// THE MIXER'S SHARED CONTRACT (Machine Overview round 3a, MIXER-SPEC-FINAL section 11.1, 5 Nov 2026).
//
// The Mixer runner (match/mixer-map.ts, match/mixer-server.ts) writes plant rows into mixer_cycle; the stock
// draw, the undo script, the admin page and the dashboard (lib/plantSync/mixerStock/, scripts/undo-plant-sync-
// mixer.sql) read them. This file is what both sides agree on: the names, the columns the matcher may write and
// may never write, the shape of sync_match.plant_values / written for a Mixer match, and the flag words' prefix.
// A change here is agreed through the lead, never made by one side alone.
//
// PURE and IMPORT-FREE, so node --test and client code can load it.

export const MIXER_MACHINE = "MIXER" as const;
export const MIXER_MODEL = "MixerCycle" as const; // sync_match.model, sync_flag.model
export const MIX_PLANT_TABLE = "plant_mix" as const; // sync_match.plant_table, sync_flag.plant_table
export const MIXER_TABLE = "mixer_cycle" as const;
export const MIXER_AIRTABLE_PREFIX = "mixer-plant-";
export const PLANT_SYNC_USER = "plant-sync"; // = match-rules PLANT_SYNC_USER_ID (a test pins them equal)

export const mixerAirtableId = (fCode: string): string => MIXER_AIRTABLE_PREFIX + fCode.trim();

/** "151170022" from "mixer-plant-151170022"; null for anything else. */
export function fCodeOfMixerAirtableId(airtableId: unknown): string | null {
  if (typeof airtableId !== "string" || !airtableId.startsWith(MIXER_AIRTABLE_PREFIX)) return null;
  const code = airtableId.slice(MIXER_AIRTABLE_PREFIX.length).trim();
  return code ? code : null;
}

/** A row the plant sync wrote for a mix: entered by plant-sync AND keyed mixer-plant-…. */
export function isPlantMixerRow(r: { airtableId?: unknown; enteredById?: unknown }): boolean {
  return r.enteredById === PLANT_SYNC_USER && fCodeOfMixerAirtableId(r.airtableId) !== null;
}

/** sync_match.plant_values[MIX_FACTS_KEY] of every Mixer match (read by the undo script and the shadow preview). */
export const MIX_FACTS_KEY = "_mix";
export interface MixFacts {
  fCode: string;
  order: number | null;
  batch: string | null;
  batchKey: string | null;
  cycle: number | null;
  numberAt: string | null; // naive IST "yyyy-MM-ddTHH:mm:ss.SSS"
  anchorAt: string | null; // naive IST
  importedAt: string | null; // UTC ISO, what imported_at is (or would be)
  hold: string | null; // the hold's reason in words, when mode is pending
}
// sync_match.plant_values = { ...<column → value, as MIXER_WRITTEN_COLUMNS>, _mix: MixFacts, _extras: {...} }
// sync_match.written (mode inserted) = { <column>: value } for exactly the columns inserted:
//   numbers as JSON numbers, booleans as booleans, text as strings, NULL as null; the two totals as JSON numbers.
/** sync_match.plant_values[MIX_EXTRAS_KEY]: what the plant gives that is never written (spec 2, "Kept beside"). */
export const MIX_EXTRAS_KEY = "_extras";

/** The 32 grit slots: column names and Prisma field names. */
export interface GritSlot {
  mixer: 1 | 2 | 3 | 4;
  slot: number;
  sn: string;
  w: string;
  link: string;
  snField: string;
  wField: string;
  linkField: string;
}

const MIXERS = [1, 2, 3, 4] as const;
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// m1_g1_sn / m1_w1 / m1_g1 / m1G1Sn / m1W1 / m1G1Ids … m4_g8_*
export const MIXER_GRIT_SLOTS: readonly GritSlot[] = Object.freeze(
  MIXERS.flatMap((n) =>
    SLOTS.map((k) =>
      Object.freeze({
        mixer: n,
        slot: k,
        sn: `m${n}_g${k}_sn`,
        w: `m${n}_w${k}`,
        link: `m${n}_g${k}`,
        snField: `m${n}G${k}Sn`,
        wField: `m${n}W${k}`,
        linkField: `m${n}G${k}Ids`,
      }),
    ),
  ),
);
export const MIXER_FILLER_COLUMNS: readonly string[] = Object.freeze(MIXERS.map((n) => `m${n}_f_w`));
export const MIXER_RESIN_COLUMNS: readonly string[] = Object.freeze(MIXERS.map((n) => `m${n}_r_w`));

/** Every stock link column: the 32 grit links, filler_silo_id, m1_r_id … m4_r_id. */
export const MIXER_STOCK_LINK_COLUMNS: readonly string[] = Object.freeze([
  ...MIXER_GRIT_SLOTS.map((s) => s.link),
  "filler_silo_id",
  ...MIXERS.map((n) => `m${n}_r_id`),
]);

/** Exactly what the matcher may insert besides id, airtableId, entered_by_user_id, imported_at, synced_at. */
export const MIXER_WRITTEN_COLUMNS: readonly string[] = Object.freeze([
  "batch", "batch_key", "cycle", "loc", "operator",
  "mixer1", "mixer2", "mixer3", "mixer4",
  ...MIXER_GRIT_SLOTS.flatMap((s) => [s.sn, s.w]),
  ...MIXER_FILLER_COLUMNS,
  ...MIXER_RESIN_COLUMNS,
  "total_cycle_weight", "total_mixer_1_weight",
]);

/** Never written by the matcher (a test holds the insert to this). */
export const MIXER_NEVER_WRITTEN_COLUMNS: readonly string[] = Object.freeze([
  "mixer_start_time", "mixer_end_time", "filler_silo_buffer",
  ...MIXERS.map((n) => `m${n}_r_dtn`),
  "remarks", "create_time", "mixer_id",
  ...MIXER_STOCK_LINK_COLUMNS,
]);

/** "Batch 1494 cycle 19 (plant 151170022): " or, without a batch or cycle, "Plant mix 151170022: ". */
export function mixFlagPrefix(batch: string | null, cycle: number | null, fCode: string): string {
  const code = String(fCode ?? "").trim();
  const b = typeof batch === "string" ? batch.trim() : "";
  if (b && cycle !== null && cycle !== undefined && Number.isFinite(cycle)) return `Batch ${b} cycle ${cycle} (plant ${code}): `;
  return `Plant mix ${code}: `;
}

/** The mix_not_given run note's words (5.4), read after "Run N: ". */
export const MIX_NOT_GIVEN_TEXT =
  "the plant does not give each Mixer cycle's start and end time, its filler buffer or its resin day tank, so they are " +
  "blank on the plant's cycles. Their filler is not taken off the silos until a buffer is named: per cycle in Tables → " +
  "Mixer Cycle, or for many cycles at once by an admin on Office → Plant sync (Mixer stock).";
