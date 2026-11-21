// THE MATCHER'S RULES: how a plant row becomes (or does not become) a row in
// a machine's form (docs/plant/MACHINE-OVERVIEW-ROUND1-SPEC.md sections 0 and 2).
// Pure: lib/plantSync/match/match-server.ts reads the database, asks these
// rules, and writes what they answer. Per machine mapping lives beside this
// file (press-map.ts); the batch rules in batch-rules.ts.
//
// THE THREE PROMISES THESE RULES KEEP (spec 0.2-0.4):
//   1. a row a person typed is never changed: its plant values are kept beside
//      it, and the differences go to the incharge as ONE flag;
//   2. never a row for a slab pressed before the machine's cut-over time, never
//      a second row for a slab, never again a row a person deleted;
//   3. on a row the plant wrote, a field is updated only while it still holds
//      what the matcher last wrote there: a field a person changed stays as
//      the person left it, and the difference is flagged.
//
// TWO CLOCKS (field-map brief 0.3). The plant writes naive IST: the wall clock
// in India with no zone. Here a plant time is ALWAYS a string
// "yyyy-MM-ddTHH:mm:ss.fff", and arithmetic on it treats its digits as if
// they were UTC (naiveMs), so no time zone of the server can move it. It is
// stored unchanged in the "naive IST" columns (press.date). created_time is
// the one column that holds a real instant: the plant time minus 5 h 30 min.
//
// PURE: imports only the plant ingest rules and the placeholder marker, with
// .ts extensions, so node --test loads it (tests/plantMatchRules.test.ts).
import { naiveTs } from "../ingest-rules.ts";
import { AUTOFILL_PREFIX } from "../../slabAddedBy.ts";
import { SCOPE_ENDED_SUFFIX_PATTERN, SCOPE_MARK, SCOPE_SUFFIX_PATTERN } from "../machine/opening-scope-rules.ts";
import { MIXER_MACHINE, MIXER_MODEL, MIX_PLANT_TABLE, mixFlagPrefix } from "./mixer-contract.ts";

/* -------------------------------------------------------------- plant times */

export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;

/** The id of the "Plant sync" login (scripts/0153): every row the matcher
 *  writes carries it in entered_by_user_id, and that is how a plant row is
 *  told from a typed one. */
export const PLANT_SYNC_USER_ID = "plant-sync";
export const PLANT_SYNC_NAME = "Plant sync";

/** A plant time's digits as milliseconds (digits read as UTC); null when it
 *  is not a plant time. */
export function naiveMs(v: unknown): number | null {
  const t = naiveTs(v);
  if (t === null) return null;
  const ms = Date.parse(`${t}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Milliseconds (digits as UTC) back to a plant time "yyyy-MM-ddTHH:mm:ss.fff". */
export function naiveOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23);
}

/** A plant time normalised to "yyyy-MM-ddTHH:mm:ss.fff", or null. */
export function plantTime(v: unknown): string | null {
  const ms = naiveMs(v);
  return ms === null ? null : naiveOf(ms);
}

/** Now, as the plant's clock would show it (IST wall clock, no zone). */
export function nowNaive(now: Date): string {
  return naiveOf(now.getTime() + IST_OFFSET_MIN * MIN_MS);
}

/** A plant time moved by some minutes. */
export function addMinutes(naive: string, minutes: number): string {
  const ms = naiveMs(naive);
  if (ms === null) throw new Error("addMinutes: not a plant time");
  return naiveOf(ms + minutes * MIN_MS);
}

/** The real instant of a plant time (IST minus 5 h 30 min). */
export function realInstant(naive: string): Date | null {
  const ms = naiveMs(naive);
  return ms === null ? null : new Date(ms - IST_OFFSET_MIN * MIN_MS);
}

/** created_time as the column stores it: the real instant's UTC digits, the
 *  way Prisma writes a Date (lib/distributorImport.ts createdTime). */
export function createdTimeOf(naive: string): string | null {
  const ms = naiveMs(naive);
  return ms === null ? null : naiveOf(ms - IST_OFFSET_MIN * MIN_MS);
}

/** in_time / out_time: whole seconds past IST midnight (lib/time.ts
 *  hhmmToSeconds gives the same for a typed "HH:MM:SS"). */
export function secondsPastMidnight(naive: string): number | null {
  const t = naiveTs(naive);
  if (t === null) return null;
  return Number(t.slice(11, 13)) * 3600 + Number(t.slice(14, 16)) * 60 + Number(t.slice(17, 19));
}

/** Seconds from a to b (b − a), from full times, so midnight does not matter. */
export function secondsBetween(a: string | null, b: string | null): number | null {
  const x = a === null ? null : naiveMs(a);
  const y = b === null ? null : naiveMs(b);
  return x === null || y === null ? null : (y - x) / 1000;
}

/** Is plant time t before the cut-over (both naive IST)? A missing cut-over
 *  never makes a slab "before" it. */
export function beforeCutover(t: string, cutoverAt: string | null): boolean {
  if (cutoverAt === null) return false;
  const a = naiveMs(t);
  const c = naiveMs(cutoverAt);
  return a !== null && c !== null && a < c;
}

/** 06:00 of the production day that holds plant time t (the ERP's "today",
 *  lib/dashboard/time.ts reportDayAt): a plant time before 06:00 belongs to
 *  the day before. Answers a plant time "yyyy-MM-ddT06:00:00.000". */
export function productionDayStart(naive: string): string {
  const ms = naiveMs(naive);
  if (ms === null) throw new Error("productionDayStart: not a plant time");
  const shifted = new Date(ms - 6 * 60 * MIN_MS).toISOString().slice(0, 10);
  return `${shifted}T06:00:00.000`;
}

/**
 * THE RUN NOTES WHOSE REMEDY IS ON THE MACHINE SCREEN (the opening check,
 * Edit parameters), for a run with slabs of an earlier production day. The
 * screen reaches back only to 06:00 of today's production day (D13), and since
 * the owner's decision of 4 Nov 2026 a live cut-over may be up to 7 days back
 * (the past week's slabs nobody typed are filled), so "Answer it on the Oven
 * screen" would lead nowhere for a back-filled run: the words then say where
 * those slabs are put right. The value written is unchanged (blank, never
 * guessed). `firstAt`: the earliest slab of the run the note was raised for.
 */
export const SCREEN_REMEDY_KINDS: readonly string[] = ["no_set_cooking_time", "gev_rpm_missing", "opening_missing", "gev_design_differs"];
// 5 Nov 2026 (check of the back-fill fix, matcher-3): these words said "fill it in from History", but the machine
// screen's History reaches back only 24 hours (src/app/entry/machine/[machine]/page.tsx MAX_HOURS). The row of an
// earlier day is put right on its Tables record, which the batch page's slab list opens ("Edit" beside each row,
// src/app/batch/slabs/page.tsx); an incharge may edit a plant row's values there (src/app/tables/actions.ts saveRow).
export const EARLIER_DAY_REMEDY = "; the screen reaches back only to 06:00 today, so for this run's slabs of an earlier day correct their rows in Tables (Edit beside each slab on the batch page's slab list)";
/**
 * THE EARLIER-DAY WORDS OF A BLANK RUN NOTE (5 Nov 2026, "Fill missing parameters"). no_set_cooking_time,
 * gev_rpm_missing and opening_missing are about a value nobody gave: for a run's slabs of an earlier day the incharge
 * now fills it on Fill missing parameters (src/app/entry/machine/fill, reached from Live Status's Needs a look), which
 * writes only the blanks. gev_design_differs is about a value that IS there, which the fill never changes: it keeps
 * EARLIER_DAY_REMEDY (Tables).
 */
export const EARLIER_DAY_FILL_REMEDY = "; the screen reaches back only to 06:00 today, so for this run's slabs of an earlier day use Fill missing parameters (Live Status, Needs a look)";
/** The run-note kinds whose earlier-day words point to Fill missing parameters (the rest of SCREEN_REMEDY_KINDS keep Tables). */
export const FILL_REMEDY_KINDS: readonly string[] = ["no_set_cooking_time", "gev_rpm_missing", "opening_missing"];
/**
 * WHAT IS SAID OF A BLANK OPERATOR OF AN EARLIER DAY (5 Nov 2026, check of the
 * back-fill fix, matcher-3). The words said "fill it in from History", but no
 * screen puts an operator on a row that exists: the machine screen's History
 * reaches back 24 hours and has no operator box (SlabView, EditParameters),
 * and a Tables record shows a person field read-only on an edit, the batch
 * page's "Edit" opening that same record (components/RecordEditor FieldInput,
 * lib/operatorFields personFieldView). So the earlier day's words say so, and
 * that the note is marked done once noted. Today's slabs keep their words.
 * SETTLED_WORDS maps these words back to "fill it in from History", so a flag
 * marked done before 06:00 stays done after it.
 */
export const EARLIER_DAY_OPERATOR_REMEDY = "no screen puts an operator on a row afterwards: History has no operator box, and a Tables record shows it read-only; mark this done once noted";
/**
 * WHAT IS SAID OF A BLANK OPERATOR, ANY DAY (5 Nov 2026, H-1 of "Fill missing parameters"). Today's per-slab
 * no_operator words said "fill it in from History" too, which no screen can do (the owner decided on 5 Nov that there
 * will be no operator box anywhere: a slab with nobody signed in stays without a name). Every map now ends its
 * no_operator words with this sentence, the same as an earlier day's. SETTLED_WORDS maps it back to "fill it in from
 * History", and no_operator is a moving-words kind, so a flag a person marked done with the old words is not raised
 * again; an open one has its words refreshed on its next raise.
 */
export const NO_OPERATOR_REMEDY = EARLIER_DAY_OPERATOR_REMEDY;
/**
 * WHERE A KREOS ROW'S GEV DESIGN NAME COMES FROM, in gev_design_recent's words (5 Nov 2026, review data-3 of "Fill
 * missing parameters"). They said "from the opening check", but a name filled on Fill missing parameters is on the
 * row too. The name the row has is a moving part of those words (SETTLED_WORDS), and gev_design_recent a moving-words
 * kind, so a flag a person marked done is not raised again when the name is filled, changed, or these words change.
 */
export const GEV_DESIGN_SOURCE = "from the opening check or Fill missing parameters";
export function runNoteDetail(kind: string, detail: string, firstAt: string, nowN: string): string {
  if (!SCREEN_REMEDY_KINDS.includes(kind)) return detail;
  // A note of the shift-and-batch rule (5 Nov 2026) already says where its slabs are filled after their shift
  // (opening-scope-rules scopeSuffix): no earlier-day suffix beside it.
  if (detail.includes(SCOPE_MARK)) return detail;
  const a = naiveMs(firstAt);
  const n = naiveMs(nowN);
  if (a === null || n === null) return detail;
  if (!(a < (naiveMs(productionDayStart(nowN)) as number))) return detail;
  // The blank kinds point to Fill missing parameters, a value that is there to Tables (5 Nov 2026). Either suffix is
  // a settled part of the words (SETTLED_WORDS), so a note marked done before 06:00 stays done after it (R-1).
  return `${detail}${FILL_REMEDY_KINDS.includes(kind) ? EARLIER_DAY_FILL_REMEDY : EARLIER_DAY_REMEDY}`;
}

/** Is plant time t in an earlier production day than nowN (before 06:00 of today's)? */
export function earlierProductionDay(t: string, nowN: string): boolean {
  const a = naiveMs(t);
  const n = naiveMs(nowN);
  if (a === null || n === null) return false;
  return a < (naiveMs(productionDayStart(nowN)) as number);
}

/**
 * A slab's no_operator words with its day (review of the back-fill, matcher-6):
 * "nobody was signed in on the Press at 14:05" names only the hour, and a
 * back-filled slab may be 6 days old while Live Status shows its flag as
 * raised today, so an incharge would look in the wrong day's History. For a
 * slab of an earlier production day the first " at HH:MM" becomes
 * " on DD/MM at HH:MM"; today's slabs keep their words. The day is a moving
 * part of the words (SETTLED_WORDS), so a flag a person marked done is not
 * raised again only because 06:00 passed.
 */
export function noOperatorDayWords(detail: string, t: string, nowN: string): string {
  if (!earlierProductionDay(t, nowN)) return detail;
  const day = `${t.slice(8, 10)}/${t.slice(5, 7)}`;
  // and what is true of an earlier day's blank operator (5 Nov 2026, matcher-3: EARLIER_DAY_OPERATOR_REMEDY)
  return detail.replace(/ at (\d{2}:\d{2})/, ` on ${day} at $1`).replace("fill it in from History", EARLIER_DAY_OPERATOR_REMEDY);
}

/**
 * THE RUN-LEVEL NOTE FOR BACK-FILLED SLABS NOBODY WAS SIGNED IN FOR (review of
 * the back-fill, matcher-1). A live cut-over days back fills slabs made before
 * anyone tapped "I'm on" on the machine screen: each would raise its own
 * no_operator flag (tonight's untyped slabs alone, about 900), crowding Needs
 * a look. A slab of an earlier production day with a run number and nobody on
 * (not even a helper) is said ONCE for its run instead (kind no_operator_run,
 * field "operator"), with the first such slab's day and time; the note stays
 * open while any of the run's plant rows still has the operator blank
 * (GAP_RUN_KINDS below). Today's slabs, a slab with no run number and a slab
 * with only a helper on keep their own no_operator flag.
 */
export function noOperatorRunWords(label: string, firstAt: string, slabNo: number | null): string {
  return `nobody was signed in on the ${label} for this run's slabs from ${firstAt.slice(8, 10)}/${firstAt.slice(5, 7)} at ${firstAt.slice(11, 16)}${slabNo === null ? "" : ` (slab ${slabNo})`}, an earlier day the plant sync filled, so their operator is blank; ${EARLIER_DAY_OPERATOR_REMEDY}`;
}

/**
 * THE RUN NOTES A LATER RUN MAY NOT CLOSE WHILE THE GAP STAYS (review of the
 * back-fill, matcher-3). A run note comes only from the slabs a run looks at,
 * but clearFlags closes every run note of each run looked at that this run did
 * not raise again. A run that spans the first answer (an Oven run whose first
 * slabs went in before the set cooking time was answered) had its note closed
 * by the next run, which looked only at the answered last 3 hours, while the
 * earlier rows stayed blank. So, before clearing, such a note is kept while
 * another slab of the run (one this run did not look at) still has the gap:
 *   - "blank": its row (the plant's, or the one it would write) has the note's
 *     field empty;
 *   - "differs": its row's field is not the plant's value the note named
 *     (gev_design_differs: the rows carry the confirmed name, not the deploy).
 */
export const GAP_RUN_KINDS: Readonly<Record<string, "blank" | "differs">> = {
  no_set_cooking_time: "blank", gev_rpm_missing: "blank", opening_missing: "blank", gev_design_differs: "differs", no_operator_run: "blank",
};

/* --------------------------------------------------------- plant row values */

/** A number from a plant row: a JSON number, or numeric text (jsonb ->> gives
 *  text). Anything else is null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Text from a plant row: trimmed, blank as null (the PC trims nchar already). */
export function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export const round = (v: number | null, dp: number): number | null => {
  if (v === null) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/* ----------------------------------------------------- who wrote an ERP row */

export type RowClass = "plant" | "placeholder" | "typed";

export interface StationRowFacts {
  enteredById: string | null;
  remarks: string | null;
  /** imported_at: when the ERP made the row (a real instant). */
  importedAt: Date | null;
}

/**
 * Who a station row belongs to (critic A2.6):
 *   - "plant": the matcher wrote it (entered_by_user_id = 'plant-sync');
 *   - "placeholder": a gap a person filled with "⚙ auto-added…", made AFTER the
 *     machine's cut-over, and still nobody's entry (no enteredById: both ways
 *     of adding one leave it empty, lib/batchRange.ts autoFillBatch and "Add
 *     all missing"): the matcher may complete it, the way the typed form
 *     completes one;
 *   - "typed": everything else, a placeholder from before cut-over and a row
 *     with no enteredById (Airtable, imports) included. Never changed.
 */
export function classifyRow(row: StationRowFacts, cutoverReal: Date | null): RowClass {
  if (row.enteredById === PLANT_SYNC_USER_ID) return "plant";
  if (typeof row.remarks === "string" && row.remarks.startsWith(AUTOFILL_PREFIX) && row.enteredById === null) {
    if (cutoverReal !== null && row.importedAt !== null && row.importedAt.getTime() >= cutoverReal.getTime()) return "placeholder";
  }
  return "typed";
}

/** Does a row carry the placeholder marker ("⚙ auto-added…")? Such a row was
 *  ADDED to fill a gap: its values are a batch's average and another
 *  station's time, never what a person read off the press. */
export function isMarkerRow(remarks: unknown): boolean {
  return typeof remarks === "string" && remarks.startsWith(AUTOFILL_PREFIX);
}

/* ----------------------------------------------- what a match is (sync_match) */

export type MatchMode =
  | "pending" | "shadow" | "inserted" | "placeholder_filled" | "typed_beside"
  | "pre_cutover" | "skipped_aborted" | "removed_by_person" | "batch_pending"
  // round 2 (spec 4.2, Q9): the Distributor's run has no answered opening
  // check yet, so its slab is held: no row in live, not "would write" in
  // shadow. Released on the first run after the answer (distributor-spec.ts).
  | "opening_pending";

/** Modes a later run looks at again even when the plant row has not changed:
 *  they wait on something else (the press log settling, the batch, a person,
 *  the Distributor's opening check). */
export const WAITING_MODES: readonly MatchMode[] = ["pending", "batch_pending", "opening_pending"];

/** Modes in which the target row is the plant's own. */
export const OWNED_MODES: readonly MatchMode[] = ["inserted", "placeholder_filled"];

/* --------------------------------------------------------- comparing values */

/** A station column's kind, as the matcher reads, compares and writes it.
 *  Round 2 (spec 1.1) adds two: "list", a text[] column (the Distributor's
 *  slot columns), written ::text[] and compared as a SET (the order a person
 *  ticked the sizes in is not a difference; sameOpeningValue does the same);
 *  and "bool" (the Kreos breakage columns, written at insert only). */
export type ColumnKind = "text" | "num" | "ts" | "list" | "bool";

/** A list column's value as a sorted set of trimmed, non-blank texts, or
 *  null when it is not a list (a JSON array, or Postgres's text[] read back as
 *  an array). An empty list is an empty set, not null: "no slot" is an answer. */
export function listValue(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.map((x) => (x === null || x === undefined ? "" : String(x).trim())).filter((x) => x !== ""))].sort();
}

/** A bool column's value: true / false, or null when it is neither (a typed
 *  row may hold NULL). */
export function boolValue(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Same value, for the ownership compare: exact, after normalising. A number
 *  read back from double precision is equal to the one written; a time is
 *  compared on its plant-time text; a list as a set; a bool as itself. */
export function sameValue(kind: ColumnKind, a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (na === null || nb === null) return na === null && nb === null;
  if (kind === "list") {
    const x = listValue(na);
    const y = listValue(nb);
    return x !== null && y !== null && x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (kind === "bool") return boolValue(na) !== null && boolValue(na) === boolValue(nb);
  if (kind === "num") {
    const x = num(na);
    const y = num(nb);
    if (x === null || y === null) return x === y;
    return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (kind === "ts") return plantTime(na) !== null && plantTime(na) === plantTime(nb);
  return String(na) === String(nb);
}

export interface OwnershipPlan {
  /** Columns to write now, with their new values. */
  set: Record<string, unknown>;
  /** Columns a person changed since the matcher wrote them: left alone. */
  changedByPerson: string[];
  /** What `written` becomes once `set` is written. */
  written: Record<string, unknown>;
}

/**
 * Field ownership on a row the plant wrote (spec 0.4). For each column the
 * matcher owns:
 *   - a column it never wrote (not in `written`: a filled placeholder keeps
 *     the batch a person gave it) is the person's: left alone, silently;
 *   - the row already holds the new value: nothing to write;
 *   - the row still holds what the matcher last wrote: write the new value;
 *   - otherwise a person changed it: leave it, and report it.
 * The operator is never written over a name (a person put it there, in Tables
 * or on a typed row before the plant's), only into an empty operator, and a
 * person's operator is not reported. (5 Nov 2026: no screen puts an operator on
 * a plant row afterwards, the owner's decision; these words said the incharge
 * fills it in from History, which never existed.)
 */
export function ownershipPlan(
  columns: Readonly<Record<string, ColumnKind>>,
  current: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): OwnershipPlan {
  const set: Record<string, unknown> = {};
  const changedByPerson: string[] = [];
  const nextWritten: Record<string, unknown> = { ...written };
  for (const [col, kind] of Object.entries(columns)) {
    if (!Object.prototype.hasOwnProperty.call(written, col)) continue;
    const cur = current[col] ?? null;
    const want = next[col] ?? null;
    const ours = written[col] ?? null;
    if (sameValue(kind, cur, want)) {
      nextWritten[col] = want;
      continue;
    }
    if (col === "operator") {
      if (cur === null && sameValue(kind, ours, null)) {
        set[col] = want;
        nextWritten[col] = want;
      }
      continue;
    }
    if (!sameValue(kind, cur, ours)) {
      changedByPerson.push(col);
      continue;
    }
    set[col] = want;
    nextWritten[col] = want;
  }
  return { set, changedByPerson, written: nextWritten };
}

/* -------------------------------------------------- typed rows: differences */

export interface CompareRule {
  kind: ColumnKind;
  /** Plain name for the incharge. */
  label: string;
  /** How far apart two values may be and still count as the same: seconds
   *  for a time, units for a number. */
  tolerance?: number;
  /** Compare folded: upper case, letters and digits only (names, batches). */
  folded?: boolean;
  /** A number that goes round a clock face of this many units (the Oven's
   *  out time, seconds past midnight: 86400). The distance is the shorter way
   *  round, so 23:55 and 00:02 are 7 minutes apart, not 86,000 s (round 2,
   *  spec 3.6). */
  circular?: number;
}

export interface Difference { column: string; label: string; typed: unknown; plant: unknown }

const fold = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The fields where a typed row disagrees with the plant (spec 0.2). Only where
 * BOTH have a value: a field the floor did not type is not wrong, and a field
 * the plant cannot see is not evidence. Within the tolerance is the same (a
 * typed time is a person reading a clock; the map found 0-3 min slips).
 */
export function typedDifferences(
  rules: Readonly<Record<string, CompareRule>>,
  typed: Readonly<Record<string, unknown>>,
  plant: Readonly<Record<string, unknown>>,
): Difference[] {
  // A placeholder is never evidence (critic A2.6): whether it is one the
  // matcher may complete or one from before cut-over (typed, untouchable),
  // its date is another station's and its weight a batch average, so it is
  // never compared with the plant. Nothing to say about it.
  if (isMarkerRow(typed.remarks)) return [];
  const out: Difference[] = [];
  for (const [column, rule] of Object.entries(rules)) {
    const t = typed[column] ?? null;
    const p = plant[column] ?? null;
    if (t === null || p === null) continue;
    if (typeof t === "string" && !t.trim()) continue;
    let same: boolean;
    if (rule.kind === "num") {
      const x = num(t);
      const y = num(p);
      if (x === null || y === null) same = true;
      else if (rule.circular && rule.circular > 0) {
        const d = Math.abs(x - y) % rule.circular;
        same = Math.min(d, rule.circular - d) <= (rule.tolerance ?? 0.01);
      } else same = Math.abs(x - y) <= (rule.tolerance ?? 0.01);
    } else if (rule.kind === "ts") {
      const x = naiveMs(plantTime(t));
      const y = naiveMs(plantTime(p));
      same = x === null || y === null ? true : Math.abs(x - y) <= (rule.tolerance ?? 0) * 1000;
    } else if (rule.kind === "list" || rule.kind === "bool") {
      // A set of sizes, or a yes/no: the same or not, no tolerance.
      same = sameValue(rule.kind, t, p);
    } else {
      same = rule.folded ? fold(t) === fold(p) : String(t).trim() === String(p).trim();
    }
    if (!same) out.push({ column, label: rule.label, typed: t, plant: p });
  }
  return out;
}

/** A value as the incharge reads it in a flag. */
/**
 * no_operator's words when only a HELPER was on the machine at the slab's
 * time (Q26; review of 3 Nov, press-2). The slab still names nobody (a helper
 * names no slab, by the owner's answer), but "nobody was signed in" would be
 * false for the incharge reading it: say who was on, and that "Take over" is
 * what names the slabs. Every map's no_operator begins "nobody was signed in";
 * any other words are kept and the helper sentence is added.
 */
export function noOperatorHelperWords(detail: string, helperName: string | null | undefined): string {
  const name = String(helperName ?? "").replace(/\s+/g, " ").trim() || "an incharge";
  const body = /^nobody was signed in\b/.test(detail) ? detail.replace(/^nobody was signed in/, `only ${name} was signed in, as a helper,`) : detail;
  return `${body}. A helper names no slab: the operator taps "I'm on", or ${name} taps "Take over" so the slabs from then on carry his name`;
}

export function shown(v: unknown): string {
  if (v === null || v === undefined || v === "") return "blank";
  if (typeof v === "number") return String(round(v, 2));
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return listValue(v)?.join(", ") || "none";
  const t = plantTime(v);
  if (t !== null) return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
  return String(v);
}

/** "Weight: typed 410, plant 412.5; Cycle time: typed 380, plant 362". */
export function differencesText(diffs: readonly Difference[]): string {
  return diffs.map((d) => `${d.label}: typed ${shown(d.typed)}, plant ${shown(d.plant)}`).join("; ");
}

/* ------------------------------------------------------------------- flags */

/** A flag the matcher raises (a sync_flag row before it is stored). */
export interface FlagDraft {
  kind: FlagKind;
  machine: string | null;
  model: string | null;
  targetId: string | null;
  plantTable: string | null;
  plantKey: string | null;
  slabNo: number | null;
  lineOrder: number | null;
  batchKey: string | null;
  field: string | null;
  plantValue: unknown;
  erpValue: unknown;
  detail: string;
}

/** Every kind the matcher raises, and so may clear again once it no longer
 *  holds. Kinds a person raises (none yet) are never cleared by the matcher. */
export const FLAG_KINDS = [
  // per slab
  "typed_differs", "changed_by_person", "typed_duplicate", "aborted_cycle", "no_operator",
  "design_not_on_list", "stages_low", "cycle_time_odd", "pinhole_differs", "press_log_missing",
  "date_refused", "batch_conflict", "not_written", "batch_pending",
  // per slab, round 2's shared groundwork (spec 1.5): the line head
  "line_head_both", "wrong_line_head",
  // per slab, round 2's Oven (spec 3.5): a slab in the oven too long, odd or
  // missing oven times, a shelf that is not a floor, the plant's discarded mark
  "oven_not_out", "oven_times_odd", "oven_time_missing", "oven_floor_odd", "oven_discarded",
  // per slab, round 2's Kreos (spec 5.2, 5.7): a slab that never left the
  // Kreos (no row), a weight or a roller load the plant does not give, a
  // thickness code the ERP does not know (the Distributor's too, 4.7), the
  // chessboard mode bit against the slab's chessboard code, a GEV design
  // deployed in the half hour before the slab in a running campaign
  "kreos_unfinished", "weight_missing", "thickness_unknown", "chessboard_mismatch", "gev_design_recent",
  // per slab, round 2's Distributor (spec 4.1, 4.7): begun on the Distributor
  // and not off it 30 minutes later
  "distributor_open",
  // per line order
  "run_batch_pending", "run_batch_split",
  // per line order, the back-fill (review of 4 Nov 2026, matcher-1): the slabs
  // of an earlier day the plant sync filled with nobody signed in, ONE flag per
  // run instead of one per slab (noOperatorRunWords)
  "no_operator_run",
  // per line order, round 2 (spec 1.9): a batch-constant field typed
  // differently on a run's typed rows, ONE flag per run, machine and field
  "typed_run_differs",
  // per line order, round 2's Oven (spec 3.1, 3.5): nobody has ever answered
  // the set cooking time, so the oven rows of the run have it blank
  "no_set_cooking_time",
  // per line order, round 2's Kreos (spec 5.1, 5.7): a GEV on at the plant
  // with no RPM given, and no GEV design name confirmed on the opening check;
  // a GEV design deployed after the confirmed name, naming another design
  // (review of 3 Nov, matcher-4: the Kreos twin of vein_design_differs)
  "gev_rpm_missing", "opening_missing", "gev_design_differs",
  // per line order, round 2's Distributor (spec 4.2, 4.3, 4.7): the run's
  // opening check is not answered 30 minutes into the run (its slabs wait);
  // the vein answers against the panel's vein bits or each other ("ask, never
  // block"); the plant deployed a vein design other than the confirmed one
  "opening_pending", "vein_panel_differs", "vein_design_differs",
  // per plant mix, round 3a's Mixer (MIXER-SPEC-FINAL 5.2): plant_table 'plant_mix', plant_key the F_CODE, machine
  // MIXER (mixFlag below). The runner raises and clears these (MIX_FLAG_KINDS)
  "mix_binder_missing", "mix_no_binder", "mix_odd", "mix_silo_by_type", "mix_typed_differs", "mix_typed_elsewhere",
  "mix_typed_twice", "mix_late_line",
  // per plant mix, the Mixer (5 Nov 2026, plant mix 151200009): its order was read past binder lines the plant left
  // the run blank on (mixer-map orderOfLines); a note, the mix's row is made as any other's
  "mix_run_blank",
  // per line order, the Mixer (5.2): its batch's typed cycles against the plant's mixes, a number not certain yet, a
  // batch that moved under written rows, MIS naming two batches for one order, and the values the plant does not give
  "mix_cycle_mismatch", "mix_count_unsure", "mix_batch_changed", "mix_batch_unsure", "mix_not_given",
  // per line order, the Mixer (review of the Mixer sync, 5 Nov 2026, rows-3): cycles the plant wrote that a person
  // deleted and nothing typed stands for (the plant never writes them again)
  "mix_deleted_untyped",
  // per plant mix, the Mixer's stock (5.2, Part B: lib/plantSync/mixerStock raises and closes it; the runner never
  // clears it, MIX_STOCK_FLAG_KINDS)
  "mix_stock_skipped",
  // per machine
  "settings_missing",
  // per MIS batch, the automatic MIS standard (lib/plantSync/std-server.ts; plant_table 'mis_batch', plant_key the
  // batch key, machine PRESS): raised and cleared by that job only, never by the matcher (they are in none of the
  // SLAB/RUN/MACHINE/MIX lists below), and only an administrator marks them done (critique 9)
  "mis_std_missing", "mis_std_left_out", "mis_std_spm", "mis_std_replay_differs", "mis_std_trial_resumed", "mis_std_low",
  "mis_std_blank",
  // per MIS batch, THE STD RULE's rule 4 (lib/misStdRule.ts, lib/misStdFlags.ts; owner, 10 Nov 2026): an hour saved
  // with no Std because nothing decides it. Raised and closed by lib/misStdFlags.ts only, never by the matcher or by
  // the automatic standard's job; an administrator's to mark done
  "mis_std_unset",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** The sentence of the "run batch pending" flag; it reads after "Run 10193: ".
 *  Machine-neutral since round 2 (spec 1.4): the same run waits on every
 *  machine, and Live Status shows one entry per run whatever machine raised it. */
export const PENDING_RUN_TEXT = "the batch of this run is not known yet, so its rows wait. Set the run's batch or fix the MIS hour that holds it";

/** The words of a run's "batch not known" flag when the run's batch was known
 *  and is not any more (an MIS hour edited, the plant's run renumbered) and the
 *  plant already wrote rows for it (review 2 of 4 Nov, r2-e2e-1): those rows
 *  keep the batch they were written with (an unknown batch never blanks one),
 *  and the flag is raised at once, without the 2-hour wait. Reads after "Run 10193: ". */
export const KEPT_RUN_TEXT = "the batch of this run is no longer known (an MIS hour or the plant's run changed), so the rows the plant already wrote keep the batch they were written with, and its new rows wait. Set the run's batch or fix the MIS hour that holds it";

/**
 * WORDS THAT MOVE WHILE THE THING STAYS (review 2 of 4 Nov, r2-runner-1).
 * A flag a PERSON marked done is not raised again with the same words
 * (flags-server.ts raiseFlags). These kinds' words carry a value that moves
 * from run to run while the thing itself is unchanged: the hours a slab has
 * been in the oven, the latest Kreos slab's begin, the slab "to edit from"
 * (the earliest one a run looked at, which moves forward as the run's first
 * slabs age out of the 3-hour recheck), the range of held slabs. For them the
 * words are compared SETTLED: each moving part below replaced by its
 * placeholder, in the database (raiseFlags) and here (settledWords) alike.
 * The parts that ARE the thing (a design name, a GEV number, a field) stay.
 */
export const MOVING_WORDS_KINDS: readonly FlagKind[] = [
  "oven_not_out", "kreos_unfinished", "gev_rpm_missing", "opening_missing", "gev_design_differs", "opening_pending",
  "vein_panel_differs", "vein_design_differs",
  // the back-fill (review of 4 Nov 2026, matcher-1 and matcher-6): a slab's day, said once 06:00 has passed, and the
  // run note's first slab, which moves on as the run's first slabs age out of the 3-hour recheck
  "no_operator", "no_operator_run",
  // 5 Nov 2026 (R-1 of "Fill missing parameters"): the earlier-day suffix runNoteDetail adds once a run's first slab
  // is of an earlier production day; with the suffix settled away, a note marked done before 06:00 stays done after it
  "no_set_cooking_time",
  // 5 Nov 2026 (review data-3 of "Fill missing parameters"): the GEV design name the row has, which a fill (or Edit
  // parameters) changes while the deploy the flag is about stays the same
  "gev_design_recent",
];
/**
 * A literal text as a regular expression both Postgres (ARE) and JavaScript read as exactly that text: every
 * character with a meaning in either is escaped with a backslash (5 Nov 2026). The words given here have none of
 * "^" or "$" (tests/plantMatchReview2Fixes.test.ts holds every pattern to that), only "(" and ")".
 */
export function literalPattern(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`);
}
/** [pattern, replacement]: each a regular expression both Postgres (ARE) and JavaScript read the same way. */
export const SETTLED_WORDS: readonly (readonly [string, string])[] = [
  // 5 Nov 2026 (R-1 of "Fill missing parameters"): the earlier-day suffixes of a run note settle to nothing. They
  // carry no fact about the gap (the run, the field and the slab to edit from are said before them), so a note marked
  // done before 06:00 (no suffix), before this change (the Tables suffix) or after it (the Fill suffix) is not raised
  // again only because 06:00 passed. First in the chain, so no later pattern touches them before they go.
  [literalPattern(EARLIER_DAY_FILL_REMEDY), ""],
  [literalPattern(EARLIER_DAY_REMEDY), ""],
  // 5 Nov 2026 (the shift-and-batch rule): a scoped blank note's suffix (opening-scope-rules scopeSuffix) settles to
  // nothing, and a scoped opening_pending ("the opening check for the shift and batch from DD/MM HH:MM is not
  // answered") to today's ("the opening check is not answered (the run began at HH:MM)", its time settled too): a
  // note a person marked done is not raised again only because its run's first slab came under the new rule.
  [SCOPE_SUFFIX_PATTERN, ""],
  // ...and the suffix of a scope that has ended (critique of the build, screens-2: "is no longer asked ... fills these
  // slabs with Fill missing parameters"), so a note marked done is not raised again when its shift or batch ends.
  [SCOPE_ENDED_SUFFIX_PATTERN, ""],
  ["the opening check for the shift and batch from [0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2} is not answered", "the opening check is not answered"],
  [" \\(the run began at [0-9]{2}:[0-9]{2}\\)", ""],
  // 5 Nov 2026 (review data-3): gev_design_recent's "the row has "<name>" from the opening check" (the words before
  // this change) or "... from the opening check or Fill missing parameters" (GEV_DESIGN_SOURCE): the name and the
  // source settle away, the deploy's title (said before them) stays. Before the patterns below, so none of them reads
  // inside a design name.
  ['the row has ".*" from the opening check( or Fill missing parameters)?', "the row has # from the opening check"],
  ["from slab [0-9?]+( at [0-9]{2}:[0-9]{2})?", "from slab #"],
  ["[0-9]+(\\.[0-9]+)? hours later", "# hours later"],
  ["a later slab began at [0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}", "a later slab began at #"],
  ["slabs? [0-9]+(–[0-9]+)? waits?", "slabs # wait"],
  ["slabs from [0-9]{2}/[0-9]{2} at [0-9]{2}:[0-9]{2}( \\(slab [0-9]+\\))?", "slabs from #"],
  [" on [0-9]{2}/[0-9]{2} at ", " at "],
  // 5 Nov 2026 (matcher-3): an earlier day's blank operator says what is true of it; settled, it is today's words
  // (no regular-expression character in it: letters, spaces, ":", "," and ";")
  [EARLIER_DAY_OPERATOR_REMEDY, "fill it in from History"],
  // 5 Nov 2026 (merge recheck of the Mixer sync): the Mixer's no_operator_run says how many of the run's cycles nobody
  // was on and from when (mixer-map), and both move as the run's cycles arrive; settled, a note marked done stays done,
  // as the stations' run note does ("slabs from #"). Only the Mixer's words read "cycle(s) (from …)".
  ["for [0-9]+ cycles? \\(from [0-9/: ?]+\\)", "for # cycles"],
];
/** A flag's words with their moving parts settled (SETTLED_WORDS), as raiseFlags compares them. */
export function settledWords(detail: string): string {
  return SETTLED_WORDS.reduce((acc, [p, r]) => acc.replace(new RegExp(p, "g"), r), detail);
}

/** Which flags hang on what: a slab (plant_slab), a run (plant_line_order) or
 *  the machine as a whole (no plant key). A run of the matcher that looked at
 *  a slab, a run or the machine clears that scope's flags it did not raise. */
export const SLAB_FLAG_KINDS: readonly FlagKind[] = [
  "typed_differs", "changed_by_person", "typed_duplicate", "aborted_cycle", "no_operator", "design_not_on_list",
  "stages_low", "cycle_time_odd", "pinhole_differs", "press_log_missing", "date_refused", "batch_conflict",
  "not_written", "batch_pending", "line_head_both", "wrong_line_head",
  "oven_not_out", "oven_times_odd", "oven_time_missing", "oven_floor_odd", "oven_discarded",
  "kreos_unfinished", "weight_missing", "thickness_unknown", "chessboard_mismatch", "gev_design_recent",
  "distributor_open",
];
export const RUN_FLAG_KINDS: readonly FlagKind[] = [
  "run_batch_pending", "run_batch_split", "typed_run_differs", "no_set_cooking_time", "gev_rpm_missing", "opening_missing",
  "gev_design_differs", "opening_pending", "vein_panel_differs", "vein_design_differs", "no_operator_run",
  // the Mixer's run notes (MIXER-SPEC-FINAL 5.2); machine MIXER, so they never meet another machine's run flags
  "mix_cycle_mismatch", "mix_count_unsure", "mix_batch_changed", "mix_batch_unsure", "mix_not_given", "mix_deleted_untyped",
];
export const MACHINE_FLAG_KINDS: readonly FlagKind[] = ["settings_missing"];
/** A plant mix's flags (plant_table 'plant_mix', plant_key the F_CODE): the Mixer runner raises them and clears
 *  those of the mixes it looked at (flags-server clearFlags, its mixKeys arm). MIXER-SPEC-FINAL 5.1-5.2. */
export const MIX_FLAG_KINDS: readonly FlagKind[] = [
  "mix_binder_missing", "mix_no_binder", "mix_odd", "mix_silo_by_type", "mix_typed_differs", "mix_typed_elsewhere",
  "mix_typed_twice", "mix_late_line", "mix_run_blank",
];
/** A plant mix's stock flags: raised and closed by the stock draw (lib/plantSync/mixerStock), NEVER by the runner. */
export const MIX_STOCK_FLAG_KINDS: readonly FlagKind[] = ["mix_stock_skipped"];
/** An MIS batch's automatic-standard notes (plant_table 'mis_batch', plant_key the batch key): raised and closed by
 *  lib/plantSync/std-server.ts only, NEVER by a runner (clearFlags names no such scope); an administrator's to mark
 *  done (flag-titles ADMIN_FLAG_KINDS). 10 Nov 2026. */
export const MIS_BATCH_FLAG_KINDS: readonly FlagKind[] = [
  "mis_std_missing", "mis_std_left_out", "mis_std_spm", "mis_std_replay_differs", "mis_std_trial_resumed", "mis_std_low", "mis_std_blank",
  // THE STD RULE's own note (lib/misStdFlags.ts), in the same scope: raised and closed there only
  "mis_std_unset",
];

/** The key the database keeps one OPEN flag per (sync_flag_open_key):
 *  kind, plant key, field, machine. */
export function flagKey(f: Pick<FlagDraft, "kind" | "plantKey" | "field" | "machine">): string {
  return [f.kind, f.plantKey ?? "", f.field ?? "", f.machine ?? ""].join("\u0001");
}

/** One draft per key, the last one winning (its detail is the newest). */
export function dedupeFlags(drafts: readonly FlagDraft[]): FlagDraft[] {
  const m = new Map<string, FlagDraft>();
  for (const d of drafts) m.set(flagKey(d), d);
  return [...m.values()];
}

/** A slab's flag, with the slab number in front of the words. */
export function slabFlag(
  kind: FlagKind,
  at: { machine: string; model: string; plantKey: string; slabNo: number | null; lineOrder: number | null; batchKey?: string | null; targetId?: string | null },
  detail: string,
  extra: Partial<Pick<FlagDraft, "field" | "plantValue" | "erpValue">> = {},
): FlagDraft {
  return {
    kind, machine: at.machine, model: at.model, targetId: at.targetId ?? null, plantTable: "plant_slab", plantKey: at.plantKey,
    slabNo: at.slabNo, lineOrder: at.lineOrder, batchKey: at.batchKey ?? null, field: extra.field ?? null,
    plantValue: extra.plantValue ?? null, erpValue: extra.erpValue ?? null,
    detail: at.slabNo === null ? detail : `Slab ${at.slabNo}: ${detail}`,
  };
}

/** A run's (line order's) flag. */
export function runFlag(kind: FlagKind, machine: string, lineOrder: number, detail: string, batchKey: string | null = null): FlagDraft {
  return {
    kind, machine, model: null, targetId: null, plantTable: "plant_line_order", plantKey: String(lineOrder),
    slabNo: null, lineOrder, batchKey, field: null, plantValue: null, erpValue: null, detail: `Run ${lineOrder}: ${detail}`,
  };
}

/** The machine's own flag (one at a time). */
export function machineFlag(kind: FlagKind, machine: string, detail: string): FlagDraft {
  return {
    kind, machine, model: null, targetId: null, plantTable: null, plantKey: null,
    slabNo: null, lineOrder: null, batchKey: null, field: null, plantValue: null, erpValue: null, detail,
  };
}

/**
 * A plant mix's flag (the Mixer, MIXER-SPEC-FINAL 5.1, 11.2): plant_table 'plant_mix', plant_key the F_CODE, no
 * slab, machine MIXER, model MixerCycle. Its words start "Batch B cycle k (plant F_CODE): ", or "Plant mix F_CODE: "
 * while the batch or the number is not known (Live Status labels a mix flag by its run, so the words carry the cycle).
 */
export function mixFlag(
  kind: FlagKind,
  at: { fCode: string; lineOrder: number | null; batch: string | null; batchKey: string | null; cycle: number | null; targetId?: string | null },
  detail: string,
  extra?: Partial<Pick<FlagDraft, "field" | "plantValue" | "erpValue">>,
): FlagDraft {
  const fCode = String(at.fCode ?? "").trim();
  return {
    kind, machine: MIXER_MACHINE, model: MIXER_MODEL, targetId: at.targetId ?? null, plantTable: MIX_PLANT_TABLE, plantKey: fCode,
    slabNo: null, lineOrder: at.lineOrder, batchKey: at.batchKey ?? null, field: extra?.field ?? null,
    plantValue: extra?.plantValue ?? null, erpValue: extra?.erpValue ?? null,
    detail: mixFlagPrefix(at.batch, at.cycle, fCode) + detail,
  };
}

/* ------------------------------------------------------- the typed form's rules */

const DAY_MS = 86_400_000;

/**
 * createRow's dateSanity (src/app/tables/actions.ts) on a plant date, so the
 * matcher refuses what a person's save would refuse. The same clocks as
 * there: the naive date's digits against the real now, and the batch's
 * newest non-placeholder date as the anchor (±21 days), else at most 90 days
 * old. The words are the incharge's, not an error code.
 */
export function dateSanityError(dateNaive: string, anchorNaive: string | null, now: Date, batchKey: string | null, timeWords = "press time"): string | null {
  // timeWords: the machine's own time in the incharge's words (round 2: "oven
  // time" and so on, from the machine's spec); the Press's are round 1's.
  const d = naiveMs(dateNaive);
  if (d === null) return `the ${timeWords} is not a real time`;
  const n = now.getTime();
  if (d > n + 2 * DAY_MS) return `the ${timeWords} ${dateNaive.slice(0, 10)} is in the future; the plant PC's clock may be wrong`;
  const a = anchorNaive === null ? null : naiveMs(anchorNaive);
  if (a !== null) {
    if (d < a - 21 * DAY_MS || d > a + 21 * DAY_MS) {
      return `the ${timeWords} ${dateNaive.slice(0, 10)} does not fit batch ${batchKey ?? "?"} (its newest entry is ${anchorNaive!.slice(0, 10)})`;
    }
    return null;
  }
  if (d < n - 90 * DAY_MS) return `the ${timeWords} ${dateNaive.slice(0, 10)} is more than 90 days old`;
  return null;
}

/** Postgres text cannot hold NUL (22021); the typed save strips it too. */
export function stripNul<T>(v: T): T {
  return (typeof v === "string" ? v.replaceAll("\u0000", "") : v) as T;
}

/* ------------------------------------------------- what to do with one slab */

/** A station row that may be this slab's (same slab number, any batch, or the
 *  row the matcher wrote for it before, found by id). */
export interface ExistingRow extends StationRowFacts {
  id: string;
  airtableId: string;
  batchKey: string | null;
}

export type SlabAction = "none" | "insert" | "fill" | "update" | "beside";

export interface SlabDecision {
  mode: MatchMode;
  action: SlabAction;
  /** The row filled, updated or compared with. */
  rowId: string | null;
  /** More than one ERP row has this slab number: their ids (flag it). */
  duplicates: string[];
  /** Why nothing was written, for a flag; null when nothing needs saying.
   *  "other_plant_row": the slab number is already on a row the plant wrote
   *  for ANOTHER plant slab (a reused number, or a lost sync_match row): the
   *  matcher refuses a second row and says so, it never guesses which one is
   *  right. */
  why: "date_refused" | "other_plant_row" | null;
}

export interface SlabDecisionInput {
  switchMode: "shadow" | "live";
  cutoverAt: string | null;
  /** The station's plant time for the slab (press: F_PRE_BEGIN). */
  plantTime: string;
  previous: { mode: MatchMode | null; targetId: string | null };
  /** The airtableId the matcher gives this slab's row ('press-plant-<article>'). */
  ownAirtableId: string;
  rows: readonly ExistingRow[];
  /** Is the plant's record of the slab complete? */
  ready: "ok" | "aborted" | "unsettled";
  batchResolved: boolean;
  /** The slab's batch key when known: a placeholder of that batch is the one
   *  completed when there are two. */
  batchKey: string | null;
  /** dateSanityError's answer for the row the matcher would write. */
  dateError: string | null;
}

/**
 * One slab's fate (spec 0.2-0.4). In order:
 *   1. a row the matcher wrote and a person deleted: never again;
 *   2. the matcher's own row still there: keep it up to date (live);
 *   3. plant time before the cut-over: nothing;
 *   4. the plant's record not complete, or an aborted cycle: nothing yet / ever;
 *   5. a row a person typed (any batch): never touched, compared beside it;
 *   6. a row the plant wrote for another plant slab with this number: nothing,
 *      and a flag (never a second row);
 *   7. a placeholder made after cut-over: completed in place (live);
 *   8. no row: a new row (live) - once the batch is known and the date passes
 *      the typed form's own check.
 * Shadow decides the same and then writes nothing to the station table.
 */
export function decideSlab(i: SlabDecisionInput): SlabDecision {
  const none = (mode: MatchMode, rowId: string | null = null, duplicates: string[] = []): SlabDecision =>
    ({ mode, action: "none", rowId, duplicates, why: null });
  const prev = i.previous;
  if (prev.mode === "removed_by_person") return none("removed_by_person");

  const owned = prev.mode !== null && (OWNED_MODES as readonly string[]).includes(prev.mode);
  if (owned && prev.targetId) {
    const target = i.rows.find((r) => r.id === prev.targetId);
    if (!target) return none("removed_by_person");
    const others = i.rows.filter((r) => r.id !== target.id).map((r) => r.id);
    if (target.enteredById === PLANT_SYNC_USER_ID) {
      return i.switchMode === "live"
        ? { mode: prev.mode!, action: "update", rowId: target.id, duplicates: others, why: null }
        : none(prev.mode!, target.id, others);
    }
    return { mode: "typed_beside", action: "beside", rowId: target.id, duplicates: others, why: null };
  }

  if (beforeCutover(i.plantTime, i.cutoverAt)) return none("pre_cutover");
  if (i.ready === "aborted") return none("skipped_aborted");
  if (i.ready === "unsettled") return none("pending");

  // A row of ours that sync_match does not know (it cannot happen while the
  // insert and the match are one transaction; if it ever does, it is ours).
  const adopt = i.rows.find((r) => r.airtableId === i.ownAirtableId && r.enteredById === PLANT_SYNC_USER_ID);
  if (adopt) {
    const others = i.rows.filter((r) => r.id !== adopt.id).map((r) => r.id);
    return i.switchMode === "live"
      ? { mode: "inserted", action: "update", rowId: adopt.id, duplicates: others, why: null }
      : none("inserted", adopt.id, others);
  }

  const cutReal = i.cutoverAt === null ? null : realInstant(i.cutoverAt);
  const classOf = new Map(i.rows.map((r) => [r.id, classifyRow(r, cutReal)]));
  // critic A2.6: only a row a PERSON typed is compared beside; a plant row
  // that is not this slab's own is not a person's evidence.
  const typed = i.rows.filter((r) => classOf.get(r.id) === "typed");
  const foreign = i.rows.filter((r) => classOf.get(r.id) === "plant");
  const placeholders = i.rows.filter((r) => classOf.get(r.id) === "placeholder");
  const dupes = i.rows.length > 1 ? i.rows.map((r) => r.id) : [];
  if (typed.length) {
    // The newest typed row is the one compared (a duplicate is flagged anyway).
    const row = [...typed].sort((a, b) => (b.importedAt?.getTime() ?? 0) - (a.importedAt?.getTime() ?? 0))[0];
    return { mode: "typed_beside", action: "beside", rowId: row.id, duplicates: dupes, why: null };
  }
  if (foreign.length) return { ...none("pending", foreign[0].id, dupes), why: "other_plant_row" };

  if (!i.batchResolved) return none("batch_pending", placeholders[0]?.id ?? null, dupes);
  if (i.dateError) return { ...none("pending", placeholders[0]?.id ?? null, dupes), why: "date_refused" };
  if (placeholders.length) {
    const row = placeholders.find((r) => i.batchKey !== null && r.batchKey === i.batchKey) ?? placeholders[0];
    return i.switchMode === "live"
      ? { mode: "placeholder_filled", action: "fill", rowId: row.id, duplicates: dupes, why: null }
      : none("shadow", row.id, dupes);
  }
  return i.switchMode === "live" ? { mode: "inserted", action: "insert", rowId: null, duplicates: [], why: null } : none("shadow");
}

/* --------------------------------------------- completing a placeholder */

/** The reserved key inside sync_match.written that keeps what a filled
 *  placeholder held before the matcher completed it (D15: the by-hand undo,
 *  scripts/undo-plant-sync-press.sql, puts it back from here). Never a column:
 *  ownershipPlan walks the columns only, so it never compares or writes it. */
export const PRIOR_KEY = "_prior";

export interface FillPlan {
  /** Columns to write, never a NULL (critic A2.5). */
  set: Record<string, unknown>;
  /** The columns the matcher owns from now on: those it set, and those that
   *  were empty and stay empty (so a value that comes later, a 03:00
   *  temperature, an operator who signs in late, may still fill them), plus
   *  PRIOR_KEY. A column the placeholder held a value in that the plant could
   *  not give stays the person's: not owned, never written. */
  written: Record<string, unknown>;
}

/**
 * How the matcher completes a placeholder (spec 2; critic A2.5; D15):
 *   - a plant value goes in; the plant having nothing never blanks a value
 *     the placeholder holds (the design or the batch's average weight that
 *     "Add all missing" put there);
 *   - `keep` columns (the batch a person gave it) are left as they are;
 *   - an operator a person put there is never written over;
 *   - what the placeholder held in every owned column, and its remarks and
 *     enteredById, are kept under PRIOR_KEY, so it can be put back exactly.
 * `row` is the placeholder as read (column name -> value, times as plant-time
 * text); `prior` adds the non-column facts the undo needs (remarks etc.).
 */
export function fillPlan(
  columns: Readonly<Record<string, ColumnKind>>,
  row: Readonly<Record<string, unknown>>,
  mapped: Readonly<Record<string, unknown>>,
  keep: readonly string[],
  prior: Readonly<Record<string, unknown>>,
): FillPlan {
  const set: Record<string, unknown> = {};
  const written: Record<string, unknown> = {};
  const before: Record<string, unknown> = { ...prior };
  for (const col of Object.keys(columns)) {
    if (keep.includes(col)) continue;
    const cur = row[col] ?? null;
    const want = mapped[col] ?? null;
    if (col === "operator" && cur !== null) continue;
    if (want !== null) {
      set[col] = want;
      written[col] = want;
      before[col] = cur;
    } else if (cur === null) {
      written[col] = null;
      before[col] = null;
    }
  }
  written[PRIOR_KEY] = before;
  return { set, written };
}

/* ------------------------------------------- the date on a plant row's update */

/** The columns that move with the press time and the batch: a change to any
 *  of them is checked as the typed save checks a date (dateSanityError). */
export const DATE_BOUND_COLUMNS: readonly string[] = ["date", "in_time", "created_time", "batch", "batch_key"];

/** Does an update change the date or the batch (critic A2.5)? */
export function updateMovesDate(set: Readonly<Record<string, unknown>>): boolean {
  return Object.prototype.hasOwnProperty.call(set, "date") || Object.prototype.hasOwnProperty.call(set, "batch_key");
}

/** An update with its date and batch changes taken out (the date check
 *  refused them): those columns stay as the row has them, and `written`
 *  keeps what the matcher wrote there before, so the next run tries again. */
export function withoutDateMove(plan: OwnershipPlan, previous: Readonly<Record<string, unknown>>): OwnershipPlan {
  const set = { ...plan.set };
  const written = { ...plan.written };
  for (const col of DATE_BOUND_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(set, col)) continue;
    delete set[col];
    if (Object.prototype.hasOwnProperty.call(previous, col)) written[col] = previous[col];
    else delete written[col];
  }
  return { set, changedByPerson: plan.changedByPerson, written };
}

/* --------------------------------------------- one row per slab, per run */

/**
 * Two plant slabs with the same slab number in one run (critic A2.7): the
 * insert's NOT EXISTS sees only committed rows, so both would pass. Only the
 * earliest pressed (then the smaller plant key) may be written; the others
 * are answered here, by plant key, to be held back and flagged.
 */
export function laterSameSlab(items: readonly { plantKey: string; slabNo: number; plantTime: string }[]): Set<string> {
  const first = new Map<number, { plantKey: string; plantTime: string }>();
  for (const it of items) {
    const f = first.get(it.slabNo);
    if (!f || it.plantTime < f.plantTime || (it.plantTime === f.plantTime && it.plantKey < f.plantKey)) first.set(it.slabNo, it);
  }
  const out = new Set<string>();
  for (const it of items) if (first.get(it.slabNo)!.plantKey !== it.plantKey) out.add(it.plantKey);
  return out;
}
