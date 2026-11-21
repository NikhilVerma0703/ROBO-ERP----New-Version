// THE PLANT'S RECORD OF ONE SLAB, for the "From the plant" card on the Robo slab
// page (owner, 17 Nov 2026: "Slab's plant journey"). The words are made in
// slabPlantJourneyRules; this file only reads.
//
// READS ONLY, and only the columns named: plant rows hold large JSON, so the
// JSON keys wanted are picked out in SQL and nothing is ever selected whole.
// A plant time is read as text (to_char on the naive IST columns, the JSON text
// as stored) and normalised to "YYYY-MM-DDTHH:MM" by plantTime: it is never a
// JS Date. Guarded by plantTablesReady(); every fault means "the plant says
// nothing" (null, and only the Prisma error code is logged).
//
// WHICH PLANT ROW: the latest (ORDER BY f_id DESC LIMIT 1) of the slab number.
// WHICH BATCH: the MIS hour that holds the slab (the rule of lib/robo/plantSlabs:
// a believable hour range), else the plant's own run (sync_line_order_batch,
// resolved).
// WAS THE CYCLE ABORTED: the ERP's one rule (press-map pickSummary + isAborted:
// the press log's lowest lower-chamber vacuum is above 900 mbar), asked of the
// press log summaries of this slab number, as gates-server plantPressedSlabs does.
import "server-only";
import { prisma } from "@/lib/prisma";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";
import { TS_FMT } from "@/lib/plantSync/machine/slabs-server";
import { plantTime } from "@/lib/plantSync/match/match-rules";
import { isAborted, pickSummary, type PressSummaryRow } from "@/lib/plantSync/match/press-map";
import { lineHeadThicknessMm } from "@/lib/plantSync/match/line-head-rules";
import { MAX_SLABS_PER_HOUR } from "@/lib/shiftScoreMath";
import { misSlabNumbers } from "@/lib/robo/plantSlabs";
import type { JourneyRow } from "@/lib/robo/slabPlantJourneyRules";

type SlabSql = {
  line_order: number | null;
  sts_begin: string | null; sts_end: string | null;
  krs_begin: string | null; krs_end: string | null;
  pre_begin: string | null; pre_end: string | null;
  ove_begin: string | null; ove_end: string | null;
  thickness: string | null;
};

/** The Prisma error CODE only: a message can quote SQL values. */
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

/** A plant time as "YYYY-MM-DDTHH:MM", or null. */
const minuteOf = (v: unknown): string | null => plantTime(v)?.slice(0, 16) ?? null;

/** The MIS hour holding the slab: its batch, or null. */
async function misBatchOf(slabNo: number): Promise<string | null> {
  try {
    const hours = await prisma.$queryRaw<{ batch: string | null; starting_slab_number: number | null; ending_slab_number: number | null }[]>`
      SELECT m.batch, m.starting_slab_number, m.ending_slab_number
        FROM mis m
       WHERE m.starting_slab_number <= ${slabNo}::float8 AND m.ending_slab_number >= ${slabNo}::float8
         AND m.ending_slab_number - m.starting_slab_number < ${MAX_SLABS_PER_HOUR + 1}::float8
         AND btrim(COALESCE(m.batch, '')) <> ''
       ORDER BY m.date_and_time DESC NULLS LAST, m.id DESC
       LIMIT 5`;
    for (const h of hours) {
      // The same believable-hour rule the batch's list is made with.
      if (misSlabNumbers([{ start: h.starting_slab_number, end: h.ending_slab_number }]).numbers.includes(slabNo)) return String(h.batch).trim();
    }
    return null;
  } catch (e) {
    console.warn(`[robo/slab-journey] the MIS hour could not be read (${code(e)})`);
    return null;
  }
}

/** The plant's own run's batch for a line order (resolved only), or null. */
async function runBatchOf(lineOrder: number | null): Promise<string | null> {
  if (lineOrder === null) return null;
  try {
    const rows = await prisma.$queryRaw<{ batch: string | null }[]>`
      SELECT b.batch FROM sync_line_order_batch b
       WHERE b.line_order = ${lineOrder}::int AND b.state = 'resolved' AND btrim(COALESCE(b.batch, '')) <> ''
       LIMIT 1`;
    return rows[0]?.batch ? String(rows[0].batch).trim() : null;
  } catch (e) {
    console.warn(`[robo/slab-journey] the plant run's batch could not be read (${code(e)})`);
    return null;
  }
}

/**
 * Was the slab's press cycle aborted, by the rule the ERP already uses. True
 * or false when the press log has a summary for this cycle (pickSummary: same
 * slab number, first row within 30 minutes of the press begin); null when it
 * has none, or the press has no begin, or the read failed: not judged.
 */
async function abortedOf(slabNo: number, preBegin: string | null): Promise<boolean | null> {
  if (preBegin === null) return null;
  try {
    // Only the two keys the rule reads are picked out of the summary's JSON.
    const sums = (await prisma.$queryRaw<{ plant_key: string; slab_no: number | null; first_id: bigint | number | null; last_id: bigint | number | null; last_at: string | null; data: Record<string, unknown> | null }[]>`
      SELECT p.plant_key, p.slab_no, p.first_id, p.last_id, to_char(p.last_at, ${TS_FMT}) AS last_at,
             jsonb_build_object('firstAt', p.data->'firstAt', 'minLowerChamberVacuum', p.data->'minLowerChamberVacuum') AS data
        FROM plant_press_slab p
       WHERE p.slab_no = ${slabNo}::int`)
      .map((p): PressSummaryRow => ({
        plantKey: p.plant_key, slabNo: p.slab_no === null ? null : Number(p.slab_no), firstId: p.first_id === null ? null : Number(p.first_id),
        lastId: p.last_id === null ? null : Number(p.last_id), lastAt: plantTime(p.last_at), data: p.data ?? {},
      }));
    const s = pickSummary({ slabNo, preBegin: plantTime(preBegin) }, sums);
    return s ? isAborted(s) : null;
  } catch (e) {
    console.warn(`[robo/slab-journey] the press log could not be read (${code(e)})`);
    return null;
  }
}

/**
 * What the plant says of one slab number, and why when it says nothing:
 * "off" (no plant tables: the card is not shown), "none" (the plant has no row
 * for the number), "failed" (the read failed). Never throws.
 */
export type SlabPlantJourney = { state: "ok"; row: JourneyRow } | { state: "off" | "none" | "failed" };

export async function readSlabPlantJourney(slabNo: number): Promise<SlabPlantJourney> {
  try {
    if (!Number.isInteger(slabNo) || slabNo < 1) return { state: "none" };
    if (!(await plantTablesReady())) return { state: "off" };
    const rows = await prisma.$queryRaw<SlabSql[]>`
      SELECT s.line_order,
             to_char(s.sts_begin, ${TS_FMT}) AS sts_begin, s.data->>'F_STS_END_DIST' AS sts_end,
             to_char(s.krs_begin, ${TS_FMT}) AS krs_begin, s.data->>'F_KRS_END_LAM' AS krs_end,
             to_char(s.pre_begin, ${TS_FMT}) AS pre_begin, s.data->>'F_PRE_END' AS pre_end,
             s.data->>'F_OVE_BEGIN' AS ove_begin, to_char(s.ove_end, ${TS_FMT}) AS ove_end,
             s.data->>'F_SLAB_THICKNESS' AS thickness
        FROM plant_slab s
       WHERE s.slab_no = ${slabNo}::int
       ORDER BY s.f_id DESC
       LIMIT 1`;
    const r = rows[0];
    if (!r) return { state: "none" };
    const lineOrder = r.line_order === null ? null : Number(r.line_order);
    const preBegin = minuteOf(r.pre_begin);
    // The abort rule matches the press log by the press begin to the SECOND (plantTime needs the
    // seconds), so it is given the time as read, not the minute shown.
    const [misBatch, aborted] = await Promise.all([misBatchOf(slabNo), abortedOf(slabNo, r.pre_begin)]);
    const batch = misBatch ?? (await runBatchOf(lineOrder));
    return { state: "ok", row: {
      distBegin: minuteOf(r.sts_begin), distEnd: minuteOf(r.sts_end),
      krsBegin: minuteOf(r.krs_begin), krsEnd: minuteOf(r.krs_end),
      preBegin, preEnd: minuteOf(r.pre_end),
      oveIn: minuteOf(r.ove_begin), oveOut: minuteOf(r.ove_end),
      thicknessMm: lineHeadThicknessMm(r.thickness),
      batch,
      aborted,
    } };
  } catch (e) {
    console.warn(`[robo/slab-journey] the plant could not be read for a slab (${code(e)})`);
    return { state: "failed" };
  }
}
