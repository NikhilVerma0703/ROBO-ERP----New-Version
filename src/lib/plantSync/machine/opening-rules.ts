// WHICH OPENING-CHECK VALUE WAS IN FORCE AT A PLANT TIME (Machine Overview
// round 1, spec section 3, CONTRACTS D13). PURE: relative imports with .ts.
//
// The opening check is a list of INSERTED rows (machine_opening_check): the
// answers at shift start, when the line order changes, and the ones changed
// from the "Edit parameters" panel. Nothing is ever updated or deleted. The
// value of a field at plant time t is the row with the greatest applies_from
// at or before t; two rows with the same applies_from: the one set last wins.
import { naiveMs } from "./plant-clock.ts";
import type { OpeningField } from "./machines.ts";

export interface OpeningRow {
  field: string;
  value: unknown;
  appliesFrom: string; // naive IST
  setAt: string; // ISO
  setByName: string | null;
  reason: string;
  lineOrder: number | null;
  fromSlabNo: number | null;
}

const at = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** The row in force for `field` at plant time `plantTime`, or null. */
export function rowInForce(rows: readonly OpeningRow[], field: string, plantTime: string): OpeningRow | null {
  const t = naiveMs(plantTime);
  if (t === null) return null;
  let best: OpeningRow | null = null;
  let bestFrom = -Infinity;
  for (const r of rows) {
    if (r.field !== field) continue;
    const from = naiveMs(r.appliesFrom);
    if (from === null || from > t) continue;
    if (best === null || from > bestFrom || (from === bestFrom && at(r.setAt) > at(best.setAt))) {
      best = r;
      bestFrom = from;
    }
  }
  return best;
}

/** The value in force for `field` at `plantTime`; undefined when there is none. */
export function openingValueAt(rows: readonly OpeningRow[], field: string, plantTime: string): unknown {
  const r = rowInForce(rows, field, plantTime);
  return r === null ? undefined : r.value;
}

/** Every listed field's value in force at `plantTime`, with who set it and when; null when none. */
export function valuesInForce(
  rows: readonly OpeningRow[],
  fields: readonly OpeningField[],
  plantTime: string,
): Record<string, { value: unknown; by: string | null; setAt: string } | null> {
  const out: Record<string, { value: unknown; by: string | null; setAt: string } | null> = {};
  for (const f of fields) {
    const r = rowInForce(rows, f.field, plantTime);
    out[f.field] = r === null ? null : { value: r.value, by: r.setByName, setAt: r.setAt };
  }
  return out;
}

/**
 * The first row for `field` that starts AFTER `plantTime`: where a value
 * recorded now would stop applying (D13: "until the next value recorded for
 * F after that time"). Null when nothing later exists.
 */
export function nextRowAfter(rows: readonly OpeningRow[], field: string, plantTime: string): OpeningRow | null {
  const t = naiveMs(plantTime);
  if (t === null) return null;
  let best: OpeningRow | null = null;
  let bestFrom = Infinity;
  for (const r of rows) {
    if (r.field !== field) continue;
    const from = naiveMs(r.appliesFrom);
    if (from === null || from <= t) continue;
    if (from < bestFrom || (from === bestFrom && best !== null && at(r.setAt) > at(best.setAt))) {
      best = r;
      bestFrom = from;
    }
  }
  return best;
}

/** A value as a person reads it ("36", "7mm, 9mm", "Enabled"). */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "not set";
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "not set";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "not set";
  return String(v);
}
