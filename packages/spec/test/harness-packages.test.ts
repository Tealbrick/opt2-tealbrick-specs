// v0.1.90 (C392 L0, C330(2), C345, C393 Q4/Q6): manifest `harnessPackages` (MANIFEST §10.1, HARNESS-HOOKS HH-5/HH-8),
// AGENTIC_HARNESS_OPTION_IDS (routes.ts) and the shared cases file examples/harness-packages.cases.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { SPEC_VERSION } from "../src/index.ts";
import {
  CONTEXT_ENGINE_SLOT_OWNERS,
  HARNESS_HOOK_EVENTS,
  HARNESS_PACKAGE_RUNTIMES,
  HARNESS_PACKAGES_MAX,
  HARNESS_UPSTREAM_COMMIT_PATTERN,
  HARNESS_UPSTREAM_KINDS,
  HARNESS_UPSTREAM_REPO_PATTERN,
  type HarnessPackage,
  type Manifest,
} from "../src/manifest.ts";
import { AGENTIC_HARNESS_OPTION_IDS, HARNESS_OPTION_IDS, isAgenticHarnessOptionId } from "../src/routes.ts";

const schema = JSON.parse(readFileSync(new URL("../schemas/manifest.schema.json", import.meta.url), "utf8"));
const notes = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../examples/harness-packages.cases.json", import.meta.url), "utf8")) as {
  valid: Case[];
  invalid: (Case & { rule: string; code: string; by: "schema" | "validator" })[];
};
type Case = { what: string; manifestId?: string; harnessPackages: HarnessPackage[] };
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
const withPackages = (harnessPackages: unknown[], id: string = notes.id) => ({ ...notes, id, harnessPackages });
const manifestOf = (c: Case) => withPackages(c.harnessPackages, c.manifestId);
// M-HP-5 written from the doc (MANIFEST §10.1): a slot-taking upstream only as a CONTEXT_ENGINE_SLOT_OWNERS pair.
const slotRuleOk = (c: Case) =>
  c.harnessPackages.every((p) =>
    (p.upstreams ?? []).every((u) => !u.takesContextEngineSlot || CONTEXT_ENGINE_SLOT_OWNERS.some((o) => o.app === (c.manifestId ?? notes.id) && o.upstream === u.name)),
  );

test("AGENTIC_HARNESS_OPTION_IDS: the agentic_system rows, a subset of HARNESS_OPTION_IDS", () => {
  assert.deepEqual([...AGENTIC_HARNESS_OPTION_IDS], ["claude-code", "eve", "tealbrick-cli"]);
  for (const id of AGENTIC_HARNESS_OPTION_IDS) assert.ok((HARNESS_OPTION_IDS as readonly string[]).includes(id), id);
  for (const id of AGENTIC_HARNESS_OPTION_IDS) assert.equal(isAgenticHarnessOptionId(id), true, id);
  // desktop and other rows, the Hermes runtime (C393 Q4: no hermes row) and non-strings are not agentic option ids
  for (const bad of ["tbd-default", "claude-desktop", "codex-desktop", "generic-mcp", "hermes", "claude_code", "", null, 1]) {
    assert.equal(isAgenticHarnessOptionId(bad), false, String(bad));
  }
});

test("schema mirrors the TS vocabularies (one list each, L1)", () => {
  const pkg = schema.$defs.harnessPackage;
  const up = schema.$defs.harnessUpstream;
  assert.equal(schema.properties.harnessPackages.maxItems, HARNESS_PACKAGES_MAX);
  assert.deepEqual(pkg.properties.harnesses.items.enum, [...AGENTIC_HARNESS_OPTION_IDS]);
  assert.deepEqual(pkg.properties.runtimes.items.enum, [...HARNESS_PACKAGE_RUNTIMES]);
  assert.deepEqual(pkg.properties.hooks.properties.events.items.enum, [...HARNESS_HOOK_EVENTS]);
  assert.equal(pkg.properties.hooks.properties.events.maxItems, HARNESS_HOOK_EVENTS.length);
  assert.deepEqual(up.properties.kind.enum, [...HARNESS_UPSTREAM_KINDS]);
  assert.equal(up.properties.repo.pattern, HARNESS_UPSTREAM_REPO_PATTERN);
  assert.equal(up.properties.commit.pattern, HARNESS_UPSTREAM_COMMIT_PATTERN);
  assert.equal(up.properties.licence.pattern, schema.properties.source.properties.license.pattern, "same SPDX pattern as source.license");
  assert.deepEqual(new Set(up.required), new Set(Object.keys(up.properties)), "every upstream field is required");
  assert.equal(pkg.additionalProperties, false);
  assert.equal(up.additionalProperties, false);
  assert.equal("defaultOn" in pkg.properties, false, "HH-0b: no default-on field");
});

test("a manifest without harnessPackages still validates (additive field)", () => {
  assert.equal("harnessPackages" in notes, false);
  assert.equal(validate(notes), true, JSON.stringify(validate.errors));
});

test("every case is an array of package objects (a case never fails only on its outer shape)", () => {
  for (const c of [...cases.valid, ...cases.invalid]) {
    assert.ok(Array.isArray(c.harnessPackages) && c.harnessPackages.length >= 1, c.what);
    for (const p of c.harnessPackages) assert.ok(p !== null && typeof p === "object" && !Array.isArray(p), c.what);
  }
});

test("valid cases pass the schema", () => {
  assert.ok(cases.valid.length >= 4);
  for (const c of cases.valid) assert.equal(validate(manifestOf(c)), true, `${c.what}: ${JSON.stringify(validate.errors)}`);
});

test("invalid cases (by schema) are refused under /harnessPackages", () => {
  const bySchema = cases.invalid.filter((c) => c.by === "schema");
  assert.ok(bySchema.length >= 30);
  for (const c of bySchema) {
    assert.equal(c.code, "harness_package_invalid", c.what);
    assert.match(c.rule, /^M-HP-[1-3]$/, c.what);
    assert.equal(validate(manifestOf(c)), false, c.what);
    const errors = validate.errors ?? [];
    assert.ok(errors.length > 0, c.what);
    for (const e of errors) assert.match(e.instancePath, /^\/harnessPackages(\/|$)/, `${c.what}: ${e.instancePath} ${e.message}`);
  }
});

test("invalid cases (by validator) pass the schema; only the manifest package rule refuses them", () => {
  const byValidator = cases.invalid.filter((c) => c.by === "validator");
  assert.ok(byValidator.length >= 3);
  for (const c of byValidator) {
    assert.match(c.rule, /^M-HP-[45]$/, c.what);
    assert.equal(validate(manifestOf(c)), true, `${c.what}: ${JSON.stringify(validate.errors)}`);
  }
});

test("the four L0 acceptance cases", () => {
  const find = (what: string) => {
    const c = cases.invalid.find((x) => x.what === what);
    assert.ok(c, what);
    return c;
  };
  const ok = cases.valid[0];
  assert.equal(validate(manifestOf(ok)), true, "valid Hermes package");
  for (const what of ["desktop harness claude-desktop", "commit is a tag, not 40 hex", "short commit", "runtime hermes without harness tealbrick-cli"]) {
    assert.equal(validate(manifestOf(find(what))), false, what);
  }
});

test("rule isolation: each M-HP-2/3 relation fails alone", () => {
  // One relation broken, every other relation satisfied: the schema refuses it only through allOf.
  for (const what of [
    "runtime hermes without harness tealbrick-cli",
    "harness claude-code without runtime claude-code",
    "hermes_plugin without runtime hermes",
    "claude_code_plugin without runtime claude-code",
    "claude_code_plugin takes the context-engine slot",
    "two upstreams take the slot",
  ]) {
    const c = cases.invalid.find((x) => x.what === what);
    assert.ok(c, what);
    assert.equal(validate(manifestOf(c)), false, what);
    assert.ok((validate.errors ?? []).some((e) => e.keyword === "if" || e.keyword === "const" || e.keyword === "contains" || e.keyword === "maxContains"), what);
  }
});

test("M-HP-5 (Coordinator HH-5 ruling): only the knowledge app's lcm-x may take the context-engine slot", () => {
  assert.deepEqual(CONTEXT_ENGINE_SLOT_OWNERS, [{ app: "knowledge", upstream: "lcm-x" }]);
  for (const c of cases.valid) assert.equal(slotRuleOk(c), true, c.what);
  const hp5 = cases.invalid.filter((c) => c.rule === "M-HP-5");
  assert.equal(hp5.length, 2);
  for (const c of hp5) assert.equal(slotRuleOk(c), false, c.what);
  // every other validator case fails for its own rule, not for M-HP-5
  for (const c of cases.invalid.filter((x) => x.rule === "M-HP-4")) assert.equal(slotRuleOk(c), true, c.what);
  const slotCases = cases.valid.filter((c) => c.harnessPackages.some((p) => (p.upstreams ?? []).some((u) => u.takesContextEngineSlot)));
  assert.ok(slotCases.length >= 1);
  for (const c of slotCases) assert.equal(c.manifestId, "knowledge", c.what);
});

test("typed HarnessPackage (v0.1.90) and SPEC_VERSION", () => {
  const p: HarnessPackage = {
    id: "knowledge_hermes",
    title: "Knowledge memory for Hermes",
    harnesses: ["tealbrick-cli"],
    runtimes: ["hermes"],
    hooks: { module: "@opt2-tealbrick/hooks-knowledge", events: ["session_start", "pre_compact", "stop", "session_end"] },
    upstreams: [
      {
        name: "lcm-x",
        repo: "github.com/electricsheephq/lcm-x",
        commit: "0123456789abcdef0123456789abcdef01234567",
        licence: "MIT",
        kind: "hermes_plugin",
        takesContextEngineSlot: true,
        dataOnAgentMachine: "Session store under the Hermes home of this agent.",
        erase: "Per session only.",
      },
    ],
  };
  const m: Pick<Manifest, "id" | "harnessPackages"> = { id: "knowledge", harnessPackages: [p] };
  assert.equal(validate(withPackages(m.harnessPackages ?? [], m.id)), true, JSON.stringify(validate.errors));
  assert.equal(SPEC_VERSION, "0.1.90");
  assert.equal(SPEC_VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});
