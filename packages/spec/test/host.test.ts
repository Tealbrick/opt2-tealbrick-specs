// v0.1.58 (S1-0): host contract — schema closure, pattern drift, route rules, conformance rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CALLER_TYPES, CREDENTIAL_KINDS, CREDENTIAL_REGISTRY, DEVICE_FLOW, TYP } from "../src/credentials.ts";
import {
  HOST_BOX_OWNED_ENV, HOST_CONFORMANCE, HOST_DENIED_ENV, HOST_DETACH_DEFAULT, HOST_ERROR_CODES, HOST_FORBIDDEN_KEYS, HOST_LIMITS, HOST_PATTERNS,
  HOST_PLATFORM_ENV, HOST_PLATFORM_GENERATED, HOST_POLICY, HOST_RESERVED_ACTION_KINDS, HOST_SECRET_VALUE_PATTERNS,
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

test("H-8: every forbidden key is refused at plan, service, release and volume level", () => {
  for (const k of HOST_FORBIDDEN_KEYS) {
    const v = k === "network_mode" || k === "pid" ? "container:other" : true;
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
  assert.equal(d.component.anyOf[0].pattern, HOST_PATTERNS.componentId);
  assert.equal(d.healthPath.anyOf[0].pattern, HOST_PATTERNS.healthPath);
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
  const e = example("host-report.example.json");
  e.escapes = [{ container: "evil", image: "alpine:3", reasons: ["namespace_mode", "docker_sock"], stoppedAt: "2026-10-22T15:00:00Z", stopped: true }];
  assert.equal(validateReport(e), true, JSON.stringify(validateReport.errors));
  e.escapes[0].reasons = ["root_shell"];
  assert.equal(validateReport(e), false, "unknown escape reason");
});

test("secret-like values are caught; platform and public values are not", () => {
  const res = HOST_SECRET_VALUE_PATTERNS.map((p) => new RegExp(p));
  const isSecret = (v: string) => res.some((r) => r.test(v));
  for (const v of [`tbe_${"A".repeat(43)}`, `tbo_${"x".repeat(43)}`, ["sk", "live", "51Habcdefgh"].join("_"), ["rk", "test", "abcdefghij"].join("_"), `ghp_${"a".repeat(36)}`, `sk-ant-api03-${"a".repeat(30)}`, `AKIA${"ABCDEFGHIJKLMNOP"}`, "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4eHh4eHgifQ.sig", "-----BEGIN OPENSSH PRIVATE KEY-----", "postgres://user:pw@db:5432/x"]) assert.ok(isSecret(v), v);
  for (const v of ['{"keys":[{"kty":"OKP","crv":"Ed25519","x":"IIKwS6eT-LIrtVuNO-2VRoGdYk27nBkG8zG_Ed1dt8Q"}]}', "https://portal.example.com", "http://tb-bridge:8080", "/data", "info", "ins_01JZ0000000000000000000005", "postgres://db:5432/x"]) assert.ok(!isSecret(v), v);
});

test("platform, box-owned and denied env names are disjoint and well-formed", () => {
  const owned = Object.keys(HOST_BOX_OWNED_ENV);
  const platform = Object.keys(HOST_PLATFORM_ENV);
  for (const n of owned) assert.ok(!platform.includes(n), n);
  for (const n of [...owned, ...platform, ...HOST_PLATFORM_GENERATED]) {
    assert.match(n, new RegExp(HOST_PATTERNS.envName));
    assert.ok(!HOST_DENIED_ENV.some((d) => (d.endsWith("*") ? n.startsWith(d.slice(0, -1)) : d === n)), n);
  }
  for (const n of ["TB_PORTAL_URL", "TB_PORTAL_KEYS", "TB_BRIDGE_URL", "TB_ENROL_CODE", "TB_OWN_INFRA_ORIGINS", "TB_INTERNAL_HOST", "PORT"]) assert.ok(owned.includes(n), n);
  for (const n of ["NODE_OPTIONS", "LD_*", "PATH", "HTTPS_PROXY"]) assert.ok((HOST_DENIED_ENV as readonly string[]).includes(n), n);
  assert.ok(new RegExp(HOST_PLATFORM_ENV.TB_INSTANCE_ID).test("ins_01JZ0000000000000000000005"));
});

test("path rules: no system path, no empty/dot segment; health path is never a URL", () => {
  const mount = new RegExp(HOST_PATTERNS.mountPath, "u");
  for (const bad of ["/", "/../proc", "/../var/run/docker.sock", "//proc", "/./proc", "/var//run/docker.sock", "/var/./run/docker.sock", "/var/run/docker.sock", "/proc/1/root", "/usr/src/app", "/etc/passwd", "/data/../etc", "/data/.", "/var/lib/docker/volumes", "relative/path"]) assert.ok(!mount.test(bad), bad);
  for (const ok of ["/data", "/var/lib/app", "/srv/knowledge/data", "/home/node/cache"]) assert.ok(mount.test(ok), ok);
  const health = new RegExp(HOST_PATTERNS.healthPath, "u");
  for (const bad of ["//evil.com/x", "/../../x", "/a//b", "http://x/", "healthz", "/.env"]) assert.ok(!health.test(bad), bad);
  for (const ok of ["/", "/healthz", "/tb/v1/health", "/api/health/"]) assert.ok(health.test(ok), ok);
  const image = new RegExp(HOST_PATTERNS.imageByDigest, "u");
  assert.ok(image.test(`registry.example.com:5000/team/app:1.2@sha256:${"a".repeat(64)}`));
  assert.ok(!image.test("ghcr.io/x/y:latest"));
});

test("final (detach) plan holds only stop actions; companions use their manifest id; volume ids may use underscores", () => {
  const p = plan();
  p.final = true;
  p.detach = { mode: "stop" };
  assert.equal(validatePlan(p), false, "final plan with ensure_service");
  p.actions = [p.actions[1]];
  assert.equal(validatePlan(p), true, JSON.stringify(validatePlan.errors));
  p.actions = [];
  assert.equal(validatePlan(p), true, "a stop plan may be empty (the box stops all its services)");
  p.detach = { mode: "leave_running" };
  assert.equal(validatePlan(p), true, "leave_running: a release notice without actions");
  p.actions = [plan().actions[1]];
  assert.equal(validatePlan(p), false, "leave_running never stops anything");
  p.actions = [];
  delete p.detach;
  assert.equal(validatePlan(p), false, "a final plan names its detach mode");
  p.detach = { mode: "wipe" };
  assert.equal(validatePlan(p), false, "only the two modes exist");
  delete p.final;
  p.detach = { mode: "stop" };
  p.actions = [plan().actions[1]];
  assert.equal(validatePlan(p), false, "detach only on a final plan");
  delete p.detach;
  p.actions = [];
  assert.equal(validatePlan(p), false, "a normal plan needs an action");
  const c = plan();
  const s = svc(c) as Record<string, any>;
  s.publicDomain = false;
  delete s.publicHosts;
  s.component = "gbrain-db";
  s.serviceName = "tb-knowledge-gbrain-db";
  s.volumes[0].name = "pg_data";
  assert.equal(validatePlan(c), true, JSON.stringify(validatePlan.errors));
  s.component = "main";
  assert.equal(validatePlan(c), true, "main is just an id string here; identity is the box rule");
  s.component = "tb-evil";
  assert.equal(validatePlan(c), false, "tb- component");
  const big = plan();
  big.seq = 2 ** 31;
  assert.equal(validatePlan(big), false, "seq cap");
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
  assert.equal(detach.input, "ServerDetachInput");
  assert.equal(HOST_DETACH_DEFAULT, "leave_running");
  for (const r of servers.filter((x) => x.method === "GET")) assert.ok((r.auth as readonly string[]).includes("owner-cli"), r.opId);
  // RT1: the owner CLI calls only reads, drafts.*, its own logout and (v0.1.64) its push device + the person-op relay
  const k3Writes = ["owner_sessions.logout", "push_devices.register", "push_devices.unregister", "person_ops.call"];
  for (const r of ROUTES) if ((r.auth as readonly string[]).includes("owner-cli")) assert.ok(r.method === "GET" || r.opId.startsWith("drafts.") || k3Writes.includes(r.opId), r.opId);
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

test("conformance rows H-1..H-19, each bound to a policy rule", () => {
  assert.deepEqual(HOST_CONFORMANCE.map((r) => r.id), Array.from({ length: 19 }, (_, i) => `H-${i + 1}`));
  for (const r of HOST_CONFORMANCE) {
    assert.ok(r.rule in HOST_POLICY, r.id);
    assert.ok(r.given.length > 20 && r.expect.length > 10, r.id);
  }
});
