import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { estimateCost, getModelPrice } from "../src/lib/activity/pricing.ts";
import { classifyUnpriced, readUnpricedModels } from "../src/lib/activity/unpriced.ts";

const million = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 };

test("Fable 5.2 and GPT-6.1 Terra use the official Standard rates verified 2026-11-11", () => {
  // Anthropic: $8 input, $10 5m write, $16 1h write, $0.20 cache hit, $40 output.
  assert.deepEqual(getModelPrice("claude-fable-5-2"), { input: 8, output: 40, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16 });
  assert.equal(estimateCost("claude-fable-5-2", million), 74.2);
  // OpenAI: $1 input, $0.05 cached, $5 output, $1.25 30-minute write; no 1h column.
  assert.equal(estimateCost("gpt-6.1-terra", { ...million, cacheWrite1h: 0 }), 7.3);
  assert.equal(estimateCost("gpt-6.1-terra", million), null);
});

test("unpriced models are classified, never guessed", () => {
  assert.equal(classifyUnpriced("gpt-9-new"), "awaiting");
  assert.equal(classifyUnpriced("codex-auto-review"), "internal");
  assert.equal(classifyUnpriced("deepseek/deepseek-v4.1-flash-1017"), "other-provider");
  assert.equal(classifyUnpriced("gpt-5.4"), "missing-rate");
});

test("readUnpricedModels lists models with tokens and no usable price, merged by base ID, newest first", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE activity_usage (date TEXT, source TEXT, model TEXT, input INTEGER, output INTEGER,
    cache_read INTEGER, cache_write_5m INTEGER, cache_write_1h INTEGER)`);
  const add = db.prepare(`INSERT INTO activity_usage VALUES (?,?,?,?,?,0,0,0)`);
  add.run("2026-11-01", "claude-code", "claude-opus-5-5", 10, 10);
  add.run("2026-11-02", "codex", "codex-auto-review", 5, 5);
  add.run("2026-11-09", "claude-code", "claude-new-6", 100, 1);
  add.run("2026-11-10", "claude-code", "claude-new-6", 50, 0);
  add.run("2026-11-10", "grok-bot", "grok-x", 1, 1);
  add.run("2026-11-10", "codex", "gpt-empty", 0, 0);
  add.run("2026-11-03", "claude-code", "claude-new-6-20261101", 9, 0);
  db.prepare(`INSERT INTO activity_usage VALUES ('2026-11-04','codex','gpt-5.4',1,1,0,5,0)`).run();
  const out = readUnpricedModels(db);
  assert.deepEqual(out.map((m) => [m.model, m.kind, m.firstSeen, m.lastSeen, m.tokens]), [
    ["gpt-5.4", "missing-rate", "2026-11-04", "2026-11-04", 7],
    ["claude-new-6", "awaiting", "2026-11-03", "2026-11-10", 160],
    ["codex-auto-review", "internal", "2026-11-02", "2026-11-02", 10],
  ]);
});
