// Host contract — opt2 spec v0.1.58 (S1-0 "deploy outside Railway", C308). Normative twin: docs/HOST.md.
// The ONE contract both ends build against in S1: Portal Core (pairing, server object, signed plans, reports) and the
// host agent on a customer server (`tealbrick host`, private CLI repo: plan verify, local policy, engine adapter).
// Data and types only: no runtime code. Route rows live in ./routes.ts (servers.*, host.*); the credential (K13 host key,
// host assertion) lives in ./credentials.ts; JSON Schemas: schemas/host-plan.schema.json, schemas/host-report.schema.json.
//
// Threat model: Core may be compromised. A valid Portal signature proves only that Core made a plan.
// The box therefore enforces a CLOSED local policy (HOST_POLICY, HOST.md §5) that no signature can override: every value the
// box can derive itself (names, ports, paths, platform env, public URLs) it derives itself and compares; what is left for Core
// to choose is the release (checked against the root-signed index), the owner's setting values (public, non-secret) and the
// one-time enrolment code.

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
  /** the box refuses a verified plan whose seq is more than this above its lastSeq (`seq_out_of_range`) */
  seqMaxJump: 1_000,
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
  /** clock skew the box tolerates on iat/exp */
  clockLeewayS: 30,
  /** the box keeps this much for the engine + agent and clamps `resources` to the rest (HOST_POLICY.resources) */
  reserveMemoryMb: 1_024,
  reserveCpu: 0.5,
} as const;

/** String rules shared by Core (when it builds a plan) and the box (when it checks one). JS regex syntax (Ajv `u` flag). */
export const HOST_PATTERNS = {
  /** single DNS label, `tb-` prefix, ≤ 60 chars; and exactly HOST_POLICY.serviceIdentity's derived name */
  serviceName: "^tb-[a-z0-9-]{1,57}$",
  /** a companion = the manifest `runtime.services[].id` (manifest rule); the release's main image has component null */
  componentId: "^(?!tb-)[a-z][a-z0-9-]{1,31}$",
  /** = the manifest volume id rule (snakeId) or "data" */
  volumeName: "^[a-z0-9][a-z0-9_-]{0,39}$",
  /** absolute, 1..8 segments, no empty / "." / ".." segment (no segment starts with "."), never a system path */
  mountPath: "^(?!/(proc|sys|dev|run|etc|boot|root|bin|sbin|lib|lib32|lib64|usr|var/run|var/lib/docker|var/lib/containerd)(/|$))(/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}){1,8}$",
  envName: "^[A-Z_][A-Z0-9_]{0,63}$",
  /** `registry[:port]/path[:tag]@sha256:<64 hex>` — a tag alone is never accepted */
  imageByDigest: "^[a-z0-9][a-z0-9._-]*(:[0-9]{1,5})?(/[a-z0-9._-]+)*(:[A-Za-z0-9._-]{1,128})?@sha256:[a-f0-9]{64}$",
  /** "/" or 1..8 segments, none empty or starting with "." (no "//", no ".."), never a URL */
  healthPath: "^(/|(/[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,63}){1,8}/?)$",
  /** one public host name (lower case, ≥ 2 labels) */
  publicHost: "^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$",
  enrolCode: "^tbe_[A-Za-z0-9_-]{43}$",
} as const;

// ───────────────────────────── server object (HOST.md §3) ─────────────────────────────
/**
 * pending  = paired, no report yet · online = last report < offlineAfterS ago, firewall ok, no service failed ·
 * degraded = online but the firewall check failed, a service is `failed` or its health is `failing`, or the agent stopped a
 *            container that does not match the box allowlist ·
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

/** Why the agent stopped a container that does not match the box allowlist (forbidden runtime settings). */
export type HostEscapeReason = "namespace_mode" | "privileged" | "capabilities" | "devices" | "docker_sock" | "host_bind";
/**
 * Containment: every report cycle the agent lists ALL containers on the
 * box; one outside its allowlist (the engine's own containers by name + image digest, and the tb- services it created) that
 * uses a container:/host network, pid or ipc mode, privileged, added capabilities, devices, a docker.sock or host-path bind
 * is stopped (`docker stop`, data kept) and reported here until Core acknowledged one report carrying it.
 */
export interface HostEscapeEvent {
  /** the container name as Docker shows it (≤ 128) */
  container: string;
  image: string;
  reasons: HostEscapeReason[];
  stoppedAt: IsoTime;
  /** false when `docker stop` failed (the agent retries every cycle) */
  stopped: boolean;
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
  /** from the last report: the highest plan seq the box decided (applied or refused after a valid signature) */
  lastSeq: number;
  services: HostServiceStatus[];
  firewall: HostFirewallStatus | null;
  /** containers the agent stopped because they did not match the box allowlist, newest first (Core keeps the last 20); any one makes the state `degraded` */
  escapes: HostEscapeEvent[];
  createdAt: IsoTime;
  detachedAt: IsoTime | null;
  /** v0.1.60: the mode of the detach; null while attached */
  detachMode: HostDetachMode | null;
}
/** servers.list query: `ws` = only the server of that workspace (detached servers keep workspaceId null and are listed without `ws`). */
export interface ServerListInput { ws?: WorkspaceId }
export interface ServerList { items: Server[] }
export interface ServerRefInput { srv: ServerId }
/**
 * v0.1.60: how a server is detached. `leave_running` (default) = nothing is stopped: the apps keep running on the owner's server
 * and Portal no longer manages them; `stop` = every service is stopped, volumes kept. Neither mode deletes data.
 */
export type HostDetachMode = "leave_running" | "stop";
export const HOST_DETACH_MODES = ["leave_running", "stop"] as const satisfies readonly HostDetachMode[];
export const HOST_DETACH_DEFAULT: HostDetachMode = "leave_running";
/** servers.detach input; `mode` absent = HOST_DETACH_DEFAULT */
export interface ServerDetachInput { srv: ServerId; mode?: HostDetachMode }

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
/** host.plans query. `after` = the box's lastSeq (0 before the first plan). */
export interface HostPlansQuery { after: number; wait?: number }
/**
 * host.plans answer: `200 application/jose` with ONE plan (`typ: tb-host-plan+jws`): the lowest unexpired seq > `after`;
 * or `304` when none arrived within `wait`. The box decides it (apply or refuse), reports, and polls again with the new `after`.
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
  /** strictly increasing per server, starts at 1; HOST_POLICY.monotonicSeq */
  seq: number;
  iat: number;
  /** exp − iat ≤ HOST_LIMITS.planMaxLifetimeS */
  exp: number;
  jti: Ulid;
  /** REQUIRED: the CURRENT root-signed key-set statement (`tb-keyset+jws`); verified against the roots pinned in the agent build */
  portalKeySet: CompactJws;
  /** detach (HOST_POLICY.finalPlan): present only on the final plan, always with `detach`; then the box refuses every later plan */
  final?: true;
  /** v0.1.60: REQUIRED with `final`. leave_running: `actions` is empty (a release notice); stop: only stop_service actions */
  detach?: { mode: HostDetachMode };
  /** applied in order; 1..planMaxActions (final plan: 0 for leave_running, 0..planMaxActions stop_service for stop) */
  actions: HostAction[];
}

export type HostAction = HostEnsureServiceAction | HostStopServiceAction;
/** create the service, or replace it when the spec differs (same serviceName, same identity — HOST_POLICY.serviceIdentity) */
export interface HostEnsureServiceAction { kind: "ensure_service"; service: HostServiceSpec }
/** stop the container; NEVER removes a volume in S1 (HOST_POLICY.neverDeleteVolumes) */
export interface HostStopServiceAction { kind: "stop_service"; serviceName: string }
/**
 * Reserved for S2+ and refused by S1 boxes (`schema_invalid`): `ensure_agent_runtime` = a CONTAINER unit in the workspace
 * stack with an egress policy. Host-level units are never part of this contract.
 */
export const HOST_RESERVED_ACTION_KINDS = ["ensure_agent_runtime"] as const;

/** CLOSED subset of Core's provider DeployPlan. Anything not listed is refused (`schema_invalid`). */
export interface HostServiceSpec {
  /** = HOST_POLICY.serviceIdentity: ("tb-" + product + (component ? "-" + component : "")) cut to 60 chars */
  serviceName: string;
  /** null = the release's main image; otherwise the manifest `runtime.services[].id` (a companion) */
  component: string | null;
  /** looked up by the box in the root-signed release index (HOST_POLICY.imageFromIndex), never trusted from Core */
  release: { product: ProductId; releaseId: ReleaseId; image: string; manifestDigest: Sha256Digest | null };
  /** names declared by the release (HOST_POLICY.envAllowlist), values checked (HOST_POLICY.manifestMatch, noSecretValues) */
  env: Record<string, string>;
  /** names only (declared `generate: secret` / `provider-secret`, or TB_KEK): the box generates each value once and keeps it */
  generatedSecrets: string[];
  /**
   * Env values the BOX fills from another service of the SAME workspace stack. Key = the env name in THIS service; value =
   * `{serviceName, env}` of the SOURCE service: `serviceName` is a tb- service the agent created in this workspace stack,
   * `env` is the name of a variable that source service holds on the box (one of its generatedSecrets, or an env value of
   * its current spec). Resolved on the box from values the box holds; never a value from outside the box, never sent back.
   * Must match the manifest's whole-value `{{services.<id>.env.<NAME>}}` entry exactly (HOST_POLICY.manifestMatch).
   */
  serviceRefs?: Record<string, { serviceName: string; env: string }>;
  /** one-time enrolment code (K6, `tbe_…`, ≤ 24 h): the box sets it as TB_ENROL_CODE; never logged, never reported */
  enrolCode: string | null;
  /** = the release's declared port (HOST_POLICY.manifestMatch); the box sets PORT to it */
  port: number | null;
  /** true only for the workspace bridge (release kind `bridge`, component null) */
  publicDomain: boolean;
  /** bridge only (C59: the key page has its own origin): exactly HOST_POLICY.publicHosts */
  publicHosts?: { main: string; keys: string };
  /** = the release's declared health path, or null (a companion waiting for a key, C296) */
  healthPath: string | null;
  /** seconds between SIGTERM and SIGKILL (bridge: drain, C131); null = engine default */
  stopGraceSeconds: number | null;
  /** NAMED volumes only, at the release's declared mount paths; the box names them `<stack>_<serviceName>_<name>` */
  volumes: { name: string; mountPath: string; purpose: "data" | "backup" }[];
  /** a request; the box clamps it (HOST_POLICY.resources) */
  resources: { cpu?: number; memoryMb?: number; volumeGb?: number } | null;
}

/**
 * Engine/compose keys that can never appear anywhere in a plan (closed format). The closed schema already refuses
 * every unknown key; this list exists so tests can name the dangerous ones (conformance H-8).
 */
export const HOST_FORBIDDEN_KEYS = [
  "privileged", "cap_add", "cap_drop", "devices", "network_mode", "networks", "pid", "ipc", "uts", "userns_mode",
  "extra_hosts", "user", "sysctls", "security_opt", "entrypoint", "command", "labels", "volumes_from", "binds",
  "hostPath", "host_path", "tmpfs", "ulimits", "cgroup_parent", "runtime", "compose", "build", "dockerfile", "source",
] as const;

/**
 * Platform env names Core may send in `env` that no manifest declares. The box checks each value against what it derives
 * itself; any other difference → `manifest_mismatch`.
 */
export const HOST_PLATFORM_ENV = {
  /** the instance id; the same for every service of one release instance on this box (pinned at first create) */
  TB_INSTANCE_ID: "^ins_[0-9A-HJKMNP-TV-Z]{26}$",
  /** = `component` (companions only) */
  TB_SERVICE: "=component",
  /** = the mountPath of the service's data volume */
  TB_DATA_DIR: "=dataMountPath",
  /** log level */
  TB_LOG_LEVEL: "^(debug|info|warn|error)$",
  /** = the mountPath of the backup volume when the spec carries one, else TB_DATA_DIR + "/backup" (Core sends one volume per service, C28) */
  TB_BACKUP_DIR: "=backupMountPath",
} as const;
export type HostPlatformEnvName = keyof typeof HOST_PLATFORM_ENV;
/** Generated-secret names allowed for every component without a manifest declaration (Core's sealing key per service). */
export const HOST_PLATFORM_GENERATED = ["TB_KEK"] as const;

/**
 * Env names only the BOX sets (it renders them itself). A plan that sends one in `env`, `generatedSecrets` or as a
 * `serviceRefs` key is refused (`env_not_declared`). The bridge's index runtime.env entries with source `portal`,
 * `public-url` or `public-url-keys` are box-rendered too (TB_PORTAL_URL, TB_PUBLIC_URL, TB_KEYS_PUBLIC_URL today).
 */
export const HOST_BOX_OWNED_ENV = {
  /** from `port` */
  PORT: "port",
  /** from `enrolCode` */
  TB_ENROL_CODE: "enrolCode",
  /** bridge: exact origins of the tb- app services the agent created in this stack (HOST_POLICY.ownInfraOrigins) */
  TB_OWN_INFRA_ORIGINS: "ownInfraOrigins",
  /** bridge: its own serviceName — the HOSTNAME form (advertise only; bridge PR #17: an IP value = bind + advertise) */
  TB_INTERNAL_HOST: "bridgeServiceName",
  /** the Portal URL the box paired with (install-time config), never from a plan */
  TB_PORTAL_URL: "pairedPortalUrl",
  /** `{"keys":[…]}` = the public keys of the key-set statement the box verified (informational for apps) */
  TB_PORTAL_KEYS: "verifiedKeySet",
  /** apps: `http://<bridge serviceName>:<bridge index runtime.internalPort>` of the bridge this box runs (the internal surface; Core records the same URL) */
  TB_BRIDGE_URL: "bridgeUrl",
  /** bridge: `https://<publicHosts.main>` / `https://<publicHosts.keys>` */
  TB_PUBLIC_URL: "publicHosts.main",
  TB_KEYS_PUBLIC_URL: "publicHosts.keys",
} as const;
export type HostBoxOwnedEnvName = keyof typeof HOST_BOX_OWNED_ENV;

/**
 * Env names refused in `env`, `generatedSecrets` and `serviceRefs` EVEN IF a manifest declares them (runtime code loading,
 * library injection, egress redirection). Prefixes end with "*".
 */
export const HOST_DENIED_ENV = [
  "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "LD_*", "DYLD_*", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONHOME",
  "PYTHONUSERBASE", "PERL5OPT", "PERL5LIB", "PERLLIB", "RUBYOPT", "RUBYLIB", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS",
  "JDK_JAVA_OPTIONS", "CLASSPATH", "BASH_ENV", "ENV", "PATH", "HOME", "SHELL", "IFS", "GCONV_PATH", "OPENSSL_CONF",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "DOCKER_*", "BUN_*", "DENO_*",
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
 * The local policy (HOST.md §5). The box applies every rule to every plan regardless of the signature. ALL checks of ALL
 * actions run before the first engine call (a refused plan changes nothing). Ids are stable; HOST_CONFORMANCE refers to them.
 */
export const HOST_POLICY = {
  verifySignature: "Plan JWS verifies under a key listed in the `portalKeySet` statement (active or pending), and that statement verifies under a root pinned in the agent build (dev or prod channel, chosen at build time); the key-set seq never goes back (bad_signature).",
  bindServer: "`server` and `aud`/`sub` equal this box; `workspace` equals the paired workspace (wrong_server).",
  monotonicSeq: "The box keeps lastSeq = the highest seq it DECIDED (applied, or refused after the signature and server binding verified), persisted across restarts, and polls with after = lastSeq. A verified plan with seq \u2264 lastSeq is refused (replayed); one with seq > lastSeq + seqMaxJump is refused without moving lastSeq (seq_out_of_range) and reported; a plan whose signature fails never moves lastSeq. Core serves only plans the box has not decided yet, so a reported refusal never blocks later plans.",
  notExpired: "now ≤ exp + clockLeewayS, iat ≤ now + clockLeewayS, exp − iat ≤ planMaxLifetimeS (expired).",
  closedSchema: "The payload validates against schemas/host-plan.schema.json (closed at every level, unknown and reserved action kinds refused) and is ≤ planMaxBytes (schema_invalid).",
  serviceIdentity: "serviceName = (\"tb-\" + release.product + (component ? \"-\" + component : \"\")) cut to 60 chars. The box records (product, component) when it first creates a serviceName and refuses any later spec with another (product, component) for it, for the life of the pairing, also after a stop (identity_changed); a reinstall of the same app (new TB_INSTANCE_ID) keeps the name and its volumes. stop_service names a tb- service the box created. Known S1 limit: product `foo-bar` main and product `foo` companion `bar` share a name \u2014 the first one wins, the other is refused (never a takeover).",
  imageFromIndex: "The box fetches the release index (index.json + index.jws) itself and verifies it with the release keys pinned in the agent build. The entry `release.releaseId` exists, its product equals `release.product`, its channel equals the box's configured channel (default stable), its `manifestDigest` equals `release.manifestDigest`, and `release.image` equals: entry.image (component null), or entry.services[component].image, or the digest-pinned image of manifest runtime.services[component] (manifest fetched from entry.manifestUrl, digest checked) (not_in_index). Index or manifest unreachable → nothing is applied (index_unavailable).",
  noDowngrade: "The box keeps a version floor per (product, component), persisted, across every serviceName, running or stopped. The release that runs now is never a downgrade (a setting change of it passes). A release below the floor is refused (downgrade_refused), except a rollback to the ONE version that ran for that serviceName right before the current one, and only while the current one is `failed` or its health `failing` (health-gated rollback, C213); that rollback lowers the floor to the restored version. The owner's `instances.rollback` (snapshot restore) is not available on own servers in S1 (Core refuses it).",
  envAllowlist: "Names in env ∪ generatedSecrets ∪ serviceRefs keys are pairwise disjoint and each is declared for that component: manifest runtime.env (main) / runtime.services[id].env (companion) names, the bridge's index runtime.env names, HOST_PLATFORM_ENV names (env only) or HOST_PLATFORM_GENERATED names (generatedSecrets only). HOST_BOX_OWNED_ENV names and HOST_DENIED_ENV names are refused everywhere, even if declared (env_not_declared).",
  manifestMatch: "The box compares everything it can derive from the verified release (manifest_mismatch): a manifest `generate: secret` / index `provider-secret` name appears only in generatedSecrets; a manifest `value` entry (and index `fixed`) appears only in env with exactly that value, `{{services.<id>.host|port|url}}` rendered with this stack's serviceNames and the declared ports; a whole-value `{{services.<id>.env.<NAME>}}` entry appears only in serviceRefs as {serviceName of <id> in the same instance, env: NAME}; `setting` entries carry any value that passes noSecretValues; HOST_PLATFORM_ENV values equal what the box derives; `port` and `healthPath` (or null) equal the release's declared ones; the volumes are a subset of the release's declared volumes at their declared mount paths (none declared: one volume at \"/data\"). Not on own servers in S1: TB_RESTORE_FROM (snapshot restore) and TB_KEK_PREVIOUS (KEK rotation) — refused env_not_declared.",
  noSecretValues: "No `env` value matches HOST_SECRET_VALUE_PATTERNS (secret_like_value).",
  generatedNotSent: "The engine config is GENERATED by the agent from HostServiceSpec; no compose file or engine spec from outside is ever passed to the engine; named volumes only; HOST_FORBIDDEN_KEYS never set.",
  neverDeleteVolumes: "`stop_service` and the detach plan never delete a volume in S1. No action deletes data.",
  finalPlan: "A plan with `final: true` carries `detach: {mode}`. mode leave_running: no actions; the box stops NOTHING, leaves every container and volume as it is, turns containment off, keeps its firewall rules and records itself as unmanaged. mode stop: only stop_service actions (0..16); the box stops EVERY tb- service it created (listed or not), keeps all data, then records itself as unmanaged. In both modes the box acknowledges the plan in one last report, then refuses every later plan (server_detached) and stops polling and reporting. No mode deletes data.",
  resources: "The box clamps requests to its facts minus reserveMemoryMb / reserveCpu, and applies its own default limits when `resources` is null.",
  ownInfraOrigins: "After every applied change the agent rewrites the bridge's TB_OWN_INFRA_ORIGINS (exact `http://<serviceName>:<port>` origins of the tb- app services it created in this stack and that run, comma-separated, sorted) and TB_INTERNAL_HOST (= the bridge serviceName), then restarts the bridge (the allowlist is read at boot).",
  firewall: "Agent-owned rules, re-checked before every report and on every Docker network create event: traffic from any Docker bridge (br-+, docker0) to the host is DROPped by default (INPUT, IPv4 and IPv6), including :22, the engine API, other stacks' networks, IPv6 host addresses and 169.254.169.254; explicit allows only for the engine's own network to what it needs (the report says ok:false; firewall_failed on an action that needs it).",
  coreDown: "While Core is unreachable the box keeps the last applied state running, queues ≤ reportQueueMax reports, applies nothing without a fresh valid plan and takes no destructive action (HOST.md §7).",
  containEscapes: "Every report cycle the agent lists ALL containers on the box and compares each one's HostConfig (network/pid/ipc modes, privileged, capabilities, devices, binds and mounts) with what it expects: for an engine container the config recorded at install for that component's pinned image digest; for a tb- service the config the agent generated. Name and digest only IDENTIFY a container, they never exempt it. A container that deviates with a container:/host namespace mode, privileged, added capabilities, devices, a docker.sock or host-path bind gets `docker update --restart=no` and `docker stop` (data kept) and is reported in `escapes` (code escape_attempt) until Core acknowledged it.",
  publicHosts: "`publicDomain` true only for release kind bridge, component null; then `publicHosts` = {main: \"w\" + lower(ws ULID) + \".\" + zone, keys: \"w\" + lower(ws ULID) + \"-keys.\" + zone}, `zone` = the box's configured workspace zone (schema_invalid otherwise).",
} as const;
export type HostPolicyRule = keyof typeof HOST_POLICY;

// ───────────────────────────── reports (metadata only — HOST.md §6) ─────────────────────────────
export type HostErrorCode =
  | "bad_signature"
  | "wrong_server"
  | "replayed"
  | "seq_out_of_range"
  | "expired"
  | "schema_invalid"
  | "identity_changed"
  | "not_in_index"
  | "index_unavailable"
  | "downgrade_refused"
  | "env_not_declared"
  | "manifest_mismatch"
  | "secret_like_value"
  | "engine_error"
  | "health_timeout"
  | "firewall_failed"
  /** the agent stopped a container that does not match the box allowlist (forbidden runtime settings such as shared namespaces,
   *  privileged mode, added capabilities, devices or host mounts); report `escapes` */
  | "escape_attempt"
  /** v0.1.60: a plan that arrives after the box applied a final (detach) plan */
  | "server_detached";
export const HOST_ERROR_CODES = [
  "bad_signature", "wrong_server", "replayed", "seq_out_of_range", "expired", "schema_invalid", "identity_changed",
  "not_in_index", "index_unavailable", "downgrade_refused", "env_not_declared", "manifest_mismatch", "secret_like_value",
  "engine_error", "health_timeout", "firewall_failed", "escape_attempt", "server_detached",
] as const satisfies readonly HostErrorCode[];

/**
 * One result per action of a decided plan. `index` = action index; -1 = the whole plan was refused before any engine call.
 * Engine phase: actions run in order and stop at the first engine failure (that action `engine_error` / `health_timeout`,
 * the rest not run → not reported); the seq counts as decided either way.
 */
export interface HostActionResult { seq: number; index: number; ok: boolean; code?: HostErrorCode }

/** host.report body. Also the heartbeat (every reportIntervalS). No log content, no env values, no secrets. */
export interface HostReport {
  server: ServerId;
  at: IsoTime;
  /** HOST_POLICY.monotonicSeq */
  lastSeq: number;
  /** results not yet acknowledged by Core (a result is sent until a report carrying it was answered 200) */
  results: HostActionResult[];
  services: HostServiceStatus[];
  facts: HostFacts;
  firewall: HostFirewallStatus;
  /** containment events not yet acknowledged by Core (absent or [] = none) */
  escapes?: HostEscapeEvent[];
  /** reports still queued on the box after this one (Core was down) */
  queued?: number;
}
export interface HostReportAck {
  accepted: true;
  serverState: ServerState;
  /** lowest deliverable plan seq > lastSeq, or null — the box may poll host.plans at once */
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
    given: "A plan signed by a key not in the key-set statement; one with a flipped signature byte; one whose statement is signed by an unpinned root; one whose statement seq is below the pinned seq.",
    expect: "Nothing applied; result {index: -1, ok: false, code: bad_signature}; lastSeq unchanged." },
  { id: "H-2", title: "wrong server refused", rule: "bindServer", target: "agent-unit",
    given: "A valid plan for another srv_ (server and aud), and one for this server but another workspace.",
    expect: "Nothing applied; code wrong_server." },
  { id: "H-3", title: "replay (same seq) refused", rule: "monotonicSeq", target: "agent-unit",
    given: "The last decided plan delivered again, a plan with a lower seq (also after an agent restart), and a plan with seq = lastSeq + seqMaxJump + 1.",
    expect: "replayed for the first two, seq_out_of_range for the last; nothing applied; lastSeq survives a restart and does not jump." },
  { id: "H-4", title: "expired refused", rule: "notExpired", target: "agent-unit",
    given: "A plan with exp < now − clockLeewayS; one with exp − iat > planMaxLifetimeS; one with iat in the future beyond the leeway.",
    expect: "Nothing applied; code expired." },
  { id: "H-5", title: "image not in index refused", rule: "imageFromIndex", target: "agent-unit",
    given: "A plan whose release.image digest is not the index entry's (main), not in entry.services, not in the digest-checked manifest; one whose manifestDigest differs from the entry; one on another channel; one with a tag-only image.",
    expect: "Nothing applied; code not_in_index (tag-only: schema_invalid)." },
  { id: "H-6", title: "downgrade refused", rule: "noDowngrade", target: "agent-unit",
    given: "The box ran N−1 then N of (product, component). Plans for N−2; for N−1 while N is healthy; for N−1 while N is failing; for N−2 under a NEW serviceName and after stop_service.",
    expect: "Only N−1 while N is failing is accepted; every other plan is refused downgrade_refused." },
  { id: "H-7", title: "undeclared env name refused", rule: "envAllowlist", target: "agent-unit",
    given: "Plans with env NODE_OPTIONS (undeclared), NODE_OPTIONS declared by the manifest (denied), TB_OWN_INFRA_ORIGINS / TB_BRIDGE_URL (box-owned), serviceRefs NODE_OPTIONS → another service, generatedSecrets PORT; a declared `value` entry with another value; a declared setting whose value is `sk_live_…`.",
    expect: "Nothing applied; env_not_declared for the first five, manifest_mismatch for the changed value, secret_like_value for the last." },
  { id: "H-8", title: "forbidden runtime settings refused", rule: "closedSchema", target: "both",
    given: "Plans that carry any HOST_FORBIDDEN_KEYS key (shared network/pid/ipc modes and the rest), at plan, action, service, release and volume level, and volumes at system paths; then on a real box: docker inspect of every tb- container.",
    expect: "Every plan refused (schema_invalid or manifest_mismatch); on the box no tb- container has a container:/host network, pid or ipc mode, a bind mount or a capability beyond the engine default." },
  { id: "H-9", title: "stop keeps the volume", rule: "neverDeleteVolumes", target: "both",
    given: "A running service with data in its volume; plan stop_service; then servers.detach (final plan); then another valid plan.",
    expect: "Container stopped; the named volume and its data still exist; no volume delete call reached the engine; after the final plan every later plan is refused and the box stops polling." },
  { id: "H-10", title: "TB_OWN_INFRA_ORIGINS matches the running tb- services", rule: "ownInfraOrigins", target: "both",
    given: "Deploy bridge + Knowledge (main + companions), then stop one service.",
    expect: "After each change the bridge env TB_OWN_INFRA_ORIGINS equals exactly the http://<serviceName>:<port> origins of the running tb- app services of this stack (sorted), TB_INTERNAL_HOST = the bridge serviceName, and the bridge restarted." },
  { id: "H-11", title: "firewall probe from an app network", rule: "firewall", target: "box-probe",
    given: "From a container on the stack network (and from a stack created AFTER the agent started): connect to host :22, the engine API port, another stack's container IP, the host's IPv6 address, 169.254.169.254, and the edge with Host: localhost.",
    expect: "Every connection fails (DROP/REJECT); the report carries firewall.ok true and an unchanged rulesDigest; breaking a rule makes the next report ok:false." },
  { id: "H-12", title: "container outside the allowlist stopped", rule: "containEscapes", target: "box-probe",
    given: "Containers created outside any plan with forbidden runtime settings (a shared namespace mode, privileged mode, a host mount).",
    expect: "Within one report cycle each is stopped (its data kept), the report carries one escapes entry per container with its reasons, the server shows degraded; allowlisted engine containers are never touched." },
  { id: "H-13", title: "detach leave_running stops nothing", rule: "finalPlan", target: "both",
    given: "A box running the bridge and an app receives a final plan with detach.mode leave_running and no actions.",
    expect: "No container is stopped or changed, no volume is touched; the box acknowledges the plan in one report, records itself unmanaged, stops polling and reporting and turns containment off; its firewall rules stay." },
  { id: "H-14", title: "detach stop stops every service and keeps the volumes", rule: "finalPlan", target: "both",
    given: "A box running the bridge and an app receives a final plan with detach.mode stop (also one that lists only some services).",
    expect: "Every tb- service the box created is stopped; every named volume and its data still exist; the box acknowledges the plan, records itself unmanaged and stops polling." },
  { id: "H-15", title: "no plan after a final plan", rule: "finalPlan", target: "agent-unit",
    given: "After a final plan of either mode: a valid plan with a higher seq, signed for this server.",
    expect: "Refused server_detached; nothing applied; the box stays unmanaged." },
] as const satisfies readonly HostConformanceRow[];
