// Runs the Mocha pages in tests/ in a Playwright browser and prints failing
// test titles with their errors.
// Usage: node scripts/test-browser.mjs <chromium|firefox|webkit> <isolated|plain>
// plain serves without COOP/COEP (no SharedArrayBuffer) and skips the mt page.
import { chromium, firefox, webkit } from "playwright";
import { serve } from "./serve.mjs";

const [browserName = "chromium", mode = "isolated"] = process.argv.slice(2);
const launcher = { chromium, firefox, webkit }[browserName];
if (!launcher || !["isolated", "plain"].includes(mode)) {
  console.error("usage: test-browser.mjs <chromium|firefox|webkit> <isolated|plain>");
  process.exit(2);
}
const isolated = mode === "isolated";
const pages = ["ffmpeg-core-st", "ffmpeg-st", "ffmpeg-esm-fallback"];
if (isolated) pages.push("ffmpeg-mt");
const PAGE_TIMEOUT_MS = 8 * 60 * 1000;

// Runs before the page scripts and wraps mocha.run() to record the result.
const collectResults = () => {
  const result = { done: false, passes: 0, failures: [] };
  window.__mochaResult = result;
  Object.defineProperty(window, "mocha", {
    configurable: true,
    set(m) {
      Object.defineProperty(window, "mocha", { value: m, writable: true, configurable: true });
      const run = m.run;
      m.run = function (...args) {
        const runner = run.apply(this, args);
        runner.on("pass", () => result.passes++);
        runner.on("fail", (test, err) =>
          result.failures.push({ title: test.fullTitle(), message: err.message })
        );
        runner.on("end", () => (result.done = true));
        return runner;
      };
    },
  });
};

const server = serve(0, { isolated });
await new Promise((resolve) => server.on("listening", resolve));
const origin = `http://localhost:${server.address().port}`;
const browser = await launcher.launch();

const runPage = async (name) => {
  const logs = [];
  const page = await browser.newPage();
  page.on("console", (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.addInitScript(collectResults);
  let result;
  try {
    await page.goto(`${origin}/tests/${name}.test.html`);
    const hasIsolation = await page.evaluate(() => crossOriginIsolated);
    if (hasIsolation !== isolated) {
      throw new Error(`crossOriginIsolated is ${hasIsolation}, expected ${isolated}`);
    }
    await page.waitForFunction(() => window.__mochaResult?.done, null, {
      timeout: PAGE_TIMEOUT_MS,
    });
    result = await page.evaluate(() => window.__mochaResult);
  } catch (err) {
    const partial = await page.evaluate(() => window.__mochaResult).catch(() => null);
    result = {
      passes: partial?.passes ?? 0,
      failures: [...(partial?.failures ?? []), { title: "(page)", message: err.message }],
    };
  }
  await page.close().catch(() => {});
  return { name, logs, ...result };
};

const results = await Promise.all(pages.map(runPage));
let failed = false;
for (const { name, logs, passes, failures } of results) {
  const label = `${name} (${browserName}, ${mode})`;
  console.log(`::group::${label}: ${passes} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`FAIL ${f.title}\n  ${f.message}`);
  if (failures.length) console.log(logs.join("\n"));
  console.log("::endgroup::");
  for (const f of failures) {
    console.log(`::error::${label}: ${f.title}: ${f.message.split("\n")[0]}`);
  }
  failed ||= failures.length > 0;
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
