// v0.1.90 (C392 L0, C395): AGENTIC_HARNESS_OPTION_IDS (routes.ts). Harness packages themselves are delivered at run time by
// the app (HARNESS-HOOKS "Harness package delivery"); the manifest has no harness package field.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SPEC_VERSION } from "../src/index.ts";
import { AGENTIC_HARNESS_OPTION_IDS, HARNESS_OPTION_IDS, isAgenticHarnessOptionId } from "../src/routes.ts";

test("AGENTIC_HARNESS_OPTION_IDS: the agentic_system rows, a subset of HARNESS_OPTION_IDS", () => {
  assert.deepEqual([...AGENTIC_HARNESS_OPTION_IDS], ["claude-code", "eve", "tealbrick-cli"]);
  assert.equal(new Set(AGENTIC_HARNESS_OPTION_IDS).size, AGENTIC_HARNESS_OPTION_IDS.length);
  for (const id of AGENTIC_HARNESS_OPTION_IDS) assert.ok((HARNESS_OPTION_IDS as readonly string[]).includes(id), id);
});

test("isAgenticHarnessOptionId: true for each agentic id only", () => {
  for (const id of AGENTIC_HARNESS_OPTION_IDS) assert.equal(isAgenticHarnessOptionId(id), true, id);
  // desktop and other rows, the Hermes runtime (C393 Q4: no hermes row), old spellings and non-strings
  for (const bad of ["tbd-default", "claude-desktop", "codex-desktop", "generic-mcp", "hermes", "claude_code", "tealbrick_cli", "", null, undefined, 1]) {
    assert.equal(isAgenticHarnessOptionId(bad), false, String(bad));
  }
  // every non-agentic option id is refused
  for (const id of HARNESS_OPTION_IDS) assert.equal(isAgenticHarnessOptionId(id), (AGENTIC_HARNESS_OPTION_IDS as readonly string[]).includes(id), id);
});

test("SPEC_VERSION 0.1.93 matches package.json", () => {
  assert.equal(SPEC_VERSION, "0.1.93");
  assert.equal(SPEC_VERSION, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});
