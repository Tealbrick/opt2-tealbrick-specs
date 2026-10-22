// v0.1.58 (S1-0): host contract — schema closure, pattern drift, route rules, conformance rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CALLER_TYPES, CREDENTIAL_KINDS, CREDENTIAL_REGISTRY, DEVICE_FLOW, TYP } from "../src/credentials.ts";
import {
  HOST_BOX_OWNED_ENV, HOST_CONFORMANCE, HOST_ERROR_CODES, HOST_FORBIDDEN_KEYS, HOST_LIMITS, HOST_PATTERNS, HOST_PLATFORM_ENV,
  HOST_POLICY, HOST_RESERVED_ACTION_KINDS, HOST_SECRET_VALUE_PATTERNS,
} from "../src/host.ts";
import { AUDIT_ACTIONS, RATE_CLASSES, ROUTES, TRANSPORTS } from "../src/routes.ts";

const schema = (f: string) => JSON.parse(readFileSync(new URL(`../schemas/${f}`, import.meta.url), "utf8"));
const example = (f: string) => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validatePlan = ajv.compile(schema("host-plan.schema.json"));
const validateReport = ajv.compile(schema("host-report.schema.json"));
const clone = <T>(v: T): T => structuredClone(v);
const plan = () => clone(example("host-plan.example.json"));
const svc = (p: { actions: { service?: Record<string, unknown> }[] }) => p.actions[0]!.service!;

test("example plan and report validate", () => {
  assert.equal(validatePlan(plan()), true, JSON.stringify(validatePlan.errors));
  assert.equal(validateReport(example("host-report.example.json")), true, JSON.stringify(validateReport.errors));
});

test("H-8: every forbidden engine key is refused at plan, service, release and volume level", () => {
  for (const k of HOST_FORBIDDEN_KEYS) {
    const v = k === "network_mode" ? "container:openship-edge" : k === "pid" ? "container:openship-api" : true;
    for (const where of ["plan", "service", "release", "volume", "action"] as const) {
      const p = plan();
      const target = where === "plan" ? p : where === "service" ? svc(p) : where === "release" ? svc(p).release : where === "volume" ? (svc(p).volumes as object[])[0] : p.actions[0];
      (target as Record<string, unknown>)[k] = v;
      assert.equal(validatePlan(p), false, `${k} at ${where} must be refused`);
    }
  }
});

test("closed schema: unknown and reserved action kinds, tag-only images, host paths and bad names are refused", () => {
  for (const kind of [...HOST_RESERVED_ACTION_KINDS, "remove_service", "exec"]) {
    const p = plan();
    p.actions.push({ kind, service: svc(p) });
    assert.equal(validatePlan(p), false, kind);
  }
  const bad: [string, (s: Record<string, any>) => void][] = [
    ["tag-only image", (s) => { s.release.image = "ghcr.io/tealbrick/opt2-tealbrick-bridge:0.2.6"; }],
    ["docker.sock mount", (s) => { s.volumes[0].mountPath = "/var/run/docker.sock"; }],
    ["/etc mount", (s) => { s.volumes[0].mountPath = "/etc"; }],
    ["dot-dot mount", (s) => { s.volumes[0].mountPath = "/data/../etc"; }],
    ["root mount", (s) => { s.volumes[0].mountPath = "/"; }],
    ["proc mount", (s) => { s.volumes[0].mountPath = "/proc/1/root"; }],
    ["host path as volume name", (s) => { s.volumes[0].name = "/srv/data"; }],
    ["service without tb- prefix", (s) => { s.serviceName = "openship-api"; }],
    ["dotted service name", (s) => { s.serviceName = "tb-x.evil.example"; }],
    ["lower-case env name", (s) => { s.env.node_options = "x"; }],
    ["public domain without hosts", (s) => { delete s.publicHosts; }],
    ["public domain on a companion", (s) => { s.component = "gbrain"; }],
    ["bad enrol code", (s) => { s.enrolCode = "tbe_short"; }],
    ["grace too long", (s) => { s.stopGraceSeconds = HOST_LIMITS.stopGraceMaxS + 1; }],
    ["extra resource key", (s) => { s.resources.privileged = true; }],
  ];
  for (const [name, mutate] of bad) {
    const p = plan();
    mutate(svc(p) as Record<string, any>);
    assert.equal(validatePlan(p), false, name);
  }
  const p = plan();
  const s = svc(p) as Record<string, any>;
  s.publicDomain = false;
  assert.equal(validatePlan(p), false, "publicHosts without publicDomain");
  delete s.publicHosts;
  assert.equal(validatePlan(p), true, JSON.stringify(validatePlan.errors));
  const big = plan();
  big.actions = Array.from({ length: HOST_LIMITS.planMaxActions + 1 }, () => clone(plan().actions[1]));
  assert.equal(validatePlan(big), false, "too many actions");
  const noKs = plan();
  delete noKs.portalKeySet;
  assert.equal(validatePlan(noKs), false, "portalKeySet is required");
});

test("schemas use the HOST_PATTERNS / HOST_LIMITS values (no drift)", () => {
  const s = schema("host-plan.schema.json");
  const d = s.$defs.service.properties;
  assert.equal(s.$defs.serviceName.pattern, HOST_PATTERNS.serviceName);
  assert.equal(s.$defs.envName.pattern, HOST_PATTERNS.envName);
  assert.equal(d.component.pattern, HOST_PATTERNS.component);
  assert.equal(d.release.properties.image.pattern, HOST_PATTERNS.imageByDigest);
  assert.equal(d.volumes.items.properties.mountPath.pattern, HOST_PATTERNS.mountPath);
  assert.equal(d.volumes.items.properties.name.pattern, HOST_PATTERNS.volumeName);
  assert.equal(d.publicHosts.properties.main.pattern, HOST_PATTERNS.publicHost);
  assert.equal(d.enrolCode.anyOf[0].pattern, HOST_PATTERNS.enrolCode);
  assert.equal(s.properties.actions.maxItems, HOST_LIMITS.planMaxActions);
  assert.equal(d.env.maxProperties, HOST_LIMITS.envMaxEntries);
  const r = schema("host-report.schema.json");
  assert.deepEqual(r.properties.results.items.properties.code.enum, [...HOST_ERROR_CODES]);
  assert.equal(r.properties.services.maxItems, HOST_LIMITS.reportMaxServices);
  for (const p of Object.values(HOST_PATTERNS)) new RegExp(p, "u");
});

test("report schema: metadata only (no logs, no env)", () => {
  for (const k of ["logs", "env", "secrets"]) {
    const r = example("host-report.example.json");
    r[k] = [];
    assert.equal(validateReport(r), false, k);
  }
  const r = example("host-report.example.json");
  r.results[0].code = "made_up";
  assert.equal(validateReport(r), false);
});

test("secret-like values are caught; platform and public values are not", () => {
  const res = HOST_SECRET_VALUE_PATTERNS.map((p) => new RegExp(p));
  const isSecret = (v: string) => res.some((r) => r.test(v));
  for (const v of [`tbe_${"A".repeat(43)}`, `tbo_${"x".repeat(43)}`, "sk_live_51Habcdefgh", "rk_test_abcdefghij", `ghp_${"a".repeat(36)}`, `sk-ant-api03-${"a".repeat(30)}`, "AKIAABCDEFGHIJKLMNOP", "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4eHh4eHgifQ.sig", "-----BEGIN OPENSSH PRIVATE KEY-----", "postgres://user:pw@db:5432/x"]) assert.ok(isSecret(v), v);
  for (const v of ['{"keys":[{"kty":"OKP","crv":"Ed25519","x":"IIKwS6eT-LIrtVuNO-2VRoGdYk27nBkG8zG_Ed1dt8Q"}]}', "https://portal.example.com", "http://tb-bridge:8080", "/data", "info", "ins_01JZ0000000000000000000005", "postgres://db:5432/x"]) assert.ok(!isSecret(v), v);
});

test("platform env forms and box-owned names do not overlap", () => {
  for (const n of HOST_BOX_OWNED_ENV) assert.ok(!(n in HOST_PLATFORM_ENV), n);
  for (const [n, form] of Object.entries(HOST_PLATFORM_ENV)) {
    assert.match(n, new RegExp(HOST_PATTERNS.envName));
    if (!form.includes(":")) new RegExp(form);
  }
  assert.ok(new RegExp(HOST_PLATFORM_ENV.TB_BRIDGE_URL).test("http://tb-bridge:8080"));
  assert.ok(!new RegExp(HOST_PLATFORM_ENV.TB_BRIDGE_URL).test("http://evil.example:80"));
});

test("routes: host rows take only the host class, never store or log bodies; servers rows keep RT1", () => {
  const host = ROUTES.filter((r) => r.opId.startsWith("host."));
  assert.deepEqual(host.map((r) => r.opId).sort(), ["host.plans", "host.report"]);
  for (const r of host) {
    assert.deepEqual([...r.auth], ["host"], r.opId);
    assert.equal(r.bodyLog, "none", r.opId);
    assert.equal(r.idempotent, false, r.opId);
    assert.equal(r.exposure, "gateway", r.opId);
  }
  for (const r of ROUTES) if ((r.auth as readonly string[]).includes("host")) assert.ok(r.opId.startsWith("host."), r.opId);
  const plans = ROUTES.find((r) => r.opId === "host.plans")!;
  assert.equal(plans.transport, "longpoll");
  assert.deepEqual([...plans.query], ["after", "wait"]);
  assert.ok(HOST_LIMITS.longpollWaitMaxS * 1000 < TRANSPORTS.longpoll.timeoutMs);
  const servers = ROUTES.filter((r) => r.opId.startsWith("servers."));
  assert.deepEqual(servers.map((r) => r.opId).sort(), ["servers.detach", "servers.get", "servers.list"]);
  const detach = servers.find((r) => r.opId === "servers.detach")!;
  assert.deepEqual([...detach.auth], ["browser"]);
  assert.equal(detach.confirm, true);
  assert.equal(detach.audit, "server.detach");
  for (const r of servers.filter((x) => x.method === "GET")) assert.ok((r.auth as readonly string[]).includes("owner-cli"), r.opId);
  // RT1 unchanged: the owner CLI calls only reads, drafts.* and its own logout
  for (const r of ROUTES) if ((r.auth as readonly string[]).includes("owner-cli")) assert.ok(r.method === "GET" || r.opId.startsWith("drafts.") || r.opId === "owner_sessions.logout", r.opId);
  assert.ok(AUDIT_ACTIONS.includes("server.pair") && AUDIT_ACTIONS.includes("server.detach"));
  assert.ok("host_poll" in RATE_CLASSES && "host_write" in RATE_CLASSES);
});

test("credentials: K13 host key, host caller, device scope host only for tealbrick-host", () => {
  assert.ok(CREDENTIAL_KINDS.includes("K13"));
  const k13 = CREDENTIAL_REGISTRY.find((r) => r.id === "K13")!;
  assert.equal(k13.holder, "host");
  assert.equal(k13.form, "key_pair");
  assert.ok(CALLER_TYPES.includes("host"));
  assert.equal(TYP.hostAssertion, "tb-host-assert+jwt");
  assert.equal(TYP.hostPlan, "tb-host-plan+jws");
  assert.ok(DEVICE_FLOW.scopes.includes("host"));
  assert.deepEqual([...DEVICE_FLOW.hostClientIds], ["tealbrick-host"]);
  assert.ok((DEVICE_FLOW.clientIds as readonly string[]).includes("tealbrick-host"));
  assert.ok(!(DEVICE_FLOW.ownerClientIds as readonly string[]).includes("tealbrick-host"));
  assert.ok(!(DEVICE_FLOW.agentClientIds as readonly string[]).includes("tealbrick-host"));
});

test("conformance rows H-1..H-11, each bound to a policy rule", () => {
  assert.deepEqual(HOST_CONFORMANCE.map((r) => r.id), Array.from({ length: 11 }, (_, i) => `H-${i + 1}`));
  for (const r of HOST_CONFORMANCE) {
    assert.ok(r.rule in HOST_POLICY, r.id);
    assert.ok(r.given.length > 20 && r.expect.length > 10, r.id);
  }
});
