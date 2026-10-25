"use client";

import type { ActivityResult } from "@/lib/activity/queries";
import { subscriptionEstimates } from "@/lib/activity/view";
import { formatCurrency, getSourceLabel } from "@/lib/format";
import { getModelPrice, PRICING_SOURCES, PRICING_VERIFIED_ON } from "@/lib/activity/pricing";
import { localSource } from "@/lib/activity/view";
import { DateRangePicker } from "./DateRangePicker";
import { ProviderIcon } from "./ProviderIcon";
import { useActivityRange } from "./useActivityRange";

export function ApiEquivalents({ initial, year, today, serverNow }: { initial: ActivityResult; year: ActivityResult; today: string; serverNow: number }) {
  const { days, setDays, state, data } = useActivityRange(initial, year, today, serverNow);
  const estimates = data ? subscriptionEstimates(data.daily) : [];
  return (
    <section aria-labelledby="equivalents-heading" className="space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h2 id="equivalents-heading" className="text-base font-semibold">At API prices</h2>
          <p className="text-xs text-muted mt-1">What your recorded subscription tokens would cost at current API rates over the last {days} days.</p>
        </div>
        <DateRangePicker activeDays={days} onChange={setDays} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {estimates.map((e) => <article key={e.source} className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ProviderIcon provider={e.source === "claude-code" ? "claude" : e.source === "codex" ? "codex" : "grok"} className="w-5 h-5" />
            {e.source === "claude-code" ? "Claude Code" : e.source === "codex" ? "ChatGPT Codex" : "Grok & Grok Bot"}
          </div>
          <p className="font-display text-3xl font-semibold mt-4">{e.tokens > e.unpricedTokens ? `≈ ${formatCurrency(e.cost)}` : "Unavailable"}</p>
          <p className="text-xs text-muted mt-2">{e.source === "grok" ? "Grok tokens at standard API rates. Grok Bot: no token data available." : e.tokens > 0 ? "API-equivalent estimate from local token history." : "No recorded tokens in this range."}</p>
          {e.tokens > 0 && <p className={`text-xs mt-2 ${e.unpricedTokens > 0 ? "text-warning" : "text-muted"}`}>
            {e.unpricedTokens === 0 ? "All recorded tokens priced." : `Partial estimate: ${((e.tokens - e.unpricedTokens) / e.tokens * 100).toFixed(1)}% of recorded tokens priced.`}
          </p>}
          {e.unpricedTokens > 0 && <p className="text-xs text-muted mt-1 break-words">Unpriced: {data?.models.filter((m) => m.source === e.source && (m.unpricedTokens ?? 0) > 0).map((m) => m.model).join(", ") || "unknown model"}.</p>}
        </article>)}
      </div>
      {!data && <p role="status" className={`text-sm ${state === "error" ? "text-critical" : "text-muted"}`}>{state === "error" ? "Couldn't load this range. Reload to try again." : "Loading…"}</p>}
      <EstimateNote />
      {data && <details className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
        <summary className="text-sm font-medium cursor-pointer">Model rates and coverage</summary>
        <p className="text-xs text-muted mt-3">USD per million tokens, using standard short-context rates. Cache writes show short / long TTL: Claude 5m / 1h; OpenAI 30m / 12h (only short writes are recorded); Grok uses input rates. — means no verified rate.</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <caption className="sr-only">Current API rates and estimated cost for subscription models in the selected range</caption>
            <thead><tr className="border-b border-card-border text-muted">
              {["Model", "Input", "Cached input", "Cache writes", "Output", "API equivalent"].map((label) => <th scope="col" key={label} className="py-2 pr-5 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{data.models.filter((m) => localSource(m.source) && m.source !== "grok-bot").map((m) => {
              const p = getModelPrice(m.model);
              const rate = (v: number | null | undefined) => v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
              return <tr key={`${m.source}:${m.model}`} className="border-b border-card-border last:border-0">
                <th scope="row" className="py-3 pr-5 font-normal"><span className="block font-medium">{m.model}</span><span className="text-muted">{getSourceLabel(m.source)}</span></th>
                <td className="py-3 pr-5">{rate(p?.input)}</td>
                <td className="py-3 pr-5">{rate(p?.cacheRead)}</td>
                <td className="py-3 pr-5">{rate(p?.cacheWrite5m)} / {rate(p?.cacheWrite1h)}</td>
                <td className="py-3 pr-5">{rate(p?.output)}</td>
                <td className="py-3 pr-5">{!p || ((m.unpricedTokens ?? 0) > 0 && m.estCost === 0) ? "Unpriced" : `≈ ${formatCurrency(m.estCost)}${(m.unpricedTokens ?? 0) > 0 ? " (partial)" : ""}`}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </details>}
    </section>
  );
}

export function EstimateNote() {
  const checked = new Date(`${PRICING_VERIFIED_ON}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return <p className="text-xs text-muted">≈ values are comparisons, not additional charges. All saved tokens use current standard rates checked {checked} ({PRICING_SOURCES.map((s, i) => <span key={s.name}>{i > 0 && ", "}<a className="underline underline-offset-2" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></span>)}). Long-context, speed and regional premiums, tool fees and taxes are excluded. Models or token categories without verified rates are excluded; Grok Bot has no token data.</p>;
}
