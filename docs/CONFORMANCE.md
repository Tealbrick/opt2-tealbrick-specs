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
- C1 every kind K1–K14 + K2b (v0.1.58 K13, v0.1.64 K14): positive path verified with the documented verifier and checks in the documented order.
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
- A8b v0.1.65 (C331 D5b/D8) scope summary: for an agent with no row of a type that declares `summaryEmpty`, the `scope_summary` label contains that text; each answer row carries `sources` = exactly the agent's rows (type, the app's own scope instance id, instance label ≤ 60 without `\p{Cc}`/`\p{Cf}` characters, access id; a label with a zero-width or bidi character arrives without it), ≤ 20, `[]` for an agent with none; the fake bridge forwards them in `StatusReport.scopeSummaries[].sources` and drops a malformed item. Generic manifest, not a product.
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
  other B-EV row PASSED (not "not applicable") and the cap is in every status report the run saw. Rows that need volume
  (retention, rate limits) get their own time budget; when only such rows did not RUN within it, the certifying row is
  `not_run` (never a fail of a compliant but slow bridge, never a pass). A bridge WITHOUT the
  cap must answer `tealbrick/events/*` with JSON-RPC -32601 (one row).
- **Runtime (R-EV, Agents lane, against the fake bridge):** as PLAN-P2-PORT-WAKE §5 (`R-EV-1`..`R-EV-6`).

## v0.1.57 — package 0.1.29: relay event duties (C274; Agents lane rows) and the planned runtime target
Normative text: BRIDGE §14.3 client duties. Rows are gated by what the fake side OFFERS, never by the relay's or host's
version (C292 pattern).
- **Relay target** (`tb-conformance relay --cmd "<stdio relay command>"`); rows run only when the fake upstream offers
  `tealbrick/events/*`, else `not_run`:
  - `B10.events_forwarded` — `tealbrick/events/stream` reaches the upstream (same id) and its answer comes back unchanged;
    a `notifications/tealbrick/event` frame (SSE `id:` = event id) on the subscribed GET stream appears on stdout as the
    whole JSON-RPC message, deep-equal.
  - `B10.events_last_event_id` — the upstream ends the GET stream; the relay's next `GET /mcp` carries `Last-Event-ID` =
    the id of the last event frame.
  - `B10.events_resubscribe` — the upstream forgets every session (404); the relay sends `initialize`, then
    `tealbrick/events/stream` on the NEW session with `cursor` = the last event id, opens a GET on it, and the next event
    reaches stdout; the suite sends nothing meanwhile and the relay writes no answer of its own to stdout (no
    result/error, no second answer to an id).
  - Fake upstream session model for these rows: a session id it never issued, forgot or ended → 404;
    `tealbrick/events/stream` without a session → 400; event frames go only to GET streams of a subscribed session.
- **Runtime target** (planned, package after 0.1.29): `tb-conformance runtime --cmd "<agent host command>"
  [--login-cmd "<agent login command>"] [--timeout <ms>] [--report <base>]`; the suite plays the bridge with the shared
  fake bridge and records every turn (prompt, time). Rows need the fake bridge to report `"events"`, except R-EV-6:
  - `R-EV-1` one event for one subject → exactly one turn naming the subject; the cursor is stored only after the turn.
  - `R-EV-2` the host stops during a turn → on restart the unhandled event gives one turn, a handled one none; a re-id'd
    event (same `origin`) gives no second turn.
  - `R-EV-3` `stream` refused → `poll` delivers within 60 s; `stream` back → polling stops; no cron/scheduler entry.
  - `R-EV-4` 10 events on one subject within 2 s → one turn; another subject → its own turn.
  - `R-EV-5` a fresh agent directory with only the login and a grant receives events; no event key in any config file.
  - `R-EV-6` a bridge without the cap (-32601) → the host keeps its own polls, reports no error, stores no event state.

## v0.1.58 — host contract rows H-1..H-11 (S1-0, HOST.md §9)
Machine-readable: `HOST_CONFORMANCE` in `packages/spec/src/host.ts` (id, title, given, expect, policy rule, target). Targets: `agent-unit` = the host agent's own unit tests against plans signed by a test key set; `box-probe` = the probe suite on a real box (QA lead); `both`. The spec package itself tests the schema side (`test/host.test.ts`: every `HOST_FORBIDDEN_KEYS` key refused at every level, reserved/unknown action kinds, tag-only images, system mount paths, secret-like values).
- H-1 bad signature refused · H-2 wrong server refused · H-3 replay (same seq) refused · H-4 expired refused · H-5 image not in index refused · H-6 downgrade refused (the one-step rollback allowed) · H-7 undeclared env name refused (+ secret-like value) · H-8 forbidden runtime settings refused · H-9 stop keeps the volume · H-10 TB_OWN_INFRA_ORIGINS matches the running tb- services · H-11 firewall probe from an app network · H-12 container outside the allowlist stopped (forbidden runtime settings; reported in `escapes`). v0.1.60: H-13 detach leave_running stops nothing · H-14 detach stop stops every service and keeps the volumes · H-15 no plan after a final plan (`server_detached`). v0.1.61: H-16 pairing by device flow · H-17 pairing key pin · H-18 public route for the bridge only. v0.1.62: H-19 pairing takes the workspace channel.
- Core side (Portal Core tests, not this package): approve with scope host creates the server + sets the infrastructure in one consent; `host.plans` serves only unexpired plans with seq > after; a detached server gets only its final stop plan, then 401.

## v0.1.64 — person-op relay and TBM rows (C326, C332; package version set at release)
- Core: C-PO-1 `cli` K3 → 403 {reason: client}; C-PO-2 `tbd` K3 → 403 {reason: client} for every op, reads included (C337b); C-PO-3 op outside the allow-list → 403; C-PO-4 bridge without cap → 409 relay_unsupported; C-PO-5 row not taken in `queueTtlS` is never handed out; C-PO-6 two concurrent polls never get the same pop; C-PO-7 result for a pop of another bridge → 404; C-PO-8 status -1 → 502, 0 → 504; C-PO-9 audit row without input/output; C-PO-10 K14 claims exact and `bd` = hex over the forwarded bytes; C-PO-11 sealed at rest, wiped at end; C-PO-12 K14 `exp` + `expLeewayS` ≤ the row's Core answer deadline (no app run after Core answered); C-PU-1 push register refused for `cli`/`tbd`; C-PU-2 push row deleted on logout/revoke; C-PU-3 one push per ws per 60 s, payload exactly `{aps, kind, ws}`; C-PU-4 sender failure never fails the status report; C-PU-5 a new tbm session → exactly one `session_added` push to each OTHER device of the person, none to the new one.
- Bridge: R-PO-1..6 (BRIDGE §16). SDK: S-PO-1..12 (SDK-API §21). Inbox: I-PO-1 `item_decide` on an item that is not open, or with a stale `version` → 409, one effect.

## v0.1.63 — model roles and persona rows RM-1..RM-12 (C322(3), C330(4), C320)
Source plan: coordination `leads/recipe/PLAN.md` §4. Target per row in brackets.
- `RM-1` [manifest package] `settings.modelRoles` validates; M-MR-1..5 each refuse their bad case with their code.
- `RM-2`..`RM-7`, `RM-12` [bridge] as BRIDGE §15.7.
- `RM-2`..`RM-7` detail and negative cases: BRIDGE §15.7 (9 policy pairs, paused, service caller, override no fall-back, stored zdr re-check, URL negatives, persona 8,000/8,001, key delete).
- `RM-8` [Core] persona > 8,000 chars → `validation_failed`; the GUI renders it escaped.
- `RM-9` [Knowledge + GUI] Knowledge without `embeddings` reports `degraded` + attention (not `needs_keys`) and the GUI opens it with the attention banner.
- `RM-10` [GUI] with 12 agents and 5 declared roles the setup screen renders exactly ONE roles table (5 rows) and 12 agent rows, all collapsed by default (0 expanded), each with a one-line summary; a unit test asserts these counts.
- `RM-13` [Core + bridge + GUI] no key value, key name or base URL reaches Portal: canary values from BRIDGE §15.7 → zero hits in StatusReport bodies, Core logs, Core DB dump, GUI network traffic; plus a Core unit test that ingests a role row with injected `baseUrl`/`key`/`keyName` and proves it is dropped.
- `RM-14` [Core] update gate (PORTAL-API v0.1.63): PASS — needs_keys → degraded `model_role_optional` with that optional role unset before and after; ok → degraded `model_role_optional` for a role NEW in the target manifest and unset; degraded(`embeddings_changed`) → same; ok → degraded `embeddings_changed` with changed embeddings labels. ROLL BACK — ok → degraded `model_role_optional` with every role `set && policyOk` before and after (app self-report); degraded(X) → degraded(`model_role_optional`) with roles configured; degraded(X) → degraded(X + `model_role_optional`); FAILED_BOOT code + model code (fails first); ok → degraded `embeddings_changed` with unchanged labels; ok → needs_keys `model_role_missing`; any model code from a bridge without cap `model_roles`.
- `RM-14b` [Core] (QA-SPEC42-10) ROLL BACK — ok → degraded `model_role_optional` when the BEFORE report has no row for that role (no cap / not reported) and the role is not new in the target manifest; degraded(X) (non-model) → degraded(model code). [SDK] an app with a fault and an unset optional role reports the fault code, not `model_role_optional`.
- `RM-15` [Core + GUI] a target release that lowers a role's `minPolicy` shows the notice and waits for owner consent (`held` when scheduled); raising it needs none.
- `RM-16` [Core] persona and `modelRoleRequirements` go only to a bridge with cap `model_roles`; a bridge without it gets neither and `KeyStatus.rolesSupported` is `false`; a bridge that declared it and then reports without it gets the next config without them (no latch).
- `RM-18` [GUI + bridge] every `zdr` label reads "zero data retention (owner-attested)" and owner-listed `local` reads "local (owner-listed, not verified)" (`policyBasis`); a gateway attestation (incl. an overridden base URL) names the host.
- `RM-19` [bridge + SDK + tb-exec] every row of `packages/spec/examples/local-check.cases.json`: same class and canonical form in all three; the stored/served base URL is always the canonical form.
- `RM-20` [SDK + tb-exec] connect-time guard: a `local` binding whose name resolves to a public address, to 169.254.169.254, to `::ffff:169.254.169.254`, to `fd00:ec2::254`, to a mix of private and public records, or (verified) to 100.64/10 → `model_endpoint_refused`, nothing sent; `fetch("//evil.example/x")`, `fetch("https://evil.example/x")`, `fetch("\\@evil/x")` → refused; a cross-origin redirect is never followed; a same-origin redirect re-runs the guard; TLS SNI = the original host name; `tb-exec` leaves the role env empty and strips `HTTP(S)_PROXY` / `ALL_PROXY` / `NO_PROXY`.
- `RM-21` [bridge] an Own hosts change bumps `keysRev` once; the page names the bindings that fall below policy before a removal is confirmed; an `http:` binding whose host leaves the Own hosts list (or `TB_OWN_INFRA_ORIGINS`) → resolve `404 role_not_set` and status `set: false`, never served in clear text (QA-SPEC49-12).
- `RM-22` [Core] persona with U+0001, U+007F, U+0085 or a lone surrogate → `validation_failed`; TAB and LF pass; the workspace total past 250,000 → `validation_failed`; an owner change that would sign a config > 3,000,000 bytes → `validation_failed` / `config_too_large`, while a pause, resume or revoke at that size still goes out (QA-SPEC49-11, C349); U+2028, U+202E, U+2067, U+FEFF and a lone surrogate in a persona → `validation_failed`; at the cap a new pairing code and a pairing completion are refused with the owner text, the 101st open pairing code → 409 `too_many_pairing_codes`, and cancelling codes keeps working (QA-SPEC49-13); 64 apps × 500 agents: an owner change whose worst-case kill-path config would pass 4,000,000 bytes is refused even when the current config is under 3,000,000, and pause-all + revoke-all then deliver (QA-SPEC49-15); C353 / QA-SPEC49-23: tag characters, U+2060, U+206A, U+3164, U+FFA0, U+115F, U+17B4, U+FFF0 and two variation selectors in a row, a variation selector right after ZWJ or any other marker (`VS ZWJ VS`), U+0008 and U+001B in a persona → `validation_failed`; Arabic U+0600–0605 / U+06DD and the prepended marks U+070F, U+0890–0891, U+08E2, U+110BD, U+110CD pass (shown as ANS / PCM markers), a variation selector right after any of them is refused, and 🏳️‍🌈, ❤️‍🔥, printable ASCII and NBSP pass (C356 / QA-SPEC49-28/-29, QA-SPEC55-6); ZWJ, ZWNJ, ZWSP, LRM, RLM, ALM, SHY, CGJ, MVS, U+FE00–FE0F and U+E0100 pass and appear as labelled markers in the drafts review and the editor (QA-SPEC49-16/-21).
- `RM-22b` [Core] (core#63 note) since C353 a pause adds almost nothing to slices, so "worst case over 4,000,000 while the config is under 3,000,000" cannot be built end to end with ≤ 500 agents; test that branch as a unit test of the size decision with injected measured sizes (config 2.9 MB, worst case 4.1 MB → refused; kill-path op at the same sizes → accepted).
- `RM-23` [Core + SDK] slices carry only their own share (C353): `pause.agents` = `[]`, a paused edge agent has `agents[].status = "paused"`, `pause.instances` ⊆ {its instance}, `revoked.jtis` only companion-grant jtis of that instance; pause-all grows a slice by at most its own instance id; owner changes keep every worst-case slice ≤ 52,000 chars (C356) (the edge that would pass it is refused, naming the app), and a slice accepted at 52,000 still signs after a Portal key-set rotation to 8 keys, a bridge key rotation, a tb-views URL and 16 bridge caps (QA-SPEC49-22); a shrinking change is accepted even when already over a limit; an app still refuses a paused edge agent (from `agents[].status`) and a revoked companion grant (QA-SPEC49-15/-18/-19).
- `RM-24` [Core + SDK] (QA-SPEC49-26) directory app: after `edges.delete` X → A, A's slice lists X with `edge: false`; X's scheduled op on A fires as `agent_removed`; a re-created edge removes the flag and new schedules work; a non-directory slice simply drops X.
- `RM-24b` [Core] (core#63 QA, QA-SPEC54-1/-2/-6) 100 pause/resume cycles leave every slice the same size (companion grants untouched); a revoke after a half-life re-mint lists both jtis and the SDK refuses both; revoked entries drop at `exp`; never size-refused over a limit: adding held families to the apps policy or an agent policy, narrowing crud / operations / an edge (`edges.update {enabled:false}`), consent revoke, `edges.delete` on a directory app (its `edge: false` flags are in the measured worst case, as is `held` at 8); every owner change incl. `instances.deploy` / `instances.update` is measured on the target release with the companions it adds.
- `RM-24c` [Core + spec CI] (C359c, C359d, QA-CORE63-13, QA-SPEC57-1/-3) a change exempt from the size check never takes the config or a slice past the measured worst case: narrowing an edge from verb-level to an op list (verb-level edges are measured at their full op list, ≤ 128 ids), adding held families (measured at 8), `edges.update {enabled:false}`, consent revoke, edge delete (directory `edge: false` measured), agent and workspace pause / RESUME (paused grants are measured as if resumed). Property test (`test/killpath-model.test.ts` in the spec repo; Core runs the same sequences on its real code): random sequences of accepted owner changes incl. every exempt kind and pause → owner changes → resume keep, after every step, the real state ≤ the measured worst case ≤ every limit (slice 65,536, signed config 4 MiB), and an agent pause and a connection revoke still sign.
- `RM-25` [bridge + Core] (QA-BRIDGE22-1, QA-SPEC49-31) a provider key labelled "OPENAI_API_KEY" and a later app requirement `OPENAI_API_KEY`: key fetch → `404 key_not_set`, the page shows the requirement "Not set", `StatusReport.keys[]` reports it `set: false` and Portal `keys.status` "not set"; the page offers no requirement key for a binding; a binding whose `keyName` is not a provider key → resolve `404 role_not_set`; a malformed percent in a key or role path → `400 bad_request`.
- `RM-26` [spec CI] (QA-SPEC49-30, QA-SPEC55-2/-3) `test/slice-reserve.test.ts`: reads every maximum from the schemas; from the smallest valid mint to all external fields at their maxima (incl. `standalone`, bridge issuer, largest `rev`), every slice shape Core accepts keeps ≥ 1,000 chars to 65,536 (measured growth 11,343, margin 2,193); the largest accepted shape is also built with ASCII, CJK and emoji caller names cut to 80 JSON bytes, all within the margin; a manifest `name` with U+0001, U+200B or U+202E is refused (QA-SPEC55-1).
- `RM-27` [Core] (specs#55, QA-SPEC55-5) the owner-change check uses the measured serialized slice, with every grant's `prd`, every caller's `provider`, every caller `name` counted at 80 serialized JSON bytes (and cut to that in the slice: a CJK, emoji or escape-heavy name never makes it longer) and the companion `revoked.jtis` of every live grant (2 each): a workspace whose real grants are larger than the smallest-grant model is refused at the measured length, and the check never passes on an estimate that is under the limit while the real slice is over; a change that does not grow any slice always passes (QA-SPEC49-19).
- `RM-28` [Core] (specs#55, QA-SPEC55-1/-4) moving a caller instance to another host (new `provider`) re-mints and re-measures every slice that lists it and is refused (slice owner text) ONLY when it grows a slice past `SLICE_CORE_MAX_CHARS`; a grant's `prd` is never changed after mint; a caller update or rollback that changes its manifest `name` is never refused (the name is already counted at 80). Negative rows, all on a slice already over the limit: pause, resume, revoke, delete-edge, a move to a shorter provider and a caller rollback all go through.
- `RM-17` [SDK] `modelRole()` → `null` on a 404 without refuse code (bridge without the cap); a required role then gives `needs_keys`.
- `RM-11` [Knowledge] `knowledge__ask` answers when `reasoning` resolves and is reachable by a granted agent; without it the tool says which role to set.

## v0.1.70 — new sign-in banner (QA-SPEC43-6)
- Core: C-NS-1 a new `tbm` session appears in `account.me.newSignIns` (osn, client, machineLabel, createdAt; no IP); C-NS-2 after `owner_sessions.ack_new_sign_ins {osns}` exactly those are gone; a session created after the list was read, or beyond the first `max`, stays (QA-SPEC51-1); a later new session appears again; C-NS-6 an ack with another account's osn changes nothing for either account and answers 200; C-NS-7 a double ack is a no-op; C-NS-8 every ack writes one `owner_session.sign_in_ack` audit row; C-NS-9 a `machine_label` with a control character, an RLO (U+202E), a ZWJ (U+200D) or over 64 chars is refused at `device.start` (`MACHINE_LABEL_PATTERN`); `iPhone 🍎` is accepted; C-NS-10 more than `max` new sign-ins → the newest `max` are listed, one older than `windowDays` is not; C-NS-3 a revoked session leaves the list; C-NS-4 a K3 calling `owner_sessions.ack_new_sign_ins` → refused (browser row); C-NS-5 `cli` / `tbd` sessions never appear.
- Core: C-PO-13 a row not taken within `queueTtlS` → 502 `upstream_timeout` {reason: not_delivered}, and the app never receives it.
- Bridge (C354): R-PO-7 a relay row for an app that does not declare `person_op` → result 409 `person_op_unsupported`, NO request reaches the app; R-PO-8 an app whose `caps` is not an array of strings within `APP_CAPS_LIMITS` (e.g. a string, 17 entries, a 33-char entry) is treated as declaring nothing (→ R-PO-7 refusal), while an unknown extra entry next to `person_op` is ignored (→ forwarded).

## v0.1.68 rows (C336 RQ-2, RQ-3; proposed by QA on specs#47)
- `A11.deep_datasets_anyof_empty` — `anyOf: []` → a dataset read is refused or `not_found`; a read naming no dataset is refused.
- `A11.deep_datasets_noneof` — `noneOf` excludes the listed datasets from reads, lists and overviews.
- `A11.deep_datasets_identity` — alias, quoted, NFD, zero-width and case variants of a dataset name never match another dataset's canonical id (resolved first; unknown → `not_found`).
- `A11.deep_datasets_merge` — two narrowings → `anyOf` intersect, `noneOf` unite, the key survives the policy app's merge.
- `A11.deep_datasets_old_reader` — a v1-only reader refuses a `v: 2` narrowing (`narrowing_unsupported`).
- `A11.deep_datasets_malformed` — `{}`, `null`, non-array, non-string, over-limit → `narrowing_unsupported`.
- `B29.hook_target_tool_list` / `_call` / `_relay` — `target.tool` = the resolution's tool on each path; absent for static ops and search; a resolution that differs from the requested name → `dynamic_resolve_failed`.
- `B29.hook_tool_bypass` — case, space and alias variants of a held tool that differ from the app's resolution are refused (`dynamic_resolve_failed`); the resolution must equal the requested name (C354a).
- `C-SO-1` — a secretOutput call writes no idempotency row, no receipt output, no log line with a canary secret, and calls no `after` hook (the check fails if one is called).
- `C-SO-2` — an agent caller is refused `secret_output_app_only` and the tool is not listed for agents.
- `C-SO-3` — `ctx.schedule` of the op is refused `secret_output_not_schedulable`.
- `C-SO-4` — a handler that throws an error containing a canary → the envelope and the receipt carry neither the canary nor the message.
- `C-SO-5` — hold, then approve → the output reaches only the retry; nothing is stored.

## v0.1.74 rows (C354a; QA-C354-1, QA-SPEC47-16)
- `B29.hook_tool_variant` — an agent requests `x__<suffix>` by name, the app resolves the same name: `target.tool` = `x__<suffix>`; a policy deny/hold on `x` applies; `variantNarrowerOrEqual(variant, base)` holds (Connect: `gmail_send__first_contact` resolves `holdFamilies` ⊇ {`outward`} plus `first_contact`). With cap `hold_families`, an owner who holds `outward` only still gets the variant held, and a variant resolution that drops a base family is refused (`dynamic_resolve_failed`).
- `B29.variant_suffix` — `send___y`, `send__`, `send__Y` are not variants (`dynamicVariantBase` → null): a bridge refuses a resolution whose `tool` contains `__` and is not a valid variant (`dynamic_resolve_failed`); a policy app that still sees one matches it to its base `send` (deny and hold fail closed). The Rules writer refuses owner rule tool entries that fail `DYNAMIC_CATALOG_NAME_RE`.
- `B29.catalog_name_invalid` — a catalog answer with an entry named `a__b` or `a_` → the SDK drops those entries from its answer; a bridge given one drops it from tools/list (`toolsOmitted` `catalog_name_invalid`); the valid entries still list.
- `C-SO-6` — a schedule of an op created before the op had `secretOutput` is refused at run time (`secret_output_not_schedulable`); the handler never runs.
- `D-CAP-1` — Core refuses to deploy a release whose `requires.bridgeCaps` lists a cap the workspace bridge does not declare (`bridge_cap_missing`, `details.cap`); a bridge refuses to register such an app the same way.
- `A11.deep_datasets_noneof_unnamed` — under `deepDatasets.noneOf` only, a data read naming no dataset is refused (`narrowing_unsupported`) unless the op enumerates and excludes the listed datasets (SDK-API §18.5 rules 3–4).

## v0.1.77 rows (C367 P3, P4; the conformance PR adds them; B30 is reserved by the lazy-tools rows, specs#48)
Both groups are gated by the bridge's reported cap, never by version: B31 by `app_hold_status`, B32 by `app_call_context`. A bridge without the cap skips its group (noted, not failed).
- B31 (P3, BRIDGE v0.1.77 §8.3, SDK-API §4.7). Fixture: app X (target) with an op that holds; app caller A with a companion entry for X that lists the op and `tb.hold_status`; a second app caller B that is ANOTHER INSTANCE of A's product with the same grant shape (so a rule keyed on the product instead of the instance id fails); an agent caller. The target's SDK is at or above `APP_HOLD_STATUS_MIN_SDK`. Fake bridge flag `app_hold_status`.
  - `B31.hold_status_own`: A's call is held; A calls `tb.hold_status` with that `holdId` through the companion path → `pending`, then `approved` after the owner decides. The output is the usual `tb.hold_status` output.
  - `B31.hold_status_other_not_found`: B asks for A's hold, A asks for an agent's hold, A asks for an unknown id → all three answer `404 hold_not_found` with the same envelope as an agent's unknown id (status, code and message `no such hold for this caller` equal; v0.1.78 erratum; `requestId` aside; the message never contains the id).
  - `B31.hold_status_undeclared`: a companion entry without `tb.hold_status` → `callApp` throws `companion_undeclared`; a direct bridge call with that grant → refused (`not_in_workflow`); the app never sees it.
  - `B31.hold_approved_repeat_once`: after `approved`, the same call (same op, input and idempotency key) runs exactly once; a second repeat is not run again. After the repeat ran, A's `tb.hold_status` answers `run` (v0.1.78 erratum).
  - `B31.hold_status_old_target`: the target reports an `sdkVersion` below `APP_HOLD_STATUS_MIN_SDK` (or none) → the bridge refuses `not_in_workflow`; the target is not called.
  - `B31.hold_denied_repeat_blocked`: after `denied` (and after `expired`), the same repeat does not run; the handler is not called.
- B32 (P4, BRIDGE v0.1.77 §8.5, SDK-API §18.6). Fixture: app caller A (verified product `evolution`) calls target X. Fake bridge flag `app_call_context`. Context: `{ "evolution.workflow": "wf_1", "evolution.version": 3, "evolution.run": "run_1", "evolution.step": "step_1" }`.
  - `B32.context_reaches_target`: X's `ctx.context` has the four keys; the receipt has `meta.callerContext` with the same keys; `tb.receipts_list` and (for a held call) `tb.holds_list` return it; `tb.holds_pending` has the summary `evolution.run="run_1"; evolution.step; evolution.version=3; evolution.workflow="wf_1"`.
  - `B32.context_foreign_key`: a key of another product (`kanban.card`) → `400 input_invalid`, `details.pointer` `/context/kanban.card`; X is not called.
  - `B32.context_tb_key`: a `tb.` key from an app (`tb.onBehalfOf`) → `400 input_invalid`, pointer `/context/tb.onBehalfOf`; X is not called.
  - `B32.context_too_large`: JCS of 2049 bytes → `400 input_invalid`, pointer `/context`; exactly 2048 bytes is accepted. Rows from `examples/caller-context.cases.json` run in the same group.
  - `B32.context_informational`: A's call with run `run_1` is held and approved; the identical repeat (same op, input, idempotency key) reports `evolution.run: "run_2"` → it runs once on that approval; the receipt keeps `meta.callerContext` with `run_1` and has `meta.callerContextRun` with `run_2`.
  - `B32.sdk_local_refusal` (SDK side, fake bridge without `app_call_context`): `callApp` with a non-empty context → `bridge_cap_missing` with `details.cap = "app_call_context"`, no network call; with `{}` → sent without `context`, no throw; an op outside `wf` with a context → `companion_undeclared` (it wins over the cap check); with the cap, a bad key → local `input_invalid` with `details.pointer`.
  - `B32.context_tampered`: the context in the op body is changed after the bridge signed the proof → the app refuses `call_proof_invalid`.

## v0.1.82 rows (C373 P1, per-workflow companion grants; the conformance PR adds them; spec 0.1.82 is a reservation)
Gated by the bridge's reported cap `app_workflow_grants`, never by version; a bridge without it skips the B-WFL group (noted, not failed). Row prefix `B-WFL` because B33 is taken by specs#60 (C370a). Every fix of the C5 review and lead §11 has a fire-on-bad row (finding id in brackets). Fixture: the bridge world must hold SEVERAL companion grants per caller (today `bridge-world.ts` keeps one): caller app A (product `evolution`, app cap `app_workflow_grants`) with a base entry for target X (`operations ["issues_list"]`, `crud ["read"]`) and `perWorkflow {operations ["issue_create","issue_update","issue_get"], crud ["read","create","update"]}`; target X declares app cap `grant_wfl`; Core-fake mints workflow grants for A with `wfl` `wf-a` (`wf ["issue_create"]`, `crud ["create"]`) and `wf-b` (`wf ["issue_get"]`, `crud ["read"]`), each `exp − iat` = 900; the config carries `workflowGrantEdges {A: [X]}`.
- M2 (MANIFEST M-CP-4).
  - `M2.companion_per_workflow`: the entry above is valid; `perWorkflow.operations` with an op X does not have → `companion_op_invalid`; with `tb.hold_status` or `tb.holds_pending` → invalid (schema / `companion_invalid`); an op whose `crud` is not in `perWorkflow.crud` → `companion_op_invalid`; `perWorkflow.crud` wider than the union of its ops (a static op) → `companion_op_invalid`, but up to a listed dynamic op's `crudCeiling` → valid (C370a); `perWorkflow` on a `"*"` entry → invalid; an extra member in `perWorkflow` → invalid.
  - `M2.companion_per_workflow_overlap` [S3-5]: `issues_list` in BOTH `operations` and `perWorkflow.operations` → `companion_invalid`.
- A12 (SDK, both sides; template `A12.grant_prd_*`).
  - `A12.wfl_present`: X receives a call under the `wf-a` grant → `ctx.caller.workflow = "wf-a"`, receipt `meta.callerWorkflow = "wf-a"`; `ctx.receipt.meta({callerWorkflow: "x"})` does not change it.
  - `A12.wfl_absent`: a base-grant call → `ctx.caller.workflow` undefined, no `meta.callerWorkflow`.
  - `A12.wfl_ttl`: a grant with `wfl` and `exp − iat` = 901 → X refuses `grant_invalid`; = 900 accepted. A grant with `wfl` that breaks `WORKFLOW_ID_PATTERN` → `grant_invalid`.
  - `A12.wfl_no_base_fallback` (caller SDK, fake bridge): `callApp("x", "issue_update", …, {workflow: "wf-a"})` → `not_in_workflow` thrown locally, no call; `callApp("x", "issues_list", …, {workflow: "wf-a"})` → `companion_undeclared` although the BASE grant lists it; the base grant is never sent with `workflow`. Without `workflow` `issues_list` sends the base grant and no `workflow` field.
  - `A12.wfl_local_order`: with `workflow: "Bad"` → `input_invalid` (`/workflow`); fake bridge without the cap → `bridge_cap_missing` (`details.cap = "app_workflow_grants"`), no network call; an op outside `perWorkflow.operations` → `companion_undeclared`, no fetch; `ctx.workflowGrants.request` without the cap → `bridge_cap_missing`.
  - `A12.wfl_refresh_once`: the bridge answers `workflow_grant_withdrawn` once → the SDK fetches a new grant and retries once; twice → thrown.
  - `A12.app_caps` [§11.2]: an SDK that implements SDK-API §22 sends `app_workflow_grants` and `grant_wfl` in `ClaimRequest.caps` and every `AppStatus.caps`.
- B-WFL (bridge, BRIDGE §8.6).
  - `B-WFL.gate_mismatch`: `wf-a` grant with envelope `workflow: "wf-b"` → 403 `workflow_mismatch`; with no `workflow` → 403 `workflow_mismatch`. X is not called.
  - `B-WFL.required`: base grant with envelope `workflow: "wf-a"` → 403 `workflow_grant_required`.
  - `B-WFL.outside_ops`: `wf-a` grant, envelope `wf-a`, op `issue_update` (in `perWorkflow`, not approved) → 403 `not_in_workflow`; X is not called.
  - `B-WFL.not_slice_bound`: the `wf-a` grant (never in A's slice) is accepted (no `grant_stale`); a BASE grant not in the current slice is still `grant_stale`.
  - `B-WFL.withdrawn_record`: config record `{sub: A, wfl: "wf-a", at ≥ iat}` → 403 `workflow_grant_withdrawn`; the same record with `aud` = another instance → accepted; `at = iat − 1` → accepted; `at = iat` → refused.
  - `B-WFL.withdrawn_epoch`: `wflEpoch[A] = iat` → refused for both `wf-a` and `wf-b`; `iat − 1` → accepted.
  - `B-WFL.withdrawn_cached_record` (C4, fire-on-bad): A holds a `wf-a` grant with 14 min left; Core-fake withdraws it (record path) and the bridge applies that ONE config revision → the next call with the OLD cached grant is refused `workflow_grant_withdrawn`; the call before the config revision was accepted (quiet-on-good).
  - `B-WFL.withdrawn_cached_epoch` (C4): the same with the epoch path (65 withdrawals for A in the window → Core-fake writes `wflEpoch[A]`, no 65th record) → refused within one config revision.
  - `B-WFL.edge_disabled` [S3-3]: the config no longer lists X in `workflowGrantEdges[A]` → 403 `workflow_grant_withdrawn` with no record; a config with the other P1 fields but no `workflowGrantEdges` → refused (fail closed).
  - `B-WFL.wildcard_not_edge` [S3-3]: A also has the wildcard `tb.holds_pending` grant, so A's slice `companionTargets` lists target Y, but `workflowGrantEdges[A]` does not → a wfl grant with `aud` = Y is refused `workflow_grant_withdrawn`.
  - `B-WFL.held_stale` [S2-1]: the current `appsPolicy.held` has `outward`, the `wf-a` grant's `held` does not → 403 `workflow_grant_withdrawn`; with `outward` in the grant → accepted.
  - `B-WFL.ttl`: a grant with `wfl` and `exp − iat` = 901 → 403 `grant_invalid`.
  - `B-WFL.regate`: a record arrives while the before hooks run → the re-gate (step 9) refuses; X is not called.
  - `B-WFL.hook_caller_workflow`: a before hook sees `call.caller.workflow = "wf-a"`; with a base grant the field is absent.
  - `B-WFL.relay_ins`: a relay body with an `ins` member → 400 `input_invalid`; Core-fake receives `ins` = the asserting instance; a paused caller → `paused`; Core-fake down → 503 `portal_unavailable`.
  - `B-WFL.app_caps_reported` [§11.2]: the status report carries `apps[].caps` with the app's normalised caps; a malformed `caps` push → omitted.
  - `B-WFL.cap_absent` (SDK side, fake bridge without the cap): see `A12.wfl_local_order`; Core-fake sends no `workflowGrantsWithdrawn` / `wflEpoch` / `workflowGrantEdges` to that bridge.
- C-WFL (Core; static or journey checks in `checks/core.ts`).
  - `C-WFL.request_narrower` [S3-4]: applied `{X: [issue_create, issue_update], [create, update]}` with title "T1"; a request `{X: [issue_create], [create]}` titled "T2" → applied at once, no draft, the applied title stays "T1", a withdrawal record with `aud` = X in the next config; a request for exactly the applied set → unchanged, no record.
  - `C-WFL.request_wider`: a request adding `issue_get` → a draft with `createdBy.kind = "app"`, one `companions.workflow_grant_set` step, `digest` = the reference digest of the canonical body, one `LooseningItem` per widened op and crud action; apply without every id in `confirmLoosening` → refused; with them → applied. A K3 `drafts.create` with that op → `draft_op_not_draftable`; a direct PUT of the row → 403 `forbidden`.
  - `C-WFL.digest_bound`: the step input changed after creation (e.g. a fake DB edit) → apply refuses `draft_invalid`, nothing applied.
  - `C-WFL.rejected_again` [S3-4]: the owner rejects a draft; the same request (same digest) → 409 `conflict` `details.reason` "rejected", no new draft; a changed request → a new draft.
  - `C-WFL.draft_limits` [S3-4]: 11th open app draft of A → 409 `conflict` "too_many_open_drafts"; 31st draft created in 60 min → 429 `rate_limited`.
  - `C-WFL.text_rule` [S3-4]: a `title` or `reason` with U+202E (bidi), U+200B or a control character → 400 `validation_failed` (`/title`, `/reason`).
  - `C-WFL.revoke_kill_path`: at the worst-case config size, `companions.workflow_grant_revoke` and `bridge_api.workflow_grant_release` are never refused `config_too_large`; the record is in the next config.
  - `C-WFL.consent_revoke_keeps` [§11.1]: the owner revokes A's wildcard consent (`tb.holds_pending`) → no withdrawal record, no epoch; `wf-a` still mints and calls pass.
  - `C-WFL.workspace_kill` [§11.1]: `workspaces.pause` → the same config revision has `wflEpoch` for every caller; `workflow_grant_get` → 409 `conflict` "paused"; after resume the still-applied `wf-a` re-mints.
  - `C-WFL.mint_refused`: `workflow_grant_get` with `aud` for a `requested` / `rejected` record or a target outside the applied set → 404 `workflow_grant_missing`; after revoke → 410 `workflow_grant_withdrawn`.
  - `C-WFL.gate_caps` [§11.2]: X without app cap `grant_wfl` (any `sdkVersion`, also a very high one) → 409 `workflow_grants_unsupported` with `details.product = "x"`; A without `app_workflow_grants` → the same; the bridge without the cap → the same; with all three → minted, whatever the versions.
  - `C-WFL.fallback_no_crud_widen` [C5 delta S2-A]: gate off for (A, X); base crud `[read]`; applied `wf-a` = dynamic `tools` with `read`, `wf-b` = static `issue_delete` with `delete` → the fallback base grant has `crud = ["read"]` and does NOT contain `issue_delete` or any dynamic op beyond `operations`; a `tools` call resolving to `delete` is refused.
  - `C-WFL.cap_flap_no_remint` [C5 delta S2-B]: before the first mint, A flips `app_workflow_grants` (and X flips `grant_wfl`) 50 times → no base re-mint, no new `revoked.jtis`, no epoch bump; the first workflow-grant mint turns the pair on exactly once.
  - `B-WFL.no_edges_field` [C5 delta S3-A]: a config with NO P1 fields at all and a grant with `wfl` → `403 workflow_grant_withdrawn`.
  - `C-WFL.app_only_not_draftable` [C5 delta S3-B]: `drafts.create` with a `companions.workflow_grant_set` step → `draft_op_not_draftable` (the check is `draftable === true`).
  - `C-WFL.fallback_no_ceiling` [S1-1]: gate off for (A, X), base crud `[read, create]`, applied `wf-a` = `[issue_create]` (static) → A's BASE grant for X has `wf = ["issues_list","issue_create"]`, never `issue_update` or `issue_get`; after the owner rejects a widening to `issue_update` or revokes `wf-a`, the base grant no longer has the rejected/revoked op (revoke → base back to `["issues_list"]`, old jti in `revoked.jtis`).
  - `C-WFL.gate_sticky` [S1-1]: the gate turns on for (A, X) and Core mints a `wf-a` grant (base re-minted to `["issues_list"]`); then X reports caps without `grant_wfl` (a rollback) → the base grant stays `["issues_list"]`, `workflow_grant_get` → `workflow_grants_unsupported`; the fallback never comes back. A reinstall of X (new instance id) starts the pair again.
  - `C-WFL.held_epoch` [S2-1]: the owner adds `outward` to `appsPolicy.held` → the SAME config revision has `wflEpoch[A]`; the next `wf-a` grant has `outward` in `held`. The same for an edge crud change and a `polrev` change.
  - `C-WFL.mint_race` [S2-2]: a mint and a revoke of `wf-a` run concurrently (forced interleaving: revoke commits between the mint's read and its signing) → the mint answers no grant (`workflow_grant_withdrawn`), and no grant with `iat ≥` the withdrawal's `at` exists for `wf-a`.
  - `C-WFL.record_lifetime` [S3-1]: a record (and an epoch) is still in the config at `at + 900 + 60 − 1` and pruned after `at + 900 + 60`.
  - `C-WFL.reuse_never_covered` [S3-2]: a cached `wf-a` grant with 600 s left; a record `{A, wf-a}` is written; the next `workflow_grant_get` returns a NEW grant with `iat > at`, never the cached one.
  - `C-WFL.full`: the 501st requested + applied record of one caller → 409 `workflow_grants_full`; a rejected or withdrawn record does not count.
  - `C-WFL.update_narrows` (C1): A is updated to a release whose `perWorkflow.operations` lacks `issue_update` → in the same transaction every applied record loses it (a record with only `issue_update` for X drops X; one with no target left is `withdrawn`), withdrawal records are in the next config, and the next mint for `wf-a` lists no `issue_update`; the update is never size-refused because of it.
  - `C-WFL.mint_recheck` (C1): with the record still listing an op the installed manifest no longer has in `perWorkflow` (e.g. written before a rollback), the minted `wf` = applied ∩ current ceiling.
  - `C-WFL.iat_after_withdrawal`: a narrowing and a re-mint in the same second → the new grant's `iat` > the record's `at`.
- Spec repo (C5 S3-6): `test/workflow-grants.test.ts` checks `draftable: "app_only"` and that the op is not a `DraftableOpId`; `test/killpath-model.test.ts` (RM-24c P1 rows) models per-caller records, the epoch fallback, edges and base-grant sizes against the worst case.

## v0.1.85 rows (C370a; Evolution P5; the conformance PR adds them)
- M-CP-2 (manifest rows, `validateCompanions`). Target `connect` has a dynamic op `tools` (`crud ["read"]`, `dynamic.crudCeiling ["read","create","update","delete"]`) and a static op `accounts_list` (`crud ["read"]`).
  - `M-CP-2.dynamic_crud_up_to_ceiling`: an entry listing `tools` with `crud ["read","create","update"]` → valid; `["read","create","update","delete"]` (the whole ceiling) → valid.
  - `M-CP-2.dynamic_crud_beyond_ceiling`: an entry listing `tools` with `crud ["read","create","update"]` against a target whose `tools` has `crudCeiling ["read","create"]` → `companion_op_invalid` at `/companions/<i>/crud` (`update` is not needed by the listed operations).
  - `M-CP-2.static_cannot_widen`: an entry listing only `accounts_list` with `crud ["read","create"]` → `companion_op_invalid`; the same entry listing `accounts_list` and `tools` is valid (the dynamic op supplies the ceiling, not the static one).
  - `M-CP-2.op_crud_within_entry`: an entry listing `tools` with `crud` that lacks `read` → `companion_op_invalid` (each `op.crud ⊆ crud` is unchanged).
- B33 (C370a, BRIDGE §8.1 step 2 + step 5 on the companion path §8.3, MANIFEST §9 per-call rule). Fixture: app target X (Connect-like) with the dynamic op `tools` (`crudCeiling ["read","create","update"]`, `effectCeiling` `write`) whose resolver answers `read_x` → `crud ["read"]`, `effect read` and `draft_x` → `crud ["create","update"]`, `effect write`, `holdFamily outward`; app caller A with a companion entry for X that lists `tools`. `tools` is UNSCOPED in rows 1–4 (no `scopeType`) and SCOPED (`scopeType: "account"`) in rows 5–6. No fake-bridge flag: the group runs on every bridge.
  - `B33.resolved_crud_exceeds_grant`: A's grant has `crud ["read"]` (the owner's edge narrowed the declaration to read). A calls the inner tool `draft_x` → `403 crud_exceeds_grant`; the target is not called; no receipt, no hold. A calls `read_x` with the same grant → ok.
  - `B33.resolved_crud_within_grant`: A's grant has `crud ["read","create","update"]` and the workspace apps policy holds no family. `draft_x` → ok (the resolution, not the op's discovery `crud ["read"]`, is what `gate()` compares).
  - `B33.outward_held_by_apps_policy`: same grant as the previous row, and the workspace apps policy `appsPolicy.held` includes `outward` (setup: the owner holds `outward`; it is NOT held by default, C107). `draft_x` → `held` (`202`, `holdId`); the handler does not run before approval; `read_x` runs. With `appsPolicy.held` without `outward` the same call runs.
  - `B33.ceiling_still_enforced`: the resolver answers an inner tool with `crud ["delete"]` (outside this op's `crudCeiling`) → `dynamic_ceiling_exceeded`, whatever the grant's `crud`.
  - `B33.scoped_no_row_refused` (scoped `tools`): A's grant has `crud ["read","create","update"]`, A has NO scope row on the account (and no scope default for app callers) → `draft_x` → `403 scope_denied` from the target SDK; the handler does not run; `read_x` follows the same row rule.
  - `B33.scoped_row_bounds_grant` (scoped `tools`): grant `crud ["read","create","update"]`, A's scope row on the account allows `["read"]` only → `draft_x` → `403 scope_denied`; with a row allowing `["read","create","update"]` → ok (grant ∩ row). A grant of `["read"]` with a wide row → `draft_x` → `scope_denied` (the row never widens the grant).

## v0.1.86 rows (C373, G-6; the conformance PR adds them)
Gated by the bridge's reported cap `hook_recipients`, never by version. A bridge without the cap skips the group (noted, not failed). Fixture: app X with a static outward op `send` (`recipients: [{pointer: "/to", kind: "email"}, {pointer: "/cc", kind: "email"}]`), a static outward op `post` without `recipients`, a read op, and a dynamic op whose outward tool `chat_send` resolves `recipients: [{pointer: "/channel", kind: "slack"}]`; a before hook on X that records `call.target`; an agent caller and an app caller.
- `B34.static_op`: `send {to: ["B@Example.com", "a@example.com"], cc: null}` → `target.recipients = ["email:a@example.com", "email:b@example.com"]`, no `recipientsIncomplete`; agent and app caller see the same.
- `B34.dynamic_op`: `chat_send {channel: "u012abcdef"}` → `["slack:U012ABCDEF"]`.
- `B34.telegram_integer`: a dynamic tool resolving `recipients: [{pointer: "/chat_id", kind: "telegram"}]`, call with `chat_id: -1001234567890` (a JSON integer) → `["telegram:-1001234567890"]`; `chat_id: "-1001234567890"` → the same; `chat_id: 1.5` or `1e21` → `recipientsIncomplete: true`, nothing listed.
- `B34.slack_conversation`: `chat_send {channel: "C012ABCDEF"}` → `["slack:C012ABCDEF"]`; `{channel: "D012ABCDEF"}` → `["slack:D012ABCDEF"]` (conversations, not people: a policy finds no holder, trust `unreviewed`); `{channel: "X012ABCDEF"}` → `recipientsIncomplete: true`.
- `B34.known_none`: `send {to: []}` → `[]`.
- `B34.incomplete`: `send {to: ["Name <a@example.com>"]}`, `{to: 42}`, `{to: "telegram:123"}` → `recipientsIncomplete: true`, the bad value not listed; 65 distinct addresses → 64 listed and `recipientsIncomplete: true`.
- `B34.absent`: the read op, `post` (no places) → no `recipients` member. No value appears in any bridge log line.
