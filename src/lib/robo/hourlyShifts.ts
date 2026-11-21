/**
 * Which shift each hour of the "Production Rate per Hour" chart belongs to, and
 * how the chart draws that: one continuous line whose COLOUR changes at the
 * shift boundaries, and one bold label per block under the axis naming the
 * shift and the slabs that came off the line in it.
 *
 * Pure and alias-free so `node --test` can reach it, and kept out of the chart
 * component so the blocks, the counts and the colour stops can be pinned by
 * tests rather than eyeballed in a browser.
 *
 * ── THE SHIFT OF AN HOUR, NOT OF A SLAB ───────────────────────────────────
 * The chart's X-axis is a run of clock HOURS, so the shift here is a property
 * of the hour, not of any slab in it: 16:00–17:00 is Shift B whatever the slabs
 * that finished in it happen to carry. The boundaries are the plant's own, the
 * same three windows productionShift.ts defines for a slab — so a historical
 * batch, whose slabs were saved long before the Shift field existed, is
 * coloured exactly as correctly as one entered today. Nothing is read off the
 * database to colour this chart.
 *
 * ── WHY SPANS AND NOT SEGMENTS ────────────────────────────────────────────
 * The line stays ONE line. Splitting it into three series (one per shift) is
 * the obvious way to colour it and the wrong one: each series would end where
 * the next begins, so every boundary gains a visible seam or a gap, the
 * monotone curve is re-fitted per piece, and three legend entries appear for
 * what is one trend. Instead the single path is stroked with a gradient whose
 * stops are HARD — two stops at the same offset — so the colour changes at a
 * point and nowhere blends. shiftSpans() returns those offsets.
 *
 * Offsets are fractions of the line's own bounding box, which runs from the
 * first point to the last. So point i sits at i/(n-1), independent of the
 * chart's margins, axis width and padding — nothing here needs to know the
 * pixel geometry, and the colours cannot drift out of step with the plot.
 *
 * ── THE SLABS OF A SHIFT ──────────────────────────────────────────────────
 * The count under a shift's name is that shift's slabs as the rest of the ERP
 * reads them: each finished slab once, under its OWN Shift — productionShiftOf,
 * the operator's pick, else the shift its In Time falls in — in the stretch of
 * that shift it was made in. So it is the figure the Shift column of Download
 * Slab Records gives for the same batch.
 *
 * It used to be the line's own hours added up, which counts a slab by the hour
 * its Out Time fell in: a slab in at 13:50 and out at 14:10 is Shift A in the
 * export and on the slab page, and the band put it under B (code review,
 * 26 Oct 2026). The line above still counts by Out Time — the hour a slab came
 * off — so over a boundary hour the points and the band can differ by the
 * slabs that straddled it. Over the run they add up to the same total: every
 * slab the line counts is counted once on the band, and nothing else is.
 *
 * hourlyProduction places each slab's count in an hour of its own shift
 * (`shiftSlabs`, through shiftHourOf below), and every hour belongs to exactly
 * ONE block, so a block's count is its hours' `shiftSlabs` added up. A block
 * that the run only part-covers is counted over the part that was run: a batch
 * that started at 16:00 has no 14:00–16:00 to count, and its Shift B figure is
 * the slabs that batch made on Shift B.
 */

import {
  SHIFT_WINDOWS,
  productionShiftOf,
  type ShiftCode,
  type ShiftedRecord,
} from "./productionShift.ts";

/** Minutes in a day. */
const DAY = 1440;

/**
 * The shift an hour of the day falls in: 6–13 → A, 14–21 → B, 22–5 → C. Takes
 * the hour alone (0–23), the `hour` an HourBucket already carries. Any other
 * number is wrapped into the day first, so an absolute hour works too.
 */
export function shiftOfHour(hour: number): ShiftCode {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = h * 60;
  for (const w of SHIFT_WINDOWS) {
    if (w.from < w.to ? m >= w.from && m < w.to : m >= w.from || m < w.to) return w.code;
  }
  /* istanbul ignore next — the three windows cover the clock */
  return SHIFT_WINDOWS[0].code;
}

/** One unbroken stretch of hours on the same shift, in bucket indices. */
export interface ShiftBlock {
  code: ShiftCode;
  /** First and last bucket index of the stretch, both inclusive. */
  from: number;
  to: number;
  /** How many hours it covers. */
  hours: number;
  /** The bucket to hang the label on — the middle of the stretch. */
  mid: number;
  /** The slabs of the shift in the stretch: its hours' counts added up. 0 when
   *  the caller gave no counts, and 0 for a shift that finished nothing. */
  slabs: number;
}

/**
 * The absolute hour a finished slab is counted in on the shift band: inside the
 * stretch of its OWN Shift (productionShiftOf) nearest to when it went in.
 * `at` is that moment in absolute minutes — the slab's placed In, else its Out.
 *
 * With no Shift stored, that stretch is the one `at` falls in, so this is just
 * the In hour. A Shift picked across a boundary counts in the nearest edge of
 * that shift: A on a slab in at 14:05 is the 13:00 hour of the A that ended five
 * minutes before, not the next morning's A. A slab with no shift at all (no
 * pick and no readable time) stays in its own hour.
 */
export function shiftHourOf(slab: ShiftedRecord, at: number): number {
  const w = SHIFT_WINDOWS.find((x) => x.code === productionShiftOf(slab));
  if (!w) return Math.floor(at / 60);
  const length = (((w.to - w.from) % DAY) + DAY) % DAY || DAY;
  // The shift's stretches on the day before, the day of and the day after.
  const day = Math.floor(at / DAY);
  let best = { start: 0, gap: Infinity };
  for (let d = day - 1; d <= day + 1; d++) {
    const start = d * DAY + w.from;
    const gap = at < start ? start - at : Math.max(0, at - (start + length - 1));
    if (gap < best.gap) best = { start, gap };
  }
  return Math.floor(Math.min(Math.max(at, best.start), best.start + length - 1) / 60);
}

/**
 * The hours split into consecutive same-shift blocks, in order. A run crossing
 * midnight simply continues: 22:00 → 06:00 is ONE block of Shift C whether or
 * not the date changed inside it, which is what the night shift is.
 *
 * `slabs` is the per-hour counts, in the same order as `hours` — bucket i's
 * count is slabs[i], so `data.map(b => b.shiftSlabs)` of the chart's own
 * buckets is exactly what to pass. Each one lands in the single block that
 * holds its hour.
 */
export function shiftBlocks(hours: readonly number[], slabs: readonly number[] = []): ShiftBlock[] {
  const blocks: ShiftBlock[] = [];
  hours.forEach((h, i) => {
    const code = shiftOfHour(h);
    const n = Number.isFinite(slabs[i]) ? (slabs[i] as number) : 0;
    // The hours arrive in order, so the open block is always the previous hour's.
    const last = blocks[blocks.length - 1];
    if (last && last.code === code) {
      last.to = i;
      last.hours = last.to - last.from + 1;
      last.mid = Math.floor((last.from + last.to) / 2);
      last.slabs += n;
    } else {
      blocks.push({ code, from: i, to: i, hours: 1, mid: i, slabs: n });
    }
  });
  return blocks;
}

/** A stretch of the line in one colour, as fractions (0–1) of the line's own
 *  width. `from` of the first span is 0 and `to` of the last is 1. */
export interface ShiftSpan {
  code: ShiftCode;
  from: number;
  to: number;
}

/**
 * The colour stops for the line, one span per block.
 *
 * A boundary sits HALFWAY between the last hour of one shift and the first hour
 * of the next — which is exactly where the shift changes, since those two
 * points are the hour before and the hour after 06:00 / 14:00 / 22:00. The
 * colour therefore turns on the boundary itself, not a point early or late.
 *
 * One hour of data has no width to grade across, so it is a single full span.
 */
export function shiftSpans(hours: readonly number[]): ShiftSpan[] {
  const blocks = shiftBlocks(hours);
  if (blocks.length === 0) return [];
  const n = hours.length;
  if (n < 2) return [{ code: blocks[0].code, from: 0, to: 1 }];
  const at = (boundaryIndex: number) => (boundaryIndex - 0.5) / (n - 1);
  return blocks.map((b, k) => ({
    code: b.code,
    from: k === 0 ? 0 : at(b.from),
    to: k === blocks.length - 1 ? 1 : at(b.to + 1),
  }));
}

/**
 * What a block's label reads: the shift, and under it the slabs it produced —
 *
 *     SHIFT B
 *     39 SLABS
 *
 * TWO LINES, not "SHIFT B: 39 SLABS" on one, and the reason is measured. Set
 * bold at 14px, "SHIFT B" is 70px wide and the whole sentence is 166px, while
 * the chart gives every hour 52px: on one line the label would need a FOUR-hour
 * block to clear its neighbours, and the first and last blocks of a run are
 * routinely shorter than that — a batch that starts at 20:00 leaves two hours
 * of Shift B. Stacked, the wider of the two lines is the count ("128 SLABS" is
 * 79px at 12px), which two hours already covers with room to spare.
 *
 * A one-hour block — a run that starts or ends on a shift's last hour — shows
 * the letter and the bare number, which the hours either side already explain.
 */
export function shiftBlockLines(block: ShiftBlock): [string, string] {
  return [shiftBlockLabel(block), shiftBlockCount(block)];
}

/** Line one: the shift's name, or its letter alone in a one-hour block. */
export function shiftBlockLabel(block: ShiftBlock): string {
  return block.hours >= 2 ? `SHIFT ${block.code}` : block.code;
}

/** Line two: the slabs the shift produced. "1 SLAB" reads as English, and a
 *  shift that finished nothing says "0 SLABS" rather than going blank — an
 *  empty line under a named shift reads as a bug, not as a quiet night. */
export function shiftBlockCount(block: ShiftBlock): string {
  const n = block.slabs;
  return block.hours >= 2 ? `${n} ${n === 1 ? "SLAB" : "SLABS"}` : String(n);
}
