// Builds the Development costs view: each subscription period's fee split by repository,
// with the project and client each repository is linked to. Pure apart from its inputs.
import { priceRecordedUsage } from "../activity/pricing.ts";
import type { Repo, RepoResolver } from "./repos.ts";
import { billingPeriods, splitFee, SUBSCRIPTIONS, type Period, type SubscriptionId } from "./split.ts";
import type { Register, UsageRow } from "./store.ts";

export const UNASSIGNED = "Unassigned";

export type SplitRow = {
  key: string; // "repo:<id>" or "folder:<name>" (usage outside a known repository)
  label: string;
  repoId: string | null;
  projectId: number | null;
  projectName: string;
  clientId: number | null;
  clientName: string;
  apiEquivalentUsd: number;
  share: number;
  chargeUsd: number;
};
export type PeriodView = Period & { rows: SplitRow[]; apiEquivalentUsd: number; unpricedTokens: number; unpricedModels: string[] };
export type SubscriptionView = { id: SubscriptionId; label: string; tool: string; periods: PeriodView[] };
export type RepoView = { id: string; name: string; git: boolean; projectId: number | null; apiEquivalentUsd: number };
export type DevCostsView = Register & { today: string; subscriptions: SubscriptionView[]; repos: RepoView[] };

type Deps = {
  register: Register;
  repos: Repo[];
  resolver: RepoResolver;
  today: string;
  usage: (start: string, end: string, sources: readonly string[]) => UsageRow[];
  repoWindowStart: string; // usage since this date is shown beside each repository
};

function resolve(row: UsageRow, resolver: RepoResolver): { key: string; label: string; repo: Repo | null } {
  // Folder-name matching is only for old rows with no recorded folder: a recorded folder
  // that is not in a known repository (say ~/Downloads/keel) must not be billed to one.
  const repo = row.cwd ? resolver.fromCwd(row.cwd) : resolver.fromClaudeKey(row.path) ?? resolver.fromName(row.project);
  if (repo) return { key: `repo:${repo.id}`, label: repo.id, repo };
  const name = row.project || "No folder";
  return { key: `folder:${name}`, label: name, repo: null };
}

function priced(rows: UsageRow[], resolver: RepoResolver) {
  const byKey = new Map<string, { label: string; repo: Repo | null; value: number }>();
  let unpricedTokens = 0;
  const unpricedModels = new Set<string>();
  for (const r of rows) {
    const cost = priceRecordedUsage(r.source, r.model, r, null);
    if (cost === null) {
      unpricedTokens += r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
      unpricedModels.add(r.model);
      continue;
    }
    const { key, label, repo } = resolve(r, resolver);
    const g = byKey.get(key) ?? { label, repo, value: 0 };
    g.value += cost;
    byKey.set(key, g);
  }
  return { byKey, unpricedTokens, unpricedModels: [...unpricedModels].sort() };
}

export function buildDevCostsView(d: Deps): DevCostsView {
  const { register } = d;
  const projects = new Map(register.projects.map((p) => [p.id, p]));
  const clients = new Map(register.clients.map((c) => [c.id, c]));
  const owner = (repoId: string | null) => {
    const project = repoId ? projects.get(register.repoProjects[repoId]) : undefined;
    const client = project ? clients.get(project.clientId) : undefined;
    return { projectId: project?.id ?? null, projectName: project?.name ?? UNASSIGNED, clientId: client?.id ?? null, clientName: client?.name ?? UNASSIGNED };
  };

  const periods = billingPeriods(register.terms, d.today);
  const subscriptions: SubscriptionView[] = SUBSCRIPTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    tool: s.tool,
    periods: periods.filter((p) => p.subscription === s.id).map((p) => {
      const { byKey, unpricedTokens, unpricedModels } = priced(d.usage(p.start, p.end, s.sources), d.resolver);
      // With usage but none of it priced, say so rather than "no usage".
      const empty = unpricedTokens > 0 ? "Usage not priced" : "No recorded usage";
      const lines = splitFee(p.feeUsd, [...byKey].map(([key, g]) => ({ key, apiEquivalentUsd: g.value })), `folder:${empty}`);
      const rows = lines.map((l) => {
        const g = byKey.get(l.key);
        const repoId = g?.repo?.id ?? null;
        return { ...l, label: g?.label ?? empty, repoId, ...owner(repoId) };
      });
      return { ...p, rows, apiEquivalentUsd: rows.reduce((t, r) => t + r.apiEquivalentUsd, 0), unpricedTokens, unpricedModels };
    }),
  }));

  // Every repository found on disk, plus any linked one that has since moved, with recent usage.
  const recent = priced(d.usage(d.repoWindowStart, "9999-12-31", SUBSCRIPTIONS.flatMap((s) => s.sources)), d.resolver).byKey;
  const repos = new Map<string, RepoView>();
  const add = (r: { id: string; name: string; git?: false }) => {
    if (!repos.has(r.id)) repos.set(r.id, { id: r.id, name: r.name, git: r.git !== false, projectId: register.repoProjects[r.id] ?? null, apiEquivalentUsd: 0 });
    return repos.get(r.id)!;
  };
  for (const r of d.repos) add(r);
  for (const g of recent.values()) if (g.repo) add(g.repo).apiEquivalentUsd += g.value;
  for (const id of Object.keys(register.repoProjects)) add({ id, name: id.split("/").pop() ?? id });

  return {
    ...register,
    today: d.today,
    subscriptions,
    repos: [...repos.values()].sort((a, b) => b.apiEquivalentUsd - a.apiEquivalentUsd || a.id.localeCompare(b.id)),
  };
}
