// v0.1.80 (C373, G-2; number set at merge): slice `topology` (compact tuple form, display only), manifest `needsTopology`,
// the append-only hold-family bit order, the `topology` consent kind.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  type InstanceSlice,
  SLICE_CORE_MAX_CHARS,
  type SliceTopology,
  type SliceTopologyView,
  TOPOLOGY_CRUD_PATTERN,
  TOPOLOGY_HELD_MASK_MAX,
  TOPOLOGY_MAX,
  TOPOLOGY_OPS_COUNT_MAX,
  topologyCrudActions,
  topologyCrudCode,
  topologyHeldFamilies,
  topologyHeldMask,
} from "../src/bridge.ts";
import { HOLD_FAMILIES, MANIFEST_HOLD_FAMILIES, type Manifest } from "../src/manifest.ts";
import type { CatalogEntry, ConsentKind, Instance } from "../src/routes.ts";
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
const CON = "con_01M53BAEQSGKVVY4PRM2VE6FBF";

const sample = (): SliceTopology => ({
  v: 1,
  instances: [
    [INS as never, "fleet", "Fleet", "0.3.1"],
    [INS2 as never, "connect", "Connect", "1.2.0-rc.1"],
  ],
  edges: [
    [0, 1, "cr", "b", topologyHeldMask(["outward", "money"]), 2, 0],
    [1, 0, "r", "f", 0, 0, 1],
  ],
  companions: [[0, 1, "r", 1]],
  connections: [
    [CON as never, 0, "p", "a"],
    [CON as never, 1, "k", "r"],
  ],
});

test("MANIFEST_HOLD_FAMILIES is append-only: today's order is pinned (a new family goes at the end)", () => {
  assert.deepEqual(
    [...MANIFEST_HOLD_FAMILIES],
    ["first_contact", "profile_change", "live_call", "destructive", "money", "outward", "identity", "public_link"],
    "never reorder or remove a family: slice topology `held` bits depend on this order",
  );
  assert.equal(MANIFEST_HOLD_FAMILIES, HOLD_FAMILIES);
  // the slice schema's appsPolicy enum (another copy of the vocabulary) starts with the same order
  assert.deepEqual(SLICE.properties.appsPolicy.properties.held.items.enum.slice(0, MANIFEST_HOLD_FAMILIES.length), [...MANIFEST_HOLD_FAMILIES]);
  assert.ok(MANIFEST_HOLD_FAMILIES.length <= 31, "the held mask has 31 bits");
});

test("held bit helpers: bit i = family i; unknown families and unknown high bits are ignored; bad masks → null", () => {
  assert.equal(topologyHeldMask([]), 0);
  assert.equal(topologyHeldMask(["first_contact"]), 1);
  assert.equal(topologyHeldMask(["public_link"]), 1 << 7);
  assert.equal(topologyHeldMask([...MANIFEST_HOLD_FAMILIES]), 0xff);
  assert.equal(topologyHeldMask(["money", "nonsense"]), 1 << 4);
  assert.deepEqual(topologyHeldFamilies(0b10_0001), ["first_contact", "outward"]);
  assert.deepEqual(topologyHeldFamilies(0xff), [...MANIFEST_HOLD_FAMILIES]);
  assert.deepEqual(topologyHeldFamilies(0xff | (1 << 20)), [...MANIFEST_HOLD_FAMILIES], "a newer family bit is tolerated");
  for (const bad of [-1, 1.5, TOPOLOGY_HELD_MASK_MAX + 1, Number.NaN]) assert.equal(topologyHeldFamilies(bad), null, String(bad));
  for (const fams of [["outward"], ["money", "identity"], [...MANIFEST_HOLD_FAMILIES]]) assert.deepEqual(topologyHeldFamilies(topologyHeldMask(fams)), MANIFEST_HOLD_FAMILIES.filter((f) => fams.includes(f)));
});

test("crud code helpers: letters in c, r, u, d order; the pattern matches the schema", () => {
  assert.equal(topologyCrudCode(["read"]), "r");
  assert.equal(topologyCrudCode(["delete", "read", "create"]), "crd");
  assert.equal(topologyCrudCode(["create", "read", "update", "delete"]), "crud");
  assert.equal(topologyCrudCode([]), "");
  assert.deepEqual(topologyCrudActions("crud"), ["create", "read", "update", "delete"]);
  assert.deepEqual(topologyCrudActions("ru"), ["read", "update"]);
  assert.deepEqual(topologyCrudActions(""), []);
  for (const bad of ["rc", "x", "rr", "CRUD", "crudx"]) assert.equal(topologyCrudActions(bad), null, bad);
  assert.equal(TOPOLOGY_CRUD_PATTERN, TOPO.properties.edges.items.prefixItems[2].pattern);
  assert.equal(TOPOLOGY_CRUD_PATTERN, TOPO.properties.companions.items.prefixItems[2].pattern);
});

test("TOPOLOGY_MAX equals the schema list bounds; every tuple has exact arity", () => {
  assert.deepEqual(TOPOLOGY_MAX, { instances: 40, edges: 600, companions: 100, connections: 300 });
  const arity = { instances: 4, edges: 7, companions: 4, connections: 4 };
  for (const k of Object.keys(TOPOLOGY_MAX) as (keyof typeof TOPOLOGY_MAX)[]) {
    const p = TOPO.properties[k];
    assert.equal(p.maxItems, TOPOLOGY_MAX[k], k);
    assert.equal(p.items.prefixItems.length, arity[k], k);
    assert.equal(p.items.minItems, arity[k], k);
    assert.equal(p.items.items, false, `${k}: items:false`);
  }
  assert.deepEqual(TOPO.required, ["v", "instances", "edges", "companions", "connections"]);
  assert.equal(TOPO.properties.edges.items.prefixItems[5].maximum, TOPOLOGY_OPS_COUNT_MAX);
  assert.equal(TOPO.properties.edges.items.prefixItems[4].maximum, TOPOLOGY_HELD_MASK_MAX);
});

test("a valid topology validates (empty lists, truncated)", () => {
  assert.equal(v(sample()), true, JSON.stringify(v.errors));
  assert.equal(v({ v: 1, instances: [], edges: [], companions: [], connections: [] }), true, JSON.stringify(v.errors));
  assert.equal(v({ ...sample(), truncated: true }), true, JSON.stringify(v.errors));
  const s: Pick<InstanceSlice, "topology"> = { topology: sample() };
  assert.equal(s.topology?.edges.length, 2);
  assert.ok(!(SLICE.required as string[]).includes("topology"), "optional on the slice");
});

test("refused shapes: arity, vocabularies, v, extra members, bounds", () => {
  const bad = (mut: (t: any) => void, why: string) => {
    const t = structuredClone(sample()) as any;
    mut(t);
    assert.equal(v(t), false, why);
  };
  bad((t) => (t.v = 2), "v is 1");
  bad((t) => delete t.v, "v is required");
  bad((t) => t.edges[0].push(9), "edge arity 7 (items:false)");
  bad((t) => t.edges[0].pop(), "edge arity 7 (minItems)");
  bad((t) => t.instances[0].push("persona"), "instance arity 4: no extra labels");
  bad((t) => t.connections[0].push({ kty: "OKP" }), "connection arity 4: no key material");
  bad((t) => (t.edges[0][2] = "rc"), "crud letters in order");
  bad((t) => (t.edges[0][2] = "read"), "crud is a code");
  bad((t) => (t.edges[0][3] = "free"), "mode f | b");
  bad((t) => (t.edges[0][4] = -1), "held ≥ 0");
  bad((t) => (t.edges[0][4] = 1.5), "held integer");
  bad((t) => (t.edges[0][5] = TOPOLOGY_OPS_COUNT_MAX + 1), "wfCount ≤ 128");
  bad((t) => (t.edges[0][6] = 2), "paused 0 | 1");
  bad((t) => (t.edges[0][6] = true), "paused is a number");
  bad((t) => (t.edges[0][0] = -1), "agentIdx ≥ 0");
  bad((t) => (t.companions[0][3] = -1), "opsCount ≥ 0");
  bad((t) => (t.connections[0][2] = "key"), "method k | p");
  bad((t) => (t.connections[0][3] = "active"), "status a | r");
  bad((t) => (t.instances[0][3] = "v1"), "version is semver");
  bad((t) => (t.instances[0][2] = "x".repeat(81)), "name ≤ 80");
  bad((t) => (t.truncated = false), "truncated is true or absent");
  bad((t) => (t.agents = []), "no extra members");
  bad((t) => delete t.connections, "every list is required");
  bad((t) => (t.edges = Array.from({ length: TOPOLOGY_MAX.edges + 1 }, () => t.edges[1])), "edges ≤ 600");
  bad((t) => (t.instances = Array.from({ length: TOPOLOGY_MAX.instances + 1 }, () => t.instances[0])), "instances ≤ 40");
});

test("worst case at the bounds, measured (CORE v0.1.80 rule 7)", () => {
  const p32 = "x".repeat(32);
  const name = "x".repeat(80);
  const worst = {
    v: 1,
    instances: Array.from({ length: TOPOLOGY_MAX.instances }, () => [INS, p32, name, "999.999.999-rc.99999"]),
    edges: Array.from({ length: TOPOLOGY_MAX.edges }, () => [499, 39, "crud", "b", topologyHeldMask([...MANIFEST_HOLD_FAMILIES]), TOPOLOGY_OPS_COUNT_MAX, 1]),
    companions: Array.from({ length: TOPOLOGY_MAX.companions }, () => [39, 39, "crud", TOPOLOGY_OPS_COUNT_MAX]),
    connections: Array.from({ length: TOPOLOGY_MAX.connections }, () => [CON, 499, "p", "r"]),
    truncated: true,
  };
  assert.equal(v(worst), true, JSON.stringify(v.errors));
  const chars = JSON.stringify(worst).length;
  const b64 = Math.ceil((chars * 4) / 3);
  // the CORE text quotes these numbers (41,119 JSON chars, 54,826 base64 chars); fail loudly when the shape changes
  assert.equal(chars, 41_119);
  assert.equal(b64, 54_826);
  // OQ-C373-1 decided ELASTIC (CORE "v0.1.80" rules 7-8): at the full bounds the topology alone passes the slice limit, so
  // Core must be able to cut it (truncated) instead of refusing a change
  assert.ok(b64 > SLICE_CORE_MAX_CHARS, "at the full bounds the topology alone passes SLICE_CORE_MAX_CHARS: Core cuts it (elastic)");
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
  assert.equal(validate({ ...ex, needsTopology: true, needsAgentDirectory: true }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...ex, needsTopology: "yes" }), false, "non-boolean refused");
  const typed: Pick<Manifest, "needsTopology" | "needsAgentDirectory"> = { needsTopology: true, needsAgentDirectory: true };
  assert.equal(typed.needsTopology, true);
});

test("consent kind topology; catalog and update name the consents they ask for", () => {
  const kinds: ConsentKind[] = ["holds_pending_all", "topology"];
  const c: Pick<CatalogEntry, "consentsAsked"> = { consentsAsked: ["topology"] };
  const i: Pick<Instance, "updateConsentsAsked"> = { updateConsentsAsked: ["topology"] };
  assert.deepEqual(c.consentsAsked, ["topology"]);
  assert.deepEqual(i.updateConsentsAsked, ["topology"]);
  assert.equal(kinds.length, 2);
});

test("ctx.topology is declared on op, start and event contexts and returns agentIds of the same slice", () => {
  const view: SliceTopologyView = { ...sample(), agentIds: ["agt_01M53BAEQSGKVVY4PRM2VE6FBF" as never, "agt_01M53BAEQSGKVVY4PRM2VE6FBG" as never] };
  assert.equal(view.agentIds[view.edges[0][0]], "agt_01M53BAEQSGKVVY4PRM2VE6FBF", "agentIdx resolves through agentIds");
  const fn = (): SliceTopologyView | null => null;
  const a: Pick<OpContext, "topology"> = { topology: fn };
  const b: Pick<StartContext, "topology"> = { topology: fn };
  const c: Pick<EventContext, "topology"> = { topology: fn };
  assert.equal(a.topology?.(), null);
  assert.equal(b.topology?.(), null);
  assert.equal(c.topology?.(), null);
});
