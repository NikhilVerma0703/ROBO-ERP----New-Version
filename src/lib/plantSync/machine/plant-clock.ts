// PLANT TIMES FOR CODE THAT THE BROWSER LOADS (Machine Overview round 1).
// PURE, and it imports nothing at all.
//
// match/match-rules.ts has the same helpers, but it imports ingest-rules.ts,
// which imports node:crypto, and a client component (the "Edit parameters"
// panel, the slab picker) cannot bundle that. These few functions are the same
// rules, copied, so the files the browser loads stay free of the server's
// imports; tests/machineOverviewOpening.test.ts holds every one of them to the
// matcher's own version on a spread of inputs, so the copy cannot drift.
//
// A plant time is the naive IST wall clock as a string "yyyy-MM-ddTHH:mm:ss.fff"
// (spec section 0.5). Its digits are read as if they were UTC: no time zone of
// the server or the browser ever moves it.

export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;
const NAIVE_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/;

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A plant time normalised to milliseconds precision, or null when it is not one. */
function naiveTs(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = NAIVE_TS.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  const frac = (m[7] ?? "").slice(0, 3).padEnd(3, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${frac}`;
}

/** A plant time's digits as milliseconds (digits read as UTC); null when it is not a plant time. */
export function naiveMs(v: unknown): number | null {
  const t = naiveTs(v);
  if (t === null) return null;
  const ms = Date.parse(`${t}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Milliseconds (digits as UTC) back to a plant time. */
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
