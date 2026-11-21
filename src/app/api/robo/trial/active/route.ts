import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { TRIAL_SETUP_INCLUDE, trialSetupView } from "@/lib/robo/trialDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/robo/trial/active — what Trial Slab Entry opens on (CR-003).
 *
 * The same shape as /api/robo/shifts/active, so the page reads it the same way:
 *   * the running shift's own fields (the setup is saved onto it, like a
 *     regular one; all null when no shift is running yet);
 *   * batchRecipes — the trial setups on that shift still WAITING for their
 *     slab. A trial setup belongs to one trial slab, so once its slab is saved
 *     it leaves this list and the page opens a fresh setup;
 *   * productionRecords — the latest trial slabs, newest first (Recent Slabs),
 *     with their batch number so the table can show it ("--" when none).
 */
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const shift = await prisma.roboShift.findFirst({ where: { status: "ACTIVE" } });
  const [setups, records] = await Promise.all([
    shift
      ? prisma.roboBatchRecipe.findMany({
          where: { shiftId: shift.id, isTrial: true, productionRecords: { none: {} } },
          include: TRIAL_SETUP_INCLUDE,
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.roboProductionRecord.findMany({
      where: { batchRecipe: { isTrial: true } },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
        batchRecipe: { select: { id: true, batchNo: true, designName: true } },
      },
    }),
  ]);
  return NextResponse.json(
    {
      ...(shift ?? { id: null, date: null, status: null, shiftNumber: null }),
      batchRecipes: setups.map(trialSetupView),
      productionRecords: records,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
