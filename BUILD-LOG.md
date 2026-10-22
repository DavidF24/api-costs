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
