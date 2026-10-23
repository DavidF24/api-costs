import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrokAccumulator, parseGrokBotTranscript } from "../src/lib/activity/grok-parse.ts";
import { grokBotTranscriptId, listGrokFiles } from "../src/lib/activity/grok-files.ts";

const id = "12345678-1234-1234-1234-123456789abc";
const ms = Date.parse("2026-10-20T12:00:00Z");
const date = (s: string) => s.slice(0, 10);
function update(kind: string, fields: object = {}, meta: object = {}, timestamp = ms / 1000) {
  return JSON.stringify({ timestamp, params: { sessionId: id, update: { sessionUpdate: kind, ...fields }, _meta: { agentTimestampMs: timestamp * 1000, ...meta } } });
}
function reply(prompt = "p1", stream = ms) { return update("agent_message_chunk", { content: { type: "text", text: "private text" } }, { promptId: prompt, streamStartMs: stream }); }
function blob(entries: unknown[], schemaVersion = 1) { return JSON.stringify({ schemaVersion, value: { entries } }); }
function text(id: string, timestampMs = ms) { return { kind: "send-message", id, timestampMs, message: { type: "text", content: "private reply" } }; }
function b32(s: string) {
  let bits = 0, value = 0, out = "";
  for (const byte of Buffer.from(s)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += "abcdefghijklmnopqrstuvwxyz234567"[(value >>> bits) & 31]; }
  }
  if (bits) out += "abcdefghijklmnopqrstuvwxyz234567"[(value << (5 - bits)) & 31];
  return out + ".blob";
}

test("Grok counts assistant streams once, not chunks, users, tools or reasoning", () => {
  const a = createGrokAccumulator(id, "project", date);
  a.line(update("user_message_chunk", { _meta: { modelId: "grok-4.7" } }));
  a.line(reply()); a.line(reply()); a.line(reply("p1", ms + 1000));
  a.line(update("agent_thought_chunk")); a.line(update("tool_call"));
  const r = a.finish();
  assert.equal(r.usage[0].messages, 2);
  assert.equal(r.usage[0].model, "grok-4.7");
  assert.equal(r.session.sessionId, id);
  assert.ok(!JSON.stringify(r).includes("private"));
});

test("Grok uses per-turn model totals once, subtracts cached input, and keeps dates separate", () => {
  const a = createGrokAccumulator(id, "project", date);
  const usage = { inputTokens: 999999, outputTokens: 999999, modelUsage: { "grok-4.7": { inputTokens: 100, cachedReadTokens: 40, cacheCreationTokens: 10, outputTokens: 20, reasoningTokens: 15 } } };
  a.line(update("turn_completed", { prompt_id: "p1", usage }));
  a.line(update("turn_completed", { prompt_id: "p1", usage }));
  a.line(update("turn_completed", { prompt_id: "p2", usage }, {}, ms / 1000 + 86400));
  const r = a.finish();
  assert.equal(r.usage.length, 2);
  assert.deepEqual(r.usage.map(u => [u.date, u.input, u.output, u.cacheRead, u.cacheWrite5m, u.messages]), [["2026-10-20",50,20,40,10,0],["2026-10-21",50,20,40,10,0]]);
});

test("Grok rejects partial/corrupt logs and ignores foreign sessions and invalid timestamps", () => {
  const a = createGrokAccumulator(id, "project", date);
  assert.throws(() => a.line('{"params":'), /invalid Grok/);
  a.line(reply().replace(id, "different"));
  assert.throws(() => a.finish(), /Unrecognized/);
  a.line(update("agent_message_chunk", { content: { type: "text" } }, { promptId: "p", streamStartMs: -1 }, -1));
  assert.equal(a.finish().usage.length, 0);
});

test("Grok incremental reparse replaces a snapshot rather than accumulating duplicate messages", () => {
  const parse = (lines: string[]) => { const a = createGrokAccumulator(id, "p", date); lines.forEach(a.line); return a.finish(); };
  assert.equal(parse([reply()]).usage[0].messages, 1);
  assert.equal(parse([reply(), reply(), reply("p2", ms + 2000)]).usage[0].messages, 2);
});

test("Bot counts dated text replies once and excludes widgets, attachments and sent user messages", () => {
  const r = parseGrokBotTranscript(blob([text("a"),text("a"),text("b",ms+86400000),{...text("user"),kind:"message",role:"user"},{...text("widget"),message:{type:"widget"}},text("bad",-1),text("future",Date.now()+86400000)]), id, date);
  assert.deepEqual(r.usage.map(u => [u.date,u.messages,u.output]), [["2026-10-20",1,0],["2026-10-21",1,0]]);
  assert.ok(!JSON.stringify(r).includes("private"));
  assert.equal(r.session.startedAt, new Date(ms).toISOString());
});

test("Bot rejects unknown schemas and corrupt documents before replacing indexed history", () => {
  assert.throws(() => parseGrokBotTranscript("{",id,date), /invalid/);
  assert.throws(() => parseGrokBotTranscript(blob([],2),id,date), /Unsupported/);
  assert.throws(() => parseGrokBotTranscript('{"schemaVersion":1,"value":{}}',id,date), /Unsupported/);
});

test("Bot counts assistant voice turns using their own timestamps, without double-counting transcript entries", () => {
  const voice = {kind:"voice-call",id:"call",timestampMs:ms,conversation:{turns:[{id:"1",speaker:"assistant",atMs:ms},{id:"2",speaker:"user",atMs:ms},{id:"3",speaker:"assistant",atMs:ms+86400000}]}};
  assert.deepEqual(parseGrokBotTranscript(blob([voice,voice]),id,date).usage.map(u=>u.messages),[1,1]);
});

test("Bot filename decoding accepts only account transcript replicas", () => {
  assert.equal(grokBotTranscriptId(b32(`sand.client.slice.account.grok-user.transcript.replicas.${id}`)),id);
  assert.equal(grokBotTranscriptId(b32("sand.client.slice.account.grok-user.weekly-usage.cache")),null);
  assert.equal(grokBotTranscriptId("sand-secrets.json"),null);
  assert.equal(grokBotTranscriptId(b32(`unrelated.transcript.replicas.${id}`)),null);
});

test("Discovery selects known logs, ignores secret stores, and deduplicates moved sessions/replicas", () => {
  const root=mkdtempSync(join(tmpdir(),"activity-grok-"));
  try {
    const sessions=join(root,"sessions"),bot=join(root,"bot");mkdirSync(bot,{recursive:true});
    for(const project of ["%2Ftmp%2Fone","%2Ftmp%2Ftwo"]){const dir=join(sessions,project,id);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"updates.jsonl"),reply());}
    utimesSync(join(sessions,"%2Ftmp%2Ftwo",id,"updates.jsonl"),new Date(ms+1000),new Date(ms+1000));
    utimesSync(join(sessions,"%2Ftmp%2Fone",id,"updates.jsonl"),new Date(ms),new Date(ms));
    writeFileSync(join(bot,b32(`sand.client.slice.account.account1.transcript.replicas.${id}`)),blob([text("a")]));
    writeFileSync(join(bot,"sand-secrets.json"),"DO NOT READ");
    const files=listGrokFiles(sessions,bot);
    assert.equal(files.length,2);assert.equal(files.find(f=>f.source==="grok")?.project,"two");
    assert.deepEqual(new Set(files.map(f=>f.key)),new Set([`grok:${id}`,`grok-bot:${id}`]));
    assert.equal(listGrokFiles(join(root,"absent"),join(root,"absent2")).length,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});
