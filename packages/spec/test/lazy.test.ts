// v0.1.73 (C330(1), M4b): `listing: "lazy"` and the per-product `<product>__tb_more_search` / `<product>__tb_more_call` pair.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { BRIDGE_CAPS, type MoreCallInput, type MoreSearchResult, type ParsedToolName, TOOL_NAME_RULE } from "../src/bridge.ts";
import { OPERATION_LISTINGS } from "../src/manifest.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

test("v0.1.73: listing vocabulary, schema enum and bridge cap", () => {
  assert.deepEqual([...OPERATION_LISTINGS], ["default", "workflow", "lazy"]);
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("lazy_tools"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const validate = ajv.getSchema(load("manifest.schema.json").$id);
  assert.ok(validate);
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  const agentOp = ex.operations.find((o: { audience: string }) => o.audience === "agent");
  const others = ex.operations.filter((o: unknown) => o !== agentOp);
  assert.equal(validate({ ...ex, operations: [...others, { ...agentOp, listing: "lazy" }] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, operations: [...others, { ...agentOp, listing: "hot" }] }), false, "absent or `default` = listed; there is no `hot` value");
  // the schema enum and the TS vocabulary are one list
  const schemaEnum = load("manifest.schema.json").$defs.operation.properties.listing.enum;
  assert.deepEqual(schemaEnum, [...OPERATION_LISTINGS]);
});

test("v0.1.73: the pair names are valid tool names, carry the reserved tb_ prefix and fit 64 chars for the longest product id", () => {
  const re = new RegExp(TOOL_NAME_RULE.pattern);
  const longestProduct = `a${"b".repeat(31)}`; // ProductId ^[a-z][a-z0-9-]{1,31}$
  for (const op of [TOOL_NAME_RULE.moreSearchOp, TOOL_NAME_RULE.moreCallOp]) {
    assert.ok(op.startsWith("tb_"), "an op id never starts with tb_ (M-OP-1), so the pair cannot collide with a static op");
    const name = `${longestProduct}${TOOL_NAME_RULE.separator}${op}`;
    assert.ok(re.test(name) && name.length <= TOOL_NAME_RULE.maxLength, name);
  }
  const parsed: ParsedToolName[] = [
    { kind: "more_search", product: "notes" },
    { kind: "more_call", product: "notes" },
  ];
  const call: MoreCallInput = { tool: "notes__notes_archive", arguments: { id: "n1" } };
  const answer: MoreSearchResult = { tools: [{ tool: "notes__notes_archive", title: "Archive", description: "Archive a note", inputSchema: { type: "object" }, effect: "write" }], total: 1 };
  assert.equal(parsed.length, 2);
  assert.equal(answer.tools[0]?.tool, call.tool);
});
