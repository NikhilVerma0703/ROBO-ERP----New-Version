import type { Prisma } from "@prisma/client";

/**
 * The register import's reads and its one find-or-create, apart from the pure
 * rules in registerImport.ts.
 *
 * `*Db.ts` like registerOrderDb.ts: it reads the database, so it sits apart
 * from the pure helpers, and it only ever imports types from Prisma, so
 * `node --test` can still load it against a stand-in database. From the code
 * review of 20 Oct 2026: ROBO-2, ROBO-7 and ROBO-8.
 */

/**
 * The transaction-scoped advisory lock the import takes before it reads
 * anything (ROBO-8), as `pg_try_advisory_xact_lock(hashtext(<this>))` — the
 * same hashtext form the silo and storage-tank locks in tables/actions.ts use.
 *
 * Two imports of one register at once — two tabs, two Robo users, or a retry
 * after a gateway timeout while the first is still working — each looked for
 * the date's shift row, both found none and both made one, then each checked
 * every slab before the other had written it and both wrote them all: every
 * slab recorded twice, under two shifts. One import at a time closes that:
 * the second is refused at once with a message to wait, and when it is run
 * again it reads the slabs the first one wrote and skips them. The lock is
 * released by COMMIT or ROLLBACK, so a failed or cut-off import cannot leave
 * it held.
 */
export const REGISTER_IMPORT_LOCK = "robo:register-import";

/** How many slab numbers go into one `IN (...)` — well inside the bind-variable
 *  limit however large the register. */
export const SLAB_NUMBER_BATCH = 1000;

/** The one table recordedSlabNumbers reads — `prisma` itself or a transaction's `tx`. */
export type SlabNumberDb = Pick<Prisma.TransactionClient, "roboProductionRecord">;

/**
 * Which of these slab numbers are already on a slab record, anywhere (ROBO-2).
 * One read per SLAB_NUMBER_BATCH numbers for the whole file — the import used
 * to run a findFirst per row, 3,000 sequential round trips for a month's
 * register (ROBO-7). Exact match on the trimmed number, as slab entry checks.
 */
export async function recordedSlabNumbers(db: SlabNumberDb, numbers: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(numbers.map((n) => n.trim()).filter(Boolean))];
  const found = new Set<string>();
  for (let i = 0; i < wanted.length; i += SLAB_NUMBER_BATCH) {
    const rows = await db.roboProductionRecord.findMany({
      where: { slabNumber: { in: wanted.slice(i, i + SLAB_NUMBER_BATCH) } },
      select: { slabNumber: true },
    });
    for (const r of rows) found.add(r.slabNumber);
  }
  return found;
}

/** The one table importShift touches. */
export type ShiftDb = Pick<Prisma.TransactionClient, "roboShift">;

export interface ImportShiftFields {
  date: string;
  shiftNumber: number;
  startTime: string;
  endTime: string | null;
  operatorName: string;
}

/** What every shift row the import makes says about itself. */
export const IMPORTED_SHIFT_NOTE = "Imported from production register";

/**
 * The shift row for this date and shift number — the existing one, or a new
 * CLOSED one (imported history is never the live shift).
 *
 * The new row is written with `createMany({ skipDuplicates: true })`, which
 * is INSERT … ON CONFLICT DO NOTHING, and then read back (ROBO-8). With
 * scripts/0131's unique index on (date, shiftNumber), a row the tablet made
 * for the same date and shift in the same instant is simply found — a plain
 * create would have thrown inside the import's transaction and rolled the
 * whole file back. Without the index there is nothing to conflict with, the
 * row is inserted as before, and imports cannot race each other for it
 * because they hold REGISTER_IMPORT_LOCK. Either way the oldest row for the
 * pair is the answer, so the choice is the same every time.
 */
export async function importShift(db: ShiftDb, fields: ImportShiftFields): Promise<{ id: string }> {
  const where = { date: fields.date, shiftNumber: fields.shiftNumber };
  const pick = () => db.roboShift.findFirst({ where, orderBy: { createdAt: "asc" }, select: { id: true } });
  const existing = await pick();
  if (existing) return existing;
  await db.roboShift.createMany({
    data: [{ ...fields, status: "CLOSED", notes: IMPORTED_SHIFT_NOTE }],
    skipDuplicates: true,
  });
  const made = await pick();
  if (!made) throw new Error(`The shift row for ${fields.date} (shift ${fields.shiftNumber}) could not be created.`);
  return made;
}
