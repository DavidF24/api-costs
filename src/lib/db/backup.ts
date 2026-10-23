import Database from "better-sqlite3";
import { chmod, link, mkdir, open, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

function verify(path: string, standalone = false) {
  const restored = new Database(path, { readonly: !standalone, fileMustExist: true });
  try {
    // Seal the new private copy as a standalone file, without WAL sidecars.
    if (standalone) restored.pragma("journal_mode = DELETE");
    if (restored.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Database backup integrity check failed");
  } finally {
    restored.close();
  }
}

// SQLite's online backup API includes committed WAL data. Never copy the live file
// directly, overwrite a completed daily snapshot, or expire historical backups.
export async function backupDatabase(sqlite: Database.Database, databasePath: string, now = new Date()): Promise<string> {
  const dir = join(dirname(databasePath), "backups", now.toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const target = join(dir, basename(databasePath));
  if (existsSync(target)) {
    verify(target);
    return target;
  }
  const temporary = join(dir, `.${randomUUID()}.sqlite.tmp`);
  try {
    const reserved = await open(temporary, "wx", 0o600);
    await reserved.close();
    await sqlite.backup(temporary);
    verify(temporary, true);
    const file = await open(temporary, "r");
    try { await file.sync(); } finally { await file.close(); }
    try {
      // An atomic, exclusive publication also handles concurrent callers safely.
      await link(temporary, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      verify(target);
    }
    return target;
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) await unlink(temporary + suffix).catch(() => {});
  }
}
