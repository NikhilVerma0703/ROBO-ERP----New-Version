"use client";

// THE BATCH SETUP, FILLED FROM THE PLANT (owner, 17 Nov 2026; the rule is
// lib/robo/plantSlabs plantBatchOffers, the read
// /api/robo/batch-recipes/plant-batches). One pick fills the batch number, the
// production date (the day of the batch's first slab) and the thickness. The
// design stays the operator's: Robo's designs are the robots' patterns, not
// the product MIS names, which is shown to help the pick. When the plant
// cannot be read the setup is typed exactly as before.
import { useEffect, useState } from "react";
import { plantBatchOfferWords, shortDate, thicknessWords, type PlantBatchOffer } from "@/lib/robo/plantSlabs";

type State = "loading" | "ok" | "off" | "failed";

export function PlantBatchPicker({ onPick, labelClass, inputClass }: {
  onPick: (offer: PlantBatchOffer) => void;
  labelClass: string;
  inputClass: string;
}) {
  const [state, setState] = useState<State>("loading");
  const [offers, setOffers] = useState<PlantBatchOffer[]>([]);
  const [picked, setPicked] = useState<PlantBatchOffer | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/robo/batch-recipes/plant-batches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { state: "failed" }))
      .catch(() => ({ state: "failed" }))
      .then((d) => {
        if (ignore) return;
        const s: State = d?.state === "ok" || d?.state === "off" ? d.state : "failed";
        setState(s);
        setOffers(s === "ok" && Array.isArray(d?.offers) ? d.offers : []);
      });
    return () => { ignore = true; };
  }, []);

  // No plant tables at all: nothing to offer, and nothing to say.
  if (state === "off") return null;
  return (
    <div className="col-span-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 lg:col-span-4">
      <span className={labelClass}>Fill from the plant</span>
      <select
        value={picked?.batchKey ?? ""}
        disabled={state !== "ok" || offers.length === 0}
        onChange={(e) => {
          const o = offers.find((x) => x.batchKey === e.target.value) ?? null;
          setPicked(o);
          if (o) onPick(o);
        }}
        className={inputClass}
      >
        <option value="">
          {state === "loading" ? "Reading the plant's batches…"
            : state === "failed" ? "Could not read the plant just now"
            : offers.length ? "Pick a batch the plant made…" : "No batch from MIS in the last days"}
        </option>
        {offers.map((o) => <option key={o.batchKey} value={o.batchKey}>{plantBatchOfferWords(o)}</option>)}
      </select>
      <p className="mt-1 text-xs text-gray-600">
        {picked
          ? <>Filled from the plant: batch {picked.batch}, production date {shortDate(picked.date)} (its first slab){picked.thickness != null ? <>, thickness {thicknessWords(picked.thickness)}</> : null}.
            {picked.thicknesses.length > 1 ? <> This batch was made in {picked.thicknesses.map((t) => thicknessWords(t)).join(" and ")}; each slab takes its own from the plant.</> : null}
            {" "}Pick the Robo design yourself{picked.design ? <>: the product is {picked.design}</> : null}.</>
          : state === "failed"
            ? "Type the setup as usual."
            : "One pick fills the batch number, production date and thickness. You can still change any of them."}
      </p>
    </div>
  );
}
