import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const shifts = await prisma.roboShift.findMany({
    include: {
      batchRecipes: { include: { design: true, program: true } },
      productionRecords: true,
      delayLogs: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(shifts);
}

export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json();
  try {
    // Serializable so the check-then-create is atomic: when two devices start a
    // shift in the same instant, one transaction conflicts and lands in the
    // catch below — there can never be two ACTIVE shifts.
    const shift = await prisma.$transaction(async (tx) => {
      const active = await tx.roboShift.findFirst({ where: { status: "ACTIVE" } });
      if (active) return null;
      return tx.roboShift.create({
        data: {
          date:             body.date,
          shiftNumber:      Number(body.shiftNumber),
          startTime:        body.startTime,
          operatorName:     body.operatorName || "",
          notes:            body.notes || null,
        },
      });
    }, { isolationLevel: "Serializable" });
    if (!shift) return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    return NextResponse.json(shift, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    }
    // P2002: the date and shift number already have a row — only possible once
    // scripts/0131's unique index on RoboShift (date, shiftNumber) is in
    // (ROBO-8, code review of 20 Oct 2026). Before it, this create made a
    // second row for the pair; now the row that is there is re-opened instead.
    // In practice that is a CLOSED row the register import made for today,
    // before the tablet's first slab of the day.
    if ((err as { code?: string }).code === "P2002") return reopenDayShift(body.date, Number(body.shiftNumber));
    console.error("Shift POST error:", err);
    return NextResponse.json({ error: "Failed to start shift" }, { status: 500 });
  }
}

/**
 * Makes the existing row for this date and shift number the running shift —
 * what the tablet's "start the day's shift" does when, with the unique index,
 * it cannot make a new one. The same answers as a create: 201 with the shift,
 * or 409 when another device has a shift running (the tablet then reads that
 * one). The tablet only ever closes a shift by starting the next day's, so the
 * re-opened row is closed again exactly as a new one would have been.
 */
async function reopenDayShift(date: string, shiftNumber: number) {
  try {
    const shift = await prisma.$transaction(async (tx) => {
      const active = await tx.roboShift.findFirst({ where: { status: "ACTIVE" } });
      if (active) return null;
      const row = await tx.roboShift.findFirst({ where: { date, shiftNumber }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!row) return null;
      return tx.roboShift.update({ where: { id: row.id }, data: { status: "ACTIVE", endTime: null } });
    }, { isolationLevel: "Serializable" });
    if (!shift) return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    return NextResponse.json(shift, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    }
    console.error("Shift POST error:", err);
    return NextResponse.json({ error: "Failed to start shift" }, { status: 500 });
  }
}
