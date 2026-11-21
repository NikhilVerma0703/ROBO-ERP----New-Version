/**
 * "Restore last deleted slab" — the rules for putting one robo slab back.
 *
 * Pure and import-free so `node --test` can reach it. The database half is
 * restoreRoboSlab() in src/lib/actionLog.ts, which reads what is in the
 * database inside one transaction and hands it here to decide; this file holds
 * every decision and every message, so the rule reads in one place.
 *
 * ── WHY IT IS NOT THE GENERIC UNDO ────────────────────────────────────────
 * A slab delete (DELETE /api/robo/production/[id]) writes the slab and its
 * delay logs into action_log, and the restore used to hand that copy to
 * actionLog's generic `delete` reversal. That reversal re-creates each row in
 * its own try/catch and swallows the error ("skip if it already exists"), then
 * the entry was marked undone and the admin was told "Restored: …" whatever had
 * happened. Two things went wrong with a slab (code review of 20 Oct 2026,
 * ROBO-9):
 *
 *   - The tablet deletes 148775, keyed against the wrong batch, and at once
 *     keys 148775 again, correctly — the very workflow the widened delete is
 *     for (rbac.ts canDeleteRoboSlab). Later an admin presses "Restore it": the
 *     old row comes back under its old id, and the register now holds two
 *     records numbered 148775, the duplicate every POST and PATCH refuses with
 *     a 409. Nothing checked.
 *   - If the slab's own insert failed for any reason, the error was swallowed,
 *     the deletion was marked restored, and the screen said "Restored". The
 *     slab was gone, and so was the offer to bring it back.
 *
 * So a slab is restored on its own terms: refused while another record holds
 * its slab number, refused (and left on offer) when the slab itself cannot be
 * put back, all in one transaction with the entry marked restored only if the
 * slab really is back. Every other kind of undo is untouched.
 *
 * ── DELAY LOGS ────────────────────────────────────────────────────────────
 * The slab is the thing being restored; its delay logs come with it when they
 * can. A delay log names a delay code, a shift and maybe a machine, and the
 * code can have been deleted since (delay-codes DELETE allows it once nothing
 * logged against it remains, which is exactly the state the slab delete
 * leaves). Inside a Postgres transaction one failed insert aborts the lot, so a
 * delay log is checked BEFORE it is written: one whose references are all still
 * there goes back verbatim; one that cannot is left out, and the message says
 * how many and why — never a silent "Restored". Its copy stays in action_log.
 *
 * ── A DELETION THAT SHOULD NOT COME BACK ──────────────────────────────────
 * A refused restore rolls back, so the deletion stays open — right for a
 * failure that can pass, and the first version (ROBO-9) left it at that. But
 * most refusals do not pass. The usual one is the workflow above: the new
 * 148775 is the right record, the old one should stay deleted, and nothing in
 * the app could close the entry. The Slabs Records banner kept offering it,
 * still promising it "can be put back exactly as they were", every press of
 * "Restore it" failed, and every deletion before it was out of reach behind it.
 * The global Undo on /batch stopped at it the same way (a later review of the
 * same code review of 20 Oct 2026).
 *
 * So a deletion can now be CLOSED without restoring it ("Keep it deleted",
 * admin only, on the banner): the entry is marked done, its saved copy stays
 * in action_log untouched, and a `dismissed` note beside it records who closed
 * it, when, and why the restore would have been refused at that moment.
 * The banner reads ahead and says WHY a restore would be refused, instead of
 * offering a button that cannot work. The global Undo steps past a slab
 * deletion it could only refuse, to the newest action it can take back.
 */

/** A deleted slab as the DELETE handler saved it — the row, verbatim. */
export interface SavedSlab {
  id: string;
  slabNumber: string;
  shiftId: string;
  batchRecipeId?: string | null;
  [field: string]: unknown;
}

/** A deleted delay log as saved — the row, verbatim. */
export type SavedDelayLog = Record<string, unknown>;

export type SlabRestorePlan =
  | { ok: true; slab: SavedSlab; delayLogs: SavedDelayLog[] }
  | { ok: false; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The way out of a refusal that will not pass on its own — the banner's
 *  "Keep it deleted" button, which closes the entry and keeps its copy. */
const CLOSE_IT = `To close this entry without restoring it, choose "Keep it deleted".`;

/**
 * Read the slab and its delay logs out of a slab-delete entry's payload.
 *
 * The DELETE handler writes `{ groups: [{ model: "RoboProductionRecord",
 * records: [slab] }, { model: "RoboDelayLog", records: delayLogs }] }`; the
 * generic `{ model, records }` shape is read too, as actionLog's reversal reads
 * both. Anything else — no slab, more than one, a slab missing its id, number
 * or shift — is refused rather than guessed at: a restore that is not sure what
 * it is restoring does not run.
 */
export function planSlabRestore(payload: unknown): SlabRestorePlan {
  const groups: { model: unknown; records: unknown }[] = [];
  if (isRecord(payload)) {
    if (payload.model && Array.isArray(payload.records)) groups.push({ model: payload.model, records: payload.records });
    if (Array.isArray(payload.groups)) for (const g of payload.groups) if (isRecord(g)) groups.push({ model: g.model, records: g.records });
  }
  const slabs: unknown[] = [];
  const delayLogs: SavedDelayLog[] = [];
  for (const g of groups) {
    if (!Array.isArray(g.records)) continue;
    if (g.model === "RoboProductionRecord") slabs.push(...g.records);
    else if (g.model === "RoboDelayLog") delayLogs.push(...g.records.filter(isRecord));
  }
  const slab = slabs.length === 1 ? slabs[0] : null;
  if (!isRecord(slab) || !nonEmpty(slab.id) || !nonEmpty(slab.slabNumber) || !nonEmpty(slab.shiftId)) {
    return {
      ok: false,
      message: `This deletion's saved copy does not hold one complete slab, so it cannot be put back from here. The copy is still kept in the action log. ${CLOSE_IT}`,
    };
  }
  return { ok: true, slab: slab as SavedSlab, delayLogs };
}

/** What the database says — read inside the restore's transaction, and read
 *  ahead, outside it, to tell the banner whether a restore would be refused. */
export interface SlabRestoreState {
  /** The slab's own row (same id) is already in the register. */
  sameIdExists: boolean;
  /** A DIFFERENT live record already holds this slab number. */
  numberTaken: boolean;
  /** The shift the slab was recorded under still exists. */
  shiftExists: boolean;
  /** The batch setup it belonged to still exists (true when it had none). */
  setupExists: boolean;
}

export type SlabRestoreDecision =
  /** Put it back. */
  | { action: "restore" }
  /** It is already there: nothing is written, and the deletion is closed so it
   *  stops being offered. Not a refusal, and not a "Restored" either. */
  | { action: "alreadyBack"; message: string }
  /** Do not put it back; the deletion stays open until it is restored or
   *  closed. `message` answers a press of "Restore it"; `notice` is what the
   *  banner says before anyone presses it. Both end with the way out. */
  | { action: "refuse"; message: string; notice: string };

const refuse = (reason: string): SlabRestoreDecision => ({
  action: "refuse",
  message: `Not restored: ${reason}`,
  notice: `This one cannot be put back: ${reason}`,
});

/**
 * Whether the slab may go back, in the order the checks matter.
 *
 * The slab-number rule is the same one POST and PATCH enforce (an exact match
 * on the trimmed number, against every other record): a slab number is how a
 * slab is found again, so two records on one number make the search screen
 * lie. A restore that would create that is refused, and the message says what
 * to do either way. Usually the new record is the right one, and the old
 * deletion is closed. If the old one is right, the new slab is deleted — and
 * since that deletion is now the newest, it is the one the banner offers; it
 * is closed in turn ("Keep it deleted"), and the banner comes back to this one,
 * which can then be restored.
 */
export function decideSlabRestore(slabNumber: string, state: SlabRestoreState): SlabRestoreDecision {
  const n = slabNumber.trim();
  if (state.sameIdExists) {
    return { action: "alreadyBack", message: `Slab ${n} is already back in the register — nothing was changed.` };
  }
  if (state.numberTaken) {
    return refuse(
      `slab ${n} has been entered again since it was deleted, and two records cannot share one slab number. ` +
      `If the new record is the right one, choose "Keep it deleted" to close this entry. ` +
      `If the deleted one is right, delete the new slab ${n}, choose "Keep it deleted" on that deletion, then restore this one.`,
    );
  }
  if (!state.shiftExists) {
    return refuse(`the shift slab ${n} was recorded under no longer exists. The deleted record is still kept in the action log. ${CLOSE_IT}`);
  }
  if (!state.setupExists) {
    return refuse(`the batch setup slab ${n} belonged to no longer exists. The deleted record is still kept in the action log. ${CLOSE_IT}`);
  }
  return { action: "restore" };
}

/** The ids a set of delay logs points at, de-duplicated — what to look up. */
export function delayLogRefs(delayLogs: readonly SavedDelayLog[]): {
  ids: string[];
  delayCodeIds: string[];
  machineIds: string[];
  shiftIds: string[];
} {
  const pick = (field: string) => [...new Set(delayLogs.map((d) => d[field]).filter(nonEmpty))];
  return { ids: pick("id"), delayCodeIds: pick("delayCodeId"), machineIds: pick("machineId"), shiftIds: pick("shiftId") };
}

/** Which of those ids the database still holds. */
export interface DelayLogRefsFound {
  existingIds: ReadonlySet<string>;
  delayCodeIds: ReadonlySet<string>;
  machineIds: ReadonlySet<string>;
  shiftIds: ReadonlySet<string>;
}

/**
 * Split the slab's delay logs into those that go back and those that cannot.
 *
 * One goes back when its delay code and shift exist and its machine, if it
 * names one, exists. One already in the table (same id) is neither written nor
 * counted as lost — it is there. Everything else is `skipped`.
 */
export function restorableDelayLogs(
  delayLogs: readonly SavedDelayLog[],
  found: DelayLogRefsFound,
): { restore: SavedDelayLog[]; skipped: number } {
  const restore: SavedDelayLog[] = [];
  let skipped = 0;
  for (const d of delayLogs) {
    const { id, delayCodeId, shiftId, machineId } = d;
    if (nonEmpty(id) && found.existingIds.has(id)) continue;
    const machineOk = machineId == null || machineId === "" || (nonEmpty(machineId) && found.machineIds.has(machineId));
    const ok =
      nonEmpty(delayCodeId) && found.delayCodeIds.has(delayCodeId) &&
      nonEmpty(shiftId) && found.shiftIds.has(shiftId) &&
      machineOk;
    if (ok) restore.push(d);
    else skipped++;
  }
  return { restore, skipped };
}

const delayLogsText = (n: number) => `${n} delay log${n === 1 ? "" : "s"}`;

/** What the admin is told after the slab really is back. */
export function slabRestoredMessage(slabNumber: string, restoredDelayLogs: number, skippedDelayLogs: number): string {
  const n = slabNumber.trim();
  const head = restoredDelayLogs > 0 ? `Restored slab ${n} and its ${delayLogsText(restoredDelayLogs)}.` : `Restored slab ${n}.`;
  if (skippedDelayLogs === 0) return head;
  return `${head} ${delayLogsText(skippedDelayLogs)} could not be put back, because the delay code, machine or shift ${skippedDelayLogs === 1 ? "it names" : "they name"} no longer exists; ${skippedDelayLogs === 1 ? "its copy is" : "their copies are"} still in the action log.`;
}

/**
 * The deletion's payload once it is closed without a restore: the saved copy
 * exactly as it was, with a `dismissed` note beside it — who closed it, when,
 * and why a restore would have been refused at that moment (null when it
 * would have gone through: the admin decided the delete was right). The copy
 * is what a by-hand recovery would ever need, so it is never trimmed; a
 * payload that is somehow not an object is kept whole under `saved`.
 */
export function dismissedPayload(
  payload: unknown,
  note: { by: string | null; at: string; refusal: string | null },
): Record<string, unknown> {
  const dismissed = { by: note.by, at: note.at, refusal: note.refusal };
  return isRecord(payload) ? { ...payload, dismissed } : { saved: payload ?? null, dismissed };
}

/** What the admin is told once a deletion is closed without a restore. */
export function slabDismissedMessage(slabNumber: string | null): string {
  const what = slabNumber && slabNumber.trim() ? `Slab ${slabNumber.trim()}` : "The slab";
  return `Closed: ${what} stays deleted. Its saved copy is still in the action log.`;
}
