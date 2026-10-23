import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, zstdCompressSync, crc32 } from "node:zlib";
import { cacheName, parseCachedJSON } from "../src/lib/plans/chromium-cache.ts";
import { desktopClaudeWindows } from "../src/lib/plans/claude-desktop.ts";
import { parseGrokGRPC, parseGrokREST, parseBotUsage } from "../src/lib/plans/grok-wire.ts";

const now = 1792700000;
const key = "1/0/https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/usage";
const usage = { five_hour: { utilization: 33, resets_at: new Date((now + 3000) * 1000).toISOString() }, seven_day: { utilization: 61, resets_at: new Date((now + 300000) * 1000).toISOString() } };

// Synthetic Chromium Simple v5 entry, using the published C++ structure layout.
function cacheFixture(at = now, compressed = "zstd"): Buffer {
  const header = Buffer.alloc(24); header.writeBigUInt64LE(BigInt("0xfcfb6d1ba7725c30")); header.writeUInt32LE(5, 8); header.writeUInt32LE(Buffer.byteLength(key), 12);
  const json = Buffer.from(JSON.stringify(usage));
  const body = compressed === "zstd" ? zstdCompressSync(json) : gzipSync(json);
  const http = Buffer.from("HTTP/1.1 200 OK\0content-type: application/json\0\0");
  const meta = Buffer.alloc(28 + http.length); meta.writeUInt32LE(meta.length - 4); meta.writeUInt32LE(3, 4); meta.writeBigInt64LE(BigInt(Math.round((at + 11644473600) * 1e6)), 8); meta.writeBigInt64LE(BigInt(Math.round((at + 11644473600) * 1e6)), 16); meta.writeUInt32LE(http.length, 24); http.copy(meta, 28);
  function eof(bytes: Buffer, flags: number) { const f = Buffer.alloc(24); f.writeBigUInt64LE(BigInt("0xf4fa6f45970d41d8")); f.writeUInt32LE(flags, 8); f.writeUInt32LE(crc32(bytes), 12); f.writeUInt32LE(bytes.length, 16); return f; }
  return Buffer.concat([header, Buffer.from(key), body, eof(body, 1), meta, createHash("sha256").update(key).digest(), eof(meta, 3)]);
}
test("Claude desktop: exact cache key, compressed response and provider timestamps", () => {
  assert.match(cacheName(key), /^[a-f0-9]{16}_0$/);
  for (const compression of ["zstd", "gzip"]) {
    const r = parseCachedJSON(cacheFixture(now, compression), key, now + 10);
    assert.deepEqual(r.data, usage); assert.equal(r.at, now);
    assert.deepEqual(desktopClaudeWindows(r.data, r.at, now).map(w => w.usedPercent), [33, 61]);
  }
});
test("Claude desktop: corrupt, partial, wrong-key, stale and future cache entries fail closed", () => {
  const b = cacheFixture(); const corrupt = Buffer.from(b); corrupt[150] ^= 1;
  assert.throws(() => parseCachedJSON(corrupt, key, now));
  assert.throws(() => parseCachedJSON(b.subarray(0, b.length - 2), key, now));
  assert.throws(() => parseCachedJSON(b, key + "?wrong", now));
  assert.throws(() => parseCachedJSON(b, key, now + 7201));
  assert.throws(() => parseCachedJSON(cacheFixture(now + 61), key, now));
});
test("Claude desktop: reset is unknown and malformed or oversized windows are omitted", () => {
  assert.equal(desktopClaudeWindows(usage, now, now + 4000)[0].usedPercent, null);
  for (const used of [-1, 101, NaN, "33", null]) assert.deepEqual(desktopClaudeWindows({ five_hour: { ...usage.five_hour, utilization: used } }, now, now), []);
  assert.deepEqual(desktopClaudeWindows(usage, now - 7201, now), []);
  assert.deepEqual(desktopClaudeWindows({ five_hour: { utilization: 10, resets_at: new Date((now + 40000) * 1000).toISOString() } }, now, now), []);
});

function vint(n: number): Buffer { const bytes: number[] = []; do { const x = n % 128; n = Math.floor(n / 128); bytes.push(x | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); }
const vi = (n: number, v: number) => Buffer.concat([vint(n * 8), vint(v)]);
const msg = (n: number, b: Buffer) => Buffer.concat([vint(n * 8 + 2), vint(b.length), b]);
function rpc(percent: number | null, start = now - 10, end = now + 604790): Buffer {
  const period = Buffer.concat([vi(1, 2), msg(2, vi(1, start)), msg(3, vi(1, end))]);
  const value = Buffer.alloc(percent === null ? 0 : 5); if (percent !== null) { value[0] = 13; value.writeFloatLE(percent, 1); }
  const payload = msg(1, Buffer.concat([value, msg(8, period)]));
  const frame = (flag: number, b: Buffer) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
  return Buffer.concat([frame(0, payload), frame(128, Buffer.from("grpc-status:0\r\n"))]);
}
test("Grok: complete current-period proto3 zero and published nonzero percentages", () => {
  assert.equal(parseGrokGRPC(rpc(null), now)?.used, 0);
  assert.equal(parseGrokGRPC(rpc(24.5), now)?.used, 24.5);
  assert.equal(parseGrokGRPC(rpc(24.5), now)?.minutes, 10080);
});
test("Grok: partial frames, RPC errors, expired periods and invalid floats never become zero", () => {
  const good = rpc(null);
  assert.equal(parseGrokGRPC(good.subarray(0, good.length - 2), now), null);
  assert.equal(parseGrokGRPC(Buffer.from(good.toString("hex").replace(Buffer.from("grpc-status:0").toString("hex"), Buffer.from("grpc-status:7").toString("hex")), "hex"), now), null);
  assert.equal(parseGrokGRPC(rpc(null, now - 604810, now - 10), now), null);
  assert.equal(parseGrokGRPC(rpc(null, now + 10, now + 604810), now), null);
  for (const p of [NaN, Infinity, -1, 101]) assert.equal(parseGrokGRPC(rpc(p), now), null);
  assert.equal(parseGrokGRPC(Buffer.from([10, 0]), now), null);
});
test("Grok REST: omitted JSON percentage stays unknown until the complete gRPC check", () => {
  const config = { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: new Date((now - 10) * 1000).toISOString(), end: new Date((now + 604790) * 1000).toISOString() } };
  assert.equal(parseGrokREST({ config }, now), null);
  assert.equal(parseGrokREST({ config: { ...config, creditUsagePercent: 0 } }, now)?.used, 0);
  assert.equal(parseGrokREST({ config: { ...config, creditUsagePercent: 36 } }, now)?.used, 36);
});
test("Grok Bot: recurring paid allowance is separate; trial expiry and absent usage are not zero", () => {
  const bot = { usagePercent: 16.2, hasNonZeroIncludedLimit: true, nextResetTimestampUtc: new Date((now + 10000) * 1000).toISOString() };
  assert.equal(parseBotUsage(bot, now)?.used, 16.2);
  assert.equal(parseBotUsage(bot, now)?.minutes, 10080);
  assert.equal(parseBotUsage({ ...bot, includedLimitZero: true }, now), null);
  assert.equal(parseBotUsage({ ...bot, usagePercent: undefined }, now), null);
  assert.equal(parseBotUsage({ ...bot, hasNonZeroIncludedLimit: false, sandTrialExpiresAt: bot.nextResetTimestampUtc }, now), null);
});


test("Grok and Bot: malformed period dates cannot create an ok reading or suppress fallback", () => {
  const start = new Date((now - 100) * 1000).toISOString();
  const end = new Date((now + 604700) * 1000).toISOString();
  for (const dates of [["invalid", end], [start, "invalid"], ["invalid", "invalid"]]) {
    assert.equal(parseGrokREST({ config: { creditUsagePercent: 0, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: dates[0], end: dates[1] } } }, now), null);
  }
  assert.equal(parseBotUsage({ hasNonZeroIncludedLimit: true, usagePercent: 0, nextResetTimestampUtc: "invalid" }, now), null);
});
