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

Validation and independent review: pending installation checks.
