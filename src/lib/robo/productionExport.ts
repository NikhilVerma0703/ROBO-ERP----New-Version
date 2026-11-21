import { batchLabel } from "./trial.ts";
/**
 * The Production Records sheet of the Complete Production download — its
 * columns and the shape of one row.
 *
 * In lib rather than in the route so `node --test` can reach it, which is the
 * whole point here: json_to_sheet takes a header list AND the row objects, and
 * silently APPENDS any row key the header does not mention. A header and a key
 * that drift apart therefore do not fail, they produce a sheet with an empty
 * column where the reader expects data and a stray column past the last one.
 *
 * That is not hypothetical — it is what this download did. The header said
 * "Robo2 Body Weight (kg)" / "Robo2 Cycle Time (sec)" while the rows were
 * keyed "RoyMix …", so those two columns came out blank and the real numbers
 * appeared after Remarks, which was supposed to be last. Keeping the two here,
 * next to each other and covered by a test, is what stops that repeating.
 *
 * ── What the sheet carries, and why ──────────────────────────────────────
 * Design Name and Batch No. now ride on every row: the sheet is read one slab
 * at a time, and a reader should not have to cross-reference the Production
 * Setup sheet to learn which design a slab was. They come off the slab's own
 * batch setup.
 *
 * Remarks is the SAME string Slabs Records shows — the slab's own note and its
 * delays through one formatter, e.g. "C5 Robo1 15m [22:40-22:55]". It is
 * resolved in the route (formatSlabRemarks lives in utils.ts, which pulls in
 * enough of the app that `node --test` cannot load it) and handed in already
 * formatted, so this file stays pure.
 *
 * Status, Delay Codes and Total Delay are gone: Status is derived from the Out
 * time beside it, and both delay columns are now folded into the one Remarks
 * string the operator actually reads.
 *
 * Shift went with them and has come back, as a different column. What was
 * dropped was RoboShift.shiftNumber — one row per day, stamped from the wall
 * clock when the tablet was first opened, so it said the same thing on a slab
 * made at 07:00 and one made at 23:40. What is here now is the A/B/C the
 * operator picks on the slab, stored on the slab, falling back to the slab's
 * own In Time for everything entered before the field existed. It sits right
 * after Production Date, where the paper register has always had it. See
 * productionShift.ts.
 *
 * Robo2, not RoyMix: the machine is stored as "Roymix" and always will be —
 * the stored names carry the ordering, the preset keys and every delay log ever
 * saved — but no screen has said RoyMix for a long time, so a sheet that did
 * was naming a machine its reader cannot find. Re-importing an exported sheet
 * still works either way; importRegister accepts both spellings.
 */

/** Column order, left to right. Remarks is last, deliberately. */
export const PRODUCTION_RECORD_COLUMNS = [
  "S.No.",
  "Production Date",
  // Beside the date, as on the register sheet the operators already fill in.
  "Shift",
  "Design Name",
  "Thickness (cm)",
  "Batch No.",
  "Slab No.",
  // Beside the slab they describe, not stranded at the far end of the row.
  "Robo2 Body Weight (kg)",
  "Robo2 Cycle Time (sec)",
  "In Time",
  "Out Time",
  "Remarks",
] as const;

/** Column widths, one per column above and in the same order. */
export const PRODUCTION_RECORD_WIDTHS = [7, 15, 7, 22, 13, 12, 12, 21, 21, 10, 10, 40];

export type ProductionRecordColumn = (typeof PRODUCTION_RECORD_COLUMNS)[number];
export type ProductionRecordRow = Partial<Record<ProductionRecordColumn, string | number>>;

/** What a record contributes, already resolved by the route. */
export interface ProductionRowInput {
  serialNumber: number | null;
  productionDate: string;
  designName: string | null;
  thickness: number | null;
  batchNo: string | null;
  slabNumber: string;
  /** "A", "B", "C" — resolved by the route through productionShiftOf, so a slab
   *  with nothing stored still reports the shift its In Time falls in. "" only
   *  when even the times cannot say. */
  productionShift: string;
  roymixBodyWeight: number | null;
  roymixCycleTime: number | null;
  inTime: string | null;
  outTime: string | null;
  /** The Slabs-Records remark string, note and delays together, resolved in
   *  the route through formatSlabRemarks. "-" when there is nothing. */
  remarks: string;
  /** CR-003: a trial slab — its Batch No. cell reads "D-1506 (Trial Slab)".
   *  Grouping still uses batchNo itself, so it stays in its batch's group. */
  isTrial?: boolean;
}

const dash = (v: string | number | null | undefined): string | number =>
  v === null || v === undefined || v === "" ? "-" : v;

/**
 * One row, keyed by exactly the columns above.
 *
 * `seqNo` is the slab's S.No. — its 1…N position in its batch, computed by the
 * caller from the authoritative slab-number order (see slabSequence.ts). The
 * stored `serialNumber` is deliberately NOT used: it was mistyped on old runs
 * (a batch numbered 1…36 then restarting at 24), so trusting it showed
 * duplicates and stopped short of the real slab count.
 */
export function productionRecordRow(
  r: ProductionRowInput,
  seqNo: number,
): ProductionRecordRow {
  return {
    "S.No.":                  seqNo,
    "Production Date":        dash(r.productionDate),
    "Shift":                  dash(r.productionShift),
    "Design Name":            dash(r.designName),
    "Thickness (cm)":         dash(r.thickness),
    "Batch No.":              r.isTrial ? batchLabel(r.batchNo, true) : dash(r.batchNo),
    "Slab No.":               dash(r.slabNumber),
    "Robo2 Body Weight (kg)": dash(r.roymixBodyWeight),
    "Robo2 Cycle Time (sec)": dash(r.roymixCycleTime),
    "In Time":                dash(r.inTime),
    "Out Time":               dash(r.outTime),
    "Remarks":                dash(r.remarks),
  };
}
