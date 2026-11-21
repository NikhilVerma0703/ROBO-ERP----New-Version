// THE OPENING CHECK AND EDIT PARAMETERS: ONE SHIFT, ONE BATCH (the owner, 5 Nov 2026, about 12:10 IST, and his
// amendment of about 12:15 IST for Edit parameters). PURE: relative .ts imports only, so `node --test` loads it
// (tests/machineOverviewOpeningScope.test.ts) and the client form may import it.
//
// THE RULE, AS CONFIRMED
//  - An opening-check answer covers ONE SCOPE: one shift (06:00, 14:00 or 22:00 IST to the next of these) at one
//    machine, cut short by a BATCH CHANGE at that machine. Inside its scope it covers every slab, including the slabs
//    made before it was saved (it fills back to the start of the scope).
//  - A batch change in the shift asks again; the new answer covers the new batch's first slab at the machine to the end
//    of the shift (or the next batch change).
//  - Edit parameters asks "From which slab?": only the slabs of the CURRENT shift at that machine, or "the next slab";
//    the change applies from the chosen slab to the end of that slab's scope (the end of the shift or of that slab's
//    batch, whichever comes first). It never reaches into another shift or batch, and never fills back.
//  - Nothing carries into the next shift or batch: a scope nobody answered is blank (Fill missing parameters fills
//    it; the Press writes its default "1" and says so).
//  - The switch-over (plant_sync_state key `opening_scope`, value {from}): slabs at or after `from` take this rule;
//    slabs before it keep the run rule they were written with (opening-rules rowInForce; the Distributor's
//    distributor-map distributorOpeningAt), read over the rows that existed at the switch-over (legacyRowsFor), so
//    no row written before the switch-over ever changes.
//
// A plant time is naive IST ("yyyy-MM-ddTHH:mm:ss.fff"); setAt is an ISO instant (UTC).
import { naiveMs, naiveOf } from "./plant-clock.ts";
import { rowInForce, valueText, type OpeningRow } from "./opening-rules.ts";
import type { OpeningField } from "./machines.ts";

export const SHIFT_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;
const IST_MS = 330 * 60_000;
/** The reasons a row ANSWERS a check (moved here from match/distributor-map.ts, which re-exports it unchanged). */
export const ANSWER_REASONS: readonly string[] = ["shift_start", "line_order"];
/** plant_sync_state key holding the switch-over. */
export const OPENING_SCOPE_KEY = "opening_scope";
/** The switch-over starts at the first shift start at least this long after it is stored (the owner's default, 5 Nov). */
export const OPENING_SCOPE_LEAD_MIN = 15;

const isAnswer = (r: Pick<OpeningRow, "reason">): boolean => ANSWER_REASONS.includes(r.reason);
const setMs = (r: Pick<OpeningRow, "setAt">): number => {
  const t = Date.parse(r.setAt);
  return Number.isFinite(t) ? t : 0;
};
const hhmm = (t: string): string => t.slice(11, 16);
/** "05/11 22:00" of a plant time. */
export const dayClock = (t: string): string => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;

/* ------------------------------------------------------------------ shifts */

/**
 * The start of the shift that holds plant time t, as a plant time: 06:00, 14:00 or 22:00 (a time before 06:00
 * belongs to the 22:00 shift of the day before), the ERP's shifts (lib/dashboard/time.ts shiftAt). Moved here from
 * distributor-map.ts (re-exported there unchanged).
 */
export function shiftStartOf(t: string): string | null {
  const ms = naiveMs(t);
  if (ms === null) return null;
  const day = naiveOf(ms).slice(0, 10);
  const h = Number(naiveOf(ms).slice(11, 13));
  if (h >= 22) return `${day}T22:00:00.000`;
  if (h >= 14) return `${day}T14:00:00.000`;
  if (h >= 6) return `${day}T06:00:00.000`;
  return naiveOf(Date.parse(`${day}T22:00:00.000Z`) - 86_400_000);
}

/** shiftStartOf(t) + 8 h: the start of the next shift. */
export function shiftEndOf(t: string): string | null {
  const s = shiftStartOf(t);
  return s === null ? null : naiveOf((naiveMs(s) as number) + SHIFT_MS);
}

/** Is t exactly a shift start (06:00, 14:00 or 22:00, to the millisecond)? */
export function isShiftStart(t: unknown): boolean {
  const ms = naiveMs(t);
  return ms !== null && shiftStartOf(naiveOf(ms)) === naiveOf(ms);
}

/** The first shift start at or after t. */
export function shiftStartAtOrAfter(t: string): string | null {
  const ms = naiveMs(t);
  if (ms === null) return null;
  const s = shiftStartOf(naiveOf(ms)) as string;
  return naiveMs(s) === ms ? s : naiveOf((naiveMs(s) as number) + SHIFT_MS);
}

/**
 * THE SWITCH-OVER, chosen once: the first shift start at least OPENING_SCOPE_LEAD_MIN minutes after `nowN` (stored at
 * 21:40 or 21:45: 22:00; at 21:46: 06:00). Never mid-shift, so no scope straddles it.
 */
export function openingScopeStartFor(nowN: string): string | null {
  const ms = naiveMs(nowN);
  return ms === null ? null : shiftStartAtOrAfter(naiveOf(ms + OPENING_SCOPE_LEAD_MIN * 60_000));
}

/** The stored switch-over, read: `from` only when it is a plant time AND a shift start (critique 15); anything else is null, today's rule. */
export function parseOpeningScope(value: unknown): { from: string; setAt: string | null; by: string | null } | null {
  let v = value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ms = naiveMs(o.from);
  if (ms === null || !isShiftStart(o.from)) return null;
  return { from: naiveOf(ms), setAt: typeof o.setAt === "string" ? o.setAt : null, by: typeof o.by === "string" ? o.by : null };
}

/** The value stored for the switch-over. */
export function openingScopeValue(from: string, by: string, now: Date): { from: string; setAt: string; by: string } {
  return { from, setAt: now.toISOString(), by };
}

/**
 * SQL text: the shift start (a `timestamp`, IST digits) of the plant time `x` (a `timestamp` expression), the same
 * arithmetic as sessions-rules shiftEndIstSql (the day cut at 06:00, then 8 hours a shift). Fixed text, no value.
 * tests/machineOverviewOpeningScopeDb.test.ts holds it to shiftStartOf on a spread of times.
 */
export function shiftStartSql(x: string): string {
  return `(date_trunc('day', (${x}) - interval '6 hours') + interval '6 hours' + interval '8 hours' * floor(extract(hour FROM (${x}) - interval '6 hours') / 8))`;
}

/* ------------------------------------------------------------- batches */

/**
 * A run's batch as the scope reads it: "b:<batch key>" when the run's batch is known (sync_line_order_batch state
 * 'resolved' with a key, the same "known" the matcher writes rows with); otherwise "run:<line order>". A run whose
 * batch is not known yet (pending, split, no row) counts as a batch of its own until it is known.
 */
export type BatchId = string;
export function batchIdOf(lineOrder: number, run: { state: string; batchKey: string | null } | null | undefined): BatchId {
  return run && run.state === "resolved" && run.batchKey ? `b:${run.batchKey}` : `run:${lineOrder}`;
}

/** One slab at the machine as the scope reads it: the time its opening values are read at, and its run. */
export interface ScopeSlab { at: string; lineOrder: number | null }

/**
 * How far back a batch change is judged: a slab is compared with the machine's previous slab with a run only when that
 * slab is at most this long before it. The scope index reads back exactly this far before its window
 * (opening-scope-server scopeIndexFor, `interval '24 hours'`), so the answer is the same whatever window a reader
 * starts at (critique of the build, rule-3, 5 Nov 2026: after an idle gap of more than a day the matcher, whose window
 * starts at its oldest candidate's shift, saw a batch change the screens, whose window starts at the current shift, did
 * not; the rows were blank while History, the check and the fill page said nothing was missing).
 */
export const BATCH_LOOKBACK_MS = 24 * HOUR_MS;

/**
 * THE BATCH CHANGES AT ONE MACHINE. The machine's slabs in time order; a slab with no run number is passed over (it
 * neither starts nor ends a batch). A slab is a batch change when the previous slab WITH A RUN at the machine (any
 * shift before: critique 2, the caller reads the last one before the shifts it asks about) has another BatchId AND is
 * at most BATCH_LOOKBACK_MS before it (after a longer gap there is nothing to compare with: the shift start is the
 * boundary). The first slab with a run in the list is never one (nothing to compare it with). Sorted times, no
 * repeats. A shift start is always a scope boundary and is not listed.
 */
export function batchChanges(slabs: readonly ScopeSlab[], idOf: (lineOrder: number) => BatchId): string[] {
  const list = slabs
    .map((s) => ({ ms: naiveMs(s.at), lineOrder: s.lineOrder }))
    .filter((s): s is { ms: number; lineOrder: number } => s.ms !== null && s.lineOrder !== null)
    .sort((a, b) => a.ms - b.ms || a.lineOrder - b.lineOrder);
  const out: number[] = [];
  let prev: { id: BatchId; ms: number } | null = null;
  for (const s of list) {
    const id = idOf(s.lineOrder);
    if (prev !== null && id !== prev.id && s.ms - prev.ms <= BATCH_LOOKBACK_MS && out[out.length - 1] !== s.ms) out.push(s.ms);
    prev = { id, ms: s.ms };
  }
  return out.map(naiveOf);
}

/* ------------------------------------------------------------- scopes */

export interface ScopeIndex {
  /** The switch-over: slabs at or after it take the scoped rule. null: never (today's rule everywhere). */
  from: string | null;
  /** batchChanges' answer over every shift the reader asks about. */
  changes: readonly string[];
}
export const NO_SCOPE: ScopeIndex = { from: null, changes: [] };

/** Does plant time t take the scoped rule? */
export function scoped(ix: ScopeIndex, t: string): boolean {
  if (ix.from === null) return false;
  const a = naiveMs(t);
  const f = naiveMs(ix.from);
  return a !== null && f !== null && a >= f;
}

export interface Scope { start: string; end: string; why: "shift_start" | "batch_change" }

/** The scope that holds t: from the later of its shift start and the last batch change at or before t, to the earlier of its shift end and the first batch change after t. */
export function scopeAt(ix: ScopeIndex, t: string): Scope | null {
  const tm = naiveMs(t);
  const s0 = shiftStartOf(t);
  if (tm === null || s0 === null) return null;
  let start = naiveMs(s0) as number;
  let end = start + SHIFT_MS;
  let why: Scope["why"] = "shift_start";
  for (const c of ix.changes) {
    const cm = naiveMs(c);
    if (cm === null) continue;
    if (cm <= tm && cm > start) { start = cm; why = "batch_change"; }
    else if (cm > tm && cm < end) end = cm;
  }
  return { start: naiveOf(start), end: naiveOf(end), why };
}

/**
 * Where a scope index read for slabs up to plant time `lastT` must reach: the end of lastT's shift (a batch change
 * after lastT in that shift ends lastT's scope), but never more than an hour past `nowN`, and always past lastT itself.
 * The matcher reads its own index this far (critique 4); the Distributor's held check and the opening check's prefill
 * read the same (critique of the build, rule-1, 5 Nov 2026: stopping a minute after the last held slab, or an hour after
 * the check's time, they missed a later batch change in the shift, so an unanswered earlier scope took the later
 * batch's answer, was never asked, and its slabs stayed held).
 */
export function scopeIndexTo(lastT: string, nowN: string): string {
  const last = naiveMs(lastT) as number;
  const end = naiveMs(shiftEndOf(lastT) as string) as number;
  const soon = (naiveMs(nowN) as number) + HOUR_MS;
  return naiveOf(end < soon ? end : soon > last ? soon : last + 60_000);
}

/**
 * Is `sc` the scope that holds at plant time `nowN` (it began at or before now and ends after it)? The opening check
 * asks only that scope (opening-server scopedOpeningDue; the Distributor's held slabs aside, heldDistributorCheck): a
 * scope nobody answered that is not it is never asked again, and its slabs are filled with Fill missing parameters or
 * corrected in Tables. ONE test for the run notes' words (scopeSuffix), Edit parameters' refusal (scopeUnansweredText)
 * and the fill page's openScope (critique of the build, rule-6 and screens-2, 5 Nov 2026).
 */
export function scopeHoldsNow(sc: Pick<Scope, "start" | "end">, nowN: string): boolean {
  const n = naiveMs(nowN);
  const a = naiveMs(sc.start);
  const b = naiveMs(sc.end);
  return n !== null && a !== null && b !== null && a <= n && n < b;
}

/** Are plant times a and b in the same scope? */
export function sameScope(ix: ScopeIndex, a: string, b: string): boolean {
  const x = scopeAt(ix, a);
  const y = scopeAt(ix, b);
  return x !== null && y !== null && x.start === y.start;
}

/** The rows dated inside a scope, [start, end). */
export function rowsInScope(rows: readonly OpeningRow[], sc: Scope): OpeningRow[] {
  const s = naiveMs(sc.start) as number;
  const e = naiveMs(sc.end) as number;
  return rows.filter((r) => {
    const f = naiveMs(r.appliesFrom);
    return f !== null && f >= s && f < e;
  });
}

/**
 * THE ROW IN FORCE FOR `field` AT SLAB TIME t, SCOPED RULE. Only rows dated inside t's scope count, and an Edit
 * parameters row (reason button) only when it was set after the scope's first answer (critique 13: an edit can never
 * be in force in a scope nobody answered, so one stranded by ingest latency or a split never carries one batch's value
 * onto another).
 *  1. The row with the greatest applies_from at or before t (ties: the one set last): the scope's answer, or an Edit
 *     parameters change from its chosen slab on.
 *  2. When NO answer of the scope (any field) is at or before t, the scope's EARLIEST answer (that save's row for the
 *     field): the check fills back to the start of the scope, including a scope that grew because a run's batch
 *     became known and was the same batch (critique 19a: per scope, so two answers are never mixed).
 *  3. An Edit parameters row never fills back.
 *  4. Otherwise null: blank. Never the previous shift's value, never the previous batch's.
 */
export function scopedRowAt(rows: readonly OpeningRow[], field: string, t: string, ix: ScopeIndex): OpeningRow | null {
  const sc = scopeAt(ix, t);
  const tm = naiveMs(t);
  if (sc === null || tm === null) return null;
  const inSc = rowsInScope(rows, sc);
  const answers = inSc.filter(isAnswer);
  if (!answers.length) return null;
  const firstSet = Math.min(...answers.map(setMs));
  const counted = inSc.filter((r) => r.field === field && (isAnswer(r) || (r.reason === "button" && setMs(r) > firstSet)));
  const r = rowInForce(counted, field, t);
  if (r !== null) return r;
  if (answers.some((a) => (naiveMs(a.appliesFrom) as number) <= tm)) return null;
  const earliest = Math.min(...answers.map((a) => naiveMs(a.appliesFrom) as number));
  let best: OpeningRow | null = null;
  for (const a of answers) {
    if (a.field !== field || naiveMs(a.appliesFrom) !== earliest) continue;
    if (best === null || setMs(a) > setMs(best)) best = a;
  }
  return best;
}

/** Has t's scope been answered (any answer row, any field, dated in the scope)? `from` is the earliest answer's applies_from. */
export function scopeAnswered(rows: readonly OpeningRow[], t: string, ix: ScopeIndex): { answered: boolean; from: string | null } {
  const sc = scopeAt(ix, t);
  if (sc === null) return { answered: false, from: null };
  let from: number | null = null;
  for (const r of rowsInScope(rows, sc)) {
    if (!isAnswer(r)) continue;
    const f = naiveMs(r.appliesFrom) as number;
    if (from === null || f < from) from = f;
  }
  return { answered: from !== null, from: from === null ? null : naiveOf(from) };
}

/* ------------------------------------------- slabs before the switch-over */

/**
 * The rows today's rule may read for a slab BEFORE the switch-over (critique 9 and 10): those dated before `from`
 * and saved before the switch-over instant, i.e. exactly the rows there were when the rule changed. A row written
 * under the new rule never reaches an old slab. One exception, the Distributor's (`ownRun`): a held run's OWN answers
 * (its line order, reason shift_start or line_order), whenever saved and whatever their date, still release its held
 * slabs as today (a run held from before the switch-over answered from Live Status; the switch-over shift's start
 * check saved with that run's line order): those slabs have no row yet, so nothing written changes. With `from` null
 * every row is read (today's rule everywhere).
 */
export function legacyRowsFor(rows: readonly OpeningRow[], ix: ScopeIndex, own?: { lineOrder: number | null } | null): OpeningRow[] {
  if (ix.from === null) return [...rows];
  const fromMs = naiveMs(ix.from) as number;
  const instant = fromMs - IST_MS;
  const lo = own?.lineOrder ?? null;
  return rows.filter((r) => {
    const f = naiveMs(r.appliesFrom);
    if (f !== null && f < fromMs && setMs(r) < instant) return true;
    return lo !== null && r.lineOrder === lo && isAnswer(r);
  });
}

/* --------------------------------------------------- one dispatch, any slab */

/**
 * The row in force for `field` at t, the Oven's, the Kreos's and the Press's rule: scoped at or after the
 * switch-over, today's rowInForce over legacyRowsFor before it. (The Distributor's run-aware rule and every slab's
 * fill are laid on in fill-rules slabOpening, the one reader; this is its core for the other machines.)
 */
export function openingRowFor(rows: readonly OpeningRow[], field: string, t: string, ix: ScopeIndex): OpeningRow | null {
  return scoped(ix, t) ? scopedRowAt(rows, field, t, ix) : rowInForce(legacyRowsFor(rows, ix), field, t);
}

/** openingRowFor's value; undefined when none. */
export function openingValueFor(rows: readonly OpeningRow[], field: string, t: string, ix: ScopeIndex): unknown {
  const r = openingRowFor(rows, field, t, ix);
  return r === null ? undefined : r.value;
}

/** valuesInForce's twin through the dispatch: each field's row in force at t, with who set it and when; null when none. */
export function valuesFor(
  rows: readonly OpeningRow[], fields: readonly Pick<OpeningField, "field">[], t: string, ix: ScopeIndex,
): Record<string, { value: unknown; by: string | null; setAt: string } | null> {
  const out: Record<string, { value: unknown; by: string | null; setAt: string } | null> = {};
  for (const f of fields) {
    const r = openingRowFor(rows, f.field, t, ix);
    out[f.field] = r === null ? null : { value: r.value, by: r.setByName, setAt: r.setAt };
  }
  return out;
}

/** The row a field last had before a scope began, whatever its scope: the check's SUGGESTION only, never in force. */
export function lastRowBefore(rows: readonly OpeningRow[], field: string, scopeStart: string): OpeningRow | null {
  const s = naiveMs(scopeStart);
  if (s === null) return null;
  return rowInForce(rows.filter((r) => (naiveMs(r.appliesFrom) ?? Infinity) < s), field, naiveOf(s - 1));
}

/* -------------------------------------------------------- edit parameters */

/** Is the slab's time in the shift running at `nowN` (from its start, up to now)? Edit parameters lists only these slabs. */
export function inCurrentShift(at: string | null | undefined, nowN: string): boolean {
  const a = at ? naiveMs(at) : null;
  const n = naiveMs(nowN);
  const s = shiftStartOf(nowN);
  if (a === null || n === null || s === null) return false;
  return a >= (naiveMs(s) as number) && a <= n;
}

/** The refusal of a slab from another shift (the owner's amendment: only the current shift's slabs). */
export function notThisShiftText(machineLabel: string, nowN: string): string {
  const s = shiftStartOf(nowN);
  return `That slab is from an earlier shift. Edit parameters changes values from a slab of this shift (since ${s ? hhmm(s) : "its start"}) or from the next slab; a slab of an earlier shift is filled with Fill missing parameters or corrected in Tables. Nothing was saved for the ${machineLabel}.`;
}

/** Where an Edit parameters change from `appliesFrom` stops under the scoped rule: the end of that slab's scope (its shift end, or a batch change). */
export function editUntil(ix: ScopeIndex, appliesFrom: string): string | null {
  return scopeAt(ix, appliesFrom)?.end ?? null;
}

/**
 * The refusal while the chosen slab's scope has no answer and is the one the machine asks now (decision 8, critique
 * 12): names that scope. The last sentence (critique of the build, screens-3, 5 Nov 2026): a check put off with "Later"
 * stays hidden across the page's own refresh, so the operator is told how to bring it back.
 */
export function checkFirstText(machineLabel: string, sc: Scope): string {
  return `Answer the ${machineLabel}'s opening check first: it sets the values for this shift and batch from ${hhmm(sc.start)}. Edit parameters changes them from a slab after that. If the check was put off with Later, reload the page to answer it.`;
}

/**
 * EDIT PARAMETERS' REFUSAL FOR A SLAB WHOSE SCOPE HAS NO ANSWER (critique of the build, rule-6, 5 Nov 2026). The scope
 * that holds now is asked on the machine screen: checkFirstText. An earlier scope of the shift is not asked again
 * (scopeHoldsNow), so "answer the check first" led nowhere: its slabs are filled with Fill missing parameters (the
 * Press: its rows have the default phase, corrected in Tables). The Distributor's held slabs are the exception: the
 * held check asks them (heldDistributorCheck), on this screen or by the incharge from Live Status.
 */
export function scopeUnansweredText(machine: string, machineLabel: string, sc: Scope, nowN: string): string {
  if (scopeHoldsNow(sc, nowN)) return checkFirstText(machineLabel, sc);
  const head = `Nobody answered the ${machineLabel}'s opening check for the shift and batch from ${dayClock(sc.start)}`;
  const tail = "Edit parameters changes values only in a shift and batch whose opening check was answered. Nothing was saved.";
  if (machine === "DISTRIBUTOR") {
    return `${head}. Its held slabs wait for that answer (this screen asks it, or the incharge answers it from Live Status); rows already written are filled with Fill missing parameters or corrected in Tables. ${tail}`;
  }
  if (machine === "PRESS") return `${head}, and it is no longer asked: its press rows have the default pinhole cycle phase; correct them in Tables. ${tail}`;
  return `${head}, and it is no longer asked: an incharge fills its slabs with Fill missing parameters, or corrects them in Tables. ${tail}`;
}

/** The verb of "a slab ___" at each machine. */
function verbAt(machine: string): string {
  switch (machine) {
    case "PRESS": return "pressed";
    case "OVEN": return "put into the oven";
    case "DISTRIBUTOR": return "put on the distributor";
    case "KREOS": return "put on the Kreos";
    default: return "at the machine";
  }
}

/**
 * The confirm step's sentence about how far a change reaches (replaces opening-change-rules reachText for the panel).
 * `untilAt` is the end of the chosen slab's scope under the scoped rule, null under today's rule. Counts are the
 * machine's rows from the chosen slab to there that the plant wrote (corrected) and that a person typed (only
 * flagged), live; shadow compares only; off records.
 */
export function editReachText(o: {
  machine: string; mode: "off" | "shadow" | "live"; untilAt: string | null; plantRows?: number; typedRows?: number; waitingRows?: number;
}): string {
  const s = (n: number) => `${n} slab${n === 1 ? "" : "s"}`;
  const verb = verbAt(o.machine);
  const oven = o.machine === "OVEN";
  // The end is the shift's end, or a batch change that comes first (critique of the build, rule-5, 5 Nov 2026: a batch
  // change at 16:00 was called "the end of this shift at 16:00").
  const reach = o.untilAt === null
    ? "until the next opening check or change"
    : isShiftStart(o.untilAt)
      ? `until the end of this shift at ${hhmm(o.untilAt)}, or until the batch changes if that comes first`
      : `until the batch changes at ${hhmm(o.untilAt)} (before the end of this shift)`;
  if (o.mode === "off") return "This is recorded for the machine. Its form is not filled from the plant yet, so no slab changes now.";
  if (o.mode === "shadow") {
    return `This machine is only being compared with the plant now, so nothing in its form changes. From the chosen slab ${reach}, ${s(o.typedRows ?? 0)} typed by a person will be flagged where they differ.${oven ? " A slab takes the value that was in force when it went into the oven." : ""}`;
  }
  const waiting = oven ? Math.max(0, Math.floor(o.waitingRows ?? 0)) : 0;
  const base = `From the chosen slab ${reach}: ${s(o.plantRows ?? 0)} the plant wrote will be corrected; ${s(o.typedRows ?? 0)} typed by a person will only be flagged. Slabs ${verb} before it keep their values.`;
  if (!oven) return base;
  return `${base} A slab takes the value that was in force when it went into the oven.${waiting > 0 ? ` ${s(waiting)} still in the oven will take the new value when ${waiting === 1 ? "it comes" : "they come"} out.` : ""}`;
}

/* ---------------------------------------------------------------- words */

/**
 * THE WORDS A SCOPED RUN NOTE ADDS (the blank kinds: no_set_cooking_time, gev_rpm_missing, opening_missing): the
 * scope its blank belongs to and who fills it after. A suffix to today's words, so match-rules SETTLED_WORDS settles
 * it to nothing (SCOPE_SUFFIX_PATTERN): a note a person marked done is not raised again only because its run's first
 * slab now falls under the shift-and-batch rule.
 */
export function scopeSuffix(scopeStart: string, asked = true): string {
  // `asked` (critique of the build, screens-2, 5 Nov 2026): false when the scope is not the one that holds now
  // (scopeHoldsNow). That check is never asked again, so "when it is answered while that shift runs" led nowhere.
  if (!asked) return `; under the shift-and-batch rule the opening check of the shift and batch from ${dayClock(scopeStart)} is no longer asked: that shift or batch has ended, so an incharge fills these slabs with Fill missing parameters, or corrects them in Tables`;
  return `; under the shift-and-batch rule the opening check of the shift and batch from ${dayClock(scopeStart)} fills these slabs when it is answered while that shift runs; after that an incharge fills them with Fill missing parameters`;
}
/** scopeSuffix as a pattern both Postgres and JavaScript read the same way (no character with a meaning in either but the digit classes). */
export const SCOPE_SUFFIX_PATTERN =
  "; under the shift-and-batch rule the opening check of the shift and batch from [0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2} fills these slabs when it is answered while that shift runs; after that an incharge fills them with Fill missing parameters";
/** scopeSuffix(…, false) as such a pattern: it settles to nothing as well, so a note marked done stays done when its scope ends. */
export const SCOPE_ENDED_SUFFIX_PATTERN =
  "; under the shift-and-batch rule the opening check of the shift and batch from [0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2} is no longer asked: that shift or batch has ended, so an incharge fills these slabs with Fill missing parameters, or corrects them in Tables";
/** The marker a scoped note carries (runNoteDetail adds no earlier-day suffix to it: the scope suffix already says where it is filled). */
export const SCOPE_MARK = "under the shift-and-batch rule";

/**
 * The Press's pinhole phase in a scope nobody answered: the default is written, and said (decision 3). The words carry
 * SCOPE_MARK (critique of the build, matcher-4, 5 Nov 2026), so runNoteDetail adds no earlier-day "use Fill missing
 * parameters" to them: the Press has nothing to fill.
 */
export function pressDefaultWords(scopeStart: string, value: string): string {
  return `Press, no pinhole cycle phase was answered on the Press's opening check for the shift and batch from ${dayClock(scopeStart)}, so ${SCOPE_MARK} the press rows have the default ${value}; answer the Press's opening check while that shift and batch run, or correct the rows in Tables`;
}

/* ------------------------------------------------------ the opening check */

/** "dd/mm hh:mm" in IST of an ISO instant, or "". */
function istDayClock(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? dayClock(naiveOf(ms + IST_MS)) : "";
}

/**
 * THE OPENING CHECK'S OWN WORDS under the shift-and-batch rule (design 4.3; critique of the build, screens-1, 5 Nov
 * 2026). "This shift" only for the shift that runs now: a held check of an earlier shift (the Distributor's, which the
 * incharge answers from Live Status) names its day and says it is an earlier shift's, held for an answer.
 */
export function openingCheckText(o: {
  machineLabel: string; why: "shift_start" | "line_order"; appliesFrom: string; lineOrder: number | null;
  heldEarlier?: boolean; nowN: string; batch?: string | null;
}): string {
  const label = o.machineLabel;
  const at = hhmm(o.appliesFrom);
  const earlier = o.heldEarlier === true || shiftStartOf(o.appliesFrom) !== shiftStartOf(o.nowN);
  const held = ` This is a check of an earlier shift (${dayClock(o.appliesFrom)}), held for an answer: give the settings that ran then.`;
  if (o.why === "shift_start") {
    return earlier
      ? `Start of an earlier shift on the ${label} (${dayClock(o.appliesFrom)}). Check the settings that ran then. They apply to that shift from ${at}, including its slabs already made, until it ended or the batch changed.${held}`
      : `Start of the shift. Check the ${label}'s settings. They apply to this shift from ${at}, including slabs already made, until the shift ends or the batch changes.`;
  }
  const head = o.batch
    ? `The batch changed on the ${label} (run ${o.lineOrder ?? "?"}, batch ${o.batch}).`
    : `A new run${o.lineOrder !== null ? ` (${o.lineOrder})` : ""} is on the ${label} and its batch is not known yet.`;
  return `${head} Check its settings. They apply from ${at} until the shift ends or the batch changes.${earlier ? held : ""}`;
}

/** The line shown to an operator instead of a held check of an earlier shift (decision 7: only the incharge answers it). */
export function heldEarlierText(machineLabel: string, appliesFrom: string): string {
  return `The ${machineLabel}'s opening check of an earlier shift (${dayClock(appliesFrom)}) is waiting for an answer; the incharge answers it from Live Status.`;
}

/**
 * THE SAVE'S REFUSAL of a held check of an earlier shift by someone below incharge (decision 7; critique of the build,
 * screens-1 / matcher-5, 5 Nov 2026): the operator of the shift running now may not know what ran then, so his guess is
 * never written onto that shift's slabs. Null when the check is not of an earlier shift, or the person is an incharge.
 */
export function heldEarlierRefusal(due: { heldEarlier?: boolean; appliesFrom: string }, machineLabel: string, inchargeOrAbove: boolean): string | null {
  if (due.heldEarlier !== true || inchargeOrAbove) return null;
  return `${heldEarlierText(machineLabel, due.appliesFrom)} Nothing was saved.`;
}

/**
 * The line under a question of a scoped check that starts from the field's last value before the scope (decision 4,
 * "same as before: check and save"; critique of the build, screens-4 and screens-1, 5 Nov 2026). Null when a value is in
 * force (it says who set it) or there is no earlier value. A text field the plant's deploy fills (ParamField
 * initialValue puts plantSuggestion first) does not show that value, so the line says it is the value from before, not
 * the field's. A held check of an earlier shift says plainly the value is from before that shift.
 */
export function lastSetLine(
  p: { kind: string; by: string | null; plantSuggestion?: string | null; lastSet?: { value: unknown; by: string | null; setAt: string } | null },
  o: { earlier?: boolean } = {},
): string | null {
  if (p.by || !p.lastSet) return null;
  const when = istDayClock(p.lastSet.setAt);
  const who = `${p.lastSet.by ?? "someone"}${when ? `, ${when}` : ""}`;
  const v = valueText(p.lastSet.value);
  const which = o.earlier ? "that" : "this";
  if (typeof p.plantSuggestion === "string" && p.plantSuggestion.trim() && p.kind !== "multi") {
    return `Before ${which} shift and batch: ${v} (${who}). The field shows the plant's deploy, not this value.`;
  }
  if (o.earlier) return `Filled in from before that shift and batch: ${v} (${who}); it may not be what ran then. Check it and save.`;
  return `Same as before: ${v} (${who}). Check it and save.`;
}
