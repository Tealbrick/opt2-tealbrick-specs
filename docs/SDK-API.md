# SDK-API — manifest package, Miniapp SDK (server + client), app template

Status: v0.1, Lead · Specs, 2026-10-11. Types: `types/sdk.ts` (declarations only). Authority: PRD-V2 > DECISION-LOG > CORE.md > this file.

Scope: the public surface of three packages in `opt2-tealbrick-sdk` (REPOS.md): `@opt2-tealbrick/manifest` (contract primitives, the only owner of crypto/canonical code and of the decision functions), `@opt2-tealbrick/miniapp-sdk` (server runtime + React client), and `create-tealbrick-miniapp` (template). It defines what an app author writes (handlers by operation id), what the SDK derives from the manifest (routes, OpenAPI, status, standard ops), and how an app talks to its four sides: Portal (claim and slices, always via the bridge), the harness (operations, holds, receipts), other apps (companion calls via the bridge), and the person (launch sign-in, app shell). Wire formats of the bridge (claim, slice, keys, call) are owned by BRIDGE.md; credential claims by CREDENTIALS.md; manifest fields by MANIFEST.md + `manifest.schema.json`. This file only says how the SDK uses them. No grantless path uses a hook-style proof: bridge-only calls use the bridge-op proof (C16 B5).

## 1. Rules (normative)
1. The manifest is the only source. An app registers handlers by operation id; the SDK derives routes, input/output validation, OpenAPI, MCP-relevant metadata, status, standard ops and the generated kit. A hand-written route table, OpenAPI file, operations list, status route, or claim route beside the manifest is a conformance failure (D110).
2. Every primitive (JCS, digest, JWS sign/verify, key sets, ticket/grant/proof verification, `verifyGrant`/`gate`/`authorize`, vocabularies) lives in `@opt2-tealbrick/manifest` only. The SDK, bridge, Core and conformance import it. A second implementation anywhere is a CI failure (CORE §3).
3. One mechanism per concern inside the SDK: one store (SQLite on `TB_DATA_DIR`), one receipts table (holds are receipt rows), one migration runner, one idempotency mechanism, one person sign-in module, one claim path, one env name per setting, one backup format and one export format (§7.3). Apps do not re-implement any of them (D105–D114).
4. No governance modes in the SDK beyond CORE §7 (`free|bound`, held families, caps). Rules/Fleet attach only through manifest hooks served by `defineApp({ hooks })`. No standing grants (C8). No `$file`/binary inputs (C11).
5. Nothing forward-declared: every export listed here ships in P1 and has a conformance check (CONFORMANCE A1–A9). No release-tag comments in code.
6. No product id in SDK or manifest-package source (CONFORMANCE M5). Product ids reach code only as manifest data.

## 2. `@opt2-tealbrick/manifest` (pure, no network; synchronous except WebCrypto key/sign calls and the CI-only `validateAppFiles`; no runtime deps beyond a vetted Ed25519/SHA-256 implementation)
| Export | Signature (see `types/sdk.ts` §A) | Notes |
|---|---|---|
| `validateManifest(json)` | `→ { ok: true, manifest } \| { ok: false, errors[] }` | schema + MANIFEST cross-field rules; used by Core Manifest Store, SDK boot, bridge, conformance |
| `manifestDigest(manifest)` | `→ "sha256:<hex>"` | digest of JCS bytes |
| `validateCompanions(manifest, targets)` / `validateAppFiles(manifest, repoDir)` | `→ ManifestValidation` | MANIFEST §13; `validateAppFiles` (CI, CLI) is the only export that reads files |
| `canonicalize(value)` | `→ string` | RFC 8785; rejects NaN/Infinity/bigint/undefined |
| `digest(value)` | `→ "sha256:<hex>"` | of `canonicalize(value)` bytes |
| `withStandardOps(manifest)` | `→ OperationView[]` | manifest ops + the agent/person standard ops (§6); the one list bridge and SDK use |
| `generateKeyPair()`, `thumbprint(jwk)` | Ed25519; `kid` = RFC 7638 | key generation is the only randomness-using export |
| `signJws(typ, claims, key)` / `verifyJws(token, keySet, expect)` | compact JWS, `alg: EdDSA` | `expect` = `{ typ, aud, iss[], now, maxLifetimeS }`; foreign/missing `typ`/`aud` → refusal (no warn path) |
| `KeySet` helpers: `keySetFrom(jwks, issuer)` | | the trusted Portal set comes only from a root-signed key-set statement (CORE §4; `keySetAnnounce` removed in 0.1.26, C133) |
| `verifyGrant(token, ctx)` | `→ VerifiedGrant \| Refusal` | CORE §7; K10 `tb-grant+jwt` |
| `verifyCallProof(token, ctx, bind)` / `verifyHookProof(token, ctx, bind)` | `→ VerifiedCallProof \| Refusal` | `TB-Call` (`typ tb-call+jwt`, CREDENTIALS §10): `aud`, `call`, `gjti`, `op` / `hook`+`phase`, `in`, `ctx`, ≤ 60 s |
| `verifyBridgeOpProof(token, ctx, bind)` | `→ VerifiedCallProof \| Refusal` | third `tb-call+jwt` variant `CallProofBridgeOpClaims { call, bop: catalog \| resolve \| mark \| scope_summary, op?, in? }` (types/credentials.ts; bridge key, `aud` = own instance, ≤ 60 s) for the grantless bridge-only calls (§3.2, C16 B5) |
| `verifyTicket(token, ctx)` | `→ VerifiedTicket \| Refusal` | K11 `tb-ticket+jwt`; SDK accepts only `pur: launch` |
| `verifySlice(token, ctx)` / `verifyConfig(token, ctx)` | | K9 `tb-slice+jws` / `tb-config+jws` |
| `signInstanceAssertion(input)` | → compact JWS | instance assertion for header `TB-Assert` (`typ tb-instance-assert+jwt`, `htm`, `htu`, `bd`; CREDENTIALS §10) |
| `renderSkill(skill, vars)` | `→ string` | the ONE skill renderer (N6): fills `{{agent.*}}`, `{{workspace.name}}`, `{{settings.*}}`, `{{scope.*}}`; used by Core (bundle) and bridge (per agent) |
| `gate(input)` | `→ { decision: "pass" \| "refuse", reason }` | bridge only (CORE §7) |
| `authorize(input)` | `→ { decision: "run" \| "hold" \| "refuse", reason, holdFamily? }` | app SDK only (CORE §7); exact input in `types/sdk.ts` `AuthorizeInput` |
| Vocabularies | re-exported from `types/manifest.ts` (`CRUD_ACTIONS`, `EFFECTS`, `HOLD_FAMILIES`, `AGENT_MODES`, `STANDARD_OPERATIONS`, …) and `types/credentials.ts` (`TYP`, `PROOF_HEADER`); owned here: `RECEIPT_STATUSES`, `SDK_AUDIT_ACTIONS` | declared once; Core stores values, holds no literals |

`authorize()` order (CORE §7 + I1, restated so this file is checkable): (0) the latest slice marks the workspace, the instance or the calling agent paused → refuse `paused`; (1) `verifyGrant` again; (2) `op.crud ⊆ grant.crud ∩ access.crud` (when the op has a `scopeType`; v0.1.50 C283 A1: `op.crud ⊆ access.crud` when `access.authority` is `owner`, §7.2) → else refuse `scope_denied`; (3) `op.effect === "money"` or `op.holdFamily ∈ grant.held` → hold, unless `approval = "approved"` for this exact call (§4.3); (4) Free caps: for the op's effect, `usage[effect] ≥ grant.caps[effect].max` → hold `caps` (I14: `caps: { write?, outward?, destructive? }`, each `{ max, per: "hour" | "day" }`; the SDK counts this caller's runs of that effect over a sliding window of `per` — v0.1.31 (SDK-02): one cap slot per run, receipt or not, reserved in the same transaction as the decision BEFORE the handler, given back when the run fails or is refused, kept when it ran or its outcome is unknown; plus its approved, unconsumed holds of that effect; `money` has no cap, it is always held); (5) run. Pure: the SDK passes `now`, trust context, resolved access and counters in; nothing is read inside.

## 3. Server: `defineApp` and `startApp`
```ts
const app = defineApp({ manifest, handlers, hooks?, dynamic?, publicRoutes?, migrations, backup?, events?, auditActions? });
await startApp(app, process.env);
```
| Field | Required | Content |
|---|---|---|
| `manifest` | yes | parsed manifest JSON; `startApp` re-validates and refuses to boot on error |
| `handlers` | yes | `{ [opId]: Handler \| { run, scope?, redact?, holdView? } }`; exactly one per manifest operation (non-`dynamic`); extra or missing ids → boot error |
| `hooks` | iff manifest `hooks[]` | `{ [hookId]: HookHandler }` (before / context / after per CORE §8) |
| `dynamic` | iff an op has `dynamic` | `{ [opId]: { catalog(q, ctx), resolve(tool, ctx), call(tool, input, ctx), holdView?(tool, input, ctx) } }` (`holdView`: v0.1.35, §4.6) |
| `publicRoutes` | iff manifest `publicRoutes[]` | `{ [path]: PublicHandler }`; the app verifies state / provider signature itself |
| `migrations` | yes | directory path (§7.1) |
| `backup` | no | `{ beforeBackup?(), afterRestore?() }` quiesce hooks; what to back up comes from manifest `backups` |
| `events` | no | `{ agentAdded?(agent, ctx), agentRemoved?(agent, ctx), keysChanged?(names, ctx) }` |
| `auditActions` | no | typed literal list of the app's own audit actions (§7.4) |

`scope(input, caller)` returns the scope instance id the call targets (or `null` = "across instances": access check uses the caller's best access of that type, and the handler MUST filter results with `ctx.scope.readable()`). Ops with a `scopeType` and no `scope` function → boot error. `redact(input, output?)` returns the receipt `summary` (≤ 280 chars, no secrets; default = op title). `holdView(input)` returns what the owner sees on a hold (≤ 16 000 chars; longer → refuse `hold_view_too_large`, never truncated). v0.1.84 (C369): an op without `holdView` gets the default view of §4.8, and every view is bound to the approval by hash (§4.8 D2).

### 3.1 Handler context (`OpContext`)
| Member | Meaning |
|---|---|
| `caller` | `{ type: "agent" \| "app" \| "person", id, name, mode }` — agent/app from verified grant `sub` (+ name from the slice); person from the session principal. Never from a caller-set header |
| `grant` | `VerifiedGrant` (null for person calls) |
| `op` | the `OperationView` (manifest op or standard op) |
| `scope` | resolved access: `access` (this call), `readable()`, `writable()`, `can(type, id, crud)` |
| `callId`, `idempotencyKey` | from `TB-Call` / body field `idempotencyKey` (CORE §8) |
| `context` | open hook context JSON (namespaced keys from context hooks) |
| `receipt` | `summary(text)`, `meta(json)` — `meta` is free JSON ≤ 4 KB (e.g. `{ subjectKind: "as_me" }`) |
| `getKey(name)` | §8 |
| `callApp(product, op, input, opts?)` | §9 |
| `callServiceHelper(serviceId, path, body)` | §11 |
| `db` | the app's SQLite handle (app tables only; `tb_*` names are SDK-reserved) |
| `log` | `debug/info/warn/error(msg, fields?)`; fields whose key matches `/key|token|secret|password|authorization|cookie/i` and any value equal to a fetched key value are replaced by `[redacted]` |
| `signal` | abort on client disconnect / 30 s op timeout |

Handlers return output (validated against the manifest `output` schema) or throw `new TbError(code, message, httpStatus)`; the SDK maps it to the CORE §8 envelope.

### 3.2 Routes the SDK mounts (derived; apps add none under `/tb`)
| Route | Caller / auth | Purpose |
|---|---|---|
| `POST /tb/v1/ops/:op` | bridge: `Authorization: Bearer <grant>` + `TB-Call` | agent and app→app calls (agent-audience ops) |
| `POST /tb/v1/hooks/:hookId` | bridge: `TB-Call` (`phase`) | hook calls (no receipts, never trigger hooks) |
| `POST /tb/v1/bridge/catalog` | bridge: `TB-Call` bridge-op proof (`bop: catalog`, `op`; `verifyBridgeOpProof`) | body `BridgeOpCatalogBody { op, query?, limit? }` → `DynamicCatalogEntry[]` (≤ 256 for `list`; query for `search`) |
| `POST /tb/v1/bridge/resolve` | bridge-op proof (`bop: resolve`, `op`, `in`) | body `BridgeOpResolveBody { op, tool }` → `DynamicResolution` (bridge caches 5 min). Dynamic calls themselves arrive on `/tb/v1/ops/:op` with `DynamicCallInput {tool, arguments}` (types/manifest.ts) |
| `POST /tb/v1/bridge/mark` | bridge-op proof (`bop: mark`, `in`) | body `BridgeOpMarkBody { call, mark: "after_failed" }` → receipt status `after_failed` (CORE §8, BRIDGE §8.1 step 12) |
| `POST /tb/v1/bridge/scope-summary` | bridge-op proof (`bop: scope_summary`) | `{}` → `ScopeSummaryResult[]` `[{ agent, label ≤ 80, sources? }]` (bodies in types/bridge.ts; v0.1.65 `sources` = the agent's scope instances, C331 D8) |
| `GET /tb/v1/manifest` | private network, no auth | verbatim manifest (bridge verifies `manifestDigest`) |
| `GET /tb/v1/openapi.json` | private network, no auth | OpenAPI 3.1 generated in memory from the manifest |
| `GET /tb/v1/health` | private network, no auth | `{ status, sdk, version, manifestDigest, keys: [{name, present, source}] }` (§10) |
| `POST /a/<product>/tb/launch` | form POST of a K11 ticket | person sign-in (§5) |
| `GET /a/<product>/tb/v1/session` · `POST …/logout` | session cookie (+ CSRF on POST) | principal + CSRF token; sign-out |
| `POST /a/<product>/tb/v1/ops/:op` | session cookie + `TB-CSRF` | person-audience ops (manifest + standard) |
| `POST /tb/v1/person-op` | private network, K14 in `TB-Person-Op` (v0.1.64) | allow-listed person op relayed for a native owner session (§21) |
| `GET /a/<product>/<ui path>` | session cookie (launch page excepted) | the app UI (static build from `dist/ui`), manifest `ui.launchPath` / `configurePath` |
| `GET\|POST <publicRoute.path>` | none (app verifies `state` / provider signature) | manifest-declared public routes only; the bridge forwards `https://<bridge>/p/<product><path>` → `<internalUrl><path>` (BRIDGE §9.2) |

Request checks on `/tb/v1/ops/:op`, in order: call proof valid (`verifyCallProof`: key in slice `bridge.keys`; binds grant via `gjti`, op, input and context digests — CREDENTIALS §10, I2) → `verifyGrant` → op exists, audience `agent` → input schema → idempotency (§4.4) → `authorize()` (step 0 = slice pause, I1) → handler. A request without a valid proof (e.g. a direct call on the private network) → 401 `call_proof_invalid`. A slice older than 12 h → 503 `slice_stale` for ops (person UI stays up), matching the bridge rule (CORE §13 C9).

## 4. Holds and receipts (one table: `tb_receipts`)
### 4.1 Receipt shape (`Receipt` in `types/sdk.ts`)
| Field | Content |
|---|---|
| `id` | `hld_<ULID>` if the row was created by a hold (that id is the `holdId` and stays the receipt id), else `rcp_<ULID>` — one id per row, one table |
| `callId` | bridge `call_` id from `TB-Call` |
| `caller` | `{ type, id, name }` |
| `op`, `effect`, `holdFamily` | from the op (dynamic ops: from `resolve`) |
| `status` | `run \| held \| approved \| denied \| refused \| failed \| after_failed` |
| `inputDigest` | `sha256:` of JCS input — raw input is never stored in the receipt. v0.1.84 (C369 D4): a HOLD row also keeps the redacted input SEALED for the owner's `tb.hold_details` only, wiped 7 days after its terminal status (§4.9); it is never part of a receipt, a list, a log or an approval match |
| `summary` | redacted text from `redact` (≤ 280) |
| `holdReason` | v0.1.84 (C369 D3): hold rows only — the hook verdict reason (e.g. the Rules rule text) or the SDK hold reason code, ≤ 280; the same value `tb.holds_pending` returns as `reason` (`tb.holds_list` and `tb.receipts_list` rows) |
| `meta` | free JSON ≤ 4 KB (e.g. `subjectKind: as_me \| as_itself`, `tool`, `account` label). v0.1.77 (C367): `callerContext` (§18.6) |
| `idempotencyKey` | nullable; remembered 24 h |
| `view` | hold view text; kept only while `held`/`approved`, deleted at a terminal status. v0.1.84: the app's `holdView`, else the default view (§4.8); `meta.viewSha256` binds it for every held op (§4.8 D2) |
| `createdAt`, `decidedAt`, `expiresAt` | epoch ms; `expiresAt` for holds |
| `decidedBy` | `per_<id>` (owner) or `"expiry"`; null otherwise |

One row per agent/app call that reaches `authorize()` for ops with `receipt: true` (MANIFEST) and for every hold/refusal regardless of the flag. Retention: 90 days, then deleted (counters only look back ≤ 24 h).

### 4.2 Status transitions
`authorize → run` → handler ok → `run`; handler throws → `failed`. `authorize → refuse` → `refused`. `authorize → hold` → `held` (pending TTL 15 min default, max 24 h). Owner decides → `approved` or `denied`; pending TTL passes → `denied` with `decidedBy: "expiry"`. Bridge reports an after-hook failure → `after_failed` (the action is not undone).

### 4.3 Approval without stored input (C8: one approval per call, no "always allow")
The held response is `202 { status: "held", holdId, expiresAt }` (BRIDGE §8.1 step 11). The agent polls `tb.hold_status`. After approval the agent repeats the SAME call (same op, same input, same idempotency key if any) within 15 min of the decision; the SDK finds the `approved` row for `(caller, op, inputDigest)`, passes `approval: "approved"` to `authorize()`, runs, and updates that row to `run`/`failed`. A different input never matches. An approved row is consumed once. While the slice shows a pause the retry is refused by `authorize()` step 0; the approval is kept until it expires. This keeps raw input out of storage. v0.1.84 (C369): the approval is also bound to the view hash (§4.8 D2); the sealed, redacted input a hold keeps for the owner's details (§4.9) is never read by the approval match.

### 4.4 Idempotency (manifest `operations[].idempotency`)
Key: 8–128 chars (BRIDGE §7.2), carried as body field `idempotencyKey` on the bridge→app op call (CORE §8; the agent passes MCP `_meta["tealbrick/idempotencyKey"]`) and as `CallEnvelope.idempotencyKey` on `callApp` (BRIDGE §8.3). Key scope = `(caller id, op, key)`. `required` and missing → 400 `idempotency_key_required`. Same key + same `inputDigest` → the stored result (output sealed with `TB_KEK`, kept 24 h, then purged with the key). Same key + different input → 409 `idempotency_conflict`. A held call keeps its key; the post-approval retry with the same key resolves to the hold (§4.3). v0.1.31 (SDK-01): the key is RESERVED before `authorize()` and the handler (one INSERT wins in `tb_idempotency`, status `pending`); it ends with the handler itself, not with the answer (a run that outlives the 30 s timeout keeps it). A concurrent duplicate with the same input waits for the first run and answers its stored result or hold; a failed or refused first run frees the key (the duplicate then runs, like a retry); still running after the wait → 409 `idempotency_in_flight` (retry later). A key left `pending` by a process that stopped mid-run becomes `unknown` at the next boot → 409 `idempotency_outcome_unknown` until the key expires (24 h): an unknown outcome is never run again (SDK-07); the caller retries with a new key on purpose. Person calls (§14) use the same reservation.

### 4.6 Hold view of a dynamic tool call (v0.1.35, SDK-HV-1; miniapp-sdk 0.1.23)
A dynamic op has no `handlers[op]`, so it cannot use the synchronous `holdView(input)`. `DynamicHandlers.holdView?(tool, args, ctx): Promise<DynamicHoldView | null>` (`DynamicHoldView = { summary?, view }`) gives the owner the content the call would act on (for example the recipients, subject and text of the mail draft a send tool delivers). The app may READ upstream data with the same account the call would use; it must never write, send or render (plain text only).
- **When.** The SDK awaits it when `authorize()` answers `hold` for a call of a dynamic op, with a time budget of 5 s (`ctx.signal` aborts at the budget; `ctx.receipt` is inert). Not called for runs or refusals.
- **Result.** `{view, summary?}` → the hold `view` (≤ 16 000) and `summary` (clamped to 280). `null` → the default view and the default summary (op title). v0.1.84 (C369 D1): the default view of a dynamic call is §4.8 over the tool ARGUMENTS with the catalog entry's titles (it was op title + JSON of the input).
- **Failure never blocks the hold and never approves it.** A throw, a timeout, a malformed answer or a view over 16 000 chars → the default view plus the line `Tealbrick could not read the content of this request.` (no `hold_view_too_large` refusal for this path); the hold is created as usual.
- **Approval bound to what the owner saw.** The hold `meta` gets `viewSha256` (`sha256:` hex of the view text). When the agent repeats the approved call (§4.3) and the app has `holdView`, the SDK computes the view again (same budget) BEFORE `authorize()`; it uses the approval only if the new view hash equals `viewSha256`. Otherwise the approval does not carry over: the call is decided as if no approval existed (normally a NEW hold that shows the new view), and the old approval stays unused until it expires. **Fail closed (C202, miniapp-sdk 0.1.24):** when the content cannot be read at retry time (fallback view), the approval is never used — not even when the approved hold also showed the fallback view; the call is held again with the "could not read" line, so an agent that can make the read fail (bad id, revoked scope, slow provider) never reuses a blind approval. Unreadable content therefore never runs on an approval (0.1.23 still ran it when both views were the fallback). An approval without `viewSha256` (hold made by an older SDK) is not used for an app with `holdView`. v0.1.84 (C369 D2): the same binding holds for EVERY held op, static or dynamic, with or without `holdView` (§4.8).
- **Limits unchanged.** Idempotency reservation (§4.4), caps (the hold path reserves no cap slot), receipts and `tb.holds_pending` (summary only, never the view) behave as for any hold. The view is shown only on the owner's hold page (`tb.holds_list`).

### 4.5 Hold decide API (person only)
`tb.holds_decide({ holdId, decision: "approve" | "deny", note? })` is person-audience only; an agent or app caller can never reach it (it is not on `/tb/v1/ops`). Owners decide in the app's own UI (`<AppShell>` holds page) opened by a `pur: launch` ticket from the Portal canvas (K1 browser session). TBD and the CLI never obtain any K11 ticket (K3 cannot, C16 B4): TBD opens the Portal launch for the hold in the system browser, and shows only hold counts (`pendingHolds`, §9). There is no Portal waiting view and no other approval channel in opt2, except (v0.1.64, C326) the person-op relay for allow-listed ops of native owner sessions (§21); in v0.1.64 `tb.holds_decide` is not on its list.

### 4.7 Hold status for an app caller (v0.1.77, C367 P3; cap `app_hold_status`)
- **Who.** `tb.hold_status` stays as in §6 for agents. An app caller (`caller.type === "app"`) reaches it on the companion path. Its companion grant must list it (MANIFEST M-CP-3), and the bridge must declare `app_hold_status` (BRIDGE §8.3). The SDK does not check the cap; without it the bridge simply does not route the op.
- **Which holds.** For an app caller the op answers only for a hold whose receipt has `caller.type = "app"` AND `caller.id` = the caller's verified instance id (§4.1). Any other `holdId` answers `404 hold_not_found` (v0.1.78 erratum: 0.1.77 said `not_found`). The envelope is exactly the same as for an unknown id. There is no existence oracle. The op never shows a hold of another caller or of an agent.
- **Unknown id (QA-SPEC58-3; all callers; v0.1.78 erratum, Coordinator C367).** `tb.hold_status` answers the EXISTING code `hold_not_found` (404) with the SDK's existing fixed message `no such hold for this caller`, for an unknown `holdId` and for a hold the caller does not own, for agent and app callers alike. No new code: agents and harnesses may already match `hold_not_found`. (0.1.77 said `404 not_found` with `No such hold.`; that text is withdrawn.) The message never repeats the `holdId`. The SDK runs ONE lookup keyed by `(holdId, caller)`, so both cases take the same path.
- **Target SDK gate (PK-D6).** The ownership rule lives in the target's SDK. So the bridge routes `tb.hold_status` for an app caller only to a target whose reported `sdkVersion` is at least the first miniapp-sdk that implements this section (BRIDGE §8.3, `APP_HOLD_STATUS_MIN_SDK`). An older target is never asked.
- **Output.** Unchanged: the same `tb.hold_status` output as for agents, with `family` and `reason` (§18, v0.1.13 clarifications). No receipt is written.
- **After `approved`.** The app repeats the SAME call (same op, same input, same idempotency key) within the existing 15-minute window (§4.3). It runs exactly once. After `denied` or `expired` the repeat does not run. After the repeat ran, `tb.hold_status` answers the receipt status `run` (v0.1.78 erratum: 0.1.77 said `consumed`, which is not a `RECEIPT_STATUSES` value). The approval match stays `(caller, op, inputDigest)`; the caller context is not part of it (§18.6 rule 5).
- **No event.** App callers still receive no `tb.hold.decided` event (MANIFEST §16.3). They poll `ctx.callApp(product, "tb.hold_status", { holdId })`.
- **Local check unchanged.** `callApp` still throws `companion_undeclared` for an op that is not in the grant's `wf` (§9).

### 4.8 Default hold view and view binding (v0.1.84, C369 D1, D2, D6; miniapp-sdk 0.1.42; spec 0.1.84 is a reservation)
An op that has no `holdView` (static), and a dynamic call whose app has no `holdView` or whose `holdView` answers `null`, gets the DEFAULT view below. It replaces "op title + JSON of the input". The rules are exact: two SDKs give the same bytes for the same title, input and schema, because the approval is bound to the hash of this text (D2). Every row of `examples/hold-view.cases.json` (≥ 25) must give exactly its `view` and `summary`.
- **Inputs.** `title` = line 1; `input` = a JSON value; `schema` = a JSON Schema object or null.
  - Static op: `title` = the op `title`, `input` = the op input, `schema` = the op's `input` schema.
  - Dynamic op: `input` = the call's tool `arguments`. The SDK asks the app's `catalog({ query: <base>, limit: 20 })` once, within 2 s, where `<base>` = `dynamicVariantBase(tool)` or else `tool`. It uses the entry whose `name` equals `<base>`. Found: `title` = `<op title>: <entry title> (<tool>)` and `schema` = the entry's `inputSchema`. Not found, a throw or the 2 s budget: `title` = `<op title>: <tool>` and `schema` = null. A failed lookup is logged with a code only. It changes the text, so an approval made with the other text is not used (fail closed, D2).
- **Units.** "Code point" = a Unicode scalar value. Lengths are code points, except two: the view cap counts UTF-16 code units (`HOLD_VIEW_MAX_CHARS` = 16 000, the cap of every view, §4.1), and the summary cap counts UTF-16 code units (280, like every receipt summary).
- **Text helpers.**
  - `clean(s)`: (1) every CR LF pair, then every remaining CR, becomes LF; (2) every TAB becomes one space; (3) remove every code point in U+0000–U+001F except LF, U+007F–U+009F, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF, and every lone surrogate. Nothing else changes (no HTML handling, no space folding: the view is shown as plain text, never rendered).
  - `clip(s, n)`: `s` when it has at most `n` code points, else its first `n − 1` code points + `…` (U+2026).
  - `oneLine(s, n)` = `clip(clean(s)` with every LF replaced by one space`, n)`.
  - `humanize(k)`: (1) insert one space between an ASCII lower-case letter or digit and a following ASCII upper-case letter; (2) replace each run of `_`, `-`, `.` and space by one space; (3) remove spaces at both ends; (4) lower-case ASCII `A`–`Z` (no other case mapping); (5) upper-case the first character when it is ASCII `a`–`z`. An empty result is `(unnamed)`. `to_address` and `toAddress` → `To address`.
  - `group(n)`: the decimal digits of `n` with `,` between groups of three from the right (`59000` → `59,000`). `count(n, noun)` = `group(n)` + space + noun, with `s` added unless `n` = 1.
  - `isSecretKey(k)`: split `humanize(` `clean(k)` with LF → space `)` at spaces, lower-case ASCII; secret when a word is in `HOLD_SECRET_KEY_WORDS` (`key`, `apikey`, `token`, `secret`, `password`, `passwd`, `passphrase`, `authorization`, `cookie`, `credential`, `credentials`). `api_key`, `accessToken` and `Authorization` are secret; `keyword` and `monkey` are not.
- **Labels.** A member key `k` with sub-schema `S` gets the segment `oneLine(S.title, 80)` when `S.title` is a string and `oneLine(S.title, 80)` is not blank (blank = empty or only U+0020 spaces); else `clip(humanize(` `clean(k)` with LF → space `), 80)`. `S` = `schema.properties[k]` when `schema` is an object whose `properties` is an object that has `k` as its own member and that member is an object; else null. A list item has the segment `#i` (`i` from 1) and the sub-schema `schema.items` when that is an object, else null. No `$ref`, `anyOf`, `oneOf` or `prefixItems` is followed. A field's label = its path segments joined by ` › ` (space, U+203A, space). Depth = the number of segments.
- **Document.** Line 1 = `oneLine(title, 200)`. Then: an object input → its members in JCS order (keys sorted by UTF-16 code units: `"10"` before `"9"`, `Z` before `z`), each a field of depth 1; an object without members → the one line `No input.`; any other input → one field labelled `Input`. Lines are joined by LF; no LF at the end.
- **Fields** (label `L`, depth `d`):
  1. `null` → `L: (empty)`; `true` → `L: yes`; `false` → `L: no`; a number → `L: <its JCS form>` (`1e21` → `1e+21`, `-0` → `0`).
  2. A string: `t = clean(s)`. When `t` has an LF or more than 200 code points, it is a BLOCK (rule 6). Else `L: t`, or `L: (empty)` when `t` is empty.
  3. A list: empty → `L: (none)`. FLAT (every item is a scalar, and no string item is a block) → `L: ` + the first 10 items in their scalar form (rules 1–2) joined by `, `, then ` and <group(N)> more` when `N` = length − 10 > 0. Not flat and `d` ≥ 3 → `L: (list of <count(length, "item")>, not shown)`. Else the first 10 items as fields `L › #i`, then `L: and <group(N)> more` when more.
  4. An object: no members → `L: (none)`. `d` ≥ 3 → `L: (<count(members, "field")>, not shown)`. Else each member in JCS order as a field `L › <segment>`.
  5. Values are shown as given: an `enum` value is its own text, a time in the input is its own text (D6: the SDK formats no time in this view; text the SDK formats in a hash-bound view is UTC).
  6. A block: header `L (plain text):` when `t` has at most 1 000 code points, else `L (plain text, first 1,000 characters; <group(length − 1000)> more not shown):`. Then the first 1 000 code points of `t`, split at LF, each line prefixed by two spaces.
- **Cap.** When the text is longer than 16 000 UTF-16 code units, keep the largest number `k` ≥ 1 of first lines such that those lines + LF + `(<count(total − k, "more line")> not shown)` fit in 16 000; that is the view.
- **Default summary** (`renderHoldView().summary`, D1/D5): line 1, then the first 2 `L: value` lines from rules 1–4, joined by ` · ` (space, U+00B7, space). Left out: block headers and their lines, the `and N more` and `not shown` lines, and every field with a secret key in its path. Longer than 280 UTF-16 code units → the longest prefix of whole code points with at most 279 units, then `…`. **The SDK does not use it as the receipt `summary` in 0.1.84:** `tb.holds_pending` summaries carry no input (C90), so the receipt summary stays the dynamic `holdView` summary, else `redact`, else the op title. Apps and the Inbox may compute it with the SDK's exported renderer; making it the receipt summary needs a Coordinator decision on C90 vs C369 D5.
- **D2: every view is bound.** The SDK writes `meta.viewSha256` (`sha256:` hex of the UTF-8 view) on EVERY hold: the default view, a static `holdView` and a dynamic `holdView`. On the agent's or app's repeat of an approved call (§4.3), the SDK computes the view again BEFORE `authorize()` and uses the approval only when the new view is readable and hashes to `viewSha256` (the §4.6 rule, now for every op). Otherwise the call is decided as if no approval existed (normally a NEW hold that shows the new view); the old approval stays unused until it expires. A static `holdView` that throws on the repeat counts as unreadable (approval not used). An approval without `viewSha256` (a hold made by an older SDK) is never used. A scheduled fire (§19) applies the same check; when the job's own approved hold no longer matches, the job ends `refused` with reason `hold_view_changed`. Consequence: a static view that reads app state voids its approval when that state changes between hold and repeat ("you approved what you saw", C202); an app keeps such a view stable for unchanged state.
- **D6: times.** Times the SDK writes into a hash-bound view are UTC. `tb.hold_details` gives `createdAt`, `expiresAt`, `decidedAt` and `inputWipeAt` as UTC ISO 8601. A UI shows them in the viewer's browser zone, and UTC in the details dialog.

### 4.9 Hold details for the owner: `tb.hold_details` and the kept input (v0.1.84, C369 D4; miniapp-sdk 0.1.42)
- **Kept input.** When the SDK creates a hold, it keeps the call's input with it: the input with every member under a secret key (`isSecretKey`, §4.8, at every depth) replaced by `"[redacted]"`, as JCS text. More than `HOLD_INPUT_MAX_BYTES` (60 000) UTF-8 bytes → nothing is kept (`too_large`); the hold is created as usual. A dynamic op keeps its whole op input (`{ tool, arguments }`). There is no per-op field rule today: `redact` builds the summary text only.
- **Sealed.** The text is sealed with TB_KEK like the app's other secrets (CREDENTIALS §9; purpose `hold-input`, id = the hold id) and resealed after a KEK rotation. Backups carry only the sealed blob (the KEK is never archived, §7.3). The export (`tb.export`) leaves the column out. It is never in a receipt, `tb.holds_list`, `tb.receipts_list`, `tb.holds_pending`, `tb.hold_status`, a hook payload, an event or a log line.
- **Seven days after the terminal status, then wiped** (Coordinator 2026-10-27). Terminal = `run`, `failed`, `denied` (by the owner or by expiry), `refused`, `after_failed`, and an approval whose window lapsed (from its `expiresAt`). From that moment the sealed input stays exactly `HOLD_INPUT_KEEP_DAYS` (7) days, then the SDK's sweep wipes it. `tb.hold_details` never shows it after that moment, even before the sweep ran. The receipt row itself keeps its 90-day retention (§4.1).
- **`tb.hold_details { holdId }`** (standard op, audience person, crud read, effect read, idempotency none, receipt false; `HOLD_DETAILS_OP`). Owner only: the verified owner session of THIS instance (`principal.type = person`, `principal.instance` = own instance, `principal.ws` = own workspace). Any other principal → 403 `session_required` (the `tb.holds_decide` rule). Agent and app callers never reach it: it is not on `/tb/v1/ops`, which answers 403 `audience_not_agent`. It is not on the person-op relay (§21, `PERSON_OP_RELAY.allow`). An unknown id, or a receipt that is not a hold → 404 `hold_not_found`. It writes no receipt.
- **Output** (`HoldDetails`, types/sdk.ts): `holdId`, `receiptId` (= `holdId`), `status`, `op`, `opTitle`, `tool?` (dynamic), `family` (`null` → `policy`), `reason?` (= `Receipt.holdReason`), `heldBy?`, `caller {type, id, name, product?}`, `callId`, `inputDigest`, `input` (JSON or null), `inputState` (`HOLD_INPUT_STATES`: `kept`, `too_large`, `wiped`, `unreadable`, `none`), `inputWipeAt`, `createdAt`, `expiresAt`, `decidedAt`, `viewSha256` (null for an older hold). `input` is non-null only for `kept`.
- **Storage.** The spec fixes the behaviour, not the storage. miniapp-sdk 0.1.42 adds three nullable columns in one migration (`sdk_receipt_hold_input`; precedent `sdk_receipt_caller_product`).
- **Later.** Connect's own `hold_details` table (24 h, keyed by `viewSha256`) moves to this op later; its extra fields (upstream, method, path) need an optional `extra` object that a later version adds.

## 5. Person sign-in (one module: `personAuth`)
| Item | Rule |
|---|---|
| Launch redeemer | `POST /a/<product>/tb/launch` form field `ticket`. `verifyTicket`: `typ tb-ticket+jwt`, `pur: launch`, `aud = tb:ins:<own id>`, issuer in trust set (Portal keys, or the standalone issuer named by a Portal-signed slice, or the instance key in app-alone mode), `exp`, `jti` unused (stored in `tb_used_jti` until `exp`). Redirect 303 to the ticket's path claim if it is under `/a/<product>/`, else `ui.launchPath`. |
| Session cookie | ONE cookie `tb_session` = 32 random bytes base64url; DB stores SHA-256 only; `Path=/a/<product>/; HttpOnly; Secure; SameSite=Lax`; absolute lifetime 8 h (CREDENTIALS §12); invalid when created before the slice's `personNbf`; deleted by logout. |
| CSRF | ONE header `TB-CSRF` = per-session random token returned by `GET …/tb/v1/session`; required (with `Origin` = request host) on every non-GET under `/a/<product>/`. |
| Principal | ONE shape `PersonPrincipal { type: "person", id: "per_…", ws, instance, iss, sessionExpiresAt }`; only the workspace owner (ticket `sub`) can hold it in opt2. |
| Errors | `ticket_invalid`, `ticket_used`, `session_required`, `csrf_invalid` (CORE §8 envelope; HTML pages show the same codes). |
| App-alone mode | the same module; the app mints the ticket itself (§12). |

## 6. Standard operations every app gets (defined once in `STANDARD_OPERATIONS`; `tb_` prefix reserved by the manifest schema)
| Op id | Audience | CRUD / effect | Input → output |
|---|---|---|---|
| `tb.hold_status` | agent | read / read | `{ holdId }` → `{ status, decidedAt?, expiresAt }` — caller's own holds only (MCP tool `<product>__tb_hold_status`); v0.1.77: an app caller too, §4.7 |
| (bridge op `scope_summary`, not a standard operation) | none — bridge op (not an audience, N1) | read / read | `POST /tb/v1/bridge/scope-summary` (bridge-op proof) → `[{ agent, label ≤ 80 }]`; the bridge calls it when `AppStatus.scopesRev` changes (BRIDGE §10.3); labels only, no third-party identifiers (CORE §13) |
| `tb.holds_list` | person | read / read | `{ status?, cursor? }` → holds with `view` |
| `tb.holds_decide` | person | update / write | §4.5 |
| `tb.hold_details` | person | read / read | v0.1.84 (C369 D4): `{ holdId }` → `HoldDetails` — owner only, the input kept with the hold (redacted, sealed at rest, wiped 7 days after the terminal status); §4.9 |
| `tb.receipts_list` | person | read / read | `{ caller?, op?, status?, cursor? }` → receipts |
| `tb.agents_list` | person | read / read | `{}` → slice agents with their scope access |
| `tb.scopes_set` | person | update / write | `{ agent, type, id, access \| null, acceptOffer? }` → updated access (audited; v0.1.52 `acceptOffer: {adds}` accepts an offer, §7.2) |
| `tb.keys_status` | person | read / read | `{}` → `[{ name, required, present, source }]` |
| `tb.key_set` / `tb.key_delete` | person | update / write · delete / write | `{ name, value }` / `{ name }` — app-own keys only; the value is never returned or logged |
| `tb.export` | person | read / read | `{}` → writes and streams a `tb-export-<timestamp>.tar.gz` (§7.3) |

`tb.hold_status` is the only agent-audience standard op (MCP tool `<product>__tb_hold_status`, BRIDGE §7.2); it needs only a valid grant from the caller (no CRUD check, I4), returns only the caller's own holds and writes no receipt. v0.1.77 (C367): an app caller may use it too (§4.7). Person ops are reachable only through the session routes (§3.2). Audiences are `agent | person` only (`OPERATION_AUDIENCES`, N1); the scope summary is not a standard operation: it is reachable only as the bridge op above. `STANDARD_OPERATIONS` (types/manifest.ts, the one declaration; `StandardOpId` in types/sdk.ts is derived from it) holds exactly these 12 ids: `tb.hold_status`, `tb.holds_list`, `tb.holds_decide`, `tb.receipts_list`, `tb.agents_list`, `tb.scopes_set`, `tb.keys_status`, `tb.key_set`, `tb.key_delete`, `tb.export`, `tb.holds_pending` (v0.1.13, G4, agent) and `tb.hold_details` (v0.1.84, C369 D4, person). Manifest op ids can never collide (`snakeId` forbids `tb_` and dots).

## 7. Data plumbing
### 7.1 Store and migrations (one runner, forward-only)
- Store: SQLite (`node:sqlite`) at `TB_DATA_DIR/app.db`, WAL mode, one process. SDK tables (`tb_receipts`, `tb_scopes`, `tb_sessions`, `tb_used_jti`, `tb_keys`, `tb_audit`, `tb_migrations`) migrate first under the SDK's own numbered set.
- App migrations: `migrations/NNNN_<name>.sql` or `NNNN_<name>.ts` (`export function up(db)`), 4-digit, gap-free from `0001`, each in one transaction; recorded as `(scope: "app", version, name, sha256, appliedAt)`. An applied file whose sha256 changed, a missing number, or a down migration → boot fails `migration_invalid`. One baseline per app (no imported history).

### 7.2 Scope store (types and access levels from manifest `scopes[]`)
- Rows `(agent, type, instanceId, access)`; instances are app data (`ctx.scope.instances.create(type, id, label)`).
- v0.1.31 (SDK-05, fail closed): an agent caller that is not in the current slice `agents[]` is refused 403 `agent_unknown` on every agent route (standard ops included): no agent record, no scope defaults, nothing runs, and the SDK asks the bridge for a newer slice at once. Revocation of a removed agent therefore never depends on its grant jti being listed in `revoked`. `ctx.paused(agent)` answers `agent: true` for an agent outside the slice. App (companion) callers keep first sight on their first call.
- First sight of an agent edge (agent appears in the slice `agents[]`, or first call — whichever is first): SDK calls `events.agentAdded` (the app creates per-agent instances, e.g. an "own" area), then applies manifest `defaultGrants` (`own` → the agent's own instance, `shared` → instances the app marked shared, `all` → every instance of the type). Applied once per (agent, type); later owner edits win.
- Lookups: `access(agent, type, id)`, `best(agent, type)`, `list(agent)`; `summary(agent)` renders `summaryTemplate` (≤ 80 chars) for the `scope_summary` bridge op.
- v0.1.65 (C331 D5b/D8): `summary(agent)` adds the type's `summaryEmpty` text for a type the agent has no row of (when the manifest declares it), joined like the other parts; `sources(agent)` returns the agent's rows as `ScopeSourceItem {type, id, label, access}` (`id` = the app's own scope instance id, never a provider id; label = the scope instance label with `\p{Cc}` and `\p{Cf}` characters removed, then clamped to 60 chars; ordered by type, then label; at most 20). The default `scope_summary` answer carries `sources` for every slice agent. Display only.
- Agent removed from the slice: rows are kept (re-adding restores them); calls are refused anyway without a grant.
- v0.1.50 (C283 A1, Martin C277): **the app's own access is primary; the Portal agent→app grant is the fallback.** A row the
  OWNER wrote through `tb.scopes_set` (person principal; an app's own owner page, e.g. Connect's account assignment, writes
  access through that op) after the app runs an SDK with this rule carries `authority = "owner"`; for a scoped op its
  access applies even above the Portal grant's `crud` (effective crud = the row's crud; a narrower owner row still narrows).
  EVERY other write path sets `bounded`, also when it overwrites an owner row: defaults, `ctx.scopeGrants`,
  `ctx.scopeSelfRevoke`. An op spanning instances (best access) is `owner` only when every row involved is. Every other row — manifest `defaultGrants`, `app` rows (`ctx.scopeGrants`), and every
  row written before the change — is `authority = "bounded"`: effective `crud = grant.crud ∩ row.crud` as before. Ops
  without `scopeType` keep `op.crud ⊆ grant.crud`. Grant validity (pause, revoke, expiry, workflow binding `wf`), holds,
  caps and `money` stay Portal-grant rules: an owner row never revives a paused or revoked agent and never skips a hold.
  An agent op and an app (companion) call never write an owner row (refused); `ctx.scopeSelfRevoke` only narrows. Migration:
  forward-only SDK schema 8 migration `sdk_scope_authority` adds `authority text NOT NULL DEFAULT 'bounded'`; the app's
  owner UI may OFFER "make my existing settings primary" per row = the owner re-saves it with `tb.scopes_set`, which sets
  `owner` even when the access level is unchanged; never automatically. Every scoped receipt records `admittedBy`
  (`app_owner_row | portal_grant`). Dynamic ops: the bridge sends `agent` in the catalog body; the SDK marks entries an owner
  row admits (`admitted: "owner"`), and the bridge lists them even when `crud ⊄ grant.crud`; static scoped ops: the
  `scope_summary` answer names them per agent (`admittedOps`). Display only; the SDK authorizes each call. The bridge
  `gate()` skips `op.crud ⊆ grant.crud` for ops WITH a `scopeType` (the SDK enforces); unscoped ops keep it.
- v0.1.52 (C283b/C283c): **an owner row keeps the CRUD it was set with.** `tb.scopes_set` by the owner stores a crud snapshot
  = the level's crud in the manifest that runs at write time (SDK schema 10 `sdk_scope_crud_snapshot`; 9 is `sdk_receipt_admitted_by`: `crud_snapshot` text,
  JSON array, NULL on bounded rows). Effective crud of an owner row (`rowCrud`) = snapshot ∩ the level's crud now: a narrowed
  level applies at once; a widened level does NOT apply. NULL, unparsable or non-array snapshot on an owner row → `[]` (fail
  closed); a level removed from the manifest → `[]`. EVERY reader of a row's crud uses `rowCrud`: `resolve` (one instance and
  best access), `bestOf`/`rank`, `ownerAdmits`, `ctx.scope` `access.crud`/`readable`/`writable`/`can`, the `scope_summary`
  `admittedOps`, the dynamic catalog `admitted` mark, `ScopeGrantRow.crud`. **Offer:** a row whose level now grants more lists
  `offer.adds` to the owner. **Accept** = `tb.scopes_set` with the same level and `acceptOffer: {adds}` equal to the current
  `offer.adds` (compared as SETS) → new snapshot, audit `scope.offer_accepted` (adds); a different set → 409 `offer_changed`;
  with no offer only `adds: []` is accepted (a no-op re-set), anything else → 409 `offer_changed`; `acceptOffer` together with a
  different level or `access: null` → 400 `input_invalid`; a plain re-set of the same level without `acceptOffer` keeps the
  snapshot (does NOT accept). Setting a DIFFERENT level stores that level's
  crud now (the owner chose it). No agent, app, companion or `ctx.scopeGrants` path accepts (they write bounded rows).
  Known limit (C283b (4)): the SDK cannot prove that a person clicked; an app's owner UI MUST show `adds` and send
  `acceptOffer` only on the owner's click (`useScopes().acceptOffer`). **Backfill:** ONCE, inside the schema-10 migration (same transaction): each owner row gets the snapshot of its level in
  the manifest that runs the migration, audited (`scope.snapshot_backfill`, level + crud). After that a NULL snapshot on an owner
  row means `[]` (corruption or a bug never widens). An E3 restore to schema 9 or lower re-runs migration 10 on the retried update (the
  same rule); a rollback to an older SDK without a restore is refused `sdk_schema_newer`. A widening shipped in the SAME update
  as the first 0.1.36 migration is baked in (no older record exists); release policy (Coordinator C283c): apps go from SDK ≤ 0.1.34 straight to 0.1.36.
  Bounded rows: unchanged.

### 7.3 Backups, restore, export
- Runner: on manifest `backups.schedule` (cron, UTC), keep `backups.retain` archives in `TB_BACKUP_DIR`. v0.1.1 (C28): Railway mounts ONE volume per service, so the deploy recipe mounts one volume at the `data` volume's mountPath and sets `TB_BACKUP_DIR=<data mountPath>/backup` (a subdirectory); manifests keep declaring both volumes and Core merges them. Off-volume copies come from the provider's volume backup.
- Archive (MANIFEST §11) = `TB_BACKUP_DIR/tb-backup-<UTC timestamp>.tar.gz` containing `meta.json` = `{ format: "tealbrick.backup/1", product, version, manifestDigest, instance, sdk, createdAt, parts: [{ name, file, sha256, bytes }] }` and the parts: `app.db` (SQLite `VACUUM INTO`: app tables, receipts, holds, idempotency keys), each manifest `backups.files[]` entry under `files/`, and `services/<id>.<extension>` per deployed service with `backup` — the runner calls that service's `tb-exec` (§11), which runs `backup.dump` and streams stdout over the private network.
- Export (`tb.export`, MANIFEST §11) = `tb-export-<timestamp>.tar.gz`: `meta.json` (`format: "tealbrick.export/1"`) + one JSONL file per app table + `receipts.jsonl` + `audit.jsonl`; written to the backup volume and streamed to the person. It is the portable, human-readable copy; `tb_keys`, `tb_sessions` and `tb_used_jti` are never exported. Restore uses backup archives only.
- Restore: set `TB_RESTORE_FROM=<archive file name>` and redeploy. At boot, before migrations, the SDK verifies every part's sha256, restores `app.db`, files, and each service through `tb-exec` (`backup.restore` argv, dump on stdin), calls `backup.afterRestore`, records the id in `tb_audit`, and ignores the variable on later boots. A failed part → boot fails `restore_failed`, nothing partially applied to the app DB.
- Secrets: the instance key and the KEK (env or `tb/kek` file) are never in an archive; app-own keys are sealed under `TB_KEK`, so a restore into a deployment with a different seal key drops them (status `needs_keys`).
- Restore test: conformance A7 round-trip, plus the ops runbook (PRD §11).

#### 7.3a Upgrade-safe boot (v0.1.39, miniapp-sdk 0.1.25; C207 (2), C213, UPGRADE-SAFETY M1–M3)
- Order at boot: scan migrations → `TB_RESTORE_FROM` → open → refuse data newer than the code (`app_schema_newer`, `sdk_schema_newer`) → when a migration is pending or the app version changed: take the migration lock (`tb_migration_lock`, holder + 2 min lease, a stopped holder is taken over), write the pre-update snapshot, migrate (lease renewed after each file), then ONE `tb_meta` write (`app_version`, `schema`, `min_compatible_code`, `min_compatible_sdk`, `last_preupdate`). A fresh database has nothing to snapshot.
- Pre-update snapshot: `TB_BACKUP_DIR/tb-preupdate-to-<version>.tar.gz` (`+` → `_`), backup format with `kind: "preupdate"`, `version` = the data's version (`"0.0.0"` when unknown), `fromVersion`, `toVersion`, `schema`. Newest 3 kept, never in `backups.list()`. Fails closed (`preupdate_snapshot_no_space`) below 2 × the database free. An upgrade interrupted mid-migration keeps its snapshot (never one of half-migrated data).
- Failed mode: any failure in the steps above does not exit. `GET /tb/v1/health` answers 200 `FailedHealth {status: "failed", failure {phase, code, reason?, file?, at}, attention, schemaVersion, codeSchema, minCompatibleCode, preUpdateSnapshot}`; every other route 503 `app_failed`; a claimed instance pushes `AppStatus` readiness `degraded` + `attention` (`BOOT_FAILURE_ATTENTION`) + `failure`.
- `TB_RESTORE_FROM` refuses BEFORE replacing anything (`restore_failed`, `details.reason`): another product (`product_mismatch`), an archive of a newer app version (`version_newer`), an archived database at a newer schema (`schema_newer`). For a pre-update snapshot: missing + data this code runs → skipped; data at the snapshot's schema → skipped (data kept); missing + newer data → `snapshot_missing`. "Already applied" = archive name + `createdAt`.
- Health and `AppStatus` carry `schemaVersion`, `minCompatibleCode` (and `preUpdateSnapshot`); Core's health-gated update reads them through the bridge (BRIDGE §10.3).

### 7.4 Audit (`tb_audit`)
Person and system actions only (agent calls are receipts): `id aud_…, at, actor (per_… \| system), action, target, detail`. `action` ∈ `SDK_AUDIT_ACTIONS` (SDK registry, distinct from Core's `AUDIT_ACTIONS`: `session.signin`, `session.signout`, `hold.decide`, `scope.set`, `key.set`, `key.delete`, `backup.create`, `backup.restore`, `migration.apply`, `claim.complete`) plus app actions declared as a typed literal list in `defineApp({ auditActions })`. No behaviour reads audit rows.

## 8. Keys (CORE §10, C2)
- `getKey(name)` → `Promise<string | null>`; `name` MUST be in manifest `settings.keys` with `usedBy` containing `app` (else throws `key_undeclared`, a programming error).
- Precedence: app-own value (`tb_keys`, sealed per CREDENTIALS §9.1 under `TB_KEK`, entered through `tb.key_set`) > account default (`GET <TB_BRIDGE_URL>/tb/v1/keys/<name>` with `TB-Assert`; response `{name, value, keysRev}`; 404 `key_not_set` → absent). Defaults are cached in memory until `keysRev` changes; the cache is dropped when the slice shows a pause.
- `onKeysChanged(cb)` (= `events.keysChanged`) fires when an app-own key is set/deleted or the status long-poll (§9) returns a new `keysRev`. Values are never logged or compared in clear (digest compare).
- Readiness `needs_keys`: a `required` key whose `when` condition holds is absent from both sources. Ops that call `getKey` then fail `key_missing`; health and `tb.keys_status` show it; the app UI tells the owner to open the bridge key page from Portal (the app mints no ticket).

## 9. Claim, slices, companion calls (always via the bridge; one credential: the instance key K8)
| Step | Rule |
|---|---|
| Instance key | generated at first boot (`generateKeyPair`), sealed under `TB_KEK` in `TB_DATA_DIR/tb/instance-key`; never leaves the instance. Settings reach the app only as env at (re)deploy; the slice carries no settings (C16 S6). Every SDK request to the bridge carries an instance assertion in header `TB-Assert` (`typ tb-instance-assert+jwt`, `htm`, `htu`, `bd`; CREDENTIALS §10). |
| Claim | no claim record → `POST <TB_BRIDGE_URL>/tb/v1/claim` with `ClaimRequest {code: TB_ENROL_CODE, instancePublicKey, manifestDigest, version, sdkVersion, service?}` (BRIDGE §10.1). Response `{ins, bridge {id, publicKey, internalUrl}, slice?}`; `ins` MUST equal `TB_INSTANCE_ID` (else boot fails `instance_mismatch`). Retry with backoff; health `needs_claim` meanwhile. After success the code is ignored. Lost key/volume → owner issues a new K6 in Portal (re-enrol). The SDK serves no claim route of its own. |
| Slice | v0.1.11: the key-set rule first (`trustedPortalKeys`, CREDENTIALS §9.5; see "v0.1.11 additions"); before the first slice is installed `verifySlice` uses the bootstrap `TB_PORTAL_KEYS`; after it only the statement's keys (CREDENTIALS §9.2, §9.5); `aud = sub = tb:ins:<id>`. Used fields: `bridge` (call-proof keys), `portalKeys`, `standalone`, `pause`, `revoked`, `personNbf`, `agents[]`, `grants` (companion grants held by this app: `mode: "bound"`, `wf` = the manifest-declared companion operations, `held` = workspace default held families, no caps — I8, C16 S5), `rev`. Stored in the app DB (last good). |
| Status + refresh | loop `POST <TB_BRIDGE_URL>/tb/v1/status?wait=60` with `AppStatus {readiness, version, sdkVersion, scopesRev, sliceRevision, keysRev, pendingHolds, attention?}` (BRIDGE §10.3; v0.1.28 F89: `attention` = `defineApp({attention(db)})` read at each push, 1 s timeout, error → none + rate-limited WARNING; present → readiness `degraded` when health is `ok`; `pendingHolds` = count of receipts with status `held`, count only, no content — C16 S2: bridge → Core status report → canvas badge and TBD counts; the push is also sent at once when the count changes); a returned slice/`keysRev` is applied (trust set, pause, agent first sight §7.2, key cache). Slice `iat` + 12 h passed → `slice_stale` (§3.2). |
| Companion call | `callApp(product, op, input, { idempotencyKey?, context? })` (v0.1.77: `context`, §18.6) → `POST <TB_BRIDGE_URL>/tb/v1/call` with `TB-Assert`, `TB-Grant: <companion grant for that product from the slice's grants>`, body `CallEnvelope {target, op, input, idempotencyKey?, parentCall?, context?}` (BRIDGE §8.3; `parentCall` = current `callId`). The bridge gates, runs hooks, forwards. Result `{status: "ok", output} | {status: "held", holdId, expiresAt}` or a thrown `TbError` (CORE §8 envelope). Ops not in manifest `companions[]` (= the grant's `wf`) throw `companion_undeclared` before any network call; `grant_stale` or `grant_expired` (v0.1.11, C70; BRIDGE §8.4) → the SDK re-reads its slice once and retries once; any other refusal surfaces unchanged. |

## 10. Status (derived)
`GET /tb/v1/health` → `status` ∈ `ok | needs_claim | needs_keys | slice_stale | restoring | failed`, computed from claim record, slice age, manifest `settings.keys` + `when`, and boot state; `keys` = names + booleans only. The status push maps it to `AppStatus.readiness`: `ok` → `ready`, `needs_keys` → `needs_keys`, every other value → `degraded`; v0.1.28 (F89) `ok` with an app `attention` → `degraded` (the app still serves; the owner sees the reason). Silent degradation is a bug (L3): an app whose engine or provider fails while ops still answer reports it here. Portal shows what the bridge reports. v0.1.31 (SDK-03): health carries `backup: BackupHealth {schedule, lastOkAt, lastFailedAt, lastError, failures, overdue}` (state kept in the app DB, survives restarts; every run, scheduled or `runNow`, records its outcome). The SDK raises `AppStatus.attention` (after the app's own `attention()`, before jobs) with `backup_schedule_invalid` / `backup_schedule_never` (no scheduled backup runs), `backup_failed` (failures since the newest good backup > 0) or `backup_overdue` (no good backup for more than two schedule periods); a good backup clears it.

## 11. `tb-exec` (C2 wrapper entrypoint for companion containers) and service helpers (C6)
- Image = thin layer `FROM <pinned upstream>@sha256` + the `tb-exec` binary; upstream unmodified, never vendored. `ENTRYPOINT ["tb-exec", "--"]`, `CMD` = the upstream command.
- At start: claim as service `TB_SERVICE` of its instance (own K8 under its own `TB_KEK`, own K6 in `TB_ENROL_CODE`); take the app instance's public key from `ClaimResponse.app.publicKey` and the key→env list from `ClaimResponse.serviceKeys` (types/bridge.ts); fetch each listed key (`GET /tb/v1/keys/<name>`); spawn the upstream command as a child with each value in its listed env var; forward signals; exit with the child's code. A new `keysRev` restarts the child. Values are never written to disk or logs.
- Control port `7077` (constant, private network only) accepts only requests carrying an instance assertion from its own app (verified with that public key): `POST /tb/v1/exec/backup` runs `backup.dump` and streams stdout; `POST /tb/v1/exec/restore` runs `backup.restore` with the body on stdin.
- Helper (C6): a service that declares `helper { port, paths[] }` ships an app-owned helper process in its thin layer; `tb-exec` starts it beside the upstream command and lets through only the declared paths on `helper.port`, after verifying the same instance assertion. App side: `callServiceHelper(serviceId, path, body)` signs the assertion and POSTs JSON; an undeclared path throws `helper_path_undeclared` locally.

- v0.1.3 (C33): `tb-exec` is a Node bin shipped by `@opt2-tealbrick/miniapp-sdk` (the thin layer installs Node + the package). Flags: `tb-exec [--helper-cmd "<cmd>" --helper-target 127.0.0.1:<port>] -- <upstream...>`; `--helper-cmd` starts the helper process, `--helper-target` is where the authenticating proxy on `helper.port` forwards declared paths.
- v0.1.3 (C33): `defineApp({ onStart(ctx: { db, log, scopes, getKey, callServiceHelper }) })` runs once after boot + claim. `callServiceHelper(serviceId, path, body)` = JSON POST to the service helper on the private network with an instance assertion (`TB-Assert`, htm/htu/bd), timeout, error envelope.
- v0.1.3 (C31): `OpContext.publicUrl` (from slice `bridge.publicUrl`), `OpContext.workspace`, `scopes.instances` on person-op and public-route ctx, and `ctx.secrets { put, get, delete }` sealed under `TB_KEK` (AAD = name; excluded from export, sealed in backups) — THE app-secret mechanism.

## 12. Standalone
| Case | What changes for the SDK |
|---|---|
| Leaving Portal (bridge standalone, CORE §4) | nothing in the app: a Portal-signed slice names `standalone.issuer`; from then the SDK accepts grants, tickets and slices from that issuer. No env change, no restart. |
| App alone (`TB_STANDALONE=1`, no bridge, no Portal) | trust set = the instance key only; no claim, no slice; `TB_INSTANCE_ID` absent → the SDK generates and stores an `ins_` id at first boot; `/tb/v1/ops`, hooks and dynamic routes answer 503 `no_bridge`; person UI is served on the app's own port. Sign-in: first boot prints a one-time setup code (stdout; stored as SHA-256; 24 h) → owner opens `/a/<product>/tb/standalone`, enters it and sets a passphrase (≥ 12 chars, scrypt); later sign-ins with the passphrase (5 tries/min). The SDK then mints a K11-shaped ticket (`iss = aud = tb:ins:<id>`, 60 s) and hands it to the SAME redeemer → same cookie, CSRF, principal (`per_` id generated at setup). `TB_STANDALONE_RESET=1` prints a fresh setup code at boot. Holds, receipts, scopes, keys (app-own only), backups, export work unchanged. |
Agent access to an app needs a bridge (enforcement lives only there, CORE §9); a bridge first start without Portal is next wave (I11), so an app run without a bridge serves persons only.

## 13. Environment variables (one name per setting, no aliases; the manifest schema reserves `TB_`)
| Name | Who | Set by | Meaning |
|---|---|---|---|
| `TB_INSTANCE_ID` | app, services | deploy recipe (absent in app-alone mode) | own `ins_` id; must equal the claim response |
| `TB_SERVICE` | services only | deploy recipe | manifest service id |
| `TB_ENROL_CODE` | app, services | deploy recipe (Core issues K6) | one-time claim code |
| `TB_BRIDGE_URL` | app, services | deploy recipe | bridge internal (private network) base URL |
| `TB_PORTAL_KEYS` | app, services | deploy recipe | Portal public JWKS JSON (public values only) |
| `TB_KEK` | app, services (the bridge uses the same name) | generated by the provider at deploy (Railway `secret()`); if the provider cannot, the service creates it on first boot in `TB_DATA_DIR/tb/kek`, excluded from backups (I3). Portal never sees it | 32-byte KEK for sealing |
| `TB_KEK_PREVIOUS` | app, services | owner, during KEK rotation only | old KEK; the SDK reseals every blob at boot, then the owner removes it |
| `TB_DATA_DIR` | app, services (`tb-exec`) | deploy recipe (manifest `data` volume mount; for a service without a volume the recipe adds a 1 GB one) | data volume mount (sealed instance key, `app.db`) |
| `TB_DATA_EPHEMERAL` | app, services (`tb-exec`) | tests and conformance runners ONLY (never a deploy recipe) | `1` = skip the v0.1.12 first-claim mount check of `TB_DATA_DIR` (temp dirs are not volumes) |
| `TB_BACKUP_DIR` | app | deploy recipe: `<data mountPath>/backup` (C28) | backup directory on the one data volume |
| `TB_STANDALONE` | app | owner (self-host) | `1` = app-alone mode |
| `TB_STANDALONE_RESET` | app | owner | `1` = print a new standalone setup code |
| `TB_RESTORE_FROM` | app | owner | archive name to restore at next boot |
| `TB_LOG_LEVEL` | app, services | optional | `error \| warn \| info \| debug` (default `info`) |
The listen port is manifest `runtime.port`; backup schedule and retention are manifest `backups`. Any other `TB_*` variable present at boot → warning `env_unknown` (no fallback names are read).

## 14. Client (`@opt2-tealbrick/miniapp-sdk/client`, React)
| Export | Content |
|---|---|
| `<TbProvider product>` | context: session, CSRF, base path `/a/<product>/` |
| `<AppShell>` | re-exported from `@opt2-tealbrick/ui` — the ONE shell (header, nav, standard pages: Holds, Receipts, Agents & scopes, Keys, Backups/export; app pages as children). No per-app copies (D113). |
| `useSession()` | `{ principal, status: "loading" \| "signed_in" \| "signed_out", signOut() }` |
| `useHolds(filter?)` | `{ holds, decide(holdId, decision, note?) }` over `tb.holds_list` / `tb.holds_decide` |
| `useScopes(agent?)` | `{ access, set(agent, type, id, access) }` over `tb.agents_list` / `tb.scopes_set` |
| `useAgents()` | slice agents (`tb.agents_list`) |
| `tbFetch(path, init?)` | same-origin fetch with `TB-CSRF`, base path, CORE error envelope → `TbError` |
| `callOp(op, input)` | person op via `/a/<product>/tb/v1/ops/:op` |

## 15. Template (`create-tealbrick-miniapp`) output
| Path | Content |
|---|---|
| `tealbrick.manifest.json` | starter manifest (one op, one scope type, `backups`, data + backup volumes) |
| `src/app.ts`, `src/main.ts` | `defineApp` with a typed handler stub per op; `main.ts` = `startApp(app, process.env)` |
| `src/ui/` | React app using `<TbProvider>` + `<AppShell>`; built to `dist/ui` |
| `migrations/0001_init.sql`, `skills/<id>/SKILL.md` | baseline + one skill file |
| `Dockerfile` | THE one app Dockerfile pattern (C53/BSA-06; Knowledge and Connect follow it) — see §15.1 |
| `.woodpecker.yaml` | includes the ONE pipeline template from `opt2-tealbrick-platform` (typecheck, lint, unit, conformance, build image, publish, release record); no repo-local pipeline logic |
| `package.json` | `@opt2-tealbrick/*` deps as GitHub-release tarball URLs (REPOS §5); scripts `typecheck lint test conformance build gen` |
Generated (never hand-written, not committed): `tb-gen openapi | kit | docs | railway`. The per-app kit (`<product>-kit`: op id constants, input/output types from the manifest schemas, skill texts, a typed client over the bridge MCP tools) is built by CI and attached to the app's GitHub release as a tarball. `tb-gen railway` renders a self-host Railway template from the manifest (incl. the backup volume); Portal deploys use Core's recipe generated from the same manifest. Conformance drift check: generated output equals the manifest.

### 15.1 The one Dockerfile pattern (C53/BSA-06, v0.1.7)
1. Build stage `node:24-slim@sha256:<pinned>`: `corepack enable`; `pnpm install --frozen-lockfile`; `tb-gen kit` (types come from the generated kit, BSA-12); `tsc -p tsconfig.build.json` → `dist/`; UI build → `dist/ui`.
2. Runtime stage: the same pinned `node:24-slim@sha256`; production deps only (`pnpm install --prod --frozen-lockfile`); copy `dist/` and `migrations/`, `skills/`.
3. Manifest copied to `/opt/tb/tealbrick.manifest.json` (read by the SDK and `tb-exec --manifest`).
4. Data under `/data` (`TB_DATA_DIR=/data`, `TB_BACKUP_DIR=/data/backup`, C28); one volume per service.
5. `USER node`; `CMD ["node", "dist/main.js"]`. If the platform starts the container as root (Railway volume mounts, C38), `startApp` chowns `TB_DATA_DIR` and drops to uid/gid 1000 before opening anything (BSA-05).
6. Companion services: `FROM <upstream>@sha256` + Node + `@opt2-tealbrick/miniapp-sdk` (`tb-exec`); `ENTRYPOINT ["tb-exec", "--manifest", "/opt/tb/tealbrick.manifest.json", "--"]`, `CMD` = the upstream command. `tb-exec` drops to 1000 only when the service sets `dropPrivileges: true` (C54).
No npm, no `node src/main.ts` in images, no hand-written types mirroring the manifest.

## 16. Versioning
SDK semver. Portal and the bridge support the current SDK major and the one before (manifest `sdkMajor`; claim reports the exact `sdk` version); an older major is refused `sdk_major_unsupported`. The wire paths stay `/tb/v1/…` across SDK majors; a breaking wire change requires a new SDK major and is supported by the bridge for that major and the previous one. The client package and `@opt2-tealbrick/ui` are versioned with the SDK.

## 17. Exported surface (coverage list; CONFORMANCE generates its coverage from `types/sdk.ts` exports at freeze)
Every name below is a runtime export with a declaration in `types/sdk.ts`; each has at least one conformance check. Types-only exports (wire shapes) are re-exported from `types/bridge.ts`, `types/credentials.ts`, `types/manifest.ts` and are not re-declared.
| Package | Functions / classes | Constants |
|---|---|---|
| `@opt2-tealbrick/manifest` | `canonicalize`, `digest`, `validateManifest`, `manifestDigest`, `validateCompanions`, `validateAppFiles`, `withStandardOps`, `generateKeyPair`, `thumbprint`, `keySetFrom`, `signJws`, `verifyJws`, `signInstanceAssertion`, `verifyGrant`, `verifyCallProof`, `verifyHookProof`, `verifyBridgeOpProof`, `verifyTicket`, `verifySlice`, `verifyConfig`, `renderSkill`, `gate`, `authorize` | `RECEIPT_STATUSES`; re-exported vocabularies (`CRUD_ACTIONS`, `EFFECTS`, `HOLD_FAMILIES`, `AGENT_MODES`, `OPERATION_AUDIENCES`, `STANDARD_OPERATIONS`, `TYP`, `PROOF_HEADER`, …) |
| `@opt2-tealbrick/miniapp-sdk` (server) | `defineApp`, `startApp`, `TbError`, `decideHold`, `getKey`, `onKeysChanged` (plus the `RunningApp` members: `receipts`, `scopes`, `keys`, `audit`, `backups`, `status`, `stop`) | `SDK_AUDIT_ACTIONS`, `SESSION_COOKIE` (`tb_session`), `CSRF_HEADER` (`TB-CSRF`), `TB_EXEC_CONTROL_PORT` (7077) |
| `@opt2-tealbrick/miniapp-sdk/client` | `TbProvider`, `useSession`, `useHolds`, `useScopes`, `useAgents`, `tbFetch`, `callOp` (`AppShell` comes from `@opt2-tealbrick/ui`) | — |
| binaries | `tb-exec` (§11), `tb-gen openapi \| kit \| docs \| railway` (§15), `create-tealbrick-miniapp` (§15) | — |

## Checklist mapping (SPEC-REVIEW-CHECKLIST §SDK-API)
| Checklist line | Answered in |
|---|---|
| Four sides have named functions; claim via bridge | §9 (Portal: claim/slice, harness: §3/§4/§6, apps: `callApp` §9, person: §5/§14) |
| ONE authorization function, same in bridge and app, signature | §2 (`verifyGrant` shared; `gate` bridge, `authorize` app per CORE §7 C10), `types/sdk.ts` `AuthorizeInput` |
| Holds/receipts one table, one shape; approvals in app GUI/TBD; no Portal waiting view | §4.1–§4.5 |
| Data plumbing SDK-owned: migrations, idempotency, audit, backups to template volume, export | §7.1, §4.4, §7.4, §7.3, §15 |
| Human sign-in one module; standalone same code | §5, §12 |
| One claim path, one credential, one proof header, no aliases, one env name per setting | §9, §3.2 (`TB-Call`), §13 |
| App registers only handlers; routes/OpenAPI/status derive from manifest | §1 rule 1, §3, §3.2, §10 |
| Rules/Fleet only via hooks; no built-in governance modes | §1 rule 4, §3 (`hooks`) |
| Template covers manifest, SDK wiring, conformance CI, Dockerfile/entrypoint, backup volume, per-app kit | §15 |
| App shell is one component | §14 |
| Each primitive one owner package; copying = CI failure | §1 rule 2, §2, §17 |
| Nothing forward-declared, no release-tag comments | §1 rule 5, §17 |

## Open questions
None open. Resolved at v0.1: the scope summary is the bridge op `scope_summary` only and is not in `STANDARD_OPERATIONS` (10 ids; the `tb.` prefix stays reserved by the manifest id rules).

## v0.1.3 clarifications (C35)
- Idempotency keys live in `tb_idempotency` (also for `receipt: false` ops); results sealed, 24 h.
- Companion (app) callers' scope rows are keyed by instance id, manifest default grants applied on first call.
- Standard person-op outputs: lists `{items, nextCursor}`, `tb.agents_list` `{agents}`, `tb.keys_status` `{keys}`, mutations `{ok}`.
- SDK 0.x counts as manifest `sdkMajor` 1 until SDK 1.0.
- `TB_KEK`: exactly 32 bytes, base64url (43 chars) or hex (64 chars); KEK id = non-secret fingerprint `kek_<16 hex>`. Grant failures use `grant_invalid | grant_expired | grant_revoked`; other token failures `invalid_token`. Backup/export failures: `backup_failed`, `export_failed`. App tables export as `tables/<name>.jsonl`.
- `onStart`, `ctx.publicUrl`, `ctx.workspace`, `ctx.scopes.instances`, `ctx.secrets` are now in types/sdk.ts (C31/C33).

## v0.1.7 additions (C53, C54)
- BSA-05/C54: ONE privilege drop (`dropPrivileges` in the SDK): `startApp` always drops to uid/gid 1000 when started as root (chown `TB_DATA_DIR`, and `TB_BACKUP_DIR` if outside it, then setgid/setuid; failure → `privilege_drop_failed`); `tb-exec` drops only when `runtime.services[].dropPrivileges: true`.
- BSA-12: `SessionInfo.idempotencyRequired` (person-audience op ids with `idempotency: required`); client `callOp` adds a fresh key for them unless the caller passes one; retrying the same logical call with the same key is the caller's job.

## v0.1.11 additions (C62/C63, C70)
- **Key-set statements (CREDENTIALS §9.5).** `@opt2-tealbrick/manifest` 0.1.6 adds `portalRootKeys(channel)`, `signKeySetStatement(claims, rootKey)` (offline ceremony tool only), `verifyKeySetStatement(jws, roots, pinned?)`, `trustedPortalKeys(body, pinned, roots)` (the ONE trust rule for config and slice bodies) and `isPrivateInternalUrl(url, {ownInfra, allowList})` (BRIDGE §5.7). `keySetAnnounce` was removed in manifest 0.1.18 (spec 0.1.26, C133); `trustedPortalKeys` has no `required` option and no `legacy` result.
- **Slice rule in miniapp-sdk 0.1.11** (`TrustState.install`), in this order: (1) after a `standalone` slice: only the standalone issuer, `portalKeySet` ignored; (2) slice carries `portalKeySet` → `trustedPortalKeys` against the pinned statement and the build-pinned roots; refused (`keyset_invalid` / `keyset_rollback`) → slice dropped; else the slice must be signed by an `active` or `pending` key of the statement, and on install the statement's keys REPLACE the trusted set and `{seq, kss}` is persisted with the slice in the app store; (3) a statement is pinned and the slice has none → dropped (`keyset_missing`, no downgrade); (4) nothing pinned and no `portalKeySet` → dropped (`keyset_missing`); there is no transition path (removed, C133: miniapp-sdk 0.1.19 has no `KEYSET_REQUIRED` and no `slice_keyset_transition` warning), and a build with no pinned roots refuses every slice (`keyset_invalid`). A refused slice is logged (`slice rejected`, code only) and the status loop waits 1 s before the next exchange.
- **Pinned roots**: miniapp-sdk 0.1.x builds pin the DEV root pair (`PORTAL_ROOT_CHANNEL = "dev"`, a build constant); the cutover release switches it to `prod`. No env name selects roots. `startApp(app, env, harness?)`: `harness.portalRootKeys` (types/sdk.ts `StartHooks`) replaces the pinned roots for test harnesses only (conformance start modules pass `env.TBCONF_PORTAL_ROOT_KEYS`, CONFORMANCE §7); production `main.ts` never passes it.
- **Companion retry (C70)**: `callApp` retries once after one slice re-read for `grant_stale` and `grant_expired` (unchanged behaviour, now also stated for `grant_stale` in BRIDGE §8.4).
- **Path bases (C70, MANIFEST §3)**: `tb-gen` follows MANIFEST §3 path bases. Build paths (`runtime.build`, `runtime.services[].build`) are repo-relative. Skill files are manifest-relative (relative to the directory of `--manifest`). `--repo <dir>` names the repo root; the default is the manifest directory. With `--repo`, `tb-gen railway` refuses a build context or Dockerfile that does not exist under it (`build_path_missing`). `validateAppFiles(manifest, repoDir, manifestDir = repoDir)` uses the same two bases.

## v0.1.12 (fallback removed, 2026-10-12T10:19:19Z)
- miniapp-sdk 0.1.12 set `KEYSET_REQUIRED = true`; 0.1.19 removes the constant (C133): the statement is always required.

## v0.1.12 addition (claim guard, spine S1: a claim on ephemeral disk lost its identity)
- **Mount gate.** Before a FIRST claim (no claim record) and before a reclaim, `startApp` and `tb-exec` check `TB_DATA_DIR` against `/proc/self/mountinfo`: the nearest mount (longest mount point equal to or a parent of the resolved data dir; on a tie the later, stacked entry) must not be `/` and its fs type not `overlay`, `aufs`, `tmpfs`, `ramfs`, `devtmpfs`, `fuse` or `fuse.*` (no allow-list of fs types or devices; Railway volumes are their own ext4 mount, `/` is overlay). Only `TB_DATA_DIR` is checked, never `TB_BACKUP_DIR` (one volume per service; Core sets `/data/backup` inside it). Not mounted → the one-time `TB_ENROL_CODE` is NOT redeemed; health `needs_claim` with detail `attention: "data_dir_not_mounted"` (wire `readiness: degraded`; `tb-exec`: warning log); the check repeats 5 s → 60 s and the claim follows once mounted. No mountinfo (macOS, non-Linux) → check skipped. `TB_DATA_EPHEMERAL=1` skips it (tests / conformance only).
- **Boot line.** One info log `data_dir_mount {dataDir, mounted: true|false|unknown, mountPoint, fsType}` at every boot.
- **Reclaim.** The claim record stores `codeDigest` = sha256 of the code it was claimed with (never the code). When the bridge refuses the stored identity (401 `unauthenticated` on an instance-assertion request) AND the current `TB_ENROL_CODE` digest differs from `codeDigest` (a record without one counts as different), the SDK claims once with the new code, replaces the record and drops the old identity's slice; the sealed instance key, app data and the pinned key-set statement stay. Same or no new code → keep refusing with backoff, health `needs_claim` + `attention: "identity_refused"` (logged once per episode). Each code is tried at most once per process.
- **Conformance.** The app runner sets `TB_DATA_EPHEMERAL=1`; new check `A1.reclaim_on_new_code` (fake bridge forgets the instance key: restart with the same code → no claim; with a new code → one claim, then an accepted status push).

## v0.1.13 additions (C81, C82, C85, C86, Fleet)
- **authorize() (G1):** `AuthorizeInput.holdVerdict` = the proof's `hv` (or null). Order: (0) slice pause → verifyGrant → scope access → **hook hold verdict** → held family / money → caps → run. With a verdict and no approval → `hold` (family = `hv.f`, reason = `hv.r`, receipt `heldBy = hv.by`, `holdFamily` may be `policy`). `approval: "approved"` (approved, unconsumed hold for (caller, op, inputDigest)) satisfies the verdict, held-family and money steps alike; the approved call runs once (C8). Scope refusals beat a verdict.
- **tb.holds_pending (G4):** standard op, audience agent, crud read, effect read, idempotency none, receipt false. Input `HoldsPendingInput {limit? 1..100 (50), cursor?}`; output `HoldsPendingOutput {items: HoldsPendingItem[], nextCursor}` — summaries only (`summary` = the redacted receipt summary; never `input`, `view` or the whole `meta`; v0.1.77: an item may carry `callerContext`, a short summary built from `meta.callerContext`, §18.6 rule 7). An agent caller sees only its own `held` receipts; an app caller (companion grant naming `tb.holds_pending`) sees all `held` receipts of the instance. `decidePath = /holds/<id>`: every app's person UI MUST open the hold's decision view at that path (template 0.1.7 routes it; apps without a UI get the SDK's minimal decision page at `/holds/<id>`, a person route using `tb.holds_list` / `tb.holds_decide`). Order: oldest first.
- **C85 callApp outside a handler:** `StartContext.callApp` and `EventContext.callApp` (same signature as `OpContext.callApp`) send `CallEnvelope` without `parentCall`; the SDK uses the app's companion grant from the slice (re-read + one retry on `grant_stale`). Usable for the app's whole lifetime (keep the ctx). Same hooks and holds as any caller; a held outward call waits for the owner like any hold.
- **C86 pendingCount / statusChanged:** `defineApp({pendingCount?(db)})`: `AppStatus.pendingHolds` = held receipts + `pendingCount()` (clamped 0..10 000; 1 s timeout; error/timeout → 0 and a WARNING log each time, rate-limited to 1 per minute with a suppressed count). `ctx.statusChanged()` (op ctx, StartContext, EventContext) pushes status within 1 s (debounced; ≤ 1 push/s).
- **Fleet: `events.agentsChanged(agents, ctx)`:** the full `SliceAgent[]` once per installed slice whose `agents[]` differ (ids, names, mode, status) and once for the first slice after boot. `agentAdded`/`agentRemoved` stay. All event handlers get `EventContext {db, log, scopes, callApp, statusChanged}`.
- **Slice `portalUrl` (C86):** `ctx.ownerLink(path)` (OpContext, StartContext, EventContext) → `<portalUrl>/w/<ws>/open?product=<own product>&path=<encoded path>`, or null until the slice carries `portalUrl`; `path` must pass the launch path rule (PORTAL-API v0.1.13), else it throws `path_invalid`.

## 18. Cross-app contracts (v0.1.13)
Pattern: a namespaced context key or a documented op behaviour, a version field `v`, and fail closed on an unknown version. Contracts are data between apps; the spine (Core, bridge, GUI) never interprets them.
- **`rules.narrowing` (G5)** — written by the app whose product id is `rules` (context hook): `RulesNarrowingV1 {v: 1, ruleId, reason, memoryTags?: {anyOf?: string[], noneOf?: string[]}}` (tags ≤ 64 chars, ≤ 32 per list). A memory app (Knowledge) MUST, for every read/recall op: keep only items whose `tags[]` intersect `anyOf` (when given) and do not intersect `noneOf`; refuse with `narrowing_unsupported` (409) on an unknown `v`; apply nothing when the key is absent. Knowledge results carry `tags[]` so a Rules `after` hook can also redact (generic after-hook mechanism).
- **`tb.onBehalfOf` (G4b)** — written by the bridge only (BRIDGE §8.5): `{claim: {kind, id, display?}, verified: false, via: "mcp_meta"}`. `channel_sender` ids: `"<channel>:<value>"`, channel lowercase `[a-z0-9_-]{1,32}` (`buzz`, `slack`, `telegram`), value = Connect's sender value (Buzz npub, Slack user id, Telegram numeric id); producers always send the prefixed form; consumers MAY read a bare `npub1…` as `buzz:`. Unverified → narrow only. Rules may copy it into `rules.onBehalfOf` (Rules' choice).
- **Connect app-caller sender identity (C86)** — when the caller of a Connect send op is a companion APP (`caller.type = "app"`), Connect sends from the workspace sender identity the owner picked in Connect (one per channel); an agent caller keeps its own identity. None set → refuse `no_sender_identity` (409, not retryable, message names the Connect settings page). The receipt records the identity used.
- **v0.1.13 clarifications (implementation, mirrored in spec 0.1.14):** the SDK calls `statusChanged()` itself whenever a hold is created, decided or expires (so `pendingHolds` reaches the canvas within ~1 s); `tb.hold_status` output gains `family` and `reason` (the hook verdict reason or the SDK hold reason) so the agent sees why it was held (C90: only that reason text — never the input, the hold view or another app's payload).
- **v0.1.14 addition:** `ctx.companionTargets(): string[]` (OpContext, StartContext, EventContext) = product ids from the slice `companionTargets` (sorted, unique; [] when absent).

- **`rules.narrowing` details (v0.1.22, G5 decision + Knowledge SPEC-GAP):**
  1. Tags compare after `normalizeTag(t)` = trim + lower case, on write AND on compare; `tagsMatch(memoryTags, tags)` in @opt2-tealbrick/manifest (≥ 0.1.16) is THE comparison: `anyOf` PRESENT (even empty) → at least one normalised item tag in it, so `anyOf: []` passes NOTHING (Rules emits it for a disjoint merge); absent `anyOf` → no anyOf constraint; `noneOf` → no item tag in it. v0.1.23 correction (C115): 0.1.22 read an empty `anyOf` as "no constraint", which WIDENED access; manifest 0.1.15's `tagsMatch` has that bug and must not be used. Rules (`rules_filter`) and every memory app import it (L1).
  2. A read that cannot honour the filter answers `narrowing_unsupported` (409, fail closed), not only for an unknown `v` (e.g. engine tools whose items carry engine-side tags; untagged items under `anyOf`; `noneOf` alone may run when untagged items are allowed by it).
  3. The memory app records `ctx.receipt.meta({narrowing: {v, ruleId}})` on every narrowed read; Rules records its own decision.
  4. Items whose tags are unknown are DROPPED under any narrowing (fail closed); a hidden item answers `not_found` on direct reads. v0.1.28 correction (C150, QA F90 S1): 0.1.22–0.1.27 said "writes ignore the narrowing", which let a narrowed agent re-tag a hidden item and then read it, and answered `ok` for a hidden id but `not_found` for a missing one (existence oracle). A narrowing binds WRITES too; a write never reveals, changes or produces an item outside it:
     a. **A write that addresses an existing item** applies the same visibility check as a read, BEFORE any access, version or input check that could tell a hidden item from a missing one, and a hidden item answers exactly like a missing one (`not_found`, 404, or the op's own missing-item answer). Knowledge: `document_update`, `document_delete`, `comment_add` (`documentId`), `link_add` (`sourceId` AND `targetId`), `link_delete` (both ends), `document_create` (`parentId`).
     b. **A write whose result the writer could not then read** is refused with `narrowing_violation` (409, not retryable, message names the rule id, nothing written): a create (`remember`, `document_create`) whose normalised tags fail `tagsMatch`, and an update whose resulting tags fail it (e.g. tags without any `anyOf` tag, or a `noneOf` tag added). Under `anyOf` a create therefore names at least one allowed tag.
     c. **A write that would touch items the caller cannot see and cannot be checked item by item without revealing them** is refused with `narrowing_unsupported` (409) under a tag narrowing. Knowledge: `collection_delete`. Creating a container that carries no tags (`collection_create`) runs. Person (owner) library ops carry no hook context in practice; under a tag narrowing every person library write refuses with `narrowing_unsupported`, like the person library reads. Any op a memory app has not classified refuses a tag narrowing (fail closed).
     d. **Items without tags** (research notebooks): writes follow rule 2 like reads — under `anyOf` refused with `narrowing_unsupported`; `noneOf` alone runs.
     e. **Engine-native writes** (dynamic engine tools) address engine pages whose tags the app cannot match: refused with `narrowing_unsupported` under a tag narrowing, like engine reads.
     f. A narrowed write records the rule id in the receipt meta like a narrowed read (rule 3). Conformance and app tests cover each rule with a quiet-on-good and a fire-on-bad case (L34).

## v0.1.14 addition (C91)
- **Bridge-op proof binding (C91, spec 0.1.14):** ONE rule, implemented once as `bridgeOpBinding(bop, body)` / `bridgeOpProofClaims(bop, body)` in @opt2-tealbrick/manifest 0.1.8 (the bridge signs with the second, the SDK and conformance verify with the first): `catalog` → `{bop, op}` only — the search body `{op, query?, limit?}` is NOT bound (no `in`; a read-only search, replay still blocked by `jti`); `resolve` → `{bop, op, in}`; `mark` → `{bop, in}`; `scope_summary` → `{bop}` (empty body). `in` = digest(JCS body). A proof that carries any other claim set for its `bop` is refused (`call_proof_invalid`, 401). Dynamic CALLS are not bridge ops: they arrive on `/tb/v1/ops/<op>` with an op proof (`in` = digest(input)). The §3.2 table rows already state it; this note makes it normative and names the shared function.
- **v0.1.13 (Kanban QA S2):** `scopes.instances.create(type, id, label, {shared: true})` on a new or not-yet-shared instance applies the `shared` defaultGrant to every caller whose defaults were applied before (INSERT-if-absent: owner edits win; owner removals after the share are kept). Apps no longer need server-side grant workarounds (Kanban `board_share_sync` can go).
- **v0.1.14 (C102):** for app callers the SDK sets `Caller.name` from slice `companionCallers` (matched by the verified grant `sub` = `tb:ins:<ins>`); fallback the instance id. Apps never show a raw instance id or an unverified label.
- **v0.1.14 (Connect Q-C2):** `defaultGrants[].callers?: ("agent" | "app")[]` (default both): first-sight defaults and the shared-on-share rule apply a grant only to the listed caller types (an app caller = a companion instance).
- **v0.1.15 (C105a):** `callApp` (any ctx) returns `{status: "held", holdId, expiresAt}` when the target holds; the calling app keeps its item pending and retries with the SAME idempotency key after approval (the approved hold runs once). `ctx.appsPolicy()` returns the slice's `appsPolicy.held` (or null) for display. No app may hold or skip holds by itself.
- **v0.1.18 (C106a, Connect F21):** `ctx.agentScopeRequest(agt)` (OpContext, StartContext, EventContext) → the slice's `agents[].scopeRequest` for that agent (`{product, kind, id?, createName?}`) or null. Only requests for THIS product are returned (`scopeRequest.product` = own product id).
- **v0.1.20:** `ctx.ownerLinkFor(product, path)` (OpContext, StartContext, EventContext) = `ownerLink` for ANOTHER app (e.g. Inbox opening a hold's `decidePath` in the owning app); product id and launch path are checked with the shared rules (`product_invalid`, `path_invalid`). Agents get NO direct `tb.holds_pending` tool on other apps: they read pending holds through an app op (e.g. Inbox `holds_overview`); spine T9 step 4 uses that.
- **Fix (miniapp-sdk 0.1.16):** the SDK validates hook answers with the shared `hookResponseProblem` (L1). SDK ≤ 0.1.15 used its own key list and turned every `hold` answer into `500 hook_failed`, so hook holds were REFUSED (fail closed), never held, behind those SDKs. Apps with hold-answering hooks (Rules, sample-gate) need SDK ≥ 0.1.16 and declare `requires.bridge: "0.1.17"`.
- **v0.1.21 (queued):** `startApp(app, env, harness)` harness option `port` (0 = any free port; harness-only, never from env) replaces manifest `runtime.port`; `RunningApp.port` = the bound port.

## 19. Background jobs and scheduled ops (miniapp-sdk 0.1.21; Scribe R1, L6, SDK-1/SDK-2, RUL-11)
ONE job mechanism per app (rule 3): table `tb_jobs` (SDK migration 4) and one runner per process. Apps do not write their own schedulers, timers for deferred outward actions, or claim ledgers (QA CON-12, code-quality pattern 7).
- **Handler jobs.** `defineApp({ jobs: { <kind>: handler | { run, maxAttempts?=5, leaseMs?=30 s, timeoutMs?=10 min, backoffMs?: {base?=1 s, max?=5 min} } } })`; kind `^[a-z][a-z0-9_.-]{0,63}$`, never `tb.`. `ctx.jobs.enqueue(kind, input?, {key?, at?, cron?, maxAttempts?})` → `Job`. A handler runs one TICK `(input, ctx: JobContext)` and returns `{status: "done", result?, state?}` (or nothing), `{status: "again", afterMs?, state?}` (live/paging; resets attempts) or `{status: "retry", afterMs?, error}`; a throw is a failed attempt (code = `TbError.code`, else `job_error`; `TbError` details `retryAfterMs` is honoured). Failed attempts wait `min(max, base·2^(n−1))`; after `maxAttempts` → `failed`.
- **Checkpoint.** `ctx.checkpoint(state, write?(db))` = the cursor + the app's own writes + a heartbeat in ONE transaction (L31). A tick resumes from `ctx.job.state`. Every write of a run is fenced by its lease token: a run that lost its lease (crash take-over, timeout, pause, cancel, stop) gets `job_lease_lost` and commits nothing.
- **Leases (L6, L21).** A claim is ONE `UPDATE … RETURNING` (due `queued`/`waiting`, or `running` with an expired lease); two workers or two processes on one volume never both win. Heartbeat every lease/3. A crashed run is resumed by the next claim once its lease expired (the crashed start counts as an attempt; a run whose attempts are used up becomes `failed` `lease_expired` in the same statement, never re-run). `stop()` (SIGTERM) gives running ticks back at once (attempt not counted) after `ctx.signal` aborts and up to 5 s drain, so a restart resumes them immediately.
- **Pause / resume / cancel.** Per job: `ctx.jobs.pause|resume|cancel(id)` (a running tick aborts; resume also retries a `failed` handler job; a running scheduled op cannot be paused or cancelled: `job_running`/`job_state` 409). Per app: `ctx.jobs.pauseAll() / resumeAll() / appPaused()` (nothing is claimed while paused). Statuses: `queued | running | waiting | paused | done | failed | cancelled | refused`; terminal rows are purged 30 days after they finished (their key is free again).
- **Slice pause (SDK-1, R2).** Read before every claim: a workspace kill switch or instance pause stops handler jobs (they wait, not fail); a job enqueued from an op inherits the caller, and a paused agent's jobs wait; an agent removed from the slice → `refused` `caller_removed`, an app caller no longer in `companionCallers` → `refused` `grant_revoked`. No current slice in bridge mode (unclaimed or > 12 h) → nothing runs (L33). `ctx.paused(agent?)` (OpContext, StartContext, EventContext, JobContext) = `{workspace, instance, agent}` with the same rule as incoming calls.
- **Scheduled ops (SDK-2, CON-01).** `ctx.schedule({op, input}, {at} | {cron}, {key?, maxAttempts?=1})` from an op handler records THIS caller (agent/app: its verified grant, sealed; person: the owner). At fire time the SDK runs `authorize()` again against the CURRENT slice, scope access, usage and approvals: paused workspace/instance/agent → `refused` `paused` (not deferred), agent not in the slice, or listed with `edge: false` in a directory slice (QA-SPEC49-26: its edge to this app was deleted) → `agent_removed`, app no longer a companion caller → `grant_revoked`, revoked companion-grant jti → `grant_revoked` (C353: slices carry no agent-grant jtis; an agent caller is checked by slice presence and `agents[].status`), op outside the grant's `wf` → `not_in_workflow`, narrowed crud → `scope_denied`; each refusal writes a `refused` receipt as that caller. A `hold` decision creates the hold and the job `waiting`; approve → it runs once (C8), deny/expiry → `refused` `hold_denied`. A run writes the receipt of the actual run. The grant used is the caller's NEWEST verified grant (refreshed on each of its calls, so owner narrowing applies); its 12 h expiry is the one check replaced by "caller still in the Portal-signed slice (≤ 12 h fresh)". An unknown outcome (timeout 30 s, stop mid-run, crash) ends `failed` (`app_timeout`/`unknown_outcome`/`lease_expired`), never re-run (SDK-07). `ctx.schedule({job, input?}, …)` schedules a handler job. Persons may schedule person ops (refused while the workspace or instance is paused). SPEC-GAP: bridge before-hooks (Rules) are not re-run at fire time; they ran for the scheduling call.
- **Status (L3).** `AppStatus.jobs?: {queued, running, waiting, paused, failed, stuck, appPaused}` when the app has any job (SPEC-GAP: additive, not yet in types/bridge.ts). With no app `attention()`, failed jobs → attention `jobs_failed`, stuck jobs (due > 10 min and not started while nothing pauses them, lease expired > 10 min, or a kind without a handler) → `jobs_stuck`; readiness `degraded` while set.
- **`onStop(ctx)` (RUL-11).** Called once from `stop()` after the runner stopped claiming and before running jobs drain and the DB closes (5 s timeout, errors logged). Apps stop their own timers here.
- **Adopt (no app migrated in this release):** Scribe (live + backfill jobs), Connect (scheduled Buzz posts → `ctx.schedule`, drop its 15 s timer: closes CON-01/CON-12), Knowledge (foundry import, projection outbox drain), Live Artifacts (refresh scheduler + `onStop`), Open Design (mirror tick + `onStop`), Evolution and Remote Setup (claim ledger RS-7 → handler jobs with keys), Rules and Inbox (timers → jobs or `onStop`, RUL-11/12).

## v0.1.44 — the verified product of an app caller (SDK-CALLER-PRODUCT, security)
`Caller.product` (app callers only) = the product id of the calling app, taken from the signed slice `companionCallers[]` entry whose `ins` equals the verified grant's caller instance; receipts and hold views carry it too. `Caller.name` is display only: an app manifest may use any name, including another product's name. An app that decides anything per calling app (data sharing, routing, trust) MUST key on `caller.product` (and `caller.id`), never on `caller.name`; conformance checks that a companion whose name equals another product's name is reported with its own product id.
- v0.1.45 note on `Caller.product` (SDK-CALLER-PRODUCT): the companion GRANT authorises the call; `companionCallers` (and so `product`) can lag one slice behind a new edge. An inbound app call with a valid grant therefore runs even while `product` is absent (conformance A12.companion_inbound). An app that decides per calling product MUST treat an absent `product` as "unverified app" and fail closed for that decision (no data sharing, no product-keyed rule match); it may key on `caller.id` (the instance) and show the call as unverified.

## v0.1.47 — app-written scope grants (SDK-INSTANCE-GRANT)
Person-op contexts carry `ctx.scopeGrants` (`grant(agent, type, instanceId, access)`, `revoke(agent, type, instanceId)`): the app gives ONE agent access to ONE scope instance inside a person op the owner just confirmed, e.g. Creative's "start this draft and let agent X work on it". Bounds, else `scope_grant_invalid` (400): the type and instance exist, the level exists and is not above the agent ceiling the manifest allows, the agent is in the verified slice with an edge to the app. The row is the same row `tb.scopes_set` writes, with `source: "app"` and `grantedByOp`; it is audited like `tb.scopes_set` and listed on the owner's Agents & scopes page ("given by <op title>"), where the owner can remove it. `ctx.scopeGrants` is undefined on agent and app calls; an agent op can only narrow its own access with `ctx.scopeSelfRevoke(type, instanceId)`. The Core grant still bounds crud/wf/held first, and Rules hooks still run on every call (no new interplay).

## v0.1.48 — companion callers on owner pages (SDK-COMPANION-CALLERS, C240)
Person-op contexts carry `ctx.companionCallers()`: the verified list of app instances that may call this app (`{product, ins, name, provider}`), taken from the CURRENT signed slice (`companionCallers`, frozen copies; `[]` when the slice is expired). `provider` (slice v0.1.48) says where the caller runs (`railway`, `own_infra`, …; null = unknown, older Core). Read-only, no grant material. Undefined on agent and app calls. Apps that share data with a calling app bind the share to `{product, ins}` at share time and re-check at use time that the call's `Caller.product` and `Caller.id` are that pair; an `own_infra` caller runs code the workspace owner operates (S3-4 residual), so the owner page should say so.

## v0.1.50 — owner-set app access is primary (C283 A1, C277)
- `ScopeGrantRow.authority` / `ScopeAccessView.access.authority`: `"owner" | "bounded"` (absent = bounded). Rule and migration: §7.2.
- `DynamicCatalogEntry.admitted?: "owner"`, `BridgeOpCatalogBody.agent?`, `ScopeSummaryResult.admittedOps?` (display only,
  not proof-bound).
- `gate()` (bridge): step (3) `op.crud ⊆ grant.crud` is skipped for ops with a `scopeType`; `AuthorizeInput.access.authority`;
  `Decision.admittedBy` / `Receipt.admittedBy` (`AdmittedBy = "app_owner_row" | "portal_grant"`).
- Conformance rows to add (conformance 0.1.25+): owner row above the grant runs; bounded row above the grant refused
  `scope_denied`; an agent op and a companion call each try to write an owner row → refused; `ctx.scopeGrants` over an owner
  row → bounded; bridge lists an admitted dynamic entry and an `admittedOps` static op; gate passes a scoped op above grant.crud
  to the SDK; paused agent with an owner row refused.
- Security cases (C277 note §3): an agent never raises its own access (agent ops and companion calls cannot write owner rows;
  self-revoke only narrows); an app never raises access without an owner action (`app` rows stay bounded); pause/revoke/expiry
  still refuse first; holds unchanged; every owner-row write is audited (`scope.set`, person actor).

## v0.1.49 — verified `Caller.listed`; slice `appCallers` (C240 S2, C261)
- `Caller.listed` (app callers only): `true` when the caller instance is in the CURRENT signed slice `companionCallers` under the same verified `product`; `false` when the slice is expired or the caller is not listed any more (edge removed after the grant was minted). Absent for agent and person callers. An app that shares data with a calling app checks `listed`, `product` and `id` at use time. First SDK: miniapp-sdk 0.1.32 (typed there as an extension until it pins 0.1.49).
- Slice `appCallers: "verified"` (Core sets it exactly when it mints the grant `prd` claim for every companion grant to this instance: bridge ≥ 0.2.3, SDK ≥ 0.1.28). With it, the SDK refuses an app call, or a resumed held app call, whose caller has no verified product (no `prd` and no `companionCallers` entry): 403 `caller_unverified`, nothing runs, the refusal is audited. The message names the fix: "the calling app is not verified for this workspace yet: update the bridge, or retry after the workspace config refreshes". Absent = the earlier lenient rule (the call runs with `product` absent). First SDK: miniapp-sdk 0.1.34.

## v0.1.52 — owner rows keep their CRUD; hook proofs bind the whole request (C283c, C268 B / C268b)
- `ScopeGrantRow.crud?` (effective) and `ScopeGrantRow.offer?: {adds}`; `tb.scopes_set` input `acceptOffer?: {adds}`;
  `useScopes().acceptOffer`; audit actions `scope.snapshot_backfill`, `scope.offer_accepted`; error `offer_changed` (409).
  Rule: §7.2.
- `CallProofHookClaims.bd?` = sha256 of the exact hook request body bytes (CREDENTIALS §10; one meaning of `bd` everywhere).
  `ClaimRequest.proofClaims?` / `AppStatus.proofClaims?` (`PROOF_CLAIM_CAPS = ["bd"]`): the SDK (miniapp-sdk 0.1.36,
  manifest 0.1.28) declares `["bd"]`; the bridge sends `bd` only to an app whose current set lists it (BRIDGE hooks step 6:
  changed only by a config manifest/version/candidate change, a re-claim or a push with a new version or set — never by a
  connect failure, timeout or 401; never a retry without `bd`; only app-instance claims/pushes set it). The SDK hashes the raw
  body before parsing and refuses a mismatch `call_proof_invalid`; absent = not compared (a later slice flag makes it required).
- Hook route (SDK): read the raw body, hash it (`bd`), then `JSON.parse` the same bytes; the shape checks run after the hash;
  an empty or non-JSON body is refused 400. The bridge sends the exact bytes it hashed.
- Release order (C215): spec 0.1.52 → manifest 0.1.28 → miniapp-sdk 0.1.36 → conformance 0.1.25 → bridge 0.2.5.
- Conformance rows (0.1.25), each fire-on-bad: (a) owner row at level L; an app update widens L; a call needing the added
  action is refused `scope_denied`, `ctx.scope.can` answers false for it, and the row lists `offer.adds`; a plain re-set of L
  does not accept; `acceptOffer` with other `adds` → 409 `offer_changed`; `acceptOffer` with the current `adds` → the call
  runs. (b) Narrowing L applies at once (also via `can`). (c) Migration 10 backfills owner rows once, audited; afterwards a NULL
  or unparsable snapshot reads `[]`; `acceptOffer` with another level or `access: null` → 400 `input_invalid`; set comparison of `adds`. (d) Hook proof whose `bd` does not match because a field OUTSIDE `ctx` and `in` changed
  (e.g. `call.id` or `call.caller`) → `call_proof_invalid`; a malformed `bd` → refused; `bd` on an op proof or a bridge-op
  proof → refused (shape); a hook proof without `bd` → accepted.
- Bridge tests (0.2.5): no `bd` to an app without `proofClaims` (an SDK 0.1.35 app), none when the set is absent or lists
  something else, none after a config manifest/version/candidate change until the next push, `bd` to an app that lists it;
  a connect failure or a 401 does NOT drop the capability and is not retried without `bd`; a service claim never sets it.

## v0.1.54 — bridge capabilities (C292); adopt write-op crud (C290); rollback wording (C291b)
- `StatusReport.bridge.caps?: BridgeCap[]` (`BRIDGE_CAPS = ["owner_rows"]`): a bridge declares ONLY what it implements;
  `"owner_rows"` = the C283 A1 owner-row filter (catalog `admitted`, scope_summary `admittedOps`, gate skips `op.crud ⊆ grant.crud`
  for scoped ops). It first ships in bridge 0.2.5; bridge 0.2.4 (G2b only) and the 0.1.x line do NOT implement A1 and never
  declare it. Core NORMALISES the reported list (keeps every entry matching `^[a-z][a-z0-9_]{0,39}$`, also ones it does not know, so a newer bridge's caps pass through; dedupes, sorts, at most 16; a
  missing or non-array member = `[]`), compares it with the stored set AS A SET, and in ONE transaction stores it and issues a
  new slice revision when the set changed; every slice Core signs carries the stored set as `slice.bridge.caps`. A STANDALONE
  bridge (no Core) sets `slice.bridge.caps` itself from its own implemented set. The SDK exposes `ctx.bridgeCaps()` (from the
  current verified slice; `[]` when the slice is absent, expired or has none; unknown entries are passed through). Caps are
  ADVISORY: they MUST NOT widen access anywhere (a bridge that declares a cap it lacks only changes display/feature switches; the
  SDK authorizes every call, and a bridge without the A1 gate refuses above-grant scoped ops, so it fails closed). Apps decide
  by capability, never by bridge version (C268c). Compatible without a gate: Core's `bridge_api.ack` input accepts unknown
  members (an older Core ignores `caps`), `verifySlice` checks only `bridge.id`/`keys` (an older SDK accepts the field).
- `AdoptResolved.grants[].write[].crud` (C290): the op's manifest crud (absent → `["read"]`, the same default the grant uses).
- `instances.rollback`: `acceptDataLoss` not `true` → 400 `validation_failed` (was written `input_invalid` in 0.1.53; Core's code
  is `validation_failed`). `TB_RESTORE_FROM` after a failed restore: C291b (PORTAL-API).
- Release order (C215): spec 0.1.54 → Core (copies caps into slices) → miniapp-sdk 0.1.37 (`ctx.bridgeCaps`) + conformance 0.1.27
  → bridge 0.2.5 (the A1 owner-row filter + declares `owner_rows`; with `bd`, C268c). manifest stays 0.1.28.
- Conformance rows (0.1.27): the app's `ctx.bridgeCaps()` equals the slice's `bridge.caps`; absent → `[]`; an expired slice → `[]`.
  The bridge suite gates its A1 rows (B5) by the bridge's reported `owner_rows` cap, NOT by version (a version gate ≥ 0.2.4
  would fail a real 0.2.4 bridge, which has no A1). Bridge tests (0.2.5): caps declared in every StatusReport; never
  `owner_rows` without the A1 filter. Core tests: normalisation (bad entry dropped, duplicates, order flip = no new revision,
  > 16 truncated), downgrade (caps disappear → new revision without them).

## 20. App events — `ctx.emit` and the outbox (v0.1.57; C274c, C274d; miniapp-sdk 0.1.38)
`ctx.emit(name, data, {subject, to?, instanceId?, summary?, untrusted?, key?})` and `ctx.purgeEvents(instanceId)` on
OpContext, EventContext and StartContext (types: `EmitFn`, `EmitOptions`, `PurgeEventsFn`). The manifest declares each `name` (MANIFEST §16); the bridge delivers (BRIDGE §14).
- **Synchronous, transactional.** `emit` validates, then writes ONE outbox row with `ctx.db` inside the transaction that
  is open, so a rolled-back change never emits and a committed one always does. The outbox row shares the fate of its
  transaction ONLY (a handler that commits and then throws still sends the event; a crash after commit sends it after
  restart). Apps that change state and emit do both in one `ctx.db.transaction`; an emit outside a transaction is its own
  write. Held calls run the handler only on replay, so they emit then.
- **Validation (throws TbError 400, before any write):** undeclared name → `event_undeclared`; a `tb.*` name →
  `event_reserved` (only the SDK emits platform events); `data` fails the `payloadSchema` or `key` fails
  `^[A-Za-z0-9._:-]{8,128}$` → `event_payload_invalid`; `data` > 2 KiB (JCS), `summary` > 280 chars, or the whole wire item without `eligible` > 4 KiB (BRIDGE §14.1, e.g. a long `to` list) → `event_too_large`; `instanceId` missing on a scoped event or present on an
  unscoped one → `event_instance_invalid`; `to` missing/empty/> 100 for `target` or present for `granted` →
  `event_target_invalid`; `subject.kind`/`subject.id` shape → `event_payload_invalid`. Tests catch these; the SDK does not
  swallow them in production (an emit bug is a code bug).
- **Key.** Default = a new ULID made at emit (unique across restores and reinstalls); an app key is for cross-emit dedupe.
  The bridge dedupes per (app instance, key) for 7 days.
- **`untrusted: true`** is REQUIRED when `summary` contains third-party text (a message body, a sender's name); it is
  copied to the envelope.
- **`causedBy`** = the calling agent of the current op call (from the verified call, never from app code); absent for
  person calls, EventContext and StartContext.
- **Sender.** A background sender drains the outbox in row order to `POST /tb/v1/events` (≤ 100 items per batch), ONLY
  while `ctx.bridgeCaps()` includes `"events"` (C292: by capability, never by bridge version). Without the cap rows wait;
  unsent rows older than 7 days are pruned (the bridge window). It drains only COMMITTED rows (never while a transaction
  is open on its connection). No emit follows a purge in the same batch (consecutive purges may share one; belt and
  braces with the bridge's purge dedupe: a retry never re-sends a purge ahead of a later event). Answers, per batch:
  - `stored`/`duplicate` → row done; `refused` → row dropped and logged with its code; a 200 that does not answer every
    item with the item's own `key` in order → retry the batch.
  - transport error, 429, 5xx, 503 `app_not_claimed` → retry the batch with backoff (same keys, so the bridge dedupes).
  - 413 → halve the batch and retry, down to one item. A single EMIT item still answered 413 is a permanent refusal (drop
    and log `event_too_large`), so one oversized row never blocks the outbox; a single PURGE item is never dropped (it is
    small; a 413 on it means a broken path): it is retried with backoff like a transport error. A 413 drop does not count
    as a successful send. The batch size grows back only after 10 consecutive fully answered sends (doubling each time).
  - 401 → retry with backoff (key or clock trouble); after 10 consecutive failed sends (any cause) the app reports
    `AppStatus.attention {code: "events_send_failing", reason}` until a send succeeds, so the owner sees it long before
    the 7-day prune.
- **Scoped events.** At SEND time the sender computes `eligible` = agents with a row on (`scopeType`, `instanceId`) whose
  effective crud ⊇ `visibleWith.crud`, with each row's authority (MANIFEST §16.2 rule 2), LIMITED to agents in the
  current verified slice (an agent that left the slice cannot receive anything; its rows may stay), at most 500; for
  `target` it is intersected with `to`. The bridge never delivers outside it. The emit records the event's scope type; a
  row whose `visibleWith` scope type changed by an app update before it was sent is dropped (logged), never sent with
  `eligible` computed on another type.
- **Purge.** When a row of agent A on an instance is removed, its effective crud narrows, or its authority changes from
  `owner` to `bounded` (`tb.scopes_set`, `ctx.scopeGrants.grant/revoke`, `ctx.scopeSelfRevoke`), the SDK writes a
  `purge {agent, instanceId}` row in the same transaction as the row change, for EVERY scope type (not only types some
  current event is scoped on: an app update may have removed the event while older events of it are still stored); it
  drains in order with the events.
  `ctx.purgeEvents(instanceId)` (synchronous, outbox) writes `purge {instanceId}` for every agent: apps call it in the
  transaction that deletes or disconnects an instance.
- **`tb.hold.decided`.** The SDK emits it after a hold decision (`tb.holds_decide`, after `receipts.decide`) and from the
  expiry sweep, `to` = the hold's caller when that caller is an agent; data `{holdId, op, decision}`; subject
  `{kind: "hold", id: holdId}`; no summary.
- Conformance (0.1.28, A-EV-*): a manifest that declares `events` but offers no way for the suite to trigger them is
  a FAIL of the A-EV rows, never "not applicable"; a declared change emits exactly one event (fake bridge); a rolled-back transaction emits
  nothing (a committed one followed by a throw still emits); an invalid payload or an undeclared name throws; bridge 503 then retry → delivered once
  (same key); a slice without `"events"` → nothing sent, then the cap appears → the backlog is sent in order; a scoped
  emit carries the right `eligible` (owner row above the grant → `owner`; `apps_only`-style row is still listed, so the app
  must not emit there — MANIFEST §16.2); a row removal, narrowing or owner→bounded change sends a purge after the earlier
  events; `ctx.purgeEvents` sends an all-agent purge; a committed transaction followed by a throw still sends.

## 21. Person op relayed from a native owner session (v0.1.64; C326; CREDENTIALS K14)
- Private-network route `POST /tb/v1/person-op`, header `TB-Person-Op: <K14>`, JSON body. Only the workspace bridge sends it (BRIDGE §16). v0.1.70 (C354): an SDK that serves this route declares app capability `person_op` in its claim and every status push (`caps`, `APP_CAPS`); gates read the capability, never the SDK version. In standalone and app-alone mode the route answers `503 person_op_unavailable` (no K14 issuer).
- Checks, in order: K14 V0 (`typ tb-person-op+jwt`, `iss = tb:portal` and a Portal key, `aud = tb:ins:<own id>`, `ws` = own, `exp − iat ≤ LIFETIME_S.personOp`, now ≤ `exp` + `PERSON_OP_RELAY.expLeewayS` — the general `LEEWAY_S` does NOT apply, `cli` ∈ `PERSON_OP_RELAY.clients`) → `jti` unused, then CONSUMED (`tb_used_jti`) before any body check → `iat ≥` slice `personNbf` → `bd` = `sha256:` + lowercase hex of SHA-256 over the raw body bytes → (own product, `op`) ∈ `PERSON_OP_RELAY.allow` and, for a `write` op, `cli` ∈ `writeClients` → `op` is a person op of the own manifest (or `tb.holds_list` / `tb.holds_decide`) → input schema → idempotency with key = K14 `idk` (§4.4) → the same handler path as `/a/<product>/tb/v1/ops/:op` (`authorize()` person branch). Failures: `401 person_op_invalid` (any token or digest check), `403 person_op_not_allowed`, `404 op_not_found`, `400 validation_failed`.
- Principal: `PersonPrincipal` with `via` = K14 `cli` and `sessionExpiresAt` = K14 `exp` × 1000. Browser sessions have no `via`.
- Family rule (C332a(4), fail closed): an op that decides a held action (`tb.holds_decide`, or an app op that decides an item that carries a hold) MUST refuse `403 family_needs_portal` when `principal.via` is set and the family is in `PERSON_OP_RELAY.refuseFamiliesFor[via]`, OR the family is unknown, OR `via` has no entry there (deny by default). The SDK enforces it for `tb.holds_decide` and exports `familyAllowedFor(via, family)` for app decide ops (Inbox `item_decide` for items carrying a hold, C277 A3).
- No cookie, no CSRF on this route (not reachable from a browser: private network + one-time Portal-signed token bound to the body).
- Conformance (SDK): S-PO-1 K11 launch token on this route → 401; S-PO-2 `aud` of another instance of the same product → 401; S-PO-3 foreign `ws` → 401; S-PO-4 `bd` mismatch → 401 and the `jti` is spent; S-PO-5 replay → 401; S-PO-6 op outside the allow-list (incl. `tb.key_set`, `tb.export`) → 403; S-PO-7 a `cli` other than `tbm` (`tbd`, `cli`) on ANY op, read or write → 401 `person_op_invalid`, no handler run, `jti` not spent (v0.1.70, QA-SPEC43-7); S-PO-8 money / destructive / unknown family with `via: tbm` → `family_needs_portal`; S-PO-9 a K14 whose `exp` is 5 s in the past → 401 (an SDK that applies the general L = 30 s fails this row; v0.1.70, QA-SPEC43-7); S-PO-10 standalone → 503; S-PO-11 same `idk` twice → one effect; S-PO-12 an answered Inbox ask never releases an SDK hold (only a `tb.holds_decide` or a C277 A3 link, fail closed).

## v0.1.63 additions (model roles; C322(3), C330(4))
- `modelRole(role)` (on `OpContext`, `StartContext`, `HookContext`, the `KeyApi` and as a free function) → `Promise<ResolvedModelRole | null>`: the binding the bridge resolves for a role the manifest declares in `settings.modelRoles[]` with `usedBy` containing `app` (BRIDGE §15.4). `null` = unset, key unset, below `minPolicy` (the SDK never sees a refused binding), OR the route is missing (404 without a refuse code: a bridge without cap `model_roles`) — fail closed, never a guess. The app uses a stored model (e.g. the embeddings model its index was built with) only against the endpoint and key resolved NOW; it never keeps an old key or base URL. Undeclared role → throws `role_undeclared` (a programming error). Cached until `keysRev` changes; `onKeysChanged` fires for binding changes too. The value carries a key: never log it, never return it in an op result.
- `modelFetch(role)` (spec follow-up, QA-SPEC49-2c/-7): `{binding, fetch}` or `null`. `fetch(path, init)`:
  - `path` must stay on the binding's canonical base URL origin: an absolute URL, a scheme-relative `//host/…`, `\`, `@` or anything that resolves to another origin → `model_endpoint_refused`, nothing sent.
  - It resolves the host at connect time, normalises every address (IPv4-mapped IPv6 decoded) and refuses (`model_endpoint_refused`) when ANY address is in `NEVER_LOCAL` or — for a `local` binding — outside the local ranges of BRIDGE §15.3 (100.64/10 only for `policyBasis: owner_attested`); a mix of private and public records is refused.
  - It pins the checked address for that request (no second lookup); TLS still uses the original host name for SNI and certificate verification.
  - Redirects: a cross-origin redirect is NEVER followed (`model_endpoint_refused`), whatever headers the app set; every same-origin hop re-runs the guard.
  - The app adds the provider's auth header itself from `binding.key`. `modelRole()` still returns `baseUrl` and `key`, so an app CAN bypass `modelFetch`: "apps that call models MUST use `modelFetch`" is an app-trust rule, checked by review and conformance, not enforced by the SDK.
  - An engine started by `tb-exec` gets the same check once at start and on every `keysRev` change (`tb-exec` does not fill the role env when it fails, so a required role shows `needs_keys`), and `tb-exec` strips proxy env vars (BRIDGE §15.3).
  - Error codes: `SDK_MODEL_ERROR_CODES` (`role_undeclared`, `model_endpoint_refused`).
- RM-13 for apps (QA-CORE63-5): an `attention.reason` (and any status or log text the SDK sends to the bridge) never contains a base URL, a host, a key name or a key value — say "the reasoning model could not be reached", not where or with what.
- Readiness: the SDK sets `needs_keys` + `attention {code: "model_role_missing", reason}` while a `required: true` role (whose `when` holds) does not resolve; it clears both when it resolves. Optional roles: the app decides (`defineApp({attention})`, codes `model_role_optional`, `embeddings_changed`; MANIFEST §7.1). One attention slot: when the app has any other attention (a fault, a backup code, a failed boot), the SDK reports that one and NOT a model-role code; model-role codes are reported only when nothing else is wrong (QA-SPEC42-10).

## v0.1.68 — dataset narrowing and secret outputs (C336 RQ-2, RQ-3; QA specs#47)

- **18.5 `rules.narrowing` v2: `deepDatasets` (C325, C330).** `RulesNarrowingV2 {v: 2, ruleId, reason, memoryTags?, deepDatasets?: {anyOf?: string[], noneOf?: string[]}}` (types/sdk.ts). The policy app writes `v: 2` exactly when `deepDatasets` is present, otherwise `v: 1` as before. Every reader that does not implement v2 refuses it with `narrowing_unsupported` (§18 unknown `v`), so a data app that predates dataset narrowing fails closed. A v2 reader applies `memoryTags` exactly as v1 and `deepDatasets` as below. `memoryTags` never restricts dataset reads and `deepDatasets` never restricts memory reads.
  1. **Well-formed only.** `deepDatasets`, when present, is an object with at least one of `anyOf` / `noneOf`, each an array of 0–64 strings of 1–128 characters. Anything else (`{}`, `null`, a non-array, a non-string item, an over-long list or name) → the reader refuses `narrowing_unsupported`.
  2. **Identity.** Dataset names are the data app's canonical dataset ids, exactly as it lists them to agents (its overview / list ops). The app resolves every dataset a call names OR would read to canonical ids BEFORE the check (an unknown or ambiguous name → `not_found`); it never compares the caller's text. Comparison is exact and case-sensitive on the canonical id: no trimming, no case folding, no Unicode normalisation. A data source never exposes two datasets whose canonical ids differ only by case (the source adapter refuses the second).
  3. **`datasetsMatch(deepDatasets, ids)`** (@opt2-tealbrick/manifest, one function, L1): key absent → pass; otherwise `ids` must be non-empty (an empty list means "every dataset", rule 4) — then `anyOf` present → every id is in `anyOf` (`anyOf: []` passes nothing) and `noneOf` present → no id is in `noneOf`.
  4. **A call that names no dataset.** A data read that names none (search, ask, an overview across datasets) reads every dataset in scope: under `anyOf` it runs only when the op restricts itself to the allowed datasets, else `narrowing_unsupported`; under `noneOf` it runs only when the op enumerates and excludes the listed datasets, else `narrowing_unsupported`. Lists and overviews omit datasets outside the narrowing; a direct read of one answers `not_found`.
  4a. **No lineage.** The check is on the canonical ids a call names or reads, never on what a dataset is built from: a view, pipeline output or published definition over a disallowed dataset is a dataset of its own and passes or fails by its own id. Owners list derived datasets explicitly; a data app never widens or narrows a narrowing by following lineage.
  5. **Combination.** When several narrowings apply (a policy app merging rules), per key: `anyOf` lists INTERSECT (disjoint → `anyOf: []`), `noneOf` lists UNITE, and a list present on either side survives (absent is not "all"). `memoryTags` and `deepDatasets` combine independently. A policy app carries every narrowing key it models through the merge and never emits a merged narrowing without a key present in any input; for a key it does not model it denies the call instead of dropping the key.
  6. Writes that change datasets or published definitions refuse any `deepDatasets` narrowing with `narrowing_unsupported` unless the op checks each dataset it touches. Receipt meta as §18 rule 3. Row limits (e.g. one region) are not part of this contract; a data app may offer them as named filtered datasets.
- **Secret outputs (`Operation.secretOutput`, MANIFEST M-OP-12).**
  1. **App callers only.** The SDK refuses an agent caller with `secret_output_app_only` (403) before the handler runs; the bridge never lists the op as an agent tool (BRIDGE v0.1.68).
  2. **Not schedulable.** `ctx.schedule` of the op refuses `secret_output_not_schedulable`; the job runner never stores its result.
  3. **Nothing kept.** No idempotency row (a replay with the same key runs again: a new credential). The receipt (`receipt: true`) keeps the input digest and the `redact` summary only, never output, so issuance is audited. No log line, status field or hook payload carries the output.
  4. **Error paths.** A handler error of the op returns its code with a fixed message (`operation failed`); the handler's message is dropped. A failed output validation reports its code only. A `failed` receipt carries no message.
  5. The manifest declares `requires.bridgeCaps: ["secret_output"]` (MANIFEST M-OP-12, C354); Core refuses a bridge without the cap. No version number is used for this gate.
  6. A schedule created before the op had `secretOutput` (or by an older release) is refused when it runs (`secret_output_not_schedulable`); the handler never runs from a job.

## v0.1.74 — catalog name rule, variants (C354a)
- The SDK validates every catalog answer entry `name` with `DYNAMIC_CATALOG_NAME_RE` (no `__`, no trailing `_`) and drops entries that fail it (logged once per name). A dynamic call `tool` follows `DYNAMIC_TOOL_NAME_RE` (≤ 63 chars, so `<name>__<suffix>` variants pass); the app's `resolve` returns the requested name (the bridge refuses a different one). A variant the app resolves runs the same upstream action as its base and is never broader (QA-SPEC56-1, `variantNarrowerOrEqual`): crud ⊆ the base's, effect at or below the base's in `EFFECTS` order, and hold families a SUPERSET of the base's (`holdFamilies`, else `[holdFamily]`; a variant may add a hold, never drops one; e.g. `__first_contact` resolves `holdFamilies: ["first_contact", "outward"]`). A suffix starts with a letter or digit (`DYNAMIC_VARIANT_RE`; `send___y` is not a variant); split names only with `dynamicVariantBase`. The SDK's decision step holds the call when any member of `op.holdFamilies` is held (the first held member is recorded as `holdFamily`).

## v0.1.77 — app hold status and caller context (C367 P3, P4; spec 0.1.77 is a reservation)
- **P3, `tb.hold_status` for app callers.** Cap `app_hold_status`. Rules in §4.7. MANIFEST M-CP-3 lets a companion entry for one product list `tb.hold_status`. BRIDGE v0.1.77 routes it.
- **18.6 Caller context (C367, P4; cap `app_call_context`).** An app that calls another app can say which of its own jobs asked. Evolution uses it to tell a workflow, a version and a run apart.
  1. **API.** `ctx.callApp(product, op, input, { idempotencyKey?, context? })` (`CallAppOptions`, types/sdk.ts) in every ctx: op, start and event. `context` is `Record<string, Json>`. It travels as `CallEnvelope.context` (BRIDGE §8.5), with or without `parentCall`.
  2. **Gate and order (QA-SPEC58-1, -4).** `context` absent or `{}` means NO context: the SDK does not send the field and never throws for it. For a non-empty `context`, `callApp` checks in this order, all before any network call: (a) `companion_undeclared` (op not in the grant's `wf`, §9); (b) `ctx.bridgeCaps()` lacks `app_call_context` → `TbError` `bridge_cap_missing` (409) with `details: { cap: "app_call_context" }`, the same shape Core uses for `requires.bridgeCaps` (C354, CONFORMANCE D-CAP-1); (c) the rules of item 3 for the app's own product → `TbError` `input_invalid` (400) with `details.pointer`. An app that wants to run without the cap leaves `context` out. `ctx.bridgeCaps()` exists on OpContext, StartContext and EventContext (v0.1.77), so an app can ask before it calls.
  3. **Rules.** The bridge checks them (BRIDGE §8.5); the SDK may check the same rules first with the same function. Every key is `<caller product>.<tail>` (`callerContextKeyPattern`). The caller product is the VERIFIED product of the companion grant (`prd`, CREDENTIALS GRANT-PRD). A `tb.` key is always refused. The JCS size of the whole object is at most `CALLER_CONTEXT_MAX_BYTES` (2048 UTF-8 bytes). Depth under a key is at most `CALLER_CONTEXT_MAX_DEPTH` (3). The manifest package implements the validator once (L1); the rows are in `examples/caller-context.cases.json`.
  4. **What the target sees.** The keys are in `ctx.context`, as any context key is. A hook of the caller's own product may overwrite a caller key, because hooks run later (BRIDGE §8.5).
  5. **Informational only (QA-SPEC58-2).** The caller context is a LABEL the caller reports. It is never an input to `authorize()`, the approval match `(caller, op, inputDigest)` (§4.3), the idempotency key (§4.4) or any policy or hook decision by the spine. So an approved hold can be used by an identical repeat that reports another run; the owner approves the call, not the label. Every UI that shows it (Inbox, the decision page) labels it "reported by the caller".
  6. **Receipt.** When `caller.type === "app"`, the receipt `meta.callerContext` holds the final context keys that start with `<caller product>.` (an object). `tb.receipts_list` and `tb.holds_list` return it with the rest of `meta`. An agent caller never gets it.
     On an approved repeat or an idempotent replay the receipt keeps the HOLD's `meta.callerContext`. When the repeat's caller-product keys differ (JCS compare), the SDK stores them as `meta.callerContextRun` (same object rule and size limit). A subset over `CALLER_CONTEXT_MAX_BYTES` (only possible after a same-product hook overwrite) is not stored; the SDK logs a warning.
  7. **`tb.holds_pending` summary.** Each item may carry `callerContext?: string`. The SDK builds it from `meta.callerContext` like this:
     - Take every key. Sort the keys. Use plain code-unit order (keys are ASCII).
     - A key shows as `key` (bare). One exception: when the LAST segment of the key is `workflow`, `version` or `run` and the value is a scalar (string, number, boolean or null), it shows as `key=<value>`.
     - `<value>` is the JSON text of the value, cut to 64 code points. No marker is added to a cut value.
     - Join the entries with `"; "`.
     - If the whole text is longer than 256 code points, keep the first 255 and add `…` (so the result is 256 code points).
     - A receipt without `meta.callerContext` has no `callerContext` on the item. The item never carries the whole context.
  8. **Evolution's fixture.** `{ "evolution.workflow": "<id>", "evolution.version": 3, "evolution.run": "<runId>", "evolution.step": "<stepId>" }`. Its summary is `evolution.run="<runId>"; evolution.step; evolution.version=3; evolution.workflow="<id>"`.
  9. **Storage.** The spec fixes the output, not the storage. The SDK PR may add a column for the summary (a migration; precedent `sdk_receipt_caller_product`).

## v0.1.84 — readable hold cards (C369 D1–D4, D6; spec 0.1.84 is a reservation; miniapp-sdk 0.1.42)
- **D1 default view** (§4.8): labelled plain-text lines (schema `title`, else the humanized key), `yes`/`no`, lists joined (≤ 10, then `and N more`), `Parent › child` paths (depth ≤ 3), long or multi-line text as an indented block (first 1 000 code points), control, bidi and zero-width characters removed, ≤ 16 000 UTF-16 code units. Exact rules; rows in `examples/hold-view.cases.json`. A dynamic call without a usable app view gets it over the tool arguments with the catalog entry's titles. The default SUMMARY rule is fixed too, but it is not the receipt summary yet (C90).
- **D2 every view is bound** (§4.8): `meta.viewSha256` on every hold; the approved repeat recomputes the view and uses the approval only on the same hash (static views too; fail closed, C202).
- **D3** `Receipt.holdReason` on hold rows of `tb.holds_list` and `tb.receipts_list` (§4.1).
- **D4** the hold keeps the redacted input sealed; standard person op `tb.hold_details` (owner only) shows it; it is wiped 7 days after the terminal status and never leaves unsealed (not in backups unsealed, not in the export) (§4.9). New types and constants: `HoldDetails`, `HoldDetailsInput`, `HoldInputState`, `HOLD_INPUT_STATES`, `HOLD_DETAILS_OP`, `HOLD_VIEW_MAX_CHARS`, `HOLD_VIEW_LIMITS`, `HOLD_SECRET_KEY_WORDS`, `HOLD_INPUT_REDACTED`, `HOLD_INPUT_MAX_BYTES`, `HOLD_INPUT_KEEP_DAYS`; `STANDARD_OPERATIONS` + `tb.hold_details`.
- **D6** UTC in hash-bound text and in `HoldDetails` times; UIs show the viewer's zone, with UTC in the details dialog (§4.8).
- No Portal holds page (C369 Q1): apps own holds; the cross-app list stays the Inbox "All approvals" (summaries only, §4.6).
