# CLI — the `tealbrick` command line (owner mode, agent mode, local bridge)

Status: v0.1, Lead · Specs, 2026-10-11. Package `tealbrick` (CLI binary) in repo `opt2-tealbrick-bridge`, owned by Lead · Bridge & Harness; specified here. Authority: PRD-V2 > DECISION-LOG > CORE.md > this file. Route op ids are those of `types/routes.ts`.

Scope: every command of the `tealbrick` CLI, the two credentials it holds (owner = person K3, agent = K4) and how they stay apart, the local bridge relay (C5), harness connection output, the own-infrastructure bridge, machine-readable output for a local operator session (owner self-setup, J3), and the mapping of each mutating command to a route-registry op or a bridge endpoint. The CLI holds no policy and no API of its own: it calls Portal route-registry ops (owner mode) or the deployed bridge (agent mode), and it runs the `@opt2-tealbrick/bridge` package (relay or full form).

## 1. Rules (normative)
1. **Two modes, two credentials, never mixed.** Owner mode uses only keychain item `tealbrick.person` (K3, opaque `tbo_`). Agent mode uses only items `tealbrick.agent.<con>` (K4 private key; the CLI always uses key connections, C16 S9). Owner commands never load an agent item; agent commands, the relay and `connect` never load the person item. A K3 is never sent to a bridge; a K4 assertion / K5 is never sent to Portal owner routes. A command run with the wrong kind fails with exit code 4 (`wrong_credential_kind`) before any network call (CREDENTIALS R-P1, §12).
2. **Owner mode = drafts + reads.** Every owner write is a draft step (`draftable` rows of `types/routes.ts`) applied later by the owner in the browser with one confirmation (`drafts.apply`, browser only). The only owner-mode calls that change server state directly are the sign-in device flow, `drafts.create|update|submit|import` and `owner_sessions.logout`.
3. **No CLI-only API.** Each mutating command maps to one route-registry op or one documented bridge endpoint (§9). Local-only commands (config writes, key generation) say so.
4. **Harness config is printed by default.** Writing happens only with `--write`, after a diff and a confirmation; never at launch, never as silent repair (CORE §13).
2a. **No tickets, no codes for K3.** K3 never obtains any K11 (launch or keys ticket), pairing code or enrolment code; no owner-cli-reachable output type carries one (route-table compile check, C16 B4/S1). Opening an app or the key page, approving holds, issuing codes: the CLI (and TBD) only print or open the Portal URL in the system browser, where the owner acts with K1.
2b. **Boundary = the OS user.** Any process of the same OS user can run `tealbrick` with the person item; K3 stays harmless by rule 2/2a (reads + drafts only, idle timeout 24 h, absolute 30 d). Where the OS supports it, the person item is stored with a user-presence keychain ACL (macOS: `kSecAccessControlUserPresence`; Windows Hello where available), so each use after the cache window asks the owner. On a machine where agents have a shell, run agents under a separate OS user (stated in `tealbrick login` output).
5. **No policy in the CLI or harness adapters.** All checks run in the deployed bridge (CORE §9). `harness-claude` and `harness-eve` only display what the bridge returns (e.g. a held call) and poll as told; they never decide, approve or cache grants.
6. **Not shipped:** no Eve setup wizard, no `app claim` / bindings, no Codex or LangChain stubs, no compat commands or legacy headers, no publish to the `tealbrick` / `@tealbrick/*` npm names (REPOS §5: GitHub-release tarballs only).

## 2. Global conventions
| Item | Rule |
|---|---|
| Invocation | `tealbrick <group> <command> [args] [flags]` |
| Portal origin | `--portal <url>` or env `TB_PORTAL_URL`; default = the release's build-time Portal origin. `https` only (`http` only for loopback, conformance). |
| Workspace | `--ws <ws_…>` or env `TB_WORKSPACE`; else the account's current workspace (`account.me`). Local selection only. |
| Agent selection | `--agent <agt_…>` or env `TB_AGENT`; required when more than one agent item exists on the machine. |
| Machine output | `--json` on every command: exactly one JSON value on stdout; success = the command's result object; failure = CORE §8 envelope `{ "error": { code, message, requestId } }`. Human text goes to stderr. Field names are stable within a CLI major. |
| Secrets as input | codes and keys are read from `--code -` (stdin) or a TTY prompt; never echoed, never logged; a code on argv is accepted but warned (shell history). |
| Non-interactive | `--yes` answers confirmations; without a TTY and without `--yes` a confirmation fails exit 2. |
| Credential store | OS keychain (macOS Keychain, Windows Credential Manager, Secret Service). Headless machine without a keychain: agent items only may use `$XDG_CONFIG_HOME/tealbrick/agent-<con>.json` (mode 0600) with `TB_CREDENTIAL_STORE=file`; the person item requires a keychain. |

### 2.1 Exit codes
| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected error |
| 2 | usage error / confirmation needed |
| 3 | not signed in (no item, expired or revoked credential) |
| 4 | wrong credential kind for this command |
| 5 | refused by Portal or bridge (403, `paused`, `draft_op_not_draftable`, …) |
| 6 | not found |
| 7 | conflict (`revision_conflict`, `idempotency_conflict`, draft state) |
| 8 | validation failed (input schema, draft invalid, manifest invalid) |
| 9 | network / upstream unavailable |
| 10 | device flow denied or expired |

## 3. Owner mode (person, K3)
| Command | Does | Op ids |
|---|---|---|
| `tealbrick login` | RFC 8628 device flow at `POST /api/v1/device/authorize` with `DeviceStartOwnerInput` (`scope: "owner"`, `client_id: "tealbrick-cli"`, `machine_label`); result `DeviceOwnerTokenResult` (types/routes.ts; fields not restated here). Before starting it warns when agent items exist on this machine ("agents on this machine run as the same OS user; the owner session is readable by them through this CLI — prefer a separate OS user"). Prints `verification_uri_complete` + `user_code`, opens the browser only with `--open`; polls (interval ≥ 5 s, `slow_down` +5 s, stop at `expires_in`); stores K3 in `tealbrick.person` (user-presence ACL where supported, rule 2b) | `device.start`, `device.token` |
| `tealbrick logout` | revokes this session server side, then deletes the item (deletes locally even if offline, and says so) | `owner_sessions.logout` |
| `tealbrick sessions` | lists owner sessions (CLI + TBD); revoking another session prints the Portal account page URL (browser op) | `owner_sessions.list` |
| `tealbrick whoami` | account, current workspace, session expiry | `account.me` |
| `tealbrick workspaces list \| show` | | `workspaces.list`, `workspaces.get` |
| `tealbrick agents list \| show <agt>` | agent cards, status, connections count | `agents.list`, `agents.get`, `connections.list` |
| `tealbrick catalog [--search <text>]` | catalog entries (search is local over `discovery.intents`/`keywords`) | `catalog.list` |
| `tealbrick instances list \| show` · `canvas show` · `keys status` · `skills show \| pack` · `harness options` · `licences list` · `audit` | reads | `instances.list`, `instances.get`, `canvas.get`, `keys.status`, `skills.get`, `skills.pack`, `harness.options`, `licences.list`, `audit.list` |
| `tealbrick draft new --title <t>` | creates an empty draft for the workspace; prints `drf_…` | `drafts.create` |
| `tealbrick draft add <opId> --input <json \| @file>` | appends one step; `$ref` allowed (`{"$ref": "#/steps/<n>/output/<pointer>"}`); validates locally first (§3.1); writes with the draft `revision` (409 → exit 7) | `drafts.get`, `drafts.update` |
| `tealbrick draft rm <n>` · `draft move <n> <to>` | edits steps | `drafts.update` |
| `tealbrick draft show [<drf>]` · `draft list` | steps with Core-rendered summaries, effects, confirm items, `requiresPurchase` | `drafts.get`, `drafts.list` |
| `tealbrick draft validate [<drf>]` | local pre-check (§3.1), then Core validation against the route table and current state without applying (I18); exit 8 on any issue, issues listed | `drafts.validate` |
| `tealbrick draft submit [<drf>]` | submits; prints `reviewUrl` for the owner's single browser confirmation; the CLI never applies | `drafts.submit` |
| `tealbrick recipe export <drf> [-o file]` | writes `Recipe { format: "tealbrick.recipe/1", title, description, steps }` | `drafts.export` |
| `tealbrick recipe import <file>` | creates a draft from a recipe (Core refuses non-portable recipes: `recipe_not_portable`) | `drafts.import` |
| `tealbrick register agents --file <agents.json> [--draft <drf>]` | J3 bulk: adds DRAFT steps (§3.2); never creates agents directly | `drafts.create` / `drafts.update` |
| `tealbrick standalone owner-key` | generates the standalone owner key (Ed25519) in keychain item `tealbrick.owner-key.<ws>` and prints its public JWK; the owner pastes it into the browser "Leave Portal" step (`workspaces.standalone`, browser only, `ownerKey` field; CREDENTIALS §17). The CLI never applies the switch | none (local) |
| `tealbrick admin pause \| resume [--agent <agt>]` · `admin revoke-connection <con>` · `admin ticket launch <product> [--path <p>] \| keys` | standalone workspaces only (frozen final config, C16 B7): exactly these 4 ops, each signed with an owner assertion from the owner key (`htm`, `htu`, `bd`, ≤ 60 s). Pause/resume = agent (with `--agent`) or workspace. `ticket` prints the bridge URL that opens the app or key page in the browser. Adding agents, edges or apps after leaving Portal = next wave | bridge `/admin/v1/pause`, `/resume`, `/revoke-connection`, `/ticket` (BRIDGE §11) |

### 3.1 Local draft validation
The CLI bundles `@opt2-tealbrick/spec` (route table + JSON Schemas) of its build. `draft add` / `draft validate` check: `opId` is a `draftable` row; input matches the row's input schema (with `$ref` positions accepted as string-typed values); every `$ref` points to an earlier step and a JSON pointer; `ws` in each input equals the draft workspace; no step input carries a secret field (schema). `draft validate` then calls `drafts.validate`; Core also re-validates on `drafts.update` and `drafts.submit` (`draft_invalid`, `draft_ref_invalid`, `draft_ref_money`); Core is authoritative.

### 3.2 `register agents` (J3: 15–16 agents)
Input file (JSON; YAML accepted with the same shape):
```json
{ "format": "tealbrick.agents/1",
  "agents": [ { "name": "Agent 01", "purpose": "…", "harness": "<harness option id>", "endpointLabel": null,
                "edges": [ { "product": "<product id>", "crud": ["read", "create", "update"] } ] } ] }
```
For each agent `i` the CLI appends `agents.create { ws, name, purpose, harnessOptionId, endpointLabel? }` (types/routes.ts `AgentCreateInput`), then per edge `edges.create { ws, agt: {"$ref": "#/steps/<i>/output/id"}, product, crud }`. Limits: ≤ 64 agents, ≤ 8 edges each, names unique in the file and the workspace (checked against `agents.list`). Scope access (e.g. per-agent area + shared area) is not in the file: each app applies its manifest `defaultGrants` when the edge first appears (C1). Connections are created afterwards per agent machine with ONE device request for all agents of that machine (`tealbrick agent login --file agents.json`, §4; C16 S4): one browser approval connects up to 64 agents.

### 3.3 Owner self-setup flow (PRD §10)
1. `tealbrick login` → the owner approves in the browser (one click).
2. The local operator session (e.g. Claude Code) runs `tealbrick catalog --json`, `agents list --json`, then `draft new`, `draft add …` / `register agents` / `recipe import`, `draft validate --json`, `draft submit --json`.
3. The owner opens `reviewUrl`, reviews and applies once (deploys, grants, licence checkout hand-off).
4. `tealbrick logout` (or revoke in Portal). Agents keep working on their own connections (CONFORMANCE P2).

## 4. Agent mode (agent card, K4 / K5)
| Command | Does | Endpoint |
|---|---|---|
| `tealbrick agent login [--agent <agt>]… \| --file <agents.json>] [--harness <id>] [--label <machine>]` (`<id>` ∈ `HARNESS_OPTION_IDS` of types/routes.ts, spec 0.1.27, default `tealbrick-cli`; the CLI imports the list, no aliases) | key connections, batched (C16 S4): generates one K4 (Ed25519) per agent (1..64; `--file` takes the §3.2 file, agents matched by name to existing cards) and sends ONE device request `DeviceStartAgentInput` (`scope: "agent"`, `client_id: "tealbrick-cli"`, `machine_label`, `harness`, `agents: [{agt?, public_key}]`); the owner approves once in the browser (agent cards pre-selected, changeable); result `DeviceAgentTokenResult` (types/routes.ts) → one item `tealbrick.agent.<con>` per returned connection; then waits (backoff ≤ 60 s) until the bridge accepts each K4 agent assertion at `token_endpoint` (jwt-bearer) | Portal `device.start`, `device.token`; bridge `/oauth/token` |
| `tealbrick agent status` | item, agent, connection, bridge reachability, current tool count (MCP `initialize` + `tools/list` through the bridge) | bridge `/mcp` |
| `tealbrick agent logout [--agent <agt>]` | deletes the item and prints the Portal URL to revoke the connection (`connections.revoke` is an owner browser op); the deleted key can no longer sign assertions | none (local) |
| `tealbrick agent list` | agent items on this machine (ids, method, bridge) | none (local) |

K5 handling: access tokens (15 min) live only in memory of the running process; the CLI mints a fresh K4 assertion when needed (key connections have no refresh token, C15). Pairing codes (K2b) are only for OAuth connectors (Claude Desktop / Codex: Approve in Portal, or paste on the bridge authorize page); the CLI has no pairing path (C16 S9).

## 5. Local bridge relay (C5)
`tealbrick bridge serve --stdio [--agent <agt>]` runs the SAME `@opt2-tealbrick/bridge` package in relay form (BRIDGE §2): downstream MCP over stdio only (I5: no loopback listener, so no relay-local token exists); upstream `https://<bridge>/mcp` with `Authorization: Bearer <K5>` from the agent item. It forwards JSON-RPC verbatim; holds no grants, keys or config; runs no `gate()`, hooks or checks; every decision is the deployed bridge's.
| Item | Rule |
|---|---|
| Person credential | never loaded; the relay authenticates upstream only with the agent's K5 (CONFORMANCE C4 `cred.p1.relay_rejects_person`). |
| Lifetime | one long-lived process per harness session; refreshes K5 before expiry; on upstream `401` re-authenticates once, then fails the call with the bridge's error. |
| Harness-local tools | tools a harness ships itself (e.g. TBD Companion timeline tools of TBD's default agent) are that harness's own tools: not app operations, not routed through the relay, not bridge-governed (C5). |

Own-infrastructure bridge (PRD §3 rule 5): `tealbrick bridge enrol --code - [--data-dir <dir>]` enrols a FULL bridge (deployed form, same package) on this machine with a K6 enrolment code (`bridge_api.enrol`; the owner copies the code from Portal `bridge.enrolment_code`, a browser op — K3 never receives it); `--data-dir` defaults to env `TB_DATA_DIR`, the same name the bridge and apps use (N3); `tealbrick bridge run [--data-dir <dir>]` runs it (the same entry as the `bridge-server` image). It is a full bridge whatever machine it runs on; the relay never enrols.

## 6. Harness connection (`connect`)
`tealbrick connect <claude-desktop | codex | claude-code | generic> [--agent <agt>] [--remote | --local] [--write [--yes]]`
| Harness | Default (printed) | `--write` target |
|---|---|---|
| `claude-desktop` | `--remote`: the bridge MCP URL `https://<bridge>/mcp` and the steps "Settings → Connectors → Add custom connector → paste URL → Approve in Portal" (OAuth, C4); no file. `--local`: stdio entry `mcpServers.tealbrick = { command: "tealbrick", args: ["bridge", "serve", "--stdio", "--agent", "<agt>"] }` | `--local` only: the Claude Desktop config JSON |
| `codex` | `--local`: `[mcp_servers.tealbrick]` with `command`/`args` as above; `--remote`: `url = "https://<bridge>/mcp"` (Codex runs the OAuth flow) | `~/.codex/config.toml` |
| `claude-code` | the `claude mcp add --scope user tealbrick -- tealbrick bridge serve --stdio --agent <agt>` command, or the `.mcp.json` entry | `./.mcp.json` (project scope) |
| `generic` | the stdio command line `tealbrick bridge serve --stdio --agent <agt>` and, for remote-capable harnesses, the bridge MCP URL, as JSON | none (print only) |
`--write`: reads the target, shows a unified diff on stderr, asks `y/N` (`--yes` for non-TTY), writes atomically, keeps `<file>.bak-<UTC timestamp>`. A target that does not parse is not touched (exit 8: no repair). No command writes harness config implicitly; `agent login`, `bridge serve` and harness start never do. The bridge URL comes from the agent item (or `--bridge`); `connect` makes no Portal call.

## 7. Harness adapters (`@opt2-tealbrick/harness-claude`, `@opt2-tealbrick/harness-eve`)
- Connect to the bridge like any MCP client (relay stdio or remote URL); hold no policy, no grants, no person credential; the agent process env is allow-listed (CREDENTIALS §12).
- On a held result (`structuredContent {status: "held", holdId, expiresAt, checkWith}`) they show "waiting for owner approval in <product>" and poll `checkWith` (≥ 10 s interval) until `approved` (then repeat the same call, SDK-API §4.3), `denied`, or expiry. They never approve, retry with different input, or treat a hold as an error.
- Eve code lives only in `harness-eve` (REPOS §2).
- Knowledge hooks (harness wave 1): `tealbrick hook [<event>] [--harness claude-code|hermes]` and `harness-claude` `knowledgeHooks()` follow HARNESS-HOOKS.md (no policy, fail-open, exit 0 always). `tealbrick hook --print-settings` prints the Claude Code `hooks` block; nothing writes it implicitly (§6 rule).

## 8. Environment variables (CLI; one name per setting)
| Name | Meaning |
|---|---|
| `TB_PORTAL_URL` | Portal origin (owner mode, `agent login` device flow) |
| `TB_WORKSPACE` | default workspace for owner commands |
| `TB_AGENT` | default agent item for agent commands |
| `TB_CREDENTIAL_STORE` | `keychain` (default) or `file` (agent items only, headless) |
| `TB_HOOKS` | `0` / `off` / `false` / `no` switches every Knowledge hook off (`tealbrick hook`, `knowledgeHooks`, Hermes adapter; HARNESS-HOOKS HH-7) |
| `TB_DATA_DIR` | state directory of an own-infrastructure full bridge (`bridge enrol` / `bridge run`); same name as bridge and apps (N3) |
No other variable is read; no token is ever taken from the environment.

## 9. Mutating command → op mapping (complete)
| Command | Portal route op (types/routes.ts) or bridge endpoint | Applied by |
|---|---|---|
| `login` | `device.start` (`DeviceStartOwnerInput`), `device.token` | owner approves in browser (`device.lookup` + `device.approve` with the user code) |
| `logout` | `owner_sessions.logout` | CLI (own session) |
| `draft new` | `drafts.create` | CLI (draft only) |
| `draft add / rm / move` | `drafts.update` | CLI (draft only) |
| `draft submit` | `drafts.submit` | owner applies in browser: `drafts.apply` |
| `recipe import` | `drafts.import` | owner applies in browser |
| `register agents` | `drafts.create` / `drafts.update` with steps `agents.create`, `edges.create` | owner applies in browser |
| any draft step | one of the `draftable` ops: `workspaces.create`, `workspaces.update`, `workspaces.set_infrastructure`, `providers.destinations_create`, `agents.create`, `agents.update`, `agents.delete`, `agents.policy_set`, `agents.pause`, `agents.resume`, `connections.revoke`, `canvas.save`, `edges.create`, `edges.update`, `edges.delete`, `hooks.set`, `instances.deploy`, `instances.update`, `instances.rollback`, `instances.remove`, `licences.assign`, `licences.unassign`, `licences.move`, `checkout.create`, `skills.override_put`, `skills.override_delete` | owner applies in browser (money steps end in the checkout hand-off) |
| `agent login` | `device.start` (`DeviceStartAgentInput`, 1..64 agents), `device.token`; bridge `/oauth/token` (jwt-bearer) | owner approves once in browser (`device.lookup` + `device.approve`) |
| `bridge enrol` | `bridge_api.enrol` | code issued by owner (`bridge.enrolment_code`, browser) |
| `admin pause \| resume \| revoke-connection \| ticket` | bridge `/admin/v1/{pause,resume,revoke-connection,ticket}` (standalone) | owner key holder |
| `draft validate` | `drafts.validate` (read-class, no state change) | — |
| `connect --write`, `standalone owner-key`, `agent list`, `agent logout` | none (local) | — |

## 10. Versioning and distribution
CLI semver, released with the bridge package (same repo, GitHub-release tarball and a single-file build per OS on the release; no npm publish). `--json` field names and exit codes change only in a new major. The CLI bundles the spec version it was built against and reports it in `tealbrick --version --json` `{cli, bridge, spec}`.

## Checklist mapping (SPEC-REVIEW-CHECKLIST §CLI)
| Checklist line | Answered in |
|---|---|
| Owner mode and agent mode use separate credentials; agent never receives the person token | §1 rules 1, 2a, 2b, §3, §4, §5 (person credential row) |
| Every mutating command maps to a route-registry op; apply needs browser confirmation | §1 rules 2–3, §9 |
| Commands cover J3 and owner self-setup: sign in, register agent cards, local bridge, connect harness, draft, revoke CLI session | §3 (`login`, `register agents`, drafts, `logout`), §3.2, §3.3, §4, §5, §6 |
| Local bridge runs the same bridge code (stdio; loopback HTTP dropped in opt2 by CORE I5) | §5 |
| Writing harness config is explicit with preview; never at launch or silently repaired | §1 rule 4, §6 |
| No Eve wizard, bindings/`app claim`, Codex/LangChain stubs, legacy headers, compat commands | §1 rule 6 |
| Machine-readable output for a local operator session | §2 (`--json`), §2.1, §3.3 |
| No publish to `tealbrick` / `@tealbrick/*`; harness adapters ask the bridge, hold no policy | §1 rules 5–6, §7, §10 |

## Open questions
None open. Resolved: leaving Portal = `tealbrick standalone owner-key` + browser step, admin limited to 4 ops (C16 B7); the CLI has no pairing path and no custom grant type (C16 S9); device-flow wire = `types/routes.ts` types `DeviceStartOwnerInput`, `DeviceStartAgentInput`, `DeviceOwnerTokenResult`, `DeviceAgentTokenResult` (C16 B6); `drafts.validate` exists (CORE I18).
