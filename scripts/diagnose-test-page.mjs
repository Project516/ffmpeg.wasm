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
// then waits up to 60s for mocha's results to appear in the DOM before
// exiting. Intended to run only for a page CI already found failing, not on
// every test run.
import puppeteer from "puppeteer";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/diagnose-test-page.mjs <url>");
  process.exit(1);
}

const WAIT_MS = 60000;

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--enable-features=SharedArrayBuffer,CrossOriginIsolation",
  ],
});

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
page.on("console", (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) =>
  console.log(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`)
);

console.log(`[diagnostic] navigating to ${url}`);
await page.goto(url, { waitUntil: "load", timeout: WAIT_MS });

// mocha-headless-chrome's own completion signal (window.__mochaResult__) is
// set by a shim it injects into its own page before navigating; this is a
// separate page/browser instance without that shim, so it will never be set
// here. Just stay open for the same window CI's run got, and print whatever
// #mocha-stats shows at the end; console/pageerror/worker output arrives via
// the event listeners above as it happens, regardless of this loop.
const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const stats = await page.evaluate(() => document.querySelector("#mocha-stats")?.innerText ?? null);
    console.log(`[diagnostic] mocha-stats at +${Math.round((Date.now() - (deadline - WAIT_MS)) / 1000)}s: ${stats}`);
  } catch (err) {
    console.log(`[diagnostic] evaluate failed: ${err.message}`);
    break;
  }
}

await browser.close();
