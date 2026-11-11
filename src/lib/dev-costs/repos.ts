// Finds the git repositories under the code folder and traces a recorded working folder
// (including worktrees, subfolders and Claude's encoded project folder names) back to one
// of them. Plain node: imports only, so tests load it directly with `node --test`.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type Repo = {
  id: string; // path relative to the code folder, e.g. "ms-pro/mspro-rc"
  name: string; // folder name, e.g. "mspro-rc"
  path: string; // absolute path
  git?: false; // a plain folder in the code folder that has no repository of its own
};

const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "dist", "build", ".next", "worktrees", ".claude"]);

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function kind(path: string): "dir" | "file" | null {
  try {
    const s = statSync(path);
    return s.isDirectory() ? "dir" : s.isFile() ? "file" : null;
  } catch {
    return null;
  }
}

// A repository is a folder with a `.git` directory. A `.git` file marks a worktree or
// submodule checkout, which belongs to another repository, so it is not listed.
export function listRepos(codeRoot: string, maxDepth = 3): Repo[] {
  const out: Repo[] = [];
  const walk = (dir: string, depth: number) => {
    for (const name of entries(dir)) {
      if (SKIP.has(name) || name.includes(".worktrees")) continue;
      const path = join(dir, name);
      if (kind(path) !== "dir") continue;
      if (kind(join(path, ".git")) === "dir") {
        out.push({ id: relative(codeRoot, path).split(sep).join("/"), name, path });
      }
      if (depth < maxDepth) walk(path, depth + 1);
    }
  };
  walk(codeRoot, 1);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Claude Code names its project folders after the working folder with every character
// that is not a letter or digit replaced by "-".
export function encodeClaudeDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

export type RepoResolver = {
  fromCwd(cwd: string | null | undefined): Repo | null;
  fromClaudeKey(key: string): Repo | null;
  fromName(name: string): Repo | null;
};

export function createRepoResolver(repos: Repo[], home: string, codeRoot?: string): RepoResolver {
  const byLength = [...repos].sort((a, b) => b.path.length - a.path.length);
  const encoded = byLength.map((r) => ({ repo: r, enc: encodeClaudeDir(r.path) }));
  const names = new Map<string, Repo | null>();
  for (const r of repos) names.set(r.name, names.has(r.name) ? null : r); // null = ambiguous

  const fromName = (name: string) => names.get(name.replace(/\.worktrees.*$/, "")) ?? null;

  function fromCwd(raw: string | null | undefined): Repo | null {
    if (!raw) return null;
    let cwd = raw.startsWith("file://") ? decodeURIComponent(raw.slice(7)) : raw;
    cwd = cwd.replace(/\/+$/, "");
    // Codex-managed worktrees: ~/.codex/worktrees/<id>/<repo folder>/...
    const codexWorktrees = join(home, ".codex", "worktrees") + "/";
    if (cwd.startsWith(codexWorktrees)) {
      const folder = cwd.slice(codexWorktrees.length).split("/")[1];
      return folder ? fromName(folder) : null;
    }
    // <repo>/.claude/worktrees/<name>, <repo>/.worktrees/<name>, <repo>.worktrees.<name>
    cwd = cwd.replace(/\/\.claude\/worktrees\/.*$/, "").replace(/\/\.worktrees\/.*$/, "");
    const parts = cwd.split("/");
    const wt = parts.findIndex((p) => /^.+?\.worktrees(\.|$)/.test(p));
    if (wt >= 0) cwd = [...parts.slice(0, wt), parts[wt].replace(/\.worktrees.*$/, "")].join("/");
    // The deepest repository containing the folder (subfolders and in-repo worktrees).
    return byLength.find((r) => cwd === r.path || cwd.startsWith(r.path + "/")) ?? plainFolder(cwd);
  }

  // Work in a code-folder project that has no git repository (e.g. code/legal or
  // code/1-off-projects/hazel-diabetes) still belongs to that folder. A top-level folder
  // that holds repositories is a group, so its next level is the project.
  function plainFolder(cwd: string): Repo | null {
    if (!codeRoot || !cwd.startsWith(codeRoot + "/")) return null;
    const parts = cwd.slice(codeRoot.length + 1).split("/").filter(Boolean);
    if (parts.length === 0 || parts[0].startsWith(".")) return null;
    const group = repos.some((r) => r.id.startsWith(parts[0] + "/"));
    const id = (group && parts.length > 1 ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
    return { id, name: id.split("/").pop()!, path: `${codeRoot}/${id}`, git: false };
  }

  // Activity rows indexed before full folders were kept still carry the transcript key
  // "claude-code:<encoded folder>/<file>", which survives Claude pruning the file itself.
  function fromClaudeKey(key: string): Repo | null {
    const m = /^claude-code:([^/]+)\//.exec(key);
    if (!m) return null;
    const dir = m[1];
    return encoded.find(({ enc }) => dir === enc || dir.startsWith(enc + "-"))?.repo ?? null;
  }

  return { fromCwd, fromClaudeKey, fromName };
}

