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
