import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { PlanUsage } from "../plans/parse";

// Additive, idempotent startup migration. Existing billing/activity tables are untouched.
export function ensureQuotaHistory(sqlite: Database.Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS quota_observations (
    observation_key TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    window_key TEXT NOT NULL,
    window_minutes INTEGER NOT NULL,
    resets_at INTEGER,
    used_percent REAL NOT NULL,
    source_updated_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    observations INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS quota_observations_time ON quota_observations(source_updated_at);
  CREATE INDEX IF NOT EXISTS quota_observations_window ON quota_observations(provider, window_key, resets_at);`);
}

type Observation = { provider: string; window: string; minutes: number; reset: number | null; used: number; updated: string };
const providers = ["claude", "codex", "grok", "grokbot"];

function validReading(provider: string, key: string, minutes: number, reset: number | null,
  used: number | null, at: number, nowSec: number, active: boolean): boolean {
  return providers.includes(provider) && !!key && key.length <= 100 &&
    Number.isInteger(minutes) && minutes > 0 && used !== null && Number.isFinite(used) && used >= 0 && used <= 100 &&
    Number.isFinite(at) && at >= 0 && at <= nowSec + 60 &&
    (reset === null || (Number.isFinite(reset) && at < reset && (!active || reset > nowSec)));
}

function persist(sqlite: Database.Database, rows: Observation[], now: Date): number {
  const observed = now.toISOString();
  const insert = sqlite.prepare(`INSERT INTO quota_observations
    (observation_key, provider, window_key, window_minutes, resets_at, used_percent,
     source_updated_at, first_seen_at, last_seen_at, observations)
    VALUES (@key, @provider, @window, @minutes, @reset, @used, @updated, @observed, @observed, 1)
    ON CONFLICT(observation_key) DO UPDATE SET
      last_seen_at = MAX(last_seen_at, excluded.last_seen_at), observations = observations + 1`);
  sqlite.transaction(() => {
    for (const row of rows) {
      const key = createHash("sha256").update(JSON.stringify([row.provider, row.window, row.minutes, row.reset, row.used, row.updated])).digest("hex");
      insert.run({ ...row, key, observed });
    }
  })();
  return rows.length;
}

// Save only validated numeric quota metadata, never credentials or response bodies.
// Repeated cached readings update last_seen_at rather than inventing new usage samples.
export function archivePlanUsage(sqlite: Database.Database, plans: PlanUsage[], now = new Date()): number {
  const rows: Observation[] = [];
  for (const plan of plans) {
    if (plan.status !== "ok") continue;
    for (const w of plan.windows) {
      const at = w.updatedAt ? Date.parse(w.updatedAt) / 1000 : NaN;
      if (w.reset || !validReading(plan.id, w.key, w.windowMinutes, w.resetsAt, w.usedPercent, at, now.getTime() / 1000, true)) continue;
      rows.push({ provider: plan.id, window: w.key, minutes: w.windowMinutes,
        reset: w.resetsAt, used: w.usedPercent!, updated: new Date(at * 1000).toISOString() });
    }
  }
  return persist(sqlite, rows, now);
}

// Protect legacy historical points too, including already-completed windows.
// Preserve only known numeric fields; legacy files remain untouched.
export function importQuotaHistory(sqlite: Database.Database, jsonl: string, now = new Date()): number {
  const rows: Observation[] = [];
  for (const line of jsonl.split("\n")) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row.provider !== "string" || typeof row.minutes !== "number" ||
        typeof row.used !== "number" || typeof row.at !== "number" || typeof row.resets_at !== "number") continue;
    const key = row.provider === "claude" && row.minutes === 300 ? "five_hour" :
      row.provider === "claude" && row.minutes === 10080 ? "seven_day" : `${row.provider}:${row.minutes}`;
    if (!validReading(row.provider, key, row.minutes, row.resets_at, row.used, row.at, now.getTime() / 1000, false) ||
        row.at < row.resets_at - row.minutes * 60) continue;
    rows.push({ provider: row.provider, window: key, minutes: row.minutes,
      reset: row.resets_at, used: row.used, updated: new Date(row.at * 1000).toISOString() });
  }
  return persist(sqlite, rows, now);
}

type HistoryRow = { provider: string; window_minutes: number; resets_at: number | null; used_percent: number; source_updated_at: string };

// The chart needs only recent points; this query does not delete older observations.
export function quotaHistoryJsonl(sqlite: Database.Database, now = new Date()): string {
  const since = new Date(now.getTime() - 8 * 86400_000).toISOString();
  const rows = sqlite.prepare(`SELECT provider, window_minutes, resets_at, used_percent, source_updated_at
    FROM quota_observations WHERE source_updated_at >= ? ORDER BY source_updated_at`).all(since) as HistoryRow[];
  return rows.map((r) => JSON.stringify({ at: Date.parse(r.source_updated_at) / 1000,
    provider: r.provider, minutes: r.window_minutes, resets_at: r.resets_at, used: r.used_percent })).join("\n");
}
