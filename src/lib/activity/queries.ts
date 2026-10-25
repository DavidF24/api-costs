import { sql, eq, and, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { activityUsage, activityTools, activitySessions, costEntries } from "../db/schema";
import { priceRecordedUsage } from "./pricing";
import { toEasternDate } from "../timezone";

export type ActivityDaily = {
  date: string;
  source: string; // local subscription source
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // cacheWrite5m + cacheWrite1h combined
  estCost: number; // sum of priced rows; a LOWER BOUND when some rows are unpriced (NULL)
  unpricedTokens: number;
};

export type ActivityModel = {
  model: string;
  source: string; // "claude-code" | "codex" | a cost_entries provider name (openai, xai, ...)
  days: number;
  lastUsed: string;
  tokens: number | null; // null when the source doesn't carry token counts (some cost_entries rows)
  estCost: number;
  unpricedTokens?: number;
};

export type ApiActivityDaily = { date: string; source: string; input: number; output: number; cost: number };

export type ToolCount = { name: string; count: number };
// One row per subagent type; `models` splits it by the model it was dispatched with ("inherit" = session model)
export type SubagentCount = { name: string; count: number; models: { model: string; count: number }[] };
export type McpServerCount = { server: string; count: number; tools: ToolCount[] };

export type ActivityToolsSummary = {
  builtin: ToolCount[];
  mcp: McpServerCount[];
  skill: ToolCount[];
  subagent: SubagentCount[];
  codex: ToolCount[];
};

export type SessionsByDay = { date: string; source: string; count: number };

export type ActivityTotals = {
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  estCost: number;
  sessions: number; // non-subagent sessions started within [start, end]
};

export type ActivityResult = {
  daily: ActivityDaily[];
  apiDaily: ApiActivityDaily[];
  models: ActivityModel[];
  tools: ActivityToolsSummary;
  sessions: SessionsByDay[];
  dataStart: { claude: string | null; codex: string | null; grok: string | null; grokBot: string | null };
  totals: ActivityTotals;
};

// Keep model-level buckets until pricing is applied, then roll up for the UI.
// Reprice retained subscription tokens at current verified rates, regardless of
// whether the index-time estimate was missing or used an older price snapshot.
function getLocalUsage(start: string, end: string) {
  return db.select({
    date: activityUsage.date,
    source: activityUsage.source,
    model: activityUsage.model,
    messages: sql<number>`SUM(${activityUsage.messages})`,
    input: sql<number>`SUM(${activityUsage.input})`,
    output: sql<number>`SUM(${activityUsage.output})`,
    cacheRead: sql<number>`SUM(${activityUsage.cacheRead})`,
    cacheWrite5m: sql<number>`SUM(${activityUsage.cacheWrite5m})`,
    cacheWrite1h: sql<number>`SUM(${activityUsage.cacheWrite1h})`,
    recorded: sql<number | null>`SUM(${activityUsage.estCostUsd})`,
  }).from(activityUsage)
    .where(and(gte(activityUsage.date, start), lte(activityUsage.date, end)))
    .groupBy(activityUsage.date, activityUsage.source, activityUsage.model)
    .all().map((r) => {
      const estCost = priceRecordedUsage(r.source, r.model, r, r.recorded);
      const tokens = r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
      return { ...r, estCost: estCost ?? 0, unpricedTokens: estCost === null ? tokens : 0 };
    });
}

function rollupLocal(rows: ReturnType<typeof getLocalUsage>) {
  const daily = new Map<string, ActivityDaily>();
  const models = new Map<string, ActivityModel & { dates: Set<string> }>();
  for (const r of rows) {
    const key = `${r.date}|${r.source}`;
    const d = daily.get(key) ?? { date: r.date, source: r.source, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estCost: 0, unpricedTokens: 0 };
    d.messages += r.messages;
    d.input += r.input;
    d.output += r.output;
    d.cacheRead += r.cacheRead;
    d.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;
    d.estCost += r.estCost;
    d.unpricedTokens += r.unpricedTokens;
    daily.set(key, d);
    if (r.model === "unknown") continue;
    const modelKey = `${r.source}|${r.model}`;
    const m = models.get(modelKey) ?? { source: r.source, model: r.model, days: 0, dates: new Set<string>(), lastUsed: r.date, tokens: 0, estCost: 0, unpricedTokens: 0 };
    m.dates.add(r.date);
    m.lastUsed = r.date > m.lastUsed ? r.date : m.lastUsed;
    // Preserve the existing Claude/Codex model-token convention; Grok input
    // excludes cached tokens, so include its cache columns explicitly.
    m.tokens = (m.tokens ?? 0) + r.input + r.output + (r.source === "grok" ? r.cacheRead + r.cacheWrite5m + r.cacheWrite1h : 0);
    m.estCost += r.estCost;
    m.unpricedTokens = (m.unpricedTokens ?? 0) + r.unpricedTokens;
    models.set(modelKey, m);
  }
  return {
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: [...models.values()].map(({ dates, ...m }) => ({ ...m, days: dates.size, tokens: m.source === "grok" && m.tokens === 0 ? null : m.tokens })),
  };
}

function getApiDaily(start: string, end: string): ApiActivityDaily[] {
  return db.select({
    date: costEntries.date,
    source: costEntries.provider,
    input: sql<number>`COALESCE(SUM(${costEntries.tokensIn}), 0)`,
    output: sql<number>`COALESCE(SUM(${costEntries.tokensOut}), 0)`,
    cost: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)`,
  }).from(costEntries)
    .where(and(gte(costEntries.date, start), lte(costEntries.date, end)))
    .groupBy(costEntries.date, costEntries.provider).orderBy(costEntries.date).all();
}

// API-provider models (OpenAI, xAI, Gemini, ...) already tracked in cost_entries, folded in
// so "models used" covers Claude Code + Codex + every metered API provider in one list.
function getProviderModels(start: string, end: string): ActivityModel[] {
  const rows = db
    .select({
      model: costEntries.model,
      source: costEntries.provider,
      days: sql<number>`COUNT(DISTINCT ${costEntries.date})`,
      lastUsed: sql<string>`MAX(${costEntries.date})`,
      tokens: sql<number>`COALESCE(SUM(${costEntries.tokensIn}), 0) + COALESCE(SUM(${costEntries.tokensOut}), 0)`,
      estCost: sql<number>`COALESCE(SUM(${costEntries.costUsd}), 0)`,
    })
    .from(costEntries)
    .where(and(gte(costEntries.date, start), lte(costEntries.date, end)))
    .groupBy(costEntries.model, costEntries.provider)
    .all();
  // tokensIn/tokensOut aren't populated for every provider row (image/video/flat-rate units);
  // a genuine 0 and "not tracked" are indistinguishable in SQL here, so this stays 0 rather
  // than null. Consumers that care about the distinction should check unitType on cost_entries
  // directly; this rollup is for the models list, not a token-accuracy source.
  return rows;
}

function getToolsUsed(start: string, end: string): ActivityToolsSummary {
  const rows = db
    .select({
      kind: activityTools.kind,
      grp: activityTools.grp,
      name: activityTools.name,
      count: sql<number>`COALESCE(SUM(${activityTools.count}), 0)`,
    })
    .from(activityTools)
    .where(and(gte(activityTools.date, start), lte(activityTools.date, end)))
    .groupBy(activityTools.kind, activityTools.grp, activityTools.name)
    .all();

  const builtin: ToolCount[] = [];
  const skill: ToolCount[] = [];
  const codex: ToolCount[] = [];
  const subagent: SubagentCount[] = [];
  const mcpByServer = new Map<string, McpServerCount>();

  for (const r of rows) {
    if (r.kind === "builtin") {
      builtin.push({ name: r.name, count: r.count });
    } else if (r.kind === "skill") {
      skill.push({ name: r.name, count: r.count });
    } else if (r.kind === "codex") {
      codex.push({ name: r.name, count: r.count });
    } else if (r.kind === "subagent") {
      let agent = subagent.find((a) => a.name === r.name);
      if (!agent) subagent.push((agent = { name: r.name, count: 0, models: [] }));
      agent.count += r.count;
      agent.models.push({ model: r.grp ?? "inherit", count: r.count });
    } else if (r.kind === "mcp") {
      const server = r.grp ?? "unknown";
      let entry = mcpByServer.get(server);
      if (!entry) {
        entry = { server, count: 0, tools: [] };
        mcpByServer.set(server, entry);
      }
      entry.count += r.count;
      entry.tools.push({ name: r.name, count: r.count });
    }
  }

  const byCountDesc = (a: ToolCount, b: ToolCount) => b.count - a.count;
  builtin.sort(byCountDesc);
  skill.sort(byCountDesc);
  codex.sort(byCountDesc);
  subagent.sort((a, b) => b.count - a.count);
  for (const a of subagent) a.models.sort((x, y) => y.count - x.count);
  const mcp = [...mcpByServer.values()].sort((a, b) => b.count - a.count);
  for (const server of mcp) server.tools.sort(byCountDesc);

  return { builtin, mcp, skill, subagent, codex };
}

// Sessions are grouped by the Eastern calendar date of startedAt, computed in JS rather than
// SQL: started_at is stored as a raw UTC ISO timestamp (session start/end, not a `date`
// bucket), and every other date in this file is Eastern via toEasternDate for consistency.
function getSessionsByDay(start: string, end: string): SessionsByDay[] {
  const rows = db
    .select({ startedAt: activitySessions.startedAt, source: activitySessions.source })
    .from(activitySessions)
    .where(eq(activitySessions.isSubagent, 0))
    .all();

  const counts = new Map<string, SessionsByDay>();
  for (const row of rows) {
    if (!row.startedAt) continue;
    const parsed = new Date(row.startedAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const date = toEasternDate(parsed);
    if (date < start || date > end) continue;
    const key = `${date}|${row.source}`;
    const entry = counts.get(key) ?? { date, source: row.source, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}

function getDataStart(): ActivityResult["dataStart"] {
  const rows = db
    .select({ source: activityUsage.source, minDate: sql<string>`MIN(${activityUsage.date})` })
    .from(activityUsage)
    .groupBy(activityUsage.source)
    .all();
  const bySource = new Map(rows.map((r) => [r.source, r.minDate]));
  return {
    claude: bySource.get("claude-code") ?? null,
    codex: bySource.get("codex") ?? null,
    grok: bySource.get("grok") ?? null,
    grokBot: bySource.get("grok-bot") ?? null,
  };
}

function getTotals(daily: ActivityDaily[], sessions: SessionsByDay[]): ActivityTotals {
  const base = daily.reduce(
    (acc, d) => ({
      messages: acc.messages + d.messages,
      input: acc.input + d.input,
      output: acc.output + d.output,
      cacheRead: acc.cacheRead + d.cacheRead,
      cacheWrite: acc.cacheWrite + d.cacheWrite,
      estCost: acc.estCost + d.estCost,
    }),
    { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estCost: 0 }
  );
  const sessionCount = sessions.reduce((acc, s) => acc + s.count, 0);
  return { ...base, sessions: sessionCount };
}

export function getActivity(start: string, end: string): ActivityResult {
  const local = rollupLocal(getLocalUsage(start, end));
  const daily = local.daily;
  const apiDaily = getApiDaily(start, end);
  const models = [...local.models, ...getProviderModels(start, end)].sort(
    (a, b) => b.estCost - a.estCost
  );
  const tools = getToolsUsed(start, end);
  const sessions = getSessionsByDay(start, end);
  const dataStart = getDataStart();
  const totals = getTotals(daily, sessions);

  return { daily, apiDaily, models, tools, sessions, dataStart, totals };
}
