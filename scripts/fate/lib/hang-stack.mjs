// Prints where a wedged core is executing. A core stuck in native code never
// returns control to JS, so the sampling happens on another thread that
// attaches to the main thread's inspector. Output goes through writeSync
// because a worker's stderr is relayed by the main thread, which is the one
// that is stuck. Kills the process once it has reported.
import { Worker } from "node:worker_threads";

const source = `
const { Session } = require("node:inspector");
const { writeSync } = require("node:fs");
const { workerData } = require("node:worker_threads");
const out = (t) => writeSync(2, "pthread-fiber: stack: " + t + "\\n");
const s = new Session();
s.connectToMainThread();
const post = (m, p) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("no reply to " + m)), 15000);
    s.post(m, p, (e, r) => { clearTimeout(t); e ? rej(e) : res(r); });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = (f) => (f.functionName || "?") + "@" + (f.url || "").slice(-20) + ":" + f.lineNumber + ":" + f.columnNumber;

async function profile() {
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 500 });
  await post("Profiler.start");
  await sleep(3000);
  const { profile } = await post("Profiler.stop");
  const parent = new Map();
  const byId = new Map();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children || []) parent.set(c, n.id);
  }
  const self = new Map();
  for (const id of profile.samples) self.set(id, (self.get(id) || 0) + 1);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  out("profile, " + profile.samples.length + " samples");
  for (const [id, count] of top) {
    const chain = [];
    for (let at = id; at !== undefined && chain.length < 40; at = parent.get(at)) chain.push(name(byId.get(at).callFrame));
    out(count + " samples in " + chain.join(" < "));
  }
}

async function pause() {
  const paused = new Promise((res) => s.on("Debugger.paused", (m) => res(m.params)));
  await post("Debugger.enable");
  await post("Debugger.pause");
  const p = await Promise.race([paused, sleep(15000).then(() => null)]);
  if (!p) return out("pause: not paused");
  out("pause: " + p.callFrames.length + " frames");
  out(p.callFrames.slice(0, 60).map((f) => name(f)).join(" < "));
}

(async () => {
  await sleep(workerData.afterMs);
  out("sampling after " + workerData.afterMs + "ms");
  try { await profile(); } catch (e) { out("profile failed: " + e.message); }
  try { await pause(); } catch (e) { out("pause failed: " + e.message); }
  process.kill(process.pid, "SIGKILL");
})();
`;

export function startHangSampler(afterMs) {
  new Worker(source, { eval: true, workerData: { afterMs } }).unref();
}
