import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import * as schema from "./schema";
import { collapseNullDedupKeys } from "./migrate-dedup";
import { ensureQuotaHistory } from "./quota-history";
import { ensureApiKeys } from "../api-keys/store";

export const databasePath = process.env.DATABASE_PATH || join(process.cwd(), "data", "costs.sqlite");

// globalThis singleton prevents HMR from opening multiple connections
const globalForDb = globalThis as unknown as { __db?: Database.Database };

function getDatabase() {
  if (!globalForDb.__db) {
    const sqlite = new Database(databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // busy_timeout prevents SQLITE_BUSY during build (multiple workers)
    sqlite.pragma("busy_timeout = 5000");
    collapseNullDedupKeys(sqlite);
    ensureQuotaHistory(sqlite);
    ensureApiKeys(sqlite);
    globalForDb.__db = sqlite;
  }
  return globalForDb.__db;
}

export const sqlite = getDatabase();
export const db = drizzle(sqlite, { schema });
export { schema };
