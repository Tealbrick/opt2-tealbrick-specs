// v0.1.89 (C380; docs/ACCESS.md): tb.access/1, how a store reports and ends access for Governance. Types and constants only.
// Schemas and fixtures: schemas/contracts/access.*.schema.json, examples/contracts/access.*.json. Not a manifest contract id.

import type { AgentId } from "./credentials.ts";

export const ACCESS_CONTRACT = "tb.access/1" as const;
/** The verified caller product of every tb.access/1 op (guard: type app, `caller.product`, `caller.listed === true`). */
export const ACCESS_CALLER_PRODUCT = "fleet" as const;
/** Every op is appended LAST in `operations`. No new manifest field, no standard op. `access_revoke` is optional per target. */
export const ACCESS_OPS = {
  access_list: { audience: "agent", listing: "workflow", crud: ["read"], effect: "read", idempotency: "none", receipt: false },
  access_revoke: { audience: "agent", listing: "workflow", crud: ["update"], effect: "write", idempotency: "required", receipt: true },
} as const;

/** The closed list of kinds per target product. `kanban` has no `access_revoke`. */
export const ACCESS_KINDS = {
  connect: ["account_as_itself", "account_as_me", "buzz_identity", "scheduled_post", "first_contacts", "channel_sender"],
  knowledge: ["agent_area", "person_area", "team_grant"],
  kanban: ["assignment", "own_project"],
  evolution: ["routine", "workflow_agent_step", "schedule_of_workflow"],
} as const;
export type AccessTarget = keyof typeof ACCESS_KINDS;
export type AccessKind = (typeof ACCESS_KINDS)[AccessTarget][number];

export const ACCESS_LIST_LIMITS = { subjectsMax: 32, handlesMax: 16, limitMax: 200, limitDefault: 100, sweepIdMaxChars: 64, cursorMaxChars: 512, sweepPagesMax: 50 } as const;
/** Items per `access_revoke`; above it the target answers 400 `input_invalid`. */
export const ACCESS_REVOKE_ITEMS_MAX = { connect: 5, knowledge: 10, evolution: 10 } as const;
/** A `failed` item: at most this many attempts by job (ACCESS.md, Fleet's failure map). */
export const ACCESS_REVOKE_ATTEMPTS_MAX = 6;

export type AccessSubject =
  | { kind: "agent"; id: AgentId }
  /** Governance id; canonical handles, ≤ 16 */
  | { kind: "person"; id: string; handles: string[] }
  /** items this target cannot tie to anyone */
  | { kind: "unlinked" }
  /** sweep; must be the only subject */
  | { kind: "all" };

export interface AccessListIn {
  v: 1;
  /** 1..32 */
  subjects: AccessSubject[];
  cursor?: string;
  /** 1..200, default 100 */
  limit?: number;
  /** ≤ 64, echoed */
  sweepId?: string;
}

export interface AccessItem {
  /** stable, `<kind>:<opaque>`, ≤ 128 */
  id: string;
  kind: AccessKind;
  subject: { kind: "agent"; id: AgentId } | { kind: "person"; id: string } | { kind: "unlinked" };
  /** stable id of what is reached (account, routine, handle, area), ≤ 128, owner-side only */
  resource: string;
  /** `about` = others can reach the subject's things */
  direction: "held_by" | "about";
  level: "read" | "write" | "use" | "info";
  /** ≤ 120, no content, no secret */
  label: string;
  state: "active" | "paused" | "scheduled" | "dormant";
  revocable: boolean;
  since?: string;
  /** `sha256:` + hex of the JCS of {v: 1, target, id, kind, subject, resource, level}. NOT state, since, label, revocable, direction. */
  digest: `sha256:${string}`;
}

export interface AccessListOut {
  v: 1;
  asOf: string;
  sweepId?: string;
  items: AccessItem[];
  /** paging ONLY */
  nextCursor: string | null;
  /** kinds this version cannot list ONLY */
  notShown: { kind: string; reason: string }[];
  /** `nextCursor === null` and `notShown` is empty; nothing else */
  complete: boolean;
}

export interface AccessRevokeIn {
  v: 1;
  /** `pln_<id>`, `^pln_[0-9A-Za-z]{1,40}$` */
  plan: string;
  /** persisted before the call; ≥ 1 */
  attempt: number;
  subject: { kind: "agent"; id: AgentId } | { kind: "person"; id: string };
  /** 1..10; Connect 1..5. No free text. */
  items: { id: string; digest: `sha256:${string}` }[];
}

export type AccessRevokeOutcome = "revoked" | "already_gone" | "changed" | "not_revocable" | "failed";

export interface AccessRevokeOut {
  v: 1;
  asOf: string;
  results: { id: string; outcome: AccessRevokeOutcome; code?: string; detail?: string }[];
}

/** `not_revocable` code of an account disconnect or routine pause while the target's signed slice shows the agent running (S2-6). */
export const ACCESS_AGENT_RUNNING = "agent_running" as const;

/** Member `lifecycle` of fleet.directory_feed/1 under `accept: ["lifecycle"]`: the EFFECTIVE lifecycle. */
export const FEED_LIFECYCLES = ["not_started", "proposed", "active", "suspended", "leaving", "archived"] as const;
export type FeedLifecycle = (typeof FEED_LIFECYCLES)[number];
/** The `accept` value that asks for `lifecycle` and `floor`. */
export const FEED_ACCEPT_LIFECYCLE = "lifecycle" as const;
