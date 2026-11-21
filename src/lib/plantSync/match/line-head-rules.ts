// WHO OWNS A SLAB AT THE LINE HEAD: one function (Machine Overview round 2,
// spec 1.5; KREOS 7.7, critic 3). PURE: relative imports with .ts only, so
// `node --test` loads it (tests/plantMatchRunnerRules.test.ts).
//
// A slab starts on the Distributor OR on the Kreos, never both (per the
// private field map no real slab carries both codes; the sample generator
// makes such rows, so they are a test artefact). The Distributor's and the
// Kreos's matchers, their screens and the typed save's "the plant already
// filled this slab" refusal (1.10) all ask this one function, so a slab is
// never the Distributor's on one page and the Kreos's on another, and
// incentiveLines.lineOfSlab keeps seeing one line head per slab.
import { text } from "./match-rules.ts";

/** The line head's work centre codes on T_RPT_SLABS. */
export const DISTRIBUTOR_CODE = "WSTS-A";
export const KREOS_CODE = "WKREOS-A";

export type LineHead = "DISTRIBUTOR" | "KREOS";

/**
 * The line head that owns a plant slab:
 *   - "DISTRIBUTOR" iff F_STS_CODE = 'WSTS-A' and not F_KRS_CODE = 'WKREOS-A';
 *   - "KREOS" iff the reverse;
 *   - "BOTH": no row on either machine, and the slab flag line_head_both;
 *   - null (neither): the slab has no line-head row at all.
 * Codes are compared trimmed (the PC trims nchar already).
 */
export function lineHeadOf(s: { data: Readonly<Record<string, unknown>> } | null | undefined): LineHead | "BOTH" | null {
  const d = s?.data ?? {};
  const dist = text(d.F_STS_CODE) === DISTRIBUTOR_CODE;
  const kreos = text(d.F_KRS_CODE) === KREOS_CODE;
  if (dist && kreos) return "BOTH";
  if (dist) return "DISTRIBUTOR";
  if (kreos) return "KREOS";
  return null;
}

/** The station tables a line-head slab's typed row may be in: both, any
 *  batch (a slab typed on the Kreos form while the plant says Distributor is
 *  still that slab's typed row: typed_beside, flag wrong_line_head). */
export const LINE_HEAD_TABLES = ["distributor", "kreos"] as const;

/** "Slab N was typed on the Kreos form; the plant says Distributor." */
export function wrongLineHeadText(typedOn: LineHead, plantSays: LineHead): string {
  const w = (m: LineHead) => (m === "KREOS" ? "Kreos" : "Distributor");
  return `it was typed on the ${w(typedOn)} form; the plant says ${w(plantSays)}. Check which line head made it`;
}

/* ------------------------------------------------- the line head's thickness */

/**
 * The plant's thickness code (F_SLAB_THICKNESS, on the slab's own row) as the
 * line-head forms spell it (src/lib/thickness.ts canonThickness: the typed
 * spellings), for the Kreos's and the Distributor's slab_thickness (spec 4.1,
 * 5.1): 1 = 7 mm, 3 = 12 mm, 4 = 2 cm, 5 = 3 cm. The ERP holds this mapping,
 * not the plant (machine/view-rules.ts thicknessText shows the same words on
 * the screens; tests/plantMatchKreos.test.ts holds the two together). Any
 * other code (0 is "not set" at the plant; 2 is not a size the plant uses)
 * is NULL and the slab flag thickness_unknown: never a guess.
 */
export const LINE_HEAD_THICKNESS: Readonly<Record<number, { text: string; mm: string }>> = Object.freeze({
  1: { text: "7 mm", mm: "7" },
  3: { text: "12 mm", mm: "12" },
  4: { text: "2 cm", mm: "20" },
  5: { text: "3 cm", mm: "30" },
});

const codeOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** The typed spelling of a plant thickness code ("2 cm"), or null when the code is not known. */
export function lineHeadThickness(code: unknown): string | null {
  const n = codeOf(code);
  return n === null ? null : LINE_HEAD_THICKNESS[n]?.text ?? null;
}

/** The same code in millimetres as the MIS sheet's thickness box takes it ("20"), or null. */
export function lineHeadThicknessMm(code: unknown): string | null {
  const n = codeOf(code);
  return n === null ? null : LINE_HEAD_THICKNESS[n]?.mm ?? null;
}
