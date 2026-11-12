// Monthly invoices and statements. One document per client per calendar month (Eastern
// time). A draft is built from tracked hours and the subscription periods that closed in
// that month, can be edited line by line, and is then issued: issuing gives it a number and
// locks it, so the history keeps exactly what was billed. Clients set to track only get a
// statement in the same form, kept but not sent. Amounts pass through at cost.
// Takes a plain better-sqlite3 handle (no path aliases) so tests use an in-memory database.
import type Database from "better-sqlite3";
import type { BillingProfile, Client, Register } from "./store.ts";
import { Conflict, NotFound } from "./store.ts";
import type { PeriodView } from "./view.ts";
import { easternDate, hoursOf, type RepoTime } from "./time.ts";

export type LineKind = "time" | "subscription" | "other";
export type LineInput = {
  kind: LineKind;
  groupName: string; // project label the line is shown under
  description: string;
  repo: string | null;
  quantity: number | null; // hours for time lines
  unit: string;
  rateUsd: number | null;
  amountUsd: number;
};
export type Line = LineInput & { id: number; position: number };
export type BillTo = { name: string; contact: string; email: string; address: string; paymentTerms: string };
export type DocKind = "invoice" | "statement";
export type Status = "draft" | "issued" | "void";
export type Payment = { id: number; paidOn: string; amountUsd: number; method: string; note: string };
export type InvoiceSummary = {
  id: number; clientId: number; month: string; kind: DocKind; status: Status; number: string | null;
  issuedOn: string | null; dueOn: string | null; billTo: BillTo; totalUsd: number; paidUsd: number; balanceUsd: number;
};
export type Invoice = InvoiceSummary & { notes: string; from: BillingProfile | null; source: InvoiceSource; lines: Line[]; payments: Payment[] };
// How the draft was built, kept so an issued document can be explained later.
export type InvoiceSource = { generatedAt: string; idleCutoffMin: number; trackerBuiltAt: string | null; trackerLatest: string | null; periods: string[] };

// toPrecision clears binary noise first, so 1.005 rounds to 1.01 rather than 1.00.
const cents = (usd: number) => Math.round(Number((usd * 100).toPrecision(12)));
export const round2 = (usd: number) => cents(usd) / 100;

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}

// A subscription period is billed on the statement for the month it closes in: a period
// whose last day is in November (its exclusive end is after Nov 1 and no later than Dec 1).
export function periodsClosingIn(month: string, periods: PeriodView[]): PeriodView[] {
  const [start, next] = monthRange(month);
  return periods.filter((p) => p.end > start && p.end <= next);
}

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const lastDay = (end: string) => new Date(Date.parse(`${end}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const SUB_NAME: Record<string, string> = { claude: "Claude", codex: "ChatGPT", grok: "Grok" };

// Lines for one client's month: tracked hours at the repository's rate (else the client's)
// and each closed subscription period's share for each of the client's repositories,
// grouped under the project label (or the repository's client-facing name).
export function buildLines(client: Client, register: Register, time: RepoTime[], periods: PeriodView[], folderName: (repoId: string) => string): LineInput[] {
  const repos = Object.entries(register.repoLinks).filter(([, l]) => l.clientId === client.id);
  const lines: (LineInput & { order: number })[] = [];
  for (const [repoId, link] of repos) {
    const display = link.displayName || folderName(repoId);
    const groupName = link.projectName || display;
    const t = time.find((x) => x.repo?.id === repoId);
    const hours = t ? hoursOf(t.seconds) : 0;
    if (hours > 0) {
      const rate = link.hourlyRateUsd ?? client.hourlyRateUsd;
      lines.push({
        order: 0, kind: "time", groupName, repo: repoId, quantity: hours, unit: "hours", rateUsd: rate, amountUsd: round2(hours * rate),
        description: `Development time · ${display} (${t!.days} ${t!.days === 1 ? "day" : "days"})`,
      });
    }
    for (const p of periods) {
      const row = p.rows.find((r) => r.repoId === repoId);
      if (!row || row.chargeUsd <= 0) continue;
      lines.push({
        order: 1, kind: "subscription", groupName, repo: repoId, quantity: null, unit: "", rateUsd: null, amountUsd: row.chargeUsd,
        description: `${SUB_NAME[p.subscription] ?? p.subscription} subscription share · ${display} · ${shortDay(p.start)} – ${shortDay(lastDay(p.end))} (${(row.share * 100).toFixed(1)}% of ${formatUsd(p.feeUsd)})`,
      });
    }
  }
  return lines
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.order - b.order || a.description.localeCompare(b.description))
    .map((l) => { const { order, ...line } = l; void order; return line; });
}

const formatUsd = (n: number) => `$${n.toFixed(2)}`;

export function ensureInvoices(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS dc_invoices (
    id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES dc_clients(id),
    month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    kind TEXT NOT NULL CHECK (kind IN ('invoice','statement')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
    number TEXT UNIQUE, issued_on TEXT, due_on TEXT,
    bill_to TEXT NOT NULL, from_profile TEXT, notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK ((status = 'draft') = (number IS NULL))
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_dc_invoices_client_month ON dc_invoices (client_id, month) WHERE status <> 'void';
  CREATE TABLE IF NOT EXISTS dc_invoice_lines (
    id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES dc_invoices(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('time','subscription','other')),
    group_name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, repo TEXT,
    quantity REAL, unit TEXT NOT NULL DEFAULT '', rate_usd REAL, amount_usd REAL NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS ix_dc_invoice_lines_invoice ON dc_invoice_lines (invoice_id, position);
  CREATE TABLE IF NOT EXISTS dc_payments (
    id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES dc_invoices(id),
    paid_on TEXT NOT NULL, amount_usd REAL NOT NULL CHECK (amount_usd > 0),
    method TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS ix_dc_payments_invoice ON dc_payments (invoice_id);`);
}

type InvoiceRow = {
  id: number; client_id: number; month: string; kind: DocKind; status: Status; number: string | null; issued_on: string | null;
  due_on: string | null; bill_to: string; from_profile: string | null; notes: string; source: string;
};
type LineRow = { id: number; position: number; kind: LineKind; group_name: string; description: string; repo: string | null; quantity: number | null; unit: string; rate_usd: number | null; amount_usd: number };

function summary(db: Database.Database, r: InvoiceRow): InvoiceSummary {
  const total = (db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) AS c FROM dc_invoice_lines WHERE invoice_id=?`).get(r.id) as { c: number }).c;
  const paid = (db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(amount_usd * 100) AS INTEGER)), 0) AS c FROM dc_payments WHERE invoice_id=?`).get(r.id) as { c: number }).c;
  return {
    id: r.id, clientId: r.client_id, month: r.month, kind: r.kind, status: r.status, number: r.number, issuedOn: r.issued_on, dueOn: r.due_on,
    billTo: JSON.parse(r.bill_to), totalUsd: total / 100, paidUsd: paid / 100, balanceUsd: r.status === "issued" ? (total - paid) / 100 : 0,
  };
}

export function readInvoices(db: Database.Database): InvoiceSummary[] {
  return (db.prepare(`SELECT * FROM dc_invoices ORDER BY month DESC, id DESC`).all() as InvoiceRow[]).map((r) => summary(db, r));
}

export function readInvoice(db: Database.Database, id: number): Invoice {
  const r = db.prepare(`SELECT * FROM dc_invoices WHERE id=?`).get(id) as InvoiceRow | undefined;
  if (!r) throw new NotFound("Invoice not found");
  const lines = (db.prepare(`SELECT * FROM dc_invoice_lines WHERE invoice_id=? ORDER BY position, id`).all(id) as LineRow[]).map((l) => ({
    id: l.id, position: l.position, kind: l.kind, groupName: l.group_name, description: l.description, repo: l.repo,
    quantity: l.quantity, unit: l.unit, rateUsd: l.rate_usd, amountUsd: l.amount_usd,
  }));
  const payments = (db.prepare(`SELECT id, paid_on, amount_usd, method, note FROM dc_payments WHERE invoice_id=? ORDER BY paid_on, id`).all(id) as
    { id: number; paid_on: string; amount_usd: number; method: string; note: string }[]).map((p) => ({ id: p.id, paidOn: p.paid_on, amountUsd: p.amount_usd, method: p.method, note: p.note }));
  return { ...summary(db, r), notes: r.notes, from: r.from_profile ? JSON.parse(r.from_profile) : null, source: JSON.parse(r.source), lines, payments };
}

function insertLines(db: Database.Database, invoiceId: number, lines: LineInput[], from = 0) {
  const ins = db.prepare(`INSERT INTO dc_invoice_lines (invoice_id, position, kind, group_name, description, repo, quantity, unit, rate_usd, amount_usd)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  lines.forEach((l, i) => ins.run(invoiceId, from + i, l.kind, l.groupName, l.description, l.repo, l.quantity, l.unit, l.rateUsd, round2(l.amountUsd)));
}

const billToOf = (c: Client): BillTo => ({ name: c.name, contact: c.contact, email: c.email, address: c.address, paymentTerms: c.paymentTerms });

// Creates the month's draft, or rebuilds an existing draft from fresh numbers (its notes
// are kept; line edits are replaced). An issued document for the month is never changed.
export function saveDraft(db: Database.Database, client: Client, month: string, lines: LineInput[], source: InvoiceSource, now = new Date()): number {
  return db.transaction(() => {
    const at = now.toISOString();
    const kind: DocKind = client.sendInvoices ? "invoice" : "statement";
    const current = db.prepare(`SELECT id, status FROM dc_invoices WHERE client_id=? AND month=? AND status<>'void'`).get(client.id, month) as { id: number; status: Status } | undefined;
    if (current?.status === "issued") throw new Conflict("This month is already issued. Void it first to bill the month again.");
    let id: number;
    if (current) {
      id = current.id;
      db.prepare(`UPDATE dc_invoices SET kind=?, bill_to=?, source=?, updated_at=? WHERE id=?`).run(kind, JSON.stringify(billToOf(client)), JSON.stringify(source), at, id);
      db.prepare(`DELETE FROM dc_invoice_lines WHERE invoice_id=?`).run(id);
    } else {
      id = Number(db.prepare(`INSERT INTO dc_invoices (client_id, month, kind, status, bill_to, source, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?)`)
        .run(client.id, month, kind, JSON.stringify(billToOf(client)), JSON.stringify(source), at, at).lastInsertRowid);
    }
    insertLines(db, id, lines);
    return id;
  }).immediate();
}

function draftOf(db: Database.Database, invoiceId: number) {
  const r = db.prepare(`SELECT status FROM dc_invoices WHERE id=?`).get(invoiceId) as { status: Status } | undefined;
  if (!r) throw new NotFound("Invoice not found");
  if (r.status !== "draft") throw new Conflict("Only a draft can be changed");
}
const touch = (db: Database.Database, id: number, now: Date) => db.prepare(`UPDATE dc_invoices SET updated_at=? WHERE id=?`).run(now.toISOString(), id);

// A time line's amount follows its hours and rate; other lines take the amount given.
function amountOf(l: LineInput) {
  return l.quantity !== null && l.rateUsd !== null ? round2(l.quantity * l.rateUsd) : round2(l.amountUsd);
}

export function addLine(db: Database.Database, invoiceId: number, l: LineInput, now = new Date()) {
  db.transaction(() => {
    draftOf(db, invoiceId);
    const next = (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM dc_invoice_lines WHERE invoice_id=?`).get(invoiceId) as { n: number }).n;
    insertLines(db, invoiceId, [{ ...l, amountUsd: amountOf(l) }], next);
    touch(db, invoiceId, now);
  })();
}

export function updateLine(db: Database.Database, lineId: number, l: LineInput, now = new Date()) {
  db.transaction(() => {
    const row = db.prepare(`SELECT invoice_id FROM dc_invoice_lines WHERE id=?`).get(lineId) as { invoice_id: number } | undefined;
    if (!row) throw new NotFound("Line not found");
    draftOf(db, row.invoice_id);
    db.prepare(`UPDATE dc_invoice_lines SET kind=?, group_name=?, description=?, repo=?, quantity=?, unit=?, rate_usd=?, amount_usd=? WHERE id=?`)
      .run(l.kind, l.groupName, l.description, l.repo, l.quantity, l.unit, l.rateUsd, amountOf(l), lineId);
    touch(db, row.invoice_id, now);
  })();
}

export function deleteLine(db: Database.Database, lineId: number, now = new Date()) {
  db.transaction(() => {
    const row = db.prepare(`SELECT invoice_id FROM dc_invoice_lines WHERE id=?`).get(lineId) as { invoice_id: number } | undefined;
    if (!row) throw new NotFound("Line not found");
    draftOf(db, row.invoice_id);
    db.prepare(`DELETE FROM dc_invoice_lines WHERE id=?`).run(lineId);
    touch(db, row.invoice_id, now);
  })();
}

export function saveNotes(db: Database.Database, invoiceId: number, notes: string, now = new Date()) {
  db.transaction(() => {
    draftOf(db, invoiceId);
    db.prepare(`UPDATE dc_invoices SET notes=? WHERE id=?`).run(notes, invoiceId);
    touch(db, invoiceId, now);
  })();
}

// "Net 15" -> 15 days; anything else (blank, "Due on receipt") is due on the issue date.
export function dueDate(issuedOn: string, paymentTerms: string): string {
  const m = /net\s*(\d{1,3})/i.exec(paymentTerms);
  const days = m ? Number(m[1]) : 0;
  return new Date(Date.parse(`${issuedOn}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Issues a draft: numbers it (INV-2026-001 for invoices, STM-2026-001 for track-only
// statements, counting up within each year), sets the due date from the payment terms and
// keeps a copy of the client's and the "from" details as they are now, so later edits to
// them do not change what was sent. A draft built before its month ended is refused: it
// would lock in a part month.
export function issueInvoice(db: Database.Database, id: number, issuedOn: string, profile: BillingProfile, now = new Date()): string {
  return db.transaction(() => {
    const r = db.prepare(`SELECT status, client_id, month, source FROM dc_invoices WHERE id=?`).get(id) as { status: Status; client_id: number; month: string; source: string } | undefined;
    if (!r) throw new NotFound("Invoice not found");
    if (r.status !== "draft") throw new Conflict("Only a draft can be issued");
    if (builtBeforeMonthEnd(r.month, JSON.parse(r.source) as InvoiceSource)) throw new Conflict("This draft was built before the month ended. Rebuild it, check it, then issue it.");
    const c = db.prepare(`SELECT name, contact, email, address, payment_terms, send_invoices FROM dc_clients WHERE id=?`).get(r.client_id) as
      { name: string; contact: string; email: string; address: string; payment_terms: string; send_invoices: number } | undefined;
    if (!c) throw new NotFound("Client not found");
    const kind: DocKind = c.send_invoices === 1 ? "invoice" : "statement";
    const billTo: BillTo = { name: c.name, contact: c.contact, email: c.email, address: c.address, paymentTerms: c.payment_terms };
    const prefix = `${kind === "invoice" ? "INV" : "STM"}-${issuedOn.slice(0, 4)}-`;
    const last = (db.prepare(`SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM dc_invoices WHERE number LIKE ?`).get(prefix.length + 1, `${prefix}%`) as { n: number | null }).n ?? 0;
    const number = `${prefix}${String(last + 1).padStart(3, "0")}`;
    db.prepare(`UPDATE dc_invoices SET status='issued', kind=?, bill_to=?, number=?, issued_on=?, due_on=?, from_profile=?, updated_at=? WHERE id=?`)
      .run(kind, JSON.stringify(billTo), number, issuedOn, dueDate(issuedOn, billTo.paymentTerms), JSON.stringify(profile), now.toISOString(), id);
    return number;
  }).immediate();
}

// True when the draft's numbers were taken before its month was over (Eastern time).
export function builtBeforeMonthEnd(month: string, source: InvoiceSource): boolean {
  return easternDate(source.generatedAt) < monthRange(month)[1];
}

// A draft is deleted outright; an issued document is marked void and kept, number and all.
export function voidInvoice(db: Database.Database, id: number, now = new Date()) {
  db.transaction(() => {
    const r = db.prepare(`SELECT status FROM dc_invoices WHERE id=?`).get(id) as { status: Status } | undefined;
    if (!r) throw new NotFound("Invoice not found");
    if (r.status === "draft") db.prepare(`DELETE FROM dc_invoices WHERE id=?`).run(id);
    else if (r.status === "issued") {
      if ((db.prepare(`SELECT COUNT(*) AS n FROM dc_payments WHERE invoice_id=?`).get(id) as { n: number }).n > 0) throw new Conflict("Remove its payments before voiding it");
      db.prepare(`UPDATE dc_invoices SET status='void', updated_at=? WHERE id=?`).run(now.toISOString(), id);
    }
  })();
}

// Payments go against issued invoices only, and never past the balance.
export function addPayment(db: Database.Database, invoiceId: number, p: Omit<Payment, "id">, now = new Date()) {
  db.transaction(() => {
    const r = db.prepare(`SELECT * FROM dc_invoices WHERE id=?`).get(invoiceId) as InvoiceRow | undefined;
    if (!r) throw new NotFound("Invoice not found");
    if (r.status !== "issued" || r.kind !== "invoice") throw new Conflict("Payments can be recorded only against an issued invoice");
    const balance = cents(summary(db, r).balanceUsd);
    if (cents(p.amountUsd) > balance) throw new Conflict(`That is more than the balance of $${(balance / 100).toFixed(2)}`);
    db.prepare(`INSERT INTO dc_payments (invoice_id, paid_on, amount_usd, method, note, created_at) VALUES (?,?,?,?,?,?)`)
      .run(invoiceId, p.paidOn, round2(p.amountUsd), p.method, p.note, now.toISOString());
  }).immediate();
}

export function deletePayment(db: Database.Database, id: number) {
  if (!db.prepare(`DELETE FROM dc_payments WHERE id=?`).run(id).changes) throw new NotFound("Payment not found");
}
