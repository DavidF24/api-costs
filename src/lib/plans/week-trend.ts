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

// A step reaches a new reported percentage at its sample time. No assumed zero,
// no smoothed curve, and no extension after the last saved reading.
export function recordedStepPath(points: TrendPoint[], x: (at: number) => number, y: (used: number) => number): string {
  return points.map((p, i) => i === 0 ? `M${x(p.at)},${y(p.used)}` : `H${x(p.at)}V${y(p.used)}`).join(" ");
}
