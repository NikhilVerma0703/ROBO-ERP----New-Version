import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";
import { TS_FMT } from "@/lib/plantSync/machine/slabs-server";
import { plantThicknessCm } from "@/lib/robo/plantThickness";
import { misSlabNumbers, plantBatchOffers, PLANT_BATCH_OFFERS_MAX, type MisBatchHour, type PlantBatchSlab } from "@/lib/robo/plantSlabs";

/**
 * GET /api/robo/batch-recipes/plant-batches
 *
 * The batches a new Robo batch setup can be filled from (owner, 17 Nov 2026):
 * those MIS filed in the last days, newest first, each with its first slab's
 * day and the thicknesses the plant made it in (lib/robo/plantSlabs
 * plantBatchOffers). READS ONLY: MIS hours, plant_slab, Robo setups.
 *
 * Never fails the form: any fault answers { state: "failed" } and the setup is
 * typed as before.
 */
const DAYS_BACK = 10;
/** The most slab numbers read from the plant for the offer (25 batches of an ordinary size fit). */
const MAX_NUMBERS = 12000;

type PlantSql = { slab_no: number; dist_at: string | null; press_at: string | null; thk: string | null };

/** The Prisma error CODE only: a message can quote SQL values. */
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  try {
    if (!(await plantTablesReady())) return NextResponse.json({ state: "off", offers: [] });
    const since = new Date(Date.now() - DAYS_BACK * 86_400_000);
    // Which batches: those with an MIS hour in the last days, newest first.
    const recent = await prisma.mis.findMany({
      where: {
        batchKey: { not: null }, startingSlabNumber: { not: null }, endingSlabNumber: { not: null },
        // The same window rule the MIS readers use: the hour's own time, or its date when it has no time.
        OR: [{ dateAndTime: { gte: since } }, { dateAndTime: null, date: { gte: since } }],
      },
      select: { batchKey: true },
      orderBy: [{ dateAndTime: { sort: "desc", nulls: "last" } }, { date: "desc" }],
      take: 4000,
    });
    const keys: string[] = [];
    for (const r of recent) {
      const k = r.batchKey ?? "";
      if (k && !keys.includes(k)) keys.push(k);
      if (keys.length >= PLANT_BATCH_OFFERS_MAX) break;
    }
    if (!keys.length) return NextResponse.json({ state: "ok", offers: [] });
    // Then EVERY hour of those batches, so a batch that began before the window still starts at its first slab.
    const rows = await prisma.mis.findMany({
      where: { batchKey: { in: keys }, startingSlabNumber: { not: null }, endingSlabNumber: { not: null } },
      select: { batchKey: true, batch: true, design: true, startingSlabNumber: true, endingSlabNumber: true },
      orderBy: [{ dateAndTime: { sort: "desc", nulls: "last" } }, { date: "desc" }],
      take: 6000,
    });
    const rank = new Map(keys.map((k, i) => [k, i]));
    // Offered in the order of each batch's newest hour (rank), whatever order the hours come in.
    const hours: MisBatchHour[] = rows
      .map((r) => ({ batchKey: r.batchKey ?? "", batch: r.batch, design: r.design, start: r.startingSlabNumber, end: r.endingSlabNumber }))
      .sort((a, b) => (rank.get(a.batchKey) ?? 99) - (rank.get(b.batchKey) ?? 99));
    const { numbers } = misSlabNumbers(hours.map((h) => ({ start: h.start, end: h.end })), MAX_NUMBERS);
    if (!numbers.length) return NextResponse.json({ state: "ok", offers: [] });

    const [plant, setups] = await Promise.all([
      // Ordered so the later plant row of a number (by F_ID) is given last and stands.
      prisma.$queryRaw<PlantSql[]>`
        SELECT s.slab_no, to_char(s.sts_begin, ${TS_FMT}) AS dist_at, to_char(s.pre_begin, ${TS_FMT}) AS press_at,
               s.data->>'F_SLAB_THICKNESS' AS thk
          FROM plant_slab s
         WHERE s.slab_no = ANY(${numbers}::int[])
         ORDER BY s.slab_no, s.f_id
         LIMIT ${MAX_NUMBERS * 2}`,
      prisma.roboBatchRecipe.findMany({ where: { batchNo: { not: null } }, select: { batchNo: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    ]);
    const slabs: PlantBatchSlab[] = plant.map((r) => ({ slabNo: Number(r.slab_no), distAt: r.dist_at, pressAt: r.press_at, thicknessCm: plantThicknessCm(r.thk) }));
    const roboKeys = new Set(setups.map((s) => normalizeBatch(s.batchNo)).filter(Boolean));
    return NextResponse.json({ state: "ok", offers: plantBatchOffers(hours, slabs, roboKeys) });
  } catch (e) {
    console.warn(`[robo/plant-batches] the plant's batches could not be read (${code(e)})`);
    return NextResponse.json({ state: "failed", offers: [] });
  }
}
