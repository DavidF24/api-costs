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
