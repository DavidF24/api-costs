// Clients, projects, repository links and subscription fees for Development costs.
// Takes a plain better-sqlite3 handle (no path aliases) so tests use an in-memory database.
import type Database from "better-sqlite3";
import type { SubscriptionId, Term } from "./split.ts";

export type Client = {
  id: number;
  name: string;
  contact: string;
  email: string;
  address: string;
  paymentTerms: string;
  internal: boolean;
  sendInvoices: boolean;
  notes: string;
};
export type Project = {
  id: number;
  clientId: number;
  name: string;
  sendInvoices: boolean | null; // null follows the client
  effectiveSendInvoices: boolean;
};
export type Register = { clients: Client[]; projects: Project[]; repoProjects: Record<string, number>; terms: Term[] };

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
  ) STRICT;`);
}

// Activity rows now keep the full working folder. Adding the column clears the file
// change cache once, so the next index re-reads every transcript still on disk and fills it.
// Rows for transcripts that are gone keep NULL; repos.ts resolves those another way.
export function ensureActivityCwd(db: Database.Database) {
  const cols = db.prepare(`SELECT name FROM pragma_table_info('activity_usage')`).all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "cwd")) return;
  db.transaction(() => {
    db.exec(`ALTER TABLE activity_usage ADD COLUMN cwd TEXT`);
    db.exec(`DELETE FROM activity_files`);
  })();
}

type ClientRow = { id: number; name: string; contact: string; email: string; address: string; payment_terms: string; internal: number; send_invoices: number; notes: string };

export function readRegister(db: Database.Database): Register {
  const clients = (db.prepare(`SELECT * FROM dc_clients ORDER BY internal, name`).all() as ClientRow[]).map((c) => ({
    id: c.id, name: c.name, contact: c.contact, email: c.email, address: c.address, paymentTerms: c.payment_terms,
    internal: c.internal === 1, sendInvoices: c.send_invoices === 1, notes: c.notes,
  }));
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const projects = (db.prepare(`SELECT id, client_id, name, send_invoices FROM dc_projects ORDER BY name`).all() as
    { id: number; client_id: number; name: string; send_invoices: number | null }[]).map((p) => {
    const own = p.send_invoices === null ? null : p.send_invoices === 1;
    return { id: p.id, clientId: p.client_id, name: p.name, sendInvoices: own, effectiveSendInvoices: own ?? byClient.get(p.client_id)?.sendInvoices ?? false };
  });
  const repoProjects = Object.fromEntries((db.prepare(`SELECT repo, project_id FROM dc_repo_projects`).all() as { repo: string; project_id: number }[]).map((r) => [r.repo, r.project_id]));
  const terms = (db.prepare(`SELECT id, subscription, plan_name, fee_usd, renewal_day, starts_on FROM dc_subscription_terms ORDER BY subscription, starts_on`).all() as
    { id: number; subscription: SubscriptionId; plan_name: string; fee_usd: number; renewal_day: number; starts_on: string }[]).map((t) => ({
    id: t.id, subscription: t.subscription, planName: t.plan_name, feeUsd: t.fee_usd, renewalDay: t.renewal_day, startsOn: t.starts_on,
  }));
  return { clients, projects, repoProjects, terms };
}

export type ClientInput = Omit<Client, "id"> & { id?: number };
export function saveClient(db: Database.Database, c: ClientInput, now = new Date()): number {
  const values = { name: c.name, contact: c.contact, email: c.email, address: c.address, terms: c.paymentTerms, internal: c.internal ? 1 : 0, send: c.sendInvoices ? 1 : 0, notes: c.notes };
  if (c.id) {
    const changed = db.prepare(`UPDATE dc_clients SET name=@name, contact=@contact, email=@email, address=@address, payment_terms=@terms,
      internal=@internal, send_invoices=@send, notes=@notes WHERE id=@id`).run({ ...values, id: c.id }).changes;
    if (!changed) throw new NotFound("Client not found");
    return c.id;
  }
  return Number(db.prepare(`INSERT INTO dc_clients (name, contact, email, address, payment_terms, internal, send_invoices, notes, created_at)
    VALUES (@name, @contact, @email, @address, @terms, @internal, @send, @notes, @at)`).run({ ...values, at: now.toISOString() }).lastInsertRowid);
}

export function deleteClient(db: Database.Database, id: number) {
  const projects = db.prepare(`SELECT COUNT(*) AS n FROM dc_projects WHERE client_id=?`).get(id) as { n: number };
  if (projects.n > 0) throw new Conflict("Move or delete this client's projects first");
  if (!db.prepare(`DELETE FROM dc_clients WHERE id=?`).run(id).changes) throw new NotFound("Client not found");
}

export type ProjectInput = { id?: number; clientId: number; name: string; sendInvoices: boolean | null };
export function saveProject(db: Database.Database, p: ProjectInput, now = new Date()): number {
  const send = p.sendInvoices === null ? null : p.sendInvoices ? 1 : 0;
  if (!db.prepare(`SELECT 1 FROM dc_clients WHERE id=?`).get(p.clientId)) throw new NotFound("Client not found");
  if (p.id) {
    if (!db.prepare(`UPDATE dc_projects SET client_id=?, name=?, send_invoices=? WHERE id=?`).run(p.clientId, p.name, send, p.id).changes) throw new NotFound("Project not found");
    return p.id;
  }
  return Number(db.prepare(`INSERT INTO dc_projects (client_id, name, send_invoices, created_at) VALUES (?,?,?,?)`).run(p.clientId, p.name, send, now.toISOString()).lastInsertRowid);
}

// Unlinks the project's repositories (cascade); their usage shows as unassigned again.
export function deleteProject(db: Database.Database, id: number) {
  if (!db.prepare(`DELETE FROM dc_projects WHERE id=?`).run(id).changes) throw new NotFound("Project not found");
}

export function assignRepo(db: Database.Database, repo: string, projectId: number | null) {
  if (projectId === null) {
    db.prepare(`DELETE FROM dc_repo_projects WHERE repo=?`).run(repo);
    return;
  }
  if (!db.prepare(`SELECT 1 FROM dc_projects WHERE id=?`).get(projectId)) throw new NotFound("Project not found");
  db.prepare(`INSERT INTO dc_repo_projects (repo, project_id) VALUES (?,?) ON CONFLICT(repo) DO UPDATE SET project_id=excluded.project_id`).run(repo, projectId);
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
