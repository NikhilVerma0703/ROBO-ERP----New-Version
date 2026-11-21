"use client";
// THE LAST RESORT for a page that fails to render. Every section of "/"
// already catches its own failure and says so on its own card; this catches
// what is left, and keeps the root layout (global-error.tsx replaces the
// whole document). A stale build — an open tab from a previous deploy that
// cannot lazy-load a chunk — reloads itself once, as global-error does.
import { useEffect } from "react";
import { viewAsRefusalOf } from "@/lib/viewAsClient";
import { VIEW_AS_API } from "@/lib/viewAs";

const CHUNK_RE = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|css chunk/i;

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = CHUNK_RE.test(`${error?.name ?? ""} ${error?.message ?? ""}`);
  // "View as" refused a write this page tried to make — the admin is looking
  // at another login's screen, read-only. Say that, not "could not be shown".
  const viewAs = viewAsRefusalOf(error);
  useEffect(() => {
    if (viewAs) return;
    if (!stale) { console.error(error); return; }
    try {
      const last = Number(sessionStorage.getItem("chunk-reload-at") ?? 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem("chunk-reload-at", String(Date.now()));
        window.location.reload();
      }
    } catch { /* storage blocked: the Reload button below still works */ }
  }, [stale, error, viewAs]);

  if (viewAs) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Nothing was saved</h1>
        <p className="max-w-md text-sm text-gray-600">{viewAs}</p>
        <div className="flex gap-2">
          <button onClick={() => reset()} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Go back to the page</button>
          <form action={VIEW_AS_API} method="post">
            <input type="hidden" name="op" value="stop" />
            <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Back to my login</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold text-gray-900">
        {stale ? "The app was updated — loading the new version…" : "This page could not be shown just now."}
      </h1>
      <p className="max-w-md text-sm text-gray-600">
        {stale
          ? "If this stays, reload the page."
          : "Try again in a moment. If you had just saved something, check it went through before entering it again; if this keeps happening, tell the admin."}
      </p>
      <div className="flex gap-2">
        {!stale && (
          <button onClick={() => reset()} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Try again</button>
        )}
        <button onClick={() => window.location.reload()} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Reload</button>
      </div>
      {error?.digest ? <p className="text-[11px] text-gray-500">Error ref: {error.digest}</p> : null}
    </div>
  );
}
