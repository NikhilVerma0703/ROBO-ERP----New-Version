// THE PRESS FORM FROM THE PLANT: one press row per slab, column by column, as
// the field map gives it (field-map brief section 1; spec section 2). Pure:
// match-server.ts reads the plant rows and hands them in; nothing here reads
// a database or the clock.
//
// WHAT ONE SLAB IS MADE OF
//   S  the slab's plant_slab row (T_RPT_SLABS): its article, line order and
//      the press times F_PRE_BEGIN / F_PRE_END;
//   P  its plant_press_slab summary (ETLProcessPress01, summarised per slab on
//      the PC): vacuum delay, vacuum set point, pumps, lowest chamber vacuum;
//   SC the press phase settings in force at F_PRE_BEGIN (plant_setting_change:
//      FR_Press_Phase_R01..R10, tags Tempo / Giri / TempoRagGiri / Pressione);
//   H  the probe temperatures of the 03:00 and 15:00 hours (plant_press_hourly),
//      on the one slab pressed nearest that hour;
//   plus the operator (the person signed in on the Press at F_PRE_BEGIN), the
//   pinhole cycle phase (the opening check, default 1), the batch and design.
//
// Rules worth knowing before changing anything here:
//   - P is taken only once the slab's log is complete (summarySettled): the
//     press ETL runs 10-20 min behind, and the first rows of a slab still carry
//     the previous slab's values (critic A2.3);
//   - an aborted cycle (lowest chamber vacuum above 900 mbar: no vacuum was
//     drawn) makes no row at all;
//   - a phase the press did not use (its Tempo is 0) is BLANK in every one of
//     its four columns, never 0 (owner, 27 Oct);
//   - the lower chamber vacuum is the SET POINT (lastVacuumSetPoint, rounded),
//     never the 0-4 mbar measured value, which is kept beside as an extra
//     (field map, Press: "It is the set point, never the 0-4 mbar measured
//     value. Extra: P.minLowerChamberVacuum");
//   - the cycle time is the chamber time F_PRE_END − F_PRE_BEGIN, nothing else.
//
// PURE: imports the rules beside it with .ts, so node --test loads it
// (tests/plantMatchPress.test.ts).
import {
  NO_OPERATOR_REMEDY, createdTimeOf, num, plantTime, round, secondsBetween, secondsPastMidnight, text, naiveMs,
  type ColumnKind, type CompareRule,
} from "./match-rules.ts";

/* ------------------------------------------------------------ the columns */

const PHASES = [1, 2, 3, 4, 5] as const;
const phaseCols = (n: number) => [`phase_${n}_rev`, `phase_${n}_pressing_time`, `phase_${n}_acceleration_time`, `phase_${n}_pressure`] as const;

/** Every press column the matcher writes, with its kind. `remarks` is not
 *  here: it is written once, at insert (a slab's remark from the panel), and
 *  never again; `entered_by_user_id`, the ids and the stamps neither. */
export const PRESS_COLUMNS: Readonly<Record<string, ColumnKind>> = Object.freeze({
  batch: "text",
  batch_key: "text",
  operator: "text",
  design_name: "text",
  slab_number: "num",
  date: "ts",
  in_time: "num",
  created_time: "ts",
  slab_weight: "num",
  temperature_in_degree_celsius_note_only_at_15_00_and_3_00: "num",
  no_of_stages: "num",
  vacuum_delay_in_seconds: "num",
  lowe_chamber_vacuum_in_mbar: "num",
  pinhole_cycle: "text",
  pinhole_cycle_phase: "text",
  pinhole_cycle_delay: "num",
  ...Object.fromEntries(PHASES.flatMap((n) => phaseCols(n).map((c) => [c, "num" as ColumnKind]))),
  vacuum_pumps: "text",
  no_of_vacuum_pumps: "num",
  cycle_time_sec: "num",
});

/** The columns compared with a row a person typed, with the form's own names.
 *  Not the hidden ones (in_time, created_time, the pump count) and not the raw
 *  batch text (its key is compared). The date allows 5 minutes: typed times
 *  run 0-3 min off the plant's (field map, Press, date). */
export const PRESS_COMPARE: Readonly<Record<string, CompareRule>> = Object.freeze({
  batch_key: { kind: "text", label: "Batch", folded: true },
  design_name: { kind: "text", label: "Design", folded: true },
  operator: { kind: "text", label: "Operator", folded: true },
  date: { kind: "ts", label: "Date", tolerance: 300 },
  slab_weight: { kind: "num", label: "Slab weight", tolerance: 0.5 },
  temperature_in_degree_celsius_note_only_at_15_00_and_3_00: { kind: "num", label: "Temperature", tolerance: 0.5 },
  no_of_stages: { kind: "num", label: "No of stages" },
  vacuum_delay_in_seconds: { kind: "num", label: "Vacuum delay", tolerance: 0.5 },
  lowe_chamber_vacuum_in_mbar: { kind: "num", label: "Lower chamber vacuum", tolerance: 0.5 },
  pinhole_cycle: { kind: "text", label: "Pinhole cycle", folded: true },
  pinhole_cycle_phase: { kind: "text", label: "Pinhole cycle phase", folded: true },
  pinhole_cycle_delay: { kind: "num", label: "Pinhole cycle delay", tolerance: 0.5 },
  ...Object.fromEntries(PHASES.flatMap((n) => [
    [`phase_${n}_rev`, { kind: "num", label: `Phase ${n} rev` }],
    [`phase_${n}_pressing_time`, { kind: "num", label: `Phase ${n} pressing time` }],
    [`phase_${n}_acceleration_time`, { kind: "num", label: `Phase ${n} acceleration time` }],
    [`phase_${n}_pressure`, { kind: "num", label: `Phase ${n} pressure` }],
  ])),
  vacuum_pumps: { kind: "text", label: "Vacuum pumps" },
  cycle_time_sec: { kind: "num", label: "Cycle time", tolerance: 1 },
} as Record<string, CompareRule>);

/* --------------------------------------------------------- plant row shapes */

export interface PlantSlabRow {
  plantKey: string;
  fId: number | null;
  article: string | null;
  slabNo: number | null;
  lineOrder: number | null;
  /** plant_slab.pre_begin as a plant time, or null. */
  preBegin: string | null;
  data: Record<string, unknown>;
}

export interface PressSummaryRow {
  plantKey: string;
  slabNo: number | null;
  firstId: number | null;
  lastId: number | null;
  lastAt: string | null;
  data: Record<string, unknown>;
}

export interface SettingRow {
  fId: number;
  /** F_LUD, a plant time. */
  lud: string;
  objName: string | null;
  /** data->>'F_TagName'. */
  tag: string | null;
  valueNum: number | null;
  valueWord: number | null;
}

export interface HourlyRow {
  tagName: string | null;
  stamp: string | null;
  data: Record<string, unknown>;
}

/** The press's work centre code on T_RPT_SLABS. */
export const PRESS_CODE = "WPRESS-A";

/** A slab the press finished: its code is the press's and F_PRE_END is set. */
export function pressFinished(s: PlantSlabRow): boolean {
  return text(s.data.F_PRE_CODE) === PRESS_CODE && s.preBegin !== null && preEndOf(s) !== null;
}

export const preEndOf = (s: PlantSlabRow): string | null => plantTime(s.data.F_PRE_END);

/* ------------------------------------------------- the press log (summary P) */

const JOIN_WINDOW_MIN = 30;
const SETTLE_AFTER_MIN = 30;

/**
 * The slab's press log summary: same slab number, and its first row within
 * 30 minutes of F_PRE_BEGIN (the last 6 digits of an article are not unique
 * for ever, so the number alone could join another year's slab). The nearest
 * one when there are several.
 */
export function pickSummary(slab: { slabNo: number | null; preBegin: string | null }, summaries: readonly PressSummaryRow[]): PressSummaryRow | null {
  const t = slab.preBegin === null ? null : naiveMs(slab.preBegin);
  if (slab.slabNo === null || t === null) return null;
  let best: PressSummaryRow | null = null;
  let bestGap = Infinity;
  for (const p of summaries) {
    if (p.slabNo !== slab.slabNo) continue;
    const f = naiveMs(p.data.firstAt);
    if (f === null) continue;
    const gap = Math.abs(f - t);
    if (gap < JOIN_WINDOW_MIN * 60_000 && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Is the slab's log complete (critic A2.3)? F_PRE_END is set, and either the
 * log has moved on to a later slab (a summary starting after this one's last
 * row exists) or this one has not grown for 30 minutes of plant time.
 */
export function summarySettled(p: PressSummaryRow, opts: { preEnd: string | null; maxFirstId: number | null; nowNaive: string }): boolean {
  if (opts.preEnd === null) return false;
  if (p.lastId !== null && opts.maxFirstId !== null && opts.maxFirstId > p.lastId) return true;
  const last = p.lastAt === null ? null : naiveMs(p.lastAt);
  const now = naiveMs(opts.nowNaive);
  return last !== null && now !== null && now - last > SETTLE_AFTER_MIN * 60_000;
}

/** No vacuum drawn: the cycle was aborted (166362: 5 s, chamber at 1000 mbar). */
export const ABORT_VACUUM_MBAR = 900;
export function isAborted(p: PressSummaryRow): boolean {
  const v = num(p.data.minLowerChamberVacuum);
  return v !== null && v > ABORT_VACUUM_MBAR;
}

/* ---------------------------------------------------------- panel settings */

export const PINHOLE_SETTING_FID = 1696; // FR_DB1162_X287_2, 1 = enabled (cross-check only)
export const PHASE_TAG = { rev: "Giri", pressingTime: "Tempo", accelerationTime: "TempoRagGiri", pressure: "Pressione" } as const;
export const phaseObj = (n: number) => `FR_Press_Phase_R${String(n).padStart(2, "0")}`;
const PHASE_OBJ = /^FR_Press_Phase_R(\d{2})$/;

export interface SettingIndex {
  /** The value in force at t for an f_id (SC(id)@t): the row with the
   *  greatest F_LUD ≤ t. */
  at(fId: number, t: string): SettingRow | null;
  /** value_num of a press phase setting at t, by phase number and tag. */
  phase(n: number, tag: string, t: string): number | null;
}

/** Index the setting rows once for many slabs. A phase is found by its name
 *  and tag, not a fixed F_ID: the PC feeds them by pattern (critic A2.9). */
export function settingIndex(rows: readonly SettingRow[]): SettingIndex {
  const byFid = new Map<number, { ms: number; row: SettingRow }[]>();
  const fidsByPhase = new Map<string, Set<number>>();
  for (const r of rows) {
    const ms = naiveMs(r.lud);
    if (ms === null) continue;
    let list = byFid.get(r.fId);
    if (!list) byFid.set(r.fId, (list = []));
    list.push({ ms, row: r });
    const m = r.objName ? PHASE_OBJ.exec(r.objName.trim()) : null;
    if (m && r.tag) {
      const k = `${Number(m[1])}|${r.tag.trim()}`;
      let s = fidsByPhase.get(k);
      if (!s) fidsByPhase.set(k, (s = new Set()));
      s.add(r.fId);
    }
  }
  for (const list of byFid.values()) list.sort((a, b) => a.ms - b.ms);
  const at = (fId: number, t: string): SettingRow | null => {
    const list = byFid.get(fId);
    const tm = naiveMs(t);
    if (!list || tm === null) return null;
    let found: SettingRow | null = null;
    for (const e of list) {
      if (e.ms <= tm) found = e.row;
      else break;
    }
    return found;
  };
  const phase = (n: number, tag: string, t: string): number | null => {
    const fids = fidsByPhase.get(`${n}|${tag}`);
    if (!fids) return null;
    // Two F_IDs for one phase and tag would be a plant change; the newest wins.
    let best: SettingRow | null = null;
    for (const f of fids) {
      const r = at(f, t);
      if (r && (!best || (naiveMs(r.lud) ?? 0) > (naiveMs(best.lud) ?? 0))) best = r;
    }
    return best === null ? null : best.valueNum;
  };
  return { at, phase };
}

/* --------------------------------------------------------------- the probes */

const PROBE = /^FR_TEMPV01(0[1-9]|1\d|20)\.PAR_Ana_001$/;
const NOTE_HOURS = new Set([3, 15]);
const NEAREST_WITHIN_MIN = 120;

export interface TemperatureReading {
  /** The reading's own time (the hour's dataTimeStamp), a plant time. */
  stamp: string;
  /** Mean of the valid probes, 1 dp; null when none was valid. */
  mean: number | null;
  /** The hottest valid probe, kept beside (27 Oct). */
  max: number | null;
  probes: number;
}

/**
 * The 03:00 and 15:00 readings from plant_press_hourly: the 20 probes
 * FR_TEMPV0101..0120.PAR_Ana_001 (never the PAR_Ana_002 twins), their hourly
 * `avg`. A probe reading 0, 300 or more (327.7 is a fault) or nothing is left
 * out of the mean.
 */
export function temperatureReadings(rows: readonly HourlyRow[]): TemperatureReading[] {
  const groups = new Map<string, { stamp: string; vals: number[] }>();
  for (const r of rows) {
    if (!r.tagName || !PROBE.test(r.tagName.trim())) continue;
    const hour = num(r.data.hour);
    if (hour === null || !NOTE_HOURS.has(hour)) continue;
    const stamp = plantTime(r.stamp);
    if (stamp === null) continue;
    const key = [num(r.data.year), num(r.data.month), num(r.data.day), hour].join("-");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { stamp, vals: [] }));
    if (stamp < g.stamp) g.stamp = stamp;
    const v = num(r.data.avg);
    if (v !== null && v !== 0 && v < 300) g.vals.push(v);
  }
  return [...groups.values()]
    .map((g) => ({
      stamp: g.stamp,
      mean: g.vals.length ? round(g.vals.reduce((a, b) => a + b, 0) / g.vals.length, 1) : null,
      max: g.vals.length ? round(Math.max(...g.vals), 1) : null,
      probes: g.vals.length,
    }))
    .sort((a, b) => (a.stamp < b.stamp ? -1 : 1));
}

/** Each reading on the press slab whose F_PRE_BEGIN is nearest its stamp
 *  (within 2 hours; the earlier slab on a tie). */
export function attachTemperatures(readings: readonly TemperatureReading[], slabs: readonly { plantKey: string; preBegin: string }[]): Map<string, TemperatureReading> {
  const out = new Map<string, TemperatureReading>();
  for (const r of readings) {
    const s = naiveMs(r.stamp);
    if (s === null) continue;
    let best: { plantKey: string; gap: number; t: number } | null = null;
    for (const slab of slabs) {
      const t = naiveMs(slab.preBegin);
      if (t === null) continue;
      const gap = Math.abs(t - s);
      if (gap > NEAREST_WITHIN_MIN * 60_000) continue;
      if (!best || gap < best.gap || (gap === best.gap && t < best.t)) best = { plantKey: slab.plantKey, gap, t };
    }
    if (best) out.set(best.plantKey, r);
  }
  return out;
}

/** The press's takt: each slab's F_PRE_END minus the previous slab's (kept
 *  beside, never the cycle time). */
export function previousPreEnds(slabs: readonly { plantKey: string; preBegin: string; preEnd: string | null }[]): Map<string, string | null> {
  const sorted = [...slabs].sort((a, b) => (a.preBegin < b.preBegin ? -1 : a.preBegin > b.preBegin ? 1 : 0));
  const out = new Map<string, string | null>();
  let prev: string | null = null;
  for (const s of sorted) {
    out.set(s.plantKey, prev);
    if (s.preEnd !== null) prev = s.preEnd;
  }
  return out;
}

/* ------------------------------------------------------------- the mapping */

export interface PressMapInput {
  slab: PlantSlabRow;
  summary: PressSummaryRow;
  settings: SettingIndex;
  temperature: TemperatureReading | null;
  prevPreEnd: string | null;
  /** The person on the Press at F_PRE_BEGIN (machine_session), or null. */
  operator: string | null;
  /** The opening check's pinhole cycle phase in force, already defaulted. */
  pinholePhase: string | null;
  batch: { batch: string; batchKey: string } | null;
  design: string | null;
}

export interface PressNote { kind: "no_operator" | "stages_low" | "cycle_time_odd" | "pinhole_differs" | "settings_missing"; detail: string; field?: string; plantValue?: unknown }

export interface PressMapped {
  /** Every PRESS_COLUMNS column, by its column name. */
  values: Record<string, unknown>;
  /** What the plant shows that has no column (spec 0.1: "stored beside"). */
  extras: Record<string, unknown>;
  notes: PressNote[];
}

const CYCLE_LOW_S = 150;
const CYCLE_HIGH_S = 600;

/** "1,2,4" from P's maxPumpNEnabling, as stampPumps writes the list. */
export function pumpsOf(p: PressSummaryRow): { list: string | null; count: number | null } {
  const on = [1, 2, 3, 4].filter((n) => num(p.data[`maxPump${n}Enabling`]) === 1);
  return { list: on.join(",") || null, count: on.length || null };
}

/** COALESCE(NULLIF(F_DIS01_STS_WEIGHT + F_DIS02_STS_WEIGHT, 0), F_KRS_WEIGHT):
 *  the distributor's two loads, else the Kreos weight (a Kreos slab has no
 *  distributor weights). */
export function slabWeightOf(s: PlantSlabRow): number | null {
  const a = num(s.data.F_DIS01_STS_WEIGHT);
  const b = num(s.data.F_DIS02_STS_WEIGHT);
  const sum = a !== null && b !== null ? a + b : null;
  if (sum !== null && sum !== 0) return round(sum, 2);
  return round(num(s.data.F_KRS_WEIGHT), 2);
}

/** One press row from one finished, settled, not aborted slab. */
export function mapPress(input: PressMapInput): PressMapped {
  const { slab, summary: p, settings } = input;
  const t = slab.preBegin as string;
  const preEnd = preEndOf(slab);
  const notes: PressNote[] = [];

  // Phases: an unused phase (Tempo 0) is blank in all four columns; a phase
  // whose Tempo is not known at t (no setting row yet) is blank too.
  const values: Record<string, unknown> = {};
  let known = false;
  for (const n of PHASES) {
    const tempo = settings.phase(n, PHASE_TAG.pressingTime, t);
    if (tempo !== null) known = true;
    const used = tempo !== null && tempo > 0;
    const [rev, press, acc, pressure] = phaseCols(n);
    values[rev] = used ? settings.phase(n, PHASE_TAG.rev, t) : null;
    values[press] = used ? tempo : null;
    values[acc] = used ? settings.phase(n, PHASE_TAG.accelerationTime, t) : null;
    values[pressure] = used ? settings.phase(n, PHASE_TAG.pressure, t) : null;
  }
  // Stages: the phases R01..R10 with a Tempo above 0.
  let stages: number | null = null;
  for (let n = 1; n <= 10; n++) {
    const tempo = settings.phase(n, PHASE_TAG.pressingTime, t);
    if (tempo === null) continue;
    stages = (stages ?? 0) + (tempo > 0 ? 1 : 0);
  }
  if (!known) notes.push({ kind: "settings_missing", detail: "the ERP has no press phase settings from the plant for this time yet, so stages and phases were left blank" });
  else if (stages !== null && stages <= 2) notes.push({ kind: "stages_low", field: "no_of_stages", plantValue: stages, detail: `the press ran ${stages} stage${stages === 1 ? "" : "s"}; check the press recipe` });

  const pinholeTime = num(slab.data.F_PRE_PINHOLE_VACUUM_TIME);
  const pinhole = pinholeTime === null ? null : pinholeTime > 0 ? "Enabled" : "Disabled";
  const panel = settings.at(PINHOLE_SETTING_FID, t);
  const panelWord = panel === null ? null : panel.valueWord;
  if (pinhole !== null && panelWord !== null && (panelWord === 1) !== (pinhole === "Enabled")) {
    notes.push({
      kind: "pinhole_differs", field: "pinhole_cycle", plantValue: pinhole,
      detail: `the slab shows the pinhole cycle ${pinhole.toLowerCase()} but the panel shows it ${panelWord === 1 ? "enabled" : "disabled"}; the operator should confirm`,
    });
  }

  const cycle = round(secondsBetween(t, preEnd), 0);
  if (cycle !== null && (cycle < CYCLE_LOW_S || cycle > CYCLE_HIGH_S)) {
    notes.push({ kind: "cycle_time_odd", field: "cycle_time_sec", plantValue: cycle, detail: `the press cycle took ${cycle} s (usual is ${CYCLE_LOW_S}-${CYCLE_HIGH_S} s)` });
  }
  if (input.operator === null) {
    // 5 Nov 2026 (H-1): no screen puts an operator on a row afterwards; the words said "fill it in from History".
    notes.push({ kind: "no_operator", field: "operator", detail: `nobody was signed in on the Press at ${t.slice(11, 16)}, so the operator is blank; ${NO_OPERATOR_REMEDY}` });
  }

  const delay = num(p.data.lastDelayVacumDone);
  const pumps = pumpsOf(p);
  Object.assign(values, {
    batch: input.batch?.batch ?? null,
    batch_key: input.batch?.batchKey ?? null,
    operator: input.operator,
    design_name: input.design,
    slab_number: slab.slabNo,
    date: t,
    in_time: secondsPastMidnight(t),
    created_time: createdTimeOf(t),
    slab_weight: slabWeightOf(slab),
    temperature_in_degree_celsius_note_only_at_15_00_and_3_00: input.temperature?.mean ?? null,
    no_of_stages: stages,
    vacuum_delay_in_seconds: delay,
    lowe_chamber_vacuum_in_mbar: round(num(p.data.lastVacuumSetPoint), 0),
    pinhole_cycle: pinhole,
    pinhole_cycle_phase: input.pinholePhase,
    // 31 Oct: the pinhole cycle delay IS the vacuum delay.
    pinhole_cycle_delay: delay,
    vacuum_pumps: pumps.list,
    no_of_vacuum_pumps: pumps.count,
    cycle_time_sec: cycle,
  });

  const extras: Record<string, unknown> = {
    article: slab.article,
    fId: slab.fId,
    lineOrder: slab.lineOrder,
    preEnd,
    summaryKey: p.plantKey,
    minLowerChamberVacuum: num(p.data.minLowerChamberVacuum),
    pressingEnter: p.data.pressingEnter ?? null,
    pressingExit: p.data.pressingExit ?? null,
    taktSec: round(secondsBetween(input.prevPreEnd, preEnd), 0),
    pinholeVacuumTime: pinholeTime,
    panelPinholeWord: panelWord,
    timeToVacuum: num(slab.data.F_PRE_TIME_TO_VACUUM),
    weightSetPoint: num(slab.data.F_DIS_WIGHT_SETPOINT),
    temperatureMax: input.temperature?.max ?? null,
    temperatureProbes: input.temperature?.probes ?? null,
    temperatureStamp: input.temperature?.stamp ?? null,
  };
  return { values, extras, notes };
}
