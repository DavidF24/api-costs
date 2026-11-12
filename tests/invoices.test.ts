import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createRepoResolver, type Repo } from "../src/lib/dev-costs/repos.ts";
import { Conflict, ensureDevCosts, readRegister, saveClient, saveRepoLink, blankProfile } from "../src/lib/dev-costs/store.ts";
import { readTrackerRows, tallyTime, type TrackerRow } from "../src/lib/dev-costs/time.ts";
import {
  addLine, addPayment, buildLines, deleteLine, dueDate, ensureInvoices, issueInvoice, monthRange, periodsClosingIn, readInvoice, readInvoices,
  saveDraft, updateLine, voidInvoice, type InvoiceSource,
} from "../src/lib/dev-costs/invoices.ts";
import type { PeriodView } from "../src/lib/dev-costs/view.ts";

const root = "/Users/me/code";
const repo = (id: string): Repo => ({ id, name: id.split("/").pop()!, path: `${root}/${id}` });
const repos = ["keel", "portal", "portal-api", "side"].map(repo);
const resolver = createRepoResolver(repos, "/Users/me", root);
const client = { contact: "Pat", email: "pat@example.com", address: "1 Main St", paymentTerms: "Net 15", notes: "", internal: false };

test("months run on calendar dates, and a period is billed in the month it closes", () => {
  assert.deepEqual(monthRange("2026-11"), ["2026-11-01", "2026-12-01"]);
  assert.deepEqual(monthRange("2026-12"), ["2026-12-01", "2027-01-01"]);
  const p = (start: string, end: string) => ({ subscription: "claude", start, end }) as PeriodView;
  // Oct 4 – Nov 3 closes in November; Nov 4 – Dec 3 in December; Oct 2 – Nov 1 (last day Oct 31) in October.
  assert.deepEqual(periodsClosingIn("2026-11", [p("2026-10-04", "2026-11-04"), p("2026-11-04", "2026-12-04"), p("2026-10-01", "2026-11-01"), p("2026-11-01", "2026-12-01")]).map((x) => x.start),
    ["2026-10-04", "2026-11-01"]);
  assert.equal(dueDate("2026-12-01", "Net 15"), "2026-12-16");
  assert.equal(dueDate("2026-12-01", "Due on receipt"), "2026-12-01");
});

test("tracked time bills active samples and idle ones within the client's cutoff", () => {
  const row = (ts: string, path: string, state: string, idleSec: number): TrackerRow => ({ ts, projectPath: path, state, idleSec });
  const rows = [
    row("2026-11-05T15:00:00Z", `${root}/keel/.claude/worktrees/fix`, "active", 5),
    row("2026-11-05T15:00:30Z", `${root}/keel`, "idle", 200), // 3m20s idle: within 5
    row("2026-11-05T15:01:00Z", `${root}/keel`, "idle", 400), // 6m40s idle: past 5
    row("2026-11-06T15:00:00Z", `${root}/side`, "idle", 400), // within the default 10
    row("2026-11-06T15:00:30Z", "/Users/me/Documents/notes", "active", 1),
  ];
  const t = tallyTime(rows, resolver, (id) => (id === "keel" ? 5 : 10));
  assert.deepEqual(t.map((x) => [x.label, x.seconds, x.days]), [["keel", 60, 1], ["/Users/me/Documents/notes", 30, 1], ["side", 30, 1]]);
  assert.deepEqual(tallyTime(rows, resolver, () => 0).map((x) => [x.label, x.seconds]), [["/Users/me/Documents/notes", 30], ["keel", 30]]);
});

test("the tracker is read only, by Eastern date, and unattributed time is never billed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-"));
  const path = join(dir, "activity.db");
  const w = new Database(path);
  w.exec(`CREATE TABLE sample_projects (sample_id INTEGER PRIMARY KEY, ts TEXT NOT NULL, app TEXT NOT NULL, state TEXT NOT NULL, idle_sec INTEGER NOT NULL,
    project_path TEXT, project TEXT, method TEXT NOT NULL, built_at TEXT NOT NULL) STRICT`);
  const add = w.prepare(`INSERT INTO sample_projects (ts, app, state, idle_sec, project_path, project, method, built_at) VALUES (?, 'Claude', 'active', 1, ?, 'keel', ?, '2026-12-01T09:00:00Z')`);
  add.run("2026-11-01T03:59:30Z", `${root}/keel`, "observed"); // Oct 31, 11:59 PM Eastern
  add.run("2026-11-01T04:00:00Z", `${root}/keel`, "observed"); // Nov 1, midnight Eastern
  add.run("2026-12-01T04:59:30Z", `${root}/keel`, "codex-log"); // Nov 30, 11:59 PM Eastern (standard time)
  add.run("2026-12-01T05:00:00Z", `${root}/keel`, "observed"); // Dec 1
  add.run("2026-11-10T12:00:00Z", null, "none");
  add.run("2026-11-10T12:00:30Z", `${root}/keel`, "none");
  w.close();
  const { rows, status } = readTrackerRows(path, "2026-11-01", "2026-12-01");
  assert.deepEqual(rows.map((r) => r.ts), ["2026-11-01T04:00:00Z", "2026-12-01T04:59:30Z"]);
  assert.equal(status.available, true);
  assert.equal(status.builtAt, "2026-12-01T09:00:00Z");
  assert.equal(readTrackerRows(join(dir, "missing.db"), "2026-11-01", "2026-12-01").status.available, false);
});

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  ensureDevCosts(db);
  ensureInvoices(db);
  const acme = saveClient(db, { ...client, name: "Acme", sendInvoices: true, hourlyRateUsd: 150, idleCutoffMin: 10 });
  const home = saveClient(db, { ...client, name: "Home", sendInvoices: false, hourlyRateUsd: 0, idleCutoffMin: 10, internal: true });
  saveRepoLink(db, { repo: "portal", clientId: acme, displayName: "Customer portal", projectName: "Portal", hourlyRateUsd: null });
  saveRepoLink(db, { repo: "portal-api", clientId: acme, displayName: "", projectName: "Portal", hourlyRateUsd: 175 });
  saveRepoLink(db, { repo: "keel", clientId: acme, displayName: "", projectName: "", hourlyRateUsd: null });
  saveRepoLink(db, { repo: "side", clientId: home, displayName: "", projectName: "", hourlyRateUsd: null });
  return { db, acme, home };
}
const source: InvoiceSource = { generatedAt: "2026-12-01T10:00:00Z", idleCutoffMin: 10, trackerBuiltAt: null, trackerLatest: null, periods: [] };
const period = {
  subscription: "claude", termId: 1, planName: "Max", feeUsd: 200, start: "2026-10-04", end: "2026-11-04", open: false, prorated: false,
  apiEquivalentUsd: 0, unpricedTokens: 0, unpricedModels: [],
  rows: [
    { key: "repo:portal", label: "portal", repoId: "portal", displayName: "Customer portal", projectName: "Portal", clientId: 1, clientName: "Acme", apiEquivalentUsd: 30, share: 0.3, chargeUsd: 60 },
    { key: "repo:side", label: "side", repoId: "side", displayName: "side", projectName: "side", clientId: 2, clientName: "Home", apiEquivalentUsd: 70, share: 0.7, chargeUsd: 140 },
  ],
} as PeriodView;

test("a client's lines group its repositories by project, at the repository's rate or the client's", () => {
  const { db, acme } = fixture();
  const reg = readRegister(db);
  const time = tallyTime([
    ...Array.from({ length: 240 }, (_, i) => ({ ts: `2026-11-0${1 + (i % 2) + 2}T15:00:00Z`, projectPath: `${root}/portal`, state: "active", idleSec: 1 })), // 2 h over 2 days
    ...Array.from({ length: 60 }, () => ({ ts: "2026-11-05T15:00:00Z", projectPath: `${root}/portal-api/src`, state: "active", idleSec: 1 })), // 0.5 h
    ...Array.from({ length: 30 }, () => ({ ts: "2026-11-06T15:00:00Z", projectPath: `${root}/keel`, state: "active", idleSec: 1 })), // 0.25 h
  ], resolver, () => 10);
  const lines = buildLines(reg.clients.find((c) => c.id === acme)!, reg, time, [period], (id) => id);
  assert.deepEqual(lines.map((l) => [l.groupName, l.kind, l.quantity, l.rateUsd, l.amountUsd]), [
    ["keel", "time", 0.25, 150, 37.5],
    ["Portal", "time", 2, 150, 300],
    ["Portal", "time", 0.5, 175, 87.5],
    ["Portal", "subscription", null, null, 60],
  ]);
  assert.match(lines[1].description, /Customer portal \(2 days\)/);
  assert.match(lines[3].description, /^Claude subscription share · Customer portal · Oct 4 – Nov 3 \(30\.0% of \$200\.00\)$/);
});

test("drafts can be edited and rebuilt; issuing numbers and locks them", () => {
  const { db, acme, home } = fixture();
  const reg = readRegister(db);
  const acmeClient = reg.clients.find((c) => c.id === acme)!;
  const line = { kind: "time" as const, groupName: "Portal", description: "Development time", repo: "portal", quantity: 2, unit: "hours", rateUsd: 150, amountUsd: 300 };
  const id = saveDraft(db, acmeClient, "2026-11", [line], source);
  addLine(db, id, { kind: "other", groupName: "Portal", description: "Credit", repo: null, quantity: null, unit: "", rateUsd: null, amountUsd: -25 });
  const [first] = readInvoice(db, id).lines;
  updateLine(db, first.id, { ...line, quantity: 1.5, amountUsd: 999 }); // the amount follows hours × rate
  let inv = readInvoice(db, id);
  assert.deepEqual(inv.lines.map((l) => l.amountUsd), [225, -25]);
  assert.equal(inv.totalUsd, 200);
  assert.equal(inv.kind, "invoice");
  // Rebuilding replaces the lines of the same draft rather than starting a second one.
  assert.equal(saveDraft(db, acmeClient, "2026-11", [line], source), id);
  assert.equal(readInvoice(db, id).totalUsd, 300);

  assert.equal(issueInvoice(db, id, "2026-12-01", { ...blankProfile, businessName: "Me LLC" }), "INV-2026-001");
  inv = readInvoice(db, id);
  assert.deepEqual([inv.status, inv.dueOn, inv.from?.businessName, inv.billTo.email], ["issued", "2026-12-16", "Me LLC", "pat@example.com"]);
  assert.throws(() => updateLine(db, inv.lines[0].id, line), Conflict);
  assert.throws(() => deleteLine(db, inv.lines[0].id), Conflict);
  assert.throws(() => saveDraft(db, acmeClient, "2026-11", [], source), Conflict);
  // Later edits to the client do not change what was issued.
  saveClient(db, { ...client, id: acme, name: "Acme Corp", email: "new@example.com", sendInvoices: true, hourlyRateUsd: 150, idleCutoffMin: 10 });
  assert.equal(readInvoice(db, id).billTo.name, "Acme");

  // Track-only clients get statements, numbered separately.
  const stm = saveDraft(db, reg.clients.find((c) => c.id === home)!, "2026-11", [], source);
  assert.equal(issueInvoice(db, stm, "2026-12-01", blankProfile), "STM-2026-001");
  const next = saveDraft(db, acmeClient, "2026-12", [line], source);
  assert.equal(issueInvoice(db, next, "2027-01-02", blankProfile), "INV-2027-001");
});

test("payments reduce the balance, and voiding keeps the number in the history", () => {
  const { db, acme } = fixture();
  const acmeClient = readRegister(db).clients.find((c) => c.id === acme)!;
  const line = { kind: "other" as const, groupName: "", description: "Work", repo: null, quantity: null, unit: "", rateUsd: null, amountUsd: 100 };
  const id = saveDraft(db, acmeClient, "2026-11", [line], source);
  assert.throws(() => addPayment(db, id, { paidOn: "2026-12-02", amountUsd: 10, method: "", note: "" }), Conflict);
  issueInvoice(db, id, "2026-12-01", blankProfile);
  addPayment(db, id, { paidOn: "2026-12-05", amountUsd: 40, method: "Check", note: "" });
  assert.deepEqual([readInvoice(db, id).paidUsd, readInvoice(db, id).balanceUsd], [40, 60]);
  assert.throws(() => voidInvoice(db, id), Conflict);
  db.prepare("DELETE FROM dc_payments").run();
  voidInvoice(db, id);
  assert.deepEqual(readInvoices(db).map((i) => [i.status, i.number]), [["void", "INV-2026-001"]]);
  // The month can then be billed again, under a new number.
  const again = saveDraft(db, acmeClient, "2026-11", [line], source);
  assert.notEqual(again, id);
  assert.equal(issueInvoice(db, again, "2026-12-03", blankProfile), "INV-2026-002");
  // A draft is simply deleted.
  const draft = saveDraft(db, acmeClient, "2026-12", [line], source);
  voidInvoice(db, draft);
  assert.equal(readInvoices(db).some((i) => i.id === draft), false);
});
