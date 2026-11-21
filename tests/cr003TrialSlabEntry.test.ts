import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NO_BATCH, TRIAL_SUFFIX, batchLabel, hasTrialSuffix, parseSetting, planPhotos, resolveTrialBatchNo, sequenceGroupKey,
  settingLabel, stripTrialSuffix, trialSetupProblem,
} from "../src/lib/robo/trial.ts";
import { batchNosMatch, canonBatchNo } from "../src/lib/robo/batchNo.ts";
import { roboNav, navHrefs } from "../src/lib/navModel.ts";

// CR-003 (20 Nov 2026): Trial Slab Entry — a page of its own below Slab Entry,
// an independent batch setup for every trial slab, and trial slabs counted as
// ordinary production everywhere.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ── Labels ─────────────────────────────────────────────────────────────── */

test("a regular slab's batch reads as before; a trial slab's reads 'D-1506 (Trial Slab)'", () => {
  assert.equal(batchLabel("D-1506", false), "D-1506");
  assert.equal(batchLabel(null, false), "-");
  assert.equal(batchLabel("D-1506", true), "D-1506 (Trial Slab)");
  assert.equal(batchLabel("  ", true), `${NO_BATCH} ${TRIAL_SUFFIX}`, "no batch: '-- (Trial Slab)'");
  assert.equal(NO_BATCH, "--");
});

test("a batch cell read back from a download loses the trial label, and only that", () => {
  assert.equal(stripTrialSuffix("D-1506 (Trial Slab)"), "D-1506");
  assert.equal(stripTrialSuffix("D-1506 (trial slab) "), "D-1506");
  assert.equal(stripTrialSuffix("D-1506"), "D-1506");
  assert.equal(stripTrialSuffix("B (Trial) 7"), "B (Trial) 7");
  assert.equal(hasTrialSuffix("-- (Trial Slab)"), true);
  assert.equal(hasTrialSuffix("D-1506"), false);
});

/* ── Liquid / Powder setting ────────────────────────────────────────────── */

test("a setting is Normal unless it says Define", () => {
  assert.equal(parseSetting("DEFINE"), "DEFINE");
  assert.equal(parseSetting(" define "), "DEFINE");
  assert.equal(parseSetting(null), "NORMAL");
  assert.equal(parseSetting("anything"), "NORMAL");
  assert.equal(settingLabel("DEFINE"), "Define");
  assert.equal(settingLabel(undefined), "Normal");
});

test("Define needs its reference photo; Normal does not; Robo2 has no powder", () => {
  const base = { machineName: "Roycut-1", hasPowder: true, liquidSetting: "NORMAL", powderSetting: "NORMAL", liquidPhoto: false, powderPhoto: false };
  assert.equal(trialSetupProblem([base]), null);
  assert.match(trialSetupProblem([{ ...base, liquidSetting: "DEFINE" }]) ?? "", /Liquid is set to Define — add its reference photo/);
  assert.equal(trialSetupProblem([{ ...base, liquidSetting: "DEFINE", liquidPhoto: true }]), null);
  assert.match(trialSetupProblem([{ ...base, powderSetting: "DEFINE" }], () => "Robo1") ?? "", /^Robo1: Powder/);
  assert.equal(trialSetupProblem([{ ...base, machineName: "Roymix", hasPowder: false, powderSetting: "DEFINE" }]), null, "Robo2's powder is never asked");
});

/* ── Photos ─────────────────────────────────────────────────────────────── */

test("a save claims uploaded photos, keeps its own, copies another trial's and removes what it dropped", () => {
  const plan = planPhotos("setup-2", [
    { machineId: "m1", kind: "LIQUID", photoId: "new" },
    { machineId: "m1", kind: "POWDER", photoId: "mine" },
    { machineId: "m2", kind: "LIQUID", photoId: "prev" },
  ], [
    { id: "new", batchRecipeId: null },
    { id: "mine", batchRecipeId: "setup-2" },
    { id: "prev", batchRecipeId: "setup-1" },
  ], ["mine", "old"]);
  assert.equal(plan.problem, null);
  assert.deepEqual(plan.actions.map((a) => [a.action, a.claim.photoId]), [["claim", "new"], ["keep", "mine"], ["copy", "prev"]]);
  assert.deepEqual(plan.remove, ["old"], "the dropped photo goes; the kept one stays");
});

test("Copy from previous record never takes the previous trial's photo away from it", () => {
  // A new setup (no id yet) naming the previous trial's photos copies every one.
  const plan = planPhotos(null, [{ machineId: "m1", kind: "LIQUID", photoId: "p1" }], [{ id: "p1", batchRecipeId: "setup-1" }], []);
  assert.deepEqual(plan.actions.map((a) => a.action), ["copy"]);
  assert.deepEqual(plan.remove, []);
});

test("two photos for one slot, or a photo that is gone, stop the save", () => {
  assert.ok(planPhotos("s", [
    { machineId: "m1", kind: "LIQUID", photoId: "a" },
    { machineId: "m1", kind: "LIQUID", photoId: "b" },
  ], [{ id: "a", batchRecipeId: null }, { id: "b", batchRecipeId: null }], []).problem);
  assert.ok(planPhotos("s", [{ machineId: "m1", kind: "LIQUID", photoId: "x" }], [], []).problem);
});

/* ── Batch No. ──────────────────────────────────────────────────────────── */

test("a bare '1506' joins the one existing production batch it names; anything else stays as typed", () => {
  const prod = ["D-1506", "D-1505", "A-1200", "D-1200"];
  const r = (t: string | null, e = prod) => resolveTrialBatchNo(t, e, canonBatchNo, batchNosMatch);
  assert.equal(r("1506"), "D-1506", "the trial reads 'D-1506 (Trial Slab)' and groups with D-1506");
  assert.equal(r(" 1506 "), "D-1506");
  assert.equal(r("D-1506"), "D-1506");
  assert.equal(r("d1506"), "d1506", "a prefixed number is the operator's own spelling");
  assert.equal(r("1200"), "1200", "matches two series (A and D) — not guessed");
  assert.equal(r("1999"), "1999", "matches nothing — a new batch");
  assert.equal(r(""), null, "Batch No. is optional");
  assert.equal(r(null), null);
});

/* ── S.No. ──────────────────────────────────────────────────────────────── */

test("trial slabs are numbered together per batch; regular slabs by their setup, as before", () => {
  assert.equal(sequenceGroupKey({ batchRecipeId: "r1", isTrial: false, batchKey: "1506" }), "r1");
  assert.equal(sequenceGroupKey({ batchRecipeId: "t1", isTrial: true, batchKey: "1506" }), "trial|1506");
  assert.equal(sequenceGroupKey({ batchRecipeId: "t2", isTrial: true, batchKey: "1506" }), "trial|1506");
  assert.equal(sequenceGroupKey({ batchRecipeId: "t3", isTrial: true, batchKey: null }), "t3", "a trial with no batch is its own group");
  assert.equal(sequenceGroupKey({ batchRecipeId: null, isTrial: false, batchKey: null }), null);
});

/* ── Navigation ─────────────────────────────────────────────────────────── */

test("the sidebar reads Slab Entry, then Trial Slab Entry, under Production", () => {
  const nav = roboNav();
  assert.equal(nav.kind, "sections");
  if (nav.kind !== "sections") return;
  const production = nav.blocks.find((b) => b.label === "Production");
  assert.deepEqual(production?.items.map((i) => [i.label, i.href]), [
    ["Slab Entry", "/robo"], ["Trial Slab Entry", "/robo/trial"], ["Slab Records", "/robo/slabs"],
  ]);
  assert.equal(navHrefs(nav).indexOf("/robo/trial"), navHrefs(nav).indexOf("/robo") + 1);
  assert.match(src("src/app/robo/page.tsx"), /title: "Slab Entry \| Pacific ERP"/);
  assert.match(src("src/app/robo/page.tsx"), />Slab entry</);
});

/* ── The regular Slab Entry is unchanged ────────────────────────────────── */

test("the regular Slab Entry never sees a trial setup or a trial slab", () => {
  const active = src("src/app/api/robo/shifts/active/route.ts");
  assert.match(active, /batchRecipes: \{ where: \{ isTrial: false \}/);
  assert.match(active, /where: \{ OR: \[\{ batchRecipeId: null \}, \{ batchRecipe: \{ isTrial: false \} \}\] \}/);
  const order = src("src/lib/robo/registerOrderDb.ts");
  assert.match(order, /export function entryScope\(trial: boolean\)/);
  assert.match(order, /where: \{ shift: \{ status: "ACTIVE" \}, \.\.\.scope \}/);
  // The regular form is the one it always was: it reads none of the trial routes.
  const regular = src("src/components/robo/RoboEntryForm.tsx");
  assert.doesNotMatch(regular, /\/api\/robo\/trial/);
  assert.match(regular, /"\/api\/robo\/shifts\/active"/);
});

test("Trial Slab Entry reads and writes through the trial routes", () => {
  const form = src("src/components/robo/trial/TrialEntryForm.tsx");
  assert.match(form, /export function TrialEntryForm\(/);
  assert.match(form, /"\/api\/robo\/trial\/active"/);
  assert.match(form, /`\/api\/robo\/trial\/setups\/\$\{editingBatchId\}` : "\/api\/robo\/trial\/setups"/);
  assert.match(form, /"\/api\/robo\/production\/next-number\?trial=1"/);
  assert.match(form, /"\/api\/robo\/trial\/setups\/latest"/, "Copy from previous record");
  assert.match(form, /<textarea value=\{slab\.remarks\}/, "a larger Remarks box");
  assert.match(form, /r\.batchRecipe\?\.batchNo\?\.trim\(\) \|\| NO_BATCH/, "Recent slabs' Batch No. reads -- when none");
  assert.doesNotMatch(form, /onClick=\{closeBatch\}/, "no Close Batch: a trial setup is closed by its slab");
});

test("a trial setup takes one slab, and a slab number is still unique across both pages", () => {
  const post = src("src/app/api/robo/production/route.ts");
  assert.match(post, /if \(clash\) throw new DuplicateSlabError\(\);\n    if \(isTrial\) \{/);
  assert.match(post, /throw new TrialSetupUsedError\(\)/);
  assert.match(post, /status: 422/);
});

test("a trial slab's batch edit stays on its own setup; regular splits and imports never join a trial setup", () => {
  const patch = src("src/app/api/robo/production/[id]/route.ts");
  assert.match(patch, /if \(currentRecipe\.isTrial\) \{/);
  assert.match(patch, /isTrial: false, \/\/ CR-003: a regular split never joins a trial setup/);
  assert.match(src("src/app/api/robo/imports/route.ts"), /where: \{ shiftId: shift\.id, isTrial: false \}/);
});

test("trial slabs are labelled in Slab Records and both downloads, and grouped with their batch", () => {
  assert.match(src("src/components/robo/SlabsBrowser.tsx"), /batchLabel\(r\.batchRecipe\?\.batchNo, r\.batchRecipe\?\.isTrial\)/);
  assert.match(src("src/lib/robo/productionExport.ts"), /"Batch No\.":\s+r\.isTrial \? batchLabel\(r\.batchNo, true\) : dash\(r\.batchNo\)/);
  assert.match(src("src/app/api/robo/exports/production/route.ts"), /isTrial:\s+Boolean\(r\.batchRecipe\?\.isTrial\)/);
  assert.match(src("src/app/api/robo/exports/delays/route.ts"), /batchLabel\(d\.productionRecord\.batchRecipe\.batchNo, true\)/);
  // Grouping is by the batch number itself, so a trial slab stays in its batch's group and total.
  assert.match(src("src/lib/robo/productionGrouping.ts"), /canonBatchNo\(r\.batchNo\)/);
});

test("the schema change is additive: a flag, two settings and the photo table", () => {
  const sql = src("prisma/migrations/0002_trial_slab_entry/migration.sql");
  assert.match(sql, /ALTER TABLE "RoboBatchRecipe" ADD COLUMN\s+"isTrial" BOOLEAN NOT NULL DEFAULT false;/);
  assert.match(sql, /ADD COLUMN\s+"liquidSetting" TEXT,\s*\nADD COLUMN\s+"powderSetting" TEXT;/);
  assert.match(sql, /CREATE TABLE "RoboReferencePhoto"/);
  assert.doesNotMatch(sql, /DROP |ALTER COLUMN/, "nothing existing is dropped or changed");
});
