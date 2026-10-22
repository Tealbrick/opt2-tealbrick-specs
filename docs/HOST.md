# opt2 specs — HOST (customer server: pairing, signed plans, local policy, reports)

Status: v0.1.58 (S1-0, frozen 2026-10-22; wording revised in v0.1.59). Sprint S1 "deploy outside Railway" (C308).
Machine-readable source of truth: `packages/spec/src/host.ts` (types, `HOST_LIMITS`, `HOST_PATTERNS`, `HOST_POLICY`,
`HOST_PLATFORM_ENV`, `HOST_BOX_OWNED_ENV`, `HOST_SECRET_VALUE_PATTERNS`, `HOST_CONFORMANCE`), route rows in `routes.ts`
(`servers.*`, `host.*`, RT9), K13 + `TYP.hostAssertion` / `TYP.hostPlan` + `DEVICE_FLOW.hostClientIds` in `credentials.ts`,
schemas `schemas/host-plan.schema.json` and `schemas/host-report.schema.json`. Where this file and the code disagree, the code wins.

Two ends build against it: **Portal Core** (pairing, server object, plan queue + signing, reports, provider `own_infra`) and the
**host agent** (`tealbrick host`, private CLI repo: plan verification, local policy, engine adapter, firewall, reports).

Threat model: Core may be compromised (for example through its hosting environment). A valid Portal
signature only proves that Core made a plan. The box enforces a closed local policy (§5) that no signature can override.

## 1. Auth: K13 host key and the host assertion
- New caller type `host` (CREDENTIALS §1 now lists six) and credential kind **K13 host key**: Ed25519, generated ON the box by the
  host agent, private half in a root-only 0600 file outside every container (`holder_host_file`); never in the engine, never sent.
- **Host assertion** = `TB-Assert: <jws>` (never `Authorization`), header exactly `{alg: "EdDSA", typ: "tb-host-assert+jwt", kid}`
  with `kid` = RFC 7638 thumbprint of the pinned key; claims `HostAssertionClaims`: `iss = sub = tb:srv:<srv>`, `aud = tb:portal`,
  `iat`, `exp` (exp − iat ≤ 60 s), `jti` (ULID, once per verifier), `htm`, `htu` (path + query as sent, `/api/v1/…`), `bd`
  (sha256 of the raw body, required when a body exists). Same shape and replay rules as the K7 bridge assertion.
- Auth class `host` (routes.ts). **RT9**: the class is accepted ONLY on `host.*` rows, and `host.*` rows accept only it.
- The public key is pinned at pairing (§2). Rotation in S1 = a new pairing (new `srv_`); S2: signed rotation.
- The owner CLI stays read + drafts only (RT1 unchanged). The host agent never holds a person credential, an owner session, an
  agent connection or a Railway token.

## 2. Pairing = device flow with scope `host`
1. `tealbrick server add --ssh root@<ip>` (CLI, owner's machine) installs the agent + the engine over SSH, then starts
   `tealbrick host pair` on the box. No claim code in cloud-init in S1 (M7: metadata endpoint).
2. The agent generates K13 and calls `device.start` (public) with `DeviceStartHostInput`
   `{scope: "host", client_id: "tealbrick-host", machine_label, host_public_key, facts}`. `tealbrick-host` is the only client for
   scope `host` and can never get scope owner or agent (`DEVICE_FLOW.hostClientIds`).
3. The CLI shows `verification_uri_complete` + `user_code` (the agent relays them over the SSH session).
4. The owner opens `/device` (browser). `device.lookup` returns `DeviceRequest.host = {publicKeyThumbprint, facts}`; the page
   shows the facts and asks for ONE choice: the workspace (+ optional server name `label`).
5. `device.approve {userCode, ws, label?}` = in ONE transaction and ONE consent record: (a) create `srv_…` (state `pending`) and
   pin the key, (b) `workspaces.set_infrastructure {provider: "own_infra", destinationId: srv_…}` for that workspace (recorded as
   one applied draft, `DeviceDecision.draftId`; audit `device.approve` + `server.pair` + `workspace.set_infrastructure`), which
   also requests the bridge deploy (the first plan). `DeviceDecision.serverId` = the new server.
   `DeviceRequest.agents` is `[]` for scope host. Refused: a workspace that already has infrastructure of any provider
   (409 conflict, `details.reason = infrastructure_set`; S1 never replaces — moving a workspace is a later migration feature),
   a paused or standalone workspace, a key already pinned for a live server (409 conflict).
6. The agent polls `device.token` (RFC 8628). Result `DeviceHostTokenResult {scope: "host", server_id, workspace_id, key_thumbprint}`
   — no token; the box checks `key_thumbprint` equals its own key and from now on signs host assertions.
- The device code is single-use and lives 10 min (K2); it is redeemed before the box can fetch any plan.

## 3. Server object
`Server {id, workspaceId, label, state, facts, keyThumbprint, lastReportAt, lastSeq, services, firewall, createdAt, detachedAt}`
(host.ts). One server runs ONE workspace (one engine stack per workspace). State (Core computes it):
`pending` paired, no report yet · `online` last report < 90 s ago, firewall ok, no service failed · `degraded` online but the
firewall check failed or a service is `failed` / its health `failing` · `offline` no report for 90 s · `detached` terminal.

| opId | method path | auth | notes |
|---|---|---|---|
| `servers.list` | GET /servers?ws= | browser, owner-cli | the account's servers, newest first; `ws` = only that workspace's server |
| `servers.get` | GET /servers/{srv} | browser, owner-cli | |
| `servers.detach` | POST /servers/{srv}/detach `{srv}` | browser; draftable, confirm, Idempotency-Key | returns the Server; repeat-safe; S1: stop + keep data + unpair (below). No delete op in S1 |
| `host.plans` | GET /host/plans?after=&wait= | host; longpoll | ONE plan JWS or 304 |
| `host.report` | POST /host/reports | host | `HostReport` → `HostReportAck`; also the heartbeat |

**Detach (S1)**: Core issues one final plan (`final: true`, only `stop_service` actions) that stops every `tb-` service it
created on the server (volumes KEPT), marks the server `detached`, clears the workspace infrastructure and marks that
workspace's instances removed with data kept. Until the box reports that plan applied, Core keeps serving it on `host.plans`
(re-signed with a new seq when it expires, so a box that was offline still gets it) and accepts `host.report`; after that every
host assertion of the server is refused (401). The box, after applying a final plan, records the pairing as detached, refuses
every later plan and stops polling. The data stays on the box. Re-pairing = a new device flow (new `srv_`);
re-adopting kept data on a server is out of S1.

## 4. Plans (signed by Core, CHECKED by the box)
- `host.plans?after=<last applied seq>&wait=<s>`: Core answers `200 application/jose` with ONE plan — the lowest unexpired
  `seq > after` — or `304` after `wait` seconds (default 50, max 60; the longpoll transport caps at 75 s). The box applies or
  refuses it, reports (§6), and polls again. On a network error: back off 5 s → 60 s. Rate class `host_poll` (6/min per server).
- Plan JWS: header exactly `{alg: "EdDSA", typ: "tb-host-plan+jws", kid}` (`kid` = the Portal signing key's thumbprint);
  payload `HostPlanClaims` = `{v: 1, iss: "tb:portal", sub = aud = "tb:srv:<srv>", server, workspace, seq, iat, exp, jti,
  portalKeySet, actions}`; closed schema `host-plan.schema.json`; ≤ 64 KiB; 1–16 actions applied in order.
- `portalKeySet` is REQUIRED: the current root-signed key-set statement, verified exactly like a config/slice (CREDENTIALS §9.5):
  statement under a root pinned in the agent build (dev or prod channel, a build constant), seq never goes back, plan signed by an
  `active` or `pending` key of it (`@opt2-tealbrick/manifest` `trustedPortalKeys` → `signers`, then `verifyJws` with
  typ `tb-host-plan+jws`). There is no separate key-set URL for the box.
- `seq`: strictly increasing per server, from 1. `exp − iat ≤ 900 s`. Core signs at enqueue and never serves an expired plan;
  a deploy job whose plan expired undelivered fails (`deploy_failed`, reason `plan_expired`); Retry enqueues a new plan (new seq).
- Actions: `ensure_service {service: HostServiceSpec}` (create, or replace when the spec differs — same identity only) and
  `stop_service {serviceName}` (never removes a volume). `ensure_agent_runtime` is RESERVED (S2+: a container unit in the stack
  with an egress policy); S1 boxes refuse it like every unknown kind (`schema_invalid`). Host-level units never exist.
- `HostServiceSpec` (closed): `serviceName` (= `("tb-" + product + ("-" + component)?)` cut to 60, single label), `component`
  (null = the main image, else the manifest service id), `release {product, releaseId, image (name@sha256 only), manifestDigest}`, `env`, `generatedSecrets` (names), `serviceRefs` (key = the env
  name in THIS service; value = `{serviceName, env}` of the SOURCE service: a tb- service the agent created in the same workspace
  stack, and a variable that source holds on the box — one of its generated secrets or an env value of its current spec; the box
  resolves it from values it holds; never a value from outside the box, never reported; must equal the manifest's whole-value
  `{{services.<id>.env.<NAME>}}` entry), `enrolCode` (the one-time `tbe_` code; the box sets TB_ENROL_CODE; never logged or
  reported), `port`, `publicDomain` (bridge only) + `publicHosts {main, keys}` (C59), `healthPath`, `stopGraceSeconds` (≤ 120;
  bridge drain C131), `volumes` (NAMED only: `{name, mountPath, purpose}`; the box names them `<stack>_<serviceName>_<name>`),
  `resources` (a request the box clamps). Manifest mount paths must not start a segment with "." (the plan pattern refuses it).
- Never in the schema, so never sendable: host paths, bind mounts, privileged, cap_add, devices, network_mode, pid, ipc,
  extra_hosts, user, sysctls, security_opt, entrypoint/command overrides, labels, compose, build/source (`HOST_FORBIDDEN_KEYS`).

## 5. Local policy on the box (cannot be overridden by a valid signature) — `HOST_POLICY`
Principle: every value the box can derive from the verified release, its pairing and its own config it DERIVES and compares.
Left to Core: which release, the owner's setting values (public, non-secret), the one-time enrolment code. ALL checks of ALL
actions run before the first engine call; a refused plan changes nothing.
1. **verifySignature / bindServer / notExpired** — §4 trust rule; `server`, `sub`, `aud` = this box, `workspace` = its paired
   workspace; `now ≤ exp + 30 s`, `iat ≤ now + 30 s`.
2. **monotonicSeq** — `lastSeq` = the highest seq the box DECIDED (applied, or refused after signature + server binding
   verified), persisted, used as `after`. seq ≤ lastSeq → `replayed`; seq > lastSeq + 1000 → `seq_out_of_range` (lastSeq not
   moved, reported); a bad signature never moves lastSeq. Core serves only plans the box has not decided, so a reported
   refusal never blocks later plans. A VPS snapshot restore rolls back lastSeq, the key-set pin and the version floor
   together; the agent re-derives the floor from the images it finds running.
3. **closedSchema** — `host-plan.schema.json`, ≤ 64 KiB (`schema_invalid`).
4. **serviceIdentity** — serviceName is derived from (product, component); the box records (product, component) at first
   create and refuses another identity for that name forever, also after a stop (`identity_changed`). A reinstall of the same
   app (new TB_INSTANCE_ID) keeps the name and its volumes.
5. **imageFromIndex** — the box fetches `index.json` + `index.jws` itself, verifies them with the release keys pinned in the agent
   build; entry `releaseId` exists, product, channel (box config, default stable) and `manifestDigest` match, and `image` =
   entry.image (component null) | entry.services[component].image | the digest-pinned image of manifest runtime.services[component]
   (`not_in_index`). Index or manifest unreachable → nothing applied (`index_unavailable`).
6. **noDowngrade** — a version floor per (product, component), persisted, across every serviceName, running or stopped. The
   release that runs now is never a downgrade (a setting change passes). Below the floor → `downgrade_refused`, except a rollback
   to the ONE version that ran for that serviceName right before the current one, only while the current one is `failed` or
   health `failing` (C213); that rollback lowers the floor. The owner's `instances.rollback` (snapshot restore) is not available
   on own servers in S1 (Core refuses it).
7. **envAllowlist** — names in env ∪ generatedSecrets ∪ serviceRefs keys are pairwise disjoint and declared for that component
   (manifest runtime.env / runtime.services[id].env; bridge: index runtime.env), or `HOST_PLATFORM_ENV` (env only:
   TB_INSTANCE_ID, TB_SERVICE, TB_DATA_DIR, TB_LOG_LEVEL, TB_BACKUP_DIR = the backup volume's path when the spec carries one,
   else TB_DATA_DIR/backup) or `HOST_PLATFORM_GENERATED` (TB_KEK). `HOST_BOX_OWNED_ENV` (PORT,
   TB_ENROL_CODE, TB_OWN_INFRA_ORIGINS, TB_INTERNAL_HOST, TB_PORTAL_URL, TB_PORTAL_KEYS, TB_BRIDGE_URL, TB_PUBLIC_URL,
   TB_KEYS_PUBLIC_URL — the box renders them) and `HOST_DENIED_ENV` (NODE_OPTIONS, LD_*, PYTHONPATH, JAVA_TOOL_OPTIONS, PATH,
   proxies, …) are refused everywhere, even if declared (`env_not_declared`).
8. **manifestMatch** — `generate: secret` / `provider-secret` names only in generatedSecrets; `value` / `fixed` entries only in env
   with exactly that value (`{{services.<id>.host|port|url}}` rendered by the box); whole-value `{{services.<id>.env.<NAME>}}`
   only as serviceRefs {serviceName of <id> in the same instance, NAME}; platform values = what the box derives; `port` and
   `healthPath` (or null) = the declared ones; volumes = a subset of the declared ones at their paths (none declared: one at
   "/data") (`manifest_mismatch`). Not on own servers in S1: TB_RESTORE_FROM (snapshot restore), TB_KEK_PREVIOUS (KEK rotation).
9. **noSecretValues** — no env value matches `HOST_SECRET_VALUE_PATTERNS` (`secret_like_value`).
10. **generatedNotSent** — the adapter GENERATES the engine config; no compose/engine spec from outside reaches the engine.
11. **neverDeleteVolumes** / **finalPlan** — no action deletes a volume in S1. A `final` plan (only stop actions, may be empty)
   makes the box stop EVERY tb- service it created, keep all data, refuse every later plan and stop polling (§3).
12. **resources** — clamped to the facts minus 1 GiB RAM / 0.5 CPU reserve; box defaults when null.
13. **ownInfraOrigins** — after every applied change: rewrite the bridge's `TB_OWN_INFRA_ORIGINS` (exact
   `http://<serviceName>:<port>` origins of the running tb- APP services the agent created in this stack, sorted, comma-separated)
   and `TB_INTERNAL_HOST` (= the bridge serviceName, hostname form = advertise only), then restart the bridge.
14. **firewall** — agent-owned, re-checked before every report and on every Docker `network create` event: DROP by default from
   any Docker bridge (`br-+`, `docker0`) to the host (INPUT, IPv4 + IPv6): :22, the engine API, other stacks' networks, IPv6
   host addresses, 169.254.169.254; explicit allows only for the engine's own network. A failed check → `firewall.ok = false`.
15. **containEscapes** — every report cycle the agent lists ALL containers and compares each one's HostConfig
   (namespace modes, privileged, capabilities, devices, binds/mounts) with what it expects: the config recorded at install for an
   engine component's pinned digest, or the config it generated for a tb- service. Name and digest only identify, never exempt.
   A deviating container with a container:/host namespace mode, privileged, added capabilities, devices, a docker.sock or
   host-path bind gets `docker update --restart=no` + `docker stop` (data kept) and is reported in `escapes` (code
   `escape_attempt`) until Core acknowledged it. Core marks the server `degraded` (24 h) and alerts.
16. **publicHosts** — only the bridge (kind bridge, component null): `main = w<lower ws ULID>.<zone>`,
   `keys = w<lower ws ULID>-keys.<zone>`, `zone` = the box's configured workspace zone.

## 6. Reports (metadata only — no log content, no env values, no secrets)
`HostReport {server, at, lastSeq, results[], services[], facts, firewall, escapes?, queued?}`, schema `host-report.schema.json`,
≤ 64 KiB, every 30 s and after every plan (rate class `host_write`, 30/min per server). `results[] = {seq, index, ok, code?}`, one
per action; `index: -1` = the whole plan was refused before any action. A result is re-sent until a report carrying it got 200.
Error codes `HostErrorCode`: `bad_signature`, `wrong_server`, `replayed`, `seq_out_of_range`, `expired`, `schema_invalid`,
`identity_changed`, `not_in_index`, `index_unavailable`, `downgrade_refused`, `env_not_declared`, `manifest_mismatch`,
`secret_like_value`, `engine_error`, `health_timeout`, `firewall_failed`, `escape_attempt` (the `escapes[]` event:
`{container, image, reasons[], stoppedAt, stopped}`, reasons `namespace_mode | privileged | capabilities | devices | docker_sock |
host_bind`). Engine phase: actions run in order and stop at the first
engine failure; the plan's seq counts as decided either way. Answer `HostReportAck {accepted: true, serverState, pendingSeq}` (`pendingSeq` = the next deliverable plan, or
null: the box may poll at once). Core accepts a report older than the last one for its results only (state never goes back).

## 7. Core down
The box keeps the last applied state running, queues up to 500 reports locally (oldest dropped first, `queued` says how many
remain), applies nothing new without a fresh valid plan, and never takes a destructive action while Core is unreachable.

## 8. Provider `own_infra` (Core)
- Provider key stays `own_infra`; a workspace on a server has `infra_provider = own_infra`, `infra_destination_id = srv_…`. Only this
  key makes config entries carry `ownInfra: true` (the bridge then routes to exact `TB_OWN_INFRA_ORIGINS` entries, M1). The older
  self-registered own-infra form (`instances.register_own_infra`, no server) is unchanged.
- `DeployRefs` for a server: `destinationId = srv_…`, `environmentId = ws_…`, `serviceId = privateHost = <serviceName>` (single label),
  `volumeIds` = the volume names, `domain` / `keysDomain` = the two bridge hosts, `deploymentId = plan:<seq>`.
- Bridge hosts: `<label>.<zone>` and `<label>-keys.<zone>`, `label = "w" + lower-case(ws ULID)`, `zone` = Core config
  `TB_SERVER_ZONE` (= the box's configured workspace zone). DNS + certificates are the box's / Platform's job (S1-6), not Core's.
- Deploy is asynchronous: `deploy`/`update`/`remove` enqueue a plan; `observe` reads the server's last report (result for that seq,
  service state + health). `remove {deleteData: true}` is refused in S1 (stop + keep only).

## 9. Conformance rows (`HOST_CONFORMANCE`; probes: QA + host-agent leads)
H-1 bad signature refused · H-2 wrong server refused · H-3 replay (same seq) refused · H-4 expired refused · H-5 image not in
index refused · H-6 downgrade refused (one-step rollback allowed) · H-7 undeclared env name refused (+ secret-like value) ·
H-8 forbidden runtime settings refused · H-9 stop keeps the volume · H-10 TB_OWN_INFRA_ORIGINS matches the
running tb- services · H-11 firewall probe from an app network · H-12 container outside the allowlist stopped. Each row names its `HOST_POLICY` rule and its target
(`agent-unit`, `box-probe`, `both`); `given` / `expect` are the test text.

## 10. Decisions on the draft's open items (2026-10-22)
| Item | Decision | Why |
|---|---|---|
| JWS header | Plan: exactly `{alg, typ: tb-host-plan+jws, kid}`, `kid` = Portal key thumbprint, key from `portalKeySet` (active/pending). Assertion: `{alg, typ: tb-host-assert+jwt, kid}` | the existing rules (JoseHeader, §9.5); no new verifier code |
| Key set for the box | carried IN every plan (`portalKeySet`, required); `portal_keyset_url` of the draft dropped | one trust path, same as config/slice; nothing for Core to point elsewhere |
| Plan times | `iat`/`exp` epoch seconds (not ISO `issuedAt`/`expiresAt`), exp − iat ≤ 900, leeway 30 s | every other JWS in the spec |
| Longpoll | one plan per answer, `wait` default 50 s / max 60 s, 304 when none | reuses the `longpoll` transport (application/jose) of the bridge config pull |
| Report cap | 64 KiB body, ≤ 64 services, ≤ 64 results; heartbeat 30 s; offline after 90 s; queue 500 | |
| Assertion `aud` | `tb:portal` (draft: portal origin) | identical to K7; the URL is bound by `htu` anyway |
| Enrolment code | own field `enrolCode`, not in `env` | a `tbe_` value fails the secret-like check by design |
| `component` | new field (null = main image, else manifest service id) | the box must know which index image to compare |
| Downgrade | refused, except the one version the box ran right before (rollback) | keeps C213 health-gated rollback working; no index flag exists |
| Error codes | added `schema_invalid` (H-8), `index_unavailable`, `seq_out_of_range`, `identity_changed`, `manifest_mismatch` | the draft had no code for these refusals |
| Detach | `final: true` stop plan (re-issued until applied), then unpair; workspace infra cleared; instances removed with data kept | S1 = stop + keep data |
| Registry | servers live in the Provider Registry (still 15 registries) | a server is an own-infrastructure destination |
| Spec version | 0.1.58 | next after 0.1.57 |

### Portal GUI questions (2026-10-22)
| # | Question | Decision |
|---|---|---|
| 1 | `device.lookup` scope host | accepted: `agents: []` + `host: {publicKeyThumbprint, facts}` |
| 2 | `device.approve` scope host | accepted: `{userCode, ws}` (+ optional `label`); server + key pin + set_infrastructure own_infra in ONE consent |
| 3 | `servers.detach` | accepted: POST `{srv}` with Idempotency-Key (`idempotent: true`), returns the Server; repeat-safe |
| 4 | `servers.list` `ws` filter | added: optional query `ws` |
| 5 | workspace already has infrastructure | refuse, 409 conflict `details.reason = infrastructure_set` (no replace in S1) |
| 6 | DeviceScope / DeviceClientId / destinationId | accepted: scope `host`, client `tealbrick-host`, the workspace destination may be `srv_…` |
| 7 | rows + auth | `servers.*` rows ship here; the `host` class is never a browser op (RT9) |

### Further decisions (2026-10-22)
- `serviceRefs` defined exactly (§4): key = env name in this service; value = source `{serviceName, env}` in the same workspace
  stack, resolved on the box, never a secret from outside the box.
- `escape_attempt` code + `HostReport.escapes[]` + `Server.escapes` + rule `containEscapes` + row H-12.
- Bridge `TB_INTERNAL_HOST`: the box writes the hostname form (advertise only); no further contract change.

### Known gaps (follow-ups, not blocking S1a)
- The manifest validator / release signer should apply `HOST_PATTERNS.mountPath` and `healthPath` at publish time, so a published
  release is never undeployable on a server (`/.well-known/...`, `/usr/share/...`). Owner: SDK/manifest + Platform signer.
- Service-name collisions (`foo-bar` vs `foo` + companion `bar`, the 60-char cut) are refused, never taken over; the signer can
  refuse colliding product/service ids. Owner: Platform.
- The release index has no `revoked` / `minVersion` / rollback flag yet; the box's floor is the only downgrade guard. Owner: Platform.
