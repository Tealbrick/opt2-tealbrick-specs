# opt2 specs — PORTAL-API (route registry)

Status: v0.1, Lead · Specs, 2026-10-11 (v0 review items B1–B4, B6, B8, S1–S4, S6, N8, N10, N12, N13 applied). Machine-readable source of truth: `types/routes.ts` (`ROUTES`, `AUDIT_ACTIONS`, `REGISTRIES`, `RATE_CLASSES`, `TRANSPORTS`, every input/output interface). This file is the rule book and a compact index; where they disagree, `routes.ts` wins and this file is a spec bug (CORE §0).

Scope: every operation Portal Core exposes — to the Portal GUI (browser), the owner CLI / TBD human sign-in (owner native session), the workspace bridge, the device flow, and Stripe — plus the 15 Core registries that own the data those operations read and write, drafts/recipes, and the coverage of every journey action (SPEC-REVIEW-CHECKLIST §3). Out of scope: bridge-internal and app-internal routes (BRIDGE.md, SDK-API.md), credential formats and lifetimes (CREDENTIALS.md), manifest fields (MANIFEST.md). Core holds no tool traffic, no app data and no key values (PRD §7.2); §8 lists the ops that must not exist.

## 1. Conventions

### 1.1 Topology and exposure
| Rule | Statement |
|---|---|
| Base | Public base `https://<portal domain>/api/v1`. The path after `/api/v1` is identical at the gateway and at Core. |
| Core is private | Core listens only on the private network of Portal's own Railway project. The only caller is the Portal GUI's generated gateway. Core has no public domain. |
| Generated gateway | Core serves `GET /internal/routes` → `{digest, routes}` (`routes.list`, exposure `internal`). The GUI builds its ONE gateway handler from it at boot and re-reads it when Core's `TB-Routes-Digest` response header differs from the cached digest. No hand-written route table exists in the GUI. |
| Default deny | Core's router, validators, rate limiter and audit hooks are built from `ROUTES` only. A request that matches no row → `404 not_found` at the gateway and at Core. `exposure: "internal"` rows are never forwarded by the gateway. There is no passthrough prefix and no "safe because the gateway does not forward it" route. |
| Explicit public rows | Every unauthenticated path is its own row: `device.start` (public), `device.token` (device), `bridge_api.enrol` (public, one-time code in body), `stripe.webhook` (Stripe signature). Nothing else is reachable without a credential. |
| JSON only | Core returns JSON (plus one SSE stream, one long-poll, one zip download). No HTML, no static assets, no cookies, no passwords, no SSO (PRD §7.2). |
| Data store | Managed Postgres, one table set per registry (C7). |
| No home-infra | No row, default or example contains a host name, tailnet suffix, machine name or personal user name. Portal domain, release index URL and Stripe/Railway identifiers are deployment configuration, not registry content. |

### 1.2 Auth classes (each maps to one CREDENTIALS kind)
| `auth` | Credential | How it arrives | Principal resolved by Core |
|---|---|---|---|
| `browser` | K1 Clerk person session | Gateway reads the Clerk session and forwards `Authorization: Bearer <Clerk session JWT>`; gateway enforces same-origin on non-GET | account + person (account row created on first `account.me`) |
| `owner-cli` | K3 owner native session (`tbo_`, client `cli` or `tbd`) | `Authorization: Bearer tbo_…` | account + `osn` session id |
| `bridge` | K7 bridge assertion (`tb-bridge-assert+jwt`, CREDENTIALS §10) | `TB-Assert: <jws>` (never `Authorization`), `aud = tb:portal`, bound to method + URL (+ body digest), ≤ 60 s, verified with the bridge public key from the Instance Registry | bridge id → workspace |
| `device` | K2 device code | `device_code` in the body of `device.token` | device request |
| `public` | none | — | none (rate class `public_strict`) |
| `stripe-webhook` | Stripe signature | `Stripe-Signature` over the raw body, verified with the sealed webhook secret | Stripe |
| `host` (v0.1.58) | K13 host assertion (`tb-host-assert+jwt`, HOST.md §1) | `TB-Assert: <jws>`, `aud = tb:portal`, bound to method + URL (+ body digest), ≤ 60 s, verified with the host key pinned at pairing; only on `host.*` rows (RT9) | server id → workspace |

Rules:
- P1 (CORE §2): the Clerk token is accepted only on `browser` rows, only through the gateway. No row accepts a person credential and an agent credential. No agent credential (K4/K5) is accepted by any Portal row: agents talk to the bridge, never to Core (except the device flow, which carries no person credential).
- Owner native session (K3) may call only `GET` rows, `drafts.*` rows, and `owner_sessions.logout` (sign-out revokes server side); v0.1.64 (C326, C332): plus its own push device (`push_devices.*`, client `tbm`) and the allow-listed person-op relay (`person_ops.call`; write ops only for `tbm`). Every other mutation reaches Core from the CLI/TBD only as a draft step applied in the browser. Enforced at compile time (`InvariantOwnerCli`, `InvariantConfirm`, `InvariantOwnerCliNoSecrets` in routes.ts) and at run time by the router.
- K3 never carries a code, ticket or token in any output it can read (S1): no K3-reachable output is a `SecretBearingSchema` or has a top-level `code|ticket|device_code|user_code|access_token|session_token` field (compile-time check). K3 never obtains any K11 (B4): `tickets.launch` and `tickets.keys` are browser-only; TBD opens Portal launches in the system browser (K1). K3 idle timeout 24 h (`OwnerSession.idleExpiresAt`). Boundary: the OS user — a K3 on a machine where agents share the OS user is reachable by them through `tealbrick`, which is why K3 is harmless by construction (reads + drafts, no secrets) (CLI.md: keychain ACL with user presence, login warning when agent items exist).
- Workspace scoping: every `{ws}` path checks `ws.account = principal.account`; a foreign or unknown id → `404 not_found` (no existence leak). Licence ids, order ids, draft ids and session ids are checked the same way.

### 1.3 Row fields (see `RouteOp`)
| Field | Meaning |
|---|---|
| `opId` | `<area>.<verb>`, unique, stable; used by drafts, audit, CLI, generated client |
| `method`, `path` | `{name}` segments bind to the same-named input field |
| `auth[]` | allowed auth classes (§1.2) |
| `exposure` | `gateway` or `internal`; nothing else |
| `transport` | `json` (256 KB body, 15 s), `json_slow` (120 s: provider calls), `sse`, `longpoll` (75 s), `raw` (raw body kept for signature), `binary` (zip) — numbers in `TRANSPORTS` |
| `query[]` | allowed query keys; the gateway drops all others |
| `input`/`output` | name of an interface in routes.ts (`SchemaMap` makes a typo a type error). Input is flat: path params + query (GET) or body. JSON Schema for runtime validation is generated from these interfaces at freeze (`@opt2-tealbrick/spec`). |
| `rate` | rate class (`RATE_CLASSES`); the gateway and Core both apply it; `429 rate_limited` + `Retry-After` |
| `bodyLog` | `none` (no body content ever logged: codes, tokens, tickets, bridge documents, Stripe) or `meta` (field names + sizes only). Bodies are never logged verbatim; GlitchTip scrubbing uses the same rule. |
| `audit` | action id from `AUDIT_ACTIONS`, or null for reads |
| `draftable` | may appear as a draft step |
| `confirm` | shown as a confirm item in draft review (deploy, grants/edges, policy, money, agent create/revoke, licence moves); the one apply confirmation covers them all, EXCEPT a step that lowers protection: since v0.1.41 (G3 R1, F126) each such step is its own item (`Draft.loosening`) and needs its own tick (`confirmLoosening`). A direct browser call is itself the owner's action; the GUI shows its own confirm dialog for these. |
| `idempotent` | `Idempotency-Key` header required |
| `registry` | the one registry module that handles the op (§2) |

### 1.4 Errors
One envelope everywhere (CORE §8): `{ "error": { "code": "<snake_case>", "message": "...", "requestId": "...", "details"?: {…} } }` (`details` optional, e.g. `revision_conflict` carries `{currentRevision}`; `drafts.*` errors carry step issues). `message` is user-safe text the GUI may show. Codes are the `ErrorCode` union in routes.ts. Status mapping:

| Status | Codes |
|---|---|
| 400 | `bad_request`, `validation_failed`, `idempotency_key_required`, `draft_invalid`, `draft_op_not_draftable`, `draft_ref_invalid`, `draft_ref_money`, `recipe_not_portable`, `policy_invalid`, `authorization_pending`, `slow_down`, `access_denied`, `expired_token` (RFC 8628 codes, carried as `error.code`) |
| 401 | `unauthenticated`, `bridge_key_revoked`, `enrolment_code_invalid`, `stripe_signature_invalid`, `clerk_signature_invalid` (v0.1.4) |
| 402 | `licence_required` |
| 403 | `forbidden` (wrong auth class for the row), `account_disabled` (v0.1.4, C49), `mfa_required` (v0.1.32, C196), `access_restricted` (C328, Core additive) |
| 404 | `not_found` |
| 405 | `method_not_allowed` (known path, wrong method; v0.1.4, C46) |
| 409 | `conflict`, `revision_conflict`, `idempotency_conflict`, `licence_already_assigned`, `licence_not_active`, `workspace_paused`, `workspace_standalone`, `workspace_not_empty`, `bridge_not_ready`, `destination_in_use`, `deploy_in_progress`, `instance_exists`, `draft_state`, `terms_not_accepted` (v0.1.32, C196) |
| 413 / 429 | `payload_too_large` / `rate_limited` |
| 422 | `manifest_invalid`, `release_not_deployable`, `offer_unavailable` |
| 502 / 504 | `provider_unavailable`, `provider_reauth_required`, `provider_not_linked` (409 when no link), `checkout_failed` / `upstream_timeout` |
| 500 | `internal` |

### 1.5 Ids, paging, idempotency, revisions, streams
- Ids: CORE §1 prefixed ULIDs. Including `osn` (owner native session) and `lnk` (provider link). Product ids are manifest slugs. Provider destinations keep the provider's own id (opaque string).
- Paging: list rows that can grow take `cursor` + `limit` (default 50, max 200) and return `Page<T> = {items, nextCursor|null}`. Cursors are opaque. Short bounded lists (providers, harness options, hooks, connections, sessions) return `{items}`.
- Idempotency: rows with `idempotent: true` require `Idempotency-Key` (16–64 chars `[A-Za-z0-9_-]`). Core keeps `(principal, opId, key) → (input digest, response)` for 24 h. Same key + same input → the stored response; same key + different input → `409 idempotency_conflict` (same semantics as the SDK, CORE §13). Responses of `bodyLog: none` rows are never stored, so those rows are never `idempotent` (B8; `InvariantIdempotencyNoSecrets`, `InvariantSecretOutputs`): a one-time code never sits in the idempotency store.
- Revisions: `canvas.save`, `agents.policy_set` and `drafts.update`/`drafts.apply` carry the `revision` the client read; a stale value → `409 revision_conflict`; the client re-reads and re-applies (the GUI ports v1's rebase-on-conflict logic). `details.currentRevision` tells the client what to re-read.
- Config revisions: every op that changes what a bridge must enforce (edges, policy, pause, licence, connection/agent revoke, hooks, skills) bumps the workspace config revision in the same transaction and returns it (`configRevision`) where useful; the long-poll wakes at once (CORE §13 C9).
- SSE (`instances.progress`): `text/event-stream`; events `phase`, `log`, `done`, `error` (`DeployProgressEvent`); heartbeat comment every 15 s; `Last-Event-ID` resumes; the stream closes after `done`/`error` or 15 min. Core re-checks ownership on every tick, polls the provider adapter (2 s, backing off to 10 s), and passes logs through a redactor (enrolment codes and any value Core set as an env value are masked). Nothing from the stream is persisted except the deploy state.
- Long-poll (`bridge_api.config`): `after=<revision>&wait=<0..60>`; returns `200 application/jose` (the config JWS itself; slices inside `apps[].slice`) as soon as a newer revision exists, or `304` when `wait` elapses (C9).

## 2. The 15 registries (PRD §7.1) — one owner module, one record kind each
No registry stores a fact another registry owns; reads across registries go through the owner module. Product ids appear only as data. Note (N10): three registries own a child record kind besides their main one — Workspace (+ Account), Entitlement (+ Order), Consent (+ Draft). Each child exists only for its parent registry and no other module writes it; accepted for opt2 instead of three more registries.

| # | Registry (`registry`) | Owner module | Record kind | Key fields | Written by |
|---|---|---|---|---|---|
| 1 | Product (`product`) | `products` | Product | product id, kind `app\|bridge\|desktop`, name, current release per channel | release sync only (no route); `catalog.list` reads |
| 2 | Release (`release`) | `releases` | Release | `rel` id, product, version, channel `stable\|dev`, manifest digest + URL, image `ref@sha256`, artifact `{url, sha256}`, `upgradeFrom` (semver range), signature `kid` | release sync only; `releases.list`, `downloads.desktop` read |
| 3 | Manifest Store (`manifest`) | `manifests` | StoredManifest | release id, manifest digest, verbatim manifest JSON | release sync only |
| 4 | Offer (`offer`) | `offers` | Offer | `off` id, kind `single\|bundle`, products[], major, Stripe price id, amount, currency, tax behaviour, livemode, `verifiedAt` | offer sync only; `offers.list`, catalog read |
| 5 | Entitlement Ledger (`entitlement`) | `entitlements` | Licence (+ Order) | `lic` id, account, product, major, status, offer, order, assignment `{ws, assignedAt}\|null`, livemode | `licences.assign/unassign/move`, `checkout.create`, `stripe.webhook` |
| 6 | Workspace + Canvas Store (`workspace`) | `workspaces` | Workspace (canvas, edges, hook settings, skill overrides as children) | `ws` id, account, name, status, channel, infrastructure `{provider, destinationId}`, canvas revision + nodes, `edg` edges, hook enable flags, skill overrides; also the account row (`acc`/`per` ↔ Clerk user id) | `account.*`, `workspaces.*`, `canvas.save`, `edges.*`, `hooks.set`, `skills.override_*` |
| 7 | Agent Registry (`agent`) | `agents` | AgentCard (+ harness option data rows) | `agt` id, ws, name, purpose, harness option id, display-only `endpointLabel`, `createdBy owner\|app`, tombstone | `agents.create` (the ONE create path), `agents.update`, `agents.delete`; harness rows are seeded data |
| 8 | Agent Policy (`agent_policy`) | `policy` | AgentPolicy (+ workspace pause flag) | agent, revision, mode `free\|bound`, held families, caps, workflow ops, paused | `agents.policy_set`, `agents.pause/resume`, `workspaces.pause/resume` |
| 9 | Connection Registry (`connection`) | `connections` | AgentConnection | `con` id, agent, method `key\|pairing`, verifier (public key or pairing `jti`), client name, created, last seen, revoked | `device.approve` (key), `bridge_api.ack` (pairing), `connections.revoke`, `agents.delete` |
| 10 | Instance Registry (`instance`) | `instances` | Instance (deployment + registration in ONE record; `kind app\|bridge`) | `ins`/`brg` id, ws, product, release id, non-secret settings, provider refs (project, environment, service, volume ids), deploy state, claim state, instance (or bridge) public key, enrolment-code digest, health, last seen, key presence (bridge only), standalone flag | `instances.*`, `bridge_api.enrol/ack`, `workspaces.standalone` |
| 11 | Provider Registry (`provider`) | `providers` | ProviderLink (account level) + adapters | `lnk` id, account, provider key, method `oauth\|token`, sealed credential, account label, status | `providers.link_*`, `providers.destinations_create` |
| 12 | Credential Registry (`credential`) | `credentials` | CredentialRow (one table, `kind` column = CREDENTIALS kind) | kind, subject, digest (codes/opaque tokens) or `jti` (signed tokens), audience, expiry, used/revoked; sealed Portal signing keys | `device.*`, `agents.pairing_code`, `pairing.approve`, `bridge.enrolment_code`, `instances.register_own_infra`, `tickets.*`, `owner_sessions.*` |
| 13 | Consent Registry (`consent`) | `consent` | ConsentRecord + Draft | request subject (`drf`/`dev`/pairing jti), kind `draft_apply\|device_approval\|connect_approval`, requested by, decided by, decision, receipt `rcp` (digest of steps + results) | `drafts.*`, `device.approve/deny`, `pairing.approve` |
| 14 | Route Registry (`route`) | `routes` | RouteOp | this table (`ROUTES`), digest | build time only; `routes.list` reads |
| 15 | Audit Log (`audit`) | `audit` | AuditEvent | `aud` id, at, actor, action (`AUDIT_ACTIONS`), ws, subject, draft id, outcome, request id | every row with `audit ≠ null` (written by the router after the handler commits) |

### 2.1 Registry rules
- **Release Registry.** Releases are not in the Core image. Lead · Platform publishes a signed release index (Ed25519 JWS over JCS, key pinned in Core configuration as a public value) from `opt2-tealbrick-platform`; Core's release sync fetches it, verifies the signature, fetches each manifest from its URL, checks `manifestDigest`, validates it with `@opt2-tealbrick/manifest` `validateManifest()`, and writes Product, Release and Manifest Store rows in one transaction. The bridge and the desktop app are releases in the same index (`kind bridge|desktop`). v0.1.1: the index JWS has `typ: tb-release-index+jws`, claims `ReleaseIndexClaims` (types/credentials.ts: `iss tb:releases`, `aud tb:portal`, `schema opt2.release-index/v2`, `indexDigest` = digest of the index body, ≤ 180 d) (C30); index entries may carry `source {repo, ref, dockerfile}` on channel `dev` only — `stable` requires an image digest (C29); desktop entries carry `artifact {url, sha256}`, `minOs`, `notarized` (C24); v0.1.29 (C174): `cli` entries (the CLI tarball for the installer and `self-update`, C173) carry only `artifact {url, sha256, integrity}` on the public dist host, and Core does not index them; v0.1.30 (C181): `package` entries (relay, harness-claude, harness-eve library tarballs) have the same shape, and Core does not index them either. An instance points to a release id; "deployable" = latest release of the product on the workspace's channel whose `upgradeFrom` admits the current version.
- **Manifest Store.** Verbatim JSON + digest. Core reads only fields MANIFEST.md lists for Core (discovery, settings, keys, scopes, operations, hooks, companions, skills, ui, runtime resources) through the manifest package; it never interprets product-specific values and holds no copy of vocabulary literals (CORE §7).
- **Offer Registry.** Reviewed data shipped in the signed release index (`offers[]`, CORE I17), never environment variables. At sync Core verifies each Stripe price: active, one-time, amount and currency equal, `tax_behavior` set, `livemode` equals the Stripe key mode of the environment (opt2 = test). A failing offer is stored `available: false` and never offered. Channel is the release field; there is no channel switch elsewhere.
- **Entitlement Ledger.** One licence kind. A bundle payment creates one licence per product (`fromBundle: true`). Licences belong to the account; unassigned licences sit on the account.
  - `isEntitled(ws, product, major)` — the ONE function: true iff an `active` licence `L` exists with `L.product = product`, `L.major = major` and `L.assignment.ws = ws`. `major` is the major of the instance's release (for `instances.update`: of the target release). Used by: config builder (agent→app grants, companion grants, slice edge entries, hook activation), `tickets.launch`, `instances.update/rollback`, catalog overlay, `licences.unpaid`. Bridge and apps never check licences (CORE §6).
  - `assign(lic, ws)`: refused with `409 licence_already_assigned` if `ws` already has another active licence for `(product, major)`; `409 licence_not_active` if the licence is not active. `unassign(lic)`: clears the assignment. `move(lic, ws)`: unassign + assign in one transaction by licence id. Every change bumps the config revision of each affected workspace; the old workspace loses grants at its next revision (≤ 60 s for an online bridge, CORE §13 C9); its instance keeps running (open-source app; no Portal tools for it).
  - TODO(Martin): licence per major vs PRD "updates free while on licence" — a new major needs a new licence under this rule; until decided, state it in offer and website copy (N12).
  - Refund or dispute (Stripe webhook) sets `refunded|disputed` → `isEntitled` false at the next config revision.
- **Workspace + Canvas Store.** One revisioned canvas per workspace. Edge = `{kind, from, to.product, crud[], scopeType}` — CRUD plus one manifest-declared scope type, nothing else; `scopeSummary` is display-only text from the bridge ack (`tb.scope_summary`, CORE §13); v0.1.65 (C331 D8) `scopeSources` = the scope instances the agent may use (`ScopeSourceItem {type, id, label, access}` from the ack's `scopeSummaries[].sources`; `null` = not reported, `[]` = none assigned), display only, for the canvas source nodes. Agent→app edges are created by the owner (`edges.create`); app→app edges (companions) are created by Core from manifest `companions[]` when both apps are deployed, with `crud` ⊆ the declared ceiling; the owner can only disable/enable them (`edges.update {enabled}`). One instance per product per workspace (CORE §1), so edges target a product id.
- **Agent Registry.** One create path (`agents.create`, mode always `free`); `bound` cards are created by apps in a later wave through a consent request (Consent Registry kind reserved, no opt2 op). Audience format `tb:agt:<id>` (CORE §2) is derived, never stored. Harness options are data rows (seed migration), so the GUI owns no harness list.
- **Agent Policy.** Values only: mode, held families, caps, workflow, paused. The vocabulary (`free|bound`, effects, hold families) and validation come from `@opt2-tealbrick/manifest`. `money` must be in `held` (`422 policy_invalid` otherwise) and has no cap. Caps shape (CORE I14): `{write?, outward?, destructive?: {max, per: hour|day}}`. Defaults for a new Free card: write 500/hour, outward 30/hour, destructive 20/day; held families = `DEFAULT_HELD_FAMILIES` (`destructive`, `money`, `first_contact`; v0.1.15 C105 — imported from @opt2-tealbrick/manifest, never retyped). No standing grants (C8). Each change bumps `revision` → grants re-minted with the new `polrev`.
- **Connection Registry.** One row per agent connection, one verifier: `key` (K4 public key, from `device.approve`) or `pairing` (OAuth connector; pairing `jti`, reported by the bridge in `bridge_api.ack`; Core accepts it only if it issued that `jti` for that agent and bridge).
- **Instance Registry.** Deployment and registration are one record. Registration: an app instance (or companion service) gets a K6 code in its deploy env; it enrols with the bridge; the bridge reports a claim `{kind, ins, service?, publicKey, manifestDigest, version, internalUrl?, codeDigest}` in `bridge_api.ack` (the raw code never travels to Portal); Core matches the code digest to the record, stores the key, and flips claim state to registered. A bridge registers itself with `bridge_api.enrol`. Re-enrolment replaces the bridge key; Core refuses the old key at once (`401 bridge_key_revoked`).
- **Provider Registry.** One adapter interface, provider names only inside adapters: `linkStart`, `linkComplete`, `linkToken`, `verify`, `listDestinations`, `createDestination(name|random)`, `estimate(resources)`, `deploy(plan)`, `observe(refs, cursor)`, `update(refs, plan)`, `remove(refs)`. Railway adapter per C3: OAuth app (`workspace:admin offline_access`), refresh token sealed (AES-256-GCM) and rotated + re-sealed on every use; fallback pasted workspace token (sealed); no project tokens; one link per account serves many workspaces; destination chosen per workspace. No Coolify adapter (C308, Openship is the own-server engine; own servers are the `own_infra` option, HOST.md). Own infrastructure is not a deploy provider: own-infra bridge and neighbour enrolment are live under the GUI's "Advanced" panel (`bridge.enrolment_code`, `instances.register_own_infra`; CORE I16). Core writes no Portal credential into customer projects: the deploy env carries only the one-time K6 code and public values (`TB_PORTAL_KEYS`, Portal origin).
- **Credential Registry.** The table behind CREDENTIALS.md: device requests (device code + user code as digests), owner native sessions (`tbo_` digest), pairing codes and tickets (issued `jti` + expiry), enrolment codes (digest, one-time, ≤ 24 h, target `bridge|instance`), Portal signing keys (sealed). Revocation is a row update plus a config revision.
- **Consent Registry.** Generic request → decision → receipt. opt2 kinds: `draft_apply`, `device_approval`, `connect_approval` — Core-owned kinds, none product-named. App-originated requests (next wave, e.g. an app asking to create a bound agent) use kind `app_request` with vocabulary from the requesting app's manifest; no opt2 op.
- **Audit Log.** Actions only from `AUDIT_ACTIONS`. Append-only. No code path reads audit rows to decide behaviour (state lives in the owning registry).

## 3. Drafts and recipes (owner self-setup)
- A draft = `{ws?, title, steps[]}`; each step `{opId, input}` where `opId` is a `DraftableOpId` (derived from `ROUTES` rows with `draftable: true`) and `input` validates against that op's input schema. Any string value may be `{"$ref": "#/steps/<n>/output/<json-pointer>"}` to an EARLIER step's output (CORE §13); a forward ref or a ref into a money step → `400 draft_ref_invalid` / `draft_ref_money`. ≤ 100 steps. JSON only (C11: no files).
- Who: the owner native session creates/updates/validates/submits (`drafts.create/update/validate/submit`, `drafts.import`); `drafts.validate` (CORE I18, read-class, not draftable) checks every step against the route table and current state (ownership, licences, ids, `$ref`s) without applying and returns `{valid, revision, issues[]}`; `drafts.submit` returns `reviewUrl` (GUI page). Only a browser session can `drafts.apply` or `drafts.reject`.
- States: `open → submitted → applying → applied | failed`; `rejected` from open/submitted. `drafts.update` is allowed in `open|submitted|failed`, bumps `revision`, and returns the draft to `open`.
- Review: `drafts.get` returns each step with a Core-rendered one-line `summary`, `effect` (`write|destructive|money`), `confirm` flag (from the row), plus `confirmCount` and `requiresPurchase`. Inputs cannot contain secrets: no draftable op accepts a key value, token or code.
- Apply (`drafts.apply {revision, confirm: true, confirmLoosening?}`, `Idempotency-Key`): ONE owner confirmation covers every confirm step (deploy, edges, policy, money, agent create/revoke, licence moves) that does NOT lower protection. Every step that lowers protection (v0.1.41, G3 R1: hold family off, cap raised/removed, bound card freed or workflow widened, hook off, write grant added, op-limited grant widened, write connection on, paused card resumed) is listed in `Draft.loosening` (before → after, recomputed by Core on every read) and must be named in `confirmLoosening`, one tick per item; otherwise 400 `validation_failed` reason `loosening_unconfirmed`. Only a person principal applies a draft with loosening items (403 `forbidden` otherwise). Steps run in order through the same handler as a direct browser call, as the browser principal, each with idempotency key `<drf>:<revision>:<n>` (re-applying after a fix never repeats a successful step). The first failure stops the run (`failed`, later steps `skipped`). Each executed step writes `draft.apply_step` audit rows with the draft id; the run writes one Consent record (`draft_apply`) with receipt `rcp`.
- Money: a `checkout.create` step never charges. Apply creates the order (`assignTo` = the draft's workspace), marks the step `handed_off`, and returns `checkout: {orderIds, url}` where `url` opens the GUI pay-pill flow; payment then lands through `stripe.webhook`, which auto-assigns the new licence to `assignTo`.
- Recipes: `drafts.export` → `Recipe {format: "tealbrick.recipe/1", title, description, steps}` with `ws` stripped from every step; any other concrete id that is not a `$ref` → `400 recipe_not_portable`. `drafts.import {ws?, recipe}` creates a new `open` draft (fills `ws`). Recipes for verticals are such JSON files; Core stores no recipe library (no env-var or vendored recipes).

## 4. Op index (100 rows; details in `ROUTES`)
Auth: B = browser, O = owner native session, pub = public, dev = device, brg = bridge, stripe = Stripe signature. Flags: D = draftable, C = confirm, I = Idempotency-Key. Paths are relative to `/api/v1` except `/internal/*` (Core private network only).

| opId | Method + path | Auth | Flags | Registry |
|---|---|---|---|---|
| `account.me` | GET `/me` | B,O | - | workspace |
| `account.set_current_workspace` | PUT `/me/current-workspace` | B | - | workspace |
| `workspaces.list` | GET `/workspaces` | B,O | - | workspace |
| `workspaces.create` | POST `/workspaces` | B | DI | workspace |
| `workspaces.get` | GET `/workspaces/{ws}` | B,O | - | workspace |
| `workspaces.update` | PATCH `/workspaces/{ws}` | B | D | workspace |
| `workspaces.delete` | DELETE `/workspaces/{ws}` | B | - | workspace |
| `workspaces.set_infrastructure` | PUT `/workspaces/{ws}/infrastructure` | B | DC | workspace |
| `workspaces.cost_estimate` | GET `/workspaces/{ws}/cost-estimate` | B,O | - | provider |
| `workspaces.pause` | POST `/workspaces/{ws}/pause` | B | - | agent_policy |
| `workspaces.resume` | POST `/workspaces/{ws}/resume` | B | - | agent_policy |
| `workspaces.standalone` | POST `/workspaces/{ws}/standalone` | B | - | instance |
| `providers.list` | GET `/providers` | B,O | - | provider |
| `providers.link_start` | POST `/providers/{provider}/link/start` | B | - | provider |
| `providers.link_complete` | POST `/providers/{provider}/link/complete` | B | - | provider |
| `providers.link_token` | POST `/providers/{provider}/link/token` | B | - | provider |
| `providers.link_get` | GET `/providers/{provider}/link` | B,O | - | provider |
| `providers.link_delete` | DELETE `/providers/{provider}/link` | B | - | provider |
| `providers.destinations_list` | GET `/providers/{provider}/destinations` | B,O | - | provider |
| `providers.destinations_create` | POST `/providers/{provider}/destinations` | B | DI | provider |
| `harness.options` | GET `/harness-options` | B,O | - | agent |
| `agents.list` | GET `/workspaces/{ws}/agents` | B,O | - | agent |
| `agents.create` | POST `/workspaces/{ws}/agents` | B | DCI | agent |
| `agents.get` | GET `/workspaces/{ws}/agents/{agt}` | B,O | - | agent |
| `agents.update` | PATCH `/workspaces/{ws}/agents/{agt}` | B | D | agent |
| `agents.delete` | DELETE `/workspaces/{ws}/agents/{agt}` | B | DC | agent |
| `agents.instructions` | GET `/workspaces/{ws}/agents/{agt}/instructions` | B,O | - | agent |
| `agents.pairing_code` | POST `/workspaces/{ws}/agents/{agt}/pairing-codes` | B | - | credential |
| `pairing.connect_request` | GET `/pairing/connect-request` | B | - | credential |
| `pairing.approve` | POST `/pairing/approve` | B | - | credential |
| `agents.policy_get` | GET `/workspaces/{ws}/agents/{agt}/policy` | B,O | - | agent_policy |
| `agents.policy_set` | PUT `/workspaces/{ws}/agents/{agt}/policy` | B | DC | agent_policy |
| `agents.pause` | POST `/workspaces/{ws}/agents/{agt}/pause` | B | D | agent_policy |
| `agents.resume` | POST `/workspaces/{ws}/agents/{agt}/resume` | B | DC | agent_policy |
| `connections.list` | GET `/workspaces/{ws}/agents/{agt}/connections` | B,O | - | connection |
| `connections.revoke` | DELETE `/workspaces/{ws}/agents/{agt}/connections/{con}` | B | DC | connection |
| `device.start` | POST `/device/authorize` | pub | - | credential |
| `device.token` | POST `/device/token` | dev | - | credential |
| `device.lookup` | POST `/device/lookup` | B | - | credential |
| `device.approve` | POST `/device/approve` | B | - | credential |
| `device.deny` | POST `/device/deny` | B | - | credential |
| `catalog.list` | GET `/catalog` | B,O | - | product |
| `releases.list` | GET `/products/{product}/releases` | B,O | - | release |
| `offers.list` | GET `/offers` | B,O | - | offer |
| `canvas.get` | GET `/workspaces/{ws}/canvas` | B,O | - | workspace |
| `canvas.save` | PUT `/workspaces/{ws}/canvas` | B | D | workspace |
| `edges.create` | POST `/workspaces/{ws}/edges` | B | DCI | workspace |
| `edges.update` | PATCH `/workspaces/{ws}/edges/{edg}` | B | DC | workspace |
| `edges.delete` | DELETE `/workspaces/{ws}/edges/{edg}` | B | DC | workspace |
| `hooks.list` | GET `/workspaces/{ws}/hooks` | B,O | - | workspace |
| `hooks.set` | PATCH `/workspaces/{ws}/hooks/{ins}/{hookId}` | B | DC | workspace |
| `instances.list` | GET `/workspaces/{ws}/instances` | B,O | - | instance |
| `instances.deploy` | POST `/workspaces/{ws}/instances` | B | DCI | instance |
| `instances.get` | GET `/workspaces/{ws}/instances/{ins}` | B,O | - | instance |
| `instances.progress` | GET `/workspaces/{ws}/instances/{ins}/progress` | B,O | - | instance |
| `instances.retry` | POST `/workspaces/{ws}/instances/{ins}/retry` | B | I | instance |
| `instances.cancel` | POST `/workspaces/{ws}/instances/{ins}/cancel` | B | - | instance |
| `instances.update` | POST `/workspaces/{ws}/instances/{ins}/update` | B | DCI | instance |
| `instances.rollback` | POST `/workspaces/{ws}/instances/{ins}/rollback` | B | DCI | instance |
| `instances.remove` | POST `/workspaces/{ws}/instances/{ins}/remove` | B | DC | instance |
| `instances.register_own_infra` | POST `/workspaces/{ws}/instances/own-infra` | B | - | instance |
| `bridge.get` | GET `/workspaces/{ws}/bridge` | B,O | - | instance |
| `bridge.deploy` | POST `/workspaces/{ws}/bridge/deploy` | B | DCI | instance |
| `bridge.progress` | GET `/workspaces/{ws}/bridge/progress` | B,O | - | instance |
| `bridge.enrolment_code` | POST `/workspaces/{ws}/bridge/enrolment-code` | B | - | credential |
| `keys.status` | GET `/workspaces/{ws}/keys` | B,O | - | instance |
| `tickets.keys` | POST `/workspaces/{ws}/tickets/keys` | B | - | credential |
| `tickets.launch` | POST `/workspaces/{ws}/tickets/launch` | B | - | credential |
| `licences.list` | GET `/licences` | B,O | - | entitlement |
| `licences.assign` | POST `/licences/{lic}/assign` | B | DC | entitlement |
| `licences.unassign` | POST `/licences/{lic}/unassign` | B | DC | entitlement |
| `licences.move` | POST `/licences/{lic}/move` | B | DC | entitlement |
| `licences.unpaid` | GET `/workspaces/{ws}/unpaid` | B,O | - | entitlement |
| `checkout.create` | POST `/checkout` | B | DCI | entitlement |
| `checkout.get` | GET `/orders/{ord}` | B | - | entitlement |
| `stripe.webhook` | POST `/stripe/webhook` | stripe | - | entitlement |
| `skills.get` | GET `/workspaces/{ws}/skills` | B,O | - | workspace |
| `skills.override_put` | PUT `/workspaces/{ws}/skills/overrides/{skillKey}` | B | D | workspace |
| `skills.override_delete` | DELETE `/workspaces/{ws}/skills/overrides/{skillKey}` | B | D | workspace |
| `skills.pack` | GET `/workspaces/{ws}/skills/pack` | B,O | - | workspace |
| `downloads.desktop` | GET `/downloads/desktop` | B | - | release |
| `owner_sessions.list` | GET `/owner-sessions` | B,O | - | credential |
| `owner_sessions.revoke` | DELETE `/owner-sessions/{osn}` | B | - | credential |
| `owner_sessions.logout` | POST `/owner-sessions/logout` | O | - | credential |
| `drafts.list` | GET `/drafts` | B,O | - | consent |
| `drafts.create` | POST `/drafts` | B,O | I | consent |
| `drafts.get` | GET `/drafts/{drf}` | B,O | - | consent |
| `drafts.update` | PUT `/drafts/{drf}` | B,O | - | consent |
| `drafts.submit` | POST `/drafts/{drf}/submit` | B,O | - | consent |
| `drafts.validate` | POST `/drafts/{drf}/validate` | B,O | - | consent |
| `drafts.apply` | POST `/drafts/{drf}/apply` | B | CI | consent |
| `drafts.reject` | POST `/drafts/{drf}/reject` | B | - | consent |
| `drafts.export` | GET `/drafts/{drf}/recipe` | B,O | - | consent |
| `drafts.import` | POST `/recipes/import` | B,O | I | consent |
| `audit.list` | GET `/audit` | B,O | - | audit |
| `bridge_api.enrol` | POST `/bridge/enrol` | pub | - | instance |
| `bridge_api.config` | GET `/bridge/config` | brg | - | instance |
| `bridge_api.ack` | POST `/bridge/ack` | brg | - | instance |
| `routes.list` | GET `/internal/routes` | pub | - | route |
| `system.health` | GET `/internal/health` | pub | - | route |
## 5. Op semantics (what the table cannot say)

### 5.1 Account, workspaces, onboarding
- `account.me` creates the account + person row on first call from the Clerk user id (no Clerk webhook row exists). `firstSignIn = true` while the account has no workspace → GUI shows "new here, create workspace".
- `workspaces.get` returns derived `onboarding` flags (infrastructure linked, agent added, agent authorised, app placed); the overlay needs no extra op. `workspaces.delete` → `409 workspace_not_empty` while instances exist. A standalone workspace is read-only in Portal (`409 workspace_standalone` on every mutation).
- `workspaces.pause` is the workspace kill switch: sets the pause flag, bumps the config revision; the bridge refuses every agent and app→app call at its next revision (CREDENTIALS pause matrix). Not draftable (immediate, browser only).
- `workspaces.standalone {confirmName, ownerKey}` (type the workspace name; paste the public owner key from `tealbrick standalone owner-key`, CREDENTIALS §17): Core signs a final config naming `standalone = {issuer: tb:brg:<id>, kid, ownerKeys: [ownerKey]}` (CORE §4) with `portalKeys` emptied; afterwards Core mints nothing for this workspace. Licences stay on the account and can be moved.

### 5.2 Infrastructure (provider link per account, destination per workspace)
`providers.list` (Railway available; own server `own_infra` per HOST.md) → `providers.link_start` (`authorizeUrl` + referral `signupUrl`, `state` bound to the session) → Railway redirects the browser to a GUI page that calls `providers.link_complete {code, state}` (there is no Core callback path) → or fallback `providers.link_token` → `providers.link_get` (verify: linked, account label, status) → `providers.destinations_list` / `providers.destinations_create {name}|{random:true}` (Core generates the random name) → `workspaces.set_infrastructure`. `workspaces.cost_estimate?products=` sums the adapter estimate of each product's manifest `runtime` resources (+ the bridge if not deployed) with a dated basis; the catalog carries the same estimate per entry.

### 5.3 Agents and connections
- `harness.options` rows (EXAMPLE data, not code) drive "I have an agent" (desktop: TBD, Claude Desktop, Codex desktop; agentic system: Eve, Claude Code, the tealbrick command line; other via URL; `endpointLabel` on the card is display-only, N8) and "I do not have an agent" (`noAgentPath` → `downloads.desktop`). `authorise`: `device_approval` (key connection: TBD, CLI agent mode, kits), `instruction_set` (OAuth connector: Claude Desktop / Codex desktop), `url` (generic MCP harness: MCP URL + pairing code).
- Key connection (CORE §9; wire = `DeviceStartAgentInput`, `DeviceAgentTokenResult`): the agent machine calls `device.start {scope: "agent", client_id, machine_label, harness, agents: [{agt?, public_key}] (1..64, S4)}` → the owner opens `verification_uri_complete` (or types the user code) → `device.lookup {userCode}` returns that ONE request (no unfiltered list, no clear user code; B2) → agent approval screen: pick the workspace and one agent card per key → `device.approve {userCode, ws, agents: [{index, agt}]}` (digest match; 5 wrong codes per 10 min per account) → Core writes one Connection row per pair (`method key`) and one Consent record; the next config carries them → the `device.token` poll returns `DeviceAgentTokenResult` (connections, `mcp_url`, `token_endpoint`; no token: each agent signs a K4 assertion at the bridge). One request + one click covers 15–16 agents on one machine (J3). TBD's agent uses exactly this path.
- OAuth connector, two equal routes (C4): (a) copy-paste: `agents.instructions` renders steps with `{{pairingCode}}` and `agents.pairing_code` fills it; (b) "Approve in Portal": the bridge's authorize page form-POSTs the browser to the GUI page `https://<portal>/pair` with a pairing state proof (`tb-pair-state+jwt`, K7-signed: request id `rid`, return URL `<bridge>/oauth/pair/callback`, `aud tb:portal`, ≤ 600 s; BRIDGE §6.2, CREDENTIALS); the GUI calls `pairing.connect_request` (Core verifies the signature with the stored bridge key and checks that the bridge's workspace belongs to the caller's account, else `404` — these paths have no `{ws}`; S3), the screen shows the `redirectHost` and the client name marked "unverified" (S3), the owner picks a card (or creates one first with `agents.create`), `pairing.approve {state, agt}` mints a fresh K2b and returns a `FormPostRedirect` (`code` in the form body, never in a URL) the GUI auto-submits to the bridge callback; no bridge→Portal server call. Either way the bridge redeems the code offline and reports the new `con` in its next ack.
- `agents.delete` revokes every connection of the card, drops its edges and grants at the next config revision, tombstones the card. `connections.revoke` drops one connection.
- `agents.policy_set` (mode, held, caps, workflow) and `agents.pause/resume` bump policy revision + config revision.

### 5.4 Owner native session (owner CLI and TBD human sign-in)
`device.start` with `DeviceStartOwnerInput {scope: "owner", client_id: "tealbrick-cli"|"tbd", machine_label}` (no key; `kit` can never ask for `owner` — B3; Core refuses any other combination) → `device.lookup {userCode}` → the OWNER approval screen (different from the agent screen) says "this signs in a tool AS YOU — never approve for an agent" → `device.approve {userCode}` → `device.token` returns `DeviceOwnerTokenResult` (`tbo_` K3, idle 24 h for `cli`, 7 d for `tbd` since v0.1.53, C289). Same limits for both clients: reads + `drafts.*` + `owner_sessions.logout`. `owner_sessions.list` shows client kind; `owner_sessions.revoke` (browser) or `owner_sessions.logout` (self) revoke server side at once. Agents keep working: no agent credential derives from K3 (CORE §9).

v0.1.53 (C289): the owner `DeviceToken.expires_in` is the idle limit of the session created: `LIFETIME_S.ownerTbdSessionIdle` (604800) for `client_id: "tbd"`, `LIFETIME_S.ownerCliSessionIdle` (86400) for `tealbrick-cli`. The STORED `owner_sessions.client` decides (Core stores `tbd` for client_id `tbd`, `cli` for everything else), both at creation and for the slide: each authenticated use slides `idle_expires_at` by that per-client value, capped at the session's absolute `expires_at`. The Sessions page shows each session's client, machine label, `lastUsedAt` and `idleExpiresAt`; revoke there, `owner_sessions.logout` and account disable end it at once.

### 5.5 Catalog, canvas, deploy (licence is the LAST step — R4)
- `catalog.list[?ws=]` returns every deployable app built only from Product + Release + Manifest + Offer rows (no app list anywhere else): slug, name, category, summary, description, icon (manifest `svgPath`/`viewBox`, validated by the manifest schema), intents + keywords (GUI search index; GUI adds its own action intents), release, operations (id, title, crud, effect), offers (with `taxNote` "tax added at checkout"), `deploySteps` from manifest `settings.steps` (fields with choices, e.g. engine) and key requirements WITHOUT values, scope types (labels for the canvas line), `hasConfigureUi` + `configurePath` (manifest `ui`), skill names, companions, cost estimate. With `ws`: overlay `licence none|unassigned_available|assigned`, `deployment absent|deploying|running|failed|needs_keys|update_available`, instance + release ids, `onCanvas`, `pendingHolds` (count only, from the bridge status report → canvas badge; double-click opens the app's holds; TBD shows the same counts; S2). The response `digest` lets the GUI cache it.
- Canvas: `canvas.save` stores node placement (agents, placed apps, deployed or not) with `revision`. Edges and hooks have their own ops.
- The bridge deploys at onboarding step 1 (B1): `workspaces.set_infrastructure` runs `bridge.deploy` as its last phase (K6 in the bridge env; progress on `bridge.progress`, SSE). `bridge.deploy` is also its own op (draftable, confirm) to redeploy a missing bridge. So the bridge exists before "add agent → authorise" and before any app popup asks for keys.
- `instances.deploy {product, releaseId?, settings}` requires an online bridge (`409 bridge_not_ready`). Phases: provision → image → start → register (instance enrols via the bridge, reported in ack) → health → ready. Non-secret settings only; they reach the app only as env at (re)deploy, never in the slice (S6); key requirements are satisfied on the bridge key page.
- Deploy does NOT require a licence. Unpaid state, exactly: the app may be deployed and the agent→app edge drawn while no licence is assigned; Core then mints NO grant, NO slice edge entry, NO launch ticket and activates NO hook for that app; the edge shows `grantState: "unlicensed"`; the overlay reports `licence: none` with `deployment: running`; `licences.unpaid` counts it → the GUI shows the glowing pay pill. `checkout.create` is the last deploy step; when `stripe.webhook` lands the payment, the licence is created and assigned (`assignTo`), and the next config revision carries the grants.
- `instances.update {releaseId?, settings?}` (a settings change redeploys, S6) and `instances.rollback` require `isEntitled` (`402 licence_required`; updates are free while licensed). `instances.remove {deleteData}` (confirm; CORE I15): `deleteData: false` (default) stops the services and keeps volumes and backups; `true` also deletes them. Core never deletes customer data implicitly. The record goes `removed`; removing the last app does not remove the bridge.
- `instances.get` / `instances.list` = status + health (from the bridge ack), `missingKeys`, `updateAvailable`, `licensed`. `bridge.get` shows bridge state (`absent|deploying|awaiting_enrolment|online|offline|standalone`), MCP URL, last seen, acked revision ("Portal reachable" lease is informational).
- `hooks.list` / `hooks.set`: subscriptions resolved from deployed + licensed manifests; owner may disable each (CORE §13).
- Own infrastructure: `instances.register_own_infra {product}` issues a K6 for one neighbour instance (shown once, with the env lines); `bridge.enrolment_code` issues a K6 for a bridge (first own-infra bridge, or re-enrolment).

### 5.6 Keys and person tickets (no key value through Portal)
- `keys.status`: per requirement name `{set: true|false|null}` from the latest bridge ack; `bridgeReady: false` until the bridge enrols (it deploys at onboarding step 1). The GUI labels source `account_default` as "workspace default keys" (N13: they live in each workspace's bridge, so a second workspace asks again).
- `tickets.keys {names?, returnTo?}` → `{url, ticket, expiresAt}`: K11 `pur: keys`, `aud` = this bridge; `url` = the bridge key page on the keys origin, `<TB_KEYS_PUBLIC_URL>/keys` (v0.1.10, C59; path owned by BRIDGE.md). `409 bridge_not_ready` before enrolment.
- `tickets.launch {product, path?}` → K11 `pur: launch`, `aud` = the instance, url `https://<bridge>/a/<product>/tb/launch` (form POST, CORE §13). Requires `isEntitled` (`402`), instance running, bridge online.
- No row accepts a key value. The only secret inputs any row takes are provider credentials Core itself needs (`providers.link_token`, OAuth `code`) — sealed at once, `bodyLog: none`.

### 5.7 Commerce (Stripe TEST in opt2)
`offers.list` → `checkout.create {offerId, ws?, returnPath}` (Stripe Checkout Session, mode `payment`, automatic tax so tax is added on top, `client_reference_id` = order id, idempotency key = order id) → `checkout.get` (poll after return) → `stripe.webhook` handles `checkout.session.completed|async_payment_succeeded` (verify session ↔ order: livemode, mode, reference, currency, amount; create licences, auto-assign to `assignTo` if free), `…async_payment_failed|expired` (order failed/expired), `charge.refunded|charge.dispute.created` (licence `refunded|disputed`). Events are de-duplicated by event id. `licences.unpaid` feeds the pay pill.

### 5.8 Skills
`skills.get[?agt=]` renders the workspace bundle from deployed apps' manifest skills + per-workspace overrides (`edited`, `generatedDigest`); with `agt`, agent variables are filled. `skills.override_put {body, baseDigest}` (`409 revision_conflict` if the generated file changed) / `skills.override_delete` (revert). `skills.pack` = zip of the same render. The bundle digest goes into the config; the bridge serves skills to MCP agents (BRIDGE.md).

### 5.9 Bridge-facing rows (outbound only from the customer side)
- Payload types are imported from `types/bridge.ts` (BRIDGE.md owns them, CORE I6): `EnrolRequest`, `EnrolResponse`, `ConfigPullQuery`, `StatusReport`. The raw K6 appears in exactly two places: the owner-facing issuance response (`EnrolmentCode`, shown once to paste into an env) and the bridge's own redemption body (`bridge_api.enrol`); acks and status reports carry digests only.
- `bridge_api.enrol {code, publicKey, version, sdkMajors, form, publicOrigin}` → `{bridgeId, workspaceId, portalKeys, configPath, ackPath, waitMaxS: 60}`. Code one-time (digest match, ≤ 24 h). Portal key set travels only here, in deploy env, and in signed documents: there is no JWKS route.
- `bridge_api.config?after&wait` → `200 application/jose` = the config JWS (`tb-config+jws`, instance slices inside `apps[].slice`), or `304`. Document shape: `workspace-config.schema.json`.
- `bridge_api.ack` = `StatusReport`: applied `rev`, bridge identity/version, app states and health, key presence booleans, scope summaries (bridge op `scope_summary`), connections created (method `pairing`, with pairing `jti`) and revoked, claims (with `codeDigest`), rejection counters. Core answers `{accepted, configRevision}`; recorded connections and claims come back in the next config. Not audited per call (high volume); the registrations and connections it creates are (`instance.registered`, `connection.create`).

## 6. Ops that must NOT exist (and are absent)
| Must not exist | Why (PRD §7.2, BOUNDARIES §9, WEB rules) |
|---|---|
| Tool execution / forwarding (MCP `tools/call`, hosted MCP endpoint, "execute" of any connector) | Portal never sees a tool call; agents reach apps through the bridge |
| Connector, channel or broker ops (third-party connector link/execute, MCP OAuth client, bot tokens, channel links, account connections) | Outside connectivity is an app's job (the connectivity miniapp), reached through the bridge |
| Relay / local-exec / frames / hosted call queues | No tool traffic through Portal. Exception v0.1.64 (C326): the person-op relay for allow-listed person ops of native owner sessions (v0.1.64 B); never agent or tool traffic |
| Fleet, teams, memberships, daemons, peers, admin/staff routes, invites, SSO, password login | No organisation plane, no self-hosted identity |
| Rooms / sessions index / chat previews / chat tokens | Desktop is not a second control plane |
| App data (partitions, areas, connected accounts, consents of apps, receipts, holds, approvals "waiting" view) | Apps own their data, holds and receipts. v0.1.64: the relay passes allow-listed person-op answers through without storing them (sealed in flight, wiped at the end) |
| Any op that accepts, returns or reveals an app key value (env reveal, apply-env, key upload) | Option B: keys live in the bridge key store |
| Grant introspection / online grant check / grant redeem | Grants are verified locally (CORE §6) |
| Generic passthrough prefixes, legacy aliases, version-negotiation headers | Default deny, one version |
| JWKS / OpenID discovery for agents | No agent auth at Portal |
| Agent-facing endpoints of any kind other than the device flow | Agents talk to the bridge |
| Product-named routes (`/<product name>/*`) | Product ids are data |

## 7. Coverage matrix (SPEC-REVIEW-CHECKLIST §3)
| Journey line | Op id(s), or owner of a non-Portal step |
|---|---|
| **J1** Clerk sign-in (Google/GitHub); first sign-in "new here, create workspace"; create workspace | Clerk hosted sign-in (GUI, K1); `account.me` (`firstSignIn`); `workspaces.create`; `account.set_current_workspace` |
| J1 Railway: authorise, verify, destination (existing / new name / random); bridge deployed | `providers.list`, `providers.link_start`, `providers.link_complete`, `providers.link_token`, `providers.link_get`, `providers.destinations_list`, `providers.destinations_create {name}\|{random}`, `workspaces.set_infrastructure` (runs `bridge.deploy`, progress `bridge.progress`), `workspaces.cost_estimate` |
| J1 Add agent: "I have an agent" (TBD / Claude Desktop / Codex desktop; Eve / other via URL) and "I do not have an agent" (download TBD) | `harness.options` (`kind`, `authorise`, `noAgentPath`); `downloads.desktop` |
| J1 Create agent card (name, purpose, harness, Free default); card on canvas | `agents.create` (mode `free`); `canvas.get`, `canvas.save` |
| J1 Authorise agent: TBD device approval one click; Claude/Codex instruction set; connection credential issued | TBD: `device.start` (`scope agent`) → `device.lookup` → `device.approve` → `device.token` (needs the bridge from `bridge.deploy`); Claude/Codex: `agents.instructions` + `agents.pairing_code`, or `pairing.connect_request` + `pairing.approve`; connection row via `device.approve` / `bridge_api.ack`; K5 issued by the bridge (BRIDGE.md) |
| J1 Catalog search by intent; drag app; tether agent→app (CRUD + scope) | `catalog.list` (intents, keywords; GUI builds the index); `canvas.save`; `edges.create {crud, scopeType}` |
| J1 Deploy app: popup steps (keys, engine; next/previous), start, progress/status, verify; enrolment code to bridge | `catalog.list` (`deploySteps`, `keyRequirements`, `costEstimate`); `instances.deploy` (instance K6; bridge already deployed by `bridge.deploy`); `instances.progress` (SSE); `instances.get`; `instances.retry`, `instances.cancel`; `bridge.get` |
| J1 Key entry: Portal issues only a link/ticket to the bridge page; no op accepts a key value | `keys.status` (booleans); `tickets.keys`; §5.6, §6 |
| J1 Licence: Stripe checkout last deploy step; status; pay pill; glow while unpaid; assign | `offers.list`, `checkout.create`, `checkout.get`, `stripe.webhook`, `licences.unpaid`, `licences.list`, `licences.assign`; §5.5 R4 |
| J1 Double-click app: launch ticket via bridge; scope summary on canvas line | `tickets.launch`; `canvas.get` (`edge.scopeSummary` from `bridge_api.ack`); scopes edited in the app (SDK-API, app op) |
| J1 Skills bundle: dynamic build, view; bridge pushes to MCP agents | `skills.get`; push = bridge (BRIDGE.md, MCP resources) |
| J1 Connect in-app: Gmail one button, several inboxes, tiers, "as me"/"as itself" | app/bridge ops, not Portal — Connect manifest + SDK-API (scopes, `publicRoutes`), BRIDGE.md (`/p/<product>/…`, `/a/<product>/…`) |
| **J2** List/switch workspaces; one Railway authorisation reused; Railway link per workspace | `workspaces.list`, `account.set_current_workspace`; `providers.link_get` (`workspacesUsing`); `workspaces.set_infrastructure` per workspace |
| J2 Agents list; bound to one workspace; edit card | `agents.list`, `agents.get`, `agents.update` (agents live under `/workspaces/{ws}`; no cross-workspace op) |
| J2 Licences: list; buy single or bundle; assign; move; unassign | `licences.list`, `offers.list` (`kind single\|bundle`), `checkout.create`, `licences.assign`, `licences.move`, `licences.unassign` |
| J2 Skills: edit; download pack; pair more machines (five Mac minis) | `skills.override_put`, `skills.override_delete`, `skills.pack`; more connections on one card: one `device.start/lookup/approve` per machine (up to 64 keys each) or `agents.pairing_code` per OAuth connector; `connections.list` |
| J2 Policy: Free/Bound; held families; pause/resume agent; kill switch; revoke agent or key | `agents.policy_get`, `agents.policy_set`, `agents.pause`, `agents.resume`, `workspaces.pause`, `workspaces.resume`, `agents.delete`, `connections.revoke` |
| J2 Download TBD (signed in); app update; app health/status | `downloads.desktop`; `releases.list`, `instances.update`, `instances.rollback`; `instances.get`, `instances.list`, `hooks.list` |
| J2 Leave Portal: bridge becomes standalone issuer | `workspaces.standalone`; switch itself = BRIDGE.md §Standalone |
| **J3** CLI install, person device sign-in, pick workspace; local bridge; write harness MCP config | `device.start {scope: "owner"}` → `device.lookup` → `device.approve` → `device.token`; `workspaces.list`; local bridge and harness config = CLI.md / BRIDGE.md (no Portal op) |
| J3 Register agent cards from the CLI (15–16), own identity each; per-agent + shared area edges | draft steps `agents.create` ×N + `edges.create` ×N (`drafts.create` → `drafts.apply`); identities = ONE `device.start {scope: "agent", agents: [16 keys]}` + one approval (S4); areas are app scopes (Knowledge, SDK-API) |
| J3 Client Railway per workspace; bridge beside own-infra apps (enrolment code); Buzz identity per agent | `providers.*`, `workspaces.set_infrastructure`; `bridge.enrolment_code`, `instances.register_own_infra`, `bridge_api.enrol`, `bridge_api.ack`; Buzz identity = Connect app op |
| **Owner self-setup** CLI person sign-in (device flow, browser approval); operator session builds a draft | `device.start/approve/token` (`scope: "owner"`); `drafts.create`, `drafts.update`, `drafts.validate`, `drafts.get`, `drafts.list`, `drafts.submit`; reads for context (`catalog.list`, `agents.list`, …) |
| Self-setup: review on website; apply with one confirmation (deploy, grants, money); export/import recipe | `drafts.get` (summaries, confirm items), `drafts.apply`, `drafts.reject`; checkout handoff; `drafts.export`, `drafts.import` |
| Self-setup: revoke CLI session; agents keep working | `owner_sessions.revoke` / `owner_sessions.logout`; agents unaffected (CORE §9; CONFORMANCE case) |

## 8. REQUESTS.md → op / §
| Request (REQUESTS.md) | Answer here |
|---|---|
| portal-core: route registry machine-readable | `types/routes.ts` (`RouteOp`, `ROUTES`, typed inputs/outputs, `SchemaMap`); `routes.list` at `/internal/routes`; §1.1. Requested fields map: `auth` (§1.2; `agent-device` → `device`), `exposure` (`gateway\|internal`, default deny), `audit`, `draftable`, `confirm`, `idempotent`, `rate`, plus `bodyLog`, `transport`, `query`, `registry`. |
| …confirm bridge enrol/config, CLI device flow, TBD device approval, Stripe webhook reach Core through the gateway as explicit rows | Yes: `bridge_api.enrol/config/ack`, `device.start/token` (+ browser `device.*`), `stripe.webhook` — §1.1 explicit public rows. Conventions §1.4–1.5 (envelope, cursor, ids: CORE §1 prefixes, not `ag_`/`in_`). |
| portal-core: one grant format, in signed config | CORE §6 (12 h, half-life re-mint, bridge attaches); Core mints from `isEntitled` + edges + policy (§2.1); no grant route (§6 table). |
| portal-core: bridge enrolment + config shape | `bridge_api.enrol`, `bridge_api.config` (long-poll 60 s), `bridge_api.ack` (health, key presence, scope summaries, connections, registrations); neighbour binding via K6 per instance (§2.1 Instance Registry, `instances.register_own_infra`). Document schema = BRIDGE.md. |
| portal-core: agent card credential per harness | §5.3: key connections via device flow (`device.*`, K4 registered); OAuth connectors via K2b (`agents.pairing_code`, `pairing.*`); Core mints no agent token. |
| portal-core: owner CLI device flow + drafts/apply | §5.4 (`scope: "owner"`; reads + `drafts.*` only), §3 (steps, `$ref`, apply, stop at first failure, per-step audit); recipes = exported drafts. |
| portal-core: manifest fields Core reads | §2.1 Manifest Store (via `@opt2-tealbrick/manifest`); `discovery.intents` delivered by `catalog.list`. |
| portal-core: release registry contract | §2.1 Release Registry (signed index from `opt2-tealbrick-platform`, bridge + desktop as releases); `releases.list`. Index format = REPOS.md / Platform. |
| portal-core: Railway link model | C3; §2.1 Provider Registry; §5.2 ops `providers.link_start/complete/token/get/delete`, `destinations_list/create`, `workspaces.cost_estimate`; deploy/update/rollback/status = `instances.*`. |
| portal-core: launch tickets + key-entry links | `tickets.launch`, `tickets.keys` (K11 `pur`), `keys.status`; §5.6. |
| portal-core: skills bundle | `skills.get/override_put/override_delete/pack`; overrides per workspace (CORE §13); §5.8. |
| portal-gui: catalog shape | `catalog.list[?ws=]` = `Catalog`/`CatalogEntry` incl. overlay (§5.5); no product names in Core/GUI code. |
| portal-gui: search intents | `CatalogEntry.intents/keywords` from manifest `discovery`; GUI adds action intents. |
| portal-gui: launch tickets; key status booleans; before bridge enrolled | `tickets.launch`, `tickets.keys`, `keys.status` (`bridgeReady`); order: infra + bridge (`bridge.deploy` at onboarding step 1) → agent → app deploy → key entry → licence (§5.5). |
| portal-gui: draft review + one-click apply + revoke CLI session | `drafts.list/get/validate/apply/reject` (`DraftStepView.summary/effect/confirm`, `requiresPurchase`), `owner_sessions.list/revoke`; money → checkout handoff (§3). |
| portal-gui: onboarding | `workspaces.create`, `providers.*` (`signupUrl`, `random`), `providers.list` (`available:false`). |
| portal-gui: agents | `harness.options`, `agents.create`, `device.lookup/approve/deny`, `agents.instructions`, `agents.pairing_code`, `pairing.*`, `AgentCard.status pending\|authorised\|connected\|paused`. |
| portal-gui: canvas | `canvas.get/save` (`revision`, `409 revision_conflict`), `edges.create/update/delete` (CRUD + scope type, `scopeSummary`), companions = manifest-derived app→app edges (§2.1). |
| portal-gui: deploy | `instances.deploy`, `instances.progress` (SSE phase/log/done/error), `instances.retry/cancel`; stable error codes + user-safe `message` (§1.4). |
| portal-gui: licences | `licences.list/assign/unassign/move`, `checkout.create` (Stripe TEST URL + return path), `checkout.get`, `licences.unpaid`. |
| portal-gui: skills | `skills.get` (`path, title, body, sourceProduct, edited`), `skills.override_put/delete`, `skills.pack`. |
| portal-gui: downloads | `downloads.desktop` (version, signed URL, sha256, notarized). |
| portal-gui: gateway route export; endpoint name; cache at boot | `GET /internal/routes` (method, path, auth, transport → body cap + timeout, query keys, rate); GUI caches by digest (`TB-Routes-Digest`). |
| Coordinator R2 / R3 / R4 | R2 §5.4 (`client: cli\|tbd`, sessions list shows client); R3 `pairing.connect_request` + `pairing.approve` + `agents.pairing_code` (§5.3); R4 §5.5 unpaid rules. |

## Checklist mapping (SPEC-REVIEW-CHECKLIST §1 PORTAL-API)
| Checklist line | Answered in |
|---|---|
| One row per op: id, path, method, exposure, caller type, rate class, body-log; generates gateway, client, CLI, rate limits | §1.1, §1.3, `RouteOp`/`ROUTES` |
| Every GUI action of PRD §7.3/§10 is a typed op, same path for GUI, CLI, recipes | §4, §7, §3 (drafts call the same handlers) |
| Default-deny; Core only from gateway; no passthrough; no "safe because not forwarded" | §1.1 |
| Core JSON only; no UI, static assets, self-hosted identity | §1.1, §1.2, §6 |
| 15 registries, one owner module, one record kind, Instance = deployment + registration | §2, §2.1 |
| Catalog op returns slug, name, category, description, operations, settings route, release state, offers; GUI owns no list | §5.5, `CatalogEntry` |
| Release Registry signed, outside image, product/version/digest/artifact/channel/upgrade rule; deployment → release id | §2, §2.1 |
| One `isEntitled(workspace, product, major)`; reassignment by licence id | §2.1 Entitlement Ledger |
| Offers reviewed data verified against Stripe, not env; channel a field | §2.1 Offer Registry |
| Provider Registry one interface, Railway adapter, own-server adapter (no Coolify, C308); names only in adapters | §2.1 Provider Registry, §5.2 |
| Consent Registry generic; manifest vocabulary; no product-named kinds | §2.1 Consent Registry |
| No op for tool execution, connectors/channels/brokers, relay/local-exec, Fleet, rooms, app data | §6 |
| Settings/key ops never carry key values | §5.6, `KeyRequirement`, §6 |
| Draft ops typed; apply needs browser confirmation | §3, `DraftableOpId`, compile-time checks RT1–RT3 (routes.ts) |
| (v0 review) codes stored as digests; K3 outputs carry no secrets | §1.2, §1.5, compile-time checks RT6–RT8 (routes.ts) |
| Audit action registry; no behaviour from audit rows; no env-var registries | `AUDIT_ACTIONS`, §2.1 Audit Log, Offer/Release rules, §3 recipes |
| No home-infra or personal constants | §1.1 |
| §3 coverage lines (J1, J2, J3, owner self-setup) | §7 (J1 authorise after `bridge.deploy`: B1; J3 one approval for 16 agents: S4) |

## Open questions
1. **Licence per major** (N12, waits on Martin): `isEntitled(ws, product, major)` means a new major needs a new licence, while PRD §1 says "updates free while on licence". Recommendation: keep per-major licences (one licence kind, no version deciders) and say so in offer and website copy; Martin decides (TODO in §2.1).

Resolved since v0 and removed: id prefixes (CORE §1), connection method `pairing` (I7), own-infra enrolment live (I16), caps shape (I14), device-poll errors in our envelope (C15), instance removal (I15), offers in the signed release index (C17), device-flow path and wire (B6: this file + routes.ts are the source).

## v0.1.3 additions (C38)
- Bridge release records carry a `runtime` record (ports, health paths, volume + backup directory, env names each with `source: portal | provider-secret | public-url | fixed`) because the bridge has no app manifest; format in `opt2-tealbrick-platform` `registry/README.md`.
- The Railway adapter sets `RAILWAY_RUN_UID=0` on services that mount a volume.
- C40/C40a: harness options ship as data in the signed release index (`harnesses` section of frozen `HarnessOption` rows from types/routes.ts, unchanged), synced by Core. v0.1.27 (F75): the SET of ids is `HARNESS_OPTION_IDS` (types/routes.ts), the one definition Core and the CLI import; the index carries the row data (label, kind, instructions) for each id, never an id outside the list.
- C46 (approved): status table §1.4 gains `405 method_not_allowed` (known path, wrong method), with the one error envelope.

## v0.1.4 additions (C49)
- Route `clerk.webhook` (`POST /clerk/webhook`, auth class `public`, the handler verifies the svix signature before any state change, `bodyLog: none`, registry Workspace + Account, audit `account.disable`). Explicit public rows are now five: `device.start`, `device.token`, `stripe.webhook`, `clerk.webhook`, `bridge_api.enrol`. A disabled or deleted Clerk user disables the account: every person route answers `403 account_disabled`. Core keeps no route outside `ROUTES` (one registry; no extension file).

## v0.1.9 addition (C60)
- Route `billing.portal` (`POST /billing/portal`, browser only, `bodyLog: none`, not idempotent, registry Entitlement): input `{returnPath}`, output `{url, expiresAt}` — a one-time Stripe customer-portal link (invoices, receipts), never stored or logged. Errors: `409 conflict` (`details.reason: no_billing_customer`) when the account never bought; `502 checkout_failed` when Stripe refuses.

## v0.1.10 addition (C59)
- `tickets.keys` answers `url = <TB_KEYS_PUBLIC_URL>/keys` — the bridge's second public domain, key page only (BRIDGE §3.1, §9.3); the GUI form-POSTs the ticket there. Ticket claims unchanged (`aud` = `tb:brg:<id>`). `bridge.deploy` adds that second domain to the bridge service and sets `TB_KEYS_PUBLIC_URL=https://<domain>`; the bridge release `runtime` record lists the env with `source: public-url`.

## v0.1.11 addition (C69c)
- `SettingFieldView.mutable?: boolean` — Core copies the manifest field `mutable` (default true); `false` means fixed at install: the GUI shows it read-only after deploy and `instances.update {settings}` must refuse a change to it (`validation_failed`).

## v0.1.11 addition (C71)
- The release index body is spec: `ReleaseIndexBody` / `ReleaseIndexEntry` / `ReleaseSourceRecord` / `BridgeRuntimeRecord` in types/routes.ts. Dev source records carry optional `context` (repo-relative build root, default "."; for apps it MUST equal the manifest `runtime.build` root); Core builds with Railway rootDirectory = `context`. Platform's registry README stays the operational guide; on a conflict the types win.

## v0.1.12 addition (C79)
- Route `portal.signing_keys` (`GET /portal/signing-keys`, auth `public`, rate `public_strict`, `bodyLog: meta`, registry Credential): `PortalSigningKeys {keys: [{jwk, status, activateAt}], keySetSeq}` — Core's signing key ring (public halves only) and the seq of the statement it emits. Ceremony input for Platform; verifiers never read it. Explicit public rows are now six (add `portal.signing_keys`).

## v0.1.13 additions (C82, C86)
- **`instances.consent`** (`POST /workspaces/{ws}/instances/{ins}/consent`, browser, confirm, audit `instance.consent`): `InstanceConsentInput {kind: "holds_pending_all", granted}` → `Instance` (with `consents[]`). A release whose manifest has a wildcard companion (`product: "*"`, M-CP-3) asks for `holds_pending_all`; any other kind → `consent_not_requested` (409). The GUI shows the consent at deploy with the text "This app can see the pending approvals of all apps" and a revoke switch in the instance settings. Granted → the config builder mints ONE companion grant per deployed, licensed app of the workspace (`sub` = this instance, `aud` = each app, `crud ["read"]`, `mode bound`, `wf ["tb.holds_pending"]`), also for apps deployed later; not granted / revoked → none (the next config drops them). Deploy without consent succeeds; the app's calls are refused `no_grant`.
- **`tickets.launch` `path`** (C86): validated before minting: starts with `/`, ≤ 512 chars, no scheme, host, `//`, `\`, control characters or `..` segment (also after percent-decoding) → else `path_invalid` (400). The ticket's `path` claim leads only into the TARGET app (`/a/<product><path>`). GUI route `/w/<ws>/open?product=<p>&path=<path>` calls it and opens the result (Core + GUI follow the spec).
- **Slice `portalUrl`** (C86): Core sets it to the GUI origin in every instance slice.
- **Slice `companionTargets`** (spec 0.1.14, C90): Core lists `{product, ins}` ONLY for the targets this app currently holds a companion grant for (one per grant, wildcard-derived included), so an app with a wildcard companion knows which apps to call. It changes with the grants: a consent revoke removes the wildcard-derived entries in the next slice.

## v0.1.14 addition (Core request)
- `system.health` output `Health` gains optional `deployWorker: DeployWorkerHealth {alive, lastSweepAt, active, queued, unowned, resumed}` (Core 542d51a). `ok` still means "db reachable" only.
- **Onboarding (C96):** `DeviceStartAgentInput.agents[]` and `DeviceRequest.agents[]` gain optional `name` (1..60 since v0.1.15, the agent card rule Core and the CLI use) and `purpose` (≤ 280), suggested by the CLI; the device page prefills them and the owner may edit them; `DeviceApproveInput.agents[]` carries the edited values and Core applies them to the agent card on approve (same validation as `agents.update`). Suggestions are untrusted display text (escaped, never used as ids). A harness option row for the CLI (`kind: "agentic_system"`, label "Tealbrick CLI") is DATA in the harness option registry (Core), no type change.
- **Catalog (Fleet):** `CatalogEntry.hasUi` (manifest declares `ui`) and `launchPath`; Open is enabled by `hasUi`, the configure affordance by `hasConfigureUi`; a launch without `path` lands on `launchPath`.
- **A2A-11:** `Edge.grantState` gains `blocked` (app→app edge whose companion declaration fails M-CP-2 against the target's current release) with `blockedReason` (`companion_op_missing` | `target_not_deployed`) and `blockedDetail` (≤ 200, plain text); a declared companion has its edge before the target is deployed (`not_deployed` + `target_not_deployed`). `Instance.companionIssues[]` lists non-working companion connections. No owner action: the grant returns in the next config once the target offers the op again.
- **C100:** `Instance.updateCompanionChanges: CompanionChange[]` whenever `updateAvailable` is set; the GUI shows each `widens` entry before Confirm ("This update lets <app> also <crud> in <target>"); the update confirm is the consent.
- **C102:** slice `companionCallers [{product, ins, name}]` (the apps holding companion grants that target this instance), emitted with `companionTargets`.

## v0.1.15 additions (C104, queued)
- `ReleaseIndexEntry.requires {bridge?, sdk?}` (signed). `instances.deploy` / `instances.update` refuse with `bridge_too_old` (409, `details {needed, current}`) when the workspace bridge version is older than `requires.bridge`; the GUI shows "Update the workspace bridge to <needed> first" with the bridge update action. Own-infra bridges: same rule on the reported version.
- **v0.1.15 (queued):** agent card `name` is 1..60 characters everywhere (agents.create/update, device request and approve suggestions); 0.1.14 said 1..80 for the device suggestion — corrected to Core's live rule (no Core change).
- **v0.1.15 (C105):** new agent cards and the workspace default held families (companion grants, CORE I8) start from `DEFAULT_HELD_FAMILIES` = `destructive`, `money`, `first_contact`. Existing cards are not changed silently: Core offers the owner a one-click "add first contact approval" on cards whose held set lacks `first_contact` (Core + GUI decide the UX; no automatic widening of holds without the owner).
- **v0.1.15 (C105a):** `Workspace.appsPolicy {held}` (default `DEFAULT_HELD_FAMILIES`), edited with `workspaces.update {appsPolicy}` (`money` required → else `422 policy_invalid`; a change re-mints every companion grant with the new `held`). The GUI shows it in workspace settings as "Approvals for apps" with one plain sentence per family. The slice carries it as `appsPolicy`.
- **v0.1.16 (C107):** agent policy `held` and `appsPolicy.held` accept `outward` and `identity`; the GUI shows `outward` as "Ask me before every message or post" (off by default) and `identity` as "Ask me before the agent changes its public profile" (on by default). Existing cards: Core offers the owner to add `identity` (no silent change, as for first_contact in C105).

## v0.1.18 additions (C106a phase 2, C109; Core 1527fe8)
- **Adopt (agent onboarding with access in ONE approval):** `DeviceStartAgentInput.agents[].adopt?: AdoptSuggestion {grants (≤ 16) {product, crud?, operations?}, channel? {kind buzz_channel|connect_inbox, id?, createName? ≤ 60}, wake? serve|poll|none}` — a suggestion only. `device.lookup {userCode, ws?}` returns `DeviceRequest.agents[].adopt?: AdoptResolved` (agent-audience, non-money ops of the deployed release per product, with `deployed`, `licensed`, `requestedCrud`; read ops may be pre-checked, write ops NEVER). `device.approve` `agents[]`: `agt` optional when `name` is given (Core creates the card, `bound`, workflow = the ticked ops), `adopt?: AdoptChoice {grants {product, operations}, channel?}` re-validated at approve; the whole approval is one transaction recorded as one applied draft (`DeviceDecision.draftId`).
- **Channel scope:** the requested channel is stored with the edge and delivered in the target app's slice as `agents[].scopeRequest {product, kind, id?, createName?}` (Connect tethers it).
- **C109 review sheet:** `CatalogEntry.operations[].holdFamily?` → "asks you first" when the family is held for the card.

## v0.1.19 additions (C111, C111a)
- `Edge.ops?: string[] | null` (agent→app): null = verb-level access; an array = the op allow-list → the grant's `wf` for ANY card mode. `edges.update {ops}` (agent-audience, non-money ops of the deployed release; `crud` defaults to the union the ops need; null = back to verb-level). Device approve (C106a) writes the ticked ops here.
- `Edge.verbChanges` (agent→app with a deployed target): per verb, the ops toggling it would unlock / remove, computed with the grant rule; the GUI review sheet shows it.
- Grants: `wf` non-empty → op-limited in any mode; `caps` apply in any mode. Mint op-limited Free grants WITH caps only once the bridge is ≥ 0.1.19 (the first bridge on manifest 0.1.12's gate; 0.1.18 ships on 0.1.11 without the Free-wf rule) and the target app's SDK is ≥ 0.1.16 (per-target check, as C108); until then dev-only Bound + wf.
- **v0.1.20 (correction):** the C111a cutover needs bridge ≥ **0.1.19** (bridge 0.1.18 ships on manifest 0.1.11 without the Free-wf gate) and target SDK ≥ 0.1.16; Core compares with `MIN_BRIDGE_FREE_WF` / `MIN_SDK_FREE_WF` from @opt2-tealbrick/manifest 0.1.12 (L1).
- **v0.1.20 (F46, Core 2b1e8a2):** `AdoptResolved.grants[].suggested: boolean` — false = a deployed, licensed app the agent did not name, listed so the owner can add it (nothing ticked).

## v0.1.21 additions
- **C113 (live: Core 81c7c27, signer platform c27c643):** `ReleaseIndexEntry.devOnly?: true` (signed; every release of a `DEV_ONLY_PRODUCTS` product in ci/tb-ci.ts, always channel `dev`). A STABLE workspace never gets a dev-only product: not in its catalog (no dev-release fallback), and `instances.deploy`, own-infra registration, `instances.update` and `instances.rollback` answer `release_not_deployable` (409) with `details.reason: "dev_only"`. A dev workspace gets it as before.

## v0.1.22 additions (Core QA S2/S3)
- `DeployState` += `refused` (bridge refused the manifest; the app never ran) — `Instance.lastError.code` = `ErrorCode | BridgeManifestRefusalCode` (`manifest_mismatch`, `bridge_too_old`, a validator code, `manifest_rejected`).
- `CatalogEntry.devOnly?: true` for a dev-only app still running in a stable workspace (entry from its running release, no offers, no update).
- StatusReport `rejected[].ins?` (BRIDGE v0.1.22) — Core no longer infers the instance.

## v0.1.24 additions (C117)
- `hookSubscriptions` / config `hooks[]`: every declared hook of every DEPLOYED app (any run state, also after a licence lapse) with `enabled` = the owner switch (`hooks.set`). A hook disappears only when the owner switches it off (then listed `enabled: false`) or removes the app. Every change that can affect the list bumps the config revision.

## v0.1.32 additions (C196: ENG-1, ENG-2, ENG-6 of the legal texts v1.0)
- Route `account.terms_accept` (`POST /me/terms`, browser only, registry Consent, audit `account.terms_accept`, input `TermsAcceptInput {documents: LegalDocumentRef[], onBehalfOfBusiness: true}`, output `AccountMe`). Core keeps ONE list of the current legal documents (doc id, version, title, URL) and records one row per document: account id, document, version, time. No IP address and no IP hash (Privacy Policy §9: "the version … and the time of acceptance"). `documents` must equal the current list exactly; otherwise `409 conflict` (`details.reason: "terms_changed"`, `details.documents` = the current list) and the GUI shows the new list.
- `AccountMe.terms?: AccountTerms {current, accepted, acceptedAt}` and `AccountMe.mfa?: AccountMfa {required, enrolled}` (optional: a Core before 0.1.32 omits them; the GUI then shows no gate).
- Terms gate: until the account accepted the current list, every mutating browser or owner-CLI op answers `409 terms_not_accepted` (`details.documents`). Exempt: `account.terms_accept` and the safety and exit ops (`owner_sessions.logout`, `owner_sessions.revoke`, `connections.revoke`, `device.deny`, `agents.pause`, `workspaces.pause`). Reads stay open. A new version of any document re-opens the gate at the next request (Terms §20.1). Bridge, device, public and webhook principals are never gated.
- MFA gate (Terms §4.2): with Core's `TB_REQUIRE_MFA` on, a browser or owner-CLI request of a person whose Clerk user has no second factor (TOTP, backup codes, SMS code or a passkey) answers `403 mfa_required`, except `account.me` (the GUI reads the gate there) and `owner_sessions.logout`. The GUI sends the person to Account › Profile & security to add one.
- `checkout.create` requires the terms acceptance (`409 terms_not_accepted`). The Stripe Checkout Session collects the business name (required), a tax ID where Stripe supports it for the buyer's country, and the checkout terms tick. `Order.business?: OrderBusiness` carries the evidence (the tax ID itself stays at Stripe).

## v0.1.33 changes (C200: consumers too)
- `LegalDocId` += `privacy`. The account accepts Terms, Privacy Policy and AUP (Core list, version 1.1) with a neutral tick; `TermsAcceptInput.onBehalfOfBusiness` is optional and ignored. `AccountTerms.businessDocuments` = the DPA, accepted only by a business buyer at checkout (Core records it then, same table, same rule: no IP).
- `checkout.create` takes `buyer: CheckoutBuyer` (required by Core 0.1.33+, 400 `validation_failed` with `details.reason: "buyer_required"`): `{type: "business", dpaAccepted: true}` → Stripe collects the business name and a tax ID, both optional; `{type: "consumer", withdrawalWaiver: true}` → no business fields, the waiver tick and its time are stored on the order. The Stripe terms tick text is neutral. Stripe Tax stays automatic.
- `drafts.apply` takes `buyer` (required when the draft has a payment step, else 400 `validation_failed` `buyer_required`); it replaces any `buyer` in the draft's checkout steps.
- `OrderBusiness.buyerType` and `.withdrawalWaiverAt` (alias `OrderBuyer`).

## v0.1.34 changes (C200 final texts, legal v1.1: Terms 1.2, 1.3, 9A, Annex A)
- The account acceptance box (sign-up, and again at checkout) covers Terms, AUP, Privacy Policy and DPA, all version 1.1; Core records document + version + time for each (no IP). `AccountTerms.businessDocuments` is deprecated (omitted).
- `CheckoutBuyer` is now `{termsAccepted: true, business: boolean, immediateSupply?: boolean}` (replaces the 0.1.33 union, unused). Buyer type: business when `business` is ticked or a VAT/tax ID was given at Stripe; else consumer.
- Consumer without `immediateSupply`: the purchase completes; the licences carry a not-before time = the end of the 14-day withdrawal period (UTC day of payment + 15 days, 00:00). `isEntitled` honours it; the workspace stays licensed for the pay pill and the catalog (`licence: "assigned"` + `licenceActiveFrom`) so nobody buys twice. `Licence.activeFrom`. Core re-mints the workspace config when the time passes.
- Stripe: tax ID collection on and optional for every buyer; business name (optional) only when `business` is ticked; no Stripe terms tick (the GUI box is the checkout acceptance). The confirmation text (immediate-supply request + acknowledgement, or the deferred start) is in `custom_text.after_submit` and the invoice footer, and on the order (`OrderBusiness`).

## v0.1.36 additions (C184/C193/C203/C204: Tealbrick Admin, operator plane, S1)

- New subpath `@opt2-tealbrick/spec/admin`: `ADMIN_ROUTES` (exposure `admin`, paths `/admin/v1/...`, auth `operator`, `minRole`, `effect`, `stepUp`, admin rate classes) and the admin shapes. Not in `ROUTES`, `/internal/routes` or `ROUTES_DIGEST`; the GUI gateway never forwards it. Core serves it only on its admin listener (`TB_ADMIN_PORT`, default 8091); the main listener refuses any exposure other than `gateway` / `internal` (fail closed).
- Four checks per admin request: (1) admin listener only; (2) admin-GUI service signature, header `tb-admin-gw: v1;ts=<unix s>;rid=<16-64 [A-Za-z0-9_-]>;sig=<base64url Ed25519>` over `ADMIN_GATEWAY_SIGNING_INPUT` (method, path+query, sha256 hex of the body, rid, ts), ±30 s, each rid once; (3) the operator's Clerk session token (`Authorization: Bearer`, the environment's Clerk application, `azp` = the admin origin); (4) the env allowlist `TB_ADMIN_OPERATORS` (C204): comma list of `<email>:<role>` (the Clerk user's primary email, verified, case-insensitive) or `user_…:<role>`, role `owner | support | readonly`. Env + redeploy is the only way to appoint or remove an operator.
- Step-up (C203): rows with `stepUp: true` need a Clerk verification younger than 5 minutes (session claim `fva`); else 403 `step_up_required`. Not on the list / role too low: 403 `operator_forbidden`.
- `Licence` (additive): `source?: "purchase" | "comp"`, `expiresAt?`, `offerId`/`orderId` may be null (a comp has no offer, order or invoice), `status` gains `revoked` / `expired` (comps only; the customer `licences.list` leaves revoked/expired comps out). A comp is issued in the Core's Stripe mode (CORE-A-03) and entitles through the same `isEntitled`, which honours `expiresAt`.
- Every admin op writes one append-only, hash-chained `operator_audit` row (ids only, no bodies), kept 3 years (own retention job, not the 365-day customer audit prune).

## v0.1.37 additions (C184 §2.3, §6; C203 Q2: Admin S2)

- Admin ops `customers.suspend` / `customers.unsuspend` (support, step-up), `customers.ban` (owner, destructive, step-up, typed account email) / `customers.unban` (owner, step-up), `admin.health`, `admin.maintenance_runs`; `CustomerDetail.actions`.
- Suspension: every customer op of that account answers 403 `account_suspended` (`details.kind` suspend | ban) except `account.me` (carries `AccountMe.restriction` with the customer text), `licences.list`, `billing.portal` and `owner_sessions.logout`. `isEntitled` is false for every licence of a suspended or banned account, and Core re-mints every workspace config at once, so the bridge drops app grants on its next pull (within ~60 s online). The bridge keeps pulling (its config carries no app grants). Timed suspensions end on their own.
- Ban = suspension + Clerk ban (ends the user's Clerk sessions, blocks sign-in) + owner CLI sessions revoked + device requests denied. If Clerk refuses, nothing changes. Neither suspension nor ban deletes data. Lifting re-mints the configs; revoked sessions stay revoked.
- `Health.commerce` is typed (ADM-8).

## v0.1.38 additions (C184 §4, §5; C203: Admin S3)

- GDPR queue (`gdpr.*`): request records with kind, channel, requester, identity check (verified / failed; method), the Art. 12(3) clock (`dueAt` = the earlier of received + 30 days and received + 1 calendar month; one extension of up to 2 more months only when the requester was told within the first month), timeline (counts only), outcome and reply template id (A–H; the GUI renders the texts, a person sends them). Access/portability: one JSON bundle (format `tealbrick.portal-export/1`, the existing export code), sealed under TB_KEK, 7 days, downloaded once (owner + step-up; never stored in the idempotency store). Erasure: the existing data-deletion code run at once; `gdpr.erasure_preview` runs the same code in a rolled-back savepoint (preview counts = executed counts); typed account email; optional Clerk deleteUser last (Clerk refuses → nothing changed). Customer hosting is never touched. Records kept 3 years after close.
- CRA queue (`cra.*`): cases with source, awareness time (later only by owner + reason + step-up), kind (undecided counts as reportable), triage, Article 14 clocks (24 h, 72 h, final = fix + 14 days or notification + 1 month), JISKB submission RECORDS (stage, time, reference, evidence location), fix, advisory, user notice, evidence timeline. Core never submits anything. Records kept 10 years.

## v0.1.39 (C213 US-3, E3 health-gated update)
- `Instance.lastUpdate?: {outcome: "updated" | "rolled_back" | "rollback_failed" (+ `kept_new` | `held` since v0.1.51), from, to, at, reason?, dataRestoredTo?}` and `Instance.updating?: {from, to, rollingBack}`. A version-changing update switches the bridge to the new release only after the new version reports healthy (state `ok`, no failed-boot attention); a failure after the provider was touched puts back the old image, settings and env, plus the pre-update snapshot (`TB_RESTORE_FROM`) when the failed version may have migrated. `lastError.code`: `update_rolling_back`, `update_rolled_back`, `rollback_failed` (operator alerted, no further attempt), `rollback_needs_restore`.
- `instances.rollback`: `release_not_deployable` with `details.reason` `not_older` (target newer than the running version) or `rollback_needs_restore` (target below the app's reported `minCompatibleCode`).
- v0.1.53 (QA INFO-1, C291; owner rollback after a schema change): the `rollback_needs_restore` refusal carries `details.restorable: {snapshot, sha256, createdAt} | null`. Non-null ONLY when ALL hold: (1) the instance's current reported `preUpdateSnapshot` (Core MUST store the bridge-reported `StatusReport.apps[].preUpdateSnapshot` ref per instance; new in Core with this version) has `from` = the target version and `to` = the running version, and the app's reported `version` = the instance's version; (2) its `file` matches `^tb-preupdate-to-[0-9A-Za-z._-]+\.tar\.gz$`; (3) the instance's `lastUpdate` for that update (from = target, to = running) has `fromSdkVersion` ≥ 0.1.25 (Core records the old version's last reported sdkVersion when the update starts) (SNAPSHOT_SDK: the old version can restore); (4) the instance has NO companion service with its own data (a restore covers the app's data only; otherwise null). The owner then calls `instances.rollback {releaseId, restore: {snapshot, sha256, acceptDataLoss: true}}`. Core accepts `restore` ONLY when the same call without it would be refused `rollback_needs_restore` (an image-only rollback never loses data for nothing), and only when `snapshot` + `sha256` equal the current report exactly (a repeated update reuses the file name with new content); else `release_not_deployable` `details.reason` `rollback_restore_unavailable`; `acceptDataLoss` not `true` → 400 `validation_failed` (Core's validation code); not allowed in a draft (400). Order of refusals stays: `update_held` (409, RS-7.4) first, then `deploy_in_progress`. Core runs it as an E3 rollback: it writes `update_attempt {from: target, to: running, rollback: {restore: snapshot}}`, deploys the target with `TB_RESTORE_FROM` = the snapshot, health-gates it, and ends with `rolled_back` (`dataRestoredTo` = the snapshot `createdAt`) or `rollback_failed` (state failed, operator alert; Core never puts the newer version back on its own). `TB_RESTORE_FROM` is cleared ONLY when the rollback succeeds; after `rollback_failed` it STAYS on the service and is not owed to the next deploy, so an owner Retry or a restart boots the old version with the restore still requested: the SDK restores the snapshot again unless its `tb_meta` marker shows `app.db` was already restored from that archive (then the old code runs on the restored data). Either way the old code never runs on the migrated data (v0.1.54, C291b; the operator deletes it last while resolving, ops RUNBOOK). Audit: `instance.rollback` plus `instance.rollback_restore` (person, snapshot, sha256, createdAt). `restorable: null` → the GUI says to contact support (operator runbook: platform ops/RUNBOOK §6b). The GUI confirm names the version and the snapshot time, says that changes since then are lost and that the app is unavailable while the restore runs.

## v0.1.40 (Core/GUI fields that were Core-local; all additive, readers tolerate, L24)
- `workspaces.cost_estimate` query key `settings` (F123): JSON text `{"<product>": {"<settingKey>": value}}`, option values only (enum, boolean, integer, number), ≤ 4096 chars, ≤ 32 products, ≤ 64 keys each; Core counts a companion service only when its manifest `when` holds. `CostEstimate.monthlyExpected` + `expectedFrom` (`measured` | `typical_idle` | `mixed`) and per line (C224/C225): the headline is the expected cost from measured use; `monthlyHigh` = "at most" at the full reserved limit; `monthlyLow` = `monthlyExpected` when present.
- `KeyRequirement.when` (R5-3): the manifest key condition; the GUI counts and asks only for keys whose condition holds for the chosen settings.
- `InstructionSet.steps[].pending: true` (F122): the step needs the bridge MCP address and `mcpUrl` is still null (no `copy`; ask again when the bridge is online).
- `BridgeDeployResult.outcome` (F122): `started` | `in_progress` | `up_to_date` | `unchanged` | `revived`. `BridgeStatus.lastError?` and `BridgeStatus.keptData? {id, removedAt}` (C226).
- `Instance.lastError` = `InstanceError {code, message, reason?, keptDataId?}`; C226 refusal: code `destination_in_use`, reason `kept_data_in_the_way`, `keptDataId` = the item in the way (null when it belongs to another account).
- INFO-8: `lastError.reason` `companion_not_running` = a companion service of the app does not run: it failed, has no live deployment for 5 min, runs without its claim for 10 min, or did not start within the 25-min watch (code `needs_keys` when a required key it uses is missing, else `provider_unavailable`). `instances.retry` on a registered app with this reason (running — it keeps serving — or failed; health not `down`) redeploys the same release: the app keeps its identity, the companion gets a new one-time code. Retry of a running app: while a deploy job holds it → `409 deploy_in_progress`; another error → `409 conflict` (Retry does not apply); no error but a companion the release uses has no recorded claim (and no job holds the app) → the same redeploy; otherwise `409 conflict` (nothing to retry). An app with health `down` keeps the C76 path (a new one-time code for the app itself).
- Kept data (C226), account level: `kept_data.list` (`GET /me/kept-data` → `KeptDataList`, ≤ 200, newest first, one item per provider service, only the owning account) and `kept_data.delete` (`POST /me/kept-data/{id}/delete`, body `{confirm}` = the main service name; → `{id, state: deleting | deleted}`; 404 `not_found`, 409 `conflict` reason `not_kept` | `data_shared`, 400 `validation_failed`).
- `workspaces.delete` → `WorkspaceDeleteResult {ok: true, state: deleted | deleting, bridge: RemoveResult | null}` (C223; a superset of `Ok`); `Workspace.deleting? {since, lastError}` while provider removals run; `RemoveResult.leftOnProvider` (`nothing` | `empty_destination` | `stopped_service_and_data`), `destinationName`, `lastError`.
- `Order.amountDiscount` (minor units) and `Order.promotionCode` (C92).
- `details.reason` and `lastError.reason` values Core sends (documented, open strings): `not_kept`, `data_shared`, `kept_data_in_the_way`, `destination_reserved`, `dev_only`, `not_newer`, `not_older`, `upgrade_path`, `rollback_needs_restore`, `rollback_restore_unavailable` (v0.1.53), `apps_remain`, `workspace_deleting`, `agent_paused`, `harness_unknown`, `licence_active`, `terms_changed`, `portal_not_configured`, `no_billing_customer`, `buyer_required`, `idempotency_in_progress`.

## v0.1.56 (C296 companion waiting for a key; app attention on the instance; additive)
- `Instance.attention?: {code, reason} | null` (INFO-1): Core copies the app's `AppStatus.attention` from the bridge report (code `^[a-z][a-z0-9_]{0,39}$`, reason cleaned, ≤ 200 chars). Core includes it only while the instance is `running`, its health is `ok` or `degraded` and it has no `lastError` (a stale reason never shows next to a failure). The GUI shows the reason under the health ("Slow or partly down" alone never says why, e.g. `engine_missing`), as plain text only. Apps MUST NOT put user content or personal data (document titles, names, e-mail addresses) in `attention.reason`: every workspace reader sees it.
- `ErrorCode` + `needs_keys`: `Instance.lastError` when a companion service failed while it was deployed WITH its provider health check and a required key it uses (manifest `settings.keys[].usedBy` names the service, `when` holds) is missing (the health check stopped it while tb-exec waited for the key). The message names the service and the key(s): enter them on the bridge key page, then try again; an undone update says the same in plain words. A companion deployed without the check that still fails gets `provider_unavailable`, naming the missing key too. Health check rule (QA-C296-3, Core #45): a companion gets NO provider health check while a required key it uses is MISSING — its own bridge key report says unset, or (no own report yet: a fresh install) no other app of the workspace reports the key set; unknown counts as missing. With every such key set it keeps its health check; when the key arrives, the check comes back on the NEXT deploy (no deploy is triggered by the key itself). Railway ignores `healthcheckPath: null`; Core clears an existing check with `""` in its own call. After the claim marks a fresh app running, Core keeps watching its companions until they run or fail, so a failed companion is never silent: a registered app keeps `running` (its claimed identity stays) with the failure as `lastError`; an app that never registered goes `failed`.

## v0.1.55 (C296 disabled setting choices; additive)
- `SettingFieldView.choices[]` is the manifest `SettingChoice {value, label, note?, disabled?}`: Core copies `note` and `disabled`. The GUI shows a disabled choice greyed with its note (e.g. "soon") and never lets it be selected.
- Core refuses a disabled choice in `instances.deploy` and `instances.update {settings}` when it is a NEW value: 400 `validation_failed`, `details {pointer: "/settings/<key>", reason: "choice_disabled"}`. A stored disabled value (written before this rule) does not block an update that does not change that field.
- Repair of a stored disabled value: when a `mutable: false` enum field holds a value that the target manifest AND the manifest of every release the instance is known to have run (`release_id` + `previous_release_ids`; an unreadable one means no repair) mark `disabled`, a settings-only `instances.update {settings: {<key>: <enabled choice>}}` (no version change: `releaseId` absent or the running release) may change it; the next deploy adds the services and keys whose `when` now holds. A repair together with a version change is refused (`reason: immutable`): a failed health-gated update would roll the settings back. Any other change of a fixed field stays refused (`reason: immutable`). The GUI offers the repair on such a field (it is not shown read-only) with a needs-you notice.
- A manifest default that is a disabled choice is refused like a sent one (publisher tooling already refuses it, M-ST-2).
- Cost estimates (C225): a sent disabled choice is dropped, so the field is quoted at its manifest default's cost; a disabled choice never quotes a lower cost.
- `details.reason` + `choice_disabled`.

## v0.1.51 (RS-7.4 update safety + G2b, INC-20261019-04; additive)
- `InstanceLastUpdate.outcome` + `kept_new` (the new version was kept, nothing undone) and `held` (frozen: the update could not be confirmed; an operator checks it; Core never puts old code on possibly migrated data).
- `ErrorCode` + `update_held` (409 on instances.update / rollback / retry / remove and the deploy revive path while an instance is held; also the `Instance.lastError.code` of a held instance, with the plain owner text in `message`) and `update_kept_new` (Instance.lastError code of a kept update).
- `DeployPhase` + `waiting_bridge` (an app update waits for a running bridge update), `waiting_apps` (a bridge update waits for running app update attempts), `held`. Clients render unknown phases by their message.
- Workspace config `apps[]` + optional `candidateManifestDigest` / `candidateVersion` during an update attempt (BRIDGE apps table; G2b).

## v0.1.41 (G3 R1 draft review, F126; additive)
- `Draft.description?` (the recipe's own text, shown as its claim) and `Draft.loosening?: LooseningItem[]` (`id` = `<n>:<setting>`, `n`, `opId`, `subject`, `setting`, `before`, `after`, `detail?`); `DraftApplyInput.confirmLoosening?: string[]`; details.reason `loosening_unconfirmed` (with `details.loosening`). See the Apply line above.
- `Draft.createdBy` gains `{kind: "device", id}`: the draft an agent device approval writes and applies at once (adopt, C96). Readers that do not know a kind show `createdByLabel`.
- Hold family `public_link` (C167, C232, LA-2): in HOLD_FAMILIES, HOOK_HOLD_FAMILIES and DEFAULT_HELD_FAMILIES. New cards and new workspace apps policies hold it; existing cards and workspaces get it in `offeredHeld` (C107a), never added silently. GUI text: "Share a page with anyone who has the link." Old readers ignore the word (C108). An app that offers links must refuse an agent link op when the verified grant does not hold `public_link` (`link_needs_hold`, fail closed) until the owner accepts the offer.
- Viewer tokens (LA-5): `tbv_` + 43 base64url chars (256-bit random), app-local bearer capabilities that authorise reading ONE rendered page; only a sha256 digest is stored; Portal and the bridge never see, log or store them; not a platform credential kind (no K-number, no registry row).

## v0.1.58 additions (S1-0, C308: deploy outside Railway — HOST.md)
- Auth class `host` (K13 host assertion) and invariant **RT9**: the class only on `host.*` rows, `host.*` rows only that class. RT1 (owner CLI = reads, drafts, logout) unchanged.
- Rows (Provider Registry; 15 registries unchanged): `servers.list` GET `/servers?ws` (B,O) · `servers.get` GET `/servers/{srv}` (B,O) · `servers.detach` POST `/servers/{srv}/detach` (B; D C I; audit `server.detach`; S1 = stop + keep data + unpair) · `host.plans` GET `/host/plans?after&wait` (host; longpoll `application/jose`, ONE plan or 304; rate `host_poll`; bodyLog none; secret-bearing: carries the one-time enrolment code) · `host.report` POST `/host/reports` (host; rate `host_write`; bodyLog none).
- Device flow scope `host` (client `tealbrick-host` only): `DeviceStartInput` gains `DeviceStartHostInput`; `DeviceRequest.host` (key thumbprint + facts); `DeviceApproveInput.label`; `DeviceDecision.serverId`; `DeviceToken` gains `DeviceHostTokenResult` (no token). Approve with scope host = create the server + pin its key + `workspaces.set_infrastructure {own_infra, srv_…}` in one consent, one applied draft.
- Audit actions `server.pair`, `server.detach`. Rate classes `host_poll` (6/min), `host_write` (30/min), per server.
- `own_infra` with a `srv_…` destination = Core deploys through signed plans (HOST.md §8); readers that know only Railway tolerate it (L24).

## v0.1.60 additions (server detach modes)
- `servers.detach` input `ServerDetachInput {srv, mode?: "leave_running" | "stop"}`, default `leave_running` (the apps keep running on the owner's server; Portal stops managing them); `stop` stops every service, volumes kept. No mode deletes data. `Server.detachMode`. `DeployState` gains `unmanaged` and `stopped` for the instances of a detached server's workspace. The catalog overlay `DeploymentView` gains the same two values (no management actions apply; Core answers 409 `not_managed`). Host plans: the final plan carries `detach: {mode}`; error code `server_detached` for a plan after it. Conformance H-13..H-15 (HOST.md).

## v0.1.61 additions (own-server install)
- `Workspace.serverInstall {portalUrl, channel, zone} | null` (read only): the values the server install command needs; null when this Portal offers no own servers or the workspace already has infrastructure. The command text belongs to the host agent's installer. Conformance rows H-16..H-18 (HOST.md).

## v0.1.62 additions (pairing channel)
- `DeviceHostTokenResult.channel` (`"stable" | "dev"`): the chosen workspace's release channel; the host agent uses it from pairing on. `workspaces.update {channel}` on a workspace with a paired (not detached) server answers 409 conflict, `details.reason = server_channel_locked` (detach and pair again to change it). Conformance row H-19.

## C323 (owner API: the dev channel is staff only; no type change)
- `workspaces.update {channel: "dev"}` changes a workspace to `dev` only when the caller's Clerk user is an operator of the admin plane (`TB_ADMIN_OPERATORS`, any role). Any other caller gets 403 `forbidden`, `details.reason = channel_staff_only`, and nothing in the call is applied. With the admin plane off, nobody passes. A change to `stable` stays open to the owner (`server_channel_locked` still applies). `workspaces.create` has no channel field: a new workspace is always `stable`. Customer GUIs show no channel choice.

## C328 (owner API: optional access allowlist; no type change)
- With Core's `TB_ACCESS_ALLOWLIST` set (comma list of emails and `@domain` entries), a browser or owner-CLI request is accepted only for a Clerk user whose verified primary email is on the list (exact email, or exact domain), or who is an operator of the admin plane (`TB_ADMIN_OPERATORS`, any role). Any other caller gets 403 `access_restricted` with the message "This Portal is for the Tealbrick team." and no account is created. `owner_sessions.logout` stays open. Device-flow approval, server pairing and tickets are browser ops and pass the same check; the device exchange, bridge, host, public and webhook principals are not affected. Unset = off. `access_restricted` is an additive Core code (not yet in `ErrorCode`); the GUI shows the envelope message.

## v0.1.64 additions (C326, C332, C332a: Teal Brick Mobile; 6 rows)

### A. Owner client `tbm` and its push device
- `device.start` accepts `DeviceStartOwnerInput.client_id: "tbm"` (Teal Brick Mobile, scope `owner` only; no agent or host scope in this version). Core stores `owner_sessions.client = "tbm"` (not `cli`); idle limit `LIFETIME_S.ownerTbdSessionIdle` (7 d), same slide and absolute life as `tbd` (§5.4, C289). The owner approval screen labels it "TBM" and says in one line that this phone will be able to answer Inbox decisions (a phished code is a decision credential: review B1; the owner sees and revokes it in Sessions, every relayed write is audited).
- `push_devices.register` `PUT /owner-sessions/current/push-device` (`owner-cli`, `bodyLog: none`): one push device per owner session; a new call replaces the row. Refused `403 push_client_not_allowed` unless the session's stored client is in `PUSH.clients` (`tbm`). `appId` must be one of Core's configured app ids (`TB_PUSH_APP_IDS`), else `validation_failed`. The token is stored sealed, never returned, never logged; `OwnerSession.pushDevice` shows only `{platform, registeredAt}`.
- `push_devices.unregister` `DELETE /owner-sessions/current/push-device`: removes it (200 also when none).
- The row is deleted with its session: `owner_sessions.logout`, `owner_sessions.revoke`, idle or absolute expiry (at the next sweep, ≤ 1 h), account disable.
- Core sender (CORE changelog v0.1.64): kind `decisions` when the summed `Instance.pendingHolds` of a workspace goes UP in a bridge status report; one push per (workspace, kind) per `PUSH.minIntervalPerWorkspaceS`; to every push device of the workspace owner's live sessions. Payload = the fixed `PUSH.kinds` text + `{kind, ws}`; never a title, person, amount, app name or item id. APNs only in this version (FCM later, same rule). Sender failure (no config, provider error, timeout) never fails the status report; an APNs `410`/`BadDeviceToken` deletes that device row. A bridge that inflates `pendingHolds` can cause at most one push per minute (accepted).
- Kind `session_added` (C337): when `device.token` creates a NEW `tbm` session, Core sends `PUSH.kinds.session_added` + `{kind, osn}` to every OTHER push device of the same person (never to the new one). TBM shows the session's label and time from `owner_sessions.list` and one button "Not me" that opens Portal › Account › Sessions (`/account/cli`), where the owner revokes it in the browser (K3 never revokes other sessions: a phished session could otherwise end the real one). Core sends no email (no mailer) and creates no Inbox item (Portal never calls into customer infrastructure).

### B. Person-op relay for native owner sessions (`person_ops.call`)
- `POST /workspaces/{ws}/instances/{ins}/person-ops/{op}` (`owner-cli`, rate `person_op` 30/min per session, `bodyLog: none`, audit `person_op.relay`). Body: `input` (the op input, verbatim) + `idempotencyKey` (16..64 chars `[A-Za-z0-9_-]`, new per user action).
- Refusals, in order: K3 client not in `PERSON_OP_RELAY.clients` (`tbm` only in v0.1.64; never `cli`; `tbd` waits for its own design, CREDENTIALS v0.1.64) → `403 person_op_not_allowed {reason: "client"}`; workspace not the caller's / instance not in it → `404 not_found`; (instance product, op) not in `PERSON_OP_RELAY.allow`, or a `write` op from a client not in `writeClients` (only `tbm`) → `403 person_op_not_allowed {reason: "op"}`; input over `maxInputBytes` → `413 payload_too_large`; bridge without cap `person_ops` → `409 bridge_not_ready {reason: "relay_unsupported"}`; bridge not reachable (last pull > 120 s) or instance not running → `409 bridge_not_ready`; more than `queueMaxPerWorkspace` rows queued or taken → `409 conflict {reason: "busy"}`.
- Then Core serializes `input` ONCE (`JSON.stringify`, UTF-8), mints K14 (`typ tb-person-op+jwt`, iss `tb:portal` only, sub the person, aud `tb:ins:<ins>`, `ws`, `op`, `bd` = `sha256:` + lowercase hex of SHA-256 over those UTF-8 bytes (not the CORE §3 JCS digest), `idk`, `cli`, `pop`, life `LIFETIME_S.personOp` 10 s, one-time), stores `{pop, ins, op, jws, body}` SEALED (TB_KEK) for the workspace's bridge, and waits up to `coreWaitS` (12 s) for the result.
- Timing (review B3): a row the bridge has not TAKEN within `queueTtlS` (4 s) expires and is never handed out; the bridge forwards within `bridgeForwardS` (4 s); the app refuses a K14 after `exp` + `expLeewayS` (10 s + 2 s = Core's 12 s deadline), so nothing is DELIVERED after Core's answer. An op that was delivered may still FINISH after Core answered `504` (the app handler is not cancelled by the bridge's forward timeout). Therefore: a repeat of the same user action reuses its `idempotencyKey` (one effect); a decide op of an allow-listed app MUST be guarded by item state + an item version (Inbox `item_decide` `version`: a second decision on an item that is no longer open → `409`), conformance I-PO-1.
- Answer: `200 PersonOpCallResult {status, body}` = the app's own HTTP status and JSON body (output, or the app's CORE §8 envelope; the client reads `body.error.code`, e.g. `family_needs_portal`, `person_op_invalid`). Bridge result `status -1` (not delivered, did not run) → `502 upstream_timeout`; `status 0` (outcome unknown) or no result in time → `504 person_op_timeout` (the op may have run once; the client reloads before it lets the user act again); body not JSON → `502 upstream_timeout {reason: "invalid_body"}`.
- At rest: body, K14 and result are sealed and wiped (set to null) when the row is answered or expires; rows are deleted after 1 h. Audit `person_op.relay` details: `{client, product, op, outcome: "ok" | "app_error" | "timeout" | "not_delivered", appStatus}`. Never the input, output or K14.
- This keeps C16 B4: the K3 holder never receives K14 or any K11; Core never calls into customer infrastructure (CREDENTIALS §1) — the bridge pulls. §6 "Relay / hosted call queues" and "App data" are amended for this one, allow-listed, person-only path (C326); agent and tool traffic still never pass Core.
- Allow-list v1 (`PERSON_OP_RELAY.allow`): `inbox` → read `items_list`, `item_get`; write `item_decide`, `item_snooze`, `item_ack`. Any addition = spec patch + QA + a reviewed statement that the op's output carries no credential (RT7 cannot see inside the untyped app body). `tb.*` standard ops are never added except `tb.holds_list` / `tb.holds_decide`.
- Money and delete (C332a(4), review B2): structured holds (SDK receipts with families, e.g. money, destructive) are NOT reachable through the relay in v1 (`tb.holds_decide` is not on the list); they stay in the app / Portal. When Inbox items carry a hold (C277 A3 fan-in), Inbox `item_decide` with `via: "tbm"` refuses `family_needs_portal` for a listed OR missing family (fail closed). Plain agent asks (no hold attached) carry no executable action and are decided in TBM. An Inbox ask answer NEVER counts as approval of any SDK hold; only C277 A3 linking may connect an item to a hold, and that path fails closed (conformance S-PO-12).

### C. Bridge rows
- `bridge_api.person_ops` `GET /bridge/person-ops?wait=` (`bridge`, `json_slow`, rate `bridge_relay`): returns the queued, unexpired rows for this bridge's workspace at once and marks them taken atomically (never handed out twice), or an empty batch after `wait` s (≤ `pollWaitS`).
- `bridge_api.person_op_result` `POST /bridge/person-ops/{pop}/result` (`bridge`): `{status, body}`; only for a `pop` handed to this bridge and not yet answered (else `404 not_found`); body over `maxOutputBytes` → Core records `status 0`.

### D. `portal.info` (public)
- `GET /portal/info` → `PortalInfo {service: "tealbrick-portal", api: "v1", spec, name, ownerClients}`. A native client asks it before sign-in to a custom Portal URL (https origin only) and refuses any other `service` value; it shows the HOST (the trust anchor the person checks) and `name` before it starts the device flow (C332a(3)). It is NOT a trust check: any server can return the same JSON. Read-only, no account data.

## v0.1.63 additions (recipe setup: persona and model roles; C320, C322(3), C330(4), C331(4))
- Agent card: `AgentCard.persona` (markdown, ≤ 8,000 chars = `PERSONA_MAX_CHARS`; `""` = none). `agents.create` and `agents.update` take optional `persona` (update: `""` clears); longer → 400 `validation_failed`. Draftable as before, so recipes (`tealbrick.recipe/1`) and the setup screen set it in the one approval. Persona is display text for the GUI (escaped) and instruction text for the agent; it is never a secret and never holds key values.
- Bridge capability (QA-SPEC42-1): Core sends `agents[].persona` and `modelRoleRequirements[]` ONLY to a workspace bridge whose last authenticated `StatusReport.bridge.caps` contains `model_roles`; `KeyStatus.rolesSupported` = that fact (`null` before the first report). Without it the GUI shows "Update the workspace bridge to set models" and roles stay unset (apps with a required role report `needs_keys`).
- Signed config: `agents[].persona` (absent when empty) and `modelRoleRequirements[] {role, ins, product, required, minPolicy, usedBy}` from each deployed instance's manifest `settings.modelRoles[]` with `when` resolved against its settings (like `keyRequirements[]`). BRIDGE §15.
- `catalog.list`: `CatalogEntry.modelRoles[] {role, required, minPolicy, help?, when?}` so the setup screen lists roles before deploy.
- Core validates each `StatusReport.roles[]` row against `model-role-status.schema.json#/$defs/modelRoleStatus` (labels only, `additionalProperties: false`) and drops a row that fails; it stores only those keys.
- `keys.status`: `KeyStatus.roles[]` = one row per declared role per instance, from the latest `StatusReport.roles` (`set`, `policyOk`, `provider`, `model`, `dataPolicy`; `null` until the bridge reports roles). Core stores labels only.
- Update gate. Base rule (copied from C219 / C296b, Core): a version-changing update switches the bridge to the new release only when the AFTER report is "not worse" than BEFORE: a FAILED_BOOT attention code fails first; `ok` must stay `ok`; `degraded` passes only with exactly the same attention code(s) as before; `needs_keys` → `needs_keys` passes whatever its code; a new code, `failed` or no report rolls back.
  v0.1.63 extension (QA-SPEC42-8: the gate never trusts an app's own claim). An AFTER report whose ONLY attention code is in `MODEL_ROLE_ATTENTION` passes only when Core's OWN data show a configuration cause, from the bridge `StatusReport.roles[]` (cap `model_roles` required; without it the base rule applies unchanged):
  - `model_role_optional` (readiness `degraded`): at least one OPTIONAL declared role of the target manifest has `set: false` or `policyOk: false` in the AFTER roles, AND that role was not `set && policyOk` in the BEFORE roles or is new in the target manifest.
  - `embeddings_changed` (readiness `degraded`): BEFORE already reported `embeddings_changed`, or the `embeddings` row's `provider`/`model`/`dataPolicy` labels differ between the BEFORE and AFTER roles.
  - `model_role_missing` (readiness `needs_keys`): only through the base `needs_keys → needs_keys` rule; `ok`/`degraded` → `needs_keys` rolls back (a release that adds a role declares it optional first; an owner who wants a stricter policy changes the binding before the update).
  - A model code together with any other code, or with a FAILED_BOOT code, gets the base rule (exact codes; FAILED_BOOT fails first).
- Lowered data policy (QA-SPEC42-9): when a target release lowers a role's `minPolicy` (e.g. `zdr` → `standard`), the update review shows "This version accepts a less private model for <role>: <old> → <new>" and the update needs the owner's explicit consent, like a wider grant; a scheduled/automatic update stops at `held` for it. Raising `minPolicy` needs no consent (the bridge refuses more, never less).
- Drafts review: a step that sets or changes `persona` shows the full persona text (not a summary), because it becomes the agent's first instruction.
- `tickets.keys`: optional `roles[] {role, provider?, model?, dataPolicy?}` (≤ 8) → K11 claim `roles` (display pre-fill on the Keys and models page; never applied without the owner's submit).
- Setup screen (GUI, "Set up"): 1 Keys and models (`keys.status` roles + keys, button → `tickets.keys`), 2 Agents (name, purpose, persona), 3 Data sources (per agent: Connect accounts it reads; "Add a source" opens Connect), 4 Review and approve (`drafts.*`, C312.2). No new op.
- Foundry chat (C322(2)): Knowledge declares `reasoning` for its `deep` service; Foundry's model-run tools (`deep_ask` …) are ON by default when that role resolves (owner may switch them off) and reachable by agents through `knowledge__ask` and the data tool family. Replaces FOUNDRY-DESIGN v2 §4 "model off by default"; the Knowledge lead records it in the Knowledge design (this bullet is the authority).
