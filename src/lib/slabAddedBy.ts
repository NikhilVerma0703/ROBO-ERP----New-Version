// Placeholder slab rows: the ones a person ADDED to fill a gap, not an operator's
// entry. Two paths make them — a range confirm (lib/batchRange autoFillBatch) and
// "Add all missing" on the batch's station list (app/batch/slabs addAllMissing) —
// and both leave the operator blank, because nobody knows who ran that slab.
//
// Import-free on purpose: node --test loads it directly, and the batch pages, the
// rectify actions and batchRange all share the one marker.

/** Every placeholder's remark starts with this. The smart-entry create completes a
 * row carrying it instead of refusing a duplicate, and the date, thickness and
 * batch-window readers skip it as a source. */
export const AUTOFILL_PREFIX = "⚙ auto-added";
/** The range confirm's remark (lib/batchRange autoFillBatch). */
export const AUTOFILL_REMARK = "⚙ auto-added by range rectify — parameters missing";

const ADD_ALL = "with Add all missing";

/** The remark "Add all missing" writes, naming who pressed it. Starts with
 * AUTOFILL_PREFIX so the row is treated as a placeholder everywhere one is. */
export function addAllMissingRemark(who: string, avgKg: number | null): string {
  const name = who.trim() || "someone";
  const weight = avgKg != null ? ` — weight is the batch average (${avgKg} kg)` : "";
  return `${AUTOFILL_PREFIX} by ${name} ${ADD_ALL}${weight}; parameters missing`;
}

/** Who added a placeholder, from its remark alone; null when the remark does not say. */
export function addedByFromRemark(remarks: unknown): string | null {
  const s = typeof remarks === "string" ? remarks : "";
  if (!s.startsWith(`${AUTOFILL_PREFIX} by `) || s === AUTOFILL_REMARK) return null;
  const i = s.indexOf(` ${ADD_ALL}`);
  return i > AUTOFILL_PREFIX.length + 4 ? s.slice(AUTOFILL_PREFIX.length + 4, i) : null;
}

/** The summary "Add all missing" logs (app/batch/slabs addAllMissing). */
const ADD_ALL_SUMMARY = /^Added \d+ missing \w+ slab/;

/**
 * Which of an action_log "create" entry's rows its Undo may still delete, as a
 * Prisma where-fragment to AND with the logged ids; null = all of them.
 *
 * "Add all missing" writes PLACEHOLDERS, and a real entry for one of those slabs
 * completes the placeholder in place (tables/actions createRow) — same row id,
 * now the operator's or the inspector's real entry. Undoing the Add all missing
 * must take back only rows that are still placeholders, never the real ones
 * (code review of 27 Oct 2026, E2E-17 follow-up: a completed Polish QC row, its
 * grade, and the finished-goods stock row it made were deleted by that Undo).
 *
 * New entries carry `placeholders: true`. Older ones are known by their summary;
 * those logged before 30 Sep 2026 made rows with NO remark at all, which the
 * entry form never completes (it completes only a marked row, and sets who
 * entered it), so an unmarked row nobody has entered still goes back too.
 * The per-slab "Add & verify" logs a real, verified row: no flag, not matched.
 */
export function placeholderUndoWhere(payload: unknown, summary: unknown): Record<string, unknown> | null {
  const marked = { remarks: { startsWith: AUTOFILL_PREFIX } };
  if ((payload as { placeholders?: unknown } | null)?.placeholders === true) return marked;
  if (typeof summary === "string" && ADD_ALL_SUMMARY.test(summary)) {
    return { OR: [marked, { remarks: null, enteredById: null }] };
  }
  return null;
}

/** An action_log "create" entry for this batch: who, and which rows it made. */
export interface CreatedBy { actor: string; ids: string[]; addAll: boolean }

/** The row ids an action_log payload names ({ model, ids }); [] for anything else. */
export function idsOfPayload(payload: unknown): string[] {
  const ids = (payload as { ids?: unknown } | null)?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** What a slab list shows in place of a blank operator: who added the row, or that
 * a range confirm did. null for a real row, or one with an operator. `logged` is the
 * action_log entry that created the row, when there is one — the only record for
 * rows "Add all missing" made before it began writing its remark. */
export function addedByNote(row: { operator?: unknown; remarks?: unknown }, logged?: { actor: string; addAll: boolean } | null): string | null {
  if (row.operator != null && String(row.operator).trim() !== "") return null;
  const how = (addAll: boolean) => (addAll ? " (Add all missing)" : "");
  if (logged) return `added by ${logged.actor}${how(logged.addAll)}`;
  const who = addedByFromRemark(row.remarks);
  if (who) return `added by ${who}${how(true)}`;
  if (typeof row.remarks === "string" && row.remarks.startsWith(AUTOFILL_PREFIX)) return "auto-added (range confirm)";
  return null;
}
