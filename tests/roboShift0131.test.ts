// scripts/0131 and model RoboShift in prisma/schema.prisma describe the same
// change: one shift row per date and shift number, held by a unique index on
// "RoboShift" ("date", "shiftNumber") — the database half of ROBO-8 (code
// review of 20 Oct 2026), where two register imports at once each made the
// date's shift row and recorded every slab on both. This holds the script to
// the schema (the index Prisma would name and build for the @@unique) and to
// the repo's rules: one transaction under a lock timeout, every statement safe
// to run twice, a refusal before any change when the index could not be
// built, no row changed, logged once. It also holds the code to the promise
// the script's header makes: it works whether or not the index is there.
//
// Every file is READ, never run: no database is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const FILE = "scripts/0131-robo-shift-date-unique.sql";
const SQL = src(FILE);
/** The script with its comments out: what Postgres runs. */
const RUN = SQL.replace(/--.*$/gm, "");
/** The comment block above BEGIN: what a reader is told before it runs. */
const HEADER = SQL.slice(0, SQL.search(/^BEGIN;/m));

/** The script cut into statements: on `;` outside a string and outside a DO $$ … $$ body. */
function statements(run: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let dollar = false;
  for (let i = 0; i < run.length; i++) {
    if (!quoted && run.startsWith("$$", i)) { dollar = !dollar; cur += "$$"; i++; continue; }
    const c = run[i]!;
    if (!dollar && c === "'") quoted = !quoted;
    if (!quoted && !dollar && c === ";") { if (cur.trim()) out.push(cur.trim().replace(/\s+/g, " ")); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\s+/g, " "));
  return out;
}
const STATEMENTS = statements(RUN);

const SCHEMA = src("prisma/schema.prisma");
const ROBO_SHIFT = /^model RoboShift \{([\s\S]*?)^\}/m.exec(SCHEMA)?.[1] ?? "";

const INDEX = '"RoboShift_date_shiftNumber_key"';

// ─────────────────────────────── the schema ───────────────────────────────────

test("model RoboShift declares @@unique([date, shiftNumber]), unmapped, on two required columns", () => {
  assert.ok(ROBO_SHIFT, "model RoboShift found");
  const attrs = ROBO_SHIFT.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("@@"));
  assert.deepEqual(attrs, ["@@unique([date, shiftNumber])"], "the one key, no map: and no @@map on the table");
  assert.match(ROBO_SHIFT, /^\s+date\s+String\s*$/m, "date is a required String, so the index has no NULLs to let through");
  assert.match(ROBO_SHIFT, /^\s+shiftNumber\s+Int\s*$/m);
  assert.match(ROBO_SHIFT, /scripts\/0131-robo-shift-date-unique\.sql/, "the model says which script put it in production");
});

test("the script builds exactly the index Prisma names and builds for that key", () => {
  const made = [...RUN.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS ("\w+") ON ("\w+") \(([^)]*)\);/g)];
  assert.equal(made.length, 1, "one index");
  const [, unique, name, table, cols] = made[0]!;
  assert.ok(unique, "unique");
  // Prisma's own name for @@unique([date, shiftNumber]) on the unmapped RoboShift.
  assert.equal(name, INDEX);
  assert.equal(table, '"RoboShift"');
  assert.deepEqual(cols!.split(",").map((c) => c.trim()), ['"date"', '"shiftNumber"']);
  assert.ok(name!.length < 63);
  // A unique INDEX, as Prisma writes one, never a constraint.
  assert.doesNotMatch(RUN, /ADD CONSTRAINT|\bUNIQUE \(/);
});

// ─────────────────────────────── the script ───────────────────────────────────

test("0131 is one transaction under a lock timeout, and every statement is safe to run twice", () => {
  assert.equal(RUN.match(/^\s*BEGIN;/gm)?.length, 1, "one BEGIN");
  assert.equal(RUN.match(/^\s*COMMIT;/gm)?.length, 1, "one COMMIT");
  assert.equal(STATEMENTS[0], "BEGIN");
  assert.equal(STATEMENTS[STATEMENTS.length - 1], "COMMIT");
  assert.equal(STATEMENTS[1], "SET LOCAL lock_timeout = '5s'", "the lock timeout comes first and lasts only to COMMIT");
  for (const s of STATEMENTS.slice(2, -1)) {
    if (/^DO \$\$ DECLARE .* BEGIN .*RAISE EXCEPTION .* END \$\$$/.test(s)) continue;
    if (s === "CREATE TEMP TABLE changed (what text) ON COMMIT DROP") continue;
    if (s === `INSERT INTO changed SELECT 'added ' || n FROM unnest(ARRAY['RoboShift_date_shiftNumber_key']) AS n WHERE to_regclass(quote_ident(n)) IS NULL`) continue;
    if (s === `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON "RoboShift" ("date", "shiftNumber")`) continue;
    if (/^INSERT INTO action_log /.test(s)) continue;
    if (s === "SELECT count(*) AS indexes_changed FROM changed") continue;
    assert.fail(`not safe to run twice, or not this change: ${s.slice(0, 160)}`);
  }
});

test("no row is changed: nothing deleted, updated, merged or altered — the duplicates are counted, never settled", () => {
  assert.doesNotMatch(RUN, /\bDROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|DEFAULT|NOT NULL|SCHEMA|VIEW|INDEX)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"?\w+"?\s+SET\b|\bALTER\s+(TABLE|TYPE|INDEX)\b|\bRENAME\b/i,
    "the UNDO stays commented out");
  assert.deepEqual([...new Set([...RUN.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]!))].sort(), ["action_log", "changed"]);
  // Nothing touches the slab or setup tables.
  assert.doesNotMatch(RUN, /"Robo(ProductionRecord|BatchRecipe|DelayLog)"/);
});

test("it refuses before changing anything: no RoboShift, the name taken by another index, or a date and shift held twice", () => {
  const refusal = STATEMENTS.findIndex((s) => s.startsWith("DO $$"));
  const firstChange = STATEMENTS.findIndex((s) => /^(CREATE UNIQUE INDEX|INSERT INTO action_log)/.test(s));
  assert.ok(refusal > 1 && refusal < firstChange, "the refusals run before the first change");
  const body = STATEMENTS[refusal]!;
  // to_regclass folds an unquoted name to lower case and would find nothing.
  assert.match(body, /IF to_regclass\('"RoboShift"'\) IS NULL THEN RAISE EXCEPTION '0131: the table "RoboShift" is not there/);
  assert.match(body, /SELECT count\(\*\) INTO shift_pairs FROM \(SELECT 1 FROM "RoboShift" GROUP BY "date", "shiftNumber" HAVING count\(\*\) > 1\) AS pairs; IF shift_pairs > 0 THEN RAISE EXCEPTION '0131: % date \/ shift number pair\(s\)/);
  assert.match(body, /IF to_regclass\('"RoboShift_date_shiftNumber_key"'\) IS NOT NULL AND NOT EXISTS \( SELECT 1 FROM pg_index i WHERE i\.indexrelid = to_regclass\('"RoboShift_date_shiftNumber_key"'\) AND i\.indrelid = to_regclass\('"RoboShift"'\) AND i\.indisunique AND i\.indisvalid AND i\.indpred IS NULL AND i\.indexprs IS NULL AND ARRAY\(/);
  assert.match(body, /ORDER BY k\.ord\) = ARRAY\['date', 'shiftNumber'\]\) THEN RAISE EXCEPTION '0131: "RoboShift_date_shiftNumber_key" is already there but is not the unique index/);
  assert.match(body, /Nothing was changed/);
  assert.doesNotMatch(body, /\bDELETE\b|\bUPDATE\b/, "it never makes room by deleting or merging");
  // The header says how to list the pairs, and that settling them is the owner's call, by hand.
  assert.match(HEADER, /--\s+FROM "RoboShift" GROUP BY 1, 2 HAVING count\(\*\) > 1 ORDER BY 1, 2;/);
  assert.match(HEADER, /a data correction for the\n-- owner to agree to, done by hand, not by this script/);
});

test("the catalogue read lists what the script adds, quoted, before the change", () => {
  const list = STATEMENTS.findIndex((s) => s.startsWith("INSERT INTO changed "));
  const index = STATEMENTS.findIndex((s) => s.startsWith("CREATE UNIQUE INDEX"));
  assert.ok(list > 0 && list < index);
  assert.match(STATEMENTS[list]!, /WHERE to_regclass\(quote_ident\(n\)\) IS NULL$/);
});

test("logged once, on the first run, as 0124 logs: HAVING count(*) > 0 OR NOT EXISTS", () => {
  const log = STATEMENTS.filter((s) => s.startsWith("INSERT INTO action_log "));
  assert.equal(log.length, 1, "one action_log row");
  assert.match(log[0]!, /^INSERT INTO action_log \(id, actor, kind, model, summary, payload\) SELECT gen_random_uuid\(\)::text, 'schema change \(scripts\/0131\)', 'edit', 'RoboShift',/);
  assert.match(log[0]!, /jsonb_build_object\('action', '0131-robo-shift-date-unique',/);
  assert.match(log[0]!, /FROM changed HAVING count\(\*\) > 0 OR NOT EXISTS \(SELECT 1 FROM action_log WHERE payload->>'action' = '0131-robo-shift-date-unique'\)$/);
});

test("the header says why, what, when, how to apply it and what to check; the UNDO is commented out", () => {
  for (const h of [/^-- WHY\. The code review of 20 Oct 2026, ROBO-8\./m, /^-- WHAT\./m, /^-- NO ROW IS CHANGED\./m, /^-- REFUSES, BEFORE CHANGING ANYTHING,/m, /^-- WHEN:/m, /^-- LOCKS\./m, /^-- Applied with:$/m, /^-- IDEMPOTENT\./m, /^-- CHECK \(after\):$/m])
    assert.match(HEADER, h);
  assert.match(HEADER, /npx prisma db execute --schema prisma\/schema\.prisma --file scripts\/0131-robo-shift-date-unique\.sql/);
  assert.match(HEADER, /\(NOT `prisma db push`\.\)/);
  assert.match(SQL, /─ UNDO ─/);
  const undo = SQL.slice(SQL.lastIndexOf("\n", SQL.search(/─ UNDO ─/)) + 1);
  assert.ok(undo.split("\n").filter((l) => l.trim()).every((l) => l.trimStart().startsWith("--")), "every UNDO line commented");
  assert.ok(undo.includes(`-- DROP INDEX IF EXISTS ${INDEX};`));
});

// ───────────────────── the code works with or without the index ─────────────────

const walk = (rel: string): string[] =>
  readdirSync(join(ROOT, rel)).flatMap((f) => {
    const p = join(rel, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

test("nothing upserts a RoboShift: ON CONFLICT (date, shiftNumber) fails outright before the script has run", () => {
  for (const file of walk("src")) {
    assert.doesNotMatch(src(file), /roboShift\.upsert\(|date_shiftNumber/, file);
  }
  assert.match(ROBO_SHIFT, /never use an upsert on this key/);
});

test("the import makes its shift row with ON CONFLICT DO NOTHING and a read-back, not a create", () => {
  const db = src("src/lib/robo/registerImportDb.ts");
  assert.match(db, /await db\.roboShift\.createMany\(\{\n\s+data: \[\{ \.\.\.fields, status: "CLOSED", notes: IMPORTED_SHIFT_NOTE \}\],\n\s+skipDuplicates: true,\n\s+\}\);/);
  assert.doesNotMatch(db, /roboShift\.create\(/);
});

test("the tablet's shift start re-opens the day's row on P2002 — the one thing the index changes there", () => {
  const route = src("src/app/api/robo/shifts/route.ts");
  // The create is untouched: without the index it behaves exactly as before.
  assert.match(route, /return tx\.roboShift\.create\(\{\n\s+data: \{\n\s+date:\s+body\.date,\n\s+shiftNumber:\s+Number\(body\.shiftNumber\),/);
  assert.match(route, /if \(\(err as \{ code\?: string \}\)\.code === "P2002"\) return reopenDayShift\(body\.date, Number\(body\.shiftNumber\)\);/);
  const reopen = route.slice(route.indexOf("async function reopenDayShift"));
  assert.ok(reopen.length > 0);
  // Only when no shift is running, the oldest row of the pair, in a serializable transaction.
  assert.match(reopen, /const active = await tx\.roboShift\.findFirst\(\{ where: \{ status: "ACTIVE" \} \}\);\n\s+if \(active\) return null;/);
  assert.match(reopen, /findFirst\(\{ where: \{ date, shiftNumber \}, orderBy: \{ createdAt: "asc" \}, select: \{ id: true \} \}\)/);
  assert.match(reopen, /data: \{ status: "ACTIVE", endTime: null \}/);
  assert.match(reopen, /\}, \{ isolationLevel: "Serializable" \}\);/);
  assert.match(reopen, /\{ error: "A shift is already active\." \}, \{ status: 409 \}/);
});
