// v0.1.89 (C380, docs/ACCESS.md): tb.access/1 schemas and fixtures, the caller vector, the digest, the feed members, the stop-draft rows.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ACCESS_KINDS, ACCESS_NOT_SHOWN, ACCESS_OPS, ACCESS_REVOKE_ITEMS_MAX, type AccessItem, type AccessListOut, type AccessRevokeIn, FEED_ACCEPT_LIFECYCLE, FEED_LIFECYCLES } from "../src/access.ts";
import { BRIDGE_CAPS, BRIDGE_INTERNAL_PATHS, OWNER_DRAFT_KEY_PATTERN, OWNER_DRAFT_LIMITS, OWNER_DRAFT_OPS, OWNER_DRAFTS_CAP, type OwnerDraftGetResult, type OwnerDraftRequestBody } from "../src/bridge.ts";
import { CONTRACT_IDS } from "../src/manifest.ts";
import { AGENT_REINSTATE_WINDOW_SEC, APP_DRAFT_OPS, type AppDraftOpId, AUDIT_ACTIONS, type DraftableOpId, ROUTES } from "../src/routes.ts";
import type { OpContext } from "../src/sdk.ts";

const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ajv = () => new Ajv2020({ strict: false, allErrors: true });
const PAIRS = ["access.list_in.1", "access.list_out.1", "access.revoke_in.1", "access.revoke_out.1"];
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const jcs = (v: Json): string => {
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k] as Json)}`).join(",")}}`;
  return JSON.stringify(v);
};
const row = (id: string) => {
  const r = ROUTES.find((x) => x.opId === id);
  assert.ok(r, id);
  return r;
};

test("v0.1.89: each access schema takes its valid fixtures and refuses its invalid ones", () => {
  for (const base of PAIRS) {
    const validate = ajv().compile(json(`schemas/contracts/${base}.schema.json`));
    const fx = json(`examples/contracts/${base}.json`) as { valid: unknown[]; invalid: { why: string; doc: unknown }[] };
    assert.ok(fx.valid.length > 0 && fx.invalid.length > 0, base);
    for (const doc of fx.valid) assert.equal(validate(doc), true, `${base}: ${JSON.stringify(validate.errors)}`);
    for (const bad of fx.invalid) assert.equal(validate(bad.doc), false, `${base} should refuse: ${bad.why}`);
  }
});

test("v0.1.89: the schemas embed as they are in a manifest op (M-OP-8): object root, no $id, no remote $ref", () => {
  for (const base of PAIRS) {
    const schema = json(`schemas/contracts/${base}.schema.json`);
    assert.equal(schema.type, "object", base);
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      if (node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        assert.ok(!["$id", "$schema", "contentEncoding", "contentMediaType"].includes(k), `${base}: ${k}`);
        if (k === "$ref") assert.ok(String(v).startsWith("#/"), `${base}: ${String(v)}`);
        walk(v);
      }
    };
    walk(schema);
  }
  // not a manifest contract id: no manifest release follows from this contract
  assert.deepEqual([...CONTRACT_IDS], ["messages/1", "fleet.directory_feed/1", "documents/1"]);
  assert.deepEqual(json("schemas/manifest.schema.json").$defs.contractId.enum, ["messages/1", "fleet.directory_feed/1", "documents/1"]);
});

test("v0.1.89: complete means nextCursor null and notShown empty, nothing else", () => {
  const validate = ajv().compile(json("schemas/contracts/access.list_out.1.schema.json"));
  const out = (nextCursor: string | null, notShown: { kind: string; reason: string }[], complete: boolean): AccessListOut => ({ v: 1, asOf: "2026-10-30T16:00:00Z", items: [], nextCursor, notShown, complete });
  const shown = [{ kind: "held_calls", reason: "x" }];
  for (const [cursor, kinds] of [[null, []], ["c", []], [null, shown], ["c", shown]] as const) {
    const truth = cursor === null && kinds.length === 0;
    assert.equal(validate(out(cursor, [...kinds], truth)), true, JSON.stringify([cursor, kinds]));
    assert.equal(validate(out(cursor, [...kinds], !truth)), false, JSON.stringify([cursor, kinds]));
  }
});

test("v0.1.89: the caller vector has 6 cases, and a guard written from the doc passes each", () => {
  const { cases } = json("examples/contracts/access.caller_vector.1.json") as { cases: { name: string; caller: { type: string; product?: string; listed?: boolean }; allow: boolean; code?: string; status?: number }[] };
  assert.equal(cases.length, 6);
  const guard = (c: { type: string; product?: string; listed?: boolean }): string | null => {
    if (c.type !== "app") return "no_access";
    if (typeof c.product !== "string" || c.product === "") return "caller_unverified";
    if (c.product !== "fleet") return "no_access";
    return c.listed === true ? null : "caller_unverified";
  };
  for (const c of cases) {
    assert.equal(guard(c.caller), c.allow ? null : (c.code ?? "missing"), c.name);
    if (!c.allow) assert.equal(c.status, 403, c.name);
  }
  assert.equal(cases.filter((c) => c.allow).length, 1);
});

test("v0.1.89: the digest names its fields; active then paused is equal; another resource is not", () => {
  const fx = json("examples/contracts/access.digest.1.json") as { target: string; jcs: string; digest: string; equal: { why: string; item: AccessItem }[]; different: { why: string; item: AccessItem }[] };
  const of = (i: AccessItem) => {
    const body = jcs({ v: 1, target: fx.target, id: i.id, kind: i.kind, subject: i.subject, resource: i.resource, level: i.level } as Json);
    return { body, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` };
  };
  assert.deepEqual(fx.equal.map((e) => e.item.state), ["active", "paused"]);
  for (const e of fx.equal) {
    assert.equal(of(e.item).body, fx.jcs, e.why);
    assert.equal(of(e.item).digest, fx.digest, e.why);
    assert.equal(e.item.digest, fx.digest, e.why);
  }
  for (const d of fx.different) {
    assert.notEqual(of(d.item).digest, fx.digest, d.why);
    assert.equal(d.item.digest, of(d.item).digest, d.why);
  }
  const listOut = json("examples/contracts/access.list_out.1.json") as { valid: AccessListOut[] };
  const targets: Record<string, string> = { account_as_itself: "connect", account_as_me: "connect", channel_sender: "connect", team_grant: "knowledge" };
  for (const i of listOut.valid[0]?.items ?? []) {
    const body = jcs({ v: 1, target: targets[i.kind] ?? "", id: i.id, kind: i.kind, subject: i.subject, resource: i.resource, level: i.level } as Json);
    assert.equal(i.digest, `sha256:${createHash("sha256").update(body).digest("hex")}`, i.id);
    assert.ok(i.id.startsWith(`${i.kind}:`), i.id);
  }
});

test("v0.1.89: the kinds per target equal the schema enum; the op table is exact", () => {
  const schema = json("schemas/contracts/access.list_out.1.schema.json");
  assert.deepEqual([...schema.$defs.item.properties.kind.enum].sort(), Object.values(ACCESS_KINDS).flat().sort());
  assert.deepEqual(Object.keys(ACCESS_KINDS), ["connect", "knowledge", "kanban", "evolution"]);
  assert.deepEqual(ACCESS_OPS.access_list.crud, ["read"]);
  assert.equal(ACCESS_OPS.access_list.idempotency, "none");
  assert.deepEqual(ACCESS_OPS.access_revoke.crud, ["update"]);
  assert.equal(ACCESS_OPS.access_revoke.idempotency, "required");
  assert.equal(ACCESS_OPS.access_revoke.receipt, true);
  assert.ok(!("holdFamily" in ACCESS_OPS.access_revoke));
  assert.ok(!("kanban" in ACCESS_REVOKE_ITEMS_MAX));
  assert.equal(ACCESS_REVOKE_ITEMS_MAX.connect, 5);
  const revoke: AccessRevokeIn = { v: 1, plan: "pln_1", attempt: 1, subject: { kind: "person", id: "ct" }, items: [{ id: "team_grant:1", digest: "sha256:0" }] };
  assert.equal(revoke.v, 1);
});

test("v0.1.89: revoke binds to the target's own row: subject, digest and the running check", () => {
  const fx = json("examples/contracts/access.revoke_bind.1.json") as {
    row: { id: string; subject: { kind: string; id: string }; digest: string };
    cases: { name: string; request: { subject: { kind: string; id: string }; digest: string }; agents: Record<string, string>; outcome: string; code?: string }[];
  };
  assert.equal(fx.cases.length, 5);
  const revoke = (c: (typeof fx.cases)[number]): { outcome: string; code?: string } => {
    if (c.request.digest !== fx.row.digest) return { outcome: "changed" };
    if (c.request.subject.kind !== fx.row.subject.kind || c.request.subject.id !== fx.row.subject.id) return { outcome: "changed" };
    const status = c.agents[fx.row.subject.id];
    if (status !== undefined && status !== "paused") return { outcome: "not_revocable", code: "agent_running" };
    return { outcome: "revoked" };
  };
  for (const c of fx.cases) assert.deepEqual(revoke(c), c.code ? { outcome: c.outcome, code: c.code } : { outcome: c.outcome }, c.name);
});

test("v0.1.89: notShown names per target", () => {
  assert.deepEqual(Object.keys(ACCESS_NOT_SHOWN), Object.keys(ACCESS_KINDS));
  for (const names of Object.values(ACCESS_NOT_SHOWN)) assert.ok((names as readonly string[]).includes("held_calls"));
});

test("v0.1.89: feed lifecycle: the new schema takes all answers; the base schema still takes them (extras ignored)", () => {
  const schema = json("schemas/contracts/fleet.directory_feed.1.lifecycle.schema.json");
  const validate = ajv().compile(schema);
  const base = ajv().compile(json("schemas/contracts/fleet.directory_feed.1.schema.json"));
  const fx = json("examples/contracts/fleet.directory_feed.1.lifecycle.json") as { valid: unknown[]; invalid: { why: string; doc: unknown }[] };
  assert.equal(fx.valid.length, 3);
  for (const doc of fx.valid) {
    assert.equal(validate(doc), true, JSON.stringify(validate.errors));
    assert.equal(base(doc), true, JSON.stringify(base.errors));
  }
  for (const bad of fx.invalid) assert.equal(validate(bad.doc), false, bad.why);
  assert.deepEqual(schema.$defs.full.properties.agents.items.properties.lifecycle.enum, [...FEED_LIFECYCLES]);
  assert.deepEqual(schema.$defs.full.properties.contacts.items.properties.lifecycle.enum, [...FEED_LIFECYCLES]);
  assert.equal(FEED_ACCEPT_LIFECYCLE, "lifecycle");
});

test("v0.1.89: route rows of the stop path; reinstate is browser only and not draftable", () => {
  for (const id of ["agents.offboard", "agents.rotate"]) {
    const r = row(id);
    assert.equal(r.method, "POST");
    assert.deepEqual([...r.auth], ["browser"]);
    assert.equal(r.draftable, true, id);
    assert.equal(r.confirm, true, id);
  }
  const reinstate = row("agents.reinstate");
  assert.deepEqual([...reinstate.auth], ["browser"]);
  assert.equal(reinstate.draftable, false);
  assert.equal(AGENT_REINSTATE_WINDOW_SEC, 2592000);
  for (const [id, path] of [["bridge_api.owner_draft_request", "/bridge/owner-drafts/request"], ["bridge_api.owner_draft_get", "/bridge/owner-drafts/get"], ["bridge_api.owner_draft_withdraw", "/bridge/owner-drafts/withdraw"]] as const) {
    const r = row(id);
    assert.deepEqual([...r.auth], ["bridge"]);
    assert.equal(r.path, path);
    assert.equal(r.rate, "bridge_relay");
    assert.equal(r.draftable, false);
    assert.equal(r.registry, "consent");
  }
  assert.equal(row("bridge_api.owner_draft_get").bodyLog, "none");
  for (const a of ["agent.offboard", "agent.rotate", "agent.reinstate", "owner_draft.request", "owner_draft.withdraw"]) assert.ok((AUDIT_ACTIONS as readonly string[]).includes(a), a);
});

test("v0.1.89: APP_DRAFT_OPS is the only allow-list: exact, narrow, and every other route row stays out", () => {
  assert.deepEqual([...APP_DRAFT_OPS], ["agents.pause", "agents.offboard", "agents.rotate", "companions.workflow_grant_set"]);
  assert.deepEqual([...OWNER_DRAFT_OPS], ["agents.pause", "agents.offboard", "agents.rotate"]);
  const allowed = new Set<string>(APP_DRAFT_OPS);
  const widening = ["edges.create", "edges.update", "agents.resume", "agents.policy_set", "agents.reinstate", "agents.create", "instances.deploy"];
  for (const id of widening) {
    assert.ok(row(id), id);
    assert.ok(!allowed.has(id), id);
  }
  for (const r of ROUTES) if (allowed.has(r.opId)) assert.ok(r.draftable === true || r.draftable === "app_only", r.opId);
  const opTypes: (DraftableOpId | AppDraftOpId)[] = [...APP_DRAFT_OPS];
  assert.equal(opTypes.length, 4);
});

test("v0.1.89: bridge cap, paths, limits, key; wire shapes compile; the body has no ins", () => {
  assert.ok((BRIDGE_CAPS as readonly string[]).includes(OWNER_DRAFTS_CAP));
  assert.equal(OWNER_DRAFTS_CAP, "owner_drafts");
  assert.equal(BRIDGE_INTERNAL_PATHS.ownerDraftRequest, "/tb/v1/owner-drafts");
  assert.equal(BRIDGE_INTERNAL_PATHS.ownerDraftGet, "/tb/v1/owner-drafts/get");
  assert.equal(BRIDGE_INTERNAL_PATHS.ownerDraftWithdraw, "/tb/v1/owner-drafts/withdraw");
  assert.deepEqual(OWNER_DRAFT_LIMITS, { titleMaxChars: 120, stepsMax: 100, expiresInSecMin: 60, expiresInSecMax: 86400, openMax: 10, perHour: 30 });
  const key = new RegExp(OWNER_DRAFT_KEY_PATTERN);
  for (const ok of ["pln_1", "pln_01M66:2", `pln_${"a".repeat(124)}`]) assert.ok(key.test(ok), ok);
  for (const bad of ["", "pln_", "drf_1", "pln_a b", `pln_${"a".repeat(125)}`]) assert.ok(!key.test(bad), bad);
  const body: OwnerDraftRequestBody = { key: "pln_1", title: "Governance: stop request", planDigest: "sha256:0", expiresInSec: 86400, steps: [{ opId: "agents.offboard", agt: "agt_01M4TNVDHPXJGTHATZV5SVJHX9" as never }] };
  assert.ok(!("ins" in body));
  const got: Pick<OwnerDraftGetResult, "state" | "receiptId"> = { state: "expired", receiptId: null };
  assert.equal(got.state, "expired");
  const ctx: Pick<OpContext, "ownerDrafts"> = {};
  assert.equal(ctx.ownerDrafts, undefined);
});

test("v0.1.89: ACCESS.md lists the sha256 of each schema file other repos copy", () => {
  const doc = readFileSync(new URL("../../../docs/ACCESS.md", import.meta.url), "utf8");
  for (const base of [...PAIRS, "fleet.directory_feed.1.lifecycle"]) {
    const bytes = readFileSync(new URL(`../schemas/contracts/${base}.schema.json`, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.ok(doc.includes(`| \`${base}.schema.json\` | \`${hash}\` |`), `${base}: ${hash}`);
  }
});
