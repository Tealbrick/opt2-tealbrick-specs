// v0.1.91 (C392, C393): messages/1 optional author.verified. Additive; absent = unknown = none (L24).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../schemas/contracts/messages.1.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

const page = (author: Record<string, unknown>) => ({
  rows: [{ id: "m", conversation: "c", sentAt: "2026-10-17T10:00:00Z", author, text: "x", attachments: [], untrusted: true }],
  nextCursor: null,
  exhausted: true,
});

test("v0.1.91: author.verified takes each of the three values", () => {
  for (const verified of ["platform_id", "dkim_spf_aligned", "none"]) {
    assert.equal(validate(page({ kind: "person", handle: "slack:u1", verified })), true, verified);
  }
});

test("v0.1.91: author.verified is optional (an older producer's row still validates)", () => {
  assert.equal(validate(page({ kind: "person", handle: "slack:u1" })), true);
});

test("v0.1.91: any other author.verified value is refused", () => {
  for (const verified of ["yes", "", "PLATFORM_ID", "dkim", true, 1, null]) {
    assert.equal(validate(page({ kind: "person", handle: "slack:u1", verified })), false, String(verified));
  }
});

test("v0.1.91: the schema text carries the MUST rules", () => {
  const d: string = schema.$defs.row.properties.author.properties.verified.description;
  assert.match(d, /MUST NOT grant any trust-based permission/);
  assert.match(d, /MUST NOT set `platform_id` for an email or phone handle/);
  assert.match(d, /MUST set `dkim_spf_aligned` only after its own check/);
});
