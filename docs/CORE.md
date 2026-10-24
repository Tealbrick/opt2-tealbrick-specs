# opt2 specs — CORE (cross-cutting decisions every spec obeys)

Status: v0.1 (Lead · Specs, 2026-10-11). Authority order: PRD-V2 > DECISION-LOG > this file > the per-topic specs. Every other spec in `specs/` MUST agree with this file; if it cannot, it raises the conflict in its "Open questions" section instead of deviating.

## Changelog → v0.1.68 (model-role follow-up after specs#42 QA; number taken at merge time, C340)
- BRIDGE §15: resolve order (paused first, retryable 503 mid-update), https-only base URL outside the own network, roles ticket claim needs the manifest verifier; `local` = listed hosts only for tailnet names/IPs (owner "Own hosts" list, `NEVER_LOCAL` incl. 100.100.100.200), Node's bracketed hex IPv4-mapped form; `zdr` shown as owner-attested, gateway attestation names the host and a model change re-asks (`ModelProvider.gateway`). PORTAL-API: cap recomputed per report (no latch), gate residuals QA-SPEC42-10, persona limit in UTF-16 units. SDK-API: one attention slot, faults outrank model codes. RM-14b, RM-16 (no latch), RM-18.

## Changelog v0.1.62 → v0.1.63 (C320, C322(2), C322(3), C330(4): model roles + persona)
- New `models.ts` (roles, data policies, provider catalog, label patterns, attention codes, persona limit) and `model-role-status.schema.json` (labels-only shapes that reach Portal). Manifest `settings.modelRoles` (MANIFEST §7.1). Bridge §15 role registry (S11), cap `model_roles`, `GET /tb/v1/model-roles/<role>`, persona in MCP instructions. AgentCard.persona, KeyStatus.roles/rolesSupported, catalog modelRoles, keys-ticket role hints, update-gate extension and lowered-policy consent (PORTAL-API v0.1.63). SDK `modelRole()`. Conformance RM-1..RM-17.

## Changelog v0.1.29 → v0.1.30 (C181: `package` release-index kind)
- `ReleaseIndexKind` adds `package`: an npm library tarball that other repos depend on by its dist URL (products `relay`, `harness-claude`, `harness-eve`, released from the private CLI repo; the private bridge and TBD depend on `relay`). Same shape and rules as `cli`: only `artifact {url, sha256, integrity}`, `url` = `<dist base>/opt2-tealbrick-cli-<product>-v<version>/opt2-tealbrick-<product>-<version>.tgz` on the public dist host, `tag` = `<product>-v<version>`. Additive: Core, the installer and `self-update` skip it (L24).

## Changelog v0.1.28 → v0.1.29 (C174: `cli` release-index kind)
- `ReleaseIndexEntry.kind` adds `cli` (type `ReleaseIndexKind`): the tealbrick CLI tarball for the one-line installer and `tealbrick self-update` (C173). Product `cli`, tag `cli-v<version>`; only `artifact` is set, as `ReleaseArtifact {url, sha256: "sha256:<hex>", integrity: "sha512-<base64>"}` (`integrity` required for `cli`, absent on desktop entries); `url` is on the public dist host, never a private repo URL (C164). Additive: Core and other readers skip kinds they do not use (L24); `Release` (Core's API record) is unchanged.

## Changelog v0.1.27 → v0.1.28 (C150 security correction; F89 attention)
- C150 (QA F90 S1): a `rules.narrowing` binds WRITES too (SDK-API §18.4 a–f). A write addressing an existing item checks visibility first and answers a hidden item exactly like a missing one (no existence oracle); a write whose result the caller could not read is refused `narrowing_violation` (409); collection-wide deletes, research writes under `anyOf` and engine-native writes answer `narrowing_unsupported`. 0.1.22–0.1.27 "writes ignore the narrowing" let a narrowed agent re-tag a hidden item and read it (L13). Type `NarrowingRefusalCode`.
- F89 (L3): `AppStatus.attention? {code, reason}` (app-reported, from `defineApp({attention(db)})`, readiness `degraded` while present) and `StatusReport.apps[].attention?` (bridge copies it; Core shows it on the app card). Additive: an older bridge ignores the field and still sees readiness `degraded`.

## Changelog v0.1.26 → v0.1.27 (F75: one harness option id list)
- `HARNESS_OPTION_IDS` / `HarnessOptionId` / `isHarnessOptionId` in `types/routes.ts` are THE harness option id list (L1): `tbd-default`, `claude-desktop`, `codex-desktop`, `claude-code` (new), `eve`, `tealbrick-cli`, `generic-mcp`. Core checks `device.start` harness ids against it and syncs only index rows whose id is in it; the CLI imports it for `agent login --harness`. The label, kind and instruction steps of each id stay data rows of the signed index (C40, C43). `claude-sdk` and `command` are runner kinds of `agent serve` / `adopt` on a `tealbrick-cli` agent, not harness options; there are no aliases (C133).

## Changelog v0.1.25 → v0.1.26 (C133: no compat ladders; breaks earlier opt2 dev formats)
- Key-set transition rule (c) removed (CREDENTIALS §9.5): a document without a valid `portalKeySet` is always refused (`keyset_missing`), pinned or not; a build without pinned roots refuses everything. `keySetAnnounce` removed from the SDK signatures (SDK-API §1); `trustedPortalKeys(body, pinned, roots)` returns a verified statement or a refusal (no `legacy`, no `required`). Manifest 0.1.18, miniapp-sdk 0.1.19 (no `KEYSET_REQUIRED`, no `slice_keyset_transition` warning), conformance 0.1.16 (no `--keyset-transitional`). The bridge removes its own legacy path on top (V-07). The SDK's `tb_*` SQL guard for runtimes without `setAuthorizer` (Node < 24.10) stays: engines say `>=24`.

## Changelog v0.1.24 → v0.1.25 (C117 report code)
- StatusReport rejected kind `config` code `hook_not_listed` (+ `ins` of the hook app) = a matching declared hook missing from config.hooks (the call was refused). Conformance 0.1.14: group `c117` (B27.*), B25.real_hook_after_update, A11.narrowing_empty_anyof.

## Changelog v0.1.23 → v0.1.24 (C117, C116)
- C117: a hook leaves the gate ONLY by explicit owner action (switch it off, remove the app) — never by run state (queued, deploying, unhealthy), an update, a licence lapse or a missing config bump. Core lists every declared hook of every deployed app in config `hooks[]` with `enabled` (owner switch) and bumps the config on every change that can affect the list; the bridge fails closed (`hook_failed`) for a matching declared hook that is absent or whose app is down (BRIDGE v0.1.24). Licence lapse keeps the hook listed (the app stops → calls fail closed with a plain "licence lapsed" reason; the owner removes the app to unblock).
- C116: StatusReport rejected kind `config` code `standalone_without_grants`.

## Changelog v0.1.22 → v0.1.23 (C115, security correction)
- `rules.narrowing.memoryTags.anyOf` present but EMPTY passes nothing (was read as "no constraint" in 0.1.22, which widened access, L13). Fixed in `tagsMatch` (manifest 0.1.16); manifest 0.1.15's `tagsMatch` must not be used.

## Changelog v0.1.21 → v0.1.22 (G5 details; Core QA S2/S3)
- `rules.narrowing`: tags compare after trim + lower case (`normalizeTag` / `tagsMatch`, manifest 0.1.15); `narrowing_unsupported` for reads that cannot honour the filter; receipt meta records the rule id; unknown-tag items dropped (SDK-API §18).
- `DeployState` `refused`; `Instance.lastError.code` may carry a bridge manifest refusal code; `CatalogEntry.devOnly`; StatusReport `rejected[].ins`.

## Changelog v0.1.20 → v0.1.21 (C113; conformance 0.1.13 free port)
- Release index `devOnly?: true` (signer DEV_ONLY_PRODUCTS); stable workspaces never get dev-only products (`release_not_deployable` + `details.reason "dev_only"`).
- `RunningApp.port` + startApp harness `port`; conformance runner passes `TBCONF_PORT` (package 0.1.13, SDK 0.1.17, template 0.1.9).

## Changelog v0.1.18 → v0.1.19 (C111, C111a)
- Grant rule: `wf`, when non-empty, limits ops in ANY mode; `caps`, when present, apply in ANY mode (`gate()` in @opt2-tealbrick/manifest 0.1.12; `authorize()` already applied caps regardless of mode). Edges may carry an op allow-list `ops` for any card (`Edge.ops`, `EdgeUpdateInput.ops`); Core mints `wf = ops`. `Edge.verbChanges` for the review sheet. Cutover gate: no op-limited grant without caps (interim on dev: op-limited edges minted as Bound + wf; after bridge ≥ 0.1.19 (manifest 0.1.12 gate) and target SDK ≥ 0.1.16, Free + caps + wf; constants `MIN_BRIDGE_FREE_WF` / `MIN_SDK_FREE_WF` in manifest 0.1.12).

## Changelog v0.1.17 → v0.1.18 (C106a phase 2, C109; additive)
- Device adopt: `agents[].adopt` suggestion / resolved / choice, `device.lookup {ws?}`, `device.approve` with optional `agt` + `adopt`, `DeviceDecision.draftId`; slice `agents[].scopeRequest`; catalog op `holdFamily`.
- (0.1.17, recorded) StatusReport rejected kind `manifest`; C108 tolerant grant `held`; resolve without family → `dynamic_resolve_failed` + `family_missing`.

## Changelog v0.1.15 → v0.1.16 (C107)
- Hold families `outward` and `identity`; `DEFAULT_HELD_FAMILIES` += identity (`outward` not held by default). Every outward op declares a family (validator: one release of grace); `resolve` answers with outward/money effect must carry a family. Schema enums (manifest holdFamily, slice appsPolicy.held) extended.

## Changelog v0.1.14 → v0.1.15 (additive; C104, C105, C98a, Bridge name rule)
- C104: release `requires {bridge?, sdk?}`, manifest `requires {bridge?}`, `bridge_too_old` (409); one feature table `requiredBridgeVersion` (manifest 0.1.10+). Apps whose before hook can answer hold declare `requires.bridge: "0.1.17"`.
- C105: `DEFAULT_HELD_FAMILIES` (destructive, money, first_contact) and `KNOWN_HOLD_FAMILIES` are spec vocabulary, re-exported by @opt2-tealbrick/manifest; Core, GUI and conformance import them (L1). Spine T10.
- C98a: derived idempotency key also for `supported` ops. Agent card name 1..60 everywhere.
- C105a: workspace `appsPolicy {held}` (default DEFAULT_HELD_FAMILIES) = the `held` claim of every companion grant (I8) and a slice field; app-initiated and in-handler app calls are held by the target app like agent calls. C105b: refusal names stay the spec's (`no_grant`, BRIDGE §8.4).

## Changelog v0.1.13 → v0.1.14 (additive; C90, C91, C96, C98, C100, C102, A2A-10/11, L3, Kanban S2, Connect Q-C2, Fleet)
- Slice `companionTargets` (C90) and `companionCallers` (C102); SDK `ctx.companionTargets()`, `Caller.name` for app callers.
- C91 bridge-op binding rule normative (`bridgeOpBinding` / `bridgeOpProofClaims`, manifest 0.1.8).
- C98 derived idempotency key (`deriveIdempotencyKey`, manifest 0.1.9); `B8.idempotency_derived`.
- A2A-10 unknown `parentCall` → app-initiated. A2A-11 `Edge.grantState: blocked` + reasons, `Instance.companionIssues`. C100 `Instance.updateCompanionChanges`.
- StatusReport `connectionsSeen`, `rejected` kind `bridge_op`, `toolsOmitted` code `catalog_failed` (L3). Core `Health.deployWorker`.
- C96 device request `agents[].name/purpose`; CLI harness option row (data).
- Catalog `hasUi` / `launchPath` (Fleet). `defaultGrants[].callers` (Connect Q-C2). Shared scope defaults reach callers seen before (Kanban S2). `tb.hold_status` family + reason (reason text only, C90).

## Changelog v0.1.12 → v0.1.13 (wave 2a spine extensions: C81 G1/G4/G4b/G5, C82, C85, C86; Fleet/Inbox requests)
- **G1 hold from a gate:** a before hook may answer `{allow: false, hold: {family, reason}}` (`family` ∈ HOOK_HOLD_FAMILIES = HOLD_FAMILIES + `policy`). Bridge precedence: any refuse wins; else the FIRST hold is kept and the chain continues; the call is forwarded with the verdict in the op call proof claim `hv {f, r, by}`; the TARGET app's `authorize()` holds (receipt `heldBy`). An approval runs the same input once; the bridge re-runs the before chain on the retry and a refuse still wins (C82). BRIDGE §8.1 v0.1.13, CREDENTIALS §10, SDK-API §4.
- **G4 cross-app holds list:** standard op `tb.holds_pending` (agent audience, read; summaries only). Wildcard companion `product: "*"` ONLY for `tb.holds_pending`/read (M-CP-3); Core mints the per-app grants only after the owner's explicit consent (`instances.consent`, kind `holds_pending_all`, GUI text "This app can see the pending approvals of all apps"), revocable (C82).
- **G4b on-behalf-of carrier:** MCP `_meta["tealbrick/onBehalfOf"]` → context `tb.onBehalfOf {claim, verified: false, via: "mcp_meta"}`; the `tb.` context namespace is bridge-only. `channel_sender` id = `"<channel>:<value>"`. Unverified claims narrow, never widen. Pluggable verification later (Martin Q5).
- **G5 `rules.narrowing`:** the first cross-app context contract (SDK-API §18): `{v: 1, ruleId, reason, memoryTags?: {anyOf?, noneOf?}}`; consumers fail closed on unknown `v` (`narrowing_unsupported`).
- **C85 app-initiated calls:** `callApp` on StartContext and event ctx; no `parentCall`; own companion grant; same hooks, holds and rate limits; bridge audit `call.app_initiated`.
- **C86:** `defineApp({pendingCount})` + `ctx.statusChanged()`; slice `portalUrl`; `tickets.launch` `path` validation (`path_invalid`); Connect app-caller sender identity (`no_sender_identity`, SDK-API §18).
- **Fleet:** `events.agentsChanged(agents, ctx)`. Conformance 0.1.9: A5 schema-aware tamper field (Inbox), `A4.mark_after_failed` n/a without receipt ops, per-check waivers with an expiry version (Fleet, C89).

## Changelog v0.1.11 → v0.1.12 (C63a fallback removal; C79)
- **Core emits `portalKeySet` since 2026-10-12T10:19:19Z** (Core 229e465, statement seq 1). From spec 0.1.12 the no-statement fallback (CREDENTIALS §9.5 rule c) is REMOVED: a build that pins Portal Root Keys for its channel refuses an enrolment response, config or slice without a valid root-signed statement, first-contact included (`keyset_missing`). SDK `KEYSET_REQUIRED = true` (miniapp-sdk 0.1.12); bridge from 0.1.13; conformance 0.1.8 runs the strict checks (`A13.kss_first_missing`, `B20.kss_enrol_missing`) by default with `--test-roots`.
- C79: route `portal.signing_keys` (GET /portal/signing-keys, public, `public_strict`): Core's public key ring + emitted statement seq — ceremony input only, never a trust path.
- Spine S1 claim guard (SDK-API §13 v0.1.12 addition): SdkEnv `TB_DATA_EPHEMERAL?` (tests/conformance only), Health `attention?: AttentionCode` (`data_dir_not_mounted` | `identity_refused`; wire readiness `degraded`), reclaim with a NEW enrolment code after a 401 identity refusal; CONFORMANCE `A1.reclaim_on_new_code`. The mount gate's enforce vs log-only mode is pending Core's Railway mountinfo reading (C-relay 2026-10-12).

## Changelog v0.1.10 → v0.1.11
- StatusReport `portalKeysDigest?` and `apps[].sliceRevision?` (Bridge 0.1.12 sends them; Core consumes them). (C62/C63, BSD-07, C70)
- C62/C63 (BSD-08) offline Portal Root Keys: two root keys (dev pair now, production pair at the cutover ceremony) pinned as release data (`PORTAL_ROOT_KEYS`, credentials.ts) sign key-set statements (`tb-keyset+jws`, monotonic `seq`); config, slice and enrolment response carry the current statement as `portalKeySet`; trusted Portal keys come ONLY from the newest root-signed statement; `portalKeys` informational for one minor; `keySetAnnounce` leaves the trust path and is removed in 0.1.26 (C133; §4, CREDENTIALS §9.5, BRIDGE §4–5, SDK-API §9; manifest 0.1.6, miniapp-sdk 0.1.11, conformance 0.1.7).
- BSD-07: `apps[].internalUrl` = `http://<name>.railway.internal:<port>`, or any http(s) origin only with `ownInfra: true` AND listed in the bridge-local env `TB_OWN_INFRA_ORIGINS` (never set by Portal); same rule for neighbour claims; refuse code `internal_url_refused` (BRIDGE §5.7).
- C70: bridge refuse code `grant_stale` (BRIDGE §8.4); CONFORMANCE A12 companion calls; MANIFEST path bases (build paths repo-relative, skill/app files manifest-relative).
- C63a dated rule: the no-statement fallback (CREDENTIALS §9.5 rule c) applies ONLY while nothing is pinned; after a pin a missing or invalid statement is refused for config, slice and bridge re-enrolment. **0.1.12 (date = Core emits `portalKeySet`; record the date here at release): fallback removed** — builds that pin roots refuse a first enrolment and a first slice without a valid statement.

## Changelog v0.1.9 → v0.1.10 (C59)
- Key page on its own origin: bridge env `TB_KEYS_PUBLIC_URL` (second public domain); `/keys` only there (main origin 404, unset 503 "key page not configured"), that origin serves only `/keys` + health; key-page CSP `form-action 'self'`; `tickets.keys` url on the keys origin; ticket `aud` unchanged (BRIDGE §3.1/§9.3, PORTAL-API, CONFORMANCE B11b; conformance 0.1.6).

## Changelog v0.1.9 → v0.1.10 (additive; C64)
- Instance slice `bridge.publicUrl` (S1: OAuth/webhook public routes need it).

## Changelog v0.1.8 → v0.1.9 (additive; C60)
- Route `billing.portal` (Stripe customer portal link; browser only, bodyLog none). 102 ops.

## Changelog v0.1.7 → v0.1.8 (text only)
- CREDENTIALS §12: draft apply carries the draft `revision` (routes.ts `DraftApplyInput`), not a `draftDigest` (QA consistency finding).

## Changelog v0.1.6 → v0.1.7 (C53, C54)
- `runtime.services[].dropPrivileges` (default false; tb-exec drops only when true; the app always drops); `SessionInfo.idempotencyRequired`; SDK-API §15 one Dockerfile pattern (C53/BSA-06).

## Changelog v0.1.4 → v0.1.6 (C50, C52)
- C50 `app_not_claimed` (0.1.5); C52 BRIDGE §9.3: keys-ticket POST answered with the form directly (200 + Strict cookie, no 303), conformance `B11.ticket_post_is_form` (0.1.6).

## Changelog v0.1.3 → v0.1.4 (additive; C44, C46, C49)
- C49 route `clerk.webhook` + codes `clerk_signature_invalid`, `account_disabled` + audit `account.disable`; C46 405 `method_not_allowed` in PORTAL-API §1.4; C44 `sdkMajorOf` (manifest 0.1.2); one `when` evaluation (manifest 0.1.3).

## Changelog v0.1.1 → v0.1.3 (additive; C31, C33, C35, C38)
- C31/C33 SDK context fields and `onStart` in types/sdk.ts; C35 eleven SPEC-GAP clarifications (MANIFEST, BRIDGE, SDK-API v0.1.3 sections), `TB_KEK` exactly 32 bytes; C38 bridge release `runtime` record + `RAILWAY_RUN_UID=0`. (spec 0.1.1 tarball withdrawn; content shipped as 0.1.2.)

## Changelog v0.1 → v0.1.1 (additive; C21, C24, C26, C28–C30)
- C21 manifest package exports (seal/unseal, key export/import, opaque values, ulid, raw digest, generic assertions, `validateInput`); C26 `signJwsWithSigner` + `DeviceAgentTokenResult.bridge_id`; C28 one volume per service, `TB_BACKUP_DIR=<data mount>/backup`; C29 release `source {repo, ref, dockerfile}` on dev only; C30 `TYP.releaseIndex` + `ReleaseIndexClaims`; C24 TBD items (REQUESTS.md).

## Changelog v0 → v0.1 (Coordinator review REVIEW-v0-VERIFIER.md, DECISION-LOG C15–C17)
- B1 bridge deploys at onboarding step 1 (`bridge.deploy`, chained into `workspaces.set_infrastructure`), so agents can be authorised before any app. B2 device approval requires the user code (no unbound list, no clear user codes). B3 device start is a discriminated union: `scope=owner` only for `tealbrick-cli|tbd`; kits can never obtain K3. B4 K3 never obtains any K11; TBD opens app launches in the system browser. B5 third call-proof variant (bridge ops: catalog, resolve, mark, scope_summary) + `verifyBridgeOpProof`. B6 routes.ts is the one wire source for device flow; `rev` everywhere. B7 standalone = frozen final config, bridge re-mints grants/slices, owner admin = 4 ops. B8 responses carrying one-time codes are never stored by the idempotency store.
- S1 K3 idle 24 h (7 d for client tbd since spec 0.1.53, C289), OS-user boundary stated, login warns when agent items exist, compile check that owner-cli outputs carry no codes/tickets. S2 `pendingHolds` count per instance → canvas badge, TBD counts. S3 pairing approval shows redirect host + unverified client name; Core checks bridge account = principal. S4 one agent device request carries up to 64 agents. S5 companion grants carry workspace default held families. S6 settings reach apps only as env at (re)deploy. S7 bridge volume backup + restore test. S8 CUT bridge skill sanitizer. S9 CUT CLI pairing path C and the custom pairing grant type. S10 `<product>__tb_skills` fallback tool. S11 conformance cases added. S12 conformance imports spec + manifest only. S13 ACCEPTED (tickets not paused; companion calls for work started before a pause may finish).
- NITs N1–N15 fixed except N12 (TODO, waits on Martin). C15 open items accepted. C17 Platform items approved (offers in signed release index, `TB_KEK` via Railway `secret()`, `skillsDigest`).

## 0. Spec set and machine-readable contract
| File | Content |
|---|---|
| CORE.md | this file: ids, audience format, crypto, trust chain, credential list, grant format, authorize(), hook envelope, versioning |
| REPOS.md | repos, packages, dependency direction, distribution |
| MANIFEST.md + manifest.schema.json | miniapp manifest v2 |
| CREDENTIALS.md + types/credentials.ts | credential registry (every kind, claims, lifetimes, revocation, pause matrix) |
| BRIDGE.md + workspace-config.schema.json + types/bridge.ts | bridge: enrolment, config pull, MCP, routing, hooks, tickets, key store, standalone, HA |
| PORTAL-API.md + types/routes.ts | route registry: every Portal op, typed |
| SDK-API.md + types/sdk.ts | miniapp-sdk server + client surface |
| CLI.md | `tealbrick` CLI (owner mode, agent mode, local bridge) |
| CONFORMANCE.md | conformance suite + fake Portal + fake bridge |

Machine-readable files in `specs/` (JSON Schema draft 2020-12, TypeScript `.ts` types) become package `@opt2-tealbrick/spec` in repo `opt2-tealbrick-specs` at freeze (data only, no runtime code). Every implementation imports them; none re-declares them. Markdown and schema disagree → the schema wins and the markdown is a spec bug.

## 1. Identifiers
- Format: `<prefix>_<ULID>` (26-char Crockford base32, upper case), e.g. `agt_01JA2...`. Prefixes: `acc` account, `per` person, `ws` workspace, `agt` agent (card), `con` agent connection, `ins` app instance, `brg` bridge, `rel` release, `lic` licence, `off` offer, `ord` order, `edg` canvas edge, `drf` draft, `dev` device-flow request, `aud` audit event, `hld` hold, `rcp` receipt, `call` bridge call id, `osn` owner CLI/native session, `lnk` provider (Railway) link.
- Product id = manifest `id`: lower-kebab slug, 2–32 chars (`^[a-z][a-z0-9-]{1,31}$`). Product ids are data; no code path branches on a product id.
- opt2: at most ONE instance of a product per workspace (licence = one workspace per product). Paths may therefore use the product id inside a workspace (`/a/<product>/…`).
- Person ↔ account: 1:1 in opt2 (account owner). Both ids exist so members can come later without a format change.

## 2. Audience / subject format (ONE format)
`tb:<kind>:<id>` where kind ∈ `portal | per | agt | ins | brg`. Examples: `tb:portal`, `tb:agt:agt_01…`, `tb:ins:ins_01…`, `tb:brg:brg_01…`.
- Every token we issue has mandatory `iss`, `sub`, `aud` (single string, never an array), `iat`, `exp`, `jti`, and a JOSE header `typ` unique per credential kind (see §5). Verifiers reject a missing/foreign `aud` or `typ` (no warn-only path).
- The person (Clerk) token is never in this format and is never accepted anywhere except the Portal gateway → Core (CREDENTIALS rule P1).

## 3. Crypto (one choice each)
- Signatures: Ed25519, JWS compact, `alg: EdDSA`, `kid` = RFC 7638 thumbprint. No HMAC tokens, no RSA.
- Canonical JSON: RFC 8785 (JCS). Digest: `sha256:<hex>` of JCS bytes (manifests, configs, skills, catalogs).
- Secrets at rest we must keep: sealed with AES-256-GCM under a KEK from the service environment (Core: Portal signing keys, Railway refresh token; bridge: key store; apps: their own keys). Codes and opaque tokens we only verify: stored as SHA-256 digests.
- Primitives (JCS, digest, JWS sign/verify, key-set handling, `verifyGrant()`, `gate()`, `authorize()`) have ONE owner: package `@opt2-tealbrick/manifest` (REPOS.md). Copying them elsewhere is a CI failure.

## 4. Trust chain (who trusts which key)
```
Portal Root Keys (offline, 2: root-a + root-b; v0.1.11) ──signs──► key-set statement (tb-keyset+jws: the Portal signing keys + status, seq)
Portal signing key K12 (sealed in Core, listed in the statement) ──signs──► workspace config (for the bridge)
                                      ├─signs──► instance slice (per app, relayed by the bridge)
                                      ├─signs──► grants (agent→app, app→app)
                                      └─signs──► person tickets (launch | keys)
Bridge key (generated in the bridge, never leaves it) ─signs─► agent sessions, call proofs, bridge assertions (to Portal)
Instance key (generated in each app instance) ─signs─► instance assertions (to the bridge)
Agent connection key (generated on the agent machine) ─signs─► agent assertions (to the bridge)
```
- v0.1.11 (C62/C63): the root PUBLIC keys are release data (`PORTAL_ROOT_KEYS` in `@opt2-tealbrick/spec`, embedded in every bridge and SDK build; dev-channel builds pin the dev pair, stable builds pin only the production pair). The trusted Portal key set is derived ONLY from the newest valid root-signed key-set statement (`portalKeySet` in the enrolment response, every config and every slice): `seq` monotonic, pinned in the bridge's sealed state and the app store. A K12 holder can sign configs but can no longer change the key set. Root change = spec + bridge/SDK release (no in-band root rotation). Details and ceremonies: CREDENTIALS §9.5. No transition path since 0.1.26 (C133).
- Before v0.1.11: the bridge learns Portal's key set in the enrolment response (TLS to the Portal domain) and pins it; apps learn it from the deploy env (`TB_PORTAL_KEYS`, public values only) and from instance slices.
- Rotation: a new Portal key is announced (`pending`) in a key-set statement ≥ 24 h before first use; retired keys stay verifiable for tokens until every token they signed has expired (≤ 12 h); configs and slices are accepted only from `active` or `pending` keys of the newest statement.
- Standalone (leaving Portal): Portal signs a final config with `standalone.issuer = <bridge key>`; from then on the bridge signs configs/slices/grants/tickets with its own key and apps accept it because a Portal-signed slice named it (BRIDGE.md §Standalone).

## 5. Credential kinds (complete list — CREDENTIALS.md details each)
| # | Kind | `typ` | Issuer → holder | Purpose |
|---|---|---|---|---|
| K1 | person session | (Clerk) | Clerk → browser | person at Portal GUI/gateway only |
| K2 | device code | n/a (opaque) | Core → CLI / TBD / kit | RFC 8628 device flow, owner approves in browser after entering/confirming the user code (B2). Discriminated start (B3): `scope=owner` only for `client_id` `tealbrick-cli`\|`tbd` → K3; `scope=agent` (CLI, TBD, kits; requires public keys, up to 64 agents per request, S4) → key connections. A kit can never obtain K3. Wire = types/routes.ts. |
| K2b | agent pairing code | `tb-pair+jwt` | Core → owner (form-POSTed to the bridge by 'Approve in Portal', or pasted on the bridge authorize page) | C4: one-time Portal-signed code (10 min, aud = bridge, sub = agent) redeemed OFFLINE at the bridge for an OAuth connection (Claude Desktop / Codex remote connector) only (S9: no CLI path) |
| K3 | owner CLI / native session | n/a (opaque `tbo_`) | Core → owner CLI or TBD (human sign-in, R2) | person, drafts + reads only, never applies, never obtains any K11 (B4); idle timeout 24 h; `client: cli\|tbd`; never reaches any agent process; boundary = the OS user (S1) |
| K4 | agent connection key | n/a (key pair) | agent machine ↔ Core registers public key | agent proves identity to the bridge (TBD, CLI agent mode, SDK harnesses) |
| K5 | agent session | `tb-agent-session+jwt` (access) / opaque rotating refresh | bridge → agent | what every MCP request carries: access token 15 min, agent-bound (sub = agent, `con` = connection); rotating refresh 30 d (digest + generation kept in bridge state); revocation/pause via signed config |
| K6 | enrolment code | n/a (opaque) | Core → bridge / app instance env | one-time registration of a bridge or an app instance (≤ 24 h, digest-stored) |
| K7 | bridge key | n/a (key pair) | bridge | bridge assertions to Portal, agent sessions, call proofs |
| K8 | instance key | n/a (key pair) | app instance | instance assertions to the bridge (companion calls, key fetch, status) |
| K9 | workspace config + instance slice | `tb-config+jws`, `tb-slice+jws` | Core → bridge (→ app) | apps, agents, connections, policies, grants, hooks, skills, keys, pause |
| K10 | grant | `tb-grant+jwt` | Core → bridge (held by bridge or by the calling app) | THE one grant: agent→app and app→app |
| K11 | person ticket | `tb-ticket+jwt` | Core → browser | one-time; `pur: launch` (open app) or `pur: keys` (key-entry page) |
| K12 | Portal signing key | n/a | Core (sealed) | signs K9–K11; standalone: bridge key takes over |
Proofs that are not credentials (cannot be used alone): agent assertion (K4), bridge assertion and call proof — op, hook and bridge-op variants (K7), instance assertion (K8). External credentials Core holds sealed (not ours): Railway OAuth refresh token, Stripe webhook secret. Exactly 13 kinds (K1–K12 + K2b); no 1-year bearer; no shared static secret between services.

## 6. The ONE grant (K10)
Claims: `iss` (`tb:portal`, or `tb:brg:<id>` in standalone), `sub` (`tb:agt:<id>` or `tb:ins:<id>`), `aud` (`tb:ins:<target>`), `ws`, `cnf: {brg: <bridge id>}` (only the workspace bridge may present it, proven by its call proof), `crud` (subset of `["create","read","update","delete"]` = edge ceiling), `mode` (`free|bound`), `held` (hold families held for this caller), `caps` (Free caps), `wf` (Bound: allowed operation ids), `polrev` (policy revision), `iat`, `exp` (= iat + 12 h), `jti`.
- Minted by Core for every licensed, unpaused edge (agent→app) and every manifest-declared companion edge (app→app), delivered inside the signed workspace config, re-minted at half-life (< 6 h left). Agents NEVER hold grants: the bridge attaches the grant to the forwarded call. A companion grant is held by the calling app (from its slice) and presented to the bridge, which forwards it with its call proof.
- Scopes: the APP is the authority for scope assignments (DECISION-LOG "Configure opens the app, which is the authority for its scopes"). The grant carries the CRUD ceiling and mode; the app holds per-scope access (Connect: per-account tier; Knowledge: per-area read/write) created from the manifest's `scopes[].defaultGrants` when an edge first appears, edited in the app's Configure UI. Effective access = `grant.crud ∩ operation.crud ∩ scope access` (computed by `authorize()`). The canvas line shows a display-only summary the app reports through the bridge status report (labels only, no third-party identifiers).
- Licence-last (R4): an app may be deployed and its edges drawn while unpaid; Core mints no grants / launch tickets / hook activations for it until entitled; the GUI shows the glowing pay pill.
- Licence gate lives in Core only: no entitlement → no grant, no slice entry for edges, no launch ticket. Bridge and apps never check licences.
- Verification: signature with trusted Portal key set (or standalone issuer), `typ`, `aud` = own instance, `exp`, `cnf.brg` = the bridge that signed the call proof. No introspection, no online check.

## 7. Decision: one grant-verify function, bridge gate, app mode decision (C10)
All in `@opt2-tealbrick/manifest` (pure, synchronous, no I/O), so bridge and app run identical code:
- `verifyGrant(token, ctx) → VerifiedGrant | Refusal` — signature with trusted key set, `typ`, `aud` = target instance, `exp`, `cnf.brg`, issuer. Used by the bridge before forwarding and by the app SDK again on receipt (re-verify).
- `gate(input) → { decision: "pass" | "refuse", reason }` — run by the BRIDGE on every routed call (MCP, relay, app→app) for every harness: (1) paused (workspace kill switch, agent, connection, instance) → refuse; (2) grant valid (`verifyGrant`) → else refuse; (3) `op.crud ⊆ grant.crud`, op is agent-audience, op's `scopeType` is one the target manifest declares → else refuse; (4) Bound, or (v0.1.19 C111a) any grant whose `wf` is non-empty: `op.id ∈ grant.wf` → else refuse; then the bridge runs before/context hooks (fail closed) and forwards. Exception: the standard op `tb.hold_status` passes step (3) with any valid grant (it returns only the caller's own holds).
- `authorize(input) → { decision: "run" | "hold" | "refuse", reason, holdFamily? }` — the MODE decision, run by the APP SDK before executing, because its state (scope access, caps counters, holds, receipts) lives in the app: (0) paused per the latest instance slice (workspace, agent) → refuse; (1) `verifyGrant` again; (2) scope access from the app's scope store: `op.crud ⊆ grant.crud ∩ access.crud` → else refuse; (3) effect / hold family ∈ `grant.held` → hold; (4) Free caps exceeded (receipts counters) → hold; (5) run. `money` is always held. No standing grants (C8): a hold is approved once per call; there is no "always allow" record.
Vocabulary (`free|bound`; effects `read|write|outward|destructive|money`; hold families `first_contact|profile_change|live_call|destructive|money`) is defined ONCE in `@opt2-tealbrick/manifest`; Core stores policy values but holds no literals of its own. Holds and receipts live only in the app (SDK receipts table).

## 8. Call path and hook envelope (bridge ↔ app)
- Agent → bridge: MCP (Streamable HTTP) with `Authorization: Bearer <agent session>`.
- Bridge → app (private network, HTTP): `POST <internalUrl>/tb/v1/ops/<operationId>`; headers `Authorization: Bearer <grant>`, `TB-Call: <call proof JWS>` (bridge key; claims `aud` target, `call` id, `gjti` = the grant's `jti`, `op`, `in` = sha256 of JCS input, `ctx` = sha256 of context, `exp` 60 s), body `{ input, context, idempotencyKey? }` (the agent may pass `_meta["tealbrick/idempotencyKey"]` on the MCP call; otherwise none).
- Hook call: `POST <internalUrl>/tb/v1/hooks/<hookId>` with `TB-Call` (claim `phase`), body `HookRequest { phase, call: { id, ws, caller {type,id,mode}, target {instance, product, op, crud, effect}, input? }, context }`. Responses: before → `{ allow: boolean, reason? }`; context → `{ add: { "<product>.<key>": JSON } }` (namespaced, merged into `context`); after → `{ output?, redactions? }`. `context` is an open JSON object (extensible; Rules adds `onBehalfOf` later without bridge change; opt2 does not set it).
- Order: before hooks (ascending `order`, then product id) → context hooks → target app → after hooks. Any before or context hook error/timeout (2 s) → refuse (fail closed). After hook error → output withheld, call marked `after_failed` in the receipt (the action is not undone).
- Errors: one envelope everywhere (also device-flow polling): `{ "error": { "code": "<snake_case>", "message": "...", "requestId": "...", "details"?: { } } }`.

## 9. Agents, connections, devices
- Agent (card) ≠ connection ≠ device-flow request ≠ person. An agent card can have several connections (e.g. five Mac minis). Owner-added agents are `free`; `bound` agents are created by apps (next wave) — the mode exists in opt2.
- The workspace bridge is deployed at onboarding step 1, right after the infrastructure link (B1), so every connection path below works before any app exists.
- Every agent connection is created by the owner in the Portal browser, whatever the harness, and recorded as one Connection Registry row `{con, agt, method, verifier}`:
  - key connection (TBD, `tealbrick` CLI agent mode, Claude Agent SDK / Eve kits): the agent machine generates K4, starts RFC 8628 device flow at Core with its public key, owner approves in the browser in one click → Core registers `{con, agt, method: key, publicKey}` → it appears in the next config → the agent exchanges a K4-signed agent assertion (RFC 7523 jwt-bearer) at the bridge `/oauth/token` for K5.
  - OAuth connection (Claude Desktop / Codex desktop remote MCP connector) — C4: the harness runs MCP OAuth 2.1 against the deployed bridge (bridge = authorization server for its own MCP resource: RFC 9728 protected-resource metadata, RFC 8414 AS metadata, RFC 7591 DCR, PKCE S256). The bridge's authorize page asks for the agent pairing code (K2b) shown on the agent card in Portal; the bridge verifies it offline (Portal key, `aud` = this bridge, unused `jti`), creates `con` (method `pairing`) locally, issues K5 access + rotating refresh, and reports the new connection in its next ack; Core records it. J1 no-terminal path (R3): the authorize page offers 'Approve in Portal' — browser redirect to Portal with a bridge-signed state, the signed-in owner picks/creates the agent card and approves, Portal form-POSTs a fresh K2b back to the bridge, verified offline; copy-paste of the code is the fallback. The approval screen shows the OAuth `redirect_uri` host and the DCR client name marked "unverified"; Core checks that the bridge's workspace belongs to the approving person (S3).
- Local bridge (C5): the same bridge package in `relay` mode inside the `tealbrick` CLI: serves stdio MCP to the harness, authenticates upstream to the deployed bridge as the agent (K5), holds no grants, no keys, no config, and duplicates no checks. Enforcement happens only in the deployed bridge. Exception: a bridge that is itself enrolled (own infrastructure) is a full bridge, whatever machine it runs on.
- A person credential is never input to any agent path (no exchange, no derivation, no forwarding).

## 10. Keys (option B) — C2
Bridge key store (sealed, bridge volume) holds workspace default keys (manifest source value `account_default`; GUI label "workspace default keys", N13) entered on the bridge key page (opened with a `pur: keys` person ticket). Apps fetch at run time `GET <bridge internal>/tb/v1/keys/<name>` with an instance assertion; the bridge returns only keys the app's manifest declares (`settings.keys[].source = account_default`). App-own keys (`source: app_own`) are entered in the app's own UI and stored in the app; when both exist the app-own key wins. Values are never logged, never sent to Portal; Portal sees only presence booleans per requirement name from the bridge status report. Upstream engine containers get keys through the SDK wrapper entrypoint (`tb-exec`: fetch declared keys with the instance key, exec the upstream command with them as env). v0.1.63 (C330(4)): the bridge also holds the workspace model-role registry (role → provider, model, base URL, key, data policy `local|zdr|standard`); apps declare `settings.modelRoles[]` with a minimum policy and resolve them from the bridge (BRIDGE §15); Portal sees role labels only.

## 11. Versioning
- Manifest `schema: "tealbrick.miniapp/2"`; one version, no `legacy` values, no negotiated version headers. Config `v: 1`. API base path `/api/v1`.
- SDK semver; Portal and bridge support the current SDK major and one before; older majors are removed by plan (CONFORMANCE version matrix).

## 12. Decisions already taken by the Coordinator (DECISION-LOG C1/C2)
- C1: "default scope grant" is a general manifest feature (`scopes[].defaultGrants`). Knowledge: connected agent gets own area read/write + shared area READ; shared WRITE off by default, owner toggles per agent in the app.
- C2: key delivery per §10 (bridge key store → app over private network with instance-credential auth, only manifest-declared keys, never logged, never Portal; SDK wrapper entrypoint for engine containers).

- C7: Portal Core DB = managed Postgres. C8: no standing grants. C9/C10: §7 and §13. C11: `$file` (binary/file) operation inputs are out of opt2.
- C15: v0 open items accepted (shared `/a/<product>/` origin until third-party apps; `entitled:false` entries; no refresh token for key connections; our error envelope on device polling). C16: v0.1 changelog above. C17: offers in the signed release index, `TB_KEK` via Railway `secret()`, `skillsDigest` in release records.
- C3: Railway link = Railway OAuth app (`workspace:admin offline_access`), refresh token sealed in Core and rotated on every use; fallback = pasted Railway workspace token, sealed. No project tokens. One link per account serves many workspaces; destination project chosen per workspace.
- C4/C5: see §9. Harness-local tools (e.g. TBD's Companion timeline tools for its default agent) are the harness's own tools, not app operations, and are not bridge-governed.
- C6: a companion service may carry an app-owned internal helper (thin layer FROM the pinned upstream image), started by `tb-exec`, declared in `runtime.services[].helper`, callable only by its own app instance (instance assertion), never exposed via the bridge.
- C12 (Connect data, not contract): one Composio user id per workspace; app-own key wins over the account default; `as_itself` uses the same flow.

## 13. Answers to REQUESTS.md (binding for all specs; details in the named spec)
| Request | Answer |
|---|---|
| Scope truth (connect, knowledge) | App is the authority (§6). Grant = CRUD ceiling + mode. Manifest `scopes[]` declares scope types, `access` levels per type, and `defaultGrants` (C1). SDK `authorize()` checks `grant.crud ∩ op.crud ∩ scope access`. The resolved scope access is computed in the app from its own store — never from a caller header. |
| Canvas scope summary | App serves the SDK bridge op `scope_summary` at `/tb/v1/bridge/scope-summary` (bridge-op call proof, B5; per agent, ≤ 80-char label, no third-party identifiers); bridge collects it into its status report; Core stores it display-only on the edge. |
| Dynamic tools (connect, knowledge) | Manifest operation with `dynamic: { mode: "list" \| "search", effectCeiling, crudCeiling }`. `list` (≤ 256 entries, e.g. engine ops): bridge shows each catalog entry as its own MCP tool. `search` (thousands, e.g. Composio): bridge shows `<product>__<op>_search` + `<product>__<op>_call`. Before authorize + hooks, the bridge resolves the concrete tool's `{crud, effect, holdFamily}` via SDK endpoint `POST /tb/v1/dynamic/<op>/resolve` (cacheable 5 min). Effect never comes from the agent. |
| Tier mapping (connect) | Scope access levels are app-declared per scope type; `authorize()` maps access → allowed CRUD set via the manifest (`access[].crud`). Connect: read→[read]; read_update→[read,create,update]; read_update_delete→[read,create,update,delete]. `money` effect is always held. |
| As me / as itself | App data (Connect stores the connection kind per account). Receipts carry `subjectKind` free field `as_me|as_itself` via the SDK receipt `meta`. Agent identity reaches the app only as grant `sub` (+ display name from the instance slice). |
| Agent list for apps | Instance slice carries `agents: [{id, name, mode, status}]` for agents with an edge to that app (and all agents for apps whose manifest sets `needsAgentDirectory: true`). No Portal call. |
| Public callbacks / webhooks | Manifest `publicRoutes: [{path, purpose: oauth_callback\|webhook}]`; bridge exposes only declared ones at `https://<bridge>/p/<product>/<path>`; the app verifies (state / provider signature). |
| Person UI in app | Person ticket `pur: launch` → `https://<bridge>/a/<product>/tb/launch` (form POST); the app SDK redeems it (verifies Portal signature, `aud` = its instance, one-time `jti` in app DB) and sets one session cookie scoped to `/a/<product>/`. Bridge proxies `/a/<product>/*` to the app's `ui` paths. OAuth popups started there return through `publicRoutes`. |
| Key read path / engines | §10 + C2. SDK `getKey(name)` (app-own > account default), `onKeysChanged`, readiness state `needs_keys`. `tb-exec` wrapper entrypoint for engine containers. Connector-level API keys inside Connect are app-own keys stored in Connect (allowed under option B). |
| Channel inbound delivery | Pull operation in the app (e.g. inbox op); no push into agent runtimes in opt2. `onBehalfOf` reserved for Rules (hook context, next wave). |
| Receipt redaction | SDK receipts store `inputDigest` + app-provided redacted `summary`; SDK `redact` hook per operation; raw bodies/secrets never stored. |
| Catalog artifact pin | Manifest `artifacts: [{id, version, sha256, url}]`; artifacts are GitHub release assets of the app repo. |
| Companion services (knowledge) | Manifest `runtime.services[]` (image @digest, port, volumes, health, env names, `keys` it needs, `when` setting condition, start order). Services authenticate to the bridge as part of their instance (own K8 key, enrolled with their own K6 code). Backups: SDK backup runner runs each service's declared `backup.dump` command into the backup volume. |
| Skills | Manifest `skills: [{id, file, title, when?}]`, files are SKILL.md (frontmatter + markdown) with `{{agent.name}}`, `{{agent.id}}`, `{{workspace.name}}`, `{{settings.<key>}}`, `{{scope.<type>.<default>}}` variables. Core renders the workspace bundle (per-workspace owner overrides); the bridge fills per-agent variables and serves skills as MCP resources + an index in `initialize.instructions`. |
| Idempotency | Manifest `operations[].idempotency: required\|supported\|none` (`required` for every `create`); SDK keeps keys in the receipts table: same key + same input digest → same result; different input → 409 `idempotency_conflict`. |
| Discovery intents (gui, core) | Manifest `discovery: { category, intents[] (≤ 60 phrases), keywords[] }`; catalog delivers them; GUI adds its own action intents. |
| Route registry machine-readable (core, gui) | `types/routes.ts` = the registry type + table; Core serves it at run time on the private network (`GET /internal/routes`) for the generated gateway; GUI may cache at boot keyed by registry digest. |
| Draft refs (core) | Draft steps may reference earlier outputs: `{"$ref": "#/steps/<n>/output/<json-pointer>"}`. Apply runs in order, stops at first failure, audits per step. Money steps never auto-charge: apply ends with a checkout handoff (pay pill). |
| Licence check location (core) | Core only (§6). |
| Grant TTL / propagation (core, bridge) — C9 | Grant 12 h, re-minted at half-life (< 6 h left). Config pull every 60 s as a long-poll (`wait ≤ 60 s`, returns at once on a new revision) → pause/revoke at online bridges in seconds, ≤ 60 s worst. Signed config older than 12 h (`iat` + 12 h) → the bridge fails closed (refuses all agent and app→app calls; person launch and key page stay up so the owner can act). Offline from Portal therefore = work continues ≤ 12 h. |
| Hooks resolution (bridge) | Core resolves the hook chain into the config (from Manifest Store); hook subscriptions are active once the declaring app is deployed and licensed, shown on the canvas, owner may disable each one (Portal op). Hook calls never trigger hooks. |
| Manifest in config (bridge) | Config carries `manifestDigest`; the bridge fetches `GET <internalUrl>/tb/v1/manifest` and verifies the digest. |
| Caps counting (bridge) — C10 | App (SDK receipts table). The bridge never counts. Bridge `gate()`s and forwards passed calls; the app's `authorize()` decides run/hold/refuse; held → `{status: "held", holdId}`; agents poll `<product>__tb_hold_status`. |
| Re-enrolment (bridge) | Portal op issues a new K6 for the bridge; new key replaces the old; Core refuses the old key's assertions immediately. |
| CLI writes harness config (bridge) | Print by default; write only with explicit `--write` after showing a diff; never at launch, never silent repair. |
| Repo split, layout, deps (platform) | REPOS.md. |

## 14. Integration decisions (Lead · Specs, after cross-reading the topic specs)
| # | Decision |
|---|---|
| I1 | `authorize()` step (0): the app SDK refuses when the latest instance slice marks the workspace or agent paused (connection revocation is enforced at the bridge; the slice carries no connections) (closes pause-matrix cells for held-action release and cached keys). |
| I2 | Call proof binds the grant via `gjti` (the proof keeps its own `jti`). |
| I3 | `TB_KEK` (bridge, apps) is generated by the provider at deploy (Railway `secret()` variable function); Portal never sees it. If the provider cannot generate it, the service creates it on first boot in a file excluded from backups. It is not one of our credential kinds (sealing key, never presented). Provider-generated service passwords (`env[].generate: "secret"`) are likewise "not ours". |
| I4 | Standard op `tb.hold_status` needs only a valid grant (see §7); agent edges need not include `read`. |
| I5 | The local relay speaks stdio only in opt2 (no loopback HTTP listener) → no relay-local token exists. |
| I6 | Config pull returns the signed config JWS itself (instance slices embedded); acks and status reports carry only digests, never codes or key values. Wire types for enrol / config / ack / status live in `types/bridge.ts`; `types/routes.ts` imports them. |
| I7 | Connection method names: `key` and `pairing` (CREDENTIALS). |
| I8 | Companion grants are minted with `mode: "bound"`, `wf` = the manifest-declared companion operations, `held` = the workspace apps policy `appsPolicy.held` (v0.1.15 C105a; default `DEFAULT_HELD_FAMILIES`, owner-editable in workspace settings), no caps (S5; `money` always held); the instance slice field is `grants`; the slice also carries `appsPolicy`. Every app→app call — in a handler or app-initiated (C85) — is held by the TARGET app's `authorize()` from that claim, exactly as an agent call is held from its card policy; the bridge never decides holds (§7). |
| I9 | The manifest validator rejects an operation whose MCP tool name `<product>__<op>` exceeds 64 characters. |
| I10 | Vocabularies live in `@opt2-tealbrick/spec` (data); `@opt2-tealbrick/manifest` re-exports them. |
| I11 | Bridge first start without Portal (pure self-hosting with agents) is next wave; opt2 standalone = leaving Portal (handover). An app run standalone without a bridge serves persons only. |
| I12 | OAuth refresh rotation: the immediately previous refresh token is accepted once within 30 s (network-retry grace); any other reuse revokes the connection. |
| I13 | Env names (one each): `TB_ENROL_CODE`, `TB_KEK`, `TB_PORTAL_KEYS`, `TB_BRIDGE_URL`, `TB_INSTANCE_ID`, `TB_DATA_DIR`, `TB_BACKUP_DIR` (full list in SDK-API). |
| I14 | Free caps claim shape: `caps: { write?: Cap, outward?: Cap, destructive?: Cap }`, `Cap = { max: integer ≥ 0, per: "hour" \| "day" }`; counted by the app per (agent, effect) over a sliding window from receipts. Agent Policy defaults for Free agents: write 500/hour, outward 30/hour, destructive 20/day; default held families = `DEFAULT_HELD_FAMILIES` (destructive, money, first_contact; v0.1.15 C105). `money` has no cap: always held. |
| I15 | `instances.remove` needs browser confirmation and an explicit `deleteData` (default false: service stopped, volumes and backups kept). Core never deletes customer data implicitly. |
| I16 | Own-infrastructure bridge enrolment (PRD §3.5, J3) is live in opt2 under an "Advanced" panel; only Coolify as a deploy PROVIDER is greyed out. |
| I17 | Offers are reviewed data shipped in the signed release index (`-platform`) and verified against Stripe at Core start; no env-var offer lists. |
| I18 | `drafts.validate` exists (owner-cli + browser, read-class): validates a draft against the route table and current state without applying. |

## v0.1.43 — the workspace views service (LA-1, C232)
Core creates `tb-views` (the bridge image with `TB_ROLE=views`, same digest as the bridge) only when the workspace deploys an app whose release manifest has a `viewer` public route; order: empty service → env (`TB_ROLE`, `TB_VIEWS_UPSTREAM` = bridge private URL, `TB_VIEWS_KEY` generated + sealed, also set on the bridge) → one generated domain → image → one deploy (L5, L40). The next signed config carries `bridge.viewUrl`. A bridge update also updates tb-views (after the bridge is healthy). Removal: when the last viewer app is removed, and always with the bridge; tb-views has no volume, so nothing is kept (no kept-data item). The cost estimate shows a "Page viewer service" line. Own-infra bridges: the operator runs a second container with `TB_ROLE=views`.
