// THE SLAB'S JOURNEY THROUGH THE PLANT, in words for the Robo slab page (owner,
// 17 Nov 2026: "Slab's plant journey"). The card "From the plant" lists, for a
// slab number, where the plant says the slab was and when: distributor, Kreos,
// press, oven, its thickness and batch, how long it waited between the line
// head and the press, and whether the press cycle was aborted.
//
// PURE string and number logic. The row comes from lib/robo/slabPlantJourney.ts
// with every time already normalised to "YYYY-MM-DDTHH:MM" (naive IST, as the
// plant stores it). Nothing here turns a plant time into a JS Date: the clock
// is read as text (plantClock) and the minutes between two times are counted
// from the calendar by hand, so no zone and no summer time can move them.
import { plantClock, shortDate } from "./plantSlabs.ts";

/** One slab as the plant has it. A time is "YYYY-MM-DDTHH:MM" or null. */
export interface JourneyRow {
  distBegin: string | null; distEnd: string | null;
  krsBegin: string | null; krsEnd: string | null;
  preBegin: string | null; preEnd: string | null;
  oveIn: string | null; oveOut: string | null;
  /** The plant's thickness in millimetres ("30"), or null when the code is not a known size. */
  thicknessMm: string | null;
  /** The batch the plant says the slab is in, or null. */
  batch: string | null;
  /** The press log judged the cycle aborted (the ERP's own rule); null = not judged. */
  aborted: boolean | null;
}

export interface JourneyLine { key: string; label: string; value: string }

export interface JourneyView {
  /** Station by station, in the order the slab travels; a station with no time is left out. */
  stations: JourneyLine[];
  /** Thickness and batch, when the plant has them. */
  facts: JourneyLine[];
  /** "Between the line head and the press: 12 min", or null. */
  wait: string | null;
  /** "The press cycle was aborted", or null. */
  abortedText: string | null;
}

/* ------------------------------------------------------------ the calendar */

/** Whole days from 1970-01-01 to a yyyy-mm-dd (the civil calendar, counted by hand). */
function dayNumber(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  let y = Number(m[1]);
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** A plant time as minutes on a counter that only ever moves forward; null when it is not a plant time. */
export function plantMinutes(naive: string | null | undefined): number | null {
  const c = plantClock(naive);
  if (!c) return null;
  const day = dayNumber(c.date);
  if (day === null) return null;
  const hh = Number(c.hm.slice(0, 2)), mm = Number(c.hm.slice(3, 5));
  if (hh > 23 || mm > 59) return null;
  return day * 1440 + hh * 60 + mm;
}

/* ------------------------------------------------------------- the words */

/**
 * One station's times: "14 Nov 22:05 → 22:41". The date is shown again only
 * when the end is on another day ("14 Nov 23:50 → 15 Nov 00:32"). A begin with
 * no end reads "14 Nov 22:05"; an end with no begin "ended 14 Nov 22:41";
 * neither: null.
 */
export function stationWords(begin: string | null | undefined, end: string | null | undefined): string | null {
  const b = plantClock(begin), e = plantClock(end);
  if (b && e) {
    const first = `${shortDate(b.date)} ${b.hm}`;
    return e.date === b.date ? `${first} → ${e.hm}` : `${first} → ${shortDate(e.date)} ${e.hm}`;
  }
  if (b) return `${shortDate(b.date)} ${b.hm}`;
  if (e) return `ended ${shortDate(e.date)} ${e.hm}`;
  return null;
}

/** "3 cm" from the plant's millimetres ("30"). Robo keeps thickness in centimetres: mm / 10. Null for anything else. */
export function thicknessCmWords(mm: string | number | null | undefined): string | null {
  if (mm === null || mm === undefined || String(mm).trim() === "") return null;
  const n = Number(mm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cm = Math.round((n / 10) * 100) / 100;
  return `${cm} cm`;
}

/**
 * The minutes between the line head and the press: the press begin minus the
 * LATER of the distributor's end and the Kreos's end (whichever the plant has).
 * Null when the press begin is missing, when neither end is there, or when the
 * answer is negative (two clocks that disagree say nothing true).
 */
export function waitMinutes(row: Pick<JourneyRow, "distEnd" | "krsEnd" | "preBegin">): number | null {
  const press = plantMinutes(row.preBegin);
  if (press === null) return null;
  const ends = [plantMinutes(row.distEnd), plantMinutes(row.krsEnd)].filter((n): n is number => n !== null);
  if (!ends.length) return null;
  const diff = press - Math.max(...ends);
  return diff < 0 ? null : diff;
}

export const ABORTED_WORDS = "The press cycle was aborted";

/** The whole card, line by line. */
export function journeyView(row: JourneyRow): JourneyView {
  const stations: JourneyLine[] = [];
  const add = (key: string, label: string, begin: string | null, end: string | null) => {
    const value = stationWords(begin, end);
    if (value) stations.push({ key, label, value });
  };
  add("distributor", "Distributor", row.distBegin, row.distEnd);
  add("kreos", "Kreos", row.krsBegin, row.krsEnd);
  add("press", "Press", row.preBegin, row.preEnd);
  add("oven", "Oven", row.oveIn, row.oveOut);

  const facts: JourneyLine[] = [];
  const thickness = thicknessCmWords(row.thicknessMm);
  if (thickness) facts.push({ key: "thickness", label: "Thickness", value: thickness });
  const batch = String(row.batch ?? "").trim();
  if (batch) facts.push({ key: "batch", label: "Plant batch", value: batch });

  const wait = waitMinutes(row);
  return {
    stations,
    facts,
    wait: wait === null ? null : `Between the line head and the press: ${wait} min`,
    abortedText: row.aborted === true ? ABORTED_WORDS : null,
  };
}
