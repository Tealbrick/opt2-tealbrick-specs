# opt2 specs — CREDENTIALS (credential registry)

Status: v0.1, Lead · Specs, 2026-10-11. Obeys CORE.md (§2–§10, §12–§14, C1–C17, I1–I18). Machine-readable twin: `types/credentials.ts` (claim sets, `typ` constants, registry table). Markdown and `.ts` disagree → the `.ts` wins and this file is a spec bug.

Scope: every credential and proof in opt2 — who issues it, with which key, who holds it, how it is stored, its exact claims, lifetime, audience rule, verifier and check order, revocation, and pause behaviour. Also: identifiers, the one grant, key management (sealing, rotation, compromise), the revocation matrix, the pause matrix, hard rules with conformance cases, owner CLI / TBD identities, device flow, pairing code, standalone handover, key custody and the external credentials Core holds. Wire shapes of the config body, routes and SDK calls are owned by BRIDGE.md, PORTAL-API.md and SDK-API.md; this file owns every credential field they carry.

## 1. Caller types (exactly five; v0.1.58 adds `host`, see the v0.1.58 section)
| Caller type | Identity | Proves itself with | Talks to |
|---|---|---|---|
| person | `per_` (1:1 with the Clerk account owner) | K1 (browser), K3 (owner CLI / owner native session in TBD), K11 (one-time ticket, at bridge key page or app launch only) | Portal (K1, K3); bridge key page (K11 `keys`); app UI (K11 `launch`); K11 is obtained only with K1 |
| agent | `agt_` (agent card) | K5 at the bridge, obtained via K4 assertion or K2b pairing | the deployed bridge only (directly or through the local relay) |
| app | `ins_` (app instance; its runtime services are part of it) | instance assertion (K8); companion grant (K10, `sub = tb:ins:`) | the bridge internal endpoints only |
| bridge | `brg_` | bridge assertion (K7) to Portal; signs K5 and call proofs | Portal (outbound only); apps (private network) |
| Portal | `tb:portal` (Core) | K12 signatures on K2b, K9, K10, K11 | nobody inbound; Portal never calls into customer infrastructure |

There is no sixth caller: the GUI gateway is not a caller (it forwards the caller's own credential and adds no identity headers; §18 R-no-shared-secret), Clerk/Stripe/Railway are external issuers, and a local relay bridge acts as the agent (CORE §9).

## 2. Identifier model
Agent ≠ connection ≠ device-flow request ≠ session ≠ person. Id format CORE §1; reference format `tb:<kind>:<id>` CORE §2 (`tb:portal`, `tb:per:per_…`, `tb:agt:agt_…`, `tb:ins:ins_…`, `tb:brg:brg_…`).
| Identifier | Issued by | When | Pairing flow | Ends |
|---|---|---|---|---|
| person `per_` | Core (bound to Clerk `sub`) | first Clerk sign-in | browser: Clerk; CLI/TBD: device flow `scope=owner` (§6) → K3 | account deletion |
| agent `agt_` | Core | owner creates the agent card in the browser (or a draft applied by the owner) | none itself; it gets connections | owner revokes the card |
| connection `con_` (= one machine / harness install of an agent) | key method: Core at device-flow approval; pairing method: the bridge at K2b redemption (reported in the next config ack; Core records it, CORE §9) | §6, §7 | key: K4 + device flow `scope=agent`; pairing: K2b → OAuth (Claude Desktop / Codex connector only) | owner revokes the connection, refresh reuse detected, agent revoked |
| device-flow request `dev_` | Core | device authorization request | RFC 8628 (§6) | approval, denial or 10 min |
| session | bridge | each `/oauth/token` success | one K5 access token (`jti`); its refresh chain is identified by `(con, gen)` | access `exp` (15 min); chain ends with the connection |

A connection belongs to exactly one agent; an agent has 0..n connections; a session belongs to exactly one connection; no identifier is derived from a person credential.

## 3. Common token rules (every kind we issue)
- JWS compact, ≤ 8192 bytes. JOSE header has exactly `alg`, `typ`, `kid`; `alg = "EdDSA"` (Ed25519); `kid` = RFC 7638 SHA-256 thumbprint (base64url, 43 chars) of `{crv,kty,x}`. Headers `jku`, `jwk`, `x5u`, `x5c`, `crit` → reject.
- Payload: `iss`, `sub`, `aud` (one string, never an array), `iat`, `exp` (integer seconds), `jti` (26-char ULID, no prefix) are mandatory; the claim set per kind is closed (unknown claim → reject).
- Leeway L = 30 s: accept only if `iat ≤ now + L` and `now < exp + L` and `exp − iat ≤ max lifetime of the kind` (§4). **Exception (v0.1.64, QA-SPEC43-7): K14 uses `PERSON_OP_RELAY.expLeewayS` (2 s) instead of L for both `iat` and `exp`**, so no relayed op runs after Core answered its caller.
- Check order (every verifier, "V0"): (1) size + 3 parts → (2) header exact, `alg`, `typ` = the ONE typ this endpoint accepts → (3) `kid` in the key set trusted for that typ's issuer → (4) signature → (5) closed claim set, types → (6) `iss` allowed for this typ → (7) `aud` = verifier's own reference → (8) time window + max lifetime → (9) kind-specific checks → (10) one-time kinds: `jti` not seen, then record it until `exp + L`. A failure at any step → refuse with error code `invalid_token` (no detail on which step to the caller; detail in the verifier's log, never the token itself).
- Opaque values (K2, K3, K6, refresh tokens, OAuth authorization codes): 32 random bytes, base64url (43 chars), behind a fixed prefix; the issuer stores only `sha256:<hex>` of the full string and compares in constant time.
| Opaque value | Prefix | Issuer |
|---|---|---|
| device code (K2) | `tbdv_` | Core |
| owner CLI session (K3) | `tbo_` | Core |
| enrolment code (K6) | `tbe_` | Core |
| agent refresh token (K5) | `tbr_` | bridge |
| OAuth authorization code (K5 issuance step) | `tbac_` | bridge |

## 4. Credential registry (16 kinds = K1–K15 + K2b; v0.1.58 adds K13 host key; v0.1.64 adds K14 relayed person op; v0.1.88 adds K15 acting ticket)
Max lifetime is enforced by every verifier (`exp − iat`). "Digest" = SHA-256 at the issuer; "sealed" = AES-256-GCM under a KEK (§9).
| # | Kind / `typ` | Issuer key → holder | Storage | Lifetime (max) | Audience rule | Verifier (key) | Revocation (mechanism → speed) | Pause |
|---|---|---|---|---|---|---|---|---|
| K1 | person session (Clerk JWT) | Clerk → browser | Clerk cookie; Core stores nothing | Clerk token 60 s, refreshed by Clerk JS | Clerk `azp` = Portal origin | Core (Clerk JWKS) | Clerk sign-out / session revoke → ≤ 60 s | n/a (person) |
| K2 | device code (opaque `tbdv_` + user code) | Core → CLI / TBD | digest (both codes) | 600 s | bound to `client_id` + `scope` at Core | Core (digest) | deny / expiry → immediate | Core refuses `scope=agent` approval while workspace kill switch is on |
| K2b | agent pairing code `tb-pair+jwt` | K12 → owner, redirected (path A) or pasted (path B) into the bridge authorize page; OAuth connector paths only | not stored by holder; Core keeps `jti` + state; bridge keeps used `jti` (persisted) | 600 s | `aud = tb:brg:<workspace bridge>` | bridge (Portal key set) | Core adds `jti` to `revoked.jtis` → ≤ 60 s; one-time | redemption refused while workspace kill switch or agent pause |
| K3 | owner CLI session / owner native session (opaque `tbo_`, `client: cli \| tbd` recorded at Core) | Core → owner CLI / TBD person keychain item (ACL with user presence where supported) | digest | 30 d absolute; idle 24 h (`cli`), 7 d (`tbd`, v0.1.53 C289), sliding on use, never past the absolute life | Core routes marked owner-CLI-allowed only: reads + drafts; never apply, codes or tickets (§12) | Core (digest) | `tealbrick logout` / Portal session list → immediate | n/a (person; drafts never act) |
| K4 | agent connection key (Ed25519 pair) | agent machine → itself; Core stores public JWK | private: OS keychain on the agent machine; public: Connection Registry + config | until the connection is revoked | its assertions: `aud = tb:brg:<id>` | bridge (public key from config) | connection revoke → ≤ 60 s | see K5 |
| K5 | agent session `tb-agent-session+jwt` + refresh `tbr_` | K7 → agent (harness / stdio relay, which holds it in memory; no relay-local token, CORE I5) | access: memory only; refresh: holder keychain / harness store, bridge keeps digest + `gen` | access 900 s; refresh 30 d sliding | `aud = tb:brg:<self>` | bridge (own key) | config drops/revokes `con` or `agt` → ≤ 60 s; refresh reuse → chain revoked at once | calls refused by `gate()` (1); issuance continues (§13) |
| K6 | enrolment code (opaque `tbe_`) | Core → env `TB_ENROL_CODE` of one bridge / instance / service | digest | ≤ 24 h, one-time | bound at issue to `{ws, target: bridge \| ins_ [+ svc]}` | Core (digest) | redeemed / expired / superseded by a new code → immediate | Core refuses redemption for a paused instance |
| K7 | bridge key (Ed25519 pair) | bridge → itself; Core stores public JWK | private: sealed on bridge volume (`TB_KEK`); public: Bridge registry, slices | until re-enrolment | bridge assertions `aud = tb:portal` | Core (registered public key); apps (key from slice) | re-enrolment → Core refuses old key at once; apps ≤ 60 s + slice | n/a (the bridge enforces pause) |
| K8 | instance key (Ed25519 pair, one per instance and per runtime service) | app → itself; Core stores public JWK | private: sealed on app volume (`TB_KEK`); public: Instance Registry + config | until re-enrolment / deletion | instance assertions `aud = tb:brg:<id>` | bridge (public key from config) | re-enrol / delete instance → ≤ 60 s | instance pause / kill switch: assertions accepted only for slice pull and status (§13) |
| K9 | workspace config `tb-config+jws` / instance slice `tb-slice+jws` (two `typ`s, one kind) | K12 (standalone: bridge key for slices) → bridge (→ app) | bridge: last good config on volume; app: last slice in its DB | 12 h (`iat + 43200`); older → fail closed (C9) | config: `aud = sub = tb:brg:<id>`; slice: `aud = sub = tb:ins:<id>` | bridge (Portal key set); app SDK (Portal key set / standalone issuer) | superseded by higher `rev` | carries pause state |
| K10 | grant `tb-grant+jwt` (agent→app and companion app→app) | K12 (standalone: bridge key) → bridge (agent grants) / calling app (companion grants, from slice) | memory + config/slice cache (v0.1.82 workflow grants: memory only, fetched on demand) | 43200 s, re-minted at half-life (v0.1.82: a grant with `wfl` 900 s, re-fetched at half-life) | `aud = tb:ins:<target>`; `cnf.brg` = workspace bridge | bridge `verifyGrant` before forwarding; app SDK `verifyGrant` again (Portal key set) | not re-minted + `revoked.jtis` → ≤ 60 s online; offline ≤ 12 h (v0.1.82 workflow grants: config withdrawal record or `wflEpoch` → ≤ 60 s online; offline ≤ 15 min) | agent→app grants not minted while paused; companion (app→app) grants stay minted (pause is status-only for them, C359a); `gate()` (1) refuses |
| K11 | person ticket `tb-ticket+jwt` (`pur: launch \| keys`) | K12 (standalone: bridge key) → browser of a K1 person (never via K3) | not stored by holder; `jti` used-set: app DB (`launch`), bridge volume (`keys`) | launch 60 s; keys 120 s; one-time | `launch`: `aud = tb:ins:<target>`; `keys`: `aud = tb:brg:<id>` | app SDK (`launch`) / bridge key page (`keys`) (Portal key set) | not re-issuable after use; app UI session ends by `personNbf` (§12) | not paused (owner access by design, §13) |
| K12 | Portal signing key (Ed25519) | Core → Core | private sealed in Core DB (`TB_KEK`); public in config, slices, `TB_PORTAL_KEYS` | planned rotation 90 d | — | — | rotation / compromise procedure §9 | n/a |
| K14 | relayed person op `tb-person-op+jwt` (v0.1.64, C326) | K12 (Portal only) → workspace bridge (relay, in memory) → target app | Core: sealed until the row ends; app: `jti` used-set | 10 s; one-time | `aud = tb:ins:<target>`, allow-listed (product, op); writes only for `cli: tbm` | app SDK `POST /tb/v1/person-op` (Portal keys only) | one-time; not minted for a revoked or idle-expired K3 | not paused (owner access by design, like K11) |
| K15 | acting ticket `tb-act+jwt` (v0.1.88, C378) | bridge identity key → the app it names, for one job | app database with the job | 30 d | a fact for hooks, never access; BRIDGE §8.7 |

No purpose has two kinds: human at Portal = K1; human at CLI/TBD = K3; device pairing = K2; harness OAuth pairing = K2b; agent calls = K5; one-time registration = K6; agent→app and app→app = K10; person into app/key page = K11; configuration = K9; native owner person op through the relay = K14 (v0.1.64).

Intermediate artefacts inside one kind's issuance (not separate kinds, never accepted elsewhere): the device-flow `user_code` (K2); the OAuth authorization code `tbac_` (60 s, one-time, digest, bound to `client_id`, `redirect_uri`, PKCE S256 `code_challenge`, `con`) and the DCR `client_id` (public client, no secret) inside K5 issuance; the app UI session cookie and the key-page cookie created by redeeming K11 (§12). Purposes are disjoint: the CLI and TBD connect agents only with K2 + K4 (key connection); K2b serves only harness OAuth connectors (C16 S9).

## 5. Claims per kind (exact names; `types/credentials.ts` is normative)
| Kind | `iss` | `sub` | `aud` | Other claims |
|---|---|---|---|---|
| K2b pairing code | `tb:portal` (never issued in standalone, §17) | `tb:agt:<id>` | `tb:brg:<id>` | `ws`; `rid?` (bridge authorize-request id, only on the redirect path §7) |
| K5 agent session | `tb:brg:<id>` | `tb:agt:<id>` | `tb:brg:<id>` (same bridge) | `ws`, `con`, `gen` (connection credential generation from config) |
| K9 config | `tb:portal` | `tb:brg:<id>` | `tb:brg:<id>` | `ws`, `v: 1`, `rev` (monotonic int) — the body (BRIDGE.md schema) carries the credential section §5.1 |
| K9 slice | `tb:portal` (standalone `tb:brg:<id>`) | `tb:ins:<id>` | `tb:ins:<id>` | `ws`, `v: 1`, `rev` |
| K10 grant | CORE §6 verbatim | `tb:agt:<id>` or `tb:ins:<caller>` | `tb:ins:<target>` | `ws`, `cnf: {brg}`, `crud`, `mode`, `held`, `caps`, `wf`, `polrev`; companion only: `prd?` (v0.1.46), `wfl?` (v0.1.82: workflow id of the caller app; `wf` stays the op list) |
| K11 launch | `tb:portal` (standalone `tb:brg:<id>`) | `tb:per:<id>` | `tb:ins:<target>` | `ws`, `pur: "launch"`, `path?` (app-relative UI path, must start with `/`) |
| K11 keys | same | `tb:per:<id>` | `tb:brg:<id>` | `ws`, `pur: "keys"`, `req?` (requirement names to focus; display only) |
| K14 person op (v0.1.64) | `tb:portal` only | `tb:per:<id>` | `tb:ins:<target>` | `ws`, `op`, `bd` (sha256 hex of the forwarded UTF-8 body bytes), `idk`, `cli` (`tbm` only in v0.1.64), `pop` |

All also carry `iat`, `exp`, `jti`. K1 is Clerk's format and is never in `tb:` form (CORE §2).

### 5.1 Credential section of config and slice (field names fixed here; container schema in BRIDGE.md)
| Field | In | Content |
|---|---|---|
| `portalKeys` | config, slice | `[{jwk, status: "pending" \| "active" \| "retired"}]` — the only way a verifier learns a new Portal key (§9) |
| `bridge` | slice | `{id, keys: [jwk]}` — keys the app accepts for call proofs |
| `connections` | config | `[{con, agt, method: "key" \| "pairing", gen, publicKey? (key method), status: "active" \| "revoked"}]` |
| `instanceKeys` | config | `[{ins, svc?, jwk}]` — keys the bridge accepts for instance assertions |
| `pause` | config, slice | `{workspace: boolean, agents: agt_[], instances: ins_[]}` (connections are revoked, not paused). C353 (QA-SPEC49-15/-18): in a SLICE `pause.agents` is always `[]` — a paused edge agent is marked by `agents[].status = "paused"` (same byte length as `"active"`; pausing adds at most the own instance id, ≈ 42 chars) — and `pause.instances` holds at most its own instance |
| `revoked` | config, slice | `{jtis: [{jti, exp}]}` (unique) — grants / pairing codes withdrawn before `exp`; entries drop after `exp`. C353: a SLICE carries only jtis of COMPANION grants that target or originate at its instance; agent-grant, pairing-code and other apps' jtis are bridge-only (the bridge never forwards a call under a revoked agent grant) |
| `personNbf` | slice | epoch seconds; app UI sessions created before it are invalid (§12) |
| `standalone` | config, slice | absent, or `{issuer: "tb:brg:<id>", kid, ownerKeys: [jwk]}` (§17) |
| grants | config (agent grants), slice (companion grants held by that app) | K10 compact strings. v0.1.82: grants with `wfl` are never in either (fetched on demand) |
| `workflowGrantsWithdrawn` | config only (v0.1.82; only to a bridge with cap `app_workflow_grants`) | `[{sub: tb:ins:<caller>, wfl, aud?: tb:ins:<target>, at}]` — workflow grants withdrawn before `exp`; a grant with `wfl` matching `sub`, `wfl` and (if present) `aud`, with `iat ≤ at`, is refused by the bridge. ≤ `WORKFLOW_WITHDRAWN_MAX` (64) per caller; kept until `at + WORKFLOW_GRANT_TTL_SEC + 2 × LEEWAY_S` (C5 S3-1) |
| `wflEpoch` | config only (v0.1.82; same gate) | `{"tb:ins:<caller>": epochS}` — every grant with `wfl` of that caller with `iat ≤` the value is refused (overflow path when more than 64 records would be live, and every change that re-mints that caller's base grant with other claims, C5 S2-1); kept as long as a record |
| `workflowGrantEdges` | config only (v0.1.82, C5 S3-3; same gate) | `{"tb:ins:<caller>": ["tb:ins:<target>", …]}` — targets whose companion edge is enabled and licensed and whose entry has `perWorkflow`; a grant with `wfl` whose `aud` is not listed for its `sub` is refused by the bridge |

## 6. Device flow (K2, RFC 8628) — owner CLI, TBD person, key connections
Wire shapes: `types/routes.ts` is the ONE source (`DeviceStartInput`, `DeviceStart`, `DeviceTokenInput`, `DeviceOwnerTokenResult`, `DeviceAgentTokenResult`; ops `device.start`, `device.token`, `device.lookup`, `device.approve`, `device.deny`). This section fixes only the credential rules; it does not restate fields.
| Item | Rule |
|---|---|
| Start (public) | `DeviceStartInput` is a discriminated union. `scope: "owner"` only with `client_id` ∈ `tealbrick-cli`, `tbd`, `tbm` (v0.1.64) and no key. `scope: "agent"` with `client_id` ∈ `tealbrick-cli`, `tbd`, `kit`, a harness, a machine label (≤ 64 chars, display only) and 1..64 `{agt?, public_key}` pairs (one approval, C16 S4). Any other combination (e.g. `kit` + `owner`, a key on an owner request) → refused. A kit can never obtain K3. |
| `device_code` | `tbdv_` + 43 base64url; digest only |
| `user_code` | 8 chars from `BCDFGHJKLMNPQRSTVWXZ` shown `XXXX-XXXX` (≈ 2^34.6); digest of the normalised form (upper case, no hyphen); returned in clear only in the start response |
| Lifetime / polling | 600 s; interval 5 s; `slow_down` adds 5 s; RFC 8628 error names inside our error envelope (C15) |
| Binding (no unbound approval) | Core never lists pending requests. `device.lookup {userCode}` (K1, `userCode` required) returns exactly the one request whose digest matches, with no clear user code in the output. `device.approve {userCode, ws?, agents?}` (K1) matches the digest again. Wrong user codes: 5 per K1 session per 10 min, then refused. J1 "one click" stays: TBD / CLI opens `verification_uri_complete`; the Portal page reads the code from the URL and calls lookup. |
| Owner approval screen (`scope=owner`) | shows client, machine label, request time, user code, and the text "This signs in a tool AS YOU — never approve for an agent."; one Approve |
| Agent approval screen (`scope=agent`) | shows client, harness, machine label, user code, and for each pair the agent card (pre-selected or chosen among the workspace's cards) and workspace; one Approve creates all connections |
| Result `scope=owner` | `DeviceOwnerTokenResult` carries the K3 value once; Core keeps its digest + `client: cli \| tbd \| tbm` |
| Result `scope=agent` | Core creates one `{con, agt, method: "key", publicKey, gen: 1}` per pair; `DeviceAgentTokenResult` carries identifiers (incl. `bridge_id` for the assertion `aud`, v0.1.1 C26) and bridge endpoints and NO bearer. The agent waits until the connection is in the bridge config (bridge answers `invalid_grant` / `connection_unknown` until then; retry with backoff ≤ 60 s) and exchanges a K4 agent assertion (§10). |
| Conformance | `cred.dev.no_unbound_list`, `cred.dev.approve_requires_user_code` (missing / wrong code refused; 6th try refused even with the right code), `cred.dev.no_clear_user_code` (no output after start carries it; DB holds the digest), `cred.dev.one_time`, `cred.dev.expiry`, `cred.p1.kit_cannot_get_owner` |

## 7. Agent pairing code (K2b, C4) — Claude Desktop / Codex OAuth connectors only
- Issued by Core on the agent card (owner, K1 or applied draft) for that agent and the workspace bridge. 10 min, one-time. Core records `{jti, agt, exp, state: issued|redeemed|cancelled}`; "cancel" adds the `jti` to `revoked.jtis`. The CLI and TBD never use K2b; they use the key connection (§6).
- Path A (preferred for J1, no terminal, no copy-paste): the harness opens the bridge `/oauth/authorize` (PKCE S256, DCR client). The page shows "Approve in Portal"; it creates a request id `rid` (bound to the pending authorization request, 10 min) and a pairing state proof (§10, `tb-pair-state+jwt`) and sends the browser to `https://<portal>/pair` with the state in an auto-submitting form POST. Core verifies the state (registered bridge key, `ret` = that bridge's registered public URL + `/oauth/pair/callback`, `jti` unused) and that the bridge's workspace belongs to the K1 principal's account. The approve screen shows the agent card picker, the redirect URI host (`rh`) and the DCR client name (`cn`) marked "unverified". On confirm, Core mints K2b with `rid` = state `rid` and returns the browser to `ret` with an auto-submitting form POST (`code=<K2b>`), never a URL query; the bridge verifies it offline.
- Path B (fallback): the owner copies the code from the agent card and pastes it on the bridge authorize page.
- Bridge verification: V0 with `typ = tb-pair+jwt`, Portal key set, `iss = tb:portal`, `aud = tb:brg:<self>`; then (9) `ws` = config workspace; `sub` agent exists in config and is neither revoked nor paused; workspace kill switch off; `rid` present ⇔ path A and equal to the pending request; last successful config pull ≤ 10 min ago (bounds a leaked Portal key at an offline bridge, §9.4); (10) `jti` unused (persisted until `exp + L`). Success → the bridge creates `con_` (method `pairing`, `gen = 1`), issues an authorization code bound to the pending request, and reports the connection in the next config ack.

## 8. K5 issuance and refresh (bridge `/oauth/token`)
| `grant_type` | Who | Input | Output |
|---|---|---|---|
| `authorization_code` | pairing (OAuth) connection | `tbac_` code + PKCE `code_verifier` + `client_id` + `redirect_uri` | access + refresh |
| `refresh_token` | pairing connections | `tbr_` | new access + new refresh (rotation) |
| `urn:ietf:params:oauth:grant-type:jwt-bearer` (RFC 7523) | key connections | `assertion` = agent assertion (§10) | access only (no refresh: the agent re-asserts with K4; C15) |
No other grant type exists.
- Refresh rotation: each use invalidates the presented token and stores the new digest with `gen+1`; the immediately previous token is accepted once within 30 s of its rotation (network-retry grace, CORE I12); any other reuse of a rotated token → the whole chain of that `con` is revoked, the event is reported in the ack, the owner sees "connection signed out". Refresh valid 30 d from its own issue (sliding).
- The bridge refuses issuance for a `con` that is unknown or `revoked`, an agent that is revoked, or `gen` lower than config. Issuance is allowed while paused (calls are refused, §13).
- Access token use: every MCP request `Authorization: Bearer <K5>`; bridge check: V0 (`typ = tb-agent-session+jwt`, own key, `iss = aud = tb:brg:<self>`), then `con` active in config with `gen` equal, `sub` = the connection's agent, `ws` = config workspace; then `gate()`.

## 9. Key management
### 9.1 Sealing (Core, bridge, apps — one format)
Sealed blob = JSON `{v: 1, alg: "A256GCM", kek: <KEK id>, iv: <12 random bytes b64url>, ct, tag}`, AAD = `tb:seal:<purpose>:<record id>` (e.g. `tb:seal:portal-key:<kid>`), so a blob cannot be moved to another record. KEK = 32 random bytes from the service environment, one env name everywhere (CORE I13): Core `TB_KEK` + `TB_KEK_ID` (Railway sealed variable); bridge and apps `TB_KEK`, generated by the provider at deploy (Railway `secret()` variable function) so Portal never sees it; if the provider cannot generate it, the service creates it on first boot in a file under `TB_DATA_DIR` that is excluded from backups (CORE I3). A KEK is a sealing key, never presented, and not one of our credential kinds ("not ours"); the same holds for provider-generated service passwords (`env[].generate: "secret"`). KEK rotation: set `TB_KEK_PREVIOUS` + new `TB_KEK`, restart, the service reseals every blob on start, then remove `TB_KEK_PREVIOUS`.

### 9.2 Portal signing keys (K12)
- One global key set (not per account). States: `pending` (announced, never signs) → `active` (exactly one; signs) → `retired` (verify only; private half destroyed at retirement) → removed from key sets.
- Trust rule (CORE §4), v0.1.11: the trusted set comes ONLY from the newest root-signed key-set statement (§9.5). Nothing else widens the set (C133: the pre-v0.1.11 announce rule and its transition path are removed in 0.1.26): not a document's `portalKeys`, not a key announced by a trusted signer. The only other key source is an app's bootstrap `TB_PORTAL_KEYS`, used until its first slice is installed.
- Every state change of the table below is one key-set statement (§9.5), each `seq` + 1; Core switches its signing key only after the activating statement is published.
- Planned rotation (every 90 d, or on demand):
| t | Action |
|---|---|
| T0 | generate key B (`pending`), sealed; next config revision and all slices list B as `pending` |
| T0 + 24 h | B → `active` (signs everything from now on); A → `retired`, private half destroyed |
| T0 + 24 h + 12 h + 5 min | A removed from `portalKeys` (every A-signed token — max 12 h — has expired) |
| next app redeploy | `TB_PORTAL_KEYS` env rewritten (public value) |
- Bootstrap: the first key of a fresh Core is `active` at once.

### 9.3 Bridge, instance and agent keys
Generated where they are used (bridge first start; instance/service first start; agent machine before device flow), never exported, private half never leaves the host. Portal stores only public JWKs. Rotation = re-enrolment (new K6 for bridge/instance) or a new connection (agent).

### 9.4 Compromise procedures
| Leaked | Exposure | Procedure (in order) | Effect / speed |
|---|---|---|---|
| Portal key (K12 private, or `TB_KEK` + DB) | forge K2b (new agent connections at a bridge), K11 (launch into apps, key page writes), grants (useless without a bridge call proof) | (1) generate key B, `active` at once (skip the 24 h); (2) next config/slices, signed with A, list B `active` and remove A; (3) re-mint all grants with B in that revision; (4) revoke every connection created by pairing since the suspected leak (Core lists them from acks); (5) if `TB_KEK` leaked: rotate KEK (§9.1), roll Railway refresh token (re-link) and Stripe webhook secret; (6) audit + incident record | online bridges/apps ≤ 60 s; offline bridges refuse K2b once their last pull is > 10 min old (§7); key-page writes are write-only (no value disclosure) |
| bridge key (K7) | forge K5 for any agent of that workspace, call proofs | (1) owner re-enrols the bridge (new K6) → new K7; Core refuses old key immediately; (2) slices carry the new bridge key; (3) if the volume leaked too: wipe refresh digests (all pairing connections re-pair) and rotate every account-default key in the key store | forged K5 dead at the bridge on restart with the new key; apps ≤ 60 s |
| instance key (K8) | act as that app at the bridge (companion calls, fetch its declared keys) — private network access needed | (1) pause the instance; (2) re-enrol it (new K6); (3) rotate the third-party keys that app may fetch (Portal shows their names) | ≤ 60 s |
| agent key (K4) / refresh token | act as that agent | revoke the connection in Portal; re-authorise with a new device flow / pairing | ≤ 60 s online; offline bridge ≤ 12 h |
| owner CLI / native session (K3) | create drafts, read workspace (no apply, no codes, no tickets) | revoke in Portal (or `tealbrick logout`) | immediate |

### 9.5 Portal Root Keys and key-set statements (v0.1.11, C62/C63, BSD-08)
**Root keys are trust anchors, not credential kinds** (the kinds of §4 are unchanged by root keys). Two Ed25519 keys, `root-a` (primary) and `root-b` (backup), generated and held OFFLINE, never in Core, Railway, CI or any repo. They sign ONLY key-set statements.
- **Pinning**: the root PUBLIC JWKs are release data, `PORTAL_ROOT_KEYS = { dev, prod }` in `types/credentials.ts`, embedded in every bridge and SDK build. Dev-channel builds pin `dev` (the pair Platform generated locally, kept in `~/.config/opt2-tealbrick/`, mode 0600; public copy `opt2-tealbrick-platform/registry/portal-root-keys.dev.json`); stable builds pin ONLY `prod` (empty until the cutover ceremony). The channel is a build constant, never an env value (Portal sets env at deploy). A root change = new spec + bridge/SDK release; there is no in-band root rotation.
- **Key-set statement (KSS)**: compact JWS, header exactly `{alg: "EdDSA", typ: "tb-keyset+jws", kid}` with `kid` = RFC 7638 thumbprint of the signing root; claims (closed set, `KeySetStatementClaims`) `{iss: "tb:portal-root", aud: "tb:portal-keys", seq, iat, keys: [{jwk, status: pending|active|retired}]}`; `seq` integer ≥ 1; `keys` 1–8 entries, distinct thumbprints, exactly one `active`, each `jwk` an Ed25519 public JWK (a `kid` member, if present, equals its thumbprint); ≤ `MAX_JWS_BYTES`. No `exp`/`sub`/`jti`: a statement is superseded only by a higher `seq`. Published as the signed file `opt2-tealbrick-platform/registry/portal-keyset.jws`; Core reads it at start and carries it verbatim as `portalKeySet` in the enrolment response, every config and every slice (no new Core route).
- **Verifier rule** (bridge and SDK, ONE implementation: `@opt2-tealbrick/manifest` `verifyKeySetStatement` / `trustedPortalKeys`): accept a KSS only if (1) it is signed by a pinned root, (2) the claims are exactly the closed set with well-formed keys, (3) `seq` > pinned `seq`, or `seq` = pinned `seq` and the JWS is byte-identical (anything else → `keyset_rollback`). The trusted Portal key set is the `keys` of the newest accepted KSS: a config or slice is accepted only if signed by an `active` or `pending` key of it; grants, tickets and pairing codes verify with any key it lists (incl. `retired`, §9.2). The KSS is evaluated BEFORE the document signature (it is self-authenticating), so the document carrying it is verified with the new set. The pinned KSS (`{seq, kss}`) is persisted with the document it came with: the bridge's sealed S1 (BSD-03), the app store. Refusal codes `KEYSET_REFUSAL`: `keyset_invalid` (JWS, unknown root, signature, claims, keys), `keyset_rollback`, `keyset_missing`; a refused KSS drops the whole document (last good kept).
- **Rules (a) and (b)** (the transition rule (c) is gone, C133): (a) A KSS is pinned → every later document MUST carry a valid `portalKeySet`: config, slice AND the enrolment response of a bridge's re-enrolment (absent or invalid → `keyset_missing` / `keyset_invalid` / `keyset_rollback`; the document is refused; a refused re-enrolment leaves S1 — key, identity, pinned KSS — unchanged). There is no downgrade after a pin, ever. (b) No pin → the document MUST still carry a valid `portalKeySet` (absent → `keyset_missing`); verify, pin, use it (first enrolment: a KSS that fails → enrolment refused). A build that pins no roots cannot verify a statement and refuses every document (`keyset_invalid`, "no pinned roots"): pinned roots are mandatory.
- **Fallback removal (spec 0.1.12; completed in 0.1.26, C133)**: rule (c) (a document without `portalKeySet` while nothing is pinned, or a build without roots) is REMOVED. Core emits `portalKeySet` since 2026-10-12T10:19:19Z. `trustedPortalKeys(body, pinned, roots)` has no `required` option and no `legacy` result; `keySetAnnounce` is removed (manifest 0.1.18); the SDK has no `KEYSET_REQUIRED` and no transition warning (miniapp-sdk 0.1.19); conformance has no `--keyset-transitional` (0.1.16). This breaks earlier opt2 dev formats (C133). `portalKeys` stays REQUIRED on the wire for one minor (the frozen v0.1 verifiers require it); Core emits it equal to the KSS `keys`; verifiers ignore it. v0.2: `portalKeys` removed.
- **Standalone** (§17): the final Portal-signed document carrying `standalone` is verified under the KSS rule; from its installation on the verifier trusts only the standalone issuer and ignores `portalKeySet` on later documents.
- **Normal rotation** (three ceremonies, each `seq` + 1): (1) announce B `pending` (A `active`); (2) ≥ 24 h later: B `active`, A `retired` — Core switches to B only after this KSS is published; (3) ≥ 12 h + 5 min later: drop A.
- **Compromise rotation (K12 stolen)**: one offline ceremony signs KSS `seq` + 1 that drops the stolen kid and lists a fresh key `active`; Core publishes it in the next config/slices; every bridge and app accepts it (root-signed) and refuses documents and tokens signed by the dropped kid at once. No re-enrolment. (Replaces steps (1)–(2) of the §9.4 Portal-key row.)
- **Root compromise**: sign with the other root a KSS that keeps the current keys; ship a spec/bridge/SDK release with a new root pair (planned, rare).
- **Ceremony** (Platform + Martin): Platform prepares `keyset-request.json` (proposed keys, kids, new `seq`) on a networked machine → USB to the offline machine → compare kids read aloud → sign with `root-a` using `signKeySetStatement` (`@opt2-tealbrick/manifest`, verified by sha256 against the release) → `portal-keyset.jws` back by USB → Platform commits it to the registry → Core picks it up. Production roots: generated at cutover in an air-gapped ceremony (encrypted USB copies, separate custody for root-b, passphrases stored apart, yearly drill = re-sign the current KSS with `seq` + 1).

## 10. Proofs that are not credentials (cannot be used alone)
All: V0 rules; the three call-proof variants are told apart by exactly one of `gjti`, `hook`, `bop`; ≤ 60 s lifetime (pairing state: 600 s), `jti` replay set at the verifier until `exp + L` (memory is enough; replay after a verifier restart is bounded by 90 s and by the body binding). Header for bridge and instance assertions: `TB-Assert: <jws>` (one header name; `Authorization` is never used for assertions).
| Proof | `typ` | Signed by | `iss` / `sub` | `aud` | Other claims | Verifier checks after V0 |
|---|---|---|---|---|---|---|
| agent assertion | `tb-agent-assert+jwt` | K4 | `tb:agt:<id>` / same | `tb:brg:<id>` | `con` | `kid` = thumbprint of the active connection's `publicKey`; `con` belongs to `sub`; connection `active`; agent not revoked |
| bridge assertion | `tb-bridge-assert+jwt` | K7 | `tb:brg:<id>` / same | `tb:portal` | `htm`, `htu` (path + query), `bd?` (sha256 of raw body; required when a body exists) | Core: `kid` = the bridge's registered key; method/path/body match |
| pairing state (bridge assertion variant, front channel; max 600 s, one-time) | `tb-pair-state+jwt` | K7 | `tb:brg:<id>` / same | `tb:portal` | `rid`, `ret` (absolute https callback URL), `rh` (redirect URI host of the pending request), `cn` (DCR client name; display only, "unverified") | Core `/pair`: `kid` = the bridge's registered key; `ret` = registered bridge public URL + `/oauth/pair/callback`; `jti` unused (Core keeps it until `exp + L`) |
| instance assertion | `tb-instance-assert+jwt` | K8 | `tb:ins:<id>` / same | `tb:brg:<id>` | `svc?` (runtime service name), `htm`, `htu`, `bd?` | bridge: `kid` ∈ `instanceKeys` for `(ins, svc)`; method/path/body match; pause rule §13 |
| call proof (op) — `gjti` present | `tb-call+jwt` | K7 | `tb:brg:<id>` / caller (`tb:agt:` or `tb:ins:`) | `tb:ins:<target>` | `call` (call id `call_…`), `gjti` (the grant's `jti`), `op`, `in` (sha256 of JCS input), `ctx` (sha256 of JCS context) | app SDK: `kid` ∈ slice `bridge.keys`; `iss` = grant `cnf.brg`; `sub` = grant `sub`; `aud` = grant `aud`; `gjti` = grant `jti`; `op` = route op; `in`/`ctx` match body |
| call proof (hook) — `hook` present | `tb-call+jwt` | K7 | `tb:brg:<id>` / caller | `tb:ins:<hook app>` | `call`, `hook`, `phase`, `ctx`, `in?`, `bd?` (v0.1.52: sha256 of the exact request body bytes; sent only to an app whose claim/status lists `"bd"` in `proofClaims`) | app SDK: `kid` ∈ slice `bridge.keys`; `hook` declared in own manifest with that `phase`; body digests match; `bd`, when present, = sha256 of the raw received body, hashed before parsing; the handler gets the object parsed from those bytes (else `call_proof_invalid`). No grant is sent with hook calls. |
| call proof (bridge op) — catalog, dynamic resolve, mark, scope summary | `tb-call+jwt` | K7 | `tb:brg:<id>` / same | `tb:ins:<target>` | `call`, `bop` (`catalog` \| `resolve` \| `mark` \| `scope_summary`), `op?`, `in?` | app SDK `verifyBridgeOpProof`: `kid` ∈ slice `bridge.keys`; `iss` = slice `bridge.id`; `bop` matches the route `POST /tb/v1/bridge/<bop>` (`catalog`, `resolve`, `mark`, `scope-summary`); `op` (if present) declared in own manifest; `in` = sha256 of JCS body; no grant; no agent action runs on these routes |

## 11. The ONE grant (K10) — CORE §6, plus
- Same kind for agent→app (`sub = tb:agt:`) and companion app→app (`sub = tb:ins:<caller>`). Companion grants exist only for manifest-declared companion edges, are minted with `mode: "bound"`, `wf` = the manifest-declared companion operations (CORE I8), `held` = the workspace default held families (always including `money`) and `caps: {}` (C16 S5), and are delivered in the calling app's slice field `grants`.
- `caps` shape (CORE I14): `{write?: Cap, outward?: Cap, destructive?: Cap}`, `Cap = {max: integer ≥ 0, per: "hour" | "day"}`; `money` has no cap (always held).
- Minted only for licensed, unpaused edges: an app deployed before payment (J1 licence-last) has its edge on the canvas, but no grant and no launch ticket exist until `isEntitled` is true; the GUI shows the glowing pay pill.
- `verifyGrant` (CORE §7) check order: V0 (`typ = tb-grant+jwt`, Portal key set or standalone issuer, `iss` ∈ {`tb:portal`} or the standalone issuer, `aud` = target instance, max 43200 s) → `ws` = own workspace → `cnf.brg` = workspace bridge id → `jti` ∉ `revoked.jtis`. Bridge, before forwarding a companion call, additionally: `sub` = the instance that signed the instance assertion. App, on receipt: the call proof (§10) binds the grant to this exact call.
- Scope rule: the app is the authority for scope assignments. Effective access = `grant.crud ∩ operation.crud ∩ scope access` (`authorize()`, CORE §7); scope access comes from the app's own store, never from a caller header or claim.
- No introspection: no Portal route answers "is this grant / token valid"; no verifier calls Portal or the bridge to check a token. Revocation is expressed only by short lifetimes, config/slice content and the bridge's own state.

## 12. Person credentials, owner CLI, TBD
- K1 is accepted only by Core behind the Portal gateway: verify with Clerk JWKS (cached ≤ 1 h, refetch on unknown `kid`), `iss` = Clerk frontend API, `azp` = Portal origin, time window, then map `sub` → `per_`.
- Owner CLI (K3): person mode = drafts + reads only. K3 is accepted only on route rows marked owner-CLI-allowed (reads, draft create/edit/validate/submit); it can never apply a draft, obtain any K11 (`launch` or `keys`) or K14, issue K2b or K6 codes, approve device flows, or call a `confirm` row. v0.1.64: it may also set its own push device and call `person_ops.call` (writes only for client `tbm`; see the v0.1.64 section). Route-table compile check (PORTAL-API): no output type reachable with K3 contains a code, ticket or other credential.
- Boundary = the OS user: any process of that user can drive `tealbrick` with the K3 keychain item, including an agent with a shell on an FDE machine. K3 is therefore kept harmless (reads + drafts, nothing acts until the owner applies in the browser), idles out after 24 h (7 d for TBD sessions, C289; revoke on the Sessions page or account disable ends it at once), and is stored with a keychain ACL requiring user presence where the OS supports it. `tealbrick login` warns when agent keychain items exist on the same machine. Apply = a K1 browser session + one confirmation on the draft review page; the apply request (`drafts.apply`, `DraftApplyInput {drf, revision, confirm: true}` in types/routes.ts — the frozen wire) carries the draft `revision` the owner reviewed (stale → `409 revision_conflict`). `tealbrick logout` revokes server side (Core deletes the digest) and deletes the local item; the Portal account page lists and revokes all K3 sessions.
- TBD has two identities, stored separately: (a) the person: device flow `client_id=tbd, scope=owner` → K3 named "owner native session" (`client: tbd`), in TBD keychain item `tealbrick.person`, same draft + read-only limits, listed and revocable in the Portal session list; it never obtains K11 — TBD opens Portal launches (e.g. to decide holds in an app) in the system browser with K1, and shows pending-hold counts from status (C16 S2); (b) TBD's agent: a key connection (K4 in keychain item `tealbrick.agent.<con>`, device flow `scope=agent`). The agent process is started with an allow-listed environment and gets only its K5 (or K4 handle via the local relay); the person token is never in its env, argv, files, IPC or logs. The `tealbrick` CLI uses the same two items and refuses agent-mode commands with K3 and owner commands with agent credentials (distinct `typ` / prefix).
- K11 redemption sessions: `launch` → the app SDK sets one cookie (HttpOnly, Secure, SameSite=Lax, Path `/a/<product>/`, 8 h absolute) bound to `per` + `ins`; invalid when its creation time < slice `personNbf` ("sign out everywhere" in Portal bumps `personNbf`). `keys` → the bridge sets a key-page cookie (Path `/keys`, 15 min). The key page is write-only: it shows presence, never values.

## 13. Pause matrix
Enforcement points: **B** = bridge (`gate()` step 1 on config `pause`; connection status), **C** = Core (stops minting / issuing), **A** = app SDK (`authorize()` step 0 on slice `pause` and slice `agents[].status`, CORE I1; C353). Online latency: bridge ≤ 60 s (config long-poll, C9); app ≤ 60 s after the bridge (slice long-poll). Offline from Portal: Core cannot reach the bridge; grants expire ≤ 12 h and a config older than 12 h fails closed (C9).
| Path that reaches an app | Workspace kill switch | Agent pause | Connection revoke | Instance pause |
|---|---|---|---|---|
| K5 → MCP `tools/call` (direct or relay) | B refuse `paused` ≤ 60 s; C no grants | B refuse for that agent ≤ 60 s; tools/list empty; C no grants | B rejects that `con`'s K5 and refresh (`invalid_token`) ≤ 60 s | B refuse calls to it, its tools removed ≤ 60 s; C no grants with `aud` = it |
| K10 agent grant at the app | C stops re-minting → ≤ 12 h even offline; B never forwards | same, for that agent | n/a at app: the bridge, the only holder of connection state, stops the call first | A refuses all ops on itself ≤ 60 s after B |
| K10 companion grant (app→app) | B refuse ≤ 60 s | n/a: `sub` is an app (opt2 has no on-behalf-of); new agent calls are refused first; companion calls for work a paused agent already started may finish (accepted, C16 S13) | n/a (same reason) | B refuse if caller or target paused; A (target) refuses; caller SDK does not send |
| Instance assertion (companion call, key fetch, status, slice pull) | B accepts only slice pull + status report (so the pause reaches the app); all else refused | n/a (not agent-bound) | n/a | same as kill switch, for that instance |
| Bridge-op calls (catalog, resolve, mark, scope summary) | metadata only, no agent action; continue (calls that would need them are refused anyway) | n/a | n/a | B sends none to a paused instance |
| Hook calls | none made (call refused before the chain) | none made | none made | hook app paused: its `before`/`context` hooks → every call in that chain refused (fail closed); its `after` hooks → output withheld (`after_failed`) |
| Key fetch `/tb/v1/keys` | B refuse; A drops cached key values on the paused slice | n/a | n/a | B refuse for that instance; A drops cache. Env already injected by `tb-exec` stays until restart; the engine is reachable only through its (refusing) app |
| New connection (K2 `scope=agent` approval, K2b redemption) | C refuses approval and K2b issue; B refuses K2b | C refuses K2b for that agent; B refuses | n/a (new connection = new `con`) | n/a |
| K5 issuance / refresh | allowed (sessions are not calls) | allowed | refused | n/a |
| Person ticket `launch` | not paused by design (accepted, C16 S13): owner must reach the app to inspect and decide holds | n/a | n/a | not paused (owner configures a paused app) |
| Held action released by the owner in the app | A refuses to execute while paused (approval kept; executes after unpause or expires) | A refuses for that agent's holds | n/a (holds are agent-bound) | A refuses |
| Person ticket `keys` | not paused (accepted, C16 S13; key page stays up, C9) | n/a | n/a | n/a |
| K14 relayed person op (v0.1.64) | not paused (owner access by design, like `launch`); a held action released this way still waits for unpause (row above) | n/a (person, not agent) | n/a | B forwards; A refuses ops of a paused instance as for `launch` |

## 14. Revocation matrix
| Action | Mechanism | What stops | How fast (online / offline from Portal) |
|---|---|---|---|
| Revoke agent (delete card) | Core removes agent + its connections from config; grant `jti`s → `revoked.jtis`; no new grants, K2b, device approvals | all K5 of all its connections, refresh chains, K4 assertions, pending K2b; app grants | bridge ≤ 60 s / ≤ 12 h |
| Revoke connection | config `connections[].status = revoked` | that `con`'s K5, refresh chain, K4 assertions; other connections of the agent keep working | ≤ 60 s / ≤ 12 h (grant expiry) |
| Revoke person session / owner CLI session | Clerk revoke (K1); Core deletes K3 digest; optional "sign out everywhere" bumps `personNbf` | Portal GUI (≤ 60 s), owner CLI and TBD person (immediate), app UI sessions (≤ 60 s + slice) — agents are unaffected | as stated / app UI sessions end at their 8 h max |
| Rotate / revoke bridge | Portal op issues a new K6; the new bridge key replaces the old | old key's bridge assertions refused by Core immediately; old K5 invalid at the new key; apps accept only the new key from the next slice | immediate at Core; apps ≤ 60 s |
| Delete instance | Core removes it from config: grants with it as `aud` or `sub` withdrawn (`revoked.jtis`), `instanceKeys` entry removed, unused K6 invalidated | calls to/from it, its assertions, key fetch, launch tickets | ≤ 60 s / ≤ 12 h |
| Rotate Portal key | §9.2 (planned) / §9.4 (compromise) | tokens signed by the old key once it is removed | planned: none stop early; compromise ≤ 60 s |
| Delete / replace a workspace default key | bridge key store write bumps `keysRev` (delivered with the slice pull, BRIDGE / SDK-API) | the app SDK drops cached values and refetches; `tb-exec` restarts the engine services so they get the new value | ≤ 60 s (bridge-local; works offline from Portal) |
| Cancel unused pairing code | `jti` → `revoked.jtis` | that code | ≤ 60 s (or its 10 min `exp`) |
| Delete an edge (agent → app; QA-SPEC49-26) | Core removes the agent's grant to that app from the config (no jti: the bridge holds grants only from the config); in a `needsAgentDirectory` slice the agent stays listed with `edge: false`, otherwise it leaves the slice | new calls of that agent to that app (bridge has no grant); its scheduled ops on that app (SDK fire time → `agent_removed`) | bridge ≤ 60 s; scheduled ops ≤ 60 s after the slice arrives / ≤ 12 h offline |
| Withdraw a workflow grant (v0.1.82: owner revoke, app release, a narrower request, an app update that narrows `perWorkflow`, companion edge disabled or removed, caller uninstalled, workspace kill switch, any base re-mint with other claims e.g. `appsPolicy.held` / `polrev` / edge crud; NOT the wildcard consent revoke, lead §11.1) | Core changes the record (CORE v0.1.82), adds a `workflowGrantsWithdrawn` record (or bumps `wflEpoch`) in the same config revision (kill path, never size-refused) and never mints a covered grant again | calls under every cached grant with that `wfl` (and `aud`) minted before the withdrawal; the bridge refuses `workflow_grant_withdrawn` | bridge ≤ 60 s (one config ack) / ≤ 15 min offline (grant `exp`) |
| Revoke a TBM session (v0.1.64) | Core deletes the K3 digest and its push device row; no new K14 is minted for it | new relayed person ops and pushes for that session; K14 already queued lives ≤ 10 s | immediate at Core |

## 15. Key custody (option B, CORE §10, C2)
- Account-default keys live only in the bridge key store (sealed with `TB_KEK`), entered on the bridge key page opened with a K11 `keys` ticket. An app fetches `GET <bridge internal>/tb/v1/keys/<name>` with an instance assertion and receives only names its manifest declares with `source: account_default`. App-own keys (`source: app_own`) are entered in the app UI and stored in the app; when both exist the app-own key wins.
- Values are never logged, never in config, slices, acks, errors or traces, never sent to Portal. Portal sees only presence booleans per requirement name from the status report.

## 16. External credentials Core holds (not ours; never leave Core)
| Credential | Storage | Use | Rotation |
|---|---|---|---|
| Railway OAuth refresh token (C3) / fallback pasted Railway workspace token | sealed in Core DB (§9.1), one per account link | Core deploy calls only | refresh token rotated and resealed on every use; pasted token: owner replaces |
| Stripe webhook secret, Stripe secret key, Clerk secret key, Railway OAuth client secret, `TB_KEK` | Core service env (Railway sealed variables); never in DB, logs or responses | Core only | rolled at the provider, then env updated |
None of these is ever sent to a bridge, app, agent or browser.

## 17. Standalone issuer handover (leaving Portal; C16 B7)
1. Before handover the owner runs `tealbrick standalone owner-key`: the CLI generates an Ed25519 owner key in the OS keychain and prints its public JWK; the owner pastes it into the "Leave Portal" step (K1 + confirmation).
2. Core publishes a final config and final slices (signed by K12) with `standalone = {issuer: "tb:brg:<id>", kid: <K7 thumbprint>, ownerKeys: [<owner jwk>]}` and with `portalKeys` emptied.
3. The final config is frozen: the bridge keeps it as state S9 "self-issued config + owner keys" (BRIDGE §1.2). The C9 12 h fail-closed rule does not apply to it, because the bridge is now its issuer. The bridge re-mints, from the frozen config and signed with K7, the same grants (`iss = tb:brg:<id>`, 12 h, at half-life) and the slices. Apps accept them because a Portal-signed slice named that issuer and `kid`; they trust no Portal key any more, so a later Portal compromise cannot reach them.
4. Owner administration: the bridge `/admin/v1/*` surface exists only in standalone mode and has exactly 4 ops — `pause` / `resume` (one agent or the workspace), `revoke-connection`, `ticket` (K11 `launch` or `keys`, signed by K7). CLI: `tealbrick admin pause|resume|revoke-connection|ticket`. These ops change only the pause and connection status inside the frozen config. Each request carries an owner assertion (`typ = tb-owner-assert+jwt`, signed by a key in `ownerKeys`, `iss = sub = tb:per:<id>`, `aud = tb:brg:<id>`, `htm`, `htu`, `bd?`, ≤ 60 s, replay set); it is never accepted on MCP, OAuth or app endpoints. The owner key belongs to the K12 row (the issuer role moves to the bridge; the owner key is its admin proof); it is not a separate kind.
5. Not in standalone (next wave): new agents, connections (no K2, no K2b), edges, apps or policy changes.

## 18. Hard rules (each is a conformance case; ids from CONFORMANCE.md)
| Rule | Statement | Conformance |
|---|---|---|
| R-P1 (F4-1 class) | No person credential (K1, K3, owner assertion) is accepted at, forwarded to, or derivable at any agent path: bridge MCP, `/oauth/*`, relay, app op/hook routes, harness processes. Person and agent kinds have disjoint `typ`, `iss` and `aud`; every endpoint accepts exactly one `typ`. Portal never puts a person credential into a config, slice, instruction set or agent-facing response. | C4 (`cred.p1.bridge_rejects_clerk_jwt`, `cred.p1.bridge_rejects_tbo`, `cred.p1.relay_rejects_person`, `cred.p1.app_op_rejects_person`, `cred.p1.payload_scan_no_person_cred`, `cred.p1.tbd_agent_env_clean`, `cred.p1.kit_cannot_get_owner`), C3 (`typ` confusion) |
| R-aud | `aud` mandatory, single string, `tb:` format, equal to the verifier's own reference; no warn-only path. | C2 |
| R-no-1y-bearer | Longest bearer = 30 d (K3 with 24 h idle — 7 d for TBD sessions, C289 — K5 refresh), both digest-stored and server-revocable; signed tokens ≤ 12 h; proofs ≤ 60 s. | C7 |
| R-no-shared-secret | No static secret is shared between two services (Core↔gateway, Core↔bridge, bridge↔app, app↔app). Every hop uses the caller's own credential or key-pair proof; Core trusts no identity header from the gateway. | C8 |
| R-no-third-party-cred | Portal never hands a third-party credential (Railway, Stripe, Clerk, OAuth, API key) to an agent, app or bridge. | C8 + payload scan |
| R-enrol-only-secret | The enrolment code is the only secret Portal writes into a customer project: one-time, ≤ 24 h, worthless after redemption. Bridges and instances generate their own key pairs; Portal stores only public keys. Public values are fine (`TB_PORTAL_URL`, `TB_PORTAL_KEYS`, bridge URL, `TB_INSTANCE_ID`). Images are public: no registry token in customer projects. | C6, C8 |
| R-owner-draft | K3 never applies and never obtains any code or K11; no K3-reachable output type carries a credential; apply needs K1 + one confirmation. | P2 + route-table check |
| R-device-bound | A device request is approved only by a K1 person who presents its user code (digest match); no op lists pending requests or returns a clear user code. | `cred.dev.*` (§6) |
| R-pause-all | Every path that reaches an app has a defined pause cell (§13). | P1 |

## 19. v1 failure classes and how opt2 prevents them
| v1 failure (REG §3, BND §5, PKG §5) | opt2 prevention |
|---|---|
| ~40 credential kinds; 6 formats for "agent may call app" (two opaque grant tokens, attachments, leases, a JWT grant) | 15 kinds (§4, K1–K14 + K2b); one grant K10 for agent→app and app→app; closed `typ` list |
| 3 audience formats; `aud` warn-only | one `tb:<kind>:<id>` format; R-aud reject |
| plaintext org identity signing key in the DB | K12 sealed (§9.1), private half destroyed on retirement |
| deployment secrets / instance tokens written into app env, sealed copies in Core | instance and bridge generate key pairs; Portal stores public keys; R-enrol-only-secret |
| registry read token pushed to customer projects; app-internal handoff key and Rules internal token copied between apps | public images; R-no-shared-secret; companion grants for app→app |
| third-party tokens decrypted and returned to agents | R-no-third-party-cred; key store in the bridge (option B) |
| owner Portal token sent to every agent endpoint (F4-1); 1-year agent JWT | R-P1; R-no-1y-bearer |
| online grant introspection, Portal on the call path | §11 no introspection; config pull only |
| pause covering 3 of ~9 kinds | §13 matrix, every path |
| device codes stored in plaintext | digests (§3) |
| two JWKS URLs; MCP OAuth hosted in Core | one key path (bootstrap + signed documents); OAuth AS = the bridge |

## Checklist mapping (SPEC-REVIEW-CHECKLIST § CREDENTIALS)
| Checklist line | Answered in |
|---|---|
| Exactly five caller types | §1 |
| Every kind has a registry row (issuer key, verifier, lifetime, audience, revocation) | §4, `types/credentials.ts` `CREDENTIAL_REGISTRY` |
| Kind count stated and short; no purpose served by two kinds | §4 (15 kinds, purpose list; K2 vs K2b disjoint) |
| One agent→app and app→app grant: short-lived, signed, aud = instance, CRUD + scope + mode | §11, CORE §6 |
| Grants verified locally; no introspection; key rotation | §11, §9.2 |
| Revocation per kind (agent, key, person, device, pause): what stops, how fast | §4, §14 (incl. default-key replace) |
| Pause mapped against every kind that reaches an app | §13 (accepted exceptions: C16 S13) |
| No person credential at agent endpoints; conformance case | §18 R-P1, R-device-bound; §6 |
| `aud` mandatory, one format | §3, §18 R-aud |
| Agent, device, session, person: four identifiers with issuer and pairing flow | §2 |
| TBD two identities; owner-CLI vs agent; apply needs browser confirmation | §12 (K3 never gets tickets) |
| Native/CLI sign-in = device flow; sign-out revokes server side | §6, §12 |
| Portal keys sealed; codes as digests; enrolment one-time | §9.1, §3, §4 K6, §6 |
| No third-party creds via Portal; no Tealbrick credential in customer project | §16, §18 |
| No app-internal or shared service secrets | §18 R-no-shared-secret, §19 |
| Key custody: bridge key store, app-own wins, Portal sees none | §15 |
| Standalone handover; launch ticket one-time, bound to app + person | §17, §4 K11, §12 |
| No 1-year bearer | §18 R-no-1y-bearer |
| Anti-patterns: ~40 kinds; owner token to agents; pause subset; Core holding third-party tokens / plaintext key / registry token | §19 |
| Coordinator review R2 (TBD person), R3 (pairing UX), R4 (licence-last) | §12, §7 path A, §11 |
| Verifier v0 items B2–B7, S1, S5, S9, S13, N3, N14, N15 | §6, §12, §10, §17, §11, §7–§8, §13, §9.1, §14, `types/credentials.ts` |

## Open questions
None. (Key connections without a refresh token: accepted, C15.)

## v0.1.1 additions
- `TYP.releaseIndex = tb-release-index+jws` (C30) signs the Platform release index digest (`ReleaseIndexClaims`, issuer `tb:releases`, pinned JWKS in Core, ≤ 180 d). It is a signed document, not one of the 13 credential kinds.
- `signJwsWithSigner` (manifest package, C26) lets holders keep K4 in the OS keychain / Secure Enclave; same JWS format.

## v0.1.11 additions (C62/C63)
- `TYP.keySet = tb-keyset+jws`, `KeySetStatementClaims`, `KEYSET_REFUSAL`, `PORTAL_ROOT_KEYS {dev, prod}` (dev = Platform e19cf98 root-a/root-b, prod empty until cutover) — §9.5. Root keys and key-set statements are not credential kinds. `keySetAnnounce` is removed (spec 0.1.26, C133).

## v0.1.12 (fallback removed, 2026-10-12T10:19:19Z)
- Rule (c) of §9.5 is removed: Core emits `portalKeySet` since 2026-10-12T10:19:19Z. Every build that pins Portal Root Keys for its channel refuses a statement-less enrolment response, config or slice, including the first one. `portal.signing_keys` (PORTAL-API) publishes Core's public key ring for the ceremony and is never a trust input.

## v0.1.13 addition (G1)
- Call proof (op) gains the optional claim `hv: {f, r, by}` (closed set extended; `HoldVerdictClaim`): `f` ∈ HOOK_HOLD_FAMILIES, `r` 1..280 chars, `by` = `<productId>/<hookId>` (both by the manifest id patterns). Verifiers (app SDK) refuse a proof with a malformed `hv` (`call_proof_invalid`). Signed by the bridge like the rest of the proof: the agent cannot add, change or remove it.

## v0.1.14 addition (C91)
- Bridge-op proof (`bop` variant): claim set per `bop` is fixed — catalog `{bop, op}`, resolve `{bop, op, in}`, mark `{bop, in}`, scope_summary `{bop}` (SDK-API v0.1.14).

## v0.1.17 addition (C108, tolerant reader)
- Grant (K10) `held`: verifiers check only the SHAPE (≤ 32 unique tokens `^[a-z][a-z0-9_]{1,31}$`) and IGNORE families they do not know (`verifyGrant` returns `held` filtered to `KNOWN_HOLD_FAMILIES`); known families still hold, `money` is always held. A newer Core can add a family without breaking older bridges and apps; ignoring is safe because an app cannot declare a family it does not know (manifests that DECLARE an unknown `holdFamily` stay refused, M-OP-4 / schema). Hold verdicts (`hv.f`) stay strict (fail closed).

## v0.1.46 — `prd` in companion grants (GRANT-PRD)
A companion grant (K10, `sub` = the calling instance) carries `prd` = that instance's product, signed with the grant by its issuer (Portal Core; a standalone bridge the same way). Agent grants never carry it. CORRECTION (2026-10-17): the grant claim set is CLOSED in @opt2-tealbrick/manifest for signing AND verification (jws.ts claimsProblem), so verifiers before manifest 0.1.23 REFUSE a grant with `prd`. Issuers mint `prd` only when every verifier of that grant knows it: the workspace bridge ≥ 0.2.3 and the target app's SDK ≥ 0.1.28 (the first releases on manifest 0.1.23); below that the grant is minted without `prd`. SDKs set `Caller.product` from `prd` first and from the slice `companionCallers` only when `prd` is absent (grants minted before Core sends it); when both exist for the same instance and differ, the SDK refuses the call `grant_invalid` and logs both values. The bridge keeps its signed config as the source of `HookCallInfo.caller.product` and omits the product when a grant's `prd` disagrees.

## v0.1.58 additions (S1-0, C308 — HOST.md)
- Caller type `host` (six caller types now): the host agent on a paired customer server. It never holds a person credential, K3, K4/K5 or a provider token.
- **K13 host key** (`CREDENTIAL_REGISTRY` row K13; 14 kinds now): Ed25519 generated on the box; private half in a root-only 0600 file outside every container (storage `holder_host_file`); public half pinned in Core at the device-flow approval with scope `host`. Revocation: `servers.detach` (after its final stop plan) or a new pairing; S2: signed rotation.
- **Host assertion** `TYP.hostAssertion = tb-host-assert+jwt` (`HostAssertionClaims`): `iss = sub = tb:srv:<srv>`, `aud = tb:portal`, exp − iat ≤ 60, `jti` once, `htm`/`htu`/`bd` request binding — the K7 bridge-assertion rules; header `TB-Assert`.
- **Host plan** `TYP.hostPlan = tb-host-plan+jws`: a signed DOCUMENT (not a kind), signed with K12, carrying `portalKeySet`; verified on the box with the §9.5 rule (statement under a pinned root, plan signed by an active or pending key). K12's audience list now includes host plans.
- Device flow (§6): scope `host`, client `tealbrick-host` only (`DEVICE_FLOW.hostClientIds`); the token result carries no token (`DeviceHostTokenResult`). User code, lifetime (10 min), polling and the 5-wrong-codes rule are unchanged.
- Ids/refs: `ServerId = srv_<ULID>`, `ServerRef = tb:srv:<srv>`, `RefKind` gains `srv`.

## v0.1.64 additions (C326, C332)
- **K3 client `tbm`** (Teal Brick Mobile): device flow `client_id: "tbm"`, scope `owner` only; stored client `tbm`; idle limit `LIFETIME_S.ownerTbdSessionIdle` (7 d). Same person limits as `cli`/`tbd` (§12: reads + drafts + logout), plus two rows: its own push device (`push_devices.*`) and `person_ops.call` (client `tbm` only; `cli` and `tbd` are refused, C337b). K3 still never obtains any K11, code or token.
- **Why `tbd` is not a relay client in v0.1.64** (review B1 and its re-review): a TBD K3 lives under the owner's OS user, where the owner's own agents also run (§12: the OS user is the boundary). A write-capable TBD K3 would let an agent approve its own Inbox items; a read-capable one would let it read every other agent's asks. `PersonOpClient` keeps `tbd` for a later design (e.g. user presence per call); `PERSON_OP_RELAY.clients` is `tbm` only. The phone runs no agent (TBM is not a harness; the later phone node executes only typed capabilities, never agent code).
- **Residual risk (accepted, C332a(4))**: a phished `tbm` device code is a decision credential for Inbox items without money or delete. Limits: the approval screen says so, money/delete and structured holds never pass the relay, every relayed write is audited, the owner revokes the session in Sessions. Notice (v0.1.64, C337): every new `tbm` session triggers a `session_added` push to the person's other TBM devices, with a one-tap way to Portal Sessions. No email (Core has no mailer; follow-up with Martin).
- **K14 relayed person op** (`TYP.personOp = tb-person-op+jwt`), registry row K14: minted by Core with K12 (iss `tb:portal` only) for one allow-listed `person_ops.call`; claims `ws, op, bd, idk, cli, pop` (+ base claims; `sub` = the person, `aud` = `tb:ins:<target>`); 10 s; one-time (`tb_used_jti`). Holder = the workspace bridge (relay only; it never verifies or stores it); Core keeps it sealed until the row ends; verifier = the target app SDK (SDK-API §21). Never returned to the K3 holder. Purpose: "native owner person op through the relay = K14".
- §1 invariant unchanged: Portal never calls into customer infrastructure; the bridge pulls the relay queue.

## v0.1.82 — `wfl` in companion grants (C373 P1; spec 0.1.82 is a reservation, C340)
- **Claim.** A companion grant (K10, `sub = tb:ins:<caller>`) may carry `wfl` = a workflow id of the CALLER app (`WORKFLOW_ID_PATTERN` `^[a-z][a-z0-9-]{2,39}$`). Wording is fixed: `wf` = the allowed op ids (unchanged); `wfl` = the caller's workflow id. A grant with `wfl` is a "workflow grant"; a companion grant without it is the "base grant". Agent grants never carry `wfl`. The P4 caller `context` (BRIDGE §8.5) stays informational and is never the source of `wfl`.
- **Closed claim set.** Verifiers that do not know `wfl` refuse the whole grant (manifest `jws.ts` claimsProblem, like `prd` in v0.1.46). Core mints `wfl` only behind the gate of CORE v0.1.82: the bridge cap `app_workflow_grants`, the caller's app cap `app_workflow_grants` and the target's app cap `grant_wfl` (`APP_CAPS`, reported in the claim and every status push; capability, never a version, C354). The manifest package adds `wfl` as an OPTIONAL claim with that pattern; unknown claims stay refused.
- **Lifetime.** `exp − iat` = `WORKFLOW_GRANT_TTL_SEC` (900 s, `LIFETIME_S.workflowGrant`). Every verifier (bridge and app SDK) refuses a grant with `wfl` whose `exp − iat` is larger: `grant_invalid`. Core reuses a minted one while more than 450 s are left (`LIFETIME_S.workflowGrantRemintBelow`), like the half-life rule, keyed by the claims without `iat`, `exp` and `jti`, and NEVER hands out a cached grant that a live record or epoch covers (C5 S3-2).
- **Content (Core, mint on demand).** `mode: "bound"`, `wf` = the applied ops for that (caller, workflow, target) ∩ the CURRENT `perWorkflow.operations` of the caller's installed manifest, plus `tb.hold_status` when the caller's base entry for that product lists it (M-CP-3; a workflow can read the status of holds it raised); `crud` = applied crud ∩ edge crud ∩ current `perWorkflow.crud`; `held` = `appsPolicy.held`; `caps: {}`; `prd` (always: the target gate is later than GRANT-PRD's); `wfl`.
- **Delivery.** Never in a slice or the config (the slice cap would allow only about 40 workflows). The app fetches it through the bridge relay `workflow-grants/get` → `bridge_api.workflow_grant_get` and keeps it in memory only.
- **Withdrawal.** Not by `revoked.jtis`: Core does not list wfl grant jtis. The config carries `workflowGrantsWithdrawn` records and `wflEpoch` (§5.1), checked by the bridge only, exactly like agent-grant revocations are bridge-only. Comparison is `iat ≤ at` (and `iat ≤ wflEpoch[sub]`): a grant minted in the same second as the withdrawal is withdrawn too. Records and epochs are kept until `at + WORKFLOW_GRANT_TTL_SEC + 2 × LEEWAY_S` (C5 S3-1). Core never mints a grant that a live record or epoch covers; when needed it waits until the next second (at most 1 s); mint and withdrawal are serialized on the record (CORE v0.1.82, C5 S2-2). The bridge also refuses a grant with `wfl` whose `aud` is not in `workflowGrantEdges[sub]` (C5 S3-3) or whose `held` lacks a family of the current `appsPolicy.held` (C5 S2-1). The target app does not check withdrawals: it accepts a call only with the bridge's call proof (§10), and the bridge refuses first.
- **Revocation latency.** Online ≤ 60 s (one config ack; conformance C4 rows `B-WFL.withdrawn_cached_record` and `B-WFL.withdrawn_cached_epoch`). Offline from Portal: no new workflow grant can be fetched, so workflow calls stop at the cached grant's `exp` (≤ 15 min); base grants are unaffected. Standalone (§17): no issuer of workflow grants; the bridge answers `workflow_grants_unsupported` and the app uses its fallback.
- Scope rule (§11) unchanged: scope access comes from the app's store, never from `wfl`. Scope rows are not per workflow in v0.1.82.
