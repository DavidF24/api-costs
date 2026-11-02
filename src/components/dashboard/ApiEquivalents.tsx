"use client";

import { useState } from "react";
import type { ActivityModel, ActivityResult } from "@/lib/activity/queries";
import { subscriptionEstimates } from "@/lib/activity/view";
import { formatCompact, formatCurrency, getSourceLabel } from "@/lib/format";
import { getModelPrice, PRICING_SOURCES, PRICING_VERIFIED_ON } from "@/lib/activity/pricing";
import { localSource } from "@/lib/activity/view";
import { DateRangePicker } from "./DateRangePicker";
import { ProviderIcon } from "./ProviderIcon";
import { useActivityRange } from "./useActivityRange";

const figures = [{ key: "costs", label: "Costs" }, { key: "tokens", label: "Tokens" }] as const;
type Figure = (typeof figures)[number]["key"];

export function ApiEquivalents({ initial, year, today, serverNow }: { initial: ActivityResult; year: ActivityResult; today: string; serverNow: number }) {
  const { days, setDays, state, data } = useActivityRange(initial, year, today, serverNow);
  const [figure, setFigure] = useState<Figure>("costs");
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
      {data && <ModelCoverage models={data.models.filter((m) => localSource(m.source) && m.source !== "grok-bot")} figure={figure} onFigure={setFigure} />}
    </section>
  );
}

function ModelCoverage({ models, figure, onFigure }: { models: ActivityModel[]; figure: Figure; onFigure: (figure: Figure) => void }) {
  const costs = figure === "costs";
  const headers = ["Model", "Input", "Cached input", "Cache writes", "Output", costs ? "API equivalent" : "Total"];
  const rate = (value: number | null | undefined) => value == null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return (
    <details className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
      <summary className="text-sm font-medium cursor-pointer">Model rates and coverage</summary>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted max-w-3xl">{costs
          ? "USD per million tokens, using standard short-context rates. Cache writes show short / long TTL: Claude 5m / 1h; OpenAI 30m / 12h (only short writes are recorded); Grok uses input rates. — means no verified rate."
          : "Recorded tokens for these models, in the same order as Costs. Cache writes show short / long TTL. Fresh input excludes tokens already counted as cache reads or writes."}</p>
        <div role="group" aria-label="Model figures" className="inline-flex shrink-0 rounded-lg border border-card-border bg-background p-1 gap-1">
          {figures.map((item) => <button key={item.key} type="button" aria-pressed={figure === item.key} onClick={() => onFigure(item.key)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${figure === item.key ? "bg-foreground text-card" : "text-muted hover:text-foreground"}`}>{item.label}</button>)}
        </div>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <caption className="sr-only">{costs ? "Current API rates and estimated cost for subscription models in the selected range" : "Recorded tokens for subscription models in the selected range, in API-equivalent order"}</caption>
          <thead><tr className="border-b border-card-border text-muted">
            {headers.map((label) => <th scope="col" key={label} className="py-2 pr-5 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{models.map((model) => {
            const price = getModelPrice(model.model);
            const usage = model.usage;
            const total = usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h : null;
            const count = (value: number | undefined) => value == null ? "—" : formatCompact(value);
            return <tr key={`${model.source}:${model.model}`} className="border-b border-card-border last:border-0">
              <th scope="row" className="py-3 pr-5 font-normal"><span className="block font-medium">{model.model}</span><span className="text-muted">{getSourceLabel(model.source)}</span></th>
              {costs ? <>
                <td className="py-3 pr-5 tabular-nums">{rate(price?.input)}</td>
                <td className="py-3 pr-5 tabular-nums">{rate(price?.cacheRead)}</td>
                <td className="py-3 pr-5 tabular-nums">{rate(price?.cacheWrite5m)} / {rate(price?.cacheWrite1h)}</td>
                <td className="py-3 pr-5 tabular-nums">{rate(price?.output)}</td>
                <td className="py-3 pr-5 tabular-nums">{!price || ((model.unpricedTokens ?? 0) > 0 && model.estCost === 0) ? "Unpriced" : `≈ ${formatCurrency(model.estCost)}${(model.unpricedTokens ?? 0) > 0 ? " (partial)" : ""}`}</td>
              </> : <>
                <td className="py-3 pr-5 tabular-nums">{count(usage?.input)}</td>
                <td className="py-3 pr-5 tabular-nums">{count(usage?.cacheRead)}</td>
                <td className="py-3 pr-5 tabular-nums">{usage ? `${formatCompact(usage.cacheWrite5m)} / ${formatCompact(usage.cacheWrite1h)}` : "—"}</td>
                <td className="py-3 pr-5 tabular-nums">{count(usage?.output)}</td>
                <td className="py-3 pr-5 tabular-nums">{total == null ? "—" : formatCompact(total)}</td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </details>
  );
}

export function EstimateNote() {
  const checked = new Date(`${PRICING_VERIFIED_ON}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return <p className="text-xs text-muted">≈ values are comparisons, not additional charges. All saved tokens use current standard rates checked {checked} ({PRICING_SOURCES.map((s, i) => <span key={s.name}>{i > 0 && ", "}<a className="underline underline-offset-2" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></span>)}). Long-context, speed and regional premiums, tool fees and taxes are excluded. Models or token categories without verified rates are excluded; Grok Bot has no token data.</p>;
}
