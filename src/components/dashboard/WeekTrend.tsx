"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlanUsage } from "@/lib/plans";
import { DAY, WEEK_DAYS, weeklySeries, weeklyValueAt, recordedLinePath, sampleMarkers, recordedDomain, recordedValueAt, inspectSampleTime } from "@/lib/plans/week-trend";
import { formatClockTime } from "@/lib/format";

const SERIES = {
  claude: { label: "Claude Max", color: "var(--provider-anthropic)" },
  codex: { label: "ChatGPT Codex", color: "var(--provider-openai)" },
  grok: { label: "Grok", color: "var(--provider-xai)" },
  grokbot: { label: "Grok Bot", color: "var(--accent-blue)" },
};
const HEIGHT = 270;
const M = { top: 20, right: 44, bottom: 32, left: 40 };
const dayTime = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function WeekTrend({ plans, now }: { plans: PlanUsage[]; now: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [view, setView] = useState<"history" | "week">("history");
  const [showAverage, setShowAverage] = useState(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nowSec = now / 1000;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (day: number) => M.left + (day / WEEK_DAYS) * plotW;
  const y = (pct: number) => M.top + (1 - Math.min(100, pct) / 100) * plotH;
  const rawSeries = useMemo(() => weeklySeries(plans, nowSec), [plans, nowSec]);
  const sampleTimes = useMemo(() => [...new Set(rawSeries.flatMap((s) => s.points.map((p) => p.at)))].sort((a, b) => a - b), [rawSeries]);
  const domain = useMemo(() => recordedDomain(rawSeries, nowSec), [rawSeries, nowSec]);
  const position = (start: number, at: number) => view === "history"
    ? WEEK_DAYS * (at - domain.from) / (domain.to - domain.from) : (at - start) / DAY;
  const series = useMemo(() => rawSeries.map((s) => ({
    ...s, ...SERIES[s.id], markers: sampleMarkers(s.points),
    path: recordedLinePath(s.points,
      (at) => M.left + (view === "history" ? (at - domain.from) / (domain.to - domain.from) : (at - s.start) / DAY / WEEK_DAYS) * plotW,
      (used) => M.top + (1 - used / 100) * plotH),
  })), [rawSeries, view, domain, plotW, plotH]);
  const summary = series.length ? series.map((s) => `${s.label}: ${Math.round(s.latest.used)}%, ${s.points.length} saved readings, latest ${dayTime.format(new Date(s.latest.at * 1000))}`).join(". ") : "No weekly readings yet.";
  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);

  return (
    <article className="week-trend">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h3 className="font-medium leading-tight">This week</h3>
          <p className="text-xs mt-1 text-muted">{view === "history" ? "Recorded history · local calendar time" : "Full week · days since each plan’s own reset"}</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Plans">
          {series.map((s) => <li key={s.id} className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden><line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" /></svg>
            {s.label}
          </li>)}
        </ul>
      </header>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted">
        <div className="flex rounded-lg border border-card-border p-1" role="group" aria-label="Chart view">
          {(["history", "week"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v}
            onClick={() => { setView(v); setHoverPosition(null); }}
            className={`rounded-md px-3 py-1.5 ${view === v ? "bg-foreground/10 text-foreground font-medium" : "hover:bg-foreground/5"}`}>
            {v === "history" ? "Recorded history" : "Full week"}
          </button>)}
        </div>
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={showAverage} onChange={(e) => setShowAverage(e.target.checked)} className="accent-foreground" />Show average pace</label>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Line styles">
          <li className="flex items-center gap-1.5"><svg width="20" height="10" aria-hidden><path d="M1 8L10 2H19" fill="none" stroke="currentColor" strokeWidth="2" /></svg>Recorded samples</li>
          <li className="flex items-center gap-1.5"><svg width="20" height="10" aria-hidden><line x1="1" y1="5" x2="19" y2="5" stroke="currentColor" strokeDasharray="6 4" /></svg>Average pace</li>
          {view === "week" && <li className="flex items-center gap-1.5"><svg width="20" height="10" aria-hidden><line x1="1" y1="5" x2="19" y2="5" stroke="currentColor" strokeDasharray="2 4" /></svg>Forecast</li>}
          {view === "week" && <li className="flex items-center gap-1.5"><svg width="20" height="10" aria-hidden><line x1="1" y1="5" x2="19" y2="5" stroke="var(--spark)" /></svg>Even pace</li>}
        </ul>

      </div>

      <div ref={box} className="relative" style={{ height: HEIGHT }}>
        {width > 0 && <svg width={width} height={HEIGHT} role="img" tabIndex={0}
          aria-label={`${view === "history" ? "Recorded quota history on a calendar time axis" : "Weekly quota usage since each reset"}. Solid lines connect saved samples; dashed lines show average pace. Full week includes dotted forecasts. ${summary}. Use left and right arrows to inspect.`}
          className="block overflow-visible rounded focus-visible:outline-2 focus-visible:outline-offset-2"
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const day = ((e.clientX - rect.left - M.left) / plotW) * WEEK_DAYS;
            if (day < 0 || day > WEEK_DAYS) return setHoverPosition(null);
            const at = domain.from + day / 7 * (domain.to - domain.from);
            const snapped = inspectSampleTime(sampleTimes, at, "nearest", 6 / plotW * (domain.to - domain.from));
            setHoverPosition(view === "history" && snapped !== null ? position(0, snapped) : day);
          }} onPointerLeave={() => setHoverPosition(null)} onBlur={() => setHoverPosition(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setHoverPosition(null);
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setHoverPosition((d) => {
                if (view === "week") return Math.max(0, Math.min(7, (d ?? 0) + (e.key === "ArrowRight" ? 0.125 : -0.125)));
                const at = d === null ? null : domain.from + d / 7 * (domain.to - domain.from);
                const next = inspectSampleTime(sampleTimes, at, e.key === "ArrowRight" ? "next" : "previous");
                return next === null ? null : position(0, next);
              });
            }
          }}>
          {[0, 25, 50, 75, 100].map((pct) => <g key={pct}>
            <line x1={M.left} x2={M.left + plotW} y1={y(pct)} y2={y(pct)} stroke="var(--card-border)" />
            <text x={M.left - 8} y={y(pct) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">{pct}%</text>
          </g>)}
          {view === "history" ? Array.from({ length: width < 400 ? 2 : width < 500 ? 3 : 5 }, (_, i) => {
            const count = width < 400 ? 2 : width < 500 ? 3 : 5;
            const fraction = i / (count - 1);
            const at = domain.from + fraction * (domain.to - domain.from);
            return <text key={i} x={x(fraction * 7)} y={HEIGHT - 6} textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
              {dayTime.format(new Date(at * 1000))}
            </text>;
          }) : Array.from({ length: WEEK_DAYS }, (_, d) => <text key={d} x={x(d + 0.5)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[11px]">{width < 400 ? d + 1 : `Day ${d + 1}`}</text>)}
          {view === "week" && <line x1={x(0)} y1={y(0)} x2={x(7)} y2={y(100)} stroke="var(--spark)" strokeWidth={1.25} />}

          {/* Draw statistical lines first so recorded observations stay in front. */}
          {series.map((s) => {
            const averageStart = view === "history" ? s.points[0].at : s.start;
            const averageUsed = s.projected === null ? 0 : s.projected * (averageStart - s.start) / (7 * DAY);
            return <g key={s.id}>
            {showAverage && s.projected !== null && <line data-line="average" x1={x(position(s.start, averageStart))} y1={y(averageUsed)} x2={x(position(s.start, s.latest.at))} y2={y(s.latest.used)} stroke={s.color} strokeOpacity={0.45} strokeWidth={1.25} strokeDasharray="6 4" />}
            {view === "week" && s.forecastEnd && <g>
              <line data-line="forecast" x1={x(position(s.start, s.latest.at))} y1={y(s.latest.used)} x2={x(position(s.start, s.forecastEnd.at))} y2={y(s.forecastEnd.used)} stroke={s.color} strokeOpacity={0.65} strokeWidth={1.5} strokeDasharray="2 4" />
              <text x={x(position(s.start, s.forecastEnd.at)) + 6} y={y(s.forecastEnd.used) + 4} className="fill-muted text-[11px] tabular-nums">{Math.round(s.forecastEnd.used)}%</text>
            </g>}
          </g>; })}
          {series.map((s, i) => {
            const day = position(s.start, s.latest.at);
            const crowded = series.some((o, j) => j !== i && Math.abs(x(day) - x(position(o.start, o.latest.at))) < 35 && Math.abs(y(s.latest.used) - y(o.latest.used)) < 22 && j < i);
            return <g key={s.id}>
              <path data-line="recorded" data-provider={s.id} d={s.path} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />
              {s.markers.map((p) => <circle key={p.at} cx={x(position(s.start, p.at))} cy={y(p.used)} r={2} fill={s.color}><title>{`${s.label}: ${p.used}% recorded ${dayTime.format(new Date(p.at * 1000))}`}</title></circle>)}
              <circle cx={x(day)} cy={y(s.latest.used)} r={5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              <text x={x(day)} y={y(s.latest.used) + (crowded ? 18 : -11)} textAnchor="middle" className="fill-foreground text-[12px] font-semibold tabular-nums">{Math.round(s.latest.used)}%</text>
            </g>;
          })}
          {hoverPosition !== null && <line x1={x(hoverPosition)} x2={x(hoverPosition)} y1={M.top} y2={M.top + plotH} stroke="var(--muted)" />}
        </svg>}

        {hoverPosition !== null && series.length > 0 && <div role="tooltip" aria-live="polite"
          className="pointer-events-none absolute z-10 rounded-lg border border-card-border bg-background px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.max(0, Math.min(x(hoverPosition) + 10, width - 285)), maxWidth: Math.min(285, width), top: M.top }}>
          <p className="font-medium">{view === "history" ? dayTime.format(new Date((domain.from + hoverPosition / 7 * (domain.to - domain.from)) * 1000)) : `Day ${Math.min(7, Math.floor(hoverPosition) + 1)} of 7`}</p>
          {series.map((s) => {
            const v = view === "history" ? recordedValueAt(s, domain.from + hoverPosition / 7 * (domain.to - domain.from)) : weeklyValueAt(s, s.start + hoverPosition * DAY);
            return <p key={s.id} className="mt-1 text-muted"><span style={{ color: s.color }}>●</span> <span className="font-medium text-foreground">{s.label}: {v ? `${Math.round(v.used)}%` : "—"}</span><br />
              <span className="ml-3">{v ? `${v.kind === "forecast" ? "Forecast" : "Recorded"} · ${dayTime.format(new Date(v.at * 1000))}` : "No saved reading"}</span></p>;
          })}
        </div>}
      </div>
      <p className="mt-2 text-xs text-muted">{totalPoints ? `${totalPoints.toLocaleString()} saved readings. ` : "Waiting for saved readings. "}History begins at the first saved sample; earlier usage is unknown. Lines connect saved samples: rising usage slopes up; unchanged usage stays flat. Exact change times between samples are unknown. {view === "history" ? "Full week shows the average-pace forecast." : "Average pace uses total usage since reset at the latest reading."}</p>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer w-fit">Reading coverage and forecast</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <caption className="sr-only">Weekly quota history coverage and average forecast</caption>
            <thead><tr>{["Plan", "Saved readings", "History begins", "Latest reading", "Used", "Forecast at reset", "Resets"].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>{series.map((s) => <tr key={s.id}>
              <th scope="row" className="py-2 pr-4 font-medium text-foreground">{s.label}</th>
              <td className="pr-4">{s.points.length}</td><td className="pr-4">{dayTime.format(new Date(s.points[0].at * 1000))}</td>
              <td className="pr-4">{dayTime.format(new Date(s.latest.at * 1000))}</td><td className="pr-4">{Number(s.latest.used.toFixed(1))}%</td>
              <td className="pr-4">{s.projected === null ? "Too early to tell" : s.projected > 100 ? `100% by ${dayTime.format(new Date(s.forecastEnd!.at * 1000))}` : `About ${Math.round(s.projected)}%`}</td>
              <td>{formatClockTime(s.resetsAt, nowSec)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
