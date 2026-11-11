// Tealbrick Admin (operator plane, C184/C193/C203/C204): the ADMIN route table and its types.
// v0.1.36 (S1): admin.me, customers.search/get, licences comp issue/list/revoke, operator audit list/verify.
// v0.1.37 (S2): customers.suspend/unsuspend/ban/unban (+ CustomerDetail.actions), admin.health, admin.maintenance_runs.
// v0.1.38 (S3): GDPR request queue (gdpr.*) and CRA case queue (cra.*). Core keeps the records and the clocks; nothing is
// ever sent or filed automatically (replies and JISKB submissions are done by a person and only RECORDED here).
//
// The admin table is SEPARATE from ROUTES: it is not in ROUTES, not in /internal/routes and not in ROUTES_DIGEST.
// Core serves it only on its admin listener (TB_ADMIN_PORT, default 8091), never on the main listener, and the Portal GUI
// gateway never forwards it. Every admin request passes four checks (C193):
//   1. separate port (admin listener only),
//   2. admin-GUI service signature (`tb-admin-gw` header, Ed25519 over ADMIN_GATEWAY_SIGNING_INPUT),
//   3. operator Clerk session token (Authorization: Bearer, the Clerk application of that environment, `azp` = admin origin),
//   4. env allowlist TB_ADMIN_OPERATORS on Core (C204): "<email>:<role>" (the Clerk user's PRIMARY email, verified,
//      case-insensitive) or "user_…:<role>", comma separated. No database write and no UI can appoint an operator.
// Step-up (C203): ops with `stepUp: true` need a Clerk session verification younger than ADMIN_STEP_UP_MAX_AGE_MINUTES
// (Clerk reverification; session claim `fva`). Missing or older → 403 step_up_required; the GUI reverifies and retries with
// the same Idempotency-Key. Every admin op writes one operator_audit row (hash chained, append-only, kept 3 years).
import type { WorkspaceId } from "./credentials.ts";
import type { ProductId } from "./manifest.ts";
import type { AccountId, HttpMethod, IsoTime, Licence, LicenceId, OfferPriceChecks, OrderId, Page, PageQuery, PaymentProvider } from "./routes.ts";

type Id<P extends string> = `${P}_${string}`;

/** C204: `readonly` sees masked emails; `support` ⊂ `owner`. */
export type OperatorRole = "owner" | "support" | "readonly";
export const OPERATOR_ROLES = ["readonly", "support", "owner"] as const satisfies readonly OperatorRole[];
/** true when `have` includes the rights of `need` (owner ⊃ support ⊃ readonly). */
export const roleCovers = (have: OperatorRole, need: OperatorRole): boolean => OPERATOR_ROLES.indexOf(have) >= OPERATOR_ROLES.indexOf(need);

export const ADMIN_PATH_PREFIX = "/admin/v1" as const;
/** Default admin listener port on Core (env TB_ADMIN_PORT). */
export const ADMIN_DEFAULT_PORT = 8091 as const;
/** C203: destructive and money-adjacent ops need a Clerk verification younger than this. */
export const ADMIN_STEP_UP_MAX_AGE_MINUTES = 5 as const;

// ───────────────────────────── admin-GUI service signature (check 2) ─────────────────────────────
/** Request header carrying the admin-GUI signature: `v1;ts=<unix s>;rid=<request id>;sig=<base64url Ed25519>`. */
export const ADMIN_GATEWAY_HEADER = "tb-admin-gw" as const;
/** Accepted clock difference between admin-GUI and Core, seconds. A (rid) is accepted once within this window. */
export const ADMIN_GATEWAY_MAX_SKEW_S = 30 as const;
export interface AdminGatewaySigningParts {
  method: HttpMethod;
  /** path + query exactly as sent to Core, starting with /admin/v1 */
  pathAndQuery: string;
  /** lowercase hex sha256 of the raw body bytes; sha256 of the empty string when there is no body */
  bodySha256: string;
  /** 16–64 chars [A-Za-z0-9_-], single use */
  rid: string;
  /** unix seconds */
  ts: number;
}
/** The exact bytes (UTF-8) the admin GUI signs and Core verifies. */
export const ADMIN_GATEWAY_SIGNING_INPUT = (p: AdminGatewaySigningParts): string =>
  ["tb-admin-gw-v1", p.method, p.pathAndQuery, p.bodySha256, p.rid, String(p.ts)].join("\n");

// ───────────────────────────── route row ─────────────────────────────
export type AdminEffect = "read" | "write" | "destructive";
export type AdminRateClass = "admin_read" | "admin_write" | "admin_destructive" | "admin_export";
/** Per operator. `admin_destructive` also has a global daily cap (Core). */
export const ADMIN_RATE_CLASSES = {
  admin_read: { limit: 120, windowMs: 60_000 },
  admin_write: { limit: 20, windowMs: 60_000 },
  admin_destructive: { limit: 5, windowMs: 3_600_000 },
  admin_export: { limit: 3, windowMs: 3_600_000 },
} as const satisfies Record<AdminRateClass, { limit: number; windowMs: number }>;

export interface AdminRouteOp {
  opId: string;
  method: HttpMethod;
  /** absolute, starts with /admin/v1; `{name}` = input field */
  path: string;
  exposure: "admin";
  auth: readonly ["operator"];
  minRole: OperatorRole;
  effect: AdminEffect;
  stepUp: boolean;
  rate: AdminRateClass;
  /** allowed query keys (GET only) */
  query: readonly string[];
  input: AdminSchemaName;
  output: AdminSchemaName;
  /** Idempotency-Key header required */
  idempotent: boolean;
}

// ───────────────────────────── S1 shapes ─────────────────────────────
export type CompGrantId = Id<"cmp">;
export type AdminEnvironment = "dev" | "live";

export interface AdminMe {
  operator: { clerkUserId: string; email: string | null; role: OperatorRole };
  /** from the Core environment (Railway environment `live` → live, anything else → dev) */
  environment: AdminEnvironment;
  /** Stripe mode of this Core's key (CORE-A-03); comps are issued in this mode */
  stripeMode: "test" | "live";
  /** the session's last verification is younger than ADMIN_STEP_UP_MAX_AGE_MINUTES */
  stepUpFresh: boolean;
  stepUpMaxAgeMinutes: number;
  version: string;
}

export type CustomerState = "active" | "closed" | "suspended" | "banned";
/** q: ≥ 3 characters of email or name, or an exact id (acc_, ws_, lic_, ord_, cmp_, user_, Stripe cus_/cs_/pi_,
 *  v0.1.94 Paddle ctm_/txn_). */
export type CustomerSearchInput = PageQuery & { q: string };
export interface CustomerSummary {
  id: AccountId;
  /** masked (`a•••@example.com`) for the readonly role */
  email: string;
  name: string | null;
  state: CustomerState;
  workspaces: number;
  licences: { paid: number; comp: number };
  createdAt: IsoTime;
}
export type CustomerList = Page<CustomerSummary>;
export interface CustomerRef { acc: AccountId }

export interface AdminWorkspace {
  id: WorkspaceId;
  name: string;
  status: "active" | "paused" | "standalone" | "deleted";
  channel: "stable" | "dev";
  infrastructure: { provider: string; destinationName: string } | null;
  bridge: { id: string | null; state: string; health: string | null; healthAt: IsoTime | null };
  apps: { product: ProductId; release: string | null; state: string; health: string | null }[];
  configRevision: number;
  createdAt: IsoTime;
  deletedAt: IsoTime | null;
}
export interface AdminOrder {
  id: OrderId;
  offerId: string;
  state: string;
  amountTotal: number | null;
  currency: string;
  promotionCode: string | null;
  buyerType: string | null;
  createdAt: IsoTime;
  paidAt: IsoTime | null;
}
export interface CustomerDetail {
  account: {
    id: AccountId;
    clerkUserId: string;
    email: string;
    name: string | null;
    state: CustomerState;
    createdAt: IsoTime;
    closedAt: IsoTime | null;
    purgedAt: IsoTime | null;
    termsAcceptedAt: IsoTime | null;
  };
  workspaces: AdminWorkspace[];
  licences: Licence[];
  orders: AdminOrder[];
  comps: CompGrant[];
  /** v0.1.37: suspend / ban history, newest first */
  actions?: AccountAction[];
}

// ───────────────────────────── S2: account state (C184 §2.3, C203 Q2) ─────────────────────────────
// Suspend: Core answers account_suspended to the customer's ops (except account.me, licences.list, billing.portal);
// isEntitled is false for every licence of the account; every workspace config is re-minted at once, so the bridge drops
// app grants within ~60 s. Ban = suspend + Clerk ban (ends Clerk sessions, blocks sign-in) + owner CLI sessions revoked +
// pending device requests denied. Neither ever deletes data (I15). Installed software stays in the customer's hosting.
export type AccountActionKind = "suspend" | "unsuspend" | "ban" | "unban";
export type RestrictionReasonCode = "unpaid_dispute" | "abuse_aup" | "fraud" | "legal_order" | "security_risk" | "other";
export const RESTRICTION_REASON_CODES = ["unpaid_dispute", "abuse_aup", "fraud", "legal_order", "security_risk", "other"] as const satisfies readonly RestrictionReasonCode[];
/** Terms: "where reasonable, we tell you in advance". Either a notice was sent (channel + time), or none, with a reason. */
export interface RestrictionNotice {
  channel: "email" | "none";
  /** required when channel is email */
  sentAt?: IsoTime | null;
  /** required when channel is none (3-300 chars, e.g. fraud, legal order, security) */
  noAdvanceReason?: string | null;
}
export type AccountActionId = Id<"act">;
export interface AccountAction {
  id: AccountActionId;
  kind: AccountActionKind;
  reasonCode: RestrictionReasonCode | null;
  /** shown to the customer (≤ 500) */
  customerText: string | null;
  /** operators only, never shown to the customer, no secrets (≤ 1000) */
  internalNote: string | null;
  notice: { channel: "email" | "none"; sentAt: IsoTime | null; noAdvanceReason: string | null } | null;
  effectiveAt: IsoTime;
  /** timed suspension: Core lifts it at this time */
  endsAt: IsoTime | null;
  operatorId: string;
}
export interface SuspendInput {
  acc: AccountId;
  reasonCode: RestrictionReasonCode;
  customerText: string;
  internalNote?: string;
  notice: RestrictionNotice;
  /** optional end; null/absent = until lifted */
  endsAt?: IsoTime | null;
}
export interface BanInput {
  acc: AccountId;
  reasonCode: RestrictionReasonCode;
  customerText: string;
  internalNote?: string;
  notice: RestrictionNotice;
  /** typed confirmation: the account's email, exactly (case-insensitive) */
  confirmEmail: string;
}
export interface LiftInput { acc: AccountId; internalNote?: string }
export interface AccountStateChange {
  account: { id: AccountId; state: CustomerState };
  action: AccountAction;
  configRevisions: { ws: WorkspaceId; revision: number }[];
  /** what Clerk did: banned / unbanned, or skipped (suspend / unsuspend never call Clerk) */
  clerk: "banned" | "unbanned" | "skipped";
  /** owner CLI sessions revoked + device requests denied (ban only) */
  sessionsRevoked: number;
}

// ───────────────────────────── S2: health (C184 §6) ─────────────────────────────
export interface AdminHealthService {
  name: string;
  /** null = not checked (no token / not reachable from Core) */
  ok: boolean | null;
  version: string | null;
  /** Railway deployment state, read-only; null when Core has no read token */
  deploy: { status: string; at: IsoTime; commit: string | null } | null;
  detail: string | null;
}
export interface AdminJobStatus {
  job: string;
  lastRunAt: IsoTime | null;
  lastOk: boolean | null;
  lastResult: Record<string, unknown> | null;
  /** the job should leave a row at least this often (minutes); null = only when it has work */
  expectedEveryMinutes: number | null;
  late: boolean;
}
export interface AdminWorkflowStatus {
  name: string;
  repo: string;
  lastRunAt: IsoTime | null;
  status: string | null;
  conclusion: string | null;
  url: string | null;
  error: string | null;
}
export interface AdminHealth {
  at: IsoTime;
  core: {
    ok: boolean;
    version: string;
    db: "ok" | "down";
    deployWorker: { alive: boolean; lastSweepAt: IsoTime | null; queued: number; unowned: number };
    commerce: { livemode: boolean; refusedSessions: number; lastRefusedAt: IsoTime | null };
  };
  services: AdminHealthService[];
  jobs: AdminJobStatus[];
  workflows: AdminWorkflowStatus[];
  stripe: { refusedSessions30d: number; lastRefusedAt: IsoTime | null; webhookFailures24h: number; lastWebhookAt: IsoTime | null };
  /** v0.1.94 (specs#74, portal-core#41): the Payment provider this Core runs on, its mode, its webhook and the Offer price
   *  checks. Optional while Core is on Stripe; `stripe` above is deprecated and removed in the spec contract (specs#75). */
  payments?: {
    provider: PaymentProvider;
    /** off = no key, or a live key refused */
    mode: "test" | "live" | "off";
    webhookFailures24h: number;
    lastWebhookAt: IsoTime | null;
    offerPriceChecks: OfferPriceChecks;
  };
  /** bridges whose last contact is older than 1 h (count only) */
  bridges: { total: number; quiet1h: number };
  sources: { railway: boolean; glitchtip: boolean };
}
export interface MaintenanceRun { id: number; job: string; startedAt: IsoTime; finishedAt: IsoTime | null; ok: boolean; result: Record<string, unknown> }
export type MaintenanceRunsInput = PageQuery & { job?: string };
export type MaintenanceRunList = Page<MaintenanceRun>;

/** Engineering name "comp"; the UI says "Free licence". */
export type CompKind = "promo" | "personal" | "friends" | "partner" | "goodwill";
export const COMP_KINDS = ["promo", "personal", "friends", "partner", "goodwill"] as const satisfies readonly CompKind[];
/** Default length by kind (days); null = lifetime of the major (owner only). */
export const COMP_DEFAULT_DAYS = { promo: 90, goodwill: 30, personal: null, friends: null, partner: null } as const satisfies Record<CompKind, number | null>;
/** support: promo/goodwill only, at most this many days. */
export const COMP_SUPPORT_MAX_DAYS = 90 as const;
/** Max active comps per account per product. */
export const COMP_MAX_ACTIVE_PER_PRODUCT = 3 as const;

export interface CompGrant {
  id: CompGrantId;
  accountId: AccountId;
  product: ProductId;
  major: number;
  kind: CompKind;
  reason: string;
  campaign: string | null;
  /** null = lifetime of this major */
  expiresAt: IsoTime | null;
  state: "active" | "expired" | "revoked";
  licenceId: LicenceId;
  livemode: boolean;
  issuedBy: string;
  issuedAt: IsoTime;
  revokedAt: IsoTime | null;
  revokedBy: string | null;
  revokeReason: string | null;
}
export interface CompIssueInput {
  acc: AccountId;
  product: ProductId;
  major: number;
  kind: CompKind;
  /** 3–300 chars, required */
  reason: string;
  campaign?: string;
  /** omitted → COMP_DEFAULT_DAYS; null → lifetime (owner only) */
  expiresAt?: IsoTime | null;
  /** optional: assign to this workspace of the account when the slot is free */
  assignTo?: WorkspaceId;
}
export interface CompRevokeInput { cmp: CompGrantId; reason: string }
export interface CompChange { comp: CompGrant; licence: Licence; configRevisions: { ws: WorkspaceId; revision: number }[] }
export type CompListInput = PageQuery & { state?: "active" | "all"; acc?: AccountId };
export type CompList = Page<CompGrant>;
export interface CompProducts { items: { product: ProductId; name: string; major: number }[] }

export interface OperatorAuditEntry {
  id: number;
  at: IsoTime;
  operatorId: string;
  role: OperatorRole;
  opId: string;
  subjectKind: string | null;
  subjectId: string | null;
  caseRef: string | null;
  outcome: "ok" | "failed" | "refused";
  reason: string | null;
  requestId: string;
  hash: string;
}
export type OperatorAuditListInput = PageQuery & { operator?: string };
export type OperatorAuditList = Page<OperatorAuditEntry>;
export interface OperatorAuditVerify { ok: boolean; rows: number; brokenAtId: number | null; headHash: string | null }

// ───────────────────────────── S3: GDPR queue (C184 §4; C203: records kept 3 years after close) ─────────────────────────────
export type GdprRequestId = Id<"gdp">;
export type GdprExportId = Id<"gex">;
export type GdprKind = "access" | "portability" | "erasure" | "rectification" | "restriction" | "objection";
export const GDPR_KINDS = ["access", "portability", "erasure", "rectification", "restriction", "objection"] as const satisfies readonly GdprKind[];
export type GdprState = "open" | "waiting_requester" | "in_progress" | "done" | "refused" | "withdrawn";
export type GdprOutcome = "done" | "partly_done" | "refused" | "not_our_data" | "no_data";
export const GDPR_OUTCOMES = ["done", "partly_done", "refused", "not_our_data", "no_data"] as const satisfies readonly GdprOutcome[];
/** Reply templates the GUI renders (A access/export, B erasure done, C rectification, D restriction, E objection,
 *  F apps + data in the customer's own hosting, G a person in a customer's data: not ours, H identity not confirmed). */
export type GdprReplyTemplate = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
export const GDPR_REPLY_TEMPLATES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const satisfies readonly GdprReplyTemplate[];
/** Art. 12(3): one month (we use the earlier of 30 days and one calendar month); extension by up to two more months. */
export const GDPR_DUE_DAYS = 30 as const;
export const GDPR_MAX_EXTENSION_MONTHS = 2 as const;
export const GDPR_EXPORT_TTL_DAYS = 7 as const;

export interface GdprRequest {
  id: GdprRequestId;
  kind: GdprKind;
  channel: "email" | "portal_form" | "other";
  receivedAt: IsoTime;
  /** masked for readonly */
  requesterEmail: string;
  accountId: AccountId | null;
  /** short operator summary, no secrets (≤ 500) */
  summary: string | null;
  identity: "unverified" | "verified" | "failed";
  identityMethod: "portal_session" | "account_email_reply" | "other" | null;
  verifiedAt: IsoTime | null;
  dueAt: IsoTime;
  extendedUntil: IsoTime | null;
  extensionReason: string | null;
  extensionNotifiedAt: IsoTime | null;
  /** extendedUntil ?? dueAt */
  effectiveDueAt: IsoTime;
  /** whole days to effectiveDueAt (negative = late), from Core's clock */
  daysLeft: number;
  late: boolean;
  state: GdprState;
  outcome: GdprOutcome | null;
  replyTemplate: GdprReplyTemplate | null;
  closedAt: IsoTime | null;
  createdBy: string;
  createdAt: IsoTime;
}
export interface GdprEvent { id: number; at: IsoTime; kind: string; operatorId: string; detail: Record<string, string | number | boolean | null> }
export interface GdprExport { id: GdprExportId; requestId: GdprRequestId; accountId: AccountId; sha256: string; bytes: number; createdAt: IsoTime; expiresAt: IsoTime; downloadedAt: IsoTime | null; deletedAt: IsoTime | null }
export interface GdprDetail { request: GdprRequest; events: GdprEvent[]; exports: GdprExport[]; account: CustomerSummary | null }
export type GdprListInput = PageQuery & { state?: "open" | "all" };
export type GdprList = Page<GdprRequest>;
export interface GdprRef { gdp: GdprRequestId }
export interface GdprCreateInput { kind: GdprKind; channel: "email" | "portal_form" | "other"; receivedAt: IsoTime; requesterEmail: string; accountId?: AccountId; summary?: string }
export interface GdprUpdateInput { gdp: GdprRequestId; state?: "open" | "waiting_requester" | "in_progress"; summary?: string; note?: string }
export interface GdprIdentityInput { gdp: GdprRequestId; identity: "verified" | "failed"; method: "portal_session" | "account_email_reply" | "other"; accountId?: AccountId; note?: string }
export interface GdprExtendInput { gdp: GdprRequestId; extendedUntil: IsoTime; reason: string; notifiedAt: IsoTime }
export interface GdprCloseInput { gdp: GdprRequestId; outcome: GdprOutcome; replyTemplate: GdprReplyTemplate; note?: string }
export interface GdprErasurePreview {
  accountId: AccountId;
  /** rows the erasure deletes or anonymises, per table (a dry run of the same code, rolled back) */
  rows: Record<string, number>;
  /** what stays and why (plain sentences) */
  keeps: string[];
  clerkUser: boolean;
}
export interface GdprErasureInput { gdp: GdprRequestId; confirmEmail: string; deleteClerkUser: boolean }
export interface GdprErasureResult { accountId: AccountId; rows: Record<string, number>; clerk: "deleted" | "skipped" | "not_found" }
/** one-download JSON bundle (format tealbrick.portal-export/1) */
export interface GdprBundle { [k: string]: unknown }

// ───────────────────────────── S3: CRA cases (C184 §5; C203: records kept 10 years) ─────────────────────────────
export type CraCaseId = Id<"cra">;
export type CraKind = "vulnerability" | "exploited_vulnerability" | "severe_incident" | "not_reportable" | "undecided";
export const CRA_KINDS = ["vulnerability", "exploited_vulnerability", "severe_incident", "not_reportable", "undecided"] as const satisfies readonly CraKind[];
export type CraSource = "security_mail" | "github_pvr" | "cvd_form" | "internal" | "customer";
export const CRA_SOURCES = ["security_mail", "github_pvr", "cvd_form", "internal", "customer"] as const satisfies readonly CraSource[];
export type CraStage = "early_warning" | "notification" | "final" | "interim" | "fallback_email";
export const CRA_STAGES = ["early_warning", "notification", "final", "interim", "fallback_email"] as const satisfies readonly CraStage[];
export type CraState = "triage" | "reporting" | "fixing" | "monitoring" | "closed";
/** Article 14 clocks from awareness: early warning 24 h, notification 72 h; final = 14 days after the fix (exploited
 *  vulnerability) or 1 month after the notification (severe incident). "undecided" counts as reportable. */
export const CRA_EARLY_WARNING_HOURS = 24 as const;
export const CRA_NOTIFICATION_HOURS = 72 as const;
export const CRA_FINAL_AFTER_FIX_DAYS = 14 as const;

export interface CraClock {
  stage: "early_warning" | "notification" | "final";
  /** null = not computable yet (final before a fix / before the notification) */
  dueAt: IsoTime | null;
  submittedAt: IsoTime | null;
  late: boolean;
  /** whole hours to dueAt (negative = late); null when there is no due time or it was submitted */
  hoursLeft: number | null;
}
export interface CraCase {
  id: CraCaseId;
  source: CraSource;
  receivedAt: IsoTime;
  /** clock start; moves earlier freely, later only by an owner with a reason and a step-up */
  awarenessAt: IsoTime;
  /** no secrets, no customer personal data (≤ 1000) */
  summary: string;
  products: { product: string; versions: string }[];
  kind: CraKind;
  reportable: boolean;
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  notReportableReason: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  cvssVector: string | null;
  maliciousAct: "confirmed" | "suspected" | "unknown";
  personalData: "yes" | "no" | "unknown";
  fixVersion: string | null;
  fixAvailableAt: IsoTime | null;
  userNoticeSentAt: IsoTime | null;
  userNoticeCount: number | null;
  advisoryUrl: string | null;
  cveId: string | null;
  ghsaId: string | null;
  state: CraState;
  closedAt: IsoTime | null;
  createdBy: string;
  createdAt: IsoTime;
  clocks: CraClock[];
}
export interface CraSubmission { id: number; caseId: CraCaseId; stage: CraStage; submittedAt: IsoTime; jiskbReference: string | null; evidenceLocation: string; submittedBy: string; late: boolean }
export interface CraEvent { id: number; at: IsoTime; kind: string; operatorId: string; text: string | null }
export interface CraDetail { case: CraCase; submissions: CraSubmission[]; events: CraEvent[] }
export type CraListInput = PageQuery & { state?: "open" | "all" };
export type CraList = Page<CraCase>;
export interface CraRef { cra: CraCaseId }
export interface CraCreateInput { source: CraSource; receivedAt: IsoTime; awarenessAt?: IsoTime; summary: string; products?: { product: string; versions: string }[]; ghsaId?: string }
export interface CraTriageInput {
  cra: CraCaseId;
  kind: CraKind;
  severity?: "low" | "medium" | "high" | "critical" | null;
  cvssVector?: string | null;
  products?: { product: string; versions: string }[];
  maliciousAct?: "confirmed" | "suspected" | "unknown";
  personalData?: "yes" | "no" | "unknown";
  /** required for kind not_reportable or vulnerability */
  notReportableReason?: string;
}
export interface CraAwarenessInput { cra: CraCaseId; awarenessAt: IsoTime; reason?: string }
export interface CraSubmissionInput { cra: CraCaseId; stage: CraStage; submittedAt: IsoTime; jiskbReference?: string; evidenceLocation: string }
export interface CraTimelineInput { cra: CraCaseId; text: string }
export interface CraFixInput { cra: CraCaseId; fixVersion: string; fixAvailableAt: IsoTime }
export interface CraAdvisoryInput { cra: CraCaseId; advisoryUrl?: string; cveId?: string; ghsaId?: string; userNoticeSentAt?: IsoTime; userNoticeCount?: number }
export interface CraCloseInput { cra: CraCaseId; note?: string }

export interface AdminEmpty { [k: string]: never }

export interface AdminSchemaMap {
  AdminEmpty: AdminEmpty;
  AdminMe: AdminMe;
  CustomerSearchInput: CustomerSearchInput;
  CustomerList: CustomerList;
  CustomerRef: CustomerRef;
  CustomerDetail: CustomerDetail;
  CompIssueInput: CompIssueInput;
  CompRevokeInput: CompRevokeInput;
  CompChange: CompChange;
  CompListInput: CompListInput;
  CompList: CompList;
  CompProducts: CompProducts;
  OperatorAuditListInput: OperatorAuditListInput;
  OperatorAuditList: OperatorAuditList;
  OperatorAuditVerify: OperatorAuditVerify;
  SuspendInput: SuspendInput;
  BanInput: BanInput;
  LiftInput: LiftInput;
  AccountStateChange: AccountStateChange;
  AdminHealth: AdminHealth;
  MaintenanceRunsInput: MaintenanceRunsInput;
  MaintenanceRunList: MaintenanceRunList;
  GdprListInput: GdprListInput; GdprList: GdprList; GdprRef: GdprRef; GdprDetail: GdprDetail; GdprCreateInput: GdprCreateInput;
  GdprUpdateInput: GdprUpdateInput; GdprIdentityInput: GdprIdentityInput; GdprExtendInput: GdprExtendInput; GdprCloseInput: GdprCloseInput;
  GdprErasurePreview: GdprErasurePreview; GdprErasureInput: GdprErasureInput; GdprErasureResult: GdprErasureResult; GdprExport: GdprExport;
  GdprBundle: GdprBundle;
  CraListInput: CraListInput; CraList: CraList; CraRef: CraRef; CraDetail: CraDetail; CraCreateInput: CraCreateInput; CraTriageInput: CraTriageInput;
  CraAwarenessInput: CraAwarenessInput; CraSubmissionInput: CraSubmissionInput; CraTimelineInput: CraTimelineInput; CraFixInput: CraFixInput;
  CraAdvisoryInput: CraAdvisoryInput; CraCloseInput: CraCloseInput;
}
export type AdminSchemaName = keyof AdminSchemaMap;

// ───────────────────────────── the admin table ─────────────────────────────
const OP = ["operator"] as const;
const NOQ = [] as const;
const PAGE = ["cursor", "limit"] as const;

export const ADMIN_ROUTES = [
  { opId: "admin.me", method: "GET", path: "/admin/v1/me", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "AdminEmpty", output: "AdminMe", idempotent: false },
  { opId: "customers.search", method: "GET", path: "/admin/v1/customers", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: ["q", "cursor", "limit"], input: "CustomerSearchInput", output: "CustomerList", idempotent: false },
  { opId: "customers.get", method: "GET", path: "/admin/v1/customers/{acc}", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "CustomerRef", output: "CustomerDetail", idempotent: false },
  { opId: "licences.comp_products", method: "GET", path: "/admin/v1/licences/comp-products", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "AdminEmpty", output: "CompProducts", idempotent: false },
  { opId: "licences.comp_list", method: "GET", path: "/admin/v1/licences/comps", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: ["state", "acc", "cursor", "limit"], input: "CompListInput", output: "CompList", idempotent: false },
  { opId: "licences.comp_issue", method: "POST", path: "/admin/v1/licences/comps", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: true, rate: "admin_write", query: NOQ, input: "CompIssueInput", output: "CompChange", idempotent: true },
  { opId: "licences.comp_revoke", method: "POST", path: "/admin/v1/licences/comps/{cmp}/revoke", exposure: "admin", auth: OP, minRole: "owner", effect: "destructive", stepUp: true, rate: "admin_destructive", query: NOQ, input: "CompRevokeInput", output: "CompChange", idempotent: true },
  { opId: "operator_audit.list", method: "GET", path: "/admin/v1/operator-audit", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: ["operator", ...PAGE], input: "OperatorAuditListInput", output: "OperatorAuditList", idempotent: false },
  { opId: "operator_audit.verify", method: "GET", path: "/admin/v1/operator-audit/verify", exposure: "admin", auth: OP, minRole: "owner", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "AdminEmpty", output: "OperatorAuditVerify", idempotent: false },
  // v0.1.37 (S2)
  { opId: "customers.suspend", method: "POST", path: "/admin/v1/customers/{acc}/suspend", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: true, rate: "admin_write", query: NOQ, input: "SuspendInput", output: "AccountStateChange", idempotent: true },
  { opId: "customers.unsuspend", method: "POST", path: "/admin/v1/customers/{acc}/unsuspend", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: true, rate: "admin_write", query: NOQ, input: "LiftInput", output: "AccountStateChange", idempotent: true },
  { opId: "customers.ban", method: "POST", path: "/admin/v1/customers/{acc}/ban", exposure: "admin", auth: OP, minRole: "owner", effect: "destructive", stepUp: true, rate: "admin_destructive", query: NOQ, input: "BanInput", output: "AccountStateChange", idempotent: true },
  { opId: "customers.unban", method: "POST", path: "/admin/v1/customers/{acc}/unban", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: true, rate: "admin_write", query: NOQ, input: "LiftInput", output: "AccountStateChange", idempotent: true },
  { opId: "admin.health", method: "GET", path: "/admin/v1/health", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "AdminEmpty", output: "AdminHealth", idempotent: false },
  { opId: "admin.maintenance_runs", method: "GET", path: "/admin/v1/maintenance-runs", exposure: "admin", auth: OP, minRole: "readonly", effect: "read", stepUp: false, rate: "admin_read", query: ["job", ...PAGE], input: "MaintenanceRunsInput", output: "MaintenanceRunList", idempotent: false },
  // v0.1.38 (S3) GDPR
  { opId: "gdpr.list", method: "GET", path: "/admin/v1/gdpr", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: ["state", ...PAGE], input: "GdprListInput", output: "GdprList", idempotent: false },
  { opId: "gdpr.get", method: "GET", path: "/admin/v1/gdpr/{gdp}", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "GdprRef", output: "GdprDetail", idempotent: false },
  { opId: "gdpr.create", method: "POST", path: "/admin/v1/gdpr", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "GdprCreateInput", output: "GdprDetail", idempotent: true },
  { opId: "gdpr.update", method: "POST", path: "/admin/v1/gdpr/{gdp}/update", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "GdprUpdateInput", output: "GdprDetail", idempotent: true },
  { opId: "gdpr.identity_record", method: "POST", path: "/admin/v1/gdpr/{gdp}/identity", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "GdprIdentityInput", output: "GdprDetail", idempotent: true },
  { opId: "gdpr.extend", method: "POST", path: "/admin/v1/gdpr/{gdp}/extend", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "GdprExtendInput", output: "GdprDetail", idempotent: true },
  { opId: "gdpr.export_build", method: "POST", path: "/admin/v1/gdpr/{gdp}/export", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: true, rate: "admin_export", query: NOQ, input: "GdprRef", output: "GdprExport", idempotent: true },
  { opId: "gdpr.export_download", method: "POST", path: "/admin/v1/gdpr/{gdp}/export/download", exposure: "admin", auth: OP, minRole: "owner", effect: "read", stepUp: true, rate: "admin_export", query: NOQ, input: "GdprRef", output: "GdprBundle", idempotent: true },
  { opId: "gdpr.erasure_preview", method: "GET", path: "/admin/v1/gdpr/{gdp}/erasure", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "GdprRef", output: "GdprErasurePreview", idempotent: false },
  { opId: "gdpr.erasure_execute", method: "POST", path: "/admin/v1/gdpr/{gdp}/erasure", exposure: "admin", auth: OP, minRole: "owner", effect: "destructive", stepUp: true, rate: "admin_destructive", query: NOQ, input: "GdprErasureInput", output: "GdprErasureResult", idempotent: true },
  { opId: "gdpr.close", method: "POST", path: "/admin/v1/gdpr/{gdp}/close", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "GdprCloseInput", output: "GdprDetail", idempotent: true },
  // v0.1.38 (S3) CRA
  { opId: "cra.list", method: "GET", path: "/admin/v1/cra", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: ["state", ...PAGE], input: "CraListInput", output: "CraList", idempotent: false },
  { opId: "cra.get", method: "GET", path: "/admin/v1/cra/{cra}", exposure: "admin", auth: OP, minRole: "support", effect: "read", stepUp: false, rate: "admin_read", query: NOQ, input: "CraRef", output: "CraDetail", idempotent: false },
  { opId: "cra.create", method: "POST", path: "/admin/v1/cra", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraCreateInput", output: "CraDetail", idempotent: true },
  { opId: "cra.triage", method: "POST", path: "/admin/v1/cra/{cra}/triage", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraTriageInput", output: "CraDetail", idempotent: true },
  /** step-up only when the new awareness time is LATER than the current one (Core enforces; T9) */
  { opId: "cra.awareness_set", method: "POST", path: "/admin/v1/cra/{cra}/awareness", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraAwarenessInput", output: "CraDetail", idempotent: true },
  { opId: "cra.submission_record", method: "POST", path: "/admin/v1/cra/{cra}/submissions", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraSubmissionInput", output: "CraDetail", idempotent: true },
  { opId: "cra.timeline_add", method: "POST", path: "/admin/v1/cra/{cra}/timeline", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraTimelineInput", output: "CraDetail", idempotent: true },
  { opId: "cra.fix_record", method: "POST", path: "/admin/v1/cra/{cra}/fix", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraFixInput", output: "CraDetail", idempotent: true },
  { opId: "cra.advisory_record", method: "POST", path: "/admin/v1/cra/{cra}/advisory", exposure: "admin", auth: OP, minRole: "support", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraAdvisoryInput", output: "CraDetail", idempotent: true },
  { opId: "cra.close", method: "POST", path: "/admin/v1/cra/{cra}/close", exposure: "admin", auth: OP, minRole: "owner", effect: "write", stepUp: false, rate: "admin_write", query: NOQ, input: "CraCloseInput", output: "CraDetail", idempotent: true },
] as const satisfies readonly AdminRouteOp[];

type AdminRow = (typeof ADMIN_ROUTES)[number];
export type AdminOpId = AdminRow["opId"];

type Check<T extends true> = T;
/** AR1: every admin path is under /admin/v1. */
export type InvariantAdminPaths = Check<[Exclude<AdminRow, { path: `/admin/v1/${string}` }>] extends [never] ? true : false>;
/** AR2: destructive ops always need a step-up. */
export type InvariantDestructiveStepUp = Check<[Extract<AdminRow, { effect: "destructive"; stepUp: false }>] extends [never] ? true : false>;
/** AR3: every mutation is idempotent (the GUI retries after a step-up with the same key). */
export type InvariantAdminWritesIdempotent = Check<[Extract<AdminRow, { method: "POST" | "PUT" | "PATCH" | "DELETE"; idempotent: false }>] extends [never] ? true : false>;
