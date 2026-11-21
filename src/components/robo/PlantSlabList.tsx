"use client";

// THE BATCH'S SLABS FROM THE PLANT, ON THE ROBO ENTRY SCREEN (owner, 17 Nov
// 2026; the rule is lib/robo/plantSlabs, the read /api/robo/production/plant-slabs).
// The operator taps a slab: its number, date and shift fill in, and they type
// only what the robot did. The list is an OFFER: a slab the robots did not
// touch is skipped, a slab that is not listed is typed as before, and when the
// list cannot be read the form works exactly as it always has.
import { useEffect, useRef, useState } from "react";
import { shortDate, thicknessWords, type PlantSlabRow } from "@/lib/robo/plantSlabs";

export interface PlantSlabs {
  /** loading: the first read is out. The others are the route's own. */
  state: "idle" | "loading" | "ok" | "nobatch" | "nomis" | "off" | "failed";
  batchKey: string;
  total: number;
  entered: number;
  rows: PlantSlabRow[];
  more: number;
  capped: boolean;
  /** The batch setup, and the batch number it had, that the list was read for. */
  batchRecipeId?: string | null;
  batchNo?: string | null;
  /** A re-read failed: the list on screen is the last one read. */
  stale: boolean;
}
const STATES: readonly unknown[] = ["ok", "nobatch", "nomis", "off", "failed"];
const NONE: PlantSlabs = { state: "idle", batchKey: "", total: 0, entered: 0, rows: [], more: 0, capped: false, stale: false };

/**
 * The list for a batch setup, read again whenever `version` moves (after a
 * save, a delete, a tap on Refresh) or the setup's batch number is corrected.
 * The rows on screen stay while a re-read is out, and an answer that is not
 * the latest asked for is dropped.
 */
export function usePlantSlabs(batchRecipeId: string | null, version: number, batchNo: string | null = null): PlantSlabs {
  const [plant, setPlant] = useState<PlantSlabs>(NONE);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!batchRecipeId) { setPlant(NONE); return; }
    // The rows of the SAME batch stay while a re-read is out; another batch's (another setup, or this
    // setup's number corrected) are dropped at once, so they are never shown under the new number.
    setPlant((p) => (p.state === "ok" && p.batchRecipeId === batchRecipeId && p.batchNo === batchNo ? p : { ...NONE, state: "loading" }));
    fetch(`/api/robo/production/plant-slabs?batchRecipeId=${encodeURIComponent(batchRecipeId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { state: "failed" }))
      .catch(() => ({ state: "failed" }))
      .then((d) => {
        if (mine !== seq.current) return;
        const state: PlantSlabs["state"] = STATES.includes(d?.state) ? d.state : "failed";
        setPlant((p) => {
          // A list already on screen outlives one failed re-read (plant wifi drops): it is marked, not thrown away.
          if (state === "failed" && p.state === "ok" && p.batchRecipeId === batchRecipeId && p.batchNo === batchNo) return { ...p, stale: true };
          return { ...NONE, ...(d && typeof d === "object" ? d : {}), state, rows: Array.isArray(d?.rows) ? d.rows : [], stale: false, batchRecipeId, batchNo };
        });
      });
    // batchNo: a setup corrected in place keeps its id, and its list is the new number's.
  }, [batchRecipeId, version, batchNo]);
  return plant;
}

export function PlantSlabList({ plant, batchLabel, currentSlabNumber, onPick, onRefresh }: {
  plant: PlantSlabs;
  /** The batch as the setup spells it. */
  batchLabel: string;
  /** The slab number on the form now: its row is marked. */
  currentSlabNumber: string;
  onPick: (row: PlantSlabRow) => void;
  onRefresh: () => void;
}) {
  if (plant.state === "idle") return null;
  const name = batchLabel.trim() || plant.batchKey || "this batch";
  const line =
    plant.state === "loading" ? "Reading the plant's slab list…"
    : plant.state === "nobatch" ? "Type the batch number in the batch setup to list its slabs from the plant."
    : plant.state === "nomis" ? `No MIS hour is filed under batch ${name} yet, so there is no slab list. Type the slab as usual.`
    : plant.state === "off" || plant.state === "failed" ? "Could not read the plant just now. Type the slab as usual."
    : plant.total === 0 ? `The plant has no slab in the MIS hours of batch ${name}. Type the slab as usual.`
    : plant.rows.length === 0 ? `All ${plant.total} slabs of batch ${name} that the plant has are entered.`
    : null;
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900">Slabs of batch {name} from the plant</h3>
        <div className="flex items-baseline gap-3 text-xs text-gray-600">
          {plant.state === "ok" && plant.total > 0 && (
            <span>{plant.total} made · {plant.entered} entered · <b className="text-gray-900">{plant.total - plant.entered} to enter</b></span>
          )}
          <button type="button" onClick={onRefresh} className="font-medium text-sky-700 underline hover:text-sky-900">Refresh</button>
        </div>
      </div>
      {line ? (
        <p className="mt-2 text-sm text-gray-600">{line}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-gray-600">
            Tap a slab: its number, date and shift fill in, and its thickness is saved with it. Type the robot&rsquo;s values and save. Skip a slab the robots did not touch; a slab not listed here can still be typed.
          </p>
          <div className="mt-2 grid max-h-56 grid-cols-1 gap-1.5 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {plant.rows.map((r) => {
              const on = r.slabNumber === currentSlabNumber.trim();
              return (
                <button key={r.slabNo} type="button" onClick={() => onPick(r)} aria-pressed={on}
                  className={`flex min-h-[44px] items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm ${on ? "border-sky-600 bg-white ring-2 ring-sky-200" : "border-gray-200 bg-white hover:border-sky-400"}`}>
                  <span className="font-semibold tabular-nums text-gray-900">{r.slabNumber}</span>
                  <span className="min-w-0 text-right text-xs leading-tight text-gray-600">
                    <span className="block">{shortDate(r.date)}{r.shift ? ` · Shift ${r.shift}` : ""}{r.thickness != null ? ` · ${thicknessWords(r.thickness)}` : ""}</span>
                    <span className="block tabular-nums text-gray-500">{r.dist ?? "—"} → {r.press ?? "—"}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {(plant.more > 0 || plant.capped) && (
            <p className="mt-1 text-xs text-gray-500">
              {plant.more > 0 ? `${plant.more} more follow these; they come up as these are entered. ` : ""}
              {plant.capped ? "This batch is longer than the list can hold in one go." : ""}
            </p>
          )}
          {plant.stale && <p className="mt-1 text-xs text-amber-700">Could not refresh the list just now. It may still show a slab that is already entered.</p>}
          <p className="mt-1 text-[11px] text-gray-500">Times are the plant&rsquo;s: when the slab left the distributor → when it reached the press. The robots are between the two.</p>
        </>
      )}
    </div>
  );
}
