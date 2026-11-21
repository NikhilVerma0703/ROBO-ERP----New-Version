// Run a real server action under `node --test`.
//
// The actions import lib/rbac (whose first line imports @/auth, which node
// cannot load), lib/prisma (a live database), next/cache and "server-only".
// This swaps those four and nothing else: every other module the action imports — branch.ts,
// stationAccess.ts, tables.ts with the real fieldmap and Prisma's DMMF,
// photoSlots, erp.ts — is the real one. So a test calls the exported action
// exactly as a hand-built POST would, and reads back what reached the
// database layer.
//
//   rbac    -> the real rank table (lib/roles.ts) and the same one-line gates
//              rbac.ts defines (canRectify = INCHARGE+, isManager =
//              LINE_MANAGER+, isAdmin = ADMIN), over a user the test sets;
//   prisma  -> a recorder: every delegate call is pushed onto `calls`, reads
//              return empty (or the rows the test put in `rows` / `found` /
//              rawRows(), or a canned answer in `answers`), writes echo;
//              every $executeRaw (an advisory lock, a raw UPDATE) is pushed
//              onto rawCalls() — kept apart, so `calls` is what it always was;
//   next/cache -> no-ops.
//
// Import this module FIRST (before any src/ module), then import the action.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

export const ROOT = resolvePath(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export const src = (rel: string) => pathToFileURL(resolvePath(ROOT, "src", rel)).href;
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

export interface Call { model: string; op: string; args: any }
/** One $executeRaw: its SQL (the template's parts joined by "?"), its values,
 *  and `at` — how many delegate calls had been made before it, so a test can
 *  tell what ran before and after it. */
export interface RawCall { sql: string; values: unknown[]; at: number }
type H = typeof globalThis & {
  __user: unknown; __calls: Call[]; __rows: Record<string, Record<string, unknown>>;
  __found: Record<string, unknown[]>; __raw: unknown[] | null;
  __answers: Record<string, unknown>; __rawCalls: RawCall[];
};
const g = globalThis as H;
g.__user = null;
g.__calls = [];
g.__rows = {};
g.__found = {};
g.__raw = null;
g.__answers = {};
g.__rawCalls = [];

/** Every database call the action made since the last reset(). */
export const calls = (): Call[] => g.__calls;
/** Rows findUnique({ where: { id } }) returns, by delegate name ("press", "user"…). */
export const rows = g.__rows;
/** Rows findMany returns, by delegate name (default: none). */
export const found = g.__found;
/** Rows every $queryRaw returns (default: none). */
export function rawRows(r: unknown[] | null): void { g.__raw = r; }
/** Canned answers by "<delegate>.<op>" ("rm.updateMany", "rm.findUnique"): a
 *  value, or a function of the call's args. For the few calls whose default
 *  answer (empty, null, { count: 0 }) a test needs to be otherwise. */
export const answers = g.__answers;
/** Every $executeRaw the action ran since the last reset(). */
export const rawCalls = (): RawCall[] => g.__rawCalls;
export function reset(): void {
  g.__calls.length = 0; g.__raw = null; g.__rawCalls.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
  for (const k of Object.keys(found)) delete found[k];
  for (const k of Object.keys(answers)) delete answers[k];
}
/** Sign in as this user (null = signed out). */
export function as(role: string | null, branch = "SHOP_FLOOR", station: string | null = null): void {
  g.__user = role ? { id: `u-${role}`, name: `Test ${role}`, email: `${role.toLowerCase()}@test`, role, branch, station } : null;
}

const ROLES = JSON.stringify(src("lib/roles.ts"));
const STUBS: Record<string, string> = {
  "@/lib/rbac": stub(`import { ROLE_RANK, rankOf } from ${ROLES};
    export { ROLE_RANK, rankOf, STATIONS, STATION_LABEL, ROLE_LABEL, FAB_ROLE_LABEL, roleLabelFor, COMMERCIAL_ROLES, isCommercialRole } from ${ROLES};
    const role = () => String(globalThis.__user?.role ?? "");
    export const currentUser = async () => globalThis.__user;
    export const currentRole = async () => role();
    export const canEnterData = async () => !!globalThis.__user;
    export const canRectify = async () => rankOf(role()) >= ROLE_RANK.INCHARGE;
    export const isManager = async () => rankOf(role()) >= ROLE_RANK.LINE_MANAGER;
    export const isAdmin = async () => rankOf(role()) >= ROLE_RANK.ADMIN;
    export const localId = (p = "local") => p + "-test";`),
  "@/lib/prisma": stub(`
    const EMPTY = { findMany: [], findFirst: null, count: 0, groupBy: [], deleteMany: { count: 0 }, updateMany: { count: 0 } };
    const delegate = (m) => new Proxy({}, { get: (_, op) => op === "then" ? undefined : async (args) => {
      globalThis.__calls.push({ model: m, op, args });
      const canned = globalThis.__answers[m + "." + op];
      if (canned !== undefined) return typeof canned === "function" ? canned(args) : canned;
      if (op === "create") return { id: "new-id", ...(args?.data ?? {}) };
      if (op === "findUnique") return globalThis.__rows[m]?.[args?.where?.id] ?? null;
      if (op === "findMany" && globalThis.__found[m]) return globalThis.__found[m];
      if (op === "aggregate") return { _avg: {}, _max: {}, _min: {}, _sum: {}, _count: {} };
      if (op in EMPTY) return EMPTY[op];
      return {};
    } });
    export const prisma = new Proxy({}, { get: (_, k) => k === "then" ? undefined
      : k === "$transaction" ? (async (fn) => fn(prisma))
      : k === "$queryRaw" || k === "$queryRawUnsafe" ? (async () => globalThis.__raw ?? [])
      : k === "$executeRaw" ? (async (s, ...v) => { globalThis.__rawCalls.push({ sql: Array.isArray(s) ? s.join("?") : String(s), values: v, at: globalThis.__calls.length }); return 0; })
      : (typeof k === "string" && k.startsWith("$")) ? (async () => 0) : delegate(k) });
    export default prisma;`),
  "next/cache": stub(`export const revalidatePath = () => {}; export const revalidateTag = () => {};`),
  // Next resolves "server-only" itself (it is not a package in node_modules);
  // under node it is the no-op it is on the server. lib/misTargets.ts, which
  // createRow and saveRow import, starts with it.
  "server-only": stub(""),
};

function withTsExtension(fileUrl: string): string {
  const p = fileURLToPath(fileUrl);
  for (const ext of ["", ".ts", ".tsx"]) if (existsSync(p + ext) && (ext !== "" || /\.[cm]?[jt]sx?$/.test(p))) return pathToFileURL(p + ext).href;
  for (const ext of ["/index.ts", "/index.tsx"]) if (existsSync(p + ext)) return pathToFileURL(p + ext).href;
  return fileUrl;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true, format: "module" };
    if (specifier.startsWith("@/")) return { url: withTsExtension(src(specifier.slice(2))), shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const u = new URL(specifier, context.parentURL).href;
      const w = withTsExtension(u);
      if (w !== u) return { url: w, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// lib/tables.ts reads scripts/fieldmap.json relative to the working directory.
process.chdir(ROOT);
