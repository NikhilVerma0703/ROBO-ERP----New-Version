// STANDALONE: who the app runs as, and the Robo gates.
//
// In Pacific ERP this file is the whole role/session layer: next-auth v5,
// session revalidation, "view as", and station and department rules (559 lines).
// Robo ERP has no sign-in by design (local development and manual testing
// only), so every request runs as ONE local user.
//
// The local user is an ADMIN. The Robo gates below are the ERP's own, copied
// with the same names and the same bodies, so every Robo route and page
// still calls them exactly as before. For this user they all answer yes:
// all seven sections and every control (delete a slab, restore it, edit a
// setup, Download Slab Records, Leave Taken, attendance on any date, roster
// edits) are open. Restoring sign-in later means replacing localUser() here;
// nothing that calls these functions has to change.
import { NOT_YOURS, plantRightsOfUser, roboAudience } from "@/lib/plantAccess";
import { rankOf, ROLE_RANK } from "@/lib/roles";

export interface LocalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  /** The login's second job, as the main ERP's session carries it. */
  altRole: string | null;
  altBranch: string | null;
  station: string | null;
  readOnly: boolean;
}

export const LOCAL_USER_ID = "local-user";

/*
 * TESTING AS ANOTHER LOGIN. With none of these set, which is the normal case,
 * the local user is the ADMIN above. Set them to see the screens the way
 * another main-ERP login would, for example:
 *   the Robo line tablet (operator tier): ROBO_LOCAL_ROLE=ROBO
 *   the Plant In-Charge:                  ROBO_LOCAL_ROLE=PLANT_INCHARGE
 * The branch defaults to SHOP_FLOOR.
 */
const env = (name: string) => process.env[name]?.trim() || "";

export function localUser(): LocalUser {
  const altRole = env("ROBO_LOCAL_ALT_ROLE") || null;
  return {
    id: LOCAL_USER_ID,
    name: env("ROBO_ACTING_USER_NAME") || "Local User",
    email: env("ROBO_LOCAL_EMAIL") || "local-user@robo.local",
    role: env("ROBO_LOCAL_ROLE") || "ADMIN",
    branch: env("ROBO_LOCAL_BRANCH") || "SHOP_FLOOR",
    altRole,
    altBranch: altRole ? env("ROBO_LOCAL_ALT_BRANCH") || "SHOP_FLOOR" : null,
    station: null,
    readOnly: false,
  };
}

/** The signed-in user. In the standalone app it is always the local user. */
export async function currentUser(): Promise<LocalUser> {
  return localUser();
}

export async function isAdmin(): Promise<boolean> {
  return rankOf((await currentUser()).role) >= ROLE_RANK.ADMIN;
}

/** ERP: who may PERMANENTLY delete a robo production record. That is the ROBO
 *  tablet, the Plant In-Charge and ADMIN (lib/plantAccess.ts roboAudience). */
export async function canDeleteRoboSlab(): Promise<boolean> {
  const u = await currentUser();
  return roboAudience(u?.role, u?.branch);
}

/** ERP: who may EDIT a saved robo production setup in place. */
export async function canEditRoboSetup(): Promise<boolean> {
  const u = await currentUser();
  return roboAudience(u?.role, u?.branch);
}

/** ERP: the in-route gate for every /api/robo handler. */
export async function roboGate(): Promise<Response | null> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (roboAudience(user.role, user.branch)) return null;
  return Response.json({ error: "Not authorized" }, { status: 403 });
}

/** ERP: the two slab exports (Download Slab Records) are the In-Charge's. */
export async function roboSlabExportGate(): Promise<Response | null> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (plantRightsOfUser(user).slabExports) return null;
  return Response.json({ error: NOT_YOURS }, { status: 403 });
}
