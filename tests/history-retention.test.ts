import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { ensureQuotaHistory, archivePlanUsage, importQuotaHistory, quotaHistoryJsonl } from "../src/lib/db/quota-history.ts";
import { backupDatabase } from "../src/lib/db/backup.ts";
import { windowTrend, type PlanUsage } from "../src/lib/plans/parse.ts";

const now = new Date("2026-10-22T12:00:00Z");
const reset = now.getTime() / 1000 + 3600;
function plan(used = 20, minutes = 10080): PlanUsage {
  return { id: "grok", name: "Grok", status: "ok", updatedAt: now.toISOString(),
    windows: [{ key: "weekly", label: "Weekly", windowMinutes: minutes, usedPercent: used,
      resetsAt: reset, updatedAt: now.toISOString(), reset: false }] };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "api-costs-retention-"));
  const path = join(dir, "costs.sqlite");
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  ensureQuotaHistory(sqlite);
  const cleanup = () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, path, sqlite, cleanup };
}

test("quota archive migration preserves existing data and is idempotent", () => {
  const f = fixture();
  try {
    f.sqlite.exec("CREATE TABLE cost_entries (cost REAL); INSERT INTO cost_entries VALUES (12.5)");
    archivePlanUsage(f.sqlite, [plan()], now);
    ensureQuotaHistory(f.sqlite);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM cost_entries").all(), [{ cost: 12.5 }]);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 1);
  } finally { f.cleanup(); }
});

test("cached quota samples deduplicate while preserving original and last observed times", () => {
  const f = fixture();
  try {
    archivePlanUsage(f.sqlite, [plan(0)], now);
    const later = new Date(now.getTime() + 60_000);
    archivePlanUsage(f.sqlite, [plan(0)], later);
    const rows = f.sqlite.prepare("SELECT used_percent, source_updated_at, first_seen_at, last_seen_at, observations FROM quota_observations").all();
    assert.deepEqual(rows, [{ used_percent: 0, source_updated_at: now.toISOString(),
      first_seen_at: now.toISOString(), last_seen_at: later.toISOString(), observations: 2 }]);
  } finally { f.cleanup(); }
});

test("quota archive retains windows and providers across reset periods and reconnects", () => {
  const f = fixture();
  try {
    const plans: PlanUsage[] = ["claude", "codex", "grok", "grokbot"].map((id) => ({ ...plan(), id: id as PlanUsage["id"] }));
    plans[0].windows.push({ ...plans[0].windows[0], key: "five_hour", windowMinutes: 300 });
    assert.equal(archivePlanUsage(f.sqlite, plans, now), 5);
    const next = plan(3);
    next.windows[0].resetsAt = reset + 7 * 86400;
    archivePlanUsage(f.sqlite, [next], now);
    const reader = new Database(f.path, { readonly: true });
    try { assert.equal((reader.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 6); }
    finally { reader.close(); }
  } finally { f.cleanup(); }
});

test("missing, malformed, expired and reset readings never become invented zero samples", () => {
  const f = fixture();
  try {
    const invalid = [plan(), plan(), plan(), plan(), plan(), plan(), plan()];
    invalid[0].status = "missing";
    invalid[1].windows[0].usedPercent = null;
    invalid[2].windows[0].usedPercent = NaN;
    invalid[3].windows[0].resetsAt = reset - 7200;
    invalid[4].windows[0].reset = true;
    invalid[5].windows[0].updatedAt = "invalid";
    invalid[6].windows[0].updatedAt = new Date(now.getTime() + 120_000).toISOString();
    assert.equal(archivePlanUsage(f.sqlite, invalid, now), 0);
    const unknownReset = plan(0); unknownReset.windows[0].resetsAt = null;
    assert.equal(archivePlanUsage(f.sqlite, [unknownReset, unknownReset], now), 2);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 1);
  } finally { f.cleanup(); }
});

test("weekly charts use saved source timestamps without deleting historical quota rows", () => {
  const f = fixture();
  try {
    archivePlanUsage(f.sqlite, [plan(20)], now);
    const later = new Date(now.getTime() + 10 * 60_000);
    const next = plan(30); next.windows[0].updatedAt = later.toISOString();
    archivePlanUsage(f.sqlite, [next], later);
    const points = windowTrend(quotaHistoryJsonl(f.sqlite, later), "grok", next.windows[0]);
    assert.equal(points.find((p) => p.at === now.getTime() / 1000)?.used, 20);
    assert.equal(points.at(-1)?.used, 30);
    assert.equal(quotaHistoryJsonl(f.sqlite, new Date(now.getTime() + 30 * 86400_000)), "");
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 2);
  } finally { f.cleanup(); }
});

test("daily backup restores committed WAL data, stays private and never overwrites past days", async () => {
  const f = fixture();
  try {
    f.sqlite.pragma("wal_autocheckpoint = 0");
    f.sqlite.exec("CREATE TABLE historical_costs (cost REAL); INSERT INTO historical_costs VALUES (42)");
    archivePlanUsage(f.sqlite, [plan()], now);
    const [first, concurrent] = await Promise.all([backupDatabase(f.sqlite, f.path, now), backupDatabase(f.sqlite, f.path, now)]);
    assert.equal(first, concurrent);
    assert.equal(statSync(first).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.dir, "backups", "2026-10-22")).mode & 0o777, 0o700);
    const restored = new Database(first, { readonly: true });
    try {
      assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(restored.prepare("SELECT * FROM historical_costs").all(), [{ cost: 42 }]);
      assert.equal((restored.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 1);
    } finally { restored.close(); }
    f.sqlite.exec("INSERT INTO historical_costs VALUES (55)");
    await backupDatabase(f.sqlite, f.path, now);
    const unchanged = new Database(first, { readonly: true });
    try { assert.equal((unchanged.prepare("SELECT count(*) n FROM historical_costs").get() as {n:number}).n, 1); }
    finally { unchanged.close(); }
    const second = await backupDatabase(f.sqlite, f.path, new Date(now.getTime() + 86400_000));
    assert.notEqual(first, second);
    assert.deepEqual(readdirSync(join(f.dir, "backups")).sort(), ["2026-10-22", "2026-10-23"]);
  } finally { f.cleanup(); }
});

test("backup failure preserves source and completed snapshots and cleans temporary files", async () => {
  const f = fixture();
  try {
    const first = await backupDatabase(f.sqlite, f.path, now);
    mkdirSync(join(f.dir, "backups", "2026-10-23"), { mode: 0o700 });
    writeFileSync(join(f.dir, "backups", "2026-10-23", "costs.sqlite"), "corrupt placeholder", { mode: 0o600 });
    await assert.rejects(backupDatabase(f.sqlite, f.path, new Date(now.getTime() + 86400_000)));
    assert.equal(f.sqlite.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(readdirSync(join(f.dir, "backups")).filter((n) => n.endsWith(".tmp")).length, 0);
    assert.ok(statSync(first).size > 0);
  } finally { f.cleanup(); }
});


test("legacy quota history survives source removal, including completed periods", () => {
  const f = fixture();
  try {
    const at = now.getTime() / 1000 - 600;
    const current = { at, provider: "grok", minutes: 10080, resets_at: reset, used: 15 };
    const old = { ...current, at: at - 30 * 86400, resets_at: reset - 30 * 86400 };
    const legacy = [current, old, { ...current, used: null }, { ...current, provider: "unknown" }].map((row) => JSON.stringify(row)).join("\n") + "\nmalformed";
    assert.equal(importQuotaHistory(f.sqlite, legacy, now), 2);
    importQuotaHistory(f.sqlite, legacy, now);
    archivePlanUsage(f.sqlite, [plan()], now);
    // The legacy source is now absent; only SQLite supplies the older chart point.
    importQuotaHistory(f.sqlite, "", now);
    assert.equal(windowTrend(quotaHistoryJsonl(f.sqlite, now), "grok", plan().windows[0]).find((p) => p.at === at)?.used, 15);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM quota_observations").get() as {n:number}).n, 3);
    assert.equal((f.sqlite.prepare("SELECT count(*) n FROM quota_observations WHERE resets_at < ?").get(now.getTime()/1000) as {n:number}).n, 1);
  } finally { f.cleanup(); }
});

test("different database files in the same directory get distinct restorable backups", async () => {
  const f = fixture();
  const secondPath = join(f.dir, "second.sqlite");
  const second = new Database(secondPath);
  try {
    f.sqlite.exec("CREATE TABLE marker (name TEXT); INSERT INTO marker VALUES ('first')");
    second.exec("CREATE TABLE marker (name TEXT); INSERT INTO marker VALUES ('second')");
    const a = await backupDatabase(f.sqlite, f.path, now);
    const b = await backupDatabase(second, secondPath, now);
    assert.notEqual(a, b);
    for (const [path, name] of [[a, "first"], [b, "second"]]) {
      const restored = new Database(path, { readonly: true });
      try { assert.deepEqual(restored.prepare("SELECT * FROM marker").all(), [{ name }]); }
      finally { restored.close(); }
    }
  } finally { second.close(); f.cleanup(); }
});
