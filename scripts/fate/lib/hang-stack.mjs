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

const probe = [
  "fd", "iov", "iovcnt", "pnum", "num",
  "HEAP8.length", "HEAPU32.length", "HEAP8.buffer === wasmMemory.buffer",
  "wasmMemory.buffer.byteLength", "Array.from(HEAPU32.slice(iov >> 2, (iov >> 2) + 4))",
  "HEAPU32[pnum >> 2]", "typeof Asyncify !== 'undefined' && Asyncify.state",
];

async function pause() {
  let frames = null;
  s.on("Debugger.paused", (m) => { frames = m.params.callFrames; });
  await post("Debugger.enable");
  for (let attempt = 0; attempt < 30; attempt++) {
    frames = null;
    await post("Debugger.pause");
    for (let i = 0; i < 100 && !frames; i++) await sleep(50);
    if (!frames) return out("pause: not paused");
    if (frames[0].functionName === "_fd_write") break;
    await post("Debugger.resume");
    await sleep(7);
  }
  out("pause: " + frames.length + " frames, top " + frames[0].functionName);
  for (const expression of probe) {
    try {
      const r = await post("Debugger.evaluateOnCallFrame", { callFrameId: frames[0].callFrameId, expression, returnByValue: true });
      out(expression + " = " + JSON.stringify(r.result.value ?? r.result.description));
    } catch (e) {
      out(expression + " failed: " + e.message);
    }
  }
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
