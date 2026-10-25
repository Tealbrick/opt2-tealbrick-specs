# MANIFEST — miniapp manifest v2 (`tealbrick.miniapp/2`)

Status: v0.1, Lead · Specs, 2026-10-11. Machine-readable: `manifest.schema.json` (structure), `types/manifest.ts` (types + vocabularies), `examples/notes.manifest.json`.

Scope: the manifest is the ONLY description of a miniapp: identity, discovery, runtime, operations, scopes, settings and key requirements, hooks, companions, unlocks, skills, harness hints, backups, artifacts, public routes and UI entry points. Portal Core, the bridge, the SDK, the GUI, the CLI and conformance read it through one validator package; nothing else describes an app. This file states every field's meaning and every cross-field rule (`M-*`) the validator enforces. The schema checks structure; the rules check what JSON Schema cannot. If this text and the schema disagree, the schema wins (CORE §0).

## Note v0.1.1 (C28)
On Railway one volume per service: the deploy recipe mounts the `data` volume and the backup directory is `<data mountPath>/backup`; the declared backup volume is merged into it.

## 1. Document

| Item | Rule |
|---|---|
| File | `tealbrick.manifest.json` at the app directory (the repo root of a single-app repo; one directory per app in a multi-app repo, §3). The SDK serves it verbatim at `GET <internalUrl>/tb/v1/manifest`; CI attaches the same bytes to the release. |
| Version | `schema: "tealbrick.miniapp/2"`, the only accepted value. No `legacy`/compat values, no negotiated version header (CORE §11). |
| Strictness | Every object is closed (`additionalProperties: false`), except the JSON Schemas inside `operations[].input/output`. No `x-` extensions. |
| Size | ≤ 256 KiB of JCS bytes; ≤ 128 operations. |
| Digest | `manifestDigest = "sha256:" + hex(sha256(JCS(manifest)))` over the whole document as served (RFC 8785, CORE §3). The Manifest Store keeps the verbatim document; the workspace config carries only the digest; the bridge fetches `/tb/v1/manifest` and checks the digest (CORE §13). |
| `version` | SemVer 2.0 (no build metadata). Its major is the licence major used by `isEntitled(workspace, product, major)`. |
| `sdkMajor` | The SDK major the app is built with. The SDK refuses to boot if it differs from its own major. Portal and the bridge accept apps whose `sdkMajor` is the current SDK major or the one before; older majors are removed by plan (CORE §11, CONFORMANCE version matrix). |

**Release info lives in the Release Registry, not here.** The manifest has NO `channel`, image reference, image digest, `releaseId`, `publishedAt` or upgrade rule. CI builds the image from `runtime.build` and writes a signed release record `{releaseId, productId = manifest.id, version = manifest.version, channel, manifestDigest, image@sha256, skills archive digest}`. A deployment points to a release id; the manifest is identical across channels.

| Rule | Check |
|---|---|
| M-DOC-1 | No key material, tokens or credentials in any string (PEM headers, JWS-shaped `eyJ…`, long `tb*_` tokens) → `secret_material`. |
| M-DOC-2 | Literal URLs (`scheme://`) only in `$schema`, `publisher.url`, `source.repo`, `artifacts[].url` and inside operation JSON Schemas → else `url_not_allowed`. |
| M-DOC-3 | No customer, workspace or instance identifiers (`<prefix>_<ULID>` per CORE §1) anywhere → `instance_id_in_manifest`. |

## 2. Vocabularies (defined once)

Declared as `as const` arrays in `types/manifest.ts` (package `@opt2-tealbrick/spec`) and re-exported by `@opt2-tealbrick/manifest`; Core, bridge, SDK, GUI and CLI import them and hold no literals of their own (CORE §7).

| Name | Values |
|---|---|
| CRUD actions | `create`, `read`, `update`, `delete` |
| Effects (ordered) | `read` < `write` < `outward` < `destructive` < `money` |
| Hold families | `first_contact`, `profile_change`, `live_call`, `destructive`, `money` |
| Agent modes | `free`, `bound` |
| Hook phases | `before`, `context`, `after` |
| Idempotency | `required`, `supported`, `none` |
| Audiences (declared once) | `agent` (any bridge caller: agent or companion app), `person` (the owner in the app UI). Bridge-only SDK calls (catalog, resolve, mark, scope summary) are bridge ops `POST /tb/v1/bridge/<bop>` with a bridge-op call proof (CREDENTIALS `CallProofBridgeOpClaims`, `verifyBridgeOpProof`), not an audience. |

Meaning of effects: `read` = no state change; `write` = changes app-internal state only; `outward` = reaches a third party (sends, posts, calls); `destructive` = deletes or irreversibly overwrites (an overwriting op MUST declare `delete` in `crud`, M-OP-3); `money` = spends or moves money (always held, CORE §7).

## 3. Identity and discovery

**Path bases (v0.1.11, C70).** Every file path in the manifest has exactly one base:

| Path | Base |
|---|---|
| `runtime.build.context`, `runtime.build.dockerfile`, `runtime.services[].build.context`, `runtime.services[].build.dockerfile` | the REPOSITORY ROOT (repo-relative): CI hands them to the image builder, which runs at the repo root. |
| `skills[].file` and every other app file the manifest names | the MANIFEST DIRECTORY (manifest-relative): the directory that contains `tealbrick.manifest.json`. |

A single-app repo keeps the manifest at the repo root, so both bases are the same directory. A multi-app repo keeps one manifest per app directory (e.g. `sample-gate/tealbrick.manifest.json`): there `build.context` is `sample-gate` and `build.dockerfile` is `sample-gate/Dockerfile` (repo-relative), while a skill is `skills/use-sample-gate/SKILL.md` (next to the manifest). No path may leave its base (`..` escapes are refused). `validateAppFiles(m, repoDir, manifestDir = repoDir)`, `tb-gen` and conformance check M6.paths follow this table.

| Field | Type / limit | Meaning |
|---|---|---|
| `id` | `^[a-z][a-z0-9-]{1,31}$` | Product id (CORE §1). Data only; no code branches on it. |
| `name`, `summary`, `description?` | ≤ 40 / ≤ 160 / ≤ 4000 chars | Catalog card, detail text (markdown), generated docs. |
| `publisher` | `{name, url?}` | Shown in catalog. |
| `source` | `{repo: https URL, license: SPDX}` | Public source repo and its open-source licence. |
| `icon` | `{svgPath, viewBox = "0 0 24 24"}` | One SVG path `d` string (path commands and numbers only). The GUI draws it in its own `<svg>` with brand colours; no markup or remote asset is ever rendered. |
| `discovery.category` | enum (schema) | Catalog grouping. |
| `discovery.intents` | 1–60 phrases, 3–80 chars | Search phrases ("add memories"). Core delivers them in the catalog; the GUI adds its own action intents. |
| `discovery.keywords` | ≤ 30 | Extra search terms. |

| Rule | Check |
|---|---|
| M-ID-1 | `source.license` is a valid SPDX expression; `NONE`/`NOASSERTION` refused → `license_invalid`. |
| M-ID-2 | Intents unique after trim + lower-case → `intent_duplicate`. |

- QA-SPEC55-1: `name` (1..40) has no control, format or other invisible character (`MANIFEST_NAME_PATTERN`, the persona rule's `INVISIBLE_CHAR_CLASS` without marker exceptions) → `manifest_invalid` otherwise.

## 4. Runtime

The app container is always built from source: `runtime.build {context, dockerfile}` (repo-relative, §3). CI pins the result by digest in the release record.

| Field | Meaning |
|---|---|
| `port` | Container HTTP port (1024–65535) on the private network. |
| `healthPath` | Default `/tb/v1/health` (SDK-served). |
| `resources {cpu, memoryMb}` | Requested size; input to the Railway cost estimate shown before deploy (Core sums app + selected services + volume sizes with its own price table). |
| `volumes[] {id, mountPath, sizeGb, purpose}` | `purpose: data` or `backup`. |
| `env[]` | Non-secret environment, each entry exactly one of `value` (literal or service template), `setting` (a non-secret setting key), `generate: "secret"` (see below). Names `^[A-Z][A-Z0-9_]{1,63}$`; `TB_*` and `RAILWAY_*` are reserved for the platform. |
| `services[]` | Companion containers in the same private network (below). |

`runtime.services[]` fields: `id` (kebab, used as private hostname stem), `title?`, exactly one of `image` (pinned `repo[:tag]@sha256:<64 hex>`, upstream unmodified) or `build` (thin layer built by the app's CI, e.g. FROM a pinned upstream image), `port`, `resources`, `volumes?` (data only), `health` (`{kind:"http", path}` or `{kind:"tcp"}`), `env?`, `when?` (setting condition, §7), `startOrder` (ascending; ties start in parallel; the app container starts last), `backup?` `{dump, restore, extension}` (argv run inside the service, §11), `helper?` `{port, paths[]}` (DECISION-LOG C6: an app-owned internal HTTP helper in the thin layer, started by the `tb-exec` wrapper, reachable only on the private network and only by its own app instance with an instance assertion (K8); never exposed through the bridge), `dropPrivileges?` (v0.1.7, C54; default `false`): when `true`, `tb-exec` chowns the service's data dir and drops to uid/gid 1000 before starting the upstream; leave `false` for upstream images that switch users themselves (e.g. Postgres). The app container always drops when started as root (SDK `startApp`, BSA-05).

Keys a service needs are the `settings.keys[]` whose `usedBy` names the service (one source; §7). `tb-exec` fetches them from the bridge with the service's own instance key and execs the upstream command with each key as an env var of the same name (CORE §10).

`generate: "secret"` ("not ours" per CORE I3, not a credential kind) asks the provider to generate a random value at first deploy (Railway: `${{secret(48)}}`) for credentials between an app and its own services (e.g. a database password). Portal never reads, stores or relays the value. Other containers reference it by `{{services.<id>.env.<NAME>}}`.

Env value templates (the only `{{…}}` forms allowed): `{{services.<id>.url}}` (`http://<private host>:<port>`), `{{services.<id>.host}}`, `{{services.<id>.port}}`, `{{services.<id>.env.<NAME>}}`. The deploy recipe omits an entry whose referenced service is not deployed (its `when` is false).

| Rule | Check |
|---|---|
| M-RT-1 | `runtime.volumes` has exactly one `purpose: backup`; service volumes are `data` only → `backup_volume`. |
| M-RT-2 | Volume ids unique across app + services; mount paths unique per container and not nested → `volume_conflict`. |
| M-RT-3 | Service ids unique and ≠ `app` → `service_duplicate`. |
| M-RT-4 | Env names unique per container; `setting` names a declared field; templates name a declared service, and `.env.<NAME>` names a `generate` entry of that service → `env_ref_invalid`. |
| M-RT-5 | An env name matching `SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL` must use `generate` or a `{{services.*.env.*}}` reference; no env name equals a `settings.keys[].name` (keys never travel through Portal or env) → `secret_env_literal`. |
| M-RT-6 | A service with `backup`, `helper`, or any key in its `usedBy` must use `build` (it needs the `tb-exec` entrypoint) → `wrapper_required`. |
| M-RT-7 | `helper.port` ≠ service `port` → `helper_port`. |
| M-RT-8 | `when` follows M-ST-3 (enum/boolean fields only). |
| M-RT-9 | `validateAppFiles` (CI, CLI, v0.1.11): each `build.context` is a directory and each `build.dockerfile` a file under the REPO root, none escaping it (§3) → `build_path_invalid`. |

## 5. Operations

### 5.1 Fields
| Field | Meaning |
|---|---|
| `id` | `^[a-z][a-z0-9_]{1,39}$`, not starting `tb_`. MCP tool name = `<product>__<id>`. |
| `title`, `description` | MCP tool title/description, OpenAPI summary, docs. |
| `input`, `output` | JSON Schema 2020-12 with `type: "object"`; local `$ref` only. JSON only: no file/binary inputs in opt2 (C11). |
| `crud` | Non-empty subset of CRUD actions. Checked by the bridge `gate()`: `op.crud ⊆ grant.crud`; by the app `authorize()`: `op.crud ⊆ grant.crud ∩ scope access.crud` (CORE §7). |
| `effect` | Separate field from `crud`. Drives holds, receipts, MCP annotations (`readOnlyHint` = read, `destructiveHint` = destructive). |
| `holdFamily?` | The family `authorize()` compares with `grant.held`. Free caps are Agent Policy values carried in the grant (CORE I14), never manifest fields; the app counts them per (agent, effect). |
| `scopeType?` | The scope type whose access applies (§6). |
| `idempotency` | `required`: caller must send an idempotency key; `supported`: optional; `none`. SDK keeps keys in the receipts table: same key + same input digest → same result; different input → 409 `idempotency_conflict`. |
| `receipt` | `true` → the SDK writes a receipt for every executed call (inputDigest + app-redacted summary, never raw bodies). |
| `audience` | `agent` → reachable through the bridge (MCP, relay, app→app), becomes an MCP tool. `person` → only from the app UI in a person session (launch ticket); never an MCP tool, never hooked, never a companion target. |
| `dynamic?` | Dynamic tool family (§5.3). |
| `secretOutput?` | v0.1.68 (C336 RQ-3, S-8): `true` = the output carries a secret (e.g. a short-lived credential). See M-OP-12. |

### 5.2 Rules
| Rule | Check |
|---|---|
| M-OP-1 | Ids unique. Every derived MCP tool name ≤ 64 chars (CORE I9): `<product>__<id>` for `agent` ops; for search mode also `<product>__<id>_search` and `<product>__<id>_call` → `tool_name_too_long`. List-mode entry names (`<product>__<entry.name>`) are checked by the SDK when it serves the catalog (same limit). |
| M-OP-2 | `effect = read` ⇔ `crud = ["read"]` → `effect_crud_mismatch`. |
| M-OP-3 | `delete ∈ crud` ⇒ `effect ∈ {destructive, money}`; `effect = destructive` ⇒ `delete ∈ crud` (so an irreversible overwrite declares `delete`, e.g. `["update","delete"]`) → `effect_crud_mismatch`. |
| M-OP-4 | `holdFamily`: absent for `read`/`write`; `= destructive` for `destructive`; `= money` for `money`; for `outward` one of `first_contact|profile_change|live_call|outward|identity|public_link` (v0.1.41 C232: `public_link` = the op makes agent-written content visible to people outside the workspace, e.g. a viewer link; it is in DEFAULT_HELD_FAMILIES; a manifest that declares it needs manifest ≥ 0.1.20, so its release states `requires.bridge`; v0.1.16 C107: every outward op DECLARES a family — absent is still accepted by the validator so older releases stay deployable; conformance `M2.outward_family` FAILS it from conformance 0.1.12; the validator refuses it once no deployed release lacks families (Coordinator decides)) → `hold_family_invalid`. |
| M-OP-5 | `create ∈ crud` ⇒ `idempotency = required`; `crud = ["read"]` ⇒ `idempotency ≠ required` → `idempotency_invalid`. |
| M-OP-6 | `effect ∈ {outward, destructive, money}` or `holdFamily` set ⇒ `receipt = true` → `receipt_required`. |
| M-OP-7 | `scopeType` names a declared scope; the union of that scope's `access[].crud` ⊇ `op.crud` → `scope_ref_invalid`. |
| M-OP-8 | Non-dynamic `agent` ops declare `input` and `output`. Embedded schemas: no remote `$ref`, no `$id`, no `contentEncoding`/`contentMediaType` → `io_schema_invalid`. |
| M-OP-9 | `audience = person` ⇒ no `dynamic` → `person_dynamic`. |
| M-OP-12 | v0.1.68: `secretOutput: true` ⇒ `audience = agent` (reached by APP callers through the bridge; agent callers are refused, SDK-API v0.1.68), no `dynamic`, `idempotency = none`, `receipt = true` (input digest + `redact` summary only) → `secret_output_invalid`. The manifest declares `requires.bridgeCaps: ["secret_output"]`. `effect` is the op's own; a credential lease is `read`, so default policy gating does not hold it — its audit is the receipt. |
| M-OP-10 | `dynamic` ⇒ `crud = ["read"]`, `effect = read`, no `holdFamily`, `idempotency = supported`, `receipt = false`, `audience = agent`, no `input`/`output`; `crudCeiling = ["read"]` ⇒ `effectCeiling = read` → `dynamic_invalid`. |

### 5.3 Dynamic operations (the engine-tool gap)
Some apps expose tool sets that are not known at build time: an engine with ~100 native operations that depend on the chosen engine version, or a connector catalog with thousands of third-party tools. Listing each as a manifest operation is impossible; one generic "call anything" operation would hide each tool's CRUD class and effect. A dynamic operation closes the gap with one mechanism (CORE §13):

- The manifest op declares the family and its ceilings: `dynamic: {mode, crudCeiling, effectCeiling}`. The op's own `crud`/`effect` (`["read"]`/`read`) describe discovery only.
- The app serves, through the bridge op `POST /tb/v1/bridge/catalog`, a catalog of `DynamicCatalogEntry {name, title, description, inputSchema, crud, effect, holdFamily?}` (types/manifest.ts). Each entry obeys M-OP-2…4 and the ceilings (`crud ⊆ crudCeiling`, effect ≤ `effectCeiling` in the effect order).
- `mode: "list"` (≤ 256 entries): the bridge shows each entry as its own MCP tool `<product>__<entry.name>` (names unique within the app, not colliding with static op ids).
- `mode: "search"`: the bridge shows `<product>__<op>_search` (input `{query, limit?}`, returns entries) and `<product>__<op>_call` (input `{tool, arguments}`).
- Every call goes to `POST /tb/v1/ops/<op>` with input `DynamicCallInput {tool, arguments}`. Before `gate()` and hooks the bridge resolves the concrete tool's `{crud, effect, holdFamily}` via the bridge op `POST /tb/v1/bridge/resolve` (cacheable 5 min) and gates, hooks, authorizes and receipts with the resolved values. The effect never comes from the agent. A resolution outside the ceilings → refuse `dynamic_ceiling_exceeded`; a resolved non-read call always gets a receipt.
- Wire details: BRIDGE.md and SDK-API.md.

### 5.4 Standard operations (every SDK app, automatic) and reserved names
| Id | Audience | CRUD / effect | Surface |
|---|---|---|---|
| `tb.hold_status` | agent | read / read | MCP `<product>__tb_hold_status` (poll a held call by `holdId`) |
| `tb.holds_list` | person | read / read | app UI (hold popup) |
| `tb.holds_decide` | person | update / write | app UI: approve or reject one hold, once (no standing grants, C8) |
| `tb.receipts_list` | person | read / read | app UI |
| `tb.agents_list` | person | read / read | app UI: slice agents with their scope access |
| `tb.scopes_set` | person | update / write | app UI (Configure): set one agent's access to one scope instance (audited) |
| `tb.keys_status` | person | read / read | app UI: key names, required, present, source (no values) |
| `tb.key_set` / `tb.key_delete` | person | update / write · delete / write | app UI: app-own keys only; values never returned or logged |
| `tb.export` | person | read / read | app UI: export archive (§11) |

Input/output shapes: SDK-API §6. The canvas scope summary is not a standard op: the bridge fetches it with the bridge op `POST /tb/v1/bridge/scope-summary` (≤ 80-char label per agent, no third-party identifiers) for its status report. `tb.hold_status` needs only a valid grant; agent edges need not include `read` (CORE I4); it returns only the caller's own holds and writes no receipt. Reserved: the `tb.` namespace (including the bridge-served read tool `<product>__tb_skills`, BRIDGE) and the `tb_` prefix for operation, hook, scope, step, setting, volume, unlock and artifact ids; `tb-` for service and skill ids; `TB_`/`RAILWAY_` env and key names; the `/tb/` path prefix inside the app (ui paths, public routes, helper paths). The schema enforces these patterns.

## 6. Scopes

A scope type is an app-declared sub-resource for grants (Connect: accounts; Knowledge: areas). Instances live in the app; the app is the authority for scope assignments (CORE §6). Portal stores only the edge CRUD + mode and shows the summary label; it never sees scope instances.

| Field | Meaning |
|---|---|
| `type`, `label`, `labelPlural` | Id and display names. |
| `access[] {id, label, crud}` | Access levels for this type, each mapping to a CRUD set. `authorize()` maps an assignment's level → `crud`. |
| `defaultGrants[] {kind, access}` | Assignments the SDK creates when an edge to a caller first appears (C1). `own` = the caller's own instance (the app creates it if absent); `shared` = instances the app marks shared (v0.1.13, Kanban QA S2: also applied when an instance BECOMES shared later — created shared or switched to shared — for every caller seen before; an existing assignment, i.e. an owner edit, always wins; re-saving an already shared instance never re-grants); `all` = every existing instance. An empty list = nothing until the owner assigns in Configure. |
| `summaryTemplate` | Used by the SDK default scope-summary bridge op (`/tb/v1/bridge/scope-summary`); variables `{count}`, `{label}`, `{labelPlural}`, `{access.<id>}` (count per level). Apps may override the summary in code; output ≤ 80 chars. |
| `summaryEmpty?` | v0.1.65 (C331 D5b): plain text (≤ 40 chars, no variables) the SDK default summary shows for an agent that has NO assignment of this type (Connect: "no account yet"), so the canvas line does not look ready when the agent can reach nothing. Absent = nothing for that type (the behaviour before v0.1.65). |

| Rule | Check |
|---|---|
| M-SC-1 | Types unique; access ids unique within a type → `scope_duplicate`. |
| M-SC-2 | `defaultGrants[].access` names an access id of the same scope; kinds unique within a scope → `default_grant_invalid`. |
| M-SC-3 | `summaryTemplate` uses only the listed variables with declared access ids → `template_invalid`. |
| M-SC-6 | v0.1.68 (RQ-4): an app MAY declare several scope types. The canvas edge to the app carries the FIRST declared type (primary; Core keeps one `scope_type` per edge); grants on the other types are set on the app's own scope page (`ui.configurePath`). |
| M-SC-4 | `scopes` non-empty ⇒ `ui.configurePath` present (scopes are edited in the app) → `configure_ui_required`. |
| M-SC-5 | v0.1.65: `summaryEmpty` is 1–40 chars and holds no `{` or `}` (no variables) → `template_invalid`. |

## 7. Settings and key requirements

Settings are non-secret values chosen at deploy (and later, if `mutable`). Core stores them per instance; they reach the app (and services) ONLY as env through `runtime.env[].setting`, written by the deploy recipe at (re)deploy. `instances.update {settings}` redeploys the instance. Settings are never in the instance slice (instance-slice.schema.json). A field no `env[].setting` references is a Portal-form value only and does not reach the app (M-ST-7). The deploy popup and settings form are generated from this section; the GUI has no per-app code.

- `steps[] {id, title, help?, when?, fields[]}`: array order is the popup order (Next/Previous). A step whose `when` is false is skipped.
- `fields[] {key, type, label, help?, required?, default?, choices?, min?, max?, maxLength?, pattern?, when?, mutable = true}`; `type ∈ string|text|integer|number|boolean|enum|url`. `choices[] {value, label, note?, disabled?}`: a disabled choice is shown greyed ("coming later").
- `when` (fields, steps, keys, services, skills): `{ "<setting key>": value | [values] }`, all entries must match (AND; array = one of).
- `keys[] {name, label, provider, help?, required, source, usedBy[], when?, step?}`: key requirements. Portal never receives values; it shows only the presence booleans the bridge reports per name. The popup shows each key in its `step` (else in a generated final "Keys" step) with a button that opens the bridge key page through a `pur: keys` ticket (CORE §10). `source: account_default` = served by the workspace bridge key store (GUI label "workspace default key"; the value stays `account_default`; J2 enters it once per workspace), and the app may also accept an app-own value, which then wins (SDK `getKey`); `source: app_own` = entered and stored only in the app's own UI. `usedBy` = `"app"` and/or service ids; the bridge serves a key only to the consumers named here.

| Rule | Check |
|---|---|
| M-ST-1 | Step ids, field keys (across all steps) and key names unique → `setting_duplicate`. |
| M-ST-2 | `type = enum` ⇔ `choices`; `default` matches the type and constraints; an enum default is a non-disabled choice; `url` has no default; `maxLength`/`pattern` only on string/text/url; `min`/`max` only on number/integer → `setting_invalid`. |
| M-ST-3 | `when` keys name an enum or boolean field; values are valid for it; on fields and steps only fields declared earlier (array order) may be referenced (no cycles) → `condition_invalid`. |
| M-ST-4 | A field key matching `secret|token|password|passwd|private|api_?key|credential` → `secret_setting` (declare it in `keys`). |
| M-ST-5 | `usedBy` items are `app` or declared service ids; `app_own` ⇒ `usedBy = ["app"]` and `ui.configurePath` present; `step` names a declared step → `key_invalid`. |
| M-ST-6 | A field referenced by any `services[].when` has `mutable: false` (changing it would add or remove containers) → `setting_must_be_immutable`. |
| M-ST-7 | Every field is referenced by at least one `env[].setting`, or by a `when` (fields, steps, keys, services, skills) or a skill `{{settings.<key>}}` → `setting_unused`. |

### 7.1 Model roles (v0.1.63; C322(3), C330(4))

`settings.modelRoles[] {role, required, minPolicy = "standard", usedBy[], env?, help?, when?}`: model roles the app or its services use. The workspace bridge resolves each from the owner's role registry (BRIDGE §15) and never serves a binding below `minPolicy`. Roles and policies: `MODEL_ROLES`, `DATA_POLICIES` (`packages/spec/src/models.ts`). "Chat" = `reasoning`.
- `required: true` → while the role is unset or below policy the app reports readiness `needs_keys` with `attention {code: "model_role_missing", reason}` naming the role(s) (the owner action is the same page). `required: false` → the app runs without it and MAY report `attention {code: "model_role_optional"}` (readiness `degraded`; the GUI opens the app) — e.g. Knowledge without `embeddings` = keyword recall. Codes: `MODEL_ROLE_ATTENTION`.
- Applying a binding: `env` (below) for services started by `tb-exec`; the env names are the service's own and need not be upstream env vars — a service boot script may map them to engine config (e.g. `gbrain config set models.tier.utility …`). API-configured engines (Open Notebook model registration, Foundry `PUT /provider`) are configured by the app from SDK `modelRole(role)` (`usedBy` `app`); a role may list both `app` and services.
- `embeddings` is special: an engine's index is built with one model and size. The app stores the model + `dims` it built with; when the resolved binding differs, it keeps using the stored one, reports `attention {code: "embeddings_changed"}` and re-embeds only after the owner approves (its own repair flow). With no `embeddings` binding at the engine's first start, the app initialises it without embeddings (e.g. GBrain `--no-embedding`) and adds them later the same way. Therefore an `embeddings` role's `env` names are the app's OWN names (e.g. `KN_EMBEDDINGS_MODEL`), read only by its boot script at the engine's first start, never the engine's run-time model variables: `tb-exec` restarts the service on every `keysRev` change, and an engine that reads its model from env at run time would embed queries with a new model against the old index. Keys likewise go to the provider's upstream env name chosen by the boot script per provider id.
- `minPolicy`: an app that reads sensitive data (Observer) declares `zdr` or `local` on every role.
- `env`: env names `tb-exec` fills for a SERVICE from the resolved binding (`provider`, `model`, `baseUrl`, `key`, `dims`). The app itself reads roles with SDK `modelRole(role)`.
- Keys a role uses are NOT declared again in `keys[]`; `keys[]` stays for non-model secrets and legacy apps.

| Rule | Check |
|---|---|
| M-MR-1 | `role` in `MODEL_ROLES`; one entry per role per manifest → `model_role_invalid`. |
| M-MR-2 | `minPolicy` in `DATA_POLICIES` → `model_role_invalid`. |
| M-MR-3 | `usedBy` items are `app` or declared service ids → `model_role_invalid`. |
| M-MR-4 | `env` only when every `usedBy` item is a service with `build` (the `tb-exec` entrypoint, as M-RT-6); env names unique across `runtime.env`, `keys[]` and all `modelRoles[].env` of that service; no name in `MODEL_ROLE_DENIED_ENV` (the host deny list `HOST_DENIED_ENV` — code loading, library injection, egress — plus `NODE_TLS_REJECT_UNAUTHORIZED`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `NPM_CONFIG_*`, `PYTHON*`, `GIT_*`; prefixes end with `*`) and no name ending in `_PROXY` (sdk#52 QA S4-3, QA-SPEC54-4: such a name would re-add a proxy, a loader or a TLS-trust change with a role value after `tb-exec` stripped it) → `model_role_invalid`. |
| M-MR-5 | `when` as for keys (M-ST-3) → `condition_invalid`. |

## 8. Hooks

A hook subscribes one of this app's handlers to the bridge chain (CORE §8). The handler is addressed by hook id: `POST <internalUrl>/tb/v1/hooks/<hookId>`; a hook is not an operation and never an MCP tool.

| Field | Meaning |
|---|---|
| `id`, `title` | Id; title shown on the canvas, where the owner may disable each subscription. |
| `phase` | `before` (gate `{allow, reason?}`), `context` (adds `{ "<product>.<key>": JSON }`), `after` (`{output?, redactions?}`). |
| `order` | Integer −1000…1000. Chain: before → context → target → after; within a phase ascending `order`, then product id. |
| `match {products, operations?, effects?}` | Target calls the hook sees; all present criteria must match. `products: ["*"]` = every product. Dynamic calls match on the resolved effect. |
| `timeoutMs` | ≤ 2000 (default 2000). `before`/`context` error or timeout → the call is refused (fail closed). `after` failure → output withheld, receipt marked `after_failed`. |

Hooks match only `agent`-audience manifest operations reached through the bridge; never standard `tb.*` ops, person ops or hook calls (hook calls never trigger hooks). Core resolves chains into the workspace config; a subscription is active once the declaring app is deployed and licensed (CORE §13).

| Rule | Check |
|---|---|
| M-HK-1 | Ids unique → `hook_duplicate`. |
| M-HK-2 | `"*"` appears alone in `products` → `hook_match_invalid`. |
| M-HK-3 | `operations` only when `products` is exactly one product id; for the own id the ops exist with audience `agent` (other products: checked by Core at chain resolution) → `hook_match_invalid`. |

## 9. Companions, unlocks, agent directory

- `companions[] {product, operations, crud, purpose}`: app→app needs. For each entry Core mints the ONE grant (K10) with `sub = tb:ins:<this>`, `aud = tb:ins:<target>`, `crud = crud`, `mode = bound`, `wf = operations` (CORE I8), once both apps are deployed in the workspace (licence rule per CORE §6). `purpose` is shown on the canvas.
- `unlocks[] {id, title, requires, provides {operations?, skills?}}`: features of THIS app that exist only when the companion product `requires` is deployed in the same workspace. The bridge hides the listed operations from MCP lists and Core leaves the listed skills out of the bundle until then. Unlocks are never licence features: the licence gates only Portal management in Core (deploy, grants, launch, updates); an app behaves the same licensed, unlicensed or self-hosted. No manifest field expresses "licence-only features".
- `needsAgentDirectory` (default false): the instance slice lists all workspace agents, not only those with an edge (CORE §13). QA-SPEC49-26: an agent WITHOUT an edge to the app carries `edge: false` in that slice (absent = has an edge), so the app can tell a directory entry from a caller.

| Rule | Check |
|---|---|
| M-CP-1 | Companion products unique and ≠ own id → `companion_invalid`. |
| M-CP-2 | `validateCompanions(m, targets)` (Core at deploy, conformance): target ops exist with audience `agent`; each `op.crud ⊆ crud`; `crud ⊆ ∪ op.crud` → `companion_op_invalid`. |
| M-CP-3 | v0.1.13 (G4, C82): `product: "*"` (wildcard companion) only with `operations` exactly `["tb.holds_pending"]` and `crud` exactly `["read"]`; the standard op `tb.holds_pending` is the only standard op a companion may name (also for one product) → `companion_invalid`. A wildcard companion is never granted by the manifest alone: Core mints one grant per deployed, licensed app (and for apps deployed later) only after the owner's explicit consent (PORTAL-API `instances.consent`), and deletes them all on revoke. |
| M-UL-1 | Unlock ids unique; `requires ∈ companions[].product`; `provides` names own operations / skills → `unlock_invalid`. |

## 10. Skills and harness hints

- `skills[] {id, title, file, when?}`: `file` is a manifest-relative `SKILL.md` (relative to the directory of the manifest file, §3; not to the repo root) (YAML frontmatter `name` = id, `description`; markdown body). Allowed variables: `{{agent.name}}`, `{{agent.id}}`, `{{workspace.name}}`, `{{settings.<key>}}`, `{{scope.<type>.<kind>}}` (label of the caller's default-grant instance of that kind). CI packs the files into the release's skills archive (`skillsDigest` in the release record, C17). Content is sanitized once: `validateAppFiles` in CI for app files, and Core's render for owner overrides; the bridge does no content filtering. One function `renderSkill(file, vars)` in `@opt2-tealbrick/manifest` substitutes variables; Core uses it for the workspace bundle (workspace variables, owner overrides) and the bridge for per-agent variables `{{agent.*}}` only. The bridge and serves skills as MCP resources plus an index in `initialize.instructions` (CORE §13).
- `harnessHints[] {harness, instructions ≤ 1000}`: short plain-text notes per harness kind (`generic` applies to all). They feed the generated instruction set and kit README. No harness-specific code, config or commands.

| Rule | Check |
|---|---|
| M-SK-1 | Skill ids and files unique; `when` per M-ST-3 → `skill_invalid`. |
| M-SK-2 | `validateAppFiles` (CI, CLI): each file exists (resolved from the manifest directory, §3), frontmatter matches, only allowed variables, `{{settings.<key>}}` names a declared field; content sanitized (no raw HTML/script, no MCP-directive or tool-call markup, ≤ 64 KiB) → `skill_file_invalid`. |
| M-HH-1 | One hint per harness kind → `hint_duplicate`. |

## 11. Backups and export

The SDK backup runner (inside the app container) runs on `backups.schedule` (5-field cron, UTC) and keeps `retain` archives on the backup volume. One archive `tb-backup-<UTC timestamp>.tar.gz` contains: `meta.json` (product, version, manifestDigest, sdk version), the SDK-managed database (app tables, receipts, holds, idempotency keys), each `backups.files[] {volume, path}` (paths in app data volumes), and one `services/<id>.<extension>` per deployed service with `backup`, produced by running `backup.dump` inside the service through `tb-exec` and streaming stdout over the private network. Restore runs `backup.restore` with the file on stdin. A restore test is part of conformance.

`tb.export` produces `tb-export-<timestamp>.tar.gz`: `meta.json` + one JSONL file per exported table (SDK database) + `receipts.jsonl`, written to the backup volume and downloadable from the app UI. The export format is SDK-defined and the same for every app; there is no manifest field for it.

| Rule | Check |
|---|---|
| M-BK-1 | `files[].volume` names an app `data` volume; cron fields in range → `backup_invalid`. |

## 12. Artifacts, public routes, UI

- `artifacts[] {id, version, sha256, url}`: pinned data the app downloads (e.g. a connector catalog). Assets are GitHub release assets of the app repo; the app verifies `sha256` before use.
- `publicRoutes[] {path, purpose}`: the bridge exposes only these at `https://<bridge>/p/<product><path>`, unauthenticated; the app verifies them (OAuth `state`, provider signature). `oauth_callback` accepts GET; `webhook` accepts POST.
- `ui {launchPath, configurePath?}`: paths under `https://<bridge>/a/<product>/`. A launch ticket opens `launchPath` (double-click on the canvas opens `configurePath` if present). This is the only settings/frontend entry the GUI needs; a new app needs zero GUI change. No `ui` → the app has no person UI: no double-click, no Configure, no launch ticket (the GUI hides them).

| Rule | Check |
|---|---|
| M-AR-1 | Artifact ids unique; `url` starts with `<source.repo>/releases/download/` → `artifact_invalid`. |
| M-PR-1 | Public route paths unique → `route_duplicate`. |

## 13. One validator package

`@opt2-tealbrick/manifest` (REPOS.md) is the only implementation, used by Core (Manifest Store, catalog, deploy), the SDK (boot), the bridge (config apply), the CLI and conformance. Nobody re-implements a rule. Surface: `validateManifest(input): ManifestValidation` (schema + all `M-*` rules; issues `{path (RFC 6901), rule, code, message}`), `manifestDigest(m)`, `validateCompanions(m, targets)`, `validateAppFiles(m, repoDir, manifestDir = repoDir)` (CI/CLI only), `renderSkill(file, vars)` (§10), the vocabularies (§2), plus `verifyGrant`, `verifyBridgeOpProof`, `gate`, `authorize` (CORE §7). Warnings do not exist: a rule passes or the manifest is refused.

## 14. Generated artifacts (no hand-written copies)

| Artifact | Generated by | From |
|---|---|---|
| MCP tools (names, schemas, annotations) | bridge at run time | operations, dynamic catalogs, unlocks, grants |
| OpenAPI 3.1 (`GET /tb/v1/openapi.json`, docs) | SDK | operations, standard ops |
| Portal deploy popup + settings forms | GUI from Core catalog | settings, keys |
| Catalog entry, cost estimate | Core | identity, discovery, runtime, ui |
| Deploy recipe (Railway services, volumes, env, order) | Core | runtime |
| Per-app kit package (typed client + README for SDK harnesses) | SDK codegen in app CI | operations, harnessHints |
| Skills bundle inputs | app CI → Core | skills |
| Docs (operations, settings, scopes reference) | SDK codegen | whole manifest |

Hand-written OpenAPI files, `recipe.json`, extra `manifest.json`, status/bootstrap descriptors, operation lists in the GUI or Core, or copied settings forms are forbidden. Conformance runs a drift check (generated = manifest) in the one CI pipeline.

## 15. Examples (illustrative only — not products)

The full EXAMPLE is `examples/notes.manifest.json` (generic notes app: 7 agent ops + 1 person op, one scope with defaults, settings with a conditional step and a greyed choice, an account-default key, a companion service with a generated secret, a hook, a companion + unlock, skills, backups, an artifact, a webhook, UI). It validates against `manifest.schema.json`.

EXAMPLE fragment — scope with tiers (Connect-like):
```json
{ "type": "account", "label": "Connected account", "labelPlural": "Connected accounts",
  "access": [
    { "id": "read", "label": "READ", "crud": ["read"] },
    { "id": "read_update", "label": "READ/UPDATE", "crud": ["read", "create", "update"] },
    { "id": "read_update_delete", "label": "READ/UPDATE/DELETE", "crud": ["read", "create", "update", "delete"] } ],
  "defaultGrants": [],
  "summaryTemplate": "{count} {labelPlural}" }
```
EXAMPLE fragment — dynamic search op (thousands of third-party tools):
```json
{ "id": "tools", "title": "Third-party tools", "description": "Search and call connected service tools.",
  "crud": ["read"], "effect": "read", "scopeType": "account", "idempotency": "supported",
  "receipt": false, "audience": "agent",
  "dynamic": { "mode": "search", "crudCeiling": ["read", "create", "update", "delete"], "effectCeiling": "money" } }
```
MCP: `connect__tools_search`, `connect__tools_call`. EXAMPLE list mode (engine ops): `"dynamic": {"mode": "list", "crudCeiling": ["read","create","update"], "effectCeiling": "write"}` → one MCP tool per engine operation.

## Checklist mapping (SPEC-REVIEW-CHECKLIST § MANIFEST)
| Checklist line | Answered in |
|---|---|
| CRUD class AND effect as separate fields | §5.1, M-OP-2…4 |
| Manifest is the only place for ops, scopes, settings/keys, hooks, skills, hints, unlocks, backups | Scope, §4–§12, §14 |
| Every generated artifact listed; hand-written copies banned | §14 |
| Scopes app-declared; edge = CRUD + declared scope only | §6, §9 (companion grant) |
| Hold families and Free/Bound vocabulary from manifest/SDK | §2 |
| Hooks: phase, order, before fails closed | §8 |
| Settings/frontend entry the GUI opens | §12 `ui` |
| Keys: account default vs app-held, no values to Portal | §7 keys, M-RT-5, M-ST-5 |
| Discoverable engine tool list with per-tool class | §5.3 |
| One schema version, no legacy, no negotiated header, SDK current+1 rule | §1 |
| One validator package for Core, SDK, bridge, conformance | §13 |
| No product name inside the schema | `manifest.schema.json` (product names only in §15 examples) |
| Idempotency and receipt declared per operation | §5.1, M-OP-5, M-OP-6 |

## Open questions
None. v0.1 review items applied: S6 (§7), S8 + N6 (§10, §13), N1 (§2, §5.4), N4 (schema `$id`), N7 (§2, M-OP-3), N9 (§12), N13 (§7). v0 questions resolved in CORE §14 (I3, I8, I10; `tb-exec` static binary owned by SDK-API; hook handlers addressed by hook id; skills-archive digest filed with Lead · Platform by the Coordinator).

## v0.1.3 additions (C35, Lead · Specs SPEC-GAPs 1, 11)
- `runtime.env[].value` may use the template `{{services.<id>.url}}`; Core's deploy recipe renders it to that service's private URL. It is how an app (and `callServiceHelper`) learns a companion service's address.
- Validator codes added to the rule table: `operation_duplicate`, `manifest_too_large` (rule M-DOC-0, 256 KiB), `schema_invalid` (rule `schema`), `hand_written_artifact`. SPDX: an embedded open-source id list; `LicenseRef-*` refused. A setting's default is not matched against its app-supplied `pattern` by Core (ReDoS guard); the pattern must compile.
- `tb-exec` reads the manifest from `--manifest <path>` (default `/opt/tb/tealbrick.manifest.json`); service images copy the app manifest there.

## v0.1.11 additions (C70)
- Path bases (§3, §4, §10): build paths (`runtime.build`, `runtime.services[].build`) are repo-relative; skill files and other app files are manifest-relative (relative to the directory that contains the manifest file). `validateAppFiles(m, repoDir, manifestDir = repoDir)` resolves build paths from `repoDir` and skill files from `manifestDir`; `tb-gen` takes the same two directories (`--repo <dir>`; manifest dir = directory of `--manifest`); conformance check M6.paths asserts it. New rule M-RT-9, code `build_path_invalid` (`validateAppFiles` only): a build context is not a directory, or a Dockerfile is not a file, under the repo root.

## v0.1.14 additions
- `scopes[].defaultGrants[].callers?` (`agent` | `app`, ≥ 1, unique; default both): which caller types a default grant applies to (Connect Q-C2: an apps-only shared sender scope).
- §12: `ui.configurePath` stays optional; Core's catalog exposes `hasUi` (Open) separately from `hasConfigureUi` (configure screen).

## v0.1.15 additions (C104, queued)
- v0.1.68 (C354): `requires.bridgeCaps?: string[]` — the bridge capabilities (BRIDGE_CAPS) the release needs, e.g. `secret_output`, `hook_tool`, `lazy_tools`, `model_roles`. Core refuses to deploy the release onto a workspace bridge whose declared caps lack one (`bridge_cap_missing`, `details.cap`). Feature gates use capabilities, never bridge version numbers: versions are assigned at merge time (C352), so no package hard-codes "the first bridge version with X". A manifest with a `secretOutput` op MUST list `secret_output` (validator: `secret_output_invalid`).
- `requires {bridge?: semver}` (optional): the minimum workspace bridge version for features the validator cannot see (a before hook that answers `hold` needs ≥ 0.1.17 — DECLARED by such apps; "any before hook → 0.1.17" was rejected as too strict: an older bridge treats a hold answer as an invalid hook answer → refuse, fail closed, so the declaration is about the feature, not safety). The release signer records `requires.bridge` = max(this, the feature table of `requiredBridgeVersion`): dynamic ops ≥ 0.1.15 (C91 catalog binding), wildcard companion or `tb.holds_pending` as a companion op ≥ 0.1.16. One function in @opt2-tealbrick/manifest; the signer and Core never keep their own table (L1).

## v0.1.16 additions (C107)
- Hold families: `outward` (messages, posts, reactions, edits to existing contacts or channels) and `identity` (changes to the agent's public identity). `DEFAULT_HELD_FAMILIES` = destructive, money, first_contact, identity (`outward` known, not held by default; Free-card caps still apply; the owner can turn on "ask me before every message").
- Dynamic ops: a `resolve` answer (`DynamicResolution`) whose effect is `outward` or `money` MUST carry a `holdFamily` (`money` → `money`; outward → one of the outward families). Connect resolves a Gmail/Composio send as `outward` (the owner's READ-UPDATE tier is the consent) and a first message to a new recipient as `first_contact` where it can know it.

## v0.1.42 — shared app-to-app contracts (C230, owners' review 2026-10-17)
- `contracts?: {produces?: ContractId[], consumes?: ContractId[]}`; ids `<name>/<major>` from `CONTRACT_IDS` (`messages/1`, `fleet.directory_feed/1`). Each contract is a JSON Schema in `@opt2-tealbrick/spec/schemas/contracts/<name>.<major>.schema.json` with a fixture (`examples/contracts/<name>.<major>.json`: `valid`, `invalid`, and for handle-carrying contracts `invalidByNormalizeHandle`). A released major never changes; a breaking change is a new major, and producers serve both during the deprecation window (handbook §9).
- Readers validate what they read against the pinned schema; a mismatch is a refusal with an error, never a partial read (RUL-02). Extra members are ignored (L24). Handles must also satisfy `normalizeHandle(h) === h` (@opt2-tealbrick/manifest ≥ 0.1.19).
- A manifest that uses `contracts` needs manifest ≥ 0.1.20 (strict schema): its release states `requires.bridge` of the first bridge that pins it.
- Producers / consumers today: `messages/1` — connect produces (data_pull dataset `messages`), knowledge + observer consume; `fleet.directory_feed/1` — fleet (Governance) produces, rules consumes (Rules 0.3.0).

## v0.1.43 — viewer routes (LA-1, C232) and workflow-only ops (LR-1, C234)
- M-PR-2: `publicRoutes[].purpose: "viewer"` — at most one per manifest; `path` = `/v`; it is served ONLY by the workspace views service (tb-views, the bridge image in `TB_ROLE=views`) at `https://<viewUrl>/v/<product>/…`; the bridge main and keys origins answer 404 for `/v/*`. The segment `_d` right after `/v/<product>/` is reserved for untrusted documents: tb-views answers 502 `viewer_document_unsafe` for a `/_d/` response whose `Content-Security-Policy` lacks `sandbox` or whose sandbox allows `allow-same-origin`, `allow-top-navigation`, `allow-top-navigation-by-user-activation`, `allow-popups`, `allow-forms` or `allow-modals` (union of all CSP headers). Request headers forwarded: `Accept`, `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `If-None-Match` only (absent stays absent). `VIEWER_HEADER_FLOOR` (@opt2-tealbrick/manifest) is set on every views response; it has no `X-Frame-Options` — the app controls framing with CSP `frame-ancestors <viewUrl> <publicUrl>`, the one header it may replace. Slice `bridge.viewUrl` / SDK `ctx.viewUrl` carry the views origin (null until Core creates tb-views; the app answers `view_origin_missing` 409).
- M-OP-11: `operations[].listing: "workflow"` (agent ops only; `person` ops refuse it → `listing_invalid`): the op is in tools/list and passes `gate()` only when the grant's `wf` names it; other cards never see it. Readers that predate it show the op as before, so an app keeps its own guard until every bridge it runs on pins manifest ≥ 0.1.21 (L26; release `requires.bridge`).
- A manifest that uses `purpose: "viewer"` or `listing` needs manifest ≥ 0.1.21 (strict schema): its release states `requires.bridge`.

## v0.1.57 — app events (§16; C274c, C274d)
Wake is a platform primitive: an app DECLARES the events it emits, the SDK writes them through a transactional outbox
(`ctx.emit`, SDK-API §20), the bridge stores one log per agent and delivers it on the agent's existing `/mcp` session
(BRIDGE §14). There is no per-agent or per-app event setting anywhere: an agent receives exactly what its grants let it see.

### 16.1 Field
`events?: EventDecl[]` (≤ 64), each `{name, title, description?, payloadSchema, visibleWith, audience}` (types/manifest.ts):

| Field | Meaning |
|---|---|
| `name` | `^(?!tb\.)[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, ≤ 64, e.g. `issue.assigned`. Wire type = `<product>.<name>`. |
| `title`, `description?` | Shown in `tealbrick/events/list` and docs. |
| `payloadSchema` | JSON Schema 2020-12, object root. The payload carries ids and enums only, never record bodies (C274d ruling 2); ≤ 2 KiB per event (JCS, checked by the SDK and the bridge). |
| `visibleWith` | An `agent` op of this manifest, not dynamic. The visibility rule of the event (§16.2). |
| `audience` | `target` = only the agents the emit names (`to`); `granted` = every agent that passes §16.2. |

There is no `scoped` field: an event is SCOPED exactly when its `visibleWith` op has a `scopeType` (a declared flag could
disagree with the op; a derived one cannot). A scoped event names one instance of that type (`instanceId`).

| Rule | Check |
|---|---|
| M-EV-1 | Names unique within the manifest; pattern above; any `tb.` name refused (the `tb.` event namespace is the platform's: `PLATFORM_EVENTS`, types/bridge.ts); a manifest whose `id` is `tb` declares no events (its wire types would read as platform types) → `event_name_invalid`. |
| M-EV-2 | `payloadSchema` compiles (Ajv 2020, strict), object root, ≤ 8 KiB (JCS); embedded-schema limits of M-OP-8 (no remote `$ref`, no `$id`, no `contentEncoding`/`contentMediaType`) → `event_schema_invalid`. |
| M-EV-3 | `visibleWith` names an op of this manifest with `audience: agent` and no `dynamic` → `event_visible_with_invalid`. |
| M-EV-4 | `payloadSchema` declares no top-level `summary` property (the summary travels in the envelope, set by `ctx.emit`, ≤ 280 chars) → `event_schema_invalid`. |

### 16.2 Visibility (normative) — "visible = could call `visibleWith` now"
An event reaches agent A only when ALL of these hold, checked when the bridge stores it AND again when it delivers it:
1. **Grant (bridge, the tools/list rule, BRIDGE §7.2):** A has a valid grant to the app's instance, the `visibleWith` op is
   an agent op, and the `wf` rule passes (Bound grants, `listing: "workflow"`). Crud: `op.crud ⊆ grant.crud` (effective) —
   except for a scoped event whose `eligible` entry for A says `authority: "owner"` (the C283 A1 rule: an owner-set primary
   row admits above the Portal grant, exactly as `gate()` does for scoped ops on a bridge with `owner_rows`).
2. **Scope row (app, scoped events only):** the app is the authority for scope rows (CORE §6; the bridge never sees them).
   The SDK computes, when it SENDS the event, `eligible` = the agents with a row on (`scopeType`, `instanceId`) whose
   EFFECTIVE crud (`ScopeGrantRow.crud`, C283c) ⊇ `visibleWith.crud`, each with that row's authority. No best-access
   fallback and no "spans instances": an event is about one instance. The bridge never delivers a scoped event to an agent
   outside `eligible`.
3. **Not the cause:** A ≠ `causedBy` (the SDK sets it from the call; app code cannot).
4. **Audience:** `target` → A ∈ `to`.
5. **Pause:** while A, the workspace or the app instance is paused, A's rows are KEPT and not delivered; delivery resumes
   on resume (retention still applies; an instance pause re-ids the held rows on release, BRIDGE §14.2, so a cursor that
   moved past them meanwhile still gets them). Every other failed check at delivery DROPS the row (grant revoked or narrowed).
6. **Hooks:** hooks run on `visibleWith` calls but not on events. When an enabled `before` or `after` hook matches the
   `visibleWith` op (BRIDGE §8.1 steps 6 and 12: it may refuse, hold or redact what the op shows), the bridge delivers the
   event WITHOUT `summary` (ids only); the agent reads the details through the op, where the hooks run. A wildcard hook
   (e.g. a Rules policy hook on `products: ["*"]`) therefore strips every summary in that workspace: runtimes MUST NOT
   depend on `summary`. Accepted residue: an agent a before-hook would refuse still receives the event's ids and timing
   (not its content); the hook runs when it tries to read.

The SDK and the bridge can only see `authorize()` (CORE §7). A handler that refuses agents for its own reasons (beyond
`authorize()`) is invisible to both: **an app MUST NOT emit an event to an agent that its `visibleWith` handler would refuse
for that instance.** For a target event the app names in `to` only agents that its handler admits (e.g. the owner agent
of the instance); the bridge still intersects with `eligible`. The summary may contain only what `visibleWith` would show
that agent (C274d ruling 2). A summary that contains third-party text (a message body, a sender's display name) MUST set
`untrusted: true` (the same marker the ops put on such content); runtimes treat it as data, never as instructions.

Revocation: the bridge re-checks rule 1 at delivery, so a Portal grant change applies at once. A scope-row change is the
app's: when a row of A on an instance is removed or its effective crud narrows (`tb.scopes_set`, `ctx.scopeGrants`,
`ctx.scopeSelfRevoke`), or its authority changes from `owner` to `bounded`, the SDK sends a `purge` for (A, instance)
through the same ordered outbox, and the bridge deletes A's stored events of that app and instance, delivered or not. When
the app deletes or disconnects an instance it calls `ctx.purgeEvents(instanceId)` (a purge for every agent). A level
narrowed by an app update (C283c, no row write) sends no purge: such events stay until retention, and they expose at most
their summary (every detail read is authorized per call).

**Connect accounts (the settled case, C274d open point).** Connect's scope type is `account`.
- A CHANNEL account (Slack/Teams/Telegram/Discord bot) belongs to one agent: `channel_conversations` refuses every other
  agent (`scope_denied`, "This channel bot belongs to another agent"), whatever its row says. So a channel event is scoped
  (`visibleWith: "channel_conversations"`, scopeType `account`, `instanceId` = the account id) AND `audience: "target"` with
  `to: [account.ownerAgent]`; the bridge also requires that agent in `eligible` (its row on that account admits `read`).
  A row alone never makes a channel event reach an agent. Summaries with message text set `untrusted: true`.
- Connect calls `ctx.purgeEvents(accountId)` when it disconnects or deletes an account or changes its owner agent (the old
  owner keeps nothing).
- Mail and tool accounts (`channel_conversations` answers 404 for them) name their own `visibleWith` op when they get
  events; none in the first wave.
- The workspace sender instances `sender:<service>` are shared and app-only: the manifest default (`shared` → `apps_only`,
  no `callers`) gives every caller, agents included, an `apps_only` row with crud read/create/update, and only the handler
  refuses agents (`sender_reserved_for_apps`). The row check would therefore admit agents, so **Connect MUST NOT emit any
  event with `instanceId` `sender:*`**. Recommended with its first events release: `callers: ["app"]` on that default grant
  (v0.1.14), so new agents get no row at all.
- Buzz events (`buzz.mention`, `buzz.dm`) are about the agent's own Buzz identity, not an account row: unscoped,
  `visibleWith: "buzz_read"`, `audience: "target"` (the mentioned agent).

### 16.3 Platform events and compatibility
- `tb.hold.decided` (types/bridge.ts `PLATFORM_EVENTS`): emitted by the SDK for every app when a hold is approved, denied
  or expires; `to` = the hold's AGENT caller only (app callers receive no events in v1); visibility = `tb.hold_status`
  (any valid grant to the app, CORE I4); data `{holdId, op, decision: "approved"|"denied"|"expired"}`.
- A manifest with `events` needs manifest ≥ 0.1.30 (strict schema) in EVERY reader: Core's catalog sync validates each
  release manifest with its pinned validator and SKIPS a release it refuses, and each bridge validates at claim. So Core
  re-pins manifest ≥ 0.1.30 before any app release with `events` is published, and `requiredBridgeVersion` gains the row
  "events declared → bridge ≥ 0.2.7" (the first bridge that pins it and declares the `events` cap), which Core's C104 gate
  already applies at deploy. Consequence: an app release WITH `events` cannot deploy to a workspace whose bridge is older
  than 0.2.7; the app ships it after bridge 0.2.7 is available on that channel (not "harmless before the bridge").
- The CI template's `release-record` step and the registry signer validate app manifests too (both pin manifest 0.1.12
  today, platform `ci/README.md`): they re-pin manifest ≥ 0.1.30 (+ spec 0.1.57) in a new template tag, with the documented
  dry run (every indexed app manifest re-validates with an unchanged `manifestDigest`), before any app release declares
  `events`; otherwise that release fails its own pipeline and the signer.
