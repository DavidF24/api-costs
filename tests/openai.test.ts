import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node's native TS runner needs the extension for this existing app import.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "../timezone" && context.parentURL?.endsWith("/providers/openai.ts")
    ? "../timezone.ts" : specifier, context);
} });
const { OpenAIAdapter } = await import("../src/lib/providers/openai.ts");
const original = { single: process.env.OPENAI_ADMIN_KEY, multiple: process.env.OPENAI_ADMIN_KEYS };
beforeEach(() => { delete process.env.OPENAI_ADMIN_KEY; delete process.env.OPENAI_ADMIN_KEYS; });
afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of [["OPENAI_ADMIN_KEY", original.single], ["OPENAI_ADMIN_KEYS", original.multiple]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
const twoAccounts = [
  { organizationId: "org-first", adminKey: "test-first" },
  { organizationId: "org-second", adminKey: "test-second" },
];
function costs(value: number, nextPage?: string) {
  return Response.json({ data: [{ start_time: 1792195200, results: [
    { amount: { value, currency: "usd" }, line_item: "gpt-4o, input", project_id: null },
  ] }], next_page: nextPage });
}

test("legacy single-key configuration still authenticates without an organization override", async () => {
  process.env.OPENAI_ADMIN_KEY = "  legacy-key  ";
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer legacy-key");
    assert.equal(headers.get("OpenAI-Organization"), null);
    return costs(2);
  });
  const adapter = new OpenAIAdapter();
  assert.equal(adapter.isConfigured(), true);
  assert.deepEqual(await adapter.testConnection(), { ok: true });
  assert.equal((await adapter.sync(new Date("2026-10-01")))[0].costUsd, 2);
});

test("multi-organization sync paginates each organization and sums matching database keys", async () => {
  process.env.OPENAI_ADMIN_KEYS = JSON.stringify(twoAccounts);
  process.env.OPENAI_ADMIN_KEY = "must-not-be-used";
  const requests: string[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const organization = headers.get("OpenAI-Organization");
    const page = new URL(url).searchParams.get("page");
    requests.push(`${organization}:${page ?? "first"}`);
    assert.equal(headers.get("Authorization"), `Bearer test-${organization === "org-first" ? "first" : "second"}`);
    assert.equal(new URL(url).searchParams.get("group_by[]"), "line_item");
    if (organization === "org-first") return page ? costs(2) : costs(1, "next-first");
    return costs(4);
  });
  const entries = await new OpenAIAdapter().sync(new Date("2026-10-01"));
  assert.deepEqual(requests, ["org-first:first", "org-first:next-first", "org-second:first"]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].costUsd, 7);
  assert.equal(entries[0].model, "gpt-4o");
  assert.equal(entries[0].direction, "input");
});

test("an account failure rejects partial totals and identifies the failed organization", async () => {
  process.env.OPENAI_ADMIN_KEYS = JSON.stringify(twoAccounts);
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) =>
    new Headers(init.headers).get("OpenAI-Organization") === "org-first"
      ? costs(10) : new Response("permission denied", { status: 403 }));
  const adapter = new OpenAIAdapter();
  await assert.rejects(adapter.sync(new Date("2026-10-01")), /org-second API error 403/);
  const connection = await adapter.testConnection();
  assert.equal(connection.ok, false);
  assert.match(connection.error!, /org-second HTTP 403/);
});

test("invalid, duplicate, and empty organization configurations fail before requests without leaking secrets", async () => {
  const request = mock.method(globalThis, "fetch", async () => costs(1));
  for (const value of ["{private-secret", "[]", "{}", "null",
    JSON.stringify([twoAccounts[0], twoAccounts[0]]),
    JSON.stringify([twoAccounts[0], { ...twoAccounts[1], adminKey: twoAccounts[0].adminKey }]),
    JSON.stringify([{ organizationId: "not-an-org", adminKey: "private-secret" }]),
    JSON.stringify([{ organizationId: "org-first", adminKey: " " }])]) {
    process.env.OPENAI_ADMIN_KEYS = value;
    process.env.OPENAI_ADMIN_KEY = "must-not-be-used";
    const adapter = new OpenAIAdapter();
    const result = await adapter.testConnection();
    assert.equal(result.ok, false);
    assert.match(result.error!, /OPENAI_ADMIN_KEYS/);
    assert.doesNotMatch(result.error!, /private-secret|test-first/);
    await assert.rejects(adapter.sync(new Date("2026-10-01")), /OPENAI_ADMIN_KEYS/);
  }
  assert.equal(request.mock.callCount(), 0);
});

test("missing credentials are unconfigured", async () => {
  const adapter = new OpenAIAdapter();
  assert.equal(adapter.isConfigured(), false);
  assert.equal((await adapter.testConnection()).ok, false);
});
