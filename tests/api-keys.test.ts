import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import Database from "better-sqlite3";
import { ensureApiKeys, saveKeyBatch, saveKeyStatus, readKeys, annotateKey, recordId } from "../src/lib/api-keys/store.ts";
import { maskedHint, keyIdentifier, safeText, type KeyBatch } from "../src/lib/api-keys/types.ts";
import { localKeyRequest, validKeyRange } from "../src/lib/api-keys/request.ts";
registerHooks({ resolve(s, c, next) { return next(s === "../timezone" && c.parentURL?.endsWith("/providers/openai.ts") ? "../timezone.ts" : s, c); } });
const { collectKeys, aggregateUsage } = await import("../src/lib/api-keys/collect.ts");
const names = ["OPENAI_ADMIN_KEYS","OPENAI_ADMIN_KEY","ANTHROPIC_ADMIN_KEY","OPENROUTER_MGMT_KEY","XAI_MANAGEMENT_KEY","XAI_TEAM_ID"];
const env = Object.fromEntries(names.map((n) => [n, process.env[n]]));
afterEach(() => { for (const n of names) { if (env[n] === undefined) delete process.env[n]; else process.env[n] = env[n]; } });
const inventory: KeyBatch = { provider: "anthropic", account: "org", phase: "inventory", keys: [{ keyId: "key-first", name: "Original", hint: "sk-ant-a••••••last1234", hintKind: "key", status: "active", project: "workspace", createdAt: null, lastUsedAt: null }] };
const usage: KeyBatch = { provider: "anthropic", account: "org", phase: "usage", dates: ["2026-10-20"], usage: [{ keyId: "key-first", date: "2026-10-20", model: "claude", input: 100, output: 20, requests: null, cost: null }] };
function fixture() { const db = new Database(":memory:"); db.pragma("foreign_keys=ON"); ensureApiKeys(db); return db; }
function sink() {
  const batches: KeyBatch[] = []; const statuses: unknown[][] = [];
  return { batches, statuses, batch: (b: KeyBatch) => batches.push(b), status: (...s: unknown[]) => statuses.push(s) };
}
const response = (v: unknown) => Response.json(v);

test("hints accept only provider-redacted values, cap exposed fragments, and reject full secrets", () => {
  assert.equal(maskedHint("sk-ant-api03-abcdefgh...abcdefghijklmnop"), "sk-ant-a••••••ijklmnop");
  assert.equal(maskedHint("sk-abc…xyz123"), "sk-abc••••••xyz123");
  for (const v of ["sk-ant-abcdefghijklmnopqrstuvwxyz123456", "named key", "abc...def...ghi", "...abcdef", null]) assert.equal(maskedHint(v), null);
  assert.throws(() => keyIdentifier("sk-abcdefghijklmnopqrstuvwxyz"));
  assert.equal(safeText("name sk-ant-abcdefghijklmnopqrstuvwxyz"), "name [credential omitted]");
});
test("additive storage preserves billing, annotations, account isolation, old keys and old history", () => {
  const db = fixture(); db.exec("CREATE TABLE cost_entries(cost REAL); INSERT INTO cost_entries VALUES(42)"); ensureApiKeys(db);
  saveKeyBatch(db, inventory); saveKeyBatch(db, usage);
  const id = recordId("anthropic", "org", "key-first"); assert.equal(annotateKey(db, id, "Dashboard", "Local tool", "Production reader"), true);
  saveKeyBatch(db, { ...inventory, keys: [{ ...inventory.keys![0], name: "Renamed upstream" }] });
  saveKeyBatch(db, { ...inventory, account: "other" });
  saveKeyBatch(db, { ...inventory, keys: [] });
  saveKeyBatch(db, { ...usage, dates: ["2026-10-21"], usage: [] });
  const view = readKeys(db, "2026-01-01", "2027-01-01"); const row = view.keys.find((k) => k.id === id)!;
  assert.equal(row.name, "Renamed upstream"); assert.equal(row.alias, "Dashboard"); assert.equal(row.usedIn, "Local tool"); assert.equal(row.note, "Production reader"); assert.equal(row.input, 100); assert.equal(row.cost, null);
  assert.equal(view.keys.length, 2); assert.equal(view.daily.length, 1); assert.equal((db.prepare("SELECT cost FROM cost_entries").get() as {cost:number}).cost, 42); db.close();
});
test("complete bucket replacement corrects totals, is idempotent, and retains dates outside coverage", () => {
  const db = fixture(); saveKeyBatch(db, usage); saveKeyBatch(db, usage);
  assert.equal(readKeys(db, "2026-10-01", "2026-11-01").daily.length, 1);
  saveKeyBatch(db, { ...usage, usage: [] }); assert.equal(readKeys(db, "2026-10-01", "2026-11-01").daily.length, 0);
  assert.equal(readKeys(db, "2026-10-01", "2026-11-01").keys.length, 1); db.close();
});
test("failed refresh keeps last success and stored history, and annotations on unknown IDs fail", () => {
  const db = fixture(); saveKeyBatch(db, usage); saveKeyStatus(db,"anthropic","org","usage",true,"ok",new Date("2026-10-20")); saveKeyStatus(db,"anthropic","org","usage",false,"HTTP 403",new Date("2026-10-21"));
  const v = readKeys(db,"2026-10-01","2026-11-01"); assert.equal(v.statuses[0].ok,0); assert.equal(v.statuses[0].succeededAt,"2026-10-20T00:00:00.000Z"); assert.equal(v.daily.length,1); assert.equal(annotateKey(db,"missing","x","y","z"),false); db.close();
});
test("local inventory endpoints reject foreign origins and hosts; date ranges are real calendar dates", () => {
  assert.equal(localKeyRequest(new Request("http://127.0.0.1:4100/api/keys")),true);
  assert.equal(localKeyRequest(new Request("http://localhost:4100/api/keys",{headers:{origin:"http://localhost:4100","sec-fetch-site":"same-origin"}})),true);
  for (const req of [new Request("http://evil.example/api/keys"),new Request("http://127.0.0.1:4100/api/keys",{headers:{origin:"http://evil.example"}}),new Request("http://localhost:4100/api/keys",{headers:{"sec-fetch-site":"cross-site"}})]) assert.equal(localKeyRequest(req),false);
  assert.equal(validKeyRange("2026-02-28","2026-03-01"),true); for(const [a,b] of [["2026-02-30","2026-03-01"],["2026-10-10","2026-10-10"],["bad","2026-03-01"]]) assert.equal(validKeyRange(a,b),false);
});
test("OpenAI inventory 403 does not suppress usage; both organizations remain isolated and paginate", async () => {
  process.env.OPENAI_ADMIN_KEYS=JSON.stringify([{organizationId:"org-one",adminKey:"secret-one"},{organizationId:"org-two",adminKey:"secret-two"}]);
  const s=sink(); const requests:string[]=[];
  await collectKeys("openai",s,new Date("2026-10-22T12:00:00Z"),async (url,init) => {
    const u=new URL(String(url)); assert.equal(init?.method,undefined); assert.equal(init?.redirect,"error"); const org=new Headers(init?.headers).get("OpenAI-Organization")!; requests.push(org);
    if(u.pathname.endsWith("/projects")) return new Response("secret error body",{status:403});
    assert.deepEqual(u.searchParams.getAll("group_by[]"),["api_key_id","model"]);
    return response({data:[{start_time:1792454400,results:[{api_key_id:"key-same",model:"gpt",input_tokens:100,input_cached_tokens:50,output_tokens:10,num_model_requests:2}]}],next_page:u.searchParams.has("page")?null:"page-two"});
  });
  assert.equal(s.batches.length,2); assert.deepEqual(s.batches.map((b)=>b.account),["org-one","org-two"]);
  assert.equal(s.batches[0].usage![0].input,200); // input already includes cached tokens
  assert.equal(s.batches[0].usage![0].cost,null); assert.equal(requests.length,6); assert.equal(JSON.stringify(s).includes("secret"),false);
});
test("OpenAI metadata paginates projects and keys and discards unexpected raw key fields", async () => {
  delete process.env.OPENAI_ADMIN_KEYS;process.env.OPENAI_ADMIN_KEY="credential";const s=sink();
  await collectKeys("openai",s,new Date("2026-10-22"),async (url) => {
    const u=new URL(String(url)); if(u.pathname.includes("/usage/"))return response({data:[]});
    if(u.pathname.endsWith("/projects"))return response({data:[{id:u.searchParams.has("after")?"proj-two":"proj-one"}],has_more:!u.searchParams.has("after"),last_id:"proj-one"});
    return response({data:[{id:u.pathname.includes("proj-one")?"key-one":"key-two",name:"Local",redacted_value:"sk-123456789...0987654321",secret_key:"NEVER-STORE-THIS"}],has_more:false});
  });
  assert.equal(s.batches[0].keys!.length,2);assert.equal(s.batches[0].keys![0].hint,"sk-12345••••••87654321");assert.equal(JSON.stringify(s).includes("NEVER"),false);
});
test("Anthropic inventory and usage paginate; cache input is counted once, with unknown requests/cost", async () => {
  process.env.ANTHROPIC_ADMIN_KEY="credential";const s=sink();
  await collectKeys("anthropic",s,new Date("2026-10-22"),async (url,init) => {
    const u=new URL(String(url));assert.equal(new Headers(init?.headers).get("x-api-key"),"credential");
    if(u.pathname.endsWith("/api_keys"))return response({data:[{id:u.searchParams.has("after_id")?"key-two":"key-one",name:"Name",partial_key_hint:"sk-ant-api03-long...tail"}],has_more:!u.searchParams.has("after_id"),last_id:"key-one"});
    return response({data:[{starting_at:"2026-10-20T00:00:00Z",results:[{api_key_id:"key-one",model:"claude",uncached_input_tokens:10,cache_read_input_tokens:20,cache_creation:{ephemeral_5m_input_tokens:30,ephemeral_1h_input_tokens:40},output_tokens:5}]}],next_page:u.searchParams.has("page")?null:"page-two"});
  });
  assert.equal(s.batches[0].keys!.length,2);assert.equal(s.batches[1].usage![0].input,200);assert.equal(s.batches[1].usage![0].output,10);assert.equal(s.batches[1].usage![0].requests,null);
});
test("OpenRouter activity is filtered by hash and summed across endpoints without adding BYOK or reasoning twice", async () => {
  process.env.OPENROUTER_MGMT_KEY="credential";const s=sink();
  await collectKeys("openrouter",s,new Date("2026-10-22T12:00:00Z"),async (url) => {
    const u=new URL(String(url)); if(u.pathname.endsWith("/keys"))return response({data:[{hash:"a".repeat(64),name:"Tool",label:"Not a masked key",key:"NEVER-STORE-THIS"}]});
    assert.equal(u.searchParams.get("api_key_hash"),"a".repeat(64));
    const row={date:"2026-10-21T00:00:00Z",model:"model",prompt_tokens:100,completion_tokens:20,reasoning_tokens:10,requests:2,usage:1,byok_usage_inference:99};
    return response({data:[row,row,{...row,date:"2026-10-22T00:00:00Z"}]});
  });
  assert.equal(s.batches[0].keys![0].hintKind,"hash");assert.equal(s.batches[1].usage![0].cost,2);assert.equal(s.batches[1].usage![0].output,40);assert.equal(s.batches[1].usage!.length,1);assert.equal(s.batches[1].dates!.length,30);assert.equal(JSON.stringify(s).includes("NEVER"),false);
});
test("a later page failure or repeating cursor never commits a partial inventory", async () => {
  process.env.ANTHROPIC_ADMIN_KEY="credential";const s=sink();
  await collectKeys("anthropic",s,new Date("2026-10-22"),async (url) => {
    if(String(url).includes("usage_report"))return response({data:[]});
    return response({data:[{id:"key-one",name:"Name"}],has_more:true,last_id:"key-one"});
  });
  assert.equal(s.batches.some((b)=>b.phase==="inventory"),false);assert.equal(s.statuses[0][3],false);
});
test("xAI inventory paginates with a read-only request and masks provider hints", async () => {
  process.env.XAI_MANAGEMENT_KEY="credential";process.env.XAI_TEAM_ID="team-one";const s=sink();
  await collectKeys("xai",s,new Date("2026-10-22"),async (url,init) => {
    assert.equal(init?.method,undefined);const next=new URL(String(url)).searchParams.has("paginationToken");
    return response({apiKeys:[{apiKeyId:next?"key-two":"key-one",name:"Grok",redactedApiKey:"xai-abcdefghij...1234567890",apiKey:"NEVER-STORE-THIS"}],paginationToken:next?"":"second"});
  });
  assert.equal(s.batches[0].keys!.length,2);assert.equal(s.batches[0].keys![0].hint,"xai-abcd••••••34567890");assert.equal(JSON.stringify(s).includes("NEVER"),false);
});
test("aggregation preserves unknown cost instead of fabricating zero", () => {
  const rows=aggregateUsage([{keyId:"key",date:"2026-10-20",model:"m",input:10,output:3,requests:null,cost:null},{keyId:"key",date:"2026-10-20",model:"m",input:2,output:1,requests:null,cost:null}]);
  assert.equal(rows[0].input,12);assert.equal(rows[0].cost,null);assert.equal(rows[0].requests,null);
});

test("OpenRouter refresh preserves deleted key history and corrects only the key hashes actually fetched", () => {
  const db=fixture(); const batch:KeyBatch={provider:"openrouter",account:"workspace",phase:"usage",dates:["2026-10-20"],usage:[
    {keyId:"deleted-key",date:"2026-10-20",model:"m",input:100,output:20,requests:2,cost:1},
    {keyId:"live-key",date:"2026-10-20",model:"m",input:100,output:20,requests:2,cost:1}]};
  saveKeyBatch(db,batch);saveKeyBatch(db,{...batch,coverageKeyIds:["live-key"],usage:[]});
  const view=readKeys(db,"2026-10-01","2026-11-01");assert.equal(view.daily.length,1);assert.equal(view.keys.find((k)=>k.keyId==="deleted-key")!.cost,1);
  saveKeyBatch(db,{...batch,coverageKeyIds:[],usage:[]});assert.equal(readKeys(db,"2026-10-01","2026-11-01").daily.length,1);db.close();
});

test("xAI and OpenRouter expired keys never appear active even when not disabled", async () => {
  process.env.XAI_MANAGEMENT_KEY="credential";process.env.XAI_TEAM_ID="team-one";process.env.OPENROUTER_MGMT_KEY="credential";
  for(const provider of ["xai","openrouter"] as const) {
    const s=sink();await collectKeys(provider,s,new Date("2026-10-22T12:00:00Z"),async (url) => {
      if(String(url).includes("/activity"))return response({data:[]});
      const rows=[{name:"Expired",disabled:false,apiKeyId:"key-expired",hash:"hash-expired",expireTime:"2026-10-21T00:00:00Z",expires_at:"2026-10-21T00:00:00Z"},{name:"Live",disabled:false,apiKeyId:"key-live",hash:"hash-live",expireTime:"2027-01-01T00:00:00Z",expires_at:"2027-01-01T00:00:00Z"}];
      return response(provider==="xai"?{apiKeys:rows}:{data:rows});
    });
    assert.deepEqual(s.batches[0].keys!.map((k)=>k.status),["expired","active"]);
  }
});
