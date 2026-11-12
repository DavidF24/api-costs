import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { billingPeriods, renewalDate, splitFee, type Term } from "../src/lib/dev-costs/split.ts";
import { createRepoResolver, encodeClaudeDir, listRepos, type Repo } from "../src/lib/dev-costs/repos.ts";
import {
  Conflict, deleteClient, ensureActivityCwd, ensureDevCosts, readFolderUsage, readRegister, saveClient, saveRepoLink, saveTerm,
} from "../src/lib/dev-costs/store.ts";
import { buildDevCostsView } from "../src/lib/dev-costs/view.ts";

const term = (t: Partial<Term>): Term => ({ id: 1, subscription: "claude", planName: "Max", feeUsd: 200, renewalDay: 4, startsOn: "2026-11-04", ...t });

test("renewal dates fall on the last day of shorter months", () => {
  assert.equal(renewalDate(2027, 1, 31, 1), "2027-02-28");
  assert.equal(renewalDate(2026, 12, 4, 1), "2027-01-04");
  assert.equal(renewalDate(2026, 11, 20, 0), "2026-11-20");
});

test("billing periods follow the renewal day, run newest first and mark the open period", () => {
  const periods = billingPeriods([term({ id: 3, subscription: "grok", feeUsd: 100, renewalDay: 20, startsOn: "2026-10-20" })], "2026-11-25");
  assert.deepEqual(periods.map((p) => [p.start, p.end, p.open]), [["2026-11-20", "2026-12-20", true], ["2026-10-20", "2026-11-20", false]]);
  // A first date between renewal days ends at the next renewal and pays only for its days
  // (19 of the 31 days from Oct 20 to Nov 20).
  assert.deepEqual(billingPeriods([term({ renewalDay: 20, startsOn: "2026-11-01" })], "2026-11-05").map((p) => [p.start, p.end, p.feeUsd, p.prorated]), [["2026-11-01", "2026-11-20", 122.58, true]]);
  assert.deepEqual(billingPeriods([term({ startsOn: "2026-12-04" })], "2026-11-11"), []);
});

test("a fee change starts on its own date and earlier periods keep the old fee", () => {
  const periods = billingPeriods([
    term({ id: 1, subscription: "codex", feeUsd: 200, renewalDay: 2, startsOn: "2026-09-02" }),
    term({ id: 2, subscription: "codex", feeUsd: 500, renewalDay: 3, startsOn: "2026-11-03" }),
  ], "2026-11-11");
  assert.deepEqual(periods.map((p) => [p.start, p.end, p.feeUsd]), [
    // The old plan's renewal on Nov 2 covered one day before the upgrade: 1/30 of $200.
    ["2026-11-03", "2026-12-03", 500], ["2026-11-02", "2026-11-03", 6.67], ["2026-10-02", "2026-11-02", 200], ["2026-09-02", "2026-10-02", 200],
  ]);
  assert.deepEqual(periods.map((p) => p.prorated), [false, true, false, false]);
});

test("an upgrade between renewal days prorates both the old and the new fee", () => {
  const periods = billingPeriods([
    term({ id: 1, feeUsd: 200, renewalDay: 4, startsOn: "2026-11-04" }),
    term({ id: 2, feeUsd: 500, renewalDay: 4, startsOn: "2026-11-20" }),
  ], "2026-12-10");
  assert.deepEqual(periods.map((p) => [p.start, p.end, p.feeUsd]), [
    ["2026-12-04", "2027-01-04", 500], ["2026-11-20", "2026-12-04", 233.33], ["2026-11-04", "2026-11-20", 106.67],
  ]);
});

test("the whole fee is split by API-equivalent share in cents that add up exactly", () => {
  const lines = splitFee(100, [{ key: "a", apiEquivalentUsd: 1 }, { key: "b", apiEquivalentUsd: 1 }, { key: "c", apiEquivalentUsd: 1 }, { key: "z", apiEquivalentUsd: 0 }], "none");
  assert.equal(lines.reduce((s, l) => s + Math.round(l.chargeUsd * 100), 0), 10000);
  assert.deepEqual(lines.map((l) => l.chargeUsd).sort(), [33.33, 33.33, 33.34]);
  assert.ok(!lines.some((l) => l.key === "z"));
  // Using half the plan does not halve the bill: two equal repos each pay half of it.
  assert.deepEqual(splitFee(200, [{ key: "a", apiEquivalentUsd: 40 }, { key: "b", apiEquivalentUsd: 40 }], "none").map((l) => l.chargeUsd), [100, 100]);
  assert.deepEqual(splitFee(50, [], "none"), [{ key: "none", apiEquivalentUsd: 0, share: 1, chargeUsd: 50 }]);
});

const root = "/Users/me/code";
const repo = (id: string): Repo => ({ id, name: id.split("/").pop()!, path: `${root}/${id}` });
const repos = ["keel", "hazel-care", "hazel-care-kids", "ms-pro/mspro-rc", "n0rd-v8", "renovo-lending", "ms-pro/_reference/mspro-rc"].map(repo);
const resolver = createRepoResolver(repos, "/Users/me", root);

test("worktrees, subfolders and file URLs resolve to their repository", () => {
  const cases: [string, string | null][] = [
    [`${root}/keel/.claude/worktrees/fix-abc123`, "keel"],
    [`${root}/keel/.worktrees/feature/sub`, "keel"],
    [`${root}/renovo-lending.worktrees.calculation-core.worktrees.borrower-engine`, "renovo-lending"],
    [`file://${root}/n0rd-v8/data/worktrees/staging-upload-privacy/frontend`, "n0rd-v8"],
    [`${root}/hazel-care-kids/web`, "hazel-care-kids"],
    [`${root}/hazel-care`, "hazel-care"],
    ["/Users/me/.codex/worktrees/01-access-audit/keel", "keel"],
    ["/Users/me/.codex/worktrees/02-encryption/keel.worktrees.codex/02-encryption-grok", "keel"],
    ["/Users/me/.codex/worktrees/03/mspro-rc", null], // two repos share this folder name
    [`${root}/ms-pro/mspro-rc/src`, "ms-pro/mspro-rc"],
    ["/Users/me/Documents/Codex/2026-11-05/can", null],
    [`${root}/hazel`, "hazel"], // a project folder without git
    [`${root}/ms-pro/notes/today`, "ms-pro/notes"], // ms-pro groups repositories
    [`${root}/.cache/x`, null],
  ];
  for (const [cwd, id] of cases) assert.equal(resolver.fromCwd(cwd)?.id ?? null, id, cwd);
});

test("a worktree with any folder name resolves through its .git file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-costs-wt-"));
  mkdirSync(join(dir, "main/.git/worktrees/side"), { recursive: true });
  mkdirSync(join(dir, "side-checkout/web"), { recursive: true });
  writeFileSync(join(dir, "side-checkout/.git"), `gitdir: ${dir}/main/.git/worktrees/side\n`);
  const r = createRepoResolver(listRepos(dir), "/Users/me", dir);
  assert.equal(r.fromCwd(join(dir, "side-checkout/web"))?.id, "main");
  assert.equal(r.fromCwd(join(dir, "other"))?.git, false);
});

test("old Claude rows resolve from the encoded transcript folder, never a partial name", () => {
  const key = (p: string) => `claude-code:${encodeClaudeDir(p)}/abc.jsonl`;
  assert.equal(resolver.fromClaudeKey(key(`${root}/hazel-care-kids/.claude/worktrees/x`))?.id, "hazel-care-kids");
  assert.equal(resolver.fromClaudeKey(key(`${root}/renovo-lending.worktrees.renovo-ci`))?.id, "renovo-lending");
  assert.equal(resolver.fromClaudeKey(key(`${root}/keelson`)), null);
  assert.equal(resolver.fromClaudeKey(key(`${root}/keel-old`)), null);
  assert.equal(resolver.fromClaudeKey(key(`${root}/keel/.worktrees/a`))?.id, "keel");
  assert.equal(resolver.fromClaudeKey("codex:2026/11/01/rollout.jsonl"), null);
  assert.equal(resolver.fromName("keel")?.id, "keel");
  assert.equal(resolver.fromName("mspro-rc"), null);
});

test("repository discovery lists real repositories and skips worktree checkouts", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-costs-"));
  for (const p of ["alpha/.git", "group/beta/.git", "alpha/node_modules/pkg/.git", "alpha.worktrees.x"]) mkdirSync(join(dir, p), { recursive: true });
  mkdirSync(join(dir, "wt"), { recursive: true });
  writeFileSync(join(dir, "wt", ".git"), "gitdir: ../alpha/.git/worktrees/wt\n");
  assert.deepEqual(listRepos(dir).map((r) => r.id), ["alpha", "group/beta"]);
});

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureDevCosts(db);
  return db;
}
const client = { contact: "", email: "", address: "", paymentTerms: "", notes: "", hourlyRateUsd: 0, idleCutoffMin: 10 };
const link = (repo: string, clientId: number | null, more: Partial<{ displayName: string; projectName: string; hourlyRateUsd: number | null }> = {}) =>
  ({ repo, clientId, displayName: "", projectName: "", hourlyRateUsd: null, ...more });

test("repositories link straight to a client, with an optional shared project name", () => {
  const db = fixture();
  const renovo = saveClient(db, { ...client, name: "Renovo", internal: true, sendInvoices: false });
  const acme = saveClient(db, { ...client, name: "Acme", internal: false, sendInvoices: true, hourlyRateUsd: 150, idleCutoffMin: 5 });
  saveRepoLink(db, link("keel", renovo));
  saveRepoLink(db, link("keel", acme, { projectName: "Portal", displayName: "Customer portal" })); // relinking replaces the old link
  saveRepoLink(db, link("portal-api", acme, { projectName: "portal", hourlyRateUsd: 175 })); // joins the existing spelling
  const reg = readRegister(db);
  assert.deepEqual(reg.repoLinks, {
    keel: { clientId: acme, displayName: "Customer portal", projectName: "Portal", hourlyRateUsd: null },
    "portal-api": { clientId: acme, displayName: "", projectName: "Portal", hourlyRateUsd: 175 },
  });
  assert.deepEqual(reg.clients.map((c) => [c.name, c.hourlyRateUsd, c.idleCutoffMin]), [["Acme", 150, 5], ["Renovo", 0, 10]]);
  assert.throws(() => deleteClient(db, acme), Conflict);
  saveRepoLink(db, link("keel", null));
  saveRepoLink(db, link("portal-api", null));
  deleteClient(db, acme);
  assert.deepEqual(readRegister(db).repoLinks, {});
  assert.throws(() => saveClient(db, { ...client, name: "renovo", internal: false, sendInvoices: true }), /UNIQUE/);
  assert.throws(() => saveRepoLink(db, link("x", 999)), /Client not found/);
});

test("existing project links move to repository links once, keeping the client and invoicing choice", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // The slice-1 register: client -> project -> repository.
  db.exec(`CREATE TABLE dc_clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', payment_terms TEXT NOT NULL DEFAULT '', internal INTEGER NOT NULL DEFAULT 0, send_invoices INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL) STRICT;
    CREATE TABLE dc_projects (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES dc_clients(id), name TEXT NOT NULL COLLATE NOCASE,
      send_invoices INTEGER, created_at TEXT NOT NULL, UNIQUE (client_id, name)) STRICT;
    CREATE TABLE dc_repo_projects (repo TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES dc_projects(id) ON DELETE CASCADE) STRICT;
    INSERT INTO dc_clients (id, name, internal, send_invoices, created_at) VALUES (1, 'Hattie', 0, 0, 'x'), (2, 'Renovo', 1, 0, 'x'), (3, 'Acme', 0, 1, 'x');
    INSERT INTO dc_projects (id, client_id, name, send_invoices, created_at) VALUES (1, 1, 'Hattie App', 1, 'x'), (2, 2, 'Tools', NULL, 'x');
    INSERT INTO dc_repo_projects VALUES ('hattie.com', 1), ('tools', 2);`);
  ensureDevCosts(db);
  const reg = readRegister(db);
  assert.deepEqual(reg.repoLinks, {
    "hattie.com": { clientId: 1, displayName: "", projectName: "Hattie App", hourlyRateUsd: null },
    tools: { clientId: 2, displayName: "", projectName: "Tools", hourlyRateUsd: null },
  });
  assert.deepEqual(reg.clients.map((c) => [c.name, c.sendInvoices, c.idleCutoffMin]), [["Acme", true, 10], ["Hattie", true, 10], ["Renovo", false, 10]]);
  // A second start does not re-copy links that were since changed.
  saveRepoLink(db, link("tools", null));
  ensureDevCosts(db);
  assert.deepEqual(Object.keys(readRegister(db).repoLinks), ["hattie.com"]);
});

test("adding the folder column clears the change cache once so transcripts are re-read", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE activity_usage (id INTEGER PRIMARY KEY, path TEXT NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL,
    messages INTEGER NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL, cache_write_1h INTEGER NOT NULL, est_cost_usd REAL);
    CREATE TABLE activity_files (path TEXT PRIMARY KEY, source TEXT, size INTEGER, mtime_ms INTEGER, parsed_at TEXT);
    INSERT INTO activity_files VALUES ('k','codex',1,1,'x');
    INSERT INTO activity_usage (path,date,source,project,model,messages,input,output,cache_read,cache_write_5m,cache_write_1h) VALUES ('k','2026-11-05','codex','keel','gpt-5',1,1,1,0,0,0);`);
  ensureActivityCwd(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_files").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_usage").get() as { n: number }).n, 1, "history is kept");
  db.exec("INSERT INTO activity_files VALUES ('k','codex',1,1,'x')");
  ensureActivityCwd(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_files").get() as { n: number }).n, 1, "runs only once");
});

test("the one-time re-read still happens when drizzle-kit already added the column", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE activity_usage (id INTEGER PRIMARY KEY, cwd TEXT);
    CREATE TABLE activity_files (path TEXT PRIMARY KEY); INSERT INTO activity_files VALUES ('k');`);
  ensureActivityCwd(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_files").get() as { n: number }).n, 0);
});

test("the view splits each period's fee by repository and names its client and project", () => {
  const db = fixture();
  db.exec(`CREATE TABLE activity_usage (id INTEGER PRIMARY KEY, path TEXT NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL, project TEXT NOT NULL, cwd TEXT, model TEXT NOT NULL,
    messages INTEGER NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL, cache_write_1h INTEGER NOT NULL, est_cost_usd REAL)`);
  const add = db.prepare(`INSERT INTO activity_usage (path,date,source,project,cwd,model,messages,input,output,cache_read,cache_write_5m,cache_write_1h) VALUES (?,?,?,?,?,?,1,?,0,0,0,0)`);
  const model = "claude-sonnet-4-5";
  add.run("a", "2026-11-05", "claude-code", "fix-1", `${root}/keel/.claude/worktrees/fix-1`, model, 1_000_000);
  add.run(`claude-code:${encodeClaudeDir(`${root}/hazel-care/.claude/worktrees/old`)}/s.jsonl`, "2026-11-06", "claude-code", "old", null, model, 1_000_000);
  add.run("c", "2026-11-07", "claude-code", "can", "/Users/me/Documents/Codex/can", model, 2_000_000);
  add.run("d", "2026-11-03", "claude-code", "keel", `${root}/keel`, model, 9_000_000); // before the period
  add.run("e", "2026-11-07", "codex", "keel", `${root}/keel`, "gpt-5", 9_000_000); // another subscription
  add.run("f", "2026-11-07", "claude-code", "keel", `${root}/keel`, "unknown-model", 5);
  add.run("g", "2026-11-08", "claude-code", "keel", "/Users/me/Downloads/keel", model, 1_000_000); // same name, not the repo
  const acme = saveClient(db, { ...client, name: "Acme", internal: false, sendInvoices: true });
  saveRepoLink(db, link("keel", acme, { projectName: "Portal" }));
  saveTerm(db, { subscription: "claude", planName: "Max", feeUsd: 200, renewalDay: 4, startsOn: "2026-11-04" });
  const view = buildDevCostsView({
    register: readRegister(db), repos, resolver, today: "2026-11-11", repoWindowStart: "2026-08-13",
    usage: (s, e, src) => readFolderUsage(db, s, e, src),
  });
  const claude = view.subscriptions.find((s) => s.id === "claude")!;
  assert.equal(claude.periods.length, 1);
  const [period] = claude.periods;
  assert.equal(period.open, true);
  assert.deepEqual(period.rows.map((r) => [r.label, r.chargeUsd, r.projectName, r.clientName]).sort(), [
    ["can", 80, "Unassigned", "Unassigned"],
    ["hazel-care", 40, "Unassigned", "Unassigned"],
    ["keel", 40, "Portal", "Acme"],
    ["keel", 40, "Unassigned", "Unassigned"],
  ]);
  assert.equal(period.rows.find((r) => r.key === "folder:keel")?.repoId, null);
  assert.deepEqual(period.unpricedModels, ["unknown-model"]);
  assert.equal(view.subscriptions.find((s) => s.id === "codex")!.periods.length, 0);
  assert.equal(view.repos.find((r) => r.id === "keel")!.link?.clientId, acme);
  assert.equal(period.rows.find((r) => r.key === "repo:hazel-care")?.displayName, "hazel-care");
});
