import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonBatchNo } from "@/lib/robo/batchNo";
import { designMatchKey } from "@/lib/robo/referenceSheet";
import { roboGate } from "@/lib/rbac";

/**
 * GET /api/robo/batch-numbers — every batch number on record, most-recent
 * first, deduped so the dozen spellings of one batch ("D-1372", "d1372",
 * "1372") appear once (the canonical rule from batchNo.ts, keeping the newest
 * spelling as the label).
 *
 * Feeds the Batch Number box on Reports and Downloads two ways at once: the
 * whole list is the dropdown, and the FIRST element is the latest batch, which
 * both screens select by default when they open.
 *
 * ── AND THE DESIGN EACH BATCH RAN ─────────────────────────────────────────
 * `designs` pairs the batch's canonical key with each design name its setup
 * rows carry, so Reports can say what D-1473 is the moment it is typed. It
 * comes back WITH the list rather than from a lookup per keystroke: the names
 * are read in the same query, the whole thing is one request on first load,
 * and typing then costs nothing.
 *
 * A batch can be MIXED — D-1423 carries AUREATE and Roots setups — so it has
 * a pair for every distinct design in it. Distinct by the Reference Sheet's
 * own rule (designMatchKey: case and spacing ignored), or the two spellings of
 * one design would read as two designs; the label kept is the one the newest
 * setup typed.
 *
 * A LIST, newest setup first, and not an object keyed by batch: the page
 * merges several keys for one typed batch ("D-1473" also counts setups typed
 * "1473") and keeps the first spelling of a design it meets, so the order has
 * to survive the trip — and an object lists number-only keys like "1473"
 * first, in ascending order, whatever order they were written in (code
 * review, 26 Oct 2026).
 */
export async function GET() {
  // The in-route gate every /api/robo handler carries (lib/rbac.ts roboGate):
  // the edge runs without the database, so a deactivated or signed-out-
  // everywhere session is refused here or not at all (code review ROBO-5).
  const refused = await roboGate();
  if (refused) return refused;
  const recipes = await prisma.roboBatchRecipe.findMany({
    where: { batchNo: { not: null } },
    select: { batchNo: true, designName: true },
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set<string>();
  const batchNumbers: string[] = [];
  /** [canonical batch key, design name], newest setup first. */
  const designs: [string, string][] = [];
  /** The designs each batch key already has a pair for, by designMatchKey. */
  const named = new Map<string, Set<string>>();
  for (const r of recipes) {
    const display = (r.batchNo ?? "").trim();
    if (!display) continue; // a stored "" is not a batch number
    const key = canonBatchNo(display);
    if (!key) continue;
    if (!seen.has(key)) { // one entry per real batch, the newest spelling
      seen.add(key);
      batchNumbers.push(display);
    }
    const name = (r.designName ?? "").trim();
    const fold = designMatchKey(name);
    if (!name || !fold) continue; // a setup with no design says nothing
    const folds = named.get(key) ?? new Set<string>();
    // First seen wins, and the rows arrive newest first, so a design renamed
    // between runs shows as the newest setup typed it.
    if (!folds.has(fold)) {
      folds.add(fold);
      designs.push([key, name]);
    }
    named.set(key, folds);
  }

  return NextResponse.json({ batchNumbers, designs });
}
