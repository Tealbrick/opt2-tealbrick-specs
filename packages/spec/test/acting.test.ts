// v0.1.88 (C378, BRIDGE §8.7): acting agents and the policy recheck: constants, the K15 row, the wire shapes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTING_AGENTS_MAX, ACTING_JOB_PATTERN, type ActingContext, type ActingEnvelope, BRIDGE_CAPS, type CallEnvelope, type PolicyRecheckRequest, type PolicyRecheckResponse, RECHECK_CONTEXT_KEY, RESERVED_CONTEXT_PREFIX } from "../src/bridge.ts";
import { type ActingTicketClaims, CREDENTIAL_KINDS, CREDENTIAL_REGISTRY, LIFETIME_S, TYP } from "../src/credentials.ts";

test("v0.1.88: cap, bounds and reserved keys", () => {
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("acting_agents"));
  assert.equal(ACTING_AGENTS_MAX, 4);
  assert.ok(RECHECK_CONTEXT_KEY.startsWith(RESERVED_CONTEXT_PREFIX));
  const job = new RegExp(ACTING_JOB_PATTERN);
  for (const ok of ["run_1", "wf:abc.2", "A".repeat(128)]) assert.ok(job.test(ok), ok);
  for (const bad of ["", "a b", "A".repeat(129), "x/y", "é"]) assert.ok(!job.test(bad), bad);
});

test("v0.1.88: K15 is bridge-signed, held by the app, 30 days, its own typ, not one-time", () => {
  assert.ok((CREDENTIAL_KINDS as readonly string[]).includes("K15"));
  const row = CREDENTIAL_REGISTRY.find((r) => r.id === "K15");
  assert.ok(row);
  assert.equal(row.typ, TYP.actingTicket);
  assert.equal(TYP.actingTicket, "tb-act+jwt");
  assert.equal(row.issuer, "bridge");
  assert.equal(row.holder, "app");
  assert.equal(row.maxLifetimeS, LIFETIME_S.actingTicket);
  assert.equal(LIFETIME_S.actingTicket, 30 * 86400);
  assert.equal(row.oneTime, false);
});

test("v0.1.88: wire shapes compile; the recheck body has no target", () => {
  const acting: ActingEnvelope = { job: "run_1", tickets: ["a.b.c" as never] };
  const env: CallEnvelope = { target: "kanban" as never, op: "issue_create" as never, input: {}, acting };
  const ctx: ActingContext = { v: 1, agents: [{ id: "agt_1" as never, via: "ticket", job: "run_1" }, { id: "agt_2" as never, via: "parent_call" }] };
  const body: PolicyRecheckRequest = { op: "buzz_post" as never, input: {}, caller: { type: "agent", id: "agt_1" as never } };
  const hold: PolicyRecheckResponse = { decision: "hold", family: "policy", reason: "r", by: "rules/rules_gate" };
  // @ts-expect-error a recheck names no target: an app can ask only about itself
  const noTarget: PolicyRecheckRequest = { ...body, target: "connect" };
  assert.ok(env && ctx && hold && noTarget);
  const claims = {} as ActingTicketClaims;
  assert.ok(claims);
});
