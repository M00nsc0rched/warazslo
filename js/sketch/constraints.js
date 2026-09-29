// Vázlat kényszerek és vezérlő méretek: katalógus, létrehozás, újraszámítás
import { uid } from '../util/misc.js';
import { evaluate, evalVariables } from '../util/units.js';
import { buildSystem, residuals, solveSketch, curveParts } from './solver.js';
import { movePoint } from './edit.js';

// ---------------------------------------------------------------- katalógus
export const CONSTRAINTS = {
  horizontal: { label: 'Vízszintes', glyph: '⎯', icon: 'minus' },
  vertical: { label: 'Függőleges', glyph: '|', icon: 'line' },
  parallel: { label: 'Párhuzamos', glyph: '∥', icon: 'parallel' },
  perpendicular: { label: 'Merőleges', glyph: '⊥', icon: 'perpendicular' },
  tangent: { label: 'Érintő', glyph: 'T', icon: 'tangentC' },
  coincident: { label: 'Egybeeső', glyph: '●', icon: 'coincident' },
  concentric: { label: 'Koncentrikus', glyph: '◎', icon: 'concentric' },
  onCurve: { label: 'Pont a görbén', glyph: '◉', icon: 'onCurve' },
  midpoint: { label: 'Felezőpont', glyph: 'M', icon: 'midpoint' },
  equal: { label: 'Egyenlő', glyph: '=', icon: 'equal' },
  symmetric: { label: 'Szimmetrikus', glyph: '⟷', icon: 'symmetric' },
  fix: { label: 'Rögzítés', glyph: '🔒', icon: 'lock' },
  // méretek
  length: { label: 'Hossz', dim: true, kind: 'len' },
  distance: { label: 'Távolság', dim: true, kind: 'len' },
  hdist: { label: 'Vízszintes távolság', dim: true, kind: 'len' },
  vdist: { label: 'Függőleges távolság', dim: true, kind: 'len' },
  radius: { label: 'Sugár', dim: true, kind: 'len', prefix: 'R ' },
  diameter: { label: 'Átmérő', dim: true, kind: 'len', prefix: 'Ø ' },
  angle: { label: 'Szög', dim: true, kind: 'angle' },
};

export const isDim = (k) => !!(CONSTRAINTS[k.type] && CONSTRAINTS[k.type].dim);

/** Kijelölt pont -> {curve, part} hivatkozás a vázlatban. */
export function pointRef(sketch, p) {
  for (const c of sketch.curves) {
    for (const [part, q] of curveParts(c)) {
      if (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) return { curve: c.id, part };
    }
  }
  return null;
}

/** A kijelölés vázlatelemei egy vázlaton belül: { sketch, lines, circs, points, others } */
export function sketchSelection(app, sel = app.sel) {
  const items = sel.filter((s) => s.type === 'curve' || s.type === 'spoint');
  if (!items.length) return null;
  const sid = items[0].sketchId;
  if (items.some((s) => s.sketchId !== sid)) return null;
  const sketch = app.doc.sketch(sid);
  if (!sketch) return null;
  const lines = [], circs = [], points = [], others = [];
  for (const s of items) {
    if (s.type === 'spoint') { const r = pointRef(sketch, s.p); if (r) points.push(r); continue; }
    const c = sketch.curves.find((x) => x.id === s.curveId);
    if (!c) continue;
    if (c.t === 'line') lines.push({ curve: c.id });
    else if (c.t === 'circle' || c.t === 'arc') circs.push({ curve: c.id });
    else others.push({ curve: c.id });
  }
  return { sketch, lines, circs, points, others, n: items.length };
}

/** Az adott kijelölésre alkalmazható kényszerek és méretek. */
export function applicable(ss) {
  if (!ss) return [];
  const { lines: L, circs: C, points: P, others: O } = ss;
  const nL = L.length, nC = C.length, nP = P.length, n = nL + nC + nP + O.length;
  const out = [];
  const add = (type, refs, extra = {}) => out.push({ type, refs, ...extra });
  if (n === 1 && nL === 1) { add('horizontal', [L[0]]); add('vertical', [L[0]]); add('length', [L[0]]); add('fix', [L[0]]); }
  if (n === 1 && nC === 1) { add('diameter', [C[0]]); add('radius', [C[0]]); add('fix', [C[0]]); }
  if (n === 1 && nP === 1) add('fix', [P[0]]);
  if (n === 2 && nL === 2) { add('parallel', L); add('perpendicular', L); add('equal', L); add('angle', L); add('distance', L, { onlyParallel: true }); }
  if (n === 2 && nL === 1 && nC === 1) add('tangent', [L[0], C[0]]);
  if (n === 2 && nC === 2) { add('concentric', C); add('equal', C); add('tangent', C); }
  if (n === 2 && nP === 2) { add('coincident', P); add('horizontal', P); add('vertical', P); add('distance', P); add('hdist', P); add('vdist', P); }
  if (n === 2 && nP === 1 && nL === 1) { add('onCurve', [P[0], L[0]]); add('midpoint', [P[0], L[0]]); add('distance', [P[0], L[0]]); }
  if (n === 2 && nP === 1 && nC === 1) { add('onCurve', [P[0], C[0]]); add('concentric', [P[0], C[0]], { pointCenter: true }); }
  if (n === 3 && nP === 2 && nL === 1) add('symmetric', [P[0], P[1], L[0]]);
  if (n === 3 && nL === 3) add('symmetric', [L[0], L[1], L[2]], { curves: true });
  return out;
}

// ---------------------------------------------------------------- mérés
/** Egy méret aktuális értéke (mm / fok) a görbékből. */
export function measure(sketch, k) {
  const sys = buildSystem(sketch.curves);
  const fns = residuals(sys, { ...k, value: 0 });
  if (!fns.length) return 0;
  const v = fns[0](sys.x);
  return k.type === 'angle' ? (v * 180) / Math.PI : v;
}

/** Méret létrehozása a jelenlegi értékkel. */
export function makeDim(sketch, type, refs) {
  const k = { id: uid('k'), type, a: refs[0], b: refs[1] || null, c: refs[2] || null };
  if (type === 'hdist' || type === 'vdist') {
    const sys = buildSystem(sketch.curves);
    const i = type === 'hdist' ? 0 : 1;
    const pa = sys.slot.get(`${refs[0].curve}:${refs[0].part}`), pb = sys.slot.get(`${refs[1].curve}:${refs[1].part}`);
    k.sign = sys.x[pb * 2 + i] - sys.x[pa * 2 + i] >= 0 ? 1 : -1;
  }
  if (type === 'angle') {
    // a kisebbik (hegyes/tompa) szöget mérjük az aktuális irányítás szerint
    k.sign = 1;
  }
  k.value = measure(sketch, k);
  return k;
}

// ---------------------------------------------------------------- alkalmazás
/**
 * Kényszer hozzáadása és a vázlat újramegoldása.
 * return { ok, sketch, message }
 */
export function addConstraint(sketch, spec) {
  let s = sketch;
  const refs = spec.refs;
  let k;
  if (spec.type === 'coincident') {
    // az egybeeső pontokat összevonjuk: a második az első helyére kerül
    const sys = buildSystem(s.curves);
    const ia = sys.slot.get(`${refs[0].curve}:${refs[0].part}`), ib = sys.slot.get(`${refs[1].curve}:${refs[1].part}`);
    const pa = [sys.x[ia * 2], sys.x[ia * 2 + 1]], pb = [sys.x[ib * 2], sys.x[ib * 2 + 1]];
    s = { ...s, curves: movePoint(s, pb, pa) };
    const r = solveSketch(s, null, { wantDof: false });
    if (!r.ok) return { ok: false, message: 'A pontok nem vonhatók össze a meglévő kényszerekkel' };
    return { ok: true, sketch: { ...s, curves: r.curves } };
  }
  if (spec.type === 'concentric') {
    const cA = refs[0].part ? refs[0] : { curve: refs[0].curve, part: 'c' };
    const cB = refs[1].part ? refs[1] : { curve: refs[1].curve, part: 'c' };
    return addConstraint(sketch, { type: 'coincident', refs: [cA, cB] });
  }
  if (spec.type === 'symmetric' && spec.curves) {
    // két vonal szimmetrikus a harmadikra: végpontjaik páronként
    let cur = sketch;
    const [l1, l2, ax] = refs;
    for (const [p1, p2] of [['a', 'a'], ['b', 'b']]) {
      const r = addConstraint(cur, { type: 'symmetric', refs: [{ curve: l1.curve, part: p1 }, { curve: l2.curve, part: p2 }, ax] });
      if (!r.ok) return r;
      cur = r.sketch;
    }
    return { ok: true, sketch: cur };
  }
  if (CONSTRAINTS[spec.type] && CONSTRAINTS[spec.type].dim) {
    k = makeDim(s, spec.type, refs);
    if (spec.value != null) k.value = spec.value;
    if (spec.expr) k.expr = spec.expr;
  } else {
    k = { id: uid('k'), type: spec.type, a: refs[0], b: refs[1] || null, c: refs[2] || null };
    if (spec.type === 'fix') {
      if (!refs[0].part) {
        // görbe rögzítése: minden pontja
        const c = s.curves.find((x) => x.id === refs[0].curve);
        let cur = s;
        for (const [part, p] of curveParts(c)) {
          if (c.t === 'arc' && part === 'c') continue;
          cur = { ...cur, constraints: [...(cur.constraints || []), { id: uid('k'), type: 'fix', a: { curve: c.id, part }, at: p.slice() }] };
        }
        if (c.t === 'circle') {
          cur = { ...cur, constraints: [...cur.constraints, makeDim(cur, 'radius', [{ curve: c.id }])] };
        }
        return { ok: true, sketch: cur };
      }
      const sys = buildSystem(s.curves);
      const i = sys.slot.get(`${refs[0].curve}:${refs[0].part}`);
      k.at = [sys.x[i * 2], sys.x[i * 2 + 1]];
    }
    if (spec.type === 'tangent') {
      const circ = refs.filter((r) => { const c = s.curves.find((x) => x.id === r.curve); return c && (c.t === 'circle' || c.t === 'arc'); });
      if (circ.length === 2) {
        const sys = buildSystem(s.curves);
        const get = (r) => { const c = s.curves.find((x) => x.id === r.curve); return { c: c.c, r: c.r }; };
        const A = get(circ[0]), B = get(circ[1]);
        const d = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]);
        k.mode = d < Math.max(A.r, B.r) ? 'int' : 'ext';
        void sys;
      }
    }
    if (spec.type === 'angle') k.sign = 1;
  }
  const next = { ...s, constraints: [...(s.constraints || []), k] };
  const r = solveSketch(next, null, { wantDof: false });
  if (!r.ok) return { ok: false, message: 'A kényszer ütközik a meglévőkkel (túlhatározott vázlat)' };
  return { ok: true, sketch: { ...next, curves: r.curves }, constraint: k };
}

/** Méret értékének módosítása (érték mm/fokban, opcionális kifejezés). */
export function setDimValue(sketch, id, value, expr) {
  const cons = sketch.constraints.map((k) => (k.id === id ? { ...k, value, expr: expr || undefined } : k));
  const next = { ...sketch, constraints: cons };
  const r = solveSketch(next, null, { wantDof: false });
  if (!r.ok) return { ok: false, message: 'Ezzel az értékkel a vázlat nem oldható meg' };
  return { ok: true, sketch: { ...next, curves: r.curves } };
}

/** Kényszer törlése. */
export function removeConstraint(sketch, id) {
  return { ...sketch, constraints: (sketch.constraints || []).filter((k) => k.id !== id) };
}

/** Görbék törlésekor a rájuk hivatkozó kényszerek eltávolítása. */
export function pruneConstraints(sketch) {
  if (!sketch.constraints || !sketch.constraints.length) return sketch;
  const ids = new Set(sketch.curves.map((c) => c.id));
  const ok = (r) => !r || ids.has(r.curve);
  const cons = sketch.constraints.filter((k) => ok(k.a) && ok(k.b) && ok(k.c));
  return cons.length === sketch.constraints.length ? sketch : { ...sketch, constraints: cons };
}

/**
 * Kifejezéssel vezérelt méretek frissítése a változók alapján minden vázlatban.
 * return { state, changed: [sketchIds], errors: [..] }
 */
export function refreshExpressions(state) {
  const { map } = evalVariables(state.variables || []);
  const changed = [];
  const errors = [];
  const sketches = state.sketches.map((s) => {
    if (!s.constraints || !s.constraints.some((k) => k.expr)) return s;
    let dirty = false;
    const cons = s.constraints.map((k) => {
      if (!k.expr) return k;
      try {
        const v = evaluate(k.expr, CONSTRAINTS[k.type].kind || 'len', map);
        if (Math.abs(v - k.value) > 1e-9) { dirty = true; return { ...k, value: v }; }
      } catch (e) { errors.push(`${s.name}: ${k.expr} – ${e.message}`); }
      return k;
    });
    if (!dirty) return s;
    const next = { ...s, constraints: cons };
    const r = solveSketch(next, null, { wantDof: false });
    if (!r.ok) { errors.push(`${s.name}: a méretekkel nem oldható meg`); return s; }
    changed.push(s.id);
    return { ...next, curves: r.curves };
  });
  return { state: changed.length ? { ...state, sketches } : state, changed, errors };
}

/** Szabadsági fokok száma (a panelen kijelezve). */
export function sketchDof(sketch) {
  try { return solveSketch(sketch, null, { wantDof: true }).dof; } catch (e) { return null; }
}

/** Szétválasztás: a pontban találkozó görbék végpontjait kissé szétnyitja (az elsőt kivéve). */
export function disconnectPoint(sketch, p, gap) {
  let first = true;
  const curves = sketch.curves.map((c) => {
    const parts = curveParts(c).filter(([, q]) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6);
    if (!parts.length) return c;
    if (first) { first = false; return c; }
    if (c.t === 'line') {
      const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) || 1;
      const g = Math.min(gap, L * 0.2);
      const d = [(c.b[0] - c.a[0]) / L * g, (c.b[1] - c.a[1]) / L * g];
      return parts[0][0] === 'a' ? { ...c, a: [c.a[0] + d[0], c.a[1] + d[1]] } : { ...c, b: [c.b[0] - d[0], c.b[1] - d[1]] };
    }
    if (c.t === 'arc') {
      const da = Math.min(gap / c.r, (c.a1 - c.a0) * 0.2);
      if (parts[0][0] === 's') return { ...c, a0: c.a0 + da };
      if (parts[0][0] === 'e') return { ...c, a1: c.a1 - da };
      return { ...c, c: [c.c[0] + gap, c.c[1]] };
    }
    if (c.t === 'spline') {
      const i = +parts[0][0].slice(1);
      const j = i === 0 ? 1 : i - 1;
      const pts = c.pts.slice();
      const L = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) || 1;
      pts[i] = [pts[i][0] + (pts[j][0] - pts[i][0]) / L * Math.min(gap, L * 0.2), pts[i][1] + (pts[j][1] - pts[i][1]) / L * Math.min(gap, L * 0.2)];
      return { ...c, pts };
    }
    if (c.c) return { ...c, c: [c.c[0] + gap, c.c[1]] };
    if (c.p) return { ...c, p: [c.p[0] + gap, c.p[1]] };
    return c;
  });
  return { ...sketch, curves };
}
