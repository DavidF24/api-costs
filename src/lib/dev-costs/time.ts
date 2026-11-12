// Billable hours per repository, from the productivity tracker's derived table
// `sample_projects` (data/activity.db in the productivity-tracking folder). The tracker
// samples the screen every 30 seconds and works out which project each Claude or Codex
// sample belongs to; idle samples carry the project of the session that was in front.
// The tracker database is only ever opened read-only. Plain node: no path aliases, so
// tests load it directly with `node --test`.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { Repo, RepoResolver } from "./repos.ts";

export const SAMPLE_SECONDS = 30;

export type TrackerRow = { ts: string; projectPath: string | null; state: string; idleSec: number };
export type TrackerStatus = { available: boolean; path: string; builtAt: string | null; latest: string | null; error?: string };

const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
export const easternDate = (ts: string) => etDate.format(new Date(ts));

// The UTC range that safely covers [start, end) Eastern dates; rows are then filtered by
// their Eastern date, so the extra hours either side never count.
function utcCover(start: string, end: string): [string, string] {
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString();
  return [shift(start, -1), shift(end, 1)];
}

export function readTrackerRows(path: string, start: string, end: string): { rows: TrackerRow[]; status: TrackerStatus } {
  if (!existsSync(path)) return { rows: [], status: { available: false, path, builtAt: null, latest: null, error: "Tracker database not found" } };
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 3000");
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sample_projects'`).get();
    if (!has) return { rows: [], status: { available: false, path, builtAt: null, latest: null, error: "The tracker has not built its billing table yet" } };
    const [from, to] = utcCover(start, end);
    // `none` rows are time the tracker could not tie to a project; they are never billed.
    const rows = (db.prepare(`SELECT ts, project_path AS projectPath, state, idle_sec AS idleSec FROM sample_projects
      WHERE method <> 'none' AND project_path IS NOT NULL AND ts >= ? AND ts < ?`).all(from, to) as TrackerRow[])
      .filter((r) => { const d = easternDate(r.ts); return d >= start && d < end; });
    const meta = db.prepare(`SELECT MAX(built_at) AS builtAt, MAX(ts) AS latest FROM sample_projects`).get() as { builtAt: string | null; latest: string | null };
    return { rows, status: { available: true, path, ...meta } };
  } catch (err) {
    return { rows: [], status: { available: false, path, builtAt: null, latest: null, error: err instanceof Error ? err.message : "Could not read the tracker" } };
  } finally {
    db?.close();
  }
}

export type RepoTime = { key: string; repo: Repo | null; label: string; seconds: number; days: number };

// A sample is billed when David was at the keyboard (active) or had been idle no longer than
// the cutoff for the client the repository is billed to. A cutoff of 0 bills active time only.
export function tallyTime(rows: TrackerRow[], resolver: RepoResolver, cutoffMin: (repoId: string | null) => number): RepoTime[] {
  const out = new Map<string, RepoTime & { dates: Set<string> }>();
  for (const r of rows) {
    if (!r.projectPath) continue;
    const repo = resolver.fromCwd(r.projectPath);
    const key = repo ? `repo:${repo.id}` : `folder:${r.projectPath}`;
    const billable = r.state === "active" || r.idleSec <= cutoffMin(repo?.id ?? null) * 60;
    if (!billable) continue;
    const t = out.get(key) ?? { key, repo, label: repo?.id ?? r.projectPath, seconds: 0, days: 0, dates: new Set<string>() };
    t.seconds += SAMPLE_SECONDS;
    t.dates.add(easternDate(r.ts));
    out.set(key, t);
  }
  return [...out.values()]
    .map(({ dates, ...t }) => ({ ...t, days: dates.size }))
    .sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
}

// Hours to two decimals, as billed.
export const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
