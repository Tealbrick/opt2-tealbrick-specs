// v0.1.82 (C373, P1): per-workflow companion grants — constants, the wfl pattern, schemas, route rows and the bound digest.
// No validator lives in this package (the manifest package implements M-CP-4 and the wfl claim once, L1).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  BRIDGE_CAPS, type CallEnvelope, type HookCallInfo, WORKFLOW_GRANT_RELAY_LIMIT, WORKFLOW_GRANT_REQUEST_LIMITS, WORKFLOW_GRANTS_CAP,
  WORKFLOW_WITHDRAWN_MAX, WORKSPACE_INSTANCES_MAX, type WorkflowGrantRequestBody, type WorkspaceConfig,
} from "../src/bridge.ts";
import { type CompanionGrantClaims, LEEWAY_S, LIFETIME_S, WORKFLOW_GRANT_TTL_SEC, WORKFLOW_ID_PATTERN } from "../src/credentials.ts";
import { type Companion, CRUD_ACTIONS, PER_WORKFLOW_OPS_MAX } from "../src/manifest.ts";
import { AUDIT_ACTIONS, type Draft, ROUTES, WORKFLOW_GRANTS_MAX } from "../src/routes.ts";
import type { CallAppOptions, Caller } from "../src/sdk.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../schemas/${f}`, import.meta.url), "utf8"));
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const jcs = (v: Json): string => {
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k] as Json)}`).join(",")}}`;
  return JSON.stringify(v);
};

test("v0.1.82 (C373 P1): constants are exact and consistent", () => {
  assert.equal(WORKFLOW_GRANT_TTL_SEC, 900);
  assert.equal(LIFETIME_S.workflowGrant, 900);
  assert.equal(LIFETIME_S.workflowGrantRemintBelow, 450);
  assert.ok(LIFETIME_S.workflowGrant < LIFETIME_S.grant);
  assert.equal(WORKFLOW_GRANTS_MAX, 500);
  assert.equal(WORKFLOW_WITHDRAWN_MAX, 64);
  assert.equal(PER_WORKFLOW_OPS_MAX, 64);
  assert.equal(WORKFLOW_GRANT_REQUEST_LIMITS.opsPerTargetMax, PER_WORKFLOW_OPS_MAX);
  assert.deepEqual({ ...WORKFLOW_GRANT_REQUEST_LIMITS }, { titleMaxChars: 120, reasonMaxChars: 280, targetsMax: 8, opsPerTargetMax: 64 });
  assert.deepEqual({ ...WORKFLOW_GRANT_RELAY_LIMIT }, { perMinute: 240, burst: 60 });
  assert.equal(WORKFLOW_GRANTS_CAP, "app_workflow_grants");
  assert.ok((BRIDGE_CAPS as readonly string[]).includes(WORKFLOW_GRANTS_CAP));
  assert.equal(LEEWAY_S, 30, "a withdrawal record lives WORKFLOW_GRANT_TTL_SEC + LEEWAY_S = 930 s");
});

test("v0.1.82: WORKFLOW_ID_PATTERN (wfl) and the schemas agree", () => {
  const re = new RegExp(WORKFLOW_ID_PATTERN, "u");
  for (const ok of ["abc", "triage-inbox", "a1-b2", `a${"b".repeat(39)}`]) assert.ok(re.test(ok), ok);
  for (const bad of ["ab", "1abc", "Abc", "a_b", "a.b", "", `a${"b".repeat(40)}`, "tb:wf"]) assert.ok(!re.test(bad), bad);
  assert.equal(load("workspace-config.schema.json").$defs.workflowId.pattern, WORKFLOW_ID_PATTERN);
});

test("v0.1.82 (M-CP-4 shape): manifest schema accepts perWorkflow on one product only, no tb.* ops, no extra members", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const m = load("manifest.schema.json");
  const v = ajv.compile({ $defs: m.$defs, $ref: "#/$defs/companion" });
  const base: Companion = { product: "kanban", operations: ["issues_list"], crud: ["read"], purpose: "Workflows act on issues" };
  const pw = { operations: ["issue_create", "issue_update"], crud: ["create", "update"] } as Companion["perWorkflow"];
  assert.equal(v(base), true, JSON.stringify(v.errors));
  assert.equal(v({ ...base, perWorkflow: pw }), true, JSON.stringify(v.errors));
  assert.equal(v({ ...base, perWorkflow: { ...pw, operations: ["issue_create", "tb.hold_status"] } }), false);
  assert.equal(v({ ...base, perWorkflow: { ...pw, operations: ["tb.holds_pending"] } }), false);
  assert.equal(v({ ...base, perWorkflow: { ...pw, operations: [] } }), false);
  assert.equal(v({ ...base, perWorkflow: { ...pw, operations: Array.from({ length: 65 }, (_, i) => `op_${i}`) } }), false);
  assert.equal(v({ ...base, perWorkflow: { ...pw, operations: Array.from({ length: 64 }, (_, i) => `op_${i}`) } }), true);
  assert.equal(v({ ...base, perWorkflow: { operations: pw?.operations } }), false, "crud is required");
  assert.equal(v({ ...base, perWorkflow: { ...pw, scopes: [] } }), false);
  assert.equal(v({ product: "*", operations: ["tb.holds_pending"], crud: ["read"], purpose: "p", perWorkflow: pw }), false);
  assert.equal(v({ product: "*", operations: ["tb.holds_pending"], crud: ["read"], purpose: "p" }), true, JSON.stringify(v.errors));
});

test("v0.1.82: config withdrawal records and wflEpoch (schema, bounds, refused shapes)", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const cfg = load("workspace-config.schema.json");
  const recs = ajv.compile({ $defs: cfg.$defs, ...cfg.properties.workflowGrantsWithdrawn });
  const epoch = ajv.compile({ $defs: cfg.$defs, ...cfg.properties.wflEpoch });
  const sub = "tb:ins:ins_01JA0000000000000000000001";
  const aud = "tb:ins:ins_01JA0000000000000000000002";
  const r: NonNullable<WorkspaceConfig["workflowGrantsWithdrawn"]>[number] = { sub, wfl: "triage-inbox", at: 1_793_000_000 };
  assert.equal(recs([r, { ...r, aud }]), true, JSON.stringify(recs.errors));
  assert.equal(recs([{ ...r, wfl: "Bad" }]), false);
  assert.equal(recs([{ ...r, sub: "tb:agt:agt_01JA0000000000000000000001" }]), false);
  assert.equal(recs([{ ...r, jti: "x" }]), false);
  assert.equal(cfg.properties.workflowGrantsWithdrawn.maxItems, WORKSPACE_INSTANCES_MAX * WORKFLOW_WITHDRAWN_MAX);
  assert.equal(epoch({ [sub]: 1_793_000_000 }), true, JSON.stringify(epoch.errors));
  assert.equal(epoch({ "ins_01JA0000000000000000000001": 1 }), false);
  assert.equal(epoch({ [sub]: "now" }), false);
  assert.equal(cfg.properties.wflEpoch.maxProperties, WORKSPACE_INSTANCES_MAX);
  assert.ok(!cfg.required.includes("workflowGrantsWithdrawn") && !cfg.required.includes("wflEpoch"), "optional: Core sends them only to a bridge with the cap");
});

test("v0.1.82: wire shapes (types compile; wf ≠ wfl)", () => {
  const claims: Pick<CompanionGrantClaims, "wf" | "wfl"> = { wf: ["issue_create"], wfl: "triage-inbox" };
  const env: CallEnvelope = { target: "kanban", op: "issue_create", input: {}, workflow: "triage-inbox" };
  const opts: CallAppOptions = { workflow: "triage-inbox", context: { "evolution.run": "r1" } };
  const caller: Caller = { type: "app", id: "ins_01JA0000000000000000000001", name: "Evolving Workflows", mode: null, product: "evolution", workflow: "triage-inbox" };
  const hookCaller: HookCallInfo["caller"] = { type: "app", id: "ins_01JA0000000000000000000001", product: "evolution", workflow: "triage-inbox" };
  const body: WorkflowGrantRequestBody = { wfl: "triage-inbox", title: "Triage", targets: [{ product: "kanban", ops: ["issue_create"], crud: ["create"] }] };
  assert.equal(claims.wfl, env.workflow);
  assert.equal(opts.workflow, caller.workflow);
  assert.equal(hookCaller.workflow, body.wfl);
});

test("v0.1.82: route rows — app-created drafts only for workflow_grant_set; revoke is the kill path; bridge relays", () => {
  const row = (id: string) => {
    const r = ROUTES.find((x) => x.opId === id);
    assert.ok(r, id);
    return r;
  };
  const set = row("companions.workflow_grant_set");
  assert.deepEqual([...set.auth], ["browser"]);
  assert.equal(set.draftable, true);
  assert.equal(set.confirm, true);
  const revoke = row("companions.workflow_grant_revoke");
  assert.deepEqual([...revoke.auth], ["browser"]);
  assert.equal(revoke.method, "DELETE");
  assert.equal(revoke.draftable, false);
  assert.deepEqual([...row("companions.workflow_grants_list").auth], ["browser", "owner-cli"]);
  for (const id of ["bridge_api.workflow_grant_request", "bridge_api.workflow_grant_get", "bridge_api.workflow_grant_release"]) {
    const r = row(id);
    assert.deepEqual([...r.auth], ["bridge"], id);
    assert.equal(r.method, "POST", id);
    assert.equal(r.draftable, false, id);
    assert.equal(r.idempotent, false, id);
  }
  assert.equal(row("bridge_api.workflow_grant_get").bodyLog, "none", "the answer carries a grant");
  assert.equal(row("bridge_api.workflow_grant_get").audit, null);
  for (const a of ["workflow_grant.request", "workflow_grant.set", "workflow_grant.revoke", "workflow_grant.release", "workflow_grant.withdraw"]) {
    assert.ok((AUDIT_ACTIONS as readonly string[]).includes(a), a);
  }
  const by: Draft["createdBy"] = { kind: "app", ins: "ins_01JA0000000000000000000001", product: "evolution", name: "Evolving Workflows", digest: "sha256:00" };
  assert.equal(by.kind, "app");
});

test("v0.1.82: the bound payload digest (examples/workflow-grant-digest.cases.json)", () => {
  const fx = JSON.parse(readFileSync(new URL("../examples/workflow-grant-digest.cases.json", import.meta.url), "utf8")) as {
    crudOrder: string[];
    cases: { name: string; ins: string; request: WorkflowGrantRequestBody; canonical: string; digest: string }[];
  };
  assert.deepEqual(fx.crudOrder, [...CRUD_ACTIONS]);
  assert.ok(fx.cases.length >= 2);
  for (const c of fx.cases) {
    const targets = [...c.request.targets]
      .sort((a, b) => (a.product < b.product ? -1 : a.product > b.product ? 1 : 0))
      .map((t) => ({ product: t.product, ops: [...new Set(t.ops)].sort(), crud: CRUD_ACTIONS.filter((x) => t.crud.includes(x)) }));
    const body: Record<string, Json> = { ins: c.ins, wfl: c.request.wfl, title: c.request.title, targets };
    if (c.request.reason) body.reason = c.request.reason;
    const canonical = jcs(body);
    assert.equal(canonical, c.canonical, c.name);
    assert.equal(`sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`, c.digest, c.name);
  }
});
