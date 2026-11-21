import type { NextRequest } from "next/server";
import { attendanceApi } from "@/lib/attendance/server";
import { roboGate } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * /api/robo/attendance/… — the Robo line's door onto the ONE attendance
 * register. Chromia has its own at /api/chromia/attendance/…, and both reach
 * the same handler over the same tables, so the two ERPs cannot disagree:
 * there is no copy to keep in step.
 *
 * Here because of the gate, not the data. The middleware rule for /api/robo
 * and roboGate below are what keep this to the Robo login and admins; a shared
 * /api/attendance prefix would have no rule at all, and the ROBO role's own
 * cap would then lock it out of the thing it needs. See lib/attendance/server.ts.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { path } = await ctx.params;
  return attendanceApi(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
