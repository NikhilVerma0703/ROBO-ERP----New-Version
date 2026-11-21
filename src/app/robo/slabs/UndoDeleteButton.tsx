"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClientTime } from "@/components/ClientTime";
import { keepRoboSlabDeleted, restoreDeletedRoboSlab } from "./undoActions";

/**
 * "Restore last deleted slab" — admin only, and shown only when there is one.
 *
 * It names the slab rather than saying "undo". An undo button with no subject
 * is one an admin will not press, because they cannot tell what it is about to
 * bring back; and on a page whose whole risk is an accidental delete, a vague
 * control is worse than none. Both buttons act on the deletion named here, by
 * its id.
 *
 * `refusal` is the page's read-ahead of why a restore would be refused (the
 * slab number keyed again since, the shift or setup gone). Then the banner says
 * so, in place of the promise that the slab can be put back, and offers only
 * "Keep it deleted" — the way to close an entry that should not come back,
 * which before this stayed up for good with a Restore that always failed (a
 * later review of ROBO-9, code review of 20 Oct 2026). "Keep it deleted" is
 * also offered beside "Restore it": an admin who decides the delete was right
 * closes it, and the banner moves on to the deletion before it.
 *
 * The page is refreshed after every press, not only a restore: after a refusal
 * it re-reads the entry and shows why, and after a close it moves on.
 */
export function UndoDeleteButton({ id, summary, by, at, refusal }: {
  id: string;
  summary: string;
  by: string | null;
  at: string | null;
  refusal: string | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [doing, setDoing] = useState<"restore" | "keep" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (what: "restore" | "keep", action: (entryId: string) => Promise<{ ok: boolean; message: string }>) => {
    setDoing(what);
    start(async () => {
      const r = await action(id);
      setMsg(r.message);
      router.refresh();
    });
  };

  const keep = () => {
    if (!window.confirm(
      `Keep this slab deleted?\n\n${summary}\n\n` +
      "This closes the entry without restoring it, and this page will no longer offer to put it back. " +
      "Its saved copy stays in the action log.",
    )) return;
    run("keep", keepRoboSlabDeleted);
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-amber-900">
          <b>{summary}</b>
          <span className="text-amber-700">
            {/* ClientTime: the time is written after mount, so the server (UTC)
                and the tablet (IST) no longer render different text and React
                no longer regenerates the page on every load */}
            {by ? ` · by ${by}` : ""}{at ? <ClientTime iso={at} prefix=" · " /> : ""}
          </span>
          <div className="text-[11px] text-amber-700">
            {refusal ?? "The slab and its delay logs were kept and can be put back exactly as they were."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!refusal && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("restore", restoreDeletedRoboSlab)}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {pending && doing === "restore" ? "Restoring…" : "Restore it"}
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={keep}
            className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {pending && doing === "keep" ? "Closing…" : "Keep it deleted"}
          </button>
        </div>
      </div>
      {msg && <div className="mt-1 text-[11px] text-amber-900">{msg}</div>}
    </div>
  );
}
