/**
 * "Production Rate per Hour" — slabs completed each hour across ONE batch's own
 * run, for the Reports line chart — and the ONE slab-placement rule that the
 * chart, its "first In → last Out" subtitle and the Total Production Time /
 * Avg Slabs/hour KPIs (productionSpan.ts, via reportSummary.ts) all share.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── HOW EACH SLAB IS PLACED — from its OWN stored production date ───────────
 * Every slab carries the production date the operator entered (productionDateOf,
 * resolved by the caller: the slab's own date, else the batch setup's, else the
 * shift's). In/Out are bare HH:MM, so each is combined with the slab's date:
 *
 *   • In  → date + In time.
 *   • Out → date + Out time, EXCEPT when Out < In: the slab crossed midnight, so
 *           its Out is on the NEXT day (In 23:55, Out 00:09 → 00:09 the following
 *           day).
 *
 * A slab is counted in the hour its Out Time falls in. The timeline runs from the
 * earliest In to the latest Out, one bucket per hour (every hour shown, even the
 * empty ones), each bucket carrying the calendar date its hour belongs to — so a
 * run that crosses midnight flows 23:00–00:00 straight into 00:00–01:00 of the
 * next date, with both dates marked on the axis. (The shift band under the
 * chart counts the same slabs under each one's own Shift instead —
 * `shiftSlabs`, see hourlyShifts.ts.)
 *
 * ── A DELAY BELONGS TO EVERY HOUR IT RAN THROUGH (2026-10-20) ──────────────
 * It used to be listed whole under the hour it BEGAN in, on the reasoning that
 * the register holds one delay of one duration. That reasoning does not survive
 * the register: a power cut logged as T1 22:00 → 06:00, 480 minutes, put eight
 * hours of stoppage into the 22:00 bucket and left the seven hours it actually
 * covered — every one of them with no slabs, for that very reason — reading
 * "No delays". Twenty-nine delays on record run longer than an hour.
 *
 * So a delay is now CUT at each hour boundary and listed in every hour it ran
 * through, keeping its code and carrying the part of itself that fell in that
 * hour (03:55 → 04:12 is 5 minutes of the 03:00 hour and 12 of the 04:00 one).
 *
 * And the hour's TOTAL is the minutes of the hour that were under a delay,
 * counted once — not the entries added up. The floor logs a delay against the
 * slab it held up, so one stoppage is written down once per slab waiting on it
 * and the entries overlap: D-1473's 05:00 hour on 19 Oct lists eight D1 rows
 * adding to 69 minutes of a sixty-minute hour. Every row is still shown; the
 * total says what the hour lost, and says when the rows overlap.
 *
 * ── WHY THE STORED DATE, NOT A RECONSTRUCTED SEQUENCE (2026-09-16) ─────────
 * An earlier version ignored the stored date and rebuilt the day from the
 * production SEQUENCE — serialNumber order plus time-wrap detection, a day cursor
 * advanced at every backwards clock step. serialNumber is mistyped on old runs
 * (it restarts and duplicates — see slabSequence.ts), so the walk ran out of
 * order, every out-of-order step looked like a midnight crossing, and whole
 * batches drifted forward: 1440 (8–10 Sep) charted as 23–25 Sep, 1445 as
 * 18–20 Sep. So the stored date became the rule. It still is.
 *
 * ── TWO RECORDING SLIPS, DRAWN WHERE THE SLAB WAS MADE (2026-09-25) ────────
 * Trusting the stored date exposed two narrow faults in the records. On the
 * chart both look the same — a slab EXACTLY 24 hours away from the rest of its
 * run. Batch D-1432 ran 31 Aug 11:20 → 22:31, yet two of its last-hour slabs were
 * drawn on 1 Sep at 21:00 and 22:00, and the same placement stretched Total
 * Production Time to 34h 40m and Avg Slabs/hour to 3.6.
 *
 *   1. A PRODUCTION DATE ONE DAY OFF. The entry form stamps each new slab with a
 *      WORKING date that carries forward (RoboEntryForm, workingDate): it
 *      re-seeds from the setup's date whenever the running setup changes and is
 *      moved on by hand at midnight — so slabs keyed before the operator notices
 *      keep a date one day off while their In/Out clock times are right. Real
 *      registers show it both ways: D-1448's slabs 160534–160535, made 18 Sep
 *      00:22 and 00:26, are stored 17 Sep; D-1449's 161281 is stored 21 Sep 07:46
 *      between slabs made on 22 Sep at 07:40 and 07:51.
 *
 *   2. AN OUT PUSHED TO THE NEXT DAY BY THE MIDNIGHT RULE. An Out typed a few
 *      minutes BEFORE its own In (22:00 against 22:05) reads as "crossed
 *      midnight", so the Out goes on the next day: the slab is charted 24 hours
 *      late and the run's last Out moves a day on.
 *
 * Each has an unmistakable signature, and the signature is all the correction
 * acts on (placeSlabs). Taken in PRODUCTION ORDER — the plant's physical slab
 * number, the authoritative sequence (slabSequence.compareSlabOrder) — the slabs
 * made just before and after it are about a day away from where it was placed,
 * and a clear majority of them sit EXACTLY one day earlier or later, right beside
 * where its clock time says it was made. Then, and only then, the slab (1) or its
 * Out (2) is placed on that day. A genuine pause never looks like this — the
 * slabs on its own side of the pause are right beside it — and nor does a slab
 * that really crossed midnight, whose next-morning Out is where the slabs around
 * it finished too. On D-1449's real register (631 slabs across seven days,
 * four pauses of 6 to 60 hours, seven slabs that crossed midnight) it moves
 * exactly one slab, 161281; on D-1448's, exactly 160534 and 160535.
 *
 * It cannot drift the way the old walk did: each slab is judged against its
 * neighbours' places as STORED, never against corrected ones, and moves at most
 * one day from its OWN stored date — there is no day cursor to accumulate. As a
 * last guard, a run's corrections are kept only if they leave it at least as
 * consistent with production order as it was (no more backwards jumps than
 * before); otherwise the stored places stand. A run of fewer than five slabs has
 * no majority to go on and is drawn exactly as stored.
 *
 * Nothing is written back. The slab keeps its stored date — Slab Records, the
 * Date Wise filter and the exports still show it, and it can still be put right
 * in Slab Records → Edit. This decides only where the reports DRAW the slab.
 */

import { compareSlabOrder } from "./slabSequence.ts";
import { shiftHourOf } from "./hourlyShifts.ts";

export interface HourlySlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null;
  inTime: string | null; // HH:MM
  outTime: string | null; // HH:MM
  /** The Shift the operator picked, for the shift band (productionShiftOf).
   *  Absent or null → the shift its In Time falls in. */
  productionShift?: string | null;
  /** Production order, for the one-day checks: the plant's physical slab
   *  number, then entry time, then id (slabSequence.compareSlabOrder). All
   *  optional — absent, the array order is taken as the sequence. */
  slabNumber?: string | null;
  createdAtMs?: number | null;
  id?: string | null;
  /** The run (batch) the slab belongs to. A slab is only ever checked against
   *  slabs of its own run. Absent → all the slabs given are one run. */
  runKey?: string | null;
}

/**
 * A delay as the hourly chart needs it: which slab it held up, its code, how
 * long it ran and when. Everything else about a delay — its description, its
 * machine, its remarks — belongs to the Delay List, not to this tooltip.
 */
export interface HourlyDelay {
  /** The id of the slab it was logged against, so the delay lands on the same
   *  day the chart drew that slab on. null for a delay logged without one. */
  slabId: string | null;
  /** "D1", "RM11" — the code alone, which is what the operator reads. */
  code: string;
  minutes: number;
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  /** The delay's own production date. Used only when it has no slab to follow. */
  date?: string | null;
}

/**
 * One delay inside an hour, as the tooltip lists it — a delay that ran through
 * more than one hour appears in EACH of them, cut at the hour boundary, with
 * its own code and the part of itself that fell in that hour.
 *
 *   D1 03:55 → 04:12  →  03:00–04:00:  D1 — 5 minutes  [03:55–04:00]
 *                        04:00–05:00:  D1 — 12 minutes [04:00–04:12]
 */
export interface HourDelayEntry {
  code: string;
  /** Minutes of the delay that fell IN THIS HOUR, never its whole duration. */
  minutes: number;
  /** "03:55" / "04:00" — this piece's own ends, clipped to the hour. */
  start: string;
  end: string;
}

export interface HourBucket {
  /** "11:00–12:00", "23:00–00:00" — the interval, 24-hour. */
  label: string;
  /** Hour of day 0-23, for anyone who needs the number rather than the label. */
  hour: number;
  /** Slabs whose Out Time fell in this hour. */
  slabs: number;
  /** What the shift band counts in this hour: the slabs above, each moved to
   *  an hour of its OWN Shift (hourlyShifts.shiftHourOf). Added up over a
   *  shift's hours it is that shift's slabs, as the Shift column of Download
   *  Slab Records reads them. Over the run it adds up to the same as `slabs`. */
  shiftSlabs: number;
  /** The calendar date (yyyy-mm-dd) this hour belongs to — the X-axis date
   *  marker. null only when no slab carried a resolvable production date. */
  date: string | null;
  /** The delays that RAN IN this hour, earliest first — each cut to the part
   *  of it that fell inside. Empty when none did, and empty on every bucket
   *  when the caller passed no delays at all. */
  delays: HourDelayEntry[];
  /** How much of the hour was lost: the minutes of the hour that were under a
   *  delay, counted ONCE however many entries covered them. Never more than
   *  60, because an hour has 60. */
  delayMins: number;
  /** True when the entries above overlap each other, so their minutes add up
   *  to more than delayMins. The tooltip says so rather than letting the
   *  reader find an addition that does not work. */
  delaysOverlap: boolean;
}

/** Minutes in a day — one day on the absolute timeline. */
const DAY = 1440;

/** Minutes since midnight for an HH:MM string, or null if unusable. */
function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Whole days since the epoch for a yyyy-mm-dd string, or null. UTC, so no
 *  timezone shifts the day. */
function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** The yyyy-mm-dd for a whole-days-since-epoch number — the inverse of dayNum,
 *  in UTC, so the date a bucket is labelled with never drifts with a timezone. */
function dateFromDayNum(dn: number): string | null {
  if (!Number.isFinite(dn)) return null;
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:00–HH:00" for an absolute hour index, wrapping the labels at midnight. */
function hourLabel(absHour: number): string {
  const a = ((absHour % 24) + 24) % 24;
  const b = (a + 1) % 24;
  return `${pad(a)}:00–${pad(b)}:00`;
}

/** An absolute minute as the calendar date and clock time it stands for —
 *  yyyy-mm-dd and HH:MM, in UTC like everything else here, so it reads back
 *  exactly the date and time the slab was recorded with. */
export function absToDateTime(abs: number): { date: string; time: string } | null {
  if (!Number.isFinite(abs)) return null;
  const date = dateFromDayNum(Math.floor(abs / DAY));
  if (!date) return null;
  const m = ((abs % DAY) + DAY) % DAY;
  return { date, time: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` };
}

/** A run's two ends as the reports return them — the first slab's In and the
 *  last slab's Out, each as a date and a clock time (absToDateTime). */
export interface RunEnds {
  start: { date: string; time: string } | null;
  end: { date: string; time: string } | null;
}

/**
 * The chart subtitle's account of a run: "31/08/2026 (11:20) → 31/08/2026
 * (22:31)" — first slab In → last slab Out, each as dd/mm/yyyy with its clock
 * time. "" when either end is missing (nothing completed yet), so the caller
 * can fall back to the dates alone.
 */
export function runScope(run: RunEnds | null | undefined): string {
  if (!run?.start || !run.end) return "";
  const dmy = (iso: string) => iso.split("-").reverse().join("/");
  return `${dmy(run.start.date)} (${run.start.time}) → ${dmy(run.end.date)} (${run.end.time})`;
}

/** A batch running longer than this is a stray-date data error, not a real run —
 *  cap the timeline so one badly-dated row can't ask for weeks of empty hours.
 *  Most batches span a day or two, but not all: D-1449 ran from 17 Sep to
 *  23 Sep 2026 through long pauses, and the old four-day cap cut its chart off
 *  on 21 Sep while its last slab came out on the 23rd — so since 2026-09-25 the
 *  cap is eight days, clear of any real run on record. */
const MAX_HOURS = 8 * 24;

/**
 * Where one slab sits by its stored date ALONE: absolute minutes (whole days
 * since the epoch × 1440 + clock) for its In and Out, and whether the midnight
 * rule put its Out on the next day. The per-slab half of the rule — placeSlabs
 * adds the two one-day checks on top, and every caller goes through placeSlabs
 * so the chart, the KPIs and the subtitle cannot disagree.
 *
 * Nulls rather than a throw: a slab with no resolvable date, or no time at all,
 * cannot be placed and is skipped by every caller.
 */
function storedPlace(slab: HourlySlab): { inAbs: number | null; outAbs: number | null; rolled: boolean } {
  // The slab's OWN stored production day.
  const day = dayNum(slab.productionDate);
  const inM = toMins(slab.inTime);
  const outM = toMins(slab.outTime);
  if (day === null || (inM === null && outM === null)) return { inAbs: null, outAbs: null, rolled: false };
  const base = day * DAY;
  // Overnight: a slab whose Out precedes its In finished after midnight, so its
  // Out belongs to the NEXT day.
  const rolled = inM !== null && outM !== null && outM < inM;
  return {
    inAbs: inM !== null ? base + inM : null,
    outAbs: outM !== null ? base + outM + (rolled ? DAY : 0) : null,
    rolled,
  };
}

/* ── the one-day checks — see the header ────────────────────────────────── */

/** "Right beside" another slab: within this many minutes of it. */
const NEAR = 180;
/** How many slabs either side, in production order, a slab is judged against. */
const NEIGHBOURS = 8;
/** Fewer neighbours than this and there is no majority to go on: leave it. */
const MIN_NEIGHBOURS = 4;

export interface PlacedSlab {
  /** Absolute minutes of the In / Out as the reports draw them; null when the
   *  slab has no such time (or no date). */
  inAbs: number | null;
  outAbs: number | null;
  /** Whole days the slab was moved from its stored date: −1, 0 or +1 (slip 1). */
  dayShift: number;
  /** True when the midnight rule's next-day Out was taken back to the In's day
   *  (slip 2) — the Out was typed a few minutes before the In. */
  outOnInDay: boolean;
}

/** The NEIGHBOURS places either side of position p — the slab's neighbours in
 *  production order, not including itself. */
function around(places: readonly number[], p: number): number[] {
  return [...places.slice(Math.max(0, p - NEIGHBOURS), p), ...places.slice(p + 1, p + 1 + NEIGHBOURS)];
}

/**
 * The one-day move, if any, that the neighbours show for the slab placed at
 * `at`: 0 when it has company where it is (more than a quarter of its
 * neighbours right beside it), else the move among `moves` that puts it right
 * beside a clear majority of them. 0 when there are too few neighbours to form
 * a majority at all.
 */
function oneDayMove(at: number, neighbours: readonly number[], moves: readonly number[]): number {
  const n = neighbours.length;
  if (n < MIN_NEIGHBOURS) return 0;
  const beside = (pos: number) => neighbours.filter((x) => Math.abs(x - pos) <= NEAR).length;
  // It has company where it is → its stored place is right.
  if (beside(at) > Math.floor(n / 4)) return 0;
  // A clear majority exactly one day away → that is where it was made.
  for (const d of moves) if (beside(at + d) * 2 > n) return d;
  return 0;
}

/** Backwards jumps of more than NEAR along a run in production order — the
 *  measure the guard compares before and after correcting. */
function backwardJumps(places: readonly number[]): number {
  let n = 0;
  for (let k = 1; k < places.length; k++) if (places[k] < places[k - 1] - NEAR) n++;
  return n;
}

/** The moves, kept only if they leave the run no LESS consistent with
 *  production order than the places they correct; otherwise none. */
function guarded(places: readonly number[], moves: number[]): number[] {
  if (!moves.some(Boolean)) return moves;
  const after = places.map((x, p) => x + moves[p]);
  return backwardJumps(after) <= backwardJumps(places) ? moves : moves.map(() => 0);
}

/**
 * Where each slab sits on the absolute timeline — the rule every report uses.
 * Same order as the input. Each slab is placed by its stored date; a slab whose
 * stored date is one day off, or whose Out the midnight rule pushed a day on
 * (see the header), is placed where its production-order neighbours show.
 */
export function placeSlabs(slabs: readonly HourlySlab[]): PlacedSlab[] {
  const stored = slabs.map(storedPlace);
  const placed: PlacedSlab[] = stored.map(({ inAbs, outAbs }) => ({ inAbs, outAbs, dayShift: 0, outOnInDay: false }));
  // Each slab's place in production order, as compareSlabOrder reads it.
  const seqKey = slabs.map((s) => ({ slabNumber: s.slabNumber ?? null, createdAtMs: s.createdAtMs ?? null, id: s.id ?? null }));

  // Each run on its own, in production order.
  const runs = new Map<string, number[]>();
  slabs.forEach((s, i) => {
    const key = s.runKey ?? "";
    const list = runs.get(key);
    if (list) list.push(i);
    else runs.set(key, [i]);
  });

  for (const members of runs.values()) {
    const order = [...members].sort((a, b) => compareSlabOrder(seqKey[a], seqKey[b]) || a - b);

    // 1 — a production date one day off. Judged on where the slab went IN
    //     (its Out when it has no In), against its neighbours' STORED places.
    const dated = order.filter((i) => (stored[i].inAbs ?? stored[i].outAbs) !== null);
    const starts = dated.map((i) => (stored[i].inAbs ?? stored[i].outAbs) as number);
    const slips = guarded(starts, starts.map((at, p) => oneDayMove(at, around(starts, p), [-DAY, DAY])));
    dated.forEach((i, p) => {
      const d = slips[p];
      if (!d) return;
      const q = placed[i];
      placed[i] = {
        ...q,
        inAbs: q.inAbs === null ? null : q.inAbs + d,
        outAbs: q.outAbs === null ? null : q.outAbs + d,
        dayShift: d / DAY,
      };
    });

    // 2 — an Out the midnight rule pushed to the next day. Only ever a rolled
    //     Out, only ever taken back to its In's day, judged against where the
    //     neighbouring slabs came OUT (their dates as settled by step 1).
    const finished = order.filter((i) => placed[i].outAbs !== null);
    const ends = finished.map((i) => placed[i].outAbs as number);
    const rolls = guarded(ends, ends.map((at, p) => (stored[finished[p]].rolled ? oneDayMove(at, around(ends, p), [-DAY]) : 0)));
    finished.forEach((i, p) => {
      if (!rolls[p]) return;
      placed[i] = { ...placed[i], outAbs: (placed[i].outAbs as number) + rolls[p], outOnInDay: true };
    });
  }
  return placed;
}

/**
 * The run's first In and last Out as absolute minutes — the two instants the
 * Total Production Time KPI measures between and the chart subtitle names.
 * The earliest In and the latest Out may be different slabs: "when did the run
 * start" and "when did it finish".
 */
export function runBounds(slabs: readonly HourlySlab[]): { firstIn: number | null; lastOut: number | null } {
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  for (const { inAbs, outAbs } of placeSlabs(slabs)) {
    if (inAbs !== null && (firstIn === null || inAbs < firstIn)) firstIn = inAbs;
    if (outAbs !== null && (lastOut === null || outAbs > lastOut)) lastOut = outAbs;
  }
  return { firstIn, lastOut };
}

/** How far an instant is outside [lo, hi]; 0 when it is inside. */
function gapTo(t: number, lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return t < a ? a - t : t > b ? t - b : 0;
}

/**
 * WHEN a delay ran, as an absolute [from, to) in minutes on the chart's own
 * timeline — the half of the rule that answers "which day".
 *
 * A delay carries a bare HH:MM, so it needs a day — and the day is the one the
 * chart DREW ITS SLAB ON, not whatever date the delay's own row holds: the slab
 * may have been moved by placeSlabs (a mis-keyed production date), and a delay
 * drawn 24 hours from the slab it held up would sit in an hour where nothing
 * was happening.
 *
 * Of the slab's own day and the two either side, the one taken is the one that
 * puts the delay NEAREST the slab's own In → Out window. That is the whole
 * rule, and it settles both awkward cases without a special case for either: a
 * slab that went in at 23:50 and was held at 00:10 was held after midnight, on
 * the next day; and a delay that began at 16:00 on a slab that went in at 16:05
 * began five minutes early, not a day late.
 *
 * ── HOW LONG ──────────────────────────────────────────────────────────────
 * From the END TIME the register holds, which is the operator's own record of
 * when the line came back: `to − from` is the clock's own answer, and an end
 * before the start crossed midnight (22:00 → 06:00 is eight hours, not minus
 * sixteen). Checked across all 1,783 delays on record: every one of them has
 * both times, and every one has durationMinutes equal to that span — so the
 * two never disagree, and the clock is used because it is what the splitting
 * needs. durationMinutes is the fallback for the two cases the clock cannot
 * answer: no end time at all, and an end equal to the start on a row that
 * records a duration anyway (a delay of exactly 24 hours reads as zero).
 *
 * A delay logged without a slab falls back to its own date. One with no start
 * time cannot be placed in an hour at all, and is left out rather than guessed
 * into one.
 */
function delaySpan(
  d: HourlyDelay,
  anchor: { inAbs: number | null; outAbs: number | null } | undefined,
): { from: number; to: number } | null {
  const sm = toMins(d.startTime);
  if (sm === null) return null;

  const stated = Number.isFinite(d.minutes) && d.minutes > 0 ? d.minutes : 0;
  const em = toMins(d.endTime);
  const clock = em === null ? 0 : ((em - sm) % DAY + DAY) % DAY;
  const length = clock > 0 ? clock : stated;

  const ref = anchor?.inAbs ?? anchor?.outAbs ?? null;
  if (ref === null) {
    const dn = dayNum(d.date);
    if (dn === null) return null;
    const from = dn * DAY + sm;
    return { from, to: from + length };
  }
  const lo = anchor?.inAbs ?? ref;
  const hi = anchor?.outAbs ?? ref;
  const base = Math.floor(ref / DAY) * DAY + sm;
  let from = base;
  for (const cand of [base - DAY, base + DAY]) {
    if (gapTo(cand, lo, hi) < gapTo(from, lo, hi)) from = cand;
  }
  return { from, to: from + length };
}

/**
 * How many minutes of [lo, hi) are covered by the intervals — overlapping ones
 * counted ONCE.
 *
 * This is what an hour's total has to be, and the register is why. The floor
 * logs a delay against the SLAB it held up, so one stoppage is written down
 * several times over, once per slab waiting on it: on 19 Oct batch D-1473 has
 * D1 05:28–05:49 and, inside it, D1 05:32–05:34 and D1 05:36–05:39, and then
 * D1 05:41–06:07 which starts before the first has ended. Added up they are 69
 * minutes of a sixty-minute hour. The line was in fact stopped from 05:28 to
 * 06:07 — once — and 05:28 to 06:00 is the part of it this hour lost.
 *
 * Every entry is still listed with its own times, so nothing is hidden; this
 * only decides what the hour's TOTAL says.
 */
function coveredMinutes(intervals: readonly (readonly [number, number])[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [open, close] = sorted[0];
  for (const [a, b] of sorted.slice(1)) {
    if (a > close) {
      total += close - open;
      open = a;
      close = b;
    } else if (b > close) {
      close = b;
    }
  }
  return total + (close - open);
}

export function hourlyProduction(
  slabs: readonly HourlySlab[],
  delays: readonly HourlyDelay[] = [],
): HourBucket[] {
  let winStart = Infinity; // absolute minute of the earliest In
  let winEnd = -Infinity; // absolute minute of the latest Out
  const completions: number[] = []; // absolute minute of each Out Time

  const placed = placeSlabs(slabs);
  // Where each slab ended up, by id — what a delay hangs off.
  const bySlab = new Map<string, { inAbs: number | null; outAbs: number | null }>();
  slabs.forEach((s, i) => {
    if (s.id) bySlab.set(s.id, { inAbs: placed[i].inAbs, outAbs: placed[i].outAbs });
  });

  for (const { inAbs, outAbs } of placed) {
    if (inAbs === null && outAbs === null) continue; // cannot be placed

    const startAbs = inAbs ?? (outAbs as number);
    winStart = Math.min(winStart, startAbs);
    if (outAbs !== null) {
      winEnd = Math.max(winEnd, outAbs);
      completions.push(outAbs);
    }
  }

  if (!Number.isFinite(winStart) && !Number.isFinite(winEnd)) return [];
  if (!Number.isFinite(winStart)) winStart = winEnd; // nothing started, only completions
  if (!Number.isFinite(winEnd)) winEnd = winStart; // started but nothing completed yet

  const startHour = Math.floor(winStart / 60);
  let endHour = Math.floor(winEnd / 60);
  // Safety cap against a stray far-off date: anchor on the batch START (the
  // earliest In, which a forward-mis-dated slab never precedes) and bound the
  // length, so a lone future-dated row can't drag the timeline across empty days.
  if (endHour - startHour > MAX_HOURS - 1) endHour = startHour + (MAX_HOURS - 1);

  const counts = new Map<number, number>();
  for (const c of completions) {
    const h = Math.floor(c / 60);
    if (h >= startHour && h <= endHour) counts.set(h, (counts.get(h) ?? 0) + 1);
  }

  /* The shift band's counts: every slab counted above, once, in an hour of its
     own Shift. A shift the chart does not reach — B picked on a run's last
     slab, out at 13:58 — is counted in the nearest hour it does, so the band
     still adds up to the line. */
  const shiftCounts = new Map<number, number>();
  placed.forEach(({ inAbs, outAbs }, i) => {
    if (outAbs === null) return; // not finished, so not on the line either
    const out = Math.floor(outAbs / 60);
    if (out < startHour || out > endHour) return;
    const h = Math.min(Math.max(shiftHourOf(slabs[i], inAbs ?? outAbs), startHour), endHour);
    shiftCounts.set(h, (shiftCounts.get(h) ?? 0) + 1);
  });

  /* Each delay CUT AT THE HOUR BOUNDARIES and listed in every hour it ran
     through, with the part of itself that fell in that hour — the same code,
     its own minutes, its own start and end. A stoppage from 03:55 to 04:12 is
     5 minutes of the 03:00 hour and 12 minutes of the 04:00 one, which is what
     each of those hours actually lost; carrying the whole 17 under 03:00 told
     the 04:00 hour it had no delays at all, and that is how an hour with no
     slabs and a power cut running through it came to read "No delays".

     A delay of no length — start and end the same minute — still gets its one
     line, at nought minutes, because the register holds it and a reader
     looking for it must find it. */
  const byHour = new Map<number, { entry: HourDelayEntry; at: [number, number] }[]>();
  for (const d of delays) {
    const span = delaySpan(d, d.slabId ? bySlab.get(d.slabId) : undefined);
    if (span === null) continue;
    const { from, to } = span;
    const lastHour = to > from ? Math.floor((to - 1) / 60) : Math.floor(from / 60);
    for (let h = Math.floor(from / 60); h <= lastHour; h++) {
      if (h < startHour || h > endHour) continue;
      const a = Math.max(from, h * 60);
      const b = Math.min(to, (h + 1) * 60);
      const piece = {
        entry: {
          code: d.code,
          minutes: Math.max(0, b - a),
          start: absToDateTime(a)?.time ?? "",
          end: absToDateTime(Math.max(a, b))?.time ?? "",
        },
        at: [a, Math.max(a, b)] as [number, number],
      };
      const list = byHour.get(h);
      if (list) list.push(piece);
      else byHour.set(h, [piece]);
    }
  }
  for (const list of byHour.values()) {
    list.sort((a, b) => a.at[0] - b.at[0] || a.entry.code.localeCompare(b.entry.code));
  }

  const out: HourBucket[] = [];
  for (let h = startHour; h <= endHour; h++) {
    const pieces = byHour.get(h) ?? [];
    /* The hour lost what it lost: the minutes of it that were under a delay,
       counted once however many entries covered them. Clipped to the hour, so
       this cannot exceed 60 whatever the register holds. */
    const lost = coveredMinutes(pieces.map((p) => p.at));
    out.push({
      label: hourLabel(h),
      hour: ((h % 24) + 24) % 24,
      slabs: counts.get(h) ?? 0,
      shiftSlabs: shiftCounts.get(h) ?? 0,
      // The day-number of an absolute hour is floor(h / 24); its calendar date is
      // the axis marker for this hour.
      date: dateFromDayNum(Math.floor(h / 24)),
      delays: pieces.map((p) => p.entry),
      delayMins: lost,
      delaysOverlap: pieces.reduce((t, p) => t + p.entry.minutes, 0) > lost,
    });
  }
  return out;
}
