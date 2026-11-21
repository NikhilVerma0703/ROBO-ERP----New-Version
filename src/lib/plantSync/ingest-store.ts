// STANDALONE: the one question Robo asks of the plant-sync store.
//
// In Pacific ERP this file (290 lines) is the database half of the plant PC's
// ingest endpoint (/api/plant/ingest): it writes the Breton plant DB's rows
// into the plant_* tables. Robo only READS those tables (the 17 Nov plant-fill
// features: From the plant, the plant slab list, the setup batch picker, the
// coverage report and import auto-fill), and every read first asks
// plantTablesReady(). That function is copied below UNCHANGED; the ingest
// writers stay in the main ERP. In a standalone database the tables exist
// (prisma/schema.prisma) but nothing posts into them, so the Robo screens show
// their own "plant data off / no plant rows" states.
import "server-only";
import { prisma } from "@/lib/prisma";
import { FEEDS } from "@/lib/plantSync/ingest-rules";

/* ------------------------------------------------------- are the tables there */

let present = false;
let askedAt = 0;
const ASK_AGAIN_MS = 5 * 60_000;
const ALL_TABLES = ["plant_sync_post", "plant_sync_state", ...FEEDS.map((f) => f.table)];

/**
 * Has scripts/0152 run? A yes is kept for the life of the process (a table
 * once there stays); a no is asked again after five minutes, so ingest comes
 * on without a redeploy once the owner has run the script. All ten tables are
 * asked for: 0152 makes them in one transaction, so it is all or none, and a
 * partial set is as good as none.
 */
export async function plantTablesReady(): Promise<boolean> {
  if (present) return true;
  if (askedAt && Date.now() - askedAt < ASK_AGAIN_MS) return false;
  const r = await prisma.$queryRaw<{ ok: boolean | null }[]>`
    SELECT bool_and(to_regclass(t) IS NOT NULL) AS ok FROM unnest(${ALL_TABLES}::text[]) AS t`;
  askedAt = Date.now();
  present = r[0]?.ok === true;
  return present;
}
