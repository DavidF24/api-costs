// Read only the known billing fields. Unknown protobuf fields are skipped, never
// searched recursively for an arbitrary percentage or timestamp.
type Field = { n: number; wire: number; value: number | Buffer };
function fields(b: Buffer): Field[] {
  let i = 0;
  function varint(): number {
    let value = 0, factor = 1;
    for (let count = 0; count < 10 && i < b.length; count++) {
      const byte = b[i++]; value += (byte & 127) * factor;
      if (!Number.isSafeInteger(value)) throw Error("protobuf integer");
      if (byte < 128) return value;
      factor *= 128;
    }
    throw Error("protobuf truncated");
  }
  const result: Field[] = [];
  while (i < b.length) {
    const tag = varint(), n = Math.floor(tag / 8), wire = tag & 7;
    if (n < 1) throw Error("protobuf tag");
    let value: number | Buffer;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const len = varint(); if (i + len > b.length) throw Error("protobuf length");
      value = b.subarray(i, i + len); i += len;
    } else if (wire === 5 || wire === 1) {
      const size = wire === 5 ? 4 : 8;
      if (i + size > b.length) throw Error("protobuf fixed");
      value = wire === 5 ? b.readFloatLE(i) : b.readDoubleLE(i); i += size;
    } else throw Error("protobuf wire");
    result.push({ n, wire, value });
  }
  return result;
}
function one(fs: Field[], n: number, wire: number): number | Buffer | undefined {
  const hits = fs.filter(f => f.n === n);
  if (hits.length > 1 || hits.some(f => f.wire !== wire)) throw Error("protobuf field");
  return hits[0]?.value;
}
function message(fs: Field[], n: number): Field[] {
  const raw = one(fs, n, 2);
  return Buffer.isBuffer(raw) ? fields(raw) : [];
}
function timestamp(fs: Field[], n: number): number | null {
  const s = one(message(fs, n), 1, 0);
  return typeof s === "number" && s >= 1_700_000_000 && s < 3_000_000_000 ? s : null;
}
export type BillingReading = { used: number; start: number; end: number; minutes: number };
function reading(used: unknown, start: number | null, end: number | null, now: number): BillingReading | null {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100 || start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start) return null;
  const minutes = Math.round((end - start) / 60);
  if (minutes < 1 || minutes > 31 * 1440) return null;
  return { used, start, end, minutes };
}

export function parseGrokGRPC(raw: Buffer, now: number): BillingReading | null {
  try {
    if (!raw.length || raw.length > 1024 * 1024) return null;
    const payloads: Buffer[] = [];
    let i = 0, status: string | undefined;
    if (raw[0] === 0 || raw[0] === 128) {
      while (i < raw.length) {
        if (i + 5 > raw.length) return null;
        const flag = raw[i], len = raw.readUInt32BE(i + 1); i += 5;
        if ((flag !== 0 && flag !== 128) || i + len > raw.length) return null;
        const payload = raw.subarray(i, i + len); i += len;
        if (flag === 0) payloads.push(payload);
        else {
          const match = payload.toString().match(/(?:^|\r?\n)grpc-status:\s*(\d+)/);
          if (match) status = match[1];
        }
      }
      if (status !== "0" || payloads.length !== 1) return null;
    } else payloads.push(raw);
    const config = message(fields(payloads[0]), 1), period = message(config, 8);
    const kind = one(period, 1, 0), start = timestamp(period, 2), end = timestamp(period, 3);
    if (kind !== 1 && kind !== 2) return null;
    // creditUsagePercent is a proto3 float: an omitted scalar means zero only
    // inside a complete, active current-period response (never a partial frame).
    const used = one(config, 1, 5) ?? 0;
    return reading(used, start, end, now);
  } catch { return null; }
}

export function parseGrokREST(data: unknown, now: number): BillingReading | null {
  if (!data || typeof data !== "object") return null;
  const c = (data as { config?: Record<string, unknown> }).config;
  const p = c?.currentPeriod as Record<string, unknown> | undefined;
  if (!c || !p || !["USAGE_PERIOD_TYPE_WEEKLY", "USAGE_PERIOD_TYPE_MONTHLY"].includes(String(p.type))) return null;
  return reading(c.creditUsagePercent, typeof p.start === "string" ? Date.parse(p.start) / 1000 : null, typeof p.end === "string" ? Date.parse(p.end) / 1000 : null, now);
}

export function parseBotUsage(data: unknown, now: number): BillingReading | null {
  if (!data || typeof data !== "object") return null;
  const v = data as Record<string, unknown>;
  const hasLimit = typeof v.includedLimitZero === "boolean" ? !v.includedLimitZero : v.hasNonZeroIncludedLimit === true;
  if (!hasLimit) return null; // A trial expiry is not a recurring weekly reset.
  const end = typeof v.nextResetTimestampUtc === "string" ? Date.parse(v.nextResetTimestampUtc) / 1000 : null;
  const start = typeof v.currentPeriodStart === "string" ? Date.parse(v.currentPeriodStart) / 1000 : null;
  if (start === null || end === null || Math.abs(end - start - 7 * 86400) > 60) return null;
  const r = reading(v.usagePercent, start, end, now);
  return r ? { ...r, minutes: 10080 } : null;
}
