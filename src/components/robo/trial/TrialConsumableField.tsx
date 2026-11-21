"use client";

/**
 * Trial Slab Entry — one Liquid or Powder cell of a robot's setup (CR-003).
 *
 * The cell holds what the regular setup's one field held, in the same place,
 * so the row structure and the number of fields per row are unchanged:
 *   Setting (Normal / Define) · Name (typed by hand for both)
 *   Reference photo — only when Define, and then required.
 */
import { useEffect, useRef, useState } from "react";
import { PhotoEditor, type PhotoEdits } from "@/components/robo/trial/PhotoEditor";
import { SETTING_DEFINE, SETTING_OPTIONS, type ConsumableSetting } from "@/lib/robo/trial";

/** A stored reference photo as the page holds it (the bytes stay on the server). */
export interface PhotoRef {
  id: string;
  hasEdited: boolean;
  notes: string | null;
  edits: unknown;
}

const photoUrl = (id: string, v: "edited" | "original") => `/api/robo/trial/photos/${id}?v=${v}`;

async function upload(fields: { original?: File; fromId?: string; edited: Blob | null; edits: PhotoEdits | null; notes: string }): Promise<PhotoRef> {
  const fd = new FormData();
  if (fields.original) fd.append("original", fields.original);
  if (fields.fromId) fd.append("fromId", fields.fromId);
  if (fields.edited) fd.append("edited", new File([fields.edited], "edited.jpg", { type: fields.edited.type || "image/jpeg" }));
  if (fields.edits) fd.append("edits", JSON.stringify(fields.edits));
  if (fields.notes) fd.append("notes", fields.notes);
  const res = await fetch("/api/robo/trial/photos", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "The photo could not be saved.");
  return data as PhotoRef;
}

/** The reference photo: Camera / Gallery, then the editor; a saved one can be edited again. */
export function ReferencePhotoField({ value, onChange, label, required }: {
  value: PhotoRef | null;
  onChange: (p: PhotoRef | null) => void;
  label: string;
  required?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ src: string; file?: File; fromId?: string; edits?: unknown; notes?: string | null } | null>(null);
  const [error, setError] = useState("");

  // A picked file is shown through an object URL; let it go when done.
  useEffect(() => () => { if (editing?.file) URL.revokeObjectURL(editing.src); }, [editing]);

  const pick = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Pick an image."); return; }
    if (file.size > 15 * 1024 * 1024) { setError("That photo is larger than 15 MB."); return; }
    setEditing({ src: URL.createObjectURL(file), file });
  };

  const btn = "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 [@media_screen_and_(pointer:coarse)]:min-h-[40px]";

  return (
    <div className="mt-2 rounded-lg border border-dashed border-brand/40 bg-brand/5 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700">
          Reference photo{required && <span className="text-red-500"> *</span>}
        </span>
        {value && (
          <span className="flex gap-2 text-xs">
            <a href={photoUrl(value.id, "original")} target="_blank" rel="noreferrer" className="text-brand hover:underline">Original</a>
            {value.hasEdited && <a href={photoUrl(value.id, "edited")} target="_blank" rel="noreferrer" className="text-brand hover:underline">Edited</a>}
          </span>
        )}
      </div>
      {value ? (
        <div className="flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(value.id, "edited")} alt={`${label} reference`} className="h-16 w-20 shrink-0 rounded border border-gray-200 bg-white object-cover" />
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <button type="button" className={btn}
              onClick={() => setEditing({ src: photoUrl(value.id, "original"), fromId: value.id, edits: value.edits, notes: value.notes })}>✎ Edit</button>
            <button type="button" className={btn} onClick={() => camRef.current?.click()}>📷 Retake</button>
            <button type="button" className={btn} onClick={() => galRef.current?.click()}>🖼 Replace</button>
            <button type="button" className={`${btn} text-red-600`} onClick={() => onChange(null)}>✕ Remove</button>
            {value.notes && <p className="w-full truncate text-xs text-gray-500" title={value.notes}>{value.notes}</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} onClick={() => camRef.current?.click()}>📷 Camera</button>
          <button type="button" className={btn} onClick={() => galRef.current?.click()}>🖼 Gallery</button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={galRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {editing && (
        <PhotoEditor
          src={editing.src}
          initialEdits={editing.edits}
          initialNotes={editing.notes}
          title={`${label} — reference photo`}
          onCancel={() => setEditing(null)}
          onSave={async ({ edits, edited, notes }) => {
            const saved = await upload({ original: editing.file, fromId: editing.fromId, edited, edits, notes });
            onChange(saved);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** One Liquid / Powder cell: Setting and Name side by side, the photo below when Define. */
export function TrialConsumableField({
  label, optional, setting, name, nameOptions, photo, labelClass, inputClass, placeholder,
  onSetting, onName, onPhoto,
}: {
  label: string;
  optional?: boolean;
  setting: ConsumableSetting;
  name: string;
  nameOptions: readonly { name: string }[];
  photo: PhotoRef | null;
  labelClass: string;
  inputClass: string;
  placeholder: string;
  onSetting: (v: ConsumableSetting) => void;
  onName: (v: string) => void;
  onPhoto: (p: PhotoRef | null) => void;
}) {
  const listId = useRef(`dl-${label}-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="min-w-0">
      <span className={labelClass}>{label}{optional ? " (optional)" : ""}</span>
      {/* Each control in its own box: the shared input class is full-width, so
          the widths are set on the wrappers (a width on the select itself lost
          to that class and squeezed the name box to nothing). */}
      {/* flex-wrap: in a narrow cell (the tablet's three-up row) the Name box
          drops under the Setting, inside the same cell, instead of being
          squeezed — the grid's rows and fields per row stay as they were. */}
      <div className="flex min-w-0 flex-wrap gap-2">
        <div className="w-[6.5rem] shrink-0">
          <select value={setting} onChange={(e) => onSetting(e.target.value as ConsumableSetting)}
            aria-label={`${label} setting`} className={inputClass}>
            {SETTING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder={placeholder} list={listId}
            aria-label={`${label} name`} className={inputClass} />
        </div>
        <datalist id={listId}>{nameOptions.map((o) => <option key={o.name} value={o.name} />)}</datalist>
      </div>
      {setting === SETTING_DEFINE && (
        <ReferencePhotoField value={photo} onChange={onPhoto} label={label} required />
      )}
    </div>
  );
}
