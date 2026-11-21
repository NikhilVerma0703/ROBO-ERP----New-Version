import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { batchNosMatch, canonBatchNo } from "../src/lib/robo/batchNo.ts";
import { designMatchKey } from "../src/lib/robo/referenceSheet.ts";

/* Reports → the design beside the Batch Number.
 *
 * The owner, 26 Oct 2026: "when a user enters a Batch Number, automatically
 * display that batch's corresponding Design Name immediately to the right of
 * the Batch Number input field… Keep the Design Name display-only."
 *
 * It is a READING of the register, not a filter: nothing it shows changes what
 * the page counts, and nothing the page counts changes because it is shown. */

/** A source file as the repository holds it: LF, whatever the checkout did to
 *  it — see tests/sourceLineEndings.test.ts. */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ── Which batch the box is naming ─────────────────────────────────── */

test("the lookup follows the report's rule, so the spellings of a batch find its design", () => {
  /* The box allows free typing, and the floor types a batch several ways. The
     rule is batchNo.ts's batchNosMatch — the one the reports select slabs by
     (resolveBatchRecipeIds) — so the name beside the box names the batch the
     page is actually counting, never a different one. That includes a BARE
     NUMBER: the report counts D-1473's slabs for "1473", so the box names
     D-1473's design (code review, 26 Oct 2026). Two different prefixes are
     still two batches. tests/review1026Robo.test.ts runs the lookup itself. */
  const key = canonBatchNo("D-1473");
  for (const typed of ["D-1473", "d-1473", "d1473", "D1473", " D-1473 ", "1473"]) {
    assert.ok(batchNosMatch(typed, key), `"${typed}"`);
  }
  assert.ok(!batchNosMatch("A-1473", key), "A-1473 is another batch");
});

test("a batch nobody has run has no design, and says so rather than going blank", () => {
  // A blank space beside a typed number reads as "still loading".
  const filters = src("components/robo/RoboReportFilters.tsx");
  assert.match(filters, /no batch on record/);
  assert.match(filters, /\(batch: string\) => batchDesignName\(batch, designs\)/);
  assert.match(filters, /if \(!batchNosMatch\(typed, key\)\) continue;/);
});

/* ── Which design the batch ran ────────────────────────────────────── */

test("a mixed batch names every design in it, not the first one it finds", () => {
  // A batch can carry setups for more than one design; naming only one would
  // be wrong on exactly the batches where the question matters most.
  // One [batch key, design] pair per distinct design in the batch, newest
  // setup first (tests/review1026Robo.test.ts runs the route itself).
  const route = src("app/api/robo/batch-numbers/route.ts");
  assert.match(route, /const designs: \[string, string\]\[\] = \[\];/);
  assert.match(route, /designs\.push\(\[key, name\]\);/);
});

test("two spellings of ONE design are one design, by the Reference Sheet's own rule", () => {
  /* D-1445's setups are typed "CALACATTA GOLD" and "Calcatta gold" — those
     differ by a letter, so they are two names and the box says both, which is
     the register telling the truth about itself. But "Taj vein" and "Tajvein"
     differ only in spacing: those are ONE design and must read as one, or the
     box would name the same design twice. */
  assert.equal(designMatchKey("Taj vein"), designMatchKey("Tajvein"));
  assert.notEqual(designMatchKey("CALACATTA GOLD"), designMatchKey("Calcatta gold"));
  const route = src("app/api/robo/batch-numbers/route.ts");
  assert.match(route, /const fold = designMatchKey\(name\);/);
  assert.match(route, /if \(!folds\.has\(fold\)\) \{\s+folds\.add\(fold\);\s+designs\.push\(\[key, name\]\);/);
});

test("a setup with no design name says nothing, rather than an empty entry", () => {
  const route = src("app/api/robo/batch-numbers/route.ts");
  assert.match(route, /if \(!name \|\| !fold\) continue;/);
});

/* ── It costs one request, not one per keystroke ───────────────────── */

test("the designs come back WITH the batch list, in the one load", () => {
  /* The box fires on every keystroke. A lookup per keystroke would be a
     request per character, and the name beside the box could lag the number
     in it; read once with the list, typing costs nothing and the two cannot
     disagree. */
  const route = src("app/api/robo/batch-numbers/route.ts");
  assert.match(route, /select: \{ batchNo: true, designName: true \}/, "one query, both columns");
  assert.match(route, /NextResponse\.json\(\{ batchNumbers, designs \}\)/);
  const filters = src("components/robo/RoboReportFilters.tsx");
  assert.equal((filters.match(/fetch\("\/api\/robo\/batch-numbers"\)/g) ?? []).length, 1, "one fetch, on mount");
  assert.doesNotMatch(filters, /useEffect\([^)]*\[[^\]]*batch[^\]]*\]/, "nothing re-fetches when the box changes");
});

/* ── Display-only, and only where it was asked for ─────────────────── */

test("the design is shown, never sent: it is not part of any query", () => {
  const page = src("components/robo/reports/ReportsClient.tsx");
  // The report queries are built from the batch, the mode and the dates. The
  // design name appears in none of them.
  const queries = [...page.matchAll(/new URLSearchParams\(([\s\S]*?)\)/g)].map((m) => m[1] ?? "");
  for (const q of queries) assert.doesNotMatch(q, /design/i, "a report asks by batch, not by design");
  assert.doesNotMatch(page, /setDesign/, "nothing on the page sets it");
});

test("Downloads reads exactly as it did — the design is opt-in", () => {
  // The filter bar is shared by Reports and Downloads, and only Reports asked
  // for this. The prop is optional and the block is skipped without it.
  const filters = src("components/robo/RoboReportFilters.tsx");
  assert.match(filters, /designName\?: string;/);
  assert.match(filters, /\{designName !== undefined && typed && \(/);
  assert.doesNotMatch(src("components/robo/DownloadsClient.tsx"), /designName=/);
  assert.match(src("components/robo/reports/ReportsClient.tsx"), /designName=\{designOf\(batch\)\}/);
});

test("the batch list still works for the screens that only want the list", () => {
  // Downloads kept useRoboBatchOptions; it is now the one-line form of the
  // same load, so there is still only one way to read the batch numbers.
  const filters = src("components/robo/RoboReportFilters.tsx");
  assert.match(filters, /export function useRoboBatchOptions\([\s\S]{0,160}return useRoboBatches\(setBatch\)\.options;/);
  assert.match(src("components/robo/DownloadsClient.tsx"), /useRoboBatchOptions\(setBatch\)/);
});
