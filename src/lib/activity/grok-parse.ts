// Local Grok CLI update logs and Grok Bot desktop transcript replicas. Keep only
// dates/counts/model/token metadata: conversation text is never returned or stored.
import type { ClaudeFinishResult, ClaudeUsageRow } from "./claude-parse.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown) => typeof v === "string" ? v : "";
const num = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const UNKNOWN = "unknown";

function iso(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 946684800000 || ms > Date.now() + 300000) return null;
  return new Date(ms).toISOString();
}

function collector(sessionId: string, project: string) {
  const rows = new Map<string, ClaudeUsageRow>();
  let start: string | null = null;
  let end: string | null = null;
  function row(ts: string, model: string, toDate: (iso: string) => string) {
    if (!start || ts < start) start = ts;
    if (!end || ts > end) end = ts;
    const date = toDate(ts);
    const key = `${date}|${model}`;
    let r = rows.get(key);
    if (!r) {
      r = { date, project, model, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
      rows.set(key, r);
    }
    return r;
  }
  function finish(): ClaudeFinishResult {
    return { session: { sessionId, project, startedAt: start, endedAt: end, isSubagent: false }, usage: [...rows.values()], tools: [], costState: null };
  }
  return { row, finish };
}

export function createGrokAccumulator(sessionId: string, project: string, toDate: (iso: string) => string) {
  const c = collector(sessionId, project);
  const messages = new Set<string>();
  const usageSeen = new Set<string>();
  let recognized = false;
  let model = UNKNOWN;
  function line(raw: string) {
    if (!raw.trim()) return;
    // Reject partial/corrupt snapshots so the indexer keeps the previous good rows.
    if (raw.length > 16 * 1024 * 1024) throw new Error("Grok update exceeds size limit");
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new Error("Incomplete or invalid Grok update log"); }
    const o = obj(data), p = obj(o.params), u = obj(p.update), m = obj(p._meta);
    if (str(p.sessionId) !== sessionId || !str(u.sessionUpdate)) return;
    recognized = true;
    // The envelope is epoch seconds; agentTimestampMs preserves sub-second timing.
    const ts = iso(m.agentTimestampMs) ?? iso(typeof o.timestamp === "number" ? o.timestamp * 1000 : null);
    if (!ts) return;
    const kind = u.sessionUpdate;
    if (kind === "user_message_chunk") {
      model = str(obj(u._meta).modelId) || model;
      return; // As with Claude/Codex, the heatmap counts assistant messages.
    }
    if (kind === "agent_message_chunk") {
      // Streaming chunks share a prompt and stream start. eventId identifies a
      // chunk, not a message, so counting eventIds would inflate the heatmap.
      const prompt = str(m.promptId);
      const stream = iso(m.streamStartMs);
      if (!prompt || !stream || obj(u.content).type !== "text") return;
      const key = `${prompt}|${stream}`;
      if (messages.has(key)) return;
      messages.add(key);
      c.row(stream, model, toDate).messages++;
    } else if (kind === "turn_completed") {
      const id = str(u.prompt_id);
      if (!id || usageSeen.has(id)) return;
      const usage = obj(u.usage);
      if (!Object.keys(usage).length) return;
      usageSeen.add(id);
      // These are per-turn totals, not cumulative session counters. Use the
      // model breakdown once; never add the summary on top of that breakdown.
      const models = obj(usage.modelUsage);
      for (const [name, values] of Object.entries(models)) {
        const v = obj(values);
        if (!Object.keys(v).length) continue;
        const r = c.row(ts, name, toDate);
        const cached = num(v.cachedReadTokens);
        const write = num(v.cacheCreationTokens);
        r.input += Math.max(0, num(v.inputTokens) - cached - write);
        r.output += num(v.outputTokens); // already includes reasoning
        r.cacheRead += cached;
        r.cacheWrite5m += write;
      }
    }
  }
  function finish() {
    if (!recognized) throw new Error("Unrecognized Grok update log");
    return c.finish();
  }
  return { line, finish };
}

export function parseGrokBotTranscript(raw: string, sessionId: string, toDate: (iso: string) => string): ClaudeFinishResult {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Incomplete or invalid Grok Bot transcript"); }
  const o = obj(data), value = obj(o.value);
  if (o.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Unsupported Grok Bot transcript format");
  const c = collector(sessionId, "Grok Bot");
  const seen = new Set<string>();
  function message(id: string, ts: string | null) {
    if (!id || !ts || seen.has(id)) return;
    seen.add(id);
    c.row(ts, UNKNOWN, toDate).messages++;
  }
  for (const entry of value.entries) {
    const e = obj(entry);
    // send-message is the Bot's reply to the user; widgets, approvals,
    // attachments and user/agent-directed messages are not assistant replies.
    if (e.kind === "send-message" && obj(e.message).type === "text") {
      message(str(e.id), iso(e.timestampMs));
    } else if (e.kind === "voice-call") {
      const conversation = obj(e.conversation);
      if (!Array.isArray(conversation.turns)) continue;
      for (const turn of conversation.turns) {
        const t = obj(turn);
        if (t.speaker === "assistant") message(`${str(e.id)}:${str(t.id)}`, iso(t.atMs));
      }
    }
  }
  return c.finish();
}
