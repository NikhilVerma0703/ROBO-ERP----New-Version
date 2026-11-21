/**
 * Adding a name to a Robo master list (Designs, Programs, Tools, Liquids,
 * Powders) — CR-002, 20 Nov 2026.
 *
 * Each list's name is unique in the database. The POST routes used to hand the
 * name straight to Prisma, so a name already on the list failed on the unique
 * index and came back as a bare HTTP 500 (and the Master Lists screens, which
 * did not read the answer, said nothing at all). They now ask first and answer
 * 409 with a sentence, the way Delay Codes always has; a create that loses a
 * race to the same name is caught on Prisma's P2002 and answered the same way.
 *
 * Pure and import-free, so `node --test` can reach it.
 */

/** The name as it will be stored: trimmed; "" when missing or not text. */
export function cleanMasterName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The refusal for a name already on the list. */
export function duplicateNameError(kind: string, name: string): string {
  return `A ${kind} named "${name}" already exists.`;
}

/** The refusal for an empty name. */
export function missingNameError(kind: string): string {
  return `Enter the ${kind} name.`;
}

/** True for Prisma's unique-constraint failure (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
