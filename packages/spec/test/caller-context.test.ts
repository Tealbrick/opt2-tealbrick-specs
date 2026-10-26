// v0.1.77 (C367): P3 app_hold_status and P4 app_call_context — constants, the key pattern, and the shared case file.
// The full validator is NOT in this package (the manifest package implements it once, L1). The reference checker below is test-only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { BRIDGE_CAPS, CALLER_CONTEXT_KEY_TAIL, CALLER_CONTEXT_MAX_BYTES, CALLER_CONTEXT_MAX_DEPTH, type CallEnvelope, callerContextKeyPattern, RESERVED_CONTEXT_PREFIX } from "../src/bridge.ts";
import { COMPANION_HOLD_STATUS_OP, STANDARD_OPERATIONS, WILDCARD_COMPANION_OPS } from "../src/manifest.ts";
import { CALLER_CONTEXT_SUMMARY_MAX_CHARS, CALLER_CONTEXT_SUMMARY_VALUE_MAX_CHARS, CALLER_CONTEXT_SUMMARY_VALUE_SEGMENTS, type CallAppOptions, type HoldsPendingItem } from "../src/sdk.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface KeyCase { name: string; callerProduct: string | null; context: Json; ok: boolean; pointer?: string }
interface SummaryCase { name: string; context: Record<string, Json>; summary: string }
const fx = JSON.parse(readFileSync(new URL("../examples/caller-context.cases.json", import.meta.url), "utf8")) as {
  limits: { maxBytes: number; maxDepth: number; summaryMaxChars: number; summaryValueMaxChars: number };
  cases: KeyCase[];
  summaryCases: SummaryCase[];
};

// No JCS implementation exists in this repo. For I-JSON values, JCS = keys sorted (UTF-16 code units) at every level +
// JSON.stringify for scalars (ES number and string serialization, minimal escaping). That is what this checker uses.
const jcs = (v: Json): string => {
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k] as Json)}`).join(",")}}`;
  return JSON.stringify(v);
};
const jcsBytes = (v: Json) => Buffer.byteLength(jcs(v), "utf8");
// a scalar is depth 0, [1] depth 1, {"a":[1]} depth 2
const depth = (v: Json): number => (v !== null && typeof v === "object" ? 1 + Math.max(-1, ...Object.values(v).map(depth)) : 0);
const esc = (k: string) => k.replaceAll("~", "~0").replaceAll("/", "~1");

// Reference checker: the first failure wins, in the order the case-file description gives.
function check(product: string | null, context: Json): { ok: true } | { ok: false; pointer: string } {
  if (context === null || typeof context !== "object" || Array.isArray(context)) return { ok: false, pointer: "/context" };
  const keys = Object.keys(context).sort();
  if (keys.length > 0 && product === null) return { ok: false, pointer: "/context" };
  if (jcsBytes(context) > CALLER_CONTEXT_MAX_BYTES) return { ok: false, pointer: "/context" };
  for (const k of keys) {
    if (k.startsWith(RESERVED_CONTEXT_PREFIX) || !callerContextKeyPattern(product as string).test(k)) return { ok: false, pointer: `/context/${esc(k)}` };
  }
  for (const k of keys) if (depth(context[k] as Json) > CALLER_CONTEXT_MAX_DEPTH) return { ok: false, pointer: `/context/${esc(k)}` };
  return { ok: true };
}

// Reference summary (SDK-API §18.6 rule 6). Counts code points, not UTF-16 units.
const cutCp = (s: string, n: number) => Array.from(s).slice(0, n).join("");
function summary(context: Record<string, Json>): string {
  const parts = Object.keys(context).sort().map((k) => {
    const last = k.split(".").at(-1) as string;
    const v = context[k] as Json;
    const scalar = v === null || typeof v !== "object";
    return scalar && (CALLER_CONTEXT_SUMMARY_VALUE_SEGMENTS as readonly string[]).includes(last) ? `${k}=${cutCp(JSON.stringify(v), CALLER_CONTEXT_SUMMARY_VALUE_MAX_CHARS)}` : k;
  });
  const all = parts.join("; ");
  const cps = Array.from(all);
  return cps.length > CALLER_CONTEXT_SUMMARY_MAX_CHARS ? `${cps.slice(0, CALLER_CONTEXT_SUMMARY_MAX_CHARS - 1).join("")}…` : all;
}

test("v0.1.77 (C367 P4): constants are exact and the case file repeats them", () => {
  assert.equal(CALLER_CONTEXT_MAX_BYTES, 2048);
  assert.equal(CALLER_CONTEXT_MAX_DEPTH, 3);
  assert.equal(CALLER_CONTEXT_KEY_TAIL, "[a-z0-9_]{1,40}(\\.[a-z0-9_]{1,40}){0,3}");
  assert.equal(CALLER_CONTEXT_SUMMARY_MAX_CHARS, 256);
  assert.equal(CALLER_CONTEXT_SUMMARY_VALUE_MAX_CHARS, 64);
  assert.deepEqual([...CALLER_CONTEXT_SUMMARY_VALUE_SEGMENTS], ["workflow", "version", "run"]);
  assert.deepEqual(fx.limits, { maxBytes: CALLER_CONTEXT_MAX_BYTES, maxDepth: CALLER_CONTEXT_MAX_DEPTH, summaryMaxChars: CALLER_CONTEXT_SUMMARY_MAX_CHARS, summaryValueMaxChars: CALLER_CONTEXT_SUMMARY_VALUE_MAX_CHARS });
  assert.equal(RESERVED_CONTEXT_PREFIX, "tb.");
});

test("v0.1.77 (C367): both new bridge caps are listed once, after the older ones", () => {
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("app_hold_status"));
  assert.ok((BRIDGE_CAPS as readonly string[]).includes("app_call_context"));
  assert.equal(new Set(BRIDGE_CAPS).size, BRIDGE_CAPS.length);
  for (const cap of BRIDGE_CAPS) assert.match(cap, /^[a-z][a-z0-9_]{0,39}$/, cap); // Core's cap normalisation rule (SDK-API v0.1.54)
});

test("v0.1.77 (C367 P4): callerContextKeyPattern(product) is ^<product>\\.<tail>$", () => {
  const p = callerContextKeyPattern("evolution");
  assert.equal(p.source, `^evolution\\.${CALLER_CONTEXT_KEY_TAIL}$`);
  for (const ok of ["evolution.run", "evolution.a_1", "evolution.a.b.c.d", `evolution.${"a".repeat(40)}`]) assert.ok(p.test(ok), ok);
  for (const bad of ["evolution", "evolution.", "evolution.Run", "evolution.a.b.c.d.e", `evolution.${"a".repeat(41)}`, "evolution..a", "evolution.a.", "evolutionx.run", "kanban.run", "tb.run", "evolution.a-b", "evolution.a b", "evolution.run\n", "xevolution.run"]) assert.ok(!p.test(bad), bad);
  assert.ok(callerContextKeyPattern("my-app").test("my-app.run"));
  assert.ok(!callerContextKeyPattern("my-app").test("my_app.run"));
});

test("v0.1.77 (C367 P4): every key row of the case file agrees with the reference checker", () => {
  assert.ok(fx.cases.length >= 15);
  assert.equal(new Set(fx.cases.map((c) => c.name)).size, fx.cases.length);
  for (const c of fx.cases) {
    const r = check(c.callerProduct, c.context);
    assert.equal(r.ok, c.ok, c.name);
    if (!c.ok) assert.equal((r as { pointer: string }).pointer, c.pointer, c.name);
    else assert.equal(c.pointer, undefined, c.name);
  }
});

test("v0.1.77 (C367 P4): the rows cover the edges the contract names", () => {
  const by = (n: string) => fx.cases.find((c) => c.name === n) as KeyCase;
  // size: exactly 2048 passes, 2049 does not; the multi-byte rows have fewer characters than bytes
  assert.equal(jcsBytes(by("jcs_exactly_2048_bytes").context), 2048);
  assert.equal(jcsBytes(by("jcs_2049_bytes").context), 2049);
  assert.equal(jcsBytes(by("multibyte_2048_bytes_ok").context), 2048);
  const mb = by("multibyte_2049_bytes_fewer_chars").context as Record<string, string>;
  assert.equal(jcsBytes(mb), 2049);
  assert.ok(Array.from(jcs(mb)).length < CALLER_CONTEXT_MAX_BYTES, "a counter of characters would wrongly accept this row");
  // depth: [1] = 1, {"a":[1]} = 2
  assert.equal(depth(1), 0);
  assert.equal(depth([1]), 1);
  assert.equal(depth({ a: [1] }), 2);
  assert.equal(depth((by("depth_3_ok").context as Record<string, Json>)["evolution.a"] as Json), 3);
  assert.equal(depth((by("depth_4").context as Record<string, Json>)["evolution.a"] as Json), 4);
  // Evolution's fixture is accepted
  assert.deepEqual(Object.keys(by("evolution_fixture").context as object).sort(), ["evolution.run", "evolution.step", "evolution.version", "evolution.workflow"]);
  // a caller with no verified product: nothing but the empty object
  assert.equal(by("non_prd_caller_nonempty").callerProduct, null);
  assert.equal(by("non_prd_caller_nonempty").ok, false);
  assert.equal(by("non_prd_caller_empty").ok, true);
});

test("v0.1.77 (C367 P4): pointer keys are escaped (RFC 6901)", () => {
  assert.equal(esc("a/b~c"), "a~1b~0c");
  assert.deepEqual(check("evolution", { "evolution/x": 1 }), { ok: false, pointer: "/context/evolution~1x" });
});

test("v0.1.77 (C367 P4): every summary row agrees with the reference summary; the cut rules hold", () => {
  assert.ok(fx.summaryCases.length >= 2);
  for (const s of fx.summaryCases) assert.equal(summary(s.context), s.summary, s.name);
  const by = (n: string) => fx.summaryCases.find((s) => s.name === n) as SummaryCase;
  assert.equal(by("evolution_fixture").summary, 'evolution.run="run_01J9Y"; evolution.step; evolution.version=3; evolution.workflow="wf_01J9X"');
  // object values and other last segments show the bare key
  assert.equal(by("non_scalar_and_other_segments").summary, "evolution.note; evolution.run.step; evolution.version=7; evolution.workflow; evolution.x.run=true");
  // value cut: 64 code points of the JSON text, no marker
  assert.equal(Array.from(by("value_cut_at_64_code_points").summary.slice("evolution.run=".length)).length, 64);
  assert.equal(Array.from(by("value_cut_counts_code_points").summary.slice("evolution.run=".length)).length, 64);
  // whole cut: 256 is kept, 257 becomes 255 + "…"
  const exact = by("whole_exactly_256_not_cut").summary;
  assert.equal(Array.from(exact).length, 256);
  assert.ok(!exact.endsWith("…"));
  const cut = by("whole_257_cut_to_255_plus_ellipsis").summary;
  assert.equal(Array.from(cut).length, 256);
  assert.ok(cut.endsWith("…"));
  assert.ok(by("many_keys_cut_at_256").summary.endsWith("…"));
});

test("v0.1.77 (C367 P4): the types accept the documented shapes", () => {
  const env: CallEnvelope = { target: "kanban" as CallEnvelope["target"], op: "card_create" as CallEnvelope["op"], input: {}, context: { "evolution.workflow": "wf_1", "evolution.version": 3 } };
  const noParent: CallEnvelope = { ...env, parentCall: undefined };
  assert.ok(env.context && noParent.context);
  const opts: CallAppOptions = { idempotencyKey: "k".repeat(8), context: { "evolution.run": "r" } };
  assert.ok(opts.context);
  const item: Pick<HoldsPendingItem, "callerContext"> = { callerContext: 'evolution.run="r"' };
  assert.equal(typeof item.callerContext, "string");
});

test("v0.1.77 (C367 P3): a companion may list tb.hold_status — one extra standard op, never in a wildcard", () => {
  assert.equal(COMPANION_HOLD_STATUS_OP, "tb.hold_status");
  assert.ok((STANDARD_OPERATIONS as readonly string[]).includes(COMPANION_HOLD_STATUS_OP));
  assert.ok(!(WILDCARD_COMPANION_OPS as readonly string[]).includes(COMPANION_HOLD_STATUS_OP));
  assert.deepEqual([...WILDCARD_COMPANION_OPS], ["tb.holds_pending"]);
});

test("v0.1.77 (C367 P3): the manifest schema takes tb.hold_status in companion operations and still refuses other dotted ids", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/manifest.schema.json", import.meta.url), "utf8")));
  const m = (operations: string[]) => {
    const x = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
    x.companions = [{ product: "kanban", operations, crud: ["read"], purpose: "Read the status of the holds this app raised." }];
    return x;
  };
  assert.equal(validate(m(["card_list", "tb.hold_status"])), true, JSON.stringify(validate.errors));
  assert.equal(validate(m(["card_list", "tb.holds_decide"])), false);
  assert.equal(validate(m(["card_list", "tb.export"])), false);
  // The pairing rules (one product, not alone, no other standard op) are the manifest package's (M-CP-3), not the schema's.
});
