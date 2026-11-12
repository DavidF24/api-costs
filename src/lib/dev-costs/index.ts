import { homedir } from "node:os";
import { join } from "node:path";
import { sqlite } from "@/lib/db";
import { shiftDate, toEasternDate } from "@/lib/timezone";
import { createRepoResolver, listRepos, type Repo } from "./repos";
import { billingPeriods, SUBSCRIPTIONS } from "./split";
import { DEFAULT_IDLE_CUTOFF_MIN, readFolderUsage, readMigrationConflicts, readProfile, readRegister, type BillingProfile, type Register, NotFound } from "./store";
import { buildDevCostsView, ownerOf, splitPeriod, UNASSIGNED, type DevCostsView, type PeriodView } from "./view";
import { hoursOf, readTrackerRows, tallyTime, type TrackerStatus } from "./time";
import { buildLines, monthRange, periodsClosingIn, readInvoices, saveDraft, type InvoiceSummary, type LineInput } from "./invoices";

// Repositories that show recent usage beside them in the register.
export const REPO_USAGE_DAYS = 90;
const REPO_SCAN_MS = 5 * 60 * 1000;

export function codeRoot(): string {
  return process.env.CODE_ROOT || join(homedir(), "code");
}

// The productivity tracker's database, opened read-only.
export function trackerPath(): string {
  return process.env.TRACKER_DB_PATH || join(homedir(), "code", "local-tools", "productivity-tracking", "data", "activity.db");
}

const cache = globalThis as unknown as { __devCostRepos?: { at: number; root: string; repos: Repo[] } };
function repos(): Repo[] {
  const root = codeRoot();
  const hit = cache.__devCostRepos;
  if (hit && hit.root === root && Date.now() - hit.at < REPO_SCAN_MS) return hit.repos;
  const found = listRepos(root);
  cache.__devCostRepos = { at: Date.now(), root, repos: found };
  return found;
}

export type DevCostsPayload = DevCostsView & { profile: BillingProfile; invoices: InvoiceSummary[]; migrationConflicts: string[] };

export function getDevCosts(now = new Date()): DevCostsPayload {
  const today = toEasternDate(now);
  const found = repos();
  const view = buildDevCostsView({
    register: readRegister(sqlite),
    repos: found,
    resolver: createRepoResolver(found, homedir(), codeRoot()),
    today,
    usage: (start, end, sources) => readFolderUsage(sqlite, start, end, sources),
    repoWindowStart: shiftDate(today, -(REPO_USAGE_DAYS - 1)),
  });
  return { ...view, profile: readProfile(sqlite), invoices: readInvoices(sqlite), migrationConflicts: readMigrationConflicts(sqlite) };
}

export type ClientMonth = { clientId: number; clientName: string; sendInvoices: boolean; idleCutoffMin: number; lines: LineInput[]; totalUsd: number; hours: number; invoice: InvoiceSummary | null };
export type UnassignedTime = { key: string; label: string; repoId: string | null; hours: number; days: number };
export type MonthPreview = {
  month: string;
  complete: boolean; // the month has ended
  tracker: TrackerStatus;
  clients: ClientMonth[];
  unassignedTime: UnassignedTime[];
  unassignedSubscriptionUsd: number;
  closedPeriods: { subscription: string; start: string; end: string; feeUsd: number }[];
  pendingPeriods: { subscription: string; start: string; end: string; feeUsd: number }[]; // close in this month but have not yet
};

function monthParts(month: string, register: Register, now: Date) {
  const today = toEasternDate(now);
  const [start, next] = monthRange(month);
  const found = repos();
  const resolver = createRepoResolver(found, homedir(), codeRoot());
  const names = new Map(found.map((r) => [r.id, r.name]));
  const folderName = (id: string) => names.get(id) ?? id.split("/").pop() ?? id;

  const all = billingPeriods(register.terms, today, 400);
  const closing = periodsClosingIn(month, all as PeriodView[]);
  const sources = (sub: string) => SUBSCRIPTIONS.find((s) => s.id === sub)?.sources ?? [];
  const closed = closing.filter((p) => !p.open).map((p) => splitPeriod(p, register, readFolderUsage(sqlite, p.start, p.end, sources(p.subscription)), resolver));
  const pending = closing.filter((p) => p.open);

  const { rows, status } = readTrackerRows(trackerPath(), start, next);
  const clientCutoff = new Map(register.clients.map((c) => [c.id, c.idleCutoffMin]));
  const cutoff = (repoId: string | null) => {
    const link = repoId ? register.repoLinks[repoId] : undefined;
    return (link && clientCutoff.get(link.clientId)) ?? DEFAULT_IDLE_CUTOFF_MIN;
  };
  const time = tallyTime(rows, resolver, cutoff);
  return { today, next, closed, pending, time, status, folderName };
}

export function getMonthPreview(month: string, now = new Date()): MonthPreview {
  const register = readRegister(sqlite);
  const { today, next, closed, pending, time, status, folderName } = monthParts(month, register, now);
  const invoices = readInvoices(sqlite).filter((i) => i.month === month && i.status !== "void");
  const clients = register.clients.map((c) => {
    const lines = buildLines(c, register, time, closed, folderName);
    const hours = lines.filter((l) => l.kind === "time").reduce((s, l) => s + (l.quantity ?? 0), 0);
    return {
      clientId: c.id, clientName: c.name, sendInvoices: c.sendInvoices, idleCutoffMin: c.idleCutoffMin, lines, hours: Math.round(hours * 100) / 100,
      totalUsd: lines.reduce((s, l) => s + Math.round(l.amountUsd * 100), 0) / 100, invoice: invoices.find((i) => i.clientId === c.id) ?? null,
    };
  });
  const unassignedTime = time
    .filter((t) => !t.repo || !register.repoLinks[t.repo.id])
    .map((t) => ({ key: t.key, label: t.label, repoId: t.repo?.id ?? null, hours: hoursOf(t.seconds), days: t.days }))
    .filter((t) => t.hours > 0);
  const unassignedSubscriptionUsd = closed.flatMap((p) => p.rows).filter((r) => ownerOf(register, r.repoId, r.label).clientName === UNASSIGNED)
    .reduce((s, r) => s + Math.round(r.chargeUsd * 100), 0) / 100;
  const brief = (p: { subscription: string; start: string; end: string; feeUsd: number }) => ({ subscription: p.subscription, start: p.start, end: p.end, feeUsd: p.feeUsd });
  return {
    month, complete: today >= next, tracker: status, clients, unassignedTime, unassignedSubscriptionUsd,
    closedPeriods: closed.map(brief), pendingPeriods: pending.map(brief),
  };
}

// Builds (or rebuilds) one client's draft for the month from the current numbers.
export function generateDraft(clientId: number, month: string, now = new Date()): number {
  const register = readRegister(sqlite);
  const client = register.clients.find((c) => c.id === clientId);
  if (!client) throw new NotFound("Client not found");
  const { closed, time, status, folderName } = monthParts(month, register, now);
  const lines = buildLines(client, register, time, closed, folderName);
  return saveDraft(sqlite, client, month, lines, {
    generatedAt: now.toISOString(), idleCutoffMin: client.idleCutoffMin, trackerBuiltAt: status.builtAt, trackerLatest: status.latest,
    periods: closed.map((p) => `${p.subscription} ${p.start}..${p.end}`),
  }, now);
}
