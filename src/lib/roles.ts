// The ONE role-rank table, in a module with no imports at all.
//
// Split out of lib/rbac.ts (which re-exports it, so nothing else changed) for
// one reason: rbac.ts imports @/auth, and node --test resolves neither the
// alias nor next-auth — so any pure logic living there is untestable, the
// same reason fab/routing.ts is alias-free. Pure per-module logic (e.g. a
// module's access-tier mapping) and its tests both import THIS module, so the
// tests exercise the real table rather than a copy that drifts.
//
// Role hierarchy (low -> high). Kept as string-typed so this compiles even
// before `prisma generate` refreshes the @prisma/client enum.
export type RoleName = "OPERATOR" | "INCHARGE" | "LINE_MANAGER" | "ADMIN" | "FINANCE" | "ACCOUNTS" | "SALES" | "COMMERCIAL" | "COMMERCIAL_MANAGER" | "COMMERCIAL_EXEC" | "STORE" | "MAINTENANCE" | "ROBO" | "CHROMIA" | "SAMPLING" | "LAB" | "VIEWER" | "PLANT_INCHARGE" | "PIGMENT" | "CTS" | "PURCHASE";

// FINANCE and ACCOUNTS are flat office roles directly under ADMIN (rank 2:
// they may edit office tables, but user management stays admin-only in Office).
// SAMPLING sits on rank 1 with the other capped module roles (ROBO, CHROMIA,
// STORE, MAINTENANCE): below every rank test in the ERP, so it inherits
// nothing and is named explicitly wherever it is wanted. Its own module gates
// on the ACTION rather than on a rank — see lib/sampling/actions.ts. LAB (the
// Lab module, scripts/0119) is the same shape again: rank 1, capped to /lab,
// and its module gates on the action — see lib/lab/actions.ts.
// PLANT_INCHARGE (scripts/0141) is rank 1 with them for the same reason: it
// holds the whole of Robo, the whole of Chromia and the whole attendance
// register, and NOTHING on the shop-floor ladder. Its powers are on
// lib/plantAccess.ts's table, which is read by name, so giving it a rank above
// the tablets would hand it every `rankOf(role) >= INCHARGE` test in the ERP —
// batch rectification, record edits — that nobody asked for it to have.
// PIGMENT (scripts/0146, the Pigment Department's login) is rank 1 with them
// too: capped to /pigment like LAB, and its powers are lib/pigment/access.ts's
// table. The shop-floor LINE_MANAGER and INCHARGE who also use the module are
// named there by role and branch, not reached by rank.
// CTS (scripts/0157, the CTS – Costing & Quotation module's login) is rank 1
// with them for the same reason: capped to /cts like CHROMIA to /chromia, and
// its module asks for the role by name (lib/cts/access.ts), so a rank above
// the tablets would hand a costing login every shop-floor rank test.
// PURCHASE (scripts/0159, the Purchase module's login, 19 Nov 2026) is rank 1
// for the same reason: capped to /purchase like CTS to /cts, its powers are
// lib/purchase/access.ts's table, and a rank above the tablets would hand a
// buyer every shop-floor rank test.
export const ROLE_RANK: Record<string, number> = { OPERATOR: 1, STORE: 1, MAINTENANCE: 1, SALES: 1, COMMERCIAL: 1, COMMERCIAL_MANAGER: 1, COMMERCIAL_EXEC: 1, ROBO: 1, CHROMIA: 1, SAMPLING: 1, LAB: 1, VIEWER: 1, PLANT_INCHARGE: 1, PIGMENT: 1, CTS: 1, PURCHASE: 1, INCHARGE: 2, FINANCE: 2, ACCOUNTS: 2, LINE_MANAGER: 3, ADMIN: 4 };

// VIEWER (scripts/0134) is the VIEW-ONLY login (Shyam, 23 Oct 2026: "a view
// only login, can see everything admin sees"). Its rank here only places it
// in Users & Roles: it never reaches a gate as VIEWER, because sign-in hands
// it the ADMIN role with readOnly set (src/auth.ts), and every save it makes
// is refused at the edge (middleware.ts 3b) and in the Prisma write guard
// (lib/viewAsServer.ts), the two refusals "View as" already relies on.
export const VIEW_ONLY_ROLE = "VIEWER";
export const VIEW_ONLY_SENTENCE = "This is a view-only login — nothing is saved. Ask an administrator to make the change.";

export function rankOf(role?: string | null): number { return ROLE_RANK[String(role ?? "")] ?? 0; }

/** THE CAPPED MODULE ROLES: THE LOGINS AN ADMIN HANDS OUT, AND NOBODY BELOW.
 *
 *  Owner, 2026-10-20, twice. First for Lab: "should only admins create Lab
 *  logins? ... Only admins". Then for the rest of the set, on the code review's
 *  AUTH-4: Store, Maintenance, Robo, Chromia and Sampling logins are admin-only
 *  to create, reset, deactivate, change station or second role, exactly like
 *  Lab.
 *
 *  Every one of them is rank 1, so the ordinary "anything strictly below you"
 *  rule let any Shop Floor INCHARGE or LINE_MANAGER create one with a password
 *  they chose, reset a real one's password and sign in as it, or grant the role
 *  as a second job — and each of them carries a power the person handing it out
 *  does not hold. STORE signs off batch prices and edits per-batch supplier
 *  rates on /office/batch-verify (lib/costing/verification.ts names the role);
 *  MAINTENANCE files the maintenance response on a downtime incident; ROBO
 *  deletes robo slabs; CHROMIA, SAMPLING and LAB each run a whole module. A
 *  supervisor could become the batch-price verifier with one password reset.
 *
 *  VIEWER is here for the same reason, more sharply: the view-only login sees
 *  everything an admin sees, so a supervisor who could reset its password
 *  could read every screen in the ERP.
 *
 *  PLANT_INCHARGE sharper still: it is the login the two tablets are capped
 *  AGAINST (lib/plantAccess.ts). It holds the whole attendance register — the
 *  roster, the leave, the exports, and any day in either direction — across
 *  both plant modules, so a supervisor who could grant it, or reset it, could
 *  hand himself everything the tablets were just refused.
 *
 *  PIGMENT (scripts/0146) by the owner's own words of 27 Oct 2026: "made only
 *  by an admin in Users & Roles", as ROBO and CHROMIA are.
 *
 *  CTS (scripts/0157, the CTS – Costing & Quotation module) the same way: it
 *  is mounted as Chromia is, and the costing it opens carries every internal
 *  cost, the margin and the rate card, which no supervisor's own login shows.
 *
 *  PURCHASE (scripts/0159, the Purchase module) the same way: the buyers'
 *  login raises and approves purchase orders, an admin's to hand out.
 *
 *  What is left below an admin is the ladder itself: a LINE_MANAGER hands out
 *  INCHARGE and OPERATOR, an INCHARGE hands out OPERATOR. */
export const CAPPED_MODULE_ROLES: ReadonlySet<string> = new Set(["STORE", "MAINTENANCE", "ROBO", "CHROMIA", "SAMPLING", "LAB", "VIEWER", "PLANT_INCHARGE", "PIGMENT", "CTS", "PURCHASE"]);

/** The first capped module role among `targetRoles` (primary first, then the
 *  second job — getUserRoles' order), or null. What the refusal names. */
export function cappedRoleOf(targetRoles: readonly (string | null | undefined)[]): string | null {
  return targetRoles.find((r): r is string => !!r && CAPPED_MODULE_ROLES.has(r)) ?? null;
}

/** WHO MAY HAND OUT, OR TOUCH, A MODULE LOGIN: AN ADMIN, AND NOBODY BELOW.
 *  Three call sites ask this one question: creatableRoles (what the Role
 *  dropdown and the second-job list offer), canManageTarget in
 *  admin/users/actions.ts (the gate every reset / deactivate / station /
 *  second-role / sign-out change goes through), and the button rule in
 *  UserAdmin.tsx (so no button, and no live machine select, is drawn that the
 *  server refuses). `targetRoles` is every role the target can wear — primary
 *  and second job alike, so a Store hat cannot hide behind an Operator primary. */
export function moduleLoginNeedsAdmin(callerRank: number, targetRoles: readonly (string | null | undefined)[]): boolean {
  return callerRank < ROLE_RANK.ADMIN && cappedRoleOf(targetRoles) !== null;
}

/** The Commercial module's two roles (owner, 2026-09-07, answer 9: "a
 *  commercial manager role"). OUTSIDE the module they are one thing — the
 *  office login that lands on /office/commercial, sees the finished-goods
 *  slab table and the read-only production lookups, and writes nothing else —
 *  so every seam that used to ask `role === "COMMERCIAL"` asks this instead
 *  and a third commercial role (the per-task roles the owner also asked for)
 *  is one entry here. INSIDE the module lib/commercial/access-rules.ts tells
 *  them apart: the manager approves the checklist, cancels a PI and edits the
 *  production plan; Commercial does not. The manager sits on rank 1 with
 *  Commercial deliberately: its extra powers are on the module's action
 *  table, not on the ladder, so it inherits none of the shop-floor rank
 *  tests (canRectify and the like).
 *
 *  THREE SINCE 8 NOV 2026: Commercial, the Commercial Manager and the
 *  Dispatch Manager (COMMERCIAL_EXEC). The owner, 6 Nov 2026: "We will keep
 *  only commercial and commercial manager. All of them will be in this with
 *  their own ids", and of the Dispatch Manager "Keep him narrow". The two
 *  others are retired: RETIRED_ROLES, below. */
export const COMMERCIAL_ROLES: ReadonlySet<string> = new Set(["COMMERCIAL", "COMMERCIAL_MANAGER", "COMMERCIAL_EXEC"]);
export function isCommercialRole(role?: string | null): boolean { return COMMERCIAL_ROLES.has(String(role ?? "")); }

/** THE RETIRED ROLES: VALUES THE DATABASE STILL HAS AND NO LOGIN MAY HOLD.
 *
 *  Commercial Documentation (COMMERCIAL_DOCS) and Commercial Logistics
 *  (COMMERCIAL_LOGISTICS), retired on 8 Nov 2026 by the owner's decision of
 *  6 Nov: "Lets not keep different logins lets make it all commercial. We
 *  will keep only commercial and commercial manager. All of them will be in
 *  this with their own ids", and "rest all (apart from this and the other
 *  two) delete all other commercial". Nobody held either on 8 Nov (users.role
 *  and users.alt_role, read on production). They are gone from every list
 *  above: no rank, no label, no Commercial area, nothing anybody can grant.
 *  The Postgres enum keeps the two values (prisma/schema.prisma), so the app
 *  names them here once, for one purpose: a login that somehow still holds
 *  one gets NOTHING. Without a rank or a cap such a login would fall through
 *  every role block in middleware.ts and reach the pages no cap refuses, so
 *  the door refuses it every path (middleware.ts, the retired-role block),
 *  its home is the refusal page (routeCaps.ts homeFor, so "/" cannot loop),
 *  its sidebar is empty (navModel.ts) and the dashboard shows it nothing
 *  (dashboard/access.ts). tests/commercialRolesRetired.test.ts holds it. */
export const RETIRED_ROLES: ReadonlySet<string> = new Set(["COMMERCIAL_DOCS", "COMMERCIAL_LOGISTICS"]);
export function isRetiredRole(role?: string | null): boolean { return RETIRED_ROLES.has(String(role ?? "")); }

/** THE COMMERCIAL DESK'S LOGINS: THE COMMERCIAL MANAGER KEEPS THEM, AND
 *  NOTHING ELSE (owner, 4 Nov 2026: "Give Thapa access to create other
 *  commercial logins").
 *
 *  A scoped delegation, the shape the Sales Admin's is (International Sales
 *  logins only, on a screen of their own), and like that one it is NOT a rank:
 *  the manager stays on rank 1, so canManageUsers, creatableRoles and every
 *  rank test in the ERP answer for him exactly as before — in particular the
 *  second-role grant, which is built from creatableRoles, offers him nothing.
 *  What he gets is this rule, asked by its three call sites: Users & Roles
 *  (admin/users/page.tsx and UserAdmin.tsx, the desk mode), every server
 *  action behind it (admin/users/actions.ts), and the door (middleware.ts,
 *  /admin/users inside the Commercial cap). The nav row asks it too.
 *
 *  WHO: every COMMERCIAL_MANAGER on the Office branch, by role and branch,
 *  never by name (today Santosh Thapa alone), judged — like every gate — on
 *  the job the request is running as.
 *
 *  WHAT: create a login with one of the two desk roles, always on the
 *  Office branch; reset a desk login's password; switch one off and on. No
 *  role, branch, station or second-role change, no finished-goods grant, no
 *  sign-out, and never his own login or another manager's.
 *
 *  NOT A STEP UP, BY ROLE AND BY ADDRESS. Each of the two desk roles holds
 *  less of the ERP than the manager does (the Commercial area table,
 *  lib/commercial/access-rules.ts). That alone covers what a ROLE carries,
 *  and a few duties go with the ADDRESS instead, whatever the role: the batch
 *  verifier, slab intake, the month incentive and the MIS targets
 *  (lib/emailGrants.ts). So an address that carries one is an admin's:
 *  createUser refuses him a new login on it, and commercialDeskGate refuses
 *  him a desk login whose address carries one, the way isCommercialDeskLogin
 *  below refuses a desk login with a second job off the desk.
 *
 *  BUT ONLY AT THE MOMENT HE SETS THE PASSWORD. A password he chooses, on a
 *  new login or by a reset, stays that login's password until someone resets
 *  it again, and the person cannot change it (resetPassword on oneself is a
 *  user manager's alone). So if an admin later gives a desk login anything
 *  more — a second job off the desk, or its address on one of those duty
 *  lists — the gates refuse him from then on, but he may still know the
 *  password. The rule for an admin: reset a desk login's password BEFORE
 *  giving it anything more (code review of 4 Nov 2026, second round). The
 *  same holds for every password a non-admin sets, an Incharge's on an
 *  Operator's login among them. The finished-goods grant (users.fg_view, set
 *  by SQL only today) is not asked by the desk's gate at all.
 *
 *  The order is the order the Role list shows. On the desk's own screen no
 *  role is chosen until he chooses one (UserAdmin, the desk mode): no role
 *  can be changed once the login is made, and the last entry, Commercial, is
 *  the wider of the two. Four until 8 Nov 2026, when Commercial Documentation
 *  and Commercial Logistics were retired (RETIRED_ROLES, above). */
export const COMMERCIAL_DESK_ROLES: readonly RoleName[] = ["COMMERCIAL_EXEC", "COMMERCIAL"];
export const COMMERCIAL_DESK_BRANCH = "OFFICE";
/** WHAT EACH DESK ROLE COVERS, one line each, under the desk's Create form so
 *  the choice is made knowing it (a role cannot be changed later). The
 *  screens are the Commercial module's (lib/commercial/access-rules.ts
 *  COMMERCIAL_AREA_ACCESS: "works on" is write, "only reads" is view; the
 *  lists name the screens that tell the roles apart, not every one), and
 *  tests/commercialDeskLogins.test.ts holds each line to that table and to
 *  the finished-goods rule. Plain text, so a client component can show it. */
export const COMMERCIAL_DESK_ROLE_NOTE: Readonly<Record<string, string>> = {
  // The Dispatch Manager since the owner narrowed him on 5 Nov 2026 ("only
  // show him the PL … and maybe polishing data"): the area table's packing
  // and dispatchCheck alone, and the polishing records lib/routeCaps.ts
  // COMMERCIAL_READ_TABLES gives the role. The slab intake form goes by
  // address (SLAB_INTAKE_EMAILS), not by role, so it is not named here.
  COMMERCIAL_EXEC: "works on packing and the dispatch check, and on no other Commercial screen; only reads the Polish Entry and Polish QC records",
  // Every screen of the area table's COMMERCIAL row: write everywhere but
  // the design codes (view) and the production queue and settings (none, an
  // admin's). Until 8 Nov 2026 the line read "everything the other three
  // work on", when the desk had four roles.
  COMMERCIAL: "works on every Commercial screen but the design codes, which it only reads, and the production queue and the settings, which are an admin's; also uses the Finished Goods slabs and can dispatch from them. The wider of the two",
};
/** The two changes he may make to an existing desk login — the server
 *  actions' own names. */
export const COMMERCIAL_DESK_ACTIONS: ReadonlySet<string> = new Set(["setActive", "resetPassword"]);

const isDeskPair = (role?: string | null, branch?: string | null) =>
  (COMMERCIAL_DESK_ROLES as readonly string[]).includes(String(role ?? "")) && branch === COMMERCIAL_DESK_BRANCH;

/** Does this (active) role and branch keep the Commercial desk's logins? */
export function keepsCommercialDesk(role?: string | null, branch?: string | null): boolean {
  return role === "COMMERCIAL_MANAGER" && branch === COMMERCIAL_DESK_BRANCH;
}

/** The roles this login may create as the desk's keeper: the four, or none. */
export function commercialDeskCreatable(role?: string | null, branch?: string | null): RoleName[] {
  return keepsCommercialDesk(role, branch) ? [...COMMERCIAL_DESK_ROLES] : [];
}

/** May this login create a login with `role` on `branch` as the desk's keeper? */
export function commercialDeskMayCreate(caller: { role?: string | null; branch?: string | null }, role?: string | null, branch?: string | null): boolean {
  return keepsCommercialDesk(caller.role, caller.branch) && isDeskPair(role, branch);
}

/** Is this one of the desk's logins? EVERY job it can wear has to be a desk
 *  role on the Office branch — the main pair and, when either half of a second
 *  job is set, the second pair too — so a desk login that also holds a Line
 *  Manager or Finance job is an admin's, the way canManageTarget ranks a login
 *  by the highest role it can wear. */
export function isCommercialDeskLogin(t: { role?: string | null; branch?: string | null; altRole?: string | null; altBranch?: string | null } | null | undefined): boolean {
  if (!t || !isDeskPair(t.role, t.branch)) return false;
  if (!t.altRole && !t.altBranch) return true;
  return isDeskPair(t.altRole, t.altBranch);
}

/** May `caller` make this change (`action`, a server action's name) to the
 *  existing login `target`, as the desk's keeper? Never to himself. */
export function commercialDeskMayManage(
  caller: { id?: string | null; role?: string | null; branch?: string | null },
  action: string,
  target: { id?: string | null; role?: string | null; branch?: string | null; altRole?: string | null; altBranch?: string | null } | null | undefined,
): boolean {
  return keepsCommercialDesk(caller.role, caller.branch)
    && COMMERCIAL_DESK_ACTIONS.has(action)
    && !!target?.id && target.id !== caller.id
    && isCommercialDeskLogin(target);
}

/** THE ROWS THE DESK'S SCREEN LISTS, from every Office login: the Commercial
 *  logins and nobody else. Users & Roles names who created each login, and
 *  that name is looked up among EVERY Office login (lib/users.ts
 *  listUsersRows), so a row an admin made would name that admin, or print the
 *  admin's address when the admin has no name. On this screen a creator is
 *  named only when it is one of the listed Commercial logins, and no other
 *  Office login goes by the same name; any other creator reads "an admin",
 *  which is who else creates an Office login. A row with no creator stays
 *  without one. Pure, so node --test holds it. */
export function commercialDeskRows<T extends { role: string; name: string | null; email: string; createdByName: string | null }>(office: readonly T[]): T[] {
  const shown = (u: T) => u.name ?? u.email;
  const listed = office.filter((u) => isCommercialRole(u.role));
  const ours = new Set(listed.map(shown));
  const others = new Set(office.filter((u) => !isCommercialRole(u.role)).map(shown));
  return listed.map((u) =>
    u.createdByName === null || (ours.has(u.createdByName) && !others.has(u.createdByName))
      ? u
      : { ...u, createdByName: "an admin" });
}

// Station and role LABELS, here with the rank table for the same two reasons:
// node --test can reach them, and a client component can import them without
// dragging lib/rbac.ts's auth chain into the browser bundle (see rbac.ts).
export type StationName =
  | "PRESS" | "OVEN" | "JOT" | "MIXER" | "KREOS"
  | "DISTRIBUTOR" | "SILO" | "POLISH_QC" | "POLISH_ENTRY" | "CUTTING";

export const STATIONS: StationName[] = ["PRESS", "OVEN", "JOT", "MIXER", "KREOS", "DISTRIBUTOR", "SILO", "POLISH_QC", "POLISH_ENTRY", "CUTTING"];
export const STATION_LABEL: Record<string, string> = {
  PRESS: "Press", OVEN: "Oven", JOT: "Jot", MIXER: "Mixer", KREOS: "Kreos",
  DISTRIBUTOR: "Distributor", SILO: "Silo", POLISH_QC: "Polish QC", POLISH_ENTRY: "Polish Entry", CUTTING: "Cutting",
};

export const ROLE_LABEL: Record<string, string> = {
  OPERATOR: "Operator", INCHARGE: "Incharge", LINE_MANAGER: "Line Manager", ADMIN: "Administrator",
  FINANCE: "Finance", ACCOUNTS: "Accounts", SALES: "Sales", COMMERCIAL: "Commercial", COMMERCIAL_MANAGER: "Commercial Manager",
  // One role per set of tasks, named for the desk rather than the person
  // (owner, 2026-09-08): Setumani's then. The Dispatch Manager since 5 Nov
  // 2026 (Nazz): the packing lists and the dispatch check
  // (lib/commercial/access-rules.ts). Its two siblings, Commercial
  // Documentation and Commercial Logistics, were retired on 8 Nov 2026
  // (RETIRED_ROLES, above).
  COMMERCIAL_EXEC: "Dispatch Manager",
  STORE: "Store Incharge", MAINTENANCE: "Maintenance Manager",
  ROBO: "Robo Operator",
  CHROMIA: "Chromia Operator",
  // The owner's own title for the man the attendance report is addressed to
  // (26 Oct 2026: "In-Charge Access ... full access to all sections and
  // subsections"). One login over both plant modules and the whole shared
  // register — see lib/plantAccess.ts, which is the whole of what it means.
  PLANT_INCHARGE: "Plant In-Charge",
  // The owner's own word for this person. Not "Sampling Operator": there is one
  // sampling login and it runs the whole module — the inventory, the intake and
  // all three dispatch transitions.
  SAMPLING: "Sampling Incharge",
  // The lab staff's login: the whole Lab module but its hard deletes and its
  // S.No. / slab-number overrides, which stay with an admin
  // (lib/lab/actions.ts). One word, like the module's sidebar heading.
  LAB: "Lab",
  // The Pigment Department's login (scripts/0146): the whole Pigment module
  // but its two permanent deletes, which are a supervisor's
  // (lib/pigment/access.ts). One word, like the module's sidebar heading.
  PIGMENT: "Pigment",
  // The CTS – Costing & Quotation module's login (scripts/0157): the whole
  // module, nothing else (lib/cts/access.ts). Named for the module, as the
  // owner's request names it: "CTS – Costing & Quotation System".
  CTS: "CTS – Costing & Quotation",
  // The purchase team's login (scripts/0159): the whole Purchase module —
  // raise, approve and print POs, keep the suppliers and items — and nothing
  // else (lib/purchase/access.ts). One word, like the module's heading.
  PURCHASE: "Purchase",
  VIEWER: "View only",
};

/** Fabrication shares the ONE role hierarchy with Shop Floor (LINE_MANAGER /
 * INCHARGE / OPERATOR — see lib/fab/access.ts's fabTierOf: there is no
 * parallel fabRole field), but the generic ROLE_LABEL names ("Line Manager",
 * "Incharge", "Operator") don't read as fabrication-specific anywhere the
 * role is displayed — most visibly in Users & Roles, where an admin picking
 * the Fabrication department couldn't find "Fabrication Manager" /
 * "Fabrication Supervisor" / "Fabrication Machine Operator" by name. This
 * gives the SAME underlying roles department-appropriate display names
 * without introducing a second role system or touching the Role enum/DB. */
export const FAB_ROLE_LABEL: Record<string, string> = {
  // Owner, 13 Oct 2026: "instead of fabrication manager put it as Fab &
  // Chromia Head" — gibin@, the one login on this pair, runs Chromia as well
  // (his second job, scripts/0118).
  LINE_MANAGER: "Fab & Chromia Head",
  INCHARGE: "Fabrication Supervisor",
  OPERATOR: "Fabrication Machine Operator",
};
/** A role held as a login's SECOND job, under the name that job goes by.
 * Users & Roles grants CHROMIA as a second job to a manager (gibin@, Fab &
 * Chromia Head; scripts/0118), and the owner asked for it to read as the
 * manager's job, not the line's (13 Oct 2026: "instead of chromia operator
 * give him manager view"). The screens are the same — lib/chromia/tier.ts has
 * one tier for the role either way — so this is a name and nothing else.
 * chromia@ ("Chromia Line") holds CHROMIA as its MAIN job and stays
 * "Chromia Operator". */
export const SECOND_JOB_LABEL: Record<string, string> = {
  CHROMIA: "Chromia Manager",
};
/** Is (role, branch) this login's second job — its altRole/altBranch pair? */
export function isSecondJob(login: { altRole?: string | null; altBranch?: string | null } | null | undefined, role?: string | null, branch?: string | null): boolean {
  return !!login?.altRole && login.altRole === role && (login.altBranch ?? null) === (branch ?? null);
}
/** Role label, department-aware: Fabrication uses its own label map for the
 * roles it shares with Shop Floor; every other branch (and any role with no
 * department-specific name) falls back to the generic ROLE_LABEL. `secondJob`
 * names the pair as a login's second job (SECOND_JOB_LABEL), where it has a
 * name of its own. */
export function roleLabelFor(role?: string | null, branch?: string | null, secondJob = false): string {
  const r = String(role ?? "");
  if (secondJob && SECOND_JOB_LABEL[r]) return SECOND_JOB_LABEL[r];
  if (branch === "FABRICATION" && FAB_ROLE_LABEL[r]) return FAB_ROLE_LABEL[r];
  return ROLE_LABEL[r] ?? r;
}
