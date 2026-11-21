// THE PLANT'S THICKNESS CODE IN ROBO'S UNIT (owner, 17 Nov 2026). Server and
// tests only: the code table is the plant-sync rule (match/line-head-rules),
// which the tablet page must not load (it pulls in the sync's server code).
// The screens get the centimetres already worked out.
import { lineHeadThicknessMm } from "../plantSync/match/line-head-rules.ts";

/** The plant's thickness code in centimetres, as Robo stores thickness (4 -> 2, 5 -> 3, 1 -> 0.7, 3 -> 1.2); null for any other code. */
export function plantThicknessCm(code: unknown): number | null {
  const mm = lineHeadThicknessMm(code);
  if (mm === null) return null;
  const cm = Number(mm) / 10;
  return Number.isFinite(cm) && cm > 0 ? cm : null;
}
