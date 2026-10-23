"use client";

import { useState } from "react";
import type { ActivityResult } from "@/lib/activity/queries";
import { activityStats, scopeModels, type ActivityScope } from "@/lib/activity/view";
import { formatCompact, formatCurrency, formatInt, getSourceLabel } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { ApiActivityChart } from "./ApiActivityChart";
import { EstimateNote } from "./ApiEquivalents";
import { DateRangePicker } from "./DateRangePicker";
import { ModelsUsed } from "./ModelsUsed";
import { ToolsPanel } from "./ToolsPanel";
import { useActivityRange } from "./useActivityRange";

type Props = { year: ActivityResult; initial: ActivityResult; today: string; serverNow: number; active?: boolean };
const scopes = [{ key: "subscriptions", label: "Subscriptions" }, { key: "api", label: "API" }, { key: "combined", label: "Combined" }] as const;

export function ActivitySection({ year, initial, today, serverNow, active = true }: Props) {
  const { days, setDays, state, data } = useActivityRange(initial, year, today, serverNow);
  const [scope, setScope] = useState<ActivityScope>("combined");
  const view = data ? activityStats(data, scope) : null;
  const stats = view ? [
    ...(view.showLocal ? [
      { label: scope === "combined" ? "Subscription sessions" : "Sessions", value: formatInt(view.sessions ?? 0) },
      { label: scope === "combined" ? "Subscription messages" : "Messages", value: formatInt(view.messages ?? 0) },
    ] : [{ label: "Recorded input tokens", value: formatCompact(view.apiInput) }]),
    { label: "Recorded output tokens", value: formatCompact(view.output) },
    ...view.estimates.map((e) => ({ label: `${getSourceLabel(e.source)} at API prices`, value: e.tokens > e.unpricedTokens ? `≈ ${formatCurrency(e.cost)}${e.unpricedTokens > 0 ? " +" : ""}` : "Unavailable" })),
    ...(view.apiCost !== null ? [{ label: "API billed spend", value: formatCurrency(view.apiCost) }] : []),
  ] : [];

  return (
    <section aria-labelledby="activity-heading" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="activity-heading" className="text-base font-semibold">Activity</h2>
          <p className="text-xs text-muted mt-1">{scope === "subscriptions" ? "Local Claude Code, Codex, Grok and Grok Bot history on this Mac." : scope === "api" ? "Usage reported by your API providers." : "Subscription history and API usage in one view. Charges and estimates stay separate."}</p>
        </div>
        <DateRangePicker activeDays={days} onChange={setDays} />
      </div>
      <div role="group" aria-label="Activity source" className="inline-flex max-w-full flex-wrap rounded-lg border border-card-border bg-card p-1 gap-1">
        {scopes.map((s) => <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => setScope(s.key)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${scope === s.key ? "bg-foreground text-card" : "text-muted hover:text-foreground"}`}>{s.label}</button>)}
      </div>
      <dl aria-live="polite" className="flex flex-wrap gap-x-9 gap-y-5 min-h-14">
        {stats.map((s) => <div key={s.label}>
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd className="font-display text-2xl font-semibold mt-1">{s.value}</dd>
        </div>)}
      </dl>
      {!data && <p role="status" className={`text-sm ${state === "error" ? "text-critical" : "text-muted"}`}>{state === "error" ? "Couldn't load this range. Reload to try again." : "Loading…"}</p>}
      {scope !== "api" && <EstimateNote />}
      {scope === "combined" && <p className="text-xs text-muted">Recorded output tokens combine both sources. Session and message totals cover local subscriptions only; Grok Bot has no token data. A + marks a partial estimate.</p>}
      {scope !== "api" && <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
        <h3 className="text-sm font-medium mb-3">Messages per day, last 12 months</h3>
        <p className="text-xs text-muted mb-4">Automatic local history. This calendar always shows the last year; the selected range applies to summaries, tools and models. Grok and Grok Bot share a subscription and appear together below. Bot has message history only.</p>
        <ActivityHeatmap daily={year.daily} sessions={year.sessions} today={today} dataStart={year.dataStart} />
      </div>}
      {data && <>
        {scope !== "subscriptions" && active && <ApiActivityChart daily={data.apiDaily} start={shiftDate(today, -(days - 1))} end={data.apiDaily.reduce((end, d) => d.date > end ? d.date : end, today)} />}
        {scope !== "api" && <div>
          <h3 className="text-sm font-medium mb-2">Tools used · Claude Code & Codex</h3>
          <ToolsPanel tools={data.tools} />
        </div>}
        <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
          <h3 className="text-sm font-medium mb-3">Models used</h3>
          <div className="overflow-x-auto"><ModelsUsed models={scopeModels(data.models, scope)} /></div>
        </div>
      </>}
    </section>
  );
}
