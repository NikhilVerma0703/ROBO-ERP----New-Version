// ROBO SLAB PAGE: "FROM THE PLANT" (owner, 17 Nov 2026: "Slab's plant journey").
// The words (lib/robo/slabPlantJourneyRules) and the source pins of the reader
// (lib/robo/slabPlantJourney) and the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABORTED_WORDS, journeyView, plantMinutes, stationWords, thicknessCmWords, waitMinutes, type JourneyRow,
} from "../src/lib/robo/slabPlantJourneyRules.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const blank: JourneyRow = {
  distBegin: null, distEnd: null, krsBegin: null, krsEnd: null, preBegin: null, preEnd: null,
  oveIn: null, oveOut: null, thicknessMm: null, batch: null, aborted: null,
};

test("a station on one day shows the date once; across midnight it shows it again", () => {
  assert.equal(stationWords("2026-11-14T22:05", "2026-11-14T22:41"), "14 Nov 22:05 → 22:41");
  assert.equal(stationWords("2026-11-14T23:50", "2026-11-15T00:32"), "14 Nov 23:50 → 15 Nov 00:32");
  assert.equal(stationWords("2026-11-14T22:05", null), "14 Nov 22:05");
  assert.equal(stationWords(null, "2026-11-14T22:41"), "ended 14 Nov 22:41");
  assert.equal(stationWords(null, null), null);
  assert.equal(stationWords("garbage", ""), null);
});

test("the minutes are counted from the calendar, across midnight, month and year ends", () => {
  assert.equal(plantMinutes("2026-11-14T22:05")! - plantMinutes("2026-11-14T22:00")!, 5);
  assert.equal(plantMinutes("2026-11-15T00:10")! - plantMinutes("2026-11-14T23:50")!, 20);
  assert.equal(plantMinutes("2027-01-01T00:00")! - plantMinutes("2026-12-31T23:59")!, 1);
  assert.equal(plantMinutes("2028-03-01T00:00")! - plantMinutes("2028-02-28T00:00")!, 2 * 1440, "2028 is a leap year");
  assert.equal(plantMinutes("2026-13-01T00:00"), null);
  assert.equal(plantMinutes(null), null);
});

test("the wait before the press: press begin minus the later of the distributor's and Kreos's end", () => {
  const base = { ...blank, preBegin: "2026-11-14T22:50" };
  assert.equal(waitMinutes({ ...base, distEnd: "2026-11-14T22:30", krsEnd: "2026-11-14T22:41" }), 9, "the later end");
  assert.equal(waitMinutes({ ...base, distEnd: "2026-11-14T22:30", krsEnd: null }), 20, "one end only");
  assert.equal(waitMinutes({ ...base, distEnd: null, krsEnd: "2026-11-14T22:41" }), 9);
  assert.equal(waitMinutes({ ...base, distEnd: null, krsEnd: null }), null, "no end");
  assert.equal(waitMinutes({ ...blank, distEnd: "2026-11-14T22:30" }), null, "no press begin");
  assert.equal(waitMinutes({ ...base, distEnd: "2026-11-14T23:00", krsEnd: null }), null, "negative says nothing");
  assert.equal(waitMinutes({ ...base, distEnd: "2026-11-14T22:50", krsEnd: null }), 0);
  assert.equal(waitMinutes({ preBegin: "2026-11-15T00:05", distEnd: "2026-11-14T23:50", krsEnd: null }), 15, "across midnight");
});

test("thickness in centimetres from the plant's millimetres", () => {
  assert.equal(thicknessCmWords("30"), "3 cm");
  assert.equal(thicknessCmWords("20"), "2 cm");
  assert.equal(thicknessCmWords("7"), "0.7 cm");
  assert.equal(thicknessCmWords("12"), "1.2 cm");
  assert.equal(thicknessCmWords(null), null);
  assert.equal(thicknessCmWords(""), null);
  assert.equal(thicknessCmWords("abc"), null);
});

test("the card's lines: stations in travel order, a missing station left out, facts and the wait", () => {
  const v = journeyView({
    ...blank,
    distBegin: "2026-11-14T22:05", distEnd: "2026-11-14T22:12",
    krsBegin: "2026-11-14T22:14", krsEnd: "2026-11-14T22:30",
    preBegin: "2026-11-14T22:41", preEnd: "2026-11-14T23:10",
    thicknessMm: "30", batch: "1507",
  });
  assert.deepEqual(v.stations.map((l) => l.key), ["distributor", "kreos", "press"], "no oven times: no oven line");
  assert.equal(v.stations[0].value, "14 Nov 22:05 → 22:12");
  assert.equal(v.stations[2].value, "14 Nov 22:41 → 23:10");
  assert.deepEqual(v.facts, [
    { key: "thickness", label: "Thickness", value: "3 cm" },
    { key: "batch", label: "Plant batch", value: "1507" },
  ]);
  assert.equal(v.wait, "Between the line head and the press: 11 min");
  assert.equal(v.abortedText, null);

  const empty = journeyView(blank);
  assert.deepEqual(empty, { stations: [], facts: [], wait: null, abortedText: null });
  assert.equal(journeyView({ ...blank, batch: "   " }).facts.length, 0);
});

test("the abort words only when the rule said so", () => {
  assert.equal(journeyView({ ...blank, aborted: true }).abortedText, "The press cycle was aborted");
  assert.equal(ABORTED_WORDS, "The press cycle was aborted");
  assert.equal(journeyView({ ...blank, aborted: false }).abortedText, null);
  assert.equal(journeyView({ ...blank, aborted: null }).abortedText, null);
});

test("the reader only SELECTs, names its columns, never makes a Date, and the rules module stays pure", () => {
  const reader = read("src/lib/robo/slabPlantJourney.ts");
  const rules = read("src/lib/robo/slabPlantJourneyRules.ts");
  assert.doesNotMatch(reader, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b\s+(INTO|FROM|TABLE|\w+\s+SET)/i);
  assert.doesNotMatch(reader, /\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|\.create\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(reader, /select\s+\*|\b\w\.\*|\bs\.data\s+AS\s+data\b/i, "never select * from a plant row");
  assert.doesNotMatch(reader, /new Date\(|Date\.parse|toISOString|Date\.now/);
  assert.doesNotMatch(rules, /new Date\(|Date\.parse|toISOString|Date\.now/);
  assert.doesNotMatch(rules, /from "@\//, "pure: no @/ imports");
  assert.match(reader, /plantTablesReady\(\)/);
  assert.match(reader, /to_char\(s\.sts_begin, \$\{TS_FMT\}\)/);
  assert.match(reader, /ORDER BY s\.f_id DESC\s+LIMIT 1/);
  assert.match(reader, /isAborted, pickSummary/, "the ERP's own abort rule");
  assert.match(reader, /lineHeadThicknessMm\(/);
  assert.match(reader, /misSlabNumbers\(/, "the MIS hour rule is reused");
  assert.match(reader, /\(\$\{code\(e\)\}\)/, "only the error code is logged");
  assert.doesNotMatch(reader, /console\.\w+\([^)]*\be\.message/);
});

test("the slab page shows the card and offers no Slab Lookup link", () => {
  const page = read("src/app/robo/slabs/[id]/page.tsx");
  assert.match(page, /\{plantRead\?\.state !== "off" && <SectionCard title="From the plant">/, "no plant tables: no card");
  // Why the plant says nothing, in words: never "no record" for a number it was not asked about or a failed read.
  assert.match(page, /The plant has no record of slab \$\{record\.slabNumber\}\./);
  assert.match(page, /is not a plain slab number, so the plant cannot be asked about it\./);
  assert.match(page, /plantRead\?\.state === "failed"\s*\? "Could not read the plant just now\."/);
  assert.match(page, /plainSlabNo\(record\.slabNumber\)/);
  assert.doesNotMatch(page, /href=\{?[`"]\/slab\?/);
});

test("the abort rule is given the press begin to the second, as the press log is matched", () => {
  const reader = read("src/lib/robo/slabPlantJourney.ts");
  // plantTime needs the seconds: a minute-only time ("2026-11-14T22:05") reads as null and no cycle was ever judged.
  assert.match(reader, /abortedOf\(slabNo, r\.pre_begin\)/);
  assert.doesNotMatch(reader, /abortedOf\(slabNo, preBegin\)/);
  assert.match(reader, /const s = pickSummary\(\{ slabNo, preBegin: plantTime\(preBegin\) \}, sums\);/);
  // The answer says why when the plant says nothing.
  assert.match(reader, /export type SlabPlantJourney = \{ state: "ok"; row: JourneyRow \} \| \{ state: "off" \| "none" \| "failed" \};/);
  assert.match(reader, /if \(!\(await plantTablesReady\(\)\)\) return \{ state: "off" \};/);
  assert.match(reader, /return \{ state: "failed" \};\n  \}\n\}/);
});
