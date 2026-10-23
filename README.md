# AI Usage Dashboard

Track AI API spending across OpenAI, Anthropic, xAI/Grok, Google Gemini, OpenRouter, fal.ai and BFL, subscription limits for Claude Desktop, ChatGPT Codex and Grok, and what you actually used in Claude Code, Codex, Grok and Grok Bot, in a single dashboard.

API spend uses actual billed amounts from each provider's billing API. Subscription API-equivalent values are separate estimates from recorded tokens. Runs locally with SQLite storage.

## What it does

- **Three tabs** -- Subscriptions keeps quotas, This week and API-equivalent estimates together; API spend contains actual billing and sync history; Activity has a Subscriptions / API / Combined source toggle. Each view keeps its own date range while switching tabs. Tab links can be bookmarked using `#subscriptions`, `#api` and `#activity`.
- **Grok at API prices** -- recorded Grok 4.5/4.6/4.7 tokens use the matching public model's standard short-context input/cache/output rates, including local `-build` labels. Rates verified October 22, 2026 at https://docs.x.ai/developers/pricing. Turn aggregates do not reveal each request's prompt length or speed tier, so long-context / Fast premiums and tool fees are excluded. Retained old rows are priced on read without reindexing. Grok Bot has message history only, so its equivalent is unavailable.
- **Activity scope** -- the toggle filters models and summary totals. Combined output tokens include recorded local and API output; sessions and messages cover local history only. API activity charts only token counts actually reported by providers. Dollar estimates and billed charges are never added together. The message calendars always cover the last year; the range picker controls summaries, tools, API tokens and model details.

- **Plan limits** -- Claude (Pro/Max), ChatGPT Codex and Grok as dials per window, with reset times, a pace notch and a straight-line projection ("runs out Thu 2 PM"), plus a burn-up chart of each weekly limit against even pace, using the app’s saved quota readings (and an optional legacy `history.jsonl` log)
- **Spend summary** -- this month with daily bars and the change against last month at the same point, a month-end projection, last 30 days, this week, this year
- **Activity** -- from local Claude Code, Codex, Grok and Grok Bot history on this machine: sessions, messages, a 12-month heatmap per tool (Claude Code, Codex, Grok and Grok Bot, each on its own scale), MCP servers (with per-tool counts), skills, subagents and built-in tools, and every model used with tokens and its cost at API list prices
- **Auto-sync** -- the server syncs every provider, refreshes quotas and indexes local logs every 30 minutes (`AUTO_SYNC_MINUTES`, 0 turns it off); the page refreshes itself every 2 minutes
- **Spend chart** -- stacked bars by provider; daily for 7/30/90 days, weekly for 1 year
- **Provider breakdown** -- dollars and share per provider for the selected range
- **Model table** -- sortable by cost, model, or provider
- **Sync now** -- runs the same refresh immediately
- **Manual entries** -- `POST /api/entries/manual` for providers without a billing API
- Light theme with provider icons and bordered subscription cards; Claude’s limits stay together, as do Grok and Grok Bot. Keyboard accessible.

## Provider support

| Provider | Data source | What you need |
|----------|------------|---------------|
| OpenAI | Admin API (`/v1/organization/costs`) | Admin key (`sk-admin-*`) |
| xAI / Grok | Management API (actual USD) | Management key + team ID |
| Gemini | GCP BigQuery billing export | Service account + billing export enabled |
| OpenRouter | Activity API | Management key |
| Anthropic | Admin API (usage and cost) | Admin key (`ANTHROPIC_ADMIN_KEY`) |
| fal.ai | Usage API | `FAL_API_KEY` |
| BFL (Flux) | Credit balance, diffed between syncs | `BFL_API_KEY` |

Each provider is optional. The dashboard works with any combination, including zero configured providers (manual entry only).

## Quick start

```bash
git clone <repo-url> && cd api-costs
npm install
npx drizzle-kit push
cp .env.example .env.local
# Edit .env.local with your API keys (see provider setup below)
npm run dev
# Open http://localhost:4100
```

## Plan limits (Claude, ChatGPT Codex, Grok and Grok Bot)

Subscription usage is quota, not dollars, so it gets its own panel: percent used per
window, when the window resets, and a notch showing how much of the window has passed.
Claude and Codex use local quota files. Grok and Grok Bot read their usage services with existing local logins; separate API billing keys are not needed.

| Plan | Source | Windows |
|------|--------|---------|
| ChatGPT Codex | Rate-limit snapshots Codex writes to `~/.codex/sessions/**/rollout-*.jsonl` (override with `CODEX_HOME`), or a direct probe recorded to `~/.local/state/ai-usage/codex-rate-limits.json` if one exists; the newer reading wins | Whatever the plan reports, e.g. weekly, or 5-hour + weekly |
| Claude (Pro/Max) | `scripts/claude-statusline.sh`, run as the Claude Code terminal status line, records the `rate_limits` field to `~/.local/state/ai-usage/claude-rate-limits.json` (override with `CLAUDE_USAGE_STATE`) | 5-hour and weekly |

To enable the Claude terminal source, add to your Claude Code settings (use an absolute path, and repeat
for each `CLAUDE_CONFIG_DIR` you use):

```json
"statusLine": { "type": "command", "command": "/abs/path/to/api-costs/scripts/claude-statusline.sh" }
```

Requires `jq`. The status line also prints model, context used and both plan percentages.
Claude Desktop is automatic on macOS: the dashboard reads one exact local HTTP cache
response for the organization in `~/Library/Application Support/Claude/plan-usage-history.json`.
It uses the provider's actual five-hour and weekly utilization, observation time and
reset dates. No Claude credentials, cookies or Keychain access are needed. Keep
Claude Desktop open; opening Settings → Usage can refresh its cache. Readings older
than 30 minutes are marked, and readings older than two hours are hidden. Chromium
Simple cache v5 is supported, including Zstandard responses (Node 22.15+ required).
The newest Desktop or terminal reading wins. Desktop activity logs are separate from
these quota readings.

Grok subscription usage is read from the billing service with the existing
`~/.grok/auth.json` user login. It does not use the xAI management API key, launch an
agent, refresh a login token, or write credentials. If the login expires, sign in
again with the Grok CLI. Missing, malformed or unavailable data stays unavailable;
a verified complete active protobuf billing period can report proto3's implicit 0%.
Grok and Grok Bot are grouped in one subscription card. Their usage percentages and reset times remain separate because the provider reports distinct allowances.

Grok Bot on macOS reads only the active account's encrypted access token from
`~/Library/Application Support/Grok Bot/sand-secrets.json`. With the user's approval,
`/usr/bin/security` reads the app's `Grok Bot Safe Storage` / `Grok Bot Key` item.
Approve any macOS Keychain prompt yourself. The derived decryption key stays in
process memory; the access token goes only to the fixed native usage endpoint at
`https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus`.
Credentials and response bodies are never logged or written. The dashboard does
not access refresh tokens or change the app's login. Open Grok Bot to renew an
expired login. A denied Keychain read retries after ten minutes or a dashboard
service restart, rather than prompting every minute. Initial page rendering never
waits for Keychain or network access. Only a valid active weekly paid allowance is
shown; trials, missing values and failures remain unavailable.

Plan readings refresh every minute while the dashboard is open, also on window
focus. Concurrent Grok reads are shared and network requests are limited to one
refresh per minute. Provider resets always come from the source. After a reset,
old usage is unknown until another reading arrives. API billing sync is separate.

Source references: [Chromium cache format](https://chromium.googlesource.com/chromium/src/+/main/net/disk_cache/simple/simple_entry_format.h),
[community Claude Desktop cache approach](https://github.com/aqua5230/usage), and
[CodexBar Grok billing protocol](https://github.com/steipete/CodexBar/blob/main/docs/grok.md), and
[Grok Bot native usage endpoint](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md).
The implementation uses the documented format and protocol facts; it does not
bundle or execute those projects.

## Activity (automatic local history)

The scheduler indexes `~/.claude/projects` and `~/.claude-ss/projects` (override with
`CLAUDE_PROJECTS_DIRS`, colon-separated) and `$CODEX_HOME/sessions` into local SQLite tables.
Only changed files are re-read. Rows stay after Claude Code prunes old transcripts, so history
accumulates from the first run. Nothing leaves the machine.

Grok activity is indexed from `$GROK_HOME/sessions/<project>/<session>/updates.jsonl`
(default `~/.grok`). Assistant streaming chunks are deduplicated by prompt and stream
start; per-turn model token breakdowns are counted once. User messages, reasoning
chunks, tool notifications and cumulative session counters do not inflate messages.
Grok Bot activity is indexed from account-scoped transcript replicas in
`~/Library/Application Support/Grok Bot/sand-client-persistence` (override with
`GROK_BOT_PERSISTENCE_DIR`). Text replies and assistant voice turns count once, using
their recorded timestamps. Widgets, approvals, attachments and user messages do not.
Grok and Grok Bot are adjacent heatmaps, with independent color scales, under their
shared subscription. Bot history contains no model/token/cost data, so those values
are not estimated. Grok tokens are available only for recorded completed turns;
Known Grok models receive standard API-equivalent estimates. Output-token totals cover recorded sources only.
No credentials, Keychain access or network calls are needed for either activity
reader. Only aggregate metadata is stored in SQLite, never transcript text. Logs
pruned before the first index cannot be recovered. Unrecognized/corrupt snapshots
retain the prior indexed history and are retried on the next sync. Click **Sync now**
for an immediate index, or use local-only `POST /api/activity/index`.

Costs for Claude Code and Codex are estimates at API list prices (`src/lib/activity/pricing.ts`);
unpriced models show no cost. Claude Code logs usage per message; Codex logs it only since
September 2026, so older Codex sessions count toward tools and sessions but not tokens.

## Historical data and backups

The app stores data in `data/costs.sqlite` (override with `DATABASE_PATH`). The
primary database and its historical records have no automatic expiration:

- `cost_entries`: daily provider/model billing records, reported tokens/requests
  where available, and sync timestamps. A normal sync requests recent data but
  does not delete older saved rows. Updated line items replace matching records.
- `activity_usage`, `activity_sessions`, `activity_tools`: dated local token/message,
  session and tool metadata. Missing source files do not remove indexed history.
  A changed source file replaces that file's indexed rows, so this is a current
  aggregate index rather than an immutable transcript archive. No message text
  or complete source logs are stored.
- `quota_observations`: subscription percentages, window lengths, reset times,
  source timestamps and first/last observed times. Duplicate cached readings are
  merged. Missing/error/expired readings do not become zero usage. Valid legacy `history.jsonl` observations are imported too, including completed
  periods. Old quota rows remain after resets; the weekly chart queries only the current period.

Quota capture runs every five minutes while the local service is running, even
with the browser closed, and on dashboard quota reads. It begins 30 seconds after
startup. Existing source apps must still provide valid readings. Sleep, shutdown,
expired logins and unavailable source data leave gaps that cannot be reconstructed.
Set `HISTORY_CAPTURE_MINUTES` to a positive interval, or `0` to disable background
quota capture and backups (dashboard quota reads still save valid readings).

The same background loop creates one verified online SQLite backup per UTC day in
`data/backups/YYYY-MM-DD/costs.sqlite`, next to the configured database (the source filename is preserved). Backups
include committed WAL transactions, are published atomically with private file
permissions, and do not overwrite existing daily snapshots. No daily snapshots
are automatically deleted. They include all database tables, but not `.env.local`,
credentials or the original source logs. Errors are written to the service error
log and retried on the next tick; previous backups remain intact.

The backups are on the same disk and protect against accidental database changes,
not loss of the Mac or disk. Include the data directory in an existing external
backup for that protection. To restore, stop the service, retain a safety copy of
its current database and WAL/SHM files, then use a verified snapshot as the new
`costs.sqlite` with no old WAL/SHM files beside it; restart the service. Use SQLite's
online backup API for a live export rather than copying an active WAL database.

Historical analysis can query the primary database or a backup with any SQLite
client. Stored token counts support later recalculation; API-equivalent dollar
estimates depend on the price assumptions and are distinct from billed spend.

## Provider setup

### OpenAI

1. Go to [platform.openai.com](https://platform.openai.com) > Organization Settings > Admin Keys
2. Create an admin key (requires org owner role), restricted to **Usage API Scope: Read**; leave the other scopes at None.
3. Add to `.env.local`:
   ```
   OPENAI_ADMIN_KEY=sk-admin-xxxxx
   ```

For multiple billing organizations, use `OPENAI_ADMIN_KEYS` instead. Copy each
organization ID from Organization Settings > General and create a Usage API Read
key in each organization:

```dotenv
OPENAI_ADMIN_KEYS='[{"organizationId":"org-first","adminKey":"sk-admin-first"},{"organizationId":"org-second","adminKey":"sk-admin-second"}]'
```

Use one key per **distinct organization**, even if you have several logins to it.
Duplicate organization IDs or keys are rejected before any API call. When the
array is set, the single `OPENAI_ADMIN_KEY` is ignored. The dashboard combines
organizations under OpenAI and sums matching daily line items; it does not show
an account breakdown. If any organization fails, the sync keeps the previous
stored totals and reports the error rather than writing a partial bill. Changing
the configured organization set does not remove older imported rows; use a fresh
database if you need a different historical scope. Restart the service after
editing the private environment file.


### xAI / Grok

1. Go to [console.x.ai](https://console.x.ai) > Settings > Management Keys
2. Create a management key
3. Copy your team ID from console.x.ai/team/default/settings/team
4. Add to `.env.local`:
   ```
   XAI_MANAGEMENT_KEY=xai-mgmt-xxxxx
   XAI_TEAM_ID=your-team-id
   ```

### OpenRouter

1. Go to [openrouter.ai](https://openrouter.ai) > Account Settings
2. Copy your management API key
3. Add to `.env.local`:
   ```
   OPENROUTER_MGMT_KEY=sk-or-v1-xxxxx
   ```

### Gemini (GCP BigQuery billing export)

The most involved setup, but gives you exact dollar amounts from Google.

**Step 1: Create a BigQuery dataset**

1. Go to [BigQuery Console](https://console.cloud.google.com/bigquery)
2. Select the GCP project your Gemini API key is attached to
3. Create a dataset called `billing_export` (location: US)

**Step 2: Enable billing export**

1. Go to [Billing Export](https://console.cloud.google.com/billing/export)
2. Select your billing account
3. BigQuery Export tab > Standard usage cost > Edit Settings
4. Select your project and the `billing_export` dataset
5. Save. Initial data takes up to 5 days to appear. Backfills ~30 days.

**Step 3: Create a service account**

Using the gcloud CLI:

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud iam service-accounts create api-costs-reader \
  --display-name="API Costs Dashboard Reader"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud iam service-accounts keys create /path/to/api-costs-sa.json \
  --iam-account=api-costs-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Or use the [GCP Console UI](https://console.cloud.google.com/iam-admin/serviceaccounts/create): create a service account with BigQuery Data Viewer + BigQuery Job User roles, then download a JSON key from the Keys tab.

**Step 4: Configure**

Add to `.env.local`:
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/api-costs-sa.json
GCP_BILLING_PROJECT=your-project-id
GCP_BILLING_DATASET=billing_export
```

The billing export table name is auto-detected on sync. To set it explicitly:
```
GCP_BILLING_TABLE=project.dataset.gcp_billing_export_v1_XXXXXX
```

**Troubleshooting:**
- **Empty sync results** -- billing export takes up to 5 days for initial backfill
- **"Not found: Table"** -- table hasn't been created yet, check back later
- **"Access Denied"** -- service account needs both `bigquery.dataViewer` and `bigquery.jobUser`

## Running as a background service

Using pm2:

```bash
npm install -g pm2
npm run build
pm2 start npm --name "api-costs" -- start
pm2 startup    # auto-start on login (follow the printed instructions)
pm2 save       # persist process list
```

Dashboard runs at `localhost:4100` and auto-restarts on crash.

```bash
pm2 status              # check if running
pm2 logs api-costs      # view logs
pm2 restart api-costs   # restart after code changes
```

## Clickable macOS launcher

After configuring `.env.local` and building with `npm run build`, run:

```bash
./scripts/install-macos-launcher.sh
```

Double-click **AI Usage.app** in the program folder to open the dashboard at
`http://127.0.0.1:4100`. You can drag the app to the Dock or create a Finder alias
on your Desktop. The launcher starts the per-user LaunchAgent if needed and reuses
an already running service. The service also starts at login and runs independently
of your terminal or coding assistant. Use this LaunchAgent instead of pm2 when
choosing the macOS launcher.

The installer records the current program folder in
`~/Library/LaunchAgents/com.davidfrey.api-costs.plist`. To move the installation,
unload that service with `launchctl bootout gui/$(id -u)/com.davidfrey.api-costs`,
move the whole folder, and rerun the installer in its new location before opening
the app. Rebuild and restart the service after changing the application code.

For a readiness check without opening a browser, run
`./scripts/launch-dashboard.sh --no-open`. Startup failures are logged in
`data/launcher.log` and `data/service-error.log`.

## Adding a new provider

1. Create `src/lib/providers/yourprovider.ts` implementing the `ProviderAdapter` interface
2. Register it in `src/lib/providers/registry.ts`
3. Add a `--provider-*` colour in `src/app/globals.css` and an entry in `PROVIDER_CONFIG` in
   `src/lib/format.ts`. The colours are validated as an ordered set (the chart stack order), so
   re-check colour-blind separation when adding one. The chart, Sync now and the scheduler pick
   the provider up automatically from the registry.
4. Keep each entry's `model`, `date`, `direction` and `rawLineItem` stable across syncs: together
   they are the dedup key, so a changed value inserts a new row instead of updating the old one.

## Tech stack

- Next.js 16, React 19, TypeScript 5
- Tailwind 4
- Drizzle ORM + SQLite (better-sqlite3)
- Recharts 3
- Zod 4

## License

MIT

## Recorded weekly quota chart

The Subscriptions chart uses real saved quota samples from the current reset
period. Solid steps and dots join sampled percentages; changes can occur between
samples. It starts at the first recorded reading, with no invented zero at reset
and no solid continuation after the latest sample. Provider corrections may make
the recorded line dip. Earlier unobserved usage cannot be reconstructed from
subscription token totals because the providers use their own quota accounting.

A lighter dashed line shows average pace (cumulative percentage divided by time
since reset at the latest reading); a dotted continuation forecasts that pace
until reset or 100%. The grey diagonal is the reference for evenly consuming the
weekly allowance. Average pace can be hidden. Hover or use left/right arrow keys
on the chart to inspect recorded timestamps and forecasts. Reading coverage and
forecast lists each plan's first/latest timestamp and sample count. The x-axis
compares days into each plan's own week, rather than shared calendar dates.

Newly collected history may initially be a single point or a short flat segment.
The curve gains detail as new percentages are saved; past usage is not backfilled
with estimates. Missing, reset or unavailable current windows do not show a quota
forecast.
