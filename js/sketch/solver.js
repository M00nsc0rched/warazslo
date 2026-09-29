// Vázlat geometriai kényszermegoldó (Gauss–Newton, minimális normájú lépés).
// A görbék végpontjai koordináta szerint csoportosítva közös pontváltozókat kapnak
// (így az összekötött görbék együtt mozognak), a kényszerek maradékfüggvények.

const TAU = Math.PI * 2;
const CLUSTER_TOL = 1e-6;

// ---------------------------------------------------------------- pont-részek
/** Egy görbe pont-részei: [part, [x,y]] */
export function curveParts(c) {
  switch (c.t) {
    case 'line': return [['a', c.a], ['b', c.b]];
    case 'circle': return [['c', c.c]];
    case 'ellipse': return [['c', c.c]];
    case 'arc': return [['c', c.c], ['s', [c.c[0] + c.r * Math.cos(c.a0), c.c[1] + c.r * Math.sin(c.a0)]], ['e', [c.c[0] + c.r * Math.cos(c.a1), c.c[1] + c.r * Math.sin(c.a1)]]];
    case 'spline': return c.pts.map((p, i) => [`p${i}`, p]);
    case 'point': case 'text': return [['p', c.p]];
    default: return [];
  }
}

/** Rendszer felépítése a görbékből. */
export function buildSystem(curves) {
  const pts = [];          // [x,y] klaszterek
  const slot = new Map();  // "curveId:part" -> pont index
  const grid = new Map();
  const cell = CLUSTER_TOL * 20;
  const find = (p) => {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = grid.get(`${gx + dx},${gy + dy}`);
      if (l) for (const i of l) if (Math.abs(pts[i][0] - p[0]) < CLUSTER_TOL && Math.abs(pts[i][1] - p[1]) < CLUSTER_TOL) return i;
    }
    const i = pts.length;
    pts.push([p[0], p[1]]);
    const k = `${gx},${gy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
    return i;
  };
  for (const c of curves) for (const [part, p] of curveParts(c)) slot.set(`${c.id}:${part}`, find(p));
  const scal = new Map();   // "curveId:name" -> változó index (a pontok után)
  const extra = [];
  for (const c of curves) {
    if (c.t === 'circle') { scal.set(`${c.id}:r`, extra.length); extra.push(c.r); }
    if (c.t === 'ellipse') {
      scal.set(`${c.id}:rx`, extra.length); extra.push(c.rx);
      scal.set(`${c.id}:ry`, extra.length); extra.push(c.ry);
      scal.set(`${c.id}:rot`, extra.length); extra.push(c.rot || 0);
    }
  }
  const np = pts.length;
  const x = new Float64Array(np * 2 + extra.length);
  pts.forEach((p, i) => { x[i * 2] = p[0]; x[i * 2 + 1] = p[1]; });
  extra.forEach((v, i) => { x[np * 2 + i] = v; });
  for (const [k, i] of scal) scal.set(k, np * 2 + i);
  const byId = new Map(curves.map((c) => [c.id, c]));
  return { x, np, slot, scal, curves, byId };
}

// ---------------------------------------------------------------- hozzáférők
function P(sys, x, curveId, part) {
  const i = sys.slot.get(`${curveId}:${part}`);
  if (i == null) throw new Error('hiányzó pont');
  return [x[i * 2], x[i * 2 + 1]];
}

function lineOf(sys, x, id) { return [P(sys, x, id, 'a'), P(sys, x, id, 'b')]; }

function circleOf(sys, x, id) {
  const c = sys.byId.get(id);
  if (!c) throw new Error('hiányzó görbe');
  const C = P(sys, x, id, 'c');
  if (c.t === 'circle') return { c: C, r: x[sys.scal.get(`${id}:r`)] };
  if (c.t === 'arc') { const S = P(sys, x, id, 's'); return { c: C, r: Math.hypot(S[0] - C[0], S[1] - C[1]) }; }
  throw new Error('nem kör');
}

/** Pont hivatkozás: {curve, part} ; görbe hivatkozás: {curve} */
function refPoint(sys, x, ref) { return P(sys, x, ref.curve, ref.part); }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// ---------------------------------------------------------------- maradékok
/**
 * Egy kényszer maradékfüggvényei. k: { type, a, b, c, value (mm / fok), mode, sign }
 */
export function residuals(sys, k) {
  const t = sys.byId;
  const isLine = (r) => r && !r.part && t.get(r.curve) && t.get(r.curve).t === 'line';
  const isCirc = (r) => r && !r.part && t.get(r.curve) && (t.get(r.curve).t === 'circle' || t.get(r.curve).t === 'arc');
  const out = [];
  const v = k.value;
  switch (k.type) {
    case 'horizontal':
      if (isLine(k.a)) out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve); return b[1] - a[1]; });
      else out.push((x) => refPoint(sys, x, k.b)[1] - refPoint(sys, x, k.a)[1]);
      break;
    case 'vertical':
      if (isLine(k.a)) out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve); return b[0] - a[0]; });
      else out.push((x) => refPoint(sys, x, k.b)[0] - refPoint(sys, x, k.a)[0]);
      break;
    case 'parallel':
      out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve), [c, d] = lineOf(sys, x, k.b.curve); const u = sub(b, a), w = sub(d, c); return cross(u, w) / Math.max(1e-9, len(u) * len(w)); });
      break;
    case 'perpendicular':
      out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve), [c, d] = lineOf(sys, x, k.b.curve); const u = sub(b, a), w = sub(d, c); return dot(u, w) / Math.max(1e-9, len(u) * len(w)); });
      break;
    case 'tangent':
      if (isLine(k.a) && isCirc(k.b) || isLine(k.b) && isCirc(k.a)) {
        const L = isLine(k.a) ? k.a : k.b, C = isLine(k.a) ? k.b : k.a;
        out.push((x) => { const [a, b] = lineOf(sys, x, L.curve); const { c, r } = circleOf(sys, x, C.curve); const d = sub(b, a); return Math.abs(cross(d, sub(c, a))) / Math.max(1e-9, len(d)) - r; });
      } else if (isCirc(k.a) && isCirc(k.b)) {
        out.push((x) => { const A = circleOf(sys, x, k.a.curve), B = circleOf(sys, x, k.b.curve); const d = len(sub(A.c, B.c)); return k.mode === 'int' ? d - Math.abs(A.r - B.r) : d - (A.r + B.r); });
      }
      break;
    case 'coincident':
    case 'concentric': {
      const pa = (x) => (k.a.part ? refPoint(sys, x, k.a) : P(sys, x, k.a.curve, 'c'));
      const pb = (x) => (k.b.part ? refPoint(sys, x, k.b) : P(sys, x, k.b.curve, 'c'));
      out.push((x) => pb(x)[0] - pa(x)[0], (x) => pb(x)[1] - pa(x)[1]);
      break;
    }
    case 'onCurve':
      if (isLine(k.b)) out.push((x) => { const p = refPoint(sys, x, k.a); const [a, b] = lineOf(sys, x, k.b.curve); const d = sub(b, a); return cross(d, sub(p, a)) / Math.max(1e-9, len(d)); });
      else if (isCirc(k.b)) out.push((x) => { const p = refPoint(sys, x, k.a); const { c, r } = circleOf(sys, x, k.b.curve); return len(sub(p, c)) - r; });
      break;
    case 'midpoint':
      out.push((x) => { const p = refPoint(sys, x, k.a); const [a, b] = lineOf(sys, x, k.b.curve); return p[0] - (a[0] + b[0]) / 2; });
      out.push((x) => { const p = refPoint(sys, x, k.a); const [a, b] = lineOf(sys, x, k.b.curve); return p[1] - (a[1] + b[1]) / 2; });
      break;
    case 'equal':
      if (isLine(k.a) && isLine(k.b)) out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve), [c, d] = lineOf(sys, x, k.b.curve); return len(sub(b, a)) - len(sub(d, c)); });
      else if (isCirc(k.a) && isCirc(k.b)) out.push((x) => circleOf(sys, x, k.a.curve).r - circleOf(sys, x, k.b.curve).r);
      break;
    case 'symmetric': {
      // a, b pontok szimmetrikusak a c vonalra
      out.push((x) => { const pa = refPoint(sys, x, k.a), pb = refPoint(sys, x, k.b); const [a, b] = lineOf(sys, x, k.c.curve); const d = sub(b, a); const m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]; return cross(d, sub(m, a)) / Math.max(1e-9, len(d)); });
      out.push((x) => { const pa = refPoint(sys, x, k.a), pb = refPoint(sys, x, k.b); const [a, b] = lineOf(sys, x, k.c.curve); const d = sub(b, a); return dot(sub(pb, pa), d) / Math.max(1e-9, len(d)); });
      break;
    }
    case 'fix':
      out.push((x) => refPoint(sys, x, k.a)[0] - k.at[0], (x) => refPoint(sys, x, k.a)[1] - k.at[1]);
      break;
    // ---------------- méretek
    case 'length':
      out.push((x) => { const [a, b] = lineOf(sys, x, k.a.curve); return len(sub(b, a)) - v; });
      break;
    case 'distance':
      if (k.b && !k.b.part && isLine(k.b)) out.push((x) => { const p = refPoint(sys, x, k.a); const [a, b] = lineOf(sys, x, k.b.curve); const d = sub(b, a); return Math.abs(cross(d, sub(p, a))) / Math.max(1e-9, len(d)) - v; });
      else if (isLine(k.a) && isLine(k.b)) out.push((x) => { const [a] = lineOf(sys, x, k.a.curve); const [c, d] = lineOf(sys, x, k.b.curve); const w = sub(d, c); return Math.abs(cross(w, sub(a, c))) / Math.max(1e-9, len(w)) - v; });
      else out.push((x) => len(sub(refPoint(sys, x, k.b), refPoint(sys, x, k.a))) - v);
      break;
    case 'hdist':
      out.push((x) => (refPoint(sys, x, k.b)[0] - refPoint(sys, x, k.a)[0]) * (k.sign || 1) - v);
      break;
    case 'vdist':
      out.push((x) => (refPoint(sys, x, k.b)[1] - refPoint(sys, x, k.a)[1]) * (k.sign || 1) - v);
      break;
    case 'radius':
      out.push((x) => circleOf(sys, x, k.a.curve).r - v);
      break;
    case 'diameter':
      out.push((x) => 2 * circleOf(sys, x, k.a.curve).r - v);
      break;
    case 'angle':
      out.push((x) => {
        const [a, b] = lineOf(sys, x, k.a.curve), [c, d] = lineOf(sys, x, k.b.curve);
        const u = sub(b, a), w = sub(d, c);
        const ang = Math.atan2(Math.abs(cross(u, w)), dot(u, w) * (k.sign || 1));
        return ang - (v * Math.PI) / 180;
      });
      break;
    default: break;
  }
  return out;
}

/** Görbékhez tartozó implicit kényszerek (ív: kezdő- és végpont azonos sugáron). */
function implicit(sys) {
  const out = [];
  for (const c of sys.curves) {
    if (c.t === 'arc') {
      out.push((x) => { const C = P(sys, x, c.id, 'c'), S = P(sys, x, c.id, 's'), E = P(sys, x, c.id, 'e'); return len(sub(E, C)) - len(sub(S, C)); });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lineáris algebra
function solveSym(A, b, n) {
  // Gauss-elimináció részleges főelem-kiválasztással (A: n*n sorfolytonos, felülíródik)
  const x = b.slice();
  for (let i = 0; i < n; i++) {
    let p = i, mx = Math.abs(A[i * n + i]);
    for (let r = i + 1; r < n; r++) { const v = Math.abs(A[r * n + i]); if (v > mx) { mx = v; p = r; } }
    if (mx < 1e-300) continue;
    if (p !== i) {
      for (let c = 0; c < n; c++) { const t = A[i * n + c]; A[i * n + c] = A[p * n + c]; A[p * n + c] = t; }
      const t = x[i]; x[i] = x[p]; x[p] = t;
    }
    const d = A[i * n + i];
    for (let r = i + 1; r < n; r++) {
      const f = A[r * n + i] / d;
      if (f === 0) continue;
      for (let c = i; c < n; c++) A[r * n + c] -= f * A[i * n + c];
      x[r] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let c = i + 1; c < n; c++) s -= A[i * n + c] * x[c];
    const d = A[i * n + i];
    x[i] = Math.abs(d) < 1e-300 ? 0 : s / d;
  }
  return x;
}

function evalF(fns, x) {
  const F = new Float64Array(fns.length);
  for (let i = 0; i < fns.length; i++) {
    let v;
    try { v = fns[i](x); } catch (e) { v = 0; }
    F[i] = Number.isFinite(v) ? v : 0;
  }
  return F;
}

function jacobian(fns, x, free, F0) {
  const m = fns.length, n = free.length;
  const J = new Float64Array(m * n);
  const xx = Float64Array.from(x);
  for (let j = 0; j < n; j++) {
    const idx = free[j];
    const h = 1e-7 * (1 + Math.abs(x[idx]));
    xx[idx] = x[idx] + h;
    const F1 = evalF(fns, xx);
    xx[idx] = x[idx];
    for (let i = 0; i < m; i++) J[i * n + j] = (F1[i] - F0[i]) / h;
  }
  return J;
}

const norm = (F) => { let s = 0; for (const v of F) s = Math.max(s, Math.abs(v)); return s; };

/** Rang Gauss-eliminációval (a szabadsági fokokhoz). */
function rank(J, m, n) {
  const A = Float64Array.from(J);
  let r = 0;
  let scale = 0;
  for (const v of A) scale = Math.max(scale, Math.abs(v));
  const tol = Math.max(1e-9, scale * 1e-9);
  for (let c = 0; c < n && r < m; c++) {
    let p = r, mx = Math.abs(A[r * n + c]);
    for (let i = r + 1; i < m; i++) { const v = Math.abs(A[i * n + c]); if (v > mx) { mx = v; p = i; } }
    if (mx < tol) continue;
    if (p !== r) for (let k = 0; k < n; k++) { const t = A[r * n + k]; A[r * n + k] = A[p * n + k]; A[p * n + k] = t; }
    for (let i = r + 1; i < m; i++) {
      const f = A[i * n + c] / A[r * n + c];
      if (f) for (let k = c; k < n; k++) A[i * n + k] -= f * A[r * n + k];
    }
    r++;
  }
  return r;
}

/**
 * Megoldás. constraints: kényszerlista (értékekkel), opts.fixedPoints: rögzített pont indexek.
 * return: { ok, x, residual, dof }
 */
export function solveSystem(sys, constraints, { fixedPoints = [], maxIter = 60, wantDof = true } = {}) {
  const fns = [...implicit(sys)];
  for (const k of constraints) {
    try { fns.push(...residuals(sys, k)); } catch (e) { /* hiányzó hivatkozás: kihagyjuk */ }
  }
  const fixed = new Set();
  for (const i of fixedPoints) { fixed.add(i * 2); fixed.add(i * 2 + 1); }
  const free = [];
  for (let i = 0; i < sys.x.length; i++) if (!fixed.has(i)) free.push(i);
  let x = Float64Array.from(sys.x);
  const m = fns.length, n = free.length;
  if (!m || !n) return { ok: true, x, residual: 0, dof: n };
  let F = evalF(fns, x);
  let r0 = norm(F);
  let J = null;
  for (let it = 0; it < maxIter && r0 > 1e-10; it++) {
    J = jacobian(fns, x, free, F);
    // (J Jᵀ + μI) y = F ; Δ = -Jᵀ y
    const A = new Float64Array(m * m);
    let tr = 0;
    for (let i = 0; i < m; i++) {
      for (let k = i; k < m; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += J[i * n + j] * J[k * n + j];
        A[i * m + k] = s; A[k * m + i] = s;
      }
      tr += A[i * m + i];
    }
    const mu = Math.max(1e-14, (tr / m) * 1e-10);
    for (let i = 0; i < m; i++) A[i * m + i] += mu;
    const y = solveSym(A, Array.from(F), m);
    const d = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i * n + j] * y[i]; d[j] = -s; }
    let alpha = 1, improved = false;
    for (let ls = 0; ls < 12; ls++) {
      const xn = Float64Array.from(x);
      for (let j = 0; j < n; j++) xn[free[j]] += alpha * d[j];
      const Fn = evalF(fns, xn);
      const rn = norm(Fn);
      if (rn < r0 || rn < 1e-10) { x = xn; F = Fn; r0 = rn; improved = true; break; }
      alpha *= 0.5;
    }
    if (!improved) break;
  }
  let dof = n;
  if (wantDof) {
    const Jf = jacobian(fns, x, free, F);
    dof = n - rank(Jf, m, n);
  }
  return { ok: r0 < 1e-6, x, residual: r0, dof };
}

/** Görbék visszaállítása a megoldott változókból. */
export function extractCurves(sys, x) {
  return sys.curves.map((c) => {
    const p = (part) => P(sys, x, c.id, part);
    switch (c.t) {
      case 'line': return { ...c, a: p('a'), b: p('b') };
      case 'circle': return { ...c, c: p('c'), r: Math.abs(x[sys.scal.get(`${c.id}:r`)]) };
      case 'ellipse': return { ...c, c: p('c'), rx: Math.abs(x[sys.scal.get(`${c.id}:rx`)]), ry: Math.abs(x[sys.scal.get(`${c.id}:ry`)]), rot: x[sys.scal.get(`${c.id}:rot`)] };
      case 'point': case 'text': return { ...c, p: p('p') };
      case 'spline': return { ...c, pts: c.pts.map((_, i) => p(`p${i}`)) };
      case 'arc': {
        const C = p('c'), S = p('s'), E = p('e');
        const r = Math.hypot(S[0] - C[0], S[1] - C[1]);
        const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
        let a1 = Math.atan2(E[1] - C[1], E[0] - C[0]);
        while (a1 <= a0 + 1e-9) a1 += TAU;
        // a korábbi középponti szöghöz legközelebbi változat
        const old = c.a1 - c.a0;
        if (Math.abs(a1 - a0 - old) > Math.PI && a1 - TAU > a0 + 1e-9) a1 -= TAU;
        return { ...c, c: C, r, a0, a1 };
      }
      default: return c;
    }
  });
}

/** Kényszer-ellenőrzött megoldás egy vázlatra. drag: { point:[u,v] eredeti, to:[u,v] } */
export function solveSketch(sketch, values, { drag = null, wantDof = true } = {}) {
  const sys = buildSystem(sketch.curves);
  const cons = (sketch.constraints || []).map((k) => ({ ...k, value: values && values.has(k.id) ? values.get(k.id) : k.value }));
  const fixedPoints = [];
  if (drag) {
    // a húzott pont klasztere
    let idx = -1;
    for (let i = 0; i < sys.np; i++) {
      if (Math.abs(sys.x[i * 2] - drag.point[0]) < 1e-6 && Math.abs(sys.x[i * 2 + 1] - drag.point[1]) < 1e-6) { idx = i; break; }
    }
    if (idx >= 0) {
      sys.x[idx * 2] = drag.to[0];
      sys.x[idx * 2 + 1] = drag.to[1];
      const r = solveSystem(sys, cons, { fixedPoints: [idx], wantDof: false });
      if (r.ok) return { ok: true, curves: extractCurves(sys, r.x), dof: null, residual: r.residual };
      // a pont nem mozdulhat szabadon: a legközelebbi érvényes helyzet
      const r2 = solveSystem(sys, cons, { wantDof: false });
      return { ok: r2.ok, curves: extractCurves(sys, r2.x), dof: null, residual: r2.residual };
    }
  }
  const r = solveSystem(sys, cons, { wantDof });
  return { ok: r.ok, curves: extractCurves(sys, r.x), dof: r.dof, residual: r.residual };
}

/** Pont-klaszter indexe egy koordinátához (a húzáshoz). */
export function pointIndexAt(curves, p) {
  const sys = buildSystem(curves);
  for (let i = 0; i < sys.np; i++) if (Math.abs(sys.x[i * 2] - p[0]) < 1e-6 && Math.abs(sys.x[i * 2 + 1] - p[1]) < 1e-6) return i;
  return -1;
}
