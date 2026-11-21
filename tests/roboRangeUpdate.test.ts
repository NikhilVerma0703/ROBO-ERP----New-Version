import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { forwardRunIds, inRunOrder } from "../src/lib/robo/rangeUpdate.ts";
import { productionDateOf } from "../src/lib/robo/productionDate.ts";
import { roboThicknessKey } from "../src/lib/robo/thickness.ts";

/* The "apply from this slab forward" rule. A batch saved with one date (or one
   thickness) on the whole run gets corrected by editing the slab where the
   change begins; the run must carry forward to the next change and no further,
   and must never reach back to earlier slabs. */

// A batch all on one date, slab numbers in production order. id "s<n>" is the
// n-th slab produced; its physical slab number is 148000 + n.
const batch = (dates: Record<number, string | null>) =>
  Object.entries(dates).map(([sno, d]) => ({
    id: `s${sno}`,
    slabNumber: String(148000 + Number(sno)),
    serialNumber: Number(sno),
    createdAt: new Date(2025, 0, 1, 0, Number(sno)),
    productionDate: d,
    batchRecipe: { productionDate: "2025-08-19" },
    shift: { date: "2025-08-19" },
  }));

const key = (s: { productionDate?: string | null; batchRecipe?: { productionDate?: string | null } | null; shift?: { date?: string | null } | null }) =>
  productionDateOf(s);

test("forwardRunIds: all one date — editing S.No.18 takes 18 to the end", () => {
  // Nothing overridden yet: every slab falls back to the batch's 19 Aug.
  const slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const run = forwardRunIds(slabs, "s18", key);
  assert.deepEqual(run, ["s18", "s110", "s111", "s123"]);
  // 1 and 17 are BEFORE 18 — never in the run.
  assert.ok(!run.includes("s1"));
  assert.ok(!run.includes("s17"));
});

test("forwardRunIds: a later change-point stops the run (111 already 21 Aug)", () => {
  // 111-123 were corrected to 21 Aug first; now editing 18 must stop at 110.
  const slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: "2025-08-21", 123: "2025-08-21" });
  const run = forwardRunIds(slabs, "s18", key);
  assert.deepEqual(run, ["s18", "s110"]);
  assert.ok(!run.includes("s111"));
  assert.ok(!run.includes("s123"));
});

test("forwardRunIds: the two orders land on the same final state", () => {
  // Order A: 18 first (18..123 -> 20 Aug), then 111 (111..123 -> 21 Aug).
  let slabs = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const runA1 = forwardRunIds(slabs, "s18", key); // -> 18,110,111,123
  assert.deepEqual(runA1, ["s18", "s110", "s111", "s123"]);
  // apply 20 Aug to that run
  slabs = slabs.map((s) => (runA1.includes(s.id) ? { ...s, productionDate: "2025-08-20" } : s));
  const runA2 = forwardRunIds(slabs, "s111", key); // 111,123 share 20 Aug -> both
  assert.deepEqual(runA2, ["s111", "s123"]);

  // Order B: 111 first (111,123 -> 21 Aug), then 18 (stops at 110).
  let slabsB = batch({ 1: null, 17: null, 18: null, 110: null, 111: null, 123: null });
  const runB1 = forwardRunIds(slabsB, "s111", key);
  assert.deepEqual(runB1, ["s111", "s123"]);
  slabsB = slabsB.map((s) => (runB1.includes(s.id) ? { ...s, productionDate: "2025-08-21" } : s));
  const runB2 = forwardRunIds(slabsB, "s18", key);
  assert.deepEqual(runB2, ["s18", "s110"]); // stops before the 21 Aug at 111
});

test("forwardRunIds: an unknown start id yields just itself — never nothing", () => {
  const slabs = batch({ 1: null, 2: null });
  assert.deepEqual(forwardRunIds(slabs, "missing", key), ["missing"]);
});

test("forwardRunIds: works the same for thickness keys", () => {
  const slabs = [10, 11, 12, 13].map((sno) => ({
    id: `s${sno}`,
    slabNumber: String(148000 + sno),
    thickness: null as number | null,
    batchRecipe: { thickness: 20 },
  }));
  // all fall back to 20 -> editing 11 takes 11..13
  assert.deepEqual(forwardRunIds(slabs, "s11", roboThicknessKey), ["s11", "s12", "s13"]);
  // now 13 is its own 15 -> editing 11 stops at 12
  const slabs2 = slabs.map((s) => (s.id === "s13" ? { ...s, thickness: 15 } : s));
  assert.deepEqual(forwardRunIds(slabs2, "s11", roboThicknessKey), ["s11", "s12"]);
});

// ── ROBO-1 (code review of 20 Oct 2026) ─────────────────────────────────────
// "Following" is production order — the physical slab number — never the stored
// S.No. The review's case: an old batch whose S.No. was mistyped 1…36 and then
// started again at 24, all on one date. Ordered by S.No. the 37th slab (stored
// S.No. 24) sat just before the 25th, so editing it forward rewrote the 25th to
// the 36th — slabs produced BEFORE it.
const mistyped = () =>
  Array.from({ length: 50 }, (_, i) => {
    const n = i + 1; // the n-th slab produced
    return {
      id: `p${n}`,
      slabNumber: String(148700 + n),
      serialNumber: n <= 36 ? n : n - 13, // 1…36, then 24…37
      createdAt: new Date(2025, 0, 1, 0, n),
      productionDate: null as string | null,
      batchRecipe: { productionDate: "2025-08-19", thickness: 20 },
      shift: { date: "2025-08-19" },
      thickness: null as number | null,
      batchRecipeId: "recipe-1",
    };
  });
const physical = (ids: string[]) => ids.map((id) => Number(id.slice(1)));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test("ROBO-1: a forward date edit on the 37th slab of a mistyped batch never reaches back to the 25th-36th", () => {
  const slabs = mistyped();
  // The stored S.No. really does put the 37th slab among the earlier ones.
  assert.equal(slabs[36].serialNumber, 24);
  assert.equal(slabs[23].serialNumber, 24);
  const run = physical(forwardRunIds(slabs, "p37", key));
  assert.deepEqual(run, range(37, 50));
  for (const earlier of range(1, 36)) assert.ok(!run.includes(earlier), `slab ${earlier} must not move`);
});

test("ROBO-1: the thickness run and the Batch No./Design split follow the same production order", () => {
  const slabs = mistyped();
  assert.deepEqual(physical(forwardRunIds(slabs, "p37", roboThicknessKey)), range(37, 50));
  // The split keys every slab on its batch, so the run is this slab to the end.
  assert.deepEqual(physical(forwardRunIds(slabs, "p37", (s) => s.batchRecipeId ?? "")), range(37, 50));
  assert.deepEqual(physical(forwardRunIds(slabs, "p24", (s) => s.batchRecipeId ?? "")), range(24, 50));
});

test("ROBO-1: the run is the same whatever order the rows arrive in", () => {
  const slabs = mistyped();
  // Shuffled, and in the old S.No.-then-createdAt order the handler used to query.
  const shuffled = [...slabs].reverse();
  const bySerial = [...slabs].sort((a, b) => a.serialNumber - b.serialNumber || a.createdAt.getTime() - b.createdAt.getTime());
  for (const rows of [shuffled, bySerial]) {
    assert.deepEqual(physical(forwardRunIds(rows, "p37", key)), range(37, 50));
  }
});

test("ROBO-1: a later change-point still stops the run in production order", () => {
  // The 45th onward already read 21 Aug; editing the 37th stops at the 44th.
  const slabs = mistyped().map((s, i) => (i + 1 >= 45 ? { ...s, productionDate: "2025-08-21" } : s));
  assert.deepEqual(physical(forwardRunIds(slabs, "p37", key)), range(37, 44));
});

test("inRunOrder: slab number as a number, then entry time, then id; the input is not reordered", () => {
  const rows = [
    { id: "d", slabNumber: "A-12", createdAt: new Date(2025, 0, 1) },
    { id: "c", slabNumber: "148776", createdAt: new Date(2025, 0, 1) },
    { id: "b", slabNumber: "148775", createdAt: new Date(2025, 0, 3) },
    { id: "a", slabNumber: "148775", createdAt: new Date(2025, 0, 2) },
    { id: "e", slabNumber: "9", createdAt: "2025-01-05T00:00:00.000Z" },
  ];
  const before = rows.map((r) => r.id);
  assert.deepEqual(inRunOrder(rows).map((r) => r.id), ["e", "a", "b", "c", "d"]);
  assert.deepEqual(rows.map((r) => r.id), before);
});

test("ROBO-1: the PATCH handler hands forwardRunIds slab number and entry time, and orders neither run by S.No.", () => {
  const src = readFileSync(new URL("../src/app/api/robo/production/[id]/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /orderBy:\s*\[\s*\{\s*serialNumber/);
  const queries = [...code.matchAll(/const (batchSlabs|runSlabs) = await tx\.roboProductionRecord\.findMany\(\{([\s\S]*?)\n\s*\}\);/g)];
  assert.deepEqual(queries.map((m) => m[1]), ["batchSlabs", "runSlabs"]);
  for (const [, name, body] of queries) {
    assert.match(body, /slabNumber: true/, `${name} selects the slab number`);
    assert.match(body, /createdAt: true/, `${name} selects the entry time`);
    assert.doesNotMatch(body, /orderBy/, `${name} leaves the order to forwardRunIds`);
  }
  // And the rule file no longer offers an S.No. ordering to reach for.
  const rule = readFileSync(new URL("../src/lib/robo/rangeUpdate.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(rule, /export function bySerialThenCreated/);
  assert.match(rule, /import \{ compareSlabOrder, type SeqSlab \} from "\.\/slabSequence\.ts";/);
});
