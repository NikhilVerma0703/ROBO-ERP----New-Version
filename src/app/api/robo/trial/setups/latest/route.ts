import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { TRIAL_SETUP_INCLUDE, trialSetupView } from "@/lib/robo/trialDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/robo/trial/setups/latest — the setup to "Copy from previous record"
 * (CR-003): the setup of the most recently entered trial slab, with its slab
 * number so the page can say which one. Reading it changes nothing; the copy
 * is saved as a new setup (and its photos as new copies) only when the next
 * trial setup is saved.
 */
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const last = await prisma.roboProductionRecord.findFirst({
    where: { batchRecipe: { isTrial: true } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { slabNumber: true, batchRecipeId: true },
  });
  if (!last?.batchRecipeId) return NextResponse.json(null, { headers: { "Cache-Control": "no-store" } });
  const setup = await prisma.roboBatchRecipe.findUnique({ where: { id: last.batchRecipeId }, include: TRIAL_SETUP_INCLUDE });
  if (!setup) return NextResponse.json(null, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ slabNumber: last.slabNumber, setup: trialSetupView(setup) }, { headers: { "Cache-Control": "no-store" } });
}
