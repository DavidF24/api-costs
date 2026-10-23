// Pure view calculations: actual API charges never get added to subscription estimates.
import type { ActivityResult, ActivityDaily } from "./queries";

export type ActivityScope = "subscriptions" | "api" | "combined";
export function localSource(source: string) {
  return ["claude-code", "codex", "grok", "grok-bot"].includes(source);
}
export function scopeModels(models: ActivityResult["models"], scope: ActivityScope) {
  return models.filter((m) => scope === "combined" || localSource(m.source) === (scope === "subscriptions"));
}
export function subscriptionEstimates(daily: ActivityDaily[]) {
  return ["claude-code", "codex", "grok"].map((source) => {
    const rows = daily.filter((d) => d.source === source);
    return {
      source,
      cost: rows.reduce((s, d) => s + d.estCost, 0),
      tokens: rows.reduce((s, d) => s + d.input + d.output + d.cacheRead + d.cacheWrite, 0),
      unpricedTokens: rows.reduce((s, d) => s + d.unpricedTokens, 0),
    };
  });
}
export function activityStats(data: ActivityResult, scope: ActivityScope) {
  const showLocal = scope !== "api", showApi = scope !== "subscriptions";
  const api = data.apiDaily.reduce((s, d) => ({ input: s.input + d.input, output: s.output + d.output, cost: s.cost + d.cost }), { input: 0, output: 0, cost: 0 });
  return {
    showLocal, showApi,
    sessions: showLocal ? data.totals.sessions : null,
    messages: showLocal ? data.totals.messages : null,
    output: (showLocal ? data.totals.output : 0) + (showApi ? api.output : 0),
    apiInput: api.input,
    apiCost: showApi ? api.cost : null,
    estimates: showLocal ? subscriptionEstimates(data.daily) : [],
  };
}
