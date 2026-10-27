// Unreleased (label 0.1.81; C373, G-6): recipients of an outward call — Operation.recipients, DynamicResolution.recipients,
// HookCallInfo.target.recipients / recipientsIncomplete, cap hook_recipients. The extraction rule is NOT in this package (the
// manifest package implements `extractRecipients` once, L1); these tests pin the constants, the types and the schema.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { BRIDGE_CAPS, type HookCallInfo } from "../src/bridge.ts";
import { type DynamicResolution, type Operation, RECIPIENT_KINDS, RECIPIENT_POINTER_MAX, RECIPIENT_SPECS_MAX, RECIPIENTS_MAX, type RecipientSpec } from "../src/manifest.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
  const validate = ajv.getSchema(load("manifest.schema.json").$id);
  assert.ok(validate);
  return validate;
}

const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8")) as { operations: { id: string; effect: string }[] };
const send = ex.operations.find((o) => o.effect === "outward") as unknown as Operation;
const withSend = (op: unknown) => ({ ...ex, operations: [...ex.operations.filter((o) => o.id !== send.id), op] });

test("C373: constants are exact and the kinds are the handle channels plus email", () => {
  assert.deepEqual([...RECIPIENT_KINDS], ["buzz", "slack", "telegram", "email"]);
  assert.equal(RECIPIENT_SPECS_MAX, 8);
  assert.equal(RECIPIENTS_MAX, 64);
  assert.equal(RECIPIENT_POINTER_MAX, 256);
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("hook_recipients"));
  // the schema repeats the limits and the kinds (one schema, one TS mirror)
  const s = load("manifest.schema.json");
  assert.deepEqual(s.$defs.recipientSpec.properties.kind.enum, [...RECIPIENT_KINDS]);
  assert.equal(s.$defs.recipientSpec.properties.pointer.maxLength, RECIPIENT_POINTER_MAX);
  assert.equal(s.$defs.operation.properties.recipients.maxItems, RECIPIENT_SPECS_MAX);
});

test("C373: typed samples (op, resolution, hook target)", () => {
  const spec: RecipientSpec = { pointer: "/to", kind: "email" };
  const op: Operation = { ...send, recipients: [spec, { pointer: "/cc", kind: "email" }] };
  // @ts-expect-error kind is one of RECIPIENT_KINDS
  const badKind: RecipientSpec = { pointer: "/to", kind: "whatsapp" };
  assert.ok(badKind);
  const r: DynamicResolution = { tool: "slack_send", crud: ["create"], effect: "outward", holdFamily: "outward", recipients: [{ pointer: "/channel", kind: "slack" }] };
  const target: HookCallInfo["target"] = { instance: "ins_01M53BAEQSGKVVY4PRM2VE6FBF" as never, product: "connect" as never, op: "tools" as never, tool: r.tool, crud: r.crud, effect: r.effect, recipients: ["slack:U012ABCDEF"], recipientsIncomplete: true };
  // @ts-expect-error recipientsIncomplete is `true` or absent, never false
  const wrong: HookCallInfo["target"] = { ...target, recipientsIncomplete: false };
  assert.ok(wrong);
  assert.equal(op.recipients?.length, 2);
  assert.deepEqual(target.recipients, ["slack:U012ABCDEF"]);
});

test("C373 M-OP-13 (schema part): recipients on an outward op validate; quiet on good, fires on bad", () => {
  const validate = manifestValidator();
  const good = { ...send, recipients: [{ pointer: "/to", kind: "email" }, { pointer: "/people/0/npub", kind: "buzz" }, { pointer: "/a~1b/~0c", kind: "slack" }] };
  assert.equal(validate(withSend(good)), true, JSON.stringify(validate.errors));
  assert.equal(validate(withSend({ ...send, recipients: Array.from({ length: 8 }, (_, i) => ({ pointer: `/r${i}`, kind: "telegram" })) })), true, "8 places");
  const bad: [string, unknown][] = [
    ["empty list", []],
    ["9 places", Array.from({ length: 9 }, (_, i) => ({ pointer: `/r${i}`, kind: "telegram" }))],
    ["root pointer", [{ pointer: "", kind: "email" }]],
    ["no leading slash", [{ pointer: "to", kind: "email" }]],
    ["bad escape", [{ pointer: "/a~2", kind: "email" }]],
    ["lone tilde", [{ pointer: "/a~", kind: "email" }]],
    ["too long", [{ pointer: `/${"x".repeat(256)}`, kind: "email" }]],
    ["unknown kind", [{ pointer: "/to", kind: "whatsapp" }]],
    ["extra member", [{ pointer: "/to", kind: "email", label: "To" }]],
    ["bare string", ["/to"]],
  ];
  for (const [name, recipients] of bad) assert.equal(validate(withSend({ ...send, recipients })), false, name);
  // outward only: a write op (and a dynamic op, which is read) with recipients is refused
  const write = ex.operations.find((o) => o.effect === "write") as unknown as Operation;
  const others = ex.operations.filter((o) => o.id !== write.id);
  assert.equal(validate({ ...ex, operations: [...others, { ...write, recipients: [{ pointer: "/to", kind: "email" }] }] }), false, "write op");
  assert.equal(validate({ ...ex, operations: [...others, write] }), true, "control: the write op alone validates");
});
