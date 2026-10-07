#!/usr/bin/env node
// Loops one-frame transcodes on the JSPI core under a watchdog, to reproduce
// the intermittent hang at the end of a command. Needs Node 24.
//
//   node scripts/jspi-repro.mjs --core packages/core-jspi --procs 4 \
//     --iterations 500 --mode fresh|same --out repro-out [--trace]
//
// The parent runs --procs children. Each child runs the loop on its main thread
// and a worker watches a heartbeat. A hang may be a wasm spin or a microtask
// loop, so no timer on the main thread can fire. When the heartbeat stalls the
// worker attaches to the main thread's inspector, profiles it, pauses it and
// writes the paused frames, then kills the child. With --trace the core's
// Module.pfiberTrace appends one line per scheduler event to a file that
// is truncated at every iteration, so after a hang it holds that iteration.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Worker, isMainThread, workerData } from "node:worker_threads";
import inspector from "node:inspector";
import fs from "node:fs";
import util from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);

function parse(argv) {
  const a = { core: "packages/core-jspi", procs: 2, iterations: 200, mode: "fresh", out: "repro-out", trace: false, stall: 15000, kill: 30000, child: null, iter: 0, cases: "jpg,png,mp4" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--trace") a.trace = true;
    else if (k === "--core") a.core = argv[++i];
    else if (k === "--procs") a.procs = Number(argv[++i]);
    else if (k === "--iterations") a.iterations = Number(argv[++i]);
    else if (k === "--mode") a.mode = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--kill") a.kill = Number(argv[++i]);
    else if (k === "--stall") a.stall = Number(argv[++i]);
    else if (k === "--child") { const v = argv[++i]; a.child = v === "prep" ? "prep" : Number(v); }
    else if (k === "--iter") a.iter = Number(argv[++i]);
    else if (k === "--cases") a.cases = argv[++i];
  }
  return a;
}

let gdbBudget = 3;
const FATE_PREFIX = ["-nostdin", "-nostats", "-noauto_conversion_filters", "-cpuflags", "all"];
const CASES = {
  jpg: [...FATE_PREFIX, "-hwaccel", "none", "-threads", "1", "-thread_type", "frame+slice", "-i", "f.jpg", "-bitexact", "-f", "framecrc", "-y", "/out"],
  png: [...FATE_PREFIX, "-hwaccel", "none", "-threads", "1", "-thread_type", "frame+slice", "-i", "f.png", "-bitexact", "-f", "framecrc", "-y", "/out"],
  mp4: ["-i", "video.mp4", "-frames:v", "1", "-y", "o.png"],
};
const OUTPUT = { jpg: "/out", png: "/out", mp4: "o.png" };

if (!isMainThread) {
  await watchdog(workerData);
} else {
  const args = parse(process.argv.slice(2));
  if (args.child == null) await parent(args);
  else if (args.child === "prep") await prep(args);
  else await child(args);
}

async function parent(args) {
  fs.mkdirSync(args.out, { recursive: true });
  let hangs = 0;
  let done = 0;
  let bad = 0;
  const run = (extra, tag) => new Promise((resolve) => {
    const p = spawn(process.execPath, [...process.execArgv, scriptPath, ...process.argv.slice(2), ...extra], { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    let doneSeen = false;
    p.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.startsWith("HANG recorded")) hangs++;
        if (line.startsWith("DONE")) (done++, (doneSeen = true));
        if (line.startsWith("BAD")) bad++;
        if (!(args.mode === "proc" && (line === "DONE" || line.startsWith("ok ")))) console.log(`[${tag}] ${line}`);
      }
    });
    const killer = args.mode !== "proc" ? null : setTimeout(() => {
      hangs++;
      console.log(`[${tag}] HANG killed by parent after ${args.kill}ms, DONE printed: ${doneSeen}`);
      const pid = p.pid;
      const sh = `for t in /proc/${pid}/task/*; do echo "$(cat $t/comm) state=$(awk '{print $3}' $t/stat) utime=$(awk '{print $14}' $t/stat) wchan=$(cat $t/wchan 2>/dev/null)"; done; command -v gdb >/dev/null && timeout 60 gdb -p ${pid} -batch -ex "set pagination off" -ex "thread apply all bt 25" 2>&1 | grep -v "^\\[New\\|^warning\\|^Download" | head -150`;
      const r = spawnSync("bash", ["-c", gdbBudget-- > 0 ? sh : "true"], { encoding: "utf8", timeout: 90000 });
      console.log(`[${tag}] process state:\n${r.stdout}${r.stderr}`);
      if (args.trace) {
        try {
          fs.copyFileSync(path.join(args.out, `proc-${extra[1]}.trace`), path.join(args.out, `parent-kill-${tag.replace(":", "-")}.trace`));
          const lines = fs.readFileSync(path.join(args.out, `proc-${extra[1]}.trace`), "utf8").split("\n");
          console.log(`[${tag}] trace ${lines.length} lines, last 60:\n${lines.slice(-60).join("\n")}`);
        } catch (e) {
          console.log(`[${tag}] no trace: ${e.message}`);
        }
      }
      p.kill("SIGKILL");
    }, args.kill);
    p.on("exit", (code, sig) => {
      if (killer) clearTimeout(killer);
      if (code !== 0 || args.mode !== "proc") console.log(`[${tag}] child exit code=${code} signal=${sig}`);
      resolve();
    });
  });
  if (args.mode === "proc") {
    // One process per iteration, like scripts/fate/run.mjs.
    await run(["--child", "prep"], "prep");
    done = 0;
    await Promise.all(
      Array.from({ length: args.procs }, async (_, slot) => {
        for (let i = 0; i < args.iterations; i++) await run(["--child", String(slot), "--iter", String(i)], `${slot}:${i}`);
      })
    );
    console.log(`SUMMARY procs=${args.procs} iterations/proc=${args.iterations} mode=proc finished=${done} expected=${args.procs * args.iterations} hangs=${hangs} bad=${bad}`);
    process.exit(hangs > 0 || bad > 0 || done < args.procs * args.iterations ? 1 : 0);
  }
  await Promise.all(Array.from({ length: args.procs }, (_, i) => run(["--child", String(i)], String(i))));
  console.log(`SUMMARY procs=${args.procs} iterations/proc=${args.iterations} mode=${args.mode} finished=${done} hangs=${hangs} bad=${bad}`);
  process.exit(hangs > 0 || bad > 0 || done < args.procs ? 1 : 0);
}

async function prep(args) {
  const core = await require(path.resolve(args.core))({});
  const { VIDEO_1S_MP4, b64ToUint8Array } = require("../tests/test-helper-browser.js");
  core.FS.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
  fs.mkdirSync(path.join(args.out, "inputs"), { recursive: true });
  fs.writeFileSync(path.join(args.out, "inputs", "video.mp4"), core.FS.readFile("video.mp4"));
  for (const f of ["f.jpg", "f.png"]) {
    if ((await core.exec("-i", "video.mp4", "-frames:v", "1", "-y", f)) !== 0) throw new Error(`could not make ${f}`);
    fs.writeFileSync(path.join(args.out, "inputs", f), core.FS.readFile(f));
  }
  process.exit(0);
}

async function child(args) {
  const id = args.child;
  const traceFile = path.join(args.out, `proc-${id}.trace`);
  const stallFile = path.join(args.out, `proc-${id}.stall`);
  const hb = new Int32Array(new SharedArrayBuffer(16)); // [heartbeat, iteration]
  new Worker(scriptPath, { workerData: { hb, stall: args.stall, id, out: args.out, traceFile, stallFile } });

  process.on("uncaughtException", (e) => (console.log(`CRASH uncaught ${e?.stack ?? util.inspect(e)}`), process.exit(2)));
  process.on("unhandledRejection", (e) => (console.log(`CRASH unhandled ${e?.stack ?? util.inspect(e)}`), process.exit(2)));

  let traceFd = -1;
  const pfiberTrace = args.trace
    ? (line) => traceFd >= 0 && fs.writeSync(traceFd, `${performance.now().toFixed(1)} ${line}\n`)
    : undefined;
  const create = async () => {
    const core = await require(path.resolve(args.core))(pfiberTrace ? { pfiberTrace } : {});
    core.setLogger(({ message }) => {
      if (process.env.REPRO_LOG) console.log("ffmpeg:", message);
      if (typeof message === "string" && message.includes("pthread-fiber:")) fs.appendFileSync(stallFile, message + "\n");
    });
    core.setTimeout(60000);
    return core;
  };

  const proc = args.mode === "proc";
  const files = {};
  let boot = null;
  if (proc) {
    for (const f of ["video.mp4", "f.jpg", "f.png"]) files[f] = fs.readFileSync(path.join(args.out, "inputs", f));
  } else {
    const { VIDEO_1S_MP4, b64ToUint8Array } = require("../tests/test-helper-browser.js");
    files["video.mp4"] = b64ToUint8Array(VIDEO_1S_MP4);
    boot = await create();
    boot.FS.writeFile("video.mp4", files["video.mp4"]);
    for (const f of ["f.jpg", "f.png"]) {
      if ((await boot.exec("-i", "video.mp4", "-frames:v", "1", "-y", f)) !== 0) throw new Error(`could not make ${f}`);
      files[f] = boot.FS.readFile(f);
    }
  }

  const cases = args.cases.split(",");
  let core = args.mode === "same" ? boot : null;
  const start = Date.now();
  for (let n = 0; n < (proc ? 1 : args.iterations); n++) {
    const i = proc ? args.iter : n;
    const name = cases[i % cases.length];
    Atomics.store(hb, 1, i);
    Atomics.add(hb, 0, 1);
    if (args.trace) {
      if (traceFd >= 0) fs.closeSync(traceFd);
      fs.writeFileSync(traceFile, "");
      traceFd = fs.openSync(traceFile, "a");
      fs.writeSync(traceFd, `iteration ${i} case ${name}\n`);
    }
    if (args.mode === "fresh" || proc) core = await create();
    for (const [f, data] of Object.entries(files)) core.FS.writeFile(f, data);
    const ret = await core.exec(...CASES[name]);
    const size = core.FS.analyzePath(OUTPUT[name]).exists ? core.FS.readFile(OUTPUT[name]).length : 0;
    if (size) core.FS.unlink(OUTPUT[name]);
    if (ret !== 0 || size === 0) console.log(`BAD iteration ${i} case ${name} ret=${ret} size=${size}`);
    Atomics.add(hb, 0, 1);
    if ((i + 1) % 50 === 0) console.log(`ok ${i + 1}/${args.iterations} ${((Date.now() - start) / 1000).toFixed(0)}s`);
  }
  console.log("DONE");
  process.exit(0);
}

async function watchdog({ hb, stall, id, out, traceFile, stallFile }) {
  let last = Atomics.load(hb, 0);
  let since = Date.now();
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    const now = Atomics.load(hb, 0);
    if (now !== last) {
      last = now;
      since = Date.now();
      continue;
    }
    if (Date.now() - since < stall) continue;
    break;
  }
  const iteration = Atomics.load(hb, 1);
  const lines = [`HANG proc ${id} iteration ${iteration} after ${stall}ms without progress`];
  try {
    const session = new inspector.Session();
    session.connectToMainThread();
    const post = (method, params) => Promise.race([new Promise((resolve, reject) => session.post(method, params, (e, r) => (e ? reject(e) : resolve(r)))), new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timed out`)), 8000))]);
    await post("Debugger.enable");
    await post("Profiler.enable");
    await post("Profiler.start");
    await new Promise((r) => setTimeout(r, 2000));
    const { profile } = await post("Profiler.stop");
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const key = `${n.callFrame.functionName || "(anon)"} ${path.basename(n.callFrame.url)}:${n.callFrame.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    });
    lines.push("profile self time (us), top 15:");
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) lines.push(`  ${v} ${k}`);

    const paused = new Promise((resolve) => session.on("Debugger.paused", resolve));
    await post("Debugger.pause");
    const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 3000))]);
    if (!ev) {
      lines.push("main thread did not pause in 3s: idle (event loop waiting) or not at a safepoint");
    } else {
      lines.push("paused frames:");
      for (const f of ev.params.callFrames.slice(0, 25)) {
        lines.push(`  ${f.functionName || "(anon)"} ${path.basename(f.url)}:${f.location.lineNumber}:${f.location.columnNumber}`);
      }
      for (const f of ev.params.callFrames.filter((x) => x.url.includes("ffmpeg-core")).slice(0, 1)) {
        try {
          const r = await post("Debugger.evaluateOnCallFrame", {
            callFrameId: f.callFrameId,
            expression: "typeof pfiberResolvers !== 'undefined' ? 'resolvers=' + [...pfiberResolvers.keys()].join() + ' running=' + running : 'no scope'",
          });
          lines.push(`  scope: ${r.result.value}`);
        } catch (e) {
          lines.push(`  scope eval failed: ${e.message}`);
        }
      }
    }
  } catch (e) {
    lines.push(`inspector failed: ${e.stack ?? e}`);
  }
  try {
    const trace = fs.readFileSync(traceFile, "utf8").split("\n");
    lines.push(`trace: ${trace.length} lines, last 150:`, ...trace.slice(-150));
  } catch {
    lines.push("no trace file");
  }
  try {
    lines.push("stall reports:", fs.readFileSync(stallFile, "utf8"));
  } catch {
    lines.push("no stall reports");
  }
  const report = lines.join("\n");
  fs.writeFileSync(path.join(out, `hang-proc${id}-iter${iteration}.log`), report);
  // Synchronous: console.log from a worker goes through the hung main thread.
  fs.writeSync(1, `${lines.slice(0, 45).join("\n  ")}\nHANG recorded\n`);
  process.kill(process.pid, "SIGKILL");
}
