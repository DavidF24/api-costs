# Multi-organization OpenAI billing

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

The dashboard previously accepted one OpenAI organization admin key. The optional
OPENAI_ADMIN_KEYS JSON array now accepts one key and organization ID per billing
organization. Matching daily cost lines are summed before the existing database
upsert. The single-key environment variable remains supported. Duplicate
organizations or credentials and malformed configuration fail before API calls.
An error in any organization rejects the sync, preserving the last stored totals.

Validation:

- npm test: 40 passed, including five adapter tests covering legacy credentials,
  organization headers, pagination, combined totals, account failures, duplicate
  configuration, malformed configuration, and secret-safe configuration errors.
- Targeted ESLint on the changed adapter and its tests: passed.
- npm run build: passed after initializing an empty worktree database with
  drizzle-kit push. The first attempt found no data directory. The existing
  Turbopack filesystem tracing warning remains.
- No database migration or dependency changes.

Independent review: Ready for implementation commit ad1af64, with no blocking
findings. A fresh GPT-6-Astra reviewer checked the source and tests read-only.


# Claude desktop quota status

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

The missing-Claude message promised a reading after any Claude Code reply, but the
collector runs from the interactive terminal status line. Desktop-only Code turns
do not invoke it. The missing and empty-state messages now name the terminal source
and its desktop limitation. Documentation explains the difference between activity
logs, subscription quota, and xAI API billing. The user requested automatic sources
only, so no manual subscription cards or snapshots were added.

Validation: all 40 existing tests and targeted ESLint passed. The production build
passed with the existing filesystem tracing warning. The worktree initially needed
a local dependency copy instead of a symlink; an initial database-lock build failure
cleared on retry after database initialization. No dependency or database schema
changes were made.

Independent review: a fresh GPT-6-Astra reviewer marked implementation commit
`b70382f` Ready with no blocking findings.


# Local-tools installation and macOS launcher

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

The user requested the installed program in code/local-tools and a clickable entry
point independent of Codex. The macOS installer creates AI Usage.app beside the
source and a private per-user LaunchAgent using the installation's current path.
The launcher loads or starts that service when needed, waits for HTTP readiness,
and opens the dashboard. Existing services are reused; --no-open supports local
verification. Generated bundles remain ignored.

Validation:

- Bash syntax checks and git diff --check passed.
- The installed program was moved to code/local-tools/api-costs, linked Git
  worktrees were repaired, and the existing Claude terminal collector and reserved
  port record were updated to the new path.
- Production build and all 40 existing tests passed in the moved installation.
  The existing Turbopack filesystem tracing and Node module-type warnings remain.
- Both generated property lists passed plutil validation. An unloaded-service
  launch with --no-open reached HTTP readiness. A real Finder double-click on the
  Desktop app also started the unloaded service and opened the dashboard in Chrome.
- Repeated launch reused the same healthy service PID. The private key file and
  service configuration remain mode 0600, the data directory 0700, and SQLite
  integrity_check returned ok.

Independent review: a fresh GPT-6-Astra reviewer marked implementation commit
49513c6 Ready with no actionable findings. The generated app contains no credentials;
it calls the installed launcher script.


# Automatic desktop subscription usage

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Claude Desktop does not invoke the terminal status line. Read its exact local usage
HTTP cache entry instead, including provider observation and reset times. The reader
checks the documented Chromium Simple cache format, checksums, exact URL and key
hash, bounded sizes, successful JSON response, timestamps and quota ranges. No
Claude credentials or cookies are accessed. Keep the newer terminal source as a fallback.

Grok subscription usage comes from its read-only billing surfaces using the existing
local CLI access token. An active complete protobuf period with an omitted proto3
percentage is zero; malformed, inactive and missing responses remain unavailable.
No coding agent is launched and no login token is refreshed or persisted. Requests
are bounded, deduplicated and throttled to once per minute.

Validation: all 48 tests passed, including synthetic compressed Chromium entries,
checksum/key mismatch and stale/future rejection, reset handling, complete proto3
zero, nonzero percentages, truncated/error frames, inactive periods, and separate
Bot allowance parsing. Targeted ESLint, TypeScript and the production build passed.
The existing Turbopack filesystem-tracing and Node module-type warnings remain.
Live read-only probes returned Claude Desktop 33% session / 61% weekly, and Grok
0% weekly, with provider reset times; no credentials or raw private responses were
printed or saved. Added a Refresh usage control; automatic reads continue each minute.

Initial independent review found malformed-date acceptance and optional network reads
delaying the initial page. Corrections reject non-finite period bounds and keep
initial rendering synchronous with local/cached readings. The client refreshes
network-backed usage immediately after mount. A fresh GPT-6-Astra reviewer rechecked both corrections at e3152e1 and marked the implementation Ready with no remaining actionable findings.


# Automatic Grok Bot usage

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

The user approved reading Grok Bot Safe Storage to decrypt the app's existing
login in memory and retrieve its weekly allowance from Cursor's native usage API.
Read only the active encrypted access token and the exact app Keychain item.
No refresh token access, credential persistence, or changes to the native login.
The new gauge and weekly trend refresh with the existing plan panel. Initial page
rendering stays local; Grok and Bot network reads run concurrently after mount.

A live read-only probe returned HTTP 200, 15.921351% usage, and an active weekly
period ending October 26 at 04:52:50 UTC (October 25, 11:52 PM America/Chicago).
Only quota/expiry metadata was printed; no credential or private response body
was printed or saved.

Validation: all 52 tests, TypeScript checks, targeted ESLint, and the isolated
production build passed. Synthetic tests cover active-account selection, wrong
keys, malformed/oversized encrypted stores, expired tokens, invalid weekly dates,
trial-only allowances and absent percentages. Existing Node module-type and
Turbopack filesystem-tracing warnings remain. A fresh GPT-6-Astra reviewer marked
implementation commit 9621a25 Ready with no actionable findings; no credentials,
Keychain items or live provider endpoints were accessed by the reviewer.

# Light subscription cards

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Switch to a warm light canvas with white bordered cards, readable chart colors and
provider icons. Claude Max keeps its two quota windows inside one card; Grok and
Grok Bot share another card with individually labelled readings and reset times.
ChatGPT Codex has its own card between them. Weekly trends have a separate panel.
Usage source explanations remain available in disclosure controls. Existing data
collection and refresh behavior are unchanged. Brand paths use LobeHub Icons (MIT).

Validation: all 52 existing tests and the production build passed, including
TypeScript. Full ESLint has zero errors and one pre-existing unused _since warning
in the unchanged OpenRouter adapter. The existing Node module-type and Turbopack
filesystem-tracing warnings remain. Visually checked desktop, 390px and 320px
layouts, and the Refresh usage control. All five gauges fit inside their cards
at 320px. The initial independent review found a narrow-screen overflow; the
correction stacks grouped readings at 360px and below and uses horizontal dividers.
The fresh GPT-6-Astra reviewer rechecked implementation d240feb and marked Ready
with no remaining actionable findings. Collection and refresh behavior are unchanged.


# Grok and Grok Bot activity history

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Add automatic daily message heatmaps for Grok CLI and Grok Bot desktop alongside
Claude Code and Codex. Read only known local update logs and transcript replicas.
Deduplicate streaming messages, completed-turn usage, moved sessions and replica
entries; exclude users, reasoning, tools, widgets and approvals from message counts.
Grok model/token breakdowns feed the existing totals and model list without invented
API prices. Bot has message metadata only; no token or cost estimate is presented.
Private message text is neither returned nor persisted. Both heatmaps stay adjacent
and the copy explains the shared subscription and differing data coverage.

Validation: all 62 tests passed, including 10 new synthetic parser/discovery tests,
plus TypeScript and the production build. Full ESLint has zero errors and the
pre-existing unused OpenRouter _since warning. Existing Node module-type and
Turbopack filesystem-tracing warnings remain. The isolated live indexing endpoint
returned no errors. A read-only parser probe recovered 517 Grok sessions and 8 Bot
transcripts (about 8,560 and 458 assistant replies); only aggregate counts were
printed. Actual totals continue to grow as the apps are used.

Live validation found Node's line reader splitting legal Unicode U+2028/U+2029
inside JSON strings. A bounded LF-only UTF-8 stream reader fixes those four logs;
a synthetic long-record regression covers separators, multibyte buffer boundaries,
an unterminated final record and corrupt-tail rejection. A fresh GPT-6-Astra reviewer
marked implementation 5aa7916 Ready, then rechecked correction cb35c59 and again
reported Ready with no actionable findings. No credentials, live provider endpoints,
Keychain items or private transcripts were accessed by the reviewer.


# Separate dashboard tabs and Grok API-equivalent estimates

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Split the local dashboard into Subscriptions, API spend and Activity. Keep grouped
subscription limits and This week together and add range-selectable API-equivalent
cards. Add Grok beside Claude Code and Codex in the Activity summary, with model-
specific cached token rates from xAI's pricing page, verified October 22, 2026.
Use the corresponding public model's standard short-context rates for local -build
labels. Per-turn aggregates cannot resolve per-request long-context or Fast tiers;
the UI explains the excluded premiums and tool fees. Grok Bot has no recorded token
counts and remains explicitly unavailable for estimates.

Price retained Grok rows on read, including previously unpriced rows whose source
logs may have been pruned. No schema migration, billing-record change, additional
credential access or provider configuration change. The Activity source toggle
partitions local subscriptions and APIs. Combined keeps billed charges and local
estimates separate, labels local-only messages/sessions, and combines only recorded
output tokens. Model tables follow the selected source. API token charts explain
coverage gaps. Tabs support keyboard navigation and bookmarkable hashes; range and
scope state survive tab switches and automatic refreshes.

Validation: all 68 tests, TypeScript and the production build pass. Full lint has
zero errors and the existing OpenRouter unused-variable warning. Six synthetic
tests cover Grok prices/cache handling, old NULL-price history, unknown models,
Bot exclusion, source partitioning and separate billed/estimated totals. Browser
checks confirm all three tabs, API-only model filtering, range changes, keyboard
navigation and preserved range/scope state. A read-only endpoint/database comparison
confirms old Grok rows reprice correctly and API totals match billing records.
All three tabs fit a 320px viewport without horizontal page overflow. Keep the
weekly accessibility table within a clipped sr-only parent and let the API headline
and month bars wrap. The normal desktop layout was also verified.

A fresh GPT-6-Astra reviewer marked implementation 208fc0a Ready, then independently
rechecked corrections db38536 and dfe4419 as Ready, with no actionable findings.
No credentials, Keychain items, live provider APIs or private user histories were
accessed by the reviewer. Existing Node module-type and Turbopack tracing warnings
remain. No new costs, CI changes or secret-file changes.

# Preserve historical dashboard data

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Retain subscription quota observations in SQLite, capture them without an open
browser, and take verified daily online SQLite backups. No historical data
expiration is introduced. Current source timestamps remain distinct from first
and last observation times; repeated cached readings are merged. Missing, invalid,
expired and reset readings do not become invented zero samples. Valid legacy
history is imported idempotently, including completed periods. Saved recent points
feed the weekly chart without deleting older observations.

The background loop starts 30 seconds after startup and repeats every five minutes,
independent of the browser and the provider billing scheduler. Backups include WAL
transactions, become verified standalone SQLite files, publish atomically without
overwriting completed copies, and are namespaced by UTC date and source filename.
No backups expire automatically. Private backup paths are ignored by Git. The
README distinguishes retained aggregates from original logs, mutable current rows
from daily versions, source gaps, and same-disk backups from external protection.

Validation: all 77 tests, TypeScript, production build and lint pass (zero lint
errors, one pre-existing OpenRouter warning). Nine synthetic tests cover schema
preservation, cached/zero/malformed readings, provider/window/reset history,
legacy-source removal, WAL backup restoration, private modes, concurrent backups,
retained daily versions, failure cleanup and distinct database filenames. An
isolated production preview, using a private SQLite copy and no billing credentials,
recorded all five live quota windows and created a verified backup before any
browser was opened. The backup retained the existing billing/activity table counts;
its integrity check passed. The dashboard still renders current readings and trends.

A fresh GPT-6-Astra reviewer identified legacy-history import and backup-name
collision issues in 801a753; both were fixed and regression-tested in f982146.
The correction recheck was Ready with no remaining actionable findings. The reviewer
also independently verified startup timing, five-minute scheduling, overlapping
ticks, backup after refresh failure and recovery using synthetic integration tests.
The reviewer accessed no credentials, Keychain, live provider APIs or private data.

# Plot recorded subscription usage

Assignment: Codex · "Set up api-costs spend tracker" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Replace the assumed zero-at-reset origin with recorded quota samples. Show sampled
steps and dots, a separate average-pace line and a dotted forecast. Keep gaps
before the first sample unknown, stop the recorded line at its last timestamp,
and preserve later provider corrections. Average pace uses cumulative usage since
reset at that timestamp; a moving browser clock does not create readings. Add
coverage details and keyboard inspection. Quota storage and billing are unchanged.

Validation: all 85 tests, TypeScript and production build pass. Full ESLint has
zero errors and the existing OpenRouter unused-variable warning. Eight synthetic
regressions cover gaps, true zeroes, provider corrections, jittered reset times,
step geometry, stable forecasts, independent reset axes and dense weekly history.
The SVG marker count is bounded while the path retains every sample. Geometry is
memoized during hover. Browser checks confirm all four recorded paths, average
line toggle, unknown-history and forecast tooltips, keyboard inspection and the
coverage table. The 320px layout has no horizontal page overflow; the coverage
table scrolls inside its container. Sparse live history remains short measured
segments; no synthetic usage was inserted into the preview database.

A fresh GPT-6-Astra reviewer marked 24e9999 Ready with no remaining actionable
findings after checking dense-history rendering and subsecond reset precision.
No credentials, live dashboards or private histories were accessed by the reviewer.
The preview uses a private SQLite copy without billing credentials and disables
both background schedulers. No CI or secret files change; no new cost.

# Make historical usage lines visible

Assignment: Codex · "ai-cost-dashboard" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

The seven-day scale compressed newly collected readings into what looked like
single dots. Default to Recorded history on a shared calendar-time axis fitted to
the saved range. Connect actual samples with line segments so equal usage is flat
and increases have a slope. Keep the Full week overview, its average pace and
forecast, and the coverage disclosure. Tooltip values remain real saved readings;
connecting lines describe changes between samples without inventing observations.
No source, retention, billing, credential or schema changes.

Validation: all 90 tests, TypeScript, lint and production build pass. Lint has
zero errors and one pre-existing OpenRouter warning. Browser checks verify four
connected history paths, clock-time labels, Full week forecasts, the average toggle,
unknown coverage, and keyboard access to the latest actual reading. The 320px
layout has no page overflow and uses two calendar labels to avoid overlap.

The fresh GPT-6-Astra reviewer found the latest sample was unreachable with fixed
keyboard increments. Commit 729530e navigates actual timestamps and snaps pointer
inspection within six pixels, with regression tests for final and lone samples.
The correction recheck was Ready with no remaining actionable findings. Review
used only source and synthetic tests; no credentials or private histories.
No CI, secrets, collection, retention or billing changes; no new cost.

# API key inventory and attributed usage

Assignment: Codex · "ai-cost-dashboard" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Add a read-only inventory in API spend with provider names, masked key hints (or
explicitly labelled key IDs/hashes), local names, usage locations, notes and key
filters. Store inventory, annotations, daily attributed usage and source status in
additive SQLite tables; refreshes preserve annotations and older history. Existing
billing totals remain separate. OpenAI and Anthropic supply token attribution;
OpenRouter supplies attributed reported cost and tokens. xAI metadata collection
is implemented, with per-key usage not integrated. Access failures retain saved
records and show a separate inventory/usage status. No credential permissions are
changed and no provider key writes are made.

Validation: all 104 tests, TypeScript, lint and production build pass (zero lint
errors, one pre-existing OpenRouter unused-variable warning, existing Turbopack
filesystem tracing warning). A read-only live probe retrieved 18 Anthropic keys,
4 OpenRouter keys and daily attributed usage without printing credentials. Both
OpenAI organizations returned no attributed text-generation usage in the last
90 days; their inventory and xAI inventory return HTTP 403 with current scopes.
No permissions have been broadened. The production preview has its own SQLite
copy, no billing credentials and both background schedulers disabled. Browser
checks verify key search, individual selection, saving all three annotation fields
and persistence after reload.

The fresh GPT-6-Astra review identified two issues: replacement of OpenRouter
buckets could erase history for keys no longer listed upstream, and expired xAI /
OpenRouter keys could appear active. Both corrections have regression tests and
were rechecked. Browser verification also found Next normalizes request.url to
localhost while the actual Host/Origin may be 127.0.0.1; the local request guard
now validates the actual loopback Host before comparing Origin, with allow/deny
regressions. The reviewer marked implementation d6c46a4 Ready after recheck, with
no remaining blockers. No CI, secrets or dependencies change; no new cost.

# Refresh subscription API-equivalent pricing

Assignment: Codex · "ai-cost-dashboard" · 01a16549-f1da-7070-8cdc-4c1e96056b2a

Saved Claude Sonnet 5.5, GPT-6.1 Sol and GPT-6 Luna tokens had no matching prices,
and non-Grok comparisons reused stale index-time estimates. Verify current official
Anthropic/OpenAI/xAI rates, including cache discounts, and price all retained
subscription tokens on read. Keep billed API amounts unchanged. Show verification
date, source links, token coverage, unpriced names and model rate details. A
read-only aggregate audit supports weekly Codex pricing maintenance; unknown
internal labels and unavailable Grok Bot tokens remain unpriced. Preserve reviewed
catalog versions in Git and explain baseline exclusions in README.

Official evidence checked 2026-10-25: Anthropic's pricing page documents Sonnet 5.5
$2 input / $0.10 cached / $10 output per MTok, $2.50/$4 cache writes; OpenAI's
Standard pricing documents GPT-6.1 Sol $2/$0.10/$10, $2.50 short cache writes, and
GPT-6 Luna $0.10/$0.01/$0.50, $0.125 short writes. Older OpenAI model pages verify
their exact input/cache/output rates. xAI's page verifies Grok 4.7/4.6 $2/$0.50/$6
and 4.5 $2/$0.30/$6. Sources are linked in README and the UI. Long-context, speed,
regional, tool and tax costs cannot be reconstructed from these aggregates.

Validation: all 107 tests, TypeScript, lint and production build pass. Lint has
one pre-existing OpenRouter unused-variable warning; the production build has the
existing filesystem tracing warning. A production preview using a private SQLite
copy and disabled background schedulers displays 7-day and 30-day comparisons,
current model rates, source links and explicit partial coverage. The read-only
audit confirms older retained rows acquire estimates without rewriting history.

The fresh GPT-6-Astra reviewer caught documented GPT-5.6 Terra/Luna cache-write
rates and a partial-subtotal label. Both corrections were applied and rechecked;
the reviewer marked the result Ready, with no remaining actionable findings.
Their exact model pages document writes at 1.25x input ($2.50/$0.25 per MTok).
No CI, secrets, dependencies or billed API data changes; no new provider cost.

Created and verified the active Codex heartbeat `refresh-ai-usage-api-pricing`,
Mondays at 9 AM America/Chicago, attached to the existing dashboard chat. Its
prompt audits retained model IDs, verifies official sources including promotion
expiry dates, follows the review/install workflow and stays quiet if nothing
meaningful changes. It runs through the Codex automation host, not an app timer.

# Show recorded tokens beside subscription model rates

Assignment: Grok · "Subscription model token and cost toggle" · 01a19a0e-ea18-7140-a16e-571e17655505

The Model rates and coverage table showed list rates and one API-equivalent total.
Recorded input, cached input, cache writes and output were already stored, but the
page received only the older combined token count. Subscription models now keep
those categories separate. Costs and Tokens switch the same columns without
changing model order, which stays highest API-equivalent first. Cache writes stay
short / long. An unpriced model such as codex-auto-review still shows its tokens.
Claude and Codex combined totals elsewhere still omit cache; Grok's combined total
still includes it. Grok Bot remains without token data. Codex cache writes are a
subset of input_tokens, using Codex's response example (input 100 = 40 cached +
60 cache-write; total = input + output). The parser now stores that remainder as
fresh input, so a later index does not add the write again. Rows already stored
with no cache writes are unchanged. No prices, billed amounts, or database shape
change.

Validation: all 109 tests pass, including the new category and order checks.
TypeScript, eslint on the changed files, and the production build pass. The build
keeps the existing Turbopack filesystem-tracing warning. A preview on 127.0.0.1:5122,
using a copy of the local database and with background sync and retention off,
opened the table, switched Tokens and back to Costs, and kept the same 16 models
in the same order. gpt-6-astra showed its rate row and then 121.1M / 3.3B / 0 / 0 /
16.5M / 3.4B. codex-auto-review stayed Unpriced on Costs and showed token counts
on Tokens. At 320px the page stayed within the viewport and the table scrolled
inside its card. The Activity tab still rendered. The preview was stopped and its
temporary port rows removed. The installed service on port 4100 was not restarted.


# Development costs: subscription split by repository

Assignment: Claude Code · "Development costs and billing dashboard" · d66b7d84-ab90-4f66-918b-4c5a6ad48753 · desktop local_158a89cf-b7ee-4ece-88c3-813c52a5cf34

The owner wants software costs by repository, project and client, passed through at
cost on monthly statements, with an invoicing toggle per client and project. This
first slice adds a Development costs tab. Each subscription billing period's whole fee
is split by each repository's share of that tool's API-equivalent usage: Claude by
Claude Code, ChatGPT by Codex, Grok by Grok. Cents add up exactly to the fee. A period
covering part of a billing cycle is prorated. Activity rows now keep the full working
folder (nullable `cwd`). Worktrees, subfolders, plain project folders and old Claude
keys resolve to their repository. A marker row triggers one re-read of local history;
rows for deleted transcripts are kept. Clients, projects, repository links and dated
fees are stored in new local `dc_*` tables. `/data/` is fully git-ignored.
`drizzle.config.ts` now limits push to the schema's tables. Before, push offered to
drop the api_keys and dc_* tables.

Validation: 124 tests pass. TypeScript, eslint (one existing openrouter.ts warning) and
the production build pass. A preview on 127.0.0.1:5143, using a database copy with
auto-sync off, re-read 5,651 files without errors. Of each current period's usage,
97–99% resolved to a repository or project folder. Adding a client and project and
linking keel rolled up correctly. 375px width stayed within the viewport. drizzle-kit
push on a database copy now reports no changes; on an empty file it creates the tables.

Independent review: a fresh Opus 5.5 reviewer found Not ready on 4124a34 (whole fee for
a partial first period; re-read skippable by drizzle-kit; name fallback for recorded
folders; and four minor items). All were fixed in acfad63, and a fresh recheck marked
it Ready. That recheck flagged the drizzle-kit drop risk, fixed in this commit.

# Verified prices for new models and new-model notice

Assignment: Claude Code · "Development costs and billing dashboard" · d66b7d84-ab90-4f66-918b-4c5a6ad48753 · desktop local_158a89cf-b7ee-4ece-88c3-813c52a5cf34

Work item W-17 (narrowed from W-14, whose paths overlap W-15).

Prices verified 2026-11-11 from the official pages, Standard short-context rates:

- Anthropic pricing table: "Claude Fable 5.2 | $8 / MTok | $10 / MTok | $16 / MTok |
  $0.20 / MTok | $40 / MTok" (input, 5m write, 1h write, cache hit, output). No
  promotion or long-context premium.
- OpenAI pricing table: "gpt-6.1-terra | $1.00 | $5.00 | $0.05 | $1.25 | $2.50 | ..."
  (short-context input, output, cached input, 30m write, 12h write). The model page
  confirms these figures. Only the 30-minute write is used, matching the other OpenAI models.
- The GPT-5.6 Sol promotion now runs "until November 30, 2026" (it was "at least
  through November 21"). The rate is unchanged.
- `codex-auto-review` is not on OpenAI's pages and stays unpriced as an internal label.
  `deepseek/deepseek-v4.1-flash-1017` is a run routed through OpenRouter and billed
  there, so it is listed as another provider's model, not a subscription model.

The Activity tab now lists models in saved history that the catalog does not price,
with the date each was first seen. `scripts/check-activity-pricing.ts --new` exits 2
only when one is waiting, so a daily job can trigger the lookup. No guessed or
provisional prices are added.

Validation: 127 tests pass, including a new unpriced-pricing test. `tsc` is clean.
ESLint reports one existing warning in openrouter.ts. The price check was run
read-only on the live database and lists none awaiting. On a copy of the database
with a test model added, the notice appeared on the Activity tab and the API listed
all three kinds. `npm run build` passes with DATABASE_PATH set to the copy (a fresh worktree has no data directory, as before).

Independent review (fresh Opus 5.5, full tier): Ready, with low-severity findings,
all fixed. Models that have a price entry but used a category with no rate are now
listed too. Suffix variants merge under the base ID. The route is local-only. The
script rejects unknown options (exit 1). The README now says other-provider and
internal models still count as unpriced usage. The notice is no longer a late
live region. The reviewer confirmed that, on the live database, only the
claude-fable-5-2 ($94.06) and gpt-6.1-terra ($0.27) estimates change. Subscription
shares for periods since Nov 3 shift accordingly. Nothing has been invoiced yet.

# Monthly invoices and statements, billed by repository

Assignment: Claude Code · "Development costs and billing dashboard" · d66b7d84-ab90-4f66-918b-4c5a6ad48753 · desktop local_158a89cf-b7ee-4ece-88c3-813c52a5cf34

David's direction (2026-11-11). Bill by repository: repositories link straight to a
client, with an optional project name shared by repositories that are billed together and
a client-facing name per repository. A client's invoice covers all its repositories.
Billing is monthly. Hours come from the productivity tracker's derived table
`sample_projects` (merged in DavidF24/productivity-tracking#1), and stop after a per-client
idle cutoff (default 10 minutes).

What changed:

- Register. A new `dc_repos` table holds repository, client, display name, project name and
  an optional rate. `dc_clients` gains `hourly_rate_usd` and `idle_cutoff_min`.
  - A one-time migration (marker `repo_billing` in `dc_meta`, inside an IMMEDIATE
    transaction) copies each project link to a repository link. It keeps the client and
    uses the old project name as the label.
  - A client is set to send invoices when any of its projects overrode it to send. Live
    data: Hattie Jo Holm and Jester Concepts each had one project set to send invoices.
  - The old `dc_projects` and `dc_repo_projects` tables are left in place, unused.
- Hours. `time.ts` opens the tracker read-only. It filters rows by Eastern date, skips
  `method = 'none'`, resolves `project_path` with the existing repository resolver, and
  counts 30 seconds per active sample or idle sample within the cutoff.
- Invoices. New tables `dc_invoices`, `dc_invoice_lines` and `dc_payments` are STRICT and
  created in code (already outside drizzle's `tablesFilter`).
  - One document per client per month. A partial unique index skips void documents.
  - Drafts are editable and can be rebuilt. Issuing numbers the document (INV/STM per
    year), sets a due date from "Net N" terms and snapshots the from-profile.
  - The bill-to details are snapshotted when the draft is built. Issued documents are
    locked. Void keeps the number. Payments only go against issued documents.
  - Subscription periods are billed in the month they close.
- A printable page at `/dev-costs/invoices/[id]` uses the same local-only request check
  as the API (404 otherwise).

Validation:

- `node --test tests/*.test.ts`: 134 passed. This includes new tests for the migration,
  repository links, the Eastern month boundary, the idle cutoff, line grouping and rates,
  draft edits, numbering, locking, payments and voiding.
- ESLint: no errors. One existing warning in openrouter.ts.
- `npm run build` against a copy of the live database: passed.
- Ran against a database copy with the real tracker database, read-only.
  - The migration linked hardmoneyhattie.com and novus/rustica.
  - October showed 10.07 h for hardmoneyhattie.com. A draft at a test rate of $125, with
    one added line, was issued as INV-2026-001, due Nov 27 on Net 15.
  - A $100 payment left $1,178.75. Issuing with an October date was refused.
  - Cross-origin POSTs return 403, and the print page returns 404 to a cross-site request.

Independent review (fresh Opus 5.5): Not ready, with 1 blocking finding and 9 others. All
are fixed in the follow-up commit:

- **Blocking.** A draft built before its month ended can no longer be issued.
  `issueInvoice` refuses it, and the editor says to rebuild it first.
- Issuing now re-reads the client. The bill-to details, invoice/statement type, number
  prefix and due date come from the client as it is at issue time.
- The migration records clients whose linked projects had different invoicing settings in
  `dc_meta`. The tab shows them until dismissed, and startup logs them. Live data has none.
- Payments are refused against statements and above the balance. The check and the insert
  run in one transaction.
- The month list shows the document's own total, and flags a draft that no longer matches
  the current numbers. It also warns when time bills at a $0 rate.
- Numbering takes the integer maximum, so numbers continue past 999. Rounding clears binary
  noise first, so 1.005 rounds to 1.01.
- The migration checks for its marker with a plain read before taking a write lock.
- Screen fixes: an error is cleared once a later load works, the editor is a labelled
  region, and the Open buttons have labels. Removing a line asks for confirmation.

Tests: 138 passed. ESLint: no errors.
