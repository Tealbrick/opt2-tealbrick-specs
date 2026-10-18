// Teal Brick opt2 — public API of @opt2-tealbrick/manifest (contract primitives) and
// @opt2-tealbrick/miniapp-sdk (server + client). v0.1, Lead · Specs, 2026-10-11. SDK-API.md is the prose.
// Declarations only: no runtime code. Vocabularies and manifest/credential shapes are imported, never re-declared.

import type {
  AppAttention,
  AppStatus,
  BootFailure,
  BridgeOp,
  BridgeOpBodies,
  CallEnvelope,
  ClaimRequest,
  ClaimResponse,
  CompanionCaller,
  HookRequest,
  HookResponseByPhase,
  InstanceSlice,
  IsoTime,
  OnBehalfOfContext,
  OpCallBody,
  OpResult,
  PreUpdateSnapshotRef,
  SchemaVersion,
  ScopeSummaryResult,
} from "./bridge.ts";
import type {
  AgentId,
  BridgeId,
  BridgeRef,
  CallId,
  CallProofBridgeOpClaims,
  CallProofHookClaims,
  CallProofOpClaims,
  ConfigClaims,
  Ed25519PublicJwk,
  FreeCaps,
  GrantClaims,
  InstanceId,
  InstanceRef,
  KeySetStatementClaims,
  PersonId,
  PersonTicketLaunchClaims,
  PortalRef,
  PortalRootChannel,
  Sha256Digest,
  SliceClaims,
  Typ,
  Ulid,
  WorkspaceId,
} from "./credentials.ts";
import type {
  AgentMode,
  CrudAction,
  DynamicCallInput,
  DynamicCatalogEntry,
  DynamicResolution,
  DynamicSearchInput,
  Effect,
  HoldFamily,
  HookHoldFamily,
  HookPhase,
  Manifest,
  ManifestValidation,
  Operation,
  OperationAudience,
  ProductId,
  Skill,
  StandardOperationId,
} from "./manifest.ts";

// Wire shapes owned by bridge.ts / credentials.ts / manifest.ts, re-exported for SDK users (not re-declared).
export type { AppAttention, AppStatus, BridgeOp, BridgeOpBodies, CallEnvelope, ClaimRequest, ClaimResponse, HookRequest, HookResponseByPhase, InstanceSlice, OnBehalfOfContext, OpCallBody, OpResult, ScopeSummaryResult };

// ════════════════════════════════════════════════════════════════════════════
// §A  @opt2-tealbrick/manifest — pure, synchronous, no I/O
// ════════════════════════════════════════════════════════════════════════════

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Uniform refusal of every verifier and decision function (CORE §8 `code`). */
export interface Refusal {
  ok: false;
  code: string;
  reason: string;
}

// ── Canonical JSON, digest, manifest ──
export declare function canonicalize(value: Json): string;
export declare function digest(value: Json): Sha256Digest;
export declare function validateManifest(json: unknown): ManifestValidation;
export declare function manifestDigest(manifest: Manifest): Sha256Digest;
/** MANIFEST §13: companion declarations checked against the target manifests (Core, conformance). */
export declare function validateCompanions(manifest: Manifest, targets: readonly Manifest[]): ManifestValidation;
/** MANIFEST §13 (CI and CLI only; the one function here that reads files): skill files, frontmatter, variables.
 * v0.1.11 (C70, MANIFEST §3): build paths resolve from `repoDir`, skill/app files from `manifestDir` (default `repoDir`). */
export declare function validateAppFiles(manifest: Manifest, repoDir: string, manifestDir?: string): Promise<ManifestValidation>;

/** Standard op ids, derived from manifest.ts STANDARD_OPERATIONS (the one declaration). */
export type StandardOpId = StandardOperationId;
/** All standard ops are agent/person ops; the scope summary is the bridge op `scope_summary` (N1). */
export type AudiencedStandardOpId = StandardOpId;

/** One operation as SDK and bridge see it: a manifest op, or an agent/person standard op. Audience is OperationAudience only (N1). */
export type OperationView =
  | (Operation & { standard: false })
  | {
      standard: true;
      id: AudiencedStandardOpId;
      title: string;
      crud: CrudAction[];
      effect: Effect;
      audience: OperationAudience;
      idempotency: "none" | "supported";
      receipt: false;
    };
export declare function withStandardOps(manifest: Manifest): OperationView[];

// ── Keys and JWS ──
export interface Ed25519KeyPair {
  publicJwk: Ed25519PublicJwk;
  /** opaque handle; private material never leaves the holder process */
  privateKey: CryptoKey;
  kid: string;
}
export declare function generateKeyPair(): Promise<Ed25519KeyPair>;
/** RFC 7638 thumbprint = `kid`. */
export declare function thumbprint(jwk: Ed25519PublicJwk): string;

/** A verifier's trusted key set (Portal keys, standalone issuer, bridge keys from the slice, own instance key). */
export interface KeySet {
  keys: { jwk: Ed25519PublicJwk; status: "pending" | "active" | "retired"; issuer: PortalRef | BridgeRef | InstanceRef }[];
}
export declare function keySetFrom(jwks: { keys: Ed25519PublicJwk[] }, issuer: PortalRef | BridgeRef | InstanceRef): KeySet;

// ── v0.1.11 (C62/C63): Portal Root Keys + key-set statements (CORE §4, CREDENTIALS §9.5). `keySetAnnounce` was
// removed in 0.1.26 (C133): the trusted set comes ONLY from a root-signed statement.
/** Build-pinned root PUBLIC keys of `channel` (= PORTAL_ROOT_KEYS[channel]). The channel is a build constant, never env. */
export declare function portalRootKeys(channel: PortalRootChannel): Ed25519PublicJwk[];
/** The pinned statement (bridge sealed S1, app store): its `seq` and the compact JWS verbatim. */
export interface PinnedKeySet { seq: number; kss: string }
/** `keys`: every key of the statement (pending | active | retired: grants, tickets, pairing codes);
 * `signers`: only active | pending keys (the ONLY keys a config or slice may be signed with). */
export interface VerifiedKeySet { ok: true; keys: KeySet; signers: KeySet; seq: number; kss: string }
/** Offline ceremony tool only (CREDENTIALS §9.5): checks the closed claim set, signs `tb-keyset+jws` with a root key. */
export declare function signKeySetStatement(claims: KeySetStatementClaims, rootKey: Ed25519KeyPair | ExternalSigner): Promise<string>;
/** Root-signed (header kid ∈ roots), closed claims, well-formed keys, `seq` > pinned.seq (equal seq: byte-identical). Refusal codes: KEYSET_REFUSAL. */
export declare function verifyKeySetStatement(jws: string, roots: readonly Ed25519PublicJwk[], pinned?: PinnedKeySet | null): VerifiedKeySet | Refusal;
/**
 * The ONE trust rule for a config / slice / enrolment body (CREDENTIALS §9.5): the body MUST carry `portalKeySet` →
 * verifyKeySetStatement against the build-pinned `roots` (`changed` = newer than pinned). No `portalKeySet` →
 * `keyset_missing` (pinned or not); no roots → `keyset_invalid`. No transition path (C133).
 */
export declare function trustedPortalKeys(
  body: { portalKeySet?: string },
  pinned: PinnedKeySet | null,
  roots: readonly Ed25519PublicJwk[],
): (VerifiedKeySet & { changed: boolean }) | Refusal;
/** BSD-07 (BRIDGE §5.7): `http://<name>.railway.internal:<port>`, or (ownInfra only) an http(s) origin listed in `allowList` (bridge env TB_OWN_INFRA_ORIGINS). */
export declare function isPrivateInternalUrl(url: string, opts?: { ownInfra?: boolean; allowList?: readonly string[] }): boolean;

export interface JwsExpect {
  typ: Typ;
  aud: string;
  iss: readonly string[];
  /** epoch seconds */
  now: number;
  maxLifetimeS: number;
}
export declare function signJws<C extends object>(typ: Typ, claims: C, key: Ed25519KeyPair): Promise<string>;
/** v0.1.1 (C26): JWS assembly with an external signer (private key outside the process: OS keychain / Secure Enclave). */
export interface ExternalSigner { kid: string; sign(signingInput: string): string | Promise<string> }
export declare function signJwsWithSigner<C extends object>(typ: Typ, claims: C, signer: ExternalSigner): Promise<string>;
export declare function verifyJws<C extends object>(token: string, keys: KeySet, expect: JwsExpect): { ok: true; header: { typ: Typ; kid: string }; claims: C } | Refusal;

/** Instance assertion (`TB-Assert`, typ tb-instance-assert+jwt) bound to method, path and body digest. */
export declare function signInstanceAssertion(input: {
  key: Ed25519KeyPair;
  ins: InstanceId;
  svc?: string;
  bridge: BridgeId;
  method: string;
  pathAndQuery: string;
  body?: Uint8Array;
  now: number;
}): Promise<string>;

// ── Verification context shared by all verifiers ──
export interface TrustContext {
  /** epoch seconds */
  now: number;
  self: InstanceRef;
  ws: WorkspaceId;
  /** workspace bridge id (grant `cnf.brg`) */
  bridge: BridgeId;
  /** Portal keys, or the standalone issuer named by a Portal-signed slice, or (app-alone) the own instance key */
  issuers: KeySet;
  /** call-proof keys = slice `bridge.keys` */
  bridgeKeys: KeySet;
  /** slice `revoked.jtis` */
  revokedJtis: ReadonlySet<Ulid>;
}

export interface VerifiedGrant {
  ok: true;
  token: string;
  claims: GrantClaims;
  caller: { type: "agent"; id: AgentId } | { type: "app"; id: InstanceId };
}
export declare function verifyGrant(token: string, ctx: TrustContext): VerifiedGrant | Refusal;

export interface VerifiedCallProof<C extends CallProofOpClaims | CallProofHookClaims | CallProofBridgeOpClaims = CallProofOpClaims> {
  ok: true;
  claims: C;
}
export declare function verifyCallProof(
  token: string,
  ctx: TrustContext,
  bind: { op: string; inputDigest: Sha256Digest; contextDigest: Sha256Digest; grantJti: Ulid },
): VerifiedCallProof | Refusal;
export declare function verifyHookProof(
  token: string,
  ctx: TrustContext,
  bind: { hook: string; phase: HookPhase; contextDigest: Sha256Digest; inputDigest?: Sha256Digest },
): VerifiedCallProof<CallProofHookClaims> | Refusal;

/** Bridge-only SDK calls (C16 B5): `POST /tb/v1/bridge/<bop>`; bodies = BridgeOpBodies (bridge.ts). */
export declare function verifyBridgeOpProof(
  token: string,
  ctx: TrustContext,
  bind: { bop: BridgeOp; op?: string; inputDigest?: Sha256Digest },
): VerifiedCallProof<CallProofBridgeOpClaims> | Refusal;

/** The ONE skill renderer (N6), used by Core (workspace bundle) and the bridge (per agent). */
export interface SkillVars {
  agent?: { id: AgentId; name: string };
  workspace?: { name: string };
  settings?: Record<string, string | number | boolean>;
  /** `{{scope.<type>.<kind>}}` labels */
  scope?: Record<string, Record<string, string>>;
}
export declare function renderSkill(skill: Skill, body: string, vars: SkillVars): string;

export interface VerifiedTicket {
  ok: true;
  claims: PersonTicketLaunchClaims;
}
/** Accepts only `pur: "launch"` with `aud` = ctx.self. The jti one-time check is the SDK's (DB), not this function's. */
export declare function verifyTicket(token: string, ctx: TrustContext): VerifiedTicket | Refusal;

export declare function verifySlice(token: string, ctx: Omit<TrustContext, "bridgeKeys" | "revokedJtis">): { ok: true; slice: InstanceSlice } | Refusal;
export declare function verifyConfig(token: string, ctx: { now: number; self: BridgeRef; issuers: KeySet }): { ok: true; claims: ConfigClaims; body: unknown } | Refusal;

/** One agent entry of the slice (`rev`, `grants` etc. come from InstanceSlice in bridge.ts). */
export type SliceAgent = InstanceSlice["agents"][number];

// ── Decision functions (CORE §7, C10) ──
export interface GateInput {
  paused: { workspace: boolean; agent: boolean; connection: boolean; instance: boolean };
  grant: string;
  trust: TrustContext;
  op: OperationView;
  /** scope types declared by the target manifest */
  declaredScopeTypes: readonly string[];
}
export interface GateDecision {
  decision: "pass" | "refuse";
  reason: string;
}
/** Bridge only. `tb.hold_status` skips the CRUD check (valid grant suffices, CORE I4). */
export declare function gate(input: GateInput): GateDecision;

export interface AuthorizeInput {
  /** step (0), CORE I1: from the latest instance slice */
  paused: { workspace: boolean; instance: boolean; agent: boolean };
  /** compact K10; `authorize()` re-runs verifyGrant (step 1) */
  grant: string;
  trust: TrustContext;
  /** effective op (dynamic ops: crud/effect/holdFamily from `resolve`) */
  op: { id: string; crud: CrudAction[]; effect: Effect; holdFamily?: HoldFamily; scopeType?: string };
  /** caller's access on the targeted scope instance (or best access when the op spans instances); null when the op has no scopeType */
  access: { level: string; crud: CrudAction[] } | null;
  /** receipts (status run|approved) per effect over each cap's sliding window (`per`), computed by the SDK (CORE I14) */
  usage: Partial<Record<Effect, number>>;
  /** "approved" only when an approved, unconsumed hold matches (caller, op, inputDigest) — SDK-API §4.3 */
  approval: "none" | "approved";
  /** v0.1.13 (G1): the call proof's `hv` claim (attested before-hook hold verdict), else null */
  holdVerdict: { family: HookHoldFamily; reason: string; by: string } | null;
}
export interface Decision {
  decision: "run" | "hold" | "refuse";
  reason: string;
  holdFamily?: HoldFamily | "caps" | "policy";
  /** v0.1.13 (G1): `<product>/<hookId>` when a before-hook verdict caused the hold */
  heldBy?: string;
}
/** App SDK only. Order: (0) slice pause → verifyGrant → scope access → hook hold verdict (v0.1.13) → held family / money
 *  → caps → run. `approval: "approved"` satisfies the verdict, held-family and money steps alike (one approval runs once). */
export declare function authorize(input: AuthorizeInput): Decision;

// ── Vocabularies owned here (others re-exported from manifest.ts / credentials.ts) ──
export declare const RECEIPT_STATUSES: readonly ["run", "held", "approved", "denied", "refused", "failed", "after_failed"];
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export declare const SDK_AUDIT_ACTIONS: readonly [
  "session.signin",
  "session.signout",
  "hold.decide",
  "scope.set",
  "key.set",
  "key.delete",
  "backup.create",
  "backup.restore",
  "migration.apply",
  "claim.complete",
];
export type SdkAuditAction = (typeof SDK_AUDIT_ACTIONS)[number];

// ════════════════════════════════════════════════════════════════════════════
// §B  @opt2-tealbrick/miniapp-sdk — server
// ════════════════════════════════════════════════════════════════════════════

export declare class TbError extends Error {
  constructor(code: string, message: string, httpStatus?: number);
  readonly code: string;
  readonly httpStatus: number;
}

export interface Caller {
  type: "agent" | "app" | "person";
  /** agt_ / ins_ / per_ */
  id: AgentId | InstanceId | PersonId;
  /** DISPLAY ONLY (agent card name, app manifest name, person name). Never an identity: two apps may share a name. */
  name: string;
  /** agents only */
  mode: AgentMode | null;
  /** v0.1.44 (SDK-CALLER-PRODUCT, security): app callers only — the VERIFIED product id of the calling app, from the signed
   *  slice `companionCallers[]` entry whose `ins` equals the verified grant's caller instance. Apps that decide anything per
   *  calling app (data sharing, routing, "is this Observer?") key on `product` (and `id`), NEVER on `name`. Absent for
   *  agent and person callers, and for an app caller that is not in the slice (the SDK refuses such a call anyway). */
  product?: ProductId;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, Json>): void;
  info(msg: string, fields?: Record<string, Json>): void;
  warn(msg: string, fields?: Record<string, Json>): void;
  error(msg: string, fields?: Record<string, Json>): void;
}

/** node:sqlite handle restricted to app tables (`tb_*` reserved). */
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  transaction<T>(fn: () => T): T;
}

export interface ReceiptHelpers {
  /** redacted, ≤ 280 chars */
  summary(text: string): void;
  /** free JSON ≤ 4 KB, e.g. { subjectKind: "as_me" } */
  meta(value: Json): void;
}

export interface ScopeAccessView {
  /** access for this call's scope instance (null if the op has no scopeType) */
  access: { type: string; id: string | null; level: string; crud: CrudAction[] } | null;
  readable(type: string): Promise<string[]>;
  writable(type: string): Promise<string[]>;
  can(type: string, id: string, crud: CrudAction): Promise<boolean>;
}

/** callApp result = OpResult (bridge.ts); refusals are thrown as TbError. */
export type CompanionResult<O = Json> = OpResult<O>;

export interface OpContext {
  caller: Caller;
  /** null for person calls */
  grant: VerifiedGrant | null;
  op: OperationView;
  scope: ScopeAccessView;
  callId: CallId | null;
  idempotencyKey: string | null;
  /** open hook context: "<product>.<key>" → JSON */
  context: Record<string, Json>;
  receipt: ReceiptHelpers;
  getKey(name: string): Promise<string | null>;
  callApp<O = Json>(product: string, op: string, input: Json, opts?: { idempotencyKey?: string }): Promise<CompanionResult<O>>;
  callServiceHelper<O = Json>(serviceId: string, path: string, body: Json): Promise<O>;
  db: Db;
  log: Logger;
  signal: AbortSignal;
  /** v0.1.3 (C31): bridge public origin from the slice (`bridge.publicUrl`); null until known */
  publicUrl: string | null;
  /** v0.1.43 (LA-1, C232): the workspace views service origin from the slice (`bridge.viewUrl`); null until Core created it.
   *  Optional for SDKs before 0.1.26. */
  viewUrl?: string | null;
  /** v0.1.3 (C31) */
  workspace: WorkspaceId;
  /** v0.1.3 (C31): create scope instances outside events.agentAdded (person ops, public routes) */
  scopes: Pick<ScopeStore, "instances">;
  /** v0.1.47 (SDK-INSTANCE-GRANT): set ONLY when the caller is a person (person ops, SDK >= 0.1.31); undefined on agent and
   *  app calls. An agent op may narrow its OWN access only through `ctx.scopeSelfRevoke`. */
  scopeGrants?: ScopeGrantApi;
  /** v0.1.48 (SDK-COMPANION-CALLERS, C240): person callers only (owner pages) — the verified apps that may call this app, from
   *  the CURRENT signed slice `companionCallers` (frozen copies; [] when the slice is expired). Undefined on agent/app calls. */
  companionCallers?: () => readonly CompanionCaller[];
  /** v0.1.47: agent callers only — drop the calling agent's own access to one instance (narrowing is always allowed). */
  scopeSelfRevoke?: (type: string, instanceId: string) => Promise<void>;
  /** v0.1.3 (C31): THE app-secret mechanism */
  secrets: AppSecrets;
  /** v0.1.13 (C86): push the status (pendingHolds) now; debounced 1 s, at most one push per second */
  statusChanged(): void;
  /** v0.1.13 (C86): `<portalUrl>/w/<ws>/open?product=<own>&path=<path>`; null until the slice has portalUrl */
  ownerLink(path: string): string | null;
}

/** v0.1.3 (C31): app secrets sealed under TB_KEK (AAD = name); excluded from export, sealed inside backups. */
export interface AppSecrets {
  put(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
  delete(name: string): Promise<void>;
}

/** v0.1.3 (C33): `defineApp({ onStart })` runs once after boot and claim. */
export interface StartContext {
  db: Db;
  log: Logger;
  scopes: ScopeStore;
  secrets: AppSecrets;
  getKey(name: string): Promise<string | null>;
  callServiceHelper<O = Json>(serviceId: string, path: string, body: Json): Promise<O>;
  /** v0.1.13 (C85): app-initiated companion call (timers, background refresh): no parentCall, own companion grant; same
   *  hooks, holds, rate limits as any caller; audited `call.app_initiated` by the bridge. Usable for the app's lifetime. */
  callApp<O = Json>(product: string, op: string, input: Json, opts?: { idempotencyKey?: string }): Promise<CompanionResult<O>>;
  /** v0.1.13 (C86) */
  statusChanged(): void;
  /** v0.1.13 (C86): `<portalUrl>/w/<ws>/open?product=<own>&path=<path>`; null until the slice has portalUrl */
  ownerLink(path: string): string | null;
}
/** v0.1.13: the ctx every event handler gets (C85: callApp outside an op handler; C86: statusChanged). */
export interface EventContext {
  db: Db;
  log: Logger;
  scopes: ScopeStore;
  callApp<O = Json>(product: string, op: string, input: Json, opts?: { idempotencyKey?: string }): Promise<CompanionResult<O>>;
  statusChanged(): void;
  /** v0.1.13 (C86): `<portalUrl>/w/<ws>/open?product=<own>&path=<path>`; null until the slice has portalUrl */
  ownerLink(path: string): string | null;
}

export type Handler<I = Json, O = Json> = (input: I, ctx: OpContext) => Promise<O>;
export interface HandlerSpec<I = Json, O = Json> {
  run: Handler<I, O>;
  /** scope instance id the call targets; null = spans instances (handler filters with ctx.scope) */
  scope?: (input: I, caller: Caller) => string | null;
  /** receipt summary (≤ 280, no secrets) */
  redact?: (input: I, output?: O) => string;
  /** owner-facing hold text (≤ 16 000; longer → refuse hold_view_too_large) */
  holdView?: (input: I) => string;
}

// ── Hooks (CORE §8) ──
export interface HookContext {
  log: Logger;
  db: Db;
  getKey(name: string): Promise<string | null>;
  signal: AbortSignal;
  /** v0.1.3 (C31) */
  secrets: AppSecrets;
}
export type HookHandler = (req: HookRequest, ctx: HookContext) => Promise<HookResponseByPhase[HookRequest["phase"]]>;

// ── Dynamic ops (CORE §13) ──
/** v0.1.35 (SDK-HV-1): what the owner sees on a hold of a dynamic tool call (SDK-API §4.6). */
export interface DynamicHoldView {
  /** hold summary (≤ 280; longer is clamped); default = op title */
  summary?: string;
  /** hold view text, plain text (≤ 16 000) */
  view: string;
}
export interface DynamicHandlers {
  catalog(query: DynamicSearchInput | null, ctx: HookContext): Promise<DynamicCatalogEntry[]>;
  resolve(tool: string, ctx: HookContext): Promise<DynamicResolution | null>;
  call(tool: string, args: DynamicCallInput["arguments"], ctx: OpContext): Promise<Json>;
  /**
   * v0.1.35 (SDK-HV-1, optional): the owner-facing hold text for a held call of `tool` — the app may READ upstream content
   * (e.g. the mail draft a send would deliver) with the same account the call would use. Awaited by the SDK with a time
   * budget (`ctx.signal`, 5 s). `null` = no special view (the SDK shows op title + arguments). A throw, a timeout or a view
   * over 16 000 chars → the SDK shows op title + arguments plus the line "Tealbrick could not read the content of this
   * request"; the hold is created either way (never blocked, never approved). The approval is bound to sha256(view): when
   * the approved call is repeated the SDK computes the view again and runs only if it is the same text, else it holds again.
   */
  holdView?(tool: string, args: DynamicCallInput["arguments"], ctx: OpContext): Promise<DynamicHoldView | null>;
}

// ── Public routes (manifest publicRoutes; app verifies) ──
export type PublicHandler = (
  req: Request,
  ctx: {
    log: Logger;
    db: Db;
    getKey(name: string): Promise<string | null>;
    /** v0.1.3 (C31) */
    publicUrl: string | null;
    /** v0.1.43 (LA-1): tb-views origin or null (SDK >= 0.1.26) */
    viewUrl?: string | null;
    workspace: WorkspaceId;
    scopes: Pick<ScopeStore, "instances">;
    secrets: AppSecrets;
  },
) => Promise<Response>;

// ── App definition ──
export interface AppEvents {
  agentAdded?(agent: SliceAgent, ctx: EventContext): Promise<void>;
  agentRemoved?(agent: SliceAgent, ctx: EventContext): Promise<void>;
  keysChanged?(names: string[], ctx: EventContext): Promise<void>;
  /** v0.1.13 (Fleet): the FULL slice agent list, once per installed slice whose `agents[]` differ from the previous one
   *  (ids, names, mode, status): add, re-add, rename, pause/resume. Also once after boot with the first slice. */
  agentsChanged?(agents: SliceAgent[], ctx: EventContext): Promise<void>;
}
export interface AppDefinition<A extends string = never> {
  manifest: Manifest;
  handlers: Record<string, Handler | HandlerSpec>;
  hooks?: Record<string, HookHandler>;
  dynamic?: Record<string, DynamicHandlers>;
  publicRoutes?: Record<string, PublicHandler>;
  /** directory of NNNN_<name>.sql | NNNN_<name>.ts */
  migrations: string;
  backup?: { beforeBackup?(): Promise<void>; afterRestore?(): Promise<void> };
  events?: AppEvents;
  /** app audit actions (typed literal list; no free strings) */
  auditActions?: readonly A[];
  /** v0.1.3 (C33) */
  onStart?(ctx: StartContext): Promise<void>;
  /** v0.1.13 (C86): items waiting for the owner beyond held receipts (0..10 000), added to AppStatus.pendingHolds.
   *  1 s timeout; an error or timeout counts 0 and logs a WARNING each time (rate-limited 1/min, suppressed count). */
  pendingCount?(db: Db): Promise<number>;
  /** v0.1.28 (F89): a condition the owner should see while the app still serves (e.g. a degraded engine), or null.
   *  Read at every status push (1 s timeout; an error or timeout counts as null and logs a WARNING, rate-limited 1/min).
   *  Non-null → `AppStatus.attention` and readiness `degraded` (when health is otherwise `ok`). Call `ctx.statusChanged()`
   *  when it changes. */
  attention?(db: Db): Promise<AppAttention | null>;
}
export interface App {
  readonly manifest: Manifest;
  readonly digest: Sha256Digest;
  readonly operations: readonly OperationView[];
}
export declare function defineApp<A extends string = never>(def: AppDefinition<A>): App;

/** Reads only the TB_* names of SdkEnv; refuses to boot on an invalid manifest, handler set or migration set. */
export declare function startApp(app: App, env: Record<string, string | undefined>, hooks?: StartHooks): Promise<RunningApp>;
/**
 * v0.1.11 (C63): TEST HARNESS hooks (conformance start modules, unit tests). Never read from env, never set by Portal.
 * `portalRootKeys` replaces the build-pinned roots so a harness can sign key-set statements with a test root pair.
 */
export interface StartHooks { portalRootKeys?: Ed25519PublicJwk[] }
export interface RunningApp {
  /** v0.1.21: the port the app listens on (harness `port`, else manifest runtime.port) */
  readonly port: number;
  readonly status: () => HealthStatus;
  readonly receipts: ReceiptStore;
  readonly scopes: ScopeStore;
  readonly keys: KeyApi;
  readonly audit: AuditLog;
  readonly backups: BackupApi;
  stop(): Promise<void>;
}

// ── Env (one name per setting; SDK-API §13) ──
export interface SdkEnv {
  /** absent only in app-alone mode (TB_STANDALONE=1) */
  TB_INSTANCE_ID?: InstanceId;
  /** companion services only */
  TB_SERVICE?: string;
  TB_ENROL_CODE?: string;
  TB_BRIDGE_URL?: string;
  /** JSON JWKS, public values */
  TB_PORTAL_KEYS?: string;
  TB_KEK: string;
  TB_KEK_PREVIOUS?: string;
  TB_DATA_DIR: string;
  TB_BACKUP_DIR?: string;
  TB_STANDALONE?: "1";
  TB_STANDALONE_RESET?: "1";
  TB_RESTORE_FROM?: string;
  TB_LOG_LEVEL?: "error" | "warn" | "info" | "debug";
  /** v0.1.12: tests / conformance runners ONLY; "1" skips the first-claim mount check of TB_DATA_DIR */
  TB_DATA_EPHEMERAL?: "1";
}

// ── Receipts and holds (one table) ──
export interface Receipt {
  /** hld_<ULID> when created by a hold, else rcp_<ULID> */
  id: `hld_${Ulid}` | `rcp_${Ulid}`;
  callId: CallId | null;
  caller: { type: "agent" | "app"; id: AgentId | InstanceId; name: string; /** v0.1.44: app callers, verified product id */ product?: ProductId };
  op: string;
  effect: Effect;
  holdFamily: HoldFamily | "caps" | "policy" | null;
  /** v0.1.13 (G1): `<product>/<hookId>` of the before hook whose verdict held this call, else null */
  heldBy: string | null;
  status: ReceiptStatus;
  inputDigest: Sha256Digest;
  summary: string;
  meta: Json;
  idempotencyKey: string | null;
  /** hold view; present only while held/approved, person reads only */
  view?: string;
  createdAt: number;
  decidedAt: number | null;
  expiresAt: number | null;
  decidedBy: PersonId | "expiry" | null;
}
export interface ReceiptQuery {
  caller?: AgentId | InstanceId;
  op?: string;
  status?: ReceiptStatus | ReceiptStatus[];
  cursor?: string;
  limit?: number;
}
export interface ReceiptStore {
  get(id: Receipt["id"]): Promise<Receipt | null>;
  list(q: ReceiptQuery): Promise<{ items: Receipt[]; nextCursor: string | null }>;
  /** counters for authorize() inside each cap window. v0.1.31 (SDK-02): the caller's cap slots — every run of a
   *  write/outward/destructive op, receipt or not, reserved before the handler, given back when the run fails or is
   *  refused — plus its approved, unconsumed holds of that effect (was: receipts with status run|approved). */
  usage(caller: AgentId | InstanceId, caps: FreeCaps, now: number): Promise<Partial<Record<Effect, number>>>;
  holdStatus(caller: AgentId | InstanceId, holdId: string): Promise<{ status: ReceiptStatus; decidedAt: number | null; expiresAt: number | null } | null>;
}
/** v0.1.13 (G4): standard op `tb.holds_pending` — audience agent, crud read, effect read, idempotency none, receipt false.
 *  An AGENT caller sees only its own pending holds; a companion APP caller (a grant naming tb.holds_pending, e.g. the
 *  consented wildcard companion) sees all pending holds of the instance. Summaries only: never the input or the view. */
export interface HoldsPendingInput {
  /** 1..100, default 50 */
  limit?: number;
  cursor?: string;
}
export interface HoldsPendingItem {
  id: `hld_${Ulid}`;
  product: string;
  op: string;
  family: HoldFamily | "caps" | "policy";
  /** hook verdict reason or the SDK's hold reason, ≤ 280 */
  reason: string;
  heldBy: string | null;
  /** the receipt summary (redacted, ≤ 280) */
  summary: string;
  caller: { type: "agent" | "app"; id: AgentId | InstanceId; name: string; /** v0.1.44: app callers, verified product id */ product?: ProductId };
  createdAt: IsoTime;
  ageS: number;
  /** app-relative decision page path `/holds/<id>`; open it with a Portal launch ticket (tickets.launch {product, path}) */
  decidePath: string;
}
export interface HoldsPendingOutput {
  items: HoldsPendingItem[];
  nextCursor: string | null;
}

// ── Cross-app context contracts (v0.1.13, SDK-API §18) ──
/** Context key `rules.narrowing` (written by the app whose product id is `rules`). Knowledge (and any memory app) MUST
 *  filter read/recall results by `memoryTags`; an unknown `v` → refuse `narrowing_unsupported` (fail closed).
 *  v0.1.28 (C150, SDK-API §18.4): writes are narrowed too — a write addressing a hidden item answers like a missing one;
 *  a write whose result the writer could not read is refused with `narrowing_violation` (409). */
/** G5 refusal codes (409): `narrowing_unsupported` = the call cannot honour the narrowing (§18.2, §18.4 c–e);
 *  v0.1.28 (C150) `narrowing_violation` = a write whose result the caller could not read (§18.4 b, not retryable). */
export type NarrowingRefusalCode = "narrowing_unsupported" | "narrowing_violation";
export interface RulesNarrowingV1 {
  v: 1;
  ruleId: string;
  reason: string;
  memoryTags?: {
    /** keep only results with at least one of these tags (each ≤ 64 chars, ≤ 32 per list). v0.1.23 (C115): present but EMPTY = nothing passes */
    anyOf?: string[];
    /** drop results with any of these tags */
    noneOf?: string[];
  };
}

/** Person only (tb.holds_decide). */
export interface HoldDecideInput {
  holdId: `hld_${Ulid}`;
  decision: "approve" | "deny";
  note?: string;
}
export declare function decideHold(principal: PersonPrincipal, input: HoldDecideInput): Promise<Receipt>;

/** Idempotency outcome before a handler runs (SDK-API §4.4). */
export type IdempotencyCheck =
  | { kind: "new" }
  | { kind: "replay"; output: Json }
  | { kind: "held"; holdId: string }
  | { kind: "conflict" };

// ── Scope store ──
export interface ScopeInstance {
  type: string;
  id: string;
  label: string;
  shared: boolean;
}
export interface ScopeGrantRow {
  agent: AgentId;
  type: string;
  instanceId: string;
  /** access level id from manifest scopes[].access */
  access: string;
  /** v0.1.47 (SDK-INSTANCE-GRANT): who wrote the row — manifest defaultGrants, the owner's Agents & scopes page
   *  (tb.scopes_set), or the app inside a person op (`grantedByOp` = that op id). Absent from SDKs before 0.1.31. */
  source?: "default" | "owner" | "app";
  grantedByOp?: string;
}
/** v0.1.47 (SDK-INSTANCE-GRANT): an app gives one agent access to one scope instance inside a PERSON op the owner just
 *  confirmed (the browser session + the op's own confirmation is the consent). Bounds (else refuse `scope_grant_invalid`
 *  400): `type` is a manifest scope type, `instanceId` exists, `access` is a level of that type and not above the agent
 *  ceiling the manifest allows agents (defaultGrants / scopes[].access), the agent is in the verified slice with an edge to
 *  this app. Audited like tb.scopes_set (`scope.set`, person principal, op id, call id). Never available on agent or app
 *  calls: an agent never widens its own or another card's access (L12, L13). */
export interface ScopeGrantApi {
  grant(agent: AgentId, type: string, instanceId: string, access: string): Promise<ScopeGrantRow>;
  revoke(agent: AgentId, type: string, instanceId: string): Promise<void>;
}
export interface ScopeStore {
  instances: {
    create(type: string, id: string, label: string, opts?: { shared?: boolean; ownerAgent?: AgentId }): Promise<ScopeInstance>;
    list(type: string): Promise<ScopeInstance[]>;
  };
  access(agent: AgentId, type: string, instanceId: string): Promise<ScopeGrantRow | null>;
  best(agent: AgentId, type: string): Promise<ScopeGrantRow | null>;
  list(agent: AgentId): Promise<ScopeGrantRow[]>;
  /** person only (tb.scopes_set); null removes */
  set(principal: PersonPrincipal, agent: AgentId, type: string, instanceId: string, access: string | null): Promise<void>;
  /** applies manifest defaultGrants once per (agent, type) */
  applyDefaults(agent: SliceAgent): Promise<void>;
  /** renders scopes[].summaryTemplate, ≤ 80 chars */
  summary(agent: AgentId): Promise<string>;
}

// ── Keys (CORE §10) ──
export interface KeyStatus {
  name: string;
  required: boolean;
  present: boolean;
  source: "app_own" | "account_default" | null;
}
export interface KeyApi {
  getKey(name: string): Promise<string | null>;
  onKeysChanged(cb: (names: string[]) => void): () => void;
  status(): Promise<KeyStatus[]>;
}
export declare function getKey(name: string): Promise<string | null>;
export declare function onKeysChanged(cb: (names: string[]) => void): () => void;

// ── Health / readiness ──
export type HealthStatus = "ok" | "needs_claim" | "needs_keys" | "slice_stale" | "restoring" | "failed";
export interface Health {
  status: HealthStatus;
  sdk: string;
  version: string;
  manifestDigest: Sha256Digest;
  keys: KeyStatus[];
  /** v0.1.12: present only while the instance needs the owner (status `needs_claim`; wire readiness `degraded`) */
  attention?: AttentionCode;
  /** v0.1.31 (SDK-03, miniapp-sdk 0.1.22): scheduled-backup state; omitted by SDKs before 0.1.22 */
  backup?: BackupHealth;
  /** v0.1.39 (C213 US-1, miniapp-sdk 0.1.25): see AppStatus (bridge.ts); omitted by older SDKs */
  schemaVersion?: SchemaVersion | null;
  minCompatibleCode?: string | null;
  /** v0.1.39: the oldest SDK that can run this data (the SDK that applied its newest SDK migration); null = unknown */
  minCompatibleSdk?: string | null;
  preUpdateSnapshot?: PreUpdateSnapshotRef | null;
}
/** v0.1.39 (US-1): failed mode (status "failed") answers 200 with this body; every other route answers 503 `app_failed`. */
export interface FailedHealth {
  status: "failed";
  sdk: string;
  version: string;
  manifestDigest: Sha256Digest;
  failure: BootFailure;
  attention: { code: string; reason: string };
  schemaVersion: SchemaVersion | null;
  /** what this code can run: app = number of migration files, sdk = newest SDK migration */
  codeSchema: SchemaVersion;
  minCompatibleCode: string | null;
  preUpdateSnapshot: PreUpdateSnapshotRef | null;
}
/** v0.1.31 (SDK-03, L3): a failed, overdue or unparsable scheduled backup is never silent. The same condition rides
 *  `AppStatus.attention` (codes `backup_failed`, `backup_overdue`, `backup_schedule_invalid`, `backup_schedule_never`). */
export interface BackupHealth {
  /** `invalid`: `backups.schedule` does not parse; `never_fires`: it parses but has no next run — no scheduled backup runs */
  schedule: "ok" | "invalid" | "never_fires";
  lastOkAt: IsoTime | null;
  lastFailedAt: IsoTime | null;
  /** error code of the newest failed run (never a message), null after a good run */
  lastError: string | null;
  /** failed runs (scheduled or `runNow`) since the newest good backup */
  failures: number;
  /** no good backup for more than two schedule periods (counted from the first tracked start when none ran yet) */
  overdue: boolean;
}
/** v0.1.12 claim guard: data dir not on a mounted volume, or the bridge refused the stored identity (same code). */
export type AttentionCode = "data_dir_not_mounted" | "identity_refused";
/** Status push body = AppStatus (bridge.ts); the SDK fills `pendingHolds` = count of held receipts (C16 S2). */

// ── Audit ──
export interface AuditEntry {
  id: `aud_${Ulid}`;
  at: number;
  actor: PersonId | "system";
  action: string;
  target: string | null;
  detail: Json;
}
export interface AuditLog {
  record(entry: Omit<AuditEntry, "id" | "at">): Promise<void>;
  list(q: { action?: string; cursor?: string; limit?: number }): Promise<{ items: AuditEntry[]; nextCursor: string | null }>;
}

// ── Backups (tb-backup-<ts>.tar.gz, meta.json format tealbrick.backup/1) and export (tb-export-<ts>.tar.gz) ──
export interface BackupMeta {
  format: "tealbrick.backup/1";
  product: string;
  version: string;
  manifestDigest: Sha256Digest;
  instance: InstanceId;
  sdk: string;
  createdAt: string;
  parts: { name: string; file: string; sha256: string; bytes: number }[];
  /** v0.1.39 (US-4): `"preupdate"` for the pre-update snapshot (then `version` = the data's version, "0.0.0" when unknown) */
  kind?: "preupdate";
  fromVersion?: string | null;
  toVersion?: string;
  schema?: SchemaVersion;
}
export interface ExportMeta {
  format: "tealbrick.export/1";
  product: string;
  version: string;
  instance: InstanceId;
  sdk: string;
  createdAt: string;
  /** one JSONL file per app table + receipts.jsonl + audit.jsonl */
  files: { file: string; rows: number; sha256: string }[];
}
export interface BackupApi {
  runNow(): Promise<{ file: string; meta: BackupMeta }>;
  list(): Promise<{ file: string; meta: BackupMeta }[]>;
  /** writes tb-export-<ts>.tar.gz to the backup volume and returns its stream (tb.export) */
  exportNow(): Promise<{ file: string; meta: ExportMeta; stream: ReadableStream<Uint8Array> }>;
}

// ── Claim (BRIDGE §10.1): ClaimRequest / ClaimResponse from bridge.ts; performed by startApp and tb-exec ──

// ── Person sign-in (one module) ──
export interface PersonPrincipal {
  type: "person";
  id: PersonId;
  ws: WorkspaceId;
  instance: InstanceId;
  iss: PortalRef | BridgeRef | InstanceRef;
  /** epoch ms; absolute 8 h */
  sessionExpiresAt: number;
}
export declare const SESSION_COOKIE: "tb_session";
export declare const CSRF_HEADER: "TB-CSRF";
export interface SessionInfo {
  principal: PersonPrincipal;
  csrf: string;
  /** v0.1.7 (C54/BSA-12): person-audience op ids whose manifest idempotency is `required`; the client `callOp` adds a key itself for these. */
  idempotencyRequired: string[];
}

// ── tb-exec (companion containers; C2, C6) ──
export declare const TB_EXEC_CONTROL_PORT: 7077;
/** CLI: `tb-exec -- <upstream command...>`; env: TB_INSTANCE_ID, TB_SERVICE, TB_ENROL_CODE, TB_BRIDGE_URL, TB_PORTAL_KEYS, TB_KEK, TB_DATA_DIR, TB_LOG_LEVEL (TB_DATA_EPHEMERAL in tests only). */
export interface TbExecControl {
  "POST /tb/v1/exec/backup": { request: Record<string, never>; response: "application/octet-stream" };
  "POST /tb/v1/exec/restore": { request: "application/octet-stream"; response: { ok: true } };
}

// ── Routes derived from the manifest (SDK-API §3.2) ──
export type SdkRoute =
  | "POST /tb/v1/ops/:op"
  | "POST /tb/v1/hooks/:hookId"
  | "POST /tb/v1/bridge/catalog"
  | "POST /tb/v1/bridge/resolve"
  | "POST /tb/v1/bridge/mark"
  | "POST /tb/v1/bridge/scope-summary"
  | "GET /tb/v1/manifest"
  | "GET /tb/v1/openapi.json"
  | "GET /tb/v1/health"
  | "POST /a/:product/tb/launch"
  | "GET /a/:product/tb/v1/session"
  | "POST /a/:product/tb/v1/logout"
  | "POST /a/:product/tb/v1/ops/:op"
  | "GET /a/:product/tb/standalone"
  | "POST /a/:product/tb/standalone";

/** Answers of POST /tb/v1/ops/:op = OpResult (bridge.ts). */

// ════════════════════════════════════════════════════════════════════════════
// §C  @opt2-tealbrick/miniapp-sdk/client — React (AppShell lives in @opt2-tealbrick/ui)
// ════════════════════════════════════════════════════════════════════════════

/** Minimal React element type so this file needs no React types; the package uses React's own. */
export type ReactNodeLike = unknown;

export interface TbProviderProps {
  product: string;
  children?: ReactNodeLike;
}
export declare function TbProvider(props: TbProviderProps): ReactNodeLike;

export interface UseSession {
  principal: PersonPrincipal | null;
  status: "loading" | "signed_in" | "signed_out";
  signOut(): Promise<void>;
}
export declare function useSession(): UseSession;

export interface UseHolds {
  holds: Receipt[];
  loading: boolean;
  decide(holdId: `hld_${Ulid}`, decision: "approve" | "deny", note?: string): Promise<void>;
}
export declare function useHolds(filter?: { status?: "held" | "approved" | "denied" }): UseHolds;

export interface UseScopes {
  access: ScopeGrantRow[];
  loading: boolean;
  set(agent: AgentId, type: string, instanceId: string, access: string | null): Promise<void>;
}
export declare function useScopes(agent?: AgentId): UseScopes;

export interface UseAgents {
  agents: SliceAgent[];
  loading: boolean;
}
export declare function useAgents(): UseAgents;

/** Same-origin fetch under /a/<product>/ with TB-CSRF; CORE error envelope → TbError. */
export declare function tbFetch(path: string, init?: RequestInit): Promise<Response>;
/** Person op via POST /a/<product>/tb/v1/ops/:op. */
export declare function callOp<O = Json>(op: string, input: Json): Promise<O>;
