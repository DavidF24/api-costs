// Models in the saved token history that have no verified price yet. The dashboard shows
// them as a notice the day they first appear, and the pricing check script uses the same
// list to decide whether there is anything to look up. Takes a plain better-sqlite3
// handle (no path aliases) so tests use an in-memory database.
import type Database from "better-sqlite3";
import { estimateCost, INTERNAL_MODELS, normalizeModelId, type UsageForCost } from "./pricing.ts";

// awaiting: a public model with no verified price in the catalog yet.
// internal: a tool's own label (no public API price will ever exist).
// other-provider: routed through another provider (e.g. "deepseek/..." via OpenRouter),
// billed on that provider's own account rather than covered by the subscription.
export type UnpricedKind = "awaiting" | "internal" | "other-provider";
export type UnpricedModel = {
  source: string;
  model: string;
  kind: UnpricedKind;
  firstSeen: string; // YYYY-MM-DD, Eastern
  lastSeen: string;
  tokens: number;
};

export const PRICED_SOURCES = ["claude-code", "codex", "grok"] as const;

export function classifyUnpriced(model: string): UnpricedKind {
  const id = normalizeModelId(model);
  if (INTERNAL_MODELS.has(id)) return "internal";
  if (id.includes("/")) return "other-provider";
  return "awaiting";
}

// A model counts as unpriced when the catalog has no entry for it, or has one but no
// verified rate for a token category it used (the estimate is then null, as in billing).
// Suffix variants of one model ("x[1m]", "x-20261101") are merged under its base ID.
export function readUnpricedModels(db: Database.Database): UnpricedModel[] {
  const marks = PRICED_SOURCES.map(() => "?").join(",");
  const rows = db.prepare(`SELECT source, model, MIN(date) AS firstSeen, MAX(date) AS lastSeen,
      SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cacheRead,
      SUM(cache_write_5m) AS cacheWrite5m, SUM(cache_write_1h) AS cacheWrite1h
    FROM activity_usage WHERE source IN (${marks}) GROUP BY source, model`).all(...PRICED_SOURCES) as
    (UsageForCost & { source: string; model: string; firstSeen: string; lastSeen: string })[];
  const out = new Map<string, UnpricedModel>();
  for (const r of rows) {
    const tokens = r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
    if (tokens <= 0 || estimateCost(r.model, r) !== null) continue;
    const model = normalizeModelId(r.model);
    const key = `${r.source}|${model}`;
    const m = out.get(key) ?? { source: r.source, model, kind: classifyUnpriced(model), firstSeen: r.firstSeen, lastSeen: r.lastSeen, tokens: 0 };
    m.tokens += tokens;
    if (r.firstSeen < m.firstSeen) m.firstSeen = r.firstSeen;
    if (r.lastSeen > m.lastSeen) m.lastSeen = r.lastSeen;
    out.set(key, m);
  }
  return [...out.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.tokens - a.tokens);
}
