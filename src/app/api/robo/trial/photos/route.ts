import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { MAX_PHOTO_BYTES, isImageType } from "@/lib/robo/trial";
import { PHOTO_META_SELECT, clearStalePhotos, photoMeta } from "@/lib/robo/trialDb";

/**
 * POST /api/robo/trial/photos — upload one reference photo (CR-003).
 *
 * multipart/form-data:
 *   original — the photo as taken / picked (a new photo), OR
 *   fromId   — an existing photo whose original is reused (editing a photo
 *              again, or a photo copied from a previous trial);
 *   edited   — the cropped / annotated image from the editor (optional);
 *   edits    — the editor's steps as JSON, so it can be reopened (optional);
 *   notes    — the photo's notes (optional).
 *
 * The photo is stored on no setup yet; the setup save claims it. A stored
 * photo is never changed: an edit is always a new row, so editing a copy can
 * never alter the trial it was copied from.
 */
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the photo as a form upload." }, { status: 400 });

  const original = form.get("original");
  const fromId = typeof form.get("fromId") === "string" ? String(form.get("fromId")) : "";
  const edited = form.get("edited");
  const editsRaw = typeof form.get("edits") === "string" ? String(form.get("edits")) : "";
  const notes = typeof form.get("notes") === "string" ? String(form.get("notes")).trim() || null : null;

  let originalData: Uint8Array<ArrayBuffer>, originalType: string, originalName: string | null;
  if (original instanceof File && original.size > 0) {
    if (original.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "That photo is larger than 15 MB." }, { status: 400 });
    if (!isImageType(original.type)) return NextResponse.json({ error: "Pick an image (JPEG, PNG, WebP or HEIC)." }, { status: 400 });
    originalData = new Uint8Array(await original.arrayBuffer());
    originalType = original.type;
    originalName = original.name || null;
  } else if (fromId) {
    const src = await prisma.roboReferencePhoto.findUnique({ where: { id: fromId }, select: { originalData: true, originalType: true, originalName: true } });
    if (!src) return NextResponse.json({ error: "The photo to edit could not be found." }, { status: 404 });
    originalData = new Uint8Array(src.originalData);
    originalType = src.originalType;
    originalName = src.originalName;
  } else {
    return NextResponse.json({ error: "Add a photo." }, { status: 400 });
  }

  let editedData: Uint8Array<ArrayBuffer> | null = null, editedType: string | null = null;
  if (edited instanceof File && edited.size > 0) {
    if (edited.size > MAX_PHOTO_BYTES || !isImageType(edited.type)) return NextResponse.json({ error: "The edited photo could not be read." }, { status: 400 });
    editedData = new Uint8Array(await edited.arrayBuffer());
    editedType = edited.type;
  }
  let edits: Prisma.InputJsonValue | undefined;
  if (editsRaw) {
    try { edits = JSON.parse(editsRaw) as Prisma.InputJsonValue; } catch { edits = undefined; }
  }

  await clearStalePhotos();
  const photo = await prisma.roboReferencePhoto.create({
    data: { originalData, originalType, originalName, editedData, editedType, edits, notes },
    select: PHOTO_META_SELECT,
  });
  return NextResponse.json(photoMeta(photo), { status: 201 });
}
