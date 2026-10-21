# BRIDGE — the workspace door (deployed + local relay)

Status: v0.1, Lead · Specs, 2026-10-11. Machine-readable: `workspace-config.schema.json`, `instance-slice.schema.json`, `types/bridge.ts` (schema wins over this text). Obeys CORE.md (C1–C12); conflicts are listed under "Open questions", not applied.

Scope: what the bridge is and is not, the state it keeps, its two forms, its public and internal HTTP surface, enrolment and signed config pull from Portal Core, agent sign-in (OAuth AS + key connections), the MCP surface, the per-call routing pipeline (`gate()` + hooks + forward), person launch, key entry and key fetch, app claim, standalone mode, health/HA and versioning. Credential claims, `typ` values, lifetimes, the config/slice credential section and the pause matrix are owned by CREDENTIALS.md (`types/credentials.ts`); Portal op paths by PORTAL-API.md (`types/routes.ts`); SDK endpoints by SDK-API.md. This file names them only where the bridge calls or serves them.

## 1. Scope statement and state inventory

### 1.1 Does / does NOT
| The bridge DOES | The bridge does NOT |
|---|---|
| verify every caller (agent session, agent assertion, instance assertion, person ticket, pairing code) | run agents, agent loops or schedules |
| run `gate()` (CORE §7) on every routed call, for every harness and path | call any model (no LLM, STT, TTS, embedding) |
| run the hook chain (before → context → after) | hold app data, holds, receipts, caps counters or scope assignments (apps do, via the SDK) |
| forward calls to apps on the private network with grant + call proof | decide run/hold (the app's `authorize()` does) or count anything |
| serve MCP (tools from grants, skills as resources) | check licences (Core withholds grants/tickets instead) |
| act as OAuth authorization server for its own MCP resource (C4) | send tool payloads, call metadata or key values to Portal |
| serve person launch proxy, public callback routes, key-entry page, health | accept any inbound connection from Portal (outbound only) |
| store account-default keys sealed and hand declared keys to apps (C2) | rebuild a connector per call or cache grants in files with locks/MACs (v1 fault) |
| pull signed config, relay instance slices, report status (outbound only) | keep "standing" approvals (C8) or accept file inputs (C11) |

### 1.2 State inventory (complete)
Persistent state lives on ONE volume (`TB_DATA_DIR`, the same env name as apps). The bridge is small and stateless apart from this list; everything else is derived and rebuilt on boot.

| # | Item | Where | Size | Volume lost → effect / recovery |
|---|---|---|---|---|
| S1 | Identity: own Ed25519 key pair (sealed), `bridgeId`, `workspaceId`, pinned Portal key set (v0.1.11: the pinned key-set statement `{seq, kss}` and the keys derived from it, CREDENTIALS §9.5; transition path only: bootstrap from enrolment, replaced by each installed config's `portalKeys`, incl. `pending` keys), digest of the enrolment code used | volume | < 4 KB | re-enrol with a new K6 (§4.3): same `bridgeId`, new key |
| S2 | Last good workspace config (verified JWS, verbatim) | volume | ≤ 4 MB | re-pulled on boot |
| S3 | Sealed key store (account-default keys) + `keysRev` | volume | ≤ 1 MB | values lost: owner re-enters them on the key page; apps show `needs_keys` |
| S4 | Pairing-connection records `{con, agt, refreshDigest, gen, previousDigest, previousUntil, previousUsed, expiresAt, clientName, createdAt, reported}` — includes connections created locally (C4) until a config lists them | volume | ~300 B each | OAuth / pairing harnesses re-pair; key connections unaffected |
| S5 | Pending claims (instance/service public keys not yet in `instanceKeys`) | volume | ~300 B each | the instance re-claims with a new K6 (Portal op) |
| S6 | Used one-time `jti`s of pairing codes and keys tickets, each until `exp` + leeway | volume | small | lost only with the volume; such items expire within ≤ 10 min |
| S9 | Standalone only (§11): self-issued config (the frozen final config + local pause/revocation overlay from the 4 admin ops) and the owner keys (`ownerKeys`) | volume | small | standalone bridge without backup cannot recover; restore from backup |
| S7 | Manifests by digest, dynamic catalogs and resolve cache (5 min) | memory | small | refetched from apps |
| S8 | Proof `jti` replay set (≤ 90 s), MCP sessions, OAuth authorization codes (60 s), authorization requests (10 min), key-page sessions (15 min), app health table, rate buckets | memory | small | clients re-initialize / retry |

Restart = unseal S1/S3 with `TB_KEK`, load S2/S4/S5/S6 (+ S9), serve with S2 (subject to the 12 h rule, §5.4), re-pull. Writes are atomic (temp file + rename + fsync). Sealing per CREDENTIALS §9.1; S4/S5/S6 hold only digests, ids and public keys.

Backup (C16 S7): the bridge service volume uses the provider's volume backup (Railway, daily, kept 7 days) set by the bridge template; Platform runs a restore test with the other backups (PRD §11). `TB_KEK` is provider-held and is not in the volume backup. Loss of volume AND backup: re-enrol (new K6), the owner re-enters every workspace default key, every pairing harness re-pairs, config and slices re-pull, pending claims are re-issued as new K6 codes; key connections, grants and app data are unaffected.

## 2. Forms
One package `@opt2-tealbrick/bridge`; two forms. Everything not listed as a difference is the same code (MCP framing, JSON-RPC handling, error envelope, logging, version negotiation).

| Aspect | Deployed (full) | Local relay (C5) |
|---|---|---|
| Entry point | `bridge-server` image named by the current release record (kind `bridge`, REPOS §5), `node dist/server.js` | `tealbrick bridge serve --stdio` |
| Downstream transport | MCP Streamable HTTP on the public listener + internal listener | MCP stdio only (CORE I5: no loopback listener, so no relay-local token exists) |
| Upstream | Portal Core (enrol, config, status) + apps on the private network | the deployed bridge `https://<bridge>/mcp`, authenticated as the agent (K5) |
| State | S1–S8 on its volume / memory | none on disk except the agent credential in the OS keychain (owned by the CLI) |
| Modules active | all | MCP transport + upstream client only; forwards JSON-RPC verbatim |
| Enforcement | `gate()`, hooks, all checks | none (holds no grants, keys, config; duplicates no check) |

An enrolled bridge on own infrastructure (PRD §3 rule 5) runs the deployed form, whatever machine it is on; it is a full bridge. The relay never enrols. Harness-local tools (C4/C5 note in CORE §12) never pass through either form.

## 3. HTTP surface
Two listeners. Internal routes are not mounted on the public listener (404), and vice versa.

### 3.1 Public listener (`PORT`, the only public address of the workspace)
| Path | Purpose | Auth |
|---|---|---|
| `POST/GET/DELETE /mcp` | MCP Streamable HTTP (§7) | `Authorization: Bearer <K5 access>` |
| `GET /.well-known/oauth-protected-resource`, `…/oauth-protected-resource/mcp` | RFC 9728 | none |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | none |
| `POST /oauth/register` | RFC 7591 DCR | none (rate-limited) |
| `GET/POST /oauth/authorize`, `POST /oauth/pair/callback` | authorize page + pairing (§6.2) | PKCE + pairing code |
| `POST /oauth/token`, `POST /oauth/revoke` | tokens (§6) | PKCE / refresh / agent assertion |
| `/a/<product>/*` | person launch + app UI proxy (§9.1) | app session cookie (app-owned) |
| `/p/<product>/<declared path>` | manifest `publicRoutes` only (§9.2) | app verifies |
| `GET/POST /keys` | key-entry page (§9.3) — ONLY on the keys origin `TB_KEYS_PUBLIC_URL` (v0.1.10, C59) | `pur: keys` ticket → page session |
| `GET /healthz`, `GET /readyz` | liveness / readiness (§12) | none, no details |
| `POST /admin/v1/{pause,resume,revoke-connection,ticket}` | standalone only (§11); 404 otherwise | owner assertion |

Apps have no public address (CONFORMANCE A9). Any other path → 404.

v0.1.10 (C59) — key page on its own origin. The public listener answers two host names: the main origin (`TB_PUBLIC_URL`) and the keys origin (`TB_KEYS_PUBLIC_URL`, an `https` origin whose host name differs from the one of `TB_PUBLIC_URL`). The bridge selects the origin by the request `Host` (host name only, port ignored, case-insensitive). The keys origin serves ONLY `GET/POST /keys`, `GET /healthz` and `GET /readyz`; every other path on it → 404 (`/mcp`, `/oauth/*`, `/.well-known/*`, `/a/*`, `/p/*`, `/admin/*` included). The main origin serves every row above except `/keys`: `/keys` there → 404. `TB_KEYS_PUBLIC_URL` unset → `/keys` → `503` (body "key page not configured") on every host; the other routes are unchanged.

### 3.2 Internal listener (`TB_INTERNAL_PORT`, default 8788, private network only)
| Path | Caller | Purpose |
|---|---|---|
| `POST /tb/v1/claim` | app instance / companion service (K6 code) | claim (§10.1) |
| `POST /tb/v1/status` | instance (`TB-Assert`) | status push + long-poll for slice/keys changes (§10.3) |
| `GET /tb/v1/keys/<name>` | instance / service / `tb-exec` (`TB-Assert`) | key fetch (§9.4) |
| `POST /tb/v1/call` | instance (`TB-Assert` + `TB-Grant`) | app→app companion call (§8.3) |
| `POST /tb/v1/events` | app instance (`TB-Assert`) | v0.1.57: app event ingest (§14.1) |
| `GET /metrics` | private scrape | counters, no payloads (§12) |

## 4. Enrolment
### 4.1 First start
The bridge exists from onboarding step 1: Portal op `bridge.deploy` (browser auth, draftable, confirmation, SSE progress) runs automatically as the last phase of `workspaces.set_infrastructure`. Agent authorisation (device flow, pairing), the key page and every app deploy therefore find a bridge already enrolled. An own-infrastructure bridge (I16) enrols the same way with a code from `bridge.enrolment_code`.
1. Deploy sets env: `TB_PORTAL_URL`, `TB_ENROL_CODE` (K6 `tbe_…`, one-time, ≤ 24 h), `TB_KEK` (generated by the provider at deploy; Portal never sees it, CORE I3/I13), `TB_PUBLIC_URL`, `TB_KEYS_PUBLIC_URL` (v0.1.10, C59: the second public domain of the bridge service, key page only, §3.1/§9.3). No other secret.
2. No S1 on the volume → the bridge generates an Ed25519 key pair (K7). The private key never leaves the bridge.
3. `POST <TB_PORTAL_URL>/api/v1/bridge/enrol` (op `bridge_api.enrol`, `types/routes.ts`) with `EnrolRequest {code, publicKey (JWK), version, sdkMajors, form: "deployed" | "own_infra", publicOrigin}`.
4. Core checks `sha256(code)` (unused, unexpired, bound to this bridge), marks it used, stores the public key → `EnrolResponse {bridgeId, workspaceId, portalKeys, portalKeySet?, configPath, ackPath, waitMaxS}`.
5. v0.1.11 (C62/C63): the bridge verifies `portalKeySet` against its build-pinned roots (`verifyKeySetStatement`, CREDENTIALS §9.5) and pins the statement + its keys; a statement that fails → enrolment refused (S1 not written, `TB_ENROL_CODE` not considered used by the bridge). Transition (spec 0.1.11 only, nothing pinned, no `portalKeySet`): the bridge pins `portalKeys` (TLS to the Portal domain is the bootstrap trust, CORE §4) and logs a warning. It writes S1 and starts the config loop. `TB_ENROL_CODE` is ignored from then on unless it changes (§4.3).

### 4.2 Bridge assertion (every later request to Portal)
`TB-Assert: <bridge assertion>` (CREDENTIALS §10: `typ: tb-bridge-assert+jwt`, `iss` = `sub` = `tb:brg:<id>`, `aud` = `tb:portal`, `htm`, `htu`, `bd?`, ≤ 60 s, `jti`). Minted per request. Core stores only the public key; there is no shared secret (fixes v1 deployment-secret custody).

### 4.3 Re-enrolment
The owner runs Portal op `bridge.enrolment_code`; Core issues a new K6 and sets it as `TB_ENROL_CODE` on the bridge service (redeploy). On boot the bridge sees `sha256(TB_ENROL_CODE)` ≠ the digest in S1 → generates a NEW key pair and enrols with it (v0.1.11, C63a: a bridge holding a pinned key-set statement requires a valid `portalKeySet` in the `EnrolResponse` — newer or byte-identical, CREDENTIALS §9.5 rule a; absent or invalid → the re-enrolment is refused, the new key discarded and S1 — key, identity, pinned statement — kept unchanged; the refusal is logged and counted in the status report `rejected[] {kind: "config", code}`); Core rebinds the SAME `bridgeId` and refuses the old key at once. S2–S6 are kept. K5 access tokens signed by the old key fail → harnesses refresh (refresh digests in S4 survive). Grants stay valid (`cnf.brg` is the id). Apps accept the new key from their next slice (`bridge.keys`). After volume loss the same op gives plain enrolment against the existing record.

## 5. Signed config pull
### 5.1 Loop
1. `GET <configPath>?after=<rev of S2>&wait=60` (op `bridge_api.config`) with `TB-Assert`.
2. Core answers at once with `200 application/jose` (compact JWS, `typ: tb-config+jws`) when a newer `rev` exists, else holds ≤ 60 s and answers `304`. Pause/revoke reaches an online bridge in seconds, ≤ 60 s worst (C9).
3. Errors: `429/503` honour `Retry-After` (30 s–15 min); network errors back off 15 s → 240 s with jitter. No error path extends or replaces S2.

### 5.2 Verify (all must hold, else the document is dropped, S2 kept, failure counted in status)
v0.1.11 first: the key-set rule (`trustedPortalKeys`, CREDENTIALS §9.5) on the body's `portalKeySet` against the pinned statement (newer → it becomes the trusted set for this document; lower `seq` / different equal-`seq` statement → `keyset_rollback`; absent after a pin → `keyset_missing`; bad → `keyset_invalid`; each drops the document); then CREDENTIALS V0 rules with `typ: tb-config+jws`, `kid` = an `active` or `pending` key of the trusted set (S1); body ≤ 4 MB; payload valid against `workspace-config.schema.json`; `v = 1`; `iss = tb:portal`; `sub = aud = tb:brg:<own id>`; `ws` = enrolled workspace; `rev` > S2 `rev` (equal → no-op, lower → refused); `exp` > now. Each embedded grant (`verifyGrant`) and slice is verified on its own; a bad entry is dropped and reported (`grant_invalid`), not the whole document.

### 5.3 Apply (atomic)
Build the full routing table (agents, connections, instance keys, tools per agent, grants by `(sub, aud)`, hooks, skills, key requirements) off to the side; fetch any new manifest (`GET <internalUrl>/tb/v1/manifest`, verify `manifestDigest`; concurrency 4, 10 s each; an unreachable app marks only that app `down`); swap one pointer; persist S2; persist the newer key-set statement and its keys in S1 (v0.1.11; transition path only: replace the trusted Portal key set with `portalKeys`). `portalKeys` never changes the trusted set once a statement is pinned. After the swap: purge S4 records of revoked/removed connections and agents, emit MCP `notifications/tools/list_changed` / `resources/list_changed` to sessions whose set changed, wake `/tb/v1/status` long-polls whose slice changed, and send the status report (§5.6). Calls in flight finish on the table they started with; `gate()` re-runs on the new table just before forwarding (§8.1 step 9).

### 5.4 Offline semantics (C9)
- Portal unreachable: the bridge keeps serving S2; each grant still carries its own `exp` (12 h, re-minted at half-life).
- `exp` of the config = `iat` + 12 h. When now > S2 `exp`, the bridge FAILS CLOSED for agent calls and app→app calls (`config_expired`); person launch, public routes, key page, key fetch, claim and status stay up so the owner can act and apps can boot.
- Pairing-code redemption additionally requires a successful pull ≤ 10 min ago (CREDENTIALS §7).
- There is no separate lease. "Portal reachable" in status = last successful pull < 120 s ago.

### 5.5 Config content (payload, field by field; schema is authoritative)
| Field | Content | Bridge use |
|---|---|---|
| `v`, `iss`, `sub`, `aud`, `iat`, `exp`, `jti`, `ws`, `rev` | CREDENTIALS §5 K9 claims; `exp` = iat + 12 h; `rev` monotonic | §5.2, §5.4 |
| `workspace` | `{id, name}` | `{{workspace.name}}` |
| `bridge` | `{id, publicUrl}` | OAuth issuer, resource URL |
| `portalKeys` | `[{jwk, status: pending\|active\|retired}]` (CREDENTIALS §5.1; announced ≥ 24 h before use). v0.1.11: informational, equal to the statement's `keys` | transition path only (CREDENTIALS §9.5) |
| `portalKeySet` | v0.1.11: current root-signed key-set statement (`tb-keyset+jws`) | the ONLY source of the trusted key set (CORE §4, CREDENTIALS §9.5) |
| `pause` | `{workspace, agents[], instances[]}` — kill switch, agent pause, instance pause | `gate()` step 1; status long-poll pause rule |
| `revoked` | `{jtis: [{jti, exp}]}` — grants / pairing codes withdrawn early | `verifyGrant`, pairing check |
| `connections[]` | `{con, agt, method: key\|pairing, gen, publicKey? (key), status: active\|revoked}` | §6 |
| `instanceKeys[]` | `{ins, svc?, jwk}` — claimed instance and service keys | instance assertions |
| `grants[]` | agent→app grants (K10 compact JWS); mode, held, caps, wf live only in the grant | attached on forward |
| `apps[]` | every deployed instance: `{ins, product, version, sdkMajor, manifestDigest, internalUrl, ownInfra?, entitled, slice}` (`internalUrl` rule: §5.7) (`slice` = `tb-slice+jws`) | routing, manifest fetch, slice relay; `entitled` is informational (status/display), never a bridge decision |
| `apps[].candidateManifestDigest`, `candidateVersion` | v0.1.51 (G2b, INC-20261019-04): present ONLY while Core runs a health-gated update attempt (E3) of that instance (both or neither); `manifestDigest` stays the serving (old) release. Contract: the bridge releases that implement it (0.1.x line: 0.1.33; 0.2.x line: 0.2.4 — 0.1.32 and 0.2.0–0.2.3 do NOT) accept a running service whose manifest digest equals EITHER value, in every place that compares digests: building the routing table (boot, new config; the previous-manifest cache is looked up by both digests), the retry of a down app (the retry key includes the candidate), and the claim (`ClaimRequest.manifestDigest` may equal either; the claim is recorded as usual). The bridge then uses the manifest the service actually serves, never reports `manifest_mismatch` for the candidate, and reports the digest and version that RUN in `StatusReport.apps[]`; that is how Core's gate sees the target become healthy. A digest equal to neither still refuses `manifest_mismatch`. Without the fields: unchanged (older bridges ignore them). |
| `agents[]` | `{agt, name, mode}` | tools/list, skill variables |
| `hooks[]` | `{id, ins, product, hookId, phase, order, timeoutMs, match{products, operations?, effects?}, enabled?}` — v0.1.24 (C117): EVERY declared hook of every deployed app, `enabled` = owner switch (absent = true) | §8.2 |
| `skills` | `{digest, files[{product, id, title, when?, content}]}` rendered by Core with `renderSkill()` (settings/scope variables filled; `{{agent.*}}` left for the bridge) | §7.4 |
| `keyRequirements[]` | `{name, label, provider?, ins, product, required, source, usedBy[]}` with `when` resolved by Core against settings | key page, key fetch, presence booleans |
| `enrolCodes[]` | pending K6 digests `{digest, kind: instance\|service\|neighbour, ins, product?, service?, exp}` | §10 |
| `standalone?` | `{issuer: "tb:brg:<id>", kid, ownerKeys[jwk]}` (final Portal-signed config only, CREDENTIALS §17) | §11 |

Licence-last (J1, REVIEW R4): an app deployed while unpaid is in `apps[]` with `entitled: false`; it can claim, fetch keys and report health, but Core puts no grant, no hook and no companion grant for it, so nothing is callable (no tools, no app→app, no launch ticket) until it is entitled. The bridge never decides on entitlement: absent grants do the work.

### 5.6 Status report (= ack)
`POST <ackPath>` (op `bridge_api.ack`, `TB-Assert`) with `StatusReport` after each applied `rev`, when its content digest changes (debounced 2 s), and at least every 5 min. Content: `rev`, `appliedAt`, `bridge {id, version, form, boot, sdkMajors, mcpVersions, caps?}` (v0.1.54 C292: `caps` = BRIDGE_CAPS this bridge implements, e.g. `["owner_rows"]` for the C283 A1 owner-row filter, first in bridge 0.2.5; advisory, never widens access; Core normalises it, SDK-API v0.1.54), `portalReachable`, `apps[] {ins, state: ok|degraded|down|needs_keys|unclaimed|paused, version, sdkVersion, manifestDigest, lastSeen, pendingHolds}` (`pendingHolds` = count from the app's last `AppStatus`, count only → canvas badge; TBD shows the counts), `keys[] {name, ins, set: boolean}` (presence only), `scopeSummaries[] {agt, ins, label ≤ 80 chars}`, `connectionsCreated[] {con, agt, method: pairing, clientName, createdAt, pairingJti}`, `connectionsRevoked[] {con, reason: refresh_reuse|client_revoke}`, `claims[] {kind, ins, service?, publicKey, manifestDigest, version, internalUrl?, codeDigest, claimedAt}`, `rejected[] {kind, code, count}`, `toolsOmitted[] {ins, name, code}`. Never inputs, outputs, key values, tokens. Core records connections and claims and returns them in the next config; S4 `reported` and S5 entries are cleared once a config lists them.

### 5.7 App addresses (v0.1.11, BSD-07)
The bridge sends tool inputs, grants, call proofs, hook envelopes and the owner's proxied UI traffic to `internalUrl`, so a compromised Portal must not be able to point it anywhere else. Accepted forms (`isPrivateInternalUrl`, `@opt2-tealbrick/manifest`):
- deployed: `http://<name>.railway.internal:<port>` (schema `$defs/internalUrl`: `^http://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*\.railway\.internal:[0-9]{1,5}$`, port 1–65535);
- own infrastructure: any `http(s)://host[:port]` origin ONLY when the app entry has `ownInfra: true` AND the origin is listed in the bridge-local env `TB_OWN_INFRA_ORIGINS` (comma-separated origins, exact match after URL normalisation; set by the owner on their own infrastructure, never by Portal; Core never writes it at `bridge.deploy`).
  C268: prefer an https internal origin; on plain http, anything on your network path can change hook calls until bridge 0.2.5 (hook proofs then bind the whole hook request, claim `bd`, for hook apps that declare `proofClaims: ["bd"]`, miniapp-sdk 0.1.36+; C268b).
Anything else: the app is not routed (no manifest fetch, no op/hook/launch/public-route forwarding; calls answer `app_unavailable`), the config is otherwise applied, and the status report counts `rejected {kind: "config", code: "internal_url_refused"}`. The same rule applies to a neighbour claim's `internalUrl` (§10.2), evaluated as own infrastructure: refused → `403 internal_url_refused`, claim not recorded.

## 6. Agent sign-in (K5 issuance, CREDENTIALS §8)
K5 access: JWS by K7, `typ: tb-agent-session+jwt`, `iss` = `aud` = `tb:brg:<id>`, `sub` = `tb:agt:<id>`, `ws`, `con`, `gen`, 900 s. Refresh (pairing connections only): opaque `tbr_…`, 30 d sliding, digest in S4. Every MCP request re-checks the current table: `con` present, `active`, `gen` equal, `sub` = its agent, `ws` matches — so revocation acts on the next config, not after 15 min. A pairing connection created here and not yet in `connections[]` is valid from its S4 record until the first config whose `rev` was issued after the bridge reported it; if that config omits it, the bridge drops it (Core refused it, e.g. agent deleted). Issuance and refresh are allowed while paused (calls are refused, CREDENTIALS §13), refused for a revoked connection.

### 6.1 Key connections (TBD, `tealbrick` CLI agent mode — the CLI's only agent sign-in, SDK/Eve kits)
`POST /oauth/token` `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion=<agent assertion>` (`tb-agent-assert+jwt`, `iss` = `sub` = `tb:agt:<id>`, `con`, `aud` = `tb:brg:<id>`, ≤ 60 s, `jti` in S8). Verified with `connections[con].publicKey` (`method: key`, `active`). Returns an access token only; the agent re-asserts with K4. Until Core's device-flow approval reaches the config the bridge answers `invalid_grant` (`connection_unknown`); clients retry with backoff ≤ 60 s.

### 6.2 Pairing connections (Claude Desktop / Codex desktop remote connector) — C4
- Metadata: protected resource `{resource: <publicUrl>/mcp, authorization_servers: [<publicUrl>], bearer_methods_supported: ["header"]}`; AS metadata with `authorization_code`, `refresh_token` and jwt-bearer grant types, `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`. `401` from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="…"`.
- DCR (stateless): public clients only; ≤ 5 `redirect_uris`, each `https` or loopback `http` (any port on 127.0.0.1/[::1], RFC 8252); `client_id` = bridge-signed JCS blob of `{redirect_uris, client_name, iat}` — no client table. Exact redirect match except the loopback port.
- `/oauth/authorize` requires `response_type=code`, PKCE S256 (43-char challenge), `state` ≤ 512, `resource` = `<publicUrl>/mcp`. J1 path with no terminal: harness → "add connector URL" → browser opens this page → approve. The page offers:
  1. **Approve in Portal (default, path A):** creates `rid` (bound to the pending request, 10 min) and a pairing state proof (`tb-pair-state+jwt`: `rid`, `ret` = `<publicUrl>/oauth/pair/callback`, `rh` = host of the client's registered `redirect_uri`, `cn` = DCR `client_name` (shown as "unverified"), `aud` `tb:portal`, ≤ 600 s; claims per types/credentials.ts `PairStateClaims`); an auto-submitting form POST takes the browser to `https://<portal>/pair`. Core verifies the state with the registered bridge key; the signed-in owner picks or creates the agent card and confirms; Core mints a K2b with `rid` and returns the browser to `POST /oauth/pair/callback` by auto-submitting form (`code=<K2b>`, never in a URL). No bridge→Portal server call.
  2. **Paste code (fallback, path B):** the owner copies the code from the agent card and pastes it.
- Consent-phishing guard (C16 S3): the bridge authorize page and Portal's approve screen both show the `redirect_uri` host and the DCR `client_name` marked "unverified" (the bridge passes both inside the pairing state proof); Core approves only when the bridge's workspace account = the signed-in principal (PORTAL-API `pairing.approve`).
- Pairing code check (offline, CREDENTIALS §7): V0 with `typ: tb-pair+jwt`, trusted key, `aud` = `tb:brg:<own id>`; `ws` matches; `sub` agent in config, not revoked, not paused; workspace not paused; `rid` present ⇔ path A and equal to the pending request; last successful pull ≤ 10 min; `jti` ∉ `revoked.jtis` and unused (S6). Success → `con_<ULID>` (method `pairing`, `gen` 1) in S4 → one-time `tbac_` authorization code (60 s) → redirect with `code`, `state`, `iss`.
- `grant_type=authorization_code`: PKCE verify; `client_id`, `redirect_uri`, `resource` match → access + refresh.
- `grant_type=refresh_token` (CORE I12): current digest → rotate (new `tbr_`, `gen`+1, new 30 d; the old digest becomes `previousDigest` with `previousUntil` = now + 30 s). The previous token is accepted ONCE within those 30 s (network-retry grace: rotates again, `previousUsed` = true). Any other reuse (previous token after 30 s or a second time) → **revoke the connection** (S4 revoked, reported `refresh_reuse`, owner sees "connection signed out"). Unknown token → `invalid_grant`.
- `/oauth/revoke` (RFC 7009) revokes that connection locally (reported `client_revoke`).
K2b serves only these two OAuth connector paths (C16 S9: no CLI pairing path, no custom pairing grant type).

### 6.3 Rules
No person credential (K1, K3, owner assertion) is accepted at `/mcp`, `/oauth/*` or the relay (CREDENTIALS R-P1, CONFORMANCE C4): anything that is not a valid K5 / agent assertion / K2b / OAuth artefact → `401 unauthenticated`. Rate limits: DCR 30/min/IP, authorize 20/min/IP, token 60/min per connection.

## 7. MCP surface
### 7.1 Transport
Streamable HTTP at `/mcp` (POST JSON-RPC, GET SSE for notifications, DELETE ends the session; `Mcp-Session-Id` in memory, unknown → 404 so the client re-initializes). The two newest MCP protocol revisions at bridge release are supported (negotiated in `initialize`). Local harnesses use stdio via the relay (§2). Request body ≤ 2 MB; tool result ≤ 4 MB.

### 7.2 tools/list
Exactly the operations the calling agent's grants allow, computed per agent from the current table:
- for each grant with `sub` = this agent whose target instance is not paused: every manifest op with `audience: agent`, `op.crud ⊆ grant.crud`, `scopeType` declared, and (Bound) `op.id ∈ grant.wf`. Person-audience ops never appear.
- per product with ≥ 1 visible tool: `<product>__tb_hold_status` (input `{holdId}`, routed to SDK standard op `tb.hold_status`; passes `gate()` step 3 with any valid grant, the app returns only the caller's own holds — CORE I4).
- dynamic ops (CORE §13): `list` → one tool per entry of `POST <internalUrl>/tb/v1/bridge/catalog` (`{op}`) (≤ 256 `DynamicCatalogEntry`); entries whose `crud ⊄ grant.crud`, outside the op's ceilings or colliding with another name are omitted and reported. `search` → `<product>__<op>_search` + `<product>__<op>_call`.
- per product with ≥ 1 visible tool: `<product>__tb_skills` (read; input `{skillId?}`; no `skillId` → the skill index for that product, else one skill's rendered text). The bridge answers it itself from config `skills` (no app call, no hooks); it is the fallback where a harness does not inject resources or instructions (C16 S10). P1 probe per tested harness (Claude Desktop, Codex desktop, Claude Agent SDK, Eve, TBD) records which of resources / instructions / `tb_skills` reaches the model.
- agent or workspace paused → empty list; `initialize.instructions` says "paused by the owner".
Tool `inputSchema` = manifest `input` (unchanged). Idempotency: the agent passes `_meta["tealbrick/idempotencyKey"]` (string, 8–128 chars) on `tools/call`; the bridge forwards it as body field `idempotencyKey` (CORE §8); for ops with `idempotency: required` a missing key → `input_invalid`. Annotations: `readOnlyHint` = effect `read`, `destructiveHint` = effect `destructive`, `openWorldHint` = effect `outward|money`.

### 7.3 Tool naming
`<product>__<op>` (two underscores); dynamic list entries `<product>__<entry>`. Charset `^[a-z0-9_-]+$`, length ≤ 64 (strictest client limit). Product ids and op ids are already in that charset (MANIFEST); a name over 64 is omitted and reported (`tool_name_too_long`). Parse by splitting at the first `__`. Helper types: `ToolName`, `ParsedToolName` in `types/bridge.ts`.

### 7.4 Skills
- Resources `tealbrick://skills/<product>/<skillId>` (`text/markdown`) for products the agent has a grant to. The bridge only substitutes `{{agent.name}}` and `{{agent.id}}` with `renderSkill()` from `@opt2-tealbrick/manifest` (the same function Core uses for the other variables). Skill text is sanitized once in CI (`validateAppFiles`) and in Core's render of owner overrides; the bridge filters nothing (C16 S8).
- `initialize.instructions`: a short index (≤ 4 KB), one line per skill (title, `when`, resource URI) + the hold-status convention.
- A new skills digest → `resources/list_changed`. The same bundle is downloadable as a pack from Portal (not via the bridge).

## 8. Routing pipeline
### 8.1 Per call (MCP `tools/call`, directly or via the relay)
1. **Authenticate**: K5 per §6; assign `call_<ULID>`.
2. **Resolve target**: tool name → `(ins, op)` from this agent's table; unknown → `unknown_tool`. `_search` → `POST <internalUrl>/tb/v1/bridge/catalog` (`{op, query, limit}`); `_call` / list entry → dynamic resolve: cache or `POST <internalUrl>/tb/v1/bridge/resolve` (`{op, tool}`, 2 s) → `DynamicResolution {crud, effect, holdFamily?}`; outside the op's `crudCeiling` / `effectCeiling` → `dynamic_ceiling_exceeded`. Effect never comes from the agent.
3. **Select grant**: the config grant for `(tb:agt:<id>, tb:ins:<target>)`; none → `no_grant`.
4. **Validate input** against the op's input schema (manifest package validator) → `input_invalid`.
5. **`gate()`** (CORE §7, no counters): paused (`pause`; connection status) → `verifyGrant` (`cnf.brg` = self, `jti` ∉ `revoked.jtis`) → `op.crud ⊆ grant.crud`, agent audience, `scopeType` declared (standard op `tb.hold_status` passes with any valid grant, I4) → `wf` when the grant is Bound or (v0.1.19 C111a) its `wf` is non-empty (companion grants are `bound` with `wf` = declared companion ops, I8). Refuse → error, stop. The bridge never decides hold.
6. **Before hooks**: matching `hooks[]` (`phase: before`), ascending `order`, then product id; each `POST <hook app internalUrl>/tb/v1/hooks/<hookId>` with the CORE §8 envelope and a hook call proof; timeout = `timeoutMs` (≤ 2 s). `allow: false` → `hook_denied`; error, timeout, bad shape or paused hook app → `hook_failed` (fail closed).
   - v0.1.52 (C268 B, C268b; bridge 0.2.5): the hook call proof carries `bd` = sha256 of the exact body bytes sent ONLY when the hook app's current `proofClaims` (from its `ClaimRequest`, then each `AppStatus` push; the newest wins) lists `"bd"`. Never inferred from `sdkVersion` (other SDKs and test apps report other numbers). Only an APP-INSTANCE claim or status sets it (no `service`; companion-service claims and pushes never change it); a missing value, a non-array, or entries other than `"bd"` mean none. The bridge changes the stored capability ONLY on authenticated or config events: a config change of that app's `manifestDigest`, `version`, `candidateManifestDigest` or `candidateVersion` (an update attempt starts or ends, incl. an E3 rollback) → drop; a re-claim → the claim's set; an `AppStatus` push whose `version` or `proofClaims` differ from the stored ones → the push's set. NEVER on a connect failure, a timeout or a 401 (a network attacker can cause those; dropping would downgrade later calls). A stale capability fails CLOSED: the older app refuses the proof and the hook ends `hook_failed` until its first push. A hook call refused 401 is NEVER retried without `bd`. Applies to before, context and after hooks.
7. **Context hooks**: same order; each `add` key MUST start with `<hook product>.` else `hook_failed`; merged into `context` (later hooks see earlier additions); error/timeout → `hook_failed`.
8. **Config age**: now > S2 `exp` → `config_expired`.
9. **Re-gate**: `gate()` again on the current table (a pause applied during hooks wins).
10. **Forward**: `POST <internalUrl>/tb/v1/ops/<op>`, `Authorization: Bearer <grant>`, `TB-Call: <op call proof>`, body `{input, context, idempotencyKey?}`; `redirect: error`; timeout 30 s; one retry only if the connection failed before any byte was sent.
11. **App answers** (SDK: call proof, slice pause, `verifyGrant`, `authorize()`): `200 {status: "ok", output, receiptId?}` | `202 {status: "held", holdId, expiresAt}` | error envelope.
12. **After hooks** (only on `ok`): same order; may replace `output` or apply `redactions` (JSON pointers). Error/timeout → output withheld, caller gets `after_failed`, and the bridge sends `POST <internalUrl>/tb/v1/bridge/mark {call, mark: "after_failed"}` (bridge-op proof) so the SDK marks the receipt. The action is not undone.
13. **Return**: `ok` → MCP result, `structuredContent` = output (+ JSON text); `held` → `structuredContent {status: "held", holdId, expiresAt, checkWith: "<product>__tb_hold_status"}` (not an error); refusal/error → `isError: true` with `{error: {code, message, requestId}}`. One log line (§12).

Call proofs (`TB-Call`, `typ: tb-call+jwt`, K7, ≤ 60 s; CREDENTIALS §10): op proof `iss` `tb:brg:<id>`, `sub` = caller, `aud` `tb:ins:<target>`, `call`, `gjti` (grant `jti`), `op`, `in`, `ctx`; hook proof `call`, `hook`, `phase`, `ctx`, `in?`, `aud` = the hook app. Apps verify with `bridge.keys` from their slice. Bridge-only SDK calls use the third variant `CallProofBridgeOpClaims {call, bop: catalog|resolve|mark|scope_summary, op?, in?}` (`aud` = target instance, no grant) on `POST /tb/v1/bridge/{catalog,resolve,mark,scope-summary}`; the SDK verifies it with `verifyBridgeOpProof` (C16 B5).

### 8.2 Hook rules
- Hook calls are bridge→app HTTP calls, never routed calls: they never trigger hooks and carry no grant. Their legitimacy = config `hooks[]` (Core-resolved, licensed, owner-enabled) + call proof with `phase`.
- A companion call whose `parentCall` is a call currently inside a hook → `hook_reentry`; companion chains deeper than 3 → `call_depth_exceeded`.
- `context` is open JSON. The bridge adds only the reserved `tb.*` keys (v0.1.13: `tb.onBehalfOf`, §8.5); hooks never write `tb.*`. Unknown namespaced fields pass through untouched.

### 8.3 App → app (companion) path
`POST /tb/v1/call` (internal) with `TB-Assert: <instance assertion>` (`tb-instance-assert+jwt`, `htm`, `htu`, `bd` required), `TB-Grant: <companion grant from the caller's slice>`, body `CallEnvelope {target: <product>, op, input, idempotencyKey?, parentCall?}`. Pipeline = §8.1 with: step 1 instance assertion (`kid` ∈ `instanceKeys` or S5 for `(ins, svc)`; caller or target paused → `paused`), step 3 the presented grant (`sub` = caller instance, `aud` = target), steps 4–13 identical, same hooks. Result = the op answer (`ok` / `held` / error envelope).

### 8.4 Refuse codes (error envelope `code`)
`unauthenticated`, `paused`, `unknown_tool`, `no_grant`, `grant_invalid`, `grant_expired`, `grant_revoked`, `crud_exceeds_grant`, `audience_not_agent`, `scope_type_unknown`, `not_in_workflow`, `input_invalid`, `dynamic_resolve_failed`, `dynamic_ceiling_exceeded`, `hook_denied`, `hook_failed`, `hook_reentry`, `call_depth_exceeded`, `config_expired`, `app_unavailable`, `app_timeout`, `app_error`, `after_failed`, `payload_too_large`, `rate_limited`, `sdk_major_unsupported`, `code_invalid`, `manifest_mismatch`, `key_not_declared`, `key_not_set`, `grant_stale` (v0.1.11, C70: a companion grant minted under an older slice/config revision than the one the bridge holds now; `grant_expired` stays for `exp`; the SDK re-reads its slice and retries once for both, SDK-API §9), `internal_url_refused` (v0.1.11, BSD-07, §5.7). App-side codes (e.g. `scope_denied`, `idempotency_conflict`) pass through unchanged.

## 9. Person launch, public routes, keys
### 9.1 Person launch (K11 `pur: launch`)
Portal GUI form-POSTs the ticket to `https://<bridge>/a/<product>/tb/launch`. The bridge checks signature (trusted key or standalone issuer), `typ: tb-ticket+jwt`, `pur: launch`, `aud` = `tb:ins:<instance of <product>>`, `exp`; it does NOT consume the `jti` (the SDK redeems it once and sets `tb_session`, Path `/a/<product>/`). The bridge proxies `/a/<product>/*` to `<internalUrl>/a/<product>/*` unchanged — `tb/launch`, `tb/v1/*` (person API: session, logout, person-audience ops) and paths under manifest `ui` only — stripping `Authorization` and every `TB-*` header except `TB-CSRF`, adding `X-Forwarded-Proto/Host`. SSE/WebSocket pass through; body ≤ 10 MB. Launch is not paused and works with a config older than 12 h (CREDENTIALS §13).

### 9.2 Public routes
Only manifest `publicRoutes` of apps in `apps[]`: `/p/<product>/<path>` → `<internalUrl>/p/<product>/<path>` (exact path; `oauth_callback`: GET, `webhook`: POST), body ≤ 1 MB, `TB-*` headers stripped, 60 req/min per route. The app verifies (`state` / provider signature). Undeclared → 404.

### 9.3 Key-entry page (K11 `pur: keys`)
1. Portal GUI form-POSTs the ticket to `<TB_KEYS_PUBLIC_URL>/keys` (never in a URL). v0.1.10 (C59): the page lives ONLY on the keys origin (§3.1); the main origin answers 404 for `/keys`, and `503` "key page not configured" is the answer when `TB_KEYS_PUBLIC_URL` is unset.
2. The bridge checks signature, `typ`, `pur: keys`, `aud` = `tb:brg:<own id>`, `exp` (120 s); consumes the `jti` (S6); opens a page session (HttpOnly, Secure, `SameSite=Strict`, `Path=/keys`, 15 min) with a CSRF token. v0.1.6 (C52): the ticket POST is answered with the key form DIRECTLY — `200` + `Set-Cookie: tb_keys=…; HttpOnly; Secure; SameSite=Strict; Path=/keys` on that same response; NO `303` redirect (browsers drop a `SameSite=Strict` cookie on a redirect in a chain started by a cross-site POST, so the page would open without its session).
3. The page lists the `account_default` entries of `keyRequirements[]` (the ticket's `req` names first) with set / not set — never values. Inputs are write-only (set, replace, delete); each value ≤ 16 KB.
4. Submit writes S3 (sealed), bumps `keysRev`, wakes `/tb/v1/status` long-polls; the status report carries presence booleans only.
Values are never logged, never in status, never sent to Portal, never echoed to the browser. The page is not paused (C9). Every key-page response (ticket POST, GET, submit) carries `Content-Security-Policy` with `form-action 'self'` (plus the existing security headers), so the form submits only to the keys origin. The session cookie keeps HttpOnly, Secure, `SameSite=Strict`, `Path=/keys` and is set by the keys origin (host-only, no `Domain`).

### 9.4 Key fetch by apps (C2)
`GET /tb/v1/keys/<name>` with `TB-Assert` (instance or service key). Allowed only if the caller's verified manifest declares `settings.keys[]` with that `name`, `source: account_default`, and `usedBy` contains the caller (`app` or the service id) — else `403 key_not_declared`; not set → `404 key_not_set`; caller or workspace paused → `403 paused`. Response `{name, value, keysRev}`, `Cache-Control: no-store`. App-own keys never touch the bridge (SDK `getKey` prefers them). `tb-exec` (SDK wrapper entrypoint of engine containers) claims as a service (§10), fetches its declared keys with this call, execs the upstream command with them as env, and restarts the child when `keysRev` changes.

## 10. App claim
### 10.1 Claim
1. The instance (or a companion service via `tb-exec`) boots with `TB_ENROL_CODE` (K6) and `TB_BRIDGE_URL` (internal), generates its Ed25519 key (K8) on first boot and keeps it sealed on its own volume (`TB_DATA_DIR`).
2. `POST /tb/v1/claim` `ClaimRequest {code, instancePublicKey, manifestDigest, version, sdkVersion, service?, internalUrl?, proofClaims?}` (v0.1.52: `proofClaims` = optional proof claims the app accepts, e.g. `["bd"]`).
3. The bridge looks up `sha256(code)` in `enrolCodes[]` (unexpired, not used in S5); SDK major supported (else `sdk_major_unsupported`); known instance → `manifestDigest` = config value (else `manifest_mismatch`); neighbour → fetch `GET <internalUrl>/tb/v1/manifest` and check the digest.
4. It records the claim in S5, reports it in the next status (§5.6), and answers `ClaimResponse {ins, bridge {id, publicKey, internalUrl}, slice?, app?, serviceKeys?}`; for a service, `app` = `{publicKey}` of its app instance (this is how `tb-exec` learns the key it accepts on its control port; refreshed on each status long-poll answer) and `serviceKeys` = `[{name, env}]` from the manifest. `slice` is absent until Core lists the key in `instanceKeys`; the SDK then waits on §10.3.
5. Core binds the key to the Instance record; the next config lists it. A reused code → `code_invalid`.

### 10.2 Own-infra neighbour apps
The owner runs Portal op `instances.register_own_infra` for a neighbour product; Core creates the Instance record and puts the code digest (`kind: neighbour`) in config; the owner sets the code and bridge URL in the neighbour's env; the neighbour claims with its `internalUrl`. Same path, same checks; v0.1.11 (BSD-07): the `internalUrl` must pass §5.7 as own infrastructure (listed in `TB_OWN_INFRA_ORIGINS`, or the railway.internal form), and Core lists the instance in `apps[]` with `ownInfra: true`.

### 10.3 Status push + slice / keys long-poll
`POST /tb/v1/status?wait=60` with `TB-Assert`, body `AppStatus {readiness: ready|needs_keys|degraded, version, sdkVersion, scopesRev, sliceRevision, keysRev, pendingHolds, attention?, proofClaims?}` (`pendingHolds` = number of holds waiting for the owner, count only; v0.1.28 F89: `attention {code, reason}` = an app-reported condition the owner should see, e.g. a degraded memory engine — the bridge copies it into `StatusReport.apps[].attention` and emits a health change when it changes; a bridge that predates it ignores the field; v0.1.39 (C213 US-2): `schemaVersion`, `minCompatibleCode` and `failure` are copied the same way into `StatusReport.apps[]`, unchanged, absent stays absent; v0.1.40 (C219, bridge 0.1.31): `preUpdateSnapshot` too, with exactly the five ref members `file` (safe file name), `sha256`, `createdAt`, `from`, `to` — extra members of the app's ref are dropped, a malformed ref is omitted, `null` stays `null`, a change emits a health report; Core shows it on the update record next to `dataRestoredTo`). Accepted also while paused (so the pause reaches the app). The bridge records health (no push for 150 s → `down`), answers at once if the slice `rev` or `keysRev` differs from the body, else holds ≤ 60 s → `AppStatusResponse {slice, sliceRevision, keysRev}` or `204`. When `scopesRev` changes the bridge calls `POST <internalUrl>/tb/v1/bridge/scope-summary` (bridge-op proof `bop: scope_summary`, no grant, no hooks) and puts the labels in its status report.

### 10.4 Instance slice (payload, `tb-slice+jws`; schema authoritative)
K9 claims (`v`, `iss`, `sub` = `aud` = `tb:ins:<id>`, `iat`, `exp` = iat + 12 h, `jti`, `ws`, `rev`) + `ins`, `product`, CREDENTIALS §5.1 section (`portalKeys` (informational from v0.1.11), `portalKeySet?` (v0.1.11: the current key-set statement; apps verify the slice against it, CREDENTIALS §9.5), `bridge {id, keys}`, `pause` = `{workspace, agents, instances}` — no connections: a connection revoke is enforced only at the bridge, the one holder of connection state, `revoked`, `personNbf`, `grants` = companion grants this app presents, `standalone?`) + `agents[] {id, name, mode, status}` (edge agents, or all if `needsAgentDirectory`).

## 11. Standalone mode (leaving Portal; CREDENTIALS §17, C16 B7)
1. The owner runs `tealbrick standalone owner-key` (owner key in the OS keychain) and pastes the public JWK into Portal's "Leave Portal" step (browser confirmation).
2. Core publishes a FINAL config and final slices with `standalone {issuer: "tb:brg:<id>", kid: <K7 thumbprint>, ownerKeys}` and `portalKeys` emptied.
3. The bridge applies it, stops pulling and reporting, and freezes it: S2 stays the verbatim final config; the bridge never edits it. From it the bridge re-mints grants (12 h, half-life) and slices (same content, new `iat`/`exp`/`rev`), signs them with K7 (`iss: tb:brg:<id>`), and keeps them with the admin overlay in S9. The 12 h rule (§5.4) applies to the re-minted documents.
4. Apps keep working unchanged: the last Portal-signed slice named that issuer and `kid`.
5. Admin = exactly 4 ops, `POST /admin/v1/…` with owner assertions (`tb-owner-assert+jwt`, key in `ownerKeys`), CLI `tealbrick admin pause|resume|revoke-connection|ticket`:
   | Op | Effect |
   |---|---|
   | `pause` / `resume` `{agt?}` | agent pause, or workspace kill switch without `agt`; overlay on `pause`, next slices carry it |
   | `revoke-connection` `{con}` | connection revoked in the overlay; its K5 and refresh chain stop at once |
   | `ticket` `{pur: launch\|keys, product?}` | K11 signed by K7, returned to the CLI for the browser |
6. Adding agents, connections, edges or apps after leaving is next wave. No licence logic (apps are open source). One-way in opt2 (rejoining Portal = new workspace + re-enrolment).

## 12. Health, HA, observability
- `/healthz`: process up → 200. Both public origins (main and keys, §3.1) serve `/healthz` and `/readyz`. `/readyz`: S1 + S3 unsealed and a verified S2 (any age) loaded → 200, else 503. Bodies are `{status}` only.
- Restart policy: always, max 10 retries (template). Boot to ready ≤ 5 s with a warm volume.
- **HA (recommendation: standby only, never active-active; backup per §1.2):** the deploy target attaches a volume to one service and runs no replicas with volumes; grants are bound to one `bridgeId` (`cnf.brg`) and refresh state lives in S4, so two enrolled bridges would double every grant and split connections. opt2 runs exactly ONE active instance per bridge identity. The second instance is a standby of the same image using the SAME state: started only after the active one is stopped, from the same volume (re-attached) or the latest volume backup — same S1, no re-enrolment. Without volume or backup: re-enrol (§4.3), the owner re-enters keys, pairing harnesses re-pair, config re-pulls (§1.2). Core detects two processes reporting one `bridgeId` with different `boot` ids within 5 min and shows `bridge_duplicate` on the canvas.
- Metrics (`/metrics`, internal only): calls by product/op/decision/code, hook latency and failures by hook id, config `rev` and age, pull errors, app states, tool counts. No payloads, no agent-supplied strings as labels.
- Logs: JSON lines `{ts, level, call, agt|ins, product, op, decision, code, ms, inDigest}`. Never inputs, outputs, tokens, tickets, codes or key values; error text passes the SDK redactor; one line per failure code per minute. Monitoring with scrubbing (Platform).

## 13. Versioning
- Bridge semver; the bridge is a release in the Release Registry (kind `bridge`) and updates through the same Portal op as apps.
- Supports the current SDK major and the one before (`sdkMajors` in enrol/status): claims, call proofs, hook envelopes and slice formats are served for both; an older major → `sdk_major_unsupported`. Wire paths stay `/tb/v1/…`.
- Config `v: 1` only; an unknown `v` is refused (no negotiation, no version headers). Two newest MCP protocol revisions (§7.1).

## Request → §
| REQUESTS item | Answer | § |
|---|---|---|
| bridge: scope statement | does / does NOT + complete state inventory incl. volume-loss effects | 1 |
| bridge: enrolment = bridge keypair | as proposed; code ≤ 24 h (CORE K6, not 10 min); re-enrolment keeps `bridgeId`, old key refused at once | 4 |
| bridge: signed workspace config | one raw JWS with slices embedded, digests-only ack (I6); long-poll 60 s (C9); manifests by digest; grant 12 h; config older than 12 h → fail closed (replaces "until each grant exp" and the lease) | 5 |
| bridge: agent sign-in remote MCP | bridge = AS (C4); "Approve in Portal" (path A) + paste fallback, redirect host + unverified client name shown (S3); access 15 min, refresh 30 d rotating, 30 s retry grace, other reuse revokes (I12) | 6.2 |
| bridge: local form when apps are private | relay mode, identity only, stdio only (C5, I5) | 2 |
| bridge: ONE authorization function | split per C10: bridge `gate()`, app `authorize()`; app counts caps and creates holds | 8.1 |
| bridge: bridge → app authentication | grant in `Authorization`, `TB-Call` proof (CORE §8), no `x-*` headers | 8.1 |
| bridge: hook chain wire | CORE §8 envelope; order phase → `order` → product; ≤ 2 s; fail closed; no recursion; owner can disable (Core) | 8.2 |
| bridge: MCP surface | `<product>__<op>` ≤ 64 (validator rejects longer, I9), hold-status tool with any grant (I4), `<product>__tb_skills` fallback (S10), no prompts, idempotency via `_meta`, list_changed, dynamic list / search+call, skills resources + instructions index | 7 |
| bridge: launch + key-entry tickets | launch `aud` = instance, app redeems (CORE §13); keys ticket consumed by the bridge; key fetch | 9 |
| bridge: app claim via bridge | app POSTs claim with K6 (the bridge does not call the app); bridge key in response + slice | 10 |
| bridge: app → app calls | `/tb/v1/call` + companion grant, same pipeline | 8.3 |
| bridge: CLI.md needs | relay (stdio), key connection only (S9), standalone owner key + 4 admin ops (B7); harness config print / `--write` (CORE §13) | 2, 6.1, 11 |
| bridge: standalone mode | frozen final config, bridge re-mints with K7, 4 admin ops (B7); Portal-less first start = next wave (I11) | 11 |
| bridge: note C4/C5 decided | applied | 2, 6.2 |
| portal-core: enrolment + config shape; neighbour registration | field table; neighbour via `instances.register_own_infra` + claim | 4, 5.5, 10.2 |
| connect/knowledge: dynamic tools | catalog (list) / search+call; resolve before `gate()` | 7.2, 8.1 |
| knowledge: companion services + keys | services claim with own K6/K8; `tb-exec` learns its app key from the claim response | 9.4, 10.1 |
| connect: public callbacks; person UI | `/p/…`, `/a/…` incl. `/a/<product>/tb/v1/*` person API | 9.1, 9.2 |
| knowledge/connect: key read path | `/tb/v1/keys`, `keysRev` via status long-poll | 9.4, 10.3 |

## Checklist mapping (SPEC-REVIEW-CHECKLIST § BRIDGE + related anti-patterns)
| Checklist line | § |
|---|---|
| Never runs agents, never calls models, no app data beyond routing state | 1.1, 1.2 |
| Local and deployed share one code path; exactly what differs | 2 |
| Public surface only MCP, launch, key page, health; apps no public address | 3.1 (+ OAuth AS and declared public routes, required by C4 / CORE §13) |
| Outbound-only: enrolment + signed config pull; content and refresh/expiry rules | 4, 5 |
| Hook order + failure semantics; "on behalf of" left out | 8.1 steps 6–12, 8.2 |
| ONE decision function for every harness; adapters only show prompts | 8.1 step 5 (`gate()`; `authorize()` in the app per C10), 2 (relay has none) |
| Pause, held families, Free/Bound caps on every path | pause + Bound at `gate()` on MCP, relay, companion (8.1, 8.3), key fetch (9.4); held/caps by the app's `authorize()` on the same forwarded call (C10) |
| Offline until expiry; licence in signed config, no online check | 5.4 (C9: 12 h), 5.5 (licence-last) |
| Agents authenticate; never hold grants, keys, runtime credentials | 6, 8.1 step 3, 2 |
| MCP tool list filtered by grants + skills | 7.2, 7.4 |
| Key page customer-side, Portal never sees values | 9.3 |
| No call or payload to Portal on the tool path | 1.1, 5.6 (status content), CONFORMANCE B9 |
| Long-lived process, grants in memory; no per-call rebuild/file cache | 1.1, 1.2, 5.3 |
| Companion grants; own-infra neighbours; SPOF (health, restart, second instance, volume backup); standalone; bridge exists from onboarding step 1 | 8.3, 10.2, 12, 1.2, 11, 4.1 |
| One approval object; holds/receipts in app | 1.1, 8.1 steps 11/13 (`held` handle, `tb_hold_status`), 5.6 (`pendingHolds` count only) |
| Anti-patterns: gate only in one Claude hook; payloads via Portal; per-call connector rebuild; pause subset | 2 + 8.1; 1.1; 1.2; 8.1 step 5 + 8.3 + 9.4 |

## Open questions
None open for the bridge after C15/C16 and CORE §14. Settled items recorded for traceability: shared `/a/<product>/` origin (C15 accepted until third-party apps ship; the key page left that shared origin in v0.1.10, C59), `entitled: false` entries (C15), idempotency key as body field (CORE §8; SDK-API aligned), relay stdio only (I5), refresh grace 30 s (I12), CLI key connection only (C16 S9).

## v0.1.3 clarifications (C35)
- Public routes: the app receives the full path `/p/<product>/<path>` (the SDK also matches `<path>` alone).
- `ClaimResponse` carries no workspace id; apps take it from the first verified slice. Slice grant entries are matched to companion targets by `wf`.
- `AppStatusResponse` does not refresh `app.publicKey`; `tb-exec` uses the key from its claim answer. Services report `AppStatus` with `scopesRev = 0`, `pendingHolds = 0`.

## v0.1.5 addition (C50)
- `POST /tb/v1/claim` from a companion service whose app instance has not claimed yet → `503 app_not_claimed` with `Retry-After` (seconds); the claim is not recorded and the service's enrolment code is not consumed. `tb-exec` retries with backoff.

## v0.1.10 additions (C59)
- Key page on its own origin (security audit S3): new deploy env `TB_KEYS_PUBLIC_URL` (§4.1) — an `https` origin on a SECOND public domain of the bridge service, host name different from `TB_PUBLIC_URL`. `/keys` is served ONLY when the request `Host` is that host name; that origin serves nothing but `/keys`, `/healthz`, `/readyz` (everything else → 404); the main origin answers 404 for `/keys`; unset → `/keys` answers `503` "key page not configured" (§3.1).
- Cookie unchanged (`tb_keys`, HttpOnly, Secure, `SameSite=Strict`, `Path=/keys`, host-only), now set by the keys origin. Key-page responses carry `Content-Security-Policy` with `form-action 'self'` in addition to the existing headers (§9.3).
- Core adds the second public domain at `bridge.deploy` and sets `TB_KEYS_PUBLIC_URL=https://<that domain>`; the bridge release `runtime` record lists it with `source: public-url`. `tickets.keys` returns `url = <TB_KEYS_PUBLIC_URL>/keys` and the GUI form-POSTs the ticket there. The keys ticket `aud` stays `tb:brg:<id>` (no credential change).
- Own-infra bridges (I16) and standalone (§11 `ticket {pur: keys}`): the operator sets `TB_KEYS_PUBLIC_URL`; the CLI form-POSTs the ticket to `<TB_KEYS_PUBLIC_URL>/keys` through the browser. How Core learns an own-infra keys origin (no `EnrolRequest` field in v0.1) is an open item for the next type revision; until then Core uses the value it set at deploy.

## v0.1.10 addition (C64, S1)
- Instance slice `bridge.publicUrl` (https origin of the bridge): Core emits it in every slice once the bridge public URL is known; apps (SDK `OpContext.publicUrl` / public-route ctx) build third-party callback URLs `<publicUrl>/p/<product><path>` from it.

## v0.1.11 additions (C62/C63, BSD-07, C70)
- Key-set statements (CREDENTIALS §9.5): `EnrolResponse.portalKeySet` verified against the build-pinned roots at enrolment (§4.1); config and slice carry `portalKeySet`; the trusted Portal key set comes only from the newest root-signed statement, persisted sealed in S1; `portalKeys` informational for one minor. Config refusals `keyset_invalid`, `keyset_rollback`, `keyset_missing` appear in the status report's `rejected[]` (kind `config`). The bridge pins roots from its build (`portalRootKeys(<build channel>)`); a test harness may replace them only through a programmatic start option, never through env (CONFORMANCE §7).
- `apps[].internalUrl` private-network forms + `ownInfra` + bridge-local `TB_OWN_INFRA_ORIGINS` (§5.7); refuse code `internal_url_refused` (§8.4). Replaces the interim `TB_APP_HOSTS` name.
- C70: refuse code `grant_stale` (§8.4).
- C63a: the no-statement fallback applies only while nothing is pinned (never at re-enrolment of a bridge with a pinned statement, §4.3) and is removed in spec 0.1.12 (a dev/stable build then refuses a first `EnrolResponse` without a valid `portalKeySet`).

## v0.1.11 addition (StatusReport, Bridge + Core request)
- `StatusReport.portalKeysDigest?` = JCS `digest()` of the `portalKeys` array the bridge trusts after applying `rev` (Core compares it with the set it signed for that revision: mismatch → error log + alert, BSD-08 short term).
- `StatusReport.apps[].sliceRevision?` = the `AppStatus.sliceRevision` the app last reported (omitted before its first report; Core uses it to see an instance has moved to a transition key, BSD-15).
- Both optional and additive. (`minRollback` on runtime records is not filed yet → next minor.)

## v0.1.12 (fallback removed, 2026-10-12T10:19:19Z)
- §4/§5: enrolment responses and configs without a valid root-signed `portalKeySet` are refused (`keyset_missing` / `keyset_invalid`), first enrolment included, by every bridge build that pins roots for its channel (bridge 0.1.13+). The 0.1.11 transition text is superseded.

## v0.1.13 additions (C81 G1/G4b, C82, C85, C86)
### 8.1 step 6 — hold verdict (G1)
- A before hook answers `{allow: true}`, `{allow: false, reason?}` (refuse → `hook_denied`), or `{allow: false, hold: {family, reason}}` (`family` ∈ HOOK_HOLD_FAMILIES, `reason` 1..280 chars; anything else, or `hold` with `allow: true` → `hook_failed`).
- Precedence over the whole before chain (in order): the first refuse stops the chain at once (`hook_denied`). Otherwise the FIRST hold verdict is kept and the remaining before hooks still run (any later refuse wins). With a kept verdict, steps 7–10 run as usual and the op call proof carries `hv: {f: family, r: reason, by: "<product>/<hookId>"}` (CREDENTIALS §10). The app decides the hold (`authorize()`); the bridge never answers `held` itself.
- Retry after approval (C82): the bridge runs the before chain again for every call, the retry included. If a before hook now refuses, the retry is refused (`hook_denied`) and the approved hold does NOT run (the approval stays unconsumed). If it answers hold again, the proof carries `hv` again and the app's approval for (caller, op, inputDigest) satisfies it (runs once).
### 8.5 Reserved context (G4b)
- If `tools/call` carries `_meta["tealbrick/onBehalfOf"]` (`OnBehalfOfClaim {kind: person|agent|channel_sender, id, display?}`), the bridge validates the shape (`kind` known; `id` 1..256 chars; `display` ≤ 128; JCS ≤ 1 KB) and puts `tb.onBehalfOf = {claim, verified: false, via: "mcp_meta"}` into `context` before the before hooks (hooks and the app see it; it is covered by `ctx` in the proof). A bad or oversized claim is dropped (the call proceeds without it) and counted in the status report `rejected` (kind `claim`, code `on_behalf_of_invalid`). `channel_sender` ids are `"<channel>:<value>"` (SDK-API §18).
- The `tb.` context namespace is the bridge's: a context hook answer with any `tb.*` key → `hook_failed` (fail closed). The bridge never writes a non-`tb.` key.
- Later (Martin Q5): the same key may carry `verified: true` + `attestation` (e.g. a Connect-signed sender). Consumers treat `verified: false` as a claim: narrow only, never widen.
### 8.3 — app-initiated calls (C85)
- A companion call without `parentCall` is app-initiated (timers, background refresh, event handlers). Same pipeline as §8.3 (assertion, presented companion grant, gate, all hook phases, holds by the target app); rate-limited per caller instance (120/min, burst 30 → `rate_limited` + `Retry-After`) like any caller; audited `call.app_initiated` in the bridge log line (`parentCall: null`). Hooks see `call.caller.type = "app"`.
### 3 — launch path (C86)
- A launch ticket (K11 `pur: launch`) may carry `path` (Core-validated, PORTAL-API v0.1.13). After the ticket POST the bridge redirects to `/a/<product><path>` of the ticket's own instance only; it re-checks the path rule (relative, `/`-prefixed, no `//`, `\`, `..`, scheme or host) and falls back to `/a/<product>/` on any doubt.

## v0.1.14 addition (C91, QA S1: catalog 401)
- **Bridge-op proof binding (C91, spec 0.1.14):** ONE rule, implemented once as `bridgeOpBinding(bop, body)` / `bridgeOpProofClaims(bop, body)` in @opt2-tealbrick/manifest 0.1.8 (the bridge signs with the second, the SDK and conformance verify with the first): `catalog` → `{bop, op}` only — the search body `{op, query?, limit?}` is NOT bound (no `in`; a read-only search, replay still blocked by `jti`); `resolve` → `{bop, op, in}`; `mark` → `{bop, in}`; `scope_summary` → `{bop}` (empty body). `in` = digest(JCS body). A proof that carries any other claim set for its `bop` is refused (`call_proof_invalid`, 401). Dynamic CALLS are not bridge ops: they arrive on `/tb/v1/ops/<op>` with an op proof (`in` = digest(input)). Bridge 0.1.15 adopts it (bridge 0.1.12–0.1.14 signed `in` for catalog → every dynamic search failed at SDK apps).
- **v0.1.14 (L3, Bridge request):** failed bridge ops surface to Core: StatusReport `rejected[]` kind `bridge_op` (code = the app's error code or `app_unavailable` / `app_timeout`), and `toolsOmitted[]` code `catalog_failed` for a dynamic list op whose catalog failed. A warn log alone is not enough.

## v0.1.14 addition (C98, S1 from a real agent: model-driven clients cannot set `_meta`)
- §7.2 / §8.1 step 4: when a `tools/call` for an op with `idempotency: required` carries no `_meta["tealbrick/idempotencyKey"]`, the bridge DERIVES the key with the shared `deriveIdempotencyKey({connection, session, op, input, now})` (@opt2-tealbrick/manifest 0.1.9): `drv_` + sha256 of JCS {connection id, MCP session id, op, canonical input, 10-min bucket}. The identical call in the same session and window gets the same key (the app deduplicates it); a client that sends a key keeps exact semantics. `input_invalid` for a missing key is gone. Root cause (L2): every test and mock set `_meta`, so the refusal of real model-driven clients was never seen. Conformance 0.1.10: `B8.idempotency_derived` replaces `B8.idempotency_required`.
- **v0.1.14 StatusReport:** optional `connectionsSeen [{con, lastSeen}]` (connections that authenticated since the previous report, ≤ 500, latest time each); Core moves `AgentConnection.lastSeenAt` forward only (future times clamped, unknown/foreign ids ignored).
- **v0.1.14 parentCall (A2A-10):** a `parentCall` the bridge does not know as a call currently in flight for the SAME caller instance (forged, another instance's call, or finished) is ignored: the call is app-initiated (C85 rate limit + `call.app_initiated` audit) and gains no hook re-entry or depth credit. A valid in-flight parentCall keeps §8.2.
- **v0.1.15 (C98a, queued):** the bridge derives the idempotency key (same `deriveIdempotencyKey`) for ops with idempotency `required` AND `supported` when `_meta` has none, so a model-driven retry of a `supported` op is deduplicated too; `none` ops never get a key. Conformance 0.1.11 adds the `supported` case to `B8.idempotency_derived`.
- **v0.1.15 (C105a):** no bridge rule: app→app calls (in-handler and app-initiated) are held by the target app from the companion grant's `held` (= workspace `appsPolicy.held`, CORE I8); the bridge forwards the app's `held` answer (`OpResult {status: held, holdId}`) to the calling app as for any companion call. Bridge 0.1.17 needs only to pass `held` through unchanged (it already does).
- **v0.1.17 (L3, C104):** StatusReport `rejected[]` kind `manifest` = an app manifest the bridge refused (code = `manifest_mismatch`, a manifest validator code, or `bridge_too_old` when the manifest's `requires.bridge` is newer than this bridge). A warn log alone is not enough.
- **v0.1.17 (C107 decision):** a dynamic `resolve` answer whose effect is `outward` or `money` and that carries no `holdFamily` is refused with `dynamic_resolve_failed` and `details.reason: "family_missing"`; the op is not called (conformance `B16.resolve_family`).
- **v0.1.21 (L1, Bridge request):** `tools/list` per agent = the ops for which `opVisibleToGrant(op, grantClaims, declaredScopeTypes)` holds (@opt2-tealbrick/manifest 0.1.14; the static part of gate() steps 3–4, built on `opInGrantWorkflow`, which gate() itself uses). The bridge keeps no local copy of the workflow / crud / audience rule.
- **v0.1.22:** StatusReport `rejected[].ins?` = the app instance concerned (kind `manifest` always; `bridge_op` when known).
- **v0.1.24 (C116; bridge 0.1.21 emits it):** StatusReport `rejected[]` kind `config`, code `standalone_without_grants` = the FINAL standalone document lists agents and apps but carries no agent grants. The bridge still applies it (fail closed: no grant → no tool) and reports it (count only, no `ins`). Root cause QA J2-15: Core minted the final doc with grantable=false (fixed in Core 1195b75).

## v0.1.24 (C117, S1 fail-open: Rules hooks dropped after an update)
- Config `hooks[]` lists EVERY declared hook of every deployed app with `enabled: boolean` (owner switch). Chain building (§8.1 steps 6, 7, 12): for a routed call, the bridge takes the hooks DECLARED in the manifests of the deployed apps it routes (manifest `hooks[]` + `match`) and, for each one that matches the call:
  - present in `config.hooks` with `enabled: false` → skipped (owner choice);
  - present and enabled (or `enabled` absent) → run as today;
  - ABSENT from `config.hooks`, or its app is down / unreachable / not claimed → the call is refused `hook_failed` (fail closed; message names the hook and "not active" / "app unavailable"). Never forwarded without it.
- A hook therefore leaves the gate only by an explicit owner action (switch off, remove the app), never because of a run state, an update in progress, a licence lapse or a missing config bump.
- v0.1.25 (bridge 0.1.22): the bridge reports a matching declared hook that is missing from `config.hooks` as StatusReport `rejected[]` kind `config`, code `hook_not_listed`, with `ins` = the hook app's instance.

## v0.1.43 — views role (LA-1, C232) and size limits (OD-9)
- Views role: the bridge image started with `TB_ROLE=views` is the workspace views service (tb-views). No volume, no Portal connection, no enrolment, no keys; it refuses to start if `TB_ENROL_CODE`, `TB_KEK` or `TB_PORTAL_URL` is set. It serves `GET /v/<product>/…`, `/healthz`, `/readyz`; everything else 404; HEAD/OPTIONS 405. It forwards to the bridge PRIVATE listener `GET /tb/v1/views/<product>/<rest>` with header `TB-Views-Key` (Core-generated `TB_VIEWS_KEY`, constant-time compare; wrong or missing → 404). Edge duties: request header allow-list (MANIFEST v0.1.43), 120 req/min per client IP (first `X-Forwarded-For` hop) + 32 in flight (503 `Retry-After`), body ≤ 2 MiB, 10 s, strip `Set-Cookie`/`Access-Control-*`, `VIEWER_HEADER_FLOOR`, the `_d` CSP gate. The bridge private route checks pause (503 `paused`), routes to the instance with the viewer route, applies the floor and the `_d` gate again, and reports `StatusReport.views {url, ok, lastCheckAt}` from a `/readyz` probe.
- Size limits enforced today (OD-9; numbers from the code, bridge 0.1.32 / miniapp-sdk 0.1.25):
  | Path | Request | Response | Time |
  |---|---|---|---|
  | Agent op (`POST /mcp`, JSON-RPC) | ≤ 2 MiB at the bridge; ≤ 4 MiB read by the SDK | app result ≤ 4 MiB | 30 s to the app |
  | Companion call (`/tb/v1/call`, private) | ≤ 2 MiB | ≤ 4 MiB | 30 s |
  | Person op / app UI (`/a/<product>/…`) | ≤ 10 MiB | not capped by the bridge (streamed) | 60 s socket idle |
  | Public route (`/p/<product>/…`) | ≤ 1 MiB | not capped by the bridge (streamed) | 60 s socket idle |
  | Views (`/v/<product>/…`, v0.1.43) | GET only | ≤ 2 MiB | 10 s |
  | Hook answers, bridge-op answers | – | ≤ 256 KiB | – |
  Apps that carry files in JSON (base64) size them below these limits; a larger file needs a streaming route (OD-2, later).


## v0.1.45 — hook caller product (HOOK-CALLER-PRODUCT)
Hook requests (`before`, `context`, `after`) carry `call.caller.product` for an APP caller: the calling instance's product from the bridge's signed configuration (instance table), never from input or a manifest name. Policy apps (Rules) match "calls from product X" on it; an instance id changes on reinstall. Absent for agents and for an app caller the bridge cannot map — treat that as unverified (fail closed for product-keyed rules).

## 14. App events (v0.1.57; C274c, C274d; MANIFEST §16, SDK-API §20)
One event stream per agent, filtered by that agent's grants, with an opaque cursor and replay; delivered on the agent's
EXISTING `/mcp` session (one connection, one auth, one grant check). Shape-compatible with MCP SEP-3415 (C274b): our
`tealbrick/events/{list,poll,stream}` map to `events/{list,poll,stream}`, the envelope `id` is the opaque cursor, overflow
answers `truncated: true`. Types: types/bridge.ts "App events". A bridge declares the cap `"events"` (with `"owner_rows"`)
ONLY in the release that implements all of §14.

### 14.1 Ingest — `POST /tb/v1/events` (internal)
- Auth: instance assertion `TB-Assert` (`htm`, `htu`, `bd` required) of a claimed APP instance; a companion service → 403.
  Body `EventIngestBody {items}` (1..100 items, ≤ 512 KiB), processed IN ORDER; answer 200 `EventIngestResult` (one result
  per item, same order). Whole-request failures: 401 `unauthenticated`, 413 `payload_too_large`, 429 `rate_limited`
  (companion-call bucket of that instance), 503 `app_not_claimed`. 4xx per item never fails the batch. A paused instance
  may send: its events are stored and held (MANIFEST §16.2 rule 5).
- Per `emit` item, in this order (first failure → `refused` with the code, nothing stored):
  1. The declaration: a `tb.*` name must be a `PLATFORM_EVENTS` type (else `event_reserved`); app events from product `tb`
     → `event_reserved`. Otherwise the SERVING manifest's declaration when it has the name, else (only while a G2b attempt
     runs) the candidate manifest's (`candidateManifestDigest`); neither → `event_undeclared`. The row records which
     manifest digest it was checked against; fan-out uses that declaration.
  2. Shape: `key` `^[A-Za-z0-9._:-]{8,128}$`, `subject.kind` `^[a-z][a-z0-9_]{0,31}$`, `subject.id` 1..256, `data`
     validates against the `payloadSchema` → else `event_payload_invalid`; `summary` > 280 chars, `data` > 2 KiB (JCS) or
     item > 4 KiB → `event_too_large`.
  3. Scoped (the `visibleWith` op has a `scopeType`) ⇔ `instanceId` present (1..256) and `eligible` present →
     else `event_instance_invalid`.
  4. `audience: target` ⇔ `to` present with 1..100 agents → else `event_target_invalid`.
  5. `(app instance, key)` seen in the last 7 days → `duplicate` (nothing stored, not an error). (`eligible` has at most
     500 entries because a slice has at most 500 agents; more → `event_payload_invalid`.)
- Fan-out at write time: candidates = `to` (target) or every agent with a grant to this instance (granted); keep those
  that pass MANIFEST §16.2 rules 1–4 now (scoped: ∩ `eligible`, with the per-entry authority); write one row per
  recipient. `stored` with `recipients` (0 is a valid answer). Paused recipients get their row (rule 5).
- `purge` items: delete every stored row of (`agent`, this app, `instanceId`), delivered or not; without `agent` (an
  instance deleted or disconnected) the rows of EVERY agent for that app and instance; answer `stored`.

### 14.2 Per-agent log
- Row id = ULID, strictly increasing per bridge (the cursor). Order per agent = id order = ingest order (the SDK outbox
  drains in emit order, so one app's events keep their order).
- Retention (C274d ruling 3): per agent, 7 days or 10 000 rows, whichever comes first; the oldest rows go first. The bridge
  keeps per agent `droppedThrough` = the highest id it removed BY RETENTION.
- At delivery the bridge re-checks MANIFEST §16.2 rules 1, 5 and 6 against the current table, using the op named by the
  row's RECORDED declaration, looked up in the CURRENT serving manifest; if that op's `scopeType` presence differs from
  the recorded one (a scoped row without `eligible`, or the reverse) the row is dropped. Otherwise: a paused agent/workspace/instance keeps the row; an op missing from the serving
  manifest while a G2b attempt runs keeps the row (the candidate may become serving); a failed grant check, or an op that
  is missing once no attempt runs (rollback), drops it (not delivered, not counted as truncation). Rule 6: an enabled
  `before` or `after` hook that matches the op → the event goes out without `summary`.
- Held rows and the cursor: an agent's cursor is one sequence over all apps. A row held because its INSTANCE was paused (or
  its op was waiting on a G2b attempt) gets a NEW id when it is released, so a cursor that moved past it meanwhile still
  receives it. Every row keeps `origin` = its first id; it may have been delivered before under its old id, so consumers
  dedupe by `origin` (never by `id`). The re-id happens in the same transaction that applies the resume (or the G2b
  switch), in old-id order, before any later ingest from that instance, so one app's order holds. Agent and workspace
  pauses hold the whole stream, so no re-id is needed.
- Retention age counts from INGEST (a re-id does not extend it). When retention removes a HELD row (its old id may be below
  the agent's cursor, so `droppedThrough` would not show it), the bridge sets a per-agent flag and answers `truncated: true`
  on that agent's next `poll` or `stream` call, whatever the cursor; the flag clears once answered. (A runtime holding an
  open stream sees it on its next reconnect or fallback poll.)
- Presence (D6) is out of scope of 0.1.57 (no wire field).

### 14.3 Delivery on `/mcp` (JSON-RPC on the agent's session)
- `tealbrick/events/list` → `EventsListResult`: the types this agent can receive NOW, plus `tb.hold.decided` for each app
  with a valid grant. Unscoped type: rule 1. Scoped type (`scoped: true`, the `visibleWith` op has a `scopeType`): a valid
  grant to the app, an agent op, and the `wf` rule (the per-instance crud part depends on scope rows the bridge never
  sees). Delivery modes `["poll","stream"]`.
- `tealbrick/events/poll {cursor?, limit?}` → `EventsPollResult`: rows with id > cursor (absent = from the oldest kept),
  ≤ limit (1..100, default 50). `truncated` = `cursor` is absent or < `droppedThrough` AND `droppedThrough` exists — i.e.
  retention removed events the agent had not read. While the agent or the workspace is paused: `{events: [], cursor:
  <unchanged>, truncated: false, paused: true}`.
- `tealbrick/events/stream {cursor?}` → `EventsStreamResult {cursor, truncated, paused?}`: `cursor` = the position the
  stream starts after (the given cursor; null = from the oldest kept), same `truncated` rule, `paused: true` while the
  agent or workspace is paused (frames start on resume; the subscription stays). Then the session's SSE stream
  (`GET /mcp`) carries `notifications/tealbrick/event {event}` frames: first the backlog after `cursor`, then live events
  within 1 s of ingest. Frames go only on an open GET stream; while none is open nothing is lost (the next GET with
  `Last-Event-ID`, or a poll, picks up from there). Each such frame has SSE `id:` = `event.id`; other frames on that stream carry no
  `id:`, so `Last-Event-ID` always names the last event. A GET reconnect with `Last-Event-ID` resumes after it. An
  unknown session (404) → the client re-initializes and calls `stream` with its stored cursor. One subscription per
  session; a second `stream` call replaces it.
- A cursor this bridge did not issue (not a ULID) → JSON-RPC error -32602 with `data.code: "cursor_invalid"`. A ULID
  cursor newer than every row = nothing yet (not an error).
- Delivery is at-least-once; consumers dedupe by `event.origin` and store their cursor (`event.id`) only after they
  handled the event.
- `tools/list_changed` is unchanged (§7.2). A bridge without the cap answers these methods with JSON-RPC -32601
  (method not found); runtimes then keep their own polls (no user step).

### 14.4 Tests (bridge 0.2.7; conformance B-EV-*, gated by the reported `"events"` cap, never by version)
Emit → subscribed agent < 3 s; agent without a visible op → nothing and no `events/list` entry; scoped event to an agent
not in `eligible` (e.g. its row lacks the op's crud) → nothing;
the causing agent → nothing; disconnect, 3 emits, reconnect with the cursor → exactly those 3 in order; grant revoked
between write and read → not delivered; instance paused while another app's events advance the cursor, then resumed →
the held events arrive (new ids, same `origin`, in their old order before any later event of that instance); a held row
removed by retention → `truncated: true` on the next poll; a matching `before`/`after` hook → no `summary`; a product `tb` → refused; > 10 000 rows or older than 7 days → `truncated` + oldest kept; undeclared type,
app `tb.*`, invalid payload → refused, nothing stored; same `(app instance, key)` twice → one event; scoped event to an
agent outside `eligible` → nothing; purge → stored rows of that agent and instance gone; purge without agent → every
agent's rows for that instance gone; `"events"` in every StatusReport of a bridge that
passes all of these, never otherwise.
