// v0.1.84 (C369 D1–D4): readable hold cards — the default hold view rows, the secret-key rule, constants and types.
// The SDK implements the renderer (miniapp-sdk src/server/hold-view.ts). The reference renderer below is test-only and written
// separately from the SDK's, straight from SDK-API §4.8: when both give the rows' bytes, two implementations agree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STANDARD_OPERATIONS } from "../src/manifest.ts";
import {
  HOLD_DETAILS_OP,
  HOLD_INPUT_KEEP_DAYS,
  HOLD_INPUT_MAX_BYTES,
  HOLD_INPUT_REDACTED,
  HOLD_INPUT_STATES,
  HOLD_SECRET_KEY_PARTS,
  HOLD_SECRET_KEY_WORDS,
  HOLD_VIEW_ELIDED_LINE,
  HOLD_VIEW_HIDDEN,
  HOLD_VIEW_LIMITS,
  HOLD_VIEW_MAX_CHARS,
  HOLDS_PENDING_TOOL_PATTERN,
  type HoldDetails,
  type HoldDetailsInput,
  type HoldsPendingItem,
  type Receipt,
} from "../src/sdk.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Row {
  name: string;
  note: string;
  dynamic?: { opTitle: string; tool: string };
  title: string;
  schema: Json;
  input: Json;
  recipients?: Json;
  view: string;
  summary: string;
}
const fx = JSON.parse(readFileSync(new URL("../examples/hold-view.cases.json", import.meta.url), "utf8")) as { limits: Record<string, number>; cases: Row[] };

// ── reference renderer (SDK-API §4.8) ────────────────────────────────────────
const L = HOLD_VIEW_LIMITS;
const ELLIPSIS = String.fromCodePoint(0x2026);
const SEP = ` ${String.fromCodePoint(0x203a)} `;
const DOT = ` ${String.fromCodePoint(0xb7)} `;
const REMOVED: [number, number][] = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xd800, 0xdfff],
];
function cleanR(s: string): string {
  const cr = s.split("\r\n").join("\n").split("\r").join("\n").split("\t").join(" ");
  const out: string[] = [];
  for (const ch of cr) {
    const cp = ch.codePointAt(0) as number;
    if (!REMOVED.some(([a, b]) => cp >= a && cp <= b)) out.push(ch);
  }
  return out.join("");
}
const len = (s: string) => [...s].length;
const clipR = (s: string, n: number) => (len(s) <= n ? s : [...s].slice(0, n - 1).join("") + ELLIPSIS);
const oneLineR = (s: string, n: number) => clipR(cleanR(s).split("\n").join(" "), n);
const isUpper = (c: string) => c >= "A" && c <= "Z";
const isLowDig = (c: string) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
function humanizeR(k: string): string {
  let a = "";
  const cs = [...k];
  cs.forEach((c, i) => {
    if (i > 0 && isUpper(c) && isLowDig(cs[i - 1] as string)) a += " ";
    a += c;
  });
  let b = "";
  let inRun = false;
  for (const c of a) {
    const sep = c === "_" || c === "-" || c === "." || c === " ";
    if (sep) {
      if (!inRun) b += " ";
      inRun = true;
    } else {
      b += c;
      inRun = false;
    }
  }
  while (b.startsWith(" ")) b = b.slice(1);
  while (b.endsWith(" ")) b = b.slice(0, -1);
  b = [...b].map((c) => (isUpper(c) ? String.fromCharCode(c.charCodeAt(0) + 32) : c)).join("");
  if (b === "") return "(unnamed)";
  const f = b[0] as string;
  return f >= "a" && f <= "z" ? String.fromCharCode(f.charCodeAt(0) - 32) + b.slice(1) : b;
}
const groupR = (n: number) => {
  const d = String(n);
  let out = "";
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ",";
    out += d[i];
  }
  return out;
};
const countR = (n: number, noun: string) => `${groupR(n)} ${noun}${n === 1 ? "" : "s"}`;
function secretR(k: string): boolean {
  const words = humanizeR(cleanR(k).split("\n").join(" "))
    .split("")
    .map((c) => (isUpper(c) ? c.toLowerCase() : c))
    .join("")
    .split(" ");
  const folded = words.join("");
  return HOLD_SECRET_KEY_PARTS.some((p) => folded.indexOf(p) >= 0) || words.some((w) => (HOLD_SECRET_KEY_WORDS as readonly string[]).includes(w));
}
const obj = (v: unknown): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const codeUnitOrder = (a: string, b: string) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
  return a.length - b.length;
};
function seg(k: string, s: Json | null): string {
  if (obj(s) && typeof s.title === "string") {
    const t = oneLineR(s.title, L.labelMaxChars);
    if (t.split(" ").join("") !== "") return t;
  }
  return clipR(humanizeR(cleanR(k).split("\n").join(" ")), L.labelMaxChars);
}
const prop = (s: Json | null, k: string): Json | null => (obj(s) && obj(s.properties) && Object.hasOwn(s.properties, k) && obj(s.properties[k]) ? (s.properties[k] as Json) : null);
const blockR = (t: string) => t.includes("\n") || len(t) > L.valueMaxChars;
function scalarR(v: Json): string {
  if (v === null) return "(empty)";
  if (v === true) return "yes";
  if (v === false) return "no";
  if (typeof v === "number") return JSON.stringify(v);
  const t = cleanR(v as string);
  return t === "" ? "(empty)" : t;
}
type Out = { text: string; sum: boolean };
interface St {
  out: Out[];
  elided: number;
  done: string[][];
}
const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isDone = (st: St, raw: string[]) => st.done.some((d) => samePath(d, raw));
function emit(v: Json, path: string[], raw: string[], hidden: boolean, s: Json | null, st: St): void {
  const label = path.join(SEP);
  const put = (x: string, sum: boolean): void => {
    st.out.push({ text: `${label}: ${x}`, sum });
  };
  if (hidden) put(HOLD_VIEW_HIDDEN, false);
  else if (typeof v === "string" && blockR(cleanR(v))) {
    const cps = [...cleanR(v)];
    st.out.push({ text: cps.length <= L.blockMaxChars ? `${label} (plain text):` : `${label} (plain text, first ${groupR(L.blockMaxChars)} characters; ${groupR(cps.length - L.blockMaxChars)} more not shown):`, sum: false });
    for (const ln of cps.slice(0, L.blockMaxChars).join("").split("\n")) st.out.push({ text: `  ${ln}`, sum: false });
  } else if (Array.isArray(v)) {
    const flat = v.every((x) => x === null || typeof x !== "object") && !v.some((x) => typeof x === "string" && blockR(cleanR(x)));
    const more = Math.max(0, v.length - L.listMaxItems);
    if (v.length === 0) put("(none)", true);
    else if (flat) {
      const head = v.slice(0, L.listMaxItems).map(scalarR).join(", ");
      st.elided += more;
      put(more > 0 ? `${head} and ${groupR(more)} more` : head, true);
    } else if (path.length >= L.depthMax) {
      st.elided += v.length;
      put(`(list of ${countR(v.length, "item")}, not shown)`, false);
    } else {
      const items = obj(s) && obj(s.items) ? (s.items as Json) : null;
      for (let i = 0; i < Math.min(v.length, L.listMaxItems); i++) if (!isDone(st, [...raw, String(i)])) emit(v[i] as Json, [...path, `#${i + 1}`], [...raw, String(i)], false, items, st);
      if (more > 0) {
        st.elided += more;
        put(`and ${groupR(more)} more`, false);
      }
    }
  } else if (obj(v)) {
    const ks = Object.keys(v).sort(codeUnitOrder);
    if (ks.length === 0) put("(none)", true);
    else if (path.length >= L.depthMax) {
      st.elided += ks.length;
      put(`(${countR(ks.length, "field")}, not shown)`, false);
    } else for (const k of ks) if (!isDone(st, [...raw, k])) emit(v[k] as Json, [...path, seg(k, prop(s, k))], [...raw, k], secretR(k), prop(s, k), st);
  } else put(scalarR(v), true);
}
// SDK-API §4.8 "Places first": RFC 6901, own members, list index 0|[1-9][0-9]*; a place equal to or under a rendered one is skipped
function places(input: Record<string, Json>, schema: Json, recipients: Json | undefined, st: St): void {
  if (!Array.isArray(recipients)) return;
  for (const r of recipients) {
    if (!obj(r) || typeof r.pointer !== "string" || !r.pointer.startsWith("/")) continue;
    const toks = r.pointer.slice(1).split("/").map((t) => t.split("~1").join("/").split("~0").join("~"));
    let v: Json = input;
    let s: Json | null = schema;
    const labels: string[] = [];
    let hidden = false;
    let ok = true;
    for (const t of toks) {
      if (Array.isArray(v)) {
        if (!/^(0|[1-9][0-9]*)$/.test(t) || Number(t) >= v.length) {
          ok = false;
          break;
        }
        labels.push(`#${Number(t) + 1}`);
        s = obj(s) && obj(s.items) ? (s.items as Json) : null;
        v = v[Number(t)] as Json;
      } else if (obj(v) && Object.hasOwn(v, t)) {
        labels.push(seg(t, prop(s, t)));
        hidden = hidden || secretR(t);
        s = prop(s, t);
        v = v[t] as Json;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok || st.done.some((d) => d.length <= toks.length && samePath(d, toks.slice(0, d.length)))) continue;
    st.done.push(toks);
    emit(v, labels, toks, hidden, s, st);
  }
}
function referenceRender(title: string, input: Json, schema: Json, recipients?: Json): { view: string; summary: string } {
  const head = oneLineR(title, L.titleMaxChars);
  const st: St = { out: [], elided: 0, done: [] };
  if (obj(input)) {
    const ks = Object.keys(input).sort(codeUnitOrder);
    if (ks.length === 0) st.out.push({ text: "No input.", sum: false });
    places(input, schema, recipients, st);
    for (const k of ks) if (!isDone(st, [k])) emit(input[k] as Json, [seg(k, prop(schema, k))], [k], secretR(k), prop(schema, k), st);
  } else emit(input, ["Input"], [], false, null, st);
  const body = st.out.map((o) => o.text);
  const line2 = (n: number) => HOLD_VIEW_ELIDED_LINE.replace("<n>", groupR(n));
  let view = [head, ...body].join("\n");
  if (st.elided > 0 || view.length > HOLD_VIEW_MAX_CHARS) {
    let k = st.elided > 0 ? body.length : body.length - 1;
    const build = (kk: number) => [head, line2(st.elided + body.length - kk), ...body.slice(0, kk)].join("\n");
    while (k > 0 && build(k).length > HOLD_VIEW_MAX_CHARS) k--;
    view = build(k);
  }
  let summary = [head, ...st.out.filter((o) => o.sum).slice(0, L.summaryFields).map((o) => o.text)].join(DOT);
  if (summary.length > L.summaryMaxChars) {
    let cut = "";
    for (const ch of summary) {
      if (cut.length + ch.length > L.summaryMaxChars - 1) break;
      cut += ch;
    }
    summary = cut + ELLIPSIS;
  }
  return { view, summary };
}

// ── tests ────────────────────────────────────────────────────────────────────
test("v0.1.84 (C369 D1): constants are exact and the row file repeats them", () => {
  assert.equal(HOLD_VIEW_MAX_CHARS, 16_000);
  assert.deepEqual({ ...HOLD_VIEW_LIMITS }, { titleMaxChars: 200, labelMaxChars: 80, valueMaxChars: 200, blockMaxChars: 1000, listMaxItems: 10, depthMax: 3, summaryMaxChars: 280, summaryFields: 2 });
  assert.deepEqual(fx.limits, { viewMaxChars: HOLD_VIEW_MAX_CHARS, ...HOLD_VIEW_LIMITS });
});

test("v0.1.84 (C369 D1): at least 25 rows with unique names, covering the edges the contract names", () => {
  assert.ok(fx.cases.length >= 25, String(fx.cases.length));
  const names = new Set(fx.cases.map((c) => c.name));
  assert.equal(names.size, fx.cases.length);
  for (const n of ["titles_vs_humanized", "booleans_yes_no", "enum_as_given", "array_over_10", "nested_depth_limit", "text_over_1000", "text_multiline_block", "bidi_zero_width_removed", "control_chars_removed", "clean_more_invisible", "view_cap_16000", "elision_cap_recipients_first", "elision_cap_no_places", "elision_depth", "recipients_nested_and_list", "recipients_unresolved_ignored", "recipients_pointer_escapes_and_secret", "dynamic_tool_title", "dynamic_variant_recipients", "secret_keys_hidden", "secret_key_rule", "proto_member_is_data"]) assert.ok(names.has(n), n);
  const cap = fx.cases.find((c) => c.name === "view_cap_16000") as Row;
  assert.ok(cap.view.length <= HOLD_VIEW_MAX_CHARS);
});

test("v0.1.84 (QA-C369-1): anything not shown → line 2 is exactly the fixed warning with the count; the recipients stay on the card", () => {
  const re = new RegExp(`^${HOLD_VIEW_ELIDED_LINE.replace(/[.()]/g, (c) => `\\${c}`).replace("<n>", "[0-9]{1,3}(,[0-9]{3})*")}$`);
  for (const c of fx.cases) {
    const l2 = c.view.split("\n")[1] ?? "";
    if (l2.startsWith("Not every field")) assert.match(l2, re, c.name);
  }
  for (const n of ["array_over_10", "nested_depth_limit", "view_cap_16000", "elision_cap_recipients_first", "elision_cap_no_places", "elision_depth", "array_of_objects_over_10"]) assert.match((fx.cases.find((c) => c.name === n) as Row).view.split("\n")[1] as string, re, n);
  for (const n of ["titles_vs_humanized", "booleans_yes_no", "text_over_1000", "dynamic_tool_title"]) assert.ok(!(fx.cases.find((c) => c.name === n) as Row).view.includes("Not every field"), n);
  const atk = fx.cases.find((c) => c.name === "elision_cap_recipients_first") as Row;
  const lines = atk.view.split("\n");
  assert.deepEqual(lines.slice(2, 4), ["To: attacker@evil.example", "Bcc: boss@evil.example"]);
  assert.ok(atk.view.length <= HOLD_VIEW_MAX_CHARS);
  const no = fx.cases.find((c) => c.name === "elision_cap_no_places") as Row;
  assert.ok(!no.view.includes("attacker@evil.example"), "without places the cap may drop the recipient: line 2 warns");
});

test("v0.1.84 (C369 D1): every row agrees with the reference renderer, byte for byte", () => {
  for (const c of fx.cases) {
    if (c.dynamic) assert.equal(c.title, `${c.dynamic.opTitle}: ${c.dynamic.tool}`, `${c.name}: line 1 of a dynamic op (no catalog lookup)`);
    const r = referenceRender(c.title, c.input, c.schema, c.recipients);
    assert.equal(r.view, c.view, `${c.name}: view`);
    assert.equal(r.summary, c.summary, `${c.name}: summary`);
    assert.equal(Buffer.from(r.view, "utf8").toString("utf8"), c.view, `${c.name}: valid UTF-8 (no lone surrogate)`);
  }
});

test("v0.1.84 (C369 D1): removed characters never reach a view", () => {
  for (const c of fx.cases)
    for (const ch of c.view) {
      const cp = ch.codePointAt(0) as number;
      assert.ok(!REMOVED.some(([a, b]) => cp >= a && cp <= b), `${c.name}: U+${cp.toString(16)}`);
    }
});

test("v0.1.84 (C369 D4, QA-C369-6): the secret-key rule — folded key contains a part, or a word equals a whole word (SDK-API §4.9)", () => {
  assert.deepEqual([...HOLD_SECRET_KEY_PARTS], ["token", "secret", "password", "passwd", "passphrase", "apikey", "authorization", "cookie", "credential", "bearer", "jwt", "privatekey", "clientsecret"]);
  assert.deepEqual([...HOLD_SECRET_KEY_WORDS], ["auth", "pwd", "otp", "pin", "sig", "signature"]);
  for (const k of ["api_key", "x-api-key", "APIKEY", "accessToken", "ACCESSTOKEN", "Authorization", "session_cookie", "client-secret", "x.credentials", "secrets", "privateKey", "bearerHeader", "jwt", "x-auth", "pin_code", "Sig", "signature", "pwd", "otp", "tokenizer_mode"]) assert.ok(secretR(k), k);
  for (const k of ["keyword", "monkey", "issue_key", "author", "authority", "pinned", "design", "signal", "spin", "to", "subject"]) assert.ok(!secretR(k), k);
  // only ASCII case folding: U+212A KELVIN SIGN is not "k"; U+0130 is not "i"
  assert.ok(!secretR(`p${String.fromCodePoint(0x130)}n`));
  assert.equal(HOLD_INPUT_REDACTED, "[redacted]");
  assert.equal(HOLD_VIEW_HIDDEN, "(hidden)");
  const row = fx.cases.find((c) => c.name === "secret_keys_hidden") as Row;
  assert.ok(row.view.includes("Api key: (hidden)") && !row.view.includes("sk-test-123"), "QA-C369-2: the view hides a secret value");
  assert.ok(!row.summary.includes("(hidden)") && !row.summary.includes("Access token"), "the summary leaves it out");
});

test("v0.1.84 (C369): HoldsPendingItem.tool is a tool name, never input", () => {
  const re = new RegExp(HOLDS_PENDING_TOOL_PATTERN);
  for (const t of ["gmail_send", "gmail_send__first_contact", "ab"]) assert.ok(re.test(t), t);
  for (const t of ["a", "Gmail", "1x", "x-y", "a".repeat(64), "gmail send"]) assert.ok(!re.test(t), t);
  const item: Pick<HoldsPendingItem, "tool"> = { tool: "gmail_send" };
  assert.equal(item.tool, "gmail_send");
});

test("v0.1.84 (C369 D3, D4): tb.hold_details is a standard op; types and constants have the documented shapes", () => {
  assert.equal(HOLD_DETAILS_OP, "tb.hold_details");
  assert.ok((STANDARD_OPERATIONS as readonly string[]).includes(HOLD_DETAILS_OP));
  assert.equal(STANDARD_OPERATIONS.length, 12);
  assert.equal(HOLD_INPUT_MAX_BYTES, 60_000);
  assert.equal(HOLD_INPUT_KEEP_DAYS, 7);
  assert.deepEqual([...HOLD_INPUT_STATES], ["kept", "too_large", "wiped", "unreadable", "none"]);
  const input: HoldDetailsInput = { holdId: "hld_01J9X0000000000000000000AA" as HoldDetailsInput["holdId"] };
  const d: HoldDetails = {
    holdId: input.holdId,
    receiptId: input.holdId,
    status: "denied",
    op: "mail_send",
    opTitle: "Send mail",
    family: "outward",
    reason: "held_family",
    caller: { type: "agent", id: "agt_01J9X0000000000000000000AA" as Receipt["caller"]["id"], name: "Ada" },
    callId: null,
    inputDigest: "sha256:00" as HoldDetails["inputDigest"],
    input: { to: "bob@example.com", api_key: HOLD_INPUT_REDACTED },
    inputState: "kept",
    inputWipeAt: "2026-11-03T09:00:00.000Z" as HoldDetails["inputWipeAt"],
    createdAt: "2026-10-27T09:00:00.000Z" as HoldDetails["createdAt"],
    expiresAt: null,
    decidedAt: "2026-10-27T09:01:00.000Z" as HoldDetails["decidedAt"],
    viewSha256: null,
  };
  assert.equal(d.receiptId, d.holdId);
  const r: Pick<Receipt, "holdReason"> = { holdReason: "Rule: no mail to new contacts" };
  assert.ok((r.holdReason ?? "").length <= 280);
});
