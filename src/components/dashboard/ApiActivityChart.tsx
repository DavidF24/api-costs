"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ApiActivityDaily } from "@/lib/activity/queries";
import { formatCompact } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";

export function ApiActivityChart({ daily, start, end }: { daily: ApiActivityDaily[]; start: string; end: string }) {
  const map = new Map<string, { date: string; input: number; output: number }>();
  for (let date = start; date <= end; date = shiftDate(date, 1)) map.set(date, { date, input: 0, output: 0 });
  for (const d of daily) {
    const r = map.get(d.date);
    if (r) { r.input += d.input; r.output += d.output; }
  }
  const rows = [...map.values()];
  const hasTokens = rows.some((d) => d.input + d.output > 0);
  return <div className="bg-card border border-card-border rounded-xl p-4 sm:p-5">
    <h3 className="text-sm font-medium">Recorded API tokens per day</h3>
    <p className="text-xs text-muted mt-1 mb-4">Only providers that report token counts. API billing records do not provide comparable session or message history.</p>
    {hasTokens ? <div className="h-60" role="img" aria-label={`Daily recorded API input and output tokens from ${start} to ${end}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--card-border)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "var(--muted)", fontSize: 11 }} minTickGap={45} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatCompact} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(value) => formatCompact(Number(value))} contentStyle={{ background: "var(--card)", borderColor: "var(--card-border)", borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="input" name="Input tokens" stackId="tokens" fill="var(--accent-blue)" isAnimationActive={false} />
          <Bar dataKey="output" name="Output tokens" stackId="tokens" fill="var(--provider-openai)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="flex justify-end gap-4 text-xs text-muted mt-1"><span>Blue · input</span><span>Green · output</span></p>
    </div> : <p className="text-sm text-muted py-8 text-center">No API token counts reported in this range. Charges and models can still appear below.</p>}
  </div>;
}
