import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { cleanMasterName, duplicateNameError, isUniqueViolation, missingNameError } from "@/lib/robo/masterNames";
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json(await prisma.roboProgram.findMany({ include: { design: true }, orderBy: { name: "asc" } }));
}
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  // CR-002: a name already on the list is a 409 with a sentence, not a 500.
  const name = cleanMasterName(body?.name);
  const designId = cleanMasterName(body?.designId);
  if (!name) return NextResponse.json({ error: missingNameError("program") }, { status: 400 });
  if (!designId || !(await prisma.roboDesign.findUnique({ where: { id: designId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Pick the design this program belongs to." }, { status: 400 });
  }
  if (await prisma.roboProgram.findUnique({ where: { name } })) {
    return NextResponse.json({ error: duplicateNameError("program", name) }, { status: 409 });
  }
  try {
    const data = await prisma.roboProgram.create({ data: { name, designId } });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: duplicateNameError("program", name) }, { status: 409 });
    throw e;
  }
}
