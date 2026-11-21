/**
 * Trial Slab Entry — the rules shared by the page, the API and the reports
 * (CR-003, 20 Nov 2026).
 *
 * A trial slab is an ordinary production record whose setup is marked
 * `isTrial`. Each trial slab has its own setup (its own programs, liquids,
 * powders and reference photos), and it counts everywhere a regular slab does:
 * batch totals, Slab Records, reports, charts and downloads. What differs is
 * only how it is entered and how it is labelled — "D-1506 (Trial Slab)".
 *
 * Pure and import-free, so `node --test` can reach it.
 */

/** The words added to a trial slab's batch number wherever it is shown. */
export const TRIAL_SUFFIX = "(Trial Slab)";

/** What a trial slab's Batch No. reads as when it has none. */
export const NO_BATCH = "--";

/**
 * A slab's batch number as Slab Records, Complete Details and the downloads
 * show it: unchanged for a regular slab ("D-1506", or `blank` when it has
 * none), and "D-1506 (Trial Slab)" — or "-- (Trial Slab)" — for a trial slab.
 */
export function batchLabel(batchNo: string | null | undefined, isTrial: boolean | null | undefined, blank = "-"): string {
  const no = (batchNo ?? "").trim();
  if (!isTrial) return no || blank;
  return `${no || NO_BATCH} ${TRIAL_SUFFIX}`;
}

/** A batch cell read back from a sheet, with any "(Trial Slab)" taken off. */
export function stripTrialSuffix(value: string): string {
  return value.replace(/\s*\(\s*trial\s+slab\s*\)\s*$/i, "").trim();
}

/** True when a batch cell carries the "(Trial Slab)" label. */
export function hasTrialSuffix(value: string | null | undefined): boolean {
  return /\(\s*trial\s+slab\s*\)\s*$/i.test(value ?? "");
}

/* ── Liquid / Powder setting ─────────────────────────────────────────────── */

export const SETTING_NORMAL = "NORMAL";
export const SETTING_DEFINE = "DEFINE";
export type ConsumableSetting = typeof SETTING_NORMAL | typeof SETTING_DEFINE;
export const SETTING_OPTIONS: readonly { value: ConsumableSetting; label: string }[] = [
  { value: SETTING_NORMAL, label: "Normal" },
  { value: SETTING_DEFINE, label: "Define" },
];

/** A stored or sent setting, read safely: anything that is not DEFINE is NORMAL. */
export function parseSetting(value: unknown): ConsumableSetting {
  return typeof value === "string" && value.trim().toUpperCase() === SETTING_DEFINE ? SETTING_DEFINE : SETTING_NORMAL;
}

export function settingLabel(value: string | null | undefined): string {
  return parseSetting(value) === SETTING_DEFINE ? "Define" : "Normal";
}

export const PHOTO_KINDS = ["LIQUID", "POWDER"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function isPhotoKind(value: unknown): value is PhotoKind {
  return value === "LIQUID" || value === "POWDER";
}

/** What one machine of a trial setup says about its consumables. */
export interface TrialEntryCheck {
  machineName: string;
  hasPowder: boolean; // Robo2 (Roymix) takes liquid only
  liquidSetting: string | null | undefined;
  powderSetting: string | null | undefined;
  liquidPhoto: boolean;
  powderPhoto: boolean;
}

/**
 * Why a trial setup cannot be saved yet, or null. "Define" needs its reference
 * photo; that is the only extra rule (names are typed by hand for both
 * settings, and stay optional exactly as on a regular setup).
 */
export function trialSetupProblem(entries: readonly TrialEntryCheck[], label: (name: string) => string = (n) => n): string | null {
  for (const e of entries) {
    if (parseSetting(e.liquidSetting) === SETTING_DEFINE && !e.liquidPhoto) {
      return `${label(e.machineName)}: Liquid is set to Define — add its reference photo.`;
    }
    if (e.hasPowder && parseSetting(e.powderSetting) === SETTING_DEFINE && !e.powderPhoto) {
      return `${label(e.machineName)}: Powder is set to Define — add its reference photo.`;
    }
  }
  return null;
}

/* ── Photos ───────────────────────────────────────────────────────────────── */

/** The largest original photo accepted (a phone camera's full-size JPEG fits). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** Image types the reference photo accepts. */
export function isImageType(type: string | null | undefined): boolean {
  return /^image\/(jpeg|png|webp|gif|heic|heif|bmp)$/i.test(type ?? "");
}

/** One photo a setup save names: which machine and consumable it is for. */
export interface PhotoClaim {
  machineId: string;
  kind: PhotoKind;
  photoId: string;
}

/** What a stored photo is, as far as attaching it to a setup goes. */
export interface PhotoOwner {
  id: string;
  batchRecipeId: string | null;
}

export type PhotoAction =
  | { action: "claim"; claim: PhotoClaim }   // uploaded, not yet on any setup
  | { action: "keep"; claim: PhotoClaim }    // already on this setup
  | { action: "copy"; claim: PhotoClaim };   // on another setup (copied from a previous trial)

export interface PhotoPlan {
  actions: PhotoAction[];
  /** This setup's photos that the save no longer names — removed. */
  remove: string[];
  /** A reason the save cannot go ahead, or null. */
  problem: string | null;
}

/**
 * How a setup save attaches its reference photos (pure; the route runs it).
 *
 * A photo is never moved off another setup: one that belongs to a different
 * trial (Copy from previous record) is COPIED, so the earlier trial keeps its
 * own. A photo of this setup that the save does not name is removed. Two
 * claims for the same machine and consumable, or a photo that does not exist,
 * stop the save.
 */
export function planPhotos(recipeId: string | null, claims: readonly PhotoClaim[], found: readonly PhotoOwner[], current: readonly string[]): PhotoPlan {
  const byId = new Map(found.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const actions: PhotoAction[] = [];
  for (const claim of claims) {
    const slot = `${claim.machineId}|${claim.kind}`;
    if (seen.has(slot)) return { actions: [], remove: [], problem: "A machine has two photos for the same consumable." };
    seen.add(slot);
    const photo = byId.get(claim.photoId);
    if (!photo) return { actions: [], remove: [], problem: "A reference photo could not be found — add it again." };
    if (photo.batchRecipeId === null) actions.push({ action: "claim", claim });
    else if (recipeId !== null && photo.batchRecipeId === recipeId) actions.push({ action: "keep", claim });
    else actions.push({ action: "copy", claim });
  }
  const keep = new Set(actions.filter((a) => a.action === "keep").map((a) => a.claim.photoId));
  return { actions, remove: current.filter((id) => !keep.has(id)), problem: null };
}

/* ── Batch No. ────────────────────────────────────────────────────────────── */

/**
 * The batch number a trial setup is stored under.
 *
 * Trial slabs may join an existing production batch ("Batch 1506 can contain
 * both regular production slabs and trial slabs"), and the register often
 * drops the series letter: an operator types "1506" for D-1506. When a BARE
 * number is typed and it matches exactly one existing production batch series
 * (D-1506, but not both A-1506 and D-1506), the trial takes that batch's own
 * spelling, so it reads "D-1506 (Trial Slab)" and groups with D-1506
 * everywhere. Anything else — a number with its own prefix, a number that
 * matches nothing or more than one series — is kept exactly as typed.
 *
 * `existing` are production batch numbers (newest first); `canon` and `match`
 * are batchNo.ts's canonBatchNo / batchNosMatch, passed in so this stays pure.
 */
export function resolveTrialBatchNo(
  typed: string | null | undefined,
  existing: readonly string[],
  canon: (s: string) => string,
  match: (a: string, b: string) => boolean,
): string | null {
  const raw = (typed ?? "").trim();
  if (!raw) return null;
  if (!/^\d/.test(canon(raw))) return raw; // has its own series prefix
  const hits = existing.filter((b) => b && /^[A-Z]/.test(canon(b)) && match(raw, b));
  const series = new Set(hits.map((b) => canon(b)));
  return series.size === 1 ? hits[0].trim() : raw;
}

/* ── S.No. ────────────────────────────────────────────────────────────────── */

/**
 * The group a slab's S.No. (1..N in slab-number order) is counted in. Regular
 * slabs: their setup, exactly as before. Trial slabs have a setup each, so
 * they are counted together per batch — "D-1506 (Trial Slab)" reads 1..11 —
 * and a trial with no batch number is a group of its own.
 */
export function sequenceGroupKey(slab: { batchRecipeId: string | null; isTrial: boolean; batchKey: string | null }): string | null {
  if (!slab.batchRecipeId) return null;
  if (slab.isTrial && slab.batchKey) return `trial|${slab.batchKey}`;
  return slab.batchRecipeId;
}
