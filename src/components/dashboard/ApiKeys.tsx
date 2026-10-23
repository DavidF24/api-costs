"use client";
import { useEffect, useState } from "react";
import type { KeyRecord, KeyView } from "@/lib/api-keys/types";
import { KEY_PROVIDERS } from "@/lib/api-keys/types";
import { formatCurrencyDetail, getProviderColor, getProviderLabel } from "@/lib/format";
import { ProviderIcon } from "./ProviderIcon";
const count = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-US", { notation: n > 999999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const date = (v: string | null) => v ? new Date(v).toLocaleDateString() : "Not reported";
const title = (key: KeyRecord) => key.alias || key.name || "Unnamed key";
const inputClass = "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-foreground/30";

export function ApiKeys({ start, end, provider, onProviderChange, active, serverNow }: {
  start: string; end: string; provider: string | null; onProviderChange: (value: string | null) => void; active: boolean; serverNow: number;
}) {
  const [data, setData] = useState<KeyView | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch(`/api/keys?start=${start}&end=${end}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<KeyView>; })
      .then((value) => { setData(value); setError(""); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load the saved key inventory. Try refreshing."); });
    return () => controller.abort();
  }, [start, end, active, serverNow, revision]);
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/keys/sync", { method: "POST" });
      if (!response.ok) throw new Error();
      setRevision((n) => n + 1);
    } catch { setError("Key refresh did not complete. Your saved inventory is retained."); }
    finally { setBusy(false); }
  }
  const query = search.toLowerCase().trim();
  const visible = (data?.keys ?? []).filter((k) => (!provider || k.provider === provider) && (!query || [k.name,k.alias,k.usedIn,k.note,k.hint,k.project,k.account].some((s) => s.toLowerCase().includes(query))));
  const selected = visible.find((key) => key.id === selectedId);
  const shown = selected ? [selected] : visible;
  const statuses = data?.statuses.filter((s) => !provider || s.provider === provider) ?? [];
  const warnings = statuses.filter((s) => !s.ok);
  const daily = selected ? data?.daily.filter((r) => r.id === selected.id) ?? [] : [];
  return <section aria-labelledby="api-keys-heading" className="space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h2 id="api-keys-heading" className="text-base font-semibold">API keys</h2>
        <p className="text-sm text-muted mt-1">Name your keys and record where they’re used. Only masked key hints or identifiers are shown.</p></div>
      <button type="button" onClick={refresh} disabled={busy} className="text-sm border border-card-border rounded-lg px-3 py-2 bg-card hover:bg-card-border/30 disabled:opacity-50">{busy ? "Refreshing keys…" : "Refresh keys"}</button>
    </div>
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="p-4 sm:p-5 space-y-3 border-b border-card-border">
        <div className="grid gap-3 sm:grid-cols-[150px_1fr_1fr]">
          <label className="text-xs text-muted space-y-1 block">Provider<select aria-label="Key provider" value={provider ?? ""} onChange={(e) => onProviderChange(e.target.value || null)} className={inputClass}><option value="">All providers</option>{KEY_PROVIDERS.map((p) => <option key={p} value={p}>{getProviderLabel(p)}</option>)}</select></label>
          <label className="text-xs text-muted space-y-1 block">Find a key<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, usage, note, or masked ID" className={inputClass} /></label>
          <label className="text-xs text-muted space-y-1 block">Individual key<select aria-label="Individual API key" value={selected?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)} className={inputClass}><option value="">All matching keys ({visible.length})</option>{visible.map((k) => <option key={k.id} value={k.id}>{title(k)} · {k.hint}</option>)}</select></label>
        </div>
        <p className="text-xs text-muted">Key filters apply to this inventory and its usage details. The billing charts above remain organization totals. Daily key usage is in UTC.</p>
        {error && <p role="alert" className="text-critical text-sm">{error}</p>}
        {warnings.length > 0 && <div className="rounded-lg bg-warning/5 border border-warning/20 px-3 py-2 text-xs space-y-1">{warnings.map((s) => <p key={`${s.provider}:${s.account}:${s.phase}`}><strong>{getProviderLabel(s.provider)} · {s.account} · {s.phase}:</strong> {s.message}</p>)}</div>}
      </div>
      <div className="overflow-auto max-h-[480px]">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="sticky top-0 bg-card text-muted text-xs text-left border-b border-card-border"><tr><th className="px-5 py-3 font-medium">Key / where used</th><th className="px-3 py-3 font-medium">Masked identifier</th><th className="px-3 py-3 font-medium text-right">Input / output tokens</th><th className="px-3 py-3 font-medium text-right">Requests</th><th className="px-5 py-3 font-medium text-right">Reported cost</th></tr></thead>
          <tbody>{shown.map((key) => <tr key={key.id} className="border-t border-card-border/60 hover:bg-card-border/15">
            <td className="px-5 py-3"><button type="button" onClick={() => setSelectedId(key.id)} className="font-medium text-left hover:underline flex items-center gap-2"><Brand provider={key.provider} />{title(key)}</button><p className="text-xs text-muted mt-1">{getProviderLabel(key.provider)} · {key.status || "Observed in usage"}</p><p className="text-xs mt-1 max-w-72 break-words">{key.usedIn || <span className="text-muted">Add where this key is used</span>}</p></td>
            <td className="px-3 py-3"><span className="font-mono text-xs whitespace-nowrap">{key.hint}</span><p className="text-xs text-muted mt-1">{key.hintKind === "key" ? "Redacted key" : key.hintKind === "hash" ? "Key hash" : "Key ID"}</p></td>
            <td className="px-3 py-3 text-right tabular-nums"><span>{key.days ? count(key.input) : "—"}</span><span className="text-muted"> / </span><span>{key.days ? count(key.output) : "—"}</span></td>
            <td className="px-3 py-3 text-right tabular-nums">{count(key.requests)}</td><td className="px-5 py-3 text-right tabular-nums">{key.cost === null ? "—" : formatCurrencyDetail(key.cost)}</td>
          </tr>)}</tbody>
        </table>
        {!shown.length && <p className="text-sm text-muted p-6 text-center">{data ? data.keys.length ? "No keys match these filters." : "No keys recorded yet. Choose Refresh keys to read the configured providers." : "Loading saved keys…"}</p>}
      </div>
      <div className="p-4 sm:px-5 text-xs text-muted border-t border-card-border space-y-2">
        <p>Tokens: OpenAI text generation and Anthropic messages. OpenRouter includes reported cost for the last 30 completed UTC days; today arrives tomorrow. A dash means no attributed reading, or that the provider does not report that field. Historical readings are kept in SQLite.</p>
        <details><summary className="cursor-pointer">Sources and last refresh</summary><ul className="mt-2 space-y-2">{statuses.map((s) => <li key={`${s.provider}:${s.account}:${s.phase}`}><strong className="text-foreground">{getProviderLabel(s.provider)} · {s.account} · {s.phase}</strong><br />{s.message} Last successful read: {s.succeededAt ? new Date(s.succeededAt).toLocaleString() : "Never"}.</li>)}</ul>{!statuses.length && <p className="mt-2">Refresh keys to check access. xAI currently supports inventory here; per-key usage is not integrated.</p>}</details>
      </div>
    </div>
    {selected && <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5 space-y-5">
      <div className="flex justify-between gap-3"><div><h3 className="font-semibold flex items-center gap-2"><Brand provider={selected.provider} />{title(selected)}</h3><p className="text-xs text-muted mt-1 font-mono">{selected.hint}</p></div><button type="button" className="text-xs text-muted hover:text-foreground self-start" onClick={() => setSelectedId("")}>Show all keys</button></div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-xs"><div><dt className="text-muted">Provider name</dt><dd>{selected.name || "Not available"}</dd></div><div><dt className="text-muted">Account / workspace</dt><dd>{selected.account}{selected.project ? ` / ${selected.project}` : ""}</dd></div><div><dt className="text-muted">Created</dt><dd>{date(selected.createdAt)}</dd></div><div><dt className="text-muted">Last used</dt><dd>{date(selected.lastUsedAt)}</dd></div><div><dt className="text-muted">Metadata last seen</dt><dd>{date(selected.seenAt)}</dd></div></dl>
      <Annotation key={selected.id} entry={selected} onSaved={() => setRevision((n) => n + 1)} />
      <div><h4 className="text-sm font-medium mb-2">Recorded daily usage · {start} to {end} (exclusive), UTC</h4>
        {daily.length ? <div className="overflow-auto max-h-72"><table className="text-xs w-full min-w-[560px]"><thead className="text-muted text-left"><tr><th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Model</th><th className="py-2 text-right font-medium">Input tokens</th><th className="py-2 text-right font-medium">Output tokens</th><th className="py-2 text-right font-medium">Reported cost</th></tr></thead><tbody>{daily.map((r) => <tr key={`${r.date}:${r.model}`} className="border-t border-card-border/60"><td className="py-2">{r.date}</td><td className="py-2">{r.model}</td><td className="py-2 text-right tabular-nums">{count(r.input)}</td><td className="py-2 text-right tabular-nums">{count(r.output)}</td><td className="py-2 text-right tabular-nums">{r.cost === null ? "—" : formatCurrencyDetail(r.cost)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">No usage attributed to this key in the selected period. Inventory access and usage access are checked separately above.</p>}
      </div>
    </div>}
  </section>;
}
function Brand({ provider }: { provider: string }) {
  const icon = provider === "openai" ? "codex" : provider === "anthropic" ? "claude" : provider === "xai" ? "grok" : null;
  return icon ? <ProviderIcon provider={icon} className="w-4 h-4 shrink-0" /> : <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: getProviderColor(provider) }} aria-hidden="true" />;
}
function Annotation({ entry, onSaved }: { entry: KeyRecord; onSaved: () => void }) {
  const [alias, setAlias] = useState(entry.alias); const [usedIn, setUsedIn] = useState(entry.usedIn); const [note, setNote] = useState(entry.note);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="space-y-3" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/keys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, alias, usedIn, note }) });
      if (!response.ok) throw new Error(); setMessage("Saved locally."); onSaved();
    } catch { setMessage("Could not save. Your edits are still here; try again."); } finally { setBusy(false); }
  }}>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-muted space-y-1">Local name<input maxLength={120} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={entry.name || "Name this key"} className={inputClass} /></label><label className="block text-xs text-muted space-y-1">Used in<input maxLength={240} value={usedIn} onChange={(e) => setUsedIn(e.target.value)} placeholder="App, project, machine, or workflow" className={inputClass} /></label></div>
    <label className="block text-xs text-muted space-y-1">Notes<textarea maxLength={2000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this key is for. Keep credentials out of notes." className={inputClass} /></label>
    <div className="flex items-center gap-3"><button type="submit" disabled={busy} className="bg-foreground text-background px-3 py-2 text-sm rounded-lg disabled:opacity-50">{busy ? "Saving…" : "Save details"}</button><span role="status" className="text-xs text-muted">{message}</span><span className="text-xs text-muted ml-auto">Local annotations; provider key names stay as they are.</span></div>
  </form>;
}
