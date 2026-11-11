import { homedir } from "node:os";
import { join } from "node:path";
import { sqlite } from "@/lib/db";
import { shiftDate, toEasternDate } from "@/lib/timezone";
import { createRepoResolver, listRepos, type Repo } from "./repos";
import { readFolderUsage, readRegister } from "./store";
import { buildDevCostsView, type DevCostsView } from "./view";

// Repositories that show recent usage beside them in the register.
export const REPO_USAGE_DAYS = 90;
const REPO_SCAN_MS = 5 * 60 * 1000;

export function codeRoot(): string {
  return process.env.CODE_ROOT || join(homedir(), "code");
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

export function getDevCosts(now = new Date()): DevCostsView {
  const today = toEasternDate(now);
  const found = repos();
  return buildDevCostsView({
    register: readRegister(sqlite),
    repos: found,
    resolver: createRepoResolver(found, homedir(), codeRoot()),
    today,
    usage: (start, end, sources) => readFolderUsage(sqlite, start, end, sources),
    repoWindowStart: shiftDate(today, -(REPO_USAGE_DAYS - 1)),
  });
}
