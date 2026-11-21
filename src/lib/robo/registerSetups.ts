/**
 * How a slab row in a register workbook is matched to the production setup it
 * was made under.
 *
 * A leaf module with no imports, so `node --test` can reach it — importRegister
 * itself pulls in @/lib/robo/utils and cannot be loaded by the test runner.
 * importRegister re-exports these, so callers need not know where they live.
 */

export function setupKey(date: string, shiftNumber: number, designName: string): string {
  return `${date}|${shiftNumber}|${designName.trim().toUpperCase()}`;
}

/**
 * The shift number a Production Setup row is filed under when its sheet has NO
 * Shift column at all (CR-001, 20 Nov 2026).
 *
 * Our own Complete Production download writes the setup sheet without a Shift
 * column (a setup belongs to the run, not to a shift), while every slab line
 * carries its shift. The rows used to be filed under shift 1, so on a re-import
 * only Shift A slabs found their machine configuration: a Shift B or C slab
 * matched nothing and was attached to a new setup with no machines. A row with
 * no shift now says "this date and design, any shift" — it is the fallback when
 * there is no row for the slab's own shift (setupEntriesFor).
 *
 * A sheet that HAS a Shift column is read exactly as before: a blank or bad
 * cell in it is still shift 1.
 */
export const ANY_SHIFT = 0;

/** The shift a setup row is filed under: its own when the sheet has a Shift
 *  column (1 when that cell is blank or not 1–3, as before), else ANY_SHIFT. */
export function setupShiftOf(hasShiftColumn: boolean, shiftRaw: number | null): number {
  if (!hasShiftColumn) return ANY_SHIFT;
  return shiftRaw && shiftRaw >= 1 && shiftRaw <= 3 ? Math.trunc(shiftRaw) : 1;
}

/** The setup rows a slab of this date, shift and design was made under: the
 *  rows filed under its own shift, else the date's shift-less rows, else none. */
export function setupEntriesFor<E>(
  setups: Record<string, E[]>,
  date: string,
  shiftNumber: number,
  designName: string,
): E[] {
  return setups[setupKey(date, shiftNumber, designName)]
    ?? setups[setupKey(date, ANY_SHIFT, designName)]
    ?? [];
}

/** The run's Target Slabs as the setup sheet states it: the first whole,
 *  positive number on any of its machine rows (each row repeats it), else null. */
export function setupTargetSlabs(entries: readonly { targetSlabs?: number | null }[]): number | null {
  for (const e of entries) {
    const t = e.targetSlabs;
    if (typeof t === "number" && Number.isInteger(t) && t > 0 && t <= 2_147_483_647) return t;
  }
  return null;
}

/**
 * The design a slab belongs to when its own row does not name one.
 *
 * Our Complete Production download no longer repeats Design Name on every slab
 * line — it belongs to the run, and the Production Setup sheet carries it once
 * per run rather than 500 times. Re-importing that workbook has to still know
 * which setup each slab was produced under, and the second sheet says so: it
 * is keyed by date, shift and design.
 *
 * This answers only when there is NO ambiguity — exactly one design configured
 * for that date and shift. Two designs in one shift is a real thing (a second
 * pour), and guessing between them would attach slabs to the wrong recipe
 * silently, which is worse than importing them with none.
 *
 * A setup row with no shift (ANY_SHIFT) counts for every shift of its date.
 *
 * Hand-written registers that do name a design on each line are unaffected;
 * the row's own value always wins.
 */
export function soleSetupDesign(
  setups: Record<string, unknown>,
  date: string,
  shiftNumber: number,
): string {
  const prefixes = [`${date}|${shiftNumber}|`, `${date}|${ANY_SHIFT}|`];
  const designs = new Set<string>();
  for (const key of Object.keys(setups)) {
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) {
        const design = key.slice(prefix.length);
        if (design) designs.add(design);
      }
    }
  }
  return designs.size === 1 ? [...designs][0] : "";
}
