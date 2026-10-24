# HARNESS-HOOKS — harness hook points → Knowledge (harness wave 1)

Status: docs, no type change, no version bump. Sources: DECISION-LOG C313.1 (governance stays in Tealbrick), C319b (LCM keeps
the context-engine slot), C329(2) (packs call Knowledge through hooks, GBrain's event mapping), C330(2) (harness-facing
packages). Implemented by `@opt2-tealbrick/harness-claude` (`runHook`, `knowledgeHooks`) and `tealbrick hook` (CLI §7).

## 1. Rules (normative)

- **HH-1 No policy.** A hook fetches context and saves memory. It never allows, denies, blocks or rewrites a harness action and
  carries no Rules text. Grants, Rules narrowing and holds apply at the bridge and the app, as for any tool call (C313.1).
- **HH-2 Own credential, through the bridge.** A hook calls Knowledge tools as the agent (K4 relay or K5/K13), never the person
  item, never the app directly.
- **HH-3 Fail-open, bounded process.** Every hook returns within its budget (§3). On error, timeout, missing tool or a refused
  call it injects nothing and lets the turn go on. The budget bounds the whole `tealbrick hook` PROCESS: at budget + 300 ms it
  writes the fail-open answer and exits, even when the token fetch or an MCP call hangs. `tealbrick hook` always exits 0, also
  on a bad flag, an unknown harness or an unknown event (Claude Code treats exit 2 as "block"). The Claude Code command is
  written as `tealbrick hook … || true`, so a CLI too old to know `hook` fails open as well.
- **HH-4 Scrub before send.** Text that leaves the machine (queries, saved items) has these replaced by `[redacted]`: tokens
  (`tb?_…`, `sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `glpat-…`, `npm_…`, `hf_…`, `whsec_…`, `xox?-…`, `AKIA…`/`ASIA…`,
  `AIza…`, JWTs), `Bearer …` and `Basic …` credentials, the value of any secret-named field (`password`, `passwd`, `pwd`,
  `secret`, `client_secret`, `aws_secret_access_key`, `*token`, `api_key`, `private_key`, … as `k: v`, `k=v` or JSON
  `"k": "v"`), the password in `scheme://user:password@host`, private-key blocks (also without an END line), e-mail
  addresses, Luhn-valid card numbers, and any other random-looking token (≥ 32 chars, letters + digits, entropy ≥ 4.2
  bits/char; pure hex such as commit ids stays). No secret in argv, env or logs. The Hermes adapter starts the CLI with an
  allow-listed env only (`PATH`, `HOME`, locale, `TMPDIR`, `XDG_CONFIG_HOME`, CA files, `TB_CREDENTIAL_STORE`, `TB_AGENT`,
  `TB_PORTAL_URL`, `TB_HOOKS`): no model keys.
- **HH-5 One slot owner.** A harness's context-engine slot (Hermes `context.engine`, OpenClaw `plugins.slots.contextEngine`)
  belongs to the harness or LCM. A Tealbrick pack never sets it and never takes an occupied memory-provider slot. When a context
  engine runs, the per-prompt recall (`prompt`) is skipped; context is added at session start and after compaction only.
- **HH-7 Off switch.** `TB_HOOKS=0` (or `off`, `false`, `no`) in the harness environment switches every hook off:
  no network call, nothing injected, exit 0 (Hermes answer `{"saved": 0, "skipped": "off"}`). It applies to `tealbrick hook`,
  the Agent SDK `knowledgeHooks` and the Hermes adapter.
- **HH-6 Idempotent saves.** Each single-item save carries `_meta["tealbrick/idempotencyKey"] = "tbh-" + sha256(area + "\n" +
  normalised text)[0..48]`, so a repeated save (compaction twice, Stop after PreCompact) makes one document.

## 2. Event map (GBrain events → Claude Code → Knowledge)

| Event | Claude Code | Hermes (plugin) | Call | Output |
|---|---|---|---|---|
| `session_start` | SessionStart (`source: compact` = rehydrate) | session start | context tool (§4) with `{purpose: "session_start" \| "after_compact", maxChars}`; recall fallback queries the project name | context text |
| `prompt` | UserPromptSubmit | `pre_llm_call` only when no context engine | context tool with `purpose: "prompt"`, else `knowledge__recall {query: <prompt>, limit: 5}`; skipped for prompts < 12 chars | context text |
| `pre_compact` | PreCompact | pre-compression | `knowledge__remember` per item (or one `items[]` call when the op has `items`) | none |
| `stop` | Stop | — | `knowledge__remember`, marked items only (backstop) | none |
| `session_end` | SessionEnd (CLI only) | session end | as `pre_compact` | none |

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

## 4. Tool resolution

From the agent's `tools/list`, in order: `knowledge__context` (Knowledge ≥ 0.1.25) → `knowledge__recall`. GBrain's
`gb_context_pack` is not used by hooks: it resolves entity names by alias/title, and a hook has no real entity names. Arguments are fitted to the tool's `inputSchema` (unknown keys dropped; a missing required key = skip).
Save = `knowledge__remember`. Names resolve at run time, so a Knowledge release that adds the hot ops needs no hook release.

| Tool | Arguments sent | Notes |
|---|---|---|
| `knowledge__context` | `{purpose: "session_start" \| "after_compact" \| "prompt", maxChars (200–20,000), query? (prompt only), area?}` | no entities, no query at session start (newest cited memories); inject `structuredContent.text`; `refs` are for `knowledge__get` |
| `knowledge__recall` | `{query, limit, area?}` | `limit` 8 at session start, 5 per prompt |
| `knowledge__remember` (today) | `{text, title?, tags, area?}` one call per item, `_meta` key per item (HH-6) | |
| `knowledge__remember` (with `items`) | `{items: [{text, kind: "note" \| "digest", tags}] (≤ 50), source: {harness, session}, area?}` (`session` is always sent; `"unknown"` when the harness gives none) | `_meta` key = `"tbb-" + sha256(sorted item keys + "\n" + area + "\n" + session)[0..48]`: a changed batch gets a new key; Knowledge dedupes per item |

## 5. Context block

`Tealbrick Knowledge: memory context for this session (reference only; it can be out of date).` followed by the passages
(`- [<area>] <text>` for recall results), cut to the size budget. No Rules text, no instructions.

## 6. Conformance (to add to CONFORMANCE as H-W1 rows)

H-W1-HH-1 no policy (lint of the pack sources: no permission decision, no rule text) · HH-3 fail-open (bridge down → exit 0,
empty stdout, ≤ budget + 200 ms) · HH-4 scrub (seeded key/token/e-mail/card never reaches the fake bridge) · HH-5 LCM on →
no `prompt` call · HH-6 same item twice → same idempotency key · HH-3b hung bridge → the real process exits 0 at budget + 300 ms
· HH-3c bad flag / unknown harness → exit 0 · HH-7 `TB_HOOKS=0` → no call · Claude Code context ≤ 10,000 chars.
