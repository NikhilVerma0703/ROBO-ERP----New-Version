"use client";
// "Made by the plant vs entered in Robo", per batch (owner, 17 Nov 2026).
// Fetched on its own, so a slow or failed plant read never touches the rest of
// the report. The numbers come from /api/robo/reports/coverage.
import { useEffect, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { compressRanges } from "@/lib/robo/coverage";

interface CoverageBatch { label: string; design: string; made: number; entered: number; notEntered: number[] }
interface CoverageAnswer { state: "ok" | "off" | "failed"; batches: CoverageBatch[]; leftOut: number; capped?: boolean }

/** More than this many characters of ranges are folded behind "show". */
const SHORT = 60;

function NotEntered({ numbers }: { numbers: number[] }) {
  const [open, setOpen] = useState(false);
  if (!numbers.length) return <span className="text-gray-400">None</span>;
  const text = compressRanges(numbers);
  if (text.length <= SHORT) return <span className="break-words text-gray-700">{text}</span>;
  return (
    <span className="break-words text-gray-700">
      {open ? text : `${text.slice(0, SHORT).replace(/[,\s–]*\d*$/, "")} …`}{" "}
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-medium text-brand hover:underline">
        {open ? "hide" : "show"}
      </button>
    </span>
  );
}

export function CoverageCard({ query }: { query: string }) {
  const [answer, setAnswer] = useState<CoverageAnswer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    const t = setTimeout(async () => {
      let next: CoverageAnswer | null = null;
      try {
        const res = await fetch(`/api/robo/reports/coverage${query}`, { cache: "no-store" });
        if (res.ok) next = await res.json();
      } catch { /* the plant says nothing */ }
      if (!current) return;
      setAnswer(next);
      setLoading(false);
    }, 250);
    return () => { current = false; clearTimeout(t); };
  }, [query]);

  const failed = !loading && (!answer || answer.state !== "ok");
  // No plant tables at all: nothing to compare, and nothing to say (the report is as it was).
  if (!loading && answer?.state === "off") return null;
  return (
    <Card>
      <h3 className="font-semibold text-gray-800">Made by the plant vs entered in Robo</h3>
      <p className="mb-3 mt-0.5 text-xs text-gray-400">
        A slab the robots did not touch is not entered in Robo; that is expected.
      </p>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />)}
        </div>
      ) : failed ? (
        <Empty>Could not read the plant just now. The rest of the report is not affected.</Empty>
      ) : !answer || answer.batches.length === 0 ? (
        <Empty>No batches for this selection.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Batch</th>
                  <th className="py-2 pr-4 font-medium">Design</th>
                  <th className="py-2 pr-4 text-right font-medium">Made</th>
                  <th className="py-2 pr-4 text-right font-medium">Entered</th>
                  <th className="py-2 pr-4 text-right font-medium">Not entered</th>
                  <th className="py-2 font-medium">Slab numbers not entered</th>
                </tr>
              </thead>
              <tbody>
                {answer.batches.map(b => (
                  <tr key={b.label} className="border-b border-gray-100 align-top last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-900">{b.label}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.design || "—"}</td>
                    {b.made === 0 ? (
                      /* Nothing the plant has: a batch from before the plant link, or one MIS has no hours for yet. Never "0 of 0". */
                      <td colSpan={4} className="py-2 text-gray-400">The plant has no record of this batch.</td>
                    ) : (
                      <>
                        <td className="py-2 pr-4 text-right tabular-nums">{b.made}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{b.entered}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{b.notEntered.length}</td>
                        <td className="py-2"><NotEntered numbers={b.notEntered} /></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {answer.capped && (
            <p className="mt-3 text-xs text-gray-400">These batches are longer than one report can read in full; narrow the filter to one batch to see all of it.</p>
          )}
          {answer.leftOut > 0 && (
            <p className="mt-3 text-xs text-gray-400">
              {answer.leftOut} older {answer.leftOut === 1 ? "batch is" : "batches are"} not shown. Narrow the filter to see {answer.leftOut === 1 ? "it" : "them"}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
