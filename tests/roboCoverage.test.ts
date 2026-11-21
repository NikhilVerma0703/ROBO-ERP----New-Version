// ROBO REPORTS: MADE BY THE PLANT vs ENTERED IN ROBO (owner, 17 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compressRanges, coverage, COVERAGE_MAX_BATCHES } from "../src/lib/robo/coverage.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("compressRanges: ascending, each number once, runs joined", () => {
  assert.equal(compressRanges([]), "");
  assert.equal(compressRanges([172610, 172602, 172600, 172601, 172603, 172604, 172600]), "172600–172604, 172610");
  assert.equal(compressRanges([5]), "5");
  assert.equal(compressRanges([1, 3, 5]), "1, 3, 5");
  assert.equal(compressRanges([1, 2]), "1–2");
  assert.equal(compressRanges([NaN, 4, 6]), "4, 6");
});

test("coverage: made, entered and the numbers not entered", () => {
  const c = coverage([172600, 172601, 172602, 172603, 172603], [172601, 172603, 999, 172601]);
  assert.deepEqual(c, { made: 4, entered: 2, notEntered: [172600, 172602] });
  assert.deepEqual(coverage([], [1, 2]), { made: 0, entered: 0, notEntered: [] });
  assert.deepEqual(coverage([7, 8], []), { made: 2, entered: 0, notEntered: [7, 8] });
  assert.deepEqual(coverage([7, 8], [8, 7]), { made: 2, entered: 2, notEntered: [] });
  assert.ok(COVERAGE_MAX_BATCHES === 40);
});

test("the coverage route: gate first, SELECT only, entered by number, never a 500", () => {
  const src = read("src/app/api/robo/reports/coverage/route.ts");
  assert.match(src, /export async function GET\(req: NextRequest\) \{\n  const refused = await roboGate\(\);\n  if \(refused\) return refused;\n/);
  assert.match(src, /import \{ roboGate \} from "@\/lib\/rbac"/);
  assert.doesNotMatch(src, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s)/i);
  assert.doesNotMatch(src, /\$executeRaw|\.(create|update|upsert|delete|deleteMany|updateMany|createMany)\(/);
  assert.doesNotMatch(src, /SELECT\s+\*|\bs\.\*|\br\.\*/i);
  assert.match(src, /plantTablesReady\(\)/);
  assert.match(src, /btrim\(r\."slabNumber"\)::int/);
  assert.match(src, /\[\[:space:\]\]\*\[0-9\]\{1,9\}\[\[:space:\]\]\*\$/);
  assert.match(src, /misSlabNumbers/);
  assert.match(src, /normalizeBatch/);
  assert.match(src, /state: "off"/);
  assert.match(src, /state: "failed"/);
  // The message of a fault is never logged, only its code.
  assert.doesNotMatch(src, /console\.\w+\([^)]*\be\.message/);
});

test("the report card fetches the coverage on its own, not inside the summary load", () => {
  const client = read("src/components/robo/reports/ReportsClient.tsx");
  assert.match(client, /<CoverageCard query=\{query\} \/>/);
  const card = read("src/components/robo/reports/CoverageCard.tsx");
  assert.match(card, /\/api\/robo\/reports\/coverage\$\{query\}/);
  assert.match(card, /A slab the robots did not touch is not entered in Robo; that is expected\./);
});
