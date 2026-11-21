// THE SLABS OF A ROBO BATCH, LISTED FROM THE PLANT (owner, 17 Nov 2026: "can we
// get some robo data from plant"; he chose "the plant fills the slab list": on
// the Robo entry screen the batch's slabs come up already listed, with number,
// date and shift, and the operator only adds the robot's own values).
//
// The plant's database records nothing the robots did (no program, tool,
// liquid, powder, roller height, cycle time, body weight, robot in or out
// time). What it knows of every slab is its NUMBER and WHEN it left the
// distributor and reached the press; the robots stand between the two.
//
// WHICH SLABS ARE THE BATCH'S: the slab ranges the in-charge filed in MIS under
// that batch (mis.batch_key, starting to ending slab number, hour by hour). Not
// the plant's own run (line order): a run does not always change at the batch
// change. On 14 Nov 2026 run 10226 began 26 slabs before MIS, and the Robo
// operators themselves, changed from batch 1506 to 1507 (slab 172781). So a
// slab is listed once its MIS hour is filed, under the batch MIS names.
//
// A slab is listed when the plant has it (its times are the plant's). A number
// inside an MIS range the plant never made is not listed. A slab already in the
// Robo register (the same number) is counted as entered and left off the list.
// Nothing here writes anything: the operator picks a slab, adds the robot's
// values and saves through the form as before, and may still type any slab the
// list does not offer.
//
// THE SLAB'S DATE AND SHIFT. Robo's Production Date is the calendar date of the
// robot's In time, and its Shift the shift that In time falls in
// (lib/robo/productionShift). The plant's two times bracket the In time, so:
//   - both on one calendar day: that day;
//   - across midnight (distributor 23:50, press 00:30): the distributor's day
//     until an In time is typed, then the day that In time is on (an In time
//     before noon is after midnight);
//   - only one of the two times known (3 in 1,118 recent slabs had no press
//     time): that time's day, unless the In time typed is plainly on the other
//     side of midnight: a late-evening distributor time with an In time in the
//     small hours is the next day, a small-hours press time with a late-evening
//     In time the day before. The windows are narrow on purpose, so a mistyped
//     In time or a few minutes between two clocks cannot move the day;
//   - the shift offered is the distributor time's, and follows the In time
//     once one is typed, as the form already does.
//
// PURE: relative .ts imports of files that import nothing, so the route, the
// screen and `node --test` read one rule.
import { shiftFromTime, type ShiftCode } from "./productionShift.ts";
import { MAX_SLABS_PER_HOUR } from "../shiftScoreMath.ts";

/** The most slab numbers one batch's list is worked from, and the most rows sent to the tablet. */
export const PLANT_LIST_MAX_NUMBERS = 4000;
export const PLANT_LIST_MAX_ROWS = 600;
/** The largest slab number there can be: nine digits, as the register's plain numbers, and inside the database's integer. */
export const MAX_SLAB_NO = 999_999_999;

export interface MisRange { start: number | null | undefined; end: number | null | undefined }

/**
 * The slab numbers MIS files under a batch: every whole number of every
 * believable hour range, each once, ascending. A range that cannot be an hour
 * (ending before it starts, or wider than an hour can press) is left out, as
 * the reports leave it out (shiftScoreMath rangeImpossible).
 */
export function misSlabNumbers(ranges: readonly MisRange[], cap = PLANT_LIST_MAX_NUMBERS): { numbers: number[]; capped: boolean } {
  const set = new Set<number>();
  let capped = false;
  for (const r of ranges) {
    const s = Number(r.start), e = Number(r.end);
    if (r.start == null || r.end == null || !Number.isFinite(s) || !Number.isFinite(e)) continue;
    const from = Math.ceil(s), to = Math.floor(e);
    if (to < from || to - from >= MAX_SLABS_PER_HOUR) continue;
    // A number no slab can have (MIS keeps them as free numbers): one such hour must not cost the batch its whole list.
    if (from < 1 || to > MAX_SLAB_NO) continue;
    for (let n = from; n <= to; n++) {
      if (set.size >= cap) { capped = true; break; }
      set.add(n);
    }
    if (capped) break;
  }
  return { numbers: [...set].sort((a, b) => a - b), capped };
}

const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
/** A plant time as it is stored (naive IST, "YYYY-MM-DDTHH:MM:SS.mmm"): its calendar date and its HH:MM. Never a JS Date. */
export function plantClock(naive: string | null | undefined): { date: string; hm: string } | null {
  const m = NAIVE.exec(String(naive ?? ""));
  return m ? { date: m[1], hm: m[2] } : null;
}

/** One slab as the plant has it (the later row stands when two share a number: the caller orders by F_ID). */
export interface PlantSlabIn {
  slabNo: number;
  /** The distributor's begin and the press's begin, as stored. */
  distAt: string | null;
  pressAt: string | null;
  lineOrder: number | null;
  /** When the slab left the line head (the distributor's end, else the Kreos's), as stored. */
  headEndAt?: string | null;
  /** Which line head that was. */
  headName?: "distributor" | "Kreos";
  /** The slab's thickness in cm as the plant made it (lib/robo/plantThickness turns the plant's code into it). */
  thicknessCm?: number | null;
}

export interface PlantSlabRow {
  slabNo: number;
  /** The slab number as the form holds it. */
  slabNumber: string;
  /** Calendar date and shift offered for the slab before an In time is typed. */
  date: string;
  shift: ShiftCode | "";
  /** The plant's times, "HH:MM", and the calendar dates they are on: `dist` is when the slab left the
   *  line head (its end; its begin while the end is not known), `press` when it reached the press. */
  dist: string | null; distDate: string | null;
  press: string | null; pressDate: string | null;
  lineOrder: number | null;
  /** When the slab left the line head, "YYYY-MM-DDTHH:MM" (the robots work after it, before the press). */
  headEndAt: string | null;
  headName: "distributor" | "Kreos";
  /** When it reached the press, "YYYY-MM-DDTHH:MM". */
  pressAtFull: string | null;
  /** The slab's own thickness in cm, as the plant made it (null when the plant does not say). */
  thickness: number | null;
}

export interface PlantSlabList {
  /** Slabs of the batch the plant has. */
  total: number;
  /** Of those, already in the Robo register. */
  entered: number;
  /** Not yet entered, ascending by slab number (at most PLANT_LIST_MAX_ROWS). */
  rows: PlantSlabRow[];
  /** More slabs wait than `rows` holds. */
  more: number;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthDays = (y: number, m: number) => (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : MONTH_DAYS[m - 1]);
/** A yyyy-mm-dd moved by whole days: the calendar counted by hand, so no clock and no time zone can come into it. */
export function addDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  let y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > monthDays(y, mo) || !Number.isInteger(days)) return ymd;
  for (let i = Math.abs(days); i > 0; i--) {
    if (days > 0) {
      d += 1;
      if (d > monthDays(y, mo)) { d = 1; mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    } else {
      d -= 1;
      if (d < 1) { mo -= 1; if (mo < 1) { mo = 12; y -= 1; } d = monthDays(y, mo); }
    }
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Late evening and the small hours: the only clock times that put a single plant time and an In time on two sides of midnight. */
const LATE = "21:00", SMALL = "03:00";
type Clock = { date: string; hm: string };

/** The one date rule (see the header), from the two plant clocks, either of which may be missing. */
function passDate(d: Clock | null, p: Clock | null, inTime?: string | null): string {
  if (!d && !p) return "";
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(inTime ?? "")) ? String(inTime) : "";
  if (d && p) {
    if (d.date === p.date) return d.date;
    // Across midnight. An In time before noon is on the press's day; one after noon, or none yet, on the distributor's.
    return hm && hm < "12:00" ? p.date : d.date;
  }
  if (d) return hm && d.hm >= LATE && hm < SMALL ? addDays(d.date, 1) : d.date;
  return hm && p!.hm < SMALL && hm >= LATE ? addDays(p!.date, -1) : p!.date;
}

/**
 * The calendar date of a slab's robot pass: see the header. `inTime` is the
 * In time typed so far ("HH:MM"), or blank.
 */
export function plantSlabDate(distAt: string | null | undefined, pressAt: string | null | undefined, inTime?: string | null): string {
  return passDate(plantClock(distAt), plantClock(pressAt), inTime);
}

/** The digits of a Robo slab number ("172600", " 172600 ", "0172600" -> 172600); null for one that is not a plain number ("140748-A"). */
export function plainSlabNo(slabNumber: string | null | undefined): number | null {
  const t = String(slabNumber ?? "").trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

/**
 * The list: the batch's numbers (MIS) that the plant has, less those already
 * in the Robo register. `plant` may hold two rows of one number: the LAST one
 * given stands (the caller orders by slab number, then F_ID).
 */
export function buildPlantSlabList(numbers: readonly number[], plant: readonly PlantSlabIn[], enteredNumbers: readonly (string | null | undefined)[], maxRows = PLANT_LIST_MAX_ROWS): PlantSlabList {
  const wanted = new Set(numbers);
  const byNo = new Map<number, PlantSlabIn>();
  for (const s of plant) if (wanted.has(s.slabNo)) byNo.set(s.slabNo, s);
  const entered = new Set<number>();
  for (const e of enteredNumbers) { const n = plainSlabNo(e); if (n != null && byNo.has(n)) entered.add(n); }
  const waiting = [...byNo.values()].filter((s) => !entered.has(s.slabNo)).sort((a, b) => a.slabNo - b.slabNo);
  const rows = waiting.slice(0, maxRows).map((s): PlantSlabRow => {
    // The line head's clock is when the slab LEFT it (its end), falling back to its begin while the
    // end is not known: the robots work after it, so the date, the shift and the words follow it.
    const leftAt = plantClock(s.headEndAt) ? s.headEndAt : s.distAt;
    const d = plantClock(leftAt), p = plantClock(s.pressAt);
    const h = plantClock(s.headEndAt);
    return {
      slabNo: s.slabNo, slabNumber: String(s.slabNo),
      date: plantSlabDate(leftAt, s.pressAt),
      shift: shiftFromTime((d ?? p)?.hm ?? null) ?? "",
      dist: d?.hm ?? null, distDate: d?.date ?? null,
      press: p?.hm ?? null, pressDate: p?.date ?? null,
      lineOrder: s.lineOrder,
      headEndAt: h ? `${h.date}T${h.hm}` : null,
      headName: s.headName === "Kreos" ? "Kreos" : "distributor",
      pressAtFull: p ? `${p.date}T${p.hm}` : null,
      thickness: s.thicknessCm ?? null,
    };
  });
  return { total: byNo.size, entered: entered.size, rows, more: waiting.length - rows.length };
}

/** The date of a listed slab given the In time typed so far: plantSlabDate's rule, from the row's own times. */
export function plantRowDate(row: Pick<PlantSlabRow, "date" | "dist" | "distDate" | "press" | "pressDate">, inTime?: string | null): string {
  const d = row.dist && row.distDate ? { date: row.distDate, hm: row.dist } : null;
  const p = row.press && row.pressDate ? { date: row.pressDate, hm: row.press } : null;
  return passDate(d, p, inTime) || row.date;
}

/** The row of the slab number on the form, when the list holds it. */
export function plantRowFor(rows: readonly PlantSlabRow[], slabNumber: string | null | undefined): PlantSlabRow | null {
  const n = plainSlabNo(slabNumber);
  return n == null ? null : rows.find((r) => r.slabNo === n) ?? null;
}

/** The next slab of the list after the one just saved: the first with a greater number. Null when the list has none. */
export function nextPlantSlab(rows: readonly PlantSlabRow[], savedSlabNumber: string | null | undefined): PlantSlabRow | null {
  const n = plainSlabNo(savedSlabNumber);
  if (n == null) return null;
  return rows.find((r) => r.slabNo > n) ?? null;
}

/** "14 Nov" for the list, from a yyyy-mm-dd. */
export function shortDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return "";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${names[Number(m[2]) - 1] ?? ""}`.trim();
}

/** The plant's times for a slab, in words beside the In and Out boxes. */
export function plantWindowWords(row: Pick<PlantSlabRow, "dist" | "press" | "distDate" | "pressDate"> & { headName?: "distributor" | "Kreos" }): string {
  const parts: string[] = [];
  if (row.dist) parts.push(`left the ${row.headName === "Kreos" ? "Kreos" : "distributor"} ${row.dist}`);
  if (row.press) parts.push(`reached the press ${row.press}${row.distDate && row.pressDate && row.distDate !== row.pressDate ? " (next day)" : ""}`);
  return parts.length ? `Plant: ${parts.join(", ")}.` : "";
}

// ---------------------------------------------------------------- thickness
// THE SLAB'S OWN THICKNESS (owner, 17 Nov 2026: fill from the plant, "most
// accurate"). The plant's code per slab (F_SLAB_THICKNESS) agrees with the
// in-charge's MIS thickness in 90 of 94 hours checked; the one number typed on
// a Robo batch setup did not match the plant for about 340 of 775 slabs, since
// a batch can change thickness partway (D-1507 went 2, 3, 2 cm in blocks).

/**
 * What a new slab stores as its own thickness: the plant's, when it differs
 * from the setup's (lib/robo/thickness: a slab carries its own only when it
 * differs; NULL means "the setup's"). Null when the plant does not say, or
 * says the same as the setup.
 */
export function slabThicknessToStore(plantCm: number | null | undefined, setupCm: number | null | undefined): number | null {
  if (plantCm == null || !Number.isFinite(plantCm) || plantCm <= 0) return null;
  return setupCm != null && Math.abs(plantCm - setupCm) < 1e-9 ? null : plantCm;
}

/** "2 cm", "0.7 cm". */
export function thicknessWords(cm: number | null | undefined): string {
  return cm == null ? "" : `${Number(cm.toFixed(2))} cm`;
}

// ------------------------------------------------- In and Out against the plant
// The robots work on a slab after it leaves the line head and before it reaches
// the press. A typed In or Out time outside that window is almost always a slip
// (a wrong hour, In and Out swapped). Warn, never block: on 774 recent slabs a
// 5-minute allowance flags 14 (the two clocks differ by a few minutes).

/** Minutes of allowance either side of the plant's window. */
export const PLANT_TIME_ALLOW_MIN = 5;

/** Days since 1970-01-01 of a civil date: arithmetic only, no Date and no time zone. */
function dayNumber(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Minutes since 1970 of a plant time "YYYY-MM-DDTHH:MM" (naive IST, read as written). */
function plantMinutes(naive: string | null | undefined): number | null {
  const c = plantClock(naive);
  if (!c) return null;
  const [y, m, d] = c.date.split("-").map(Number);
  const [hh, mm] = c.hm.split(":").map(Number);
  return dayNumber(y, m, d) * 1440 + hh * 60 + mm;
}

/** A typed "HH:MM" placed on whichever day puts it nearest the plant time it is compared with. */
function nearestMinutes(hm: string, anchor: number): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm.trim());
  if (!m) return null;
  const clock = Number(m[1]) * 60 + Number(m[2]);
  const day = Math.floor(anchor / 1440);
  let best: number | null = null;
  for (const dd of [-1, 0, 1]) {
    const t = (day + dd) * 1440 + clock;
    if (best === null || Math.abs(t - anchor) < Math.abs(best - anchor)) best = t;
  }
  return best;
}

/**
 * The warnings for a typed In and Out time against the plant's window for the
 * slab: after it left the line head, before it reached the press, with
 * PLANT_TIME_ALLOW_MIN either side. Empty when the plant has no window or
 * nothing typed is a full time.
 */
export function plantTimeWarnings(row: Pick<PlantSlabRow, "headEndAt" | "headName" | "pressAtFull">, inTime: string | null | undefined, outTime: string | null | undefined): string[] {
  const head = plantMinutes(row.headEndAt), press = plantMinutes(row.pressAtFull);
  const out: string[] = [];
  const hm = (naive: string | null) => plantClock(naive)?.hm ?? "";
  const A = PLANT_TIME_ALLOW_MIN;
  const check = (label: "In" | "Out", typed: string | null | undefined) => {
    const t = String(typed ?? "").trim();
    const anchor = label === "In" ? (head ?? press) : (press ?? head);
    if (!t || anchor === null) return;
    const at = nearestMinutes(t, anchor);
    if (at === null) return;
    if (head !== null && at < head - A) out.push(`${label} time ${t} is before this slab left the ${row.headName === "Kreos" ? "Kreos" : "distributor"} at ${hm(row.headEndAt)} (plant).`);
    else if (press !== null && at > press + A) out.push(`${label} time ${t} is after this slab reached the press at ${hm(row.pressAtFull)} (plant).`);
  };
  check("In", inTime);
  check("Out", outTime);
  return out;
}

// ------------------------------------------------- batches offered for a setup
// THE BATCH SETUP, FILLED FROM THE PLANT (owner, 17 Nov 2026). Operators set a
// batch up on the tablet, often days after it ran (batch 1506, made from 12
// Nov, was set up on 17 Nov). The setup offers the batches MIS has filed in
// the last days; picking one fills its number (as MIS spells it), its
// production date (the calendar day of its first slab the plant has) and its
// thickness (that first slab's). The design is not filled: Robo's designs are
// the robots' own patterns ("Bellagio Grey"), not the product MIS names
// ("Elvis"), so the product is shown beside the batch to help the pick.

export interface MisBatchHour {
  batchKey: string;
  /** The batch as the in-charge typed it ("D1507"). */
  batch: string | null;
  design: string | null;
  start: number | null | undefined;
  end: number | null | undefined;
}

export interface PlantBatchSlab { slabNo: number; distAt: string | null; pressAt: string | null; thicknessCm: number | null }

export interface PlantBatchOffer {
  batchKey: string;
  /** The batch number to fill, as MIS spells it. */
  batch: string;
  /** The product MIS names (not a Robo design). */
  design: string;
  /** The first slab the plant has, its calendar day and thickness. */
  firstSlab: number;
  date: string;
  thickness: number | null;
  /** Every thickness the batch was made in, ascending (cm). */
  thicknesses: number[];
  /** Slabs of the batch the plant has. */
  slabs: number;
  /** A Robo setup already names this batch. */
  setUp: boolean;
}

/** The most batches offered, newest first. */
export const PLANT_BATCH_OFFERS_MAX = 25;

/**
 * The batches to offer: `hours` newest first (the order is the offer's), the
 * plant's rows for their numbers (the later row of a number given last
 * stands), and the batch keys Robo setups already name. A batch the plant has
 * no slab of is not offered.
 */
export function plantBatchOffers(hours: readonly MisBatchHour[], plant: readonly PlantBatchSlab[], roboKeys: ReadonlySet<string>, max = PLANT_BATCH_OFFERS_MAX): PlantBatchOffer[] {
  const order: string[] = [];
  const byKey = new Map<string, { batch: string; design: string; ranges: MisRange[] }>();
  for (const h of hours) {
    const key = String(h.batchKey ?? "").trim();
    if (!key) continue;
    let b = byKey.get(key);
    if (!b) {
      if (order.length >= max) continue;
      b = { batch: String(h.batch ?? "").trim() || key, design: String(h.design ?? "").trim(), ranges: [] };
      byKey.set(key, b);
      order.push(key);
    }
    if (!b.design && h.design) b.design = String(h.design).trim();
    b.ranges.push({ start: h.start, end: h.end });
  }
  const bySlab = new Map<number, PlantBatchSlab>();
  for (const s of plant) bySlab.set(s.slabNo, s);
  const out: PlantBatchOffer[] = [];
  for (const key of order) {
    const b = byKey.get(key)!;
    const own = misSlabNumbers(b.ranges).numbers.map((n) => bySlab.get(n)).filter((s): s is PlantBatchSlab => Boolean(s));
    if (!own.length) continue;
    const first = own[0];
    const cms = new Set<number>();
    for (const s of own) if (s.thicknessCm != null) cms.add(s.thicknessCm);
    const firstThk = own.find((s) => s.thicknessCm != null)?.thicknessCm ?? null;
    out.push({
      batchKey: key, batch: b.batch, design: b.design, firstSlab: first.slabNo,
      date: plantSlabDate(first.distAt, first.pressAt), thickness: firstThk,
      thicknesses: [...cms].sort((x, y) => x - y), slabs: own.length, setUp: roboKeys.has(key),
    });
  }
  return out;
}

/** The words of one offer in the pick-list: "D1507 · Alchemy · from 14 Nov · 2 cm and 3 cm · 68 slabs · already set up". */
export function plantBatchOfferWords(o: PlantBatchOffer): string {
  const parts = [o.batch];
  if (o.design) parts.push(o.design);
  if (o.date) parts.push(`from ${shortDate(o.date)}`);
  if (o.thicknesses.length) parts.push(o.thicknesses.map((t) => thicknessWords(t)).join(" and "));
  parts.push(`${o.slabs} slab${o.slabs === 1 ? "" : "s"}`);
  if (o.setUp) parts.push("already set up");
  return parts.join(" · ");
}
