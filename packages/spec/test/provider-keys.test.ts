// v0.1.92 (BRIDGE "one key per provider", Martin 2026-11-06): the provider-key prefix and the requirement → provider link.
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyProviderOf, MODEL_PROVIDERS, PROVIDER_DEFAULT_KEY_PREFIX } from "../src/models.ts";

test("v0.1.92: the provider key lives in the provider-key namespace pk:", () => {
  assert.equal(PROVIDER_DEFAULT_KEY_PREFIX, "pk:@");
  assert.ok(PROVIDER_DEFAULT_KEY_PREFIX.startsWith("pk:"));
});

test("v0.1.92: a requirement provider links by id or label, case-insensitive and trimmed", () => {
  assert.equal(keyProviderOf("OpenAI")?.id, "openai");
  assert.equal(keyProviderOf(" openai ")?.id, "openai");
  assert.equal(keyProviderOf("Anthropic")?.id, "anthropic");
  assert.equal(keyProviderOf("google gemini")?.id, "google");
  assert.equal(keyProviderOf("deepseek")?.id, "deepseek");
});

test("v0.1.92: no link for an unknown provider, an empty value or a provider that needs no key", () => {
  assert.equal(keyProviderOf("Composio"), undefined);
  assert.equal(keyProviderOf(""), undefined);
  assert.equal(keyProviderOf(undefined), undefined);
  assert.equal(keyProviderOf(null), undefined);
  for (const p of MODEL_PROVIDERS.filter((x) => !x.keyNeeded)) {
    assert.equal(keyProviderOf(p.id), undefined, p.id);
    assert.equal(keyProviderOf(p.label), undefined, p.label);
  }
});

test("v0.1.92: every keyNeeded provider links to itself by id and by label", () => {
  for (const p of MODEL_PROVIDERS.filter((x) => x.keyNeeded)) {
    assert.equal(keyProviderOf(p.id)?.id, p.id);
    assert.equal(keyProviderOf(p.label)?.id, p.id);
  }
});
