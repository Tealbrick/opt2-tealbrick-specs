// v0.1.64 (C326, C332): Teal Brick Mobile — owner client tbm, push devices, person-op relay (K14), portal.info.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDENTIAL_KINDS, CREDENTIAL_REGISTRY, DEVICE_FLOW, LIFETIME_S, OWNER_SESSION_CLIENTS, TYP } from "../src/credentials.ts";
import { HOLD_FAMILIES } from "../src/manifest.ts";
import type { BridgePersonOpResultInput, PersonOpCallResult, PortalInfo } from "../src/routes.ts";
import { AUDIT_ACTIONS, PERSON_OP_RELAY, PUSH, RATE_CLASSES, ROUTES, TRANSPORTS } from "../src/routes.ts";

// Compile-time guards (QA specs#43 S3): no K14 / jws ever travels back toward the K3 caller; PortalInfo is a closed shape.
type Has<T, K extends string> = K extends keyof T ? true : false;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const noJwsInCallResult: Has<PersonOpCallResult, "jws"> = false;
const noJwsInBridgeResult: Has<BridgePersonOpResultInput, "jws"> = false;
const portalInfoKeys: Exact<keyof PortalInfo, "service" | "api" | "spec" | "name" | "ownerClients"> = true;
void [noJwsInCallResult, noJwsInBridgeResult, portalInfoKeys];

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
  // the new-session owner notice is a normative push kind (QA-SPEC43-2)
  assert.deepEqual(Object.keys(PUSH.kinds).sort(), ["decisions", "session_added"]);
  assert.match(PUSH.kinds.session_added, /^New TBM sign-in on your account\./);
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
  assert.deepEqual([...PERSON_OP_RELAY.clients], ["tbm"], "tbd waits for its own design (review B1)");
  for (const c of PERSON_OP_RELAY.clients) assert.ok((OWNER_SESSION_CLIENTS as readonly string[]).includes(c));
  assert.equal(call.rate, "person_op");
  assert.ok("person_op" in RATE_CLASSES);
  const products = PERSON_OP_RELAY.allow.map((a) => a.product);
  assert.equal(new Set(products).size, products.length, "one entry per product");
  for (const a of PERSON_OP_RELAY.allow) {
    const ops = [...a.read, ...a.write] as string[];
    assert.ok(ops.length > 0);
    assert.equal(new Set(ops).size, ops.length, "an op is read OR write");
    // key, export and scope ops never travel this path (review S5)
    for (const op of ops) assert.ok(!op.startsWith("tb.") || ["tb.holds_list", "tb.holds_decide"].includes(op), op);
  }
  assert.deepEqual([...PERSON_OP_RELAY.refuseFamiliesFor.tbm].sort(), ["destructive", "money"]);
  // deny by default: only configured clients have a refusal list, and every relay client has one (QA-SPEC43-1)
  assert.deepEqual(Object.keys(PERSON_OP_RELAY.refuseFamiliesFor), [...PERSON_OP_RELAY.clients]);
  assert.ok(!("tbd" in PERSON_OP_RELAY.refuseFamiliesFor));
  for (const f of Object.values(PERSON_OP_RELAY.refuseFamiliesFor).flat()) assert.ok((HOLD_FAMILIES as readonly string[]).includes(f), f);
  for (const c of PERSON_OP_RELAY.writeClients) assert.ok((PERSON_OP_RELAY.clients as readonly string[]).includes(c));
});

test("person-op relay: a tbd K3 is never an approval credential (review B1)", () => {
  assert.ok(!(PERSON_OP_RELAY.writeClients as readonly string[]).includes("tbd"));
  assert.deepEqual([...PERSON_OP_RELAY.writeClients], ["tbm"]);
});

test("person-op relay: no delivery after Core answered; results fit the post (review B3, S2)", () => {
  const { coreWaitS, queueTtlS, bridgeForwardS, pollWaitS, maxOutputBytes, maxInputBytes } = PERSON_OP_RELAY;
  // an untaken row expires, and a taken one is forwarded with a timeout, before Core gives up
  assert.ok(queueTtlS + bridgeForwardS < coreWaitS);
  // K14 outlives queue + forward (no false refusals) but not much more
  assert.ok(LIFETIME_S.personOp > queueTtlS + bridgeForwardS);
  // the app never runs a K14 after Core answered the caller (QA S3)
  assert.ok(LIFETIME_S.personOp + PERSON_OP_RELAY.expLeewayS <= coreWaitS);
  assert.ok(coreWaitS * 1000 < TRANSPORTS.json.timeoutMs);
  const pull = row("bridge_api.person_ops");
  assert.ok(pollWaitS * 1000 < TRANSPORTS[pull.transport].timeoutMs);
  const result = row("bridge_api.person_op_result");
  // the body travels JSON-escaped inside a string: keep it below half the transport cap
  assert.ok(maxOutputBytes * 2 < TRANSPORTS[result.transport].bodyCapKb * 1024);
  assert.ok(maxInputBytes * 2 < TRANSPORTS[row("person_ops.call").transport].bodyCapKb * 1024);
  assert.ok(PERSON_OP_RELAY.queueMaxPerWorkspace > 0);
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
  assert.equal(LIFETIME_S.personOp, 10);
  assert.ok(k14.checks.some((c) => c.includes("cli ∈ PERSON_OP_RELAY.clients")), "the app re-checks the client");
  assert.ok(k14.checks.some((c) => c.includes("expLeewayS")), "K14 has its own small leeway");
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

// v0.1.70 (QA-SPEC43-4, -6): pin the shapes and constants a reviewer must see change.
type ExactKeys<T, K extends PropertyKey> = [keyof T] extends [K] ? ([K] extends [keyof T] ? true : false) : false;
const callResultKeys: ExactKeys<import("../src/routes.ts").PersonOpCallResult, "status" | "body"> = true;
const bridgeResultKeys: ExactKeys<import("../src/routes.ts").BridgePersonOpResultInput, "pop" | "status" | "body"> = true;
const newSignInKeys: ExactKeys<import("../src/routes.ts").NewSignIn, "osn" | "client" | "machineLabel" | "createdAt"> = true;
const ackInputKeys: ExactKeys<import("../src/routes.ts").NewSignInsAckInput, "osns"> = true;
void ackInputKeys;
type IdkRequired = undefined extends import("../src/routes.ts").PersonOpCallInput["idempotencyKey"] ? false : true;
const idkRequired: IdkRequired = true;
void [callResultKeys, bridgeResultKeys, newSignInKeys, idkRequired];

test("v0.1.70: push texts, allow-list and new-sign-in constants are exact (QA-SPEC43-4)", async () => {
  assert.deepEqual({ ...PUSH.kinds }, {
    decisions: "A decision is waiting",
    session_added: "New TBM sign-in on your account. Not you? Open TBM.",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(PERSON_OP_RELAY.allow)), [
    { product: "inbox", read: ["items_list", "item_get"], write: ["item_decide", "item_snooze", "item_ack"] },
  ]);
  const { NEW_SIGN_IN } = await import("../src/routes.ts");
  assert.deepEqual([...NEW_SIGN_IN.clients], ["tbm"]);
  assert.ok(NEW_SIGN_IN.max > 0 && NEW_SIGN_IN.windowDays > 0);
});

test("v0.1.70: only the browser acknowledges new sign-ins (a K3 can never silence the notice)", () => {
  const r = row("owner_sessions.ack_new_sign_ins");
  assert.deepEqual([...r.auth], ["browser"]);
  assert.equal(r.method, "POST");
  assert.equal(r.input, "NewSignInsAckInput");
  // QA-SPEC51-1 / S4: per-session ack of the shown ids, audited
  assert.equal(r.audit, "owner_session.sign_in_ack");
  assert.ok(AUDIT_ACTIONS.includes("owner_session.sign_in_ack"));
});

test("v0.1.70: new-sign-in bounds are exact; machine labels are bounded (QA-SPEC51 S4)", async () => {
  const { NEW_SIGN_IN } = await import("../src/routes.ts");
  assert.equal(NEW_SIGN_IN.max, 5);
  assert.equal(NEW_SIGN_IN.windowDays, 30);
  assert.equal(DEVICE_FLOW.machineLabelMax, 64);
});

test("v0.1.70 (C354): app capabilities are a closed list; person_op is declared by the app, not inferred from a version", async () => {
  const { APP_CAPS } = await import("../src/bridge.ts");
  assert.deepEqual([...APP_CAPS], ["person_op", "app_workflow_grants", "grant_wfl"]); // v0.1.82 (C373 P1, lead §11.2): workflow-grant caps
});

test("v0.1.70 (C354): the bridge's refusals are exact; cap bounds are fixed (fail closed, routing hint only)", async () => {
  const { APP_CAPS, APP_CAPS_LIMITS, PERSON_OP_BRIDGE_REFUSALS } = await import("../src/bridge.ts");
  assert.deepEqual({ ...PERSON_OP_BRIDGE_REFUSALS }, { instanceUnknown: "instance_unknown", appUnsupported: "person_op_unsupported" });
  assert.deepEqual({ ...APP_CAPS_LIMITS }, { maxEntries: 16, maxLength: 32 });
  for (const cap of APP_CAPS) assert.ok(cap.length <= APP_CAPS_LIMITS.maxLength, cap);
  assert.ok(APP_CAPS.length <= APP_CAPS_LIMITS.maxEntries);
});

test("v0.1.70: machine labels refuse bidi, ZWJ and other invisible characters (QA specs#51)", async () => {
  const { MACHINE_LABEL_PATTERN } = await import("../src/routes.ts");
  const { INVISIBLE_CHAR_CLASS, PERSONA_PATTERN } = await import("../src/models.ts");
  const re = new RegExp(MACHINE_LABEL_PATTERN, "u");
  for (const ok of ["Martin's iPhone", "iPhone 🍎", "Pixel 9 Pro", "Téléphone de Zoë", "手机"]) assert.ok(re.test(ok), ok);
  for (const bad of ["", "‮enohp", "i‍Phone", "a⁦b⁩", "tab\there", "line\nbreak", "﻿bom", "x​y", "tag\u{E0041}", "a b"]) {
    assert.ok(!re.test(bad), JSON.stringify(bad));
  }
  // one class, reused (not copied) by the persona rule
  assert.ok(MACHINE_LABEL_PATTERN.includes(INVISIBLE_CHAR_CLASS) && PERSONA_PATTERN.includes(INVISIBLE_CHAR_CLASS));
});

// QA mutants N12/N13/N14/N18: `caps` exists on the claim and the status push with exactly this type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const claimCaps: Same<import("../src/bridge.ts").ClaimRequest["caps"], import("../src/bridge.ts").AppCap[] | undefined> = true;
const statusCaps: Same<import("../src/bridge.ts").AppStatus["caps"], import("../src/bridge.ts").AppCap[] | undefined> = true;
const capsIsOptionalOnClaim: undefined extends import("../src/bridge.ts").ClaimRequest["caps"] ? true : false = true;
void [claimCaps, statusCaps, capsIsOptionalOnClaim];
