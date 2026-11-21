import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { DownloadsClient } from "@/components/robo/DownloadsClient";
import { currentUser } from "@/lib/rbac";
import { plantRightsOfUser } from "@/lib/plantAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Downloads | Pacific ERP" };

/**
 * Robo → Downloads. Three subsections for the Plant In-Charge and an admin,
 * two for the line tablet: the owner's instruction of 26 Oct 2026 is that an
 * operator sees "only Reference Sheet and QC Rejection Analysis" and that
 * Download Slab Records is hidden and restricted. The page is still theirs —
 * the card is not, and neither are the two endpoints behind it (the route
 * gate in src/app/api/robo/exports/*, and the edge in routeCaps).
 *
 * Read from the session here rather than in the client, for the reason the
 * attendance page gives.
 */
export default async function RoboDownloadsPage() {
  const { slabExports } = plantRightsOfUser(await currentUser());
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Downloads</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {slabExports
            ? "Slab record exports, a design’s last run, and what QC did with a batch."
            : "A design’s last run, and what QC did with a batch."}
        </p>
      </div>
      <DownloadsClient slabExports={slabExports} />
    </Shell>
  );
}
