# HARNESS-HOOKS — harness hook points → Knowledge (harness wave 1)

Status: docs, no type change, no version bump. Sources: DECISION-LOG C313.1 (governance stays in Tealbrick), C319b (LCM keeps
the context-engine slot), C329(2) (packs call Knowledge through hooks, GBrain's event mapping), C330(2) (harness-facing
packages). Implemented by `@opt2-tealbrick/harness-claude` (`runHook`, `knowledgeHooks`) and `tealbrick hook` (CLI §7).

## 1. Rules (normative)

- **HH-1 No policy.** A hook fetches context and saves memory. It never allows, denies, blocks or rewrites a harness action and
  carries no Rules text. Grants, Rules narrowing and holds apply at the bridge and the app, as for any tool call (C313.1).
- **HH-2 Own credential, through the bridge.** A hook calls Knowledge tools as the agent (K4 relay or K5/K13), never the person
  item, never the app directly.
- **HH-3 Fail-open.** Every hook returns within its budget (§3). On error, timeout, missing tool or a refused call it injects
  nothing and lets the turn go on. `tealbrick hook` always exits 0 (Claude Code treats exit 2 as "block").
- **HH-4 Scrub before send.** Text that leaves the machine (queries, saved items) has keys, tokens (`tb?_…`, `sk-…`, `ghp_…`,
  `xox?-…`, `AKIA…`, JWTs, `Bearer …`), private-key blocks, e-mail addresses and Luhn-valid card numbers replaced by
  `[redacted]`. No secret in argv, env or logs.
- **HH-5 One slot owner.** A harness's context-engine slot (Hermes `context.engine`, OpenClaw `plugins.slots.contextEngine`)
  belongs to the harness or LCM. A Tealbrick pack never sets it and never takes an occupied memory-provider slot. When a context
  engine runs, the per-prompt recall (`prompt`) is skipped; context is added at session start and after compaction only.
- **HH-6 Idempotent saves.** Each single-item save carries `_meta["tealbrick/idempotencyKey"] = "tbh-" + sha256(area + "\n" +
  normalised text)[0..48]`, so a repeated save (compaction twice, Stop after PreCompact) makes one document.

## 2. Event map (GBrain events → Claude Code → Knowledge)

| Event | Claude Code | Hermes (plugin) | Call | Output |
|---|---|---|---|---|
| `session_start` | SessionStart (`source: compact` = rehydrate) | session start | context tool (§4) with `{purpose: "session_start", maxChars, query: <project>}` | context text |
| `prompt` | UserPromptSubmit | `pre_llm_call` only when no context engine | context tool with `purpose: "prompt"`, else `knowledge__recall {query: <prompt>, limit: 5}`; skipped for prompts < 12 chars | context text |
| `pre_compact` | PreCompact | pre-compression | `knowledge__remember` per item (or one `items[]` call when the op has `items`) | none |
| `stop` | Stop | — | `knowledge__remember`, marked items only (backstop) | none |
| `session_end` | SessionEnd (CLI only) | session end | as `pre_compact` | none |

Items (wave 1 rule until the promotion benchmark, WP-HARNESS-WAVE1 X8): lines starting with `remember:`, `#remember` or
`[remember]` in any turn, plus one digest of the last 8 user turns at `pre_compact` / `session_end` (tags `harness, digest`).
≤ 20 items per call, ≤ 2,000 chars per item.

## 3. Budgets

| Event | Budget | Context size |
|---|---|---|
| `session_start` | 1.5 s | 2,000 chars (owner may raise) |
| `prompt` | 0.8 s | 1,000 chars |
| `pre_compact`, `stop`, `session_end` | 3 s | — |

The budget includes relay start-up. Claude Code hook `timeout` (seconds) is set above it (5 / 4 / 8 / 8).

## 4. Tool resolution

From the agent's `tools/list`, in order: `knowledge__context` (planned hot op) → `knowledge__gb_context_pack` (engine entry) →
`knowledge__recall`. Arguments are fitted to the tool's `inputSchema` (unknown keys dropped; a missing required key = skip).
Save = `knowledge__remember`. Names resolve at run time, so a Knowledge release that adds the hot ops needs no hook release.

| Tool | Arguments sent | Notes |
|---|---|---|
| `knowledge__context` | `{purpose: "session_start" \| "after_compact" \| "prompt", maxChars, query?, area?}` | `after_compact` = session start right after a compaction |
| `knowledge__gb_context_pack` | `{entities: "<name>,…" (comma-separated string, ≤ 8 names), budget_tokens: ⌊maxChars / 4⌋, session_id?}` | session start only (the project name is the entity); never for `prompt` (falls back to recall) |
| `knowledge__recall` | `{query, limit, area?}` | `limit` 8 at session start, 5 per prompt |
| `knowledge__remember` (today) | `{text, title?, tags, area?}` one call per item, `_meta` key per item (HH-6) | |
| `knowledge__remember` (with `items`) | `{items: [{text, kind: "note" \| "digest", tags}] (≤ 50), source: {harness, session?}, area?}` | `_meta` key = `"tbb-" + sha256(sorted item keys + "\n" + area + "\n" + session)[0..48]`: a changed batch gets a new key; Knowledge dedupes per item |

## 5. Context block

`Tealbrick Knowledge: memory context for this session (reference only; it can be out of date).` followed by the passages
(`- [<area>] <text>` for recall results), cut to the size budget. No Rules text, no instructions.

## 6. Conformance (to add to CONFORMANCE as H-W1 rows)

H-W1-HH-1 no policy (lint of the pack sources: no permission decision, no rule text) · HH-3 fail-open (bridge down → exit 0,
empty stdout, ≤ budget + 200 ms) · HH-4 scrub (seeded key/token/e-mail/card never reaches the fake bridge) · HH-5 LCM on →
no `prompt` call · HH-6 same item twice → same idempotency key.
