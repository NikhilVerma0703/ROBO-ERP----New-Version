"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/rbac";
import { dismissRoboSlabDelete, restoreRoboSlabDelete } from "@/lib/actionLog";

/**
 * Restore the most recently deleted robo slab, with its delay logs.
 *
 * ADMIN ONLY, and deliberately narrower than the delete itself. The tablet may
 * remove the slab it just mis-keyed — that is the mistake worth fixing in
 * seconds — but deciding that a deletion was wrong and putting the row back is
 * a supervisory act, and an undo the operator can also press is just a second
 * button to mis-tap.
 *
 * This is the half of the decision that makes the widened delete safe: the
 * handler writes its reversal payload into action_log inside the same
 * transaction, and until this existed nothing could read it back — the rows
 * were recoverable in principle and unreachable in practice.
 *
 * What comes back is the truth (code review of 20 Oct 2026, ROBO-9). The
 * restore used to report "Restored" even when the slab's insert had failed, and
 * would put the old record back on a slab number the tablet had since keyed
 * again — two records on one number. A slab now goes through actionLog's
 * restoreRoboSlab: one transaction, refused while another record holds the
 * number, ok:false with the deletion still on offer whenever the slab is not
 * back. So `r.ok` here means the slab is in the register.
 *
 * It restores the deletion the banner SHOWED, by its action_log id — not
 * whatever is newest when the button is pressed, which is a different slab if
 * the tablet deleted another one in between.
 */
export async function restoreDeletedRoboSlab(entryId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) {
    return { ok: false, message: "Only an administrator can restore a deleted slab." };
  }
  if (typeof entryId !== "string" || !entryId) return { ok: false, message: "No deletion was named." };
  const r = await restoreRoboSlabDelete(entryId);
  if (r.ok) {
    revalidatePath("/robo/slabs");
    revalidatePath("/robo");
  }
  return r;
}

/**
 * "Keep it deleted": close the deletion the banner showed, without restoring it.
 *
 * The way out a refused restore never had (a later review of ROBO-9, code
 * review of 20 Oct 2026). Once the slab number was keyed again correctly, or
 * the slab's shift or setup was gone, every "Restore it" was refused and rolled
 * back, so the banner offered the same deletion for good and every older one
 * sat behind it. Admin only, like the restore: closing an entry gives up the
 * page's offer to put the slab back (its saved copy stays in action_log).
 * Nothing in the register changes, so only this page needs refreshing.
 */
export async function keepRoboSlabDeleted(entryId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) {
    return { ok: false, message: "Only an administrator can close a slab deletion." };
  }
  if (typeof entryId !== "string" || !entryId) return { ok: false, message: "No deletion was named." };
  const r = await dismissRoboSlabDelete(entryId);
  if (r.ok) revalidatePath("/robo/slabs");
  return r;
}
