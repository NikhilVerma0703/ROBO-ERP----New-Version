//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/review1026Robo.test.ts
//
// Review of PR #37 (26 Oct 2026), the Robo Reports findings:
//   1. The shift band under Production Rate per Hour counted a slab by the hour
//      its Out Time fell in, not by the slab's own Shift — so at every 06:00,
//      14:00 and 22:00 its per-shift figures differed from the Shift column of
//      Download Slab Records for the same batch.
//   2. The design beside the Batch box looked the batch up by its exact
//      canonical key, while the report selects slabs by batchNosMatch — so a
//      bare "1473" counted D-1473's slabs and said "no batch on record".
//      And, from the re-check of that fix: merging the keys by walking an
//      object put number-only keys ("1473") first, so the spelling shown could
//      be an older setup's — /api/robo/batch-numbers now sends a list, newest
//      setup first, and the route is run for real here (serverActionHarness,
//      with next/server and the gate stubbed).
import { answers, calls, reset, src as srcUrl } from "./fixtures/serverActionHarness.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

import { hourlyProduction, type HourlySlab } from "../src/lib/robo/hourlyProduction.ts";
import { shiftBlockLines, shiftBlocks, shiftHourOf } from "../src/lib/robo/hourlyShifts.ts";
import { productionShiftOf } from "../src/lib/robo/productionShift.ts";
import { batchNosMatch, matchingBatchRecipeIds } from "../src/lib/robo/batchNo.ts";
import { designMatchKey } from "../src/lib/robo/referenceSheet.ts";

/** A source file as the repository holds it: LF, whatever the checkout did to
 *  it — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ══ 1. The shift band counts each slab under its own Shift ══════════════ */

/** One slab of a single-day run, in production order. */
let serial = 0;
function slab(inTime: string | null, outTime: string | null, productionShift: string | null = null, date = "2026-10-19"): HourlySlab {
  serial += 1;
  return { productionDate: date, inTime, outTime, productionShift, slabNumber: String(170000 + serial), id: `s${serial}` };
}

/** The band as the chart draws it: each block's code, hours and count. */
function band(slabs: HourlySlab[]) {
  const buckets = hourlyProduction(slabs);
  return shiftBlocks(buckets.map((b) => b.hour), buckets.map((b) => b.shiftSlabs));
}

/** The export's count: every finished slab under productionShiftOf. */
function exportCount(slabs: HourlySlab[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slabs) {
    if (!s.outTime) continue;
    const code = productionShiftOf(s);
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

function bandCount(slabs: HourlySlab[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of band(slabs)) out[b.code] = (out[b.code] ?? 0) + b.slabs;
  return out;
}

test("the finding's slab: in 13:50, out 14:10 is Shift A on the band, as in the export", () => {
  const slabs = [
    slab("13:00", "13:20"), // A
    slab("13:50", "14:10", "A"), // picked A — the finding's example
    slab("13:50", "14:10"), // no pick: its In Time says A
    slab("14:05", "14:25", "A"), // picked A five minutes after the boundary
    slab("14:30", "14:50"), // B
    slab("21:50", "22:05"), // no pick: B, out on C's first hour
    slab("22:10", "22:30"), // C
  ];
  assert.deepEqual(exportCount(slabs), { A: 4, B: 2, C: 1 });
  assert.deepEqual(
    band(slabs).map((b) => [b.code, b.slabs]),
    [["A", 4], ["B", 2], ["C", 1]],
    "was A 1, B 4, C 2 — the Out hours added up",
  );
  assert.deepEqual(band(slabs).map(shiftBlockLines), [["A", "4"], ["SHIFT B", "2 SLABS"], ["C", "1"]]);
});

test("the line above still counts by Out Time — it is the hour each slab came off", () => {
  const slabs = [slab("13:00", "13:20"), slab("13:50", "14:10", "A"), slab("14:30", "14:50")];
  const buckets = hourlyProduction(slabs);
  assert.deepEqual(buckets.map((b) => [b.hour, b.slabs]), [[13, 1], [14, 2]]);
  assert.deepEqual(buckets.map((b) => [b.hour, b.shiftSlabs]), [[13, 2], [14, 1]]);
});

test("a C slab out at 06:05 is counted under C, not under the morning's A", () => {
  const slabs = [
    slab("05:40", "05:55"), // C
    slab("05:55", "06:05"), // no pick: the finding's second example
    slab("05:50", "06:05", "C"),
    slab("06:02", "06:20", "C"), // picked C just after the change: the night that just ended
    slab("06:10", "06:30"), // A
  ];
  assert.deepEqual(exportCount(slabs), { C: 4, A: 1 });
  assert.deepEqual(band(slabs).map((b) => [b.code, b.slabs]), [["C", 4], ["A", 1]]);
});

test("the night shift is still one figure across midnight", () => {
  const slabs = [
    slab("22:30", "22:50", null, "2026-10-18"),
    slab("23:55", "00:09", null, "2026-10-18"), // crossed midnight
    slab("00:20", "00:40", null, "2026-10-19"),
    slab("05:50", "06:10", null, "2026-10-19"), // C, out on A's first hour
  ];
  assert.deepEqual(band(slabs).map((b) => [b.code, b.slabs]), [["C", 4], ["A", 0]]);
});

test("the band adds up to the line over the run: every finished slab once, nothing else", () => {
  // Two days of slabs every 10 minutes, each out 25 minutes after it went in,
  // and every seventh one picked as the shift of 15 minutes earlier — the
  // operator who has not changed the box yet. Unfinished slabs are on neither.
  const slabs: HourlySlab[] = [];
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  for (let t = 9 * 60, k = 0; t < 47 * 60; t += 10, k++) { // 19 Oct 09:00 → 20 Oct 23:00
    const date = t < 1440 ? "2026-10-19" : "2026-10-20";
    const pick = k % 7 === 0 ? productionShiftOf({ inTime: hhmm(t - 15) }) : null;
    slabs.push(slab(hhmm(t), k % 11 === 5 ? null : hhmm(t + 25), pick, date));
  }
  const buckets = hourlyProduction(slabs);
  const line = buckets.reduce((n, b) => n + b.slabs, 0);
  const onBand = buckets.reduce((n, b) => n + b.shiftSlabs, 0);
  assert.equal(line, slabs.filter((s) => s.outTime).length);
  assert.equal(onBand, line);
  assert.deepEqual(bandCount(slabs), exportCount(slabs), "each shift's figure is the export's");
});

test("a shift the chart does not reach is counted in its nearest hour, so nothing is lost", () => {
  // B picked on the run's last slab, out at 13:58: the chart ends at 13:00 and
  // has no B to put it under.
  const slabs = [slab("12:00", "12:30"), slab("13:40", "13:58", "B")];
  assert.deepEqual(band(slabs).map((b) => [b.code, b.slabs]), [["A", 2]]);
});

test("shiftHourOf: the hour of the slab's own shift nearest to when it went in", () => {
  const day = 20_000 * 1440; // any midnight, in absolute minutes
  const hourOf = (hh: number) => day / 60 + hh;
  const at = (hh: number, mm: number) => day + hh * 60 + mm;
  assert.equal(shiftHourOf({ inTime: "13:50" }, at(13, 50)), hourOf(13), "no pick: its own In hour");
  assert.equal(shiftHourOf({ productionShift: "A", inTime: "14:10" }, at(14, 10)), hourOf(13), "A that just ended");
  assert.equal(shiftHourOf({ productionShift: "B", inTime: "13:50" }, at(13, 50)), hourOf(14), "B about to start");
  assert.equal(shiftHourOf({ productionShift: "C", inTime: "06:05" }, at(6, 5)), hourOf(5), "the night just ended");
  assert.equal(shiftHourOf({ productionShift: "C", inTime: "21:55" }, at(21, 55)), hourOf(22), "the night about to start");
  assert.equal(shiftHourOf({ productionShift: "A", inTime: "05:50" }, at(5, 50)), hourOf(6));
  assert.equal(shiftHourOf({}, at(9, 30)), hourOf(9), "no shift at all: its own hour");
});

test("the chart's band reads the buckets' shiftSlabs", () => {
  const charts = src("components/robo/reports/report-charts.tsx");
  assert.match(charts, /shiftBlocks\(hours, data\.map\(\(b\) => b\.shiftSlabs\)\)/);
  assert.doesNotMatch(charts, /shiftBlocks\(hours, data\.map\(\(b\) => b\.slabs\)\)/);
});

test("the hourly route hands the band each slab's stored Shift", () => {
  const route = src("app/api/robo/reports/hourly/route.ts");
  const select = route.slice(route.indexOf("prisma.roboProductionRecord.findMany("), route.indexOf("const rows = slabs.map("));
  assert.match(select, /\n\s*productionShift: true,/);
  const rows = route.slice(route.indexOf("const rows = slabs.map("), route.indexOf("}));", route.indexOf("const rows = slabs.map(")));
  assert.match(rows, /\n\s*productionShift: s\.productionShift,/);
  assert.match(route, /hourlyProduction\(rows, delays\)/);
});

/* ══ 2. The design beside the Batch box, by the report's own rule ════════ */

const FILTERS = src("components/robo/RoboReportFilters.tsx");

/** batchDesignName as the page runs it, lifted out of the client component. */
const batchDesignName = (() => {
  const from = FILTERS.indexOf("function batchDesignName(");
  const to = FILTERS.indexOf("/**\n * Load every batch number", from);
  assert.ok(from >= 0 && to > from, "batchDesignName is in RoboReportFilters.tsx");
  const body = stripTypeScriptTypes(FILTERS.slice(from, to), { mode: "strip" });
  return new Function("batchNosMatch", "designMatchKey", `${body}\nreturn batchDesignName;`)(
    batchNosMatch,
    designMatchKey,
  ) as (batch: string, designs: [string, string][]) => string;
})();

/* The route, run for real. The harness swaps Prisma for a recorder; the two
   things it does not cover are stubbed here: Next's response helper, and the
   module gate (roboGate), which is not what these tests are about. */
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;
const MORE: Record<string, string> = {
  "next/server": stub(`export const NextResponse = { json: (body, init) => Response.json(body, init) };`),
  "@/lib/rbac": stub(`export const roboGate = async () => null;`),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (MORE[specifier]) return { url: MORE[specifier], shortCircuit: true, format: "module" };
    return nextResolve(specifier, context);
  },
});
const { GET: batchNumbersGET } = await import(srcUrl("app/api/robo/batch-numbers/route.ts"));

/** /api/robo/batch-numbers over these setups (newest first, as its query
 *  orders them), through JSON as the page receives it. */
async function batchNumbers(setups: { batchNo: string | null; designName: string | null }[]) {
  reset();
  answers["roboBatchRecipe.findMany"] = setups;
  const res: Response = await batchNumbersGET();
  assert.equal(res.status, 200);
  return await res.json() as { batchNumbers: string[]; designs: [string, string][] };
}

/** Setups as the register holds them, newest first. */
const SETUPS = [
  { id: "r1", batchNo: "D-1473", designName: "AUREATE" },
  { id: "r2", batchNo: "1473", designName: "Roots" },
  { id: "r3", batchNo: "d1473", designName: "Aureate" },
  { id: "r4", batchNo: "A-1248", designName: "Costa 2 cm" },
  { id: "r5", batchNo: "D-1248", designName: "Taj vein" },
  { id: "r6", batchNo: "D-1248", designName: "Tajvein" },
  { id: "r7", batchNo: "D-1500", designName: "" },
  { id: "r8", batchNo: "1600", designName: "Calacatta" },
];

/** The /api/robo/batch-numbers `designs` list for SETUPS, from the route. */
const DESIGNS = (await batchNumbers(SETUPS)).designs;

const asSet = (label: string) => new Set(label ? label.split(" + ").map(designMatchKey) : []);

test("a bare batch number names the design of the batch the report counts", () => {
  assert.deepEqual(asSet(batchDesignName("1473", DESIGNS)), new Set(["aureate", "roots"]));
  assert.equal(batchDesignName("1600", DESIGNS), "Calacatta");
});

test("a prefixed batch also names the setups typed with the bare number", () => {
  // The report for "D-1473" counts the bare-"1473" setups too.
  assert.deepEqual(asSet(batchDesignName("D-1473", DESIGNS)), new Set(["aureate", "roots"]));
  assert.deepEqual(asSet(batchDesignName("d1473", DESIGNS)), new Set(["aureate", "roots"]));
});

test("two prefixes stay two batches, and a bare number names both", () => {
  assert.equal(batchDesignName("A-1248", DESIGNS), "Costa 2 cm");
  assert.equal(batchDesignName("D-1248", DESIGNS), "Taj vein", "one design, spelled two ways");
  assert.deepEqual(asSet(batchDesignName("1248", DESIGNS)), new Set(["costa", "tajvein"]));
});

test("each design is named once, whichever batch keys it came under", () => {
  const label = batchDesignName("1473", [["D1473", "Taj vein"], ["1473", "Tajvein"], ["1473", "Roots"]]);
  assert.equal(label, "Taj vein + Roots", "once each, in the list's order, first spelling kept");
});

test("the route sends each batch's designs as a list, newest setup first, one pair per design", async () => {
  assert.deepEqual(DESIGNS, [
    ["D1473", "AUREATE"], // r3's "Aureate" is the same design under the same key: not repeated
    ["1473", "Roots"],
    ["A1248", "Costa 2 cm"],
    ["D1248", "Taj vein"], // r6's "Tajvein" likewise
    ["1600", "Calacatta"],
  ]);
  // Read newest first, which is what makes the first spelling the newest.
  const read = calls().find((c) => c.model === "roboBatchRecipe" && c.op === "findMany");
  assert.deepEqual(read?.args.orderBy, { createdAt: "desc" });
});

test("the spelling shown is the one the newest setup typed, though its key is the prefixed one", async () => {
  // Why it is a list: an object lists number-only keys first, in ascending
  // order, whatever order they were written in.
  assert.deepEqual(Object.keys(JSON.parse('{"D1473":"Taj vein","1473":"Tajvein"}')), ["1473", "D1473"]);

  // D-1473 typed "Taj vein" last; an older setup typed bare "1473" "Tajvein".
  const prefixedNewest = (await batchNumbers([
    { batchNo: "D-1473", designName: "Taj vein" },
    { batchNo: "1473", designName: "Tajvein" },
  ])).designs;
  for (const typed of ["1473", "D-1473", "d1473"]) {
    assert.equal(batchDesignName(typed, prefixedNewest), "Taj vein", typed);
  }
  // And the other way round: the bare number was typed last.
  const bareNewest = (await batchNumbers([
    { batchNo: "1473", designName: "Tajvein" },
    { batchNo: "D-1473", designName: "Taj vein" },
  ])).designs;
  for (const typed of ["1473", "D-1473", "d1473"]) {
    assert.equal(batchDesignName(typed, bareNewest), "Tajvein", typed);
  }
});

test("…by design, not by batch key: a key's newest setup does not speak for its older ones", async () => {
  // D-1473's newest setup is Roots; its "aureate" is older than the bare
  // "1473" setup typed "AUREATE". Ordering the keys by their newest setup
  // would show "aureate".
  const designs = (await batchNumbers([
    { batchNo: "D-1473", designName: "Roots" },
    { batchNo: "1473", designName: "AUREATE" },
    { batchNo: "D-1473", designName: "aureate" },
  ])).designs;
  assert.equal(batchDesignName("1473", designs), "Roots + AUREATE");
  assert.equal(batchDesignName("D-1473", designs), "Roots + AUREATE");
});

test("nothing typed, or nothing on record, names nothing", () => {
  assert.equal(batchDesignName("", DESIGNS), "");
  assert.equal(batchDesignName("   ", DESIGNS), "");
  assert.equal(batchDesignName("1999", DESIGNS), "");
  assert.equal(batchDesignName("D-1500", DESIGNS), "", "a setup with no design says nothing");
});

test("the name beside the box is the design of exactly the setups the report selects", () => {
  // Against the report's own selection (matchingBatchRecipeIds — the rule
  // resolveBatchRecipeIds runs), for every way the floor types these batches.
  for (const typed of ["D-1473", "d-1473", "1473", "A-1473", "1248", "A-1248", "D1248", "1600", "D-1500", "9999"]) {
    const ids = new Set(matchingBatchRecipeIds(typed, SETUPS));
    const want = new Set(SETUPS.filter((s) => ids.has(s.id) && designMatchKey(s.designName)).map((s) => designMatchKey(s.designName)));
    assert.deepEqual(asSet(batchDesignName(typed, DESIGNS)), want, typed);
  }
});

test("the page asks batchDesignName, not an exact key", () => {
  assert.match(FILTERS, /const designOf = useCallback\(\(batch: string\) => batchDesignName\(batch, designs\), \[designs\]\);/);
  assert.doesNotMatch(FILTERS, /designs\[canonBatchNo\(/);
  // It walks the route's list in its order, never an object's keys.
  assert.match(FILTERS, /for \(const \[key, name\] of designs\) \{/);
  assert.doesNotMatch(FILTERS, /Object\.(entries|keys|values)\(designs\)/);
  assert.match(FILTERS, /setDesigns\(Array\.isArray\(d\.designs\) \? d\.designs : \[\]\);/);
});
