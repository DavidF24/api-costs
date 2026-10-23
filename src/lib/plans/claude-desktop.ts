import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cacheName, parseCachedJSON, MAX_CACHE_BYTES } from "./chromium-cache.ts";
import { applyReset, windowLabel, type PlanUsage, type QuotaWindow } from "./parse.ts";

function boundedRead(path: string, max: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size > max) throw Error("oversized file");
    const b = Buffer.alloc(size);
    if (readSync(fd, b, 0, size, 0) !== size || fstatSync(fd).size !== size) throw Error("incomplete file");
    return b;
  } finally { closeSync(fd); }
}

export function desktopClaudeWindows(data: unknown, at: number, nowSec: number): QuotaWindow[] {
  if (!data || typeof data !== "object" || at < nowSec - 7200 || at > nowSec + 60) return [];
  return [["five_hour", 300], ["seven_day", 10080]].flatMap(([key, minutes]) => {
    const w = (data as Record<string, unknown>)[key];
    if (!w || typeof w !== "object") return [];
    const { utilization: used, resets_at: reset } = w as Record<string, unknown>;
    const sec = typeof reset === "string" ? Date.parse(reset) / 1000 : NaN;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100 || !Number.isFinite(sec) || sec > at + Number(minutes) * 60 + 60) return [];
    return [applyReset({ key: String(key), label: windowLabel(Number(minutes)), windowMinutes: Number(minutes), usedPercent: used, resetsAt: sec, updatedAt: new Date(at * 1000).toISOString(), reset: false }, nowSec)];
  });
}

export function getDesktopClaudeUsage(nowSec = Date.now() / 1000, root = join(homedir(), "Library", "Application Support", "Claude")): PlanUsage | null {
  try {
    const history = JSON.parse(boundedRead(join(root, "plan-usage-history.json"), 4 * MAX_CACHE_BYTES).toString());
    if (![1, 2].includes(history.version) || !Array.isArray(history.samples)) return null;
    const latest = history.samples.filter((x: { t?: unknown; org?: unknown }) => typeof x?.t === "number" && x.t <= (nowSec + 60) * 1000 && typeof x.org === "string" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(x.org)).sort((a: { t: number }, b: { t: number }) => b.t - a.t)[0];
    if (!latest) return null;
    const key = `1/0/https://claude.ai/api/organizations/${latest.org}/usage`;
    const cached = parseCachedJSON(boundedRead(join(root, "Cache", "Cache_Data", cacheName(key)), MAX_CACHE_BYTES), key, nowSec);
    const windows = desktopClaudeWindows(cached.data, cached.at, nowSec);
    if (!windows.length) return null;
    return { id: "claude", name: "Claude Max", status: "ok", windows, updatedAt: new Date(cached.at * 1000).toISOString(), staleAfterMinutes: 30, note: "Automatic reading from Claude Desktop’s local usage cache. Open Claude Desktop to refresh it; readings older than 2 hours are hidden." };
  } catch { return null; }
}
