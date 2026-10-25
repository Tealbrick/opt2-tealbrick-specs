import { HOST_DENIED_ENV } from "./host.ts";

// Model roles, data policies and compatible providers (v0.1.63, C322(3), C330(4)). Data only.
// MANIFEST §7.1 (modelRoles), BRIDGE §15 (workspace role registry), PORTAL-API §4.7 (persona, role status).

/** What a model call is for. One binding per role (workspace default, optional per-app override). "Chat" = `reasoning`. */
export const MODEL_ROLES = ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * Where inference runs and what the provider may keep.
 * - `local`: base URL on the owner's private network or own server; the bridge checks the URL (BRIDGE §15.3).
 * - `zdr`: rented inference under a zero-data-retention contract; the owner attests it per binding (not verifiable).
 * - `standard`: any other.
 */
export const DATA_POLICIES = ["local", "zdr", "standard"] as const;
export type DataPolicy = (typeof DATA_POLICIES)[number];

/** Higher = stricter. A binding satisfies `minPolicy` when `DATA_POLICY_RANK[binding] >= DATA_POLICY_RANK[minPolicy]`. */
export const DATA_POLICY_RANK: Readonly<Record<DataPolicy, number>> = { standard: 0, zdr: 1, local: 2 };

export interface ModelProvider {
  /** stable id, stored in bindings */
  id: string;
  label: string;
  /** roles the provider serves (from provider docs; the app's first real call is the proof — the bridge calls no model) */
  roles: readonly ModelRole[];
  /** an API key is needed (false for local servers without auth) */
  keyNeeded: boolean;
  /** runs on the owner's machine or network: binding defaults to `local` and needs a base URL */
  local: boolean;
  /** the owner may attest a zero-data-retention contract for it (C336 Q3: owner-attested; gateways and custom addresses
   *  included, because the owner, not Tealbrick, holds the upstream contract) */
  zdrOffered: boolean;
  /** speaks the OpenAI HTTP API (chat/embeddings) at `baseUrl` */
  openaiCompatible: boolean;
  /** routes to other upstream providers (OpenRouter, LiteLLM, a custom address): a `zdr` attestation names the host and
   *  covers every upstream; a model change clears it (BRIDGE §15.3, QA-SPEC42-11) */
  gateway: boolean;
  /** absent = the owner must enter a base URL */
  defaultBaseUrl?: string;
}

/**
 * Compatible providers per role. A wrong row is a spec patch, never app code. Role support is from provider docs and the
 * v1 Knowledge "Models" step (`_v1/knowledge/tealbrick.app.json`); UNVERIFIED by test call.
 */
export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  { id: "openai", label: "OpenAI", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: true, gateway: false, defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", roles: ["reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: false, gateway: false, defaultBaseUrl: "https://api.anthropic.com" },
  { id: "google", label: "Google Gemini", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"], keyNeeded: true, local: false, zdrOffered: false, openaiCompatible: false, gateway: false, defaultBaseUrl: "https://generativelanguage.googleapis.com" },
  { id: "voyage", label: "Voyage AI", roles: ["embeddings", "rerank"], keyNeeded: true, local: false, zdrOffered: false, openaiCompatible: false, gateway: false, defaultBaseUrl: "https://api.voyageai.com/v1" },
  { id: "openrouter", label: "OpenRouter", roles: ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: true, gateway: true, defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "deepseek", label: "DeepSeek", roles: ["reasoning", "utility", "dreaming", "summarize"], keyNeeded: true, local: false, zdrOffered: false, openaiCompatible: true, gateway: false, defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "together", label: "Together AI", roles: ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: true, local: false, zdrOffered: false, openaiCompatible: true, gateway: false, defaultBaseUrl: "https://api.together.xyz/v1" },
  { id: "mistral", label: "Mistral AI", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: true, local: false, zdrOffered: false, openaiCompatible: true, gateway: false, defaultBaseUrl: "https://api.mistral.ai/v1" },
  { id: "azure-openai", label: "Azure OpenAI", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: true, gateway: false },
  { id: "ollama", label: "Ollama (own server)", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: false, local: true, zdrOffered: false, openaiCompatible: true, gateway: false },
  { id: "llama-server", label: "llama.cpp server (own server)", roles: ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize"], keyNeeded: false, local: true, zdrOffered: false, openaiCompatible: true, gateway: false },
  { id: "lm-studio", label: "LM Studio (own machine)", roles: ["embeddings", "reasoning", "utility", "dreaming", "summarize", "vision"], keyNeeded: false, local: true, zdrOffered: false, openaiCompatible: true, gateway: false },
  { id: "litellm", label: "LiteLLM proxy", roles: ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: true, gateway: true },
  { id: "openai-compatible", label: "OpenAI-compatible (custom address)", roles: ["embeddings", "rerank", "reasoning", "utility", "dreaming", "summarize", "vision", "transcribe"], keyNeeded: true, local: false, zdrOffered: true, openaiCompatible: true, gateway: true },
];

/**
 * App attention codes for model roles (MANIFEST §7.1). `model_role_missing`: a required role does not resolve (readiness
 * `needs_keys`). `model_role_optional`: an optional role is unset and the app runs with less (readiness `degraded`).
 * `embeddings_changed`: the embeddings binding differs from the one the app's index was built with; the app keeps the old
 * one until the owner approves a re-embed. Core's update gate treats these as configuration, not regression (PORTAL-API v0.1.63).
 */
export const MODEL_ROLE_ATTENTION = ["model_role_missing", "model_role_optional", "embeddings_changed"] as const;

/** `provider` everywhere (bindings, status rows, hints, K11 claim) is a `MODEL_PROVIDERS` id of this form. */
export const PROVIDER_ID_PATTERN = "^[a-z][a-z0-9-]{1,31}$" as const;
/** `model` labels (bindings, status rows, hints): 1..128 chars, no whitespace, control characters or `//`, so a pasted key
 *  sentence or a URL with spaces cannot pass as a label; the bridge page refuses anything else (BRIDGE §15.2). */
export const MODEL_ID_PATTERN = "^(?!.*//)[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$" as const;
/** Max role hints in `tickets.keys` input and the K11 `roles` claim. */
export const MODEL_ROLE_HINTS_MAX = 8;

/** Agent card persona (PORTAL-API v0.1.63): markdown, the system-prompt fragment the owner edits. The limit counts UTF-16
 *  code units (JavaScript `.length`, as BRIDGE §14 `summary`); JSON Schema `maxLength` (code points) is only an outer bound. */
export const PERSONA_MAX_CHARS = 8000;

/** Total persona text per workspace (UTF-16 units over all agents), QA-SPEC49-11. With control characters and lone
 *  surrogates forbidden (PERSONA_PATTERN, well-formed UTF-16), one unit costs at most 3 bytes in JSON, so 250,000 units are
 *  ≤ 1 MB after base64url — well inside CONFIG_CORE_MAX_BYTES. Core refuses a create/update past it (`validation_failed`). */
export const PERSONA_WORKSPACE_MAX_CHARS = 250_000;
/** Persona text (C353, QA-SPEC49-23): one rule by Unicode property, so no range can be forgotten. A persona is accepted when
 *  every character is TAB, LF, a PERSONA_MARKERS character (allowed, shown as a marker), or NOT in \p{Cc}, \p{Cf}, \p{Cs}
 *  (lone surrogates), \p{Default_Ignorable_Code_Point}, U+2028 or U+2029 — and no variation selector directly follows a
 *  marker character (C356 / QA-SPEC49-29: covers VS VS and VS ZWJ VS payloads; 🏳️‍🌈 and ❤️‍🔥 pass because their VS follows
 *  the base character). So bidi controls, tag characters, Hangul fillers (U+115F,
 *  U+1160, U+3164, U+FFA0), BOM, invisible operators etc. are refused, and every allowed invisible character is a marker.
 *  Unicode-mode regex (`u` flag) of the runtime (Node 24 / current browsers); Core's verdict wins. Clients turn CRLF into LF.
 *  Core also checks isWellFormed(). */
/** v0.1.70: the ONE class of invisible / reordering characters (control, format incl. bidi U+202A–202E and U+2066–2069,
 *  surrogates, default-ignorables, line/paragraph separators). PERSONA_PATTERN and MACHINE_LABEL_PATTERN (routes.ts) both use it. */
export const INVISIBLE_CHAR_CLASS = "\\p{Cc}\\p{Cf}\\p{Cs}\\p{Default_Ignorable_Code_Point}\\u2028\\u2029" as const;
/** QA-SPEC55-1 (Coordinator): a manifest `name` has no control, format or other invisible character (INVISIBLE_CHAR_CLASS
 *  without marker exceptions), so a name never needs JSON escapes and cannot hide text. Schema `manifest.schema.json#/name`. */
export const MANIFEST_NAME_PATTERN = `^[^${INVISIBLE_CHAR_CLASS}]+$` as const;
/** QA-SPEC55-1: the slice's `companionCallers[].name` is a display copy of the caller's manifest name, at most this many bytes
 *  as serialized JSON (without the quotes); Core cuts it at a code-point boundary, never inside an escape, and counts every
 *  caller name at exactly this size in its measured worst-case slice. */
export const CALLER_NAME_MAX_JSON_BYTES = 80;

/** QA-SPEC54-4 / sdk#52 S4-3: env names a model role may NOT fill (MANIFEST M-MR-4) — the host deny list (code loading,
 *  library injection, egress) plus TLS trust and package-manager config. Prefixes end with "*"; besides these, any name
 *  ending in `_PROXY` is refused. Role values are canonical origins, model ids, numbers and keys, so the reachable harm is
 *  egress routing and TLS trust (e.g. a model id "0" in NODE_TLS_REJECT_UNAUTHORIZED). */
export const MODEL_ROLE_DENIED_ENV = [
  ...HOST_DENIED_ENV,
  "NODE_TLS_REJECT_UNAUTHORIZED", "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "NPM_CONFIG_*", "PYTHON*", "GIT_*",
] as const;
export const PERSONA_PATTERN =
  `^(?![\\s\\S]*[\\u00AD\\u034F\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u{110BD}\\u{110CD}\\u180B-\\u180F\\u200B-\\u200F\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}][\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}])(?:[\\t\\n]|[\\u00AD\\u034F\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u{110BD}\\u{110CD}\\u180B-\\u180F\\u200B-\\u200F\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]|(?![${INVISIBLE_CHAR_CLASS}])[\\s\\S])*$` as const;

/** C353: allowed invisible characters that scripts need (Persian, Hebrew, Arabic, Sinhala, Mongolian, Japanese IVS, emoji
 *  ZWJ sequences). The drafts review and the persona editor show each one as a visible labelled marker (e.g. `⟨ZWJ⟩`) next
 *  to the text, so nothing is hidden from the owner. `[from, to]` inclusive code points. */
export const PERSONA_MARKERS: readonly { from: number; to: number; label: string }[] = [
  { from: 0x00ad, to: 0x00ad, label: "SHY" },
  { from: 0x034f, to: 0x034f, label: "CGJ" },
  { from: 0x0600, to: 0x0605, label: "ANS" },
  { from: 0x061c, to: 0x061c, label: "ALM" },
  { from: 0x06dd, to: 0x06dd, label: "ANS" },
  { from: 0x070f, to: 0x070f, label: "PCM" },
  { from: 0x0890, to: 0x0891, label: "PCM" },
  { from: 0x08e2, to: 0x08e2, label: "PCM" },
  { from: 0x180b, to: 0x180d, label: "FVS" },
  { from: 0x180e, to: 0x180e, label: "MVS" },
  { from: 0x180f, to: 0x180f, label: "FVS" },
  { from: 0x200b, to: 0x200b, label: "ZWSP" },
  { from: 0x200c, to: 0x200c, label: "ZWNJ" },
  { from: 0x200d, to: 0x200d, label: "ZWJ" },
  { from: 0x200e, to: 0x200e, label: "LRM" },
  { from: 0x200f, to: 0x200f, label: "RLM" },
  { from: 0xfe00, to: 0xfe0f, label: "VS" },
  { from: 0xe0100, to: 0xe01ef, label: "VS" },
  { from: 0x110bd, to: 0x110bd, label: "PCM" },
  { from: 0x110cd, to: 0x110cd, label: "PCM" },
];

/** Max origins in the owner's "Own hosts" list on the Keys and models page (BRIDGE §15.3). */
export const OWN_HOSTS_MAX = 32;

/** Never local, even when the owner lists them: link-local, cloud metadata (AWS IPv6, Alibaba, Oracle, Azure wireserver),
 *  "this network", unspecified. BRIDGE §15.3 step 3. Pinned by test. */
export const NEVER_LOCAL = [
  "169.254.0.0/16",
  "fe80::/10",
  "fd00:ec2::254/128",
  "100.100.100.200/32",
  "192.0.0.192/32",
  "168.63.129.16/32",
  "0.0.0.0/8",
  "::/128",
] as const;
/** Metadata host names that are never local, even when listed (BRIDGE §15.3 step 3). */
export const NEVER_LOCAL_HOSTNAMES = ["metadata.google.internal", "metadata.goog", "metadata"] as const;

/** Why a binding has its data policy (BRIDGE §15.3/§15.5): `verified` = the bridge checked it from the URL;
 *  `owner_attested` = the owner said so (every `zdr`, and `local` through the Own hosts list). */
export const POLICY_BASES = ["verified", "owner_attested"] as const;
export type PolicyBasis = (typeof POLICY_BASES)[number];

/** MCP resource URI under which the bridge serves the calling agent's persona (BRIDGE §15.6). */
export const PERSONA_RESOURCE_URI = "tb://agent/persona" as const;
