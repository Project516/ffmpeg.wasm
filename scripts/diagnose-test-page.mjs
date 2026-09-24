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

const deadline = Date.now() + WAIT_MS;
let stats = null;
while (Date.now() < deadline) {
  stats = await page.evaluate(() => {
    const el = document.querySelector("#mocha-stats");
    if (!el) return null;
    return el.innerText;
  });
  if (stats) break;
  await new Promise((r) => setTimeout(r, 1000));
}

console.log(stats ? `[diagnostic] mocha-stats:\n${stats}` : "[diagnostic] mocha never reported stats within 60s");

await browser.close();
