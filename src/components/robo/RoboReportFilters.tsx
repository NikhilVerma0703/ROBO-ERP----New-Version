"use client";
// The filter bar shared by Reports and Downloads: Batch Number first, then
// Production Date (All / Date Wise / Date Range). One component so the two
// screens can never drift in order, wording, or behaviour — change (4)/(6).
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ReportMode } from "@/lib/robo/reportQuery";
import { batchNosMatch } from "@/lib/robo/batchNo";
import { designMatchKey } from "@/lib/robo/referenceSheet";

const input =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/**
 * The design(s) of the batch in the box, found by the report's OWN rule
 * (batchNo.ts batchNosMatch, which resolveBatchRecipeIds uses) — so the name
 * beside the box is the design of the slabs the page is counting. A bare
 * "1473" counts D-1473's slabs, so it names D-1473's design; "D-1473" also
 * counts setups typed as bare "1473", so their designs are named too; "1248"
 * counts both A-1248 and D-1248, and names both.
 *
 * `designs` is the route's list of [canonical batch key, design name] pairs,
 * newest setup first. Every design across the matching keys, once each by the
 * Reference Sheet's rule (designMatchKey), joined by " + ". The FIRST spelling
 * met is kept, and the list's order makes that the one the newest setup typed
 * — the route sends a list for exactly this, since an object would put
 * number-only keys like "1473" first. "" when nothing matches.
 */
export function batchDesignName(batch: string, designs: ReadonlyArray<readonly [string, string]>): string {
  const typed = batch.trim();
  if (!typed) return "";
  const names = new Map<string, string>();
  for (const [key, name] of designs) {
    if (!batchNosMatch(typed, key)) continue;
    const fold = designMatchKey(name);
    if (fold && !names.has(fold)) names.set(fold, name.trim());
  }
  return [...names.values()].join(" + ");
}

/**
 * Load every batch number on record (for the dropdown) and, on first load,
 * select the LATEST one — the batch at the top of the list — unless the operator
 * has already typed something. Returns the options for the datalist.
 *
 * The default is applied exactly once (a ref, not the options length), so it
 * seeds the screen without ever fighting a value the operator sets afterwards.
 */
export function useRoboBatchOptions(setBatch: Dispatch<SetStateAction<string>>): string[] {
  return useRoboBatches(setBatch).options;
}

/**
 * The same load, with the DESIGN each batch ran — `designOf(batch)` answers
 * for whatever is in the box by the report's own batch rule (batchDesignName),
 * so "d1473", "D-1473" and a bare "1473" give the design of the slabs the page
 * counts, and an unknown batch gives "".
 *
 * The names come back with the list, in one request on first load, so typing
 * in the Batch box costs nothing: no lookup per keystroke, nothing to debounce,
 * and no way for the name beside the box to lag the number in it.
 */
export function useRoboBatches(setBatch: Dispatch<SetStateAction<string>>): {
  options: string[];
  designOf: (batch: string) => string;
} {
  const [options, setOptions] = useState<string[]>([]);
  const [designs, setDesigns] = useState<[string, string][]>([]);
  const didDefault = useRef(false);
  useEffect(() => {
    let ignore = false;
    fetch("/api/robo/batch-numbers")
      .then((r) => (r.ok ? r.json() : { batchNumbers: [] }))
      .then((d: { batchNumbers?: string[]; designs?: [string, string][] }) => {
        if (ignore) return;
        const list = d.batchNumbers ?? [];
        setOptions(list);
        setDesigns(Array.isArray(d.designs) ? d.designs : []);
        if (!didDefault.current && list.length > 0) {
          didDefault.current = true;
          setBatch((cur) => (cur.trim() ? cur : list[0]));
        }
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, [setBatch]);

  const designOf = useCallback((batch: string) => batchDesignName(batch, designs), [designs]);
  return { options, designOf };
}

interface Props {
  mode: ReportMode;
  setMode: Dispatch<SetStateAction<ReportMode>>;
  date: string;
  setDate: Dispatch<SetStateAction<string>>;
  from: string;
  setFrom: Dispatch<SetStateAction<string>>;
  to: string;
  setTo: Dispatch<SetStateAction<string>>;
  batch: string;
  setBatch: Dispatch<SetStateAction<string>>;
  /** Every batch number on record, for the dropdown; free typing is allowed. */
  batchOptions: string[];
  /** The design the batch in the box ran, shown beside it. Omitted on screens
   *  that do not ask for it, so Downloads reads exactly as it did. */
  designName?: string;
}

export function RoboReportFilters({
  mode, setMode, date, setDate, from, setFrom, to, setTo, batch, setBatch, batchOptions, designName,
}: Props) {
  const typed = batch.trim();
  return (
    <div className="flex flex-col gap-3">
      {/* 1 ── Batch Number (a dropdown of every batch, plus free typing) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-32 text-sm font-medium text-gray-700">Batch Number</label>
        <input
          list="robo-batch-options"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          placeholder="All batches — pick or type"
          aria-label="Batch number"
          className={input}
        />
        <datalist id="robo-batch-options">
          {batchOptions.map((b) => <option key={b} value={b} />)}
        </datalist>
        {/* THE DESIGN THIS BATCH RAN, read-only, beside the number it belongs
            to — so the operator can see at a glance that D-1473 is the batch
            they meant before reading a single figure. It is a reading of the
            register, not a filter: nothing here changes what the page counts.
            A batch nobody recognises says so rather than going blank, which
            would read as "still loading". */}
        {designName !== undefined && typed && (
          <span className="flex items-baseline gap-2 text-sm" aria-live="polite">
            <span className="text-gray-400">Design</span>
            {designName
              ? <span className="font-semibold text-gray-900">{designName}</span>
              : <span className="text-gray-400">— no batch on record</span>}
          </span>
        )}
        {typed && (
          <button
            type="button"
            onClick={() => setBatch("")}
            className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* 2 ── Production Date (All / Date Wise / Date Range) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-32 text-sm font-medium text-gray-700">Production Date</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as ReportMode)} className={input}>
          <option value="ALL">All</option>
          <option value="DATE">Date Wise</option>
          <option value="RANGE">Date Range</option>
        </select>
        {mode === "DATE" && (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        )}
        {mode === "RANGE" && (
          <>
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
            <span className="text-sm text-gray-400">to</span>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </>
        )}
      </div>
    </div>
  );
}
