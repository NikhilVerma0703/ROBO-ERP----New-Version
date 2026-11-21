/**
 * "Apply this from here onward" — the forward run of slabs a range edit touches.
 *
 * Pure so `node --test` can reach it; its one import is the relative
 * slabSequence.ts, which is pure as well. The PATCH handler does the database
 * work (see api/robo/production/[id]/route.ts); this decides WHICH slabs are in
 * the range, and nothing else, so the rule can be tested on its own and read in
 * one place.
 *
 * THE RULE. A batch can change its Production Date or its Thickness partway
 * through — a run crosses midnight, or the line switches to a different slab
 * thickness mid-batch — but the register was saved with one value on the whole
 * run. To correct it without editing every slab by hand, the operator opens the
 * slab where the change BEGINS, sets the new value, and asks for it to carry
 * forward. This computes exactly how far "forward" goes:
 *
 *   start at the edited slab, and include every following slab, in PRODUCTION
 *   order, that currently shows the SAME value the edited slab shows — stopping
 *   at the first slab that already shows something different, or at the end of
 *   the batch.
 *
 * So on a batch that is all one date, editing the 18th slab -> 20 Aug takes the
 * 18th to the end. Do the 111th -> 21 Aug first and then the 18th -> 20 Aug, and
 * the 18th's edit stops at the 110th because the 111th already reads 21 Aug.
 * Either order lands on 1-17 = the original day, 18-110 = 20 Aug, 111-123 =
 * 21 Aug. And a slab BEFORE the edited one is never in the run, so
 * previously-saved earlier slabs cannot move — which is the one thing a bulk
 * edit must never get wrong. The Batch No. / Design split (batchSplit.ts) uses
 * the same run, keyed on the batch itself, so it moves the edited slab and
 * every slab produced after it in the batch.
 *
 * ── WHICH ORDER IS "FOLLOWING" ────────────────────────────────────────────
 * Production order is the PHYSICAL SLAB NUMBER ascending, then entry time, then
 * id — slabSequence.compareSlabOrder, the same order that numbers the S.No. on
 * Slabs Records, the exports and the hourly chart. It is NOT the stored
 * `serialNumber`.
 *
 * It used to be. The handler queried the batch `orderBy serialNumber, createdAt`
 * and this read the run straight off that order — but slabSequence.ts exists
 * because the stored S.No. is not reliable: old runs were mistyped, a batch
 * going 1…36 and then starting again at 24. On such a batch the stored order
 * interleaves two stretches of production: …, 24 (the 24th slab), 24 (the
 * 37th), 25 (the 25th), 25 (the 38th), … So the operator opened the 37th slab —
 * its form shows the stored S.No. 24 — changed its date, ticked "apply
 * forward", and the run took in the 25th to the 36th as well: slabs produced
 * BEFORE the edited one, given the new date or thickness or split off into the
 * new batch, on a screen that numbers them by slab number and so gave no hint
 * it would happen. Code review of 20 Oct 2026, ROBO-1.
 *
 * So the order now lives HERE, not in the caller's query: forwardRunIds sorts
 * what it is handed, and a caller cannot get the run wrong by querying in some
 * other order. The rows need only their id, slab number and createdAt.
 *
 * "Same value" is compared as a string KEY the caller supplies (the effective
 * production date, or the effective thickness, or the batch) so this stays
 * ignorant of which field is being ranged and how each falls back to the batch
 * setup.
 */

import { compareSlabOrder, type SeqSlab } from "./slabSequence.ts";

/** A slab reduced to what the run needs: its id, and what orders it. */
export interface RunSlab {
  id: string;
  /** The plant's physical slab number — the authoritative production order. */
  slabNumber: string | null;
  /** When the slab was entered — breaks a tie between equal slab numbers. */
  createdAt?: Date | string | null;
}

/** The ordering key compareSlabOrder reads, from a slab as Prisma returns it. */
function seqOf(slab: RunSlab): SeqSlab {
  const ms = slab.createdAt == null ? null : new Date(slab.createdAt).getTime();
  return { slabNumber: slab.slabNumber, createdAtMs: ms != null && Number.isFinite(ms) ? ms : null, id: slab.id };
}

/**
 * A batch's slabs in production order — slab number ascending, then entry
 * time, then id (slabSequence.compareSlabOrder). A sorted copy; the input is
 * left as it was.
 */
export function inRunOrder<T extends RunSlab>(slabs: readonly T[]): T[] {
  return [...slabs].sort((a, b) => compareSlabOrder(seqOf(a), seqOf(b)));
}

/**
 * The ids to update: the edited slab and the contiguous following slabs, in
 * production order, that share its current value.
 *
 * `slabs` is the batch's slabs in ANY order — they are put in production order
 * here (inRunOrder), never taken in the order the query returned them, for the
 * reason in the header.
 *
 * `keyOf` returns the slab's CURRENT effective value as a string — two slabs are
 * "the same" iff their keys are equal. The edited slab's key is read BEFORE the
 * new value is written (the caller computes the run first, then updates), so it
 * is the OLD value that defines the run, exactly as the rule requires.
 *
 * The edited slab is always in the result (a run of one is still a run), even if
 * `startId` is not found in `slabs` — then the result is just `[startId]`, so
 * a range save can never silently touch nothing.
 */
export function forwardRunIds<T extends RunSlab>(
  slabs: readonly T[],
  startId: string,
  keyOf: (slab: T) => string,
): string[] {
  const ordered = inRunOrder(slabs);
  const startIndex = ordered.findIndex((s) => s.id === startId);
  if (startIndex < 0) return [startId];

  const startKey = keyOf(ordered[startIndex]);
  const ids: string[] = [];
  for (let i = startIndex; i < ordered.length; i++) {
    if (keyOf(ordered[i]) !== startKey) break;
    ids.push(ordered[i].id);
  }
  return ids;
}
