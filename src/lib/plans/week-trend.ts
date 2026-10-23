import { applyReset, type PlanUsage, type TrendPoint } from "./parse.ts";

export const DAY = 86400;
export const WEEK_DAYS = 7;

export type WeeklySeries = {
  id: PlanUsage["id"];
  start: number;
  resetsAt: number;
  points: TrendPoint[];
  latest: TrendPoint;
  projected: number | null;
  forecastEnd: TrendPoint | null;
};

// The average is cumulative usage / time since reset at the latest recorded
// reading. Never move that reading forward merely because the browser clock ticks.
export function weeklySeries(plans: PlanUsage[], nowSec: number): WeeklySeries[] {
  return plans.flatMap((plan) => {
    const raw = plan.windows.find((w) => w.windowMinutes === WEEK_DAYS * 1440);
    if (plan.status !== "ok" || !raw) return [];
    const w = applyReset(raw, nowSec);
    if (w.reset || w.resetsAt === null || w.usedPercent === null || !Number.isFinite(w.resetsAt)) return [];
    const start = w.resetsAt - WEEK_DAYS * DAY;
    const points = (w.trend ?? []).filter((p) => Number.isFinite(p.at) && Number.isFinite(p.used) &&
      p.at >= start && p.at < w.resetsAt! && p.at <= nowSec && p.used >= 0 && p.used <= 100)
      .sort((a, b) => a.at - b.at);
    const latest = points.at(-1);
    if (!latest) return [];
    const elapsed = (latest.at - start) / (WEEK_DAYS * DAY);
    const projected = elapsed >= 0.1 && elapsed < 1 ? latest.used / elapsed : null;
    const forecastEnd = projected === null ? null : {
      at: projected > 100 ? start + WEEK_DAYS * DAY * 100 / projected : w.resetsAt,
      used: Math.min(100, projected),
    };
    return [{ id: plan.id, start, resetsAt: w.resetsAt, points, latest, projected, forecastEnd }];
  });
}

export type WeeklyValue = { used: number; kind: "recorded" | "forecast"; at: number };

export function weeklyValueAt(s: WeeklySeries, at: number): WeeklyValue | null {
  if (at < s.points[0].at || at > s.resetsAt) return null;
  if (at <= s.latest.at) {
    const p = s.points.findLast((p) => p.at <= at)!;
    return { ...p, kind: "recorded" };
  }
  if (s.projected === null) return null;
  return { at, used: Math.min(100, s.projected * (at - s.start) / (WEEK_DAYS * DAY)), kind: "forecast" };
}

// Connect actual samples with straight segments. Their slope describes the
// average change between observations, not the precise time of each request.
export function recordedLinePath(points: TrendPoint[], x: (at: number) => number, y: (used: number) => number): string {
  return points.map((p, i) => i === 0 ? `M${x(p.at)},${y(p.used)}` : `L${x(p.at)},${y(p.used)}`).join(" ");
}

// Bound SVG marker nodes on dense histories. The path still contains every sample.
export function sampleMarkers(points: TrendPoint[], limit = 120): TrendPoint[] {
  if (points.length <= limit) return points;
  const stride = Math.ceil((points.length - 1) / (limit - 1));
  return points.filter((_, i) => i % stride === 0 || i === points.length - 1);
}

// A shared calendar axis makes short collected histories visible even when the
// plans have different reset dates. Padding also keeps a lone sample visible.
export function recordedDomain(series: WeeklySeries[], nowSec: number): { from: number; to: number } {
  if (!series.length) return { from: nowSec - 60, to: nowSec + 60 };
  const first = Math.min(...series.map((s) => s.points[0].at));
  const last = Math.max(...series.map((s) => s.latest.at));
  const padding = Math.max(30, (last - first) * 0.04);
  return { from: first - padding, to: last + padding };
}

// Tooltips report a saved value with its original timestamp. They never label an
// interpolated point on the connecting segment as an actual observation.
export function recordedValueAt(s: WeeklySeries, at: number): WeeklyValue | null {
  // Axis conversion may round an exact sample time by a fraction of a microsecond.
  const epsilon = 1e-6;
  if (at < s.points[0].at - epsilon || at > s.latest.at + epsilon) return null;
  const p = s.points.findLast((p) => p.at <= at + epsilon)!;
  return { ...p, kind: "recorded" };
}

// Keyboard inspection advances through actual sample timestamps, including a
// lone or final sample. Pointer inspection snaps only inside a small hit area.
export function inspectSampleTime(times: number[], at: number | null, direction: "previous" | "next" | "nearest", tolerance = 0): number | null {
  if (!times.length) return null;
  if (at === null) return direction === "previous" ? times.at(-1)! : times[0];
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < at - 1e-6) lo = mid + 1; else hi = mid;
  }
  if (direction === "previous") return times[Math.max(0, lo - 1)];
  if (direction === "next") return times[Math.min(times.length - 1, lo + (Math.abs((times[lo] ?? Infinity) - at) < 1e-6 ? 1 : 0))];
  const before = times[Math.max(0, lo - 1)], after = times[Math.min(times.length - 1, lo)];
  const nearest = Math.abs(before - at) < Math.abs(after - at) ? before : after;
  return Math.abs(nearest - at) <= tolerance ? nearest : at;
}
