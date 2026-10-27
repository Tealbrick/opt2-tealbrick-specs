// v0.1.80 (C373, G-2; number set at merge): slice `topology` (display only) and manifest `needsTopology`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { type InstanceSlice, type SliceTopology, TOPOLOGY_MAX } from "../src/bridge.ts";
import type { Manifest } from "../src/manifest.ts";
import type { EventContext, OpContext, StartContext } from "../src/sdk.ts";

const dir = new URL("../schemas/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) ajv.addSchema(load(f));
const SLICE = load("instance-slice.schema.json");
const TOPO = SLICE.properties.topology;
const v = ajv.compile({ ...TOPO, $id: new URL("tbtest-topology.json", SLICE.$id).href });

const INS = "ins_01M53BAEQSGKVVY4PRM2VE6FBF";
const INS2 = "ins_01M53BAEQSGKVVY4PRM2VE6FBG";
const AGT = "agt_01M53BAEQSGKVVY4PRM2VE6FBF";
const CON = "con_01M53BAEQSGKVVY4PRM2VE6FBF";

const sample = (): SliceTopology => ({
  instances: [
    { ins: INS as never, product: "fleet", name: "Fleet", version: "0.3.1" },
    { ins: INS2 as never, product: "connect", name: "Connect", version: "1.2.0-rc.1" },
  ],
  edges: [
    { agt: AGT as never, ins: INS2 as never, product: "connect", crud: ["read", "create"], mode: "bound", held: ["outward", "money"], wf: ["mail_send", "tb.hold_status"] },
    { agt: AGT as never, ins: INS as never, product: "fleet", crud: ["read"], mode: "free", held: [], paused: true },
  ],
  companions: [{ from: INS as never, to: INS2 as never, product: "connect", crud: ["read"], ops: ["tb.holds_pending"] }],
  connections: [
    { con: CON as never, agt: AGT as never, method: "pairing", status: "active" },
    { con: CON as never, agt: AGT as never, method: "key", status: "revoked" },
  ],
});

test("TOPOLOGY_MAX equals the schema list bounds", () => {
  assert.deepEqual(TOPOLOGY_MAX, { instances: 200, edges: 2000, companions: 500, connections: 500 });
  for (const k of Object.keys(TOPOLOGY_MAX) as (keyof typeof TOPOLOGY_MAX)[]) assert.equal(TOPO.properties[k].maxItems, TOPOLOGY_MAX[k], k);
  assert.deepEqual(TOPO.required, ["instances", "edges", "companions", "connections"]);
});

test("a valid topology validates (empty lists, optional wf / paused / ops / truncated)", () => {
  assert.equal(v(sample()), true, JSON.stringify(v.errors));
  assert.equal(v({ instances: [], edges: [], companions: [], connections: [] }), true, JSON.stringify(v.errors));
  assert.equal(v({ ...sample(), truncated: true }), true, JSON.stringify(v.errors));
  const s: Pick<InstanceSlice, "topology"> = { topology: sample() };
  assert.equal(s.topology?.edges.length, 2);
});

test("the slice schema keeps topology optional", () => {
  assert.ok(!(SLICE.required as string[]).includes("topology"));
});

test("refused shapes: extra labels, bad enums, truncated/paused false, a missing list, over the bounds", () => {
  const bad = (mut: (t: Record<string, any>) => void, why: string) => {
    const t = structuredClone(sample()) as Record<string, any>;
    mut(t);
    assert.equal(v(t), false, why);
  };
  bad((t) => (t.instances[0].persona = "x"), "no persona on an instance");
  bad((t) => (t.instances[0].internalUrl = "http://x.railway.internal:8080"), "no endpoints");
  bad((t) => (t.edges[0].jti = "01M53BAEQSGKVVY4PRM2VE6FBF"), "no token data on an edge");
  bad((t) => (t.connections[0].publicKey = { kty: "OKP" }), "no key material on a connection");
  bad((t) => (t.connections[0].method = "token"), "method is key | pairing");
  bad((t) => (t.connections[0].status = "paused"), "status is active | revoked");
  bad((t) => (t.edges[0].paused = false), "paused is true or absent");
  bad((t) => (t.truncated = false), "truncated is true or absent");
  bad((t) => (t.edges[0].crud = ["read", "read"]), "crud unique");
  bad((t) => (t.edges[0].held = ["nonsense"]), "held families from the vocabulary");
  bad((t) => (t.edges[0].mode = "loose"), "mode free | bound");
  bad((t) => (t.instances[0].version = "v1"), "version is semver");
  bad((t) => (t.instances[0].name = "x".repeat(81)), "name ≤ 80");
  bad((t) => delete t.connections, "every list is required");
  bad((t) => (t.edges = Array.from({ length: TOPOLOGY_MAX.edges + 1 }, () => t.edges[1])), "edges ≤ 2000");
  bad((t) => (t.instances = Array.from({ length: TOPOLOGY_MAX.instances + 1 }, () => t.instances[0])), "instances ≤ 200");
});

test("manifest needsTopology: boolean, default false, next to needsAgentDirectory", () => {
  const m = load("manifest.schema.json");
  assert.deepEqual({ type: m.properties.needsTopology.type, default: m.properties.needsTopology.default }, { type: "boolean", default: false });
  const keys = Object.keys(m.properties);
  assert.equal(keys.indexOf("needsTopology"), keys.indexOf("needsAgentDirectory") + 1);
  const validate = ajv.getSchema(m.$id);
  assert.ok(validate);
  const ex = JSON.parse(readFileSync(new URL("../examples/notes.manifest.json", import.meta.url), "utf8"));
  assert.equal(validate(ex), true, "a manifest without needsTopology still validates");
  assert.equal(validate({ ...ex, needsTopology: true }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, needsTopology: "yes" }), false, "non-boolean refused");
  const typed: Pick<Manifest, "needsTopology"> = { needsTopology: true };
  assert.equal(typed.needsTopology, true);
});

test("ctx.topology is declared on op, start and event contexts", () => {
  const fn = (): SliceTopology | null => null;
  const a: Pick<OpContext, "topology"> = { topology: fn };
  const b: Pick<StartContext, "topology"> = { topology: fn };
  const c: Pick<EventContext, "topology"> = { topology: fn };
  assert.equal(a.topology?.(), null);
  assert.equal(b.topology?.(), null);
  assert.equal(c.topology?.(), null);
});
