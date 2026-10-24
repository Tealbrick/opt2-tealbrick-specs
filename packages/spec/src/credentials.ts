// opt2 credential registry — types + data only (no runtime code). Normative twin of specs/CREDENTIALS.md.
// v0.1, Lead · Specs, 2026-10-11. Vocabulary (CRUD, effects, hold families, modes, hook phases) comes from ./manifest.ts.

import type { AgentMode, CrudAction, HoldFamily, HookHoldFamily, HookPhase, ProductId } from "./manifest.ts";

// ── Identifiers (CORE §1) ────────────────────────────────────────────────────
/** 26-char Crockford base32 ULID, upper case. */
export type Ulid = string;
export type PersonId = `per_${Ulid}`;
export type AgentId = `agt_${Ulid}`;
export type ConnectionId = `con_${Ulid}`;
export type InstanceId = `ins_${Ulid}`;
export type BridgeId = `brg_${Ulid}`;
export type WorkspaceId = `ws_${Ulid}`;
export type DeviceRequestId = `dev_${Ulid}`;
export type CallId = `call_${Ulid}`;
/** v0.1.58 (S1-0, C308): a customer server paired by the device flow with scope `host` (HOST.md §3). */
export type ServerId = `srv_${Ulid}`;

// ── Subject / audience references (CORE §2): `tb:${kind}:${id}` ─────────────
export type RefKind = "portal" | "per" | "agt" | "ins" | "brg" | "srv";
export type PortalRef = "tb:portal";
export type PersonRef = `tb:per:${PersonId}`;
export type AgentRef = `tb:agt:${AgentId}`;
export type InstanceRef = `tb:ins:${InstanceId}`;
export type BridgeRef = `tb:brg:${BridgeId}`;
/** v0.1.58 (S1-0): the host agent of one paired server (iss/sub of K13 host assertions, aud of host plans). */
export type ServerRef = `tb:srv:${ServerId}`;
export type TbRef = PortalRef | PersonRef | AgentRef | InstanceRef | BridgeRef | ServerRef;
/** v0.1.1 (C30): issuer of the signed release index (Platform release key, pinned JWKS in Core). Not a caller type. */
export type ReleasesRef = "tb:releases";

// ── Caller types (exactly six; v0.1.58 adds `host`) and kinds ─────────────────
/** v0.1.58 (S1-0): `host` = the host agent on a paired customer server (HOST.md). It never holds a person credential. */
export const CALLER_TYPES = ["person", "agent", "app", "bridge", "portal", "host"] as const;
export type CallerType = (typeof CALLER_TYPES)[number];

/** v0.1.64 (C326, C332): K14 = relayed person op (Core-minted on the authority of an allow-listed K3 call; PORTAL-API "v0.1.64" B). */
export const CREDENTIAL_KINDS = ["K1", "K2", "K2b", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10", "K11", "K12", "K13", "K14"] as const;
export type CredentialKindId = (typeof CREDENTIAL_KINDS)[number];

// ── JOSE `typ` values: one per token kind / proof; every endpoint accepts exactly one ──
export const TYP = {
  pairingCode: "tb-pair+jwt",
  agentSession: "tb-agent-session+jwt",
  config: "tb-config+jws",
  slice: "tb-slice+jws",
  grant: "tb-grant+jwt",
  personTicket: "tb-ticket+jwt",
  agentAssertion: "tb-agent-assert+jwt",
  bridgeAssertion: "tb-bridge-assert+jwt",
  /** Bridge assertion variant for the "Approve in Portal" front channel (CREDENTIALS §7, §10). */
  pairState: "tb-pair-state+jwt",
  instanceAssertion: "tb-instance-assert+jwt",
  callProof: "tb-call+jwt",
  /** Standalone only (CREDENTIALS §17); accepted only on the bridge /admin surface. */
  ownerAssertion: "tb-owner-assert+jwt",
  /** v0.1.1 (C30): signed release index (Platform). A signed DOCUMENT digest, not a credential kind. */
  releaseIndex: "tb-release-index+jws",
  /** v0.1.11 (C62/C63): Portal key-set statement, signed by a Portal Root Key (CREDENTIALS §9.5). A signed DOCUMENT, not a credential kind. */
  keySet: "tb-keyset+jws",
  /** v0.1.58 (S1-0): host assertion (K13 key), accepted only on the `host` route rows (HOST.md §1). */
  hostAssertion: "tb-host-assert+jwt",
  /** v0.1.58 (S1-0): a host plan, signed by a Portal signing key (K12); verified on the box (HOST.md §4). A signed DOCUMENT, not a credential kind. */
  hostPlan: "tb-host-plan+jws",
  /** v0.1.64 (C326): relayed person op (K14), accepted only by the app SDK on `POST /tb/v1/person-op` (SDK-API §21). */
  personOp: "tb-person-op+jwt",
} as const;
export type Typ = (typeof TYP)[keyof typeof TYP];

/** Opaque value prefixes; value = prefix + 43 base64url chars (32 random bytes); issuer stores sha256 only. */
export const OPAQUE_PREFIX = {
  deviceCode: "tbdv_",
  ownerCliSession: "tbo_",
  enrolmentCode: "tbe_",
  agentRefresh: "tbr_",
  oauthAuthorizationCode: "tbac_",
} as const;
export type OpaquePrefix = (typeof OPAQUE_PREFIX)[keyof typeof OPAQUE_PREFIX];

/** Verification constants (seconds). */
export const LEEWAY_S = 30;
export const MAX_JWS_BYTES = 8192;
export const LIFETIME_S = {
  deviceCode: 600,
  pairingCode: 600,
  ownerCliSessionAbsolute: 30 * 86400,
  ownerCliSessionIdle: 86400,
  /** v0.1.53 (C289): idle limit of an owner session whose stored `owner_sessions.client` is `tbd` (TBD device flow; the CLI uses the
   *  device flow too but is stored as `cli`); slides on every use like the
   *  CLI idle limit and never passes `ownerCliSessionAbsolute` (30 d). CLI sessions keep `ownerCliSessionIdle` (24 h). Revoke,
   *  account disable and the absolute life end it as before.
   *  v0.1.64 (C332): applies to stored client `tbm` (Teal Brick Mobile) too. */
  ownerTbdSessionIdle: 7 * 86400,
  /** v0.1.64 (C326): K14 relayed person op, exp − iat (> queueTtlS + bridgeForwardS; the app refuses it later) */
  personOp: 20,
  agentAccess: 900,
  agentRefreshSliding: 30 * 86400,
  /** previous refresh token accepted once within this window (CORE I12) */
  agentRefreshReuseGrace: 30,
  oauthAuthorizationCode: 60,
  enrolmentCodeMax: 86400,
  configOrSlice: 43200,
  /** v0.1.1 (C30) */
  releaseIndex: 15552000,
  grant: 43200,
  grantRemintBelow: 21600,
  ticketLaunch: 60,
  ticketKeys: 120,
  proof: 60,
  pairState: 600,
  appUiSession: 8 * 3600,
  keyPageSession: 15 * 60,
  pairingRedeemMaxConfigAge: 600,
  portalKeyPrepublish: 86400,
  portalKeyRetiredKept: 43200 + 300,
} as const;

// ── JOSE header and base claims ──────────────────────────────────────────────
/** RFC 7638 SHA-256 thumbprint, base64url, 43 chars. */
export type Kid = string;
/** Exactly these three members; jku/jwk/x5u/x5c/crit are rejected. */
export interface JoseHeader<T extends Typ = Typ> {
  alg: "EdDSA";
  typ: T;
  kid: Kid;
}
export interface Ed25519PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid?: Kid;
}
/** `sha256:<hex>` (CORE §3). */
export type Sha256Digest = `sha256:${string}`;

interface BaseClaims<I extends TbRef, S extends TbRef, A extends TbRef> {
  iss: I;
  sub: S;
  /** single string, never an array (R-aud) */
  aud: A;
  iat: number;
  exp: number;
  /** ULID, 26 chars, no prefix */
  jti: Ulid;
}

/** Issuer of Portal-signed kinds: Portal, or the standalone bridge after handover (§17). */
export type PortalOrStandaloneIssuer = PortalRef | BridgeRef;

// ── K2b agent pairing code ───────────────────────────────────────────────────
/** Never issued in standalone (CREDENTIALS §17). OAuth connector paths A/B only. */
export interface PairingCodeClaims extends BaseClaims<PortalRef, AgentRef, BridgeRef> {
  ws: WorkspaceId;
  /** bridge authorize-request id; present only on the "Approve in Portal" redirect path */
  rid?: string;
}

// ── K5 agent session (access token) ──────────────────────────────────────────
export interface AgentSessionClaims extends BaseClaims<BridgeRef, AgentRef, BridgeRef> {
  ws: WorkspaceId;
  con: ConnectionId;
  /** connection credential generation from config */
  gen: number;
}

// ── K9 workspace config / instance slice ─────────────────────────────────────
/** Signed envelope claims common to config and slice. Body schema: workspace-config.schema.json (BRIDGE.md). */
export interface ConfigHeader<S extends BridgeRef | InstanceRef> extends BaseClaims<PortalOrStandaloneIssuer, S, S> {
  ws: WorkspaceId;
  v: 1;
  /** monotonic revision */
  rev: number;
}
export type ConfigClaims = ConfigHeader<BridgeRef> & { iss: PortalRef };
export type SliceClaims = ConfigHeader<InstanceRef>;

export type PortalKeyStatus = "pending" | "active" | "retired";
export interface PortalKeyEntry {
  jwk: Ed25519PublicJwk;
  status: PortalKeyStatus;
}
export interface ConnectionEntry {
  con: ConnectionId;
  agt: AgentId;
  method: "key" | "pairing";
  gen: number;
  /** key method only */
  publicKey?: Ed25519PublicJwk;
  status: "active" | "revoked";
}
export interface InstanceKeyEntry {
  ins: InstanceId;
  /** runtime service name; absent for the app process itself */
  svc?: string;
  jwk: Ed25519PublicJwk;
}
export interface PauseState {
  workspace: boolean;
  agents: AgentId[];
  instances: InstanceId[];
}
export interface RevokedSet {
  jtis: { jti: Ulid; exp: number }[];
}
export interface StandaloneState {
  issuer: BridgeRef;
  kid: Kid;
  ownerKeys: Ed25519PublicJwk[];
}
/** Credential section of the config body (field names fixed by CREDENTIALS §5.1). */
export interface ConfigCredentialSection {
  /**
   * v0.1.11 (C62/C63): INFORMATIONAL only. Kept (required) for one minor because the frozen v0.1 wire requires it;
   * Core emits it equal to the `keys` of `portalKeySet`. The trust rule (CREDENTIALS §9.5) ignores it whenever a
   * key-set statement is present or pinned. Removed in v0.2.
   */
  portalKeys: PortalKeyEntry[];
  /** v0.1.11 (C62/C63): the CURRENT root-signed key-set statement (`tb-keyset+jws`, compact JWS). The ONLY source of trusted Portal keys (CREDENTIALS §9.5). */
  portalKeySet?: string;
  connections: ConnectionEntry[];
  instanceKeys: InstanceKeyEntry[];
  pause: PauseState;
  revoked: RevokedSet;
  /** agent→app grants (K10 compact JWS) */
  grants: string[];
  standalone?: StandaloneState;
}
/** Credential section of the slice body. */
export interface SliceCredentialSection {
  /** v0.1.11 (C62/C63): INFORMATIONAL only (see ConfigCredentialSection.portalKeys). */
  portalKeys: PortalKeyEntry[];
  /** v0.1.11 (C62/C63): the CURRENT root-signed key-set statement (`tb-keyset+jws`); apps derive trusted Portal keys only from it (CREDENTIALS §9.5). */
  portalKeySet?: string;
  /** v0.1.10 (C64): `publicUrl` = bridge public origin (apps build `/p/<product>` callback URLs from it) */
  bridge: { id: BridgeId; keys: Ed25519PublicJwk[]; publicUrl?: string };
  pause: PauseState;
  revoked: RevokedSet;
  /** epoch seconds; app UI sessions created earlier are invalid */
  personNbf: number;
  /** companion grants held by this app (K10 compact JWS) */
  grants: string[];
  standalone?: StandaloneState;
}

// ── K10 the ONE grant (CORE §6) ──────────────────────────────────────────────
/** Free caps (CORE I14); `money` has no cap (always held). */
export interface Cap {
  /** integer ≥ 0 */
  max: number;
  per: "hour" | "day";
}
export interface FreeCaps {
  write?: Cap;
  outward?: Cap;
  destructive?: Cap;
}
export interface GrantClaims extends BaseClaims<PortalOrStandaloneIssuer, AgentRef | InstanceRef, InstanceRef> {
  ws: WorkspaceId;
  cnf: { brg: BridgeId };
  crud: CrudAction[];
  mode: AgentMode;
  held: HoldFamily[];
  caps: FreeCaps;
  /** Bound: allowed operation ids (empty for Free) */
  wf: string[];
  polrev: number;
}
/** Companion grant = same kind, subject is the calling instance; mode bound, wf = declared companion ops (CORE I8),
 *  held = workspace default held families (always incl. money), caps = {} (C16 S5).
 *  v0.1.46 (GRANT-PRD): `prd` = the product of the calling instance (`sub`), signed with the grant by its issuer (Portal
 *  Core, or a standalone bridge). The grant claim set is CLOSED (manifest jws.ts): verifiers before manifest 0.1.23 refuse
 *  `prd`, so issuers mint it only for bridge >= 0.2.3 and target SDK >= 0.1.28 (CREDENTIALS v0.1.46). The SDK takes Caller.product
 *  from `prd` first and from slice companionCallers only when `prd` is absent; a `prd` that differs from the slice entry
 *  for the same instance is refused (`grant_invalid`). Agent grants never carry `prd`. */
export type CompanionGrantClaims = GrantClaims & { sub: InstanceRef; mode: "bound"; prd?: ProductId };
export type AgentGrantClaims = GrantClaims & { sub: AgentRef };

// ── K11 person ticket ────────────────────────────────────────────────────────
export interface PersonTicketLaunchClaims extends BaseClaims<PortalOrStandaloneIssuer, PersonRef, InstanceRef> {
  ws: WorkspaceId;
  pur: "launch";
  /** app-relative UI path, starts with "/" */
  path?: string;
}
export interface PersonTicketKeysClaims extends BaseClaims<PortalOrStandaloneIssuer, PersonRef, BridgeRef> {
  ws: WorkspaceId;
  pur: "keys";
  /** requirement names to focus (display only) */
  req?: string[];
}
export type PersonTicketClaims = PersonTicketLaunchClaims | PersonTicketKeysClaims;

// ── K14 relayed person op (v0.1.64, C326) ────────────────────────────────────
/** Owner-session clients whose K3 may call `person_ops.call` (PERSON_OP_RELAY.clients). The CLI (`cli`) never may. */
export type PersonOpClient = "tbd" | "tbm";
/**
 * Core mints one K14 per allow-listed `person_ops.call` from a K3 of a `PersonOpClient`. It is never returned to the K3 holder:
 * Core hands it to the workspace bridge on `bridge_api.person_ops` (the bridge pulls; Portal never calls in), the bridge
 * forwards it with the input to the app's private `POST /tb/v1/person-op`, and the app SDK verifies it (SDK-API §21).
 * Bound to one person, one instance, one op and the exact input bytes; one-time; ≤ LIFETIME_S.personOp. Issuer is Core only
 * (tb:portal): a standalone bridge or app-alone app never mints or accepts K14 (the route answers 503 there).
 */
export interface PersonOpClaims extends BaseClaims<PortalRef, PersonRef, InstanceRef> {
  ws: WorkspaceId;
  /** the person-audience op id (manifest or standard), = the allow-list entry */
  op: string;
  /** "sha256:" + lowercase hex of SHA-256 over the UTF-8 bytes of the exact body string the bridge forwards (NOT the CORE §3
   *  JCS digest; no BOM). The app checks it on the raw body before parsing. */
  bd: Sha256Digest;
  /** = PersonOpCallInput.idempotencyKey; the app's idempotency key for this call (SDK §4.4) */
  idk: string;
  /** owner-session client the call came from; the app reads it as PersonPrincipal.via */
  cli: PersonOpClient;
  /** the relay row id (`pop_…`), echoed in the bridge result post */
  pop: `pop_${Ulid}`;
}

// ── Proofs that are not credentials (≤ 60 s, jti replay set at the verifier) ──
export interface AgentAssertionClaims extends BaseClaims<AgentRef, AgentRef, BridgeRef> {
  con: ConnectionId;
}
interface RequestBinding {
  /** HTTP method */
  htm: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** path + query */
  htu: string;
  /** sha256 of the raw body; required when a body exists */
  bd?: Sha256Digest;
}
export interface BridgeAssertionClaims extends BaseClaims<BridgeRef, BridgeRef, PortalRef>, RequestBinding {}
/** Front-channel pairing state: bridge → Portal /pair (form POST), one-time, ≤ 600 s. */
export interface PairStateClaims extends BaseClaims<BridgeRef, BridgeRef, PortalRef> {
  /** bridge authorize-request id, echoed as K2b `rid` */
  rid: string;
  /** absolute https URL = registered bridge public URL + "/oauth/pair/callback" */
  ret: string;
  /** redirect URI host of the pending OAuth request (shown on the Portal approve screen) */
  rh: string;
  /** DCR client name; display only, shown as "unverified" */
  cn: string;
}
export interface InstanceAssertionClaims extends BaseClaims<InstanceRef, InstanceRef, BridgeRef>, RequestBinding {
  svc?: string;
}
export interface CallProofOpClaims extends BaseClaims<BridgeRef, AgentRef | InstanceRef, InstanceRef> {
  call: CallId;
  /** the forwarded grant's jti */
  gjti: Ulid;
  op: string;
  /** sha256 of JCS(input) */
  in: Sha256Digest;
  /** sha256 of JCS(context) */
  ctx: Sha256Digest;
  /** v0.1.13 (G1): before-hook hold verdict, attested by the bridge; the target's authorize() holds with it */
  hv?: HoldVerdictClaim;
}
/** v0.1.13 (G1): `f` ∈ HOOK_HOLD_FAMILIES, `r` 1..280 chars, `by` = `<product>/<hookId>` of the first holding before hook. */
export interface HoldVerdictClaim {
  f: HookHoldFamily;
  r: string;
  by: string;
}
export interface CallProofHookClaims extends BaseClaims<BridgeRef, AgentRef | InstanceRef, InstanceRef> {
  call: CallId;
  hook: string;
  phase: HookPhase;
  ctx: Sha256Digest;
  in?: Sha256Digest;
  /** v0.1.52 (C268 B, C268b): sha256 of the EXACT hook request body bytes the bridge sends (the same meaning as `bd` on
   *  bridge/instance/owner assertions: raw bytes, not a re-serialisation). Optional. The bridge sends it ONLY to a hook app whose
   *  current claim or status lists `"bd"` in `proofClaims` (BRIDGE hooks step 6); never by version number. Older verifiers refuse
   *  any unknown claim ("hook proof shape"), so sending it to them breaks every hook of that app. A verifier that knows `bd` hashes
   *  the raw body it received BEFORE parsing, refuses a mismatch `call_proof_invalid`, and hands the handler the object parsed
   *  from those same bytes. Absent = not compared (a later slice flag makes it required). */
  bd?: Sha256Digest;
}
export const BRIDGE_OPS = ["catalog", "resolve", "mark", "scope_summary"] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];
/** SDK route per bridge op: POST /tb/v1/bridge/<path>. */
export const BRIDGE_OP_PATH = { catalog: "catalog", resolve: "resolve", mark: "mark", scope_summary: "scope-summary" } as const satisfies Record<BridgeOp, string>;
/** Bridge-only SDK calls (no grant, no agent action); verified by `verifyBridgeOpProof` in @opt2-tealbrick/manifest. */
export interface CallProofBridgeOpClaims extends BaseClaims<BridgeRef, BridgeRef, InstanceRef> {
  call: CallId;
  bop: BridgeOp;
  /** operation the bridge op concerns (e.g. the dynamic op being resolved); must be declared in the target manifest */
  op?: string;
  /** sha256 of JCS(body) */
  in?: Sha256Digest;
}
/** Variants are told apart by exactly one of `gjti` (op), `hook` (hook), `bop` (bridge op). */
export type CallProofClaims = CallProofOpClaims | CallProofHookClaims | CallProofBridgeOpClaims;
/** Standalone only. */
export interface OwnerAssertionClaims extends BaseClaims<PersonRef, PersonRef, BridgeRef>, RequestBinding {}
/**
 * v0.1.58 (S1-0): host assertion (`typ: tb-host-assert+jwt`), signed by the host key (K13) generated ON the box.
 * Same shape and replay rules as the bridge assertion: `iss = sub = tb:srv:<srv>`, `aud = tb:portal`, `exp − iat ≤ 60`, `jti`
 * once per verifier, bound to method + path/query (+ raw body digest). Header `kid` = RFC 7638 thumbprint of the pinned key.
 */
export interface HostAssertionClaims extends BaseClaims<ServerRef, ServerRef, PortalRef>, RequestBinding {}

/** Header names: one per proof purpose. */
export const PROOF_HEADER = { assertion: "TB-Assert", callProof: "TB-Call" } as const;

/** Bridge /oauth/token grant types. */
export const OAUTH_GRANT_TYPES = {
  authorizationCode: "authorization_code",
  refreshToken: "refresh_token",
  jwtBearer: "urn:ietf:params:oauth:grant-type:jwt-bearer",
  deviceCode: "urn:ietf:params:oauth:grant-type:device_code",
} as const;

/** K3 client label recorded at Core (opaque token, so not a claim). */
/** v0.1.64 (C322(8), C332): `tbm` = Teal Brick Mobile (device flow client_id `tbm`, scope owner). */
export const OWNER_SESSION_CLIENTS = ["cli", "tbd", "tbm"] as const;
export type OwnerSessionClient = (typeof OWNER_SESSION_CLIENTS)[number];

/** Device flow (K2, RFC 8628) parameters. */
export const DEVICE_FLOW = {
  /** v0.1.64: `tbm` (Teal Brick Mobile) — scope owner only in this version (no agent scope until the node contract, C332) */
  clientIds: ["tealbrick-cli", "tbd", "kit", "tealbrick-host", "tbm"],
  /** scope=owner only for these (a kit can never obtain K3) */
  ownerClientIds: ["tealbrick-cli", "tbd", "tbm"],
  agentClientIds: ["tealbrick-cli", "tbd", "kit"],
  /** v0.1.58 (S1-0): scope `host` only for this client (the host agent on a server); it can never obtain K3 or agent connections */
  hostClientIds: ["tealbrick-host"],
  scopes: ["owner", "agent", "host"],
  /** one agent request carries 1..64 {agt?, public_key} pairs */
  maxAgentPairs: 64,
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",
  userCodeLength: 8,
  expiresIn: 600,
  interval: 5,
  slowDownIncrement: 5,
  maxWrongUserCodePer10Min: 5,
  machineLabelMax: 64,
} as const;
export type DeviceClientId = (typeof DEVICE_FLOW.clientIds)[number];
export type DeviceScope = (typeof DEVICE_FLOW.scopes)[number];
export type DeviceOwnerClientId = (typeof DEVICE_FLOW.ownerClientIds)[number];
export type DeviceAgentClientId = (typeof DEVICE_FLOW.agentClientIds)[number];
export type DeviceHostClientId = (typeof DEVICE_FLOW.hostClientIds)[number];
// Device-flow wire types (DeviceStartInput union, DeviceOwnerTokenResult, DeviceAgentTokenResult) live in ./routes.ts only.

/** Sealed blob (Core, bridge, app): AES-256-GCM under a KEK from the service env; AAD = `tb:seal:<purpose>:<record id>`. */
export interface SealedBlob {
  v: 1;
  alg: "A256GCM";
  kek: string;
  iv: string;
  ct: string;
  tag: string;
}

// ── Registry row type and table ──────────────────────────────────────────────
export type Storage =
  | "issuer_digest"
  | "issuer_sealed"
  | "issuer_public_key"
  | "holder_keychain"
  | "holder_memory"
  | "holder_sealed_volume"
  /** v0.1.58 (S1-0): a root-only (0600) file on the customer server, outside every container (K13) */
  | "holder_host_file"
  | "verifier_jti_set"
  | "none";
export type Form = "external_jwt" | "opaque" | "jwt" | "jws" | "key_pair";

export interface CredentialRegistryRow {
  id: CredentialKindId;
  name: string;
  form: Form;
  /** K9 carries two typs (config, slice) for one kind */
  typ: Typ | readonly [Typ, Typ] | null;
  /** opaque prefix(es), if any */
  prefix: OpaquePrefix | `${OpaquePrefix}+${OpaquePrefix}` | null;
  issuer: CallerType | "clerk" | "self";
  issuerKey: string;
  holder: CallerType;
  holderDetail: string;
  storage: readonly Storage[];
  /** max lifetime in seconds; null = until revoked/rotated */
  maxLifetimeS: number | null;
  oneTime: boolean;
  audienceRule: string;
  verifier: string;
  /** checks after V0 (CREDENTIALS §3), in order */
  checks: readonly string[];
  acceptedAt: readonly string[];
  revocation: string;
  revocationLatency: string;
  pause: string;
}

export const CREDENTIAL_REGISTRY = [
  {
    id: "K1", name: "person session (Clerk)", form: "external_jwt", typ: null, prefix: null,
    issuer: "clerk", issuerKey: "Clerk instance key (Clerk JWKS)", holder: "person", holderDetail: "browser (Clerk cookie)",
    storage: ["none"], maxLifetimeS: 60, oneTime: false,
    audienceRule: "Clerk azp = Portal origin",
    verifier: "Core behind the Portal gateway, Clerk JWKS (cached ≤ 1 h, refetch on unknown kid)",
    checks: ["Clerk signature", "iss = Clerk frontend API", "azp = Portal origin", "time window", "sub → per_"],
    acceptedAt: ["Portal gateway → Core"],
    revocation: "Clerk sign-out / session revoke", revocationLatency: "≤ 60 s", pause: "n/a (person)",
  },
  {
    id: "K2", name: "device code", form: "opaque", typ: null, prefix: "tbdv_",
    issuer: "portal", issuerKey: "none (random)", holder: "person", holderDetail: "scope owner: tealbrick CLI / TBD only; scope agent: CLI / TBD / kit on the agent machine",
    storage: ["issuer_digest"], maxLifetimeS: 600, oneTime: true,
    audienceRule: "bound to client_id + scope at Core",
    verifier: "Core (digest of device_code; digest of normalised user_code)",
    checks: ["start: scope/client_id combination allowed (kit never owner)", "approval: K1 + user-code digest match (no unbound list, 5 wrong tries / 10 min)", "token: device_code digest match", "not expired", "polling interval honoured (slow_down)"],
    acceptedAt: ["Core POST /api/v1/device/token"],
    revocation: "owner denies / expiry", revocationLatency: "immediate", pause: "Core refuses scope=agent approval while workspace kill switch is on",
  },
  {
    id: "K2b", name: "agent pairing code", form: "jwt", typ: TYP.pairingCode, prefix: null,
    issuer: "portal", issuerKey: "K12 Portal signing key (not issued in standalone)", holder: "agent", holderDetail: "Portal form-POSTs it back to the bridge (path A) or the owner pastes it on the bridge authorize page (path B); OAuth connectors only",
    storage: ["verifier_jti_set"], maxLifetimeS: 600, oneTime: true,
    audienceRule: "aud = tb:brg:<workspace bridge>; sub = tb:agt:<id>",
    verifier: "deployed bridge, Portal key set (standalone: own key)",
    checks: ["ws = config workspace", "agent in config, not revoked, not paused", "workspace kill switch off", "rid matches pending request on redirect path", "last config pull ≤ 600 s ago", "jti unused (persisted)"],
    acceptedAt: ["bridge /oauth/authorize (paste)", "bridge /oauth/pair/callback (form POST)"],
    revocation: "Core adds jti to revoked.jtis; one-time", revocationLatency: "≤ 60 s (or 600 s exp)", pause: "redemption refused under workspace kill switch or agent pause",
  },
  {
    id: "K3", name: "owner CLI session / owner native session (client cli | tbd)", form: "opaque", typ: null, prefix: "tbo_",
    issuer: "portal", issuerKey: "none (random)", holder: "person", holderDetail: "owner CLI / TBD person keychain item tealbrick.person (ACL with user presence where supported; boundary = OS user)",
    storage: ["issuer_digest", "holder_keychain"], maxLifetimeS: 30 * 86400, oneTime: false,
    audienceRule: "Core route rows marked owner-CLI-allowed only (reads, drafts); never apply, any K11, K2b/K6 codes, device approval, confirm rows; no K3-reachable output carries a credential",
    verifier: "Core (digest)",
    checks: ["digest match", "absolute 30 d", "idle 24 h (client cli) / 7 d (client tbd, C289)", "route allows owner CLI"],
    acceptedAt: ["Portal gateway → Core (owner-CLI-allowed rows)"],
    revocation: "tealbrick logout or Portal session list deletes the digest", revocationLatency: "immediate", pause: "n/a (person; drafts never act)",
  },
  {
    id: "K4", name: "agent connection key", form: "key_pair", typ: null, prefix: null,
    issuer: "self", issuerKey: "Ed25519 generated on the agent machine", holder: "agent", holderDetail: "TBD / tealbrick CLI agent mode / SDK kits; keychain item tealbrick.agent.<con>",
    storage: ["holder_keychain", "issuer_public_key"], maxLifetimeS: null, oneTime: false,
    audienceRule: "agent assertions: aud = tb:brg:<id>",
    verifier: "deployed bridge, public key from config connections[]",
    checks: ["kid = connection publicKey thumbprint", "con belongs to sub", "connection active", "agent not revoked", "jti not replayed"],
    acceptedAt: ["bridge /oauth/token grant jwt-bearer"],
    revocation: "connection revoke in config", revocationLatency: "≤ 60 s online; ≤ 12 h offline", pause: "issuance continues; calls refused (see K5)",
  },
  {
    id: "K5", name: "agent session (access JWT + rotating refresh)", form: "jwt", typ: TYP.agentSession, prefix: "tbr_",
    issuer: "bridge", issuerKey: "K7 bridge key", holder: "agent", holderDetail: "harness (Claude Desktop / Codex OAuth store) or stdio local relay (memory only, no relay-local token); access token in memory",
    storage: ["holder_memory", "issuer_digest"], maxLifetimeS: 900, oneTime: false,
    audienceRule: "aud = iss = tb:brg:<self>; sub = tb:agt:<id>; con bound",
    verifier: "deployed bridge, own key",
    checks: ["con active in config", "gen equal to config", "sub = the connection's agent", "ws = config workspace", "then gate()"],
    acceptedAt: ["bridge MCP endpoint (Authorization: Bearer)"],
    revocation: "config drops/revokes con or agt; refresh reuse (beyond one retry of the previous token within 30 s) revokes the con chain", revocationLatency: "≤ 60 s online; refresh reuse immediate", pause: "gate() step 1 refuses calls; issuance/refresh continue",
  },
  {
    id: "K6", name: "enrolment code", form: "opaque", typ: null, prefix: "tbe_",
    issuer: "portal", issuerKey: "none (random)", holder: "bridge", holderDetail: "env TB_ENROL_CODE of one bridge, app instance or runtime service (instances redeem through their bridge)",
    storage: ["issuer_digest"], maxLifetimeS: 86400, oneTime: true,
    audienceRule: "bound at issue to {ws, target: bridge | ins_ [+ svc]}",
    verifier: "Core (digest)",
    checks: ["digest match", "unused", "≤ 24 h", "target matches the redeeming party", "instance not paused"],
    acceptedAt: ["Core bridge enrolment", "Core instance enrolment (relayed by the bridge with a bridge assertion)"],
    revocation: "redeemed / expired / superseded by a new code", revocationLatency: "immediate", pause: "refused for a paused instance",
  },
  {
    id: "K7", name: "bridge key", form: "key_pair", typ: null, prefix: null,
    issuer: "self", issuerKey: "Ed25519 generated in the bridge", holder: "bridge", holderDetail: "bridge volume, sealed with TB_KEK (provider-generated, CORE I3)",
    storage: ["holder_sealed_volume", "issuer_public_key"], maxLifetimeS: null, oneTime: false,
    audienceRule: "bridge assertions: aud = tb:portal",
    verifier: "Core (registered public key); apps (slice bridge.keys) for call proofs",
    checks: ["kid = registered bridge key", "htm/htu/bd match", "jti not replayed"],
    acceptedAt: ["Core bridge routes (TB-Assert)"],
    revocation: "re-enrolment with a new K6", revocationLatency: "Core immediate; apps ≤ 60 s via slice", pause: "n/a (the bridge enforces pause)",
  },
  {
    id: "K8", name: "instance key", form: "key_pair", typ: null, prefix: null,
    issuer: "self", issuerKey: "Ed25519 generated in the app instance / runtime service", holder: "app", holderDetail: "app volume, sealed with TB_KEK",
    storage: ["holder_sealed_volume", "issuer_public_key"], maxLifetimeS: null, oneTime: false,
    audienceRule: "instance assertions: aud = tb:brg:<id>",
    verifier: "deployed bridge, config instanceKeys[]",
    checks: ["kid ∈ instanceKeys for (ins, svc)", "htm/htu/bd match", "jti not replayed", "pause: only slice pull + status while paused"],
    acceptedAt: ["bridge internal /tb/v1/* (TB-Assert)"],
    revocation: "re-enrolment / instance deletion", revocationLatency: "≤ 60 s", pause: "assertions accepted only for slice pull and status report",
  },
  {
    id: "K9", name: "workspace config / instance slice", form: "jws", typ: [TYP.config, TYP.slice], prefix: null,
    issuer: "portal", issuerKey: "K12 Portal signing key (standalone: bridge key for slices)", holder: "bridge", holderDetail: "bridge volume (last good config); app DB (last slice, typ tb-slice+jws)",
    storage: ["holder_sealed_volume"], maxLifetimeS: 43200, oneTime: false,
    audienceRule: "config: aud = sub = tb:brg:<id>; slice: aud = sub = tb:ins:<id>",
    verifier: "bridge (Portal key set); app SDK (Portal key set or standalone issuer)",
    checks: ["ws matches", "rev > installed rev", "older than 12 h → fail closed"],
    acceptedAt: ["bridge config pull", "app slice pull from the bridge"],
    revocation: "superseded by a higher rev", revocationLatency: "≤ 60 s", pause: "carries pause state",
  },
  {
    id: "K10", name: "grant (agent→app and companion app→app)", form: "jwt", typ: TYP.grant, prefix: null,
    issuer: "portal", issuerKey: "K12 Portal signing key (standalone: bridge key)", holder: "bridge", holderDetail: "bridge (agent grants); calling app (companion grants, from its slice); agents never",
    storage: ["holder_memory"], maxLifetimeS: 43200, oneTime: false,
    audienceRule: "aud = tb:ins:<target>; cnf.brg = workspace bridge",
    verifier: "bridge verifyGrant before forwarding; app SDK verifyGrant again + call proof",
    checks: ["ws = own workspace", "cnf.brg = workspace bridge", "jti ∉ revoked.jtis", "companion: sub = asserting instance", "app: call proof binds sub/aud/gjti/op/in/ctx"],
    acceptedAt: ["app /tb/v1/ops/<op> (Authorization: Bearer) with TB-Call", "bridge internal companion call"],
    revocation: "not re-minted + revoked.jtis", revocationLatency: "≤ 60 s online; ≤ 12 h offline", pause: "not minted while paused; gate() step 1 refuses",
  },
  {
    id: "K11", name: "person ticket (pur launch | keys)", form: "jwt", typ: TYP.personTicket, prefix: null,
    issuer: "portal", issuerKey: "K12 Portal signing key (standalone: bridge key)", holder: "person", holderDetail: "browser of a K1 person (form POST); never obtainable with K3",
    storage: ["verifier_jti_set"], maxLifetimeS: 120, oneTime: true,
    audienceRule: "launch: aud = tb:ins:<target>, max 60 s; keys: aud = tb:brg:<id>, max 120 s; sub = tb:per:<id>",
    verifier: "app SDK (launch) / bridge key page (keys), Portal key set",
    checks: ["ws matches", "pur matches endpoint", "launch exp − iat ≤ 60", "jti unused (app DB / bridge volume)"],
    acceptedAt: ["https://<bridge>/a/<product>/tb/launch (app SDK)", "https://<bridge>/keys"],
    revocation: "one-time; app UI session ends by slice personNbf", revocationLatency: "app UI sessions ≤ 60 s after the bridge", pause: "not paused (owner access by design)",
  },
  {
    id: "K12", name: "Portal signing key", form: "key_pair", typ: null, prefix: null,
    issuer: "portal", issuerKey: "Ed25519 generated in Core", holder: "portal", holderDetail: "Core DB, sealed with TB_KEK; public in config, slices, TB_PORTAL_KEYS",
    storage: ["issuer_sealed"], maxLifetimeS: null, oneTime: false,
    audienceRule: "n/a (signs K2b, K9, K10, K11; v0.1.58: host plans tb-host-plan+jws)",
    verifier: "n/a",
    checks: ["pending ≥ 24 h before active", "retired private half destroyed", "retired removed after 12 h + 5 min", "standalone: frozen final config; bridge key re-mints grants/slices; owner key (ownerKeys) proves 4 admin ops"],
    acceptedAt: [],
    revocation: "planned rotation (90 d) or compromise procedure", revocationLatency: "compromise: ≤ 60 s online", pause: "n/a",
  },
  {
    id: "K13", name: "host key (v0.1.58, S1-0)", form: "key_pair", typ: null, prefix: null,
    issuer: "self", issuerKey: "Ed25519 generated on the customer server by the host agent; the private half never leaves the box", holder: "host", holderDetail: "root-only 0600 file of the host agent on the server (never in a container, never in the engine)",
    storage: ["holder_host_file", "issuer_public_key"], maxLifetimeS: null, oneTime: false,
    audienceRule: "host assertions: aud = tb:portal; iss = sub = tb:srv:<srv>",
    verifier: "Core (public key pinned at the device-flow approval with scope host)",
    checks: ["kid = pinned host key thumbprint", "server not detached (except the final stop plan and its report)", "htm/htu/bd match", "exp − iat ≤ 60", "jti not replayed"],
    acceptedAt: ["Core host rows (TB-Assert): host.plans, host.report"],
    revocation: "servers.detach (unpairs the key) or a new pairing (S2: signed rotation)", revocationLatency: "Core immediate", pause: "n/a (pause is enforced by the bridge; plans and reports continue)",
  },
  {
    id: "K14", name: "relayed person op (v0.1.64, C326)", form: "jwt", typ: TYP.personOp, prefix: null,
    issuer: "portal", issuerKey: "K12 Portal signing key (never a standalone issuer)", holder: "bridge", holderDetail: "workspace bridge, in memory, only to forward it once to the target app; never returned to the K3 holder, never logged; Core keeps it sealed until the row ends",
    storage: ["issuer_sealed", "verifier_jti_set"], maxLifetimeS: 20, oneTime: true,
    audienceRule: "iss = tb:portal only; aud = tb:ins:<target>; sub = tb:per:<workspace owner>; op ∈ PERSON_OP_RELAY.allow for the target product (write ops only for cli ∈ writeClients); cli ∈ PERSON_OP_RELAY.clients",
    verifier: "app SDK on POST /tb/v1/person-op (Portal keys only; refused in standalone / app-alone mode)",
    checks: ["iss = tb:portal", "ws = own workspace", "aud = own instance", "exp − iat ≤ LIFETIME_S.personOp", "jti unused, then consumed (tb_used_jti) BEFORE the body checks", "slice personNbf ≤ iat", "bd = sha256 hex of the raw body bytes", "(own product, op) ∈ PERSON_OP_RELAY.allow, write ops only for cli ∈ writeClients", "op is an op of audience person in the own manifest (or tb.holds_list / tb.holds_decide)"],
    acceptedAt: ["app private network POST /tb/v1/person-op (header TB-Person-Op), forwarded only by the workspace bridge"],
    revocation: "one-time; not minted for a revoked or idle-expired K3", revocationLatency: "n/a (≤ 60 s life)", pause: "not paused (owner access by design, like K11)",
  },
] as const satisfies readonly CredentialRegistryRow[];

/** v0.1.1 (C30): claims of the signed release index JWS. Closed set. The JWS signs `indexDigest` = digest(index body), so it stays < MAX_JWS_BYTES. */
export interface ReleaseIndexClaims {
  iss: ReleasesRef;
  aud: PortalRef;
  iat: number;
  exp: number;
  schema: "opt2.release-index/v2";
  indexDigest: Sha256Digest;
  releases: number;
  offers: number;
}

// ── v0.1.11 (C62/C63): Portal Root Keys and the key-set statement (CORE §4, CREDENTIALS §9.5) ──
/** Issuer of key-set statements: the offline Portal Root Keys. Not a credential kind: a trust anchor. */
export type PortalRootRef = "tb:portal-root";
/** Audience of key-set statements: every verifier of Portal-signed documents. */
export type PortalKeysAudience = "tb:portal-keys";

/**
 * Claims of a key-set statement (`typ: tb-keyset+jws`, header `kid` = RFC 7638 thumbprint of the signing root key).
 * Closed set. No `exp`, `sub` or `jti`: a statement is superseded only by a higher `seq`.
 * `keys`: 1..8 entries, distinct thumbprints, exactly one `active`; `jwk` = Ed25519 public JWK (`kid`, if present, = its thumbprint).
 */
export interface KeySetStatementClaims {
  iss: PortalRootRef;
  aud: PortalKeysAudience;
  /** monotonic, ≥ 1; +1 per ceremony */
  seq: number;
  /** epoch seconds (informational; ordering is `seq`) */
  iat: number;
  keys: PortalKeyEntry[];
}

/** Refusal codes of the key-set rule (bridge status `rejected[].code`, SDK slice refusal). */
export const KEYSET_REFUSAL = {
  /** bad JWS, unknown root, bad signature, claims not the closed set, malformed keys */
  invalid: "keyset_invalid",
  /** `seq` below the pinned `seq`, or equal `seq` with a different statement */
  rollback: "keyset_rollback",
  /** a document without `portalKeySet` after a statement was pinned */
  missing: "keyset_missing",
} as const;

/** Root set a build pins: dev-channel builds pin `dev`, stable builds pin only `prod` (C63). Selected at build time, never by env. */
export type PortalRootChannel = "dev" | "prod";

/**
 * v0.1.11 (C63): pinned Portal Root Key PUBLIC JWKs (release data; a root change = new spec + bridge/SDK release).
 * `dev`: the dev root pair Platform generated locally (registry/portal-root-keys.dev.json, Platform e19cf98;
 * root-a, root-b). `prod`: empty until the cutover ceremony (air-gapped, CREDENTIALS §9.5).
 */
export const PORTAL_ROOT_KEYS: { dev: Ed25519PublicJwk[]; prod: Ed25519PublicJwk[] } = {
  dev: [
    { kty: "OKP", crv: "Ed25519", x: "IIKwS6eT-LIrtVuNO-2VRoGdYk27nBkG8zG_Ed1dt8Q", kid: "xr8nlOuIDP8GqJOnDvBe6dIc2jwy2T83j2YqlPz6x7A" },
    { kty: "OKP", crv: "Ed25519", x: "d-u0BND48bU6DR38KF4GgHh5hatvEUrIS3WccrmiPIs", kid: "17Gm_IqxFTy4zBA_VgpcCQYN53_Pfh-gLVidSiyJTKg" },
  ],
  prod: [],
};
