/**
 * What a register import writes, decided before anything is written — the
 * rules the import (api/robo/imports) and its preview (imports/preview) both
 * apply, in one place so the preview's "will import / will skip" is exactly
 * what the import then does.
 *
 * Pure, and its only import is the import-free batchNo.ts, so `node --test`
 * can reach it. The two database reads it needs are in registerImportDb.ts.
 * From the code review of 20 Oct 2026: ROBO-2, ROBO-4 and ROBO-7.
 *
 * ── ONE SLAB NUMBER, ONE RECORD (ROBO-2) ─────────────────────────────────
 * A slab number names one slab, and the module enforces it everywhere else:
 * slab entry (POST) and slab edit (PATCH) refuse a number another record
 * holds, trimmed. The import did not. It skipped a row only when the same
 * number already sat on a shift of the SAME date as the row, and the date on
 * the row is not the shift's. Our own Complete Production download prints
 * each slab's production date: its own per-slab date for a batch that ran
 * past midnight (slab 81 at 00:03 reads 2 Sep, on the 1 Sep shift), or the
 * setup's date for a register caught up days later (the batch says Thursday,
 * the shift row says Monday). Re-importing that download — the very file the
 * import page asks for — found nothing on the printed date and recorded every
 * such slab a second time, and the preview called them "will import".
 * Reports, trends and both downloads then counted them twice.
 *
 * Now a row is skipped when its slab number is already recorded anywhere,
 * whatever the date, and also when the same number came earlier in the same
 * file (only the first is written; the old code did the same, but only when
 * both rows carried one date). The numbers already recorded are read once,
 * for the whole file, not once per row.
 *
 * ── WHICH SETUP A SLAB JOINS (ROBO-4) ────────────────────────────────────
 * A setup is one batch run: a design, and the plant's batch number for it.
 * The import matched slabs to setups by design alone and never read the
 * Batch No. column, so every imported setup had no batch number and two
 * batches of one design on one date became one setup. Now a row that carries
 * a batch number joins the setup on its shift with the same batch number
 * (case and punctuation aside — "D-1372" is "d1372", canonBatchNo) and the
 * same design, and a new setup it creates carries that number.
 *
 * A row with NO batch number is matched as before, by design alone, so a
 * paper register without a batch column imports exactly as it always has —
 * onto the shift's setup of that design when there is one.
 *
 * ── THE HISTORY ROW (ROBO-7) ─────────────────────────────────────────────
 * The import writes its RoboImportLog row before it starts, as "running",
 * and finishes it at the end. A row still "running" well after the longest
 * an import may run (60 s) belongs to one that was cut off; importLogView
 * shows it as "interrupted" rather than leave it running for ever.
 */
import { canonBatchNo } from "./batchNo.ts";
import { normalizeBatch } from "../normalizeBatch.ts";

/* ── slab numbers ──────────────────────────────────────────────────────── */

export interface PlannableRow {
  rowNumber: number;
  slabNumber: string;
}

/** "recorded" — the number is already on a slab record; "repeated" — an
 *  earlier row of the same file has it, and that row is the one written. */
export type SkipReason = "recorded" | "repeated";

export interface RegisterImportPlan<T extends PlannableRow> {
  /** The rows to write, in file order. */
  toImport: T[];
  /** The rows left out, in file order, with why. */
  skipped: { row: T; reason: SkipReason }[];
}

/**
 * Splits the file's rows into those to write and those to skip. `recorded`
 * holds the slab numbers already on a record (registerImportDb's
 * recordedSlabNumbers); numbers are compared trimmed, as POST and PATCH
 * compare them.
 */
export function planRegisterImport<T extends PlannableRow>(
  rows: readonly T[],
  recorded: ReadonlySet<string>,
): RegisterImportPlan<T> {
  const inFile = new Set<string>();
  const toImport: T[] = [];
  const skipped: { row: T; reason: SkipReason }[] = [];
  for (const row of rows) {
    const n = row.slabNumber.trim();
    if (recorded.has(n)) skipped.push({ row, reason: "recorded" });
    else if (inFile.has(n)) skipped.push({ row, reason: "repeated" });
    else {
      inFile.add(n);
      toImport.push(row);
    }
  }
  return { toImport, skipped };
}

/** The line the preview lists for a skipped row. */
export function skipMessage(s: { row: PlannableRow; reason: SkipReason }): string {
  return s.reason === "recorded"
    ? `Row ${s.row.rowNumber}: slab ${s.row.slabNumber} is already recorded`
    : `Row ${s.row.rowNumber}: slab ${s.row.slabNumber} is listed earlier in this file`;
}

/** The rows to write grouped by the shift row they hang on — production date
 *  and shift number — groups and rows both in file order. */
export function groupRowsByShift<T extends { date: string; shiftNumber: number }>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.date}|${r.shiftNumber}`;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }
  return [...groups.values()];
}

/* ── setups ────────────────────────────────────────────────────────────── */

/** A setup already on the shift, or one the import has just made. */
export interface KnownSetup {
  id: string;
  designName: string;
  batchNo: string | null;
}

const designKey = (designName: string): string => designName.trim().toUpperCase();

/** How a setup is matched when the row names a batch: its canonical batch
 *  number and its design, case and spacing aside. */
export function setupLookupKey(batchNo: string | null | undefined, designName: string): string {
  return `${canonBatchNo(batchNo)}|${designKey(designName)}`;
}

export interface SetupIndex {
  /** The setup this row's slab joins on the shift, if there is one yet. */
  find(batchNo: string | null | undefined, designName: string): string | undefined;
  /**
   * For a batch FILLED FROM THE PLANT (the cell was blank; lib/robo/importPlantFill):
   * the setup the row joins when `find` has none. A setup of the same design whose
   * batch is the same batch however spelt ("1372", "D-1372", "D1372": normalizeBatch),
   * else the one with no batch number, which is where the blank cell went before the
   * plant filled it. Undefined when neither exists (a new setup is made for the batch).
   */
  findForFilled(batchNo: string | null | undefined, designName: string): string | undefined;
  /** Makes a setup findable — each one the import creates is remembered. */
  remember(setup: KnownSetup): void;
}

/**
 * The setups of one shift, looked up the two ways above: by batch number and
 * design for a row that names a batch, by design alone for one that does
 * not. Where two setups share a key the later one answers, as the old
 * design-only map did.
 */
export function setupIndex(existing: readonly KnownSetup[]): SetupIndex {
  const byBatch = new Map<string, string>();
  const byDesign = new Map<string, string>();
  /** By design and the batch's MIS key (normalizeBatch), and by design for a setup with no batch. */
  const byBatchKey = new Map<string, string>();
  const blankBatch = new Map<string, string>();
  const remember = (s: KnownSetup) => {
    byBatch.set(setupLookupKey(s.batchNo, s.designName), s.id);
    byDesign.set(designKey(s.designName), s.id);
    const k = normalizeBatch(s.batchNo);
    if (k) byBatchKey.set(`${k}|${designKey(s.designName)}`, s.id);
    else blankBatch.set(designKey(s.designName), s.id);
  };
  for (const s of existing) remember(s);
  return {
    find: (batchNo, designName) =>
      canonBatchNo(batchNo)
        ? byBatch.get(setupLookupKey(batchNo, designName))
        : byDesign.get(designKey(designName)),
    findForFilled: (batchNo, designName) => {
      const k = normalizeBatch(batchNo);
      return (k ? byBatchKey.get(`${k}|${designKey(designName)}`) : undefined) ?? blankBatch.get(designKey(designName));
    },
    remember,
  };
}

/**
 * The machine rows a new setup is created with: the Production Setup sheet's
 * entries for its date, shift and design, each on a machine the module knows.
 *
 * Code review 27 Oct 2026 (E2E-24): the sheet has no Shift or Batch column,
 * so two batches of one design on one date (1384 and 1385, both Crystallo)
 * land under one key and every machine is listed twice. A setup holds one row
 * per machine, so the create broke that unique and the whole file rolled
 * back. Which block belongs to which batch cannot be told from the sheet, and
 * guessing would put one batch's programs on the other, so when a machine
 * repeats the setup is made with no machine rows — as when the sheet has no
 * block for it. The slabs and the setup still import. A list with each
 * machine once is returned exactly as before.
 */
export function setupMachineEntries<E extends { machineName: string }>(
  entries: readonly E[],
  machineByName: ReadonlyMap<string, string>,
): { machineId: string; entry: E }[] {
  const known = entries
    .filter(e => machineByName.has(e.machineName.toLowerCase()))
    .map(e => ({ machineId: machineByName.get(e.machineName.toLowerCase()) as string, entry: e }));
  const machines = new Set(known.map(k => k.machineId));
  return machines.size === known.length ? known : [];
}

/* ── the history row ───────────────────────────────────────────────────── */

/** The status the import's history row carries while it runs. */
export const IMPORT_RUNNING = "running";

/** How long after it began a "running" row is taken to be cut off: the
 *  import's 60 s limit (maxDuration on the route), and room to spare. */
export const IMPORT_STALE_MS = 3 * 60_000;

export const INTERRUPTED_MESSAGE =
  "This import stopped before it could report. Everything is written in one transaction, so if it was cut off nothing from it was saved. Importing the file again is safe either way: slabs already recorded are skipped.";

/**
 * A history row as the import page should show it. A row still "running"
 * after IMPORT_STALE_MS is shown as "interrupted", with what that means;
 * everything else is shown as stored. Display only — GET writes nothing.
 */
export function importLogView<T extends { status: string; createdAt: Date | string; message: string | null }>(
  log: T,
  nowMs: number,
): T {
  if (log.status !== IMPORT_RUNNING) return log;
  const began = new Date(log.createdAt).getTime();
  if (!Number.isFinite(began) || nowMs - began < IMPORT_STALE_MS) return log;
  return { ...log, status: "interrupted", message: INTERRUPTED_MESSAGE };
}
