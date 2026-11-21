"use client";

/**
 * The reference-photo editor of Trial Slab Entry (CR-003, 20 Nov 2026).
 *
 * Crop and resize, add text and notes, draw circles, rectangles and squares,
 * highlight areas in different colours (a highlight box or a highlighter pen),
 * and add arrows. Works with a finger on the tablet and with a mouse.
 *
 * The photo itself is never changed: every shape is kept in ORIGINAL image
 * pixels in `edits`, and the edited image is drawn from the original and those
 * steps when Save is pressed. So reopening a saved photo shows every shape
 * again, still editable, and the original is always there to go back to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Pt = { x: number; y: number };
type BoxTool = "rect" | "square" | "circle" | "arrow" | "highlight";
export type Shape =
  | { t: BoxTool; a: Pt; b: Pt; color: string; w: number }
  | { t: "marker"; pts: Pt[]; color: string; w: number }
  | { t: "text"; a: Pt; text: string; color: string; size: number };
type Crop = { x: number; y: number; w: number; h: number };

/** What is stored with a photo so it can be edited again. */
export interface PhotoEdits {
  v: 1;
  crop: Crop | null;
  scale: number;
  shapes: Shape[];
}

type Tool = BoxTool | "marker" | "text" | "crop";

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "crop", label: "✂ Crop", title: "Drag a box, then Apply crop" },
  { id: "rect", label: "▭ Rectangle", title: "Drag to draw a rectangle" },
  { id: "square", label: "□ Square", title: "Drag to draw a square" },
  { id: "circle", label: "◯ Circle", title: "Drag to draw a circle" },
  { id: "arrow", label: "➜ Arrow", title: "Drag from the tail to the point" },
  { id: "highlight", label: "▨ Highlight", title: "Drag a box to highlight an area" },
  { id: "marker", label: "🖍 Marker", title: "Draw freehand to highlight" },
  { id: "text", label: "T Text", title: "Type the text below, then tap where it goes" },
];

const COLORS = [
  { v: "#e11d48", n: "Red" },
  { v: "#f59e0b", n: "Orange" },
  { v: "#facc15", n: "Yellow" },
  { v: "#16a34a", n: "Green" },
  { v: "#2563eb", n: "Blue" },
  { v: "#9333ea", n: "Purple" },
  { v: "#111827", n: "Black" },
  { v: "#ffffff", n: "White" },
];

const WIDTHS = [{ v: 1, n: "Thin" }, { v: 2, n: "Medium" }, { v: 4, n: "Thick" }];
const SCALES = [1, 0.75, 0.5, 0.25];

function emptyEdits(): PhotoEdits {
  return { v: 1, crop: null, scale: 1, shapes: [] };
}

/** Reads a stored `edits` value back, or a clean start when it is anything else. */
export function readEdits(value: unknown): PhotoEdits {
  const e = value as Partial<PhotoEdits> | null;
  if (!e || e.v !== 1 || !Array.isArray(e.shapes)) return emptyEdits();
  return { v: 1, crop: e.crop ?? null, scale: SCALES.includes(Number(e.scale)) ? Number(e.scale) : 1, shapes: e.shapes as Shape[] };
}

/** True when the edits would change nothing (no crop, full size, no shapes). */
export function editsAreEmpty(e: PhotoEdits): boolean {
  return !e.crop && e.scale === 1 && e.shapes.length === 0;
}

/** Stroke width in image pixels for a width step, relative to the photo size. */
function strokePx(img: { w: number; h: number }, step: number): number {
  return Math.max(2, Math.round((Math.max(img.w, img.h) / 400) * step));
}

function normBox(a: Pt, b: Pt, square: boolean): { x: number; y: number; w: number; h: number } {
  let w = b.x - a.x, h = b.y - a.y;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Draws one shape; `map` turns image pixels into canvas pixels, `k` scales sizes. */
function drawShape(ctx: CanvasRenderingContext2D, s: Shape, map: (p: Pt) => Pt, k: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.t === "text") {
    const p = map(s.a);
    const size = s.size * k;
    ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = "top";
    // A thin contrasting outline keeps text readable on any background.
    ctx.lineWidth = Math.max(1, size / 8);
    ctx.strokeStyle = s.color === "#ffffff" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.85)";
    const lines = s.text.split("\n");
    lines.forEach((line, i) => {
      ctx.strokeText(line, p.x, p.y + i * size * 1.2);
      ctx.fillStyle = s.color;
      ctx.fillText(line, p.x, p.y + i * size * 1.2);
    });
  } else if (s.t === "marker") {
    if (s.pts.length < 2) { ctx.restore(); return; }
    ctx.strokeStyle = hexAlpha(s.color, 0.4);
    ctx.lineWidth = s.w * 4 * k;
    ctx.beginPath();
    const p0 = map(s.pts[0]);
    ctx.moveTo(p0.x, p0.y);
    for (const q of s.pts.slice(1)) { const p = map(q); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  } else {
    const a = map(s.a), b = map(s.b);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.w * k;
    if (s.t === "arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, s.w * k * 4);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    } else {
      const r = normBox(a, b, s.t === "square" || s.t === "circle");
      if (s.t === "highlight") {
        ctx.fillStyle = hexAlpha(s.color, 0.35);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else if (s.t === "circle") {
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
  }
  ctx.restore();
}

/** Renders the edited image (crop, size and every shape) to a JPEG/PNG blob. */
export async function renderEdited(img: HTMLImageElement, edits: PhotoEdits, type = "image/jpeg"): Promise<Blob> {
  const crop = edits.crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const k = edits.scale;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w * k));
  canvas.height = Math.max(1, Math.round(crop.h * k));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  const map = (p: Pt) => ({ x: (p.x - crop.x) * k, y: (p.y - crop.y) * k });
  for (const s of edits.shapes) drawShape(ctx, s, map, k);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), type, 0.92));
}

export function PhotoEditor({ src, initialEdits, initialNotes, title, onCancel, onSave }: {
  /** The ORIGINAL photo (an object URL for a new pick, or the stored original). */
  src: string;
  initialEdits?: unknown;
  initialNotes?: string | null;
  title: string;
  onCancel: () => void;
  onSave: (result: { edits: PhotoEdits; edited: Blob | null; notes: string; img: HTMLImageElement }) => void | Promise<void>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [edits, setEdits] = useState<PhotoEdits>(() => readEdits(initialEdits));
  const [redo, setRedo] = useState<Shape[]>([]);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState(COLORS[0].v);
  const [width, setWidth] = useState(2);
  const [text, setText] = useState("");
  const [textSize, setTextSize] = useState(2);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Crop | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(800);
  const drag = useRef<{ start: Pt } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setLoadError(true);
    i.src = src;
  }, [src]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Esc closes, Ctrl+Z undoes — on a desk; the buttons do the same on the tablet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const full = useMemo<Crop | null>(() => (img ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight } : null), [img]);
  // While cropping, the whole photo is shown so the box can be drawn anywhere.
  const view = tool === "crop" ? full : (edits.crop ?? full);
  const maxH = typeof window === "undefined" ? 600 : Math.max(240, window.innerHeight - 330);
  const k = view ? Math.min(boxW / view.w, maxH / view.h) : 1;

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !img || !view) return;
    c.width = Math.max(1, Math.round(view.w * k));
    c.height = Math.max(1, Math.round(view.h * k));
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, view.x, view.y, view.w, view.h, 0, 0, c.width, c.height);
    const map = (p: Pt) => ({ x: (p.x - view.x) * k, y: (p.y - view.y) * k });
    for (const s of edits.shapes) drawShape(ctx, s, map, k);
    if (draft) drawShape(ctx, draft, map, k);
    if (tool === "crop") {
      const r = cropDraft ?? edits.crop;
      if (r) {
        const a = map({ x: r.x, y: r.y });
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, c.width, a.y);
        ctx.fillRect(0, a.y + r.h * k, c.width, c.height - a.y - r.h * k);
        ctx.fillRect(0, a.y, a.x, r.h * k);
        ctx.fillRect(a.x + r.w * k, a.y, c.width - a.x - r.w * k, r.h * k);
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, r.w * k, r.h * k);
        ctx.restore();
      }
    }
  }, [img, view, k, edits, draft, tool, cropDraft]);

  useEffect(() => { draw(); }, [draw]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = view!;
    const x = v.x + ((e.clientX - r.left) / r.width) * v.w;
    const y = v.y + ((e.clientY - r.top) / r.height) * v.h;
    return { x: Math.max(v.x, Math.min(v.x + v.w, x)), y: Math.max(v.y, Math.min(v.y + v.h, y)) };
  };

  const imgSize = img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 1000, h: 1000 };
  const commit = (s: Shape) => {
    setEdits((p) => ({ ...p, shapes: [...p.shapes, s] }));
    setRedo([]);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img || !view) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    if (tool === "text") {
      if (!text.trim()) { setError("Type the text first, then tap where it goes."); return; }
      setError("");
      commit({ t: "text", a: p, text: text.trim(), color, size: strokePx(imgSize, 1) * 6 * textSize });
      return;
    }
    drag.current = { start: p };
    if (tool === "crop") setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    else if (tool === "marker") setDraft({ t: "marker", pts: [p], color, w: strokePx(imgSize, width) });
    else setDraft({ t: tool, a: p, b: p, color, w: strokePx(imgSize, width) });
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const p = toImage(e);
    const s = drag.current.start;
    if (tool === "crop") setCropDraft(normBox(s, p, false));
    else if (tool === "marker") setDraft((d) => (d && d.t === "marker" ? { ...d, pts: [...d.pts, p] } : d));
    else setDraft((d) => (d && d.t !== "marker" && d.t !== "text" ? { ...d, b: p } : d));
  };

  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (tool === "crop") return; // applied with the button
    if (draft) {
      const tiny = draft.t === "marker" ? draft.pts.length < 2
        : draft.t !== "text" && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < 3;
      if (!tiny) commit(draft);
    }
    setDraft(null);
  };

  const applyCrop = () => {
    if (!cropDraft || cropDraft.w < 10 || cropDraft.h < 10) { setError("Drag a box over the part to keep."); return; }
    setError("");
    setEdits((p) => ({ ...p, crop: { x: Math.round(cropDraft.x), y: Math.round(cropDraft.y), w: Math.round(cropDraft.w), h: Math.round(cropDraft.h) } }));
    setCropDraft(null);
    setTool("rect");
  };

  const undo = () => {
    if (!edits.shapes.length) return;
    const last = edits.shapes[edits.shapes.length - 1];
    setEdits((p) => ({ ...p, shapes: p.shapes.slice(0, -1) }));
    setRedo((r) => [...r, last]);
  };
  const redoOne = () => {
    if (!redo.length) return;
    const s = redo[redo.length - 1];
    setRedo((r) => r.slice(0, -1));
    setEdits((p) => ({ ...p, shapes: [...p.shapes, s] }));
  };

  const save = async () => {
    if (!img) return;
    setSaving(true);
    setError("");
    try {
      const edited = editsAreEmpty(edits) ? null : await renderEdited(img, edits);
      await onSave({ edits, edited, notes: notes.trim(), img });
    } catch {
      setError("The photo could not be saved — try again.");
      setSaving(false);
    }
  };

  const outW = Math.round((edits.crop?.w ?? imgSize.w) * edits.scale);
  const outH = Math.round((edits.crop?.h ?? imgSize.h) * edits.scale);
  const btn = "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition [@media_screen_and_(pointer:coarse)]:min-h-[40px]";
  const btnOff = `${btn} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;
  const btnOn = `${btn} border-brand bg-brand text-white`;

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/60 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
          <span className="shrink-0 text-xs text-gray-400">{img ? `Saved size ${outW} × ${outH}px` : ""}</span>
        </div>

        {/* Toolbar */}
        <div className="space-y-2 border-b border-gray-100 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" title={t.title} onClick={() => { setTool(t.id); setError(""); }}
                className={tool === t.id ? btnOn : btnOff}>{t.label}</button>
            ))}
            <span className="mx-1 hidden w-px bg-gray-200 sm:block" />
            <button type="button" className={btnOff} onClick={undo} disabled={!edits.shapes.length}>↶ Undo</button>
            <button type="button" className={btnOff} onClick={redoOne} disabled={!redo.length}>↷ Redo</button>
            <button type="button" className={btnOff} onClick={() => { setEdits((p) => ({ ...p, shapes: [] })); setRedo([]); }} disabled={!edits.shapes.length}>Clear shapes</button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
              {COLORS.map((c) => (
                <button key={c.v} type="button" title={c.n} aria-label={c.n} aria-checked={color === c.v} role="radio" onClick={() => setColor(c.v)}
                  className={`h-7 w-7 rounded-full border-2 ${color === c.v ? "border-gray-900 ring-2 ring-brand/40" : "border-gray-300"}`}
                  style={{ background: c.v }} />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Line
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
                {WIDTHS.map((w) => <option key={w.v} value={w.v}>{w.n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Size
              <select value={edits.scale} onChange={(e) => setEdits((p) => ({ ...p, scale: Number(e.target.value) }))} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
                {SCALES.map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
              </select>
            </label>
            {tool === "crop" && (
              <div className="flex items-center gap-1.5">
                <button type="button" className={btnOn} onClick={applyCrop}>Apply crop</button>
                <button type="button" className={btnOff} onClick={() => { setEdits((p) => ({ ...p, crop: null })); setCropDraft(null); }} disabled={!edits.crop && !cropDraft}>Reset crop</button>
              </div>
            )}
            {tool === "text" && (
              <div className="flex min-w-[240px] flex-1 items-center gap-1.5">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to place on the photo"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
                <select value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1 text-xs" aria-label="Text size">
                  <option value={1}>Small</option><option value={2}>Medium</option><option value={3}>Large</option>
                </select>
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Canvas */}
        <div ref={boxRef} className="flex min-h-[240px] flex-1 items-center justify-center overflow-auto bg-gray-100 p-2">
          {loadError ? (
            <p className="max-w-sm text-center text-sm text-gray-600">
              This photo cannot be opened for editing in this browser (for example a HEIC photo). Save keeps it as it is,
              without edits.
            </p>
          ) : !img ? (
            <p className="text-sm text-gray-500">Loading photo…</p>
          ) : (
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              className="max-w-full cursor-crosshair touch-none rounded shadow" />
          )}
        </div>

        {/* Notes + actions */}
        <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Notes for this photo</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional — what to look for in this reference"
              className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
          </label>
          <div className="flex shrink-0 justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={saving}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={saving || (!img && !loadError)}
              onClick={loadError ? () => onSave({ edits: emptyEdits(), edited: null, notes: notes.trim(), img: new Image() }) : save}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
              {saving ? "Saving…" : "Save photo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
