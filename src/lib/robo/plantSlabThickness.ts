// A NEW SLAB'S OWN THICKNESS, FROM THE PLANT (owner, 17 Nov 2026: "fill
// wherever possible", "most accurate"). The rule is lib/robo/plantSlabs
// (plantThicknessCm, slabThicknessToStore); this file only reads.
//
// READS ONLY, and never fails a save: when the plant cannot be read, does not
// know the slab, or the number is not a plain one, the answer is null and the
// slab is saved exactly as before (its thickness is the setup's).
import { prisma } from "@/lib/prisma";
import { plantTablesReady } from "@/lib/plantSync/ingest-store";
import { plainSlabNo, slabThicknessToStore } from "@/lib/robo/plantSlabs";
import { plantThicknessCm } from "@/lib/robo/plantThickness";

/** The Prisma error CODE only: a message can quote SQL values. */
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "error");

/** The plant's thickness of one slab in cm, or null. The later plant row (by F_ID) stands. */
export async function plantThicknessOfSlab(slabNumber: string | null | undefined): Promise<number | null> {
  const n = plainSlabNo(slabNumber);
  if (n == null) return null;
  try {
    if (!(await plantTablesReady())) return null;
    const rows = await prisma.$queryRaw<{ thk: string | null }[]>`
      SELECT s.data->>'F_SLAB_THICKNESS' AS thk
        FROM plant_slab s
       WHERE s.slab_no = ${n}
       ORDER BY s.f_id DESC
       LIMIT 1`;
    return plantThicknessCm(rows[0]?.thk);
  } catch (e) {
    console.warn(`[robo/thickness] the plant's thickness could not be read (${code(e)})`);
    return null;
  }
}

/**
 * What a new slab stores as its own thickness: the plant's when it differs
 * from its setup's, else null (the setup's stands). Never throws.
 */
export async function slabThicknessFromPlant(slabNumber: string, batchRecipeId: string | null | undefined): Promise<number | null> {
  const plantCm = await plantThicknessOfSlab(slabNumber);
  if (plantCm == null) return null;
  try {
    const setup = batchRecipeId
      ? await prisma.roboBatchRecipe.findUnique({ where: { id: batchRecipeId }, select: { thickness: true } })
      : null;
    return slabThicknessToStore(plantCm, setup?.thickness ?? null);
  } catch (e) {
    console.warn(`[robo/thickness] the setup's thickness could not be read (${code(e)})`);
    return null;
  }
}
