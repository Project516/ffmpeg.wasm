import assert from "node:assert/strict";
import { test } from "node:test";
import { benchBaselineFrom, compareBench, compareFate, fateBaselineFrom } from "./compare.mjs";

const report = (tests) => ({ tests });
const baseline = { "a.mak": { pass: ["p1", "p2", "p3"], fail: { f1: "bad" }, skip: { s1: "no sample" } } };

test("fate: a passing test that now fails is a regression", () => {
  const r = compareFate(baseline, report([
    { name: "p1", status: "pass" },
    { name: "p2", status: "fail", reason: "timeout" },
    { name: "p3", status: "skip", reason: "sample not fetched" },
    { name: "f1", status: "pass" },
    { name: "s1", status: "skip" },
    { name: "new1", status: "pass" },
  ]));
  assert.equal(r.regressions.length, 1);
  assert.match(r.regressions[0], /fate-p2.*timeout/);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.fixed, ["f1"]);
  assert.deepEqual(r.added, ["new1"]);
});

test("fate: a baseline failure that still fails is not a regression", () => {
  const r = compareFate(baseline, report([
    { name: "p1", status: "pass" },
    { name: "p2", status: "pass" },
    { name: "p3", status: "pass" },
    { name: "f1", status: "fail", reason: "bad" },
  ]));
  assert.equal(r.regressions.length, 0);
  assert.deepEqual(r.fixed, []);
});

test("fate: results round trip through the baseline shape", () => {
  const groups = fateBaselineFrom({
    tests: [
      { name: "a", makFile: "x.mak", status: "pass" },
      { name: "b", makFile: "x.mak", status: "fail", reason: "r" },
      { name: "c", makFile: "y.mak", status: "skip", reason: "s" },
    ],
  });
  assert.deepEqual(groups, { "x.mak": { pass: ["a"], fail: { b: "r" } }, "y.mak": { pass: [], skip: { c: "s" } } });
});

const bench = (wasmMs, rss) => ({
  caseNames: ["c"],
  native: { cases: [{ name: "c", medianWallMs: 100 }] },
  cores: [{ label: "st", cases: [{ name: "c", medianWallMs: wasmMs, medianPeakRssKb: rss }] }],
});
const benchBaseline = { cores: { st: { c: { ratio: 4, peakRssKb: 200000 } } } };

test("bench: within noise passes", () => {
  const r = compareBench(benchBaseline, bench(410, 205000));
  assert.deepEqual([r.failures.length, r.warnings.length], [0, 0]);
});

test("bench: 20 to 50 percent over warns, more fails", () => {
  assert.deepEqual([compareBench(benchBaseline, bench(500, 200000)).warnings.length, compareBench(benchBaseline, bench(500, 200000)).failures.length], [1, 0]);
  assert.equal(compareBench(benchBaseline, bench(700, 200000)).failures.length, 1);
  assert.equal(compareBench(benchBaseline, bench(400, 320000)).failures.length, 1);
});

test("bench: a case with no successful runs fails", () => {
  assert.equal(compareBench(benchBaseline, bench(null, null)).failures.length, 1);
});

test("bench: baseline stores the wasm/native ratio", () => {
  const b = benchBaselineFrom(bench(450, 1000));
  assert.equal(b.cores.st.c.ratio, 4.5);
});
