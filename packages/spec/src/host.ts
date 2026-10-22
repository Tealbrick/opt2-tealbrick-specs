// Host contract — opt2 spec v0.1.58 (S1-0 "deploy outside Railway", C308). Normative twin: docs/HOST.md.
// The ONE contract both ends build against in S1: Portal Core (pairing, server object, signed plans, reports) and the
// host agent on a customer server (`tealbrick host`, private CLI repo: plan verify, local policy, engine adapter).
// Data and types only: no runtime code. Route rows live in ./routes.ts (servers.*, host.*); the credential (K13 host key,
// host assertion) lives in ./credentials.ts; JSON Schemas: schemas/host-plan.schema.json, schemas/host-report.schema.json.
//
// Threat model (REDTEAM-S1 B2): Core may be compromised. A valid Portal signature proves only that Core made a plan.
// The box therefore enforces a CLOSED local policy (HOST_POLICY, §5 of HOST.md) that no signature can override.

import type { CompactJws } from "./bridge.ts";
import type { Ed25519PublicJwk, PortalRef, ServerId, ServerRef, Sha256Digest, Ulid, WorkspaceId } from "./credentials.ts";
import type { ProductId } from "./manifest.ts";
import type { IsoTime, ReleaseId } from "./routes.ts";

export type { ServerId, ServerRef } from "./credentials.ts";

// ───────────────────────────── limits (seconds, bytes, counts) ─────────────────────────────
export const HOST_LIMITS = {
  /** host assertion: exp − iat (same as every other proof) */
  assertionMaxLifetimeS: 60,
  /** a plan: exp − iat; Core never serves an expired plan; the box refuses one (`expired`) */
  planMaxLifetimeS: 900,
  /** compact JWS bytes of one plan (the key-set statement inside included) */
  planMaxBytes: 65_536,
  planMaxActions: 16,
  /** host.plans: Core holds the request up to `wait` seconds, then answers 304. Default 50, max 60 (transport cap 75 s). */
  longpollWaitDefaultS: 50,
  longpollWaitMaxS: 60,
  /** host.report doubles as the heartbeat */
  reportIntervalS: 30,
  /** Core shows the server `offline` after this long without a report (3 missed heartbeats) */
  offlineAfterS: 90,
  /** request body of one host.report */
  reportMaxBytes: 65_536,
  reportMaxServices: 64,
  reportMaxResults: 64,
  /** Core down (HOST.md §7): reports the box keeps locally, oldest dropped first */
  reportQueueMax: 500,
  envMaxEntries: 64,
  envValueMaxBytes: 8_192,
  volumesMaxPerService: 4,
  stopGraceMaxS: 120,
  machineLabelMax: 64,
  /** a box ignores a plan whose `exp` is further away than this (clock skew guard) */
  clockLeewayS: 30,
} as const;

/** String rules shared by Core (when it builds a plan) and the box (when it checks one). JS regex syntax, `u` flag. */
export const HOST_PATTERNS = {
  /** single DNS label, `tb-` prefix: the box creates only these names, and only these go into TB_OWN_INFRA_ORIGINS */
  serviceName: "^tb-[a-z0-9-]{1,40}$",
  /** "main" = the release's main image; otherwise a manifest `runtime.services[].id` */
  component: "^(main|[a-z0-9][a-z0-9_-]{0,39})$",
  volumeName: "^[a-z0-9][a-z0-9-]{0,39}$",
  /** absolute container path; no `..` segment; never a system path (HOST.md §5.4) */
  mountPath: "^/(?!(proc|sys|dev|run|etc|boot|root|var/run|var/lib/docker)(/|$))(?!.*(^|/)\\.\\.(/|$))[A-Za-z0-9._/-]{1,200}$",
  envName: "^[A-Z_][A-Z0-9_]{0,63}$",
  /** `name@sha256:<64 hex>` — a tag alone is never accepted */
  imageByDigest: "^[a-z0-9][a-z0-9._/-]{0,200}(:[A-Za-z0-9._-]{1,128})?@sha256:[a-f0-9]{64}$",
  healthPath: "^/[A-Za-z0-9._~/-]{0,200}$",
  /** one public host name (lower case, ≥ 2 labels) */
  publicHost: "^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$",
  enrolCode: "^tbe_[A-Za-z0-9_-]{43}$",
} as const;

// ───────────────────────────── server object (HOST.md §3) ─────────────────────────────
/**
 * pending  = paired, no report yet · online = last report < offlineAfterS ago, firewall ok, no service failed ·
 * degraded = online but the firewall check failed, a service is `failed` or its health is `failing` ·
 * offline  = no report for offlineAfterS · detached = servers.detach ran (terminal; a new pairing makes a new `srv_`).
 */
export type ServerState = "pending" | "online" | "degraded" | "offline" | "detached";

export interface HostFacts {
  os: string;
  kernel: string;
  arch: "x86_64" | "aarch64";
  cpuCount: number;
  memoryMb: number;
  diskGb: number;
  diskFreeGb: number;
  publicIpv4: string | null;
  publicIpv6: string | null;
  /** images = engine component → `name@sha256:…` as running (api, edge, postgres, redis; dashboard absent with --no-ui) */
  engine: { name: "openship"; version: string; images: Record<string, string> };
  agentVersion: string;
}

export type HostServiceState = "running" | "starting" | "stopped" | "failed";
export type HostServiceHealth = "ok" | "failing" | "none";
export interface HostServiceStatus {
  serviceName: string;
  state: HostServiceState;
  /** image as running (`name@sha256:…`) */
  image: string;
  health: HostServiceHealth;
  restarts: number;
}

export interface HostFirewallStatus {
  ok: boolean;
  /** sha256 of the agent's canonical rule listing (lets Core and QA see a change) */
  rulesDigest: Sha256Digest;
}

export interface Server {
  id: ServerId;
  /** the ONE workspace this server runs (one engine stack per workspace); null after detach */
  workspaceId: WorkspaceId | null;
  /** the owner's name for it; default = machine_label of the pairing request */
  label: string;
  state: ServerState;
  facts: HostFacts;
  /** RFC 7638 thumbprint of the pinned host key (K13) */
  keyThumbprint: string;
  lastReportAt: IsoTime | null;
  /** from the last report */
  lastAppliedSeq: number;
  services: HostServiceStatus[];
  firewall: HostFirewallStatus | null;
  createdAt: IsoTime;
  detachedAt: IsoTime | null;
}
export interface ServerList { items: Server[] }
export interface ServerRefInput { srv: ServerId }

// ───────────────────────────── pairing = device flow scope `host` (HOST.md §2) ─────────────────────────────
/** `device.start` body for scope host. The key pair is generated ON the box; only the public half is sent. */
export interface DeviceStartHostInput {
  scope: "host";
  client_id: "tealbrick-host";
  /** 1..64, shown on the approval page */
  machine_label: string;
  host_public_key: Ed25519PublicJwk;
  /** shown on the approval page; Core stores them as the server's first facts */
  facts: HostFacts;
}
/** `device.token` result for scope host: no token. From now on the box signs K13 host assertions. */
export interface DeviceHostTokenResult {
  scope: "host";
  server_id: ServerId;
  workspace_id: WorkspaceId;
  /** thumbprint of the key Core pinned (the box checks it equals its own) */
  key_thumbprint: string;
}
/** The host part of a `DeviceRequest` (device.lookup) — what the approval page shows. */
export interface DeviceRequestHost {
  publicKeyThumbprint: string;
  facts: HostFacts;
}

// ───────────────────────────── plans (signed by Core, CHECKED by the box — HOST.md §4) ─────────────────────────────
/** host.plans query. `after` = the box's last applied seq (0 before the first plan). */
export interface HostPlansQuery { after: number; wait?: number }
/**
 * host.plans answer: `200 application/jose` with ONE plan (`typ: tb-host-plan+jws`): the lowest unexpired seq > `after`;
 * or `304` when none arrived within `wait`. The box applies (or refuses) it, reports, and polls again with the new `after`.
 */
export type HostPlanJws = CompactJws;

/**
 * Payload of a `tb-host-plan+jws`. JOSE header = exactly {alg: "EdDSA", typ: "tb-host-plan+jws", kid}, `kid` = RFC 7638
 * thumbprint of the Portal signing key (K12) that signed it. Trust = the config/slice rule (CREDENTIALS §9.5): the statement in
 * `portalKeySet` verifies under a pinned root (seq never goes back), and the plan is signed by an `active` or `pending` key
 * of it (`@opt2-tealbrick/manifest` trustedPortalKeys → `signers`). Closed set: schemas/host-plan.schema.json
 * (`additionalProperties: false` at every level).
 */
export interface HostPlanClaims {
  v: 1;
  iss: PortalRef;
  sub: ServerRef;
  aud: ServerRef;
  /** must equal this box's paired server id */
  server: ServerId;
  /** must equal this box's paired workspace */
  workspace: WorkspaceId;
  /** strictly increasing per server, starts at 1; the box refuses seq ≤ its last applied seq */
  seq: number;
  iat: number;
  /** exp − iat ≤ HOST_LIMITS.planMaxLifetimeS */
  exp: number;
  jti: Ulid;
  /** REQUIRED: the CURRENT root-signed key-set statement (`tb-keyset+jws`); verified against the roots pinned in the agent build */
  portalKeySet: CompactJws;
  /** applied in order; 1..planMaxActions */
  actions: HostAction[];
}

export type HostAction = HostEnsureServiceAction | HostStopServiceAction;
/** create the service, or replace it when the spec differs (same serviceName) */
export interface HostEnsureServiceAction { kind: "ensure_service"; service: HostServiceSpec }
/** stop the container; NEVER removes a volume in S1 (HOST_POLICY.neverDeleteVolumes) */
export interface HostStopServiceAction { kind: "stop_service"; serviceName: string }
/**
 * Reserved for S2+ and refused by S1 boxes (`schema_invalid`): `ensure_agent_runtime` = a CONTAINER unit in the workspace
 * stack with an egress policy (REDTEAM M9, C306 R7). Host-level units are never part of this contract.
 */
export const HOST_RESERVED_ACTION_KINDS = ["ensure_agent_runtime"] as const;

/** CLOSED subset of Core's provider DeployPlan. Anything not listed is refused (`schema_invalid`). */
export interface HostServiceSpec {
  serviceName: string;
  /** which image of the release this service runs: "main" or the manifest service id (companion) */
  component: string;
  /** looked up by the box in the root-signed release index (HOST_POLICY.imageFromIndex), never trusted from Core */
  release: { product: ProductId; releaseId: ReleaseId; image: string; manifestDigest: Sha256Digest | null };
  /** names ⊆ the declared names (HOST_POLICY.envAllowlist); values public only (HOST_SECRET_VALUE_PATTERNS) */
  env: Record<string, string>;
  /** names only: the box generates each value once (32 random bytes, base64url), keeps it, never reports it */
  generatedSecrets: string[];
  /** env value = another tb- service's env value IN THIS STACK (generated secrets included); the box renders it */
  serviceRefs?: Record<string, { serviceName: string; env: string }>;
  /** one-time enrolment code (K6, `tbe_…`, ≤ 24 h): the box sets it as TB_ENROL_CODE; never logged, never reported */
  enrolCode: string | null;
  /** container port; the box sets PORT to it */
  port: number | null;
  /** true only for the workspace bridge (release kind `bridge`, component main) */
  publicDomain: boolean;
  /** bridge only (C59: the key page has its own origin); both inside the box's configured workspace zone */
  publicHosts?: { main: string; keys: string };
  healthPath: string | null;
  /** seconds between SIGTERM and SIGKILL (bridge: drain, C131); null = engine default */
  stopGraceSeconds: number | null;
  /** NAMED volumes only (the box names them `<stack>_<serviceName>_<name>`); no host path ever */
  volumes: { name: string; mountPath: string; purpose: "data" | "backup" }[];
  resources: { cpu?: number; memoryMb?: number; volumeGb?: number } | null;
}

/**
 * Engine/compose keys that can never appear anywhere in a plan (REDTEAM B2(a), B3). The closed schema already refuses
 * every unknown key; this list exists so tests can name the dangerous ones (conformance H-8).
 */
export const HOST_FORBIDDEN_KEYS = [
  "privileged", "cap_add", "cap_drop", "devices", "network_mode", "networks", "pid", "ipc", "uts", "userns_mode",
  "extra_hosts", "user", "sysctls", "security_opt", "entrypoint", "command", "labels", "volumes_from", "binds",
  "hostPath", "host_path", "tmpfs", "ulimits", "cgroup_parent", "runtime", "compose", "build", "dockerfile", "source",
] as const;

/**
 * Env names Core may send in `env` that no manifest declares (the platform's own variables). Each value has a fixed form
 * that the box checks; anything else in `env` must be declared by the release (HOST_POLICY.envAllowlist).
 */
export const HOST_PLATFORM_ENV = {
  TB_INSTANCE_ID: "^ins_[0-9A-HJKMNP-TV-Z]{26}$",
  TB_SERVICE: "^[a-z0-9][a-z0-9_-]{0,39}$",
  /** the bridge inside this stack: `http://<tb- service>:<port>` */
  TB_BRIDGE_URL: "^http://tb-[a-z0-9-]{1,40}:[0-9]{1,5}$",
  /** JSON `{"keys":[Ed25519 public JWK, …]}`, 1..8 keys (informational for apps; trust = key-set statement) */
  TB_PORTAL_KEYS: "json:portal-keys",
  TB_PORTAL_URL: "^https://[a-z0-9.-]+(:[0-9]{1,5})?$",
  /** a volume mountPath of this service, or a path below it */
  TB_DATA_DIR: "path:volume",
  TB_BACKUP_DIR: "path:volume",
} as const;
export type HostPlatformEnvName = keyof typeof HOST_PLATFORM_ENV;

/** Env names only the BOX sets. A plan that sends one in `env` is refused (`env_not_declared`). */
export const HOST_BOX_OWNED_ENV = [
  /** from `port` */
  "PORT",
  /** from `enrolCode` */
  "TB_ENROL_CODE",
  /** bridge: exact origins of the tb- services the agent created in this stack (HOST_POLICY.ownInfraOrigins) */
  "TB_OWN_INFRA_ORIGINS",
  /** bridge: the stable advertised internal host (= its serviceName) */
  "TB_INTERNAL_HOST",
] as const;

/**
 * A value is "secret-like" (refused, `secret_like_value`) when it matches any of these (JS regex, no flags). Values of
 * generated secrets and service refs never travel in a plan, so they are not checked.
 */
export const HOST_SECRET_VALUE_PATTERNS = [
  "^tb[a-z]{1,3}_[A-Za-z0-9_-]{20,}$",
  "^(sk|rk)_(live|test)_[A-Za-z0-9]{8,}",
  "^whsec_[A-Za-z0-9]{8,}",
  "^gh[pousr]_[A-Za-z0-9]{20,}",
  "^github_pat_[A-Za-z0-9_]{20,}",
  "^glpat-[A-Za-z0-9_-]{16,}",
  "^xox[abprs]-[A-Za-z0-9-]{10,}",
  "^sk-[A-Za-z0-9_-]{20,}",
  "^npm_[A-Za-z0-9]{30,}",
  "^AKIA[0-9A-Z]{16}$",
  "^eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.",
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  "^[a-z][a-z0-9+.-]*://[^/:@\\s]+:[^/@\\s]+@",
] as const;

/**
 * The local policy (HOST.md §5). The box applies each rule to every plan regardless of the signature. Ids are stable;
 * conformance rows (HOST_CONFORMANCE) refer to them.
 */
export const HOST_POLICY = {
  verifySignature: "Plan JWS verifies under a key listed in the `portalKeySet` statement, and that statement verifies under a root pinned in the agent build (dev or prod channel, chosen at build time); key-set seq never goes back (bad_signature).",
  bindServer: "`server` and `aud`/`sub` equal this box; `workspace` equals the paired workspace (wrong_server).",
  monotonicSeq: "`seq` > the last applied seq, kept on the box across restarts (replayed).",
  notExpired: "now ≤ exp + clockLeewayS, iat ≤ now + clockLeewayS, exp − iat ≤ planMaxLifetimeS (expired).",
  closedSchema: "The payload validates against schemas/host-plan.schema.json (closed at every level, unknown action kinds refused) and is ≤ planMaxBytes (schema_invalid).",
  imageFromIndex: "The box fetches the release index (index.json + index.jws) itself and verifies it with the release keys pinned in the agent build. The entry `release.releaseId` exists, its product equals `release.product`, its channel equals the box's configured channel (default stable), its `manifestDigest` equals `release.manifestDigest`, and `release.image` equals: entry.image (component main), or entry.services[id].image, or the digest-pinned image of manifest runtime.services[id] (manifest fetched from entry.manifestUrl, digest checked) (not_in_index). Index unreachable → nothing is applied (index_unavailable).",
  noDowngrade: "For a serviceName the box already runs, a lower release version (from the index) is refused, except the ONE version the box itself ran for that serviceName right before its current one (health-gated rollback, C213) (downgrade_refused).",
  envAllowlist: "Every `env` name is declared by the release for that component (manifest runtime.env / runtime.services[id].env names; bridge: index runtime.env names) or is a HOST_PLATFORM_ENV name with a value of its form; HOST_BOX_OWNED_ENV names are never accepted (env_not_declared).",
  noSecretValues: "No `env` value matches HOST_SECRET_VALUE_PATTERNS (secret_like_value).",
  generatedNotSent: "The engine config is GENERATED by the agent from HostServiceSpec; no compose file or engine spec from outside is ever passed to the engine; named volumes only; HOST_FORBIDDEN_KEYS never set.",
  neverDeleteVolumes: "`stop_service` and servers.detach never delete a volume in S1. No action deletes data.",
  ownInfraOrigins: "After every applied change the agent rewrites the bridge's TB_OWN_INFRA_ORIGINS (exact `http://<serviceName>:<port>` origins of the tb- app services it created in this stack, comma-separated, sorted) and TB_INTERNAL_HOST (= the bridge serviceName), then restarts the bridge (the allowlist is read at boot).",
  firewall: "Agent-owned rules, re-checked before every report and on every Docker network create event: traffic from any Docker bridge (br-+, docker0) to the host is DROPped by default (INPUT, IPv4 and IPv6), including :22, the engine API, other stacks' networks, IPv6 host addresses and 169.254.169.254; explicit allows only for the engine's own network to what it needs (firewall_failed when a check fails; the report says ok:false).",
  coreDown: "While Core is unreachable the box keeps the last applied state running, queues ≤ reportQueueMax reports, applies nothing without a fresh valid plan and takes no destructive action (HOST.md §7).",
  publicHosts: "`publicDomain` true only for release kind bridge, component main; then `publicHosts` is present, main ≠ keys, both end with \".\" + the box's configured workspace zone; bridge env values of the index runtime sources public-url / public-url-keys equal `https://<main>` / `https://<keys>` (schema_invalid).",
} as const;
export type HostPolicyRule = keyof typeof HOST_POLICY;

// ───────────────────────────── reports (metadata only — HOST.md §6) ─────────────────────────────
export type HostErrorCode =
  | "bad_signature"
  | "wrong_server"
  | "replayed"
  | "expired"
  | "schema_invalid"
  | "not_in_index"
  | "index_unavailable"
  | "downgrade_refused"
  | "env_not_declared"
  | "secret_like_value"
  | "engine_error"
  | "health_timeout"
  | "firewall_failed";
export const HOST_ERROR_CODES = [
  "bad_signature", "wrong_server", "replayed", "expired", "schema_invalid", "not_in_index", "index_unavailable",
  "downgrade_refused", "env_not_declared", "secret_like_value", "engine_error", "health_timeout", "firewall_failed",
] as const satisfies readonly HostErrorCode[];

/** One result per action of an applied/refused plan. `index` = action index; -1 = the whole plan was refused before any action. */
export interface HostActionResult { seq: number; index: number; ok: boolean; code?: HostErrorCode }

/** host.report body. Also the heartbeat (every reportIntervalS). No log content, no env values, no secrets. */
export interface HostReport {
  server: ServerId;
  at: IsoTime;
  lastAppliedSeq: number;
  /** results not yet acknowledged by Core (a result is sent until a report carrying it was answered 200) */
  results: HostActionResult[];
  services: HostServiceStatus[];
  facts: HostFacts;
  firewall: HostFirewallStatus;
  /** reports still queued on the box after this one (Core was down) */
  queued?: number;
}
export interface HostReportAck {
  accepted: true;
  serverState: ServerState;
  /** lowest deliverable plan seq > lastAppliedSeq, or null — the box may poll host.plans at once */
  pendingSeq: number | null;
}

// ───────────────────────────── conformance rows (HOST.md §9; probes: QA + host-agent leads) ─────────────────────────────
export interface HostConformanceRow {
  id: `H-${number}`;
  title: string;
  /** what the test does */
  given: string;
  /** what must happen (the assertion) */
  expect: string;
  rule: HostPolicyRule;
  /** who runs it: the host agent's own unit tests, the probe suite on a real box, or both */
  target: "agent-unit" | "box-probe" | "both";
}
export const HOST_CONFORMANCE = [
  { id: "H-1", title: "bad signature refused", rule: "verifySignature", target: "agent-unit",
    given: "A plan signed by a key not in the key-set statement; one with a flipped signature byte; one whose statement is signed by an unpinned root.",
    expect: "Nothing applied; result {index: -1, ok: false, code: bad_signature}; lastAppliedSeq unchanged." },
  { id: "H-2", title: "wrong server refused", rule: "bindServer", target: "agent-unit",
    given: "A valid plan for another srv_ (server and aud), and one for this server but another workspace.",
    expect: "Nothing applied; code wrong_server." },
  { id: "H-3", title: "replay (same seq) refused", rule: "monotonicSeq", target: "agent-unit",
    given: "The last applied plan delivered again, and a plan with a lower seq; also after an agent restart.",
    expect: "Nothing applied; code replayed; the seq survives a restart." },
  { id: "H-4", title: "expired refused", rule: "notExpired", target: "agent-unit",
    given: "A plan with exp < now − clockLeewayS; one with exp − iat > planMaxLifetimeS; one with iat in the future beyond the leeway.",
    expect: "Nothing applied; code expired." },
  { id: "H-5", title: "image not in index refused", rule: "imageFromIndex", target: "agent-unit",
    given: "A plan whose release.image digest is not the index entry's (main), not in entry.services, not in the digest-checked manifest; one whose manifestDigest differs from the entry; one with a tag-only image.",
    expect: "Nothing applied; code not_in_index (tag-only: schema_invalid)." },
  { id: "H-6", title: "downgrade refused", rule: "noDowngrade", target: "agent-unit",
    given: "The box runs version N of a service (after N−1). Plans for N−2 and for N−1.",
    expect: "N−2 refused downgrade_refused; N−1 (the version it ran right before) accepted once." },
  { id: "H-7", title: "undeclared env name refused", rule: "envAllowlist", target: "agent-unit",
    given: "A plan with env NODE_OPTIONS (undeclared), one with TB_OWN_INFRA_ORIGINS (box-owned), one with TB_BRIDGE_URL=http://evil.example:80; a declared name whose value is `sk_live_…` (secret_like_value).",
    expect: "Nothing applied; env_not_declared for the first three, secret_like_value for the last." },
  { id: "H-8", title: "namespace escape refused (REDTEAM B3)", rule: "closedSchema", target: "both",
    given: "Plans that carry network_mode: container:openship-edge, pid: container:<engine api>, and any other HOST_FORBIDDEN_KEYS key, at service level and nested; then on a real box: no container of the stack shares a namespace with the edge or the API (docker inspect).",
    expect: "Every plan refused schema_invalid; on the box no tb- container has a container:/host network, pid or ipc mode." },
  { id: "H-9", title: "stop keeps the volume", rule: "neverDeleteVolumes", target: "both",
    given: "A running service with data in its volume; plan stop_service; then servers.detach (final stop plan).",
    expect: "Container stopped; the named volume and its data still exist; no volume delete call reached the engine." },
  { id: "H-10", title: "TB_OWN_INFRA_ORIGINS matches the running tb- services", rule: "ownInfraOrigins", target: "both",
    given: "Deploy bridge + Knowledge (main + companions), then stop one service.",
    expect: "After each change the bridge env TB_OWN_INFRA_ORIGINS equals exactly the http://<serviceName>:<port> origins of the running tb- app services of this stack (sorted), TB_INTERNAL_HOST = the bridge serviceName, and the bridge restarted." },
  { id: "H-11", title: "firewall probe from an app network", rule: "firewall", target: "box-probe",
    given: "From a container on the stack network (and from a stack created AFTER the agent started): connect to host :22, the engine API port, another stack's container IP, the host's IPv6 address, 169.254.169.254, and the edge with Host: localhost.",
    expect: "Every connection fails (DROP/REJECT); the report carries firewall.ok true and an unchanged rulesDigest; breaking a rule makes the next report ok:false (firewall_failed)." },
] as const satisfies readonly HostConformanceRow[];
