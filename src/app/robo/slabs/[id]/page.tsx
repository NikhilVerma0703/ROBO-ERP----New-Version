import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { canEditRoboSetup } from "@/lib/rbac";
import { slabStatusClass, slabStatusLabel, machineLabel } from "@/lib/robo/utils";
import { productionDateOf } from "@/lib/robo/productionDate";
import { productionShiftOf, shiftOptionLabel } from "@/lib/robo/productionShift";
import { roboThicknessOf } from "@/lib/robo/thickness";
import { sequenceNumbersById } from "@/lib/robo/slabSequence";
import { plainSlabNo } from "@/lib/robo/plantSlabs";
import { readSlabPlantJourney } from "@/lib/robo/slabPlantJourney";
import { journeyView } from "@/lib/robo/slabPlantJourneyRules";
import { batchLabel, settingLabel, sequenceGroupKey } from "@/lib/robo/trial";
import { canonBatchNo } from "@/lib/robo/batchNo";
import { PHOTO_META_SELECT } from "@/lib/robo/trialDb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slab Details | Pacific ERP" };

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];
const MACHINE_COLORS: Record<string, string> = {
  "Roycut-1": "bg-blue-500", "Roymix": "bg-emerald-500",
  "Roycut-2": "bg-indigo-500", "Roycut-3": "bg-violet-500",
};

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : String(v);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-1.5 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="break-words text-right text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export default async function SlabCompleteDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: {
      shift: true,
      // referencePhotos (CR-003): a trial setup's reference photos, no bytes.
      batchRecipe: { include: { entries: { include: { machine: true } }, referencePhotos: { select: PHOTO_META_SELECT } } },
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!record) notFound();

  /* S.No. is the slab's position within its batch by physical slab number — the
     authoritative production order — not the stored serialNumber, which was
     mistyped on old runs (see slabSequence.ts). Rank this slab among its batch's
     slabs; a slab with no batch has no in-batch position. */
  let seqNo: number | null = null;
  const trialKey = record.batchRecipe?.isTrial ? canonBatchNo(record.batchRecipe.batchNo) : "";
  if (record.batchRecipeId && trialKey) {
    // CR-003: a trial slab is numbered among its batch's trial slabs, as in Slab
    // Records (sequenceGroupKey) — each has a setup of its own.
    const trialMates = await prisma.roboProductionRecord.findMany({
      where: { batchRecipe: { isTrial: true, batchNo: { not: null } } },
      select: { id: true, slabNumber: true, createdAt: true, batchRecipeId: true, batchRecipe: { select: { batchNo: true } } },
    });
    const mine = sequenceGroupKey({ batchRecipeId: record.batchRecipeId, isTrial: true, batchKey: trialKey });
    seqNo =
      sequenceNumbersById(
        trialMates
          .filter((m) => sequenceGroupKey({ batchRecipeId: m.batchRecipeId, isTrial: true, batchKey: canonBatchNo(m.batchRecipe?.batchNo) || null }) === mine)
          .map((m) => ({ id: m.id, slabNumber: m.slabNumber, createdAtMs: m.createdAt.getTime() })),
        () => "batch",
      ).get(record.id) ?? null;
  } else if (record.batchRecipeId) {
    const mates = await prisma.roboProductionRecord.findMany({
      where: { batchRecipeId: record.batchRecipeId },
      select: { id: true, slabNumber: true, createdAt: true },
    });
    seqNo =
      sequenceNumbersById(
        mates.map((m) => ({ id: m.id, slabNumber: m.slabNumber, createdAtMs: m.createdAt.getTime() })),
        () => "batch",
      ).get(record.id) ?? null;
  }

  const setup = record.batchRecipe;
  /* Same gate the Edit setup tab uses, so this page cannot offer a button that
     lands on a screen refusing to open. It is deliberately wider than the slab
     DELETE gate — see canEditRoboSetup() in src/lib/rbac.ts. */
  const maySetup = Boolean(setup) && (await canEditRoboSetup());
  const entries = [...(setup?.entries ?? [])].sort(
    (a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name)
  );
  const totalDelay = record.delayLogs.reduce((s, d) => s + d.durationMinutes, 0);

  /* What the plant says about this slab number (read only; null when the number
     is not a plain number, the plant has no row, or it cannot be read). */
  const plantNo = plainSlabNo(record.slabNumber);
  const plantRead = plantNo === null ? null : await readSlabPlantJourney(plantNo);
  const journey = plantRead?.state === "ok" ? journeyView(plantRead.row) : null;
  /* Why the plant says nothing, in words: a number that is not a plain one was never asked about;
     a failed read is not "no record". No plant tables at all: the card is not shown. */
  const plantNote = plantNo === null
    ? `Slab ${record.slabNumber} is not a plain slab number, so the plant cannot be asked about it.`
    : plantRead?.state === "failed"
      ? "Could not read the plant just now."
      : `The plant has no record of slab ${record.slabNumber}.`;

  return (
    <Shell>
      <div className="max-w-4xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/robo/slabs" className="text-sm text-gray-400 hover:text-gray-600">← Slabs Records</Link>
              <span className="text-gray-300">/</span>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slab {record.slabNumber}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${slabStatusClass(record.status)}`}>
                {slabStatusLabel(record.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Complete details for this slab</p>
          </div>
          {/* Corrections start here, from the record itself — the same routes
              the Slabs Records table offers, so whichever screen someone
              noticed the mistake on leads to the same form.

              Two buttons because two different rows can be wrong. "Edit slab"
              is this record: its numbers, times and delays. "Edit setup" is the
              run underneath it — the design, thickness and machines in section
              2 above — which is one row shared by the whole batch. Reading a
              wrong design here and being offered only "Edit slab" is what sent
              people to the entry screen to start a duplicate setup. */}
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/robo/slabs/${id}/edit`}
              className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
              Edit slab
            </Link>
            {maySetup && (
              <Link href={`/robo/slabs/${id}/edit?section=setup`}
                className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                Edit setup
              </Link>
            )}
          </div>
        </div>

        {/* ── 1. Batch Information ──
            Was "Shift Information", and listed Shift Number, Start Time and
            Operator Name. Nobody enters any of those: the RoboShift row is
            plumbing the schema requires, created silently once a day by the
            entry form, so its number was always 1/2/3 off the wall clock, its
            start time was whenever the tablet was first opened and its operator
            name was blank. Three values that looked like records of something
            and were records of nothing.

            What the operator DOES write at the top of the batch setup is the
            production date and the batch number, and those are what this
            section shows now. The Production Date in particular used to read
            off the shift as well, which is why it said today on a slab from
            last Thursday — see productionDate.ts.

            Shift is back, and it is NOT the old one: it is the A/B/C the
            operator now picks on the slab itself, stored on the slab. For a
            slab entered before that field existed it is read off the slab's own
            In Time rather than left blank — productionShift.ts. */}
        <SectionCard title="1. Batch Information">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Field label="Production Date" value={dash(productionDateOf(record))} />
            <Field label="Shift" value={dash(shiftOptionLabel(productionShiftOf(record)))} />
            {/* CR-003: "D-1506 (Trial Slab)" for a trial slab. */}
            <Field label="Batch No." value={setup?.isTrial ? batchLabel(setup.batchNo, true) : dash(setup?.batchNo)} />
          </div>
        </SectionCard>

        {/* ── 2. Production Information ── */}
        <SectionCard title="2. Production Information" subtitle={setup ? undefined : "No production setup was linked to this slab"}>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Production Info</h3>
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                <Field label="Design Name" value={dash(setup?.designName)} />
                {/* The slab's own thickness when it carries one (a batch that
                    changed thickness mid-run), else the setup's — roboThicknessOf. */}
                <Field label="Slab Thickness (cm)" value={dash(roboThicknessOf(record))} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Machine Configuration</h3>
              {entries.length === 0 ? (
                <p className="text-sm text-gray-400">-</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {entries.map(e => {
                    const isRoymix = e.machine.name === "Roymix";
                    const isRoycut3 = e.machine.name === "Roycut-3";
                    // CR-003: a trial setup also states each consumable's setting.
                    const trial = Boolean(setup?.isTrial);
                    const liquidSetting = trial ? [{ label: "Liquid Setting", value: settingLabel(e.liquidSetting) }] : [];
                    const powderSetting = trial ? [{ label: "Powder Setting", value: settingLabel(e.powderSetting) }] : [];
                    const photos = trial
                      ? (setup?.referencePhotos ?? []).filter((p) => p.machineId === e.machineId)
                          .sort((a, b) => String(a.kind).localeCompare(String(b.kind)))
                      : [];
                    const fields = isRoymix
                      ? [
                          { label: "Program Name", value: dash(e.programName) },
                          ...liquidSetting,
                          { label: "Liquid Name", value: dash(e.liquidName) },
                          { label: "Body Weight (kg)", value: record.roymixBodyWeight != null ? String(record.roymixBodyWeight) : "-" },
                          { label: "Cycle Time (sec)", value: record.roymixCycleTime != null ? String(record.roymixCycleTime) : "-" },
                        ]
                      : [
                          { label: "Program Name", value: dash(e.programName) },
                          { label: "Tool Name", value: dash(e.toolName) },
                          { label: "Target Cycle Time (sec)", value: e.targetCycleTime != null ? String(e.targetCycleTime) : "-" },
                          ...liquidSetting,
                          { label: "Liquid Name", value: dash(e.liquidName) },
                          ...powderSetting,
                          { label: "Powder Name", value: dash(e.powderName) },
                          ...(isRoycut3 ? [] : [{ label: "Roller Height (mm)", value: dash(e.rollerHeight) }]),
                        ];
                    return (
                      <div key={e.id} className="rounded-lg border border-gray-100 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <span className={`h-5 w-2 rounded-full ${MACHINE_COLORS[e.machine.name] || "bg-gray-400"}`} />
                          <p className="font-semibold text-gray-800">{machineLabel(e.machine.name)}</p>
                        </div>
                        {fields.map(f => <Field key={f.label} label={f.label} value={f.value} />)}
                        {/* CR-003: the reference photos (Define), original and edited. */}
                        {photos.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {photos.map((p) => (
                              <div key={p.id} className="rounded-lg border border-gray-100 p-2">
                                <p className="mb-1 text-xs font-medium text-gray-500">{p.kind === "POWDER" ? "Powder" : "Liquid"} reference</p>
                                <a href={`/api/robo/trial/photos/${p.id}?v=edited`} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={`/api/robo/trial/photos/${p.id}?v=edited`} alt={`${machineLabel(e.machine.name)} ${p.kind === "POWDER" ? "powder" : "liquid"} reference`}
                                    className="h-28 w-full rounded border border-gray-200 bg-gray-50 object-contain" />
                                </a>
                                <p className="mt-1 flex gap-3 text-xs">
                                  <a href={`/api/robo/trial/photos/${p.id}?v=original`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Original</a>
                                  {p.editedType && <a href={`/api/robo/trial/photos/${p.id}?v=edited`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Edited</a>}
                                </p>
                                {p.notes && <p className="mt-1 text-xs text-gray-500">{p.notes}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Slab Information ── */}
        <SectionCard title="3. Slab Information">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Field label="S.No." value={dash(seqNo)} />
            <Field label="Slab Number" value={dash(record.slabNumber)} />
            <Field label="In Time" value={dash(record.inTime)} />
            <Field label="Out Time" value={dash(record.outTime)} />
          </div>
        </SectionCard>

        {/* ── From the plant ──
            The slab's own trip through the plant, read from the plant's tables
            (slabPlantJourney.ts). No link to Slab Lookup (/slab) is offered:
            the ERP has no single page-access helper to ask whether this viewer
            may open it (the rule is spread through middleware and routeCaps,
            and the Robo logins that reach this page are refused /slab). */}
        {plantRead?.state !== "off" && <SectionCard title="From the plant">
          {journey ? (
            <div className="space-y-3">
              {journey.abortedText && (
                <p className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{journey.abortedText}</p>
              )}
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                {journey.stations.map(l => <Field key={l.key} label={l.label} value={l.value} />)}
                {journey.facts.map(l => <Field key={l.key} label={l.label} value={l.value} />)}
              </div>
              {journey.wait && <p className="text-sm text-gray-600">{journey.wait}</p>}
              {journey.stations.length === 0 && !journey.wait && <p className="text-sm text-gray-500">The plant has no times for this slab.</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{plantNote}</p>
          )}
        </SectionCard>}

        {/* ── 4. Remark ── */}
        <SectionCard title="4. Remark" subtitle={record.delayLogs.length > 0 ? `${record.delayLogs.length} delay(s) · ${totalDelay} min total` : undefined}>
          {record.delayLogs.length === 0 && !record.remarks?.trim() ? (
            <p className="text-sm text-gray-500">-</p>
          ) : (
            <div className="space-y-3">
              {record.delayLogs.length > 0 && (
                <div className="space-y-2">
                  {record.delayLogs.map(d => (
                    <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-2">
                      <span className="w-10 text-xs font-bold text-red-700">{d.delayCode.code}</span>
                      <span className="min-w-[8rem] flex-1 text-sm text-gray-700">{d.delayCode.description}</span>
                      {d.machineName && <span className="text-xs text-gray-500">{machineLabel(d.machineName)}</span>}
                      {d.startTime && d.endTime && <span className="text-xs text-gray-400">{d.startTime}–{d.endTime}</span>}
                      <span className="text-xs font-medium text-red-600">{d.durationMinutes} min</span>
                      {d.remarks && <span className="w-full text-xs text-gray-500">{d.remarks}</span>}
                    </div>
                  ))}
                </div>
              )}
              {record.remarks?.trim() && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">Slab Remark</p>
                  {/* CR-003: a trial's longer, multi-line remark keeps its lines. */}
                  <p className={`text-sm text-gray-700 ${setup?.isTrial ? "whitespace-pre-wrap" : ""}`}>{record.remarks}</p>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </Shell>
  );
}
