import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ROLE-BASED ACCESS FOR THE TWO PLANT MODULES, END TO END (owner, 26 Oct
// 2026). Alias-free relative imports with an explicit .ts extension, every
// module in the chain import-free down to lib/roles.ts — the idiom
// tests/labAccess.test.ts and tests/chromiaAccess.test.ts use, and the reason
// lib/plantAccess.ts is written the way it is: `node --test` resolves neither
// the `@/` alias nor next-auth, so the rule that decides who may do what has
// to be reachable from here.
import {
  ALREADY_SAVED, NOT_YOURS, ONLY_TODAY, PLANT_INCHARGE, PLANT_RIGHTS,
  plantRightsOf, plantRightsOfUser, plantTierOf, plantTierOfUser, type PlantTier,
} from "../src/lib/plantAccess.ts";
// STANDALONE (Robo ERP): routeCaps.ts (the main ERP's edge middleware caps),
// chromia/tier.ts and the ERP-wide navModel are not part of Robo ERP, so they
// are not imported. See the STANDALONE notes below for each test that went.
import { ROLE_LABEL, ROLE_RANK, rankOf, CAPPED_MODULE_ROLES } from "../src/lib/roles.ts";
import { roboNav, navHrefs } from "../src/lib/navModel.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const src = (p: string) => read(`src/${p}`);

/* ── THE TIER TABLE ────────────────────────────────────────────────── */

test("the two line tablets are operators; the Plant In-Charge and an admin are not", () => {
  assert.equal(plantTierOf("ROBO", "SHOP_FLOOR"), "OPERATOR");
  assert.equal(plantTierOf("CHROMIA", "SHOP_FLOOR"), "OPERATOR");
  assert.equal(plantTierOf(PLANT_INCHARGE, "SHOP_FLOOR"), "INCHARGE");
  assert.equal(plantTierOf("ADMIN", "OFFICE"), "INCHARGE");
  // TRANSITIONAL: a login left on the retired Chromia department is a tablet.
  assert.equal(plantTierOf("INCHARGE", "CHROMIA"), "OPERATOR");
});

test("every other role has no plant tier at all — the modules are not theirs", () => {
  // COMMERCIAL_DOCS and COMMERCIAL_LOGISTICS: retired on 8 Nov 2026 (lib/roles.ts RETIRED_ROLES), kept here as a stray holder, who still gets nothing.
  for (const role of ["OPERATOR", "INCHARGE", "LINE_MANAGER", "STORE", "MAINTENANCE", "SALES",
    "COMMERCIAL", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC", "COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS",
    "FINANCE", "ACCOUNTS", "SAMPLING", "LAB", "VIEWER", ""]) {
    assert.equal(plantTierOf(role, "SHOP_FLOOR"), null, `${role || "(none)"} has no plant tier`);
    assert.equal(plantTierOf(role, "OFFICE"), null, `${role || "(none)"} on OFFICE has no plant tier`);
  }
  // VIEWER signs in as ADMIN with readOnly set (src/auth.ts), so what reaches
  // a gate is "ADMIN" — never the name above. A tier for it here would be a
  // tier nothing ever asks for, and the null is the honest answer.
  assert.equal(plantTierOfUser(null), null);
  assert.equal(plantTierOfUser(undefined), null);
});

// STANDALONE (Robo ERP): "the Role enum, lib/roles.ts and the tier table agree"
// and "scripts/0141 adds the enum value" read the main ERP's users/Role enum and
// scripts/0141. Robo ERP has no users table or Role enum (no sign-in), so they
// are not carried. The rank/label half is kept here:
test("the Plant In-Charge is a rank-1 capped module role", () => {
  assert.equal(rankOf(PLANT_INCHARGE), 1, "rank 1, below every rank test in the ERP");
  assert.equal(ROLE_RANK.PLANT_INCHARGE, 1);
  assert.equal(ROLE_LABEL.PLANT_INCHARGE, "Plant In-Charge");
  assert.ok(CAPPED_MODULE_ROLES.has(PLANT_INCHARGE), "only an admin hands this login out");
});


/* ── THE RIGHTS TABLE ──────────────────────────────────────────────── */

const RIGHTS = ["slabExports", "anyDate", "amendSaved", "roster", "leave", "downloads"] as const;

test("an operator may do none of the six; an in-charge may do all six", () => {
  for (const key of RIGHTS) {
    assert.equal(PLANT_RIGHTS.OPERATOR[key], false, `the tablet may not: ${key}`);
    assert.equal(PLANT_RIGHTS.INCHARGE[key], true, `the Plant In-Charge may: ${key}`);
  }
  assert.equal(PLANT_RIGHTS.OPERATOR.tier, "OPERATOR");
  assert.equal(PLANT_RIGHTS.INCHARGE.tier, "INCHARGE");
});

test("a login with no tier reads as the narrowest one, not the widest", () => {
  // plantRightsOf is asked in places where the gate has not yet refused — a
  // request with no session at all, for one. Failing open there would be the
  // whole change undone by a missing cookie.
  assert.deepEqual(plantRightsOf(null), PLANT_RIGHTS.OPERATOR);
  assert.deepEqual(plantRightsOfUser(null), PLANT_RIGHTS.OPERATOR);
  assert.deepEqual(plantRightsOfUser({ role: "SALES", branch: "OFFICE" }), PLANT_RIGHTS.OPERATOR);
  assert.deepEqual(plantRightsOfUser({ role: PLANT_INCHARGE }), PLANT_RIGHTS.INCHARGE);
  assert.deepEqual(plantRightsOfUser({ role: "ADMIN" }), PLANT_RIGHTS.INCHARGE);
});

test("the rights handed out cannot be widened by whoever receives them", () => {
  const r = plantRightsOfUser({ role: "ROBO" }) as { leave: boolean };
  assert.throws(() => { "use strict"; r.leave = true; }, "frozen");
  assert.equal(plantRightsOfUser({ role: "ROBO" }).leave, false);
});

/* ── WHERE EACH LOGIN MAY GO, AT THE EDGE ─────────────────────────── */

// STANDALONE (Robo ERP): the main ERP's tests of routeCaps (roboMayVisit,
// plantInchargeMayVisit, homeFor, plantOperatorRefused), of middleware.ts, of
// chromiaTierOf and of the ERP-wide sidebar for every role lived here. Robo ERP
// has no sign-in and no middleware by design, so those 13 tests are not
// carried. The rights table above, the route gates and the screens below are
// the parts of the same feature that still run, and are kept unchanged.

test("the Robo sidebar is the Robo rows, in the Robo login's order — Trial Slab Entry right below Slab Entry (CR-003)", () => {
  assert.deepEqual(navHrefs(roboNav()), ["/robo", "/robo/trial", "/robo/slabs", "/robo/reports", "/robo/downloads", "/robo/import", "/robo/masters", "/robo/attendance"]);
});


test("the route gate refuses the same three cards, by rights and not by path", () => {
  const s = src("lib/attendance/server.ts");
  assert.match(s, /const rights = plantRightsOfUser\(await currentUser\(\)\)/, "read from the session, in the shared half");
  assert.match(s, /if \(head === "leave" && !rights\.leave\) return NOT_YOURS;/);
  assert.match(s, /if \(\(head === "records" \|\| head === "export"\) && !rights\.downloads\) return NOT_YOURS;/);
  assert.match(s, /if \(head === "operators" && method !== "GET" && !rights\.roster\) return NOT_YOURS;/);
  // The roster's GET is NOT refused: the tablet has to read the list of
  // operators to draw the register it is allowed to write.
  assert.match(s, /if \(head === "operators" && !id\) \{\s*\n\s*if \(method === "GET"\) return json\(await listOperators\(\)\);/);
});

test("the route gate locks the tablet to today, and to writing a row once", () => {
  const s = src("lib/attendance/server.ts");
  // Both the read and the write, against the SERVER's plant date — the PUT
  // against the one reading it then shares with dayKind, the GET against its
  // own, since nothing else on that path needs one.
  assert.match(s, /!rights\.anyDate && date !== today\) return bad\(ONLY_TODAY, 403\);/, "the day PUT");
  assert.match(s, /!rights\.anyDate && date !== todayPlant\(\)\) return bad\(ONLY_TODAY, 403\);/, "the day GET");
  assert.equal((s.match(/return bad\(ONLY_TODAY, 403\);/g) ?? []).length, 2, "both, and only those two");
  assert.match(s, /!rights\.amendSaved && amendsSavedRow\(existing, \{ lines, inTime, outTime \}\)/);
  // Asked against what WILL BE STORED — after the clock rules have decided it.
  assert.ok(s.indexOf("const outTime = outTimeToStoreOn(") < s.indexOf("amendsSavedRow(existing"));
  // And the row it compares against is read with all three columns (and, since
  // 17 Nov 2026, the date the Out fell on, which a stamped Out keeps).
  assert.match(s, /select: \{ lines: true, inTime: true, outTime: true, outDate: true \}/);
});

test("the two slab exports gate themselves, after the module gate", () => {
  for (const p of ["app/api/robo/exports/production/route.ts", "app/api/robo/exports/delays/route.ts"]) {
    const s = src(p);
    assert.match(s, /roboSlabExportGate\(\)/, p);
    assert.ok(s.indexOf("await roboGate()") < s.indexOf("await roboSlabExportGate()"),
      `${p}: no session reads as "sign in", not as "not for you"`);
  }
  // And the gate itself answers the rights table rather than a role list.
  assert.match(src("lib/rbac.ts"), /plantRightsOfUser\(user\)\.slabExports/);
});

test("the screens hide exactly what the API refuses", () => {
  const a = src("components/attendance/AttendanceClient.tsx");
  assert.match(a, /\{rights\.leave && \(\s*\n\s*<LeaveTaken/, "Leave Taken is not drawn");
  assert.match(a, /\{rights\.downloads && <Downloads /, "Downloads is not drawn");
  assert.match(a, /if \(!rights\.leave\) return;/, "and the leave rows are not even fetched");
  assert.match(a, /\{rights\.roster && \(/, "no + Add Operator");
  assert.match(a, /rights\.anyDate \? \(/, "no date picker");
  assert.match(a, /rights\.amendSaved \|\| !r\.saved \?/, "a written row offers no Edit");
  const d = src("components/robo/DownloadsClient.tsx");
  assert.match(d, /\{slabExports && \(\s*\n\s*<section>/, "Download Slab Records is not drawn");
  assert.match(d, /\{slabExports && <hr /, "and its divider goes with it");
});

test("the rights reach the screens from the SERVER, never from the browser", () => {
  for (const p of ["app/robo/attendance/page.tsx", "app/robo/downloads/page.tsx"]) {
    assert.match(src(p), /plantRightsOfUser\(/, p);
  }
  // The client takes them as a prop and works nothing out for itself: a
  // component that read the session would be reading something the browser
  // can edit.
  const a = src("components/attendance/AttendanceClient.tsx");
  assert.match(a, /import type \{ PlantRights \} from "@\/lib\/plantAccess"/, "the TYPE only");
  assert.doesNotMatch(a, /plantTierOf|plantRightsOf\(/, "and never the function");
});

/* ── THE PASSWORDS ARE NOWHERE IN HERE ─────────────────────────────── */

test("no login's password is in the source, or in a script, or in a test", () => {
  // Owner, 26 Oct 2026: "Store credentials securely using the existing
  // authentication architecture; never hardcode plaintext passwords in the
  // source code." The two tablet logins and the In-Charge login are made in
  // Users & Roles and their passwords are bcrypt hashes in users.passwordHash.
  // This is written as a pattern rather than as the literal, so the literal
  // is not in the repository either.
  const needle = ["Pacific", "@", "123"].join("");
  for (const p of [
    "src/lib/plantAccess.ts", "src/lib/roles.ts",
    "src/lib/rbac.ts", "src/lib/attendance/server.ts", "src/components/attendance/AttendanceClient.tsx",
    "src/components/robo/DownloadsClient.tsx",
    "prisma/seed-robo.ts", "prisma/seed-attendance.ts", // STANDALONE: the files Robo ERP has
  ]) {
    assert.ok(!read(p).includes(needle), `${p} holds a plaintext password`);
  }
});

/* ── THE SENTENCES ─────────────────────────────────────────────────── */

test("a refusal says the same thing wherever it is met", () => {
  // One wording per refusal, in one place, so an operator who gets past a
  // hidden control reads what the page would have said.
  for (const s of [ONLY_TODAY, ALREADY_SAVED, NOT_YOURS]) {
    assert.ok(s.length > 10 && s.endsWith("."), s);
  }
  assert.match(ONLY_TODAY, /Plant In-Charge/);
  assert.match(ALREADY_SAVED, /Plant In-Charge/);
  const s = src("lib/attendance/server.ts");
  for (const name of ["ONLY_TODAY", "ALREADY_SAVED", "NOT_YOURS"]) {
    assert.ok(s.includes(name), `the API says ${name} rather than its own words`);
  }
});

/* ── AND THE TIERS ARE THE ONLY TWO ────────────────────────────────── */

test("there are two tiers and the table answers for both", () => {
  const tiers: PlantTier[] = ["OPERATOR", "INCHARGE"];
  assert.deepEqual(Object.keys(PLANT_RIGHTS).sort(), [...tiers].sort());
  for (const t of tiers) assert.equal(plantRightsOf(t).tier, t);
});
