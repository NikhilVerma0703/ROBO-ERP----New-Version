import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
import { cleanMasterName, duplicateNameError, isUniqueViolation, missingNameError } from "@/lib/robo/masterNames";
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json(await prisma.roboLiquid.findMany({ orderBy: { name: "asc" } }));
}
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  // CR-002: a name already on the list is a 409 with a sentence, not a 500.
  const name = cleanMasterName(body?.name);
  if (!name) return NextResponse.json({ error: missingNameError("liquid") }, { status: 400 });
  if (await prisma.roboLiquid.findUnique({ where: { name } })) {
    return NextResponse.json({ error: duplicateNameError("liquid", name) }, { status: 409 });
  }
  try {
    const data = await prisma.roboLiquid.create({ data: { name } });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: duplicateNameError("liquid", name) }, { status: 409 });
    throw e;
  }
}
