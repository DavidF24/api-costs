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

// Save only validated numeric quota metadata, never credentials or response bodies.
// Repeated cached readings update last_seen_at rather than inventing new usage samples.
export function archivePlanUsage(sqlite: Database.Database, plans: PlanUsage[], now = new Date()): number {
  const observedAt = now.toISOString();
  const nowSec = now.getTime() / 1000;
  const insert = sqlite.prepare(`INSERT INTO quota_observations
    (observation_key, provider, window_key, window_minutes, resets_at, used_percent,
     source_updated_at, first_seen_at, last_seen_at, observations)
    VALUES (@key, @provider, @window, @minutes, @reset, @used, @updated, @observed, @observed, 1)
    ON CONFLICT(observation_key) DO UPDATE SET
      last_seen_at = MAX(last_seen_at, excluded.last_seen_at), observations = observations + 1`);
  let recorded = 0;
  sqlite.transaction(() => {
    for (const plan of plans) {
      if (plan.status !== "ok" || !["claude", "codex", "grok", "grokbot"].includes(plan.id)) continue;
      for (const w of plan.windows) {
        const at = w.updatedAt ? Date.parse(w.updatedAt) / 1000 : NaN;
        if (w.reset || !Number.isFinite(at) || at < 0 || at > nowSec + 60 ||
            !w.key || w.key.length > 100 || !Number.isInteger(w.windowMinutes) || w.windowMinutes <= 0 ||
            w.usedPercent === null || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 ||
            (w.resetsAt !== null && (!Number.isFinite(w.resetsAt) || w.resetsAt <= nowSec || at >= w.resetsAt))) continue;
        const updated = new Date(at * 1000).toISOString();
        const key = createHash("sha256").update(JSON.stringify([plan.id, w.key, w.windowMinutes, w.resetsAt, w.usedPercent, updated])).digest("hex");
        insert.run({ key, provider: plan.id, window: w.key, minutes: w.windowMinutes,
          reset: w.resetsAt, used: w.usedPercent, updated, observed: observedAt });
        recorded++;
      }
    }
  })();
  return recorded;
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
