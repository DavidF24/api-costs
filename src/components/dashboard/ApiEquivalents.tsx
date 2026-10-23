"use client";

import type { ActivityResult } from "@/lib/activity/queries";
import { subscriptionEstimates } from "@/lib/activity/view";
import { formatCurrency } from "@/lib/format";
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
          <p className="text-xs text-muted mt-1">Estimated value of recorded subscription activity over the last {days} days. Covered by your plans.</p>
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
          {e.unpricedTokens > 0 && <p className="text-xs text-warning mt-2">Partial estimate: some models have no price on file.</p>}
        </article>)}
      </div>
      {!data && <p role="status" className={`text-sm ${state === "error" ? "text-critical" : "text-muted"}`}>{state === "error" ? "Couldn't load this range. Reload to try again." : "Loading…"}</p>}
      <EstimateNote />
    </section>
  );
}

export function EstimateNote() {
  return <p className="text-xs text-muted">≈ values are comparisons, not additional charges. Grok uses <a className="underline underline-offset-2" href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">standard token rates</a> verified Oct 22, 2026; long-context / Fast premiums and tool fees are excluded. Models without known prices are excluded.</p>;
}
