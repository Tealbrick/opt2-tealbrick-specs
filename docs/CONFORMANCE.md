# CONFORMANCE — what the conformance suite checks

Status: v0.1, Lead · Specs, 2026-10-11. Package: `@opt2-tealbrick/conformance` in `opt2-tealbrick-sdk` (REPOS.md).

## 1. Scope and status of the evidence
- Conformance proves that an implementation obeys the frozen interface specs (CORE, MANIFEST, CREDENTIALS, BRIDGE, PORTAL-API, SDK-API). It is a builder tool.
- **Conformance is NOT release evidence.** Release evidence = Lead · Adversarial QA's acceptance tests written from PRD-V2 and the journeys (`opt2-tealbrick-qa`). A green conformance run never replaces a QA verdict.
- It runs as ONE stage (`pnpm conformance`) in the ONE pipeline template from `opt2-tealbrick-platform`, in every repo that ships an app, the bridge or Core.

## 2. Targets
| Target | Run as | Counterparts used |
|---|---|---|
| App (any miniapp), Portal mode | `tb-conformance app --url <app> --manifest <file>` | fake bridge (+ fake Portal behind it) |
| App, standalone mode | `tb-conformance app --standalone` | none (app is its own issuer) |
| Bridge (deployed form) | `tb-conformance bridge --url <bridge>` | fake Portal, fake app(s) generated from the example manifests, fake agent |
| Bridge (relay form, CLI) | `tb-conformance relay --cmd "tealbrick bridge serve --stdio"` | fake deployed bridge |
| Portal Core | `tb-conformance core --url <gateway>` | fake bridge (enrol/pull/ack), fake device client, Stripe test fixtures |
| Manifest | `tb-conformance manifest <file>` | none (schema + cross-field rules + generators) |

## 3. Fakes are generated from the specs (cannot drift)
- The suite imports ONLY `@opt2-tealbrick/spec` and `@opt2-tealbrick/manifest` (S12: never miniapp-sdk or bridge, so the bridge is never tested with itself and there is no repo cycle).
- One **fake Portal** and one **fake bridge**, both built from `@opt2-tealbrick/spec` (JSON Schemas, `types/routes.ts` route table, workspace-config / instance-slice schemas) and `@opt2-tealbrick/manifest` (the real `verifyGrant`/`gate`/`authorize`, JCS, JWS). They do not re-declare any shape.
- The fake Portal implements exactly the `bridge`-auth and `device`-auth rows of the route table plus a test control API (mint config revision, pause agent, rotate key, revoke connection, go offline, issue codes/tickets). Unknown routes → 404 (default deny is itself checked).
- The fake bridge implements the bridge internal surface (`/tb/v1/claim`, `/tb/v1/keys/<name>`, `/tb/v1/call`, `/tb/v1/status`) and the bridge→app call path (grant + `TB-Call` proof, hook envelopes) with a control API (set context, inject failing hook, tamper proof, expire grant).
- Drift guard: a CI check fails when a fake's request/response validators are not the spec schemas by reference (digest of the imported schema set is printed in every report).

## 4. Checks (each has a real assertion; no "coverage: none")
IDs are stable; the report lists every ID with pass/fail and the asserted value.

### 4.1 Manifest (M)
- M1 schema valid (`tealbrick.miniapp/2`), strict objects, no unknown keys, no `legacy` values.
- M2 cross-field rules (create ⇒ idempotency `required`; crud/effect consistency; `money` ⇒ held; scopeType declared; hooks reference real ops; `when` references real settings; key names unique; `tb.`/`tb_` prefix reserved; MCP tool name `<product>__<op>` ≤ 64 chars).
- M3 digest = sha256(JCS) reproducible across two runs and two machines' outputs.
- M4 generators: MCP tool list, OpenAPI, Portal form/deploy steps, deploy recipe, per-app kit, skills inputs — regenerated output equals committed nothing (no hand-written copies exist: repo scan for `openapi.*`, `manifest.json`, `recipe.json` beside the manifest fails).
- M5 no product literal: Core, bridge, SDK source trees contain no product id from any example/real manifest (grep list built from manifests).

### 4.2 Credentials (C) — one case per kind, plus negatives
- C1 every kind K1–K12 + K2b: positive path verified with the documented verifier and checks in the documented order.
- C2 `aud` mandatory: missing, array, or foreign `aud` → refused (grant, agent session, pairing code, person ticket, call proof, assertions).
- C3 `typ` confusion: each token presented where another kind is expected → refused (e.g. person ticket as grant, grant as agent session).
- C4 **F4-1 class**: a person credential (Clerk session or owner CLI session) presented at the bridge MCP endpoint, the relay, an app op route, or any agent path → refused; and no agent-facing response, config, slice or instruction set ever contains a person credential (scan of all fake-captured payloads).
- C5 expired / not-yet-valid / wrong-issuer / unannounced `kid` → refused; rotated key: announced key accepted after activation, retired key accepted only until its tokens expire.
- C6 one-time codes: device code, pairing code, enrolment code, person ticket replayed → refused; codes stored only as digests (Core DB inspection hook in the Core target).
- C7 no 1-year bearer: no issued token has `exp − iat` above its kind's lifetime.
- C8 no shared secret: the app and bridge targets start with no secret env except their one-time enrolment code and the provider-generated `TB_KEK` (CORE I3); the app obtains keys only from `/tb/v1/keys`.
- C9 credential case ids from CREDENTIALS §18 (`cred.*`, e.g. `cred.p1.bridge_rejects_clerk_jwt`, `cred.p1.kit_cannot_get_owner`) are sub-ids of C1–C8/R8 and appear verbatim in the report.

### 4.3 Pause and revocation matrix (P) — every cell of CREDENTIALS' pause matrix
- P1 workspace kill switch, agent pause, connection revoke, instance pause: for EVERY path that reaches an app (MCP call, relay call, app→app companion call, hook call, key fetch, person launch where applicable) → refused at the documented enforcement point within the documented latency (online: next config revision, ≤ 60 s; asserted with the fake Portal's control API).
- P2 owner CLI session revoked → next CLI call refused; agents keep working (owner self-setup flow).
- P3 agent revoked → its sessions and refresh tokens refused; other agents unaffected.

### 4.4 Bridge (B)
- B1 public surface equals the documented list (MCP, OAuth AS endpoints + metadata, `/a/<product>/*`, declared `/p/<product>/<path>`, `/keys`, `/healthz`); any other path → 404; internal surface not reachable on the public listener.
- B2 enrolment: one-time code, own key pair generated, Portal stores only the public key; re-enrolment invalidates the old key.
- B3 config: signature verified, monotonic revision (older revision rejected), atomic apply, last good kept on a bad document, ack/status sent with key presence booleans only (no values — payload scan).
- B4 **Portal-down**: fake Portal goes offline → calls keep working; after signed config age > 12 h → bridge fails closed for agent and app→app calls; person launch and key page stay up.
- B5 `gate()` order: paused → no grant → CRUD → audience → scopeType → Bound workflow; Bound agent calling an op outside `wf` → refused.
- B6 hooks: order (phase, `order`, product id); failing/slow (> 2 s) `before` → refused (fail closed); failing `context` → refused; failing `after` → output withheld, receipt marked `after_failed`; hook calls never trigger hooks; context is extensible (unknown namespaced field passes through untouched).
- B7 MCP: `tools/list` equals exactly the agent-audience ops allowed by the agent's grants (+ dynamic list entries / search+call pair), never person-audience ops; changes after a config revision emit `list_changed`; skills served as resources with per-agent variables filled.
- B8 call path: app receives grant + valid `TB-Call` proof bound to op, input digest and context digest; tampered input → app refuses.
- B9 no tool payload or call metadata is sent to Portal (fake Portal records every request; only enrol/config/ack/status shapes allowed).
- B10 relay form speaks stdio only (no listener), holds no grants, keys or config (filesystem + memory snapshot check) and duplicates no checks; enforcement observed only at the deployed bridge.
- B11 key page: `pur: keys` ticket required; values written to the sealed store; never in logs (log capture scan) or status; app gets only manifest-declared keys with an instance assertion; undeclared key → refused.
- B11a (v0.1.6, C52): the keys-ticket POST response itself is the key form (200, Strict session cookie on that response, no 3xx); check id `B11.ticket_post_is_form`.
- B11b (v0.1.10, C59): every B11 key-page request (ticket POST, page GET, submit) is sent to the keys origin (`TB_KEYS_PUBLIC_URL`, `Host` = its host name). New checks: `B11.main_origin_keys_404` (main origin `/keys` → 404); `B11.keys_origin_only` (keys origin `/a/*`, `/mcp`, `/oauth/*` → 404); `B11.keys_origin_csp` (key-page responses carry `Content-Security-Policy` with `form-action 'self'`); `B11.keys_origin_unset_503` (bridge started without `TB_KEYS_PUBLIC_URL` → `/keys` 503).
- B12 OAuth AS: metadata documents valid; DCR + PKCE S256 enforced; pairing code redeemed offline; refresh rotation with reuse detection (previous token once within 30 s, CORE I12; other reuse → connection revoked); no custom pairing grant type at `/oauth/token` (S9).
- B13 bridge-op proofs (B5): `/tb/v1/bridge/{catalog,resolve,mark,scope-summary}` accept only the bridge-op call-proof variant; an op proof or hook proof there → refused; a bridge-op proof at `/tb/v1/ops/*` → refused.
- B14 standalone handover (B7): after the final config, apps accept bridge-issued grants and slices; Portal-key-signed tokens issued after the handover are refused; the admin surface has exactly 4 ops (pause/resume, revoke connection, ticket) — any other admin path → 404; adding agents/edges → not possible.
- B15 pairing path A: `tb-pair-state+jwt` one-time, `ret` must equal the bridge's own callback, tampered/expired state → refused; no bridge→Portal server call on the path.
- B16 limits: dynamic tool beyond the manifest ceiling → `dynamic_ceiling_exceeded`; hook re-entry → `hook_reentry`; companion call depth > limit → `call_depth_exceeded`; app with slice older than its validity → `slice_stale`.
- B17 skills: `<product>__tb_skills` read tool is listed for every agent with any grant on that app (S10); skill text is served as rendered by `renderSkill()` (no bridge-side filtering).
- B18 `pendingHolds` count reaches the status report (count only, no hold content) (S2).

### 4.5 App + SDK (A)
- A1 claim via the bridge with the enrolment code; instance key generated; no claim route other than the SDK's.
- A2 app re-verifies every grant (`verifyGrant`) and call proof; request without proof (direct call on the private network) → refused.
- A3 `authorize()`: scope access from the app store (`grant.crud ∩ access.crud`); held family → `{status: "held", holdId}`; Free caps exceeded → hold; `money` always held; no "always allow" record exists after an approval (C8).
- A4 holds/receipts: one table, one receipt shape; approvals only through person-audience ops (app GUI / TBD via launch); receipt stores input digest + redacted summary, never raw secrets.
- A5 idempotency: same key + same input → same result; different input → 409 `idempotency_conflict`.
- A6 person sign-in: launch ticket redeemed once; one session cookie, one CSRF header; standalone mode uses the same module.
- A7 data plumbing: migrations forward-only and repeatable from empty; backup to `TB_BACKUP_DIR` + restore round-trip; export produces the documented format.
- A8 default scope grants applied on first sight of an agent edge (C1 behaviour asserted with a generic manifest, not a product).
- A9 public address: app target fails if it listens on anything but the private interface in deployed mode (Railway template check: no public domain on app services).
- A10 post-approval retry (SDK §4.3): an approved hold runs only when the agent repeats the same input (same digest); a different input → new hold; no raw input stored for the hold.
- A11 every exported function of `types/sdk.ts` has at least one check; the list is generated from the exports at FREEZE and committed with the suite (a new export without a check fails CI).

### 4.6 Portal Core (R)
- R1 route table served at `/internal/routes` equals `types/routes.ts`; an op without a row is unreachable through the gateway (default deny); Core not reachable except via the gateway (deploy check: no public domain).
- R2 owner-cli auth class: only reads + `drafts.*`; any other mutation → refused; `drafts.apply` needs a browser person session and confirmation.
- R3 licence gate: unlicensed app → no grants, no edges in config, no launch ticket; `isEntitled(workspace, product, major)` single implementation (assign/move/unassign transitions).
- R4 no op accepts a key value (schema scan: no route input field holds a secret); key status returns booleans only.
- R5 no op exists for tool execution, connectors, channels, relay, Fleet, rooms, or app data (route table scan against the forbidden list in PORTAL-API).
- R6 signing keys sealed (DB contains no plaintext private key — inspection hook); Railway token sealed.
- R7 device flow (`/device/authorize`, polling): polling errors use the one error envelope with codes `authorization_pending`, `slow_down` (+5 s), `access_denied`, `expired_token`; codes one-time, 10 min, digests only.
- R8 device binding (B2/B3): no op lists pending device requests without a user code; `device.lookup` / `device.approve` require the user code (digest match; 6th wrong try in 10 min → locked); no output contains a clear user code; `scope=owner` with `client_id=kit` (or with a public key) → refused (`cred.p1.kit_cannot_get_owner`); an agent-scope request never yields K3; a batch request with 65 agents → refused, with 64 → one approval creates 64 connections (S4).
- R9 owner-cli outputs: no route reachable with K3 returns a one-time code, a pairing code or a person ticket (route-table scan, S1/B4); K3 idle > 24 h (client cli) or > 7 d (client tbd, v0.1.53 C289) → refused.
- R10 idempotency store never holds a response of a `bodyLog: none` row; replay of such a request → 409 `idempotency_conflict` (B8).
- R11 onboarding order (B1): after `workspaces.set_infrastructure` the bridge is enrolled and an agent can be authorised (device flow and pairing) before any app is deployed; licence-last (R4): deployed unpaid app → `entitled:false`, no grants, no launch ticket; after the Stripe test webhook → next config revision carries grants.
- R12 pairing approval (S3): Core refuses `pairing.approve` when the bridge's workspace does not belong to the principal; approval view returns the redirect host and the client name flagged unverified.

## 5. Version matrix
Every target runs against the current SDK major and the one before (bridge and Core must accept both; apps built with either must pass). Older majors are expected to fail with a clear `sdk_major_unsupported` error.

## 6. Report shape
JSON (machine) + markdown (human): target, spec digest, SDK versions, every check ID with result and asserted value, captured-payload scan summary. Exit code 0 only if every check passes.

## Checklist mapping
| Checklist (CONFORMANCE) | § |
|---|---|
| Targets apps (Portal + standalone), bridge, Core; one fake Portal + one fake bridge | §2, §3 |
| Every check has a real assertion; every SDK function and credential kind covered | §4 (C1 per kind; A11 generated per `types/sdk.ts` export at freeze), §6 |
| Negative cases (person token, aud, expired, pause every kind, Bound, held, failing before hook, public address) | C4, C2, C5, P1, B5, A3, B6, A9 |
| Portal-down case | B4 |
| Drift check generated vs manifest; no product literal | M4, M5, §3 drift guard |
| Version matrix | §5 |
| Not release evidence | §1 |
| One CI stage | §1 |

## Open questions
1. A9 "app has no public address" can only be asserted from the Railway template / deployment record, not from inside the app. Recommendation: Core's deploy adapter asserts it at deploy time and conformance checks the generated template; QA checks the live project.

## v0.1.10 additions (C59)
- Bridge target: the suite sets `TB_KEYS_PUBLIC_URL` in the bridge env (a second host name that reaches the same public listener) and sends every key-page request with that origin/`Host`; B1's documented public list is per origin (main: everything except `/keys`; keys: `/keys`, `/healthz`, `/readyz`). New check ids `B11.main_origin_keys_404`, `B11.keys_origin_only`, `B11.keys_origin_csp`, `B11.keys_origin_unset_503` (§4.4 B11b). Package `@opt2-tealbrick/conformance` 0.1.6.

## v0.1.11 additions (C62/C63, BSD-07, C70) — package `@opt2-tealbrick/conformance` 0.1.7
- §4.1 **M6.paths** (C70): build paths resolve from the repo root (`--repo <dir>`), skill files from the manifest's directory (MANIFEST §3); without `--repo` M6 is `not_applicable`. **M2.hook_ops** reports own vs foreign hook counts (foreign hooks: checked by Core at chain resolution, M-HK-3); `not_applicable` without an own-product hook.
- §4.5 **A12 companion calls** (C70): outbound grant / envelope / `parentCall`, `grant_stale` retry (one slice re-read, one retry), inbound bound caller (ids `A12.companion_inbound`, `A12.companion_call`, `A12.companion_refresh_retry`; present since 0.1.6).
- §4.5 **A13 key-set rule on slices** (CREDENTIALS §9.5): `A13.kss_pinned` (first slice with a root-signed `portalKeySet` installed and pinned), `A13.portal_keys_ignored` (a key added only to `portalKeys` cannot sign grants), `A13.kss_unknown_root`, `A13.kss_rollback`, `A13.kss_missing` (each: slice not installed), `A13.kss_rotation` (3 statements), `A13.kss_compromise` (slice and grants by the dropped kid refused at once).
- §4.4 **B20 key-set rule at the bridge**: `B20.kss_enrolled`, `B20.portal_keys_ignored`, `B20.kss_unknown_root`, `B20.kss_rollback`, `B20.kss_missing`, `B20.kss_compromise` (each negative: the forged config is not acked and its forged pause has no effect).
- C63a: `B20.kss_reenrol_missing` (a bridge with a pinned statement re-enrolled with a fresh code whose `EnrolResponse` carries no `portalKeySet`, then one by an unknown root: re-enrolment refused, the old key and pinned statement kept — a following config with the statement is applied under the old identity). Strict checks (always on with `--test-roots`; conformance 0.1.16 removed the `--keyset-required` / `--keyset-transitional` flags, C133): `A13.kss_first_missing` (an app on a fresh data dir receives a first slice without a statement and must refuse it) and `B20.kss_enrol_missing` (a bridge on a fresh data dir receives a first `EnrolResponse` without a statement and must refuse the enrolment). The fake bridge / fake Portal emit `portalKeySet` from the first slice / enrolment.
- §4.4 **B21 app addresses** (BSD-07, BRIDGE §5.7): `B21.own_infra_allowed`, `B21.internal_url_external` (foreign `internalUrl` with `ownInfra` but not allow-listed → not routed, 0 requests at that origin, `rejected[] internal_url_refused`), `B21.own_infra_flag_required` (allow-listed origin without `ownInfra: true` → not routed), `B21.neighbour_url_refused` (403 `internal_url_refused`). The fake apps run on the suite's host, so the world lists them as `ownInfra: true` entries and the runner sets the bridge env `TB_OWN_INFRA_ORIGINS` to their origins (the owner-set allow-list; Portal never sets it).

## 7. Test roots (v0.1.11, C63)
A bridge or SDK build pins its channel's Portal Root Keys; a conformance run cannot sign statements for them, and no production code path reads a root key from env. The honest approach:
- The runner generates a TEST root pair and, only with `--test-roots`, passes its public JWKs as `TBCONF_PORTAL_ROOT_KEYS` (JSON array) in the env object it hands to the start module. The name is harness-only: not a `TB_*` name, never read by the SDK or the bridge, never set by Portal.
- The start module (test harness) passes it to the programmatic start option: `startApp(app, env, { portalRootKeys })` (SDK-API v0.1.11) or the bridge's equivalent start option (Lead · Bridge adds one: `startBridge({..., portalRootKeys})`).
- Without `--test-roots`, A13 (app) and B20 (bridge) report `not_run` with that reason; the fake Portal / fake bridge then emit no `portalKeySet` (a product that pins roots refuses them, so use this only for products without roots wiring). With `--cmd` the name reaches the process env; only a harness entry that passes it to the start option wires it (a product `main.ts` never does) — otherwise use no `--test-roots` and A13 / B20 stay `not_run`.

## v0.1.12
- The strict key-set checks (`A13.kss_first_missing`, `B20.kss_enrol_missing`) run whenever `--test-roots` is given (the default). `R1` explicit public rows include `portal.signing_keys` (C79).
- Claim guard (spine S1): the app runner always sets `TB_DATA_EPHEMERAL=1`. New check `A1.reclaim_on_new_code`: the fake bridge forgets the instance key; a restart with the SAME code makes no claim (health `attention: identity_refused`); a restart with a NEW code makes one claim, then an accepted status push. The mount rule itself is unit-tested in the SDK (no portable mountinfo fixture for a black-box runner).
- Read-only apps (Fleet): when no agent op is holdable (no write/outward/destructive/money effect, no holdFamily), the hold chain (`A3.hold`, `A4.hold_status`, `A4.decide_person_only`, `A4.holds_list`, `A4.receipt_digest`, `A10`, `P1.held_release_paused`, `A3.no_standing_approval`) reports `not_applicable`; the P1 pause cells call the read op without hold caps; `A7.restart` / `A1.key_persisted` check the claim record and instance key; `A7.backup_roundtrip` checks the archive and a restore boot.
- Bridge with `--test-roots` over ALL groups in one pass (Lead · Bridge): the C5 Portal key rotation re-signs the key-set statement (seq + 1) with each rotation step; the B14 standalone world carries the statement on the final Portal-signed `standalone` document (§9.5), only later bridge-issued documents drop it.

## v0.1.13 — package `@opt2-tealbrick/conformance` 0.1.9
- **Bridge:** `B22.hold_verdict` (a before hook answers hold → the call is forwarded with `hv` in the proof; refuse > hold > allow; a later refuse wins), `B22.hold_retry_refused` (approval granted, then the hook refuses the retry → `hook_denied`, the app is not called), `B22.hv_tamper` (an edited `hv` fails proof verification at the app), `B23.on_behalf_of` (the `_meta` claim lands in `tb.onBehalfOf` unverified; oversized → dropped), `B23.reserved_tb_namespace` (a context hook writing `tb.*` → `hook_failed`), `B24.app_initiated` (a call without `parentCall` passes the pipeline, hooks see caller app), `B24.no_grant` (undeclared op → refused).
- **App:** `A14.hook_hold` (proof with `hv` → `held`, receipt `heldBy`, family `policy` allowed), `A14.hold_retry_once` (after approval the same input with `hv` runs once; another input → new hold), `A14.scope_wins` (a scope refusal beats `hv`), `A15.holds_pending` (summaries only; agent sees own holds; companion app sees all; paging), `A16.call_outside_handler` (observed only: an app-initiated call (no parentCall) seen by the fake bridge must carry a valid assertion and the app's companion grant; n/a when none is seen), `A17.pending_count` (status `pendingHolds` ≥ the suite's open holds and drops after a decision), `A17.status_changed` (a status push with the new count within 2 s after a hold is created). `agentsChanged` is covered by SDK unit tests (not observable black-box).
- **Bridge with a REAL SDK app (C91):** group `real_app`: one app behind the bridge under test is a real `@opt2-tealbrick/miniapp-sdk` app (not a fake) — `B25.real_catalog_search`, `B25.real_dynamic_call`, `B25.real_op_call`, `B25.real_mark`. The fake apps and the fake bridge use the shared `bridgeOpBinding` / `bridgeOpProofClaims` (they bound `in` for every bop before, which hid QA S1).
- **Manifest:** `M-CP-3` wildcard companion rule.
- **Core (live/QA; NOT in package 0.1.9 — QA runs them live until a later package adds them):** `C-CO.wildcard_other_op` (wildcard on another op refused at deploy), `C-CO.wildcard_needs_consent` (no grants before consent; revoke removes them), `C-T.launch_path` (`..`, scheme, host, `//` → `path_invalid`).
- **Fixes (Inbox, Fleet):** `A5` tampers a free-text string field (no `enum`, `pattern`, `format` or `const`), else a schema-valid variant of another field, else n/a — apps never reorder inputs to pass. `A4.mark_after_failed` → n/a when no agent op has `receipt: true`.
- **Waivers (Fleet, C89):** `--waive <checkId>@<untilVersion>` (repeatable) or `tealbrick-conformance.json {waivers: [{id, until, reason}]}`: a waived failing check reports `waived` (not counted) while the conformance package version < `until`; at or after `until` the waiver is ignored and noted. Unknown ids → usage error. `--allow-not-run` stays but is discouraged.
- Release order note: conformance depends on miniapp-sdk (real_app group), so tags go manifest → miniapp-sdk → conformance, each after the previous release asset exists.

## v0.1.14 — package 0.1.10
- `B8.idempotency_derived` (C98) replaces `B8.idempotency_required`: a required op called without `_meta` succeeds with a non-empty forwarded key; an identical retry in the same session gets the same key; another input gets another key. Mini-bridge fault `noDerivedKey` must fail it.
- `A14.hold_retry_once` tries schema-valid variants until one is not refused by the app (a variant that targets an unreachable scope instance proves nothing about holds), as `A10` does. Found by the template 0.1.7 proof.

## v0.1.15 — package 0.1.11
- `M2.hold_family_known` (C105): every op `holdFamily` ∈ `KNOWN_HOLD_FAMILIES` (and never `policy`); fails otherwise (the rule is also the schema enum; the check proves the app was validated against THIS vocabulary).
- Fakes (L1): the fake bridge/Portal mint agent and companion grants with `held = DEFAULT_HELD_FAMILIES`, and build slices from the shared shape incl. `companionTargets` / `companionCallers`; new app check `A12.caller_name` (C102): a companion app caller listed in `companionCallers` reaches the handler with `caller.name` = that name (the template exposes it in receipts: `caller.name` of the receipt row), and an unlisted caller gets its instance id.
- `B8.idempotency_derived` also covers a `supported` op (C98a).
- `A12.app_caller_held` (C105a): an app caller whose companion grant `held` = `DEFAULT_HELD_FAMILIES` calls a `first_contact` op → `held` with a holdId; after approval the same input + the same idempotency key → runs once; the same call again → held again (C8). n/a when the app has no first_contact op.
- (C107) `M2.outward_family`: every op with effect `outward` declares a holdFamily. **Warn-only in 0.1.11** (status pass, asserted text starts `WARN:` and a report note lists the ops) because Connect v0.4.0 has 11 agent ops + 1 person op without one; **fail from 0.1.12**. `B16.resolve_family` / app `A11.resolve_family`: a `resolve` answer with effect `outward` or `money` and no `holdFamily` FAILS (no released app is affected: dynamic resolutions are runtime answers; Connect fixes them in its next release).
- (C108) `C3.grant_held_unknown`: a grant with `held: ["destructive", "future_x"]` is ACCEPTED (not `grant_invalid`) and a `destructive` op is still held; bridge side `B5.grant_held_unknown`: the bridge forwards calls under such a grant.
- (C107, BRIDGE v0.1.17) `B16.resolve_family` asserts the refusal shape: `dynamic_resolve_failed` with `details.reason: "family_missing"` (conformance 0.1.11).

## v0.1.18 — package 0.1.12 (Knowledge sweep; Connect F21)
- **Setup fixtures** in `tealbrick-conformance.json` (beside the manifest; `--inputs` stays and is merged, the file wins per key):
  ```json
  {
    "setup": [
      { "id": "owner_area", "as": "owner", "op": "tb.scopes_set", "input": { "...": "..." } },
      { "id": "app_area", "as": "app", "op": "area_create", "input": { "name": "conformance" }, "capture": { "appArea": "/id" } }
    ],
    "inputs":   { "<opId>": { "area": "${appArea}" } },
    "inputsAs": { "app": { "<opId>": { "area": "${appArea}" } }, "agentB": { } },
    "dynamic":  { "<dynamicOpId>": { "resolveTools": ["<tool name>"] } }
  }
  ```
  `setup` runs once after the first status push, before the checks, in order; `as` ∈ `owner` (person session) | `agentA` | `agentB` | `app` (the suite's companion app caller, the same identity A12.* uses); `capture` maps a name to a JSON pointer into the step's `output`; `${name}` placeholders (whole string values only) in later `input`, `inputs` and `inputsAs` are replaced by captured values. A failing setup step → every check that needs its captures reports `not_run` with the step id and answer (never a silent pass). `inputsAs.<caller>` overrides `inputs` for that caller. `dynamic.<op>.resolveTools` = tool names the dynamic checks (A11.*, A11.resolve_family) resolve instead of taking them from the catalog; the app's conformance start module makes them resolvable (e.g. a stub engine behind a harness-only env such as `TBCONF_STUB_ENGINE=1`); a resolve that answers null for a listed tool FAILS (the app promised it).
- **Fakes (L1, Connect F21):** the fake bridge's slice carries `agents[].scopeRequest` for agent A (`{product: <self>, kind: "connect_inbox", createName: "conformance"}`); new app check `A12.scope_request` is n/a by default (black-box apps need not expose it) — the SDK's `ctx.agentScopeRequest(agt)` is covered by SDK unit tests.
- `M2.outward_family` FAILS from 0.1.12 (SDK sweep: no released app warns; Connect v0.5.0 declares all families). The manifest VALIDATOR keeps its grace for an absent outward family (older releases such as Connect v0.4.0 stay deployable by Core); it refuses it from the first manifest release after every deployed workspace runs a release with families (Coordinator decides).
- Stub resolvers (Knowledge, Coordinator rule): a stub behind `resolveTools` MUST live only in the app's conformance harness (`conformance.start.ts` + a harness-only env such as `TBCONF_STUB_ENGINE`); no product code path may read that env, so the stub is unreachable in the shipped image. The app's own tests assert it (e.g. a source scan: no file under `src/` reads `TBCONF_*`).
- (v0.1.31, SDK-02/SDK-04) `A3.caps_count`: a fresh agent (added to the slice for the check) with caps `{<effect>: {max: 1, per: hour}}` — the first call of a capped op runs, the second is held `caps`; checked for a `receipt: false` op and a `receipt: true` op when the manifest has them (`max: 0` alone cannot see a cap that never counts).
- (C111a) `B5.free_wf_limits` (Free grant with non-empty wf → an op outside wf refused `not_in_workflow`), `B5.free_wf_caps` and `A3.free_wf_caps` (Free grant with wf + caps → caps still hold).
- Placeholders (0.1.12, as built): besides captured names, built-ins `${tb.agentA}`, `${tb.agentB}` (the suite's agent ids), `${tb.app}` (the suite's ONE companion app caller instance — the same identity in setup `as: "app"` and in every A12.* check) and `${tb.instance}` (the app under test). A setup step `as: "app"` runs under a companion grant with `held: []` (setup must not create holds). A dynamic tool the bridge filters from `tools/list` may answer `unknown_tool` in A11.* (accepted, noted).
- `B25.real_hook_hold` (real_app, L2): a REAL SDK app's before hook answers `{allow:false, hold:{family:"policy", …}}` through the bridge under test → the target op comes back held with that reason (an SDK ≤ 0.1.15 answered 500 hook_failed → the call was refused, never held). Mini-bridge fault "treats hold as hook_failed" fails it.

## v0.1.21 — package 0.1.13 (queued)
- **No fixed port:** for a `start(env)` app the runner binds a free port and passes it as `TBCONF_PORT` (harness-only); the start module hands it to `startApp(app, env, {port})` and returns `url` from `RunningApp.port` (template ≥ 0.1.9). A report note prints the port; a start module that ignores it keeps `runtime.port` and the note says so. A caller pins it with `env: {TBCONF_PORT}`. Two runs on one machine never clash.
- Example (Knowledge 0.1.12): an app without an area-create op captures agent A's area in a setup step (`as: "agentA"`, `capture`), then an owner step (`as: "owner"`, op `tb.scopes_set`) grants that area to `${tb.app}`; `inputsAs.app` then uses the captured id. A12.caller_name and A11.resolve_family pass without waivers.

## v0.1.23 — package 0.1.14 (queued, C115)
- `A11.narrowing_empty_anyof`: the suite sends a read with context `rules.narrowing {v: 1, ruleId, reason, memoryTags: {anyOf: []}}` to an app that declares tag-filtered reads (fixture: `tealbrick-conformance.json` `narrowing: {op, input}` names the read op; n/a without it) → the answer contains NO items (or `narrowing_unsupported`). An app whose filter treats an empty `anyOf` as "no constraint" (returns items) FAILS. Plus `anyOf: ["<a tag the setup created>"]` → only matching items; absent `memoryTags` → unfiltered.
- (C117) `B27.hook_declared_absent`: a matching hook DECLARED by a deployed app (its manifest) but absent from `config.hooks` → the bridge refuses `hook_failed` and does not forward (FAIL if forwarded); `B27.hook_disabled_skipped`: listed with `enabled: false` → skipped, call forwarded; `B27.hook_app_down`: listed and enabled but its app is down → `hook_failed`; real_app: `B25.real_hook_after_update` — the real SDK gate app restarts with a new release while a call is made → refused or gated, never ungated.
- (C117, Bridge lead) In the bridge-target worlds, "hooks off" lists every declared hook with `enabled: false` (never omits it), so checks that switch hooks off stay valid against a C117 bridge.
- package 0.1.15 (Knowledge sweep): `narrowing.itemsPath` (JSON pointer) names the result items array in the op output; default = the output itself when it is an array, else its ONLY array field; several array fields and no `itemsPath` → `not_run` naming them (0.1.14 counted every array field, so a status list gave a false FAIL).
- package 0.1.16 (C133): the CLI flags `--keyset-transitional` and `--keyset-required` and the `keysetRequired` run option are removed (no transition rules to test); the strict key-set checks always run. Breaks earlier opt2 dev formats.

## v0.1.57 — package 0.1.28: app events (C274c, C274d)
Rows (normative text: MANIFEST §16, BRIDGE §14, SDK-API §20):
- **Manifest (M2 block, from `validateManifest`):** `M-EV-1` names unique, pattern, no `tb.`, no events in a manifest `tb`; `M-EV-2` payloadSchema
  compiles, object root, ≤ 8 KiB, M-OP-8 limits; `M-EV-3` `visibleWith` = an agent op of the manifest, not dynamic;
  `M-EV-4` no top-level `summary` in the payloadSchema.
- **App (A-EV, fake bridge):** `A-EV-1` a declared change emits exactly one event; `A-EV-2` a rolled-back transaction emits
  nothing, a committed one followed by a throw still emits; `A-EV-3` invalid payload / undeclared name / `tb.*` name throws; `A-EV-4` bridge 503
  then retry → stored once (same key); `A-EV-5` slice without `"events"` → nothing sent, cap appears → backlog in order;
  `A-EV-6` scoped emit: `eligible` lists exactly the agents whose row admits `visibleWith.crud`, with the row's authority;
  `A-EV-7` a scope row removal, narrowing or owner→bounded change sends a `purge` after the earlier events, and
  `ctx.purgeEvents` sends an all-agent purge; `A-EV-8` `tb.hold.decided` to the agent caller on
  approve, deny and expiry, never to an app caller.
- **Bridge (B-EV, gated by the reported `"events"` cap, never by version):** one row per case listed in BRIDGE §14.4
  (numbered B-EV-1.. in that order by the conformance package). The row that certifies the cap passes only when every
  other B-EV row PASSED (not "not applicable") and the cap is in every status report the run saw. A bridge WITHOUT the
  cap must answer `tealbrick/events/*` with JSON-RPC -32601 (one row).
- **Runtime (R-EV, Agents lane, against the fake bridge):** as PLAN-P2-PORT-WAKE §5 (`R-EV-1`..`R-EV-6`).
