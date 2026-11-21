import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";
import { TS_FMT } from "@/lib/plantSync/machine/slabs-server";
import { plantThicknessCm } from "@/lib/robo/plantThickness";
import { buildPlantSlabList, misSlabNumbers, PLANT_LIST_MAX_NUMBERS, type PlantSlabIn } from "@/lib/robo/plantSlabs";

/**
 * GET /api/robo/production/plant-slabs?batchRecipeId=<id>
 *
 * The slabs of a Robo batch setup as the plant has them, less those already in
 * the Robo register: the list the entry form offers so the operator picks a
 * slab instead of typing its number, date and shift (owner, 17 Nov 2026; the
 * rule is lib/robo/plantSlabs).
 *
 * READS ONLY. Three reads: the MIS hours filed under the setup's batch (which
 * slabs are the batch's), the plant's rows for those numbers (their times) and
 * the Robo records holding those numbers (already entered). Nothing is
 * written, here or to the plant's tables.
 *
 * ENTERED IS BY NUMBER, not by spelling: the register's slab number is text,
 * so "0172600" and "172600" are the plant's slab 172600 and it is not offered
 * again. A register number that is not a plain number ("140748-A") is no
 * plant slab and matches nothing.
 *
 * IT NEVER FAILS THE FORM. Whatever goes wrong answers a `state` the form
 * turns into one line ("type the slab as usual"); the entry form works exactly
 * as before without the list.
 *   nobatch  the setup has no batch number
 *   off      the plant's tables are not there
 *   nomis    no MIS hour is filed under the batch yet
 *   ok       the list (it may be empty: everything entered, or nothing the plant has)
 *   failed   a read failed
 */
type PlantSql = { slab_no: number; line_order: number | null; dist_at: string | null; press_at: string | null; dist_end: string | null; krs_end: string | null; thk: string | null };

/** The Prisma error CODE only: a message can quote SQL values. */
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const batchRecipeId = req.nextUrl.searchParams.get("batchRecipeId")?.trim() || "";
  if (!batchRecipeId) return NextResponse.json({ state: "nobatch" });
  try {
    const recipe = await prisma.roboBatchRecipe.findUnique({ where: { id: batchRecipeId }, select: { batchNo: true } });
    // The ERP's one spelling of a batch ("D-1507", "d1507" and "1507" are batch 1507), as MIS stores it in batch_key.
    const batchKey = normalizeBatch(recipe?.batchNo);
    if (!recipe || !batchKey) return NextResponse.json({ state: "nobatch" });
    if (!(await plantTablesReady())) return NextResponse.json({ state: "off", batchKey });

    const hours = await prisma.mis.findMany({
      where: { batchKey, startingSlabNumber: { not: null }, endingSlabNumber: { not: null } },
      select: { startingSlabNumber: true, endingSlabNumber: true },
      take: 3000,
    });
    const { numbers, capped } = misSlabNumbers(hours.map((h) => ({ start: h.startingSlabNumber, end: h.endingSlabNumber })));
    if (!numbers.length) return NextResponse.json({ state: "nomis", batchKey });

    const [plant, entered] = await Promise.all([
      // Two plant rows can share a slab number: ordered so the later one (by F_ID) is read last and stands.
      prisma.$queryRaw<PlantSql[]>`
        SELECT s.slab_no, s.line_order,
               to_char(s.sts_begin, ${TS_FMT}) AS dist_at, to_char(s.pre_begin, ${TS_FMT}) AS press_at,
               s.data->>'F_STS_END_DIST' AS dist_end, s.data->>'F_KRS_END_LAM' AS krs_end,
               s.data->>'F_SLAB_THICKNESS' AS thk
          FROM plant_slab s
         WHERE s.slab_no = ANY(${numbers}::int[])
         ORDER BY s.slab_no, s.f_id
         LIMIT ${PLANT_LIST_MAX_NUMBERS * 2}`,
      // In the register under any batch. The CASE keeps the cast off a number that is not one (AND gives no such order).
      prisma.$queryRaw<{ slabNumber: string }[]>`
        SELECT r."slabNumber"
          FROM "RoboProductionRecord" r
         WHERE CASE WHEN r."slabNumber" ~ '^[[:space:]]*[0-9]{1,9}[[:space:]]*$' THEN btrim(r."slabNumber")::int END = ANY(${numbers}::int[])`,
    ]);
    const rows: PlantSlabIn[] = plant.map((r) => ({
      slabNo: Number(r.slab_no), lineOrder: r.line_order == null ? null : Number(r.line_order), distAt: r.dist_at, pressAt: r.press_at,
      // The line head's end is kept as JSON text by the sync ("YYYY-MM-DDTHH:MM:SS.mmm", naive IST): read as written.
      headEndAt: r.dist_end || r.krs_end || null, headName: !r.dist_end && r.krs_end ? "Kreos" : "distributor",
      thicknessCm: plantThicknessCm(r.thk),
    }));
    const list = buildPlantSlabList(numbers, rows, entered.map((e) => e.slabNumber));
    return NextResponse.json({ state: "ok", batchKey, capped, ...list });
  } catch (e) {
    console.warn(`[robo/plant-slabs] the batch's plant slabs could not be read (${code(e)})`);
    return NextResponse.json({ state: "failed" });
  }
}
