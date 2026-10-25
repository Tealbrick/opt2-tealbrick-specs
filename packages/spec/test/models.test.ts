import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { BRIDGE_CAPS, CONFIG_CORE_MAX_BYTES, CONFIG_KILLPATH_MAX_BYTES, type ModelRoleStatus, PAIRING_CODES_OPEN_MAX, SLICE_CORE_MAX_CHARS, SLICE_JWS_MAX_CHARS } from "../src/bridge.ts";
import { DATA_POLICIES, DATA_POLICY_RANK, INVISIBLE_CHAR_CLASS, MANIFEST_NAME_PATTERN, MODEL_ID_PATTERN, MODEL_PROVIDERS, MODEL_ROLE_ATTENTION, MODEL_ROLE_HINTS_MAX, MODEL_ROLES, NEVER_LOCAL, NEVER_LOCAL_HOSTNAMES, OWN_HOSTS_MAX, PERSONA_MARKERS, PERSONA_MAX_CHARS, PERSONA_PATTERN, PERSONA_WORKSPACE_MAX_CHARS, POLICY_BASES, PROVIDER_ID_PATTERN } from "../src/models.ts";
import type { AgentCard, CatalogEntry, KeyStatus, KeyStatusRole, ModelRoleHint } from "../src/routes.ts";

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

// ── QA-SPEC42-3/-4 (v0.1.63): drift, labels only, patterns, attention codes, fixtures ──

test("v0.1.63: schema enums equal MODEL_ROLES / DATA_POLICIES in every schema (no drift)", () => {
  const m = load("manifest.schema.json").$defs.modelRole.properties;
  const c = load("workspace-config.schema.json").$defs.modelRoleRequirement.properties;
  const st = load("model-role-status.schema.json").$defs;
  for (const roles of [m.role.enum, c.role.enum, st.role.enum]) assert.deepEqual(roles, [...MODEL_ROLES]);
  for (const pols of [m.minPolicy.enum, c.minPolicy.enum, st.dataPolicy.enum]) assert.deepEqual(pols, [...DATA_POLICIES]);
  assert.equal(st.providerId.pattern, PROVIDER_ID_PATTERN);
  assert.equal(st.modelId.pattern, MODEL_ID_PATTERN);
  assert.equal(st.modelRoleHints.maxItems, MODEL_ROLE_HINTS_MAX);
  for (const p of MODEL_PROVIDERS) assert.match(p.id, new RegExp(PROVIDER_ID_PATTERN), p.id);
});

test("v0.1.63: role entries refuse extra fields and repeated usedBy items", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(load("manifest.schema.json"));
  const withRole = (r: object) => {
    const m = example();
    m.settings = { ...(m.settings ?? { steps: [] }), modelRoles: [r] };
    return m;
  };
  const ok = { role: "reasoning", required: false, usedBy: ["app"] };
  assert.equal(validate(withRole(ok)), true, JSON.stringify(validate.errors));
  assert.equal(validate(withRole({ ...ok, baseUrl: "http://10.0.0.1" })), false);
  assert.equal(validate(withRole({ ...ok, usedBy: ["app", "app"] })), false);
  const cfg = load("workspace-config.schema.json");
  const req = ajv.compile({ $defs: cfg.$defs, $ref: "#/$defs/modelRoleRequirement" });
  const r = { role: "summarize", ins: "ins_01JA0000000000000000000001", product: "observer", required: true, minPolicy: "zdr", usedBy: ["app"] };
  assert.equal(req({ ...r, key: "k" }), false);
  assert.equal(req({ ...r, usedBy: ["app", "app"] }), false);
});

test("v0.1.63: Portal-facing role shapes are labels only (exact keys; base URL / key fields refused)", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const st = load("model-role-status.schema.json");
  const status = ajv.compile({ $defs: st.$defs, $ref: "#/$defs/modelRoleStatus" });
  const keyRow = ajv.compile({ $defs: st.$defs, $ref: "#/$defs/keyStatusRole" });
  const hints = ajv.compile({ $defs: st.$defs, $ref: "#/$defs/modelRoleHints" });
  const s: ModelRoleStatus = { role: "embeddings", ins: "ins_01JA0000000000000000000001" as ModelRoleStatus["ins"], set: true, policyOk: true, provider: "openai", model: "text-embedding-3-small", dataPolicy: "standard" };
  const k: KeyStatusRole = { ...s, product: "knowledge" as KeyStatusRole["product"], required: false, minPolicy: "standard" };
  // the TS types and the schema list the same keys (a field added to one side fails here)
  assert.deepEqual(Object.keys(s).sort(), [...st.$defs.modelRoleStatus.required].sort());
  assert.deepEqual(Object.keys(k).sort(), [...st.$defs.keyStatusRole.required].sort());
  // the only optional key is policyBasis (spec follow-up); anything else added to the schema fails here
  assert.deepEqual(Object.keys(st.$defs.modelRoleStatus.properties).sort(), [...Object.keys(s), "policyBasis"].sort());
  assert.deepEqual(Object.keys(st.$defs.keyStatusRole.properties).sort(), [...Object.keys(k), "policyBasis"].sort());
  assert.equal(status({ ...s, policyBasis: "owner_attested" }), true);
  assert.equal(status({ ...s, policyBasis: "trusted" }), false);
  assert.equal(status(s), true, JSON.stringify(status.errors));
  assert.equal(keyRow(k), true, JSON.stringify(keyRow.errors));
  for (const extra of [{ baseUrl: "http://10.1.2.3:11434" }, { key: "canary-value" }, { keyName: "OpenAI main" }, { apiKey: "x" }]) {
    assert.equal(status({ ...s, ...extra }), false, JSON.stringify(extra));
    assert.equal(keyRow({ ...k, ...extra }), false, JSON.stringify(extra));
  }
  // labels: a URL or a pasted sentence cannot pass as provider/model
  for (const model of ["http://10.1.2.3/v1", "sk live key", "", "x".repeat(129), "a\nb"]) assert.equal(status({ ...s, model }), false, model);
  for (const provider of ["OpenAI", "open ai", "https://x"]) assert.equal(status({ ...s, provider }), false, provider);
  for (const model of ["gpt-4o", "openai/gpt-4o-mini", "llama3:8b", "qwen3-reranker-0.6b", "voyage-3.5@2026"]) assert.equal(status({ ...s, model }), true, model);
  const hint: ModelRoleHint = { role: "reasoning", provider: "ollama", model: "llama3:8b", dataPolicy: "local" };
  assert.equal(hints([hint]), true, JSON.stringify(hints.errors));
  assert.equal(hints(Array.from({ length: MODEL_ROLE_HINTS_MAX + 1 }, () => hint)), false);
  assert.equal(hints([{ ...hint, baseUrl: "http://10.0.0.1" }]), false);
});

test("v0.1.63: optional Portal fields stay optional (older Core / clients)", () => {
  const card = { id: "agt_01JA0000000000000000000001", name: "A" } as Partial<AgentCard>;
  const entry = {} as Partial<CatalogEntry>;
  const keys: KeyStatus = { bridgeReady: true, reportedAt: null, items: [] };
  assert.equal(card.persona ?? "", "");
  assert.equal((entry.modelRoles ?? []).length, 0);
  assert.equal((keys.roles ?? []).length, 0);
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("model_roles"));
});

test("v0.1.63: MODEL_ROLE_ATTENTION is exactly the three documented codes", () => {
  assert.deepEqual([...MODEL_ROLE_ATTENTION], ["model_role_missing", "model_role_optional", "embeddings_changed"]);
  for (const c of MODEL_ROLE_ATTENTION) assert.match(c, /^[a-z][a-z0-9_]{0,39}$/);
  const docs = readFileSync(new URL("../../../docs/MANIFEST.md", import.meta.url), "utf8");
  for (const c of MODEL_ROLE_ATTENTION) assert.ok(docs.includes(c), c);
});

test("v0.1.63: invalid modelRoles fixtures name a rule and a code (manifest package tests against them)", () => {
  const fx = JSON.parse(readFileSync(new URL("../examples/model-roles.invalid.json", import.meta.url), "utf8"));
  const rules = new Set<string>();
  for (const c of fx.cases) {
    assert.match(c.rule, /^M-MR-[1-5]$/);
    assert.ok(["model_role_invalid", "condition_invalid"].includes(c.code), c.code);
    assert.ok(Array.isArray(c.modelRoles) && c.modelRoles.length > 0);
    rules.add(c.rule);
  }
  assert.deepEqual([...rules].sort(), ["M-MR-1", "M-MR-2", "M-MR-3", "M-MR-4", "M-MR-5"]);
});

test("spec follow-up (QA-SPEC42-11, local check): gateways and never-local ranges", () => {
  assert.deepEqual(
    MODEL_PROVIDERS.filter((p) => p.gateway).map((p) => p.id),
    ["openrouter", "litellm", "openai-compatible"],
  );
  for (const p of MODEL_PROVIDERS.filter((p) => p.gateway)) assert.ok(p.zdrOffered && p.openaiCompatible && !p.local, p.id);
  for (const cidr of NEVER_LOCAL) assert.match(cidr, /^[0-9a-f.:]+\/\d{1,3}$/, cidr);
  assert.ok(NEVER_LOCAL.includes("100.100.100.200/32"), "cloud metadata inside CGNAT");
  assert.ok(OWN_HOSTS_MAX > 0 && OWN_HOSTS_MAX <= 64);
  assert.equal(PERSONA_WORKSPACE_MAX_CHARS, 250_000);
});

// ── Spec follow-up (QA-SPEC49-1/-2/-6): a reference classifier for BRIDGE §15.3, run against the shared fixture ──

const v4 = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : 2 ** 32 - 2 ** (32 - Number(bits));
  return (v4(ip) & mask) >>> 0 === (v4(base) & mask) >>> 0;
};
const hex1 = (h: string) => Number.parseInt(h.split(":")[0] || "0", 16);
function hostOf(url: URL): { host: string; ip4: string | null; ip6: string | null } {
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) host = host.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const n = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
    host = [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
  }
  const ip4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : null;
  const ip6 = !ip4 && host.includes(":") ? host : null;
  return { host, ip4, ip6 };
}
function neverLocal(h: ReturnType<typeof hostOf>): boolean {
  if ((NEVER_LOCAL_HOSTNAMES as readonly string[]).includes(h.host)) return true;
  if (h.ip4) return NEVER_LOCAL.filter((c) => !c.includes(":")).some((c) => inV4(h.ip4 as string, c));
  if (h.ip6) return h.ip6 === "::" || h.ip6 === "fd00:ec2::254" || (hex1(h.ip6) & 0xffc0) === 0xfe80;
  return false;
}
const PRIVATE4 = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
function verifiedLocal(h: ReturnType<typeof hostOf>, origin: string, ownInfra: string[]): boolean {
  // exact suffix after a dot: "railway.internal", "xrailway.internal" and "a.railway.internal.evil.com" are NOT local
  if (h.host === "localhost" || h.host.endsWith(".railway.internal") || ownInfra.includes(origin)) return true;
  if (h.ip4) return PRIVATE4.some((c) => inV4(h.ip4 as string, c));
  if (h.ip6) return h.ip6 === "::1" || (hex1(h.ip6) & 0xfe00) === 0xfc00;
  return false;
}
const ownNetIpLiteral = (h: ReturnType<typeof hostOf>) =>
  (h.ip4 !== null && [...PRIVATE4, "100.64.0.0/10"].some((c) => inV4(h.ip4 as string, c))) || (h.ip6 !== null && (hex1(h.ip6) & 0xfe00) === 0xfc00);
function parse(input: string): URL | null {
  if (/[\\@\s?#\uff20\ufe6b\uff3c]|%40|%5c/i.test(input) || [...input].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}
function classifyOwnHost(input: string): string {
  const u = parse(input);
  if (u?.pathname !== "/") return "refused";
  const h = hostOf(u);
  if (neverLocal(h)) return "refused";
  if (u.protocol === "http:" && !ownNetIpLiteral(h)) return "refused";
  return (h.ip4 !== null || h.ip6 !== null) && !ownNetIpLiteral(h) ? "accepted_warn_public" : "accepted";
}
function classifyBase(input: string, ownHosts: string[], ownInfra: string[]): string {
  const u = parse(input);
  if (!u) return "refused";
  const h = hostOf(u);
  const owned = ownHosts.filter((o) => classifyOwnHost(o).startsWith("accepted")).map((o) => new URL(o).origin);
  const cls = neverLocal(h) ? "not_local" : verifiedLocal(h, u.origin, ownInfra) ? "verified" : owned.includes(u.origin) ? "owner_listed" : "not_local";
  if (u.protocol === "http:" && !(cls === "verified" || (cls === "owner_listed" && ownNetIpLiteral(h)))) return "refused";
  return cls;
}

test("spec follow-up: NEVER_LOCAL and NEVER_LOCAL_HOSTNAMES are pinned exactly", () => {
  assert.deepEqual(
    [...NEVER_LOCAL],
    ["169.254.0.0/16", "fe80::/10", "fd00:ec2::254/128", "100.100.100.200/32", "192.0.0.192/32", "168.63.129.16/32", "0.0.0.0/8", "::/128"],
  );
  assert.deepEqual([...NEVER_LOCAL_HOSTNAMES], ["metadata.google.internal", "metadata.goog", "metadata"]);
  assert.deepEqual([...POLICY_BASES], ["verified", "owner_attested"]);
});

test("spec follow-up: every local-check fixture row matches the BRIDGE §15.3 reference classifier", () => {
  const fx = JSON.parse(readFileSync(new URL("../examples/local-check.cases.json", import.meta.url), "utf8"));
  assert.ok(fx.cases.length >= 100);
  for (const c of fx.cases) {
    const got = c.kind === "own_host" ? classifyOwnHost(c.input) : classifyBase(c.input, c.ownHosts ?? [], c.ownInfra ?? []);
    assert.equal(got, c.expect, `${c.kind} ${JSON.stringify(c.input)}`);
    if (c.canonical) assert.equal(new URL(c.input).href, c.canonical, c.input);
  }
  // the parser-differential string from QA-SPEC49-1 is in the fixture and refused
  assert.ok(fx.cases.some((c: { input: string; expect: string }) => c.input === "http://10.0.0.1\\@evil.example/v1" && c.expect === "refused"));
});

test("spec follow-up (QA-SPEC49-7): the SDK model error codes are pinned", async () => {
  const { SDK_MODEL_ERROR_CODES } = await import("../src/sdk.ts");
  assert.deepEqual([...SDK_MODEL_ERROR_CODES], ["role_undeclared", "model_endpoint_refused"]);
});

test("spec follow-up (QA-SPEC49-11): the persona budget cannot push the signed config near the bridge limit", () => {
  // worst cases per UTF-16 unit once control characters and lone surrogates are refused: CJK (3 bytes), `"` / `\\` / LF
  // (2 bytes as JSON escapes), astral emoji (4 bytes per 2 units); the config is stored as base64url (x 4/3)
  const b64 = (s: string) => Math.ceil((Buffer.byteLength(JSON.stringify(s)) * 4) / 3);
  for (const unit of ["字", '"', "\\", "\n", "\t", "😀"]) {
    const s = unit.repeat(PERSONA_WORKSPACE_MAX_CHARS / unit.length);
    assert.ok(s.length <= PERSONA_WORKSPACE_MAX_CHARS);
    assert.ok(b64(s) <= 1_000_100, `${JSON.stringify(unit)}: ${b64(s)}`);
  }
  assert.ok(CONFIG_CORE_MAX_BYTES + 1_000_000 <= 4 * 1024 * 1024, "1 MB headroom to the bridge limit");
  assert.ok(CONFIG_CORE_MAX_BYTES < CONFIG_KILLPATH_MAX_BYTES && CONFIG_KILLPATH_MAX_BYTES < 4 * 1024 * 1024);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const schema = load("workspace-config.schema.json");
  const agent = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/agentEntry" });
  const base = { agt: "agt_01JA0000000000000000000001", name: "A", mode: "free" };
  assert.equal(agent({ ...base, persona: "line one\n\tindented" }), true, JSON.stringify(agent.errors));
  for (const bad of ["\u0001", "a\u007fb", "\u0085", "\r\n", "\u0000", "a\u2028b", "\u2029", "\u202e", "\u2067x", "\ufeff", "x\ud800", "\udc00y"])
    assert.equal(agent({ ...base, persona: bad }), false, JSON.stringify(bad));
  for (const good of ["😀 emoji pairs pass", "字", "tab\there"]) assert.equal(agent({ ...base, persona: good }), true, good);
  // C353 / QA-SPEC49-21/-23: refuse by property (Cc/Cf/Cs/Default_Ignorable, U+2028/2029) except the markers; edges both sides
  const refused = ["\u0001", "\u000b", "\u000c", "\u001f", "\u0080", "\u009f", "\u115f", "\u1160", "\u3164", "\uffa0",
    "\u17b4", "\u17b5", "\u0008", "\u001b", "\u2028", "\u2029", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
    "\u2060", "\u2061", "\u2064", "\u2065", "\u2066", "\u2067", "\u2068", "\u2069", "\u206a", "\u206f", "\ufeff",
    "\ufff0", "\ufff8", "\ufff9", "\ufffb", "\udbff", "\udfff", "\u{e0000}", "\u{e0041}", "\u{e007f}", "\u{e0080}",
    "\u{1bca0}", "\ufe0f\ufe0f", "\ufe00\ufe01", "\u{e0100}\u{e0101}", "\ufe0f\u200d\ufe0f", "x\u200d\ufe0f", "\u200c\ufe00",
    "\u0600\ufe0f", "\u00ad\u{e0100}", `😀${"\ufe0f".repeat(54)}`];
  for (const bad of refused) assert.equal(agent({ ...base, persona: `a${bad}b` }), false, JSON.stringify(bad));
  const allowed = ["\t", "\n", "\u00ad", "\u034f", "\u061c", "\u180b", "\u180d", "\u180e", "\u180f", "\u200a", "\u200b",
    "\u200c", "\u200d", "\u200e", "\u200f", "\u2027", "\u202f", "\u205f", "\u2070", "\u115e", "\u1161", "\u3163",
    "\u3165", "\uff9f", "\uffa1", "\ufdff", "\ufe00", "\ufe0f", "\ufffc", "\u{e0100}", "\u{e01ef}", "\u{1f600}",
    "👨\u200d👩\u200d👧", "❤\ufe0f", "1\ufe0f\u20e3", "\u0628\u200c\u0627", "\u05d0\u200f\u05d1", "\u0600", "\u0605", "\u06dd", "\u070f", "\u0890", "\u0891", "\u08e2", "\u{110bd}", "\u{110cd}", " \ufe0f", "a\ufe00",
    "\u0661\u0600\u0662", "🏳\ufe0f\u200d🌈", "❤\ufe0f\u200d🔥", "👁\ufe0f\u200d🗨\ufe0f", "\u00a0", " !~"];
  for (const ok of allowed) assert.equal(agent({ ...base, persona: `a${ok}b` }), true, JSON.stringify(ok));
  assert.equal(PAIRING_CODES_OPEN_MAX, 100);
  assert.equal(schema.$defs.agentEntry.properties.persona.pattern, PERSONA_PATTERN);
});

test("C353: persona markers are exactly the allowed invisible script characters; the slice limit matches the schema", () => {
  const re = new RegExp(PERSONA_PATTERN, "u");
  for (const m of PERSONA_MARKERS) {
    assert.ok(m.from <= m.to && /^[A-Z]{2,4}$/.test(m.label), JSON.stringify(m));
    for (const cp of [m.from, m.to]) assert.ok(re.test(`a${String.fromCodePoint(cp)}b`), `marker U+${cp.toString(16)} must be allowed`);
  }
  assert.deepEqual(
    PERSONA_MARKERS.map((m) => m.label),
    ["SHY", "CGJ", "ANS", "ALM", "ANS", "PCM", "PCM", "PCM", "FVS", "MVS", "FVS", "ZWSP", "ZWNJ", "ZWJ", "LRM", "RLM", "VS", "VS", "PCM", "PCM"],
  );
  assert.equal(load("workspace-config.schema.json").$defs.compactJws.maxLength, SLICE_JWS_MAX_CHARS);
  assert.ok(SLICE_CORE_MAX_CHARS <= SLICE_JWS_MAX_CHARS - 13_000, "reserve for automatic slice growth (QA-SPEC49-22/-27)");
  // C356 / QA-SPEC49-27: slice URLs are origins, the key-set statement is bounded
  const cfg = load("workspace-config.schema.json");
  assert.equal(cfg.$defs.portalKeySet.maxLength, 4096);
  const origin = new Ajv2020({ strict: false }).compile({ $defs: cfg.$defs, $ref: "#/$defs/httpsOrigin" });
  for (const ok of ["https://bridge.example.com", "https://views.example.com:8443"]) assert.equal(origin(ok), true, ok);
  for (const bad of ["https://bridge.example.com/", "https://x.example/path", "http://x.example", `https://${"a".repeat(260)}.example`]) assert.equal(origin(bad), false, bad);
  const slice = load("instance-slice.schema.json");
  for (const ref of [slice.properties.bridge.properties.publicUrl.$ref, slice.properties.portalUrl.$ref, slice.properties.bridge.properties.viewUrl.oneOf[0].$ref])
    assert.equal(ref, "workspace-config.schema.json#/$defs/httpsOrigin");
  // both directions (QA-SPEC49-23): every allowed invisible / format character is a marker, every marker is allowed
  const invisible = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
  const isMarker = (cp: number) => PERSONA_MARKERS.some((m) => cp >= m.from && cp <= m.to);
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (!invisible.test(ch)) continue;
    assert.equal(re.test(`a${ch}b`), isMarker(cp), `U+${cp.toString(16)}: allowed must equal marker`);
  }
  // QA-SPEC49-28: every control character is refused except TAB and LF; printable ASCII and NBSP pass
  for (let cp = 0; cp <= 0x9f; cp++) {
    const ch = String.fromCodePoint(cp);
    if (!/\p{Cc}/u.test(ch)) continue;
    assert.equal(re.test(`a${ch}b`), cp === 0x09 || cp === 0x0a, `U+${cp.toString(16)}`);
  }
  for (let cp = 0x20; cp <= 0x7e; cp++) assert.ok(re.test(`a${String.fromCodePoint(cp)}b`), `U+${cp.toString(16)}`);
  assert.ok(re.test("a\u00a0b"));
});

test("QA-SPEC55-1: MANIFEST_NAME_PATTERN equals the manifest schema pattern and reuses INVISIBLE_CHAR_CLASS", () => {
  assert.equal(load("manifest.schema.json").properties.name.pattern, MANIFEST_NAME_PATTERN);
  assert.ok(MANIFEST_NAME_PATTERN.includes(INVISIBLE_CHAR_CLASS));
});
