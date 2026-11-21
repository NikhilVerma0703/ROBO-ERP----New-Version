/**
 * "Shift" — which of the plant's three shifts a slab was made on.
 *
 * Pure and alias-free so `node --test` can reach it, exactly like its sibling
 * productionDate.ts, whose shape this follows field for field.
 *
 *   Shift A — 06:00 to 14:00
 *   Shift B — 14:00 to 22:00
 *   Shift C — 22:00 to 06:00   (wraps midnight)
 *
 * ── THE OPERATOR'S SHIFT, NOT THE SHIFT ROW ───────────────────────────────
 * `RoboShift` already carries a `shiftNumber`, and it is NOT this. That row is
 * plumbing the schema requires: the entry form creates ONE per day, silently,
 * the first time the tablet is used, and stamps it from the wall clock. Every
 * batch and every slab of that day hangs off that single row — so a day opened
 * at 07:00 would read "shift 1" on a slab made at 23:40, and a register typed
 * up the next morning would read the typist's shift for the whole night. That
 * is why Shift was pulled out of Complete Details and both Excel sheets.
 *
 * This is the other thing: the shift the operator picks on the slab, stored on
 * the slab, one per slab. It is what the register has always meant by Shift,
 * and it can now be shown again because it is now answerable.
 *
 * ── SLABS ENTERED BEFORE THIS FIELD EXISTED ───────────────────────────────
 * Nothing was back-filled: `productionShift` is NULL on every slab saved before
 * this, and on every imported one. Rather than leave three months of register
 * blank, productionShiftOf() reads the shift off the slab's own In Time when
 * nothing is stored — the same three windows, applied to the clock time the
 * operator already recorded. A stored value always wins, so the moment anyone
 * picks one it is the answer, and the derived reading never overwrites it:
 * nothing is written back, exactly as placeSlabs leaves stored dates alone.
 *
 * Times are "HH:MM" strings and dates yyyy-mm-dd, the convention the whole Robo
 * module uses — no Date object, no timezone, anywhere near this file.
 */

/** The three shifts, in the order they are offered and shown. */
export const SHIFT_CODES = ["A", "B", "C"] as const;

export type ShiftCode = (typeof SHIFT_CODES)[number];

export interface ShiftWindow {
  code: ShiftCode;
  /** First minute of the shift, 0–1439. */
  from: number;
  /** First minute AFTER it. Equal to or less than `from` means it wraps midnight. */
  to: number;
  /** "06:00–14:00" — the hours on their own. */
  hours: string;
  /** "Shift A — 06:00–14:00" — the whole thing, as the dropdown reads.
   *
   *  The hours are an en dash rather than "06:00 to 14:00" for one measured
   *  reason: on a tablet held in portrait the Shift box is 224px wide, a touch
   *  screen renders the form at 16px, and the spelt-out version comes to 197px
   *  against 186px of room — so the closed dropdown would have read
   *  "Shift C — 22:00 to 06:…". The dash costs nothing to read and fits with
   *  room to spare at every width the line uses. */
  label: string;
}

const win = (code: ShiftCode, from: number, to: number, hours: string): ShiftWindow => ({
  code,
  from,
  to,
  hours,
  label: `Shift ${code} — ${hours}`,
});

/** The plant's three shifts. C runs 22:00 → 06:00, so its window wraps. */
export const SHIFT_WINDOWS: readonly ShiftWindow[] = [
  win("A", 6 * 60, 14 * 60, "06:00–14:00"),
  win("B", 14 * 60, 22 * 60, "14:00–22:00"),
  win("C", 22 * 60, 6 * 60, "22:00–06:00"),
];

/** Minutes since midnight for "HH:MM", or null. Same reading as toMins in
 *  slabPlacement.ts; kept here so this file imports nothing. */
function toMins(t: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The shift a clock time falls in: "06:00"–"13:59" → A, "14:00"–"21:59" → B,
 * "22:00"–"05:59" → C. Each boundary belongs to the shift it STARTS, so 14:00
 * is B's first minute and not A's last. Null for anything that is not a time.
 */
export function shiftFromTime(time: string | null | undefined): ShiftCode | null {
  const m = toMins(time);
  if (m === null) return null;
  for (const w of SHIFT_WINDOWS) {
    const inside = w.from < w.to ? m >= w.from && m < w.to : m >= w.from || m < w.to;
    if (inside) return w.code;
  }
  return null; // unreachable: the three windows cover the clock
}

/** A stored or typed shift, read as one of the three codes. Accepts the code
 *  itself in any case ("a", "A"), the whole label a sheet may carry ("Shift A",
 *  "Shift A — 06:00 to 14:00"), and the 1/2/3 numbering the register importer
 *  and RoboShift.shiftNumber use. Anything else is null, never a guess. */
export function parseShiftCode(raw: unknown): ShiftCode | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? byNumber(raw) : null;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[123]$/.test(s)) return byNumber(Number(s));
  // "A", "a", "Shift C", "shift c — 22:00 to 06:00": the first letter after an
  // optional "shift", and nothing else before it.
  const m = /^(?:shifts?\b[\s._-]*)?([abc])\b/i.exec(s);
  return m ? (m[1].toUpperCase() as ShiftCode) : null;
}

const byNumber = (n: number): ShiftCode | null => SHIFT_CODES[n - 1] ?? null;

/** The shapes this needs, structural so any query shape satisfies them. */
export interface ShiftedRecord {
  /** The shift the operator picked for this slab. INVARIANT: "A", "B", "C" or
   *  NULL — never "" and never anything else; the API validates on the way in,
   *  so a reader can trust it. NULL on every slab saved before the field
   *  existed and on every imported one; those fall back to the In Time. */
  productionShift?: string | null;
  inTime?: string | null;
  outTime?: string | null;
}

/**
 * The shift to SHOW for a slab: the one stored on it, else the one its In Time
 * falls in, else (for the rare slab logged with only an Out Time) that one,
 * else "". Nothing is written back — a derived reading is a reading, and the
 * next operator to open the slab can still set it properly.
 */
export function productionShiftOf(record: ShiftedRecord | null | undefined): ShiftCode | "" {
  return (
    parseShiftCode(record?.productionShift) ||
    shiftFromTime(record?.inTime) ||
    shiftFromTime(record?.outTime) ||
    ""
  );
}

/** What a cell shows for a slab — the bare letter, or "-" when even the times
 *  cannot say. The register has always written the shift as a single letter. */
export function shiftCell(record: ShiftedRecord | null | undefined): string {
  return productionShiftOf(record) || "-";
}

/** "Shift A — 06:00 to 14:00" for a code, for the dropdown and anywhere the
 *  hours belong beside the letter. "" for a code that is not one of the three. */
export function shiftOptionLabel(code: string | null | undefined): string {
  const c = parseShiftCode(code);
  return SHIFT_WINDOWS.find((w) => w.code === c)?.label ?? "";
}
