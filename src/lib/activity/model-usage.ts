// Per-model token categories for the subscription rates table. The combined
// `tokens` field keeps the older Activity convention: Claude and Codex omit
// cache, and Grok includes it. `usage` always keeps the categories separate.

export type ModelUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export type ModelUsageRow = ModelUsage & {
  date: string;
  source: string;
  model: string;
  estCost: number;
  unpricedTokens: number;
};

export type FoldedModelUsage = {
  source: string;
  model: string;
  days: number;
  lastUsed: string;
  tokens: number | null;
  estCost: number;
  unpricedTokens: number;
  usage: ModelUsage;
};

export function foldModelUsage(rows: ModelUsageRow[]): FoldedModelUsage[] {
  const models = new Map<string, FoldedModelUsage & { dates: Set<string> }>();
  for (const row of rows) {
    if (row.model === "unknown") continue;
    const key = `${row.source}|${row.model}`;
    let model = models.get(key);
    if (!model) {
      model = {
        source: row.source,
        model: row.model,
        days: 0,
        dates: new Set(),
        lastUsed: row.date,
        tokens: 0,
        estCost: 0,
        unpricedTokens: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      };
      models.set(key, model);
    }
    model.dates.add(row.date);
    if (row.date > model.lastUsed) model.lastUsed = row.date;
    const cache = row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
    model.tokens = (model.tokens ?? 0) + row.input + row.output + (row.source === "grok" ? cache : 0);
    model.estCost += row.estCost;
    model.unpricedTokens += row.unpricedTokens;
    model.usage.input += row.input;
    model.usage.output += row.output;
    model.usage.cacheRead += row.cacheRead;
    model.usage.cacheWrite5m += row.cacheWrite5m;
    model.usage.cacheWrite1h += row.cacheWrite1h;
  }
  return [...models.values()].map(({ dates, tokens, ...model }) => ({
    ...model,
    days: dates.size,
    tokens: model.source === "grok" && tokens === 0 ? null : tokens,
  }));
}
