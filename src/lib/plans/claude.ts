import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeWindows, newestUpdate, type ClaudeState, type PlanUsage } from "./parse";

// Written by scripts/claude-statusline.sh on each Claude Code status line refresh.
const STATE_PATH =
  process.env.CLAUDE_USAGE_STATE ??
  join(homedir(), ".local", "state", "ai-usage", "claude-rate-limits.json");

const MISSING_MESSAGE =
  "No terminal reading yet. Automatic capture uses the Claude Code terminal status line; Claude desktop replies do not update it.";

export function getClaudeUsage(nowSec = Date.now() / 1000): PlanUsage {
  const base = {
    id: "claude" as const,
    name: "Claude Max",
    windows: [],
    updatedAt: null,
    note: "Model-specific weekly limits and credit balances are not included in this source.",
  };

  let state: ClaudeState;
  try {
    state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ...base,
      status: missing ? "missing" : "error",
      message: missing
        ? MISSING_MESSAGE
        : `Couldn't read ${STATE_PATH}.`,
    };
  }

  const windows = claudeWindows(state, nowSec);
  if (windows.length === 0) {
    return { ...base, status: "missing", message: MISSING_MESSAGE };
  }
  return { ...base, status: "ok", windows, updatedAt: newestUpdate(windows) };
}
