# HARNESS-HOOKS — harness hook points → app hook modules (harness wave 1)

Status: docs; v0.1.90 adds the constant `AGENTIC_HARNESS_OPTION_IDS` (routes.ts), the HH-5 exception, HH-8 and §7 "Harness
package delivery" (C392 L0, C395: run-time delivery, no manifest field). Sources: DECISION-LOG C313.1 (governance stays in Tealbrick), C319b (LCM keeps
the context-engine slot), C329(2) (packs call apps through hooks, GBrain's event mapping), C330(2) (harness-facing
packages), C338 (package ownership), **C345** (MCP stays the default; hooks are opt-in, OFF by default, app-specific, and
ship per harness × app only after a real-harness test), **C392/C393 Q4, Q6** (an app's harness package may install a pinned
third-party plugin such as LCM-X; Hermes via `tealbrick-cli --harness hermes`), **C395** (the package is served by the app at
run time, not declared in the manifest). Implemented by the runner `@opt2-tealbrick/hooks` (system,
plumbing only), the app modules (e.g. `@opt2-tealbrick/hooks-knowledge`, owned by the Knowledge lead), `tealbrick hook`
(CLI §7), `harness-claude` `sdkAppHooks`, and the Hermes adapter `tealbrick-hermes`. Harness facts: the harness profiles
(coordination `leads/harness/HARNESS-PROFILE-<harness>.md`).

## 0. Layers (normative, C345)

- **HH-0a MCP first.** The default integration of every app with every harness is the MCP tool surface. Hooks are an extra,
  opt-in layer. Nothing installs, enables or writes hooks implicitly.
- **HH-0b OFF by default.** `tealbrick hook` runs nothing without `--app <app>`; the Hermes adapter runs nothing without
  `settings.apps`; the Agent SDK runs app hooks only when `appHooks.apps` is given. Kill switch: HH-7.
- **HH-0c Runner = plumbing.** The runner owns budgets, fail-open, the process deadline, scrub, size caps, the harness
  input/output shapes and HH-5. It holds no app logic: which tool to call, with which arguments, and what to inject belong
  to the app's own hook module (`AppHooks`), owned and reviewed by that app's lead (C338 B).
- **HH-0d Release gate.** An app module is enabled for a harness only after the per-harness × per-app test in the REAL
  harness passed: every response path (ok, empty, slow, error, refusal, hold, oversized, app down, bridge down), two turns,
  the agent loop continues (C345.3). Unit tests are not release evidence.

## 1. Rules (normative)

- **HH-1 No policy.** A hook fetches context and saves memory. It never allows, denies, blocks or rewrites a harness action and
  carries no Rules text. Grants, Rules narrowing and holds apply at the bridge and the app, as for any tool call (C313.1).
- **HH-2 Own credential, through the bridge.** A hook calls Knowledge tools as the agent (K4 relay or K5/K13), never the person
  item, never the app directly.
- **HH-3 Fail-open, bounded process.** Every hook returns within its budget (§3). On error, timeout, missing tool, a refused
  or held call it injects nothing and lets the turn go on. The budget bounds the whole `tealbrick hook` PROCESS: the app
  handler ends at its budget (and gets an abort signal); anything that hangs outside it (a token fetch, the relay start, a
  DNS lookup stalled in Node's thread pool, a transcript path that is a FIFO) is ended by a hard deadline at budget + 300 ms,
  which writes the fail-open answer synchronously and then ends the process with a signal (a normal exit would wait for a
  stalled lookup). Before connecting, the bridge host must resolve within 500 ms; transcripts are read only when they are
  regular files (non-blocking open, last 2 MB). Exit status: 0 on every path except the hard deadline (signal); the printed
  Claude Code command ends in `|| true`, so Claude Code always sees 0 — also from a CLI too old to know `hook` — and never
  2 ("block"). The Hermes adapter reads stdout only.
- **HH-4 Scrub before send.** Text that leaves the machine (queries, saved items) has these replaced by `[redacted]`: tokens
  (`tb?_…`, `sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `glpat-…`, `npm_…`, `hf_…`, `whsec_…`, `xox?-…`, `AKIA…`/`ASIA…`,
  `AIza…`, JWTs), `Bearer …` and `Basic …` credentials, the value of any secret-named field (`password`, `passwd`, `pwd`,
  `secret`, `client_secret`, `aws_secret_access_key`, `*token`, `api_key`, `private_key`, … as `k: v`, `k=v` or JSON
  `"k": "v"`), the password in `scheme://user:password@host`, private-key blocks (also without an END line), e-mail
  addresses, Luhn-valid card numbers, and any other random-looking token (≥ 32 chars, letters + digits, entropy ≥ 4.2
  bits/char; pure hex such as commit ids and sha256 digests stays), Slack webhook URLs (`hooks.slack.com/services|workflows|
  triggers/…`). Every pass is linear in the input (e-mail by a bounded scan from each `@`, bounded scheme length for URL
  passwords) and the scrub works on at most 256 KiB, so 1 MB of adversarial text scrubs in < 100 ms and never blocks a host
  process (Agent SDK). Text is scrubbed before it is cut (`scrubCut`), so a secret is never cut in half first. No secret in
  argv, env or logs. The Hermes adapter starts the CLI with an
  allow-listed env only (`PATH`, `HOME`, locale, `TMPDIR`, `XDG_CONFIG_HOME`, CA files, `TB_CREDENTIAL_STORE`, `TB_AGENT`,
  `TB_PORTAL_URL`, `TB_HOOKS`): no model keys.
- **HH-5 One slot owner.** A harness's context-engine slot (Hermes `context.engine`, OpenClaw `plugins.slots.contextEngine`)
  belongs to the harness or LCM. A Tealbrick hook (runner or app module) never sets it and never takes an occupied
  memory-provider slot. When a context engine runs, the per-prompt recall (`prompt`) is skipped; context is added at session
  start and after compaction only.
  **v0.1.90 exception (Coordinator HH-5 ruling 2026-11-06; C392, C393 Q6), narrow:**
  1. Only the Knowledge harness package may set the slot, and only to `lcm-x` at the pinned commit (§7, HH-8). No other app,
     package, upstream or value: the CLI refuses `takesContextEngineSlot: true` in a package from any other app or for any
     other upstream name.
  2. The install sets the slot only when it is empty or already `lcm-x`. If another engine is set (e.g. lossless-claw,
     gbrain-context-engine, a user's own), the install refuses with a clear message naming that engine and does not
     overwrite it.
  3. The owner opts in per agent; it is off by default (HH-0b). No workspace-wide or default-on switch (§7 step 3).
  4. Uninstall restores the previous slot value exactly (the value, or its absence, recorded at install).
  While `lcm-x` holds the slot, the `prompt` recall is skipped exactly as for any context engine.
- **HH-7 Off switches.** `TB_HOOKS_<APP>=0` (e.g. `TB_HOOKS_KNOWLEDGE=0`) switches one app's hooks off; `TB_HOOKS=0` (or `off`,
  `false`, `no`) in the harness environment switches every hook off. The runner applies both (apps read no env):
  no network call, nothing injected, exit 0 (Hermes answer `{"saved": 0, "skipped": "off"}`). It applies to `tealbrick hook`,
  the Agent SDK `knowledgeHooks` and the Hermes adapter.
- **HH-8 Third-party upstream in a package (v0.1.90; C319a, C392, C393 Q6, C395).** An app's harness package (§7) may install
  a third-party harness plugin (`upstreams[]` of the package document). Rules:
  - **Exact pin.** The exact repo (`github.com/<owner>/<name>`), the full 40-char commit, the release tag that points to it,
    and the SPDX licence. The CLI accepts only a repo on its own allow-list and only a commit that an allow-listed release tag
    points to (§7 step 5). The install fetches that commit only and checks the commit id after fetch; a branch, a fork or a
    look-alike repo is never used (C319a: a look-alike malware repo was reported). A new upstream version = a new app release
    with a new pin.
  - **Own home only.** It installs only into the harness's own home of that agent (e.g. its own `HERMES_HOME`, the Claude Code
    plugin folder of that agent's user). Never into a global runtime (no global pip/npm/Python install, no shared interpreter
    change), never into a home shared with another agent or person.
  - **Not a Knowledge engine.** It is a harness plugin, not a Knowledge engine type (C319b stands; C393 Q6). Knowledge never
    reads its store; it reaches the agent's memory only through Knowledge tools and its own hooks.
  - **Store stays on the agent machine.** Its data stays on the agent machine (`dataOnAgentMachine` says what and where). The
    package sends none of it to Tealbrick.
  - **Honest erase.** `erase` states what erase can and cannot do for that store (e.g. per session only, no per-person purge).
    The Knowledge forget report quotes it, and lists what the operator must do on the agent machine.
  - **Slot.** An upstream takes a context-engine slot only under the HH-5 exception (Knowledge package, `lcm-x` at the pinned
    commit, empty or already-`lcm-x` slot, per-agent opt-in, exact restore on uninstall). Every other upstream leaves the slot
    as it is.
  - **Same gates.** Opt-in and off by default (HH-0b), kill switches (HH-7) also stop the package's hooks, and the real-harness
    gate (HH-0d) runs with the upstream installed.
- **HH-6 Idempotent saves.** Each single-item save carries `_meta["tealbrick/idempotencyKey"] = "tbh-" + sha256(area + "\n" +
  normalised text)[0..48]`, so a repeated save (compaction twice, Stop after PreCompact) makes one document.

## 2. Event map — Knowledge module (GBrain events → Claude Code → Knowledge)

The rows below are the Knowledge app module's behaviour (owner: Knowledge lead); the event columns are the runner's.

| Event | Claude Code | Hermes (plugin) | Call | Output |
|---|---|---|---|---|
| `session_start` | SessionStart (`source: compact` = rehydrate) | session start | context tool (§4) with `{purpose: "session_start" \| "after_compact", maxChars}`; recall fallback queries the project name | context text |
| `prompt` | UserPromptSubmit | `pre_llm_call` only when no context engine | context tool with `purpose: "prompt"`, else `knowledge__recall {query: <prompt>, limit: 5}`; skipped for prompts < 12 chars | context text |
| `pre_compact` | PreCompact | pre-compression | `knowledge__remember` per item (or one `items[]` call when the op has `items`) | none |
| `stop` | Stop | — | `knowledge__remember`, marked items only (backstop) | none |
| `session_end` | not installed for Claude Code (SessionEnd hooks share a 1.5 s budget) | `on_session_finalize` | as `pre_compact` | none |

Items (wave 1 rule until the promotion benchmark, WP-HARNESS-WAVE1 X8): lines starting with `remember:`, `#remember` or
`[remember]` in any turn (kind `note`), plus one digest of the last 8 user turns at `pre_compact` / `session_end` (kind `digest`, tags `harness, digest`).
≤ 20 items per call, ≤ 2,000 chars per item.

## 3. Budgets

| Event | Budget | Context size |
|---|---|---|
| `session_start` | 1.5 s | 2,000 chars (owner may raise with `--max-chars`) |
| `prompt` | 0.8 s | 1,000 chars |
| `pre_compact`, `stop`, `session_end` | 3 s | — |

The budget counts from the start of the hook run (after the CLI has loaded) and includes the relay connection; the process
ends at budget + 300 ms (HH-3). Claude Code hook `timeout` (seconds) is set above load time + budget (5 / 4 / 8 / 8).
Context size ceilings: **10,000 chars for Claude Code** (its hook output limit; a larger `--max-chars` is cut to it), 20,000
for other harnesses (Knowledge's `maxChars` maximum); the floor is 200.

## 4. Tool resolution (Knowledge module)

From the agent's `tools/list`, in order: `knowledge__context` (Knowledge ≥ 0.1.25) → `knowledge__recall`. GBrain's
`gb_context_pack` is not used by hooks: it resolves entity names by alias/title, and a hook has no real entity names. Arguments are fitted to the tool's `inputSchema` (unknown keys dropped; a missing required key = skip).
Save = `knowledge__remember`. Names resolve at run time, so a Knowledge release that adds the hot ops needs no hook release.

| Tool | Arguments sent | Notes |
|---|---|---|
| `knowledge__context` | `{purpose: "session_start" \| "after_compact" \| "prompt", maxChars (200–20,000), query? (prompt only), area?}` | no entities, no query at session start (newest cited memories); inject `structuredContent.text`; `refs` are for `knowledge__get` |
| `knowledge__recall` | `{query, limit, area?}` | `limit` 8 at session start, 5 per prompt |
| `knowledge__remember` (today) | `{text, title?, tags, area?}` one call per item, `_meta` key per item (HH-6) | |
| `knowledge__remember` (with `items`) | `{items: [{text, kind: "note" \| "digest", tags}] (≤ 50), source: {harness, session}, area?}` (`session` is always sent; `"unknown"` when the harness gives none) | `_meta` key = `"tbb-" + sha256(sorted item keys + "\n" + area + "\n" + session)[0..48]`: a changed batch gets a new key; Knowledge dedupes per item |

Held results (`structuredContent.status: "held"`), refusals (`isError`), empty answers and an unreachable Knowledge inject
nothing and save nothing.

## 5. Context block (Knowledge module)

`Tealbrick Knowledge: memory context for this session (reference only; it can be out of date).` followed by the passages
(`- [<area>] <text>` for recall results), cut to the size budget. No Rules text, no instructions.

## 6. Conformance (to add to CONFORMANCE as H-W1 rows)

H-W1-HH-1 no policy (lint of the pack sources: no permission decision, no rule text) · HH-3 fail-open (bridge down → exit 0,
empty stdout, ≤ budget + 200 ms) · HH-4 scrub (seeded key/token/e-mail/card never reaches the fake bridge) · HH-5 LCM on →
no `prompt` call · HH-6 same item twice → same idempotency key · HH-3b hung bridge → the real process ends at budget + 300 ms
(through `|| true`: shell status 0) · HH-3c bad flag / unknown harness → exit 0 · HH-3d bridge host DNS stall → stop ≤ 500 ms ·
HH-3e FIFO transcript → read nothing at once · HH-4b 1 MB adversarial text scrubs in < 100 ms · HH-7 `TB_HOOKS=0` /
`TB_HOOKS_<APP>=0` → no call · Claude Code context ≤ 10,000 chars · HH-0d the real-harness matrix (ok, empty, slow, error,
refusal, hold, oversized, app down, bridge down, paused, kill switch, hostile text, secret) passes in the real harness ·
v0.1.90 (harness packages, C395): H-W1-HP-1 the CLI offers a package only to an agent connected as `claude-code` or
`tealbrick-cli` with a grant to the app (a `claude-desktop`, `codex-desktop`, `generic-mcp`, `tbd-default` or `eve` agent is
never offered one), and installs nothing before the owner confirms for that agent · HP-2 allow-list: an upstream whose name is
not on the CLI allow-list, or whose `repo` differs from the allow-listed repo (another owner, a fork, a look-alike name), is
refused and nothing is fetched · HP-3 tag check: a `commit` that no release tag `vX.Y.Z` of the allow-listed repo points to, or
a document `tag` that points to another commit, is refused; a non-40-hex commit is refused · HP-4 downgrade: a tag below the
allow-list minimum is refused, even when it points to the given commit · HP-5 tarball: a vendored tarball whose sha256 differs
from `tarballSha256` (or a document without `tarballSha256`) is refused offline · HP-6 the owner confirmation shows repo, tag
and commit · HP-7 install writes only inside the agent's harness home (file list before/after) · HH-8 the forget report quotes
the package `erase` text ·
HH-5 exception (Coordinator ruling 2026-11-06), one row per point: H-W1-HH-5.1 `takesContextEngineSlot: true` from any app
other than `knowledge`, or for an upstream other than `lcm-x`, is refused by the CLI and the slot is never written · H-W1-HH-5.2
slot empty → set to `lcm-x`; slot `lcm-x` → unchanged; slot `lossless-claw` / `gbrain-context-engine` / a custom value →
install refuses with a message naming it, slot and config bytes unchanged · H-W1-HH-5.3 a new agent has no package installed and
the slot untouched until the owner turns it on for THAT agent; turning it on for agent A leaves agent B unchanged · H-W1-HH-5.4
install then uninstall → the slot value (or its absence) is byte-equal to the value before install, for each start state of
HH-5.2 · while `lcm-x` holds the slot → no `prompt` call.

## 7. Harness package delivery (v0.1.90; C392 L0, C395)

An app's harness package is NOT a manifest field. The app serves it at run time; the CLI installs it on the agent machine after
the owner confirms. MCP stays the default integration (HH-0a); the package is an opt-in layer (HH-0b), gated per harness × app
by HH-0d.

**Package document.** A JSON document baked into the app image, so the signed index's image digest pins it. One per app
(C330(2)). Members:

| Member | Rule |
|---|---|
| `id` | snake id (`^[a-z][a-z0-9_]{1,39}$`). |
| `title` | 1..80 chars; shown in the owner confirmation. |
| `runtimes` | 1..2 unique of `claude-code`, `hermes` (the values of `tealbrick hook --harness`). |
| `hooks` | optional `{module, events}`: `module` = npm name of the app's own hook module (e.g. `@opt2-tealbrick/hooks-knowledge`, C338, HH-0c); `events` = 1..5 unique of `session_start`, `prompt`, `pre_compact`, `stop`, `session_end` (§2). |
| `upstreams[]` | optional, ≤ 4, each `{name, repo, commit, tag, licence, kind, takesContextEngineSlot, dataOnAgentMachine, erase, tarballSha256?}`: `name` = the CLI allow-list key (e.g. `lcm-x`); `repo` = `github.com/<owner>/<name>` (no scheme, no `.git`); `commit` = 40 lower-case hex; `tag` = `vX.Y.Z` (no pre-release); `licence` = SPDX id; `kind` = `hermes_plugin` (runtime `hermes`) or `claude_code_plugin` (runtime `claude-code`); `takesContextEngineSlot` boolean (HH-5: only `lcm-x` from `knowledge`); `dataOnAgentMachine` and `erase` 1..300 chars each (HH-8); `tarballSha256` = 64 lower-case hex, for vendored or air-gapped installs. |

No default-on member exists. The CLI refuses a document that breaks a rule above and installs nothing from it (the install fails
closed; the hooks, once installed, stay fail-open per HH-3).

**Steps (normative).**
1. **Serve.** The app serves the document through one of its own agent ops (Knowledge: `harness_package_get`, read). The op
   returns the baked document unchanged; it takes no input that changes the document.
2. **Who.** The CLI (`tealbrick`) fetches it through the bridge AS THE AGENT (K4/K5, HH-2), only for an agent connected as
   `claude-code` or `tealbrick-cli` (option ids in `AGENTIC_HARNESS_OPTION_IDS`, routes.ts, except `eve`), with the runtime
   chosen by `--harness claude-code | hermes`, and only when the agent has a grant to that app. A runtime not in the document's
   `runtimes` → nothing to install. Hermes is reached only through `tealbrick-cli` (C393 Q4).
3. **Owner confirms per agent.** Off by default. Nothing installs until the owner confirms for THAT agent. The confirmation shows
   the package title, the hook events, and for each upstream: repo, tag, commit, licence, `dataOnAgentMachine`, `erase`, and
   whether it takes the context-engine slot.
4. **CLI allow-list (the CLI's own, hard-coded).** Upstream `name` → exact repo + minimum release tag. Today: `lcm-x` →
   `github.com/electricsheephq/lcm-x`, minimum `v0.29.1`. An upstream whose name is not on the list, or whose `repo` differs from
   the listed repo, is refused. Adding or changing an entry is a CLI release, never a document change.
5. **Tag check (at install).** The CLI resolves the release tags of the allow-listed repo (annotated tags peeled to their
   commit). It accepts `commit` only if the document's `tag` exists there, is a `vX.Y.Z` release tag, points to exactly that
   commit, and is ≥ the allow-list minimum (SemVer order). Otherwise refused. This stops a compromised app from moving agents to
   an old or unreleased commit.
6. **Air-gapped.** A vendored tarball is accepted only if its sha256 equals the document's `tarballSha256`; a document without
   `tarballSha256` cannot install offline. The allow-list (step 4) and the minimum tag (on the document's `tag`) still apply;
   the confirmation states that the tag-to-commit link was not verified online.
7. **Install.** Only into the agent's own harness home (HH-8); the slot only under the HH-5 exception; uninstall restores what
   install changed, the slot exactly (HH-5 point 4).

**Portal.** No catalog field. The Portal shows "package available" only through the app's existing manifest `harnessHints` text
(kinds `tealbrick_cli`, `claude_agent_sdk`; MANIFEST §10, plain text, no commands).

**Eve.** Eve is agentic (`AGENTIC_HARNESS_OPTION_IDS`) but has no hook points: it is not a package target.
