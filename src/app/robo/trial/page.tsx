import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { TrialEntryForm } from "@/components/robo/trial/TrialEntryForm";
import { canDeleteRoboSlab } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trial Slab Entry | Pacific ERP" };

/**
 * Trial Slab Entry (CR-003, 20 Nov 2026) — directly below Slab Entry in the
 * sidebar. The same flow as Slab Entry (Batch setup → Slab entry → Recent
 * slabs), with a batch setup of its own for every trial slab. Trial slabs are
 * ordinary production slabs: they count in every total, report and download,
 * and show in Slab Records as "D-1506 (Trial Slab)".
 */
export default async function TrialSlabEntryPage() {
  const canDelete = await canDeleteRoboSlab();
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Trial slab entry</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Each trial slab has its own batch setup — programs, liquids, powders and reference photos. Save the setup,
          then enter the trial slab. Trial slabs count in production like any other slab.
        </p>
      </div>
      <TrialEntryForm canDelete={canDelete} />
    </Shell>
  );
}
