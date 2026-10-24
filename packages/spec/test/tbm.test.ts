// v0.1.64 (C326, C332): Teal Brick Mobile — owner client tbm, push devices, person-op relay (K14), portal.info.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDENTIAL_KINDS, CREDENTIAL_REGISTRY, DEVICE_FLOW, LIFETIME_S, OWNER_SESSION_CLIENTS, TYP } from "../src/credentials.ts";
import { HOLD_FAMILIES } from "../src/manifest.ts";
import { AUDIT_ACTIONS, PERSON_OP_RELAY, PUSH, RATE_CLASSES, ROUTES, TRANSPORTS } from "../src/routes.ts";

const row = (opId: string) => {
  const r = ROUTES.find((x) => x.opId === opId);
  assert.ok(r, opId);
  return r;
};

test("tbm: owner scope only (no agent or host scope in this version), stored as its own client", () => {
  assert.ok((DEVICE_FLOW.clientIds as readonly string[]).includes("tbm"));
  assert.ok((DEVICE_FLOW.ownerClientIds as readonly string[]).includes("tbm"));
  assert.ok(!(DEVICE_FLOW.agentClientIds as readonly string[]).includes("tbm"));
  assert.ok(!(DEVICE_FLOW.hostClientIds as readonly string[]).includes("tbm"));
  assert.ok((OWNER_SESSION_CLIENTS as readonly string[]).includes("tbm"));
  assert.equal(LIFETIME_S.ownerTbdSessionIdle, 7 * 86400);
});

test("push devices: only the calling owner session, only clients in PUSH.clients, token never logged", () => {
  for (const opId of ["push_devices.register", "push_devices.unregister"]) {
    const r = row(opId);
    assert.deepEqual([...r.auth], ["owner-cli"], opId);
    assert.equal(r.path, "/owner-sessions/current/push-device", opId);
    assert.equal(r.idempotent, false, opId);
  }
  assert.equal(row("push_devices.register").bodyLog, "none");
  assert.deepEqual([...PUSH.clients], ["tbm"]);
  for (const c of PUSH.clients) assert.ok((OWNER_SESSION_CLIENTS as readonly string[]).includes(c));
  assert.ok(AUDIT_ACTIONS.includes("push_device.register") && AUDIT_ACTIONS.includes("push_device.unregister"));
  // the fixed text carries no content placeholder
  for (const text of Object.values(PUSH.kinds)) assert.ok(!/[{}<>$%]/.test(text), text);
});

test("person-op relay: K3 only, clients tbd/tbm (never cli), one allow-list, bodies never logged", () => {
  const call = row("person_ops.call");
  assert.deepEqual([...call.auth], ["owner-cli"]);
  assert.equal(call.method, "POST");
  assert.equal(call.bodyLog, "none");
  assert.equal(call.audit, "person_op.relay");
  assert.equal(call.draftable, false);
  assert.equal(call.confirm, false);
  assert.ok(!(PERSON_OP_RELAY.clients as readonly string[]).includes("cli"));
  for (const c of PERSON_OP_RELAY.clients) assert.ok((OWNER_SESSION_CLIENTS as readonly string[]).includes(c));
  const products = PERSON_OP_RELAY.allow.map((a) => a.product);
  assert.equal(new Set(products).size, products.length, "one entry per product");
  for (const a of PERSON_OP_RELAY.allow) {
    assert.ok(a.ops.length > 0);
    for (const op of a.ops as readonly string[]) assert.ok(!op.startsWith("tb.") || ["tb.holds_list", "tb.holds_decide"].includes(op), op);
  }
  assert.deepEqual([...PERSON_OP_RELAY.refuseFamiliesFor.tbm].sort(), ["destructive", "money"]);
  for (const f of Object.values(PERSON_OP_RELAY.refuseFamiliesFor).flat()) assert.ok((HOLD_FAMILIES as readonly string[]).includes(f), f);
  // Core waits less than the K3 transport allows; the bridge poll wait fits its transport
  assert.ok(PERSON_OP_RELAY.coreWaitS * 1000 < TRANSPORTS.json.timeoutMs);
  const pull = row("bridge_api.person_ops");
  assert.ok(PERSON_OP_RELAY.pollWaitS * 1000 < TRANSPORTS[pull.transport].timeoutMs);
  assert.ok(PERSON_OP_RELAY.queueTtlS <= LIFETIME_S.personOp);
  for (const opId of ["bridge_api.person_ops", "bridge_api.person_op_result"]) {
    const r = row(opId);
    assert.deepEqual([...r.auth], ["bridge"], opId);
    assert.equal(r.bodyLog, "none", opId);
    assert.equal(r.rate, "bridge_relay", opId);
  }
  assert.ok("bridge_relay" in RATE_CLASSES);
});

test("K14: Portal-signed, held only by the bridge, one-time, ≤ 60 s, its own typ", () => {
  assert.ok((CREDENTIAL_KINDS as readonly string[]).includes("K14"));
  const k14 = CREDENTIAL_REGISTRY.find((k) => k.id === "K14");
  assert.ok(k14);
  assert.equal(k14.typ, TYP.personOp);
  assert.equal(k14.issuer, "portal");
  assert.equal(k14.holder, "bridge");
  assert.equal(k14.oneTime, true);
  assert.equal(k14.maxLifetimeS, LIFETIME_S.personOp);
  assert.equal(LIFETIME_S.personOp, 60);
  const typs = Object.values(TYP);
  assert.equal(new Set(typs).size, typs.length, "one typ per kind");
});

test("portal.info: public, read-only, no audit", () => {
  const r = row("portal.info");
  assert.deepEqual([...r.auth], ["public"]);
  assert.equal(r.method, "GET");
  assert.equal(r.rate, "public_strict");
  assert.equal(r.audit, null);
});
