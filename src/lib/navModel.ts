// STANDALONE: the sidebar's model.
//
// Pacific ERP's navModel.ts (794 lines) builds the sidebar for every login in
// every department. Robo ERP has one sidebar: the Robo login's. It is copied
// here exactly as production draws it, with the same rows, icons, labels,
// order and section headings (Production, Reports, Setup, Attendance). The
// ROBO_ITEMS list and the `role === "ROBO"` arm are the ERP's, unchanged.
// NAV_ICON and the types are the ERP's too, so Nav.tsx and MobileNav.tsx are
// copied as they were.

export const NAV_ICON = {
  overview:    "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  batch:       "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.35-4.35",
  tables:      "M4 5h16v14H4zM4 10h16M10 5v14",
  report:      "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  mis:         "M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5M12 16h.01",
  spanner:     "M14.7 6.3a4 4 0 01-5 5L4 17v3h3l5.7-5.7a4 4 0 015-5l2-2-2.6-2.6-2.4 1.6z",
  entry:       "M12 5v14M5 12h14",
  live:        "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  users:       "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  box:         "M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  factory:     "M2 20h20M4 20V8l5 4V8l5 4V4l6 4v12",
  scissors:    "M6 3a3 3 0 110 6 3 3 0 010-6zm12 12a3 3 0 110 6 3 3 0 010-6zM5.2 5.2l13.6 13.6M18.8 5.2 9.4 14.6",
  samples:     "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  ceo:         "M18 20V10M12 20V4M6 20v-6",
  planning:    "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  manager:     "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8z",
  polishing:   "M12 2a10 10 0 100 20 10 10 0 000-20z",
  sink:        "M5 9V5h14v4M2 9h20v2a5 5 0 01-5 5H7a5 5 0 01-5-5V9z",
  fabrication: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",
  packaging:   "M21 16V8l-9-5-9 5v8l9 5 9-5z",
  commercial:  "M3 3h18v4H3zM3 7v13h18V7M9 12h6",
  attendance:  "M8 2v4M16 2v4M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M9 16l2 2 4-4",
  // The Lab module's two of its own: a flask for the sample register, and a
  // pair of opposed arrows for samples coming in and going out.
  flask:       "M9 3h6M10 3v6.5L4.6 18.4A1.75 1.75 0 006.1 21h11.8a1.75 1.75 0 001.5-2.6L14 9.5V3M7.5 15h9",
  swap:        "M4 7h16M16 3l4 4-4 4M20 17H4M8 13l-4 4 4 4",
  // The Lab's Announcement (a megaphone) and Slab Records (slabs stacked).
  megaphone:   "M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13",
  layers:      "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  // A ledger: the receivables register (Accounts; Payment Tracking's row).
  ledger:      "M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z",
  // A tick in a circle: Approved Slabs (27 Oct 2026).
  approved:    "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",
  // A calculator: the CTS – Costing & Quotation project list.
  calculator:  "M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zM8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01",
};
const I = NAV_ICON;


/** One row. `exact`: this row's sub-pages are rows of their own, so it lights
 *  only on its own path (see NavLink). `office`: the Office Home row, which
 *  lights for every read-only production page the office home's cards open.
 *  `fullLoad`: a plain <a>, a whole-document load, not a next/link soft
 *  navigation — for a page whose own views cannot be soft-navigated between
 *  (HR > Attendance: app/office/hr/attendance/behaviour.tsx says why). */
export interface NavItem { href: string; icon: string; label: string; exact?: boolean; office?: boolean; fullLoad?: boolean }

/** A folding section (Nav.tsx Section), or a fixed heading that does not fold
 *  (the office arm's "Office" group, whose Office Home row keeps its own
 *  highlight). `flush` is the group's `first:mt-0`, which the office arm's
 *  group carries and the Commercial arm's — never first — does not. */
export type NavBlock =
  | { kind: "section"; label: string; items: NavItem[] }
  | { kind: "group"; label: string; items: NavItem[]; flush: boolean };

/** The whole sidebar: sections top to bottom, or — for the three logins whose
 *  nav was always a bare list (the shop-floor operator, office Sales) — flat
 *  rows with no heading at all. A section with no rows is never in the model:
 *  Section rendered nothing for one, so leaving it out changes no pixel. */
export type NavModel =
  | { kind: "sections"; blocks: NavBlock[] }
  | { kind: "flat"; items: NavItem[] };

// The robo line. ONE list, for the same reason CHROMIA_ITEMS below is one: it
// is the ROBO operator's entire nav AND a section on the admin's shop-floor
// nav (owner, 2026-09-09: "add robo module and chromia module in admin shop
// floor login as well"), and two hand-kept copies of a module's rows drift
// the first time a page is added to one of them.
const ROBO_ITEMS: NavItem[] = [
  // CR-003 (20 Nov 2026): "Robo Entry" renamed Slab Entry, and Trial Slab
  // Entry directly below it.
  { href: "/robo",           icon: I.factory, label: "Slab Entry", exact: true },
  { href: "/robo/trial",     icon: I.flask,   label: "Trial Slab Entry" },
  { href: "/robo/slabs",     icon: I.batch,   label: "Slab Records" },
  { href: "/robo/reports",   icon: I.ceo,     label: "Reports" },
  { href: "/robo/downloads", icon: I.box,     label: "Downloads" },
  { href: "/robo/import",    icon: I.entry,   label: "Import" },
  { href: "/robo/masters",   icon: I.tables,  label: "Master Lists" },
  // Last, and the same register CHROMIA_ITEMS ends with — one page, two doors.
  // See lib/attendance/server.ts. The calendar the HR > Attendance row draws,
  // so the sidebar has one picture for attendance.
  { href: "/robo/attendance", icon: I.attendance, label: "Attendance" },
];

const section = (label: string, items: NavItem[]): NavBlock[] => (items.length ? [{ kind: "section", label, items }] : []);
const sections = (...blocks: NavBlock[][]): NavModel => ({ kind: "sections", blocks: blocks.flat() });

/** The Robo login's sidebar: the `role === "ROBO"` arm of the ERP's navSections(). */
export function roboNav(): NavModel {
  return sections(
    section("Production", ROBO_ITEMS.filter((t) => t.href === "/robo" || t.href === "/robo/trial" || t.href === "/robo/slabs")),
    section("Reports", ROBO_ITEMS.filter((t) => t.href === "/robo/reports" || t.href === "/robo/downloads")),
    section("Setup", ROBO_ITEMS.filter((t) => t.href === "/robo/import" || t.href === "/robo/masters")),
    section("Attendance", ROBO_ITEMS.filter((t) => t.href === "/robo/attendance")),
  );
}

/** Every href in a model, in order. */
export function navHrefs(m: NavModel): string[] {
  return m.kind === "flat" ? m.items.map((i) => i.href) : m.blocks.flatMap((b) => b.items.map((i) => i.href));
}
