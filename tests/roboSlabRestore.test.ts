// "RESTORE LAST DELETED SLAB" PUTS BACK ONLY WHAT IT CAN, AND SAYS SO — code
// review of 20 Oct 2026, ROBO-9.
//
// The restore went through actionLog's generic `delete` reversal, which wraps
// each insert in try/catch and swallows the error, after which the entry was
// marked undone and the admin read "Restored: …" whatever had happened. And it
// never asked whether the slab number had been keyed again since the delete,
// so a restore could leave two records on one number — the duplicate POST and
// PATCH both refuse with a 409.
//
// A later review of the same code found the way out missing: a refused restore
// rolls back and leaves the deletion open, so one that should never come back
// (the slab number keyed again correctly, the shift or setup gone) stayed on
// the Slabs Records banner for good, every "Restore it" failed, every older
// deletion sat behind it, and the /batch global Undo stopped at it too. Now an
// admin can close it ("Keep it deleted"), the banner reads ahead and says why a
// restore would be refused, both buttons act on the deletion the banner named
// (by id), and the global Undo steps past a slab deletion it could only refuse.
//
// Two halves: the rules in lib/robo/slabRestore.ts (pure, tested directly),
// and the restore, the close and undoLastAction in lib/actionLog.ts run end to end against
// an in-memory fake of the tables with real transaction semantics (a throw
// rolls every write back). lib/actionLog.ts imports Prisma and the app's "@/"
// modules, so a resolve hook maps "@/" onto src/ and swaps lib/prisma, lib/rbac,
// lib/tables and lib/inventory/finishedSlab for stubs (the pattern
// tests/loginThrottle.test.ts uses). node --test runs each file in its own
// process, so the hook stays here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import {
  planSlabRestore,
  decideSlabRestore,
  delayLogRefs,
  restorableDelayLogs,
  slabRestoredMessage,
  dismissedPayload,
  slabDismissedMessage,
} from "../src/lib/robo/slabRestore.ts";

const SRC = new URL("../src/", import.meta.url).href;
const STUBS: Record<string, string> = {
  "lib/prisma": "export const prisma = new Proxy({}, { get: (_, k) => globalThis.__restoreDb.client[k] });",
  // localId as well as currentUser: merging the silo lane put lib/backfill on
  // this test's module graph (actionLog -> automations-silo -> backfill), and
  // backfill takes localId from the same module. A stub that answers only what
  // robo needed fails to link the moment another lane widens the graph.
  "lib/rbac": "export const currentUser = async () => ({ email: 'admin@test' }); export const localId = (p = 'local') => p + '-test';",
  "lib/tables": "export const delegateOf = (model) => globalThis.__restoreDb.delegateOf(model);",
  // The fg lane's actionLog also takes reprojectFinishedSlabs and
  // carryQcCorrections from here, so the stub answers all three.
  "lib/inventory/finishedSlab": "export const autolinkFinishedSlabFromQc = async () => {}; export const reprojectFinishedSlabs = async () => {}; export const carryQcCorrections = async () => {};",
};
const dataUrl = (js: string) => `data:text/javascript,${encodeURIComponent(js)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const href = specifier.startsWith("@/") ? SRC + specifier.slice(2)
      : specifier.startsWith(".") && context.parentURL?.startsWith(SRC) ? new URL(specifier, context.parentURL).href
      : null;
    if (href === null) return nextResolve(specifier, context);
    const mod = href.slice(SRC.length).replace(/\.tsx?$/, "");
    if (mod in STUBS) return { url: dataUrl(STUBS[mod]), shortCircuit: true };
    if (/\.[cm]?[jt]sx?$/.test(href)) return nextResolve(href, context);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(fileURLToPath(href + ext))) return nextResolve(href + ext, context);
    }
    return nextResolve(href, context);
  },
});

// ── The fake database ──────────────────────────────────────────────────────
// Tables are arrays of plain rows. A where clause supports what actionLog.ts
// sends: equality, { in }, { notIn } and NOT. $transaction snapshots every
// table and puts the snapshot back if the callback throws, which is what a
// Postgres transaction does to the writes inside it.
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const MODELS: Record<string, string> = {
  actionLog: "actionLog",
  RoboProductionRecord: "roboProductionRecord",
  RoboDelayLog: "roboDelayLog",
  PolishQc: "polishQc",
};
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, cond]) => {
    if (k === "NOT") return !matches(row, cond as Row);
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; notIn?: unknown[] };
      if (c.in) return c.in.includes(row[k]);
      if (c.notIn) return !c.notIn.includes(row[k]);
    }
    return row[k] === cond;
  });
const pick = (row: Row, select?: Record<string, boolean>) =>
  select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row };

function makeDb(tables: Tables, opts: { failCreate?: (table: string, data: Row) => boolean } = {}) {
  const writes: string[] = [];
  const delegate = (name: string) => {
    const rows = () => (tables[name] ??= []);
    return {
      findFirst: async ({ where, select, orderBy }: { where?: Row; select?: Record<string, boolean>; orderBy?: Record<string, "asc" | "desc"> } = {}) => {
        let found = rows().filter((r) => matches(r, where));
        if (orderBy?.createdAt) found = [...found].sort((a, b) => (Number(a.createdAt) - Number(b.createdAt)) * (orderBy.createdAt === "desc" ? -1 : 1));
        return found[0] ? pick(found[0], select) : null;
      },
      findUnique: async ({ where, select }: { where: Row; select?: Record<string, boolean> }) => {
        const r = rows().find((x) => matches(x, where));
        return r ? pick(r, select) : null;
      },
      findMany: async ({ where, select }: { where?: Row; select?: Record<string, boolean> } = {}) =>
        rows().filter((r) => matches(r, where)).map((r) => pick(r, select)),
      create: async ({ data }: { data: Row }) => {
        if (opts.failCreate?.(name, data)) throw new Error(`insert into ${name} failed`);
        if (rows().some((r) => r.id === data.id)) throw new Error(`Unique constraint failed on ${name}.id`);
        rows().push({ ...data });
        writes.push(`create ${name} ${String(data.id)}`);
        return { ...data };
      },
      createMany: async ({ data }: { data: Row[] }) => {
        for (const d of data) {
          if (opts.failCreate?.(name, d)) throw new Error(`insert into ${name} failed`);
          rows().push({ ...d });
          writes.push(`create ${name} ${String(d.id)}`);
        }
        return { count: data.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = rows().find((x) => matches(x, where));
        if (!r) throw new Error("Record to update not found.");
        Object.assign(r, data);
        writes.push(`update ${name} ${String(r.id)}`);
        return { ...r };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rows().filter((x) => matches(x, where));
        for (const r of hit) Object.assign(r, data);
        if (hit.length) writes.push(`updateMany ${name} ${hit.map((r) => r.id).join(",")}`);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const keep = rows().filter((x) => !matches(x, where));
        const n = rows().length - keep.length;
        tables[name] = keep;
        return { count: n };
      },
    };
  };
  const client: Record<string, unknown> = new Proxy({}, {
    get: (_, k: string) => {
      if (k === "$transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>) => {
          const snapshot = structuredClone(tables);
          try {
            return await fn(client);
          } catch (e) {
            for (const key of Object.keys(tables)) delete tables[key];
            Object.assign(tables, snapshot);
            throw e;
          }
        };
      }
      return delegate(k);
    },
  });
  return { tables, writes, client, delegateOf: (model: string) => delegate(MODELS[model] ?? model) };
}

const G = globalThis as Record<string, unknown>;
const { restoreRoboSlabDelete, dismissRoboSlabDelete, lastUndoableFor } = await import("../src/lib/actionLog.ts");
// "Restore it" on the banner, which names the deletion log-1.
const restore = (entryId = "log-1") => restoreRoboSlabDelete(entryId);

// A slab as DELETE /api/robo/production/[id] saves it: the row verbatim, dates
// as ISO strings (they went through JSON), then its delay logs.
const SLAB = {
  id: "slab-old",
  serialNumber: 24,
  slabNumber: "148775",
  shiftId: "shift-1",
  batchRecipeId: "recipe-1",
  productionDate: "2026-10-19",
  productionShift: "B",
  inTime: "14:10",
  outTime: "14:40",
  roymixCycleTime: null,
  roymixBodyWeight: null,
  thickness: 20,
  status: "COMPLETED",
  remarks: null,
  createdAt: "2026-10-19T08:40:00.000Z",
};
const DELAY = (id: string, over: Row = {}) => ({
  id,
  shiftId: "shift-1",
  productionRecordId: "slab-old",
  machineId: "robo-2",
  machineName: "Robo 2",
  delayCodeId: "dc-1",
  durationMinutes: 5,
  startTime: "14:20",
  endTime: "14:25",
  remarks: null,
  createdAt: "2026-10-19T08:50:00.000Z",
  ...over,
});
const deleteEntry = (delays: Row[] = [DELAY("d1")]) => ({
  id: "log-1",
  createdAt: 1000,
  kind: "delete",
  model: "RoboProductionRecord",
  batchKey: null,
  undone: false,
  undoneAt: null,
  summary: `Deleted robo slab 148775 and its ${delays.length} delay log(s)`,
  payload: { groups: [{ model: "RoboProductionRecord", records: [SLAB] }, { model: "RoboDelayLog", records: delays }] },
});
const baseTables = (over: Tables = {}): Tables => ({
  actionLog: [deleteEntry()],
  roboProductionRecord: [],
  roboDelayLog: [],
  roboShift: [{ id: "shift-1" }],
  roboBatchRecipe: [{ id: "recipe-1" }],
  roboDelayCode: [{ id: "dc-1" }, { id: "dc-2" }],
  roboMachine: [{ id: "robo-2" }],
  ...over,
});
const install = (tables: Tables, opts?: Parameters<typeof makeDb>[1]) => {
  const db = makeDb(tables, opts);
  G.__restoreDb = db;
  return db;
};
const entry = (db: ReturnType<typeof makeDb>) => db.tables.actionLog.find((r) => r.id === "log-1")!;

// ── End to end ─────────────────────────────────────────────────────────────

test("a clean restore puts the slab and its delay logs back, verbatim, and closes the deletion", async () => {
  const db = install(baseTables());
  const r = await restore();
  assert.deepEqual(r, { ok: true, message: "Restored slab 148775 and its 1 delay log." });
  const slab = db.tables.roboProductionRecord[0];
  assert.equal(slab.id, "slab-old");
  assert.equal(slab.slabNumber, "148775");
  assert.equal(slab.productionDate, "2026-10-19"); // a date string, not a timestamp — left as text
  assert.ok(slab.createdAt instanceof Date, "createdAt comes back as a DateTime");
  assert.ok(!("remarks" in slab), "nulls are omitted, as the generic reversal does");
  assert.deepEqual(db.tables.roboDelayLog.map((d) => d.id), ["d1"]);
  assert.equal(entry(db).undone, true);
});

test("ROBO-9: refused while another record holds the slab number — nothing written, the deletion still on offer", async () => {
  // The tablet deleted 148775 and keyed it again, correctly, as a new record.
  const db = install(baseTables({ roboProductionRecord: [{ id: "slab-new", slabNumber: "148775", shiftId: "shift-1" }] }));
  const r = await restore();
  assert.equal(r.ok, false);
  assert.match(r.message, /^Not restored: slab 148775 has been entered again since it was deleted/);
  // The way out, either way: close this entry, or delete the new slab and close THAT deletion first.
  assert.match(r.message, /If the new record is the right one, choose "Keep it deleted" to close this entry\./);
  assert.match(r.message, /delete the new slab 148775, choose "Keep it deleted" on that deletion, then restore this one\.$/);
  assert.deepEqual(db.tables.roboProductionRecord.map((s) => s.id), ["slab-new"], "still one record on 148775");
  assert.equal(db.tables.roboDelayLog.length, 0);
  assert.equal(entry(db).undone, false, "the deletion stays restorable");
});

test("ROBO-9: the slab-number check reads the trimmed number, as POST and PATCH do", async () => {
  const padded = { ...deleteEntry(), payload: { groups: [{ model: "RoboProductionRecord", records: [{ ...SLAB, slabNumber: " 148775 " }] }] } };
  const db = install(baseTables({ actionLog: [padded], roboProductionRecord: [{ id: "slab-new", slabNumber: "148775", shiftId: "shift-1" }] }));
  const r = await restore();
  assert.equal(r.ok, false);
  assert.equal(db.tables.roboProductionRecord.length, 1);
});

test("ROBO-9: when the slab's insert fails, it says so, writes nothing and keeps the deletion on offer", async () => {
  const db = install(baseTables(), { failCreate: (t) => t === "roboProductionRecord" });
  const r = await restore();
  assert.equal(r.ok, false);
  assert.match(r.message, /^Not restored — nothing was changed, and the deletion is still here to restore: insert into roboProductionRecord failed$/);
  assert.equal(db.tables.roboProductionRecord.length, 0);
  assert.equal(entry(db).undone, false, "the claim rolled back with the failed insert");
  assert.ok(!/Restored/.test(r.message));
});

test("ROBO-9: a delay-log insert that fails rolls the slab back too — never half a restore reported whole", async () => {
  const db = install(baseTables(), { failCreate: (t) => t === "roboDelayLog" });
  const r = await restore();
  assert.equal(r.ok, false);
  assert.equal(db.tables.roboProductionRecord.length, 0);
  assert.equal(entry(db).undone, false);
});

test("a delay log whose delay code was deleted since is left out — the slab goes back and the message counts it", async () => {
  const db = install(baseTables({
    actionLog: [deleteEntry([DELAY("d1"), DELAY("d2", { delayCodeId: "dc-gone" }), DELAY("d3", { machineId: null })])],
  }));
  const r = await restore();
  assert.equal(r.ok, true);
  assert.equal(r.message, "Restored slab 148775 and its 2 delay logs. 1 delay log could not be put back, because the delay code, machine or shift it names no longer exists; its copy is still in the action log.");
  assert.deepEqual(db.tables.roboDelayLog.map((d) => d.id), ["d1", "d3"]);
  assert.equal(entry(db).undone, true);
});

test("refused when the shift or the batch setup is gone, with the reason — not a raw database error", async () => {
  let db = install(baseTables({ roboShift: [] }));
  let r = await restore();
  assert.deepEqual(r, { ok: false, message: 'Not restored: the shift slab 148775 was recorded under no longer exists. The deleted record is still kept in the action log. To close this entry without restoring it, choose "Keep it deleted".' });
  assert.equal(entry(db).undone, false);

  db = install(baseTables({ roboBatchRecipe: [] }));
  r = await restore();
  assert.match(r.message, /^Not restored: the batch setup slab 148775 belonged to no longer exists\./);
  assert.equal(db.tables.roboProductionRecord.length, 0);
});

test("a slab whose own row is already back is not created twice; the deletion is closed and the message says nothing changed", async () => {
  const db = install(baseTables({ roboProductionRecord: [{ ...SLAB }] }));
  const r = await restore();
  assert.deepEqual(r, { ok: true, message: "Slab 148775 is already back in the register — nothing was changed." });
  assert.equal(db.tables.roboProductionRecord.length, 1);
  assert.equal(db.tables.roboDelayLog.length, 0);
  assert.equal(entry(db).undone, true);
});

test("two admins pressing Restore together: the second finds nothing left to restore", async () => {
  const db = install(baseTables());
  const [a, b] = await Promise.all([restore(), restore()]);
  const oks = [a, b].filter((r) => r.ok);
  assert.equal(oks.length, 1, JSON.stringify([a, b]));
  assert.equal(db.tables.roboProductionRecord.length, 1);
  const other = a.ok ? b : a;
  assert.match(other.message, /already (been restored|back in the register)/);
});

// STANDALONE (Robo ERP): four tests of the main ERP's GLOBAL Undo (the /batch
// page's undo bar: lastUndoable / undoLastAction, which reverse edits in every
// ERP module) lived here. That bar and its generic reversal are not part of Robo
// ERP, so lib/actionLog.ts does not carry them and these tests are not carried.
// The Robo half of ROBO-9 (the Slab Records banner: restore by id, read-ahead,
// Keep it deleted) is tested in full above and below, unchanged.

// A non-slab entry, kept from the removed block because a test below uses it.
const QC = { id: "qc-1", slabNumber: 7, createdAt: "2026-10-19T08:40:00.000Z" };
const qcEntry = () => ({ id: "log-qc", createdAt: 5, kind: "delete", model: "PolishQc", batchKey: "B1", undone: false, summary: "Deleted QC 7", payload: { model: "PolishQc", records: [QC] } });

// ── "Keep it deleted", the read-ahead, and acting on the deletion shown ──────

// An older deletion, of slab 148700, made before log-1.
const OLDER = { ...SLAB, id: "slab-older", slabNumber: "148700" };
const olderEntry = () => ({
  ...deleteEntry([]),
  id: "log-0",
  createdAt: 500,
  summary: "Deleted robo slab 148700",
  payload: { groups: [{ model: "RoboProductionRecord", records: [OLDER] }, { model: "RoboDelayLog", records: [] }] },
});

test("the banner reads ahead: a deletion whose restore would be refused says why, instead of promising it can go back", async () => {
  install(baseTables({ roboProductionRecord: [{ id: "slab-new", slabNumber: "148775", shiftId: "shift-1" }] }));
  const shown = await lastUndoableFor("RoboProductionRecord");
  assert.equal(shown?.id, "log-1");
  assert.match(shown?.refusal ?? "", /^This one cannot be put back: slab 148775 has been entered again since it was deleted/);
  assert.match(shown?.refusal ?? "", /choose "Keep it deleted" to close this entry/);

  install(baseTables({ roboBatchRecipe: [] }));
  assert.match((await lastUndoableFor("RoboProductionRecord"))?.refusal ?? "", /^This one cannot be put back: the batch setup slab 148775 belonged to no longer exists\./);

  const broken = { ...deleteEntry(), payload: { groups: [{ model: "RoboProductionRecord", records: [] }] } };
  install(baseTables({ actionLog: [broken] }));
  assert.match((await lastUndoableFor("RoboProductionRecord"))?.refusal ?? "", /saved copy does not hold one complete slab.*"Keep it deleted"/);

  install(baseTables());
  assert.equal((await lastUndoableFor("RoboProductionRecord"))?.refusal, null, "a restorable deletion is offered as before");
});

test("Keep it deleted closes a refused deletion: no slab written, the copy kept whole with who/when/why, and the banner moves on", async () => {
  const db = install(baseTables({
    actionLog: [olderEntry(), deleteEntry()],
    roboProductionRecord: [{ id: "slab-new", slabNumber: "148775", shiftId: "shift-1" }],
  }));
  const before = structuredClone(deleteEntry().payload);
  const r = await dismissRoboSlabDelete("log-1");
  assert.deepEqual(r, { ok: true, message: "Closed: Slab 148775 stays deleted. Its saved copy is still in the action log." });
  assert.deepEqual(db.tables.roboProductionRecord.map((s) => s.id), ["slab-new"], "nothing restored");
  assert.equal(db.tables.roboDelayLog.length, 0);
  const e = entry(db);
  assert.equal(e.undone, true);
  assert.ok(e.undoneAt instanceof Date);
  const payload = e.payload as Record<string, unknown> & { dismissed: { by: string; at: string; refusal: string | null } };
  assert.deepEqual(payload.groups, before.groups, "the saved copy is untouched");
  assert.equal(payload.dismissed.by, "admin@test");
  assert.match(payload.dismissed.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(payload.dismissed.refusal ?? "", /slab 148775 has been entered again/);
  // The banner now offers the deletion before it — no longer stuck behind log-1.
  const next = await lastUndoableFor("RoboProductionRecord");
  assert.equal(next?.id, "log-0");
  assert.equal(next?.refusal, null);
  assert.deepEqual(await restore("log-0"), { ok: true, message: "Restored slab 148700." });
});

test("Keep it deleted on a deletion that could go back: closed all the same, the note saying no restore was refused", async () => {
  const db = install(baseTables());
  const r = await dismissRoboSlabDelete("log-1");
  assert.equal(r.ok, true);
  assert.equal(db.tables.roboProductionRecord.length, 0);
  assert.equal((entry(db).payload as { dismissed: { refusal: unknown } }).dismissed.refusal, null);
  assert.equal(await lastUndoableFor("RoboProductionRecord"), null);
});

test("the old record was the right one: delete the new slab, close that deletion, then the old one restores", async () => {
  // The flow the refusal message describes, end to end.
  const db = install(baseTables({ roboProductionRecord: [{ id: "slab-new", slabNumber: "148775", shiftId: "shift-1" }] }));
  assert.equal((await restore()).ok, false);
  // The new slab is deleted (DELETE /api/robo/production/[id] writes this entry) …
  db.tables.roboProductionRecord = [];
  db.tables.actionLog.push({
    ...deleteEntry([]),
    id: "log-2",
    createdAt: 2000,
    payload: { groups: [{ model: "RoboProductionRecord", records: [{ ...SLAB, id: "slab-new" }] }, { model: "RoboDelayLog", records: [] }] },
  });
  // … which is now the newest deletion, the one the banner offers. Closed in turn:
  assert.equal((await lastUndoableFor("RoboProductionRecord"))?.id, "log-2");
  assert.equal((await dismissRoboSlabDelete("log-2")).ok, true);
  // … and the banner is back on the old deletion, which can now go back.
  const shown = await lastUndoableFor("RoboProductionRecord");
  assert.equal(shown?.id, "log-1");
  assert.equal(shown?.refusal, null);
  assert.deepEqual(await restore(), { ok: true, message: "Restored slab 148775 and its 1 delay log." });
  assert.deepEqual(db.tables.roboProductionRecord.map((s) => s.id), ["slab-old"]);
});

test("a closed deletion cannot be restored, nor a restored one closed; an unknown or non-slab entry is refused", async () => {
  let db = install(baseTables());
  assert.equal((await dismissRoboSlabDelete("log-1")).ok, true);
  assert.deepEqual(await restore(), { ok: false, message: "This deletion has already been restored or closed." });
  assert.equal(db.tables.roboProductionRecord.length, 0);

  db = install(baseTables());
  assert.equal((await restore()).ok, true);
  const payloadAfterRestore = structuredClone(entry(db).payload);
  assert.deepEqual(await dismissRoboSlabDelete("log-1"), { ok: false, message: "This deletion has already been restored or closed." });
  assert.deepEqual(entry(db).payload, payloadAfterRestore, "no dismissed note on a restored entry");

  db = install({ ...baseTables(), actionLog: [deleteEntry(), qcEntry()] });
  for (const id of ["nope", "log-qc"]) {
    assert.deepEqual(await dismissRoboSlabDelete(id), { ok: false, message: "That slab deletion is not on record." });
    assert.deepEqual(await restore(id), { ok: false, message: "That slab deletion is not on record." });
  }
  assert.equal(db.tables.actionLog.find((r) => r.id === "log-qc")!.undone, false);
});

test("Restore acts on the deletion the banner named, not on a newer one made since", async () => {
  // The banner showed log-1 (148775); the tablet then deleted 148900 (log-3).
  const newer = {
    ...deleteEntry([]),
    id: "log-3",
    createdAt: 3000,
    summary: "Deleted robo slab 148900",
    payload: { groups: [{ model: "RoboProductionRecord", records: [{ ...SLAB, id: "slab-148900", slabNumber: "148900" }] }] },
  };
  const db = install(baseTables({ actionLog: [deleteEntry(), newer] }));
  const r = await restore("log-1");
  assert.deepEqual(r, { ok: true, message: "Restored slab 148775 and its 1 delay log." });
  assert.deepEqual(db.tables.roboProductionRecord.map((s) => s.slabNumber), ["148775"]);
  assert.equal(db.tables.actionLog.find((x) => x.id === "log-3")!.undone, false);
});

// STANDALONE (Robo ERP): "every other undo is exactly as it was" tested the main
// ERP's generic Undo reversal (a Polish QC delete); not part of Robo ERP.

// ── The rules ──────────────────────────────────────────────────────────────

test("planSlabRestore reads the DELETE handler's payload and refuses anything that is not one whole slab", () => {
  const plan = planSlabRestore(deleteEntry().payload);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.slab.id, "slab-old");
    assert.deepEqual(plan.delayLogs.map((d) => d.id), ["d1"]);
  }
  // The generic { model, records } shape too.
  assert.equal(planSlabRestore({ model: "RoboProductionRecord", records: [SLAB] }).ok, true);
  for (const bad of [
    null,
    {},
    { groups: [{ model: "RoboDelayLog", records: [DELAY("d1")] }] },
    { groups: [{ model: "RoboProductionRecord", records: [SLAB, { ...SLAB, id: "x" }] }] },
    { groups: [{ model: "RoboProductionRecord", records: [{ ...SLAB, slabNumber: "  " }] }] },
    { groups: [{ model: "RoboProductionRecord", records: [{ ...SLAB, shiftId: null }] }] },
  ]) {
    const p = planSlabRestore(bad);
    assert.equal(p.ok, false, JSON.stringify(bad));
    if (!p.ok) assert.match(p.message, /cannot be put back from here/);
  }
});

test("decideSlabRestore: already back, then number taken, then shift, then setup — in that order", () => {
  const all = { sameIdExists: false, numberTaken: false, shiftExists: true, setupExists: true };
  assert.deepEqual(decideSlabRestore("148775", all), { action: "restore" });
  assert.equal(decideSlabRestore("148775", { ...all, sameIdExists: true, numberTaken: true }).action, "alreadyBack");
  assert.equal(decideSlabRestore("148775", { ...all, numberTaken: true, shiftExists: false }).action, "refuse");
  assert.match((decideSlabRestore(" 148775 ", { ...all, numberTaken: true }) as { message: string }).message, /slab 148775 has been entered again/);
  assert.match((decideSlabRestore("1", { ...all, shiftExists: false, setupExists: false }) as { message: string }).message, /shift/);
});

test("decideSlabRestore: every refusal says why twice — the press's answer and the banner's notice — and how to close it", () => {
  const all = { sameIdExists: false, numberTaken: false, shiftExists: true, setupExists: true };
  for (const state of [{ ...all, numberTaken: true }, { ...all, shiftExists: false }, { ...all, setupExists: false }]) {
    const d = decideSlabRestore("148775", state);
    assert.equal(d.action, "refuse");
    if (d.action !== "refuse") continue;
    const reason = d.message.replace(/^Not restored: /, "");
    assert.notEqual(reason, d.message, "the answer to a press starts Not restored:");
    assert.equal(d.notice, `This one cannot be put back: ${reason}`, "the banner says the same reason, before anyone presses");
    assert.match(reason, /"Keep it deleted"/, "and names the way out");
    assert.doesNotMatch(d.notice, /exactly as they were/);
  }
});

test("dismissedPayload keeps the saved copy whole and adds the note beside it", () => {
  const payload = deleteEntry().payload;
  const note = { by: "admin@test", at: "2026-10-20T10:00:00.000Z", refusal: null };
  const out = dismissedPayload(payload, note);
  assert.deepEqual(out, { ...payload, dismissed: note });
  assert.deepEqual(payload, deleteEntry().payload, "the input is not changed");
  // A payload that is not an object is kept whole, under `saved`.
  assert.deepEqual(dismissedPayload([1, 2], note), { saved: [1, 2], dismissed: note });
  assert.deepEqual(dismissedPayload(null, note), { saved: null, dismissed: note });
});

test("slabDismissedMessage names the slab when it is known", () => {
  assert.equal(slabDismissedMessage(" 148775 "), "Closed: Slab 148775 stays deleted. Its saved copy is still in the action log.");
  assert.equal(slabDismissedMessage(null), "Closed: The slab stays deleted. Its saved copy is still in the action log.");
});

test("delayLogRefs and restorableDelayLogs: what to look up, and what goes back", () => {
  const logs = [DELAY("d1"), DELAY("d2", { machineId: null }), DELAY("d3", { delayCodeId: "dc-2", machineId: "robo-9" }), DELAY("d4")];
  assert.deepEqual(delayLogRefs(logs), {
    ids: ["d1", "d2", "d3", "d4"],
    delayCodeIds: ["dc-1", "dc-2"],
    machineIds: ["robo-2", "robo-9"],
    shiftIds: ["shift-1"],
  });
  const out = restorableDelayLogs(logs, {
    existingIds: new Set(["d4"]),          // already there: neither written nor lost
    delayCodeIds: new Set(["dc-1", "dc-2"]),
    machineIds: new Set(["robo-2"]),       // robo-9 is gone
    shiftIds: new Set(["shift-1"]),
  });
  assert.deepEqual(out.restore.map((d) => d.id), ["d1", "d2"]);
  assert.equal(out.skipped, 1);
});

test("slabRestoredMessage: counts what came back and what did not", () => {
  assert.equal(slabRestoredMessage("148775", 0, 0), "Restored slab 148775.");
  assert.equal(slabRestoredMessage("148775", 3, 0), "Restored slab 148775 and its 3 delay logs.");
  assert.match(slabRestoredMessage("148775", 0, 2), /^Restored slab 148775\. 2 delay logs could not be put back, because .* they name no longer exists; their copies are still in the action log\.$/);
});

// ── Pinned in the source ───────────────────────────────────────────────────

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("both undo entry points send a robo slab delete to restoreRoboSlab — never the generic reversal", () => {
  const src = code(read("src/lib/actionLog.ts"));
  const fnBody = (fn: string) => {
    const at = src.indexOf(`export async function ${fn}(`);
    assert.ok(at >= 0, `${fn} exists`);
    return src.slice(at, src.indexOf("\n}\n", at));
  };
  // STANDALONE (Robo ERP): the main ERP's global undoLastAction is not carried
  // (see above), so its half of this test is not either.
  // The banner's restore goes by id, and only ever to restoreRoboSlab.
  const byId = fnBody("restoreRoboSlabDelete");
  assert.match(byId, /return restoreRoboSlab\(found\.row\);/);
  assert.doesNotMatch(byId, /reverse\(/);
  assert.ok(!src.includes("export async function undoLastFor("), "the newest-at-press-time restore is gone");
  // The open slab deletion is looked up by its id AND its kind and model, so a
  // forged id cannot restore or close any other kind of entry.
  assert.match(src, /findFirst\(\{ where: \{ id: entryId, kind: "delete", model: "RoboProductionRecord" \} \}\)/);
  // Closing is guarded like the restore's claim: only while still open.
  const close = fnBody("dismissRoboSlabDelete");
  assert.match(close, /updateMany\(\{\n\s+where: \{ id: row\.id, undone: false \},/);
  assert.doesNotMatch(close, /roboProductionRecord|reverse\(/, "closing writes no slab");
  // The restore is one transaction, and claims the entry only where it is still open.
  const restore = src.slice(src.indexOf("async function restoreRoboSlab("));
  assert.match(restore, /await prisma\.\$transaction\(async \(tx: any\) => \{\n\s+const claimed = await tx\.actionLog\.updateMany\(\{\n\s+where: \{ id: row\.id, undone: false \},/);
  // It decides on what it reads with the TRANSACTION's client; the banner's
  // read-ahead reads the same state, by the same function, with plain prisma.
  assert.match(restore, /decideSlabRestore\(slabNumber, await readSlabRestoreState\(tx, slab, slabNumber\)\)/);
  assert.match(src, /readSlabRestoreState\(prisma, plan\.slab, slabNumber\)/);
  const stateAt = src.indexOf("async function readSlabRestoreState(");
  const state = src.slice(stateAt, src.indexOf("\n}\n", stateAt));
  assert.match(state, /where: \{ slabNumber, NOT: \{ id: slab\.id \} \}/);
});

test("the banner's server actions: admin only, by the id shown, the result passed through", () => {
  const src = code(read("src/app/robo/slabs/undoActions.ts"));
  for (const [fn, call] of [["restoreDeletedRoboSlab", "restoreRoboSlabDelete"], ["keepRoboSlabDeleted", "dismissRoboSlabDelete"]]) {
    const at = src.indexOf(`export async function ${fn}(entryId: string)`);
    assert.ok(at >= 0, fn);
    const body = src.slice(at, src.indexOf("\n}\n", at));
    assert.ok(body.indexOf("if (!(await isAdmin()))") > 0 && body.indexOf("if (!(await isAdmin()))") < body.indexOf(`await ${call}(entryId)`), `${fn} checks admin first`);
    assert.match(body, new RegExp(`const r = await ${call}\\(entryId\\);\\n\\s+if \\(r\\.ok\\)`));
    assert.match(body, /\n {2}return r;$/);
  }
  // The page hands the banner the entry's id and the read-ahead refusal; the
  // banner sends that id, and offers Restore only when no refusal was read.
  const page = code(read("src/app/robo/slabs/page.tsx"));
  assert.match(page, /<UndoDeleteButton id=\{undoable\.id\} [^>]*refusal=\{undoable\.refusal\} \/>/);
  const button = code(read("src/app/robo/slabs/UndoDeleteButton.tsx"));
  assert.match(button, /const r = await action\(id\);/);
  assert.match(button, /\{!refusal && \(\n\s+<button/);
  assert.match(button, /\{refusal \?\? "The slab and its delay logs were kept and can be put back exactly as they were\."\}/);
  assert.match(button, /if \(!window\.confirm\(/, "closing asks first");
});
