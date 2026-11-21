/**
 * Trial Slab Entry — the database half (CR-003). The rules are in trial.ts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PHOTO_KINDS, isPhotoKind, parseSetting, planPhotos, resolveTrialBatchNo, trialSetupProblem,
  type PhotoClaim, type PhotoKind,
} from "@/lib/robo/trial";
import { batchNosMatch, canonBatchNo } from "@/lib/robo/batchNo";
import { entryCreateData, type SetupEntryInput } from "@/lib/robo/setupMasters";

/** A photo as the page sees it: never the bytes, only what to ask for. */
export interface PhotoMeta {
  id: string;
  machineId: string | null;
  kind: string | null;
  hasEdited: boolean;
  notes: string | null;
  edits: unknown;
  originalName: string | null;
}

/** The photo columns the page needs (no image bytes). */
export const PHOTO_META_SELECT = {
  id: true, machineId: true, kind: true, notes: true, edits: true, originalName: true, editedType: true,
} as const;

export function photoMeta(p: { id: string; machineId: string | null; kind: string | null; notes: string | null; edits: unknown; originalName: string | null; editedType: string | null }): PhotoMeta {
  return { id: p.id, machineId: p.machineId, kind: p.kind, hasEdited: Boolean(p.editedType), notes: p.notes, edits: p.edits ?? null, originalName: p.originalName };
}

/** What a trial setup is loaded with, everywhere the page reads one. */
export const TRIAL_SETUP_INCLUDE = {
  design: true,
  program: true,
  entries: { include: { machine: true } },
  referencePhotos: { select: PHOTO_META_SELECT },
} satisfies Prisma.RoboBatchRecipeInclude;

type LoadedSetup = Prisma.RoboBatchRecipeGetPayload<{ include: typeof TRIAL_SETUP_INCLUDE }>;

/** A loaded trial setup with its photos as PhotoMeta. */
export function trialSetupView(s: LoadedSetup) {
  const { referencePhotos, ...rest } = s;
  return { ...rest, photos: referencePhotos.map(photoMeta) };
}

/** A trial setup entry as the save sends it: the regular fields plus the two settings. */
export interface TrialEntryInput extends SetupEntryInput {
  liquidSetting?: string | null;
  powderSetting?: string | null;
}

/** The rows a trial setup's entries are created with: the regular ones plus the settings. */
export function trialEntryCreateData(entries: readonly TrialEntryInput[]) {
  const byMachine = new Map(entries.filter((e) => e.machineId).map((e) => [e.machineId as string, e]));
  return entryCreateData(entries).map((row) => {
    const e = byMachine.get(row.machineId);
    return { ...row, liquidSetting: parseSetting(e?.liquidSetting), powderSetting: parseSetting(e?.powderSetting) };
  });
}

/** The photo claims a save sends, read safely (anything malformed is dropped). */
export function readClaims(value: unknown): PhotoClaim[] {
  if (!Array.isArray(value)) return [];
  const out: PhotoClaim[] = [];
  for (const v of value) {
    const c = v as { machineId?: unknown; kind?: unknown; photoId?: unknown };
    if (typeof c?.machineId === "string" && isPhotoKind(c.kind) && typeof c.photoId === "string" && c.photoId) {
      out.push({ machineId: c.machineId, kind: c.kind as PhotoKind, photoId: c.photoId });
    }
  }
  return out;
}

/**
 * Why this trial setup cannot be saved, or null: a Liquid or Powder set to
 * Define with no reference photo among the claims.
 */
export async function trialSaveProblem(entries: readonly TrialEntryInput[], claims: readonly PhotoClaim[]): Promise<string | null> {
  const ids = entries.map((e) => e.machineId).filter((x): x is string => Boolean(x));
  const machines = await prisma.roboMachine.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(machines.map((m) => [m.id, m.name]));
  const has = (machineId: string, kind: PhotoKind) => claims.some((c) => c.machineId === machineId && c.kind === kind);
  return trialSetupProblem(
    entries.filter((e) => e.machineId).map((e) => ({
      machineName: nameOf.get(e.machineId as string) ?? "A robot",
      hasPowder: nameOf.get(e.machineId as string) !== "Roymix",
      liquidSetting: e.liquidSetting,
      powderSetting: e.powderSetting,
      liquidPhoto: has(e.machineId as string, "LIQUID"),
      powderPhoto: has(e.machineId as string, "POWDER"),
    })),
    (n) => ({ "Roycut-1": "Robo1", Roymix: "Robo2", "Roycut-2": "Robo3", "Roycut-3": "Robo4" } as Record<string, string>)[n] ?? n,
  );
}

/**
 * The batch number to store for a trial setup: a bare "1506" takes the
 * spelling of the one existing production batch it matches ("D-1506"), so
 * the trial slab reads "D-1506 (Trial Slab)" and groups with its batch
 * (resolveTrialBatchNo says when). Only regular setups are consulted.
 */
export async function trialBatchNo(typed: unknown): Promise<string | null> {
  const raw = typeof typed === "string" ? typed : "";
  if (!raw.trim()) return null;
  const rows = await prisma.roboBatchRecipe.findMany({
    where: { isTrial: false, batchNo: { not: null } },
    select: { batchNo: true },
    orderBy: { createdAt: "desc" },
    distinct: ["batchNo"],
    take: 2000,
  });
  return resolveTrialBatchNo(raw, rows.map((r) => r.batchNo as string), canonBatchNo, batchNosMatch);
}

/** A photo save that cannot go ahead; its message is what the page shows. */
export class PhotoPlanError extends Error {}

/**
 * Attaches the claimed photos to this trial setup, inside the save's
 * transaction (planPhotos decides; this does it):
 *   uploaded photo        → claimed by this setup;
 *   this setup's photo    → kept (its machine / consumable restated);
 *   another trial's photo → copied (Copy from previous record), never moved;
 *   this setup's photo the save no longer names → removed.
 * Only a claim for a consumable set to Define is kept: a photo for a Normal
 * setting is dropped rather than stored against nothing.
 */
export async function attachPhotos(
  tx: Prisma.TransactionClient,
  recipeId: string,
  claims: readonly PhotoClaim[],
  entries: readonly TrialEntryInput[],
): Promise<void> {
  const defined = (machineId: string, kind: PhotoKind) => {
    const e = entries.find((x) => x.machineId === machineId);
    return parseSetting(kind === "LIQUID" ? e?.liquidSetting : e?.powderSetting) === "DEFINE";
  };
  const wanted = claims.filter((c) => defined(c.machineId, c.kind));
  const found = await tx.roboReferencePhoto.findMany({
    where: { id: { in: wanted.map((c) => c.photoId) } },
    select: { id: true, batchRecipeId: true },
  });
  const current = await tx.roboReferencePhoto.findMany({ where: { batchRecipeId: recipeId }, select: { id: true } });
  const plan = planPhotos(recipeId, wanted, found, current.map((c) => c.id));
  if (plan.problem) throw new PhotoPlanError(plan.problem);

  if (plan.remove.length) await tx.roboReferencePhoto.deleteMany({ where: { id: { in: plan.remove } } });
  // Kept photos first move out of the way (a swap of two slots would otherwise
  // clash on the (setup, machine, kind) unique index), then each lands.
  const kept = plan.actions.filter((a) => a.action === "keep").map((a) => a.claim.photoId);
  if (kept.length) await tx.roboReferencePhoto.updateMany({ where: { id: { in: kept } }, data: { machineId: null, kind: null } });
  for (const a of plan.actions) {
    const { machineId, kind, photoId } = a.claim;
    if (a.action === "copy") {
      const src = await tx.roboReferencePhoto.findUniqueOrThrow({ where: { id: photoId } });
      await tx.roboReferencePhoto.create({
        data: {
          batchRecipeId: recipeId, machineId, kind,
          originalData: src.originalData, originalType: src.originalType, originalName: src.originalName,
          editedData: src.editedData, editedType: src.editedType,
          edits: (src.edits ?? undefined) as Prisma.InputJsonValue | undefined,
          notes: src.notes,
        },
      });
    } else {
      await tx.roboReferencePhoto.update({ where: { id: photoId }, data: { batchRecipeId: recipeId, machineId, kind } });
    }
  }
}

/** Photos uploaded but never saved with a setup, older than a day, are cleared. */
export async function clearStalePhotos(): Promise<void> {
  await prisma.roboReferencePhoto.deleteMany({
    where: { batchRecipeId: null, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  }).catch(() => null);
}

export { PHOTO_KINDS };
