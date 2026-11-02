import { test } from "node:test";
import assert from "node:assert/strict";
import { foldModelUsage, type ModelUsageRow } from "../src/lib/activity/model-usage.ts";

function row(partial: Partial<ModelUsageRow> & Pick<ModelUsageRow, "source" | "model">): ModelUsageRow {
  return {
    date: "2026-10-03",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    estCost: 0,
    unpricedTokens: 0,
    ...partial,
  };
}

test("subscription models keep token categories separate and preserve first-seen order", () => {
  const models = foldModelUsage([
    row({ source: "codex", model: "gpt-6-astra", date: "2026-10-03", input: 100, output: 20, cacheRead: 400, estCost: 9 }),
    row({ source: "claude-code", model: "claude-sonnet-5-5", date: "2026-10-03", input: 5, output: 7, cacheRead: 80, cacheWrite5m: 3, cacheWrite1h: 4, estCost: 2 }),
    row({ source: "claude-code", model: "claude-sonnet-5-5", date: "2026-10-04", input: 1, output: 1, cacheRead: 20, cacheWrite5m: 1, estCost: 1 }),
    row({ source: "codex", model: "codex-auto-review", input: 9, output: 8, cacheRead: 7, unpricedTokens: 24 }),
    row({ source: "grok", model: "unknown", input: 50, output: 50, cacheRead: 50 }),
  ]);
  assert.deepEqual(models.map((model) => model.model), ["gpt-6-astra", "claude-sonnet-5-5", "codex-auto-review"]);
  const sonnet = models[1];
  assert.equal(sonnet.tokens, 14, "Claude model total still omits cache");
  assert.deepEqual(sonnet.usage, { input: 6, output: 8, cacheRead: 100, cacheWrite5m: 4, cacheWrite1h: 4 });
  assert.equal(sonnet.days, 2);
  assert.equal(sonnet.lastUsed, "2026-10-04");
  assert.equal(sonnet.estCost, 3);
  const review = models[2];
  assert.equal(review.tokens, 17);
  assert.equal(review.usage.cacheRead, 7);
  assert.equal(review.unpricedTokens, 24);
});

test("Grok's combined token count includes cache, and a tokenless Grok model stays null", () => {
  const models = foldModelUsage([
    row({ source: "grok", model: "grok-4.7-build", input: 10, output: 4, cacheRead: 30, cacheWrite5m: 2 }),
    row({ source: "grok", model: "grok-4.7", date: "2026-10-05" }),
  ]);
  assert.equal(models[0].tokens, 46);
  assert.deepEqual(models[0].usage, { input: 10, output: 4, cacheRead: 30, cacheWrite5m: 2, cacheWrite1h: 0 });
  assert.equal(models[1].tokens, null);
  assert.deepEqual(models[1].usage, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
});
