import "server-only";
import { prisma } from "@/lib/prisma";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";
import { plantThicknessCm } from "@/lib/robo/plantThickness";
import {
  IMPORT_FILL_MAX_SLABS, fillBlanksFromPlant, misBatchBySlab, plainSlabNumbersOf,
  type FillableRow, type FilledCells, type PlantFillValue,
} from "@/lib/robo/importPlantFill";

/**
 * The plant's side of "the register import fills its blanks" (rule and words:
 * lib/robo/importPlantFill). READS ONLY, and every read is a SELECT with
 * explicit columns: the plant's rows are never selected whole (they hold large
 * JSON), only the one field wanted is taken out of `data`. Nothing is written,
 * here or to the plant's tables.
 *
 * For the plain slab numbers of the file (at most IMPORT_FILL_MAX_SLABS):
 *   thickness  the plant's code (plant_slab.data F_SLAB_THICKNESS, the later
 *              row by F_ID when two share a number) through lineHeadThicknessMm,
 *              in centimetres as Robo holds it;
 *   batch      the batch of the MIS hour whose range holds the slab, as typed;
 *              else the batch of the slab's plant run (sync_line_order_batch,
 *              state 'resolved').
 * A slab the plant has no row for is not in the map at all.
 *
 * NEVER THROWS. Any fault, or the plant's tables not being there, is "the plant
 * says nothing": an empty map, so the import goes on exactly as it did before.
 * Only the Prisma error CODE is logged, never its message (it can quote values).
 */

type PlantSql = { slab_no: number; line_order: number | null; thk: string | null };
type RunSql = { line_order: number; batch: string | null };

const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

export interface PlantFillRead {
  lookup: Map<number, PlantFillValue>;
  /** More distinct slab numbers than IMPORT_FILL_MAX_SLABS: only the first ones were asked about. */
  capped: boolean;
  /** How many slab numbers were asked about. */
  asked: number;
}

/** What the plant says of these slab numbers (file order, plain numbers only). */
export async function readPlantFillValues(slabNumbers: readonly string[]): Promise<PlantFillRead> {
  const { numbers, capped } = plainSlabNumbersOf(slabNumbers, IMPORT_FILL_MAX_SLABS);
  const lookup = new Map<number, PlantFillValue>();
  const none: PlantFillRead = { lookup, capped, asked: numbers.length };
  if (!numbers.length) return none;
  try {
    if (!(await plantTablesReady())) return none;

    // One row per slab number, the later by F_ID, so the limit can never cut a number off.
    const plant = await prisma.$queryRaw<PlantSql[]>`
      SELECT DISTINCT ON (s.slab_no) s.slab_no, s.line_order, s.data->>'F_SLAB_THICKNESS' AS thk
        FROM plant_slab s
       WHERE s.slab_no = ANY(${numbers}::int[])
       ORDER BY s.slab_no, s.f_id DESC
       LIMIT ${IMPORT_FILL_MAX_SLABS}`;
    const bySlab = new Map<number, { lineOrder: number | null; thk: string | null }>();
    for (const r of plant) bySlab.set(Number(r.slab_no), { lineOrder: r.line_order == null ? null : Number(r.line_order), thk: r.thk });
    if (!bySlab.size) return none;

    const have = [...bySlab.keys()];
    const lo = Math.min(...have), hi = Math.max(...have);
    // The MIS hours that can hold any of them; misBatchBySlab keeps the believable ranges.
    const hours = await prisma.mis.findMany({
      where: { batch: { not: null }, startingSlabNumber: { not: null, lte: hi }, endingSlabNumber: { not: null, gte: lo } },
      select: { batch: true, startingSlabNumber: true, endingSlabNumber: true },
      take: 20000,
    });
    const misBatch = misBatchBySlab(have, hours.map((h) => ({ batch: h.batch, start: h.startingSlabNumber, end: h.endingSlabNumber })));

    // The plant's run, for the slabs MIS does not name.
    const orders = [...new Set(have.filter((n) => !misBatch.has(n)).map((n) => bySlab.get(n)!.lineOrder).filter((o): o is number => o != null))];
    const runBatches = new Map<number, Set<string>>();
    if (orders.length) {
      const runs = await prisma.$queryRaw<RunSql[]>`
        SELECT b.line_order, b.batch
          FROM sync_line_order_batch b
         WHERE b.state = 'resolved' AND b.line_order = ANY(${orders}::int[])
         LIMIT ${orders.length * 4}`;
      for (const r of runs) {
        const batch = String(r.batch ?? "").trim();
        if (!batch) continue;
        const k = Number(r.line_order);
        let set = runBatches.get(k);
        if (!set) runBatches.set(k, (set = new Set()));
        set.add(batch);
      }
    }

    for (const [n, s] of bySlab) {
      const fromRun = s.lineOrder != null ? runBatches.get(s.lineOrder) : undefined;
      const batch = misBatch.get(n) ?? (fromRun && fromRun.size === 1 ? [...fromRun][0] : null);
      const thicknessCm = plantThicknessCm(s.thk);
      if (batch != null || thicknessCm != null) lookup.set(n, { batch, thicknessCm });
    }
    return none;
  } catch (e) {
    console.warn(`[robo/import-fill] the plant could not be read (${code(e)})`);
    lookup.clear();
    return none;
  }
}

export interface PlantFilledRows<T extends FillableRow> {
  /** The rows with blanks filled; the file's own rows when the plant says nothing. */
  rows: T[];
  /** By rowNumber, the cells filled. */
  filled: Map<number, FilledCells>;
  capped: boolean;
  asked: number;
}

/**
 * THE ONE FUNCTION the preview and the import both call, so what is imported
 * is exactly what the preview showed: read the plant for the file's slab
 * numbers, fill the blank batch and blank thickness cells. Never throws.
 */
export async function fillRowsFromPlant<T extends FillableRow>(rows: readonly T[]): Promise<PlantFilledRows<T>> {
  try {
    const read = await readPlantFillValues(rows.map((r) => r.slabNumber));
    const { rows: filledRows, filled } = fillBlanksFromPlant(rows, read.lookup);
    return { rows: filledRows, filled, capped: read.capped, asked: read.asked };
  } catch {
    return { rows: [...rows], filled: new Map(), capped: false, asked: 0 };
  }
}
