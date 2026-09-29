// Vázlat szerkesztése: pontok húzása, méretek megadása
import { dist, polar, TAU } from './geom2d.js';
import { planeFromJSON, toWorld } from './manager.js';
import { snap, SnapViz } from "./snap.js";
import { solveSketch } from "./solver.js";
import { fmtLen } from '../util/units.js';

const EPS = 1e-6;

/** Egy pontra illeszkedő görbe-szerepek egy vázlatban. */
function rolesAt(sketch, p) {
  const out = [];
  for (const c of sketch.curves) {
    switch (c.t) {
      case 'line':
        if (dist(c.a, p) < EPS) out.push({ id: c.id, role: 'a' });
        if (dist(c.b, p) < EPS) out.push({ id: c.id, role: 'b' });
        break;
      case 'circle': case 'ellipse':
        if (dist(c.c, p) < EPS) out.push({ id: c.id, role: 'c' });
        break;
      case 'arc':
        if (dist(c.c, p) < EPS) out.push({ id: c.id, role: 'c' });
        if (dist(polar(c.c, c.r, c.a0), p) < EPS) out.push({ id: c.id, role: 'a0' });
        if (dist(polar(c.c, c.r, c.a1), p) < EPS) out.push({ id: c.id, role: 'a1' });
        break;
      case 'spline':
        c.pts.forEach((q, i) => { if (dist(q, p) < EPS) out.push({ id: c.id, role: `pt${i}` }); });
        break;
      case 'point': case 'text':
        if (dist(c.p, p) < EPS) out.push({ id: c.id, role: 'p' });
        break;
    }
  }
  return out;
}

/** Ív egyik végének áthelyezése, a középponti szög megtartásával. */
function moveArcEnd(c, role, np) {
  const s = c.a1 - c.a0;
  let S = polar(c.c, c.r, c.a0), E = polar(c.c, c.r, c.a1);
  if (role === 'a0') S = np; else E = np;
  const d = dist(S, E);
  if (d < 1e-9) return c;
  const r = d / (2 * Math.sin(s / 2));
  const dir = [(E[0] - S[0]) / d, (E[1] - S[1]) / d];
  const left = [-dir[1], dir[0]];
  const M = [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2];
  const h = r * Math.cos(s / 2);
  const C = [M[0] + left[0] * h, M[1] + left[1] * h];
  const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
  return { ...c, c: C, r: Math.abs(r), a0, a1: a0 + s };
}

function applyRole(c, role, np, delta) {
  switch (role) {
    case 'a': return { ...c, a: np };
    case 'b': return { ...c, b: np };
    case 'c':
      if (c.t === 'arc' || c.t === 'circle' || c.t === 'ellipse') return { ...c, c: np };
      return c;
    case 'a0': case 'a1': return moveArcEnd(c, role, np);
    case 'p': return { ...c, p: np };
    default:
      if (role.startsWith('pt')) {
        const i = +role.slice(2);
        const pts = c.pts.slice();
        pts[i] = np;
        return { ...c, pts };
      }
      return c;
  }
}

/** Görbelista, amelyben az adott pontra illeszkedő végpontok áthelyeződnek. */
export function movePoint(sketch, oldP, newP, skipIds = new Set()) {
  const roles = rolesAt(sketch, oldP).filter((r) => !skipIds.has(r.id));
  if (!roles.length) return sketch.curves;
  const byId = new Map();
  for (const r of roles) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r.role); }
  return sketch.curves.map((c) => {
    const rs = byId.get(c.id);
    if (!rs) return c;
    let n = c;
    for (const role of rs) n = applyRole(n, role, newP);
    return n;
  });
}

export class PointDrag {
  constructor(app, pick, ev) {
    this.app = app;
    this.sketchId = pick.sketchId;
    this.sketch0 = app.doc.sketch(pick.sketchId);
    this.frame = planeFromJSON(this.sketch0.plane);
    this.p0 = pick.p;
    this.cur = pick.p;
    this.roles = rolesAt(this.sketch0, pick.p);
    this.committed = false;
    this.viz = new SnapViz(app);
  }

  move(ev) {
    const uv = this.app.sketches.rayToSketch(this.sketch0, ev.x, ev.y);
    if (!uv) return;
    const s = snap(this.app, this.frame, uv, ev, { exclude: [this.p0], noCurves: false });
    this.viz.show(this.frame, s);
    const np = s.p;
    if (dist(np, this.cur) < 1e-12) return;
    this.cur = np;
    // kényszermegoldóval: a húzott pont a célba kerül, a többi a lehető legkevésbé mozdul
    const res = solveSketch(this.sketch0, null, { drag: { point: this.p0, to: np }, wantDof: false });
    const curves = res.curves;
    const st = this.app.doc.state;
    const ns = { ...st, sketches: st.sketches.map((x) => (x.id === this.sketchId ? { ...x, curves } : x)) };
    if (!this.committed) { this.app.doc.commit('Pont mozgatása', ns, { icon: 'point' }); this.committed = true; }
    else this.app.doc.replace(ns);
  }

  finish() { this.viz.dispose(); }

  cancel() {
    this.viz.dispose();
    if (this.committed) this.app.doc.undo();
  }
}

/** Kijelölt görbe méretének megadása billentyűzettel. */
export function editCurveDimension(app, sketch, c) {
  const commit = (curves, label) => {
    const st = app.doc.state;
    app.doc.commit(label, { ...st, sketches: st.sketches.map((x) => (x.id === sketch.id ? { ...x, curves } : x)) }, { icon: 'rename' });
  };
  const anchor = app.ui.selInfo;
  if (c.t === 'line') {
    const L = dist(c.a, c.b);
    app.ui.keypad({
      label: 'Vonal hossza', kind: 'len', value: L, anchor,
      onDone: (v) => {
        if (!(v > 0)) return;
        const d = [(c.b[0] - c.a[0]) / L, (c.b[1] - c.a[1]) / L];
        const nb = [c.a[0] + d[0] * v, c.a[1] + d[1] * v];
        commit(movePoint(sketch, c.b, nb), 'Hossz megadása');
      },
    });
  } else if (c.t === 'circle') {
    app.ui.keypad({
      label: 'Kör átmérője', kind: 'len', value: c.r * 2, anchor,
      onDone: (v) => { if (v > 0) commit(sketch.curves.map((x) => (x.id === c.id ? { ...x, r: v / 2 } : x)), 'Átmérő megadása'); },
    });
  } else if (c.t === 'arc') {
    app.ui.keypad({
      label: 'Ív sugara', kind: 'len', value: c.r, anchor,
      onDone: (v) => {
        if (!(v > 0)) return;
        const n = { ...c, r: v };
        let curves = sketch.curves.map((x) => (x.id === c.id ? n : x));
        const tmp = { ...sketch, curves };
        curves = movePoint(tmp, polar(c.c, c.r, c.a0), polar(c.c, v, c.a0), new Set([c.id]));
        curves = movePoint({ ...sketch, curves }, polar(c.c, c.r, c.a1), polar(c.c, v, c.a1), new Set([c.id]));
        commit(curves, 'Sugár megadása');
      },
    });
  } else if (c.t === 'ellipse') {
    app.ui.keypad({
      label: 'Ellipszis fél-nagytengely', kind: 'len', value: c.rx, anchor,
      onDone: (rx) => app.ui.keypad({
        label: 'Ellipszis fél-kistengely', kind: 'len', value: c.ry, anchor,
        onDone: (ry) => { if (rx > 0 && ry > 0) commit(sketch.curves.map((x) => (x.id === c.id ? { ...x, rx, ry } : x)), 'Ellipszis méret'); },
      }),
    });
  } else {
    app.ui.toast('Ennek a görbének nincs szerkeszthető mérete; húzd a pontjait', '', 2500);
  }
}

export function dimensionText(c) {
  if (c.t === 'line') return fmtLen(dist(c.a, c.b));
  if (c.t === 'circle') return `Ø ${fmtLen(c.r * 2)}`;
  if (c.t === 'arc') return `R ${fmtLen(c.r)}`;
  return '';
}

export { toWorld, TAU };
