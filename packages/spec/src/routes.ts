// Portal route registry — opt2 (v0.1, Lead · Specs, 2026-10-11).
// Source of truth for every Portal op (PORTAL-API.md is the index + rules).
// Data and types only: no runtime code. Core builds its router, validators, rate limits and
// audit hooks from ROUTES; Core serves ROUTES at GET /internal/routes; the GUI generates its ONE
// gateway from that document (cached by digest); the owner CLI and the fake Portal (conformance)
// are generated from it too. An op without a row here is unreachable (default deny).
//
// Shared vocabulary and ids are imported, never re-declared (CORE §0).

import type { CompactJws, ConfigPullQuery, EnrolRequest, EnrolResponse, StatusReport } from "./bridge.ts";
import type {
  AgentId, BridgeId, ConnectionId, DeviceClientId, DeviceRequestId, DeviceScope, Ed25519PublicJwk,
  FreeCaps, InstanceId, OwnerSessionClient, PersonId, PersonOpClient, WorkspaceId,
} from "./credentials.ts";
import type {
  DeviceHostTokenResult, DeviceRequestHost, DeviceStartHostInput, HostPlanJws, HostPlansQuery, HostReport, HostReportAck,
  Server, ServerDetachInput, ServerId, ServerList, ServerListInput, ServerRefInput,
} from "./host.ts";
import type { AgentMode, Category, Condition, CrudAction, Effect, HoldFamily, KeySource, ProductId, SettingChoice, SettingType } from "./manifest.ts";

export type Crud = CrudAction;
/** I14 shape `{write?, outward?, destructive?: {max, per}}` — owned by ./credentials.ts (FreeCaps). */
export type Caps = FreeCaps;
export type Jwk = Ed25519PublicJwk;
export interface Jwks { keys: Ed25519PublicJwk[] }

// ───────────────────────────── ids (CORE §1; the rest come from ./credentials.ts) ─────────────────────────────
type Id<P extends string> = `${P}_${string}`;
export type AccountId = Id<"acc">;
export type ReleaseId = Id<"rel">;
export type LicenceId = Id<"lic">;
export type OfferId = Id<"off">;
export type OrderId = Id<"ord">;
export type EdgeId = Id<"edg">;
export type DraftId = Id<"drf">;
export type AuditEventId = Id<"aud">;
export type ReceiptId = Id<"rcp">;
/** CORE §1: owner native session (K3), provider link. */
export type OwnerSessionId = Id<"osn">;
/** v0.1.64 (C332): the push device of one owner session (Teal Brick Mobile). */
export type PushDeviceId = Id<"pdv">;
/** v0.1.64 (C326): one relayed person op (Core queue row; K14 `pop` claim). */
export type PersonOpId = Id<"pop">;
export type ProviderLinkId = Id<"lnk">;
export type IsoTime = string;
export type Digest = `sha256:${string}`;
/** Provider adapter id, data (e.g. "railway"); never branched on outside the adapter. v0.1.58 (S1-0): `own_infra` with a
 *  `srv_…` destination = a paired server (HOST.md §8); the only key whose config entries carry `ownInfra: true`. */
export type ProviderKey = string;

// ───────────────────────────── route row ─────────────────────────────
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Maps to CREDENTIALS kinds: browser=K1 Clerk session; owner-cli=K3 `tbo_`; bridge=K7 bridge
 *  assertion; device=K2 device_code in body; public=no credential; stripe-webhook=Stripe signature.
 *  v0.1.58 (S1-0): host=K13 host assertion (`TB-Assert`, typ tb-host-assert+jwt), only on the host.* rows (RT9). */
export type AuthClass = "browser" | "owner-cli" | "bridge" | "device" | "public" | "stripe-webhook" | "host";
/** gateway = forwarded by the generated GUI gateway at https://<portal>/api/v1/…; internal = Core
 *  private network only (the gateway never forwards it). v0.1.36 (C193): admin = only in ADMIN_ROUTES
 *  (`@opt2-tealbrick/spec/admin`), served only on Core's admin listener; never a ROUTES row (Core's main listener refuses
 *  any exposure other than gateway/internal). */
export type Exposure = "gateway" | "internal" | "admin";
export type Transport = "json" | "json_slow" | "sse" | "longpoll" | "raw" | "binary";
export type RateClass =
  | "read" | "write" | "sensitive" | "public_strict" | "device_poll"
  | "bridge_poll" | "bridge_write" | "webhook" | "stream" | "internal"
  /** v0.1.58 (S1-0): per server */
  | "host_poll" | "host_write"
  /** v0.1.64 (C326): per bridge, the person-op relay pull and result posts */
  | "bridge_relay"
  /** v0.1.64 (C326): per owner session, person_ops.call */
  | "person_op";
/** none = request/response bodies never logged; meta = field names + byte sizes only. Values never. */
export type BodyLog = "none" | "meta";

export const REGISTRIES = {
  product: { module: "products", record: "Product" },
  release: { module: "releases", record: "Release" },
  manifest: { module: "manifests", record: "StoredManifest" },
  offer: { module: "offers", record: "Offer" },
  entitlement: { module: "entitlements", record: "Licence" },
  workspace: { module: "workspaces", record: "Workspace" },
  agent: { module: "agents", record: "AgentCard" },
  agent_policy: { module: "policy", record: "AgentPolicy" },
  connection: { module: "connections", record: "AgentConnection" },
  instance: { module: "instances", record: "Instance" },
  provider: { module: "providers", record: "ProviderLink" },
  credential: { module: "credentials", record: "CredentialRow" },
  consent: { module: "consent", record: "ConsentRecord" },
  route: { module: "routes", record: "RouteOp" },
  audit: { module: "audit", record: "AuditEvent" },
} as const;
export type RegistryId = keyof typeof REGISTRIES;

export const TRANSPORTS = {
  json: { contentType: "application/json", bodyCapKb: 256, timeoutMs: 15_000 },
  json_slow: { contentType: "application/json", bodyCapKb: 256, timeoutMs: 120_000 },
  sse: { contentType: "text/event-stream", bodyCapKb: 0, timeoutMs: 900_000 },
  longpoll: { contentType: "application/jose", bodyCapKb: 0, timeoutMs: 75_000 },
  raw: { contentType: "application/json", bodyCapKb: 512, timeoutMs: 15_000 },
  binary: { contentType: "application/zip", bodyCapKb: 0, timeoutMs: 60_000 },
} as const satisfies Record<Transport, { contentType: string; bodyCapKb: number; timeoutMs: number }>;

/** Limits per key per minute. Key: principal (account / cli session / bridge) or client IP. */
export const RATE_CLASSES = {
  read: { perMinute: 600, key: "principal" },
  write: { perMinute: 120, key: "principal" },
  sensitive: { perMinute: 10, key: "principal" },
  public_strict: { perMinute: 20, key: "ip" },
  device_poll: { perMinute: 30, key: "ip" },
  bridge_poll: { perMinute: 6, key: "principal" },
  bridge_write: { perMinute: 30, key: "principal" },
  webhook: { perMinute: 300, key: "ip" },
  stream: { perMinute: 20, key: "principal" },
  internal: { perMinute: 0, key: "none" },
  host_poll: { perMinute: 6, key: "principal" },
  host_write: { perMinute: 30, key: "principal" },
  bridge_relay: { perMinute: 240, key: "principal" },
  person_op: { perMinute: 30, key: "principal" },
} as const satisfies Record<RateClass, { perMinute: number; key: "principal" | "ip" | "none" }>;

// ───────────────────────────── audit action registry ─────────────────────────────
// Free-string actions are impossible: AuditEvent.action is this union. No behaviour reads audit rows.
export const AUDIT_ACTIONS = [
  "account.set_current_workspace",
  /** v0.1.4 (C49): Clerk webhook disabled/deleted a person → account disabled */
  "account.disable",
  "workspace.create", "workspace.update", "workspace.delete", "workspace.set_infrastructure",
  "workspace.pause", "workspace.resume", "workspace.standalone",
  "provider.link", "provider.link_token", "provider.unlink", "provider.destination_create",
  "agent.create", "agent.update", "agent.delete", "agent.pairing_code_issue", "agent.pairing_approve",
  "agent.policy_set", "agent.pause", "agent.resume",
  "connection.create", "connection.revoke",
  "device.approve", "device.deny", "device.redeem",
  "canvas.save", "edge.create", "edge.update", "edge.delete", "hook.set",
  "instance.deploy", "instance.retry", "instance.cancel", "instance.update", "instance.rollback", "instance.rollback_restore",
  "instance.remove", "instance.register_own_infra", "instance.registered", "bridge.deploy",
  /** v0.1.13 (C82): owner grants / revokes a consent (wildcard companion `tb.holds_pending`) */
  "instance.consent",
  "bridge.enrolment_code_issue", "bridge.enrol",
  "ticket.launch", "ticket.keys",
  "licence.assign", "licence.unassign", "licence.move", "licence.create", "licence.revoke",
  "order.create", "order.paid", "order.failed",
  "skills.override_put", "skills.override_delete",
  "owner_session.create", "owner_session.revoke",
  "draft.create", "draft.update", "draft.submit", "draft.apply", "draft.apply_step",
  "draft.reject", "draft.import",
  /** v0.1.32 (C196 ENG-1): the account accepted the current legal documents (Terms, DPA, AUP) for its business */
  "account.terms_accept",
  /** v0.1.58 (S1-0): device approval with scope host created the server and set the workspace infrastructure (one consent) */
  "server.pair",
  /** v0.1.58 (S1-0): stop every service on the server, keep data, unpair the key */
  "server.detach",
  /** v0.1.64 (C332): an owner session (client tbm) set or removed its push device */
  "push_device.register", "push_device.unregister",
  /** v0.1.64 (C326): one allow-listed person op relayed for a K3 of client tbd/tbm (details: client, product, op, outcome; never input or output) */
  "person_op.relay",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ───────────────────────────── errors, paging ─────────────────────────────
export type ErrorCode =
  | "bad_request" | "validation_failed" | "unauthenticated" | "forbidden" | "not_found"
  | "method_not_allowed" | "conflict" | "revision_conflict" | "idempotency_key_required"
  | "idempotency_conflict" | "rate_limited" | "payload_too_large" | "licence_required"
  | "licence_already_assigned" | "licence_not_active" | "workspace_paused" | "workspace_standalone"
  | "workspace_not_empty" | "bridge_not_ready" | "provider_not_linked" | "provider_unavailable"
  | "provider_reauth_required" | "destination_in_use" | "release_not_deployable"
  | "manifest_invalid" | "deploy_in_progress" | "instance_exists" | "policy_invalid"
  | "draft_invalid" | "draft_op_not_draftable" | "draft_ref_invalid" | "draft_ref_money"
  | "draft_state" | "recipe_not_portable" | "authorization_pending" | "slow_down" | "access_denied"
  | "expired_token" | "enrolment_code_invalid" | "bridge_key_revoked" | "stripe_signature_invalid"
  | "clerk_signature_invalid" | "account_disabled"
  | "offer_unavailable" | "checkout_failed" | "upstream_timeout"
  /** v0.1.56 (C296): Instance.lastError of a companion that could not start because a required key it uses is not set */
  | "needs_keys"
  /** v0.1.13 (C86): tickets.launch `path` outside the target app */
  | "path_invalid"
  /** v0.1.13 (C82): instances.consent for a consent the release does not ask for */
  | "consent_not_requested"
  /** v0.1.32 (C196 ENG-1): 409, the account has not accepted the current legal documents (details.documents lists them) */
  | "terms_not_accepted"
  /** v0.1.32 (C196 ENG-6): 403, the owner has no second sign-in factor while Core requires one (TB_REQUIRE_MFA) */
  | "mfa_required"
  /** v0.1.36 (C193/C204, admin listener only): 403, the Clerk user is not in TB_ADMIN_OPERATORS (or its primary email is not
   *  verified), or its role is below the op's minRole */
  | "operator_forbidden"
  /** v0.1.36 (C203, admin listener only): 403, the op needs a Clerk verification younger than ADMIN_STEP_UP_MAX_AGE_MINUTES */
  | "step_up_required"
  /** v0.1.37 (C184 §2.3, C203 Q2): 403, an operator suspended or banned this account; details.kind "suspend" | "ban".
   *  Not returned for account.me, licences.list and billing.portal (the customer can still read the notice and pay). */
  | "account_suspended"
  /** v0.1.39 (C213 US-3, E3): Instance.lastError codes of a health-gated update — the old version is being put back / was put
   *  back / could not be put back (operator alerted) / the data needs newer code and no snapshot restore was possible.
   *  `release_not_deployable` details.reason adds "not_older" and "rollback_needs_restore" (instances.rollback). */
  | "update_rolling_back" | "update_rolled_back" | "rollback_failed" | "rollback_needs_restore"
  /** v0.1.51 (RS-7.4, INC-20261019-04): the update could not be confirmed and is FROZEN for an operator (old SDK < 0.1.25 or
   *  unknown: Core never puts old code on possibly migrated data); 409 on instances.update / rollback / retry / remove and the
   *  revive path while frozen. `update_kept_new`: the new version was kept (it reported and did not fail its boot). */
  | "update_held" | "update_kept_new"
  /** v0.1.64 (C326): 403, person_ops.call for an op/product not in PERSON_OP_RELAY.allow, or a K3 whose client is not in
   *  PERSON_OP_RELAY.clients (details.reason "op" | "client") */
  | "person_op_not_allowed"
  /** v0.1.64 (C326): 504, the bridge did not post the app's answer within PERSON_OP_RELAY.coreWaitS (the op may still have
   *  run once; the client reloads before it repeats a write) */
  | "person_op_timeout"
  /** v0.1.64 (C332): 403, push_devices.register from a K3 whose client is not in PUSH.clients */
  | "push_client_not_allowed"
  | "internal";
/** CORE §8: the one error envelope. */
export interface ErrorEnvelope { error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> } }
export interface PageQuery { cursor?: string; limit?: number }
export interface Page<T> { items: T[]; nextCursor: string | null }

// ───────────────────────────── shared shapes ─────────────────────────────
export type Empty = Record<string, never>;
export interface Ok { ok: true }
export interface EnvVar { name: string; value: string }
export interface WorkspaceRef { ws: WorkspaceId }
export interface AgentRef { ws: WorkspaceId; agt: AgentId }
export interface InstanceRef { ws: WorkspaceId; ins: InstanceId }
export interface ProviderRef { provider: ProviderKey }
export interface ConfigChange { id: string; configRevision: number }
export type SettingValue = string | number | boolean;

// account
export interface AccountMe {
  account: { id: AccountId; createdAt: IsoTime };
  person: { id: PersonId; email: string; name: string | null; imageUrl: string | null };
  /** true while the account has no workspace: GUI shows "new here, create workspace". */
  firstSignIn: boolean;
  currentWorkspaceId: WorkspaceId | null;
  workspaceCount: number;
  /** v0.1.32 (C196 ENG-1): the legal documents the account must accept and whether it did; omitted by Core before 0.1.32. */
  terms?: AccountTerms;
  /** v0.1.32 (C196 ENG-6): the second-factor gate; omitted by Core before 0.1.32. */
  mfa?: AccountMfa;
  /** v0.1.37 (C184 §2.3): present while an operator suspended or banned this account (the Portal shows the notice) */
  restriction?: AccountRestriction;
}
export interface AccountRestriction { kind: "suspend" | "ban"; customerText: string | null; since: IsoTime; endsAt: IsoTime | null }
export interface SetCurrentWorkspaceInput { ws: WorkspaceId }
/** v0.1.32 (C196 ENG-1): a legal document the account accepts, at one version. Core keeps the ONE list (its config constant). */
export type LegalDocId = "terms" | "dpa" | "aup" | "privacy";
export interface LegalDocument { doc: LegalDocId; version: string; title: string; url: string }
export interface LegalDocumentRef { doc: LegalDocId; version: string }
export interface AccountTerms {
  /** every document the account must accept now, at its current version */
  current: LegalDocument[];
  /** true when the account accepted every current document at its current version */
  accepted: boolean;
  /** time of the acceptance of the current set; null while not accepted */
  acceptedAt: IsoTime | null;
  /** v0.1.33 (C200), DEPRECATED in 0.1.34: legal v1.1 accepts every document (DPA included) with one tick; Core omits it. */
  businessDocuments?: LegalDocument[];
}
export interface AccountMfa {
  /** true when Core refuses owner sessions without a second factor */
  required: boolean;
  /** Clerk reports a second factor (TOTP, backup codes, SMS code or a passkey); null when not checked (required false) */
  enrolled: boolean | null;
}
/** v0.1.32 (C196 ENG-1): `documents` = exactly the current list the GUI showed (else 409 conflict, details.reason
 *  terms_changed + details.documents). v0.1.33 (C200, consumers too): the tick is neutral; `onBehalfOfBusiness` is
 *  optional and ignored (the buyer type is chosen at checkout). */
export interface TermsAcceptInput { documents: LegalDocumentRef[]; onBehalfOfBusiness?: boolean }

// workspaces
export type BridgeState = "absent" | "deploying" | "awaiting_enrolment" | "online" | "offline" | "standalone";
export interface Workspace {
  id: WorkspaceId;
  name: string;
  status: "active" | "paused" | "standalone";
  channel: "stable" | "dev";
  infrastructure: { provider: ProviderKey; destinationId: string; destinationName: string } | null;
  bridge: { id: BridgeId | null; state: BridgeState };
  /** Derived, never stored: drives the onboarding overlay. */
  onboarding: { infrastructure: boolean; agent: boolean; agentAuthorised: boolean; app: boolean };
  counts: { agents: number; instances: number };
  /** v0.1.15 (C105a) */
  appsPolicy?: AppsPolicy;
  createdAt: IsoTime;
  /** v0.1.40 (C223): present only while a workspace delete waits for provider removals (the workspace disappears after) */
  deleting?: { since: IsoTime; lastError: { code: string; message: string } | null };
  /** v0.1.61: what the server install command needs (the command text belongs to the host agent's installer). null when
   *  own servers are not offered by this Portal, or when the workspace already has infrastructure. Read only. */
  serverInstall?: { portalUrl: string; channel: "stable" | "dev"; zone: string } | null;
}
/** v0.1.40 (C223): `workspaces.delete` answer (a superset of `Ok`). `deleting` = provider services are still being removed;
 *  `bridge` = the bridge removal this delete started (null when the workspace had no bridge). A repeat answers the same
 *  state; after completion `deleted`. */
export interface WorkspaceDeleteResult { ok: true; state: "deleted" | "deleting"; bridge: RemoveResult | null }
export type WorkspaceListInput = PageQuery;
export type WorkspaceList = Page<Workspace>;
export interface WorkspaceCreateInput { name: string }
/** v0.1.15 (C105a): `appsPolicy` = the workspace "apps policy" for app-initiated and app→app calls (held families;
 *  `money` must stay in it, `422 policy_invalid` otherwise). Each change re-mints the companion grants (new `polrev`). */
export interface WorkspaceUpdateInput { ws: WorkspaceId; name?: string; channel?: "stable" | "dev"; appsPolicy?: AppsPolicy }
export interface AppsPolicy {
  /** default DEFAULT_HELD_FAMILIES */
  held: HoldFamily[];
}
export interface SetInfrastructureInput { ws: WorkspaceId; provider: ProviderKey; destinationId: string }
/** v0.1.40 (F123): `settings` = query key, JSON text `{"<product>": {"<settingKey>": <string | number | boolean>}}` with the deploy
 *  options the estimate is for (only option values: enum, boolean, integer, number — never free text). Core counts a companion
 *  service only when its manifest `when` holds for these values. Limits: ≤ 4096 chars, ≤ 32 products, ≤ 64 keys per product
 *  (`validation_failed` otherwise). Absent = the manifest defaults. */
export interface CostEstimateInput { ws: WorkspaceId; products: ProductId[]; settings?: string }
/** v0.1.40: the decoded form of `CostEstimateInput.settings`. */
export type EstimateSettings = Record<ProductId, Record<string, string | number | boolean>>;
/** v0.1.40 (C224/C225): where the expected figure comes from: measured use on qa1 for that product version, or a typical
 *  idle figure (`mixed` at the top level when the lines differ). */
export type EstimateBasisKind = "measured" | "typical_idle";
export interface CostEstimate {
  provider: ProviderKey;
  currency: "USD";
  /** v0.1.40 (C225): equal to `monthlyExpected` when Core sends it (the headline). */
  monthlyLow: number;
  /** v0.1.40 (C225): "at most": full reserved CPU + memory all month (the small print). */
  monthlyHigh: number;
  lines: { item: string; monthlyLow: number; monthlyHigh: number; monthlyExpected?: number; expectedFrom?: EstimateBasisKind }[];
  basis: string;
  asOf: string;
  /** v0.1.40 (C225): the EXPECTED monthly cost from measured use per app (headline). Older Core omits it: use `monthlyLow`. */
  monthlyExpected?: number;
  expectedFrom?: EstimateBasisKind | "mixed";
}
/** ownerKey = public JWK printed by `tealbrick standalone owner-key` (CREDENTIALS §17). */
export interface StandaloneInput { ws: WorkspaceId; confirmName: string; ownerKey: Ed25519PublicJwk }
export interface StandaloneResult { ws: WorkspaceId; finalRevision: number; issuer: `tb:brg:${string}`; effectiveAt: IsoTime }

// providers
export interface ProviderOption {
  id: ProviderKey;
  label: string;
  kind: "managed_cloud" | "self_hosted";
  available: boolean;
  unavailableReason: string | null;
  linkMethods: ("oauth" | "token")[];
}
export interface ProviderList { items: ProviderOption[] }
export interface LinkStart { authorizeUrl: string; signupUrl: string | null; state: string; expiresAt: IsoTime }
export interface LinkCompleteInput { provider: ProviderKey; code: string; state: string }
/** C3 fallback. The token is sealed in Core at once; bodyLog none; never returned. */
export interface LinkTokenInput { provider: ProviderKey; token: string }
export interface ProviderLink {
  provider: ProviderKey;
  linked: boolean;
  id: ProviderLinkId | null;
  method: "oauth" | "token" | null;
  accountLabel: string | null;
  status: "ok" | "reauth_required" | null;
  verifiedAt: IsoTime | null;
  workspacesUsing: number;
}
export interface Destination { id: string; name: string; createdByPortal: boolean; inUseBy: WorkspaceId | null }
export interface DestinationList { items: Destination[] }
export type DestinationCreateInput =
  | { provider: ProviderKey; name: string; random?: never }
  | { provider: ProviderKey; random: true; name?: never };

// harness options (data rows, Agent Registry)
/**
 * v0.1.27 (F75, L1): THE list of harness option ids, the one definition Core, the CLI and the registry rows check against.
 * A row of the signed index `harnesses` section (data: label, kind, instructions) exists for each id; the id set itself lives
 * here. `claude-code` = Claude Code (CLI, project-scope MCP). The CLI's `claude-sdk` and `command` are NOT harness options:
 * they are runner kinds of `agent serve` / `adopt` on an agent connected as `tealbrick-cli`.
 */
export const HARNESS_OPTION_IDS = ["tbd-default", "claude-desktop", "codex-desktop", "claude-code", "eve", "tealbrick-cli", "generic-mcp"] as const;
export type HarnessOptionId = (typeof HARNESS_OPTION_IDS)[number];
export const isHarnessOptionId = (id: unknown): id is HarnessOptionId => typeof id === "string" && (HARNESS_OPTION_IDS as readonly string[]).includes(id);
export interface HarnessOption {
  /** one of HARNESS_OPTION_IDS (typed `string` so a reader holding an older list still parses newer rows, L24) */
  id: string;
  kind: "desktop" | "agentic_system" | "other";
  label: string;
  /** Asset URL served from the release of the harness, or null. */
  icon: string | null;
  authorise: "device_approval" | "instruction_set" | "url";
  /** true = the row is the "I do not have an agent" path (download the desktop app). */
  noAgentPath: boolean;
}
export interface HarnessOptionList { items: HarnessOption[] }

// agents
export type AgentStatus = "pending" | "authorised" | "connected" | "paused";
export interface AgentCard {
  id: AgentId;
  ws: WorkspaceId;
  name: string;
  purpose: string;
  harnessOptionId: string;
  /** Display only (N8); Portal never calls agents. */
  endpointLabel: string | null;
  mode: AgentMode;
  status: AgentStatus;
  paused: boolean;
  connections: number;
  createdBy: "owner" | "app";
  createdAt: IsoTime;
}
export type AgentListInput = WorkspaceRef & PageQuery;
export type AgentList = Page<AgentCard>;
/** The ONE create path. Mode is always "free" for owner-created cards. */
export interface AgentCreateInput { ws: WorkspaceId; name: string; purpose: string; harnessOptionId: string; endpointLabel?: string }
export interface AgentUpdateInput { ws: WorkspaceId; agt: AgentId; name?: string; purpose?: string; harnessOptionId?: string; endpointLabel?: string | null }
export interface AgentDeleteResult { agt: AgentId; revokedConnections: number; configRevision: number }
export interface InstructionsInput { ws: WorkspaceId; agt: AgentId; harnessOptionId?: string }
export interface InstructionSet {
  harnessOptionId: string;
  mcpUrl: string | null;
  needsPairingCode: boolean;
  /** `value` may contain the placeholder {{pairingCode}}; the GUI fills it from agents.pairing_code.
   *  v0.1.40 (F122): `pending: true` = the step needs the bridge MCP address and `mcpUrl` is still null: `detail` names the
   *  address in words and `copy` is omitted; ask again when the bridge is online. Absent = the step is complete. */
  steps: { title: string; detail: string; copy?: { kind: "command" | "json" | "url" | "text"; value: string }; pending?: true }[];
}
/** K2b, shown once; aud = this workspace's bridge. Only for OAuth connectors: path A (pairing.approve) and path B
 *  (paste on the bridge authorize page). CLI and kits always use key connections (S9). */
export interface PairingCode { code: string; expiresAt: IsoTime; mcpUrl: string }
/** "Approve in Portal" (C4 connector path): `state` is the bridge-signed connect request (K7 key;
 *  claims: OAuth request id, return URL on the bridge origin, bridge id, exp <= 10 min). */
export interface ConnectRequestInput { state: string }
/** Core returns it only if the bridge's workspace belongs to the caller's account (S3), else 404. */
export interface ConnectRequest {
  bridgeId: BridgeId;
  ws: WorkspaceId;
  /** Host of the OAuth client's redirect_uri, shown to the owner (S3). */
  redirectHost: string;
  /** DCR client_name as sent by the client; the GUI labels it "unverified" (S3). */
  clientNameUnverified: string;
  returnOrigin: string;
  expiresAt: IsoTime;
}
/** Owner picks an agent card (a new card is made first with agents.create, the one create path). */
export interface ConnectApproveInput { state: string; agt: AgentId }
/** The GUI auto-submits this form (POST) to the bridge; it carries a freshly minted K2b. */
export interface FormPostRedirect { action: string; method: "POST"; fields: Record<string, string> }
export interface AgentPolicy {
  agt: AgentId;
  revision: number;
  mode: AgentMode;
  held: HoldFamily[];
  caps: Caps;
  /** Bound only: allowed operation ids per product (grant `wf`). */
  workflow: { product: ProductId; operations: string[] }[];
  paused: boolean;
}
export interface AgentPolicySetInput {
  ws: WorkspaceId;
  agt: AgentId;
  revision: number;
  mode: AgentMode;
  held: HoldFamily[];
  caps: Caps;
  workflow?: { product: ProductId; operations: string[] }[];
}
export interface PauseState { id: string; paused: boolean; configRevision: number }

// connections
export interface AgentConnection {
  id: ConnectionId;
  agt: AgentId;
  method: "key" | "pairing";
  clientName: string;
  publicKeyThumbprint: string | null;
  createdAt: IsoTime;
  lastSeenAt: IsoTime | null;
}
export interface ConnectionList { items: AgentConnection[] }
export interface ConnectionRef { ws: WorkspaceId; agt: AgentId; con: ConnectionId }

// device flow — this file is the ONE wire source (B6); CREDENTIALS §6 and CLI.md cite these type names.
// RFC 8628 field names on start/token. No unbound list exists: the owner reaches a request only with its user code (B2).
/** scope "owner" → K3 owner native session; only the owner's own tools (`tealbrick-cli`, `tbd`), never `kit`, never a key (B3). */
/** v0.1.64: client_id `tbm` (Teal Brick Mobile). */
export interface DeviceStartOwnerInput { scope: "owner"; client_id: "tealbrick-cli" | "tbd" | "tbm"; machine_label: string }
/** scope "agent" → key connections; one request may carry 1..64 {agt?, public_key} pairs from one machine (S4). */
export interface DeviceStartAgentInput {
  scope: "agent";
  client_id: "tealbrick-cli" | "tbd" | "kit";
  machine_label: string;
  /** harness option id */
  harness: string;
  /** v0.1.14 (C96): `name` (1..60, v0.1.15: = the agent card name rule) / `purpose` (≤ 280) are suggestions from the CLI; the owner may edit them on the device page */
  /** v0.1.18 (C106a): `adopt` = the CLI's SUGGESTED access for the new card (the owner decides on the device page) */
  agents: { agt?: AgentId; public_key: Jwk; name?: string; purpose?: string; adopt?: AdoptSuggestion }[];
}
/** v0.1.58 (S1-0): scope "host" (`DeviceStartHostInput`, ./host.ts) → a paired server (HOST.md §2). */
export type DeviceStartInput = DeviceStartOwnerInput | DeviceStartAgentInput | DeviceStartHostInput;
export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}
export interface DeviceTokenInput { grant_type: "urn:ietf:params:oauth:grant-type:device_code"; device_code: string; client_id: DeviceClientId }
/** K3 owner native session (opaque `tbo_`); idle timeout 24 h for client cli, 7 d for client tbd (v0.1.53 C289); 30 d absolute. */
export interface DeviceOwnerTokenResult { scope: "owner"; access_token: string; token_type: "Bearer"; expires_in: number; session_id: OwnerSessionId }
/** No token: each agent then signs a K4 assertion at the bridge `token_endpoint`. */
export interface DeviceAgentTokenResult {
  scope: "agent";
  workspace_id: WorkspaceId;
  /** v0.1.1 (C26): needed for the agent assertion `aud = tb:brg:<id>`. */
  bridge_id: BridgeId;
  mcp_url: string;
  token_endpoint: string;
  connections: { connection_id: ConnectionId; agent_id: AgentId; public_key_thumbprint: string }[];
}
export type DeviceToken = DeviceOwnerTokenResult | DeviceAgentTokenResult | DeviceHostTokenResult;
/** user_code as typed or from verification_uri_complete; normalised + digest-matched; 5 wrong codes / 10 min per account. */
/** v0.1.18 (C106a): adopt (agent onboarding with access in one approval) */
export type AdoptChannel = { kind: "buzz_channel" | "connect_inbox"; id?: string; /** ≤ 60 */ createName?: string };
export type AdoptWake = "serve" | "poll" | "none";
export interface AdoptSuggestion {
  /** ≤ 16 */
  grants: { product: ProductId; crud?: Crud[]; operations?: string[] }[];
  channel?: AdoptChannel;
  wake?: AdoptWake;
}
/** Resolved by Core for the device page (needs `ws`): agent-audience, non-money ops of the deployed release; write ops never pre-checked. */
export interface AdoptResolved {
  grants: {
    product: ProductId;
    /** v0.1.20 (F46): false = a deployed, licensed app the agent did NOT name, listed so the owner can add it (nothing ticked) */
    suggested: boolean;
    deployed: boolean;
    licensed: boolean;
    requestedCrud: Crud[];
    read: { opId: string; title: string; checked: boolean }[];
    /** v0.1.54 (C290): `crud` = the op's manifest crud (absent in the manifest → ["read"], the grant rule); the owner form's
     *  "Tick what the agent asked for" ticks the write ops whose crud ⊆ requestedCrud and contains a write verb (never money). */
    write: { opId: string; title: string; effect: Effect; holdFamily?: HoldFamily; crud: Crud[]; checked: false }[];
  }[];
  channel?: AdoptChannel;
  wake?: AdoptWake;
}
/** The owner's choice at approve; re-validated by Core; the approval is ONE transaction recorded as one applied draft. */
export interface AdoptChoice {
  grants: { product: ProductId; operations: string[] }[];
  channel?: AdoptChannel;
}
/** v0.1.18: `ws` lets Core resolve `adopt` against that workspace's deployed releases. */
export interface DeviceLookupInput { userCode: string; ws?: WorkspaceId }
/** One request. The user code itself is never returned. */
export interface DeviceRequest {
  id: DeviceRequestId;
  scope: DeviceScope;
  clientId: DeviceClientId;
  machineLabel: string;
  harness: string | null;
  /** v0.1.14 (C96): suggested `name` / `purpose` as the client sent them (display + prefill only) */
  agents: { index: number; agt: AgentId | null; publicKeyThumbprint: string; name?: string; purpose?: string; adopt?: AdoptResolved }[];
  /** v0.1.58 (S1-0): scope host only — the key thumbprint and the facts the box sent (the approval page shows them) */
  host?: DeviceRequestHost;
  state: "pending" | "approved" | "denied" | "expired" | "redeemed";
  createdAt: IsoTime;
  expiresAt: IsoTime;
}
/** scope agent: ws + one agent card per pair (by index; existing cards from agents.create). scope owner: neither. */
/** v0.1.14 (C96): `name` / `purpose` = the owner's edits on the device page, applied to that agent card on approve. */
/** v0.1.18 (C106a): `agt` optional when `name` is given (Core creates the card: `bound`, workflow = the ticked ops of `adopt`). */
/** v0.1.58 (S1-0) scope host: `ws` REQUIRED (the one choice), `label` optional (default machine_label, 1..64); no `agents`.
 *  Approve = create the server, pin its key, set the workspace infrastructure {own_infra, srv_…} — ONE consent, one draft.
 *  A workspace that already has infrastructure (any provider) is refused: 409 conflict, details.reason `infrastructure_set`
 *  (S1: no replace; moving a workspace is a later migration feature). */
export interface DeviceApproveInput { userCode: string; ws?: WorkspaceId; label?: string; agents?: { index: number; agt?: AgentId; name?: string; purpose?: string; adopt?: AdoptChoice }[] }
export interface DeviceDenyInput { userCode: string }
export interface DeviceDecision {
  id: DeviceRequestId;
  state: "approved" | "denied";
  connections: { connectionId: ConnectionId; agt: AgentId }[];
  ownerSessionId: OwnerSessionId | null;
  /** v0.1.18 (C106a): the applied draft that recorded an adopt approval */
  draftId?: DraftId;
  /** v0.1.58 (S1-0): scope host — the server the approval created */
  serverId?: ServerId;
}

// catalog
/** v0.1.60: `unmanaged` / `stopped` = the instance's state after a server detach (mode leave_running / stop): no management
 *  actions apply (Core refuses them with 409 not_managed); removing the app only forgets it. */
export type DeploymentView = "absent" | "deploying" | "running" | "failed" | "needs_keys" | "update_available" | "unmanaged" | "stopped";
export interface SettingFieldView {
  key: string;
  type: SettingType;
  label: string;
  help: string | null;
  required: boolean;
  default: SettingValue | null;
  /** v0.1.55 (C296): Core copies the manifest choice `note` and `disabled`. A disabled choice is shown greyed with its note
   *  ("soon") and can never be chosen: `instances.deploy` / `instances.update` refuse it (`validation_failed`, reason `choice_disabled`). */
  choices: SettingChoice[] | null;
  /** v0.1.11 (C69c): manifest `mutable` (default true); `false` = fixed at install, the GUI renders it read-only after deploy. */
  mutable?: boolean;
}
/** Requirement only. A value field does not exist anywhere in this registry.
 *  GUI label for source `account_default` = "workspace default keys" (N13: they live in each workspace's bridge). */
export interface KeyRequirement {
  name: string;
  label: string;
  provider: string;
  required: boolean;
  source: KeySource;
  help: string | null;
  step: string | null;
  /** v0.1.40 (R5-3, Core dcd8eaa): the manifest key's `when` (MANIFEST §9; omitted when absent or empty = the key always
   *  applies). The GUI counts or asks for a key only when the condition holds for the chosen settings (manifest `conditionHolds`). */
  when?: Condition;
}
export interface DeployStep { id: string; title: string; help: string | null; fields: SettingFieldView[]; keys: KeyRequirement[] }
export interface OfferSummary {
  id: OfferId;
  kind: "single" | "bundle";
  name: string;
  products: ProductId[];
  major: number;
  amount: number;
  currency: string;
  taxNote: string;
}
export interface ReleaseSummary { id: ReleaseId; version: string; channel: "stable" | "dev"; publishedAt: IsoTime }
export interface CatalogEntry {
  slug: ProductId;
  name: string;
  category: Category;
  summary: string;
  description: string | null;
  icon: { svgPath: string; viewBox: string } | null;
  intents: string[];
  keywords: string[];
  release: ReleaseSummary;
  /** v0.1.18 (C109): `holdFamily` → the review sheet says "asks you first" when the family is held */
  operations: { id: string; title: string; crud: Crud; effect: Effect; holdFamily?: HoldFamily }[];
  offers: OfferSummary[];
  deploySteps: DeployStep[];
  keyRequirements: KeyRequirement[];
  scopeTypes: { type: string; label: string; labelPlural: string }[];
  /** the configure screen only (manifest `ui.configurePath`) */
  hasConfigureUi: boolean;
  configurePath: string | null;
  /** v0.1.14 (Fleet): the manifest declares `ui` (Open is possible); a launch without `path` lands on `launchPath` */
  hasUi?: boolean;
  launchPath?: string | null;
  /** v0.1.22 (QA S3): a dev-only app that still runs in a STABLE workspace keeps its entry (from its running release, no
   *  offers, no update); never set otherwise */
  devOnly?: true;
  skills: string[];
  companions: { product: ProductId; purpose: string }[];
  costEstimate: CostEstimate | null;
  /** Present only when the request names a workspace. */
  workspace?: {
    licence: "none" | "unassigned_available" | "assigned";
    licenceId: LicenceId | null;
    /** v0.1.34 (C200, Terms 9A.3): the assigned licence entitles only from this time (a consumer who did not ask for
     *  immediate supply); null/absent = entitles now. `licence` is "assigned" meanwhile (no second purchase). */
    licenceActiveFrom?: IsoTime | null;
    deployment: DeploymentView;
    instanceId: InstanceId | null;
    releaseId: ReleaseId | null;
    onCanvas: boolean;
    /** Count only, from the bridge status report (S2): canvas badge; double-click opens the app's holds. */
    pendingHolds: number | null;
  };
}
export interface CatalogInput { ws?: WorkspaceId }
export interface Catalog { digest: Digest; items: CatalogEntry[] }

// releases + offers
export interface Release {
  id: ReleaseId;
  product: ProductId;
  kind: "app" | "bridge" | "desktop";
  version: string;
  channel: "stable" | "dev";
  manifestDigest: Digest | null;
  image: string | null;
  artifact: { url: string; sha256: string } | null;
  upgradeFrom: string;
  publishedAt: IsoTime;
}
/**
 * v0.1.11 (C71): wire of the signed release index body (`opt2.release-index/v2`, published by Platform, read by Core's
 * release sync; signature = ReleaseIndexClaims in types/credentials.ts). Exactly one of `image` | `source` | `artifact`.
 */
export interface ReleaseSourceRecord {
  /** `opt2-tealbrick-<x>` (GitHub repo under the opt2 owner) */
  repo: string;
  /** commit sha the build uses */
  ref: string;
  /** repo-relative Dockerfile path */
  dockerfile: string;
  /** repo-relative build root (default "."); for apps it MUST equal the manifest `runtime.build` root; Core builds with Railway rootDirectory = context */
  context?: string;
}
export interface BridgeRuntimeRecord {
  port: number;
  internalPort: number;
  healthPath: string;
  readyPath: string;
  volumes: { mountPath: string; backup: boolean }[];
  env: { name: string; source: "portal" | "provider-secret" | "public-url" | "public-url-keys" | "fixed"; value?: string }[];
}
/**
 * v0.1.29 (C174): a downloadable release file. `sha256` = `sha256:<64 hex>`. `integrity` = the npm/pnpm lockfile value
 * `sha512-<base64>` of the same bytes; REQUIRED for kinds `cli` and `package` (v0.1.30), absent on desktop entries.
 */
export interface ReleaseArtifact {
  url: string;
  sha256: string;
  integrity?: string;
}
/**
 * v0.1.29 (C174): index entry kinds. `cli` = the tealbrick CLI tarball (product `cli`) that the one-line installer and
 * `tealbrick self-update` verify (C173): only `artifact` is set, its `url` is on the public dist host (never a private repo URL),
 * `tag` = `cli-v<version>`. Readers skip kinds they do not use (L24); Core indexes app, bridge and desktop only.
 * v0.1.30 (C181): `package` = an npm library tarball other repos depend on by its dist URL (products `relay`,
 * `harness-claude`, `harness-eve`, released from the private CLI repo): same shape as `cli` (only `artifact` with `url` on the
 * public dist host, `sha256` + `integrity`), `tag` = `<product>-v<version>`. Core, the installer and self-update skip it.
 */
export type ReleaseIndexKind = "app" | "bridge" | "desktop" | "cli" | "package";
export interface ReleaseIndexEntry {
  id: ReleaseId;
  product: ProductId;
  kind: ReleaseIndexKind;
  version: string;
  channel: "stable" | "dev";
  manifestDigest: Digest | null;
  manifestUrl: string | null;
  skillsDigest: Digest | null;
  /** stable releases always carry an image pinned by digest */
  image: string | null;
  /** dev channel only (C29) */
  source: ReleaseSourceRecord | null;
  /** desktop, cli (v0.1.29) and package (v0.1.30) only */
  artifact: ReleaseArtifact | null;
  /** apps with companion services built as images: one image per service */
  services: { id: string; image: string }[] | null;
  /** kind bridge only */
  runtime: BridgeRuntimeRecord | null;
  minOs: string | null;
  notarized: boolean | null;
  upgradeFrom: string;
  repo: string;
  commit: string;
  tag: string | null;
  publishedAt: IsoTime;
  /** v0.1.21 (C113): true = a dev-only product (signer DEV_ONLY_PRODUCTS: QA fixtures, spine samples). Signed in the index; Core
   *  never offers it to a STABLE workspace (no dev fallback for it) and refuses `instances.deploy` / `update` there. */
  devOnly?: true;
  /** v0.1.15 (C104): minimum versions this release needs; the signer computes `bridge` with @opt2-tealbrick/manifest
   *  `requiredBridgeVersion(manifest)` (max of the feature table and the manifest's declared `requires.bridge`), `sdk` from
   *  the app's locked @opt2-tealbrick/miniapp-sdk. Core refuses deploy / update when the workspace bridge is older
   *  (`bridge_too_old`, 409, with the needed version). Absent = no requirement. */
  requires?: { bridge?: string; sdk?: string };
}
export interface ReleaseIndexBody {
  schema: "opt2.release-index/v2";
  generatedAt: IsoTime;
  releases: ReleaseIndexEntry[];
  harnesses: HarnessOption[];
  offers: unknown[];
}
/** v0.1.12 (C79): Core's signing key ring, public halves only, plus the seq of the key-set statement Core emits.
 *  Ceremony INPUT for Platform (keyset-request.json). NOT a trust path: verifiers never read it (trust = root-signed statement only). */
export interface PortalSigningKeys {
  keys: { jwk: Ed25519PublicJwk; status: "pending" | "active" | "retired"; activateAt: IsoTime }[];
  keySetSeq: number | null;
}
export interface ReleaseListInput { product: ProductId; channel?: "stable" | "dev" }
export interface ReleaseList { items: Release[] }
export interface Offer extends OfferSummary { livemode: boolean; verifiedAt: IsoTime }
export interface OfferListInput { product?: ProductId }
export interface OfferList { items: Offer[] }

// canvas, edges, hooks
export interface CanvasNode { kind: "agent" | "app"; ref: AgentId | ProductId; x: number; y: number }
export interface Edge {
  id: EdgeId;
  kind: "agent_app" | "app_app";
  from: { type: "agent"; id: AgentId } | { type: "app"; product: ProductId };
  to: { product: ProductId };
  crud: Crud[];
  scopeType: string | null;
  /** Display only (≤ 80 chars), reported by the app via the bridge ack. */
  scopeSummary: string | null;
  enabled: boolean;
  origin: "owner" | "manifest";
  /** v0.1.14 (A2A-11): `blocked` = an app→app edge whose companion declaration fails M-CP-2 against the target's current release */
  grantState: "active" | "unlicensed" | "not_deployed" | "paused" | "disabled" | "blocked";
  /** v0.1.14 (A2A-11): app→app edges only */
  blockedReason?: "companion_op_missing" | "target_not_deployed";
  /** ≤ 200 chars, plain text */
  blockedDetail?: string;
  /** v0.1.19 (C111, agent→app only): null/absent = verb-level access; an array = the op allow-list (the grant's `wf`, any card mode) */
  ops?: string[] | null;
  /** v0.1.19 (C111, agent→app with a deployed target): what toggling each verb would change (grant rule `op.crud ⊆ verbs`;
   *  op-limited edges stay exact) — the GUI review sheet shows it (one rule, L1) */
  verbChanges?: Partial<Record<Crud, { unlocks: string[]; removes: string[] }>>;
}
export interface Canvas { ws: WorkspaceId; revision: number; nodes: CanvasNode[]; edges: Edge[] }
export interface CanvasSaveInput { ws: WorkspaceId; revision: number; nodes: CanvasNode[] }
export interface EdgeCreateInput { ws: WorkspaceId; agt: AgentId; product: ProductId; crud: Crud[]; scopeType?: string }
/** v0.1.19 (C111): `ops` = op allow-list (agent-audience, non-money ops of the deployed release; `crud` defaults to the union
 *  the ops need); null = back to verb-level access. */
export interface EdgeUpdateInput { ws: WorkspaceId; edg: EdgeId; crud?: Crud[]; scopeType?: string | null; enabled?: boolean; ops?: string[] | null }
export interface EdgeRef { ws: WorkspaceId; edg: EdgeId }
export interface HookSubscription {
  ins: InstanceId;
  product: ProductId;
  hookId: string;
  title: string;
  phase: "before" | "context" | "after";
  order: number;
  matchSummary: string;
  enabled: boolean;
  active: boolean;
}
export interface HookList { items: HookSubscription[] }
export interface HookSetInput { ws: WorkspaceId; ins: InstanceId; hookId: string; enabled: boolean }

// instances (deployment + registration in one record)
/** v0.1.22: `refused` = the bridge refused the app's manifest and the app never ran (terminal until a clean report or a new
 *  release; `lastError` carries the refusal code). It returns to `registering` / `running` on a clean bridge report. */
/** v0.1.60: after a server detach the instances of that workspace are `unmanaged` (mode leave_running: they keep running on the
 *  owner's server, Portal no longer manages them) or `stopped` (mode stop: stopped there, data kept). Neither deletes data. */
export type DeployState = "queued" | "deploying" | "registering" | "running" | "failed" | "refused" | "cancelled" | "removing" | "removed" | "unmanaged" | "stopped";
/** v0.1.22: bridge manifest refusal codes Core copies into `Instance.lastError.code` (a manifest validator issue code passes
 *  through as a string; `manifest_rejected` = several codes in one report). */
export type BridgeManifestRefusalCode = "manifest_mismatch" | "bridge_too_old" | "manifest_rejected" | (string & {});
export interface Instance {
  id: InstanceId;
  ws: WorkspaceId;
  product: ProductId;
  releaseId: ReleaseId;
  version: string;
  state: DeployState;
  health: "ok" | "degraded" | "down" | "unknown";
  healthAt: IsoTime | null;
  registered: boolean;
  missingKeys: string[];
  /** Count only (S2). */
  pendingHolds: number;
  licensed: boolean;
  updateAvailable: ReleaseSummary | null;
  /** v0.1.14 (C100): companion access changes from the running release to `updateAvailable` (empty = none); the GUI
   *  shows widening entries before Confirm (the confirm is the consent) */
  updateCompanionChanges?: CompanionChange[];
  /** v0.1.14 (A2A-11): this app's companion connections that do not work now */
  companionIssues?: { target: ProductId | "*"; edge: EdgeId | null; state: "blocked" | "not_deployed" | "unlicensed" | "paused" | "disabled"; reason: "companion_op_missing" | "target_not_deployed" | null; detail: string }[];
  provider: ProviderKey | "own_infra";
  settings: Record<string, SettingValue>;
  /** v0.1.56 (C296 INFO-1): the app's own attention as the bridge reported it (AppStatus.attention: code + plain reason,
   *  ≤ 200 chars, cleaned by Core), so the owner sees WHY an app is degraded (e.g. engine_missing). Absent when none. */
  attention?: { code: string; reason: string } | null;
  lastError: InstanceError | null;
  createdAt: IsoTime;
  /** v0.1.13 (C82): consents the release asks for (wildcard companion → `holds_pending_all`) and their state */
  consents?: InstanceConsent[];
  /** v0.1.39 (C213 US-3, E3): the outcome of the last version-changing update. GUI card text for `rolled_back`:
   *  "Update failed — rolled back to <from>, your data is restored to <dataRestoredTo> UTC." (or "your data is kept"). */
  lastUpdate?: InstanceLastUpdate;
  /** v0.1.39 (US-3): a version-changing update in progress; `rollingBack` = the GUI's "Undoing" step */
  updating?: { from: string; to: string; rollingBack: boolean };
}
/** v0.1.39 (US-3) */
export interface InstanceLastUpdate {
  /** v0.1.51 (RS-7.4): + `kept_new` (the new version was kept, nothing undone) and `held` (frozen for an operator; ops 409). */
  outcome: "updated" | "rolled_back" | "rollback_failed" | "kept_new" | "held";
  from: string;
  to: string;
  at: IsoTime;
  reason?: { code: string; message: string };
  /** rolled_back with a snapshot restore: the data is as it was when the update started; null = data kept */
  dataRestoredTo?: IsoTime | null;
  /** v0.1.53 (C291): the miniapp-sdk version the OLD (`from`) version reported before the update; absent on updates before Core
   *  stored it (then an owner rollback-with-restore is not offered: restorable null). */
  fromSdkVersion?: string;
}
/** v0.1.13 (C82). GUI text for `holds_pending_all`: "This app can see the pending approvals of all apps". */
export type ConsentKind = "holds_pending_all";
export interface InstanceConsent { kind: ConsentKind; granted: boolean; at: IsoTime | null; by: PersonId | null }
export interface InstanceConsentInput { ws: WorkspaceId; ins: InstanceId; kind: ConsentKind; granted: boolean }
/** v0.1.14 (C100) */
export interface CompanionChange {
  target: ProductId | "*";
  change: "added" | "removed" | "changed";
  operations: { added: string[]; removed: string[] };
  crud: { added: Crud[]; removed: Crud[] };
  /** true when the update grants more (new ops, new crud, a new target) */
  widens: boolean;
}
/** v0.1.40: `Instance.lastError`. `reason` = a finer cause (e.g. `kept_data_in_the_way`, C226); `keptDataId` = the
 *  `kept_data.list` item in the way (null when it belongs to another account; absent otherwise). */
export interface InstanceError {
  code: ErrorCode | BridgeManifestRefusalCode;
  message: string;
  reason?: string;
  keptDataId?: KeptDataId | null;
}
export interface InstanceList { items: Instance[] }
export interface DeployInput { ws: WorkspaceId; product: ProductId; releaseId?: ReleaseId; settings: Record<string, SettingValue> }
export interface DeployResult { instance: Instance }
/** B1: the bridge deploys when workspace infrastructure is set (onboarding step 1), not with the first app.
 *  v0.1.40 (F122): `outcome` says what the call did — `started` (a deploy or update began), `in_progress` (one is already
 *  running), `up_to_date` (no newer bridge release), `unchanged` (nothing to update: own infrastructure or no service yet),
 *  `revived` (a removed bridge came back on its kept service + volume, C226). Readers that miss it: `bridge.state`. */
export interface BridgeDeployResult { bridge: BridgeStatus; outcome?: BridgeDeployOutcome }
export type BridgeDeployOutcome = "started" | "in_progress" | "up_to_date" | "unchanged" | "revived";
/** S6: settings reach the app only as env at (re)deploy; a settings change redeploys. Never in the slice. */
export interface InstanceUpdateInput { ws: WorkspaceId; ins: InstanceId; releaseId?: ReleaseId; settings?: Record<string, SettingValue> }
export interface RollbackInput {
  ws: WorkspaceId;
  ins: InstanceId;
  releaseId?: ReleaseId;
  /** v0.1.53 (QA INFO-1, C291): go back AND restore the data from the pre-update snapshot the running version took when it was updated
   *  from the target. Accepted ONLY when the same call without `restore` would be refused `rollback_needs_restore` and
   *  `details.restorable` is non-null; `snapshot` + `sha256` must equal the instance's CURRENT reported `preUpdateSnapshot` exactly
   *  (`acceptDataLoss` literal `true`: changes since the snapshot are lost). Anything else → `release_not_deployable`
   *  `details.reason` `rollback_restore_unavailable` (acceptDataLoss not true → 400 `validation_failed`). Not allowed in drafts. */
  restore?: { snapshot: string; sha256: string; acceptDataLoss: true };
}
/** v0.1.53 (QA INFO-1): `details.restorable` of a `release_not_deployable` `rollback_needs_restore` refusal: the pre-update snapshot the
 *  owner can restore with `RollbackInput.restore`, or `null` (no usable snapshot: the owner contacts support; ops RUNBOOK §6b). */
export interface RollbackRestorable { snapshot: string; sha256: string; createdAt: IsoTime }
/** I15: deleteData defaults to false (services stopped, volumes and backups kept). */
export interface RemoveInput { ws: WorkspaceId; ins: InstanceId; deleteData: boolean }
export interface RemoveResult {
  id: InstanceId | BridgeId;
  state: "removing" | "removed";
  dataDeleted: boolean;
  /** v0.1.40 (C223): what stays in the owner's infrastructure after the removal (the GUI words it; Core never deletes the
   *  project): nothing, an empty project, or the stopped service with its data (kept data, C226) */
  leftOnProvider?: "nothing" | "empty_destination" | "stopped_service_and_data";
  destinationName?: string | null;
  lastError?: { code: string; message: string } | null;
}
/** `register` = instance claim via the bridge, or bridge enrolment for bridge.deploy. */
/** v0.1.51 (RS-7.4): + `waiting_bridge` (an app update waits for a running bridge update, G1), `waiting_apps` (a bridge
 *  update waits for running app update attempts), `held` (frozen update, see ErrorCode `update_held`). Clients render unknown
 *  phases by their message. */
export type DeployPhase = "provision" | "image" | "start" | "register" | "health" | "ready" | "waiting_bridge" | "waiting_apps" | "held";
/** SSE `data:` payloads; event name = `type`. Heartbeat comment every 15 s; resumable with Last-Event-ID. */
export type DeployProgressEvent =
  | { type: "phase"; phase: DeployPhase; status: "started" | "done" | "failed"; message: string; elapsedMs: number }
  | { type: "log"; lines: { ts: IsoTime; source: "build" | "deploy"; message: string }[] }
  | { type: "done"; state: DeployState }
  | { type: "error"; error: { code: ErrorCode; message: string } };
export interface OwnInfraRegisterInput { ws: WorkspaceId; product: ProductId; releaseId?: ReleaseId }
/** K6 for one neighbour instance; code shown once; env has only public values + the code. */
export interface EnrolmentCode { code: string; expiresAt: IsoTime; instanceId: InstanceId | null; replacesBridge: BridgeId | null; env: EnvVar[] }

// bridge (owner view)
export interface BridgeStatus {
  id: BridgeId | null;
  state: BridgeState;
  version: string | null;
  mcpUrl: string | null;
  lastSeenAt: IsoTime | null;
  ackedRevision: number | null;
  currentRevision: number;
  /** v0.1.40 (C223, C226): the last deploy/update error of the bridge (null while `removing` or when none) */
  lastError?: InstanceError | null;
  /** v0.1.40 (C226): a removed bridge of this workspace whose service + volume are kept on the same destination
   *  (Deploy revives it); set only when the bridge is absent, failed or cancelled */
  keptData?: { id: KeptDataId; removedAt: IsoTime } | null;
}

// kept data (v0.1.40, C226): removed instances whose provider service + volume stay on the owner's infrastructure
/** The removed instance's id (`ins_…` app, `brg_…` bridge) = the item id. */
export type KeptDataId = InstanceId | BridgeId;
export interface KeptDataItem {
  id: KeptDataId;
  kind: "app" | "bridge";
  product: string;
  /** manifest name, or "Workspace bridge" */
  name: string;
  workspace: { id: WorkspaceId; name: string; deleted: boolean };
  provider: ProviderKey;
  destination: { id: string; name: string | null };
  /** main service first, then companions; the main `name` is the confirm text for kept_data.delete */
  services: { name: string; serviceId: string; volumeIds: string[] }[];
  keptSince: IsoTime;
  monthlyCost: { expected: number; high: number; currency: "USD"; basis: string } | null;
  state: "kept" | "deleting";
  /** only while `deleting` after a failed try */
  lastError: { code: string; message: string } | null;
}
/** ≤ 200 items, newest removal first; one item per provider service; never another account's item. */
export interface KeptDataList { items: KeptDataItem[] }
/** `confirm` = the item's main service name exactly (typed by the owner). 404 `not_found` (absent, other account, own
 *  infrastructure); 409 `conflict` details.reason `not_kept` | `data_shared` (a live instance uses that service);
 *  400 `validation_failed` (wrong confirm). A repeat after completion answers `deleted`. */
export interface KeptDataDeleteInput { id: KeptDataId; confirm: string }
export interface KeptDataDeleteResult { id: KeptDataId; state: "deleting" | "deleted"; lastError: null }

// keys + tickets (no key value anywhere)
export interface KeyStatus {
  bridgeReady: boolean;
  reportedAt: IsoTime | null;
  items: { name: string; label: string; required: boolean; source: KeySource; set: boolean | null; usedBy: ProductId[] }[];
}
export interface KeyTicketInput { ws: WorkspaceId; names?: string[]; returnTo?: string }
/** v0.1.13 (C86): `path` = app-relative, starts with `/`, ≤ 512 chars; refused `path_invalid` (400) when it has a scheme,
 *  a host, `//`, `\\`, a `..` segment (also after percent-decoding) or control characters. The bridge serves it under
 *  `/a/<product>` of the TARGET app only. */
export interface LaunchTicketInput { ws: WorkspaceId; product: ProductId; path?: string }
/** url = bridge origin + one-time K11 ticket (form POST target). */
export interface TicketResult { url: string; ticket: string; expiresAt: IsoTime }

// licences + commerce
export interface Licence {
  id: LicenceId;
  product: ProductId;
  major: number;
  /** v0.1.36 (C184 comps): `revoked` / `expired` occur only for source "comp" (the customer list leaves those out) */
  status: "active" | "refunded" | "disputed" | "review" | "revoked" | "expired";
  /** v0.1.36: null for a complimentary licence (no offer, no order, no invoice) */
  offerId: OfferId | null;
  orderId: OrderId | null;
  fromBundle: boolean;
  assignment: { ws: WorkspaceId; workspaceName: string; assignedAt: IsoTime } | null;
  livemode: boolean;
  createdAt: IsoTime;
  /** v0.1.34 (C200, Terms 9A.3): not-before time; the licence entitles only from then (isEntitled honours it). */
  activeFrom?: IsoTime | null;
  /** v0.1.36 (C184/C203): purchase (Stripe order) or comp (complimentary, issued by an operator; UI word "Free licence").
   *  Absent = purchase. */
  source?: "purchase" | "comp";
  /** v0.1.36: a comp's end; null/absent = no end (purchase, or a lifetime comp for this major). isEntitled honours it. */
  expiresAt?: IsoTime | null;
}
export type LicenceListInput = PageQuery & { product?: ProductId; assigned?: boolean };
export type LicenceList = Page<Licence>;
export interface LicenceRef { lic: LicenceId }
export interface LicenceTargetInput { lic: LicenceId; ws: WorkspaceId }
export interface LicenceChange { licence: Licence; configRevisions: { ws: WorkspaceId; revision: number }[] }
/** v0.1.34 (C200, legal v1.1 Terms 1.2, 1.3, 9A.3; replaces the 0.1.33 union, which nothing used). The three checkout boxes,
 *  all unticked at first: `termsAccepted` = the acceptance box again at checkout (must be true); `business` = the optional
 *  "I am buying for my trade, business or profession." (a VAT/tax ID given at Stripe also makes the buyer a business);
 *  `immediateSupply` = the consumer box "I ask Tealbrick to start supplying this licence immediately, before the 14-day
 *  withdrawal period ends. I acknowledge that I lose my right of withdrawal once supply has started." (only when not
 *  business; unticked → the purchase completes and the licence entitles only after the withdrawal period). */
export interface CheckoutBuyer { termsAccepted: true; business: boolean; immediateSupply?: boolean }
/** v0.1.33 (C200): `buyer` is required by Core 0.1.33+ (400 validation_failed, details.reason buyer_required); optional in the
 *  type so a draft step can omit it: drafts.apply supplies it (DraftApplyInput.buyer). */
export interface CheckoutInput { offerId: OfferId; ws?: WorkspaceId; returnPath: string; buyer?: CheckoutBuyer }
/** v0.1.9 (C60): Stripe customer portal (invoices, receipts). `returnPath` = path on the Portal origin (same rule as CheckoutInput). */
export interface BillingPortalInput { returnPath: string }
/** One-time Stripe portal link: bearer-like, never logged or stored (bodyLog none, not idempotent), browser only. */
export interface BillingPortalSession { url: string; expiresAt: IsoTime }
export interface Checkout { orderId: OrderId; url: string; expiresAt: IsoTime }
export interface OrderRef { ord: OrderId }
export interface Order {
  id: OrderId;
  offerId: OfferId;
  state: "open" | "paid" | "failed" | "expired" | "refunded";
  amountSubtotal: number;
  amountTax: number | null;
  amountTotal: number | null;
  currency: string;
  licenceIds: LicenceId[];
  assignTo: WorkspaceId | null;
  createdAt: IsoTime;
  paidAt: IsoTime | null;
  /** v0.1.32 (C196 ENG-2): the business evidence stored with the order; omitted by Core before 0.1.32. */
  business?: OrderBusiness;
  /** v0.1.40 (C92): discount in minor units (0 = none) and the promotion code used at checkout */
  amountDiscount?: number;
  promotionCode?: string | null;
}
/** v0.1.32 (C196 ENG-2): Terms §1.2-1.3 evidence. `documents` = what the account had accepted when checkout started
 *  (Core refuses checkout without it: 409 terms_not_accepted). After payment: the business name Stripe collected, whether a
 *  tax ID was given (the tax ID itself stays at Stripe) and the checkout terms tick (`accepted`, null = not collected). */
export interface OrderBusiness {
  documents: LegalDocumentRef[];
  acceptedAt: IsoTime;
  name: string | null;
  taxIdProvided: boolean | null;
  checkoutTerms: "accepted" | null;
  /** v0.1.33 (C200): the buyer type chosen before checkout; omitted on orders before 0.1.33 (business only then) */
  buyerType?: "business" | "consumer";
  /** v0.1.33 (C200): consumer orders: time of the immediate-supply request + acknowledgement tick (Terms 9A.3); null otherwise */
  withdrawalWaiverAt?: IsoTime | null;
  /** v0.1.34: the buyer ticked the business box (a VAT ID at Stripe can make buyerType business without it) */
  businessDeclared?: boolean;
  /** v0.1.34: time of the acceptance box ticked again at checkout */
  checkoutAcceptedAt?: IsoTime;
  /** v0.1.34: the order's licences entitle from this time (consumer without immediate supply); null = at once */
  licenceActiveFrom?: IsoTime | null;
}
/** v0.1.33 (C200): the order evidence covers consumers too. */
export type OrderBuyer = OrderBusiness;
export interface UnpaidCount { ws: WorkspaceId; count: number; products: ProductId[] }
/** Raw Stripe event body; verified with the sealed webhook secret before parsing. */
export interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: Record<string, unknown> } }
export interface WebhookAck { received: true }
/** v0.1.4 (C49): Clerk webhook event (svix-signed; verified with the Clerk webhook signing secret held sealed in Core). */
export interface ClerkEvent { type: string; object: "event"; data: Record<string, unknown> }

// skills
export interface SkillsInput { ws: WorkspaceId; agt?: AgentId }
export interface SkillFile {
  key: string;
  path: string;
  title: string;
  when: string | null;
  body: string;
  sourceProduct: ProductId;
  edited: boolean;
  generatedDigest: Digest;
}
export interface SkillBundle { ws: WorkspaceId; digest: Digest; files: SkillFile[] }
export interface SkillOverrideInput { ws: WorkspaceId; skillKey: string; body: string; baseDigest: Digest }
export interface SkillKeyRef { ws: WorkspaceId; skillKey: string }
/** application/zip of the rendered bundle (agent variables filled when `agt` is given). */
export interface ZipFile { contentType: "application/zip"; filename: string }

// downloads
export interface DesktopDownload { releaseId: ReleaseId; version: string; url: string; sha256: string; notarized: boolean; minOs: string; publishedAt: IsoTime }

// owner native sessions (K3: owner CLI and TBD human sign-in)
export interface OwnerSession {
  id: OwnerSessionId; client: OwnerSessionClient; machineLabel: string; createdAt: IsoTime; lastUsedAt: IsoTime | null; idleExpiresAt: IsoTime; expiresAt: IsoTime; current: boolean;
  /** v0.1.64 (C332): the session's push device (client tbm only); absent = none. Never the token. */
  pushDevice?: { platform: PushPlatform; registeredAt: IsoTime };
}
export interface OwnerSessionList { items: OwnerSession[] }
export interface OwnerSessionRef { osn: OwnerSessionId }

// v0.1.64 (C332): push devices of owner sessions (Teal Brick Mobile). PORTAL-API "v0.1.64" A.
export type PushPlatform = "ios" | "android";
/** APNs needs the environment of the app build; FCM ignores it (send "production"). */
export type PushEnvironment = "sandbox" | "production";
/** One push device per owner session; a new register replaces the old row. The token never leaves Core again. */
export interface PushDeviceRegisterInput {
  platform: PushPlatform;
  /** APNs device token (hex) or FCM registration token; 1..PUSH.tokenMax chars */
  token: string;
  /** iOS bundle id / Android package name; must be in Core's configured app ids (else validation_failed) */
  appId: string;
  environment: PushEnvironment;
}
export interface PushDevice { id: PushDeviceId; platform: PushPlatform; appId: string; environment: PushEnvironment; registeredAt: IsoTime; lastPushAt: IsoTime | null }

/** v0.1.64 (C332): push rules (Core sender, CORE "v0.1.64" changelog). Push text never carries content (EVAL IN-3, v1 notify rule). */
export const PUSH = {
  /** owner-session clients that may register a push device */
  clients: ["tbm"],
  platforms: ["ios", "android"],
  tokenMax: 4096,
  appIdMax: 200,
  /** at most one push per (workspace, kind) in this window */
  minIntervalPerWorkspaceS: 60,
  /** push kinds in this version; the payload is this fixed text + `{ kind, ws }` (decisions) or `{ kind, osn }` (session_added), nothing else.
   *  session_added (C337, residual risk of a phished tbm code): to the person's OTHER push devices when a new tbm session is created. */
  kinds: { decisions: "A decision is waiting", session_added: "New TBM sign-in on your account. Not you? Open TBM." },
} as const satisfies { clients: readonly OwnerSessionClient[]; platforms: readonly PushPlatform[]; tokenMax: number; appIdMax: number; minIntervalPerWorkspaceS: number; kinds: Record<string, string> };
export type PushKind = keyof typeof PUSH.kinds;

// v0.1.64 (C326): person-op relay for native owner sessions (TBD, TBM). PORTAL-API "v0.1.64" B, BRIDGE §15, SDK-API §21.
/**
 * The ONE allow-list (Core AND the app SDK check it). Every other (product, op) → person_op_not_allowed; adding an entry is a
 * spec patch + QA, with a reviewed statement that the op's output carries no credential (RT7 by review: the result body is
 * app data, not a spec type). Standard ops `tb.*` may never be added except `tb.holds_list` / `tb.holds_decide` (key, export
 * and scope ops never travel this path).
 * - `read` ops: every client in `clients`. `write` ops: only `writeClients` — a `tbd` K3 lives on a Mac where the owner's own
 *   agents run under the same OS user (CREDENTIALS §12), so it must never become an approval credential (review B1).
 * - `refuseFamiliesFor` (C332a(4)): a write that decides a held action refuses `family_needs_portal` when the K14 `cli` is the
 *   key and the family is listed OR UNKNOWN (fail closed). Core does not see families; the app enforces it.
 */
export const PERSON_OP_RELAY = {
  /** v0.1.64: `tbm` only. `tbd` (same OS user as the owner's agents) waits for its own design — CREDENTIALS v0.1.64. */
  clients: ["tbm"],
  writeClients: ["tbm"],
  allow: [
    { product: "inbox", read: ["items_list", "item_get"], write: ["item_decide", "item_snooze", "item_ack"] },
  ],
  refuseFamiliesFor: { tbm: ["money", "destructive"], tbd: [] },
  /** Core holds the K3 request this long for the bridge's answer, then 504 person_op_timeout */
  coreWaitS: 12,
  /** a queued row the bridge has not TAKEN by then expires and is never handed out (no late delivery after Core's answer) */
  queueTtlS: 5,
  /** the bridge's forward timeout to the app; queueTtlS + bridgeForwardS < coreWaitS */
  bridgeForwardS: 5,
  /** at most this many rows queued or taken per workspace, else 409 conflict {reason: "busy"} */
  queueMaxPerWorkspace: 8,
  maxInputBytes: 32_768,
  /** the result travels as a JSON string inside a json-transport post (256 KiB cap): keep well below it */
  maxOutputBytes: 98_304,
  /** bridge_api.person_ops long-poll wait */
  pollWaitS: 25,
} as const satisfies {
  clients: readonly PersonOpClient[]; writeClients: readonly PersonOpClient[];
  allow: readonly { product: ProductId; read: readonly string[]; write: readonly string[] }[];
  refuseFamiliesFor: Record<PersonOpClient, readonly HoldFamily[]>; coreWaitS: number; queueTtlS: number; bridgeForwardS: number;
  queueMaxPerWorkspace: number; maxInputBytes: number; maxOutputBytes: number; pollWaitS: number;
};
/** K3 input: the op input is passed through verbatim (the app validates it against its manifest schema). */
export interface PersonOpCallInput {
  ws: WorkspaceId; ins: InstanceId; op: string; input: Record<string, unknown>;
  /** 16..64 chars [A-Za-z0-9_-], new per user action; minted into K14 `idk`; the app uses it as its idempotency key (SDK §4.4) */
  idempotencyKey: string;
}
/** The app's answer. `status` = the app's HTTP status; `body` = the app's JSON body (output, or its CORE §8 error envelope). */
export interface PersonOpCallResult { status: number; body: unknown }
/** Bridge pull (long-poll). */
export interface BridgePersonOpsQuery { wait?: number }
export interface BridgePersonOp {
  id: PersonOpId; ins: InstanceId; op: string;
  /** K14, typ tb-person-op+jwt; forwarded once in header TB-Person-Op */
  jws: CompactJws;
  /** the exact input bytes (UTF-8 JSON text) whose sha256 is K14 `bd`; forwarded as the body unchanged */
  body: string;
  expiresAt: IsoTime;
}
export interface BridgePersonOpBatch { items: BridgePersonOp[] }
export interface BridgePersonOpResultInput {
  pop: PersonOpId;
  /** app HTTP status; -1 = not delivered (the app was not reached, the op did not run → Core 502 upstream_timeout);
   *  0 = outcome unknown (timeout after sending, body over maxOutputBytes → Core 504 person_op_timeout) */
  status: number;
  /** the app's JSON body as text, ≤ PERSON_OP_RELAY.maxOutputBytes */
  body: string;
}

// v0.1.64 (C332a(3)): public Portal identity for native clients checking a custom Portal URL before sign-in.
export interface PortalInfo {
  /** constant: a client refuses any other value */
  service: "tealbrick-portal";
  api: "v1";
  /** SPEC_VERSION Core runs */
  spec: string;
  /** display name of this Portal (operator setting; default "Teal Brick") */
  name: string;
  /** owner-session clients the device flow accepts here */
  ownerClients: OwnerSessionClient[];
}

// drafts + recipes (Consent Registry)
/** Any string value in a step input may be replaced by a ref to an earlier step output (CORE §13). */
export interface DraftRef { $ref: `#/steps/${number}/output${string}` }
export interface DraftStep { opId: DraftableOpId; input: Record<string, unknown> }
export type DraftState = "open" | "submitted" | "applying" | "applied" | "failed" | "rejected";
export interface DraftStepView {
  n: number;
  opId: DraftableOpId;
  input: Record<string, unknown>;
  summary: string;
  effect: "write" | "destructive" | "money";
  confirm: boolean;
  status: "pending" | "ok" | "failed" | "skipped" | "handed_off";
}
export interface ApplyResult {
  state: "applied" | "failed";
  steps: { n: number; opId: DraftableOpId; status: "ok" | "failed" | "skipped" | "handed_off"; output?: unknown; error?: { code: ErrorCode; message: string } }[];
  checkout: { orderIds: OrderId[]; url: string } | null;
  receiptId: ReceiptId;
}
export interface Draft {
  id: DraftId;
  ws: WorkspaceId | null;
  title: string;
  revision: number;
  state: DraftState;
  /** v0.1.41: + `device` = the draft an agent device approval (adopt, C96) wrote and applied at once; `id` = the device request. */
  createdBy: { kind: "owner_session"; id: OwnerSessionId; label: string } | { kind: "browser" } | { kind: "recipe"; title: string } | { kind: "device"; id: DeviceRequestId };
  steps: DraftStepView[];
  confirmCount: number;
  requiresPurchase: boolean;
  result: ApplyResult | null;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  /** v0.1.41 (G3 R1, F126): the recipe's own text (what the recipe CLAIMS to do; shown as a claim, never as Portal text) */
  description?: string | null;
  /** v0.1.41 (G3 R1, F126): every step that LOWERS protection, recomputed by Core against the current state on every read
   *  (empty once applied). drafts.apply needs each id in `confirmLoosening`. Older Core omits it. */
  loosening?: LooseningItem[];
}
/** v0.1.41 (G3 R1, F126): one step that lowers protection: an owner approval turned off (card or apps-policy hold family),
 *  a cap raised or removed, a bound card set free or its workflow widened, a hook switched off, a grant that adds write
 *  access, an op-limited grant widened, a write connection switched on, a paused card resumed. Read-only access and
 *  tightening steps are never items. */
export interface LooseningItem {
  /** `<step n>:<setting key>`, stable for one draft revision */
  id: string;
  /** the step number */
  n: number;
  opId: string;
  /** what the setting belongs to, e.g. `Agent "Sales" (new in step 1)` */
  subject: string;
  /** the setting in words, e.g. `Ask you before deleting or removing things` */
  setting: string;
  before: string;
  after: string;
  /** optional plain detail, e.g. the write operations a grant unlocks */
  detail?: string;
}
export interface DraftSummary {
  id: DraftId;
  ws: WorkspaceId | null;
  title: string;
  state: DraftState;
  createdByLabel: string;
  stepCount: number;
  requiresPurchase: boolean;
  createdAt: IsoTime;
}
export type DraftListInput = PageQuery & { ws?: WorkspaceId; state?: DraftState };
export type DraftList = Page<DraftSummary>;
export interface DraftCreateInput { ws?: WorkspaceId; title: string; steps: DraftStep[] }
export interface DraftRefInput { drf: DraftId }
export interface DraftUpdateInput { drf: DraftId; revision: number; title?: string; steps?: DraftStep[] }
export interface DraftSubmitResult { id: DraftId; state: "submitted"; reviewUrl: string }
/** I18: validation against the route table and current state; nothing is applied. */
export interface DraftValidation {
  valid: boolean;
  revision: number;
  issues: { n: number | null; code: ErrorCode; message: string; pointer: string | null }[];
}
/** v0.1.33 (C200): `buyer` = the person's checkout choice, required when the draft has a payment step; it replaces any
 *  `buyer` inside the draft's checkout steps (an agent never chooses it). */
/** v0.1.41 (G3 R1, F126): `confirmLoosening` = exactly the ids of Core's recomputed `Draft.loosening` list, each ticked by
 *  the person (one confirmation per item). A different set → 400 `validation_failed` details.reason `loosening_unconfirmed`
 *  (+ `details.loosening` = the current list, `pointer: "/confirmLoosening"`). A draft with loosening items is applied only
 *  by a person principal (browser); any other principal → 403 `forbidden`. */
export interface DraftApplyInput { drf: DraftId; revision: number; confirm: true; buyer?: CheckoutBuyer; confirmLoosening?: string[] }
export interface DraftRejectInput { drf: DraftId; reason?: string }
/** Exported recipe: steps without workspace-bound ids (`ws` stripped; other ids must be $refs). */
export interface Recipe { format: "tealbrick.recipe/1"; title: string; description: string | null; steps: DraftStep[] }
export interface RecipeImportInput { ws?: WorkspaceId; recipe: Recipe }

// audit
export type AuditListInput = PageQuery & { ws?: WorkspaceId; action?: AuditAction };
export interface AuditEvent {
  id: AuditEventId;
  at: IsoTime;
  actor: { kind: "person" | "owner_session" | "bridge" | "stripe" | "system"; id: string };
  action: AuditAction;
  ws: WorkspaceId | null;
  subject: string | null;
  draftId: DraftId | null;
  outcome: "ok" | "failed";
  requestId: string;
}
export type AuditList = Page<AuditEvent>;

// bridge-facing: payload documents are owned by BRIDGE.md and imported from ./bridge.ts
/** Request body of bridge_api.enrol. */
export type BridgeEnrolInput = EnrolRequest;
export type BridgeEnrolResult = EnrolResponse;
export type BridgeConfigInput = ConfigPullQuery;
/** 200 `application/jose`: the config JWS itself (`tb-config+jws`, slices inside `apps[].slice`); 304 after `wait`. */
export type BridgeConfig = CompactJws;
export type BridgeAckInput = StatusReport;
/** Connections and claims Core recorded come back in the next config (BRIDGE §5.6). */
export interface BridgeAckResult { accepted: true; configRevision: number }

// internal
export interface RouteRegistryDoc { digest: Digest; routes: readonly RouteOp[] }
/** `ok` = db reachable (platform health checks must not flap on a slow sweep). v0.1.14: `deployWorker` (Core 542d51a). */
export interface Health {
  ok: boolean; version: string; db: "ok" | "down"; deployWorker?: DeployWorkerHealth;
  /** v0.1.37 (ADM-8): what Core already returned untyped (CORE-02): Stripe mode + paid sessions refused in the last 30 days */
  commerce?: { livemode: boolean; refusedSessions: number; lastRefusedAt: IsoTime | null };
}
export interface DeployWorkerHealth {
  /** the sweep ran < 90 s ago */
  alive: boolean;
  lastSweepAt: IsoTime | null;
  /** jobs running in this process */
  active: number;
  /** instances queued / deploying / removing */
  queued: number;
  /** in flight but no live lease */
  unowned: number;
  /** jobs this process resumed since boot */
  resumed: number;
}

// ───────────────────────────── schema name map ─────────────────────────────
// input/output columns name a key of this map, so a typo fails typecheck.
export interface SchemaMap {
  Empty: Empty; Ok: Ok; WorkspaceRef: WorkspaceRef; AgentRef: AgentRef; InstanceRef: InstanceRef;
  ProviderRef: ProviderRef; ConfigChange: ConfigChange;
  AccountMe: AccountMe; SetCurrentWorkspaceInput: SetCurrentWorkspaceInput; TermsAcceptInput: TermsAcceptInput;
  Workspace: Workspace; WorkspaceListInput: WorkspaceListInput; WorkspaceList: WorkspaceList;
  WorkspaceCreateInput: WorkspaceCreateInput; WorkspaceUpdateInput: WorkspaceUpdateInput;
  SetInfrastructureInput: SetInfrastructureInput; CostEstimateInput: CostEstimateInput; CostEstimate: CostEstimate;
  KeptDataList: KeptDataList; WorkspaceDeleteResult: WorkspaceDeleteResult; KeptDataDeleteInput: KeptDataDeleteInput; KeptDataDeleteResult: KeptDataDeleteResult;
  StandaloneInput: StandaloneInput; StandaloneResult: StandaloneResult; PauseState: PauseState;
  ProviderList: ProviderList; LinkStart: LinkStart; LinkCompleteInput: LinkCompleteInput; LinkTokenInput: LinkTokenInput;
  ProviderLink: ProviderLink; DestinationList: DestinationList; DestinationCreateInput: DestinationCreateInput; Destination: Destination;
  HarnessOptionList: HarnessOptionList;
  AgentCard: AgentCard; AgentListInput: AgentListInput; AgentList: AgentList; AgentCreateInput: AgentCreateInput;
  AgentUpdateInput: AgentUpdateInput; AgentDeleteResult: AgentDeleteResult; InstructionsInput: InstructionsInput;
  InstructionSet: InstructionSet; PairingCode: PairingCode; ConnectRequestInput: ConnectRequestInput;
  ConnectRequest: ConnectRequest; ConnectApproveInput: ConnectApproveInput; FormPostRedirect: FormPostRedirect; AgentPolicy: AgentPolicy; AgentPolicySetInput: AgentPolicySetInput;
  ConnectionList: ConnectionList; ConnectionRef: ConnectionRef;
  DeviceStartInput: DeviceStartInput; DeviceStart: DeviceStart; DeviceTokenInput: DeviceTokenInput; DeviceToken: DeviceToken;
  DeviceLookupInput: DeviceLookupInput; DeviceRequest: DeviceRequest; DeviceApproveInput: DeviceApproveInput;
  DeviceDenyInput: DeviceDenyInput; DeviceDecision: DeviceDecision;
  CatalogInput: CatalogInput; Catalog: Catalog; ReleaseListInput: ReleaseListInput; ReleaseList: ReleaseList;
  OfferListInput: OfferListInput; OfferList: OfferList;
  Canvas: Canvas; CanvasSaveInput: CanvasSaveInput; Edge: Edge; EdgeCreateInput: EdgeCreateInput; EdgeUpdateInput: EdgeUpdateInput;
  EdgeRef: EdgeRef; HookList: HookList; HookSetInput: HookSetInput; HookSubscription: HookSubscription;
  Instance: Instance; InstanceList: InstanceList; DeployInput: DeployInput; DeployResult: DeployResult; BridgeDeployResult: BridgeDeployResult;
  InstanceUpdateInput: InstanceUpdateInput; RollbackInput: RollbackInput; RemoveInput: RemoveInput; RemoveResult: RemoveResult; InstanceConsentInput: InstanceConsentInput;
  DeployProgressEvent: DeployProgressEvent; OwnInfraRegisterInput: OwnInfraRegisterInput; EnrolmentCode: EnrolmentCode;
  BridgeStatus: BridgeStatus; KeyStatus: KeyStatus; KeyTicketInput: KeyTicketInput; LaunchTicketInput: LaunchTicketInput;
  TicketResult: TicketResult;
  Licence: Licence; LicenceListInput: LicenceListInput; LicenceList: LicenceList; LicenceRef: LicenceRef;
  LicenceTargetInput: LicenceTargetInput; LicenceChange: LicenceChange; CheckoutInput: CheckoutInput; Checkout: Checkout; BillingPortalInput: BillingPortalInput; BillingPortalSession: BillingPortalSession;
  OrderRef: OrderRef; Order: Order; UnpaidCount: UnpaidCount; StripeEvent: StripeEvent; WebhookAck: WebhookAck; PortalSigningKeys: PortalSigningKeys; ClerkEvent: ClerkEvent;
  SkillsInput: SkillsInput; SkillBundle: SkillBundle; SkillOverrideInput: SkillOverrideInput; SkillKeyRef: SkillKeyRef;
  SkillFile: SkillFile; ZipFile: ZipFile; DesktopDownload: DesktopDownload;
  OwnerSessionList: OwnerSessionList; OwnerSessionRef: OwnerSessionRef;
  DraftCreateInput: DraftCreateInput; DraftRefInput: DraftRefInput; DraftUpdateInput: DraftUpdateInput; Draft: Draft;
  DraftListInput: DraftListInput; DraftList: DraftList; DraftSubmitResult: DraftSubmitResult; DraftValidation: DraftValidation; DraftApplyInput: DraftApplyInput;
  ApplyResult: ApplyResult; DraftRejectInput: DraftRejectInput; Recipe: Recipe; RecipeImportInput: RecipeImportInput;
  AuditListInput: AuditListInput; AuditList: AuditList;
  BridgeEnrolInput: BridgeEnrolInput; BridgeEnrolResult: BridgeEnrolResult; BridgeConfigInput: BridgeConfigInput;
  BridgeConfig: BridgeConfig; BridgeAckInput: BridgeAckInput; BridgeAckResult: BridgeAckResult;
  RouteRegistryDoc: RouteRegistryDoc; Health: Health;
  /** v0.1.58 (S1-0) */
  Server: Server; ServerList: ServerList; ServerListInput: ServerListInput; ServerRefInput: ServerRefInput; ServerDetachInput: ServerDetachInput;
  HostPlansQuery: HostPlansQuery; HostPlanJws: HostPlanJws; HostReport: HostReport; HostReportAck: HostReportAck;
  /** v0.1.64 (C326, C332) */
  PushDeviceRegisterInput: PushDeviceRegisterInput; PushDevice: PushDevice; PersonOpCallInput: PersonOpCallInput; PersonOpCallResult: PersonOpCallResult;
  BridgePersonOpsQuery: BridgePersonOpsQuery; BridgePersonOpBatch: BridgePersonOpBatch; BridgePersonOpResultInput: BridgePersonOpResultInput; PortalInfo: PortalInfo;
}
export type SchemaName = keyof SchemaMap;

export interface RouteOp {
  opId: string;
  method: HttpMethod;
  /** Relative to /api/v1 for exposure "gateway"; absolute for "internal". `{name}` = input field. */
  path: string;
  auth: readonly AuthClass[];
  exposure: Exposure;
  transport: Transport;
  /** Allowed query keys (GET only); the gateway drops any other key. */
  query: readonly string[];
  /** Flat input = path params + query (GET) or body (others). */
  input: SchemaName;
  output: SchemaName;
  rate: RateClass;
  bodyLog: BodyLog;
  audit: AuditAction | null;
  /** Owner CLI may put it in a draft (applied later in the browser). */
  draftable: boolean;
  /** Listed as a confirm item in draft review; covered by the one apply confirmation. */
  confirm: boolean;
  /** Idempotency-Key header required. */
  idempotent: boolean;
  registry: RegistryId;
}

// ───────────────────────────── the table ─────────────────────────────
const B = ["browser"] as const;
const BO = ["browser", "owner-cli"] as const;
const NOQ = [] as const;
const PAGE = ["cursor", "limit"] as const;

export const ROUTES = [
  // account
  { opId: "account.me", method: "GET", path: "/me", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "AccountMe", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "account.set_current_workspace", method: "PUT", path: "/me/current-workspace", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "SetCurrentWorkspaceInput", output: "AccountMe", rate: "write", bodyLog: "meta", audit: "account.set_current_workspace", draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  /** v0.1.32 (C196 ENG-1): the person ticks "I accept … on behalf of my business"; Core records account, document versions, time (no IP). */
  { opId: "account.terms_accept", method: "POST", path: "/me/terms", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "TermsAcceptInput", output: "AccountMe", rate: "write", bodyLog: "meta", audit: "account.terms_accept", draftable: false, confirm: false, idempotent: false, registry: "consent" },
  /** v0.1.40 (C226): kept data on the owner's infrastructure, account level (only the owning account lists or deletes) */
  { opId: "kept_data.list", method: "GET", path: "/me/kept-data", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "KeptDataList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  /** v0.1.40 (C226): typed confirm; deletes the provider service(s) + volume(s) of one kept item; repeat-safe */
  { opId: "kept_data.delete", method: "POST", path: "/me/kept-data/{id}/delete", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "KeptDataDeleteInput", output: "KeptDataDeleteResult", rate: "write", bodyLog: "meta", audit: "instance.remove", draftable: false, confirm: false, idempotent: false, registry: "provider" },

  // workspaces
  { opId: "workspaces.list", method: "GET", path: "/workspaces", auth: BO, exposure: "gateway", transport: "json", query: PAGE, input: "WorkspaceListInput", output: "WorkspaceList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "workspaces.create", method: "POST", path: "/workspaces", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceCreateInput", output: "Workspace", rate: "write", bodyLog: "meta", audit: "workspace.create", draftable: true, confirm: false, idempotent: true, registry: "workspace" },
  { opId: "workspaces.get", method: "GET", path: "/workspaces/{ws}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "Workspace", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "workspaces.update", method: "PATCH", path: "/workspaces/{ws}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceUpdateInput", output: "Workspace", rate: "write", bodyLog: "meta", audit: "workspace.update", draftable: true, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "workspaces.delete", method: "DELETE", path: "/workspaces/{ws}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "WorkspaceDeleteResult", rate: "write", bodyLog: "meta", audit: "workspace.delete", draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "workspaces.set_infrastructure", method: "PUT", path: "/workspaces/{ws}/infrastructure", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "SetInfrastructureInput", output: "Workspace", rate: "write", bodyLog: "meta", audit: "workspace.set_infrastructure", draftable: true, confirm: true, idempotent: false, registry: "workspace" },
  { opId: "workspaces.cost_estimate", method: "GET", path: "/workspaces/{ws}/cost-estimate", auth: BO, exposure: "gateway", transport: "json", query: ["products", "settings"], input: "CostEstimateInput", output: "CostEstimate", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "workspaces.pause", method: "POST", path: "/workspaces/{ws}/pause", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "PauseState", rate: "write", bodyLog: "meta", audit: "workspace.pause", draftable: false, confirm: false, idempotent: false, registry: "agent_policy" },
  { opId: "workspaces.resume", method: "POST", path: "/workspaces/{ws}/resume", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "PauseState", rate: "write", bodyLog: "meta", audit: "workspace.resume", draftable: false, confirm: false, idempotent: false, registry: "agent_policy" },
  { opId: "workspaces.standalone", method: "POST", path: "/workspaces/{ws}/standalone", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "StandaloneInput", output: "StandaloneResult", rate: "sensitive", bodyLog: "meta", audit: "workspace.standalone", draftable: false, confirm: false, idempotent: false, registry: "instance" },

  // providers (Railway adapter; Coolify / own-infra rows available:false)
  { opId: "providers.list", method: "GET", path: "/providers", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "ProviderList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.link_start", method: "POST", path: "/providers/{provider}/link/start", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "ProviderRef", output: "LinkStart", rate: "sensitive", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.link_complete", method: "POST", path: "/providers/{provider}/link/complete", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "LinkCompleteInput", output: "ProviderLink", rate: "sensitive", bodyLog: "none", audit: "provider.link", draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.link_token", method: "POST", path: "/providers/{provider}/link/token", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "LinkTokenInput", output: "ProviderLink", rate: "sensitive", bodyLog: "none", audit: "provider.link_token", draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.link_get", method: "GET", path: "/providers/{provider}/link", auth: BO, exposure: "gateway", transport: "json_slow", query: NOQ, input: "ProviderRef", output: "ProviderLink", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.link_delete", method: "DELETE", path: "/providers/{provider}/link", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "ProviderRef", output: "ProviderLink", rate: "write", bodyLog: "meta", audit: "provider.unlink", draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.destinations_list", method: "GET", path: "/providers/{provider}/destinations", auth: BO, exposure: "gateway", transport: "json_slow", query: NOQ, input: "ProviderRef", output: "DestinationList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "providers.destinations_create", method: "POST", path: "/providers/{provider}/destinations", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "DestinationCreateInput", output: "Destination", rate: "write", bodyLog: "meta", audit: "provider.destination_create", draftable: true, confirm: false, idempotent: true, registry: "provider" },

  // harness options + agents
  { opId: "harness.options", method: "GET", path: "/harness-options", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "HarnessOptionList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "agent" },
  { opId: "agents.list", method: "GET", path: "/workspaces/{ws}/agents", auth: BO, exposure: "gateway", transport: "json", query: PAGE, input: "AgentListInput", output: "AgentList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "agent" },
  { opId: "agents.create", method: "POST", path: "/workspaces/{ws}/agents", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentCreateInput", output: "AgentCard", rate: "write", bodyLog: "meta", audit: "agent.create", draftable: true, confirm: true, idempotent: true, registry: "agent" },
  { opId: "agents.get", method: "GET", path: "/workspaces/{ws}/agents/{agt}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "AgentCard", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "agent" },
  { opId: "agents.update", method: "PATCH", path: "/workspaces/{ws}/agents/{agt}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentUpdateInput", output: "AgentCard", rate: "write", bodyLog: "meta", audit: "agent.update", draftable: true, confirm: false, idempotent: false, registry: "agent" },
  { opId: "agents.delete", method: "DELETE", path: "/workspaces/{ws}/agents/{agt}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "AgentDeleteResult", rate: "write", bodyLog: "meta", audit: "agent.delete", draftable: true, confirm: true, idempotent: false, registry: "agent" },
  { opId: "agents.instructions", method: "GET", path: "/workspaces/{ws}/agents/{agt}/instructions", auth: BO, exposure: "gateway", transport: "json", query: ["harnessOptionId"], input: "InstructionsInput", output: "InstructionSet", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "agent" },
  { opId: "agents.pairing_code", method: "POST", path: "/workspaces/{ws}/agents/{agt}/pairing-codes", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "PairingCode", rate: "sensitive", bodyLog: "none", audit: "agent.pairing_code_issue", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "pairing.connect_request", method: "GET", path: "/pairing/connect-request", auth: B, exposure: "gateway", transport: "json", query: ["state"], input: "ConnectRequestInput", output: "ConnectRequest", rate: "read", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "pairing.approve", method: "POST", path: "/pairing/approve", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "ConnectApproveInput", output: "FormPostRedirect", rate: "sensitive", bodyLog: "none", audit: "agent.pairing_approve", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "agents.policy_get", method: "GET", path: "/workspaces/{ws}/agents/{agt}/policy", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "AgentPolicy", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "agent_policy" },
  { opId: "agents.policy_set", method: "PUT", path: "/workspaces/{ws}/agents/{agt}/policy", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentPolicySetInput", output: "AgentPolicy", rate: "write", bodyLog: "meta", audit: "agent.policy_set", draftable: true, confirm: true, idempotent: false, registry: "agent_policy" },
  { opId: "agents.pause", method: "POST", path: "/workspaces/{ws}/agents/{agt}/pause", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "PauseState", rate: "write", bodyLog: "meta", audit: "agent.pause", draftable: true, confirm: false, idempotent: false, registry: "agent_policy" },
  { opId: "agents.resume", method: "POST", path: "/workspaces/{ws}/agents/{agt}/resume", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "PauseState", rate: "write", bodyLog: "meta", audit: "agent.resume", draftable: true, confirm: true, idempotent: false, registry: "agent_policy" },

  // connections
  { opId: "connections.list", method: "GET", path: "/workspaces/{ws}/agents/{agt}/connections", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "AgentRef", output: "ConnectionList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "connection" },
  { opId: "connections.revoke", method: "DELETE", path: "/workspaces/{ws}/agents/{agt}/connections/{con}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "ConnectionRef", output: "ConfigChange", rate: "write", bodyLog: "meta", audit: "connection.revoke", draftable: true, confirm: true, idempotent: false, registry: "connection" },

  // device flow (owner CLI sign-in + key connections)
  { opId: "device.start", method: "POST", path: "/device/authorize", auth: ["public"], exposure: "gateway", transport: "json", query: NOQ, input: "DeviceStartInput", output: "DeviceStart", rate: "public_strict", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "device.token", method: "POST", path: "/device/token", auth: ["device"], exposure: "gateway", transport: "json", query: NOQ, input: "DeviceTokenInput", output: "DeviceToken", rate: "device_poll", bodyLog: "none", audit: "device.redeem", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "device.lookup", method: "POST", path: "/device/lookup", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "DeviceLookupInput", output: "DeviceRequest", rate: "sensitive", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "device.approve", method: "POST", path: "/device/approve", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "DeviceApproveInput", output: "DeviceDecision", rate: "sensitive", bodyLog: "none", audit: "device.approve", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "device.deny", method: "POST", path: "/device/deny", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "DeviceDenyInput", output: "DeviceDecision", rate: "sensitive", bodyLog: "none", audit: "device.deny", draftable: false, confirm: false, idempotent: false, registry: "credential" },

  // catalog, releases, offers
  { opId: "catalog.list", method: "GET", path: "/catalog", auth: BO, exposure: "gateway", transport: "json", query: ["ws"], input: "CatalogInput", output: "Catalog", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "product" },
  { opId: "releases.list", method: "GET", path: "/products/{product}/releases", auth: BO, exposure: "gateway", transport: "json", query: ["channel"], input: "ReleaseListInput", output: "ReleaseList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "release" },
  { opId: "offers.list", method: "GET", path: "/offers", auth: BO, exposure: "gateway", transport: "json", query: ["product"], input: "OfferListInput", output: "OfferList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "offer" },

  // canvas, edges, hooks
  { opId: "canvas.get", method: "GET", path: "/workspaces/{ws}/canvas", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "Canvas", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "canvas.save", method: "PUT", path: "/workspaces/{ws}/canvas", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "CanvasSaveInput", output: "Canvas", rate: "write", bodyLog: "meta", audit: "canvas.save", draftable: true, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "edges.create", method: "POST", path: "/workspaces/{ws}/edges", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "EdgeCreateInput", output: "Edge", rate: "write", bodyLog: "meta", audit: "edge.create", draftable: true, confirm: true, idempotent: true, registry: "workspace" },
  { opId: "edges.update", method: "PATCH", path: "/workspaces/{ws}/edges/{edg}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "EdgeUpdateInput", output: "Edge", rate: "write", bodyLog: "meta", audit: "edge.update", draftable: true, confirm: true, idempotent: false, registry: "workspace" },
  { opId: "edges.delete", method: "DELETE", path: "/workspaces/{ws}/edges/{edg}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "EdgeRef", output: "ConfigChange", rate: "write", bodyLog: "meta", audit: "edge.delete", draftable: true, confirm: true, idempotent: false, registry: "workspace" },
  { opId: "hooks.list", method: "GET", path: "/workspaces/{ws}/hooks", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "HookList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "hooks.set", method: "PATCH", path: "/workspaces/{ws}/hooks/{ins}/{hookId}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "HookSetInput", output: "HookSubscription", rate: "write", bodyLog: "meta", audit: "hook.set", draftable: true, confirm: true, idempotent: false, registry: "workspace" },

  // instances (deploy lifecycle) + bridge
  { opId: "instances.list", method: "GET", path: "/workspaces/{ws}/instances", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "InstanceList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "instances.deploy", method: "POST", path: "/workspaces/{ws}/instances", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "DeployInput", output: "DeployResult", rate: "write", bodyLog: "meta", audit: "instance.deploy", draftable: true, confirm: true, idempotent: true, registry: "instance" },
  { opId: "instances.get", method: "GET", path: "/workspaces/{ws}/instances/{ins}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "InstanceRef", output: "Instance", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "instances.progress", method: "GET", path: "/workspaces/{ws}/instances/{ins}/progress", auth: BO, exposure: "gateway", transport: "sse", query: NOQ, input: "InstanceRef", output: "DeployProgressEvent", rate: "stream", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "instances.retry", method: "POST", path: "/workspaces/{ws}/instances/{ins}/retry", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "InstanceRef", output: "Instance", rate: "write", bodyLog: "meta", audit: "instance.retry", draftable: false, confirm: false, idempotent: true, registry: "instance" },
  { opId: "instances.cancel", method: "POST", path: "/workspaces/{ws}/instances/{ins}/cancel", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "InstanceRef", output: "Instance", rate: "write", bodyLog: "meta", audit: "instance.cancel", draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "instances.update", method: "POST", path: "/workspaces/{ws}/instances/{ins}/update", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "InstanceUpdateInput", output: "Instance", rate: "write", bodyLog: "meta", audit: "instance.update", draftable: true, confirm: true, idempotent: true, registry: "instance" },
  { opId: "instances.rollback", method: "POST", path: "/workspaces/{ws}/instances/{ins}/rollback", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "RollbackInput", output: "Instance", rate: "write", bodyLog: "meta", audit: "instance.rollback", draftable: true, confirm: true, idempotent: true, registry: "instance" },
  { opId: "instances.remove", method: "POST", path: "/workspaces/{ws}/instances/{ins}/remove", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "RemoveInput", output: "RemoveResult", rate: "write", bodyLog: "meta", audit: "instance.remove", draftable: true, confirm: true, idempotent: false, registry: "instance" },
  { opId: "instances.consent", method: "POST", path: "/workspaces/{ws}/instances/{ins}/consent", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "InstanceConsentInput", output: "Instance", rate: "write", bodyLog: "meta", audit: "instance.consent", draftable: false, confirm: true, idempotent: true, registry: "instance" },
  { opId: "instances.register_own_infra", method: "POST", path: "/workspaces/{ws}/instances/own-infra", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "OwnInfraRegisterInput", output: "EnrolmentCode", rate: "sensitive", bodyLog: "none", audit: "instance.register_own_infra", draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge.get", method: "GET", path: "/workspaces/{ws}/bridge", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "BridgeStatus", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge.deploy", method: "POST", path: "/workspaces/{ws}/bridge/deploy", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "WorkspaceRef", output: "BridgeDeployResult", rate: "write", bodyLog: "meta", audit: "bridge.deploy", draftable: true, confirm: true, idempotent: true, registry: "instance" },
  { opId: "bridge.progress", method: "GET", path: "/workspaces/{ws}/bridge/progress", auth: BO, exposure: "gateway", transport: "sse", query: NOQ, input: "WorkspaceRef", output: "DeployProgressEvent", rate: "stream", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge.enrolment_code", method: "POST", path: "/workspaces/{ws}/bridge/enrolment-code", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "EnrolmentCode", rate: "sensitive", bodyLog: "none", audit: "bridge.enrolment_code_issue", draftable: false, confirm: false, idempotent: false, registry: "credential" },

  // keys (presence only) + person tickets
  { opId: "keys.status", method: "GET", path: "/workspaces/{ws}/keys", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "KeyStatus", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "tickets.keys", method: "POST", path: "/workspaces/{ws}/tickets/keys", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "KeyTicketInput", output: "TicketResult", rate: "sensitive", bodyLog: "none", audit: "ticket.keys", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "tickets.launch", method: "POST", path: "/workspaces/{ws}/tickets/launch", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "LaunchTicketInput", output: "TicketResult", rate: "sensitive", bodyLog: "none", audit: "ticket.launch", draftable: false, confirm: false, idempotent: false, registry: "credential" },

  // licences + commerce
  { opId: "licences.list", method: "GET", path: "/licences", auth: BO, exposure: "gateway", transport: "json", query: ["cursor", "limit", "product", "assigned"], input: "LicenceListInput", output: "LicenceList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "entitlement" },
  { opId: "licences.assign", method: "POST", path: "/licences/{lic}/assign", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "LicenceTargetInput", output: "LicenceChange", rate: "write", bodyLog: "meta", audit: "licence.assign", draftable: true, confirm: true, idempotent: false, registry: "entitlement" },
  { opId: "licences.unassign", method: "POST", path: "/licences/{lic}/unassign", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "LicenceRef", output: "LicenceChange", rate: "write", bodyLog: "meta", audit: "licence.unassign", draftable: true, confirm: true, idempotent: false, registry: "entitlement" },
  { opId: "licences.move", method: "POST", path: "/licences/{lic}/move", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "LicenceTargetInput", output: "LicenceChange", rate: "write", bodyLog: "meta", audit: "licence.move", draftable: true, confirm: true, idempotent: false, registry: "entitlement" },
  { opId: "licences.unpaid", method: "GET", path: "/workspaces/{ws}/unpaid", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "WorkspaceRef", output: "UnpaidCount", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "entitlement" },
  { opId: "checkout.create", method: "POST", path: "/checkout", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "CheckoutInput", output: "Checkout", rate: "sensitive", bodyLog: "meta", audit: "order.create", draftable: true, confirm: true, idempotent: true, registry: "entitlement" },
  /** v0.1.9 (C60): errors 409 conflict (details.reason no_billing_customer) when the account never bought; 502 checkout_failed when Stripe refuses. */
  { opId: "billing.portal", method: "POST", path: "/billing/portal", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "BillingPortalInput", output: "BillingPortalSession", rate: "sensitive", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "entitlement" },
  { opId: "checkout.get", method: "GET", path: "/orders/{ord}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "OrderRef", output: "Order", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "entitlement" },
  { opId: "stripe.webhook", method: "POST", path: "/stripe/webhook", auth: ["stripe-webhook"], exposure: "gateway", transport: "raw", query: NOQ, input: "StripeEvent", output: "WebhookAck", rate: "webhook", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "entitlement" },
  /** v0.1.4 (C49): public class; the handler verifies the svix signature (clerk_signature_invalid otherwise) before any state change. */
  { opId: "clerk.webhook", method: "POST", path: "/clerk/webhook", auth: ["public"], exposure: "gateway", transport: "raw", query: NOQ, input: "ClerkEvent", output: "WebhookAck", rate: "webhook", bodyLog: "none", audit: "account.disable", draftable: false, confirm: false, idempotent: false, registry: "workspace" },

  // skills
  { opId: "skills.get", method: "GET", path: "/workspaces/{ws}/skills", auth: BO, exposure: "gateway", transport: "json", query: ["agt"], input: "SkillsInput", output: "SkillBundle", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "skills.override_put", method: "PUT", path: "/workspaces/{ws}/skills/overrides/{skillKey}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "SkillOverrideInput", output: "SkillFile", rate: "write", bodyLog: "meta", audit: "skills.override_put", draftable: true, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "skills.override_delete", method: "DELETE", path: "/workspaces/{ws}/skills/overrides/{skillKey}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "SkillKeyRef", output: "SkillFile", rate: "write", bodyLog: "meta", audit: "skills.override_delete", draftable: true, confirm: false, idempotent: false, registry: "workspace" },
  { opId: "skills.pack", method: "GET", path: "/workspaces/{ws}/skills/pack", auth: BO, exposure: "gateway", transport: "binary", query: ["agt"], input: "SkillsInput", output: "ZipFile", rate: "read", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "workspace" },

  // downloads
  { opId: "downloads.desktop", method: "GET", path: "/downloads/desktop", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "DesktopDownload", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "release" },
  /** v0.1.12 (C79): public, read-only ceremony input; never a trust path. */
  { opId: "portal.signing_keys", method: "GET", path: "/portal/signing-keys", auth: ["public"], exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "PortalSigningKeys", rate: "public_strict", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "credential" },

  // owner native sessions (K3)
  { opId: "owner_sessions.list", method: "GET", path: "/owner-sessions", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "OwnerSessionList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "owner_sessions.revoke", method: "DELETE", path: "/owner-sessions/{osn}", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "OwnerSessionRef", output: "Ok", rate: "write", bodyLog: "meta", audit: "owner_session.revoke", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "owner_sessions.logout", method: "POST", path: "/owner-sessions/logout", auth: ["owner-cli"], exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "Ok", rate: "write", bodyLog: "meta", audit: "owner_session.revoke", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  /** v0.1.64 (C332): the calling owner session's push device (client in PUSH.clients); revoke / logout / expiry deletes it. */
  { opId: "push_devices.register", method: "PUT", path: "/owner-sessions/current/push-device", auth: ["owner-cli"], exposure: "gateway", transport: "json", query: NOQ, input: "PushDeviceRegisterInput", output: "PushDevice", rate: "write", bodyLog: "none", audit: "push_device.register", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  { opId: "push_devices.unregister", method: "DELETE", path: "/owner-sessions/current/push-device", auth: ["owner-cli"], exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "Ok", rate: "write", bodyLog: "meta", audit: "push_device.unregister", draftable: false, confirm: false, idempotent: false, registry: "credential" },
  /** v0.1.64 (C326): allow-listed person op of one app instance for a K3 of client tbd/tbm, relayed through the workspace bridge (PERSON_OP_RELAY). */
  { opId: "person_ops.call", method: "POST", path: "/workspaces/{ws}/instances/{ins}/person-ops/{op}", auth: ["owner-cli"], exposure: "gateway", transport: "json", query: NOQ, input: "PersonOpCallInput", output: "PersonOpCallResult", rate: "person_op", bodyLog: "none", audit: "person_op.relay", draftable: false, confirm: false, idempotent: false, registry: "instance" },
  /** v0.1.64 (C332a(3)): public, read-only; lets a native client check that a custom URL is a Teal Brick Portal before sign-in. */
  { opId: "portal.info", method: "GET", path: "/portal/info", auth: ["public"], exposure: "gateway", transport: "json", query: NOQ, input: "Empty", output: "PortalInfo", rate: "public_strict", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "route" },

  // drafts + recipes (Consent Registry)
  { opId: "drafts.list", method: "GET", path: "/drafts", auth: BO, exposure: "gateway", transport: "json", query: ["cursor", "limit", "ws", "state"], input: "DraftListInput", output: "DraftList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.create", method: "POST", path: "/drafts", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftCreateInput", output: "Draft", rate: "write", bodyLog: "meta", audit: "draft.create", draftable: false, confirm: false, idempotent: true, registry: "consent" },
  { opId: "drafts.get", method: "GET", path: "/drafts/{drf}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftRefInput", output: "Draft", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.update", method: "PUT", path: "/drafts/{drf}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftUpdateInput", output: "Draft", rate: "write", bodyLog: "meta", audit: "draft.update", draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.submit", method: "POST", path: "/drafts/{drf}/submit", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftRefInput", output: "DraftSubmitResult", rate: "write", bodyLog: "meta", audit: "draft.submit", draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.validate", method: "POST", path: "/drafts/{drf}/validate", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftRefInput", output: "DraftValidation", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.apply", method: "POST", path: "/drafts/{drf}/apply", auth: B, exposure: "gateway", transport: "json_slow", query: NOQ, input: "DraftApplyInput", output: "ApplyResult", rate: "sensitive", bodyLog: "meta", audit: "draft.apply", draftable: false, confirm: true, idempotent: true, registry: "consent" },
  { opId: "drafts.reject", method: "POST", path: "/drafts/{drf}/reject", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "DraftRejectInput", output: "Draft", rate: "write", bodyLog: "meta", audit: "draft.reject", draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.export", method: "GET", path: "/drafts/{drf}/recipe", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "DraftRefInput", output: "Recipe", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "consent" },
  { opId: "drafts.import", method: "POST", path: "/recipes/import", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "RecipeImportInput", output: "Draft", rate: "write", bodyLog: "meta", audit: "draft.import", draftable: false, confirm: false, idempotent: true, registry: "consent" },

  // audit
  { opId: "audit.list", method: "GET", path: "/audit", auth: BO, exposure: "gateway", transport: "json", query: ["cursor", "limit", "ws", "action"], input: "AuditListInput", output: "AuditList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "audit" },

  // bridge-facing (outbound-only from the customer side)
  { opId: "bridge_api.enrol", method: "POST", path: "/bridge/enrol", auth: ["public"], exposure: "gateway", transport: "json", query: NOQ, input: "BridgeEnrolInput", output: "BridgeEnrolResult", rate: "public_strict", bodyLog: "none", audit: "bridge.enrol", draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge_api.config", method: "GET", path: "/bridge/config", auth: ["bridge"], exposure: "gateway", transport: "longpoll", query: ["after", "wait"], input: "BridgeConfigInput", output: "BridgeConfig", rate: "bridge_poll", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge_api.ack", method: "POST", path: "/bridge/ack", auth: ["bridge"], exposure: "gateway", transport: "json", query: NOQ, input: "BridgeAckInput", output: "BridgeAckResult", rate: "bridge_write", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  /** v0.1.64 (C326): the bridge pulls queued person ops for its workspace (BRIDGE §15); empty batch after `wait` s. */
  { opId: "bridge_api.person_ops", method: "GET", path: "/bridge/person-ops", auth: ["bridge"], exposure: "gateway", transport: "json_slow", query: ["wait"], input: "BridgePersonOpsQuery", output: "BridgePersonOpBatch", rate: "bridge_relay", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },
  { opId: "bridge_api.person_op_result", method: "POST", path: "/bridge/person-ops/{pop}/result", auth: ["bridge"], exposure: "gateway", transport: "json", query: NOQ, input: "BridgePersonOpResultInput", output: "Ok", rate: "bridge_relay", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "instance" },

  // v0.1.58 (S1-0, HOST.md): paired servers (Provider Registry: a server is an own-infrastructure destination)
  { opId: "servers.list", method: "GET", path: "/servers", auth: BO, exposure: "gateway", transport: "json", query: ["ws"], input: "ServerListInput", output: "ServerList", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  { opId: "servers.get", method: "GET", path: "/servers/{srv}", auth: BO, exposure: "gateway", transport: "json", query: NOQ, input: "ServerRefInput", output: "Server", rate: "read", bodyLog: "meta", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  /** v0.1.60: `mode` leave_running (default: the apps keep running, Portal stops managing them) or stop (stop every service, volumes KEPT). One final plan, the key is unpaired after it, the workspace infrastructure is cleared. No data is deleted. */
  { opId: "servers.detach", method: "POST", path: "/servers/{srv}/detach", auth: B, exposure: "gateway", transport: "json", query: NOQ, input: "ServerDetachInput", output: "Server", rate: "write", bodyLog: "meta", audit: "server.detach", draftable: true, confirm: true, idempotent: true, registry: "provider" },

  // v0.1.58 (S1-0): host-agent-facing (outbound only from the server; K13 host assertion)
  /** 200 application/jose = ONE plan (lowest unexpired seq > after); 304 after `wait` s. Carries one-time codes: never stored, never logged. */
  { opId: "host.plans", method: "GET", path: "/host/plans", auth: ["host"], exposure: "gateway", transport: "longpoll", query: ["after", "wait"], input: "HostPlansQuery", output: "HostPlanJws", rate: "host_poll", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },
  /** heartbeat every 30 s + plan results; metadata only */
  { opId: "host.report", method: "POST", path: "/host/reports", auth: ["host"], exposure: "gateway", transport: "json", query: NOQ, input: "HostReport", output: "HostReportAck", rate: "host_write", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "provider" },

  // internal (private network only; the gateway never forwards these)
  { opId: "routes.list", method: "GET", path: "/internal/routes", auth: ["public"], exposure: "internal", transport: "json", query: NOQ, input: "Empty", output: "RouteRegistryDoc", rate: "internal", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "route" },
  { opId: "system.health", method: "GET", path: "/internal/health", auth: ["public"], exposure: "internal", transport: "json", query: NOQ, input: "Empty", output: "Health", rate: "internal", bodyLog: "none", audit: null, draftable: false, confirm: false, idempotent: false, registry: "route" },
] as const satisfies readonly RouteOp[];

// ───────────────────────────── derived types + compile-time invariants ─────────────────────────────
type Row = (typeof ROUTES)[number];
export type OpId = Row["opId"];
export type DraftableOpId = Extract<Row, { draftable: true }>["opId"];
export type ConfirmOpId = Extract<Row, { confirm: true }>["opId"];
type WithAuth<R, A extends AuthClass> = R extends { auth: readonly (infer X)[] } ? (A extends X ? R : never) : never;
export type OwnerCliOpId = WithAuth<Row, "owner-cli">["opId"];
export type PublicOpId = WithAuth<Row, "public">["opId"];

type Check<T extends true> = T;
type OwnerCliRow = WithAuth<Row, "owner-cli">;
/** RT1: owner CLI may call only reads, drafts.*, and its own logout. v0.1.64 (C326, C332): plus its own push device
 *  (push_devices.*, client tbm) and the allow-listed person-op relay (person_ops.call, clients tbd/tbm). Nothing else. */
export type InvariantOwnerCli = Check<
  [Exclude<OwnerCliRow, { method: "GET" } | { opId: `drafts.${string}` | "owner_sessions.logout" | "push_devices.register" | "push_devices.unregister" | "person_ops.call" }>] extends [never] ? true : false
>;
/** RT2: draftable ops are browser-callable mutations (never GET, never public/bridge/device/webhook). */
export type InvariantDraftable = Check<
  [Exclude<Extract<Row, { draftable: true }>, { method: Exclude<HttpMethod, "GET">; auth: readonly ("browser" | "owner-cli")[] }>] extends [never] ? true : false
>;
/** RT3: confirm ops are never callable by the owner CLI directly. */
export type InvariantConfirm = Check<[Extract<OwnerCliRow, { confirm: true }>] extends [never] ? true : false>;
/** RT4: internal exposure only on /internal paths. */
export type InvariantInternal = Check<
  [Exclude<Extract<Row, { exposure: "internal" }>, { path: `/internal/${string}` }>] extends [never] ? true : false
>;
/** RT5: gateway rows never use /internal paths. */
export type InvariantGatewayPaths = Check<[Extract<Row, { exposure: "gateway"; path: `/internal${string}` }>] extends [never] ? true : false>;
/** RT6 (B8): rows whose responses must never be stored are never idempotent (the idempotency store keeps responses). */
export type InvariantIdempotencyNoSecrets = Check<[Extract<Row, { idempotent: true; bodyLog: "none" }>] extends [never] ? true : false>;
/** Output schemas that carry a one-time code, ticket or token. */
/** v0.1.58: HostPlanJws (a bridge/app plan carries its one-time enrolment code). */
export type SecretBearingSchema = "DeviceStart" | "DeviceToken" | "PairingCode" | "FormPostRedirect" | "EnrolmentCode" | "TicketResult" | "HostPlanJws";
type SecretKey = "code" | "ticket" | "device_code" | "user_code" | "access_token" | "session_token";
type TopKeys<T> = T extends unknown ? keyof T : never;
/** RT7 (S1): no output reachable with K3 (owner CLI / TBD) carries a code, ticket or token — by name and by top-level field. */
export type InvariantOwnerCliNoSecrets = Check<
  [Extract<OwnerCliRow["output"], SecretBearingSchema> | Extract<TopKeys<SchemaMap[OwnerCliRow["output"]]>, SecretKey>] extends [never] ? true : false
>;
/** RT8 (S1): every secret-bearing output is idempotent: false and bodyLog: none. */
export type InvariantSecretOutputs = Check<
  [Exclude<Extract<Row, { output: SecretBearingSchema }>, { idempotent: false; bodyLog: "none" }>] extends [never] ? true : false
>;
type HostRow = WithAuth<Row, "host">;
/** RT9 (v0.1.58, S1-0): the host class is accepted ONLY on host.* rows, and host.* rows accept ONLY the host class (a host
 *  agent never reaches a person, owner-CLI or bridge row; no person credential reaches a host row). */
export type InvariantHostRows = Check<
  [Exclude<HostRow, { opId: `host.${string}`; auth: readonly ["host"] }> | Exclude<Extract<Row, { opId: `host.${string}` }>, HostRow>] extends [never] ? true : false
>;
