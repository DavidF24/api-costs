// Read-only coverage audit for weekly pricing maintenance. Prints aggregates
// only; never opens credentials or original transcripts. Run from the repo root:
// node scripts/check-activity-pricing.ts [path/to/costs.sqlite]
import Database from "better-sqlite3";
import { join } from "node:path";
import { estimateCost, PRICING_VERIFIED_ON, type UsageForCost } from "../src/lib/activity/pricing.ts";

type Row = UsageForCost & { source: string; model: string };
const path = process.argv[2] ?? process.env.DATABASE_PATH ?? join(process.cwd(), "data/costs.sqlite");
const sqlite = new Database(path, { readonly: true, fileMustExist: true });
try {
  const rows = sqlite.prepare(`SELECT source, model, SUM(input) input,
    SUM(output) output, SUM(cache_read) cacheRead, SUM(cache_write_5m) cacheWrite5m,
    SUM(cache_write_1h) cacheWrite1h FROM activity_usage
    WHERE source IN ('claude-code', 'codex', 'grok') GROUP BY source, model`).all() as Row[];
  console.log(`Pricing verified ${PRICING_VERIFIED_ON}; all retained token history at current standard rates.`);
  console.table(rows.map((r) => ({
    source: r.source, model: r.model,
    tokens: r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h,
    apiEquivalentUSD: estimateCost(r.model, r)?.toFixed(2) ?? "UNPRICED",
  })));
  console.log("Grok Bot has no token data. codex-auto-review is an internal label without a verified public API price.");
} finally { sqlite.close(); }
