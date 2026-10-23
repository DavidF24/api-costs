import { createHash } from "node:crypto";
import * as zlib from "node:zlib";

// Chromium's documented Simple cache v5 layout. Only one exact URL is decoded;
// this is not a browser-history or cookie reader.
// https://chromium.googlesource.com/chromium/src/+/main/net/disk_cache/simple/simple_entry_format.h
const INITIAL = "fcfb6d1ba7725c30";
const FINAL = "f4fa6f45970d41d8";
export const MAX_CACHE_BYTES = 1024 * 1024;

export function cacheName(key: string): string {
  return createHash("sha1").update(key).digest().readBigUInt64LE(0).toString(16).padStart(16, "0") + "_0";
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function footer(raw: Buffer, at: number): { flags: number; size: number; crc: number } {
  if (at < 0 || at + 24 > raw.length || raw.readBigUInt64LE(at).toString(16) !== FINAL) throw Error("cache footer");
  const flags = raw.readUInt32LE(at + 8);
  if (flags & ~3) throw Error("cache flags");
  return { flags, crc: raw.readUInt32LE(at + 12), size: raw.readUInt32LE(at + 16) };
}

export function parseCachedJSON(raw: Buffer, key: string, nowSec: number): { data: unknown; at: number } {
  if (raw.length < 100 || raw.length > MAX_CACHE_BYTES || raw.readBigUInt64LE(0).toString(16) !== INITIAL || raw.readUInt32LE(8) !== 5) throw Error("cache format");
  const keyLen = raw.readUInt32LE(12);
  if (keyLen > 4096 || !raw.subarray(24, 24 + keyLen).equals(Buffer.from(key))) throw Error("cache key");
  const last = footer(raw, raw.length - 24);
  const metaEnd = raw.length - 24 - ((last.flags & 2) ? 32 : 0);
  if (last.flags & 2) {
    if (!raw.subarray(metaEnd, metaEnd + 32).equals(createHash("sha256").update(key).digest())) throw Error("cache key hash");
  }
  const metaStart = metaEnd - last.size;
  const bodyEnd = metaStart - 24;
  if (metaStart < 24 + keyLen + 24 || last.size < 32) throw Error("cache sizes");
  const first = footer(raw, bodyEnd);
  const meta = raw.subarray(metaStart, metaEnd);
  let body = raw.subarray(24 + keyLen, bodyEnd);
  if (((last.flags & 1) && crc32(meta) !== last.crc) || ((first.flags & 1) && crc32(body) !== first.crc)) throw Error("cache checksum");
  const flags = meta.readUInt32LE(4);
  if (meta.readUInt32LE(0) !== meta.length - 4 || (flags & 255) !== 3 || (flags & (1 << 12))) throw Error("cache metadata");
  const timeStart = (flags & 0x80000000) ? 12 : 8;
  const extra = timeStart === 12 ? meta.readUInt32LE(8) : 0;
  const at = Number(meta.readBigInt64LE(timeStart + 8)) / 1e6 - 11644473600;
  if (at < nowSec - 7200 || at > nowSec + 60) throw Error("cache stale");
  const headerAt = timeStart + 16 + ((extra & 4) ? 8 : 0);
  const headerLen = meta.readUInt32LE(headerAt);
  const headers = meta.subarray(headerAt + 4, headerAt + 4 + headerLen).toString();
  if (headerAt + 4 + headerLen > meta.length || !/^HTTP\/\S+ 200(?: |\0)/.test(headers) || !headers.toLowerCase().includes("application/json")) throw Error("cache response");
  const options = { maxOutputLength: MAX_CACHE_BYTES };
  if (body.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    const decode = (zlib as unknown as { zstdDecompressSync?: (b: Buffer, o: typeof options) => Buffer }).zstdDecompressSync;
    if (!decode) throw Error("Node 22.15+ is required for desktop cache compression");
    body = decode(body, options);
  } else if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body, options);
  else if (headers.toLowerCase().includes("content-encoding: deflate")) body = zlib.inflateSync(body, options);
  return { data: JSON.parse(body.toString("utf8")), at };
}
