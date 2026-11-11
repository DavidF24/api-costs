// Read-only coverage audit for pricing maintenance. Prints aggregates only; never opens
// credentials or original transcripts. Run from the repo root:
//   node scripts/check-activity-pricing.ts [path/to/costs.sqlite]
//   node scripts/check-activity-pricing.ts --new [path]   models awaiting a verified price;
//     prints nothing and exits 0 when there are none, exits 2 when there are, so a daily
//     job can start the price lookup only when a new model has appeared.
import Database from "better-sqlite3";
import { join } from "node:path";
import { estimateCost, PRICING_VERIFIED_ON, type UsageForCost } from "../src/lib/activity/pricing.ts";
import { readUnpricedModels } from "../src/lib/activity/unpriced.ts";

type Row = UsageForCost & { source: string; model: string };
const args = process.argv.slice(2);
const unknown = args.filter((a) => a.startsWith("--") && a !== "--new");
if (unknown.length > 0) {
  console.error(`Unknown option ${unknown.join(", ")}. Usage: check-activity-pricing.ts [--new] [path/to/costs.sqlite]`);
  process.exit(1);
}
const newOnly = args.includes("--new");
const path = args.find((a) => !a.startsWith("--")) ?? process.env.DATABASE_PATH ?? join(process.cwd(), "data/costs.sqlite");
const sqlite = new Database(path, { readonly: true, fileMustExist: true });
try {
  if (newOnly) {
    const awaiting = readUnpricedModels(sqlite).filter((m) => m.kind === "awaiting");
    if (awaiting.length > 0) {
      console.log(`Models awaiting a verified price (catalog checked ${PRICING_VERIFIED_ON}):`);
      for (const m of awaiting) console.log(`- ${m.model} (${m.source}), first seen ${m.firstSeen}, ${m.tokens} tokens`);
      process.exitCode = 2;
    }
  } else {
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
    const unpriced = readUnpricedModels(sqlite);
    for (const m of unpriced) console.log(`${m.model}: ${m.kind === "awaiting" ? "awaiting a verified price" : m.kind === "internal" ? "internal label, no public price" : "billed by another provider, not the subscription"}`);
    console.log("Grok Bot has no token data.");
  }
} finally { sqlite.close(); }
