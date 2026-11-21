// scripts/0123 and prisma/schema.prisma describe the same change: one nullable
// column on the Robo slab (RoboProductionRecord.productionShift) and the three
// tables of the ATTENDANCE MODULE block. The repo's rule (tests/
// commercialSchema0117.test.ts states it, tests/accountsSchema0121.test.ts
// follows it) is that a hand-written script matches the DDL Prisma would
// write, so that `prisma migrate diff` against the schema stays clean — and
// nothing but a test keeps two hand-kept descriptions of one table the same.
// So this file reads both and holds them to one another: the column, every
// table, every column with its type, nullability and default; every index and
// foreign key, under the name Prisma gives it; the shape check the script runs
// against a table already there; and the script's own shape — one
// transaction, every statement safe to run twice, nothing existing altered
// but the one column, nothing back-filled, logged once.
//
// Both files are READ, never run: no database is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const SQL = src("scripts/0123-robo-shift-attendance.sql");
/** The script with its comments out: what Postgres runs. */
const RUN = SQL.replace(/--.*$/gm, "");
/** The comment block above BEGIN: what a reader is told before it runs. */
const HEADER = SQL.slice(0, SQL.search(/^BEGIN;/m));
const SCHEMA = src("prisma/schema.prisma");
/** The attendance block: from its banner to the next module's (Accounts). */
const BANNER = SCHEMA.search(/^\/\/ ATTENDANCE MODULE — /m);
// STANDALONE (Robo ERP): the Accounts module is not part of Robo ERP, so the
// attendance block ends at the schema's "END ATTENDANCE MODULE" banner instead.
const BLOCK_END = SCHEMA.search(/^\/\/ (ACCOUNTS|END ATTENDANCE) MODULE — /m);
const BLOCK = SCHEMA.slice(BANNER, BLOCK_END);

const TABLES = ["attendance_operator", "attendance_day", "attendance_leave"];
const ACTION = "0123-robo-shift-attendance";

/** The script cut into statements: on `;` outside a string and outside a
 *  DO $$ … $$ body, with its white space folded. */
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
/** A name as Postgres stores it: the quotes off. */
const bare = (s: string) => s.replace(/"/g, "");

// ─────────────────────────────── the script ───────────────────────────────────

test("0123 is one transaction, every statement safe to run twice, and no enum change", () => {
  assert.equal(RUN.match(/^\s*BEGIN;/gm)?.length, 1, "one BEGIN");
  assert.equal(RUN.match(/^\s*COMMIT;/gm)?.length, 1, "one COMMIT");
  assert.equal(STATEMENTS[0], "BEGIN");
  assert.equal(STATEMENTS[STATEMENTS.length - 1], "COMMIT");
  assert.equal(STATEMENTS[1], "SET LOCAL lock_timeout = '5s'", "the lock timeout comes first");
  assert.doesNotMatch(RUN, /ALTER TYPE|CREATE TYPE/i, "no enum change");
  assert.doesNotMatch(RUN.replace(/ON COMMIT DROP/g, ""), /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"?\w+"?\s+SET\b|\bALTER\s+COLUMN\b|\bRENAME\b/i,
    "nothing taken away or rewritten, nothing back-filled — the UNDO stays commented out");
  let preconditions = 0;
  for (let k = 1; k < STATEMENTS.length - 1; k++) {
    const s = STATEMENTS[k]!;
    if (/^SET LOCAL lock_timeout = '\d+s'$/.test(s)) continue;
    if (s === `ALTER TABLE "RoboProductionRecord" ADD COLUMN IF NOT EXISTS "productionShift" TEXT`) continue;
    if (/^CREATE TABLE IF NOT EXISTS attendance_\w+ \(/.test(s)) continue;
    if (/^CREATE (UNIQUE )?INDEX IF NOT EXISTS "?attendance_\w+"? ON attendance_\w+ \(/.test(s)) continue;
    if (/^CREATE TEMP TABLE added \(.*\) ON COMMIT DROP$/.test(s)) continue;
    if (/^INSERT INTO added /.test(s)) continue;
    if (/^DO \$\$ BEGIN ALTER TABLE attendance_\w+ ADD CONSTRAINT "?attendance_\w+"? .* EXCEPTION WHEN duplicate_object THEN NULL; END \$\$$/.test(s)) continue;
    if (/^COMMENT ON TABLE attendance_\w+ IS '.*'$/.test(s)) continue;
    if (/^DO \$\$ DECLARE /.test(s)) {
      // The preconditions: they read and refuse, and change nothing.
      assert.doesNotMatch(s, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE|COMMENT)\b/, "the precondition block only reads");
      assert.match(s, /RAISE EXCEPTION/);
      preconditions++;
      continue;
    }
    if (s.startsWith("INSERT INTO action_log ")) {
      assert.match(s, new RegExp(`NOT EXISTS \\(SELECT 1 FROM action_log WHERE payload->>'action' = '${ACTION}'\\)$`), "the log is guarded");
      continue;
    }
    assert.fail(`not safe to run twice: ${s.slice(0, 160)}`);
  }
  assert.equal(preconditions, 1, "one precondition block");
  const pre = STATEMENTS.findIndex((s) => /^DO \$\$ DECLARE /.test(s));
  const firstChange = STATEMENTS.findIndex((s) => /^(ALTER TABLE|CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|DO \$\$ BEGIN|COMMENT )/.test(s));
  assert.ok(pre > 1 && pre < firstChange, "the preconditions run after the lock timeout and before the first change");
});

test("NOTHING EXISTING IS ALTERED but the one column: every other table touched is one the script creates", () => {
  const alters = [...RUN.matchAll(/ALTER TABLE ("?\w+"?)/g)].map((m) => bare(m[1]!));
  assert.deepEqual(alters.filter((t) => !TABLES.includes(t)), ["RoboProductionRecord"], "one existing table altered");
  assert.equal((RUN.match(/ALTER TABLE "RoboProductionRecord"/g) ?? []).length, 1, "once, to add the column");
  const touched = [
    ...RUN.matchAll(/REFERENCES ("?\w+"?)\(/g), ...RUN.matchAll(/COMMENT ON TABLE ("?\w+"?)/g),
    ...RUN.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "?\w+"? ON ("?\w+"?)/g),
  ].map((m) => bare(m[1]!));
  for (const t of touched) assert.ok(TABLES.includes(t), `${t} is not one of the register's own tables`);
  assert.doesNotMatch(RUN, /COMMENT ON COLUMN/, "no comment written on the existing table");
  // The one existing table it writes: a single action_log row.
  const inserts = [...RUN.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(inserts)].sort(), ["action_log", "added"]);
  assert.equal(inserts.filter((t) => t === "action_log").length, 1);
});

test("every named constraint is added in a DO … duplicate_object block", () => {
  const adds = [...RUN.matchAll(/ADD CONSTRAINT ("?\w+"?)/g)].map((m) => bare(m[1]!));
  const guarded = [...RUN.matchAll(/DO \$\$ BEGIN\s+ALTER TABLE \w+ ADD CONSTRAINT ("?\w+"?)[\s\S]*?EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;/g)].map((m) => bare(m[1]!));
  assert.deepEqual(adds, guarded);
  assert.equal(adds.length, 2, "the two foreign keys, and no CHECK");
  assert.doesNotMatch(RUN, /\bCHECK\s*\(/, "the schema declares no CHECK, so the script adds none");
});

/** What the script creates, by kind, read from the statements themselves. */
const CREATED = {
  column: [...RUN.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => `${m[1]}.${m[2]}`),
  table: [...RUN.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!),
  index: [...RUN.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ("?\w+"?)/g)].map((m) => bare(m[1]!)),
  constraint: [...RUN.matchAll(/ADD CONSTRAINT ("?\w+"?)/g)].map((m) => bare(m[1]!)),
};

test("logged once, on the first run, naming exactly what this run added", () => {
  const log = STATEMENTS.find((s) => s.startsWith("INSERT INTO action_log "));
  assert.ok(log, "an action_log row");
  assert.match(log, new RegExp(`HAVING count\\(\\*\\) > 0 OR NOT EXISTS \\(SELECT 1 FROM action_log WHERE payload->>'action' = '${ACTION}'\\)$`));
  assert.match(log, /'schema change \(scripts\/0123\)', 'edit'/, "the actor and kind 0116, 0117 and 0121 log with");
  // 'edit' is never offered by Undo (lib/actionLogKinds NOT_UNDOABLE), and the
  // Robo slabs page's undo reads kind 'delete' only (lib/actionLog
  // lastUndoableFor): a schema change is not a row the app can take back.
  assert.match(src("src/lib/actionLogKinds.ts"), /NOT_UNDOABLE[^\n]*"edit"/);
  const fills = STATEMENTS.map((s, i) => [s, i] as const).filter(([s]) => s.startsWith("INSERT INTO added "));
  const firstChange = STATEMENTS.findIndex((s) => /^(ALTER TABLE|CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|DO \$\$ BEGIN|COMMENT )/.test(s));
  assert.equal(fills.length, 3);
  for (const [, i] of fills) assert.ok(i > 0 && i < firstChange, "the catalogue is read before the first change");
  const [column, objects, constraints] = fills.map(([s]) => s);
  // The column, when information_schema does not have it yet.
  assert.match(column!, /^INSERT INTO added SELECT 'RoboProductionRecord\.productionShift', 'column' WHERE NOT EXISTS \(SELECT 1 FROM information_schema\.columns WHERE table_schema = current_schema\(\) AND table_name = 'RoboProductionRecord' AND column_name = 'productionShift'\)$/);
  assert.deepEqual(CREATED.column, ["RoboProductionRecord.productionShift"]);
  // Every table, index and constraint the script creates — no more, no fewer —
  // under the right kind, so a second run counts nothing.
  const listed = [...objects!.matchAll(/\('(\w+)', '(table|index)'\)/g)].map((m) => [m[1]!, m[2]!] as const);
  assert.deepEqual(listed.filter(([, k]) => k === "table").map(([n]) => n).sort(), [...CREATED.table].sort());
  assert.deepEqual(listed.filter(([, k]) => k === "index").map(([n]) => n).sort(), [...CREATED.index].sort());
  // %I quotes a mixed-case name, so to_regclass finds attendance_day_date_operatorId_key as it was created.
  assert.match(objects!, /WHERE to_regclass\(format\('%I', what\)\) IS NULL$/);
  assert.deepEqual([...constraints!.matchAll(/\('(\w+)'\)/g)].map((m) => m[1]!).sort(), [...CREATED.constraint].sort());
  assert.match(constraints!, /WHERE NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = c\.what\)$/);
  // The summary's totals are the script's own.
  assert.match(log, new RegExp(`added %s of ${CREATED.column.length} column, %s of ${CREATED.table.length} tables, %s of ${CREATED.index.length} indexes and %s of ${CREATED.constraint.length} constraints`));
});

test("no timestamptz and no now(): moments are TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, as Prisma's DateTime", () => {
  assert.doesNotMatch(RUN, /timestamptz|with time zone/i);
  // now() appears once, in the precondition that reads a default already
  // there: Postgres keeps an equal default as either spelling, and Prisma
  // reads both as now(). Nothing the script creates says now().
  assert.doesNotMatch(STATEMENTS.filter((s) => !/^DO \$\$ DECLARE /.test(s)).join("\n"), /\bnow\(\)/i);
  assert.equal((RUN.match(/\bnow\(\)/gi) ?? []).length, 1);
  assert.doesNotMatch(RUN, /\bREFERENCES\b(?![^;]*\bON UPDATE CASCADE\b)/, "every foreign key ON UPDATE CASCADE, as Prisma writes it");
});

// ──────────────────────── the column on the Robo slab ─────────────────────────

/** One model's body, by name. */
function modelBody(name: string): string {
  const m = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(SCHEMA);
  assert.ok(m, `model ${name}`);
  return m[1]!;
}

test("productionShift is the nullable TEXT the schema declares, on the table the model maps to, with no default and no back-fill", () => {
  const body = modelBody("RoboProductionRecord");
  // No @@map, so the table is the model's own name, quoted as Postgres keeps it.
  assert.doesNotMatch(body, /@@map\(/, "RoboProductionRecord keeps its model name as its table");
  const field = /^\s+productionShift\s+(\w+)(\?)?(.*)$/m.exec(body);
  assert.ok(field, "RoboProductionRecord.productionShift");
  assert.equal(field[1], "String", "a String is TEXT");
  assert.equal(field[2], "?", "nullable");
  assert.doesNotMatch(field[3]!, /@map\(|@default\(|@db\./, "no column rename, no default, Prisma's own TEXT");
  // Nullable and default-free in the script too: an ADD COLUMN with neither
  // NOT NULL nor DEFAULT touches no existing row.
  const add = STATEMENTS.filter((s) => s.startsWith("ALTER TABLE \"RoboProductionRecord\""));
  assert.deepEqual(add, [`ALTER TABLE "RoboProductionRecord" ADD COLUMN IF NOT EXISTS "productionShift" TEXT`]);
  // The sibling per-slab column added the same way (scripts/0047), the
  // precedent for the table's quoted name.
  assert.match(src("scripts/0047-robo-slab-production-date.sql"), /^ALTER TABLE "RoboProductionRecord" ADD COLUMN IF NOT EXISTS "productionDate" TEXT;$/m);
  // The code that writes it stores "A", "B", "C" or NULL through
  // parseShiftCode, and reads NULL as "fall back to the In Time": nothing has
  // to be back-filled for the register to read.
  assert.match(src("src/app/api/robo/production/route.ts"), /productionShift:\s+parseShiftCode\(body\.productionShift\)/);
  assert.match(src("src/app/api/robo/production/[id]/route.ts"), /data\.productionShift = parseShiftCode\(body\.productionShift\)/);
  assert.match(src("src/lib/robo/productionShift.ts"), /parseShiftCode\(record\?\.productionShift\) \|\|\s+shiftFromTime\(record\?\.inTime\)/);
});

// ───────────────────────────── the script ↔ the schema ────────────────────────

interface SqlColumn { name: string; type: string; notNull: boolean; primary: boolean; def: string | null }
function tableBody(table: string): string {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(RUN);
  assert.ok(m, `the script creates ${table}`);
  return m[1]!;
}
/** One line of DDL — a CREATE TABLE column or an ADD COLUMN — as a column. */
function readColumn(table: string, line: string): SqlColumn {
  const m = /^"([A-Za-z][A-Za-z0-9]*)"\s+(TEXT|BOOLEAN|INTEGER|TIMESTAMP\(3\))(.*)$/.exec(line);
  assert.ok(m, `${table}: a quoted column: ${line}`);
  const rest = m[3]!;
  assert.doesNotMatch(rest, /REFERENCES|CHECK|UNIQUE/, `${table}.${m[1]}: no inline constraint — Prisma names its own, and so does this script`);
  const def = /DEFAULT ('[^']*'|\S+)/.exec(rest);
  return { name: m[1]!, type: m[2]!, notNull: /NOT NULL/.test(rest), primary: /PRIMARY KEY/.test(rest), def: def ? def[1]! : null };
}

/* A COLUMN ADDED AFTER THE TABLE WAS MADE is still part of what the model must
   describe, and ADD COLUMN appends it — so the model declares it last and this
   reads it from the script that added it. Named one by one on purpose: a new
   attendance column is a line here as well as a script, which is the point.
   The guarantee is unchanged — the model is exactly what the scripts built. */
const LATER: { script: string; table: string }[] = [
  { script: "scripts/0139-attendance-roster-order.sql", table: "attendance_operator" },
  { script: "scripts/0140-attendance-leave-type.sql", table: "attendance_leave" },
  // attendance_day."shiftNo": a second shift on one date (Chromia round of
  // 7 Nov 2026).
  { script: "scripts/0156-chromia-round-2026-11.sql", table: "attendance_day" },
  // attendance_day."outDate": the date an Out-Time fell on (the owner's round
  // of 17 Nov 2026, no longest shift). Declared after "shiftNo".
  { script: "scripts/0158-chromia-round-2026-11-17.sql", table: "attendance_day" },
];

/* AN INDEX REPLACED LATER. scripts/0156 moved attendance_day's unique key from
   (date, operatorId) to (date, operatorId, shiftNo): it creates the new one,
   then drops the old one only once the new one exists. So the indexes the
   model must describe are 0123's with that one swapped — read from 0156
   itself, so a change there is a change here. */
const SQL_0156 = src("scripts/0156-chromia-round-2026-11.sql").replace(/--.*$/gm, "");
const REPLACED = {
  drop: /DROP INDEX "(attendance_day_date_operatorId_key)";/.exec(SQL_0156)?.[1],
  create: /CREATE UNIQUE INDEX "(attendance_day_date_operatorId_shiftNo_key)"\s+ON "attendance_day"\("date", "operatorId", "shiftNo"\);/.exec(SQL_0156)?.[1],
};

function addedColumns(table: string): SqlColumn[] {
  const out: SqlColumn[] = [];
  for (const { script, table: t } of LATER) {
    if (t !== table) continue;
    const sql = src(script).replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([\s\S]*?);/g)) {
      assert.equal(m[1], table, `${script}: alters ${m[1]}, not ${table}`);
      out.push(readColumn(table, m[2]!.replace(/\s+/g, " ").trim()));
    }
  }
  return out;
}

/** The columns THIS script creates — what its own header counts and what its
 *  shape check holds an existing table to. */
function sqlColumns(table: string): SqlColumn[] {
  return tableBody(table).split("\n").map((l) => l.trim().replace(/,$/, "")).filter(Boolean)
    .map((l) => readColumn(table, l));
}

/** Every column the table has now: the ones this script created, then the ones
 *  later scripts appended. What the MODEL must describe, in this order. */
function modelColumns(table: string): SqlColumn[] {
  return [...sqlColumns(table), ...addedColumns(table)];
}

interface PrismaField { name: string; type: string; optional: boolean; list: boolean; attrs: string }
interface Model { name: string; table: string; block: string; fields: PrismaField[] }
/** Every model in the attendance block and its fields. */
const MODELS: Model[] = [...BLOCK.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => {
  const body = m[2]!;
  const fields: PrismaField[] = [];
  for (const l of body.split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const f = /^\s+(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/.exec(l);
    if (!f) continue;
    const tail = f[4]!;
    const cut = tail.search(/\s*\/\/.*$/);
    fields.push({ name: f[1]!, type: f[2]!, optional: f[3] === "?", list: f[3] === "[]", attrs: cut < 0 ? tail : tail.slice(0, cut) });
  }
  const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? "";
  return { name: m[1]!, table, block: body, fields };
});
const SCALARS = new Set(["String", "Int", "DateTime", "Decimal", "Boolean", "Json", "BigInt", "Float", "Bytes"]);
const columnOf = (f: PrismaField): string => /@map\("([^"]+)"\)/.exec(f.attrs)?.[1] ?? f.name;
const modelOf = (table: string): Model => {
  const m = MODELS.find((x) => x.table === table);
  assert.ok(m, `a model for ${table}`);
  return m;
};
const scalarsOf = (m: Model) => m.fields.filter((f) => SCALARS.has(f.type));

test("the block holds exactly the three Attendance models, names its script, and no other model maps an attendance_ table", () => {
  assert.ok(BANNER > 0 && BLOCK_END > BANNER, "the ATTENDANCE MODULE banner, before the ACCOUNTS one");
  assert.deepEqual(MODELS.map((m) => m.name), ["AttendanceOperator", "AttendanceDay", "AttendanceLeave"]);
  assert.deepEqual(MODELS.map((m) => m.table), TABLES, "one model per table, in the script's order");
  assert.deepEqual(CREATED.table, TABLES, "the script creates the same three, in the same order");
  const outside = SCHEMA.slice(0, BANNER) + SCHEMA.slice(BLOCK_END);
  assert.doesNotMatch(outside, /@@map\("attendance_/, "every attendance_ table is modelled in the block");
  assert.doesNotMatch(outside, /^model Attendance/m);
  assert.match(BLOCK, /scripts\/0123-robo-shift-attendance\.sql/, "the banner names its script");
  assert.match(modelBody("RoboProductionRecord"), /scripts\/0123-robo-shift-attendance\.sql/, "and so does the column");
});

/** The Prisma field a SQL column must be. */
function assertSame(table: string, col: SqlColumn, f: PrismaField | undefined): void {
  const where = `${table}."${col.name}"`;
  assert.ok(f, `${where} is a field`);
  const plain: Record<string, string> = { TEXT: "String", BOOLEAN: "Boolean", INTEGER: "Int", "TIMESTAMP(3)": "DateTime" };
  assert.equal(f.type, plain[col.type], where);
  assert.doesNotMatch(f.attrs, /@db\./, `${where}: Prisma's own mapping of ${f.type} is ${col.type}`);
  assert.equal(f.optional, !(col.notNull || col.primary), `${where}: nullable in both or in neither`);
  if (col.primary) assert.match(f.attrs, /@id\b/, `${where}: the primary key`);
  const def = col.def === null ? null
    : col.def === "CURRENT_TIMESTAMP" ? "now()"
      : /^'.*'$/.test(col.def) ? `"${col.def.slice(1, -1)}"` : col.def;
  const prismaDef = /@default\(((?:[^()]|\([^()]*\))*)\)/.exec(f.attrs)?.[1] ?? null;
  if (col.primary) assert.equal(prismaDef, "cuid()", `${where}: the id is the app's own cuid()`);
  else if (/@updatedAt\b/.test(f.attrs)) {
    assert.equal(col.def, null, `${where}: Prisma stamps @updatedAt; the DDL Prisma writes has no DEFAULT`);
    assert.ok(col.notNull, where);
  } else assert.equal(prismaDef, def, `${where}: the same default`);
}

test("every table: every column, its type, nullability and default, as its model declares it — in the same order", () => {
  let columns = 0;
  for (const table of TABLES) {
    // Created here, plus anything a later script appended (LATER above).
    const cols = modelColumns(table);
    const model = modelOf(table);
    const scalars = scalarsOf(model);
    assert.deepEqual(scalars.map(columnOf), cols.map((c) => c.name), `${table}: the same columns, no more and no fewer, in the same order`);
    for (const c of cols) assertSame(table, c, scalars.find((f) => columnOf(f) === c.name));
    // The fields map no column name, so each column is the field's own name.
    for (const f of scalars) assert.doesNotMatch(f.attrs, /@map\(/, `${model.name}.${f.name}: no @map, so the column is "${f.name}"`);
    columns += cols.length;
  }
  // 22 as 0123 created them, and four appended since: attendance_operator's
  // "sortOrder" (0139), attendance_leave's "leaveType" (0140) and
  // attendance_day's "shiftNo" (0156) and "outDate" (0158, 17 Nov 2026).
  assert.equal(columns, 26);
});

test("the header's column counts are the tables' own", () => {
  const check = HEADER.slice(HEADER.search(/^-- CHECK \(after\):$/m));
  const listed = [...check.matchAll(/\b(attendance_[a-z]+) (\d+)(?=[,\n])/g)].map((m) => [m[1]!, Number(m[2])] as const);
  assert.deepEqual(listed.map(([t]) => t).sort(), [...TABLES].sort(), "every table is listed");
  for (const [t, n] of listed) assert.equal(n, sqlColumns(t).length, `${t}: the header says ${n}`);
});

/** Prisma's own name for an index or unique on these columns. */
const indexName = (table: string, cols: string[], unique: boolean) => `${table}_${cols.join("_")}_${unique ? "key" : "idx"}`;

test("index names agree: every @@index, @@unique and @unique is a script index under Prisma's own name, and nothing else is", () => {
  assert.doesNotMatch(BLOCK, /map:/, "no name is overridden: every index and key keeps the name Prisma gives it");
  const want: string[] = [];
  for (const m of MODELS) {
    const col = (field: string) => columnOf(m.fields.find((f) => f.name === field)!);
    for (const x of m.block.matchAll(/@@(index|unique)\(\[([^\]]+)\]\)/g)) {
      const cols = x[2]!.split(",").map((s) => col(s.trim()));
      want.push(`${indexName(m.table, cols, x[1] === "unique")} | ${x[1] === "unique"} | ${m.table} | ${cols.join(", ")}`);
    }
    for (const f of m.fields) if (/@unique\b/.test(f.attrs)) want.push(`${indexName(m.table, [columnOf(f)], true)} | true | ${m.table} | ${columnOf(f)}`);
  }
  const made = [...RUN.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS ("?\w+"?) ON (\w+) \(([^)]*)\);/g)]
    .map((x) => `${bare(x[2]!)} | ${Boolean(x[1])} | ${x[3]} | ${bare(x[4]!)}`);
  assert.equal(made.length, 4);
  // 0156's swap, applied: its old index is one of 0123's, its new one is not.
  assert.equal(REPLACED.drop, "attendance_day_date_operatorId_key", "0156 drops the old unique");
  assert.equal(REPLACED.create, "attendance_day_date_operatorId_shiftNo_key", "0156 creates the new unique");
  assert.ok(SQL_0156.indexOf(`CREATE UNIQUE INDEX "${REPLACED.create}"`) < SQL_0156.indexOf(`DROP INDEX "${REPLACED.drop}"`), "the new rule is in place before the old one goes");
  const have = [
    ...made.filter((x) => !x.startsWith(`${REPLACED.drop} |`)),
    `${REPLACED.create} | true | attendance_day | date, operatorId, shiftNo`,
  ];
  assert.equal(have.length, made.length, "one swapped for one");
  assert.deepEqual(have.sort(), want.sort());
  // A mixed-case name is quoted where it is created, or Postgres would fold it
  // to lower case and Prisma would not find it under its own name.
  for (const x of RUN.matchAll(/(?:INDEX IF NOT EXISTS|ADD CONSTRAINT) ("?)(\w+)"?/g)) {
    if (/[A-Z]/.test(x[2]!)) assert.equal(x[1], '"', `${x[2]} is quoted`);
  }
});

test("foreign keys agree: every relation is a script foreign key named as Prisma names it — RESTRICT on delete, CASCADE on update", () => {
  const want: string[] = [];
  for (const m of MODELS) for (const f of m.fields) {
    const rel = /@relation\(fields: \[(\w+)\], references: \[id\]\)/.exec(f.attrs);
    if (!rel) { assert.doesNotMatch(f.attrs, /@relation\(/, `${m.name}.${f.name}: a relation this test does not read`); continue; }
    const col = columnOf(m.fields.find((x) => x.name === rel[1])!);
    const target = MODELS.find((x) => x.name === f.type);
    assert.ok(target, `${m.name}.${f.name} -> ${f.type} stays in the block`);
    want.push(`${m.table}_${col}_fkey ${m.table}(${col}) -> ${target.table}`);
  }
  const have = [...RUN.matchAll(/ALTER TABLE (\w+) ADD CONSTRAINT "(\w+)"\s+FOREIGN KEY \("(\w+)"\) REFERENCES (\w+)\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/g)]
    .map((x) => `${x[2]} ${x[1]}(${x[3]}) -> ${x[4]}`);
  assert.deepEqual(have.sort(), want.sort());
  assert.equal(have.length, 2);
  assert.equal((RUN.match(/FOREIGN KEY/g) ?? []).length, 2, "and no other");
  // RESTRICT is what the API counts on: an operator with records on file is
  // switched off, not deleted (lib/attendance/server.ts).
  assert.match(src("src/lib/attendance/server.ts"), /if \(days \+ leaves > 0\) \{\s+const row = await tx\.attendanceOperator\.update\(\{ where: \{ id \}, data: \{ isActive: false \}/);
});

// ───────────────────────────── the preconditions ──────────────────────────────

const PRE = STATEMENTS.find((s) => /^DO \$\$ DECLARE /.test(s)) ?? "";

test("a table already there is checked column by column against the same list the script creates — type, nullability and default", () => {
  // timestamp(3), not timestamp: a bare timestamp is timestamp(6), and the
  // precision is part of what Prisma's DDL says.
  const sqlType: Record<string, string> = { TEXT: "text", BOOLEAN: "boolean", "TIMESTAMP(3)": "timestamp(3)" };
  // A default as Postgres keeps it: '' is ''::text, true is true.
  const kept = (def: string | null) => def === null ? "none" : def === "''" ? "''::text" : def;
  const want = TABLES.flatMap((t) => sqlColumns(t).map((c) => `${t}.${c.name} ${sqlType[c.type]} ${c.notNull || c.primary ? "NO" : "YES"} ${kept(c.def)}`));
  const have = [...PRE.matchAll(/\('(attendance_\w+)', '(\w+)', '([a-z0-9() ]+)', '(YES|NO)', (NULL|'(?:[^']|'')*')\)/g)]
    .map((m) => `${m[1]}.${m[2]} ${m[3]} ${m[4]} ${m[5] === "NULL" ? "none" : m[5]!.slice(1, -1).replace(/''/g, "'")}`);
  assert.deepEqual(have.sort(), want.sort());
  // The catalogue read the same way: a timestamp with its precision, now()
  // read as the CURRENT_TIMESTAMP it is.
  assert.match(PRE, /CASE WHEN c\.data_type = 'timestamp without time zone' THEN format\('timestamp\(%s\)', c\.datetime_precision\) ELSE c\.data_type END AS typ/);
  assert.match(PRE, /CASE WHEN c\.column_default = 'now\(\)' THEN 'CURRENT_TIMESTAMP' ELSE c\.column_default END AS def/);
  assert.match(PRE, /WHERE to_regclass\(e\.tbl\) IS NOT NULL AND \(h\.col IS NULL OR h\.typ <> e\.typ OR h\.nullable <> e\.nullable OR h\.def IS DISTINCT FROM e\.def\)/);
  // And a column the schema does not declare is refused, not passed over.
  assert.match(PRE, /FROM h LEFT JOIN e ON e\.tbl = h\.tbl AND e\.col = h\.col WHERE e\.col IS NULL/);
});

test("a table already there must carry the primary key on \"id\" under Prisma's name", () => {
  for (const t of TABLES) assert.match(tableBody(t), /^\s+"id"\s+TEXT PRIMARY KEY,/m, `${t}: the id is the primary key`);
  const listed = [...PRE.matchAll(/\(VALUES \('attendance_operator'\), \('attendance_day'\), \('attendance_leave'\)\) AS t\(tbl\)/g)];
  assert.equal(listed.length, 1, "the three tables, once");
  assert.match(PRE, /k\.contype = 'p' AND k\.conname = t\.tbl \|\| '_pkey' AND k\.conkey = ARRAY\[\(SELECT a\.attnum FROM pg_attribute a WHERE a\.attrelid = k\.conrelid AND a\.attname = 'id'\)\]/);
});

test("an index already under one of the script's names must cover what the script would create", () => {
  // The same four, each with the same table, uniqueness and columns as its CREATE INDEX.
  const created = [...RUN.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS ("?\w+"?) ON (\w+) \(([^)]*)\);/g)]
    .map((x) => `${bare(x[2]!)} ${x[3]} ${Boolean(x[1])} ${bare(x[4]!).replace(/\s/g, "")}`);
  const checked = [...PRE.matchAll(/\('(attendance_\w+)', +'(attendance_\w+)', +(true|false), +'([\w,]+)'\)/g)]
    .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
  assert.deepEqual(checked.sort(), created.sort());
  for (const clause of [
    "i.indexrelid = to_regclass(format('%I', w.idx))", "i.indrelid = to_regclass(w.tbl)",
    "i.indisunique = w.uniq AND m.amname = 'btree'", "i.indpred IS NULL AND i.indexprs IS NULL",
    "FROM generate_series(0, i.indnatts - 1) AS k JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[k]) = w.cols",
  ]) assert.ok(PRE.includes(clause), clause);
});

test("a foreign key already under one of the script's names must be the one the script would add", () => {
  const added = [...RUN.matchAll(/ALTER TABLE (\w+) ADD CONSTRAINT "(\w+)"\s+FOREIGN KEY \("(\w+)"\) REFERENCES (\w+)\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/g)]
    .map((x) => `${x[2]} ${x[1]}`);
  const checked = [...PRE.matchAll(/\('(attendance_\w+_fkey)', +'(attendance_\w+)'\)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(checked.sort(), added.sort());
  // Every added key runs "operatorId" -> attendance_operator("id"), so that is what is read back.
  for (const x of RUN.matchAll(/ADD CONSTRAINT "\w+"\s+FOREIGN KEY \("(\w+)"\) REFERENCES (\w+)\("id"\)/g)) {
    assert.equal(x[1], "operatorId");
    assert.equal(x[2], "attendance_operator");
  }
  assert.match(PRE, /JOIN pg_constraint k ON k\.conname = w\.fk AND k\.conrelid = to_regclass\(w\.tbl\)/, "matched on its own table, not by name across the schema");
  assert.match(PRE, /WHERE NOT coalesce\( k\.contype = 'f' AND k\.confrelid = to_regclass\('attendance_operator'\) AND k\.conkey = ARRAY\[\(SELECT a\.attnum FROM pg_attribute a WHERE a\.attrelid = k\.conrelid AND a\.attname = 'operatorId'\)\] AND k\.confkey = ARRAY\[\(SELECT a\.attnum FROM pg_attribute a WHERE a\.attrelid = k\.confrelid AND a\.attname = 'id'\)\] AND k\.confdeltype = 'r' AND k\.confupdtype = 'c', false\)/,
    "RESTRICT ('r') on delete and CASCADE ('c') on update; anything unread counts as different");
});

test("nothing else may sit on a table already there: every other index or constraint is refused", () => {
  const pkeys = TABLES.map((t) => `${t}_pkey`);
  const at = PRE.indexOf("SELECT format('index %s on %s'");
  assert.ok(at > 0, "the extra-objects check");
  const tail = PRE.slice(at);
  const lists = [...tail.matchAll(/NOT IN \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!).sort());
  assert.deepEqual(lists[0], [...pkeys, ...CREATED.index].sort(), "the indexes allowed are the primary keys and the script's own");
  assert.deepEqual(lists[1], [...pkeys, ...CREATED.constraint].sort(), "the constraints allowed are the primary keys and the script's foreign keys");
  assert.match(tail, /AND k\.contype <> 'n'/, "a NOT NULL is its column's, whichever catalogue keeps it");
  assert.match(tail, /AND NOT \(k\.contype = 'u' AND k\.conname IN \('attendance_operator_name_key', 'attendance_day_date_operatorId_key'\)\)/);
});

test("it refuses, before changing anything, on the wrong database, a different column, or rows the new keys would refuse — and deletes nothing", () => {
  assert.match(PRE, /IF to_regclass\('"RoboProductionRecord"'\) IS NULL THEN RAISE EXCEPTION/);
  assert.match(PRE, /column_name = 'productionShift' AND NOT \(data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL\)/);
  // Duplicates the unique indexes would refuse, counted only while the index is missing.
  assert.match(PRE, /to_regclass\('attendance_operator_name_key'\) IS NULL THEN[^$]*GROUP BY "name" HAVING count\(\*\) > 1/);
  assert.match(PRE, /to_regclass\('"attendance_day_date_operatorId_key"'\) IS NULL THEN[^$]*GROUP BY "date", "operatorId" HAVING count\(\*\) > 1/);
  // Orphans the foreign keys would refuse, counted only while the key is missing.
  for (const t of ["attendance_day", "attendance_leave"]) {
    assert.match(PRE, new RegExp(`NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${t}_operatorId_fkey'\\)`), t);
  }
  assert.equal((PRE.match(/RAISE EXCEPTION '0123 refused: /g) ?? []).length, 11, "eleven refusals, each naming the script");
  for (const m of PRE.matchAll(/RAISE EXCEPTION '([^']*)'/g)) assert.match(m[1]!, /Nothing was changed/, m[1]);
  assert.doesNotMatch(PRE, /\bDELETE\b|\bUPDATE\b/, "a duplicate is named, never removed");
  // `found` is PL/pgSQL's own; the block keeps clear of it.
  assert.doesNotMatch(PRE, /\bfound\b/i);
});

// ─────────────────────────────── the header ────────────────────────────────────

test("the header says why, what, how it is applied, when, what it refuses, and what to check after", () => {
  for (const heading of [/^-- WHY\. /m, /^-- WHAT\.$/m, /^-- CONVENTIONS\.$/m, /^-- Applied with:$/m, /^-- WHEN: /m,
    /^-- ADDITIVE AND IDEMPOTENT\. /m, /^-- REFUSES, /m, /^-- Logged: /m, /^-- CHECK \(after\):$/m]) {
    assert.match(HEADER, heading);
  }
  assert.match(HEADER, /npx prisma db execute --schema prisma\/schema\.prisma --file scripts\/0123-robo-shift-attendance\.sql/);
  assert.match(HEADER, /\(NOT `prisma db push`\.\)/);
  for (const t of TABLES) assert.ok(HEADER.includes(t), `the header names ${t}`);
  assert.match(HEADER, /"RoboProductionRecord"\."productionShift"/);
  assert.match(HEADER, /NOT back-filled/);
  assert.match(HEADER, /P2022/, "it says what the new code does without the column");
});

test("the UNDO block is there, commented out: the tables children first, then the column", () => {
  assert.match(SQL, /─ UNDO ─/);
  const undo = SQL.slice(SQL.lastIndexOf("\n", SQL.search(/─ UNDO ─/)) + 1);
  assert.ok(undo.split("\n").filter((l) => l.trim()).every((l) => l.trimStart().startsWith("--")), "every line commented");
  const drops = [...undo.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1]!);
  assert.deepEqual([...drops].sort(), [...TABLES].sort(), "every table, and only the register's");
  for (const fk of RUN.matchAll(/ALTER TABLE (\w+) ADD CONSTRAINT "\w+"\s+FOREIGN KEY \("\w+"\) REFERENCES (\w+)\(/g)) {
    assert.ok(drops.indexOf(fk[1]!) < drops.indexOf(fk[2]!), `${fk[1]} before ${fk[2]}`);
  }
  assert.match(undo, /^-- ALTER TABLE "RoboProductionRecord" DROP COLUMN IF EXISTS "productionShift";$/m);
  assert.match(undo, /^-- BEGIN;$/m);
  assert.match(undo, /^-- COMMIT;$/m);
});
