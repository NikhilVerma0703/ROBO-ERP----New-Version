import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { setupScalarData } from "@/lib/robo/setupMasters";
import { registerTypedMasters, resolveDesignId } from "@/lib/robo/setupMastersDb";
import {
  PhotoPlanError, TRIAL_SETUP_INCLUDE, attachPhotos, readClaims, trialBatchNo, trialEntryCreateData, trialSaveProblem, trialSetupView,
  type TrialEntryInput,
} from "@/lib/robo/trialDb";

/**
 * POST /api/robo/trial/setups — save a trial slab's own batch setup (CR-003).
 *
 * The regular setup save (POST /api/robo/batch-recipes) plus the trial parts:
 * the setup is marked isTrial, each machine keeps its Liquid / Powder setting
 * (Normal or Define), and the reference photos the page uploaded are attached
 * (a Define setting must have one). Batch No. is optional, as on a regular
 * setup; Design is required, as on a regular setup.
 */
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const shiftId = typeof body.shiftId === "string" ? body.shiftId : "";
  if (!shiftId || !(await prisma.roboShift.findUnique({ where: { id: shiftId }, select: { id: true } }))) {
    return NextResponse.json({ error: "The running shift could not be found — reload the page." }, { status: 400 });
  }
  if (!String(body.designName ?? "").trim()) return NextResponse.json({ error: "Design is required." }, { status: 400 });

  const entries: TrialEntryInput[] = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.some((e) => e.machineId)) return NextResponse.json({ error: "At least one machine must be active." }, { status: 400 });
  const claims = readClaims(body.photos);
  const problem = await trialSaveProblem(entries, claims);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const designId = await resolveDesignId(body.designName);
    await registerTypedMasters(entries, designId);
    // A bare "1506" joins the existing production batch it names (D-1506).
    const batchNo = await trialBatchNo(body.batchNo);
    const saved = await prisma.$transaction(async (tx) => {
      const recipe = await tx.roboBatchRecipe.create({
        data: {
          shiftId,
          designId,
          programName: "",
          isTrial: true,
          ...setupScalarData(body),
          batchNo,
          entries: { create: trialEntryCreateData(entries) },
        },
        select: { id: true },
      });
      await attachPhotos(tx, recipe.id, claims, entries);
      return tx.roboBatchRecipe.findUniqueOrThrow({ where: { id: recipe.id }, include: TRIAL_SETUP_INCLUDE });
    });
    return NextResponse.json(trialSetupView(saved), { status: 201 });
  } catch (err) {
    if (err instanceof PhotoPlanError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Trial setup POST error:", err);
    return NextResponse.json({ error: "Failed to save the trial setup." }, { status: 500 });
  }
}
