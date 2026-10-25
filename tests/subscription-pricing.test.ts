import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { estimateCost, getModelPrice, priceRecordedUsage, type UsageForCost } from "../src/lib/activity/pricing.ts";

const million = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0 };
test("new subscription models use verified Standard rates, including discounted cache reads", () => {
  assert.equal(estimateCost("claude-sonnet-5-5", { ...million, cacheWrite1h: 1_000_000 }), 18.6);
  assert.equal(estimateCost("gpt-6.1-sol", million), 14.6);
  assert.equal(estimateCost("gpt-6-luna", million), 0.735);
  assert.equal(estimateCost("gpt-5.6-terra", million), 16.7);
  assert.equal(estimateCost("gpt-5.6-luna", million), 1.67);
  assert.equal(estimateCost("gpt-5.2-codex", { ...million, cacheWrite5m: 0 }), 15.925);
  assert.equal(getModelPrice("gpt-6.1-sol")?.cacheRead, 0.1);
  assert.equal(getModelPrice("gpt-6-sol")?.cacheRead, 0.2);
});

test("unknown categories and invalid counts are never treated as free or assigned fallback prices", () => {
  assert.equal(estimateCost("gpt-5.2-codex", million), null, "cache writes have no verified rate");
  assert.equal(estimateCost("gpt-6.1-sol", { ...million, cacheWrite1h: 1 }), null);
  assert.equal(estimateCost("gpt-6.1-sol", { ...million, input: -1 }), null);
  assert.equal(estimateCost("gpt-6.1-sol", { ...million, output: NaN }), null);
  assert.equal(getModelPrice("constructor"), undefined);
  assert.equal(priceRecordedUsage("codex", "codex-auto-review", million, 999), null);
  assert.equal(priceRecordedUsage("grok-bot", "grok-4.7", million, 999), null);
  const withMetadata = { ...million, source: "codex", model: "gpt-6.1-sol", recorded: null };
  assert.equal(estimateCost(withMetadata.model, withMetadata), 14.6);
});

test("SQLite history indexed with missing or old prices is repriced without changing saved history or bills", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`CREATE TABLE history (source TEXT, model TEXT, input INTEGER, output INTEGER,
      cacheRead INTEGER, cacheWrite5m INTEGER, cacheWrite1h INTEGER, recorded REAL);
      CREATE TABLE billed (cost REAL); INSERT INTO billed VALUES (27.13);`);
    const insert = sqlite.prepare("INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const [source, model, recorded] of [
      ["claude-code", "claude-sonnet-5-5", null], ["claude-code", "claude-sonnet-5-5", 999],
      ["codex", "gpt-6.1-sol", null], ["codex", "gpt-6.1-sol", 999],
      ["grok", "grok-4.7-build", null], ["grok", "grok-4.7-build", 999],
      ["codex", "codex-auto-review", null],
    ] as const) insert.run(source, model, ...Object.values(million), recorded);
    const before = sqlite.prepare("SELECT * FROM history").all();
    const rows = sqlite.prepare(`SELECT source, model, SUM(input) input, SUM(output) output,
      SUM(cacheRead) cacheRead, SUM(cacheWrite5m) cacheWrite5m, SUM(cacheWrite1h) cacheWrite1h,
      SUM(recorded) recorded FROM history GROUP BY source, model`).all() as
      (UsageForCost & { source: string; model: string; recorded: number | null })[];
    const priced = rows.map((r) => ({ ...r, cost: priceRecordedUsage(r.source, r.model, r, r.recorded) }));
    assert.equal(priced.find((r) => r.model === "claude-sonnet-5-5")?.cost, 29.2);
    assert.equal(priced.find((r) => r.model === "gpt-6.1-sol")?.cost, 29.2);
    assert.equal(priced.find((r) => r.model === "grok-4.7-build")?.cost, 21);
    assert.equal(priced.find((r) => r.model === "codex-auto-review")?.cost, null);
    assert.deepEqual(sqlite.prepare("SELECT * FROM history").all(), before);
    assert.deepEqual(sqlite.prepare("SELECT * FROM billed").all(), [{ cost: 27.13 }]);
  } finally { sqlite.close(); }
});
