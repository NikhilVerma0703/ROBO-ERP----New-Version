// THE REGISTER IMPORT FILLS ITS BLANKS FROM THE PLANT (owner, 17 Nov 2026,
// "Import: fill blanks"). A paper register often leaves the Batch No. or the
// Thickness cell empty. The plant knows both for every slab it made, by slab
// number, so an EMPTY cell is filled from it, and the preview says so before
// anything is imported.
//
// THE RULE, in one place:
//   - only a BLANK cell is ever filled: a batch cell with no text, a thickness
//     cell with no number. What the sheet says is never overwritten, even when
//     the plant disagrees;
//   - a slab number that is not a plain number ("140748-A") is no plant slab:
//     its row is left exactly as it was;
//   - when the plant says nothing for a slab (or at all), the row is returned
//     as it was, the very same object.
//
// GROUPING. The import joins a slab to its setup by batch number and design
// (registerImport.ts setupIndex, canonBatchNo), and a new setup takes the batch
// and thickness of the row that makes it. The fill runs BEFORE any of that, on
// the parsed rows, so a filled batch groups exactly like a typed one: the
// import and the preview both read the filled rows and nothing else.
//
// PURE: relative .ts imports of files that import nothing from the app, so
// `node --test` reads it. The plant reads are in importPlantRead.ts.
import { misSlabNumbers, plainSlabNo, type MisRange } from "./plantSlabs.ts";

/** What the plant says of one slab: either may be null (it says nothing). */
export interface PlantFillValue { batch: string | null; thicknessCm: number | null }

/** The cells of a parsed row this reads and may fill (ParsedRow has more). */
export interface FillableRow {
  rowNumber: number;
  slabNumber: string;
  batchNo: string;
  thickness: number | null;
}

/** Which cells of one row were filled from the plant. */
export interface FilledCells { batch: boolean; thickness: boolean }

export interface PlantFillResult<T extends FillableRow> {
  /** The rows, blanks filled. A row nothing was filled in is the same object. */
  rows: T[];
  /** By the row's rowNumber: only rows where at least one cell was filled. */
  filled: Map<number, FilledCells>;
}

/** The most distinct slab numbers one file asks the plant about. */
export const IMPORT_FILL_MAX_SLABS = 6000;

const isBlankText = (s: string | null | undefined) => String(s ?? "").trim() === "";

/**
 * The rows with their blank batch and blank thickness filled from `lookup`
 * (plain slab number -> what the plant says). See the header.
 */
export function fillBlanksFromPlant<T extends FillableRow>(
  rows: readonly T[],
  lookup: ReadonlyMap<number, PlantFillValue>,
): PlantFillResult<T> {
  const filled = new Map<number, FilledCells>();
  if (lookup.size === 0) return { rows: [...rows], filled };
  const out = rows.map((row): T => {
    const n = plainSlabNo(row.slabNumber);
    if (n == null) return row;
    const plant = lookup.get(n);
    if (!plant) return row;
    const batch = plant.batch == null ? "" : plant.batch.trim();
    const fillBatch = isBlankText(row.batchNo) && batch !== "";
    const cm = plant.thicknessCm;
    const fillThickness = row.thickness == null && cm != null && Number.isFinite(cm) && cm > 0;
    if (!fillBatch && !fillThickness) return row;
    filled.set(row.rowNumber, { batch: fillBatch, thickness: fillThickness });
    return {
      ...row,
      ...(fillBatch ? { batchNo: batch } : {}),
      ...(fillThickness ? { thickness: cm } : {}),
    };
  });
  return { rows: out, filled };
}

/** How many batch numbers and thicknesses were filled, over `rows` only (the rows that will be imported). */
export function countFilled(
  filled: ReadonlyMap<number, FilledCells>,
  rows: readonly Pick<FillableRow, "rowNumber">[],
): { batches: number; thicknesses: number } {
  let batches = 0, thicknesses = 0;
  for (const r of rows) {
    const f = filled.get(r.rowNumber);
    if (!f) continue;
    if (f.batch) batches++;
    if (f.thickness) thicknesses++;
  }
  return { batches, thicknesses };
}

/** The distinct plain slab numbers of a file, in the order they first appear, at most `cap`; `capped` says there were more. */
export function plainSlabNumbersOf(
  slabNumbers: readonly string[],
  cap = IMPORT_FILL_MAX_SLABS,
): { numbers: number[]; capped: boolean } {
  const seen = new Set<number>();
  let capped = false;
  for (const s of slabNumbers) {
    const n = plainSlabNo(s);
    if (n == null || seen.has(n)) continue;
    if (seen.size >= cap) { capped = true; break; }
    seen.add(n);
  }
  return { numbers: [...seen], capped };
}

/** One MIS hour: the batch as the in-charge typed it, and the slab range filed. */
export interface MisHour extends MisRange { batch: string | null | undefined }

/**
 * The batch MIS names for each of these slab numbers: the hour whose believable
 * range (misSlabNumbers' rule) holds the slab, the batch as typed. A slab whose
 * holding hours name two different batches has no answer here (the plant's own
 * run answers instead): MIS is not guessed between.
 */
export function misBatchBySlab(numbers: readonly number[], hours: readonly MisHour[]): Map<number, string> {
  const wanted = new Set(numbers);
  const found = new Map<number, Set<string>>();
  for (const h of hours) {
    const batch = String(h.batch ?? "").trim();
    if (!batch) continue;
    for (const n of misSlabNumbers([h]).numbers) {
      if (!wanted.has(n)) continue;
      let set = found.get(n);
      if (!set) found.set(n, (set = new Set()));
      set.add(batch);
    }
  }
  const out = new Map<number, string>();
  for (const [n, set] of found) if (set.size === 1) out.set(n, [...set][0]);
  return out;
}

/** The words the preview shows under the table. */
export function fillSummaryText(c: { batches: number; thicknesses: number }): string {
  return `${c.batches} batch number${c.batches === 1 ? "" : "s"} and ${c.thicknesses} thickness${c.thicknesses === 1 ? "" : "es"} filled from the plant.`;
}
