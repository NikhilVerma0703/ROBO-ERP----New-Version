// Append-only action log — the Robo part of it.
//
// STANDALONE: Pacific ERP's lib/actionLog.ts (661 lines) is the ERP-wide audit
// trail and global "Undo", which reverses edits in every module (silo, finished
// goods, stock, mixer cycles…). Robo ERP keeps only what Robo and the shared
// Attendance register call, COPIED UNCHANGED from the ERP file:
//   * logActionTx        — the audit row written inside a slab edit/delete or an
//                          attendance write's own transaction;
//   * lastUndoableFor    — the "last deleted slab" banner on Slab Records;
//   * restoreRoboSlabDelete / dismissRoboSlabDelete — that banner's two buttons,
//                          with the whole ROBO-9 restore logic (restoreRoboSlab,
//                          slabRestoreRefusal, readSlabRestoreState).
// Left out: the generic undoLastAction/reverse machinery for other modules,
// logAction/logActionAs (no Robo caller) and recentActions.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import {
  decideSlabRestore,
  delayLogRefs,
  dismissedPayload,
  planSlabRestore,
  restorableDelayLogs,
  slabDismissedMessage,
  slabRestoredMessage,
  type SavedSlab,
  type SlabRestoreState,
} from "@/lib/robo/slabRestore";

import { type ActionKind } from "@/lib/actionLogKinds";

const log = () => (prisma as any).actionLog;

export type { ActionKind };

export interface LogInput {
  kind: ActionKind;
  summary: string;
  batchKey?: string | null;
  model?: string | null;
  payload: any;
}

/** Like logAction but inside the CALLER'S transaction, and NOT best-effort: a write
 *  that promises to be undoable must not outlive its undo trail, so if this entry
 *  can't be created the whole transaction rolls back with it. */
export async function logActionTx(tx: any, input: LogInput): Promise<void> {
  const u = await currentUser();
  await tx.actionLog.create({
    data: {
      kind: input.kind,
      summary: input.summary,
      batchKey: input.batchKey ?? null,
      model: input.model ?? null,
      payload: input.payload,
      actor: (u as any)?.email ?? (u as any)?.name ?? null,
    },
  });
}

export interface UndoableInfo { id: string; summary: string; kind: string; createdAt: string; actor: string | null }

function revive(rec: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null) continue; // omit nulls: nullable columns default to null, and Prisma rejects plain null for Json? fields
    out[k] = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v) : v;
  }
  return out;
}

export interface UndoResult { ok: boolean; message: string }

/**
 * The last un-undone deletion of one MODEL — and, below, its restore (by the
 * entry's id: restoreRoboSlabDelete) or its closing (dismissRoboSlabDelete).
 *
 * undoLastAction is keyed on batchKey, which is right for the rectification
 * screens: an undo there means "take back what I just did to THIS batch". A
 * robo slab delete carries no batchKey, so it could only have been reached by
 * calling undoLastAction(null) — and that undoes whatever happened last
 * ANYWHERE, which on a busy afternoon is somebody else's work on another
 * screen. Scoping by model is what makes the robo delete recoverable without
 * putting a global undo button on a shop-floor page.
 *
 * The delete was widened to the ROBO tablet on the strength of being
 * reversible (see canDeleteRoboSlab), so this is not a convenience — it is the
 * half of that decision that makes it safe.
 *
 * `refusal` reads ahead, outside any transaction, whether a restore of a robo
 * slab would be refused, and why — so the banner says so and offers only
 * "Keep it deleted", instead of promising the slab can be put back and failing
 * on every press. The restore itself decides again inside its transaction.
 * null when it would go through, or could not be read ahead (then the press
 * answers for itself).
 */
export async function lastUndoableFor(model: string): Promise<(UndoableInfo & { refusal: string | null }) | null> {
  try {
    const row = await log().findFirst({
      where: { undone: false, model, kind: "delete" },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const refusal = isRoboSlabDelete(row) ? await slabRestoreRefusal(row) : null;
    return { id: row.id, summary: row.summary, kind: row.kind, createdAt: new Date(row.createdAt).toISOString(), actor: row.actor ?? null, refusal };
  } catch { return null; }
}

/**
 * The robo slab deletion with this action_log id, while it is still open.
 *
 * The Slabs Records banner names ONE deletion, and its two buttons act on that
 * one, by id. They used to act on "the newest open deletion" at the moment of
 * the press — the same one, unless the tablet deleted another slab in between,
 * and then "Restore it" brought back a slab the admin had not been shown. For
 * "Keep it deleted" that would close the wrong entry, so both go by id.
 */
async function openRoboSlabDelete(entryId: string): Promise<{ row: any } | { message: string }> {
  const row = await log().findFirst({ where: { id: entryId, kind: "delete", model: "RoboProductionRecord" } });
  if (!row) return { message: "That slab deletion is not on record." };
  if (row.undone) return { message: "This deletion has already been restored or closed." };
  return { row };
}

/** "Restore it": put back the slab deletion the banner showed, on the slab's
 *  own terms (restoreRoboSlab). */
export async function restoreRoboSlabDelete(entryId: string): Promise<UndoResult> {
  const found = await openRoboSlabDelete(entryId);
  if (!("row" in found)) return { ok: false, message: found.message };
  return restoreRoboSlab(found.row);
}

/**
 * "Keep it deleted": close a robo slab deletion WITHOUT restoring it.
 *
 * The way out a refused restore never had (code review of 20 Oct 2026, a later
 * review of ROBO-9). A refusal rolls back and leaves the deletion open — right
 * while it may still go back, a dead end when it never will: the slab was
 * keyed again correctly, or its shift or setup is gone. Without this the
 * banner offered it for good, every press failed, and every older deletion sat
 * behind it.
 *
 * Writes no slab. Marks the entry done (undone/undoneAt are the log's only
 * "closed" marks) and keeps its saved copy whole in the payload, with a
 * `dismissed` note beside it: who closed it, when, and why a restore would
 * have been refused at that moment (null when it would have gone through —
 * then the admin decided the delete was right). Guarded like the restore's own
 * claim: only while it is still open, so a restore and a close pressed together
 * cannot both win. Offered for any open slab deletion, not only a refused one:
 * putting back the OLD record when the new one is wrong means deleting the new
 * one, and that deletion — now the newest — is closed in turn to reach it.
 */
export async function dismissRoboSlabDelete(entryId: string): Promise<UndoResult> {
  const found = await openRoboSlabDelete(entryId);
  if (!("row" in found)) return { ok: false, message: found.message };
  const { row } = found;
  const u = await currentUser();
  const at = new Date();
  const closed = await log().updateMany({
    where: { id: row.id, undone: false },
    data: {
      undone: true,
      undoneAt: at,
      payload: dismissedPayload(row.payload, {
        by: (u as any)?.email ?? (u as any)?.name ?? null,
        at: at.toISOString(),
        refusal: await slabRestoreRefusal(row),
      }),
    },
  });
  if (closed.count === 0) return { ok: false, message: "This deletion has already been restored or closed." };
  const plan = planSlabRestore(row.payload);
  return { ok: true, message: slabDismissedMessage(plan.ok ? plan.slab.slabNumber : null) };
}

/** A robo slab delete — the one entry DELETE /api/robo/production/[id] writes. */
function isRoboSlabDelete(row: any): boolean {
  return row?.kind === "delete" && row?.model === "RoboProductionRecord";
}

/** A refusal raised inside the restore's transaction: thrown to roll it back,
 *  and its message is what the admin reads. */
class SlabRestoreRefused extends Error {}

/** What decides a restore, read with `db`: the transaction's client inside
 *  restoreRoboSlab, plain prisma when reading ahead (slabRestoreRefusal). */
async function readSlabRestoreState(db: any, slab: SavedSlab, slabNumber: string): Promise<SlabRestoreState> {
  const sameId = await db.roboProductionRecord.findUnique({ where: { id: slab.id }, select: { id: true } });
  const taken = await db.roboProductionRecord.findFirst({ where: { slabNumber, NOT: { id: slab.id } }, select: { id: true } });
  const shift = await db.roboShift.findUnique({ where: { id: slab.shiftId }, select: { id: true } });
  const setup = slab.batchRecipeId
    ? await db.roboBatchRecipe.findUnique({ where: { id: slab.batchRecipeId }, select: { id: true } })
    : { id: null };
  return {
    sameIdExists: Boolean(sameId),
    numberTaken: Boolean(taken),
    shiftExists: Boolean(shift),
    setupExists: Boolean(setup),
  };
}

/**
 * Why a restore of this robo slab deletion would be refused right now — the
 * banner's wording — or null when it would go through (or the slab is already
 * back, which a press closes). Read-only and outside any transaction, so it is
 * a forecast: the restore decides again inside its own. A read that fails
 * gives null — "not known to be refused" — and the press answers for itself.
 */
async function slabRestoreRefusal(row: any): Promise<string | null> {
  const plan = planSlabRestore(row.payload);
  if (!plan.ok) return plan.message;
  const slabNumber = plan.slab.slabNumber.trim();
  try {
    const decision = decideSlabRestore(slabNumber, await readSlabRestoreState(prisma, plan.slab, slabNumber));
    return decision.action === "refuse" ? decision.notice : null;
  } catch {
    return null;
  }
}

/**
 * Put one deleted robo slab back, with its delay logs — or say plainly why not.
 *
 * Not the generic `delete` reversal, which swallows a failed insert and was
 * then marked undone and reported "Restored" regardless; and which never asked
 * whether the slab number had been keyed again since, so a restore could leave
 * two records on one number. The rules, and why, are in lib/robo/slabRestore.ts
 * (code review of 20 Oct 2026, ROBO-9). Here is only the database half, and it
 * is ONE transaction:
 *
 *   1. Claim the entry — undone=true only where it is still false. Two admins
 *      pressing Restore together (or one Restore, one "Keep it deleted"): the
 *      second waits on the first's row lock, then finds nothing left to claim.
 *   2. Read what decides it: the slab's own id, any OTHER record on its slab
 *      number, its shift, its batch setup.
 *   3. Refuse (throw — the claim rolls back, so the deletion stays on offer
 *      until it can go back or an admin closes it with "Keep it deleted"),
 *      or create the slab and the delay logs whose references still exist.
 *
 * Any error at all — the slab's insert included — rolls the whole thing back,
 * claim and all, and comes back as ok:false. Nothing is ever reported restored
 * that is not in the register.
 *
 * The slab-number check and the insert share the transaction but not a lock: a
 * slab keyed on the tablet in the same instant could still slip between them,
 * exactly as it could between POST's own check and insert. The column has no
 * unique constraint to lean on; this is the same guard every other write of a
 * slab number has.
 */
async function restoreRoboSlab(row: any): Promise<UndoResult> {
  const plan = planSlabRestore(row.payload);
  if (!plan.ok) return { ok: false, message: plan.message };
  const { slab, delayLogs } = plan;
  const slabNumber = slab.slabNumber.trim();
  try {
    const message: string = await prisma.$transaction(async (tx: any) => {
      const claimed = await tx.actionLog.updateMany({
        where: { id: row.id, undone: false },
        data: { undone: true, undoneAt: new Date() },
      });
      if (claimed.count === 0) throw new SlabRestoreRefused("This deletion has already been restored or closed.");

      const decision = decideSlabRestore(slabNumber, await readSlabRestoreState(tx, slab, slabNumber));
      // Already there: the claim stands (the deletion is closed, not re-offered)
      // and nothing else is written.
      if (decision.action === "alreadyBack") return decision.message;
      if (decision.action === "refuse") throw new SlabRestoreRefused(decision.message);

      await tx.roboProductionRecord.create({ data: revive(slab) });

      let restored = 0;
      let skipped = 0;
      if (delayLogs.length > 0) {
        const refs = delayLogRefs(delayLogs);
        const ids = async (delegate: any, list: string[]) =>
          new Set<string>(list.length ? (await delegate.findMany({ where: { id: { in: list } }, select: { id: true } })).map((r: any) => r.id) : []);
        const split = restorableDelayLogs(delayLogs, {
          existingIds: await ids(tx.roboDelayLog, refs.ids),
          delayCodeIds: await ids(tx.roboDelayCode, refs.delayCodeIds),
          machineIds: await ids(tx.roboMachine, refs.machineIds),
          shiftIds: await ids(tx.roboShift, refs.shiftIds),
        });
        if (split.restore.length > 0) {
          await tx.roboDelayLog.createMany({ data: split.restore.map((d) => revive(d)) });
        }
        restored = split.restore.length;
        skipped = split.skipped;
      }
      return slabRestoredMessage(slabNumber, restored, skipped);
    });
    return { ok: true, message };
  } catch (e) {
    if (e instanceof SlabRestoreRefused) return { ok: false, message: e.message };
    return { ok: false, message: `Not restored — nothing was changed, and the deletion is still here to restore: ${(e as Error).message}` };
  }
}
