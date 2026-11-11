"use client";
import { useEffect, useState } from "react";
import type { DevCostsView, PeriodView, SplitRow, SubscriptionView } from "@/lib/dev-costs/view";
import type { Client, Project } from "@/lib/dev-costs/store";
import type { SubscriptionId } from "@/lib/dev-costs/split";
import { formatCurrency } from "@/lib/format";

const inputClass = "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-foreground/30";
const buttonClass = "text-sm border border-card-border rounded-lg px-3 py-2 bg-card hover:bg-card-border/30 disabled:opacity-50";
const card = "bg-card border border-card-border rounded-xl";
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const lastDay = (end: string) => { const d = new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

type Group = "repo" | "project" | "client";
const ROWS_SHOWN = 8;
type Post = (body: Record<string, unknown>) => Promise<boolean>;

export function DevCosts({ active, serverNow }: { active: boolean; serverNow: number }) {
  const [data, setData] = useState<DevCostsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>("repo");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch("/api/dev-costs", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<DevCostsView>; })
      .then((v) => { setData(v); setError(""); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load development costs. Try refreshing."); });
    return () => controller.abort();
  }, [active, serverNow]);

  const post: Post = async (body) => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/dev-costs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await r.json();
      if (!r.ok) { setError(value.error ?? "That change was not saved."); return false; }
      setData(value as DevCostsView);
      return true;
    } catch { setError("That change was not saved. Check the dashboard is running."); return false; }
    finally { setBusy(false); }
  };

  if (!data) return <p className={error ? "text-critical text-sm" : "text-muted text-sm"}>{error || "Loading…"}</p>;
  return <div className="space-y-10">
    {error && <p role="alert" className="text-critical text-sm">{error}</p>}
    <section aria-labelledby="split-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="split-heading" className="text-base font-semibold">Subscription split</h2>
          <p className="text-sm text-muted mt-1 max-w-3xl">Each billing period’s full fee is split by each repository’s share of that tool’s API-equivalent usage. Charges are passed through at cost. An open period is a running estimate until it renews.</p>
        </div>
        <div role="radiogroup" aria-label="Group charges by" className="flex rounded-lg border border-card-border overflow-hidden text-sm">
          {(["repo", "project", "client"] as const).map((g) => <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => setGroup(g)} className={`px-3 py-2 ${group === g ? "bg-foreground text-background" : "bg-card hover:bg-card-border/30"}`}>{g === "repo" ? "Repository" : g === "project" ? "Project" : "Client"}</button>)}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {data.subscriptions.map((s) => <SubscriptionCard key={s.id} sub={s} group={group} />)}
      </div>
    </section>
    <Register data={data} post={post} busy={busy} />
    <Repositories data={data} post={post} busy={busy} />
    <Fees data={data} post={post} busy={busy} />
  </div>;
}

function grouped(rows: SplitRow[], group: Group) {
  if (group === "repo") return rows.map((r) => ({ key: r.key, label: r.label, detail: r.repoId ? r.projectName : "Outside the code folder", apiEquivalentUsd: r.apiEquivalentUsd, share: r.share, chargeUsd: r.chargeUsd }));
  const out = new Map<string, { key: string; label: string; detail: string; apiEquivalentUsd: number; share: number; chargeUsd: number }>();
  for (const r of rows) {
    const label = group === "project" ? r.projectName : r.clientName;
    const key = String(group === "project" ? r.projectId : r.clientId);
    const g = out.get(key) ?? { key, label, detail: group === "project" && r.projectId ? r.clientName : "", apiEquivalentUsd: 0, share: 0, chargeUsd: 0 };
    g.apiEquivalentUsd += r.apiEquivalentUsd; g.share += r.share; g.chargeUsd += r.chargeUsd;
    out.set(key, g);
  }
  return [...out.values()].sort((a, b) => b.chargeUsd - a.chargeUsd);
}

function SubscriptionCard({ sub, group }: { sub: SubscriptionView; group: Group }) {
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState(false);
  const period: PeriodView | undefined = sub.periods[Math.min(index, sub.periods.length - 1)];
  const rows = period ? grouped(period.rows, group) : [];
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return <div className={`${card} p-4 sm:p-5 space-y-3 min-w-0`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold">{sub.label}{period?.planName ? ` · ${period.planName}` : ""}</h3>
      {period && <span className="text-sm tabular-nums">{formatCurrency(period.feeUsd)}</span>}
    </div>
    {!period ? <p className="text-sm text-muted">No fee recorded. Add this subscription under Subscription fees to split it.</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`${sub.label} billing period`} value={index} onChange={(e) => setIndex(Number(e.target.value))} className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-foreground/30">
          {sub.periods.map((p, i) => <option key={p.start} value={i}>{shortDate(p.start)} – {shortDate(lastDay(p.end))}{p.open ? " (current)" : ""}</option>)}
        </select>
        <span className={`text-xs rounded-full px-2 py-0.5 border ${period.open ? "border-accent-amber text-warning" : "border-accent-green text-accent-green"}`}>{period.open ? "Running estimate" : "Closed"}</span>
      </div>
      <table className="w-full text-sm table-fixed">
        <colgroup><col /><col className="w-16" /><col className="w-24" /></colgroup>
        <thead><tr className="text-xs text-muted text-left"><th className="font-normal py-1">{group === "repo" ? "Repository" : group === "project" ? "Project" : "Client"}</th><th className="font-normal text-right">Share</th><th className="font-normal text-right">Charge</th></tr></thead>
        <tbody>
          {shown.map((r) => <tr key={r.key} className="border-t border-card-border align-top">
            <td className="py-1.5 pr-2 min-w-0"><div className="truncate" title={r.label}>{r.label}</div>{r.detail && <div className="text-xs text-muted truncate">{r.detail}</div>}</td>
            <td className="text-right tabular-nums text-muted" title={`${formatCurrency(r.apiEquivalentUsd)} at API prices`}>{pct(r.share)}</td>
            <td className="text-right tabular-nums">{formatCurrency(r.chargeUsd)}</td>
          </tr>)}
        </tbody>
        <tfoot>{rows.length > ROWS_SHOWN && <tr className="border-t border-card-border"><td colSpan={3} className="py-1.5">
          <button type="button" onClick={() => setAll((v) => !v)} className="text-xs underline text-muted hover:text-foreground">{all ? "Show fewer" : `Show all ${rows.length} (${rows.length - ROWS_SHOWN} more, ${formatCurrency(rows.slice(ROWS_SHOWN).reduce((t, r) => t + r.chargeUsd, 0))})`}</button>
        </td></tr>}<tr className="border-t border-card-border font-medium"><td className="py-1.5">Total</td><td /><td className="text-right tabular-nums">{formatCurrency(period.feeUsd)}</td></tr></tfoot>
      </table>
      <p className="text-xs text-muted">{formatCurrency(period.apiEquivalentUsd)} of usage at API prices in this period.</p>
      {period.prorated && <p className="text-xs text-muted">Part of a billing cycle (a plan started or changed mid-cycle): the fee covers only these days.</p>}
      {period.unpricedTokens > 0 && <p className="text-xs text-warning">Not counted, no verified API price yet: {period.unpricedModels.join(", ")}.</p>}
    </>}
  </div>;
}

const blankClient = { name: "", contact: "", email: "", address: "", paymentTerms: "", internal: false, sendInvoices: true, notes: "" };

function ClientForm({ initial, post, busy, onDone }: { initial: Omit<Client, "id"> & { id?: number }; post: Post; busy: boolean; onDone: () => void }) {
  const [c, setC] = useState(initial);
  const set = (k: keyof typeof c, v: string | boolean) => setC((x) => ({ ...x, [k]: v }));
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "saveClient", ...c })) onDone(); }}>
    <label className="text-xs text-muted space-y-1 block">Client name<input required value={c.name} onChange={(e) => set("name", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Billing contact<input value={c.contact} onChange={(e) => set("contact", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Billing email<input type="email" value={c.email} onChange={(e) => set("email", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Payment terms<input value={c.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Net 15" className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block sm:col-span-2">Mailing address<textarea rows={2} value={c.address} onChange={(e) => set("address", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block sm:col-span-2">Notes<textarea rows={2} value={c.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} /></label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={c.internal} onChange={(e) => set("internal", e.target.checked)} />Internal (my own business or family)</label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={c.sendInvoices} onChange={(e) => set("sendInvoices", e.target.checked)} />Send invoices (off = track only)</label>
    <div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={busy} className={buttonClass}>Save client</button><button type="button" onClick={onDone} className={buttonClass}>Cancel</button></div>
  </form>;
}

function invoiceLabel(p: Project) {
  return p.sendInvoices === null ? `Follows client (${p.effectiveSendInvoices ? "send invoices" : "track only"})` : p.sendInvoices ? "Send invoices" : "Track only";
}

function Register({ data, post, busy }: { data: DevCostsView; post: Post; busy: boolean }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [newProject, setNewProject] = useState<Record<number, string>>({});
  return <section aria-labelledby="clients-heading" className="space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h2 id="clients-heading" className="text-base font-semibold">Clients and projects</h2>
        <p className="text-sm text-muted mt-1">Every project gets a monthly statement. Track-only clients and projects are recorded but not invoiced.</p></div>
      {editing !== "new" && <button type="button" onClick={() => setEditing("new")} className={buttonClass}>Add client</button>}
    </div>
    {editing === "new" && <div className={`${card} p-4 sm:p-5`}><ClientForm initial={blankClient} post={post} busy={busy} onDone={() => setEditing(null)} /></div>}
    {data.clients.length === 0 && editing !== "new" && <p className="text-sm text-muted">No clients yet. Add one, then link repositories to its projects.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      {data.clients.map((c) => {
        const projects = data.projects.filter((p) => p.clientId === c.id);
        return <div key={c.id} className={`${card} p-4 sm:p-5 space-y-3`}>
          {editing === c.id ? <ClientForm initial={c} post={post} busy={busy} onDone={() => setEditing(null)} /> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{c.name}</h3>
                <p className="text-xs text-muted">{[c.internal ? "Internal" : "Client", c.sendInvoices ? "Send invoices" : "Track only", c.paymentTerms].filter(Boolean).join(" · ")}</p>
                {(c.contact || c.email) && <p className="text-xs text-muted">{[c.contact, c.email].filter(Boolean).join(" · ")}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(c.id)} className="text-xs underline text-muted hover:text-foreground">Edit</button>
                {projects.length === 0 && <button type="button" disabled={busy} onClick={() => { if (confirm(`Delete ${c.name}?`)) post({ action: "deleteClient", id: c.id }); }} className="text-xs underline text-muted hover:text-critical">Delete</button>}
              </div>
            </div>
            <ul className="space-y-2">
              {projects.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-card-border pt-2">
                <span className="text-sm">{p.name} <span className="text-xs text-muted">· {Object.values(data.repoProjects).filter((id) => id === p.id).length} repos</span></span>
                <span className="flex items-center gap-2">
                  <select aria-label={`Invoicing for ${p.name}`} title={invoiceLabel(p)} value={p.sendInvoices === null ? "" : p.sendInvoices ? "send" : "track"} disabled={busy}
                    onChange={(e) => post({ action: "saveProject", id: p.id, clientId: p.clientId, name: p.name, sendInvoices: e.target.value === "" ? null : e.target.value === "send" })} className={`${inputClass} w-auto py-1 text-xs`}>
                    <option value="">Follow client ({c.sendInvoices ? "send" : "track only"})</option><option value="send">Send invoices</option><option value="track">Track only</option>
                  </select>
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`Delete project ${p.name}? Its repositories become unassigned.`)) post({ action: "deleteProject", id: p.id }); }} className="text-xs underline text-muted hover:text-critical">Delete</button>
                </span>
              </li>)}
            </ul>
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const name = (newProject[c.id] ?? "").trim(); if (name && await post({ action: "saveProject", clientId: c.id, name, sendInvoices: null })) setNewProject((x) => ({ ...x, [c.id]: "" })); }}>
              <input aria-label={`New project for ${c.name}`} placeholder="New project name" value={newProject[c.id] ?? ""} onChange={(e) => setNewProject((x) => ({ ...x, [c.id]: e.target.value }))} className={inputClass} />
              <button type="submit" disabled={busy} className={`${buttonClass} whitespace-nowrap`}>Add project</button>
            </form>
          </>}
        </div>;
      })}
    </div>
  </section>;
}

function Repositories({ data, post, busy }: { data: DevCostsView; post: Post; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const visible = data.repos.filter((r) => (showAll || r.apiEquivalentUsd > 0 || r.projectId !== null) && (!q || r.id.toLowerCase().includes(q)));
  return <section aria-labelledby="repos-heading" className="space-y-4">
    <div><h2 id="repos-heading" className="text-base font-semibold">Repositories</h2>
      <p className="text-sm text-muted mt-1">Repositories in your code folder, plus project folders without git that have usage. Worktrees count toward the repository they belong to. Link each one to a project.</p></div>
    <div className={`${card} overflow-hidden`}>
      <div className="p-4 sm:p-5 flex flex-wrap gap-3 items-center border-b border-card-border">
        <input type="search" aria-label="Find a repository" placeholder="Find a repository" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} sm:max-w-xs`} />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Include repositories with no use in the last 90 days</label>
      </div>
      {data.projects.length === 0 && <p className="text-sm text-muted px-4 sm:px-5 pt-4">Add a client and a project first, then link repositories here.</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted text-left"><th className="font-normal px-4 sm:px-5 py-2">Repository</th><th className="font-normal text-right px-2 whitespace-nowrap">Last 90 days at API prices</th><th className="font-normal px-4 sm:px-5">Project</th></tr></thead>
        <tbody>
          {visible.map((r) => <tr key={r.id} className="border-t border-card-border">
            <td className="px-4 sm:px-5 py-2 break-all">{r.id}{!r.git && <span className="text-xs text-muted"> · folder</span>}</td>
            <td className="text-right tabular-nums text-muted px-2">{r.apiEquivalentUsd > 0 ? formatCurrency(r.apiEquivalentUsd) : "—"}</td>
            <td className="px-4 sm:px-5 py-1.5">
              <select aria-label={`Project for ${r.id}`} value={r.projectId ?? ""} disabled={busy || data.projects.length === 0} onChange={(e) => post({ action: "assignRepo", repo: r.id, projectId: e.target.value ? Number(e.target.value) : null })} className={`${inputClass} py-1`}>
                <option value="">Unassigned</option>
                {data.clients.map((c) => <optgroup key={c.id} label={c.name}>{data.projects.filter((p) => p.clientId === c.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
              </select>
            </td>
          </tr>)}
          {visible.length === 0 && <tr><td colSpan={3} className="px-4 sm:px-5 py-6 text-center text-muted">No repositories match.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

const SUB_LABEL: Record<SubscriptionId, string> = { claude: "Claude", codex: "ChatGPT (Codex)", grok: "Grok" };

function Fees({ data, post, busy }: { data: DevCostsView; post: Post; busy: boolean }) {
  const [f, setF] = useState({ subscription: "claude" as SubscriptionId, planName: "", feeUsd: "", renewalDay: "", startsOn: "" });
  return <section aria-labelledby="fees-heading" className="space-y-4">
    <div><h2 id="fees-heading" className="text-base font-semibold">Subscription fees</h2>
      <p className="text-sm text-muted mt-1">Record a new fee when a plan changes. It applies from its start date; earlier periods keep the fee you paid then.</p></div>
    <div className={`${card} overflow-hidden`}>
      <div className="overflow-x-auto relative"><table className="w-full text-sm min-w-[560px]">
        <thead><tr className="text-xs text-muted text-left"><th className="font-normal px-4 sm:px-5 py-2">Subscription</th><th className="font-normal">Plan</th><th className="font-normal text-right">Monthly fee</th><th className="font-normal px-2">Renews</th><th className="font-normal">From</th><th className="px-4 sm:px-5"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {data.terms.map((t) => <tr key={t.id} className="border-t border-card-border">
            <td className="px-4 sm:px-5 py-2">{SUB_LABEL[t.subscription]}</td><td>{t.planName || "—"}</td>
            <td className="text-right tabular-nums">{formatCurrency(t.feeUsd)}</td><td className="px-2">the {ordinal(t.renewalDay)}</td><td>{shortDate(t.startsOn)}, {t.startsOn.slice(0, 4)}</td>
            <td className="px-4 sm:px-5 text-right"><button type="button" disabled={busy} onClick={() => { if (confirm("Delete this fee?")) post({ action: "deleteTerm", id: t.id }); }} className="text-xs underline text-muted hover:text-critical">Delete</button></td>
          </tr>)}
          {data.terms.length === 0 && <tr><td colSpan={6} className="px-4 sm:px-5 py-4 text-muted">No fees recorded yet.</td></tr>}
        </tbody>
      </table></div>
      <form className="p-4 sm:p-5 border-t border-card-border grid gap-3 sm:grid-cols-[1fr_1fr_120px_100px_160px_auto] items-end" onSubmit={async (e) => {
        e.preventDefault();
        if (await post({ action: "saveTerm", subscription: f.subscription, planName: f.planName, feeUsd: Number(f.feeUsd), renewalDay: Number(f.renewalDay), startsOn: f.startsOn })) setF((x) => ({ ...x, planName: "", feeUsd: "", renewalDay: "", startsOn: "" }));
      }}>
        <label className="text-xs text-muted space-y-1 block">Subscription<select value={f.subscription} onChange={(e) => setF((x) => ({ ...x, subscription: e.target.value as SubscriptionId }))} className={inputClass}>{Object.entries(SUB_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        <label className="text-xs text-muted space-y-1 block">Plan name<input value={f.planName} onChange={(e) => setF((x) => ({ ...x, planName: e.target.value }))} placeholder="Max" className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">Monthly fee ($)<input required type="number" min="0" step="0.01" value={f.feeUsd} onChange={(e) => setF((x) => ({ ...x, feeUsd: e.target.value }))} className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">Renewal day<input required type="number" min="1" max="31" value={f.renewalDay} onChange={(e) => setF((x) => ({ ...x, renewalDay: e.target.value }))} className={inputClass} /></label>
        <label className="text-xs text-muted space-y-1 block">First period starts<input required type="date" value={f.startsOn} onChange={(e) => setF((x) => ({ ...x, startsOn: e.target.value }))} className={inputClass} /></label>
        <button type="submit" disabled={busy} className={buttonClass}>Add fee</button>
      </form>
    </div>
  </section>;
}
