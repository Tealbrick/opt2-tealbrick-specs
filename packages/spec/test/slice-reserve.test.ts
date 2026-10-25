// QA-SPEC49-30, QA-SPEC55-1..5: the per-slice reserve holds for every feasible app shape, measured, not estimated.
// Builds real slices (validated against instance-slice.schema.json): the EXTERNAL automatic fields (never refused, not
// known at mint) first at the smallest valid mint and then at their schema maximum, for every companion-hub shape that
// Core can accept (measured worst-case slice ≤ SLICE_CORE_MAX_CHARS), and asserts ≥ 1,000 chars under the hard limit.
// Values Core knows at mint are part of Core's measured worst case, not of the reserve: `prd` on every companion grant,
// `provider` on every caller, every caller `name` counted at its schema maximum (it changes on the caller's update or
// rollback, which is never refused), and the companion-grant `revoked.jtis` of every live grant (2 each while old and new
// overlap). Every maximum below is READ FROM THE SCHEMA, so raising one in the schema fails or re-checks this test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { SLICE_CORE_MAX_CHARS, SLICE_JWS_MAX_CHARS } from "../src/bridge.ts";
import { CALLER_NAME_MAX_JSON_BYTES } from "../src/models.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const CFG = load("workspace-config.schema.json");
const SLICE = load("instance-slice.schema.json");
const D = CFG.$defs;
const P = SLICE.properties;
const maxRep = (pattern: string) => Number(/\{\d+,(\d+)\}/.exec(pattern)?.[1]) + 1;
const MAX = {
  portalKeys: D.portalKeys.maxItems as number,
  portalKeySet: D.portalKeySet.maxLength as number,
  bridgeKeys: P.bridge.properties.keys.maxItems as number,
  caps: P.bridge.properties.caps.maxItems as number,
  capLen: maxRep(P.bridge.properties.caps.items.pattern),
  origin: D.httpsOrigin.maxLength as number,
  ownerKeys: D.standaloneBlock.properties.ownerKeys.maxItems as number,
  grants: P.grants.maxItems as number,
  // a caller is another instance of the workspace: bounded by the instance count (pause.instances maxItems) − itself
  callers: Math.min(P.companionCallers.maxItems as number, (D.pause.properties.instances.maxItems as number) - 1),
  callerName: P.companionCallers.items.properties.name.maxLength as number,
  provider: maxRep(P.companionCallers.items.properties.provider.oneOf[0].pattern),
  product: maxRep(D.productId.pattern),
  agents: P.agents.maxItems as number,
  agentName: P.agents.items.properties.name.maxLength as number,
};
/** QA-SPEC54-2: `held` counted at all families on every grant (adding held families is never refused). */
const ALL_HELD = P.appsPolicy.properties.held.items.enum as string[];

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = (n: number) => {
  let s = "";
  for (let i = 0; i < 26; i++) {
    s = CROCKFORD[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
};
let seq = 1;
const next = () => ulid(seq++);
const b64 = (s: string) => Math.ceil((Buffer.byteLength(s) * 4) / 3);
/** A compact JWS of the exact length a real one has: base64url(header) . base64url(payload) . 86-char Ed25519 signature. */
const jws = (header: object, payload: object) => `${"a".repeat(b64(JSON.stringify(header)))}.${"b".repeat(b64(JSON.stringify(payload)))}.${"c".repeat(86)}`;
const key43 = () => next().padEnd(43, "x");
const jwkMin = () => ({ kty: "OKP", crv: "Ed25519", x: key43() });
const jwkMax = () => ({ kty: "OKP", crv: "Ed25519", x: key43(), kid: key43(), alg: "EdDSA", use: "sig" });
const origin = (len: number) => `https://${"o".repeat(len - "https://".length - ".example".length)}.example`;
const word = (len: number, i: number) => `${"w".repeat(len - 1)}${"abcdefghijklmnopqrstuvwxyz"[i % 26]}`;

const WS = `ws_${next()}`;
const SELF = `ins_${next()}`;
const BRG = `brg_${next()}`;

/** Reference cut (QA-SPEC55-1): the longest code-point prefix whose JSON serialization (without quotes) is ≤ max bytes. */
export function cutName(name: string, max = CALLER_NAME_MAX_JSON_BYTES): string {
  let out = "";
  for (const ch of name) {
    if (Buffer.byteLength(JSON.stringify(out + ch)) - 2 > max) break;
    out += ch;
  }
  return out;
}
const SCRIPTS: Record<string, string> = { ascii: "w", cjk: "名", emoji: "😀", accented: "é" };
let script = "ascii";
const callerName = (i: number) => cutName(SCRIPTS[script].repeat(200) + "abcdefghijklmnopqrstuvwxyz"[i % 26]);

/** A companion grant (K10) as small as Core mints it, with its real `prd` — small grants let the most of them fit. */
function grant(i: number) {
  const payload = {
    v: 1, iss: "tb:portal", sub: `tb:ins:${SELF}`, aud: `tb:ins:ins_${next()}`, iat: 1_790_000_000, exp: 1_790_043_200, jti: next(), ws: WS,
    mode: "bound", crud: ["read"], held: ALL_HELD, prd: word(MAX.product, i),
  };
  return jws({ alg: "EdDSA", typ: "tb-grant+jwt", kid: key43() }, payload);
}

/** One slice for `callers` companion callers and `grants` companion grants; `auto` = the external fields at min or max. */
function slice(callers: number, grants: number, auto: "min" | "max", dirAgents = 0, dirName = 1) {
  const max = auto === "max";
  return {
    v: 1, iss: max ? `tb:brg:${BRG}` : "tb:portal", sub: `tb:ins:${SELF}`, aud: `tb:ins:${SELF}`, iat: 1_790_000_000, exp: 1_790_043_200,
    jti: next(), ws: WS, rev: max ? Number.MAX_SAFE_INTEGER : 1, ins: SELF, product: "hub",
    portalKeys: Array.from({ length: max ? MAX.portalKeys : 0 }, () => ({ jwk: jwkMax(), status: "active" })),
    ...(max ? { portalKeySet: `${"k".repeat(1000)}.${"k".repeat(MAX.portalKeySet - 1000 - 2 - 86)}.${"s".repeat(86)}` } : {}),
    bridge: {
      id: BRG,
      keys: Array.from({ length: max ? MAX.bridgeKeys : 1 }, () => (max ? jwkMax() : jwkMin())),
      ...(max ? { caps: Array.from({ length: MAX.caps }, (_, i) => word(MAX.capLen, i)), viewUrl: origin(MAX.origin), publicUrl: origin(MAX.origin) } : {}),
    },
    // pause at its worst for this slice (C353: pause.agents is always []; own instance listed) — measured part
    pause: { workspace: true, agents: [], instances: [SELF] },
    // QA-SPEC55-5: companion-grant jtis of every live grant, 2 each (old and new overlap) — measured part
    revoked: { jtis: Array.from({ length: 2 * (grants + callers) }, () => ({ jti: next(), exp: 1_790_043_200 })) },
    personNbf: 1_790_000_000,
    grants: Array.from({ length: grants }, (_, i) => grant(i)),
    // QA-SPEC54-1: a directory slice lists every agent; `edge: false` on each is in the measured worst case (edges.delete is kill path)
    agents: Array.from({ length: dirAgents }, (_, i) => ({ id: `agt_${next()}`, name: word(dirName, i), mode: "free", status: "active", edge: false })),
    companionTargets: Array.from({ length: grants }, () => ({ product: "t1", ins: `ins_${next()}` })),
    // QA-SPEC55-1: name at its schema maximum, provider at its real (here: maximum) value — measured part
    companionCallers: Array.from({ length: callers }, (_, i) => ({ product: "c1", ins: `ins_${next()}`, name: callerName(i), provider: word(MAX.provider, i) })),
    appsPolicy: { held: ALL_HELD },
    ...(max ? { appCallers: "verified", portalUrl: origin(MAX.origin) } : {}),
    ...(max ? { standalone: { issuer: `tb:brg:${BRG}`, kid: key43(), ownerKeys: Array.from({ length: MAX.ownerKeys }, jwkMax) } } : {}),
  };
}
const sliceLen = (p: object) => jws({ alg: "EdDSA", typ: "tb-slice+jws", kid: key43() }, p).length;

/** Largest growth of the external fields over every shape Core accepts; exported numbers are pinned by the test below. */
function worstShape() {
  let worst = { growth: 0, callers: 0, grants: 0, agents: 0 };
  const shapes: [number, number][] = [[0, 1]];
  // directory slices (QA-SPEC54-1): many agents with short or long names, each carrying edge:false
  for (const [agents, name] of [[MAX.agents, 1], [460, 1], [406, 12], [312, 40], [235, MAX.agentName]] as [number, number][]) shapes.push([agents, name]);
  for (const [agents, name] of shapes) {
    for (let callers = 0; callers <= MAX.callers; callers += agents ? 21 : 1) {
      for (let grants = 0; grants <= MAX.grants; grants++) {
        const lo = slice(callers, grants, "min", agents, name);
        if (sliceLen(lo) > SLICE_CORE_MAX_CHARS) break; // Core refuses this shape (more grants only grow it)
        const growth = sliceLen(slice(callers, grants, "max", agents, name)) - sliceLen(lo);
        if (growth > worst.growth) worst = { growth, callers, grants, agents };
      }
    }
  }
  return worst;
}

test("QA-SPEC55: every accepted slice shape keeps ≥ 1,000 chars to the 65,536 limit after all external automatic growth", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema(CFG);
  const validate = ajv.compile(SLICE);
  assert.equal(SLICE_JWS_MAX_CHARS, D.compactJws.maxLength);
  for (const [c, g, a] of [[0, 0, 0], [MAX.callers, 0, 0], [MAX.callers, 8, 0], [21, 16, 0], [0, 4, 235]]) {
    for (const auto of ["min", "max"] as const) assert.equal(validate(slice(c, g, auto, a, a ? MAX.agentName : 1)), true, JSON.stringify(validate.errors));
  }
  for (const s of Object.keys(SCRIPTS)) {
    script = s; // QA-SPEC55-1: caller names in other scripts are cut to the same JSON size, so no script grows the slice
    const worst = worstShape();
    const margin = SLICE_JWS_MAX_CHARS - (SLICE_CORE_MAX_CHARS + worst.growth);
    assert.ok(worst.growth > 10_000, `${s}: growth ${worst.growth} looks too small: is a field missing?`);
    assert.ok(margin >= 1_000, `${s}: worst shape ${JSON.stringify(worst)}: margin ${margin} < 1,000`);
  }
  script = "ascii";
});

test("QA-SPEC55-1: caller names are cut to ≤ 80 JSON bytes at a code-point boundary; manifest names refuse invisible characters", () => {
  for (const name of ["Knowledge", "名".repeat(40), "😀".repeat(40), "é".repeat(60), "a\"b\\c".repeat(30)]) {
    const cut = cutName(name);
    assert.ok(Buffer.byteLength(JSON.stringify(cut)) - 2 <= CALLER_NAME_MAX_JSON_BYTES, name);
    assert.ok(name.startsWith(cut), "a prefix");
    assert.equal(cut.isWellFormed(), true, "never splits a surrogate pair");
  }
  assert.equal(cutName("名".repeat(40)).length, 26);
  assert.equal([...cutName("😀".repeat(40))].length, 20);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const nameSchema = load("manifest.schema.json").properties.name;
  const v = ajv.compile(nameSchema);
  for (const ok of ["Knowledge", "Task Board", "Café 東京", "😀 Helper"]) assert.equal(v(ok), true, ok);
  for (const bad of ["a\u0001b", "a\u200bb", "a\u202eb", "a\u00adb", "a\u2028b", "a\u{e0041}b"]) assert.equal(v(bad), false, JSON.stringify(bad));
});
