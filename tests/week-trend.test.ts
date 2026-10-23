import test from "node:test";
import assert from "node:assert/strict";
import { windowTrend, type PlanUsage, type TrendPoint } from "../src/lib/plans/parse.ts";
import { DAY, weeklySeries, weeklyValueAt, recordedLinePath, sampleMarkers, recordedDomain, recordedValueAt, inspectSampleTime } from "../src/lib/plans/week-trend.ts";

const start = 1_000_000;
const end = start + 7 * DAY;
function plan(points: TrendPoint[], id: PlanUsage["id"] = "grok"): PlanUsage {
  return { id, name: id, status: "ok", updatedAt: null, windows: [{
    key: "weekly", label: "Weekly", windowMinutes: 10080, resetsAt: end,
    usedPercent: points.at(-1)?.used ?? 0, updatedAt: null, reset: false, trend: points,
  }] };
}

test("recorded history has no assumed origin and keeps plateaus, jumps and corrections", () => {
  const row = (day: number, used: number, extra = {}) => JSON.stringify({ at: start + day * DAY, used, minutes: 10080, resets_at: end, provider: "grok", ...extra });
  const text = [row(1, 15), row(2, 15), row(3, 40), row(4, 38), row(4, 38), row(5, 50, { resets_at: end + 1 }),
    row(0, -1), row(0, 101), row(8, 60), row(3, 5, { provider: "codex" }), "null", "{bad"].join("\n");
  const w = plan([]).windows[0];
  assert.deepEqual(windowTrend(text, "grok", w, start + 5 * DAY), [
    { at: start + DAY, used: 15 }, { at: start + 2 * DAY, used: 15 },
    { at: start + 3 * DAY, used: 40 }, { at: start + 4 * DAY, used: 38 },
  ]);
  assert.deepEqual(windowTrend("", "grok", w, start + DAY), []);
  assert.deepEqual(windowTrend(row(2, 10), "grok", w, start + DAY), []);
});

test("a real zero at reset is retained, and current reading wins a duplicate timestamp", () => {
  const w = plan([]).windows[0];
  w.updatedAt = new Date((start + DAY) * 1000).toISOString(); w.usedPercent = 7;
  const text = [0, DAY].map((offset) => JSON.stringify({ at: start + offset, used: offset ? 5 : 0, minutes: 10080, resets_at: end, provider: "grok" })).join("\n");
  assert.deepEqual(windowTrend(text, "grok", w, start + 2 * DAY), [{ at: start, used: 0 }, { at: start + DAY, used: 7 }]);
});

test("line geometry shows flat periods and usage slopes between real samples", () => {
  const points = [{ at: 2, used: 10 }, { at: 3, used: 10 }, { at: 5, used: 35 }, { at: 6, used: 30 }];
  assert.equal(recordedLinePath(points, (x) => x * 10, (y) => 100 - y), "M20,90 L30,90 L50,65 L60,70");
  assert.equal(recordedLinePath([points[0]], (x) => x, (y) => y), "M2,10");
  assert.equal(recordedLinePath([], (x) => x, (y) => y), "");
});

test("average forecast uses the latest sample time and never fabricates browser-clock readings", () => {
  const p = plan([{ at: start + DAY, used: 20 }, { at: start + 2 * DAY, used: 40 }]);
  const [s] = weeklySeries([p], start + 3 * DAY);
  assert.equal(s.projected, 140);
  assert.deepEqual(s.forecastEnd, { at: start + 5 * DAY, used: 100 });
  assert.deepEqual(weeklySeries([p], start + 4 * DAY), [s]);
  assert.equal(s.points.length, 2);
  assert.equal(weeklyValueAt(s, start + DAY / 2), null);
  assert.deepEqual(weeklyValueAt(s, start + 1.5 * DAY), { at: start + DAY, used: 20, kind: "recorded" });
  assert.deepEqual(weeklyValueAt(s, start + 3 * DAY), { at: start + 3 * DAY, used: 60, kind: "forecast" });
  assert.equal(weeklyValueAt(s, end + 1), null);
});

test("single readings, zero forecasts, early periods, resets and unavailable sources", () => {
  const p = plan([{ at: start + 2 * DAY, used: 0 }]);
  const [s] = weeklySeries([p], start + 3 * DAY);
  assert.equal(s.projected, 0);
  assert.deepEqual(s.forecastEnd, { at: end, used: 0 });
  assert.deepEqual(weeklySeries([p], end), []);
  assert.deepEqual(weeklySeries([{ ...p, status: "error" }], start + 3 * DAY), []);
  assert.deepEqual(weeklySeries([plan([])], start + 3 * DAY), []);
  const [early] = weeklySeries([plan([{ at: start + 100, used: 1 }])], start + 1000);
  assert.equal(early.projected, null);
  assert.equal(early.forecastEnd, null);
  assert.equal(weeklyValueAt(early, start + 200), null);
});

test("separate reset periods keep all four providers on their own elapsed time axes", () => {
  const plans = (["claude", "codex", "grok", "grokbot"] as const).map((id, i) => {
    const p = plan([{ at: start + (i + 1) * DAY, used: 10 }], id);
    p.windows[0].resetsAt = end + i * DAY;
    return p;
  });
  const all = weeklySeries(plans, start + 5 * DAY);
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((s) => (s.latest.at - s.start) / DAY), [1, 1, 1, 1]);
  assert.deepEqual(all.map((s) => s.projected), [70, 70, 70, 70]);
});

test("subsecond reset jitter preserves samples but a different reset period does not", () => {
  const row = (reset: number, at: number) => JSON.stringify({ at, used: 10, minutes: 10080, resets_at: reset, provider: "grok" });
  const w = plan([]).windows[0];
  const points = windowTrend([row(end - 0.4, start + DAY), row(end + 0.3, start + 2 * DAY), row(end + 60, start + 3 * DAY)].join("\n"), "grok", w, start + 4 * DAY);
  assert.equal(points.length, 2);
});

test("dense histories retain all path samples while bounding SVG markers", () => {
  const points = Array.from({ length: 10080 }, (_, i) => ({ at: i, used: i / 101 }));
  const markers = sampleMarkers(points);
  assert.ok(markers.length <= 120);
  assert.equal(markers[0], points[0]);
  assert.equal(markers.at(-1), points.at(-1));
  const path = recordedLinePath(points, (x) => x, (y) => y);
  assert.equal((path.match(/L/g) ?? []).length, 10079);
});

test("calendar detail domain fits collected time across different reset dates", () => {
  const a = plan([{ at: start + DAY, used: 10 }, { at: start + DAY + 600, used: 20 }]);
  const b = plan([{ at: start + DAY + 120, used: 5 }, { at: start + DAY + 900, used: 5 }], "codex");
  b.windows[0].resetsAt = end + DAY / 2;
  const all = weeklySeries([a, b], start + 2 * DAY);
  assert.deepEqual(recordedDomain(all, start + 2 * DAY), { from: start + DAY - 36, to: start + DAY + 936 });
  const d = recordedDomain(all, start + 3 * DAY);
  assert.equal(d.to - d.from, 972); // does not spread 15 minutes across seven days
});

test("calendar detail handles a lone observation and an empty archive", () => {
  const all = weeklySeries([plan([{ at: start + DAY, used: 10 }])], start + 2 * DAY);
  assert.deepEqual(recordedDomain(all, start + 2 * DAY), { from: start + DAY - 30, to: start + DAY + 30 });
  assert.deepEqual(recordedDomain([], 123), { from: 63, to: 183 });
});

test("recorded tooltip values stay real and never interpolate or forecast", () => {
  const [s] = weeklySeries([plan([{ at: start + DAY, used: 10 }, { at: start + 2 * DAY, used: 50 }])], start + 3 * DAY);
  assert.deepEqual(recordedValueAt(s, start + 1.5 * DAY), { at: start + DAY, used: 10, kind: "recorded" });
  assert.equal(recordedValueAt(s, start + 3 * DAY), null);
  assert.equal(recordedValueAt(s, start), null);
});


test("history keyboard inspection reaches every saved sample and both endpoints", () => {
  const [s] = weeklySeries([plan([{ at: start + DAY, used: 10 }, { at: start + 2 * DAY, used: 50 }])], start + 3 * DAY);
  const times = s.points.map((p) => p.at);
  const first = inspectSampleTime(times, null, "next")!;
  const last = inspectSampleTime(times, first, "next")!;
  assert.deepEqual(recordedValueAt(s, first), { at: first, used: 10, kind: "recorded" });
  assert.deepEqual(recordedValueAt(s, last + 1e-7), { at: last, used: 50, kind: "recorded" });
  assert.equal(inspectSampleTime(times, last, "next"), last);
  assert.equal(inspectSampleTime(times, last, "previous"), first);
  assert.equal(inspectSampleTime(times, null, "previous"), last);
});

test("pointer inspection snaps near a lone sample but leaves distant gaps unknown", () => {
  assert.equal(inspectSampleTime([123], 123.001, "nearest", 0.1), 123);
  assert.equal(inspectSampleTime([123], 122, "nearest", 0.1), 122);
  assert.equal(inspectSampleTime([123], null, "next"), 123);
  assert.equal(inspectSampleTime([], 123, "nearest", 1), null);
  assert.equal(inspectSampleTime([10, 20, 30], 24, "nearest", 5), 20);
});
