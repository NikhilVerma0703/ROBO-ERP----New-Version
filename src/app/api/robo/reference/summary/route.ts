import { NextRequest, NextResponse } from "next/server";
import { buildReferenceSummary } from "@/lib/robo/referenceData";
import { roboGate } from "@/lib/rbac";

// Live aggregation, never cached — the same reason reports/summary is
// force-dynamic: a stale Reference Sheet is how "the numbers changed later"
// happens. Always computed fresh from the current rows.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/robo/reference/summary?design=<Design Name>
 *
 * The preview behind the Downloads "Reference Sheet" section. Matches the design
 * by name only (thickness ignored — see designMatchKey), finds its latest
 * production run and returns the same summary the Excel export writes, so the
 * screen and the file agree. `found:false` means no production exists for that
 * design → the UI shows "No previous production record found".
 */
export async function GET(req: NextRequest) {
  // The in-route gate every /api/robo handler carries (lib/rbac.ts roboGate):
  // the edge runs without the database, so a deactivated or signed-out-
  // everywhere session is refused here or not at all (code review ROBO-5).
  const refused = await roboGate();
  if (refused) return refused;
  const design = req.nextUrl.searchParams.get("design")?.trim() || "";
  if (!design) return NextResponse.json({ found: false });

  const summary = await buildReferenceSummary(design);
  if (!summary) return NextResponse.json({ found: false });

  return NextResponse.json({ found: true, ...summary });
}
