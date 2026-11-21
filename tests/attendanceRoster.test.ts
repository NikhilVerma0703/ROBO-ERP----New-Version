import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The attendance roster — the plant's operators in the plant's own order.
 *
 * THE ORDER IS THE DATA. It is the order the line is called in: Jagadeesh,
 * Rajesh, Saravanan .L, Kiran… Alphabetical would be a different document
 * from the register the floor keeps, so nothing in the module is allowed to
 * sort it into one. These tests are what stops that creeping back in. */

/** A repository file as it is held: LF, whatever the checkout did to it —
 *  see tests/sourceLineEndings.test.ts. */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const src = (p: string) => read(`src/${p}`);

/** The roster as the seed writes it, in file order. */
function seedRoster(): string[] {
  const s = read("prisma/seed-attendance.ts");
  const block = /const ROSTER = \[([\s\S]*?)\n\];/.exec(s);
  assert.ok(block, "seed-attendance.ts no longer declares ROSTER");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/* ── The owner's list, exactly ─────────────────────────────────────── */

test("the twelve operators are the owner's, in the owner's order", () => {
  assert.deepEqual(seedRoster(), [
    "Jagadeesh",
    "Rajesh",
    "Saravanan .L",
    "Kiran",
    "Praveen S.",
    "Venkatraj",
    "U Kumar",
    "Aaquib",
    "Sebul",
    "Shiva",
    "Mani Bharathi",
    "Yogender Reddy",
  ]);
});

test("the order is deliberately NOT alphabetical", () => {
  // If this ever passes, somebody has sorted the list and the register no
  // longer reads the way the line is called.
  const roster = seedRoster();
  const sorted = [...roster].sort((a, b) => a.localeCompare(b));
  assert.notDeepEqual(roster, sorted, "the roster has been alphabetised");
  assert.equal(roster[0], "Jagadeesh");
  assert.equal(sorted[0], "Aaquib");
});

test("the names are spelt the way the register writes them", () => {
  const roster = seedRoster();
  // The space and the stop are the owner's, and a tidy-up would quietly
  // create a second operator next time the seed runs.
  assert.ok(roster.includes("Saravanan .L"), "Saravanan .L, with the space");
  assert.ok(roster.includes("Praveen S."), "Praveen S., with the stop");
  assert.equal(new Set(roster).size, roster.length, "no name is listed twice");
  for (const n of roster) assert.equal(n, n.trim(), `"${n}" has stray space at an end`);
});

test("the seed numbers them 1..12 from their position, and is safe to run twice", () => {
  const s = read("prisma/seed-attendance.ts");
  assert.match(s, /const sortOrder = i \+ 1;/);
  assert.match(s, /attendanceOperator\.upsert/);
  assert.doesNotMatch(s, /deleteMany|\.delete\(/, "a seed must not remove anybody's operator");
});

/* ── Nothing re-sorts it ───────────────────────────────────────────── */

test("the roster is read in its own order, by the column that holds it", () => {
  const s = src("lib/attendance/server.ts");
  assert.match(s, /orderBy: \[\{ sortOrder: "asc" \}, \{ id: "asc" \}\]/);
});

test("the alphabetical comparator is gone, not merely unused", () => {
  // It sorted the register until the owner's order arrived. Left exported, it
  // is one import away from sorting it again.
  const s = src("lib/attendance/attendance.ts");
  assert.doesNotMatch(s, /compareOperatorNames/);
  for (const p of ["lib/attendance/server.ts", "components/attendance/AttendanceClient.tsx"]) {
    assert.doesNotMatch(src(p), /compareOperatorNames/, p);
  }
});

test("the page shows the roster as the server hands it over", () => {
  // Any .sort() on the operator list in the page would undo the order on the
  // way to the screen, whatever the server did.
  const s = src("components/attendance/AttendanceClient.tsx");
  assert.doesNotMatch(s, /operators[\s\S]{0,40}\.sort\(/);
  assert.doesNotMatch(s, /rows[\s\S]{0,20}\.sort\(/);
});

test("the sheet reads down the page in the same order as the register", () => {
  const s = src("lib/attendance/server.ts");
  // …and an operator's shifts of a date in shift order (7 Nov 2026).
  assert.match(s, /orderBy: \[\{ date: "asc" \}, \{ operator: \{ sortOrder: "asc" \} \}, \{ operatorId: "asc" \}, \{ shiftNo: "asc" \}\]/);
});

/* ── Adding, renaming, removing ────────────────────────────────────── */

test("a new operator joins at the end, so adding one never moves another", () => {
  const s = src("lib/attendance/server.ts");
  // Read inside the write's own transaction, so two tablets adding an operator
  // at once cannot both read the same last number.
  assert.match(s, /async function nextSortOrder\(tx: Tx\)/);
  assert.match(s, /return \(last\?\.sortOrder \?\? 0\) \+ 1;/);
  assert.match(s, /data: \{ name, sortOrder: await nextSortOrder\(tx\) \}/);
});

test("the three operator actions are all still there", () => {
  const s = src("lib/attendance/server.ts");
  assert.match(s, /head === "operators" && !id/);     // GET + POST (add)
  assert.match(s, /attendanceOperator\.update/);       // PATCH (rename)
  assert.match(s, /attendanceOperator\.delete/);       // DELETE (remove)
  const page = src("components/attendance/AttendanceClient.tsx");
  for (const label of [">Add<", ">Rename<", ">Remove<"]) {
    assert.ok(page.includes(label), `the page offers ${label.replace(/[<>]/g, "")}`);
  }
});

test("renaming does not reorder: a rename cannot even name sortOrder", () => {
  // The shape of what a PATCH may write is the guarantee — a rename changes
  // the name and whether they are on the roster, and has no way to say where
  // in the list they sit.
  const s = src("lib/attendance/server.ts");
  assert.match(s, /const data: \{ name\?: string; isActive\?: boolean \} = \{\};/);
});
