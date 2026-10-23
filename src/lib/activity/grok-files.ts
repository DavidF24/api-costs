import { createReadStream, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export type GrokFile = { path: string; key: string; source: "grok" | "grok-bot"; isSubagent: boolean; sessionId: string; project: string };
function dirs(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}
// Bound discovery to known session/persistence layouts. Never read auth stores,
// search databases, prompt history, tool output, or unrelated Electron blobs.
export function listGrokFiles(sessions: string, botPersistence: string): GrokFile[] {
  const files = new Map<string, GrokFile>();
  function add(f: GrokFile) {
    try {
      const stat = statSync(f.path);
      if (!stat.isFile()) return;
      const old = files.get(f.key);
      if (!old || stat.mtimeMs > statSync(old.path).mtimeMs) files.set(f.key, f);
    } catch { /* optional source absent */ }
  }
  for (const project of dirs(sessions)) {
    for (const id of dirs(join(sessions, project))) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      let name = project;
      try { name = basename(decodeURIComponent(project)); } catch { /* keep encoded name */ }
      add({ path: join(sessions, project, id, "updates.jsonl"), key: `grok:${id}`, source: "grok", isSubagent: false, sessionId: id, project: name });
    }
  }
  for (const filename of dirs(botPersistence)) {
    const id = grokBotTranscriptId(filename);
    if (id) add({ path: join(botPersistence, filename), key: `grok-bot:${id}`, source: "grok-bot", isSubagent: false, sessionId: id, project: "Grok Bot" });
  }
  return [...files.values()];
}

// Desktop persistence filenames are RFC4648 base32 keys, not arbitrary blob scans.
export function grokBotTranscriptId(filename: string): string | null {
  if (!/^[a-z2-7]+\.blob$/.test(filename) || filename.length > 2048) return null;
  let bits = 0, value = 0;
  const bytes: number[] = [];
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  for (const ch of filename.slice(0, -5)) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  const key = String.fromCharCode(...bytes);
  return /^sand\.client\.slice\.account\.[^.]+\.transcript\.replicas\.([a-f0-9-]{36})$/.exec(key)?.[1] ?? null;
}

// JSONL records end at LF. Node readline also splits Unicode U+2028/U+2029,
// which are legal inside JSON strings and occur in Grok tool output.
export async function streamGrokLines(path: string, onLine: (line: string) => void): Promise<void> {
  let pending = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    pending += chunk;
    let lf: number;
    while ((lf = pending.indexOf("\n")) !== -1) {
      onLine(pending.slice(0, lf));
      pending = pending.slice(lf + 1);
    }
    if (pending.length > 16 * 1024 * 1024) throw new Error("Grok update exceeds size limit");
  }
  if (pending.trim()) onLine(pending);
}
