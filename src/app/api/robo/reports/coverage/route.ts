import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { productionDateSelectWhere, setupProductionDateSelectWhere } from "@/lib/robo/productionDate";
import { misSlabNumbers, PLANT_LIST_MAX_NUMBERS } from "@/lib/robo/plantSlabs";
import { coverage, COVERAGE_MAX_BATCHES } from "@/lib/robo/coverage";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/reports/coverage?date=&from=&to=&batch=
 * The same filter as /api/robo/reports/summary. For each Robo batch the filter
 * selects: the slabs the plant made, how many are entered in Robo, and the
 * numbers not entered (owner, 17 Nov 2026: "Made vs entered").
 *
 * Which batches: the setups the filter names (a batch filter), and, with a
 * date filter, the setups whose slabs or own date fall in it. One batch per
 * normalizeBatch key, newest setup first, at most COVERAGE_MAX_BATCHES; the
 * rest are counted in `leftOut`.
 *
 * Which slabs are a batch's: the MIS hour ranges under its batch key, as the
 * entry form's plant list reads them (lib/robo/plantSlabs), kept to those the
 * plant has. ENTERED IS BY NUMBER, as in production/plant-slabs.
 *
 * READS ONLY, and always HTTP 200: `state` "ok", "off" (the plant's tables are
 * not there) or "failed" (a read failed: the plant says nothing). The report
 * page beside it never waits for this.
 */
type CoverageBatch = { label: string; design: string; made: number; entered: number; notEntered: number[] };

/** The Prisma error CODE only: a message can quote SQL values. */
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

/** The most slab numbers read for one report: every batch shown together. */
const MAX_NUMBERS = PLANT_LIST_MAX_NUMBERS * 4;

/**
 * Made and entered for every batch shown, in THREE reads whatever the number of
 * batches: the MIS hours of all of them, the plant's slabs among all their
 * numbers, and the register's entries among the same numbers.
 */
async function allBatches(shown: readonly [string, { label: string; design: string }][]): Promise<{ batches: CoverageBatch[]; capped: boolean }> {
  const keys = shown.map(([k]) => k);
  const hoursTake = 3000 * Math.min(keys.length, 10);
  const hours = keys.length
    ? await prisma.mis.findMany({
        where: { batchKey: { in: keys }, startingSlabNumber: { not: null }, endingSlabNumber: { not: null } },
        select: { batchKey: true, startingSlabNumber: true, endingSlabNumber: true },
        take: hoursTake,
      })
    : [];
  const ranges = new Map<string, { start: number | null; end: number | null }[]>();
  for (const h of hours) {
    const k = h.batchKey ?? "";
    let list = ranges.get(k);
    if (!list) ranges.set(k, (list = []));
    list.push({ start: h.startingSlabNumber, end: h.endingSlabNumber });
  }
  const own = new Map<string, number[]>();
  const all = new Set<number>();
  // A full page of hours may not be all of them: said, never silent.
  let capped = keys.length > 0 && hours.length >= hoursTake;
  for (const k of keys) {
    const { numbers, capped: c } = misSlabNumbers(ranges.get(k) ?? []);
    if (c) capped = true;
    const kept: number[] = [];
    for (const n of numbers) {
      if (all.size >= MAX_NUMBERS && !all.has(n)) { capped = true; break; }
      all.add(n);
      kept.push(n);
    }
    own.set(k, kept);
  }
  const numbers = [...all];
  const [plant, entered] = numbers.length
    ? await Promise.all([
        prisma.$queryRaw<{ slab_no: number }[]>`
          SELECT DISTINCT s.slab_no
            FROM plant_slab s
           WHERE s.slab_no = ANY(${numbers}::int[])
           LIMIT ${MAX_NUMBERS}`,
        // By number: "0172600" and "172600" are one slab; a register number that is not a plain number matches nothing.
        prisma.$queryRaw<{ n: number }[]>`
          SELECT CASE WHEN r."slabNumber" ~ '^[[:space:]]*[0-9]{1,9}[[:space:]]*$' THEN btrim(r."slabNumber")::int END AS n
            FROM "RoboProductionRecord" r
           WHERE CASE WHEN r."slabNumber" ~ '^[[:space:]]*[0-9]{1,9}[[:space:]]*$' THEN btrim(r."slabNumber")::int END = ANY(${numbers}::int[])`,
      ])
    : [[], []];
  const plantHas = new Set(plant.map((p) => Number(p.slab_no)));
  const enteredNos = entered.map((e) => Number(e.n));
  const batches = shown.map(([k, b]): CoverageBatch => {
    const mine = (own.get(k) ?? []).filter((n) => plantHas.has(n));
    return { label: b.label, design: b.design, ...coverage(mine, enteredNos) };
  });
  return { batches, capped };
}

export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date")?.trim() || "";
  const from = sp.get("from")?.trim() || "";
  const to = sp.get("to")?.trim() || "";
  try {
    if (!(await plantTablesReady())) return NextResponse.json({ state: "off", batches: [], leftOut: 0 });

    const batchIds = await resolveBatchRecipeIds(sp.get("batch"));
    const dateWhere = productionDateSelectWhere({ date, from, to });
    const idIn: Prisma.RoboBatchRecipeWhereInput = batchIds !== null ? { id: { in: batchIds } } : {};
    let where: Prisma.RoboBatchRecipeWhereInput;
    if (dateWhere) {
      // The setups of the slabs the filter selects, and the setups dated in it.
      const recs = await prisma.roboProductionRecord.findMany({
        where: { ...dateWhere, ...(batchIds !== null ? { batchRecipeId: { in: batchIds } } : {}) },
        select: { batchRecipeId: true },
        distinct: ["batchRecipeId"],
      });
      const setupDate = setupProductionDateSelectWhere({ date, from, to });
      where = {
        ...idIn,
        OR: [
          { id: { in: recs.map((r) => r.batchRecipeId).filter((x): x is string => !!x) } },
          ...(setupDate ? [setupDate as Prisma.RoboBatchRecipeWhereInput] : []),
        ],
      };
    } else {
      where = idIn;
    }
    const recipes = await prisma.roboBatchRecipe.findMany({
      where: { ...where, batchNo: { not: null } },
      select: { batchNo: true, designName: true },
      orderBy: { createdAt: "desc" },
    });
    // One entry per batch key; the newest setup names it.
    const seen = new Map<string, { label: string; design: string }>();
    for (const r of recipes) {
      const key = normalizeBatch(r.batchNo);
      if (key && !seen.has(key)) seen.set(key, { label: String(r.batchNo).trim(), design: r.designName ?? "" });
    }
    const all = [...seen.entries()];
    const shown = all.slice(0, COVERAGE_MAX_BATCHES);
    const { batches, capped } = await allBatches(shown);
    return NextResponse.json({ state: "ok", batches, leftOut: all.length - shown.length, capped });
  } catch (e) {
    console.warn(`[robo/reports/coverage] the plant's slabs could not be read (${code(e)})`);
    return NextResponse.json({ state: "failed", batches: [], leftOut: 0 });
  }
}
