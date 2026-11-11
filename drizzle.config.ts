import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // Only the tables declared in schema.ts. Other tables (api_keys*, dc_* client and fee
  // records, dc_meta) are created in code; without this, push offers to drop them.
  tablesFilter: [
    "cost_entries", "sync_log", "provider_state", "activity_files", "activity_usage",
    "activity_tools", "activity_sessions", "quota_observations",
  ],
  dbCredentials: {
    url: process.env.DATABASE_PATH || "./data/costs.sqlite",
  },
});
