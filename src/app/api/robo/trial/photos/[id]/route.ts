import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

/**
 * GET /api/robo/trial/photos/[id]?v=edited|original — the image itself
 * (CR-003). `edited` falls back to the original when the photo was never
 * edited. A stored photo never changes (every edit is a new row), so it may be
 * cached for good.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const wantEdited = req.nextUrl.searchParams.get("v") !== "original";
  const photo = await prisma.roboReferencePhoto.findUnique({
    where: { id },
    select: { originalData: true, originalType: true, editedData: true, editedType: true, originalName: true },
  });
  if (!photo) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  const useEdited = wantEdited && photo.editedData && photo.editedType;
  const data = useEdited ? photo.editedData! : photo.originalData;
  const type = useEdited ? photo.editedType! : photo.originalType;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${useEdited ? "edited" : "original"}-${id}.${type.split("/")[1] ?? "jpg"}"`,
    },
  });
}
