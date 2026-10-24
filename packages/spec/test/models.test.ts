import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { DATA_POLICIES, DATA_POLICY_RANK, MODEL_PROVIDERS, MODEL_ROLES, PERSONA_MAX_CHARS } from "../src/models.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const example = () => JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));

test("v0.1.63: role and policy vocabularies are unique; policy rank is strict local > zdr > standard", () => {
  assert.equal(new Set(MODEL_ROLES).size, MODEL_ROLES.length);
  assert.equal(new Set(DATA_POLICIES).size, DATA_POLICIES.length);
  assert.ok(DATA_POLICY_RANK.local > DATA_POLICY_RANK.zdr && DATA_POLICY_RANK.zdr > DATA_POLICY_RANK.standard);
});

test("v0.1.63: provider catalog — unique ids, known roles, every role has a provider, local providers need no default URL", () => {
  const ids = new Set<string>();
  for (const p of MODEL_PROVIDERS) {
    assert.match(p.id, /^[a-z][a-z0-9-]{1,31}$/, p.id);
    assert.ok(!ids.has(p.id), p.id);
    ids.add(p.id);
    assert.ok(p.roles.length > 0, p.id);
    for (const r of p.roles) assert.ok((MODEL_ROLES as readonly string[]).includes(r), `${p.id}: ${r}`);
    if (p.local) assert.equal(p.defaultBaseUrl, undefined, p.id);
    if (p.defaultBaseUrl) assert.match(p.defaultBaseUrl, /^https:\/\//, p.id);
  }
  for (const r of MODEL_ROLES) assert.ok(MODEL_PROVIDERS.some((p) => p.roles.includes(r)), r);
  // C322(3): DeepSeek and Anthropic have no embeddings API
  for (const id of ["deepseek", "anthropic"]) assert.ok(!MODEL_PROVIDERS.find((p) => p.id === id)?.roles.includes("embeddings"), id);
  // C330(4): a local lane exists for the roles Observer-type apps need
  for (const r of ["embeddings", "reasoning", "summarize"] as const) assert.ok(MODEL_PROVIDERS.some((p) => p.local && p.roles.includes(r)), r);
});

test("v0.1.63: manifest settings.modelRoles validates; bad role, policy or env name is refused", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(load("manifest.schema.json"));
  const ok = example();
  ok.settings = { ...(ok.settings ?? { steps: [] }), modelRoles: [{ role: "embeddings", required: false, minPolicy: "zdr", usedBy: ["app"], env: { model: "EMBEDDING_MODEL", key: "EMBEDDING_KEY" } }] };
  assert.equal(validate(ok), true, JSON.stringify(validate.errors));
  for (const bad of [
    { role: "chat", required: true, usedBy: ["app"] },
    { role: "reasoning", required: true, minPolicy: "private", usedBy: ["app"] },
    { role: "reasoning", required: true, usedBy: [] },
    { role: "reasoning", required: true, usedBy: ["app"], env: { model: "TB_MODEL" } },
    { role: "reasoning", required: true, usedBy: ["app"], env: {} },
    { role: "reasoning", usedBy: ["app"] },
  ]) {
    const m = example();
    m.settings = { ...(m.settings ?? { steps: [] }), modelRoles: [bad] };
    assert.equal(validate(m), false, JSON.stringify(bad));
  }
});

test("v0.1.63: config agents[].persona ≤ PERSONA_MAX_CHARS and modelRoleRequirements entries", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const schema = load("workspace-config.schema.json");
  const agent = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/agentEntry" });
  const base = { agt: "agt_01JA0000000000000000000001", name: "Finance Analyst", mode: "free" };
  assert.equal(agent(base), true, JSON.stringify(agent.errors));
  assert.equal(agent({ ...base, persona: "You are the finance analyst of Acme LLC." }), true, JSON.stringify(agent.errors));
  assert.equal(agent({ ...base, persona: "x".repeat(PERSONA_MAX_CHARS) }), true);
  assert.equal(agent({ ...base, persona: "x".repeat(PERSONA_MAX_CHARS + 1) }), false);
  const req = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/modelRoleRequirement" });
  const r = { role: "summarize", ins: "ins_01JA0000000000000000000001", product: "observer", required: true, minPolicy: "zdr", usedBy: ["app"] };
  assert.equal(req(r), true, JSON.stringify(req.errors));
  assert.equal(req({ ...r, minPolicy: undefined }), false);
  assert.ok(schema.properties.modelRoleRequirements);
  assert.ok(!schema.required.includes("modelRoleRequirements"), "optional: older Core omits it");
});
