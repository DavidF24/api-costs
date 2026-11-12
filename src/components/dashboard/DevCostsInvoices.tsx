"use client";
import { useEffect, useState } from "react";
import type { DevCostsPayload, MonthPreview } from "@/lib/dev-costs";
import type { Invoice, InvoiceSummary, Line, LineInput } from "@/lib/dev-costs/invoices";
import { formatCurrency } from "@/lib/format";

const inputClass = "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-foreground/30";
const buttonClass = "text-sm border border-card-border rounded-lg px-3 py-2 bg-card hover:bg-card-border/30 disabled:opacity-50";
const card = "bg-card border border-card-border rounded-xl";
const SUB: Record<string, string> = { claude: "Claude", codex: "ChatGPT", grok: "Grok" };

const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const easternToday = () => etFmt.format(new Date());
const nextMonth = (m: string) => { const [y, n] = m.split("-").map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, "0")}`; };
// A draft whose numbers were taken before its month ended must be rebuilt before issuing.
const builtEarly = (inv: Invoice) => {
  const end = `${nextMonth(inv.month)}-01`;
  return etFmt.format(new Date(inv.source.generatedAt)) < end || (inv.source.trackerBuiltAt !== null && etFmt.format(new Date(inv.source.trackerBuiltAt)) < end);
};
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const lastDay = (end: string) => new Date(Date.parse(`${end}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
function recentMonths(today: string, n = 13): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const t = y * 12 + (m - 1) - i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; });
}
const docName = (i: { kind: string }) => i.kind === "invoice" ? "Invoice" : "Statement";
function statusText(i: InvoiceSummary) {
  if (i.status === "draft") return "Draft";
  if (i.status === "void") return `Void · ${i.number}`;
  if (i.kind === "statement") return `Issued · ${i.number}`;
  return i.balanceUsd <= 0 ? `Paid · ${i.number}` : i.paidUsd > 0 ? `Part paid · ${i.number}` : `Issued · ${i.number}`;
}

async function call<T>(url: string, body?: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const value = await r.json();
    return r.ok ? { ok: true, value } : { ok: false, error: value.error ?? "That did not work." };
  } catch { return { ok: false, error: "Could not reach the dashboard. Check it is running." }; }
}

export function Invoices({ data, reload }: { data: DevCostsPayload; reload: () => Promise<void> }) {
  const today = easternToday();
  const months = recentMonths(today);
  const [month, setMonth] = useState(months[0]);
  const [preview, setPreview] = useState<MonthPreview | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    call<MonthPreview>(`/api/dev-costs/invoices?month=${month}`).then((r) => { if (!live) return; if (r.ok) { setPreview(r.value); setError(""); } else setError(r.error); });
    return () => { live = false; };
  }, [month, version, data]);

  const refresh = async () => { setVersion((v) => v + 1); await reload(); };
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    const r = await call<Invoice & { deleted?: boolean }>("/api/dev-costs/invoices", body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    setOpen(r.value.deleted ? null : r.value);
    await refresh();
    return true;
  };
  const show = async (id: number) => {
    setError("");
    const r = await call<Invoice>(`/api/dev-costs/invoices?id=${id}`);
    if (r.ok) setOpen(r.value); else setError(r.error);
  };

  return <section aria-labelledby="invoices-heading" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="invoices-heading" className="text-base font-semibold">Monthly invoices and statements</h2>
        <p className="text-sm text-muted mt-1 max-w-3xl">One document per client per calendar month: tracked hours at your rate, plus each repository’s share of the subscription periods that closed that month, at cost. Build a draft, check and edit it, then issue it to lock it.</p>
      </div>
      <label className="text-xs text-muted space-y-1 block">Month
        <select value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null); }} className={`${inputClass} w-auto`}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === months[0] ? " (so far)" : ""}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="text-critical text-sm">{error}</p>}
    {!preview || preview.month !== month ? <p className="text-sm text-muted">Loading…</p> : <MonthCard preview={preview} busy={busy} run={run} show={show} />}
    {open && <Editor key={open.id} invoice={open} busy={busy} run={run} close={() => setOpen(null)} today={today} />}
    <History invoices={data.invoices} show={show} />
  </section>;
}

function MonthCard({ preview: p, busy, run, show }: { preview: MonthPreview; busy: boolean; run: (b: Record<string, unknown>) => Promise<boolean>; show: (id: number) => void }) {
  const t = p.tracker;
  return <div className={`${card} p-4 sm:p-5 space-y-4`}>
    <div className="text-xs text-muted space-y-1">
      {t.available
        ? <p>Hours come from the productivity tracker. Its billing table was last rebuilt {when(t.builtAt)}; the newest sample in it is from {when(t.latest)}.</p>
        : <p className="text-warning">Tracked hours are not available: {t.error}. Subscription shares are still shown.</p>}
      {!p.complete && <p>This month is not over, so these figures will still change. A document can be issued once the month has ended.</p>}
      {p.closedPeriods.length > 0 && <p>Subscription periods billed this month: {p.closedPeriods.map((x) => `${SUB[x.subscription]} ${shortDate(x.start)} – ${shortDate(lastDay(x.end))}`).join("; ")}.</p>}
      {p.pendingPeriods.length > 0 && <p>Still open, added when they close: {p.pendingPeriods.map((x) => `${SUB[x.subscription]} until ${shortDate(lastDay(x.end))}`).join("; ")}.</p>}
    </div>
    {p.clients.length === 0 ? <p className="text-sm text-muted">Add a client below to start billing.</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
        <thead><tr className="text-xs text-muted text-left"><th className="font-normal py-2">Client</th><th className="font-normal text-right px-2">Hours</th><th className="font-normal text-right px-2">Total</th><th className="font-normal px-2">Document</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{p.clients.map((c) => <tr key={c.clientId} className="border-t border-card-border">
          <td className="py-2">{c.clientName}<div className="text-xs text-muted">{c.sendInvoices ? "Invoice" : "Statement, track only"} · idle cutoff {c.idleCutoffMin} min</div></td>
          <td className="text-right tabular-nums px-2" title={c.invoice && c.invoice.status !== "draft" ? "Hours tracked now; the issued document keeps its own lines" : undefined}>{c.hours.toFixed(2)}</td>
          <td className="text-right tabular-nums px-2">{formatCurrency(c.invoice ? c.invoice.totalUsd : c.totalUsd)}
            {c.invoice?.status === "draft" && Math.round(c.invoice.totalUsd * 100) !== Math.round(c.totalUsd * 100) && <div className="text-xs text-warning">Now {formatCurrency(c.totalUsd)}: rebuild to update</div>}</td>
          <td className="px-2">{c.invoice ? statusText(c.invoice) : <span className="text-muted">Not started</span>}
            {c.sendInvoices && c.lines.some((l) => l.kind === "time" && l.rateUsd === 0) && <div className="text-xs text-warning">No hourly rate set: time bills at $0</div>}</td>
          <td className="text-right whitespace-nowrap space-x-2">
            {c.invoice && <button type="button" aria-label={`Open ${docName(c.invoice)} for ${c.clientName}`} onClick={() => show(c.invoice!.id)} className="text-xs underline text-muted hover:text-foreground">Open</button>}
            {(!c.invoice || c.invoice.status === "draft") && <button type="button" disabled={busy || (c.lines.length === 0 && !c.invoice)}
              onClick={() => { if (!c.invoice || confirm("Rebuild this draft from the current numbers? Line edits are replaced; notes are kept.")) run({ action: "generate", clientId: c.clientId, month: p.month }); }}
              className="text-xs underline text-muted hover:text-foreground disabled:opacity-50 disabled:no-underline">{c.invoice ? "Rebuild" : "Create draft"}</button>}
          </td>
        </tr>)}</tbody>
      </table></div>}
    {(p.unassignedTime.length > 0 || p.unassignedSubscriptionUsd > 0) && <div className="text-xs text-muted border-t border-card-border pt-3 space-y-1">
      <p className="font-medium text-foreground text-sm">Not billed to any client</p>
      {p.unassignedTime.length > 0 && <p>Time: {p.unassignedTime.slice(0, 12).map((u) => `${u.label} ${u.hours.toFixed(1)} h`).join(", ")}{p.unassignedTime.length > 12 ? `, and ${p.unassignedTime.length - 12} more` : ""}. Link these repositories to a client to bill them.</p>}
      {p.unassignedSubscriptionUsd > 0 && <p>Subscription shares: {formatCurrency(p.unassignedSubscriptionUsd)} from repositories not linked to a client.</p>}
    </div>}
  </div>;
}

const blankLine: LineInput = { kind: "other", groupName: "", description: "", repo: null, quantity: null, unit: "", rateUsd: null, amountUsd: 0 };

function Editor({ invoice: inv, busy, run, close, today }: { invoice: Invoice; busy: boolean; run: (b: Record<string, unknown>) => Promise<boolean>; close: () => void; today: string }) {
  const draft = inv.status === "draft";
  const [notes, setNotes] = useState(inv.notes);
  const [issuedOn, setIssuedOn] = useState(today);
  const [adding, setAdding] = useState(false);
  const [pay, setPay] = useState({ paidOn: today, amountUsd: "", method: "", note: "" });
  const monthOver = today.slice(0, 7) > inv.month;
  const groups = [...new Set(inv.lines.map((l) => l.groupName))];
  const early = draft && builtEarly(inv);
  return <div role="region" className={`${card} p-4 sm:p-5 space-y-4`} aria-label={`${docName(inv)} for ${inv.billTo.name}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{docName(inv)} · {inv.billTo.name} · {monthLabel(inv.month)}</h3>
        <p className="text-xs text-muted">{statusText(inv)}{inv.issuedOn ? ` · issued ${shortDate(inv.issuedOn)}` : ""}{inv.dueOn && inv.kind === "invoice" ? ` · due ${shortDate(inv.dueOn)}` : ""} · built with a {inv.source.idleCutoffMin}-minute idle cutoff</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`/dev-costs/invoices/${inv.id}`} target="_blank" rel="noopener" className={buttonClass}>{draft ? "Preview" : "Print or save PDF"}</a>
        <button type="button" onClick={close} className={buttonClass}>Close</button>
      </div>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
      <thead><tr className="text-xs text-muted text-left"><th className="font-normal py-1">Description</th><th className="font-normal text-right px-2 w-20">Hours</th><th className="font-normal text-right px-2 w-24">Rate</th><th className="font-normal text-right px-2 w-28">Amount</th>{draft && <th className="w-24"><span className="sr-only">Actions</span></th>}</tr></thead>
      {groups.map((g) => <tbody key={g}>
        <tr><td colSpan={draft ? 5 : 4} className="pt-3 pb-1 text-xs font-medium">{g || "Other"}</td></tr>
        {inv.lines.filter((l) => l.groupName === g).map((l) => <LineRow key={l.id} line={l} draft={draft} busy={busy} run={run} invoiceId={inv.id} />)}
      </tbody>)}
      {inv.lines.length === 0 && <tbody><tr><td colSpan={5} className="py-4 text-muted">No lines. Add one below, or delete this draft.</td></tr></tbody>}
      <tfoot><tr className="border-t border-card-border font-medium"><td className="py-2">Total</td><td /><td /><td className="text-right tabular-nums px-2">{formatCurrency(inv.totalUsd)}</td>{draft && <td />}</tr></tfoot>
    </table></div>
    {draft && (adding
      ? <LineForm initial={{ ...blankLine, groupName: groups[0] ?? "" }} groups={groups} busy={busy} onCancel={() => setAdding(false)} onSave={async (line) => { if (await run({ action: "addLine", invoiceId: inv.id, line })) setAdding(false); }} />
      : <button type="button" onClick={() => setAdding(true)} className={buttonClass}>Add a line</button>)}
    {draft ? <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ action: "saveNotes", invoiceId: inv.id, notes }); }}>
      <label className="text-xs text-muted space-y-1 block">Note on the document<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></label>
      <button type="submit" disabled={busy || notes === inv.notes} className={buttonClass}>Save note</button>
    </form> : inv.notes && <p className="text-sm whitespace-pre-wrap">{inv.notes}</p>}
    {draft && <div className="flex flex-wrap items-end gap-3 border-t border-card-border pt-4">
      <label className="text-xs text-muted space-y-1 block">Issue date<input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={`${inputClass} w-auto`} /></label>
      <button type="button" disabled={busy || !monthOver || early} title={!monthOver ? "The month has not ended yet" : early ? "Rebuild the draft first" : undefined} onClick={() => { if (confirm("Issue this document? It takes the client's current details, gets a number and can no longer be edited. Clients set to send invoices get an invoice; track-only clients a statement.")) run({ action: "issue", invoiceId: inv.id, issuedOn }); }} className={buttonClass}>Issue</button>
      <button type="button" disabled={busy} onClick={() => { if (confirm("Delete this draft?")) run({ action: "void", invoiceId: inv.id }); }} className={`${buttonClass} hover:text-critical`}>Delete draft</button>
      {!monthOver && <p className="text-xs text-muted w-full">You can issue it once {monthLabel(inv.month)} has ended.</p>}
      {monthOver && early && <p className="text-xs text-warning w-full">This draft was built before {monthLabel(inv.month)} ended, or from tracker data last rebuilt before then, so it may miss the end of the month. Rebuild it from the month list above once the tracker has caught up, check it, then issue it.</p>}
    </div>}
    {inv.status === "issued" && inv.kind === "invoice" && <div className="border-t border-card-border pt-4 space-y-3">
      <h4 className="text-sm font-medium">Payments</h4>
      {inv.payments.length === 0 ? <p className="text-sm text-muted">None recorded. Balance {formatCurrency(inv.balanceUsd)}.</p> :
        <ul className="text-sm space-y-1">{inv.payments.map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2">
          <span>{shortDate(p.paidOn)} · {formatCurrency(p.amountUsd)}{p.method ? ` · ${p.method}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
          <button type="button" disabled={busy} onClick={() => { if (confirm("Remove this payment?")) run({ action: "deletePayment", invoiceId: inv.id, paymentId: p.id }); }} className="text-xs underline text-muted hover:text-critical">Remove</button>
        </li>)}<li className="text-muted">Balance {formatCurrency(inv.balanceUsd)}</li></ul>}
      <form className="grid gap-3 sm:grid-cols-[160px_120px_1fr_1fr_auto] items-end" onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ action: "addPayment", invoiceId: inv.id, paidOn: pay.paidOn, amountUsd: Number(pay.amountUsd), method: pay.method, note: pay.note })) setPay((x) => ({ ...x, amountUsd: "", note: "" }));
      }}>
        <label className="text-xs text-muted space-y-1 block">Paid on<input required type="date" value={pay.paidOn} onChange={(e) => setPay((x) => ({ ...x, paidOn: e.target.value }))} className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">Amount ($)<input required type="number" min="0.01" step="0.01" value={pay.amountUsd} onChange={(e) => setPay((x) => ({ ...x, amountUsd: e.target.value }))} className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">Method<input value={pay.method} placeholder="Check, ACH…" onChange={(e) => setPay((x) => ({ ...x, method: e.target.value }))} className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">Note<input value={pay.note} onChange={(e) => setPay((x) => ({ ...x, note: e.target.value }))} className={inputClass} /></label>
        <button type="submit" disabled={busy} className={buttonClass}>Record payment</button>
      </form>
    </div>}
    {inv.status === "issued" && <div className="border-t border-card-border pt-4">
      <button type="button" disabled={busy || inv.payments.length > 0} title={inv.payments.length > 0 ? "Remove its payments first" : undefined} onClick={() => { if (confirm(`Void ${inv.number}? It stays in the history marked void, and the month can be billed again.`)) run({ action: "void", invoiceId: inv.id }); }} className={`${buttonClass} hover:text-critical`}>Void {inv.number}</button>
    </div>}
  </div>;
}

function LineRow({ line: l, draft, busy, run, invoiceId }: { line: Line; draft: boolean; busy: boolean; run: (b: Record<string, unknown>) => Promise<boolean>; invoiceId: number }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <tr><td colSpan={5} className="py-2"><LineForm initial={l} groups={[]} busy={busy} onCancel={() => setEditing(false)} onSave={async (line) => { if (await run({ action: "updateLine", invoiceId, lineId: l.id, line })) setEditing(false); }} /></td></tr>;
  return <tr className="border-t border-card-border align-top">
    <td className="py-1.5 pr-2">{l.description}</td>
    <td className="text-right tabular-nums px-2">{l.quantity !== null ? l.quantity.toFixed(2) : ""}</td>
    <td className="text-right tabular-nums px-2">{l.rateUsd !== null ? formatCurrency(l.rateUsd) : ""}</td>
    <td className="text-right tabular-nums px-2">{formatCurrency(l.amountUsd)}</td>
    {draft && <td className="text-right whitespace-nowrap space-x-2">
      <button type="button" onClick={() => setEditing(true)} className="text-xs underline text-muted hover:text-foreground">Edit</button>
      <button type="button" disabled={busy} onClick={() => { if (confirm(`Remove “${l.description}”?`)) run({ action: "deleteLine", invoiceId, lineId: l.id }); }} className="text-xs underline text-muted hover:text-critical">Remove</button>
    </td>}
  </tr>;
}

// Time lines take hours and a rate (the amount follows); other lines take an amount, which
// may be negative for a credit.
function LineForm({ initial, groups, busy, onSave, onCancel }: { initial: LineInput; groups: string[]; busy: boolean; onSave: (l: LineInput) => void; onCancel: () => void }) {
  const [f, setF] = useState({ ...initial, quantity: initial.quantity === null ? "" : String(initial.quantity), rateUsd: initial.rateUsd === null ? "" : String(initial.rateUsd), amountUsd: String(initial.amountUsd) });
  const time = f.kind === "time";
  return <form className="grid gap-3 sm:grid-cols-[140px_1fr_2fr_100px_110px_120px] items-end" onSubmit={(e) => {
    e.preventDefault();
    const q = time ? Number(f.quantity) : null;
    const r = time ? Number(f.rateUsd) : null;
    onSave({ kind: f.kind, groupName: f.groupName, description: f.description, repo: initial.repo, unit: time ? "hours" : "", quantity: q, rateUsd: r, amountUsd: time ? Math.round((q ?? 0) * (r ?? 0) * 100) / 100 : Number(f.amountUsd) });
  }}>
    <label className="text-xs text-muted space-y-1 block">Type<select value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value as LineInput["kind"] }))} className={inputClass}>
      <option value="time">Time</option><option value="subscription">Subscription share</option><option value="other">Other</option></select></label>
    <label className="text-xs text-muted space-y-1 block">Project<input list="invoice-groups" value={f.groupName} onChange={(e) => setF((x) => ({ ...x, groupName: e.target.value }))} className={inputClass} />
      <datalist id="invoice-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></label>
    <label className="text-xs text-muted space-y-1 block">Description<input required value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} className={inputClass} /></label>
    {time ? <>
      <label className="text-xs text-muted space-y-1 block">Hours<input required type="number" min="0" step="0.01" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} className={inputClass} /></label>
      <label className="text-xs text-muted space-y-1 block">Rate ($)<input required type="number" min="0" step="0.01" value={f.rateUsd} onChange={(e) => setF((x) => ({ ...x, rateUsd: e.target.value }))} className={inputClass} /></label>
    </> : <label className="text-xs text-muted space-y-1 block sm:col-span-2">Amount ($)<input required type="number" step="0.01" value={f.amountUsd} onChange={(e) => setF((x) => ({ ...x, amountUsd: e.target.value }))} className={inputClass} /></label>}
    <div className="flex gap-2"><button type="submit" disabled={busy} className={buttonClass}>Save</button><button type="button" onClick={onCancel} className={buttonClass}>Cancel</button></div>
  </form>;
}

function History({ invoices, show }: { invoices: InvoiceSummary[]; show: (id: number) => void }) {
  if (invoices.length === 0) return null;
  const owed = invoices.filter((i) => i.status === "issued" && i.kind === "invoice").reduce((s, i) => s + Math.round(i.balanceUsd * 100), 0) / 100;
  return <div className={`${card} overflow-hidden`}>
    <div className="px-4 sm:px-5 py-3 flex flex-wrap justify-between gap-2 border-b border-card-border">
      <h3 className="text-sm font-semibold">History</h3><span className="text-sm text-muted">Unpaid on issued invoices: <span className="tabular-nums text-foreground">{formatCurrency(owed)}</span></span>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
      <thead><tr className="text-xs text-muted text-left"><th className="font-normal px-4 sm:px-5 py-2">Month</th><th className="font-normal">Client</th><th className="font-normal">Document</th><th className="font-normal text-right px-2">Total</th><th className="font-normal text-right px-2">Balance</th><th className="px-4 sm:px-5"><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{invoices.map((i) => <tr key={i.id} className={`border-t border-card-border ${i.status === "void" ? "text-muted line-through" : ""}`}>
        <td className="px-4 sm:px-5 py-2">{monthLabel(i.month)}</td><td>{i.billTo.name}</td><td>{docName(i)} · {statusText(i)}</td>
        <td className="text-right tabular-nums px-2">{formatCurrency(i.totalUsd)}</td>
        <td className="text-right tabular-nums px-2">{i.status === "issued" && i.kind === "invoice" ? formatCurrency(i.balanceUsd) : "—"}</td>
        <td className="px-4 sm:px-5 text-right"><button type="button" aria-label={`Open ${docName(i)} for ${i.billTo.name}, ${monthLabel(i.month)}`} onClick={() => show(i.id)} className="text-xs underline text-muted hover:text-foreground">Open</button></td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
