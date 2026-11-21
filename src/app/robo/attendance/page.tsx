import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { AttendanceClient } from "@/components/attendance/AttendanceClient";
import { currentUser } from "@/lib/rbac";
import { plantRightsOfUser } from "@/lib/plantAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Attendance | Pacific ERP" };

/**
 * Robo → Attendance. The same register the Chromia side shows, over the same
 * tables; only the API door differs, because only the gate does. See
 * lib/attendance/server.ts.
 *
 * The rights are read HERE, from the session, and handed to the screen: a
 * client component that worked out its own permissions would be working them
 * out from something the browser could change. They decide what is drawn and
 * nothing else — the API checks every one of them again.
 */
export default async function RoboAttendancePage() {
  const rights = plantRightsOfUser(await currentUser());
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Attendance</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          One register for both lines — the same operators, the same days, whichever ERP it is entered from.
        </p>
      </div>
      <AttendanceClient api="/api/robo/attendance" rights={rights} />
    </Shell>
  );
}
