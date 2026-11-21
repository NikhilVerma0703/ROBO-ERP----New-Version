"use client";
/**
 * Every Recharts-backed figure on the Robo Reports page.
 *
 * Kept in its own module so the page can pull it in with next/dynamic — the
 * charting library is by far the heaviest thing on this route, and loading it
 * after the page frame has painted is what makes Reports open immediately.
 */
import { Fragment, useEffect, useId, useState } from "react";
import {
  Tooltip, ResponsiveContainer, LabelList,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area, ReferenceLine,
} from "recharts";
import { fmtDuration, fmtDurationLong } from "@/lib/robo/utils";
import type { HourBucket } from "@/lib/robo/hourlyProduction";
import { hourlyYAxis } from "@/lib/robo/hourlyAxis";
import { shiftBlockLines, shiftBlocks, shiftOfHour, shiftSpans } from "@/lib/robo/hourlyShifts";
import { dailyRateYAxis } from "@/lib/robo/dailyRate";
import {
  DELAY_HUE, PRODUCTION_HUE, GRID, AXIS, MUTED, DATE_RULE, DATE_TEXT, SHIFT_HUES, TOOLTIP_STYLE, HOURLY_PLOT_H,
  type TrendPoint,
} from "./chart-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "21 Aug" from a yyyy-mm-dd, parsed as text so no timezone shifts the day. */
function shortDate(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]}` : "";
}

/* Layout for Production Rate per Hour. Taller than before, with a readable
   minimum WIDTH PER HOUR so a long run (e.g. a 40-hour batch) scrolls sideways
   instead of squashing every hour into a sliver. The Y-axis is pinned on the
   left while the plot scrolls under it. */
const HP_HEIGHT = HOURLY_PLOT_H; // chart height — chart-tokens, where the page's placeholder reads it too
const HP_AXIS_W = 46;    // Y-axis gutter — also the width of the pinned overlay
const HP_XAXIS_H = 74;   // bottom room for the angled time labels
const HP_SHIFT_H = 50;   // the SHIFT A / B / C band under them, name over count
const HP_TOP = 24;       // top room for the per-point value labels and date markers
const HP_HOUR_PX = 52;   // readable width per hour before horizontal scroll kicks in
/** Both X-axes carry the same padding, so the shift labels line up exactly with
 *  the hours they name. */
const HP_XPAD = { left: 44, right: 20 };

/** A Recharts axis tick, as much of it as a custom renderer needs. */
interface TickProps { x?: number; y?: number; payload?: { value?: number } }
/** A Recharts dot, likewise. */
interface DotProps { cx?: number; cy?: number; index?: number }

/**
 * What one hour of the run holds: the slabs that finished in it, and every
 * delay that ran in it — code, how long, and when — with the time the hour
 * lost.
 *
 * The hour's delays are not a summary: each line is the register's own row,
 * findable in the Delay List by its code and its times. A delay that ran
 * through this hour and on into the next is shown here CUT at the boundary,
 * with the minutes and the start–end that fell inside this hour, and again in
 * the next hour with the rest — so an hour never claims a stoppage that
 * happened after it, and never hides one that happened during it.
 *
 * TOTAL DELAYS is the time the hour lost, which is not always the lines added
 * up. The floor logs a delay against the slab it held up, so one stoppage is
 * written down once per slab waiting on it and the rows overlap; an hour has
 * only sixty minutes to lose whatever the rows say. When they do overlap the
 * box says so, so nobody is left checking an addition that cannot work.
 *
 * Wider than a default Recharts tooltip because it has to be: a code, a
 * duration and a time range on one line do not fit in the stock box, and
 * wrapping them was how "RM11 — 22 minutes [16:33–16:55]" became unreadable.
 * It is capped against the viewport so a phone cannot push it off screen.
 */
function HourDetail({ b }: { b: HourBucket }) {
  const delays = b.delays ?? [];
  return (
    <>
      <div className="text-sm font-bold text-gray-900">{b.label}</div>
      <div className="mt-0.5 text-gray-700">
        Completed: <span className="font-semibold text-gray-900">{b.slabs}</span> slab{b.slabs === 1 ? "" : "s"}
      </div>
      <div className="mt-2 border-t border-gray-100 pt-2">
        <div className="font-semibold uppercase tracking-wide text-gray-500">Delays</div>
        {delays.length === 0 ? (
          <div className="mt-1 text-gray-500">No delays</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {delays.map((d, i) => (
              <li key={`${d.code}-${d.start}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-semibold text-gray-900">{d.code}</span>
                <span className="text-gray-400">—</span>
                <span className="whitespace-nowrap text-gray-700">{fmtDurationLong(d.minutes)}</span>
                {d.start && d.end && (
                  <span className="whitespace-nowrap text-gray-500">[{d.start}–{d.end}]</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 border-t border-gray-100 pt-1.5 font-semibold text-gray-900">
          Total delays: {fmtDurationLong(b.delayMins ?? 0)}
        </div>
        {b.delaysOverlap && (
          <div className="mt-0.5 text-gray-500">
            Some of these ran at the same time — the hour lost each minute once.
          </div>
        )}
      </div>
    </>
  );
}

interface HourTooltipProps { active?: boolean; payload?: { payload?: HourBucket }[] }

/** The floating card, for a mouse. */
function HourTooltip({ active, payload }: HourTooltipProps) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  return (
    <div className="max-h-[70vh] max-w-[22rem] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
      <HourDetail b={b} />
    </div>
  );
}

/**
 * Production Rate per Hour — slabs completed in each hour of the selected
 * batch's run. One point per hour across the batch's own timeline (see
 * hourlyProduction.ts), the exact count printed above each point.
 *
 * READABILITY: every hour gets a fixed minimum width, so a long run does not
 * shrink to fit — it becomes horizontally scrollable inside the card (never the
 * page), and the Y-axis stays pinned on the left as an opaque, tick-aligned copy
 * so the scale is always readable while scrolling. The Y-axis is 0…12 by default
 * and extends in 2s only when an hour tops 12 (hourlyYAxis). When the run crosses
 * midnight the hours flow straight across the boundary (…23:00–00:00, 00:00–01:00…)
 * with no gap, and a dated marker is drawn where the day changes; the first date
 * is named in the card subtitle.
 *
 * SHIFT COLOURS: the line is one line, and its colour says which shift each
 * hour belongs to — red on A (06:00–14:00), dark blue on B (14:00–22:00), dark
 * green on C (22:00–06:00), turning exactly on the boundary. It is stroked with
 * a hard-stopped gradient rather than split into three series, so the trend
 * stays a single unbroken curve; see lib/robo/hourlyShifts.ts for the offsets
 * and why. A band under the time labels names each stretch in its own colour,
 * repeating as the run carries on through the next day's shifts, so the chart
 * is as readable in black and white as in colour.
 *
 * SLABS PER SHIFT: under each name the band prints what that shift produced —
 * SHIFT B / 39 SLABS — each slab under its own Shift (the operator's pick, else
 * its In Time's), as the Shift column of Download Slab Records counts it. The
 * line counts a slab in the hour it came OUT, so over a boundary hour the two
 * can differ by the slabs that straddled it; over the run they add up to the
 * same total, and no slab is counted twice or missed.
 */
export function HourlyProductionLine({ data }: { data: HourBucket[] }) {
  const { max: yMax, ticks } = hourlyYAxis(data.reduce((m, b) => Math.max(m, b.slabs), 0));
  // The X-axis is keyed by position, not by the hour label: past 24 buckets a
  // label repeats ("06:00–07:00" on both days), and Recharts then swaps the
  // category domain for indices — the midnight ReferenceLine positioned by
  // label silently vanished, and two midnights gave duplicate React keys.
  const points = data.map((b, i) => ({ ...b, x: i }));
  const hourLabel = (x: number) => data[x]?.label ?? "";
  const boundaries = points.filter((b, i) => i > 0 && b.date && b.date !== data[i - 1].date);
  const plotWidth = data.length * HP_HOUR_PX;

  // The shift of each hour, and from it: the gradient that colours the line,
  // and the labels under the axis. Both come from the one function, so a
  // colour and the name beneath it can never disagree.
  //
  // The band's counts come with the buckets (hourlyProduction's shiftSlabs):
  // the same slabs as the points above, each under its own Shift rather than
  // the hour it came out, so SHIFT A's figure is the export's Shift A count.
  const hours = data.map((b) => b.hour);
  const spans = shiftSpans(hours);
  const hueAt = (i: number) => SHIFT_HUES[shiftOfHour(hours[i] ?? 0)];
  const shiftLabels = new Map(
    shiftBlocks(hours, data.map((b) => b.shiftSlabs)).map((b) => [b.mid, { code: b.code, lines: shiftBlockLines(b) }]),
  );
  // One <defs> id per mounted chart — two charts on a page must not share a
  // gradient, and a bare "#id" would be the same for both.
  const gradientId = `robo-shift-line-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /* A touch screen has no hover, and a card that floats beside the finger is
     the wrong answer for one: the plot is wider than a phone and scrolls, so
     Recharts — which keeps the card inside the CHART, not inside the screen —
     puts it off the right edge for any hour in the right half of the view.
     Tapping instead opens the same reading in a panel UNDER the chart, where
     it is always whole and nothing has to be scrolled to read it.
     Read after mount: the server has no pointer to ask. */
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [tapped, setTapped] = useState<number | null>(null);
  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);
  const tappedHour = coarsePointer && tapped !== null ? data[tapped] : undefined;

  /** SHIFT A / SHIFT B / SHIFT C and the slabs it produced, centred under the
   *  hours it covers. Drawn as a second X-axis so it sits in the chart's own
   *  coordinate space and stays aligned with the hours at any width, scrolled
   *  or not.
   *
   *  The name wears the shift's colour, tying it to the stretch of line above
   *  it; the count is a reading, so it wears ink — the same dark neutral as the
   *  date markers. A figure is easier to read in it, and the colour is already
   *  saying everything it has to say. */
  const shiftTick = ({ x = 0, y = 0, payload }: TickProps) => {
    const hit = shiftLabels.get(Number(payload?.value));
    if (!hit) return <g />;
    return (
      <g>
        <text x={x} y={y + 18} textAnchor="middle" fill={SHIFT_HUES[hit.code]}
          style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.08em" }}>{hit.lines[0]}</text>
        <text x={x} y={y + 35} textAnchor="middle" fill={DATE_TEXT}
          style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>{hit.lines[1]}</text>
      </g>
    );
  };

  return (
    <div>
      {/* The axis titles sit outside the plot, in plain HTML: the Y title above
          the scale rather than turned on its side, and the X title centred on
          the CARD rather than the plot, so neither moves or is clipped when a
          long run scrolls sideways under the pinned axis. They live outside the
          positioned wrapper below, so the pinned axis still starts at the top
          of the plot and not of the title. */}
      <div className="mb-1 pl-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Number of Slabs</div>
      <div className="relative">
      {/* The plot. Scrolls horizontally when the run is wider than the card;
          minWidth gives each hour a readable slice, and when the hours are few
          it simply fills the card. The scroll lives here, so the page never
          overflows sideways. */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: plotWidth }}>
          <ResponsiveContainer width="100%" height={HP_HEIGHT}>
            <LineChart data={points} margin={{ top: HP_TOP, right: 24, left: 0, bottom: 0 }}
              onClick={(s: { activeTooltipIndex?: number }) =>
                setTapped(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)}>
              {/* The line's colour, hour by hour. Two stops share each boundary
                  offset, so the colour changes at a point instead of fading
                  across it. Offsets are fractions of the path's own box, which
                  runs from the first point to the last — no margin, axis width
                  or padding enters into it. */}
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  {spans.map((s) => (
                    <Fragment key={`${s.code}-${s.from}`}>
                      <stop offset={s.from} stopColor={SHIFT_HUES[s.code]} />
                      <stop offset={s.to} stopColor={SHIFT_HUES[s.code]} />
                    </Fragment>
                  ))}
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              {/* Left padding keeps the first angled label clear of the pinned
                  Y-axis gutter so its leading digits ("18:00…") are not clipped. */}
              <XAxis dataKey="x" tickFormatter={hourLabel} height={HP_XAXIS_H} interval={0} angle={-45} textAnchor="end"
                padding={HP_XPAD}
                tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} />
              {/* The shift band. Same dataKey and padding as the axis above, so
                  each name sits under the hours it covers. */}
              <XAxis xAxisId="shift" dataKey="x" height={HP_SHIFT_H} interval={0} padding={HP_XPAD}
                tick={shiftTick} axisLine={false} tickLine={false} />
              <YAxis width={HP_AXIS_W} domain={[0, yMax]} ticks={ticks} allowDecimals={false}
                tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
              {/* On a mouse the card follows the pointer; on a tablet or phone
                  there is no hover, so a TAP opens it and the next tap moves
                  it. Recharts' own touch handling only tracks a drag across
                  the plot, which is not how anyone reads one hour. */}
              {/* The floating card is for a mouse. On touch the Tooltip is kept
                  (it draws the cursor line and the raised dot on the tapped
                  hour) but renders nothing — the panel below the chart does. */}
              <Tooltip content={coarsePointer ? () => null : <HourTooltip />}
                trigger={coarsePointer ? "click" : "hover"}
                cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
                wrapperStyle={{ pointerEvents: "none", zIndex: 10 }} />
              {/* Date markers at each midnight the run crossed — drawn behind the line. */}
              {boundaries.map((b) => (
                <ReferenceLine key={b.x} x={b.x} stroke={DATE_RULE} strokeWidth={2} strokeDasharray="7 4"
                  label={{ value: shortDate(b.date), position: "top", fontSize: 12, fontWeight: 700, fill: DATE_TEXT }} />
              ))}
              <Line type="monotone" dataKey="slabs" stroke={`url(#${gradientId})`} strokeWidth={2.5}
                dot={({ cx, cy, index }: DotProps) => (
                  <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={hueAt(index ?? 0)} />
                )}
                activeDot={({ cx, cy, index }: DotProps) => (
                  <circle key={`active-${index}`} cx={cx} cy={cy} r={6} fill={hueAt(index ?? 0)}
                    stroke="#fff" strokeWidth={2} />
                )}
                name="Slabs">
                <LabelList dataKey="slabs" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "#555" }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pinned Y-axis: an opaque, clipped copy of the same axis — identical
          margins and domain, so its ticks line up exactly with the plot's
          gridlines — held over the left edge so the scale stays readable while
          the plot scrolls under it. Its white cover stops ABOVE the x-axis label
          band (height − the two bottom axes): covering that band too was painting
          over the first time label's leading digits ("18:00…" showing as ":00…"),
          and it must clear the shift band for the same reason. The copy carries
          both bottom axes at their real heights, or the plot area would be
          taller here than there and the ticks would not line up. */}
      <div className="pointer-events-none absolute left-0 top-0 overflow-hidden bg-white"
        style={{ width: HP_AXIS_W, height: HP_HEIGHT - HP_XAXIS_H - HP_SHIFT_H }}>
        <div style={{ width: 200, height: HP_HEIGHT }}>
          <ResponsiveContainer width="100%" height={HP_HEIGHT}>
            <LineChart data={points} margin={{ top: HP_TOP, right: 24, left: 0, bottom: 0 }}>
              <XAxis dataKey="x" height={HP_XAXIS_H} tick={false} axisLine={false} tickLine={false} />
              <XAxis xAxisId="shift" dataKey="x" height={HP_SHIFT_H} tick={false} axisLine={false} tickLine={false} />
              <YAxis width={HP_AXIS_W} domain={[0, yMax]} ticks={ticks} allowDecimals={false}
                tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>

      {/* Clear of the band's count line, which is set in the same dark ink: at
          the old single line of margin the two read as one block of text. */}
      <div className="mt-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
        Time Duration (in Hours)
      </div>

      {/* Touch only: the tapped hour, in full, under the chart. */}
      {tappedHour && (
        <div className="relative mt-3 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-sm">
          <button type="button" onClick={() => setTapped(null)} aria-label="Close"
            className="absolute right-1 top-1 rounded px-2 py-1 text-sm text-gray-400">✕</button>
          <HourDetail b={tappedHour} />
        </div>
      )}
      {coarsePointer && !tappedHour && (
        <p className="mt-2 text-center text-xs text-gray-400">Tap an hour for its slabs and delays.</p>
      )}
    </div>
  );
}

// The Machine Performance and Delay Analysis pies were removed: Machine
// Performance is gone from the page, and Delay Analysis is now the all-types
// horizontal bar chart in DelayAnalysis.tsx (plain CSS). Only the Trend
// Analysis figures below still use Recharts.

export function DelayByDayBar({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(11,11,11,0.04)" }}
          formatter={(v: number) => [fmtDurationLong(v), "Delay"]} />
        <Bar dataKey="delayMins" fill={DELAY_HUE} radius={[4, 4, 0, 0]} maxBarSize={38} name="Delay" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Daily Slabs / Hour Trend — each date's slabs ÷ the hours the Robo line ran
 * that date (lib/robo/dailyRate.ts). The Y-axis is the owner's 0, 2, 4, 6, 8,
 * 10, extended in 2s only when a date really tops 10; the tooltip names the
 * slabs and the running time behind each value, so any point can be checked.
 */
export function SlabsPerHourLine({ data }: { data: TrendPoint[] }) {
  const { max: yMax, ticks } = dailyRateYAxis(data.reduce((m, p) => Math.max(m, p.slabsPerHour), 0));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis domain={[0, yMax]} ticks={ticks} allowDecimals={false}
          tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, _n: unknown, item: { payload?: TrendPoint }) => {
            const p = item?.payload;
            return [p && p.lineMinutes > 0 ? `${v} slabs/hr (${p.slabs} slabs in ${fmtDuration(p.lineMinutes)})` : `${v} slabs/hr`, "Rate"];
          }} />
        <Line type="monotone" dataKey="slabsPerHour" stroke={PRODUCTION_HUE} strokeWidth={2}
          dot={{ r: 4, strokeWidth: 0, fill: PRODUCTION_HUE }} activeDot={{ r: 5 }} name="Slabs / Hour" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DailyProductionArea({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="slabFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRODUCTION_HUE} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PRODUCTION_HUE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: AXIS }} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} slabs`, "Produced"]} />
        <Area type="monotone" dataKey="slabs" stroke={PRODUCTION_HUE} strokeWidth={2} fill="url(#slabFill)" name="Slabs" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
