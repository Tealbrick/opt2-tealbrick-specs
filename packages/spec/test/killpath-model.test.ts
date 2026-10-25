// RM-24c (C359c, C359d, QA-SPEC57-1/-3): an executable model of the size invariant. A change may skip the size check (kill
// path, safety tightening, resume) only if the measured worst case already covers its result. The model keeps the abstract
// workspace state that drives grant size (edges with verb-level access or an op list, held families, enabled, pause flags)
// and runs seeded random sequences of owner changes through Core's rule:
//   - exempt kinds always pass; every other change passes only if the measured worst case stays ≤ the limit or does not grow;
//   - after EVERY step: real size ≤ measured worst case, and the measured worst case ≤ the limit.
// It also shows that the earlier rule (measure the CURRENT state) breaks the invariant, so the test fails if the spec rule is
// weakened. Byte costs are a model (one grant = header + per-op + per-held bytes), not the JWS; Core runs the same sequences
// against its real signer (RM-24c).
import assert from "node:assert/strict";
import { test } from "node:test";

const OPS_MAX = 128; // QA-SPEC57-2: validateOps returns at most 128 ids
const HELD_ALL = 8;
const GRANT_BASE = 420;
const PER_OP = 44;
const PER_HELD = 16;

interface Edge { agent: number; app: number; ops: number | null; held: number; enabled: boolean }
interface State { apps: number[]; agentPaused: boolean[]; wsPaused: boolean; edges: Edge[] }

const grant = (ops: number, held: number) => GRANT_BASE + ops * PER_OP + held * PER_HELD;
/** What the config really carries now: agent grants are not minted while paused (CORE §6). */
function realSize(s: State): number {
  if (s.wsPaused) return 0;
  return s.edges.filter((e) => e.enabled && !s.agentPaused[e.agent]).reduce((n, e) => n + grant(e.ops ?? 0, e.held), 0);
}
/** C359c/C359d: every exempt change at its maximum — paused grants as if resumed, verb-level at the full list, held at 8. */
function worstSize(s: State): number {
  return s.edges.filter((e) => e.enabled).reduce((n, e) => n + grant(e.ops ?? Math.min(s.apps[e.app], OPS_MAX), HELD_ALL), 0);
}
/** The rule QA-SPEC57-1 broke: measure the current state only. */
const naiveWorst = (s: State) => realSize(s);
/** A mutant that forgets AGENT pauses (counts paused agents' grants as gone): it must break too (QA-SPEC57 S3). */
const ignoresAgentPause = (s: State) =>
  s.edges.filter((e) => e.enabled && !s.agentPaused[e.agent]).reduce((n, e) => n + grant(e.ops ?? Math.min(s.apps[e.app], OPS_MAX), HELD_ALL), 0);

type Change = { exempt: boolean; apply: (s: State) => void };
function rng(seed: number) {
  let x = seed >>> 0;
  return (n: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x % n;
  };
}
function randomChange(s: State, r: (n: number) => number): Change {
  const k = s.edges.length ? r(s.edges.length) : -1; // the edge INDEX: apply() works on the copy it is given
  const at = (t: State) => (k >= 0 ? t.edges[k] : undefined);
  const agent = r(s.agentPaused.length);
  switch (r(14)) {
    case 0: return { exempt: true, apply: (t) => { t.agentPaused[agent] = true; } };
    case 1: return { exempt: true, apply: (t) => { t.agentPaused[agent] = false; } }; // resume
    case 2: return { exempt: true, apply: (t) => { t.wsPaused = true; } };
    case 3: return { exempt: true, apply: (t) => { t.wsPaused = false; } }; // resume
    case 4: { const add = 1 + r(3); return { exempt: true, apply: (t) => { const e = at(t); if (e) e.held = Math.min(HELD_ALL, e.held + add); } }; } // held added
    case 5: { const n = r(1 << 30); return { exempt: true, apply: (t) => { const e = at(t); if (e && e.ops === null) e.ops = 1 + (n % Math.min(t.apps[e.app], OPS_MAX)); else if (e?.ops) e.ops = Math.max(1, e.ops - 1); } }; } // narrow (validateOps: only the app's own ops, ≤ 128)
    case 6: return { exempt: true, apply: (t) => { const e = at(t); if (e) e.enabled = false; } }; // switch off / consent revoke
    case 7: return { exempt: true, apply: (t) => { if (k >= 0) t.edges.splice(k, 1); } }; // edge delete
    case 8:
    case 11:
    case 12:
    case 13: { const app = r(s.apps.length); return { exempt: false, apply: (t) => { t.edges.push({ agent, app, ops: null, held: 5, enabled: true }); } }; } // new edge
    case 9: return { exempt: false, apply: (t) => { const e = at(t); if (e) e.enabled = true; } }; // switch on
    case 10: return { exempt: false, apply: (t) => { const e = at(t); if (e && e.ops !== null) e.ops = null; } }; // widen to verb-level
    default: throw new Error("unreachable");
  }
}
const clone = (s: State): State => ({ apps: [...s.apps], agentPaused: [...s.agentPaused], wsPaused: s.wsPaused, edges: s.edges.map((e) => ({ ...e })) });

/** Runs `steps` random owner changes through the size rule with `measure`; returns the first broken step (or null) and
 *  how often the rule refused a change and how close the true worst case came to the limit (non-vacuous: QA-SPEC57 S3). */
function run(seed: number, steps: number, limit: number, measure: (s: State) => number): { broken: string | null; refused: number; peak: number } {
  const r = rng(seed);
  const s: State = { apps: Array.from({ length: 8 }, () => 20 + r(200)), agentPaused: Array.from({ length: 40 }, () => false), wsPaused: false, edges: [] };
  let refused = 0;
  let peak = 0;
  for (let i = 0; i < steps; i++) {
    const c = randomChange(s, r);
    const next = clone(s);
    c.apply(next);
    const accepted = c.exempt || measure(next) <= limit || measure(next) <= measure(s);
    if (accepted) Object.assign(s, next);
    else refused++;
    peak = Math.max(peak, worstSize(s));
    if (realSize(s) > worstSize(s)) return { broken: `step ${i}: real ${realSize(s)} > worst ${worstSize(s)}`, refused, peak };
    // the TRUE worst case (every exempt change at its maximum) must stay under the limit: otherwise a later exempt change
    // (resume, narrowing, held additions) can take the real config past it with no check left to stop it
    if (worstSize(s) > limit) return { broken: `step ${i}: true worst ${worstSize(s)} > limit ${limit}`, refused, peak };
  }
  return { broken: null, refused, peak };
}

test("RM-24c: with the C359c/C359d worst case, no sequence of accepted changes (incl. pause → changes → resume) passes the limit", () => {
  const limit = 40_000;
  let refused = 0;
  let nearLimit = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const out = run(seed, 400, limit, worstSize);
    assert.equal(out.broken, null, `seed ${seed}`);
    refused += out.refused;
    if (out.peak >= 0.9 * limit) nearLimit++;
  }
  // non-vacuous: the rule really refuses changes, and many sequences push the true worst case close to the limit
  assert.ok(refused > 1_000, `only ${refused} refusals`);
  assert.ok(nearLimit > 30, `only ${nearLimit} sequences came near the limit`);
});

test("RM-24c: the earlier rule (measure the current state) breaks — the spec rule must not be weakened", () => {
  const limit = 40_000;
  const broken = Array.from({ length: 300 }, (_, i) => run(i + 1, 400, limit, naiveWorst).broken).filter(Boolean);
  assert.ok(broken.length > 0, "the naive measure should break in some sequence");
  // QA-SPEC57 S3: a measure that forgets AGENT pauses must break as well (the model sees agent pause, not only workspace pause)
  const brokenAgent = Array.from({ length: 300 }, (_, i) => run(i + 1, 400, limit, ignoresAgentPause).broken).filter(Boolean);
  assert.ok(brokenAgent.length > 0, "a measure that ignores agent pauses should break in some sequence");
});

test("RM-24c: exempt changes never raise the measured worst case", () => {
  const r = rng(7);
  const s: State = { apps: [30, 200, 128, 5], agentPaused: Array.from({ length: 10 }, () => false), wsPaused: false, edges: [] };
  for (let i = 0; i < 40; i++) s.edges.push({ agent: r(10), app: r(4), ops: r(2) ? null : 1 + r(100), held: r(9), enabled: true });
  for (let i = 0; i < 2000; i++) {
    const c = randomChange(s, r);
    if (!c.exempt) continue;
    const before = worstSize(s);
    c.apply(s); // exempt changes are always applied
    assert.ok(worstSize(s) <= before, `exempt change raised the worst case at ${i}`);
  }
});
