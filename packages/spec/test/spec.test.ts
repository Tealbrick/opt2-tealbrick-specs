import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { SPEC_VERSION } from "../src/index.ts";
import { STANDARD_OPERATIONS } from "../src/manifest.ts";
import { type AccountMe, AUDIT_ACTIONS, type CheckoutInput, type DraftApplyInput, HARNESS_OPTION_IDS, isHarnessOptionId, type Order, type ReleaseIndexEntry, type ReleaseIndexKind, ROUTES, type TermsAcceptInput } from "../src/routes.ts";
import type { BackupHealth, DynamicHandlers, DynamicHoldView, Health } from "../src/sdk.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

test("every schema compiles (draft 2020-12)", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) ajv.addSchema(load(f));
  for (const f of files) assert.ok(ajv.getSchema(load(f).$id), f);
});

test("example manifest validates", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(load("manifest.schema.json"));
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  assert.equal(validate(ex), true, JSON.stringify(validate.errors));
});

test("route table: unique op ids and method+path", () => {
  const ids = new Set<string>();
  const mp = new Set<string>();
  for (const r of ROUTES) {
    assert.ok(!ids.has(r.opId), r.opId);
    ids.add(r.opId);
    const k = `${r.method} ${r.path}`;
    assert.ok(!mp.has(k), k);
    mp.add(k);
  }
  assert.ok(ROUTES.length >= 100);
});

test("standard operations use the reserved tb. prefix", () => {
  for (const id of STANDARD_OPERATIONS) assert.match(id, /^tb\.[a-z_]+$/);
});

test("harness option ids: one list, unique, canonical spelling, includes claude-code", () => {
  assert.equal(new Set(HARNESS_OPTION_IDS).size, HARNESS_OPTION_IDS.length);
  for (const id of HARNESS_OPTION_IDS) assert.match(id, /^[a-z][a-z0-9-]{1,63}$/);
  assert.equal(isHarnessOptionId("claude-code"), true);
  // CLI runner kinds and old spellings are not harness options (no aliases, C133)
  for (const bad of ["claude-sdk", "command", "claude_code", "generic", "codex", "tealbrick_cli", "", null, 3]) assert.equal(isHarnessOptionId(bad), false, String(bad));
});

test("v0.1.29 (C174): a cli release-index entry is a valid ReleaseIndexEntry; the version constant matches package.json", () => {
  const kinds: ReleaseIndexKind[] = ["app", "bridge", "desktop", "cli"];
  const cli: ReleaseIndexEntry = {
    id: "rel_01JA0000000000000000000009" as ReleaseIndexEntry["id"],
    product: "cli" as ReleaseIndexEntry["product"],
    kind: "cli",
    version: "0.2.0",
    channel: "stable",
    manifestDigest: null,
    manifestUrl: null,
    skillsDigest: null,
    image: null,
    source: null,
    artifact: {
      url: "https://github.com/Martin-Atrin/opt2-tealbrick-dist/releases/download/opt2-tealbrick-cli-cli-v0.2.0/opt2-tealbrick-cli-0.2.0.tgz",
      sha256: `sha256:${"a".repeat(64)}`,
      integrity: `sha512-${"A".repeat(86)}==`,
    },
    services: null,
    runtime: null,
    minOs: null,
    notarized: null,
    upgradeFrom: "*",
    repo: "Martin-Atrin/opt2-tealbrick-cli",
    commit: "e".repeat(40),
    tag: "cli-v0.2.0",
    publishedAt: "2026-10-14T00:00:00.000Z" as ReleaseIndexEntry["publishedAt"],
  };
  assert.ok(kinds.includes(cli.kind));
  // v0.1.30 (C181): kind package, same shape as cli
  const relay: ReleaseIndexEntry = {
    ...cli,
    product: "relay" as ReleaseIndexEntry["product"],
    kind: "package",
    version: "0.1.0",
    artifact: { ...(cli.artifact as NonNullable<ReleaseIndexEntry["artifact"]>), url: "https://github.com/Martin-Atrin/opt2-tealbrick-dist/releases/download/opt2-tealbrick-cli-relay-v0.1.0/opt2-tealbrick-relay-0.1.0.tgz" },
    tag: "relay-v0.1.0",
  };
  const allKinds: ReleaseIndexKind[] = [...kinds, "package"];
  assert.ok(allKinds.includes(relay.kind));
  assert.match(cli.artifact?.integrity ?? "", /^sha512-/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(SPEC_VERSION, pkg.version);
});

test("v0.1.31 (SDK-03): Health.backup is optional and additive", () => {
  const backup: BackupHealth = { schedule: "ok", lastOkAt: null, lastFailedAt: "2026-10-15T03:17:01.000Z" as BackupHealth["lastFailedAt"], lastError: "backup_failed", failures: 1, overdue: false };
  const old: Health = { status: "ok", sdk: "0.1.21", version: "1.0.0", manifestDigest: `sha256:${"0".repeat(64)}` as Health["manifestDigest"], keys: [] };
  const now: Health = { ...old, backup };
  assert.equal(old.backup, undefined);
  assert.equal(now.backup?.failures, 1);
});

test("v0.1.32 (C196 ENG-1/2/6): terms acceptance row, gate codes and optional AccountMe/Order fields", () => {
  const row = ROUTES.find((r) => r.opId === "account.terms_accept");
  assert.ok(row);
  assert.equal(row.method, "POST");
  assert.equal(row.path, "/me/terms");
  assert.deepEqual([...row.auth], ["browser"]); // a person ticks the box; never the owner CLI, never a draft
  assert.equal(row.draftable, false);
  assert.equal(row.audit, "account.terms_accept");
  assert.ok((AUDIT_ACTIONS as readonly string[]).includes("account.terms_accept"));
  const input: TermsAcceptInput = { documents: [{ doc: "terms", version: "1.0" }, { doc: "dpa", version: "1.0" }, { doc: "aup", version: "1.0" }], onBehalfOfBusiness: true };
  assert.equal(input.documents.length, 3);
  const before: AccountMe = { account: { id: "acc_1", createdAt: "2026-10-15T00:00:00.000Z" }, person: { id: "per_1", email: "", name: null, imageUrl: null }, firstSignIn: true, currentWorkspaceId: null, workspaceCount: 0 };
  const after: AccountMe = { ...before, terms: { current: [{ doc: "terms", version: "1.0", title: "Terms of Service", url: "https://tealbrick.com/terms" }], accepted: false, acceptedAt: null }, mfa: { required: true, enrolled: false } };
  assert.equal(before.terms, undefined);
  assert.equal(after.mfa?.required, true);
  const order: Pick<Order, "business"> = { business: { documents: input.documents, acceptedAt: "2026-10-15T00:00:00.000Z", name: "Novak Dental s.r.o.", taxIdProvided: true, checkoutTerms: "accepted" } };
  assert.equal(order.business?.checkoutTerms, "accepted");
});

test("v0.1.34 (C200, legal v1.1): three checkout boxes, licence not-before, order evidence", () => {
  const consumer: CheckoutInput = { offerId: "off_1", returnPath: "/w", buyer: { termsAccepted: true, business: false, immediateSupply: false } };
  const business: CheckoutInput = { offerId: "off_1", returnPath: "/w", buyer: { termsAccepted: true, business: true } };
  const draftStep: CheckoutInput = { offerId: "off_1", returnPath: "/w" };
  const apply: DraftApplyInput = { drf: "drf_1", revision: 2, confirm: true, buyer: { termsAccepted: true, business: false, immediateSupply: true } };
  assert.equal(consumer.buyer?.immediateSupply, false);
  assert.equal(business.buyer?.business, true);
  assert.equal(draftStep.buyer, undefined);
  assert.equal(apply.buyer?.immediateSupply, true);
  const accept: TermsAcceptInput = { documents: [{ doc: "terms", version: "1.1" }, { doc: "aup", version: "1.1" }, { doc: "privacy", version: "1.1" }, { doc: "dpa", version: "1.1" }] };
  assert.equal(accept.onBehalfOfBusiness, undefined);
  const order: Pick<Order, "business"> = {
    business: { documents: accept.documents, acceptedAt: "2026-10-15T00:00:00.000Z", name: null, taxIdProvided: false, checkoutTerms: null, buyerType: "consumer", withdrawalWaiverAt: null, businessDeclared: false, checkoutAcceptedAt: "2026-10-15T00:01:00.000Z", licenceActiveFrom: "2026-10-30T00:00:00.000Z" },
  };
  assert.equal(order.business?.licenceActiveFrom, "2026-10-30T00:00:00.000Z");
});

test("v0.1.35 (SDK-HV-1): DynamicHandlers.holdView is optional and async; DynamicHoldView {summary?, view}", async () => {
  const base: DynamicHandlers = { catalog: async () => [], resolve: async () => null, call: async () => null };
  assert.equal(base.holdView, undefined);
  const withView: DynamicHandlers = { ...base, holdView: async (tool) => (tool === "x" ? { view: "To: a@b.c" } : null) };
  const v: DynamicHoldView | null | undefined = await withView.holdView?.("x", {}, {} as Parameters<NonNullable<DynamicHandlers["holdView"]>>[2]);
  assert.deepEqual(v, { view: "To: a@b.c" });
  assert.equal(v?.summary, undefined);
});

test("v0.1.36 (C193/C203/C204): ADMIN_ROUTES is separate from ROUTES; admin paths, step-up and idempotency rules", async () => {
  const admin = await import("../src/admin.ts");
  const ids = new Set<string>();
  for (const r of admin.ADMIN_ROUTES) {
    assert.ok(!ids.has(r.opId), r.opId);
    ids.add(r.opId);
    assert.equal(r.exposure, "admin");
    assert.match(r.path, /^\/admin\/v1\//);
    if (r.effect === "destructive") assert.equal(r.stepUp, true, r.opId);
    if (r.method !== "GET") assert.equal(r.idempotent, true, r.opId);
  }
  // ROUTES has no admin row and no /admin path
  for (const r of ROUTES as readonly { exposure: string; path: string }[]) {
    assert.notEqual(r.exposure, "admin");
    assert.ok(!r.path.startsWith("/admin"), r.path);
  }
  assert.equal(admin.roleCovers("owner", "support"), true);
  assert.equal(admin.roleCovers("support", "owner"), false);
  assert.equal(admin.roleCovers("readonly", "readonly"), true);
  const input = admin.ADMIN_GATEWAY_SIGNING_INPUT({ method: "POST", pathAndQuery: "/admin/v1/licences/comps", bodySha256: "e3b0", rid: "r".repeat(16), ts: 1 });
  assert.equal(input, `tb-admin-gw-v1\nPOST\n/admin/v1/licences/comps\ne3b0\n${"r".repeat(16)}\n1`);
  assert.equal(admin.ADMIN_STEP_UP_MAX_AGE_MINUTES, 5);
  assert.equal(SPEC_VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});

test("v0.1.37 (C184 §2.3/§6, Admin S2): suspend/ban/lift + health rows; account_suspended; AccountMe.restriction and Health.commerce optional", async () => {
  const admin = await import("../src/admin.ts");
  const byId = new Map(admin.ADMIN_ROUTES.map((r) => [r.opId, r] as const));
  assert.equal(byId.get("customers.ban")?.minRole, "owner");
  assert.equal(byId.get("customers.ban")?.effect, "destructive");
  assert.equal(byId.get("customers.suspend")?.stepUp, true);
  assert.equal(byId.get("admin.health")?.minRole, "readonly");
  const me: AccountMe = { account: { id: "acc_x", createdAt: "" }, person: { id: "per_x", email: "", name: null, imageUrl: null }, firstSignIn: false, currentWorkspaceId: null, workspaceCount: 0 };
  assert.equal(me.restriction, undefined);
  const h: import("../src/routes.ts").Health = { ok: true, version: "x", db: "ok" };
  assert.equal(h.commerce, undefined);
});

test("v0.1.38 (C184 §4/§5, Admin S3): GDPR + CRA rows; personal-data and destructive ops are owner + step-up", async () => {
  const admin = await import("../src/admin.ts");
  const byId = new Map(admin.ADMIN_ROUTES.map((r) => [r.opId, r] as const));
  for (const op of ["gdpr.export_build", "gdpr.export_download", "gdpr.erasure_execute"] as const) {
    assert.equal(byId.get(op)?.minRole, "owner", op);
    assert.equal(byId.get(op)?.stepUp, true, op);
  }
  assert.equal(byId.get("gdpr.erasure_execute")?.effect, "destructive");
  assert.equal(byId.get("cra.triage")?.minRole, "owner");
  assert.equal(byId.get("cra.submission_record")?.minRole, "owner");
  assert.equal(admin.GDPR_DUE_DAYS, 30);
  assert.equal(admin.CRA_EARLY_WARNING_HOURS, 24);
  assert.equal(admin.CRA_NOTIFICATION_HOURS, 72);
  assert.ok(admin.ADMIN_ROUTES.length >= 36);
});

test("v0.1.39 (C213 US-1..4): upgrade-safety fields are optional and additive; failed-mode health; Instance.lastUpdate", async () => {
  const bridge = await import("../src/bridge.ts");
  assert.deepEqual([...bridge.BOOT_FAILURE_ATTENTION].sort(), ["migration_failed", "migration_locked", "preupdate_snapshot_failed", "preupdate_snapshot_no_space", "restore_failed", "schema_newer"]);
  // an AppStatus of an SDK before 0.1.25 stays valid; one from 0.1.25 carries the new members
  const old: import("../src/bridge.ts").AppStatus = { readiness: "ready", version: "1.0.0", sdkVersion: "0.1.24", scopesRev: 0, sliceRevision: 0, keysRev: 0, pendingHolds: 0 };
  const failed: import("../src/bridge.ts").AppStatus = {
    ...old,
    readiness: "degraded",
    attention: { code: "migration_failed", reason: "The update could not change the stored data." },
    schemaVersion: { app: 2, sdk: 5 },
    minCompatibleCode: "1.0.0",
    preUpdateSnapshot: { file: "tb-preupdate-to-2.0.0.tar.gz", sha256: "a".repeat(64), createdAt: "2026-10-16T14:46:23.347Z", from: "1.0.0", to: "2.0.0" },
    failure: { phase: "app_migrations", code: "migration_failed", file: "0003_bad.sql", at: "2026-10-16T14:46:23.400Z" },
  };
  assert.ok(old && failed.failure?.file);
  const health: import("../src/sdk.ts").FailedHealth = {
    status: "failed", sdk: "0.1.25", version: "2.0.0", manifestDigest: `sha256:${"b".repeat(64)}`, failure: failed.failure!, attention: failed.attention!,
    schemaVersion: { app: 2, sdk: 5 }, codeSchema: { app: 3, sdk: 5 }, minCompatibleCode: "1.0.0", preUpdateSnapshot: null,
  };
  assert.equal(health.status, "failed");
  const last: import("../src/routes.ts").InstanceLastUpdate = { outcome: "rolled_back", from: "1.0.0", to: "2.0.0", at: "2026-10-16T14:48:06.000Z", dataRestoredTo: "2026-10-16T14:45:37.000Z" };
  const code: import("../src/routes.ts").ErrorCode = "update_rolled_back";
  assert.ok(last.outcome === "rolled_back" && code);
});

test("v0.1.40 (Core-local fields typed): estimate settings + expected, key when, pending step, bridge outcome, kept data, preUpdateSnapshot pass-through", async () => {
  const routes = await import("../src/routes.ts");
  const row = (id: string) => routes.ROUTES.find((r) => r.opId === id);
  assert.deepEqual([...(row("workspaces.cost_estimate")?.query ?? [])], ["products", "settings"]);
  const list = row("kept_data.list");
  const del = row("kept_data.delete");
  assert.ok(list && del);
  assert.equal(list.method, "GET");
  assert.equal(list.path, "/me/kept-data");
  assert.equal(list.output, "KeptDataList");
  assert.deepEqual([...list.auth], ["browser", "owner-cli"]);
  assert.equal(del.method, "POST");
  assert.equal(del.path, "/me/kept-data/{id}/delete");
  assert.deepEqual([...del.auth], ["browser"]); // RT1: the owner CLI never deletes
  assert.equal(del.input, "KeptDataDeleteInput");
  assert.equal(row("workspaces.delete")?.output, "WorkspaceDeleteResult");
  // old answers stay valid (every new member is optional) and new ones carry the members
  const est: import("../src/routes.ts").CostEstimate = {
    provider: "railway", currency: "USD", monthlyLow: 1.2, monthlyHigh: 40, basis: "b", asOf: "2026-10-17T00:00:00Z",
    lines: [{ item: "knowledge", monthlyLow: 1.2, monthlyHigh: 40, monthlyExpected: 1.2, expectedFrom: "measured" }],
    monthlyExpected: 1.2, expectedFrom: "measured",
  };
  const key: import("../src/routes.ts").KeyRequirement = { name: "OPENAI", label: "OpenAI", provider: "openai", required: true, source: "app_own", help: null, step: null, when: { engine: ["hindsight", "gbrain"] } };
  const step: import("../src/routes.ts").InstructionSet["steps"][number] = { title: "Connect", detail: "the MCP address (shown when your workspace bridge is online)", pending: true };
  const deployed: import("../src/routes.ts").BridgeDeployResult = { bridge: { id: null, state: "absent", version: null, mcpUrl: null, lastSeenAt: null, ackedRevision: null, currentRevision: 0, keptData: { id: "brg_01M53BAEQSGKVVY4PRM2VE6FBF", removedAt: "2026-10-17T00:00:00Z" } }, outcome: "revived" };
  const kept: import("../src/routes.ts").KeptDataItem = {
    id: "ins_01M53BAEQSGKVVY4PRM2VE6FBF", kind: "app", product: "connect", name: "Connect", workspace: { id: "ws_01M53BAEQSGKVVY4PRM2VE6FBF", name: "A", deleted: true },
    provider: "railway", destination: { id: "p", name: null }, services: [{ name: "tb-connect", serviceId: "s", volumeIds: ["v"] }], keptSince: "2026-10-17T00:00:00Z",
    monthlyCost: null, state: "kept", lastError: null,
  };
  const err: import("../src/routes.ts").InstanceError = { code: "destination_in_use", message: "m", reason: "kept_data_in_the_way", keptDataId: kept.id };
  const report: import("../src/bridge.ts").StatusReport["apps"][number]["preUpdateSnapshot"] = { file: "tb-preupdate-to-0.2.0.tar.gz", sha256: "a".repeat(64), createdAt: "2026-10-17T00:00:00Z", from: "0.1.0", to: "0.2.0" };
  assert.ok(est.monthlyExpected && key.when && step.pending && deployed.outcome && err.keptDataId && report);
});

test("v0.1.41 (G3 R1, F126): draft loosening list, confirmLoosening, device-created drafts", async () => {
  const item: import("../src/routes.ts").LooseningItem = { id: "1:held.destructive", n: 1, opId: "agents.policy_set", subject: 'Agent "Sales"', setting: "Ask you before deleting or removing things", before: "on", after: "off" };
  const apply: import("../src/routes.ts").DraftApplyInput = { drf: "drf_01M4TW2PPZT5S353V9NPEQK8JF", revision: 2, confirm: true, confirmLoosening: [item.id] };
  const by: import("../src/routes.ts").Draft["createdBy"] = { kind: "device", id: "dev_01M4TW2PPZT5S353V9NPEQK8JF" };
  assert.ok(apply.confirmLoosening?.includes(item.id) && by.kind === "device");
  const m = await import("../src/manifest.ts");
  assert.ok((m.HOLD_FAMILIES as readonly string[]).includes("public_link"));
  assert.ok((m.HOOK_HOLD_FAMILIES as readonly string[]).includes("public_link"));
  assert.deepEqual([...m.DEFAULT_HELD_FAMILIES], ["destructive", "money", "first_contact", "identity", "public_link"]);
  assert.ok(!(m.DEFAULT_HELD_FAMILIES as readonly string[]).includes("outward")); // outward stays offered-only (C107)
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(load("manifest.schema.json"));
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  const op = { ...ex.operations.find((o: { effect: string }) => o.effect === "write"), id: "page_share", effect: "outward", holdFamily: "public_link", receipt: true };
  assert.equal(validate({ ...ex, operations: [...ex.operations, op] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, operations: [...ex.operations, { ...op, holdFamily: "public_links" }] }), false);
});

test("v0.1.42 (C230, owners' review): shared app-to-app contracts — schema + fixture per CONTRACT_ID; valid pass, invalid fail (L34)", async () => {
  const { CONTRACT_IDS } = await import("../src/manifest.ts");
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const id of CONTRACT_IDS) {
    const base = id.replace("/", ".");
    const schema = JSON.parse(readFileSync(new URL(`../schemas/contracts/${base}.schema.json`, import.meta.url), "utf8"));
    assert.equal(schema.$id, `https://schemas.tealbrick.com/opt2/contracts/${id}.schema.json`);
    const validate = ajv.compile(schema);
    const fx = JSON.parse(readFileSync(new URL(`../examples/contracts/${base}.json`, import.meta.url), "utf8")) as {
      valid: unknown[];
      invalid: { why: string; doc: unknown }[];
      invalidByNormalizeHandle?: { why: string; doc: unknown }[];
    };
    assert.ok(fx.valid.length > 0 && fx.invalid.length > 0, id);
    for (const doc of fx.valid) assert.equal(validate(doc), true, `${id}: ${JSON.stringify(validate.errors)}`);
    for (const bad of fx.invalid) assert.equal(validate(bad.doc), false, `${id} should refuse: ${bad.why}`);
    // the JSON pattern cannot check a bech32 checksum: these pass the schema and MUST be refused by normalizeHandle (conformance)
    for (const bad of fx.invalidByNormalizeHandle ?? []) assert.equal(validate(bad.doc), true, `${id}: ${bad.why}`);
  }
  const validate = ajv.compile(load("manifest.schema.json"));
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  assert.equal(validate({ ...ex, contracts: { produces: ["messages/1"], consumes: ["fleet.directory_feed/1"] } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, contracts: { produces: ["messages/2"] } }), false);
});

test("v0.1.43 (LA-1, LR-1): viewer route purpose, workflow listing, slice viewUrl, StatusReport.views", async () => {
  const m = await import("../src/manifest.ts");
  assert.deepEqual([...m.PUBLIC_ROUTE_PURPOSES], ["oauth_callback", "webhook", "viewer"]);
  assert.deepEqual([...m.OPERATION_LISTINGS], ["default", "workflow"]);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const validate = ajv.getSchema(load("manifest.schema.json").$id);
  assert.ok(validate);
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  const agentOp = ex.operations.find((o: { audience: string }) => o.audience === "agent");
  assert.equal(validate({ ...ex, publicRoutes: [{ path: "/v", purpose: "viewer" }] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, publicRoutes: [{ path: "/v", purpose: "viewers" }] }), false);
  assert.equal(validate({ ...ex, operations: [...ex.operations.filter((o: unknown) => o !== agentOp), { ...agentOp, listing: "workflow" }] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, operations: [...ex.operations.filter((o: unknown) => o !== agentOp), { ...agentOp, listing: "hidden" }] }), false);
  const views: import("../src/bridge.ts").StatusReport["views"] = { url: "https://tb-views-x.up.railway.app", ok: true, lastCheckAt: "2026-10-17T13:00:00Z" };
  const slice: Pick<import("../src/bridge.ts").InstanceSlice, "bridge"> = { bridge: { id: "brg_01M53BAEQSGKVVY4PRM2VE6FBF", keys: [], publicUrl: "https://b.up.railway.app", viewUrl: null } };
  assert.ok(views?.ok && slice.bridge.viewUrl === null);
});

test("v0.1.44 (SDK-CALLER-PRODUCT): app callers carry the verified product id; name stays display only", async () => {
  const c: import("../src/sdk.ts").Caller = { type: "app", id: "ins_01M53BAEQSGKVVY4PRM2VE6FBF", name: "Observer", mode: null, product: "evil-notes" };
  const r: import("../src/sdk.ts").Receipt["caller"] = { type: "app", id: c.id as never, name: c.name, product: c.product };
  assert.notEqual(c.product, c.name.toLowerCase()); // the name may claim anything; product is the identity
  assert.ok(r.product);
});

test("v0.1.45 (HOOK-CALLER-PRODUCT): hook call info carries the verified product of an app caller", async () => {
  const call: import("../src/bridge.ts").HookCallInfo = {
    id: "call_01M53BAEQSGKVVY4PRM2VE6FBF" as never,
    ws: "ws_01M53BAEQSGKVVY4PRM2VE6FBF" as never,
    caller: { type: "app", id: "ins_01M53BAEQSGKVVY4PRM2VE6FBF" as never, product: "observer" },
    target: { instance: "ins_01M53BAEQSGKVVY4PRM2VE6FBG" as never, product: "connect", op: "data_pull", crud: ["read"], effect: "read" },
  };
  assert.equal(call.caller.product, "observer");
});

test("v0.1.46 (GRANT-PRD): a companion grant may carry the signed product of its subject", async () => {
  const c: Pick<import("../src/credentials.ts").CompanionGrantClaims, "sub" | "mode" | "prd"> = { sub: "tb:ins:01M53BAEQSGKVVY4PRM2VE6FBF" as never, mode: "bound", prd: "observer" };
  assert.equal(c.prd, "observer");
});

test("v0.1.47 (SDK-INSTANCE-GRANT): person-op scope grants are typed; rows say who wrote them", async () => {
  const row: import("../src/sdk.ts").ScopeGrantRow = { agent: "agt_01M4TNVDHPXJGTHATZV5SVJHX9" as never, type: "project", instanceId: "p1", access: "contribute", source: "app", grantedByOp: "draft_start" };
  const api: import("../src/sdk.ts").ScopeGrantApi = { grant: async () => row, revoke: async () => {} };
  assert.equal((await api.grant(row.agent, "project", "p1", "contribute")).source, "app");
});

test("v0.1.48 (SDK-COMPANION-CALLERS, C240): slice companion callers carry provider; person ops read them", async () => {
  const c: import("../src/bridge.ts").CompanionCaller = { product: "observer", ins: "ins_01M53BAEQSGKVVY4PRM2VE6FBF" as never, name: "Observer", provider: "own_infra" };
  const old: import("../src/bridge.ts").CompanionCaller = { product: "observer", ins: c.ins, name: "Observer" };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const slice = load("instance-slice.schema.json");
  const item = slice.properties.companionCallers.items;
  const v = ajv.compile({ ...item, $id: new URL("tbtest-companion-caller.json", slice.$id).href });
  assert.equal(v(c), true, JSON.stringify(v.errors));
  assert.equal(v(old), true);
  assert.equal(v({ ...c, provider: null }), true);
  assert.equal(v({ ...c, provider: "Own Infra" }), false);
  const fn: NonNullable<import("../src/sdk.ts").OpContext["companionCallers"]> = () => [c];
  assert.equal(fn()[0]?.provider, "own_infra");
});

test("v0.1.49 (C240 S2 + C261): verified Caller.listed; slice appCallers \"verified\"", async () => {
  const caller: import("../src/sdk.ts").Caller = { type: "app", id: "ins_01M53BAEQSGKVVY4PRM2VE6FBF" as never, name: "Observer", mode: null, product: "observer" as never, listed: true };
  assert.equal(caller.listed, true);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const slice = load("instance-slice.schema.json");
  const v = ajv.compile({ ...slice.properties.appCallers, $id: new URL("tbtest-app-callers.json", slice.$id).href });
  assert.equal(v("verified"), true);
  assert.equal(v("lenient"), false);
  const s: Pick<import("../src/bridge.ts").InstanceSlice, "appCallers"> = { appCallers: "verified" };
  assert.equal(s.appCallers, "verified");
});

test("v0.1.50 (C283 A1): owner-set scope rows are primary; catalog admitted marks; catalog body agent", () => {
  const row: import("../src/sdk.ts").ScopeGrantRow = { agent: "agt_01M53BAEQSGKVVY4PRM2VE6FBF" as never, type: "account", instanceId: "acc1", access: "editor", source: "owner", authority: "owner" };
  assert.equal(row.authority, "owner");
  const old: import("../src/sdk.ts").ScopeGrantRow = { agent: row.agent, type: "account", instanceId: "acc1", access: "viewer" };
  assert.equal(old.authority ?? "bounded", "bounded", "absent = bounded");
  const view: NonNullable<import("../src/sdk.ts").ScopeAccessView["access"]> = { type: "account", id: "acc1", level: "editor", crud: ["read", "update"], authority: "owner" };
  assert.equal(view.authority, "owner");
  const entry: import("../src/manifest.ts").DynamicCatalogEntry = { name: "send_mail", title: "Send", description: "d", inputSchema: { type: "object" } as never, crud: ["create"], effect: "outward", holdFamily: "outward", admitted: "owner" };
  assert.equal(entry.admitted, "owner");
  const body: import("../src/bridge.ts").BridgeOpCatalogBody = { op: "tools" as never, query: "x", agent: row.agent };
  assert.equal(body.agent, row.agent);
  const sum: import("../src/bridge.ts").ScopeSummaryResult = { agent: row.agent, label: "2 accounts", admittedOps: ["account_post"] };
  assert.deepEqual(sum.admittedOps, ["account_post"]);
  const rcp: Pick<import("../src/sdk.ts").Receipt, "admittedBy"> = { admittedBy: "app_owner_row" };
  const dec: Pick<import("../src/sdk.ts").Decision, "admittedBy"> = { admittedBy: "portal_grant" };
  assert.notEqual(rcp.admittedBy, dec.admittedBy);
  const ai: NonNullable<import("../src/sdk.ts").AuthorizeInput["access"]> = { level: "editor", crud: ["update"], authority: "owner" };
  assert.equal(ai.authority, "owner");
  const a: import("../src/sdk.ts").ScopeAuthority[] = ["owner", "bounded"];
  assert.equal(a.length, 2);
});

test("v0.1.51 (RS-7.4 + G2b): held/kept_new vocabulary; config app entry candidate digest", () => {
  const lu: import("../src/routes.ts").InstanceLastUpdate[] = [
    { outcome: "kept_new", from: "0.5.10", to: "0.5.11", at: "2026-10-19T15:00:00Z" as never },
    { outcome: "held", from: "0.1.12", to: "0.1.13", at: "2026-10-19T15:00:00Z" as never, reason: { code: "update_held", message: "x" } },
  ];
  assert.equal(lu.length, 2);
  const codes: import("../src/routes.ts").ErrorCode[] = ["update_held", "update_kept_new"];
  assert.equal(codes.length, 2);
  const phases: import("../src/routes.ts").DeployPhase[] = ["waiting_bridge", "waiting_apps", "held"];
  assert.equal(phases.length, 3);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const cfg = load("workspace-config.schema.json");
  const v = ajv.compile({ ...cfg.$defs.appEntry, $id: new URL("tbtest-app-entry.json", cfg.$id).href, $defs: cfg.$defs });
  const digest = `sha256:${"a".repeat(64)}`;
  const base = { ins: "ins_01M53BAEQSGKVVY4PRM2VE6FBF", product: "notes", version: "0.1.0", sdkMajor: 0, manifestDigest: digest, internalUrl: "http://notes.railway.internal:8080", entitled: true, slice: "aaa.bbb.ccc" };
  const ok = v(base);
  const withCand = v({ ...base, candidateManifestDigest: `sha256:${"b".repeat(64)}`, candidateVersion: "0.2.0" });
  const bad = v({ ...base, candidateManifestDigest: "not-a-digest" });
  assert.equal(ok, true, `base app entry must be valid: ${JSON.stringify(v.errors)}`);
  assert.equal(withCand, true, JSON.stringify(v.errors));
  assert.equal(bad, false);
  assert.equal(v({ ...base, candidateManifestDigest: `sha256:${"b".repeat(64)}` }), false, "candidateManifestDigest needs candidateVersion");
  assert.equal(v({ ...base, candidateVersion: "0.2.0" }), false, "candidateVersion needs candidateManifestDigest");
  const e: Pick<import("../src/bridge.ts").AppEntry, "candidateManifestDigest" | "candidateVersion"> = { candidateManifestDigest: digest as never, candidateVersion: "0.2.0" as never };
  assert.ok(e.candidateManifestDigest);
});

test("v0.1.52 (C283c + C268 B): owner row effective crud and offer; hook proof body digest bd", async () => {
  const row: import("../src/sdk.ts").ScopeGrantRow = { agent: "agt_01M53BAEQSGKVVY4PRM2VE6FBF" as never, type: "notebook", instanceId: "nb1", access: "editor", source: "owner", authority: "owner", crud: ["read", "update"], offer: { adds: ["delete"] } };
  assert.deepEqual(row.offer?.adds, ["delete"]);
  assert.ok(!row.crud?.includes("delete"), "an offered action is not in the effective crud");
  const bounded: import("../src/sdk.ts").ScopeGrantRow = { agent: "agt_01M53BAEQSGKVVY4PRM2VE6FBF" as never, type: "notebook", instanceId: "nb1", access: "editor" };
  assert.equal(bounded.offer, undefined);
  const hp: Pick<import("../src/credentials.ts").CallProofHookClaims, "hook" | "phase" | "bd"> = { hook: "h1", phase: "before", bd: `sha256:${"c".repeat(64)}` as never };
  assert.ok(hp.bd);
  const old: Pick<import("../src/credentials.ts").CallProofHookClaims, "hook" | "phase" | "bd"> = { hook: "h1", phase: "before" };
  assert.equal(old.bd, undefined);
  const caps = await import("../src/bridge.ts");
  assert.deepEqual([...caps.PROOF_CLAIM_CAPS], ["bd"], "the one proof-claim capability");
  const st: Pick<import("../src/bridge.ts").AppStatus, "proofClaims"> = { proofClaims: ["bd"] };
  assert.deepEqual(st.proofClaims, ["bd"]);
  const acts: import("../src/sdk.ts").SdkAuditAction[] = ["scope.snapshot_backfill", "scope.offer_accepted"];
  assert.equal(acts.length, 2);
});

test("v0.1.53 (C289 + C291): TBD device-flow owner sessions have a 7-day idle limit; owner rollback with restore", async () => {
  const { LIFETIME_S } = await import("../src/credentials.ts");
  assert.equal(LIFETIME_S.ownerTbdSessionIdle, 604800);
  assert.equal(LIFETIME_S.ownerCliSessionIdle, 86400);
  assert.ok(LIFETIME_S.ownerTbdSessionIdle < LIFETIME_S.ownerCliSessionAbsolute, "idle never exceeds the absolute life");
  const rb: import("../src/routes.ts").RollbackInput = { ws: "ws_01M53BAEQSGKVVY4PRM2VE6FBF" as never, ins: "ins_01M53BAEQSGKVVY4PRM2VE6FBF" as never, restore: { snapshot: "tb-preupdate-to-0.3.0.tar.gz", sha256: "a".repeat(64), acceptDataLoss: true } };
  assert.equal(rb.restore?.acceptDataLoss, true);
  const r: import("../src/routes.ts").RollbackRestorable = { snapshot: "tb-preupdate-to-0.3.0.tar.gz", sha256: "a".repeat(64), createdAt: "2026-10-19T12:00:00Z" as never };
  const { AUDIT_ACTIONS } = await import("../src/routes.ts");
  assert.ok((AUDIT_ACTIONS as readonly string[]).includes("instance.rollback_restore"));
  assert.ok(r.snapshot);
});

test("v0.1.54 (C292 + C290): bridge capabilities in the status report and the slice; adopt write-op crud", async () => {
  const { BRIDGE_CAPS } = await import("../src/bridge.ts");
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("owner_rows"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const slice = load("instance-slice.schema.json");
  const v = ajv.compile({ ...slice.properties.bridge, $id: new URL("tbtest-slice-bridge.json", slice.$id).href, $defs: slice.$defs });
  const key = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", kid: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
  const base = { id: "brg_01M53BAEQSGKVVY4PRM2VE6FBF", keys: [key] };
  const plain = v(base);
  assert.equal(plain, true, `the base slice bridge must be valid: ${JSON.stringify(v.errors)}`);
  assert.equal(v({ ...base, caps: ["owner_rows"] }), true, JSON.stringify(v.errors));
  assert.equal(v({ ...base, caps: ["Bad Cap"] }), false);
  assert.equal(v({ ...base, caps: ["owner_rows", "owner_rows"] }), false, "duplicates are refused (Core dedupes)");
  assert.equal(v({ ...base, caps: Array.from({ length: 17 }, (_, i) => `cap_${i}`) }), false, "at most 16");
  const w: import("../src/routes.ts").AdoptResolved["grants"][number]["write"][number] = { opId: "note_create", title: "Create a note", effect: "write", crud: ["create"], checked: false };
  assert.deepEqual(w.crud, ["create"]);
});

test("v0.1.55 (C296): a setting choice view carries the manifest note and disabled flag", () => {
  const f: import("../src/routes.ts").SettingFieldView = {
    key: "engine", type: "enum", label: "Memory engine", help: null, required: true, default: "gbrain", mutable: false,
    choices: [{ value: "gbrain", label: "GBrain" }, { value: "hindsight", label: "Hindsight", note: "soon", disabled: true }],
  };
  assert.equal(f.choices?.find((c) => c.disabled)?.note, "soon");
});

test("v0.1.56 (C296): needs_keys is an instance error code (a companion waits for a required key)", () => {
  const e: import("../src/routes.ts").InstanceError = { code: "needs_keys", message: "The gbrain service waits for OPENAI_API_KEY. Enter it on the bridge key page, then use Retry." };
  assert.equal(e.code, "needs_keys");
  const attention: import("../src/routes.ts").Instance["attention"] = { code: "engine_missing", reason: "No memory engine runs." };
  assert.equal(attention?.code, "engine_missing");
});

test("v0.1.57 (C274c/C274d): manifest events, the reserved tb. namespace, the events cap and the wire shapes", async () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(load("manifest.schema.json"));
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  const ev = {
    name: "note.shared",
    title: "A note was shared with the agent",
    payloadSchema: { type: "object", additionalProperties: false, required: ["noteId"], properties: { noteId: { type: "string" } } },
    visibleWith: ex.operations.find((o: { audience: string }) => o.audience === "agent").id,
    audience: "target",
  };
  assert.equal(validate({ ...ex, events: [ev] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, events: [{ ...ev, name: "tb.hold.decided" }] }), false, "an app never declares tb.*");
  assert.equal(validate({ ...ex, events: [{ ...ev, name: "shared" }] }), false, "a name has at least two segments");
  assert.equal(validate({ ...ex, events: [{ ...ev, audience: "everyone" }] }), false);
  assert.equal(validate({ ...ex, events: [{ ...ev, scoped: true }] }), false, "scoped is derived from visibleWith, not declared");
  assert.equal(validate({ ...ex, events: [{ ...ev, payloadSchema: { type: "array" } }] }), false, "object root");
  const { RESERVED_EVENT_PREFIX, EVENT_AUDIENCES } = await import("../src/manifest.ts");
  assert.equal(RESERVED_EVENT_PREFIX, "tb.");
  assert.deepEqual([...EVENT_AUDIENCES], ["target", "granted"]);

  const { BRIDGE_CAPS, BRIDGE_INTERNAL_PATHS, EVENT_MCP_METHODS, PLATFORM_EVENTS } = await import("../src/bridge.ts");
  assert.deepEqual([...BRIDGE_CAPS], ["owner_rows", "events"]);
  assert.equal(BRIDGE_INTERNAL_PATHS.events, "/tb/v1/events");
  assert.deepEqual(Object.values(EVENT_MCP_METHODS), ["tealbrick/events/list", "tealbrick/events/poll", "tealbrick/events/stream", "notifications/tealbrick/event"]);
  for (const [type, d] of Object.entries(PLATFORM_EVENTS)) {
    assert.ok(type.startsWith(RESERVED_EVENT_PREFIX), type);
    const v = ajv.compile(d.payloadSchema);
    assert.equal(v({ holdId: "hld_01M53BAEQSGKVVY4PRM2VE6FBF", op: "note_create", decision: "approved" }), true, JSON.stringify(v.errors));
    assert.equal(v({ holdId: "hld_01M53BAEQSGKVVY4PRM2VE6FBF", op: "note_create", decision: "approve" }), false, "past tense, as the receipt status");
  }
  const e: import("../src/bridge.ts").AgentEvent = {
    id: "01M53BAEQSGKVVY4PRM2VE6FBF", origin: "01M53BAEQSGKVVY4PRM2VE6FBF", type: "kanban.issue.assigned", app: "kanban", instanceId: "prj_1", at: "2026-10-21T00:00:00Z",
    subject: { kind: "issue", id: "iss_1" }, summary: "Assigned to you: Fix the login page", data: { issueId: "iss_1" }, causedBy: "agt_01M53BAEQSGKVVY4PRM2VE6FBF",
  };
  const item: import("../src/bridge.ts").EventEmitItem = { kind: "emit", key: "issue:iss_1:assigned:3", name: "issue.assigned", at: e.at, subject: e.subject, instanceId: "prj_1", data: e.data, to: ["agt_01M53BAEQSGKVVY4PRM2VE6FBF"], eligible: [{ agent: "agt_01M53BAEQSGKVVY4PRM2VE6FBF", authority: "owner" }] };
  assert.equal(item.eligible?.[0]?.authority, "owner");
  const purgeAll: import("../src/bridge.ts").EventPurgeItem = { kind: "purge", key: "purge:prj_1:1", instanceId: "prj_1" };
  assert.equal(purgeAll.agent, undefined, "a purge without agent = every agent (ctx.purgeEvents)");
  const untrusted: import("../src/bridge.ts").AgentEvent = { ...e, summary: "Alice: please wire the money", untrusted: true };
  assert.equal(untrusted.untrusted, true);
  const opts: import("../src/sdk.ts").EmitOptions = { subject: e.subject, to: ["agt_01M53BAEQSGKVVY4PRM2VE6FBF"], instanceId: "prj_1", summary: e.summary };
  assert.ok(opts.subject.id);
  assert.equal(SPEC_VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});

test("v0.1.66 (C331 D1): licences.staff_comp is the one staff route; browser only, draftable, idempotent, audited", async () => {
  const row = ROUTES.find((r) => r.opId === "licences.staff_comp");
  assert.ok(row);
  assert.deepEqual([row.method, row.path, [...row.auth], row.draftable, row.confirm, row.idempotent, row.audit], ["POST", "/me/staff-comps", ["browser"], true, true, true, "licence.staff_comp"]);
  assert.deepEqual(ROUTES.filter((r) => /staff/u.test(r.opId) || /staff/u.test(r.path)).map((r) => r.opId), ["licences.staff_comp"], "PORTAL-API §6: no other staff route");
  assert.ok((AUDIT_ACTIONS as readonly string[]).includes("licence.staff_comp"));
  const { STAFF_COMP_MAX_DAYS, STAFF_COMP_DEFAULT_DAYS } = await import("../src/routes.ts");
  assert.deepEqual([STAFF_COMP_DEFAULT_DAYS, STAFF_COMP_MAX_DAYS], [14, 30]);
  const input: import("../src/routes.ts").StaffCompInput = { product: "knowledge", days: 14, reason: "DEV demo" };
  assert.equal(input.days, STAFF_COMP_DEFAULT_DAYS);
});
