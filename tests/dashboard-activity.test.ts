import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, normalizeModelId, priceRecordedUsage } from "../src/lib/activity/pricing.ts";
import { activityStats, scopeModels, subscriptionEstimates } from "../src/lib/activity/view.ts";
import { createGrokAccumulator } from "../src/lib/activity/grok-parse.ts";
import type { ActivityResult, ActivityDaily } from "../src/lib/activity/queries.ts";

const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0 };
test("Grok uses model-specific cached rates and input rates for cache creation", () => {
  assert.equal(estimateCost("grok-4.5-build", usage), 10.3);
  assert.equal(estimateCost("grok-4.6-build", usage), 10.5);
  assert.equal(estimateCost("grok-4.7-build", usage), 10.5);
  assert.equal(normalizeModelId("grok-4.7-build"), "grok-4.7");
  assert.equal(estimateCost("grok-4.8-build", usage), null);
  assert.equal(estimateCost("grok-build-0.1", usage), null);
});
test("retained Grok history is priced without reindexing, and billing/other estimates stay unchanged", () => {
  assert.equal(priceRecordedUsage("grok", "grok-4.7-build", usage, null), 10.5);
  assert.equal(priceRecordedUsage("grok", "grok-4.7-build", usage, 999), 10.5);
  assert.equal(priceRecordedUsage("claude-code", "claude-opus-5-5", usage, 43), 43);
  assert.equal(priceRecordedUsage("codex", "unknown", usage, null), null);
  assert.equal(priceRecordedUsage("grok-bot", "grok-4.7", usage, 123), null);
});
test("Grok cached input and reasoning are not charged twice", () => {
  const a = createGrokAccumulator("session", "synthetic", (s) => s.slice(0, 10));
  a.line(JSON.stringify({ timestamp: 1780000000, params: { sessionId: "session", update: { sessionUpdate: "turn_completed", prompt_id: "p", usage: { modelUsage: { "grok-4.7-build": { inputTokens: 1_000_000, cachedReadTokens: 800_000, outputTokens: 100_000, reasoningTokens: 80_000 } } } } } }));
  const r = a.finish().usage[0];
  assert.equal(r.input, 200_000);
  assert.equal(r.output, 100_000);
  assert.equal(estimateCost(r.model, r), 1.4);
});
function row(source: string, cost: number, unpricedTokens = 0): ActivityDaily {
  return { date: "2026-10-22", source, messages: 2, input: 10, output: 20, cacheRead: 30, cacheWrite: 40, estCost: cost, unpricedTokens };
}
const data: ActivityResult = {
  daily: [row("claude-code", 10), row("codex", 20), row("grok", 30, 5), row("grok-bot", 0)],
  apiDaily: [{ date: "2026-10-22", source: "xai", input: 100, output: 200, cost: 5 }],
  models: ["claude-code", "codex", "grok", "grok-bot", "xai", "openai"].map((source) => ({ source, model: "model", days: 1, lastUsed: "2026-10-22", tokens: 10, estCost: 1 })),
  tools: { builtin: [], mcp: [], skill: [], subagent: [], codex: [] }, sessions: [],
  dataStart: { claude: null, codex: null, grok: null, grokBot: null },
  totals: { messages: 8, input: 40, output: 80, cacheRead: 120, cacheWrite: 160, sessions: 4, estCost: 60 },
};
test("Activity source toggle partitions models without confusing Grok with the xAI API", () => {
  assert.deepEqual(scopeModels(data.models, "subscriptions").map((m) => m.source), ["claude-code", "codex", "grok", "grok-bot"]);
  assert.deepEqual(scopeModels(data.models, "api").map((m) => m.source), ["xai", "openai"]);
  assert.equal(scopeModels(data.models, "combined").length, data.models.length);
});
test("Combined adds recorded tokens but keeps estimates separate from billed API charges", () => {
  const combined = activityStats(data, "combined");
  assert.equal(combined.output, 280);
  assert.equal(combined.apiCost, 5);
  assert.equal(combined.sessions, 4);
  assert.equal(combined.messages, 8);
  assert.equal(combined.estimates.reduce((s, e) => s + e.cost, 0), 60);
  const api = activityStats(data, "api");
  assert.equal(api.output, 200);
  assert.equal(api.apiInput, 100);
  assert.equal(api.messages, null);
  assert.equal(api.sessions, null);
  assert.deepEqual(api.estimates, []);
  const subs = activityStats(data, "subscriptions");
  assert.equal(subs.output, 80);
  assert.equal(subs.apiCost, null);
});
test("estimates retain coverage information and empty history doesn't invent a price", () => {
  const e = subscriptionEstimates(data.daily);
  assert.equal(e[2].tokens, 100);
  assert.equal(e[2].unpricedTokens, 5);
  assert.deepEqual(subscriptionEstimates([]).map((v) => [v.cost, v.tokens]), [[0, 0], [0, 0], [0, 0]]);
});
