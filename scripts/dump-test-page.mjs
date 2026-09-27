// Dumps a test page's console, page errors, failed requests, and the console
// output of any worker it creates.
//
// mocha-headless-chrome reports only pass/fail, so a page that wedges, throws
// before mocha starts, or fails inside a Web Worker is otherwise a black box.
// This is the difference between "ffmpeg-st failed" and the line that failed.
//
// Uses puppeteer-core, which mocha-headless-chrome already depends on, so it
// adds nothing to the lockfile. Worker output has to come over CDP: Puppeteer's
// own Worker API does not surface a worker's console.
//
// Usage: node scripts/dump-test-page.mjs <url> [watchMs]
import puppeteer from "puppeteer-core";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/dump-test-page.mjs <url> [watchMs]");
  process.exit(1);
}
const WATCH_MS = Number(process.argv[3] || 45000);

let browser = null;
const hardTimer = setTimeout(() => {
  console.log("[dump] hard deadline reached, killing the browser and exiting");
  try {
    browser?.process()?.kill("SIGKILL");
  } catch {
    // best effort
  }
  process.exit(1);
}, WATCH_MS + 45000);
hardTimer.unref?.();

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: [
    "--no-sandbox",
    "--enable-features=SharedArrayBuffer,CrossOriginIsolation",
  ],
});

browser.on("targetcreated", async (target) => {
  const type = target.type();
  if (type !== "worker" && type !== "shared_worker" && type !== "service_worker" && type !== "other") return;
  try {
    const session = await target.createCDPSession();
    await session.send("Runtime.enable");
    session.on("Runtime.consoleAPICalled", (e) => {
      const text = e.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log(`[worker console:${e.type}] ${text}`);
    });
    session.on("Runtime.exceptionThrown", (e) => {
      const d = e.exceptionDetails;
      console.log(`[worker exception] ${d.text} ${d.exception?.description ?? ""}`);
    });
  } catch (err) {
    console.log(`[dump] could not attach to a ${type} target: ${err.message}`);
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
  console.log(`[dump] navigating to ${url}`);
  // A navigation timeout must not skip the observation window: a page that
  // never fires `load` is exactly the case worth watching.
  try {
    await withTimeout(page.goto(url, { waitUntil: "load" }), 15000, "page.goto");
  } catch (err) {
    console.log(`[dump] ${err.message}; watching anyway`);
  }

  await new Promise((r) => setTimeout(r, WATCH_MS));

  try {
    const stats = await withTimeout(
      page.evaluate(() => document.querySelector("#mocha-stats")?.innerText?.replace(/\n/g, " ") ?? null),
      8000,
      "page.evaluate"
    );
    console.log(`[dump] mocha-stats: ${stats}`);
  } catch (err) {
    console.log(`[dump] page unresponsive to evaluate(): ${err.message}`);
  }
} finally {
  try {
    await withTimeout(browser.close(), 10000, "browser.close");
  } catch (err) {
    console.log(`[dump] ${err.message}; killing the browser process`);
    try {
      browser.process()?.kill("SIGKILL");
    } catch {
      // best effort
    }
  }
  clearTimeout(hardTimer);
}
