import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { identifierHint, type KeyBatch, type KeyRecord, type KeyStatus, type KeyView } from "./types.ts";

export function ensureApiKeys(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, account TEXT NOT NULL, key_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', hint TEXT NOT NULL, hint_kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '', created_at TEXT, last_used_at TEXT,
    alias TEXT NOT NULL DEFAULT '', used_in TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', seen_at TEXT NOT NULL,
    UNIQUE(provider, account, key_id)
  );
  CREATE TABLE IF NOT EXISTS api_key_usage (
    id TEXT NOT NULL REFERENCES api_keys(id), date TEXT NOT NULL, model TEXT NOT NULL,
    input REAL NOT NULL, output REAL NOT NULL, requests REAL, cost REAL, PRIMARY KEY(id, date, model)
  );
  CREATE INDEX IF NOT EXISTS api_key_usage_date ON api_key_usage(date);
  CREATE TABLE IF NOT EXISTS api_key_sync (
    provider TEXT NOT NULL, account TEXT NOT NULL, phase TEXT NOT NULL, ok INTEGER NOT NULL,
    message TEXT NOT NULL, attempted_at TEXT NOT NULL, succeeded_at TEXT, PRIMARY KEY(provider, account, phase)
  );`);
}
export function recordId(provider: string, account: string, keyId: string) {
  return createHash("sha256").update(JSON.stringify([provider, account, keyId])).digest("hex");
}
export function saveKeyBatch(db: Database.Database, batch: KeyBatch, now = new Date()) {
  const at = now.toISOString();
  db.transaction(() => {
    if (batch.phase === "inventory") {
      const put = db.prepare(`INSERT INTO api_keys (id,provider,account,key_id,name,hint,hint_kind,status,project,created_at,last_used_at,seen_at)
        VALUES (@id,@provider,@account,@keyId,@name,@hint,@hintKind,@status,@project,@createdAt,@lastUsedAt,@at)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,hint=excluded.hint,hint_kind=excluded.hint_kind,
        status=excluded.status,project=excluded.project,created_at=excluded.created_at,last_used_at=excluded.last_used_at,seen_at=excluded.seen_at`);
      for (const key of batch.keys ?? []) put.run({ ...key, id: recordId(batch.provider, batch.account, key.keyId), provider: batch.provider, account: batch.account, at });
    } else {
      // Delete only complete returned UTC buckets. Older history is never pruned.
      const remove = db.prepare(`DELETE FROM api_key_usage WHERE date=? AND id IN (SELECT id FROM api_keys WHERE provider=? AND account=?)`);
      const removeKey = db.prepare(`DELETE FROM api_key_usage WHERE date=? AND id=?`);
      for (const date of new Set(batch.dates ?? [])) {
        if (batch.coverageKeyIds) {
          for (const keyId of new Set(batch.coverageKeyIds)) removeKey.run(date, recordId(batch.provider, batch.account, keyId));
        } else remove.run(date, batch.provider, batch.account);
      }
      const ensure = db.prepare(`INSERT INTO api_keys(id,provider,account,key_id,hint,hint_kind,seen_at)
        VALUES (?,?,?,?,?,'id',?) ON CONFLICT(id) DO NOTHING`);
      const put = db.prepare(`INSERT INTO api_key_usage (id,date,model,input,output,requests,cost) VALUES (@id,@date,@model,@input,@output,@requests,@cost)
        ON CONFLICT(id,date,model) DO UPDATE SET input=excluded.input,output=excluded.output,requests=excluded.requests,cost=excluded.cost`);
      for (const row of batch.usage ?? []) {
        const id = recordId(batch.provider, batch.account, row.keyId);
        ensure.run(id, batch.provider, batch.account, row.keyId, identifierHint(row.keyId), at);
        put.run({ ...row, id });
      }
    }
  })();
}
export function saveKeyStatus(db: Database.Database, provider: string, account: string, phase: string, ok: boolean, message: string, now = new Date()) {
  const at = now.toISOString();
  db.prepare(`INSERT INTO api_key_sync(provider,account,phase,ok,message,attempted_at,succeeded_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(provider,account,phase) DO UPDATE SET ok=excluded.ok,message=excluded.message,attempted_at=excluded.attempted_at,
    succeeded_at=COALESCE(excluded.succeeded_at,api_key_sync.succeeded_at)`).run(provider,account,phase,ok ? 1 : 0,message,at,ok ? at : null);
}
export function readKeys(db: Database.Database, start: string, end: string): KeyView {
  const keys = db.prepare(`SELECT k.id,k.provider,k.account,k.key_id AS keyId,k.name,k.hint,k.hint_kind AS hintKind,k.status,k.project,
    k.created_at AS createdAt,k.last_used_at AS lastUsedAt,k.alias,k.used_in AS usedIn,k.note,k.seen_at AS seenAt,
    COALESCE(SUM(u.input),0) AS input,COALESCE(SUM(u.output),0) AS output,SUM(u.requests) AS requests,SUM(u.cost) AS cost,COUNT(DISTINCT u.date) AS days
    FROM api_keys k LEFT JOIN api_key_usage u ON k.id=u.id AND u.date>=? AND u.date<?
    GROUP BY k.id ORDER BY k.provider,k.account,COALESCE(NULLIF(k.alias,''),k.name),k.key_id`).all(start,end) as KeyRecord[];
  const statuses = db.prepare(`SELECT provider,account,phase,ok,message,attempted_at AS attemptedAt,succeeded_at AS succeededAt FROM api_key_sync ORDER BY provider,account,phase`).all() as KeyStatus[];
  const daily = db.prepare(`SELECT id,date,model,input,output,requests,cost FROM api_key_usage WHERE date>=? AND date<? ORDER BY date DESC,model`).all(start,end) as KeyView["daily"];
  return { keys, statuses, daily };
}
export function annotateKey(db: Database.Database, id: string, alias: string, usedIn: string, note: string): boolean {
  return db.prepare(`UPDATE api_keys SET alias=?,used_in=?,note=? WHERE id=?`).run(alias,usedIn,note,id).changes > 0;
}
