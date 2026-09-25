// Diagnostic for a browser test page that mocha-headless-chrome reports as
// hung or timed out with zero tests run. mocha-headless-chrome does not print
// page console output, page errors, failed network requests, or anything a
// dedicated worker logs, so a page that throws or deadlocks before mocha
// starts is otherwise a black box.
//
// Usage: node scripts/diagnose-test-page.mjs <url>
//
// Prints every page console message, uncaught page error, failed request,
// and console message from any worker the page creates (captured over CDP,
// since Puppeteer's own Worker API does not surface worker console output),
// for a fixed window, then exits. Intended to run only for a page CI already
// found failing, not on every test run.
//
// Every step has its own hard timeout: a genuinely wedged page (a native
// tight loop that never yields to the browser's own event loop) can make
// page.evaluate() and even browser.close() itself hang, which would turn a
// diagnostic into a second, worse hang on top of the one it's investigating.
// If anything here exceeds HARD_DEADLINE_MS this process kills itself and
// the browser process directly rather than waiting indefinitely.
import puppeteer from "puppeteer";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/diagnose-test-page.mjs <url>");
  process.exit(1);
}

const WATCH_MS = 60000;
const HARD_DEADLINE_MS = WATCH_MS + 20000;

let browserRef = null;
const hardTimer = setTimeout(() => {
  console.log("[diagnostic] hard deadline exceeded, killing browser process and exiting");
  try {
    browserRef?.process()?.kill("SIGKILL");
  } catch {
    // best effort
  }
  process.exit(1);
}, HARD_DEADLINE_MS);
hardTimer.unref?.();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--enable-features=SharedArrayBuffer,CrossOriginIsolation",
  ],
});
browserRef = browser;

browser.on("targetcreated", async (target) => {
  if (target.type() !== "worker" && target.type() !== "other") return;
  try {
    const client = await target.createCDPSession();
    await client.send("Runtime.enable");
    client.on("Runtime.consoleAPICalled", (e) => {
      const text = e.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log(`[worker console:${e.type}] ${text}`);
    });
    client.on("Runtime.exceptionThrown", (e) => {
      console.log(`[worker exception] ${e.exceptionDetails.text}`);
    });
  } catch (err) {
    console.log(`[diagnostic] could not attach to worker target: ${err.message}`);
  }
});

const page = await browser.newPage();
page.setDefaultTimeout(10000);
page.on("console", (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) =>
  console.log(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`)
);

try {
  console.log(`[diagnostic] navigating to ${url}`);
  await withTimeout(page.goto(url, { waitUntil: "load" }), 15000, "page.goto");

  // mocha-headless-chrome's own completion signal (window.__mochaResult__) is
  // set by a shim it injects into its own page before navigating; this is a
  // separate page/browser instance without that shim, so it will never be
  // set here. Just watch console/pageerror/worker output (already streaming
  // via the listeners above) for a fixed window instead.
  await new Promise((r) => setTimeout(r, WATCH_MS));

  try {
    const stats = await withTimeout(
      page.evaluate(() => document.querySelector("#mocha-stats")?.innerText ?? null),
      8000,
      "page.evaluate"
    );
    console.log(`[diagnostic] mocha-stats at end of window: ${stats}`);
  } catch (err) {
    console.log(`[diagnostic] page unresponsive to evaluate() at end of window: ${err.message}`);
  }
} catch (err) {
  console.log(`[diagnostic] ${err.message}`);
} finally {
  try {
    await withTimeout(browser.close(), 10000, "browser.close");
  } catch (err) {
    console.log(`[diagnostic] browser.close() ${err.message}, killing process`);
    try {
      browser.process()?.kill("SIGKILL");
    } catch {
      // best effort
    }
  }
  clearTimeout(hardTimer);
}
