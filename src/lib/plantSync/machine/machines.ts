// The six machines of the plant and the opening-check questions each one
// asks (Machine Overview, round 1). PURE: data only, relative imports only,
// so `node --test` loads it.
//
// A field name here IS the station table's database column, so round 2 maps
// one to one. machine_opening_check.field stores exactly these names.

export type Machine = "MIXER" | "DISTRIBUTOR" | "KREOS" | "ROBO" | "PRESS" | "OVEN";

/** Display order (spec section 1). */
export const MACHINES: readonly Machine[] = ["MIXER", "DISTRIBUTOR", "KREOS", "ROBO", "PRESS", "OVEN"];

export const MACHINE_LABEL: Readonly<Record<Machine, string>> = {
  MIXER: "Mixer", DISTRIBUTOR: "Distributor", KREOS: "Kreos", ROBO: "Robo", PRESS: "Press", OVEN: "Oven",
};

/** The Prisma model of the typed station table; Robo has none. */
export const MACHINE_MODEL: Readonly<Record<Machine, string | null>> = {
  MIXER: "MixerCycle", DISTRIBUTOR: "Distributor", KREOS: "Kreos", ROBO: null, PRESS: "Press", OVEN: "Oven",
};

export const MACHINE_SLUG: Readonly<Record<Machine, string>> = {
  MIXER: "mixer", DISTRIBUTOR: "distributor", KREOS: "kreos", ROBO: "robo", PRESS: "press", OVEN: "oven",
};

/** Any case; anything unknown is null (never a guess). */
export function machineFromSlug(slug: string): Machine | null {
  const up = String(slug ?? "").trim().toUpperCase();
  return (MACHINES as readonly string[]).includes(up) ? (up as Machine) : null;
}

export interface OpeningField {
  field: string;
  label: string;
  kind: "select" | "multi" | "number" | "text";
  required?: boolean;
  defaultValue?: string | number | string[];
  options?: readonly string[];
  /** Dropdown choices come from selectOptions(model)[prismaField]. */
  optionsFrom?: { model: string; prismaField: string };
  /** The words a stored choice is shown with (round 2: the vein's "None" reads "No vein"); a choice not listed reads as itself. */
  optionLabels?: Readonly<Record<string, string>>;
  /** Asked only when this plant panel bit (F_ID) reads 1 (a GEV's "enabled"
   *  bit): a plant that shows it 0, with no value in force, hides the question. */
  onlyIfPlantEnabled?: number;
  /** The question starts with this panel setting's value (F_ID, value_num) as
   *  its suggestion; the person confirms or changes it. */
  prefillFromPanel?: number;
  /** The question is prefilled with the title of the newest GEV deployment on
   *  the machine's own GEV instance(s) (plant_gev_deploy): the Distributor's
   *  two vein instances (gev-rules.ts), the Kreos's own instance
   *  (match/kreos-map.ts kreosDeploys: status 1, not deleted). The person
   *  confirms it; only the confirmed value is ever written. Even when a value
   *  is in force: the plant may have deployed a new design since. */
  prefillFromGevDeploy?: boolean;
}

// Round 2 (spec 5.4): the material question reads "GEV N material" (label
// only: the field, and so the column, is unchanged), so a floor reader does
// not see "GEV 1" beside "GEV 1 slot size" and "GEV 1 RPM".
const gev = (n: 1 | 2 | 3, panelBit: number): OpeningField[] => [
  { field: `gev_${n}`, label: `GEV ${n} material`, kind: "select", optionsFrom: { model: "Kreos", prismaField: `gev${n}` } },
  { field: `gev_${n}_slot_size`, label: `GEV ${n} slot size`, kind: "number" },
  { field: `gev_${n}_rpm`, label: `GEV ${n} RPM`, kind: "number", onlyIfPlantEnabled: panelBit },
];

export const OPENING_FIELDS: Readonly<Record<Machine, readonly OpeningField[]>> = {
  MIXER: [],
  ROBO: [],
  PRESS: [
    { field: "pinhole_cycle_phase", label: "Pinhole cycle phase", kind: "select", defaultValue: "1",
      optionsFrom: { model: "Press", prismaField: "pinholeCyclePhase" } },
  ],
  OVEN: [
    { field: "set_cooking_time", label: "Set cooking time", kind: "number", required: true, defaultValue: 36 },
  ],
  // Round 2 (spec 4.2, 4.3; Q9 and Q10, accepted): THE VEIN AND SLOT GATE.
  // Vein 1 and Vein 2 are REQUIRED, each with an explicit "No vein" (stored
  // as "None", opening-vein-rules.ts NO_VEIN; the Distributor row then gets
  // NULL and an empty slot list). The slots are NOT pre-ticked any more (the
  // round-1 default of all three sizes met "required" with one tap): a slot
  // list is required exactly for a vein that is named and refused for "No
  // vein" (opening-vein-rules veinAnswerRefusal, on the server and the
  // screen), so they are not `required` here. The hopper gap joins, prefilled
  // from the panel (F_ID 18742) like the hopper weight; the person confirms
  // it (typed values have differed from the panel, per the private field map).
  // The matcher holds a run's slabs until its check is answered
  // (match/distributor-spec.ts, sync_match mode opening_pending).
  DISTRIBUTOR: [
    { field: "distributor_vein_1", label: "Vein 1", kind: "select", required: true, options: ["None"], optionLabels: { None: "No vein" },
      optionsFrom: { model: "Distributor", prismaField: "distributorVein1" } },
    { field: "distributor_vein_2", label: "Vein 2", kind: "select", required: true, options: ["None"], optionLabels: { None: "No vein" },
      optionsFrom: { model: "Distributor", prismaField: "distributorVein2" } },
    { field: "distributor_vein_1_gev_slot", label: "Vein 1 GEV slot", kind: "multi", options: ["7mm", "9mm", "11mm"],
      optionsFrom: { model: "Distributor", prismaField: "distributorVein1GevSlot" } },
    { field: "distributor_vein_2_gev_slot", label: "Vein 2 GEV slot", kind: "multi", options: ["7mm", "9mm", "11mm"],
      optionsFrom: { model: "Distributor", prismaField: "distributorVein2GevSlot" } },
    { field: "distributor_fractionator_type", label: "Fractionator type", kind: "select",
      optionsFrom: { model: "Distributor", prismaField: "distributorFractionatorType" } },
    { field: "distributor_manual_roller_height", label: "Manual roller height", kind: "number" },
    { field: "distributor_loading_belt_loading_speed", label: "Loading belt speed", kind: "number", defaultValue: 5 },
    { field: "vein_design_name", label: "Vein design name", kind: "text", prefillFromGevDeploy: true },
    { field: "distributor_hopper_weight", label: "Hopper weight", kind: "number", prefillFromPanel: 18754 },
    { field: "distributor_hopper_gap", label: "Hopper gap", kind: "number", prefillFromPanel: 18742 },
  ],
  // Round 2 (spec 5.4): the loading belt speed starts at 5 like the
  // Distributor's (the plan's "prefilled 5"; the panel's copy of it is frozen,
  // so it is never read from the plant), and the GEV design name is a CONFIRM
  // field (Q17): prefilled from the newest standing deploy on the Kreos's GEV
  // instance, and the Kreos row gets only what the person confirmed
  // (match/kreos-map.ts). The RPM stays asked by the GEV's enable bit and is
  // checked per slab by the matcher (gev_rpm_missing).
  KREOS: [
    ...gev(1, 22556),
    ...gev(2, 22559),
    ...gev(3, 22562),
    { field: "distributor_loading_belt_loading_speed", label: "Loading belt speed", kind: "number", defaultValue: 5 },
    { field: "gev_design_name", label: "GEV design name", kind: "text", prefillFromGevDeploy: true },
  ],
};
