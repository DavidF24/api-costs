"use client";
import { useEffect, useState } from "react";
import type { PeriodView, SplitRow, SubscriptionView } from "@/lib/dev-costs/view";
import type { DevCostsPayload } from "@/lib/dev-costs";
import type { BillingProfile, Client } from "@/lib/dev-costs/store";
import type { RepoView } from "@/lib/dev-costs/view";
import { Invoices } from "./DevCostsInvoices";
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
const UNLINKED = "Not linked to a client";
const ROWS_SHOWN = 8;
type Post = (body: Record<string, unknown>) => Promise<boolean>;

export function DevCosts({ active, serverNow }: { active: boolean; serverNow: number }) {
  const [data, setData] = useState<DevCostsPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>("repo");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch("/api/dev-costs", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<DevCostsPayload>; })
      .then((v) => { setData(v); setError(""); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load development costs. Try refreshing."); });
    return () => controller.abort();
  }, [active, serverNow]);

  const reload = async () => {
    try { const r = await fetch("/api/dev-costs"); if (r.ok) setData(await r.json()); } catch { /* keep what is shown */ }
  };
  const post: Post = async (body) => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/dev-costs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await r.json();
      if (!r.ok) { setError(value.error ?? "That change was not saved."); return false; }
      setData(value as DevCostsPayload);
      return true;
    } catch { setError("That change was not saved. Check the dashboard is running."); return false; }
    finally { setBusy(false); }
  };

  if (!data) return <p className={error ? "text-critical text-sm" : "text-muted text-sm"}>{error || "Loading…"}</p>;
  return <div className="space-y-10">
    {error && <p role="alert" className="text-critical text-sm">{error}</p>}
    {data.migrationConflicts.length > 0 && <div className={`${card} p-4 text-sm space-y-2`}>
      <p>Invoicing is now set per client. For these clients a linked project had a different invoicing setting, so check their <strong>Send invoices</strong> setting: {data.migrationConflicts.join(", ")}.</p>
      <button type="button" disabled={busy} onClick={() => post({ action: "dismissMigrationConflicts" })} className={buttonClass}>Done, hide this</button>
    </div>}
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
    <Invoices data={data} reload={reload} />
    <Register data={data} post={post} busy={busy} />
    <Repositories data={data} post={post} busy={busy} />
    <Fees data={data} post={post} busy={busy} />
    <Profile data={data} post={post} busy={busy} />
  </div>;
}

function grouped(rows: SplitRow[], group: Group) {
  if (group === "repo") return rows.map((r) => ({ key: r.key, label: r.label, detail: r.repoId ? (r.clientId ? `${r.clientName} · ${r.projectName}` : UNLINKED) : "Outside the code folder", apiEquivalentUsd: r.apiEquivalentUsd, share: r.share, chargeUsd: r.chargeUsd }));
  const out = new Map<string, { key: string; label: string; detail: string; apiEquivalentUsd: number; share: number; chargeUsd: number }>();
  for (const r of rows) {
    const label = group === "project" ? r.projectName : r.clientName;
    const key = group === "project" ? `${r.clientId}|${r.projectName.toLowerCase()}` : String(r.clientId);
    const g = out.get(key) ?? { key, label, detail: group === "project" && r.clientId ? r.clientName : "", apiEquivalentUsd: 0, share: 0, chargeUsd: 0 };
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

const blankClient = { name: "", contact: "", email: "", address: "", paymentTerms: "", internal: false, sendInvoices: true, notes: "", hourlyRateUsd: 0, idleCutoffMin: 10 };

function ClientForm({ initial, post, busy, onDone }: { initial: Omit<Client, "id"> & { id?: number }; post: Post; busy: boolean; onDone: () => void }) {
  const [c, setC] = useState(initial);
  const set = (k: keyof typeof c, v: string | boolean | number) => setC((x) => ({ ...x, [k]: v }));
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "saveClient", ...c })) onDone(); }}>
    <label className="text-xs text-muted space-y-1 block">Client name<input required value={c.name} onChange={(e) => set("name", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Billing contact<input value={c.contact} onChange={(e) => set("contact", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Billing email<input type="email" value={c.email} onChange={(e) => set("email", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Payment terms<input value={c.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Net 15" className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Hourly rate ($)<input required type="number" min="0" step="0.01" value={c.hourlyRateUsd} onChange={(e) => set("hourlyRateUsd", Number(e.target.value))} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Stop billing after idle (minutes)<input required type="number" min="0" max="240" step="1" value={c.idleCutoffMin} onChange={(e) => set("idleCutoffMin", Number(e.target.value))} className={inputClass} />
      <span className="block">Time away from the keyboard still billed. 0 bills active time only.</span></label>
    <label className="text-xs text-muted space-y-1 block sm:col-span-2">Mailing address<textarea rows={2} value={c.address} onChange={(e) => set("address", e.target.value)} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block sm:col-span-2">Notes<textarea rows={2} value={c.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} /></label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={c.internal} onChange={(e) => set("internal", e.target.checked)} />Internal (my own business or family)</label>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={c.sendInvoices} onChange={(e) => set("sendInvoices", e.target.checked)} />Send invoices (off = track only)</label>
    <div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={busy} className={buttonClass}>Save client</button><button type="button" onClick={onDone} className={buttonClass}>Cancel</button></div>
  </form>;
}

function Register({ data, post, busy }: { data: DevCostsPayload; post: Post; busy: boolean }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const linked = (clientId: number) => Object.values(data.repoLinks).filter((l) => l.clientId === clientId).length;
  return <section aria-labelledby="clients-heading" className="space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h2 id="clients-heading" className="text-base font-semibold">Clients</h2>
        <p className="text-sm text-muted mt-1">Each client gets one document a month covering all of its repositories. Track-only clients get a statement that is kept but not sent.</p></div>
      {editing !== "new" && <button type="button" onClick={() => setEditing("new")} className={buttonClass}>Add client</button>}
    </div>
    {editing === "new" && <div className={`${card} p-4 sm:p-5`}><ClientForm initial={blankClient} post={post} busy={busy} onDone={() => setEditing(null)} /></div>}
    {data.clients.length === 0 && editing !== "new" && <p className="text-sm text-muted">No clients yet. Add one, then link repositories to it below.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      {data.clients.map((c) => <div key={c.id} className={`${card} p-4 sm:p-5 space-y-2`}>
        {editing === c.id ? <ClientForm initial={c} post={post} busy={busy} onDone={() => setEditing(null)} /> : <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{c.name}</h3>
              <p className="text-xs text-muted">{[c.internal ? "Internal" : "Client", c.sendInvoices ? "Send invoices" : "Track only", c.paymentTerms].filter(Boolean).join(" · ")}</p>
              <p className="text-xs text-muted">{formatCurrency(c.hourlyRateUsd)}/hour · stops after {c.idleCutoffMin} idle {c.idleCutoffMin === 1 ? "minute" : "minutes"} · {linked(c.id)} {linked(c.id) === 1 ? "repository" : "repositories"}</p>
              {(c.contact || c.email) && <p className="text-xs text-muted">{[c.contact, c.email].filter(Boolean).join(" · ")}</p>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(c.id)} className="text-xs underline text-muted hover:text-foreground">Edit</button>
              {linked(c.id) === 0 && <button type="button" disabled={busy} onClick={() => { if (confirm(`Delete ${c.name}?`)) post({ action: "deleteClient", id: c.id }); }} className="text-xs underline text-muted hover:text-critical">Delete</button>}
            </div>
          </div>
        </>}
      </div>)}
    </div>
  </section>;
}

function Repositories({ data, post, busy }: { data: DevCostsPayload; post: Post; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const visible = data.repos.filter((r) => (showAll || r.apiEquivalentUsd > 0 || r.link !== null) && (!q || r.id.toLowerCase().includes(q) || (r.link?.displayName ?? "").toLowerCase().includes(q)));
  const clientName = (id: number) => data.clients.find((c) => c.id === id)?.name ?? "";
  return <section aria-labelledby="repos-heading" className="space-y-4">
    <div><h2 id="repos-heading" className="text-base font-semibold">Repositories</h2>
      <p className="text-sm text-muted mt-1">Repositories in your code folder, plus project folders without git that have usage. Worktrees count toward the repository they belong to. Link each one to a client; give two repositories the same project name to bill them together.</p></div>
    <div className={`${card} overflow-hidden`}>
      <div className="p-4 sm:p-5 flex flex-wrap gap-3 items-center border-b border-card-border">
        <input type="search" aria-label="Find a repository" placeholder="Find a repository" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} sm:max-w-xs`} />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Include repositories with no use in the last 90 days</label>
      </div>
      {data.clients.length === 0 && <p className="text-sm text-muted px-4 sm:px-5 pt-4">Add a client first, then link repositories here.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
        <thead><tr className="text-xs text-muted text-left"><th className="font-normal px-4 sm:px-5 py-2">Repository</th><th className="font-normal text-right px-2 whitespace-nowrap">Last 90 days at API prices</th><th className="font-normal px-2">Billed to</th><th className="px-4 sm:px-5"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {visible.map((r) => editing === r.id
            ? <tr key={r.id} className="border-t border-card-border"><td colSpan={4} className="px-4 sm:px-5 py-3"><RepoForm repo={r} data={data} post={post} busy={busy} onDone={() => setEditing(null)} /></td></tr>
            : <tr key={r.id} className="border-t border-card-border align-top">
              <td className="px-4 sm:px-5 py-2 break-all">{r.id}{!r.git && <span className="text-xs text-muted"> · folder</span>}{r.link?.displayName && <div className="text-xs text-muted">Shown as {r.link.displayName}</div>}</td>
              <td className="text-right tabular-nums text-muted px-2 py-2">{r.apiEquivalentUsd > 0 ? formatCurrency(r.apiEquivalentUsd) : "—"}</td>
              <td className="px-2 py-2">{r.link ? <>{clientName(r.link.clientId)}{r.link.projectName && <span className="text-muted"> · {r.link.projectName}</span>}{r.link.hourlyRateUsd !== null && <div className="text-xs text-muted">{formatCurrency(r.link.hourlyRateUsd)}/hour for this repository</div>}</> : <span className="text-muted">Not linked</span>}</td>
              <td className="px-4 sm:px-5 py-2 text-right"><button type="button" disabled={data.clients.length === 0} onClick={() => setEditing(r.id)} className="text-xs underline text-muted hover:text-foreground disabled:opacity-50">{r.link ? "Edit" : "Link"}</button></td>
            </tr>)}
          {visible.length === 0 && <tr><td colSpan={4} className="px-4 sm:px-5 py-6 text-center text-muted">No repositories match.</td></tr>}
        </tbody>
      </table></div>
    </div>
  </section>;
}

function RepoForm({ repo, data, post, busy, onDone }: { repo: RepoView; data: DevCostsPayload; post: Post; busy: boolean; onDone: () => void }) {
  const [f, setF] = useState({
    clientId: repo.link?.clientId ?? data.clients[0]?.id ?? 0, displayName: repo.link?.displayName ?? "", projectName: repo.link?.projectName ?? "",
    rate: repo.link?.hourlyRateUsd === null || repo.link?.hourlyRateUsd === undefined ? "" : String(repo.link.hourlyRateUsd),
  });
  // Project names this client already uses, so a second repository can join one.
  const names = [...new Set(Object.entries(data.repoLinks).filter(([id, l]) => l.clientId === f.clientId && l.projectName && id !== repo.id).map(([, l]) => l.projectName))].sort();
  const listId = `projects-${repo.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const save = (clientId: number | null) => post({ action: "saveRepoLink", repo: repo.id, clientId, displayName: f.displayName, projectName: f.projectName, hourlyRateUsd: f.rate === "" ? null : Number(f.rate) });
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await save(f.clientId)) onDone(); }}>
    <p className="text-sm font-medium sm:col-span-2 break-all">{repo.id}</p>
    <label className="text-xs text-muted space-y-1 block">Client<select value={f.clientId} onChange={(e) => setF((x) => ({ ...x, clientId: Number(e.target.value) }))} className={inputClass}>
      {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="text-xs text-muted space-y-1 block">Name the client sees<input value={f.displayName} placeholder={repo.name} onChange={(e) => setF((x) => ({ ...x, displayName: e.target.value }))} className={inputClass} /></label>
    <label className="text-xs text-muted space-y-1 block">Project (optional)<input list={listId} value={f.projectName} onChange={(e) => setF((x) => ({ ...x, projectName: e.target.value }))} className={inputClass} />
      <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      <span className="block">Repositories with the same project name are billed together.</span></label>
    <label className="text-xs text-muted space-y-1 block">Hourly rate for this repository ($, optional)<input type="number" min="0" step="0.01" value={f.rate} placeholder={`Client rate: ${formatCurrency(data.clients.find((c) => c.id === f.clientId)?.hourlyRateUsd ?? 0)}`} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} className={inputClass} /></label>
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      <button type="submit" disabled={busy || !f.clientId} className={buttonClass}>Save</button>
      <button type="button" onClick={onDone} className={buttonClass}>Cancel</button>
      {repo.link && <button type="button" disabled={busy} onClick={async () => { if (confirm(`Unlink ${repo.id}? Its time and usage show as not linked again.`) && await save(null)) onDone(); }} className={`${buttonClass} hover:text-critical`}>Unlink</button>}
    </div>
  </form>;
}

const SUB_LABEL: Record<SubscriptionId, string> = { claude: "Claude", codex: "ChatGPT (Codex)", grok: "Grok" };

function Fees({ data, post, busy }: { data: DevCostsPayload; post: Post; busy: boolean }) {
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

function Profile({ data, post, busy }: { data: DevCostsPayload; post: Post; busy: boolean }) {
  const [p, setP] = useState<BillingProfile>(data.profile);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof BillingProfile, v: string) => { setSaved(false); setP((x) => ({ ...x, [k]: v })); };
  return <section aria-labelledby="profile-heading" className="space-y-4">
    <div><h2 id="profile-heading" className="text-base font-semibold">Your billing details</h2>
      <p className="text-sm text-muted mt-1">Shown as “From” on every invoice and statement. Each issued document keeps the details it was issued with.</p></div>
    <form className={`${card} p-4 sm:p-5 grid gap-3 sm:grid-cols-2`} onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "saveProfile", ...p })) setSaved(true); }}>
      <label className="text-xs text-muted space-y-1 block">Business name<input value={p.businessName} onChange={(e) => set("businessName", e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted space-y-1 block">Email<input type="email" value={p.email} onChange={(e) => set("email", e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted space-y-1 block">Phone<input value={p.phone} onChange={(e) => set("phone", e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted space-y-1 block sm:row-span-2">Mailing address<textarea rows={3} value={p.address} onChange={(e) => set("address", e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted space-y-1 block sm:col-span-2">How to pay<textarea rows={2} value={p.paymentInstructions} placeholder="For example: check payable to …, or ACH details sent on request" onChange={(e) => set("paymentInstructions", e.target.value)} className={inputClass} /></label>
      <div className="flex items-center gap-3 sm:col-span-2"><button type="submit" disabled={busy} className={buttonClass}>Save details</button>{saved && <span role="status" className="text-xs text-muted">Saved.</span>}</div>
    </form>
  </section>;
}
