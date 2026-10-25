// Teal Brick miniapp manifest v2 (`tealbrick.miniapp/2`). v0.1, Lead · Specs, 2026-10-11.
// Mirrors specs/manifest.schema.json exactly; MANIFEST.md holds the cross-field rules.
// Data only: the `as const` vocabularies below are the ONE declaration of these literals.
// `@opt2-tealbrick/manifest` re-exports them; no other package declares them.
import type { DataPolicy, ModelRole } from "./models.ts";

// ---------- Shared vocabularies ----------

export const MANIFEST_SCHEMA = "tealbrick.miniapp/2" as const;
export const CRUD_ACTIONS = ["create", "read", "update", "delete"] as const;
/** Ordered: a dynamic `effectCeiling` admits every effect at or before it in this list. */
export const EFFECTS = ["read", "write", "outward", "destructive", "money"] as const;
/** v0.1.16 (C107): + `outward` (messages, posts, reactions, edits to existing contacts or channels) and `identity`
 *  (changes to the agent's public identity). Every op with outward effects declares a family. */
/** v0.1.41 (C167, C232, LA-2): + `public_link` (an action that makes agent-written content visible to people outside the
 *  workspace: create a viewer link, or make new content live on a page that has an active link). */
export const HOLD_FAMILIES = ["first_contact", "profile_change", "live_call", "destructive", "money", "outward", "identity", "public_link"] as const;
/** v0.1.15 (C105): the families an op may declare (= HOLD_FAMILIES; the name Core, GUI and conformance import). */
export const KNOWN_HOLD_FAMILIES = HOLD_FAMILIES;
/** v0.1.15 (C105, QA S2: a first-contact DM went out unheld on a default card): the held families of a NEW agent card
 *  and of companion grants (CORE I8 "workspace default held families"). `money` is held always, listed for clarity. */
/** v0.1.16 (C107): + `identity`; `outward` is known but NOT held by default (Free-card caps apply; the owner can turn on
 *  "ask me before every message"). */
/** v0.1.41 (C232): + `public_link` — held for every NEW card and new workspace; existing ones get it OFFERED (C107a). */
export const DEFAULT_HELD_FAMILIES = ["destructive", "money", "first_contact", "identity", "public_link"] as const;
/** v0.1.13 (G1): families a before hook may hold with = HOLD_FAMILIES + `policy` (a policy app decided). Ops never declare `policy`. */
export const HOOK_HOLD_FAMILIES = ["first_contact", "profile_change", "live_call", "destructive", "money", "outward", "identity", "public_link", "policy"] as const;
export const AGENT_MODES = ["free", "bound"] as const;
export const HOOK_PHASES = ["before", "context", "after"] as const;
export const IDEMPOTENCY_MODES = ["required", "supported", "none"] as const;
/** The ONE audience vocabulary. Bridge-only SDK calls (catalog, resolve, mark, scope summary) are bridge ops (`POST /tb/v1/bridge/<bop>`, CREDENTIALS `CallProofBridgeOpClaims`), not an audience. */
export const OPERATION_AUDIENCES = ["agent", "person"] as const;
export const DYNAMIC_MODES = ["list", "search"] as const;
export const DEFAULT_GRANT_KINDS = ["own", "shared", "all"] as const;
export const KEY_SOURCES = ["account_default", "app_own"] as const;
export const SETTING_TYPES = ["string", "text", "integer", "number", "boolean", "enum", "url"] as const;
export const VOLUME_PURPOSES = ["data", "backup"] as const;
/** v0.1.43 (LA-1, C232): + `viewer` — a prefix route served ONLY on the workspace views service origin (tb-views), never on
 *  the bridge main or keys origin. MANIFEST M-PR-2: at most one viewer route, path `/v`; the segment `_d` right after
 *  `/v/<product>/` is reserved for untrusted documents (sandbox CSP enforced by tb-views). */
export const PUBLIC_ROUTE_PURPOSES = ["oauth_callback", "webhook", "viewer"] as const;
/** v0.1.43 (LR-1, C234): `workflow` = an agent op that is listed in tools/list and passes gate() ONLY when the grant's `wf`
 *  names it (machine ops). `default` (or absent) = today's rule.
 *  v0.1.76 (C330(1), M4b): `lazy` = a STATIC agent op that is visible and callable exactly as `default`, but the bridge leaves
 *  it out of tools/list and serves it through the product's `<product>__tb_more_search` / `<product>__tb_more_call` pair
 *  (BRIDGE §7.5). Display only: gate(), hooks, holds, receipts and idempotency are the direct call's (MANIFEST §5.5). */
export const OPERATION_LISTINGS = ["default", "workflow", "lazy"] as const;
export const CATEGORIES = ["memory", "connectivity", "communication", "automation", "governance", "operations", "productivity", "developer"] as const;
export const HARNESS_KINDS = ["generic", "claude_desktop", "codex_desktop", "tbd", "claude_agent_sdk", "eve", "tealbrick_cli"] as const;
/** Standard operations every SDK app serves automatically (MANIFEST.md §5.4): one agent op, the rest person ops. Manifest ids never start with `tb_`. */
export const STANDARD_OPERATIONS = ["tb.hold_status", "tb.holds_list", "tb.holds_decide", "tb.receipts_list", "tb.agents_list", "tb.scopes_set", "tb.keys_status", "tb.key_set", "tb.key_delete", "tb.export", "tb.holds_pending"] as const;
/** v0.1.13 (G4): the ONE op a wildcard companion (`product: "*"`) may name (MANIFEST M-CP-3); needs owner consent at deploy (C82). */
export const WILDCARD_COMPANION_OPS = ["tb.holds_pending"] as const;
/** v0.1.42 (C230): shared app-to-app contracts, `<name>/<major>`; each has a JSON Schema in this package at
 *  `schemas/contracts/<name>.<major>.schema.json` and a fixture at `examples/contracts/<name>.<major>.json`. */
export const CONTRACT_IDS = ["messages/1", "fleet.directory_feed/1"] as const;
/** v0.1.57 (C274c/C274d): who an app event goes to. `target` = only the agents the emit names (`to`); `granted` = every agent
 *  that passes the `visibleWith` rule. Either way the bridge delivers only to agents that pass it (MANIFEST §16). */
export const EVENT_AUDIENCES = ["target", "granted"] as const;
/** v0.1.57 (C274d ruling 4): the platform event namespace. Event types starting with it are declared in this spec
 *  (`PLATFORM_EVENTS`, bridge.ts) and emitted by the SDK; a manifest never declares one (M-EV-1). */
export const RESERVED_EVENT_PREFIX = "tb." as const;


export type CrudAction = (typeof CRUD_ACTIONS)[number];
export type Effect = (typeof EFFECTS)[number];
export type HoldFamily = (typeof HOLD_FAMILIES)[number];
export type HookHoldFamily = (typeof HOOK_HOLD_FAMILIES)[number];
export type AgentMode = (typeof AGENT_MODES)[number];
export type HookPhase = (typeof HOOK_PHASES)[number];
export type IdempotencyMode = (typeof IDEMPOTENCY_MODES)[number];
export type OperationAudience = (typeof OPERATION_AUDIENCES)[number];
export type DynamicMode = (typeof DYNAMIC_MODES)[number];
export type DefaultGrantKind = (typeof DEFAULT_GRANT_KINDS)[number];
export type KeySource = (typeof KEY_SOURCES)[number];
export type SettingType = (typeof SETTING_TYPES)[number];
export type VolumePurpose = (typeof VOLUME_PURPOSES)[number];
export type PublicRoutePurpose = (typeof PUBLIC_ROUTE_PURPOSES)[number];
export type OperationListing = (typeof OPERATION_LISTINGS)[number];
export type Category = (typeof CATEGORIES)[number];
export type HarnessKind = (typeof HARNESS_KINDS)[number];
export type StandardOperationId = (typeof STANDARD_OPERATIONS)[number];
export type ContractId = (typeof CONTRACT_IDS)[number];
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

// ---------- Primitive aliases (patterns in the schema) ----------

/** `^[a-z][a-z0-9-]{1,31}$` (CORE §1). */
export type ProductId = string;
/** `^(?!tb_)[a-z][a-z0-9_]{1,39}$`: operation, hook, scope type, step, setting, volume, access, unlock, artifact ids. */
export type SnakeId = string;
/** SemVer 2.0 without build metadata. */
export type SemVer = string;
/** `^https://host[:port][/path]`, no userinfo, query or fragment. */
export type HttpsUrl = string;
/** `^(?!TB_|RAILWAY_)[A-Z][A-Z0-9_]{1,63}$`. */
export type EnvName = string;
/** The one env / key name pattern (manifest `envName`, workspace-config `keyName`). The bridge keeps only app-key requirement
 *  names that match it, so a provider-namespace name (`pk:…`) or any other shape is never fetchable (BRIDGE §9.4, QA-BRIDGE22-6). */
export const ENV_NAME_PATTERN = "^(?!TB_|RAILWAY_)[A-Z][A-Z0-9_]{1,63}$" as const;
/** A JSON Schema 2020-12 document whose `type` is `"object"`; local `$ref` only. */
export type JsonSchemaObject = { type: "object"; [keyword: string]: unknown };

/** All-of equality on earlier settings; an array value means "one of". */
export type Condition = Record<SnakeId, ConditionValue | ConditionValue[]>;
export type ConditionValue = string | boolean | number;

// ---------- Manifest ----------

export interface Manifest {
  $schema?: string;
  schema: typeof MANIFEST_SCHEMA;
  id: ProductId;
  name: string;
  summary: string;
  description?: string;
  /** SemVer; major = licence major (`isEntitled(workspace, product, major)`). */
  version: SemVer;
  /** SDK major the app is built with; the SDK refuses to boot on mismatch. */
  sdkMajor: number;
  publisher: { name: string; url?: HttpsUrl };
  source: { repo: HttpsUrl; license: string };
  icon: { svgPath: string; viewBox?: string };
  discovery: Discovery;
  runtime: Runtime;
  operations: Operation[];
  scopes?: Scope[];
  settings?: Settings;
  hooks?: Hook[];
  companions?: Companion[];
  /** v0.1.15 (C104) */
  requires?: ManifestRequires;
  needsAgentDirectory?: boolean;
  skills?: Skill[];
  harnessHints?: HarnessHint[];
  unlocks?: Unlock[];
  backups: Backups;
  artifacts?: Artifact[];
  publicRoutes?: PublicRoute[];
  ui?: Ui;
  /** v0.1.42 (C230): the shared app-to-app contracts this app writes (`produces`) and reads (`consumes`). A manifest with this
   *  field needs a validator from manifest 0.1.20 on: the release must state `requires.bridge` of a bridge that pins it. */
  contracts?: { produces?: ContractId[]; consumes?: ContractId[] };
  /** v0.1.57 (C274c/C274d): the event types this app emits (`ctx.emit`) and the bridge delivers to agents (MANIFEST §16). A
   *  manifest with this field needs a validator from manifest 0.1.30 on (strict schema). */
  events?: EventDecl[];
}

/** v0.1.57 (C274c/C274d): one app event type (MANIFEST §16). */
export interface EventDecl {
  /** `^(?!tb\.)[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, ≤ 64 chars, unique per app. Wire type = `<product>.<name>`. */
  name: string;
  title: string;
  description?: string;
  /** JSON Schema 2020-12, object root, local `$ref` only, ≤ 8 KiB (JCS); ids and enums only, never record bodies (C274d
   *  ruling 2); no top-level `summary` property (the summary travels in the envelope, M-EV-4). */
  payloadSchema: JsonSchemaObject;
  /** An `agent` op of this manifest (not dynamic). The event reaches an agent only when tools/list would list this op for it;
   *  when the op has a `scopeType`, the event is SCOPED: it names one instance of that type and reaches only agents whose row
   *  on that instance admits the op (M-EV-3, MANIFEST §16.2). */
  visibleWith: SnakeId;
  audience: EventAudience;
}

export interface Discovery {
  category: Category;
  /** 1..60 phrases. */
  intents: string[];
  keywords?: string[];
}

// ---------- Runtime ----------

export interface Build {
  /** Repo-relative build context, `.` = repo root. */
  context: string;
  /** Repo-relative Dockerfile path. */
  dockerfile: string;
}

export interface Resources {
  /** vCPU, 0.1..32. */
  cpu: number;
  memoryMb: number;
}

export interface Volume {
  id: SnakeId;
  mountPath: string;
  sizeGb: number;
  purpose: VolumePurpose;
}

/** Exactly one of `value`, `setting`, `generate`. */
export type EnvEntry =
  | { name: EnvName; value: string; setting?: never; generate?: never }
  | { name: EnvName; setting: SnakeId; value?: never; generate?: never }
  | { name: EnvName; generate: "secret"; value?: never; setting?: never };

export type Health = { kind: "http"; path: string } | { kind: "tcp" };

export interface ServiceBackup {
  dump: string[];
  restore: string[];
  extension: string;
}

export interface ServiceHelper {
  port: number;
  paths: string[];
}

interface ServiceBase {
  id: string;
  title?: string;
  port: number;
  resources: Resources;
  volumes?: Volume[];
  health: Health;
  env?: EnvEntry[];
  when?: Condition;
  startOrder: number;
  /** v0.1.7 (C54): tb-exec drops to uid/gid 1000 before starting the upstream only when true (default false: upstream images that manage their own users, e.g. Postgres, keep doing so). The app process always drops (SDK startApp). */
  dropPrivileges?: boolean;
  backup?: ServiceBackup;
  helper?: ServiceHelper;
}

/** Exactly one of `image` (pinned `...@sha256:<64 hex>`) or `build`. */
export type Service =
  | (ServiceBase & { image: string; build?: never })
  | (ServiceBase & { build: Build; image?: never });

export interface Runtime {
  build: Build;
  port: number;
  /** Default `/tb/v1/health` (served by the SDK). */
  healthPath?: string;
  resources: Resources;
  volumes: Volume[];
  env?: EnvEntry[];
  services?: Service[];
}

// ---------- Operations ----------

export interface DynamicSpec {
  mode: DynamicMode;
  crudCeiling: CrudAction[];
  effectCeiling: Effect;
}

export interface Operation {
  id: SnakeId;
  title: string;
  description: string;
  /** Required unless `dynamic` or `audience: "person"` with no input. */
  input?: JsonSchemaObject;
  output?: JsonSchemaObject;
  crud: CrudAction[];
  effect: Effect;
  holdFamily?: HoldFamily;
  scopeType?: SnakeId;
  idempotency: IdempotencyMode;
  receipt: boolean;
  audience: OperationAudience;
  dynamic?: DynamicSpec;
  /** v0.1.43 (LR-1): agent ops only; see OPERATION_LISTINGS. A manifest using it needs a validator from manifest 0.1.21 on.
   *  v0.1.76: `lazy` needs a validator that pins spec ≥ 0.1.76 (MANIFEST §5.5, M-OP-13). */
  listing?: OperationListing;
  /** v0.1.68 (C336 RQ-3, S-8; MANIFEST M-OP-12): the output carries a secret (e.g. a short-lived credential). App callers
   *  only (agent callers refused, `secret_output_app_only`), not schedulable, no idempotency row, receipt with input digest +
   *  summary only, never logged or given to an `after` hook; errors carry a code and a fixed message. Needs a bridge with the
   *  `secret_output` cap. */
  secretOutput?: true;
}

/** C354a (QA-C354-1): a catalog entry name — `^[a-z][a-z0-9_]{1,47}$`, never contains `__` and never ends in `_`, so a
 *  resolved variant `<name>__<suffix>` splits uniquely at its first `__`. SDKs and bridges drop other entry names. */
export const DYNAMIC_CATALOG_NAME_RE = /^(?!.*__)[a-z][a-z0-9_]{0,46}[a-z0-9]$/;
/** C354a: a requested or resolved dynamic tool — a catalog name, or a variant `<catalog name>__<suffix>` an app resolves
 *  (≤ 63 chars; e.g. `gmail_send__first_contact`). A variant runs the same upstream action as its base, never broader
 *  (`variantNarrowerOrEqual`). */
export const DYNAMIC_TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,62}$/;
/** C354a (QA-C354-3): a variant name — base (a catalog name: no `__`, no trailing `_`) + `__` + a suffix that starts with a
 *  letter or digit (`send___y` is not a variant). Group 1 = base, group 2 = suffix. Length limits: `dynamicVariantBase`. */
export const DYNAMIC_VARIANT_RE = /^([a-z](?:[a-z0-9]|_(?!_))*[a-z0-9])__([a-z0-9][a-z0-9_]*)$/;

/** C354a: the base catalog name of a variant `<base>__<suffix>`, or null when `name` is not a valid variant (bad shape,
 *  base fails `DYNAMIC_CATALOG_NAME_RE`, or the whole name fails `DYNAMIC_TOOL_NAME_RE`). Rules and bridges split here only. */
export function dynamicVariantBase(name: string): string | null {
  if (!DYNAMIC_TOOL_NAME_RE.test(name)) return null;
  const m = DYNAMIC_VARIANT_RE.exec(name);
  return m?.[1] && DYNAMIC_CATALOG_NAME_RE.test(m[1]) ? m[1] : null;
}

/** C354a (QA-SPEC56-1): the hold families of a resolution or catalog entry as a set (`holdFamilies`, else `[holdFamily]`).
 *  QA-SPEC56-3: an EMPTY `holdFamilies` never means "no holds": it falls back to `holdFamily` like an absent one. */
export function holdFamilySet(r: { holdFamily?: HoldFamily; holdFamilies?: HoldFamily[] }): Set<HoldFamily> {
  const set = new Set<HoldFamily>(r.holdFamilies ?? []);
  if (r.holdFamily) set.add(r.holdFamily);
  return set;
}

/** C354a (QA-SPEC56-1): "never broader" for a variant against its base — crud ⊆ base crud, effect at or below the base
 *  effect in `EFFECTS` order, and hold families ⊇ the base's (a variant may add holds, never drops one). */
export function variantNarrowerOrEqual(
  variant: { crud: CrudAction[]; effect: Effect; holdFamily?: HoldFamily; holdFamilies?: HoldFamily[] },
  base: { crud: CrudAction[]; effect: Effect; holdFamily?: HoldFamily; holdFamilies?: HoldFamily[] },
): boolean {
  if (!variant.crud.every((c) => base.crud.includes(c))) return false;
  // QA-SPEC56-3: an effect outside EFFECTS (either side) is never "narrower or equal" (fail closed)
  const ve = EFFECTS.indexOf(variant.effect);
  const be = EFFECTS.indexOf(base.effect);
  if (ve < 0 || be < 0 || ve > be) return false;
  const v = holdFamilySet(variant);
  return [...holdFamilySet(base)].every((f) => v.has(f));
}

/** One entry of a dynamic operation's catalog (bridge op `POST /tb/v1/bridge/catalog`, search results). */
export interface DynamicCatalogEntry {
  /** `DYNAMIC_CATALOG_NAME_RE`, unique within the app (C354a: no `__`, no trailing `_`; `__` is reserved for resolved variants such as `<name>__first_contact`). */
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  crud: CrudAction[];
  effect: Effect;
  holdFamily?: HoldFamily;
  /** v0.1.50 (C283 A1): set by the SDK on a catalog answer for one agent (BridgeOpCatalogBody.agent) when that agent's
   *  OWNER-set primary scope row admits this entry's crud. The bridge then lists it even when crud ⊄ grant.crud. DISPLAY
   *  only: the SDK still authorizes every call (decision.ts). Absent = admitted by the Portal grant only. */
  admitted?: "owner";
}

/** Fixed input of every dynamic operation call (`POST /tb/v1/ops/<op>`). */
export interface DynamicCallInput {
  tool: string;
  arguments: Record<string, unknown>;
}

/** Fixed input of a search-mode `<product>__<op>_search` call. */
export interface DynamicSearchInput {
  query: string;
  limit?: number;
}

/** Answer of bridge op `POST /tb/v1/bridge/resolve` (cacheable 5 min). */
export interface DynamicResolution {
  tool: string;
  crud: CrudAction[];
  effect: Effect;
  holdFamily?: HoldFamily;
  /** v0.1.74 (C354a, QA-SPEC56-1; bridge cap `hold_families`): the full hold-family SET of this call; the call is held when
   *  ANY member is held for the caller. When present it contains `holdFamily`, and `holdFamily` = the family a bridge without
   *  the cap applies (put the one held by default first, e.g. `first_contact`). A variant's set ⊇ its base's. */
  holdFamilies?: HoldFamily[];
}

// ---------- Scopes ----------

export interface ScopeAccessLevel {
  id: SnakeId;
  label: string;
  crud: CrudAction[];
}

export interface DefaultGrant {
  kind: DefaultGrantKind;
  access: SnakeId;
  /** v0.1.14 (Connect Q-C2): caller types the grant applies to; default both */
  callers?: ("agent" | "app")[];
}

export interface Scope {
  type: SnakeId;
  label: string;
  labelPlural: string;
  access: ScopeAccessLevel[];
  defaultGrants: DefaultGrant[];
  /** Variables: `{count}`, `{label}`, `{labelPlural}`, `{access.<id>}`. Rendered output ≤ 80 chars. */
  summaryTemplate: string;
  /** v0.1.65 (C331 D5b): plain text (≤ 40, no variables) the summary shows for an agent with NO assignment of this type, e.g.
   *  Connect "no account yet". Absent = the type adds nothing for that agent (before v0.1.65: always). M-SC-5. */
  summaryEmpty?: string;
}

// ---------- Settings and keys ----------

export interface SettingChoice {
  value: string;
  label: string;
  note?: string;
  disabled?: boolean;
}

export interface SettingField {
  key: SnakeId;
  type: SettingType;
  label: string;
  help?: string;
  required?: boolean;
  default?: string | number | boolean;
  choices?: SettingChoice[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  when?: Condition;
  mutable?: boolean;
}

export interface SettingStep {
  id: SnakeId;
  title: string;
  help?: string;
  when?: Condition;
  fields: SettingField[];
}

export interface KeyRequirement {
  name: EnvName;
  label: string;
  provider: string;
  help?: string;
  required: boolean;
  /** `account_default`: GUI label "workspace default key" (stored per workspace bridge). */
  source: KeySource;
  /** `"app"` or `runtime.services[].id`. */
  usedBy: string[];
  when?: Condition;
  step?: SnakeId;
}

/**
 * v0.1.63 (C322(3), C330(4)): a model role the app (or a service) uses. The workspace bridge resolves it from the owner's
 * role registry (BRIDGE §15) and never serves a binding below `minPolicy`. MANIFEST §7.1, rules M-MR-1..5.
 */
export interface ModelRoleRequirement {
  role: ModelRole;
  /** true: the app reports `needs_keys` + attention `model_role_missing` while unset; false: it runs without (attention optional) */
  required: boolean;
  /** default `standard`; Observer-type apps that read sensitive data declare `zdr` or `local` */
  minPolicy?: DataPolicy;
  /** `"app"` or `runtime.services[].id` */
  usedBy: string[];
  /** env names `tb-exec` fills for services from the resolved binding (M-MR-4) */
  env?: { provider?: EnvName; model?: EnvName; baseUrl?: EnvName; key?: EnvName; dims?: EnvName };
  help?: string;
  when?: Condition;
}

export interface Settings {
  steps: SettingStep[];
  keys?: KeyRequirement[];
  /** v0.1.63 */
  modelRoles?: ModelRoleRequirement[];
}

// ---------- Hooks, companions, unlocks ----------

export interface HookMatch {
  products: ("*" | ProductId)[];
  operations?: SnakeId[];
  effects?: Effect[];
}

export interface Hook {
  id: SnakeId;
  title: string;
  phase: HookPhase;
  order: number;
  match: HookMatch;
  /** 100..2000, default 2000. */
  timeoutMs?: number;
}

/** v0.1.15 (C104): declared minimum versions (features the validator cannot see, e.g. a before hook that answers `hold`). */
export interface ManifestRequires {
  bridge?: string;
  /** v0.1.68 (C354): bridge capabilities the release needs (BRIDGE_CAPS, e.g. "secret_output"). Core refuses to deploy it
   *  onto a workspace bridge that does not declare each one (`bridge_cap_missing`); a cap is never inferred from a version. */
  bridgeCaps?: string[];
}

export interface Companion {
  /** v0.1.13 (G4): `"*"` = every deployed app of the workspace, ONLY with operations ["tb.holds_pending"] and crud ["read"]
   *  (M-CP-3); Core mints the per-app grants only after the owner's explicit consent (C82, PORTAL-API `instances.consent`). */
  product: ProductId | "*";
  operations: SnakeId[];
  crud: CrudAction[];
  purpose: string;
}

export interface Unlock {
  id: SnakeId;
  title: string;
  /** Companion product id; must appear in `companions`. */
  requires: ProductId;
  provides: { operations?: SnakeId[]; skills?: string[] };
}

// ---------- Skills, hints ----------

export interface Skill {
  /** `^(?!tb-)[a-z][a-z0-9-]{1,39}$`. */
  id: string;
  title: string;
  /** Repo-relative path ending in `SKILL.md`. */
  file: string;
  when?: Condition;
}

export interface HarnessHint {
  harness: HarnessKind;
  instructions: string;
}

// ---------- Backups, artifacts, routes, UI ----------

export interface Backups {
  /** 5-field cron, UTC. */
  schedule: string;
  /** Number of backup archives kept, 1..90. */
  retain: number;
  files?: { volume: SnakeId; path: string }[];
}

export interface Artifact {
  id: SnakeId;
  version: SemVer;
  /** Lower-case hex SHA-256 of the asset bytes. */
  sha256: string;
  url: HttpsUrl;
}

export interface PublicRoute {
  path: string;
  purpose: PublicRoutePurpose;
}

export interface Ui {
  launchPath: string;
  configurePath?: string;
}

// ---------- Validator surface (implemented in @opt2-tealbrick/manifest) ----------

export interface ManifestIssue {
  /** RFC 6901 pointer into the manifest. */
  path: string;
  /** Rule id from MANIFEST.md, e.g. `M-OP-3`. */
  rule: string;
  /** snake_case error code. */
  code: string;
  message: string;
}

export type ManifestValidation =
  | { ok: true; manifest: Manifest; digest: `sha256:${string}` }
  | { ok: false; errors: ManifestIssue[] };
