// Clients, the repositories billed to each, and subscription fees for Development costs.
// Takes a plain better-sqlite3 handle (no path aliases) so tests use an in-memory database.
import type Database from "better-sqlite3";
import type { SubscriptionId, Term } from "./split.ts";

export const DEFAULT_IDLE_CUTOFF_MIN = 10;

export type Client = {
  id: number;
  name: string;
  contact: string;
  email: string;
  address: string;
  paymentTerms: string;
  internal: boolean;
  sendInvoices: boolean; // off = track only: a statement is kept but not sent
  notes: string;
  hourlyRateUsd: number;
  idleCutoffMin: number; // idle time after the last input still billed, in minutes
};
// A repository billed to a client. The project name is an optional label: repositories of
// one client with the same project name are billed together under it.
export type RepoLink = {
  clientId: number;
  displayName: string; // shown to the client in place of the folder name; blank = folder name
  projectName: string;
  hourlyRateUsd: number | null; // null = the client's rate
};
export type Register = { clients: Client[]; repoLinks: Record<string, RepoLink>; terms: Term[] };

export function ensureDevCosts(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS dc_clients (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT '', internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1)),
    send_invoices INTEGER NOT NULL DEFAULT 1 CHECK (send_invoices IN (0,1)), notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dc_projects (
    id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES dc_clients(id),
    name TEXT NOT NULL COLLATE NOCASE, send_invoices INTEGER CHECK (send_invoices IN (0,1)),
    created_at TEXT NOT NULL, UNIQUE (client_id, name)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dc_repo_projects (
    repo TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES dc_projects(id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dc_subscription_terms (
    id INTEGER PRIMARY KEY, subscription TEXT NOT NULL CHECK (subscription IN ('claude','codex','grok')),
    plan_name TEXT NOT NULL DEFAULT '', fee_usd REAL NOT NULL CHECK (fee_usd >= 0),
    renewal_day INTEGER NOT NULL CHECK (renewal_day BETWEEN 1 AND 31), starts_on TEXT NOT NULL,
    UNIQUE (subscription, starts_on)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dc_repos (
    repo TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES dc_clients(id),
    display_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '',
    hourly_rate_usd REAL CHECK (hourly_rate_usd IS NULL OR hourly_rate_usd >= 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;`);
  migrateToRepoBilling(db);
}

// Billing moved from client -> project -> repository to repositories linked straight to a
// client, with the project as an optional label. Runs once (marker row). Each linked
// repository keeps its client and takes its old project's name as its label. Invoicing
// becomes a client setting: a client is set to send invoices when any of its projects was
// set to send them. Where a client's linked projects disagreed (some sent, some track
// only), their names are kept in dc_meta ('repo_billing_conflicts') and shown on the tab.
// The old project tables are left in place, unused.
function migrateToRepoBilling(db: Database.Database) {
  const columns = () => (db.prepare(`SELECT name FROM pragma_table_info('dc_clients')`).all() as { name: string }[]).map((c) => c.name);
  const marked = () => !!db.prepare(`SELECT 1 FROM dc_meta WHERE key='repo_billing'`).get();
  const cols0 = columns();
  if (cols0.includes("hourly_rate_usd") && cols0.includes("idle_cutoff_min") && marked()) return; // a plain read: no write lock on every start
  db.transaction(() => {
    const cols = columns();
    if (!cols.includes("hourly_rate_usd")) db.exec(`ALTER TABLE dc_clients ADD COLUMN hourly_rate_usd REAL NOT NULL DEFAULT 0 CHECK (hourly_rate_usd >= 0)`);
    if (!cols.includes("idle_cutoff_min")) db.exec(`ALTER TABLE dc_clients ADD COLUMN idle_cutoff_min INTEGER NOT NULL DEFAULT ${DEFAULT_IDLE_CUTOFF_MIN} CHECK (idle_cutoff_min BETWEEN 0 AND 240)`);
    if (marked()) return;
    const conflicts = (db.prepare(`SELECT c.name FROM dc_clients c JOIN dc_projects p ON p.client_id = c.id
        WHERE EXISTS (SELECT 1 FROM dc_repo_projects rp WHERE rp.project_id = p.id)
        GROUP BY c.id HAVING COUNT(DISTINCT COALESCE(p.send_invoices, c.send_invoices)) > 1 ORDER BY c.name`).all() as { name: string }[]).map((r) => r.name);
    db.exec(`INSERT OR IGNORE INTO dc_repos (repo, client_id, display_name, project_name, hourly_rate_usd)
        SELECT rp.repo, p.client_id, '', p.name, NULL FROM dc_repo_projects rp JOIN dc_projects p ON p.id = rp.project_id;
      UPDATE dc_clients SET send_invoices = 1
        WHERE send_invoices = 0 AND EXISTS (SELECT 1 FROM dc_projects p WHERE p.client_id = dc_clients.id AND p.send_invoices = 1);`);
    if (conflicts.length) {
      db.prepare(`INSERT OR REPLACE INTO dc_meta (key, value) VALUES ('repo_billing_conflicts', ?)`).run(JSON.stringify(conflicts));
      console.warn(`Development costs: invoicing is now set per client. Check these clients, whose projects had different settings: ${conflicts.join(", ")}`);
    }
    db.prepare(`INSERT INTO dc_meta (key, value) VALUES ('repo_billing', ?)`).run(new Date().toISOString());
  }).immediate();
}

// Clients whose old projects had different invoicing settings when billing moved to
// repositories; shown on the tab until dismissed.
export function readMigrationConflicts(db: Database.Database): string[] {
  const row = db.prepare(`SELECT value FROM dc_meta WHERE key='repo_billing_conflicts'`).get() as { value: string } | undefined;
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}
export function dismissMigrationConflicts(db: Database.Database) {
  db.prepare(`DELETE FROM dc_meta WHERE key='repo_billing_conflicts'`).run();
}

// Activity rows now keep the full working folder. The file change cache is cleared once,
// so the next index re-reads every transcript still on disk and records it. A marker row,
// not the column, records that this happened: `drizzle-kit push` may add the column first.
// Rows for transcripts that are gone keep NULL; repos.ts resolves those another way.
// IMMEDIATE takes the write lock before checking, so two processes opening the database at
// once cannot both try to add the column.
export function ensureActivityCwd(db: Database.Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS dc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`);
    const cols = db.prepare(`SELECT name FROM pragma_table_info('activity_usage')`).all() as { name: string }[];
    if (cols.length === 0) return; // a new database; drizzle-kit creates the table with the column
    if (!cols.some((c) => c.name === "cwd")) db.exec(`ALTER TABLE activity_usage ADD COLUMN cwd TEXT`);
    if (db.prepare(`SELECT 1 FROM dc_meta WHERE key='activity_cwd_reindex'`).get()) return;
    db.exec(`DELETE FROM activity_files`);
    db.prepare(`INSERT INTO dc_meta (key, value) VALUES ('activity_cwd_reindex', ?)`).run(new Date().toISOString());
  }).immediate();
}

type ClientRow = {
  id: number; name: string; contact: string; email: string; address: string; payment_terms: string; internal: number;
  send_invoices: number; notes: string; hourly_rate_usd: number; idle_cutoff_min: number;
};

export function readRegister(db: Database.Database): Register {
  const clients = (db.prepare(`SELECT * FROM dc_clients ORDER BY internal, name`).all() as ClientRow[]).map((c) => ({
    id: c.id, name: c.name, contact: c.contact, email: c.email, address: c.address, paymentTerms: c.payment_terms,
    internal: c.internal === 1, sendInvoices: c.send_invoices === 1, notes: c.notes,
    hourlyRateUsd: c.hourly_rate_usd, idleCutoffMin: c.idle_cutoff_min,
  }));
  const repoLinks = Object.fromEntries((db.prepare(`SELECT repo, client_id, display_name, project_name, hourly_rate_usd FROM dc_repos`).all() as
    { repo: string; client_id: number; display_name: string; project_name: string; hourly_rate_usd: number | null }[]).map((r) =>
    [r.repo, { clientId: r.client_id, displayName: r.display_name, projectName: r.project_name, hourlyRateUsd: r.hourly_rate_usd }]));
  const terms = (db.prepare(`SELECT id, subscription, plan_name, fee_usd, renewal_day, starts_on FROM dc_subscription_terms ORDER BY subscription, starts_on`).all() as
    { id: number; subscription: SubscriptionId; plan_name: string; fee_usd: number; renewal_day: number; starts_on: string }[]).map((t) => ({
    id: t.id, subscription: t.subscription, planName: t.plan_name, feeUsd: t.fee_usd, renewalDay: t.renewal_day, startsOn: t.starts_on,
  }));
  return { clients, repoLinks, terms };
}

export type ClientInput = Omit<Client, "id"> & { id?: number };
export function saveClient(db: Database.Database, c: ClientInput, now = new Date()): number {
  const values = {
    name: c.name, contact: c.contact, email: c.email, address: c.address, terms: c.paymentTerms, internal: c.internal ? 1 : 0,
    send: c.sendInvoices ? 1 : 0, notes: c.notes, rate: c.hourlyRateUsd, cutoff: c.idleCutoffMin,
  };
  if (c.id) {
    const changed = db.prepare(`UPDATE dc_clients SET name=@name, contact=@contact, email=@email, address=@address, payment_terms=@terms,
      internal=@internal, send_invoices=@send, notes=@notes, hourly_rate_usd=@rate, idle_cutoff_min=@cutoff WHERE id=@id`).run({ ...values, id: c.id }).changes;
    if (!changed) throw new NotFound("Client not found");
    return c.id;
  }
  return Number(db.prepare(`INSERT INTO dc_clients (name, contact, email, address, payment_terms, internal, send_invoices, notes, hourly_rate_usd, idle_cutoff_min, created_at)
    VALUES (@name, @contact, @email, @address, @terms, @internal, @send, @notes, @rate, @cutoff, @at)`).run({ ...values, at: now.toISOString() }).lastInsertRowid);
}

export function deleteClient(db: Database.Database, id: number) {
  const repos = db.prepare(`SELECT COUNT(*) AS n FROM dc_repos WHERE client_id=?`).get(id) as { n: number };
  if (repos.n > 0) throw new Conflict("Unlink this client's repositories first");
  const invoices = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name='dc_invoices'`).get() as { n: number };
  if (invoices.n > 0 && (db.prepare(`SELECT COUNT(*) AS n FROM dc_invoices WHERE client_id=?`).get(id) as { n: number }).n > 0) {
    throw new Conflict("This client has invoices or statements; they are kept as history");
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM dc_repo_projects WHERE project_id IN (SELECT id FROM dc_projects WHERE client_id=?)`).run(id);
    db.prepare(`DELETE FROM dc_projects WHERE client_id=?`).run(id);
    if (!db.prepare(`DELETE FROM dc_clients WHERE id=?`).run(id).changes) throw new NotFound("Client not found");
  })();
}

export type RepoLinkInput = { repo: string; clientId: number | null; displayName: string; projectName: string; hourlyRateUsd: number | null };
// Links a repository to a client, or unlinks it when clientId is null.
export function saveRepoLink(db: Database.Database, r: RepoLinkInput) {
  if (r.clientId === null) {
    db.prepare(`DELETE FROM dc_repos WHERE repo=?`).run(r.repo);
    return;
  }
  if (!db.prepare(`SELECT 1 FROM dc_clients WHERE id=?`).get(r.clientId)) throw new NotFound("Client not found");
  // Reuse the spelling of a project name the client already has, so "Rustica" and
  // "rustica" do not become two projects on the invoice.
  const existing = r.projectName
    ? (db.prepare(`SELECT project_name FROM dc_repos WHERE client_id=? AND project_name=? COLLATE NOCASE AND repo<>? LIMIT 1`).get(r.clientId, r.projectName, r.repo) as { project_name: string } | undefined)
    : undefined;
  db.prepare(`INSERT INTO dc_repos (repo, client_id, display_name, project_name, hourly_rate_usd) VALUES (@repo, @client, @display, @project, @rate)
    ON CONFLICT(repo) DO UPDATE SET client_id=excluded.client_id, display_name=excluded.display_name, project_name=excluded.project_name, hourly_rate_usd=excluded.hourly_rate_usd`)
    .run({ repo: r.repo, client: r.clientId, display: r.displayName, project: existing?.project_name ?? r.projectName, rate: r.hourlyRateUsd });
}

// Billing settings shown on every invoice: who it is from and how to pay. Local only.
export type BillingProfile = { businessName: string; address: string; email: string; phone: string; paymentInstructions: string };
const PROFILE_KEY = "billing_profile";
export const blankProfile: BillingProfile = { businessName: "", address: "", email: "", phone: "", paymentInstructions: "" };
export function readProfile(db: Database.Database): BillingProfile {
  const row = db.prepare(`SELECT value FROM dc_meta WHERE key=?`).get(PROFILE_KEY) as { value: string } | undefined;
  if (!row) return { ...blankProfile };
  try { return { ...blankProfile, ...JSON.parse(row.value) }; } catch { return { ...blankProfile }; }
}
export function saveProfile(db: Database.Database, p: BillingProfile) {
  db.prepare(`INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(PROFILE_KEY, JSON.stringify(p));
}

export type TermInput = Omit<Term, "id"> & { id?: number };
export function saveTerm(db: Database.Database, t: TermInput): number {
  const v = { sub: t.subscription, plan: t.planName, fee: t.feeUsd, day: t.renewalDay, starts: t.startsOn };
  if (t.id) {
    if (!db.prepare(`UPDATE dc_subscription_terms SET subscription=@sub, plan_name=@plan, fee_usd=@fee, renewal_day=@day, starts_on=@starts WHERE id=@id`).run({ ...v, id: t.id }).changes) throw new NotFound("Fee not found");
    return t.id;
  }
  return Number(db.prepare(`INSERT INTO dc_subscription_terms (subscription, plan_name, fee_usd, renewal_day, starts_on) VALUES (@sub,@plan,@fee,@day,@starts)`).run(v).lastInsertRowid);
}

export function deleteTerm(db: Database.Database, id: number) {
  if (!db.prepare(`DELETE FROM dc_subscription_terms WHERE id=?`).run(id).changes) throw new NotFound("Fee not found");
}

export type UsageRow = {
  source: string; model: string; cwd: string | null; project: string; path: string;
  input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number;
};

// Token totals per source, model and working folder for [start, end) Eastern dates.
export function readFolderUsage(db: Database.Database, start: string, end: string, sources: readonly string[]): UsageRow[] {
  if (sources.length === 0) return [];
  const marks = sources.map(() => "?").join(",");
  // Old rows have no folder; the transcript key is kept so repos.ts can still resolve them.
  return db.prepare(`SELECT source, model, cwd, project, CASE WHEN cwd IS NULL THEN path ELSE '' END AS path,
      SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cacheRead,
      SUM(cache_write_5m) AS cacheWrite5m, SUM(cache_write_1h) AS cacheWrite1h
    FROM activity_usage WHERE date >= ? AND date < ? AND source IN (${marks})
    GROUP BY source, model, cwd, project, 5`).all(start, end, ...sources) as UsageRow[];
}

export class NotFound extends Error {}
export class Conflict extends Error {}
