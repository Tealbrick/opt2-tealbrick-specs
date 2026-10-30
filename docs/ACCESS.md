# ACCESS — `tb.access/1`, how a store reports and ends access for Governance

Status: v0.1.89 (C380), frozen at tag `spec-v0.1.89`. A change needs the Coordinator. Types: `packages/spec/src/access.ts` (`@opt2-tealbrick/spec/access`). Schemas: `packages/spec/schemas/contracts/access.*.schema.json`. Fixtures: `packages/spec/examples/contracts/access.*.json`. Obeys CORE, MANIFEST, BRIDGE. Not a manifest contract id: `CONTRACT_IDS` and the manifest schema do not change.

Doc `docs/ACCESS.md` in specs; schemas + fixtures byte-copied with sha256 to each target and Fleet. **Hard no: no new manifest field, no standard op.** Ops are `audience: "agent"`, `listing: "workflow"`, appended **last** in `operations`. Knowledge and Task Board run conformance on a `conformance.manifest.json` without them (Inbox precedent; result of the Kanban spike can change this before B6 starts).

```ts
// access_list: crud ["read"], effect "read", idempotency "none", receipt false
type Subject =
  | { kind: "agent"; id: AgentId }
  | { kind: "person"; id: string; handles: string[] } // Governance id; canonical handles, ≤ 16
  | { kind: "unlinked" }                              // items this target cannot tie to anyone
  | { kind: "all" };                                  // sweep; must be the only subject
interface ListIn  { v: 1; subjects: Subject[] /* 1..32 */; cursor?: string; limit?: number /* 1..200, default 100 */; sweepId?: string /* ≤ 64, echoed */ }
interface ListOut {
  v: 1; asOf: string; sweepId?: string;
  items: AccessItem[];
  nextCursor: string | null;                      // paging ONLY
  notShown: { kind: string; reason: string }[];   // kinds this version cannot list ONLY
  complete: boolean;                              // nextCursor === null && notShown is empty; nothing else
}
interface AccessItem {
  id: string;           // stable, "<kind>:<opaque>", ≤ 128
  kind: AccessKind;     // closed list per target, below
  subject: { kind: "agent" | "person"; id: string } | { kind: "unlinked" };
  resource: string;     // stable id of what is reached (account, routine, handle, area), ≤ 128, owner-side only
  direction: "held_by" | "about"; // about = others can reach the subject's things
  level: "read" | "write" | "use" | "info";
  label: string;        // ≤ 120, no content, no secret
  state: "active" | "paused" | "scheduled" | "dormant";
  revocable: boolean;
  since?: string;
  digest: string;       // "sha256:" + hex of JCS {v:1, target, id, kind, subject, resource, level}. NOT state, since, label, revocable, direction
}
// Fixture: same item, active then paused = equal digest.

// access_revoke: crud ["update"], effect "write", no holdFamily, idempotency "required", receipt true. Optional per target.
interface RevokeIn  { v: 1; plan: string; attempt: number; subject: { kind: "agent" | "person"; id: string };
                      items: { id: string; digest: string }[] /* 1..10; Connect 1..5 */ } // no free text
interface RevokeOut { v: 1; asOf: string; results: { id: string;
                      outcome: "revoked" | "already_gone" | "changed" | "not_revocable" | "failed";
                      code?: string; detail?: string }[] }
```

- **Key:** `pln_<id>:<target>:<batch>:<attempt>`. `attempt` is persisted before the call. A new attempt happens only after a fresh `access_list`, and sends only items still open, so `already_gone` covers a lost answer. A `held` step keeps its key until decided.
- **Guard, every target, shared vector of 6 caller cases in the spec fixture** (pattern `connect src/data/caller.ts`): type `app`, verified `caller.product === "fleet"`, `caller.listed === true`. Else `no_access` or `caller_unverified`.
- **Bind to Core (S2-6):** for an `agent` subject, account disconnect and routine pause need the target's own signed slice to show that agent `paused` or absent; else `not_revocable`, code `agent_running`. Fleet therefore cannot trigger them with no approved plan or Portal pause. Person-subject `team_grant` and `channel_sender` stay unbound: both reversible by the owner; accepted tonight, stated.
- **Sweep deletion rule:** Fleet may delete a shadow row only after a sweep with one `sweepId` reached `nextCursor: null`, and never for a kind in `notShown`. Page cap 50 per target. Items whose subject was not asked for are dropped. `complete: false` caused by `notShown` is a stated limit, not an error.

| Target, slot | Kinds | Revoke |
|---|---|---|
| Connect `0.7.14-dev.N` | `account_as_itself`, `account_as_me` (`unlinked`), `buzz_identity`, `scheduled_post`, `first_contacts` (info), `channel_sender` (person, per handle). `notShown`: held calls | Disconnect path (`app.ts:2019`), `cancelScheduled`, new `connect_sender_bars` |
| Knowledge `0.1.31-dev.N` | `agent_area`, `person_area`, `team_grant` (`about`, default unticked, screen says colleagues keep reading otherwise). `notShown`: scope rows, held calls | `access_grant_remove` logic, `kn_access_log`. Areas never touched |
| Task Board `0.1.17-dev.N` | `assignment`, `own_project` (info). `notShown`: project access, held calls | None (list-only target) |
| Evolution `0.4.3-dev.N` | `routine`, `workflow_agent_step`, `schedule_of_workflow`. `notShown`: held calls | `pauseAutomation` for `routine` only. Temporal is not in the revoke path |
| Core | No op. Paused: `agents[].status` in the signed slice, no consent. Edges and connections: step output via `owner_draft_get`; topology as a second view when consent is on and not `truncated` | §5 |

**Fleet's failure map** (one client `src/access/client.ts`: 1 call/s, concurrency 2, honours `Retry-After`, jitter):

| Answer | Step or read state |
|---|---|
| Product absent from `ctx.companionTargets()` or Fleet's manifest | `not_installed` ("Not installed": a plain fact, no warning) |
| `unknown_tool`, `companion_undeclared`, `no_grant`, 5xx, timeout | `not_read` ("Could not be read"). Never zero |
| `hook_denied` | `refused`, with the reason; `access_list` backs off 15 min |
| `held` | `waiting`, app named. `access_list` backs off 15 min. Never a new hold per tick |
| 409 `idempotency_outcome_unknown`, `idempotency_in_flight` | Re-list, new attempt |
| 409 `idempotency_conflict` | `failed`, code surfaced (a bug) |
| 403 `hold_denied` | `refused`; "Try again" takes a new attempt |
| 429 | Wait `Retry-After` |
| `failed` item | Re-list, new attempt on "Try again" or by job, max 6 |

**What an app can lie about:** it can hide items in its own store (items say "reported by <app>, <time>"; a clean list proves only that); it can claim revoke (Fleet re-lists; `still_listed` = failed); it cannot report for another target (stored under the verified target); text passes `cleanText`, plain render, owner only, never in an agent answer (C88).

**Compromised Fleet:** no widening. Can: stop agents through the floor (owner's "Clear" on Rules page), bar senders, remove team grants, ask for drafts. Cannot: disconnect accounts or pause routines of running agents. It is now the most sensitive app. Also a stop button if merely busy (F12): `fleet_facts` must answer under 200 ms during a sweep at caps; one transaction per page, `setImmediate` between pages.

## Binding details

- **Files are the contract.** Each target and Fleet copy these files byte for byte and check the sha256 below. The four `access.*` schemas have no `$id` and no `$schema`, so the same bytes go in a manifest op's `input` or `output` (M-OP-8). Dialect: JSON Schema 2020-12.
- **Input schemas are strict** (`additionalProperties: false`; no free text). **Output schemas ignore extra members** (L24).
- **`label` and `detail`:** the schema checks the length only. Fleet runs `cleanText` on them and renders plain text.
- **Guard refusal in Fleet's failure map.** `no_access` and `caller_unverified` on `access_*` = `not_read` ("Could not be read"). Never zero.
- **Guard vector.** `examples/contracts/access.caller_vector.1.json`, 6 cases. `caller.listed` is `true` only for an app the current signed slice lists; `false` or absent is `caller_unverified`. A person caller gets the agent answer.
- **Item ids** start with `<kind>:` and use ASCII with no spaces. `public_link` is a reserved kind name: no target lists it, and using it needs a contract change.
- **Batch.** `access_revoke` items: `ACCESS_REVOKE_ITEMS_MAX`. The schema allows 10. Connect refuses 6 or more with 400 `input_invalid`.
- **Idempotency key.** `pln_<id>:<target>:<batch>:<attempt>` fits the key rule `^[A-Za-z0-9._:-]{8,128}$`: `plan` is `^pln_[0-9A-Za-z]{1,40}$`.

## Feed members (`fleet.directory_feed/1`, `accept: ["lifecycle"]`)

Schema: `fleet.directory_feed.1.lifecycle.schema.json` (the base schema + optional `agents[].handles`, `lifecycle`, `floor`; the base file does not change). Fixture: `fleet.directory_feed.1.lifecycle.json`.

- **`lifecycle`** on `agents[]` and person `contacts[]`: the effective lifecycle, computed by Governance, never stored (`FEED_LIFECYCLES`: `not_started, proposed, active, suspended, leaving, archived`). Absent on outside agents.
- **`floor`** on `agents[]` and `contacts[]`: `true` when the effective lifecycle is `not_started, suspended, leaving` or `archived` (not migrated `no_card` rows), or trust is `blocked`.
- **A Governance that ignores `accept`** omits both, and the answer stays valid. A member with no `floor` is not an entry, but trust `blocked` still refuses as a recipient (DESIGN §9, Rules gate).
- **`status`** is derived and does not change meaning: `departed` for `proposed`, `leaving`, `archived`. A lean agent view shows `departed` from `archived` only.
- **Floor store.** A reader replaces its entries only in the same transaction as a full valid read. A refusal, an expiry, a crash or an `unchanged` answer never touches them.

## Stop drafts

Routes, cap and limits: PORTAL-API "v0.1.89", CORE "v0.1.89", BRIDGE §8.8, SDK-API "v0.1.89".

## Copy these files

| File | sha256 |
|---|---|
| `access.list_in.1.schema.json` | `83f1c2f7c2c399d8e11a93418e469d01c777af5f6c8bfe7cd2643539f3a04fe5` |
| `access.list_out.1.schema.json` | `571feb6b833d392f8eec3212b21d53aa7e529dfb65a34f8a54b89d07160c7f48` |
| `access.revoke_in.1.schema.json` | `edbe7c6b94ffb74e4dff0c3f986ccaa29e83d8d6fd1fa9f1e2986d2802e60c51` |
| `access.revoke_out.1.schema.json` | `b36b1c6474fc858daf93e2a4d9605067113937b984e8b26833fa13eae314d919` |
| `fleet.directory_feed.1.lifecycle.schema.json` | `35ebfd9f49eebeebc3c84a0ea686ab4efb18503953599828bdfd94f76734695f` |

Fixtures, same folder name under `examples/contracts/`: `access.list_in.1.json`, `access.list_out.1.json`, `access.revoke_in.1.json`, `access.revoke_out.1.json` (`valid`, `invalid` with `why`), `access.caller_vector.1.json`, `access.digest.1.json`, `fleet.directory_feed.1.lifecycle.json`.
