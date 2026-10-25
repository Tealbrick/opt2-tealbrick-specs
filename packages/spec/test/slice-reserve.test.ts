// QA-SPEC49-30: the per-slice reserve holds for every feasible app shape, measured, not estimated.
// Builds real slices (validated against instance-slice.schema.json) with the automatic, never-refused fields first at
// their realistic minimum and then at their schema maximum, for every companion-hub shape that Core can accept
// (worst-case slice ≤ SLICE_CORE_MAX_CHARS), and asserts that the grown slice stays ≥ 1,000 chars under the hard limit.
// `prd` on every companion grant and `provider` on every caller are values Core knows when it mints the slice, so they are
// part of Core's worst case (PORTAL-API "Config size"), not of the reserve; the reserve covers only external growth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { SLICE_CORE_MAX_CHARS, SLICE_JWS_MAX_CHARS } from "../src/bridge.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

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
const label = (n: number, len: number) => `${"p".repeat(len - 1)}${CROCKFORD[n % 32].toLowerCase()}`.replace(/[^a-z0-9]/g, "a");

const WS = `ws_${next()}`;
const SELF = `ins_${next()}`;

/** A companion grant (K10) as small as Core mints it — small grants let the most of them fit, the worst case for `prd`. */
function grant(withPrd: boolean) {
  const target = `tb:ins:ins_${next()}`;
  const payload = {
    v: 1, iss: "tb:portal", sub: `tb:ins:${SELF}`, aud: target, iat: 1_790_000_000, exp: 1_790_043_200, jti: next(), ws: WS,
    mode: "bound", crud: ["read"], held: [], ...(withPrd ? { prd: label(seq, 32) } : {}),
  };
  return jws({ alg: "EdDSA", typ: "tb-grant+jwt", kid: key43() }, payload);
}

/** One slice for `callers` companion callers and `grants` companion grants; `auto` = the automatic fields at min or max. */
function slice(callers: number, grants: number, auto: "min" | "max") {
  const max = auto === "max";
  const keyset = max
    ? "k".repeat(4096 - 87 - 2) // portalKeySet at its schema maximum (two dots + signature included)
    : jws({ alg: "EdDSA", typ: "tb-keyset+jws", kid: key43() }, { seq: 1, keys: [jwkMin()] });
  return {
    v: 1, iss: "tb:portal", sub: `tb:ins:${SELF}`, aud: `tb:ins:${SELF}`, iat: 1_790_000_000, exp: 1_790_043_200, jti: next(), ws: WS, rev: 123_456,
    ins: SELF, product: "hub",
    portalKeys: Array.from({ length: max ? 8 : 1 }, () => ({ jwk: max ? jwkMax() : jwkMin(), status: "active" })),
    portalKeySet: max ? keyset.replace(/^(k+)$/, (k) => `${k.slice(0, 1000)}.${k.slice(1000)}.${"s".repeat(86)}`) : keyset,
    bridge: {
      id: `brg_${next()}`,
      keys: Array.from({ length: max ? 4 : 1 }, () => (max ? jwkMax() : jwkMin())),
      caps: max ? Array.from({ length: 16 }, (_, i) => `${"c".repeat(39)}${CROCKFORD[i].toLowerCase()}`.replace(/[^a-z0-9]/g, "a")) : [],
      viewUrl: max ? origin(267) : null,
      publicUrl: max ? origin(267) : "https://brg.example.com",
    },
    // pause at its worst for this slice (C353: pause.agents is always []; own instance listed)
    pause: { workspace: true, agents: [], instances: [SELF] },
    revoked: { jtis: [] },
    personNbf: 1_790_000_000,
    grants: Array.from({ length: grants }, () => grant(true)), // prd: known to Core, part of its worst case (not the reserve)
    agents: [],
    companionTargets: Array.from({ length: grants }, () => ({ product: "t1", ins: `ins_${next()}` })),
    companionCallers: Array.from({ length: callers }, (_, i) => ({
      product: "c1", ins: `ins_${next()}`, name: "C", provider: label(i, 32).replace(/-/g, "_"), // known to Core, in its worst case
    })),
    appsPolicy: { held: [] },
    ...(max ? { appCallers: "verified" } : {}),
    portalUrl: max ? origin(267) : "https://portal.example.com",
  };
}
const sliceLen = (p: object) => jws({ alg: "EdDSA", typ: "tb-slice+jws", kid: key43() }, p).length;

test("QA-SPEC49-30: every accepted slice shape keeps ≥ 1,000 chars to the 65,536 limit after all automatic growth", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema(load("workspace-config.schema.json"));
  const validate = ajv.compile(load("instance-slice.schema.json"));
  let worst = { growth: 0, callers: 0, grants: 0 };
  for (let callers = 0; callers <= 63; callers++) {
    for (let grants = 0; grants <= 64; grants++) {
      const lo = slice(callers, grants, "min");
      if (sliceLen(lo) > SLICE_CORE_MAX_CHARS) break; // Core refuses this shape (more grants only grow it)
      const hi = slice(callers, grants, "max");
      const growth = sliceLen(hi) - sliceLen(lo);
      if (growth > worst.growth) worst = { growth, callers, grants };
      if ((callers === 63 && grants % 16 === 0) || (callers % 21 === 0 && grants === 0)) {
        assert.equal(validate(lo), true, JSON.stringify(validate.errors));
        assert.equal(validate(hi), true, JSON.stringify(validate.errors));
      }
    }
  }
  const margin = SLICE_JWS_MAX_CHARS - (SLICE_CORE_MAX_CHARS + worst.growth);
  assert.ok(margin >= 1_000, `worst shape ${JSON.stringify(worst)}: margin ${margin} < 1,000`);
});
