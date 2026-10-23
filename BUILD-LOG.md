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
