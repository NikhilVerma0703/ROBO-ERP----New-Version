import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditRoboSetup, roboGate } from "@/lib/rbac";
import { setupScalarData } from "@/lib/robo/setupMasters";
import { registerTypedMasters, resolveDesignId } from "@/lib/robo/setupMastersDb";
import {
  PhotoPlanError, TRIAL_SETUP_INCLUDE, attachPhotos, readClaims, trialBatchNo, trialEntryCreateData, trialSaveProblem, trialSetupView,
  type TrialEntryInput,
} from "@/lib/robo/trialDb";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/robo/trial/setups/[id] — one trial setup with its photos (no bytes). */
export async function GET(_: NextRequest, { params }: Ctx) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const setup = await prisma.roboBatchRecipe.findFirst({ where: { id, isTrial: true }, include: TRIAL_SETUP_INCLUDE });
  if (!setup) return NextResponse.json({ error: "This trial setup no longer exists." }, { status: 404 });
  return NextResponse.json(trialSetupView(setup));
}

/**
 * PATCH /api/robo/trial/setups/[id] — correct a trial setup (CR-003): from the
 * page while its slab is still to be entered, or from Slab Records → Edit setup
 * afterwards. Rebuilds the machine rows like the regular PATCH (keeping each
 * machine's notes), and re-attaches the photos: unchanged ones are kept, newly
 * edited ones replace them, ones no longer named are removed.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  if (!(await canEditRoboSetup())) {
    return NextResponse.json({ error: "You do not have permission to change a production setup." }, { status: 403 });
  }
  const current = await prisma.roboBatchRecipe.findFirst({ where: { id, isTrial: true }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "This trial setup no longer exists." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  if (!String(body.designName ?? "").trim()) return NextResponse.json({ error: "Design is required." }, { status: 400 });
  const entries: TrialEntryInput[] = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.some((e) => e.machineId)) return NextResponse.json({ error: "At least one machine must be active." }, { status: 400 });
  const claims = readClaims(body.photos);
  const problem = await trialSaveProblem(entries, claims);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const designId = await resolveDesignId(body.designName);
    await registerTypedMasters(entries, designId);
    const batchNo = await trialBatchNo(body.batchNo); // see the POST route
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.roboBatchRecipeEntry.findMany({ where: { batchRecipeId: id }, select: { machineId: true, notes: true } });
      const notesByMachine = new Map(existing.map((e) => [e.machineId, e.notes]));
      await tx.roboBatchRecipeEntry.deleteMany({ where: { batchRecipeId: id } });
      await tx.roboBatchRecipe.update({
        where: { id },
        data: {
          designId,
          ...setupScalarData(body),
          batchNo,
          entries: { create: trialEntryCreateData(entries).map((r) => ({ ...r, notes: notesByMachine.get(r.machineId) ?? null })) },
        },
      });
      await attachPhotos(tx, id, claims, entries);
      return tx.roboBatchRecipe.findUniqueOrThrow({ where: { id }, include: TRIAL_SETUP_INCLUDE });
    });
    return NextResponse.json(trialSetupView(saved));
  } catch (err) {
    if (err instanceof PhotoPlanError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Trial setup PATCH error:", err);
    return NextResponse.json({ error: "Failed to update the trial setup." }, { status: 500 });
  }
}
