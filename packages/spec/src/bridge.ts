// opt2 bridge wire types — types + data only (no runtime code). Normative twin of specs/BRIDGE.md,
// specs/workspace-config.schema.json and specs/instance-slice.schema.json (the schemas win on conflict).
// v0.1, Lead · Specs, 2026-10-11. Credential claims and the config/slice credential section come from ./credentials.ts;
// vocabularies and manifest shapes from ./manifest.ts. Nothing here re-declares them.

import type {
  AgentId,
  AgentRef,
  BridgeId,
  BridgeRef,
  CallId,
  ConfigClaims,
  ConnectionEntry,
  ConnectionId,
  Ed25519PublicJwk,
  InstanceId,
  InstanceKeyEntry,
  InstanceRef,
  Kid,
  PauseState,
  PortalKeyEntry,
  RevokedSet,
  Sha256Digest,
  SliceClaims,
  StandaloneState,
  Ulid,
  WorkflowId,
  WorkspaceId,
} from "./credentials.ts";
import type {
  AgentMode,
  CrudAction,
  DynamicCatalogEntry,
  Effect,
  HoldFamily,
  HookHoldFamily,
  HookMatch,
  HookPhase,
  JsonSchemaObject,
  KeySource,
  ProductId,
  SemVer,
  SnakeId,
} from "./manifest.ts";
import type { DataPolicy, ModelRole, PolicyBasis } from "./models.ts";

// ── Common ───────────────────────────────────────────────────────────────────
/** Compact JWS string (`header.payload.signature`). */
export type CompactJws = string;
/** Epoch seconds. */
export type EpochS = number;
/** ISO 8601 UTC timestamp. */
export type IsoTime = string;
/** Private-network origin of an app instance or the bridge internal listener, no path (e.g. `http://svc.internal:8080`). */
export type InternalUrl = string;
/** Runtime service id from manifest `runtime.services[].id`. */
export type ServiceId = string;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

/** The two bridge forms (BRIDGE §2). `relay` never enrols and speaks stdio only (CORE I5). */
export type BridgeForm = "deployed" | "relay";
/** Where an enrolled (full) bridge runs; matches `types/routes.ts` BridgeEnrolInput.form. */
export type EnrolForm = "deployed" | "own_infra";

// ── Error envelope (CORE §8) and bridge refuse codes (BRIDGE §8.4) ───────────
export type BridgeErrorCode =
  | "unauthenticated"
  | "paused"
  | "unknown_tool"
  | "no_grant"
  | "grant_invalid"
  | "grant_expired"
  | "grant_revoked"
  /** v0.1.11 (C70): companion grant minted under an older slice/config revision than the one the bridge holds; the SDK re-reads its slice and retries once */
  | "grant_stale"
  | "crud_exceeds_grant"
  | "audience_not_agent"
  | "scope_type_unknown"
  | "not_in_workflow"
  | "input_invalid"
  | "dynamic_resolve_failed"
  | "dynamic_ceiling_exceeded"
  | "hook_denied"
  | "hook_failed"
  | "hook_reentry"
  | "call_depth_exceeded"
  | "config_expired"
  | "app_unavailable"
  | "app_timeout"
  | "app_error"
  | "after_failed"
  | "payload_too_large"
  | "rate_limited"
  | "sdk_major_unsupported"
  | "code_invalid"
  /** v0.1.5 (C50): companion service claimed before its app; 503 + Retry-After, code not consumed */
  | "app_not_claimed"
  | "manifest_mismatch"
  | "key_not_declared"
  | "key_not_set"
  /** malformed percent-encoding in a key or role path, after authentication (BRIDGE §9.4 / §15.4, QA-SPEC49-31) */
  | "bad_request"
  /** v0.1.63 (C330(4), BRIDGE §15.4): model-role resolve refusals */
  | "role_not_declared"
  | "role_not_set"
  | "role_policy_too_low"
  | "tool_name_too_long"
  /** v0.1.11 (BSD-07): an app / neighbour `internalUrl` outside the private-network forms (BRIDGE §5.7); the app is not routed */
  | "internal_url_refused"
  /** v0.1.57 (C274c/C274d): per-item refusals of `POST /tb/v1/events` (EventIngestResult) and the events methods (BRIDGE §14) */
  | EventRefuseCode
  /** v0.1.82 (C373, P1; BRIDGE §8.6): per-workflow companion grants. 403: the grant's `wfl` ≠ `CallEnvelope.workflow` (also when
   *  the envelope names none) */
  | "workflow_mismatch"
  /** 403: the envelope names a workflow but the presented grant has no `wfl` (a base grant is never used for a workflow call) */
  | "workflow_grant_required"
  /** 403 at the bridge (withdrawal record, `wflEpoch`, or no enabled companion edge); 410 from Core on `workflow_grant_get` */
  | "workflow_grant_withdrawn"
  /** 404 from Core: no applied workflow grant for (caller, workflow[, target]) */
  | "workflow_grant_missing"
  /** 409: the gate is off for this target (bridge cap, caller SDK, target SDK; standalone); `details.product` names it */
  | "workflow_grants_unsupported"
  /** 409 from Core: the caller has WORKFLOW_GRANTS_MAX requested + applied records */
  | "workflow_grants_full"
  /** 503: a workflow-grant relay got no answer from Core (Portal unreachable, or no answer within the json transport timeout) */
  | "portal_unavailable";

/** One envelope everywhere. App-side codes (e.g. `scope_denied`, `idempotency_conflict`) pass through, hence `string`. */
export interface ErrorEnvelope<C extends string = BridgeErrorCode | (string & {})> {
  /** `details` is the CORE §8 optional member (v0.1.77: typed here). `details.pointer` = a JSON pointer (RFC 6901) into the
   *  request for `input_invalid` refusals that name a place, e.g. `/context/evolution.step` (BRIDGE §8.5, C367). */
  error: { code: C; message: string; requestId: string; details?: Record<string, unknown> };
}

// ── Workspace config payload (`tb-config+jws`) — workspace-config.schema.json ─
export interface WorkspaceConfig extends Omit<ConfigClaims, "iss">, ConfigCredentialFields {
  /** `tb:portal`, or the bridge itself after standalone (§11). */
  iss: ConfigClaims["iss"] | BridgeRef;
  workspace: { id: WorkspaceId; name: string };
  bridge: { id: BridgeId; publicUrl: string };
  apps: AppEntry[];
  agents: AgentEntry[];
  hooks: HookEntry[];
  skills: SkillsBundle;
  keyRequirements: KeyRequirementEntry[];
  /** v0.1.63 (C330(4)): manifest `settings.modelRoles[]` per instance, `when` resolved by Core. Absent (older Core, or a bridge
   *  without cap `model_roles`, to which Core never sends it) = none. */
  modelRoleRequirements?: ModelRoleRequirementEntry[];
  enrolCodes: EnrolCodeEntry[];
}
/** CREDENTIALS §5.1 credential section as it appears in the config body. */
export interface ConfigCredentialFields {
  portalKeys: PortalKeyEntry[];
  pause: PauseState;
  revoked: RevokedSet;
  connections: ConnectionEntry[];
  instanceKeys: InstanceKeyEntry[];
  /** agent→app grants (K10 compact JWS) */
  grants: CompactJws[];
  standalone?: StandaloneState;
  /** v0.1.82 (C373, P1; CREDENTIALS §5.1, BRIDGE §8.6): withdrawn per-workflow grants (config only, never in a slice). Core sends
   *  it only to a bridge that declares `app_workflow_grants` (an older bridge's schema refuses the field). Absent = none. */
  workflowGrantsWithdrawn?: WorkflowGrantWithdrawal[];
  /** v0.1.82: per caller instance ref (`tb:ins:<id>`): every wfl grant of that caller with `iat ≤` this value is withdrawn
   *  (the overflow path when one instance has more than WORKFLOW_WITHDRAWN_MAX live records). Same gate. Absent = none. */
  wflEpoch?: Record<InstanceRef, EpochS>;
}
/** v0.1.82 (C373, P1): one withdrawal record. The bridge refuses a presented grant with `wfl` when `sub` and `wfl` equal the
 *  grant's, `aud` is absent or equals the grant's, and grant `iat ≤ at` (`workflow_grant_withdrawn`). Core keeps a record until
 *  `at + WORKFLOW_GRANT_TTL_SEC + LEEWAY_S` (every grant it covers has expired by then) and never mints a covered grant. */
export interface WorkflowGrantWithdrawal {
  sub: InstanceRef;
  wfl: WorkflowId;
  /** absent = every target of that workflow */
  aud?: InstanceRef;
  at: EpochS;
}
export interface AppEntry {
  ins: InstanceId;
  product: ProductId;
  version: SemVer;
  sdkMajor: number;
  manifestDigest: Sha256Digest;
  /** v0.1.51 (G2b, INC-20261019-04): present ONLY while a health-gated update attempt (E3) runs: the TARGET release's manifest
   *  digest and version (both or neither). `manifestDigest` stays the SERVING (old) release. Contract: the bridge releases that implement it (0.1.x line: 0.1.33; 0.2.x line: 0.2.4 — 0.1.32 and 0.2.0–0.2.3 do NOT) accept a running service whose manifest digest equals EITHER value, in every place that compares digests: building the routing table (boot, new config; the previous-manifest cache is looked up by both digests), the retry of a down app (the retry key includes the candidate), and the claim (`ClaimRequest.manifestDigest` may equal either; the claim is recorded as usual). The bridge then uses the manifest the service actually serves, never reports `manifest_mismatch` for the candidate, and reports the digest and version that RUN in `StatusReport.apps[]`; that is how Core's gate sees the target become healthy. A digest equal to neither still refuses `manifest_mismatch`.
   *  Older bridges ignore the fields (the config body is not schema-validated by the bridge). Core drops both at the end of
   *  the attempt (switch, rollback or freeze). */
  candidateManifestDigest?: Sha256Digest;
  candidateVersion?: SemVer;
  /**
   * v0.1.11 (BSD-07): `http://<name>.railway.internal:<port>`, or — only with `ownInfra: true` — any http(s) origin,
   * which the bridge routes to ONLY when it is listed in its local `TB_OWN_INFRA_ORIGINS` (BRIDGE §5.7).
   */
  internalUrl: InternalUrl;
  /** v0.1.11 (BSD-07): the instance runs on the owner's own infrastructure (neighbour, BRIDGE §10.2). Absent = false. */
  ownInfra?: boolean;
  /** Informational (status/display). Enforcement is absent grants/hooks/tickets; the bridge never decides on it. */
  entitled: boolean;
  /** Portal-signed instance slice (`tb-slice+jws`) relayed to the app. */
  slice: CompactJws;
}
export interface AgentEntry {
  agt: AgentId;
  name: string;
  mode: AgentMode;
  /** v0.1.63 (C320, C312a): the card's persona (markdown, ≤ PERSONA_MAX_CHARS UTF-16 units); absent = none. Sent only to a
   *  bridge with cap `model_roles` (an older bridge's config schema refuses unknown agent fields). BRIDGE §15.6. */
  persona?: string;
}
export interface HookEntry {
  /** `<product>.<hookId>` */
  id: `${ProductId}.${SnakeId}`;
  ins: InstanceId;
  product: ProductId;
  hookId: SnakeId;
  phase: HookPhase;
  order: number;
  /** 100..2000 */
  timeoutMs: number;
  match: HookMatch;
  /** v0.1.24 (C117): the owner switch. Core lists EVERY declared hook of every deployed app (whatever its run state or
   *  licence); `false` = the owner switched it off → the bridge skips it. Absent (older Core) = true. */
  enabled?: boolean;
}
export interface SkillsBundle {
  digest: Sha256Digest;
  files: SkillFile[];
}
export interface SkillFile {
  product: ProductId;
  id: string;
  title: string;
  when?: string;
  /** SKILL.md rendered by Core; `{{agent.name}}` / `{{agent.id}}` left for the bridge. */
  content: string;
}
export interface KeyRequirementEntry {
  name: string;
  label: string;
  provider?: string;
  ins: InstanceId;
  product: ProductId;
  required: boolean;
  source: KeySource;
  /** `"app"` or a service id */
  usedBy: ("app" | ServiceId)[];
}
/** v0.1.63: one declared model role of one instance (BRIDGE §15). */
export interface ModelRoleRequirementEntry {
  role: ModelRole;
  ins: InstanceId;
  product: ProductId;
  required: boolean;
  minPolicy: DataPolicy;
  /** `"app"` or a service id */
  usedBy: ("app" | ServiceId)[];
}
export type EnrolCodeEntry =
  | { digest: Sha256Digest; kind: "instance" | "neighbour"; ins: InstanceId; product: ProductId; exp: EpochS }
  | { digest: Sha256Digest; kind: "service"; ins: InstanceId; service: ServiceId; product?: ProductId; exp: EpochS };

/** v0.1.14 (C102) entry of slice `companionCallers`: an app instance that holds a companion grant to this instance.
 *  v0.1.48 (SDK-COMPANION-CALLERS, C240): `provider` = where that instance runs ("railway", "own_infra", another provider
 *  key; null = unknown, Cores before the field). Display + binding data only; never grant material. */
export interface CompanionCaller {
  product: ProductId;
  ins: InstanceId;
  name: string;
  provider?: string | null;
}

// ── Instance slice payload (`tb-slice+jws`) — instance-slice.schema.json ────
export interface InstanceSlice extends SliceClaims {
  ins: InstanceId;
  product: ProductId;
  portalKeys: PortalKeyEntry[];
  /** keys the app accepts for call proofs; v0.1.10 (C64) `publicUrl` = bridge public origin (OpContext.publicUrl) */
  bridge: {
    id: BridgeId;
    keys: Ed25519PublicJwk[];
    publicUrl?: string;
    /** v0.1.43 (LA-1): tb-views origin or null */
    viewUrl?: string | null;
    /** v0.1.54 (C292): what the workspace bridge declared it implements (BRIDGE_CAPS), copied by Core from the bridge's last
     *  authenticated StatusReport (normalised: SDK-API v0.1.54); absent or [] = none. Apps decide by capability, never by bridge
     *  version. Advisory: it MUST NOT widen access (display and feature switches only; the SDK authorizes every call). */
    caps?: string[];
  };
  pause: PauseState;
  revoked: RevokedSet;
  personNbf: EpochS;
  /** companion grants this app presents as `TB-Grant` (K10 compact JWS) */
  grants: CompactJws[];
  /** v0.1.18 (C106a): `scopeRequest` = the channel the owner chose at adopt for an edge with scopeType "channel" (Connect tethers it) */
  /** QA-SPEC49-26: `edge: false` only in a needsAgentDirectory slice, on an agent without an edge to this app (absent = edge). */
  agents: { id: AgentId; name: string; mode: AgentMode; status: "active" | "paused"; edge?: false; scopeRequest?: ScopeRequest }[];
  standalone?: StandaloneState;
  /** v0.1.13 (C86): the Portal GUI origin (`https://…`, no path); apps build owner links (`/w/<ws>/open?product=&path=`) */
  portalUrl?: string;
  /** v0.1.14 (C90): ONLY the targets this app currently holds a companion grant for (one entry per grant); a wildcard
   *  companion (tb.holds_pending) learns the workspace's apps from it; a consent revoke removes them. SDK: `ctx.companionTargets()`. */
  companionTargets?: { product: ProductId; ins: InstanceId }[];
  /** v0.1.14 (C102): the instances holding companion grants that TARGET this instance (Core minted them); `name` = the
   *  caller's manifest name (≤ 80). The SDK sets `Caller.name` for app callers from it (verified grant `sub`), fallback the instance id. */
  companionCallers?: CompanionCaller[];
  /** v0.1.15 (C105a): the workspace apps policy (Core-filled; default DEFAULT_HELD_FAMILIES). Informational for the app
   *  (e.g. to say "this send waits for the owner"); enforcement is the companion grant `held` claim = this list (CORE I8). */
  appsPolicy?: { held: HoldFamily[] };
  /** v0.1.49 (C261 = C243): `"verified"` = Core mints the grant `prd` claim for every companion grant to this instance, so
   *  the SDK REFUSES an app call (or a resumed held app call) whose caller has no verified product (no `prd` and no
   *  `companionCallers` entry): 403 `caller_unverified`, nothing runs, audited. Absent = the earlier lenient rule. */
  appCallers?: "verified";
}

// ── Enrolment (BRIDGE §4) — op `bridge_api.enrol` ───────────────────────────
export interface EnrolRequest {
  /** K6 `tbe_…` from `TB_ENROL_CODE` */
  code: string;
  publicKey: Ed25519PublicJwk;
  version: SemVer;
  /** SDK majors this bridge serves (current + one before) */
  sdkMajors: number[];
  form: EnrolForm;
  publicOrigin: string;
}
export interface EnrolResponse {
  bridgeId: BridgeId;
  workspaceId: WorkspaceId;
  /** bootstrap trust set (CORE §4). v0.1.11: informational when `portalKeySet` is present (CREDENTIALS §9.5). */
  portalKeys: PortalKeyEntry[];
  /** v0.1.11 (C62/C63): current root-signed key-set statement; the bridge verifies it against its build-pinned roots and refuses enrolment if it fails. */
  portalKeySet?: CompactJws;
  configPath: string;
  ackPath: string;
  waitMaxS: number;
}

// ── Config pull (BRIDGE §5.1) — op `bridge_api.config` ──────────────────────
export interface ConfigPullQuery {
  /** `rev` of the last good config */
  after: number;
  /** ≤ 60 */
  wait: number;
}
/** 200: the config JWS itself (`application/jose`); 304: unchanged after `wait`. */
export type ConfigPullResponse = { status: 200; body: CompactJws } | { status: 304 };

// ── Status report = ack (BRIDGE §5.6) — op `bridge_api.ack` ─────────────────
export type AppState = "ok" | "degraded" | "down" | "needs_keys" | "unclaimed" | "paused";
/** v0.1.54 (C292): capabilities a bridge can declare (StatusReport.bridge.caps → slice.bridge.caps → ctx.bridgeCaps).
 *  v0.1.57 (C274c/C274d): + `events` = the bridge implements BRIDGE §14 in full (ingest, per-agent log, delivery on /mcp).
 *  A bridge declares it only together with `owner_rows` (scoped events use the owner-row rule). */
/** v0.1.63 (C330(4), QA-SPEC42-1): + `model_roles` = the bridge implements BRIDGE §15 in full (S11 bindings, Keys and models
 *  page, `GET /tb/v1/model-roles/<role>`, `StatusReport.roles`, persona in instructions + resource). Core sends
 *  `agents[].persona` and `modelRoleRequirements[]` only to a bridge that declares it.
 *  v0.1.64 (C326): + `person_ops` = the bridge runs the person-op relay (BRIDGE §16); Core queues relay requests only for it. */
/** v0.1.74 (C354a, QA-SPEC56-1): + `hold_families` = the bridge reads `DynamicResolution.holdFamilies` (held when any member is
 *  held), passes it in `HookCallInfo.target.holdFamilies`, and refuses a variant resolution broader than its base
 *  (`variantNarrowerOrEqual`, `dynamic_resolve_failed`). */
/** v0.1.77 (C367, P3): + `app_hold_status` = the bridge routes the standard op `tb.hold_status` on the companion path when the
 *  presented companion grant's `wf` lists it (BRIDGE §8.3; the I4 CRUD skip applies). The target app answers an app caller only for
 *  holds that caller raised (SDK-API §4.7). Without the cap nothing changes.
 *  v0.1.77 (C367, P4): + `app_call_context` = the bridge accepts `CallEnvelope.context` on the companion path, validates it
 *  (BRIDGE §8.5; `CALLER_CONTEXT_*`), and puts the keys into the op body `context` before the before-hook chain. Without the cap
 *  the SDK never sends `context` (it refuses locally, SDK-API §18.6). */
/** v0.1.82 (C373, P1): + `app_workflow_grants` = the bridge implements BRIDGE §8.6 in full: the three workflow-grant relays,
 *  `CallEnvelope.workflow`, the wfl gate rules, `workflowGrantsWithdrawn` / `wflEpoch` in its config, `call.caller.workflow`
 *  for hooks. Core mints wfl grants and sends those config fields only to a bridge that declares it; the SDK refuses
 *  `callApp(..., {workflow})` and `ctx.workflowGrants.*` locally without it (`bridge_cap_missing`). */
export const BRIDGE_CAPS = ["owner_rows", "events", "model_roles", "person_ops", "hook_tool", "secret_output", "hold_families", "app_hold_status", "app_call_context", "app_workflow_grants"] as const;
/** Spec follow-up (QA-SPEC49-11, C349): the largest signed config (compact JWS, bytes) Core emits for an owner change. A change
 *  that would pass it is refused (`validation_failed`, details.reason `config_too_large`); kill-path changes (pause, resume,
 *  revoke, grant or connection removal) are never refused and only shrink or keep the size. Headroom to the bridge's 4 MB
 *  limit (BRIDGE §1.2 S2) keeps pause and revoke deliverable. */
export const CONFIG_CORE_MAX_BYTES = 3_000_000;
/** Spec follow-up (QA-SPEC49-13): pairing codes (K2b) of a workspace that are live OR cancelled-but-unexpired (their jti sits
 *  in `revoked.jtis` until `exp`). Core refuses a new code at this count, so cancellations cannot grow the config past the
 *  kill-path budget. */
export const PAIRING_CODES_OPEN_MAX = 100;
/** The bridge's / signer's hard limit for a signed config (compact JWS bytes, BRIDGE §1.2 S2: 4 MiB). */
export const CONFIG_SIGNER_MAX_BYTES = 4 * 1024 * 1024;
/** Instances in a workspace (schema `pause.instances` maxItems): the number of slices a config can carry. */
export const WORKSPACE_INSTANCES_MAX = 64;
/** QA-SPEC57 S3: the largest EXTERNAL automatic growth of one slice (key rotations, origins, caps, app callers, standalone,
 *  bridge issuer, rev), measured at the schema maxima by test/slice-reserve.test.ts (11,343 today) plus headroom; that test
 *  fails if the measured growth ever passes this. */
export const SLICE_AUTO_GROWTH_CHARS = 11_500;
/** Spec follow-up (QA-SPEC49-15, C349; derived per QA-SPEC57 S3): before it signs an owner change, Core also builds the
 *  WORST-CASE kill-path config of the result (PORTAL-API "Config size") and refuses the change when that JWS is larger than
 *  this. Derived, never hand-set: the signer limit minus one automatic growth event for every slice AND for the config's
 *  own external fields (WORKSPACE_INSTANCES_MAX + 1), each base64-encoded once more inside the config JWS (× 4/3), rounded
 *  down to a thousand. So one key rotation at the worst case still signs. */
export const CONFIG_KILLPATH_MAX_BYTES =
  Math.floor((CONFIG_SIGNER_MAX_BYTES - (WORKSPACE_INSTANCES_MAX + 1) * Math.ceil((SLICE_AUTO_GROWTH_CHARS * 4) / 3)) / 1000) * 1000;
/** C353 (QA-SPEC49-18): the per-slice limit (schema `compactJws` maxLength). Core's worst-case kill-path check (above) also
 *  requires EVERY re-minted slice to stay at or under it; slices add no bytes on pause (`agents[].status`), so the check is
 *  about the slice's normal content (edge-agent directory, companion grants). */
export const SLICE_JWS_MAX_CHARS = 65_536;
/** QA-SPEC49-22, C356 / QA-SPEC49-27: owner changes keep every worst-case slice at or under this, so the automatic,
 *  never-refused growth always fits under SLICE_JWS_MAX_CHARS even at the schema maxima: Portal key set (`portalKeys` ≤ 8,
 *  `portalKeySet` ≤ 4,096), bridge key rotation (`bridge.keys` ≤ 4), the origins `bridge.publicUrl` / `bridge.viewUrl` /
 *  `portalUrl` (≤ 267 each, no path), `bridge.caps` ≤ 16, `appCallers`. QA-SPEC49-30: `prd` on every companion grant and
 *  `provider` on every caller are known to Core and part of its worst case, and so are every caller `name` at its schema
 *  maximum (QA-SPEC55-1) and the companion `revoked.jtis` of every live grant (QA-SPEC55-5) — not of this reserve. Measured
 *  external growth (smallest valid mint → schema maxima incl. `standalone`, bridge issuer, largest `rev`): 11,343 chars
 *  (test/slice-reserve.test.ts) → margin 2,193 under 65,536. Pause/revoke stay deliverable. */
export const SLICE_CORE_MAX_CHARS = 52_000;
export type BridgeCap = (typeof BRIDGE_CAPS)[number];
/** v0.1.82 (C373, P1): the cap name of per-workflow companion grants (one of BRIDGE_CAPS). */
export const WORKFLOW_GRANTS_CAP = "app_workflow_grants" as const satisfies BridgeCap;
/** v0.1.82 (C373, P1): live withdrawal records per caller instance that Core keeps in the config. Core's worst-case config
 *  measure counts this many records (largest `wfl`, with `aud`) plus one `wflEpoch` entry for EVERY instance, so a withdrawal
 *  never needs the size rule. A further withdrawal for that instance inside the window becomes a `wflEpoch` bump instead
 *  (kill path; still-applied grants re-mint at once). */
export const WORKFLOW_WITHDRAWN_MAX = 64;
export interface StatusReport {
  rev: number;
  appliedAt: IsoTime;
  bridge: {
    id: BridgeId;
    version: SemVer;
    form: EnrolForm;
    /** random id per process start; two alternating values → `bridge_duplicate` */
    boot: string;
    sdkMajors: number[];
    mcpVersions: string[];
    /** v0.1.54 (C292): the capabilities this bridge implements (BRIDGE_CAPS). "owner_rows" = the C283 A1 owner-row filter
     *  (catalog `admitted`, scope_summary `admittedOps`, gate skips op.crud ⊆ grant.crud for scoped ops). Absent = none.
     *  v0.1.57: "events" = app events (BRIDGE §14). */
    caps?: BridgeCap[];
  };
  portalReachable: boolean;
  /** v0.1.14: connections that authenticated (agent assertion / pairing session) since the previous report, latest time each, ≤ 500 */
  connectionsSeen?: { con: ConnectionId; lastSeen: IsoTime }[];
  /** v0.1.11: JCS digest() of the `portalKeys` array the bridge trusts after applying `rev`; Core compares it with what it signed (BSD-08 alert) */
  portalKeysDigest?: Sha256Digest;
  /** v0.1.43 (LA-1, C232, L3): the workspace views service as the bridge last probed it on the private network (`/readyz`);
   *  omitted when the workspace has none */
  views?: { url: string; ok: boolean; lastCheckAt: IsoTime };
  apps: {
    ins: InstanceId;
    state: AppState;
    version: SemVer | null;
    sdkVersion: SemVer | null;
    manifestDigest: Sha256Digest | null;
    lastSeen: IsoTime | null;
    /** holds waiting for the owner, count only (from AppStatus) → canvas badge */
    pendingHolds: number;
    /** v0.1.11: AppStatus.sliceRevision the app last reported (omitted before its first report); Core uses it for key transition tracking (BSD-15) */
    sliceRevision?: number;
    /** v0.1.28 (F89): AppStatus.attention as the app last reported it (omitted when absent); Core shows it on the app card */
    attention?: AppAttention;
    /** v0.1.39 (C213 US-2): AppStatus.schemaVersion / minCompatibleCode / failure copied unchanged (omitted when absent, L24);
     *  Core's health-gated update and rollback read them (UPGRADE-SAFETY M4/M5) */
    schemaVersion?: SchemaVersion;
    minCompatibleCode?: SemVer | null;
    failure?: BootFailure;
    /** v0.1.40 (C219, bridge 0.1.31): AppStatus.preUpdateSnapshot with exactly the five ref members (`file` safe name, `sha256`,
     *  `createdAt`, `from`, `to`); extra members of the app's ref are dropped, a malformed ref is omitted, `null` stays `null`
     *  (BRIDGE §10.3). Core shows it on the update record next to `lastUpdate.dataRestoredTo`. */
    preUpdateSnapshot?: PreUpdateSnapshotRef | null;
  }[];
  /** presence booleans only — never values */
  keys: { name: string; ins: InstanceId; set: boolean }[];
  /** v0.1.63 (BRIDGE §15.5): one row per declared role per instance — labels only, never a base URL, key name or key value.
   *  `set` = a binding resolves for it; `policyOk` = that binding meets the declared `minPolicy`. Absent (older bridge) = unknown. */
  roles?: ModelRoleStatus[];
  /** display-only, ≤ 80 chars, no third-party identifiers. v0.1.65 (C331 D8): `sources` = the app's ScopeSummaryResult.sources,
   *  forwarded as given (≤ SCOPE_SOURCES_MAX, each label ≤ SCOPE_SOURCE_LABEL_MAX; a malformed item is dropped, never repaired);
   *  absent when the app's SDK does not report them. */
  scopeSummaries: { agt: AgentId; ins: InstanceId; label: string; sources?: ScopeSourceItem[] }[];
  connectionsCreated: { con: ConnectionId; agt: AgentId; method: "pairing"; clientName: string; createdAt: IsoTime; pairingJti: Ulid }[];
  connectionsRevoked: { con: ConnectionId; reason: "refresh_reuse" | "client_revoke" }[];
  claims: ClaimRecord[];
  /** v0.1.24 (C116): kind `config` + code `standalone_without_grants` = the final standalone document carries no agent grants (applied, fail closed).
   *  v0.1.25 (C117): kind `config` + code `hook_not_listed` (+ `ins` of the hook app) = a matching declared hook missing from config.hooks (call refused).
   *  v0.1.14 (L3): `bridge_op` = a failed catalog / resolve / mark / scope_summary call to an app (code = the app's refusal or transport error).
   *  v0.1.17 (L3, C104): `manifest` = an app manifest the bridge refused (code = the refusal, e.g. `manifest_mismatch`, a validator code, `bridge_too_old`)
   *  v0.1.63: kind `config` + code `persona_too_long` = an agent persona over PERSONA_MAX_CHARS, dropped for that agent (BRIDGE §15.6);
   *  spec follow-up #49: code `persona_invalid` = a persona that does not match PERSONA_PATTERN, dropped the same way */
  rejected: {
    kind: "config" | "grant" | "slice" | "assertion" | "ticket" | "pairing" | "claim" | "bridge_op" | "manifest";
    code: BridgeErrorCode | string;
    count: number;
    /** v0.1.22: the app instance concerned (kind `manifest`, and `bridge_op` when known) */
    ins?: InstanceId;
  }[];
  /** v0.1.14 (L3): `catalog_failed` = a dynamic `list` op whose catalog bridge op failed, so its entries are missing */
  toolsOmitted: { ins: InstanceId; name: string; code: "tool_name_too_long" | "name_collision" | "ceiling" | "catalog_failed" | "catalog_name_invalid" }[];
}
export interface ClaimRecord {
  kind: EnrolCodeEntry["kind"];
  ins: InstanceId;
  service?: ServiceId;
  publicKey: Ed25519PublicJwk;
  manifestDigest: Sha256Digest;
  version: SemVer;
  internalUrl?: InternalUrl;
  /** digest only; the code itself never travels to Portal */
  codeDigest: Sha256Digest;
  claimedAt: IsoTime;
}

// ── Bridge → app call (CORE §8, BRIDGE §8.1) ────────────────────────────────
/** Body of `POST <internalUrl>/tb/v1/ops/<op>` (headers: `Authorization: Bearer <grant>`, `TB-Call`). */
export interface OpCallBody<I = JsonValue> {
  input: I;
  /** open JSON; keys `<product>.<key>` added by context hooks */
  context: JsonObject;
  /** from MCP `_meta["tealbrick/idempotencyKey"]` (CORE §8) or `CallEnvelope.idempotencyKey` */
  idempotencyKey?: string;
}
export type OpResult<O = JsonValue> =
  | { status: "ok"; output: O; receiptId?: string }
  | { status: "held"; holdId: string; expiresAt: IsoTime };

// ── Hooks (CORE §8, BRIDGE §8.2) — `POST <internalUrl>/tb/v1/hooks/<hookId>` ─
export interface HookCallInfo {
  id: CallId;
  ws: WorkspaceId;
  /** v0.1.45 (HOOK-CALLER-PRODUCT): `product` = app callers only, the calling instance's product from the bridge's signed
   *  config (never from input or a manifest name); a policy app matches "calls from product X" on it, since an instance id
   *  changes on reinstall. Absent for agents, and for a caller the bridge cannot map (then treat it as unverified). */
  caller: { type: "agent" | "app"; id: AgentId | InstanceId; mode?: AgentMode; product?: ProductId; /** v0.1.82 (C373 P1, cap `app_workflow_grants`): the VERIFIED `wfl` of the presented grant (app callers with a workflow grant only) */ workflow?: WorkflowId };
  /** v0.1.68 (C336 RQ-2, cap `hook_tool`): `tool` = `DynamicResolution.tool` of a dynamic call (`crud`/`effect`/`holdFamily` are then
   *  the entry's resolution); absent for static ops and dynamic search. Policy apps (Rules) may match on it. */
  target: { instance: InstanceId; product: ProductId; op: SnakeId; tool?: string; crud: CrudAction[]; effect: Effect; holdFamily?: HoldFamily; /** v0.1.74 (cap `hold_families`) */ holdFamilies?: HoldFamily[] };
  input?: JsonValue;
}
export interface HookRequestBase<P extends HookPhase> {
  phase: P;
  call: HookCallInfo;
  context: JsonObject;
}
export type BeforeHookRequest = HookRequestBase<"before">;
export type ContextHookRequest = HookRequestBase<"context">;
export interface AfterHookRequest extends HookRequestBase<"after"> {
  /** the app's ok output (after hooks run only on `ok`) */
  output: JsonValue;
}
export type HookRequest = BeforeHookRequest | ContextHookRequest | AfterHookRequest;
/** v0.1.13 (G1): `{allow: false, hold}` = hold verdict (never with allow true). Bridge precedence over the chain:
 *  any refuse wins at once; else the FIRST hold is kept, later before hooks still run (and may refuse); then forwarded
 *  with the verdict in the call proof (`hv`). The bridge re-runs the chain on the retry after approval (C82). */
export interface BeforeHookResponse { allow: boolean; reason?: string; hold?: HookHoldVerdict }
export interface HookHoldVerdict {
  family: HookHoldFamily;
  /** 1..280 chars, shown to the owner and the agent */
  reason: string;
}
/** every key MUST start with `<hook product>.` */
export interface ContextHookResponse { add: Record<`${ProductId}.${string}`, JsonValue> }
export interface AfterHookResponse {
  output?: JsonValue;
  /** JSON pointers into the output to remove */
  redactions?: string[];
}
export interface HookResponseByPhase {
  before: BeforeHookResponse;
  context: ContextHookResponse;
  after: AfterHookResponse;
}
// ── Bridge-only SDK calls (C16 B5): `POST <internalUrl>/tb/v1/bridge/<bop>` with a `CallProofBridgeOpClaims`
//    proof (types/credentials.ts, verified by `verifyBridgeOpProof`); no grant, no hooks.
export type BridgeOp = "catalog" | "resolve" | "mark" | "scope_summary";
/** v0.1.50 (C283 A1): `agent` = the agent the list/search is for; the SDK then marks entries its owner-set primary rows
 *  admit (`DynamicCatalogEntry.admitted`). Not bound by the bridge-op proof (C91 binds {bop, op}): the answer only shapes
 *  what the bridge DISPLAYS; every call is authorized by the SDK. Bridges before the change omit it (no marks). */
export interface BridgeOpCatalogBody { op: SnakeId; query?: string; limit?: number; agent?: AgentId }
export interface BridgeOpResolveBody { op: SnakeId; tool: string }
export interface BridgeOpMarkBody { call: CallId; mark: "after_failed" }
export type BridgeOpScopeSummaryBody = Record<string, never>;
export interface BridgeOpBodies {
  catalog: BridgeOpCatalogBody;
  resolve: BridgeOpResolveBody;
  mark: BridgeOpMarkBody;
  scope_summary: BridgeOpScopeSummaryBody;
}
/** v0.1.50 (C283 A1): `admittedOps` = this agent's STATIC ops with a scopeType whose crud an owner-set primary row admits
 *  (possibly above grant.crud); the bridge lists those tools too. Display only (the SDK authorizes each call). */
export interface ScopeSummaryResult {
  agent: AgentId;
  label: string;
  admittedOps?: string[];
  /** v0.1.65 (C331 D8): the scope instances this agent is assigned (display only, ≤ SCOPE_SOURCES_MAX). Absent = the SDK does not
   *  report sources; [] = the agent has no assignment. */
  sources?: ScopeSourceItem[];
}
/** v0.1.65 (C331 D8): one scope instance an agent may use, as the app's owner UI names it (a Connect account, a Knowledge area).
 *  `id` = the app's OWN scope instance id (ScopeInstance.id, e.g. Connect `cna_…`), never a provider's id (no Stripe, Slack or
 *  Google id). `label` = the scope instance label (≤ 60) with control characters and every format character (`\p{Cc}`,
 *  `\p{Cf}`: zero-width, bidi marks) removed by the SDK and again by Core; apps never use a third-party identifier (an email
 *  address, a phone number, a handle) as an instance label they create (the owner may type one). `access` = an access level id of
 *  that scope type. Display only: Core shows it on the canvas; the SDK authorizes every call. */
export interface ScopeSourceItem { type: SnakeId; id: string; label: string; access: SnakeId }
export const SCOPE_SOURCES_MAX = 20;
export const SCOPE_SOURCE_LABEL_MAX = 60;

// ── MCP surface (BRIDGE §7) ──────────────────────────────────────────────────
export const TOOL_NAME_RULE = {
  separator: "__",
  pattern: "^[a-z0-9_-]+$",
  maxLength: 64,
  holdStatusOp: "tb_hold_status",
  skillsOp: "tb_skills",
  searchSuffix: "_search",
  callSuffix: "_call",
  idempotencyMetaKey: "tealbrick/idempotencyKey", // gitleaks:allow (MCP _meta key name, not a secret)
  /** v0.1.13 (G4b): runner-set claim, copied UNVERIFIED into context `tb.onBehalfOf` */
  onBehalfOfMetaKey: "tealbrick/onBehalfOf", // gitleaks:allow (MCP _meta key name, not a secret)
  skillUriPrefix: "tealbrick://skills/",
} as const;
/** `<product>__<op>`, `<product>__<op>_search|_call`, `<product>__<dynamic list entry>`, `<product>__tb_hold_status`. */
export type ToolName = `${ProductId}__${string}`;
export type ParsedToolName =
  | { kind: "op"; product: ProductId; op: SnakeId }
  | { kind: "dynamic_entry"; product: ProductId; op: SnakeId; entry: DynamicCatalogEntry["name"] }
  | { kind: "dynamic_search"; product: ProductId; op: SnakeId }
  | { kind: "dynamic_call"; product: ProductId; op: SnakeId }
  | { kind: "hold_status"; product: ProductId }
  /** bridge-answered fallback read tool (C16 S10) */
  | { kind: "skills"; product: ProductId };
export type SkillResourceUri = `tealbrick://skills/${ProductId}/${string}`;
/** `structuredContent` of a held tool result (not an error). */
export interface HeldToolResult {
  status: "held";
  holdId: string;
  expiresAt: IsoTime;
  checkWith: ToolName;
}
export interface HoldStatusToolInput { holdId: string }
export interface SkillsToolInput { skillId?: string }

// ── OAuth AS (BRIDGE §6) ─────────────────────────────────────────────────────
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: [string];
  bearer_methods_supported: ["header"];
}
export interface DcrRequest {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: "none";
  grant_types?: ("authorization_code" | "refresh_token")[];
  response_types?: ["code"];
}
export interface DcrResponse {
  /** bridge-signed, self-contained registration (no client table) */
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: ("authorization_code" | "refresh_token")[];
  response_types: ["code"];
}
export interface TokenResponse {
  /** K5 access (`tb-agent-session+jwt`) */
  access_token: CompactJws;
  token_type: "Bearer";
  expires_in: 900;
  /** `tbr_…`; pairing connections only (key connections re-assert with K4) */
  refresh_token?: string;
}

// ── App events (BRIDGE §14, MANIFEST §16, v0.1.57; C274c/C274d) ──────────────
// Shape-compatible with MCP SEP-3415 (C274b): events/list, events/poll, events/stream, opaque cursor, `truncated`.

/** Platform events (C274d ruling 4): declared HERE, emitted by the SDK for every app, never declared in a manifest
 *  (M-EV-1 refuses `tb.*`). The bridge validates them against this table like a manifest declaration; `visibleWith` names
 *  the standard op whose rule applies (`tb.hold_status`: any valid grant to the app, CORE I4). */
export const PLATFORM_EVENTS = {
  "tb.hold.decided": {
    title: "A held call was decided",
    audience: "target",
    visibleWith: "tb.hold_status",
    subjectKind: "hold",
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      required: ["holdId", "op", "decision"],
      properties: {
        holdId: { type: "string", pattern: "^hld_[0-9A-HJKMNP-TV-Z]{26}$" },
        op: { type: "string", pattern: "^[a-z][a-z0-9_]{1,39}$" },
        decision: { enum: ["approved", "denied", "expired"] },
      },
    },
  },
} as const;
export type PlatformEventType = keyof typeof PLATFORM_EVENTS;
/** Data of `tb.hold.decided`; `to` = the hold's AGENT caller only (app callers receive no events in v1). */
export interface HoldDecidedData { holdId: `hld_${Ulid}`; op: SnakeId; decision: "approved" | "denied" | "expired" }

export type EventRefuseCode =
  /** name not declared by the manifest of the sending release, or a platform type the bridge does not know */
  | "event_undeclared"
  /** an app name in the `tb.` namespace other than a PLATFORM_EVENTS type, or app events from product `tb` */
  | "event_reserved"
  | "event_payload_invalid"
  | "event_too_large"
  /** scoped event without `instanceId`, unscoped event with one, or `eligible` on an unscoped event */
  | "event_instance_invalid"
  /** `to` missing / empty / > 100 for audience `target`, or present for `granted` */
  | "event_target_invalid"
  /** `tealbrick/events/poll|stream` with a cursor that is not one this bridge issued */
  | "cursor_invalid";

/** What the event is about (routing key for the agent runtime). */
export interface EventSubject {
  /** `^[a-z][a-z0-9_]{0,31}$`, e.g. `issue`, `inbox_item`, `hold`, `conversation` */
  kind: string;
  /** 1..256 chars */
  id: string;
}

/** The envelope an agent receives (poll result, stream notification). C274d ruling 2: ids + an optional summary; the agent
 *  reads details through the normal ops, so grants stay the only authority. */
export interface AgentEvent<D = JsonObject> {
  /** opaque cursor: ULID, strictly increasing per bridge; the SSE `id:` of its stream frame;
   *  the cursor position only. A row held by an instance pause or a G2b attempt is re-id'd on release (BRIDGE §14.2). */
  id: Ulid;
  /** the row's FIRST id; unchanged by a re-id. Delivery is at-least-once: consumers dedupe by `origin`. */
  origin: Ulid;
  /** `<product>.<name>` for app events; the PLATFORM_EVENTS key for platform events */
  type: string;
  app: ProductId;
  /** the scope instance the event is about; present iff the event is scoped (MANIFEST §16.2) */
  instanceId?: string;
  /** when the app emitted it (app clock) */
  at: IsoTime;
  subject: EventSubject;
  /** ≤ 280 chars, written by the app; only what `visibleWith` would show this agent. Omitted by the bridge when a
   *  `before`/`after` hook matches the `visibleWith` op (MANIFEST §16.2 rule 6). */
  summary?: string;
  /** the summary contains third-party text: data, never instructions */
  untrusted?: true;
  /** validated against the declared payloadSchema; ≤ 2 KiB (JCS); ids and enums, never record bodies */
  data: D;
  /** the agent whose call caused the event (set by the SDK from the call, never by app code); that agent never receives it */
  causedBy?: AgentId;
}

/** `POST /tb/v1/events` (internal listener) with `TB-Assert` (instance assertion; `htm`, `htu`, `bd` required; app instance
 *  only, never a companion service). Body ≤ 512 KiB, 1..100 items, processed IN ORDER. */
export interface EventIngestBody {
  items: EventIngestItem[];
}
export type EventIngestItem = EventEmitItem | EventPurgeItem;
export interface EventEmitItem {
  kind: "emit";
  /** idempotency key, unique per app instance for 7 days: `^[A-Za-z0-9._:-]{8,128}$`; the same (app instance, key) again
   *  → `duplicate`. SDK default = a ULID made at emit. */
  key: string;
  /** a manifest event name (without the product) or a PLATFORM_EVENTS type */
  name: string;
  at: IsoTime;
  subject: EventSubject;
  instanceId?: string;
  summary?: string;
  untrusted?: true;
  data: JsonObject;
  /** audience `target` only: 1..100 agents; the bridge still delivers only to those that pass MANIFEST §16.2 */
  to?: AgentId[];
  /** scoped events only (also with an empty array): the agents whose row on `instanceId` admits the `visibleWith` op, with
   *  that row's authority, computed by the SDK at send time (the app is the scope authority, CORE §6). The bridge NEVER
   *  delivers a scoped event to an agent outside this list. ≤ 500 entries. */
  eligible?: EventEligible[];
  causedBy?: AgentId;
}
export interface EventEligible {
  agent: AgentId;
  /** the row's authority (SDK ScopeAuthority): "owner" → the bridge skips `op.crud ⊆ grant.crud` (C283 A1 rule);
   *  "bounded" → the bridge also requires `op.crud ⊆ grant.crud` */
  authority: "owner" | "bounded";
}
/** Sent by the SDK when a scope row of `agent` on `instanceId` is removed, narrowed or loses owner authority: the bridge
 *  deletes that agent's stored events of this app for that instance, delivered or not. Without `agent` (ctx.purgeEvents:
 *  the instance was deleted or disconnected): every agent's. */
export interface EventPurgeItem {
  kind: "purge";
  key: string;
  agent?: AgentId;
  instanceId: string;
}
/** 200 answer: one result per item, same order. `stored` = written for `recipients` agents (0 is a valid answer);
 *  `refused` = permanent (the SDK drops the row and logs it); transport errors, 429 and 5xx = retry the whole batch. */
export interface EventIngestResult {
  results: { key: string; status: "stored" | "duplicate" | "refused"; code?: EventRefuseCode; recipients?: number }[];
}

/** JSON-RPC methods and the notification on the agent's EXISTING `/mcp` session (C274d ruling 1). */
export const EVENT_MCP_METHODS = {
  list: "tealbrick/events/list",
  poll: "tealbrick/events/poll",
  stream: "tealbrick/events/stream",
  notification: "notifications/tealbrick/event",
} as const;
/** `tealbrick/events/list` (no params): the event types this agent can receive now (BRIDGE §14.3; scoped types without the
 *  per-instance part). */
export interface EventsListResult {
  types: { type: string; app: ProductId; title: string; payloadSchema: JsonSchemaObject; scoped: boolean; delivery: ("poll" | "stream")[] }[];
}
/** `tealbrick/events/poll`: events with id > cursor (absent = from the oldest kept), ≤ limit (1..100, default 50). */
export interface EventsPollParams {
  cursor?: string;
  limit?: number;
}
export interface EventsPollResult {
  events: AgentEvent[];
  /** id of the last event returned; else the given cursor; null when neither exists */
  cursor: string | null;
  /** true when retention removed events after the given cursor (BRIDGE §14.3); delivery continues from the oldest kept */
  truncated: boolean;
  /** present while the agent or the workspace is paused: nothing is delivered, nothing is dropped */
  paused?: true;
}
/** `tealbrick/events/stream`: from now on, this session's SSE stream (GET /mcp) carries `notifications/tealbrick/event`
 *  frames, first the backlog after `cursor`, then live events. One subscription per session; a second call replaces it. */
export interface EventsStreamParams {
  cursor?: string;
}
export interface EventsStreamResult {
  /** the position the stream starts after: the given cursor; null = from the oldest kept */
  cursor: string | null;
  truncated: boolean;
  /** while the agent or workspace is paused; frames start on resume */
  paused?: true;
}
export interface EventNotificationParams {
  event: AgentEvent;
}

// ── Bridge internal API (BRIDGE §3.2, §8.3, §9.4, §10) ─────────────────────
/** `POST /tb/v1/claim` (no assertion yet; the K6 code authenticates). */
export interface ClaimRequest {
  code: string;
  instancePublicKey: Ed25519PublicJwk;
  manifestDigest: Sha256Digest;
  version: SemVer;
  sdkVersion: SemVer;
  service?: ServiceId;
  /** neighbours (own infrastructure) only */
  internalUrl?: InternalUrl;
  /** v0.1.52 (C268b): optional call-proof claims this app's verifier accepts (miniapp-sdk 0.1.36+: `["bd"]`). Absent = none. */
  proofClaims?: ProofClaimCap[];
  /** v0.1.70 (C354): capabilities this app serves (APP_CAPS). Absent = none. */
  caps?: AppCap[];
}
/** v0.1.52 (C268b): optional call-proof claims a verifier can declare it accepts. The bridge adds such a claim to proofs for an
 *  app ONLY when the app's current claim or status lists it (capability, never inferred from a version number). */
export const PROOF_CLAIM_CAPS = ["bd"] as const;
export type ProofClaimCap = (typeof PROOF_CLAIM_CAPS)[number];
/** v0.1.70 (C354): what an app SERVES, declared by the app (claim + every status push). A ROUTING HINT ONLY, never an authority:
 *  the owner's grant and the app's own checks still decide every call. Gates (bridge, conformance) read it, never a version number.
 *  Readers ignore unknown entries (forward-compatible) and treat a value that is not an array of strings within APP_CAPS_LIMITS
 *  as NO caps (fail closed). `person_op` = the app serves `POST /tb/v1/person-op` (SDK-API §21). */
export const APP_CAPS = ["person_op"] as const;
export type AppCap = (typeof APP_CAPS)[number];
export const APP_CAPS_LIMITS = { maxEntries: 16, maxLength: 32 } as const;
/** v0.1.70 (C354): the bridge's fixed refusals in a person-op result (status 409, body `{error: {code}}`), nothing forwarded. */
export const PERSON_OP_BRIDGE_REFUSALS = {
  /** `ins` is not an instance of the bridge's current config */
  instanceUnknown: "instance_unknown",
  /** the target app's latest claim/status does not declare `person_op` (or its caps are malformed) — fail closed */
  appUnsupported: "person_op_unsupported",
} as const;
export interface ClaimResponse {
  ins: InstanceId;
  bridge: { id: BridgeId; publicKey: Ed25519PublicJwk; internalUrl: InternalUrl };
  /** absent until Core lists the key in `instanceKeys` */
  slice?: CompactJws;
  /** services only: the instance key `tb-exec` accepts on its control port */
  app?: { publicKey: Ed25519PublicJwk };
  /** services only: declared keys and the env names `tb-exec` injects */
  serviceKeys?: { name: string; env: string }[];
}
/** `POST /tb/v1/status?wait=60` with `TB-Assert`. */
export interface AppStatus {
  readiness: "ready" | "needs_keys" | "degraded";
  version: SemVer;
  sdkVersion: SemVer;
  scopesRev: number;
  sliceRevision: number;
  keysRev: number;
  /** items waiting for the owner, count only = held receipts + `pendingCount()` (v0.1.13, C86) */
  pendingHolds: number;
  /** v0.1.28 (F89): app-reported condition the owner should see (from `defineApp({attention})`); present → readiness `degraded` */
  attention?: AppAttention;
  /** v0.1.39 (C213 US-1, miniapp-sdk 0.1.25): the schema the app's data is at (highest applied migration per scope) */
  schemaVersion?: SchemaVersion;
  /** v0.1.39 (US-1): the oldest app version that can run this data (the version that applied its newest migration); null = unknown */
  minCompatibleCode?: SemVer | null;
  /** v0.1.39 (US-1): the newest pre-update snapshot of this data (SDK-API §7.3a) */
  preUpdateSnapshot?: PreUpdateSnapshotRef | null;
  /** v0.1.39 (US-1): present only in failed mode (Health.status "failed"); readiness `degraded` + attention carry it too */
  failure?: BootFailure;
  /** v0.1.52 (C268b/C268c): as ClaimRequest.proofClaims; every push states the current set (absent, non-array or unknown entries
   *  = none). Only an app-instance push (no service) sets the bridge's stored capability (BRIDGE hooks step 6). */
  proofClaims?: ProofClaimCap[];
  /** v0.1.70 (C354): as ClaimRequest.caps; every push states the current set */
  caps?: AppCap[];
}
/** v0.1.39 (US-1): highest applied migration per scope (0 = none). */
export interface SchemaVersion {
  app: number;
  sdk: number;
}
/** v0.1.39 (US-4): the pre-update snapshot `TB_BACKUP_DIR/tb-preupdate-to-<version>.tar.gz` (SDK-API §7.3a). */
export interface PreUpdateSnapshotRef {
  file: string;
  sha256: string;
  createdAt: IsoTime;
  /** the app version that wrote the data; null for data from before miniapp-sdk 0.1.25 */
  from: SemVer | null;
  to: SemVer;
}
/** v0.1.39 (US-1): the boot phase that failed and why (never SQL, data or a secret). */
export interface BootFailure {
  phase: "restore" | "open" | "schema" | "lock" | "snapshot" | "sdk_migrations" | "app_migrations";
  /** SDK error code, e.g. migration_invalid, migration_failed, app_schema_newer, sdk_schema_newer, restore_failed, migration_locked */
  code: string;
  /** restore: product_mismatch | version_newer | schema_newer | snapshot_missing | archive_missing | meta_invalid | db_invalid | name_invalid */
  reason?: string;
  /** the app migration file that failed */
  file?: string;
  at: IsoTime;
}
/** v0.1.39 (US-1): attention codes the SDK itself raises in failed mode (next to the backup_* codes of v0.1.31). */
export const BOOT_FAILURE_ATTENTION = ["migration_failed", "restore_failed", "schema_newer", "migration_locked", "preupdate_snapshot_failed", "preupdate_snapshot_no_space"] as const;
/** v0.1.28 (F89): `code` matches `^[a-z][a-z0-9_]{0,39}$`; `reason` is plain text ≤ 200 chars for the owner — never a
 *  secret, a key name's value, raw upstream text or another app's data. */
export interface AppAttention {
  code: string;
  reason: string;
}
/** 200 when the slice or keysRev changed; otherwise 204 after `wait`. */
export interface AppStatusResponse {
  slice: CompactJws;
  sliceRevision: number;
  keysRev: number;
}
/** v0.1.63 (BRIDGE §15.5): presence + labels of one declared role; `provider`/`model`/`dataPolicy` null when unset. Labels
 *  only — exactly these keys (schema `model-role-status.schema.json#/$defs/modelRoleStatus`). */
export interface ModelRoleStatus {
  role: ModelRole;
  ins: InstanceId;
  set: boolean;
  policyOk: boolean;
  provider: string | null;
  model: string | null;
  dataPolicy: DataPolicy | null;
  /** spec follow-up (QA-SPEC49-2): absent when unset; GUI shows `owner_attested` local as "local (owner-listed, not verified)" */
  policyBasis?: PolicyBasis;
}
/** v0.1.63 (BRIDGE §15.4): `GET /tb/v1/model-roles/<role>` with `TB-Assert`; `Cache-Control: no-store`. */
export interface ModelRoleFetchResponse {
  role: ModelRole;
  /** MODEL_PROVIDERS id */
  provider: string;
  model: string;
  baseUrl: string | null;
  /** the bound key's value; null for a provider that needs no key */
  key: string | null;
  dataPolicy: DataPolicy;
  /** embeddings only: vector size, when the owner set it */
  dims: number | null;
  /** one revision for keys AND role bindings */
  keysRev: number;
}
/** `GET /tb/v1/keys/<name>` with `TB-Assert`; `Cache-Control: no-store`. */
export interface KeyFetchResponse {
  name: string;
  value: string;
  keysRev: number;
}
/** `POST /tb/v1/call` with `TB-Assert` + `TB-Grant` (companion path). Result: `OpResult` or `ErrorEnvelope`. */
export interface CallEnvelope<I = JsonValue> {
  target: ProductId;
  op: SnakeId;
  input: I;
  idempotencyKey?: string;
  /** set by the SDK to the current call id; used for hook re-entry and depth limits. v0.1.13 (C85): ABSENT for
   *  app-initiated calls (StartContext / events ctx / timers): the bridge audits them `call.app_initiated`. */
  parentCall?: CallId;
  /** v0.1.77 (C367, P4; cap `app_call_context`, BRIDGE §8.5, SDK-API §18.6): context keys the caller adds to this call. Allowed
   *  with or without `parentCall`. Every key matches `callerContextKeyPattern(<the caller's verified product>)`; a `tb.` key is
   *  always refused; no verified product → a non-empty object is refused; JCS size ≤ `CALLER_CONTEXT_MAX_BYTES`, depth ≤
   *  `CALLER_CONTEXT_MAX_DEPTH`. A refusal is `400 input_invalid` with `details.pointer` = `/context` or `/context/<key>`. */
  context?: Record<string, JsonValue>;
  /** v0.1.82 (C373, P1; cap `app_workflow_grants`, BRIDGE §8.6): the caller's workflow id (WORKFLOW_ID_PATTERN) this call runs
   *  for. MUST equal the presented grant's `wfl` (`workflow_mismatch`); with a grant that has no `wfl` → `workflow_grant_required`.
   *  Unlike `context`, it is gate-relevant; `context` stays informational. */
  workflow?: WorkflowId;
}

// ── Caller context on app-initiated calls (v0.1.77, C367 P4) ────────────────
/** Largest JCS serialization of a whole `CallEnvelope.context` object, in UTF-8 bytes. */
export const CALLER_CONTEXT_MAX_BYTES = 2048;
/** Deepest value under one context key. A scalar is depth 0, `[1]` depth 1, `{"a":[1]}` depth 2. */
export const CALLER_CONTEXT_MAX_DEPTH = 3;
/** The key rule after `<callerProduct>.`: 1 to 4 segments of `[a-z0-9_]{1,40}`. */
export const CALLER_CONTEXT_KEY_TAIL = "[a-z0-9_]{1,40}(\\.[a-z0-9_]{1,40}){0,3}";
/** `^<product>\.<CALLER_CONTEXT_KEY_TAIL>$`. `product` is an already validated product id (it holds only `[a-z0-9-]`, so it needs
 *  no escaping). The full validator lives once in the manifest package (L1); this is only the key rule. */
export function callerContextKeyPattern(product: string): RegExp {
  return new RegExp(`^${product}\\.${CALLER_CONTEXT_KEY_TAIL}$`);
}

/** v0.1.18 (C106a) */
export interface ScopeRequest {
  product: ProductId;
  kind: "buzz_channel" | "connect_inbox";
  id?: string;
  createName?: string;
}

// ── Reserved context (v0.1.13, G4b) ─────────────────────────────────────────
/** The `tb.` context namespace is bridge-only: a context hook answer with a `tb.*` key is refused (hook_failed). */
export const RESERVED_CONTEXT_PREFIX = "tb." as const;
/** `_meta["tealbrick/onBehalfOf"]` as the runner sends it (≤ 1 KB JCS, else dropped). */
export interface OnBehalfOfClaim {
  kind: "person" | "agent" | "channel_sender";
  /** channel_sender: `"<channel>:<value>"`, channel `[a-z0-9_-]{1,32}` (buzz | slack | telegram …), value = Connect's sender
   *  value (Buzz npub, Slack user id, Telegram numeric id); consumers MAY read a bare `npub1…` as `buzz:` */
  id: string;
  display?: string;
}
/** Context key `tb.onBehalfOf`. Unverified = a claim: consumers may use it to NARROW, never to widen access.
 *  Later (Martin Q5): `verified: true` + `attestation` (e.g. a Connect-signed sender) — same key, pluggable. */
export interface OnBehalfOfContext {
  claim: OnBehalfOfClaim;
  verified: false;
  via: "mcp_meta";
}
export type CompanionCallResponse<O = JsonValue> = OpResult<O> | ErrorEnvelope;

// ── Per-workflow companion grants (v0.1.82, C373 P1; BRIDGE §8.6, CORE v0.1.82, SDK-API §22) ────────────────────
/** One target of a workflow grant: the target product, the ops and crud the workflow needs there. */
export interface WorkflowGrantTarget {
  product: ProductId;
  /** 1..PER_WORKFLOW_OPS_MAX unique, each in the caller's `companions[product].perWorkflow.operations` (no `tb.*`) */
  ops: SnakeId[];
  /** 1..4 unique, ⊆ `perWorkflow.crud` ∩ the companion edge crud */
  crud: CrudAction[];
}
/** Limits of a request (Core refuses more with 400 `validation_failed` + `details.pointer`). */
export const WORKFLOW_GRANT_REQUEST_LIMITS = { titleMaxChars: 120, reasonMaxChars: 280, targetsMax: 8, opsPerTargetMax: 64 } as const;
/** The bridge's own bucket for the three relays, per caller instance (separate from the call bucket); over it → 429
 *  `rate_limited` + `Retry-After`. The SDK keeps using a cached grant until its `exp`. */
export const WORKFLOW_GRANT_RELAY_LIMIT = { perMinute: 240, burst: 60 } as const;
/** `POST /tb/v1/workflow-grants/request` body (app → bridge). The bridge relays it as `bridge_api.workflow_grant_request` with
 *  `ins` = the instance that signed `TB-Assert` (never from the body). */
export interface WorkflowGrantRequestBody {
  wfl: WorkflowId;
  /** shown to the owner; 1..120 chars, plain text */
  title: string;
  /** 1..8 targets, unique `product`, never the caller's own product */
  targets: WorkflowGrantTarget[];
  /** shown to the owner as "reported by the app"; ≤ 280 chars */
  reason?: string;
}
/** `POST /tb/v1/workflow-grants/get` body. Without `aud` = status only. With `aud` (the target instance, from the slice
 *  `companionTargets`) = status + a minted grant when the record is applied for that target. */
export interface WorkflowGrantGetBody {
  wfl: WorkflowId;
  aud?: InstanceId;
}
/** `POST /tb/v1/workflow-grants/release` body. Kill path: the record is withdrawn at once. */
export interface WorkflowGrantReleaseBody {
  wfl: WorkflowId;
}
/** State of one (caller instance, workflow) record. `none` = Core has no record. */
export type WorkflowGrantState = "none" | "requested" | "applied" | "rejected" | "withdrawn";
/** The answer of all three relays (and `ctx.workflowGrants.*`). */
export interface WorkflowGrantStatus {
  wfl: WorkflowId;
  state: WorkflowGrantState;
  title: string | null;
  /** the applied set (state `applied` only, else null) */
  applied: WorkflowGrantTarget[] | null;
  /** digest of the applied set's request (the canonical body, CORE v0.1.82), else null */
  appliedDigest: Sha256Digest | null;
  /** an open owner draft: the first request (state `requested`) or a widening of the applied set (state `applied`) */
  pending: { digest: Sha256Digest; targets: WorkflowGrantTarget[]; reviewUrl: string } | null;
  /** digest of the last request the owner rejected while no newer request is open, else null */
  rejectedDigest: Sha256Digest | null;
  updatedAt: IsoTime | null;
}
/** Answer of `workflow-grants/get`: `grant` (a K10 compact JWS with `wfl`, `exp − iat` = WORKFLOW_GRANT_TTL_SEC) only with `aud`
 *  and state `applied` for that target; refusals are error envelopes (`workflow_grant_missing` 404, `workflow_grant_withdrawn`
 *  410, `workflow_grants_unsupported` 409 with `details.product`). */
export interface WorkflowGrantGetResult {
  status: WorkflowGrantStatus;
  grant?: CompactJws;
}

/** Request headers the bridge reads or writes (one name per purpose). */
export const BRIDGE_HEADERS = {
  assertion: "TB-Assert",
  callProof: "TB-Call",
  companionGrant: "TB-Grant",
  csrf: "TB-CSRF",
} as const;

/** Bridge-internal routes (private listener) and SDK routes the bridge calls. */
export const BRIDGE_INTERNAL_PATHS = {
  claim: "/tb/v1/claim",
  status: "/tb/v1/status",
  keys: "/tb/v1/keys/{name}",
  /** v0.1.63 (BRIDGE §15.4) */
  modelRoles: "/tb/v1/model-roles/{role}",
  call: "/tb/v1/call",
  /** v0.1.57 (C274c): app event ingest (BRIDGE §14.1) */
  events: "/tb/v1/events",
  /** v0.1.82 (C373, P1; BRIDGE §8.6): workflow-grant relays to Core (TB-Assert; the bridge adds the verified instance) */
  workflowGrantRequest: "/tb/v1/workflow-grants/request",
  workflowGrantGet: "/tb/v1/workflow-grants/get",
  workflowGrantRelease: "/tb/v1/workflow-grants/release",
  metrics: "/metrics",
} as const;
export const SDK_PATHS_CALLED_BY_BRIDGE = {
  op: "/tb/v1/ops/{op}",
  hook: "/tb/v1/hooks/{hookId}",
  manifest: "/tb/v1/manifest",
  bridgeCatalog: "/tb/v1/bridge/catalog",
  bridgeResolve: "/tb/v1/bridge/resolve",
  bridgeMark: "/tb/v1/bridge/mark",
  bridgeScopeSummary: "/tb/v1/bridge/scope-summary",
} as const;

// ── Standalone admin (BRIDGE §11, C16 B7): exactly 4 ops, owner assertion ─
export const STANDALONE_ADMIN_PATHS = {
  pause: "/admin/v1/pause",
  resume: "/admin/v1/resume",
  revokeConnection: "/admin/v1/revoke-connection",
  ticket: "/admin/v1/ticket",
} as const;
/** without `agt` = workspace kill switch */
export interface AdminPauseBody { agt?: AgentId }
export type AdminResumeBody = AdminPauseBody;
export interface AdminRevokeConnectionBody { con: ConnectionId }
export interface AdminTicketBody { pur: "launch" | "keys"; product?: ProductId }
export interface AdminTicketResult { ticket: CompactJws; url: string }

// ── Persistent bridge state records (BRIDGE §1.2; volume layout is internal, shapes are normative) ─
export interface PairingConnectionRecord {
  con: ConnectionId;
  agt: AgentId;
  refreshDigest: Sha256Digest;
  gen: number;
  /** CORE I12: the immediately previous refresh token, accepted once until `previousUntil` (now + 30 s at rotation) */
  previousDigest: Sha256Digest | null;
  previousUntil: EpochS | null;
  previousUsed: boolean;
  expiresAt: EpochS;
  clientName: string;
  createdAt: EpochS;
  /** true once a config lists this connection */
  reported: boolean;
}
export interface BridgeIdentityRecord {
  bridgeId: BridgeId;
  workspaceId: WorkspaceId;
  kid: Kid;
  publicKey: Ed25519PublicJwk;
  /** CREDENTIALS §9.1 sealed private key */
  sealedPrivateKey: unknown;
  portalKeys: PortalKeyEntry[];
  enrolCodeDigest: Sha256Digest;
}

// Re-exported refs so implementers import bridge-facing identity types from one place.
export type { AgentRef, BridgeRef, InstanceRef };
