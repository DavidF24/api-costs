// Models in the saved token history that have no verified price yet. The dashboard shows
// them as a notice the day they first appear, and the pricing check script uses the same
// list to decide whether there is anything to look up. Takes a plain better-sqlite3
// handle (no path aliases) so tests use an in-memory database.
import type Database from "better-sqlite3";
import { getModelPrice, INTERNAL_MODELS, normalizeModelId } from "./pricing.ts";

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

export function readUnpricedModels(db: Database.Database): UnpricedModel[] {
  const marks = PRICED_SOURCES.map(() => "?").join(",");
  const rows = db.prepare(`SELECT source, model, MIN(date) AS firstSeen, MAX(date) AS lastSeen,
      SUM(input + output + cache_read + cache_write_5m + cache_write_1h) AS tokens
    FROM activity_usage WHERE source IN (${marks}) GROUP BY source, model`).all(...PRICED_SOURCES) as Omit<UnpricedModel, "kind">[];
  return rows
    .filter((r) => r.tokens > 0 && !getModelPrice(r.model))
    .map((r) => ({ ...r, kind: classifyUnpriced(r.model) }))
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.tokens - a.tokens);
}
