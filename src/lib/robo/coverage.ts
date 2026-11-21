// MADE BY THE PLANT vs ENTERED IN ROBO (owner, 17 Nov 2026: "Made vs entered").
// For a batch: how many slabs the plant made, how many of those are in the Robo
// register, and which numbers are not. A slab the robots never touched is not
// entered in Robo; that is expected, and this only counts, it judges nothing.
//
// PURE: no imports, so the route, the screen and `node --test` read one rule.

/** The most batches one answer holds; the rest are counted in `leftOut`. */
export const COVERAGE_MAX_BATCHES = 40;

/** Slab numbers as short text: "172600–172604, 172610". Ascending, each number once; runs of two or more joined by an en dash. */
export function compressRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

export interface Coverage {
  /** Slabs of the batch the plant has. */
  made: number;
  /** Of those, in the Robo register (by number). */
  entered: number;
  /** The plant's slabs of the batch not in the register, ascending. */
  notEntered: number[];
}

/**
 * `plantNumbers`: the batch's numbers the plant has made. `enteredNumbers`:
 * Robo register numbers (any batch; those the plant did not make are ignored).
 * Repeats count once.
 */
export function coverage(plantNumbers: readonly number[], enteredNumbers: readonly number[]): Coverage {
  const made = [...new Set(plantNumbers)].sort((a, b) => a - b);
  const have = new Set(enteredNumbers);
  const notEntered = made.filter((n) => !have.has(n));
  return { made: made.length, entered: made.length - notEntered.length, notEntered };
}
