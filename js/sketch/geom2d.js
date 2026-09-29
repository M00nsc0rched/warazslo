// 2D görbe primitívek: vonal, ív, kör, harmadfokú Bézier
// Darab (piece): { k:'line', a, b } | { k:'arc', c, r, a0, a1 } (CCW, a1>a0) | { k:'circle', c, r } | { k:'bez', p:[p0,p1,p2,p3] }

export const TAU = Math.PI * 2;
export const EPS = 1e-7;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const angleOf = (a) => Math.atan2(a[1], a[0]);
export const polar = (c, r, t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
export const normAngle = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

// ---------------------------------------------------------------- kiértékelés
export function evalAt(pc, t) {
  switch (pc.k) {
    case 'line': return lerp2(pc.a, pc.b, t);
    case 'arc': return polar(pc.c, pc.r, pc.a0 + (pc.a1 - pc.a0) * t);
    case 'circle': return polar(pc.c, pc.r, t * TAU);
    case 'bez': {
      const [p0, p1, p2, p3] = pc.p, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
    }
  }
  return [0, 0];
}

export function derivAt(pc, t) {
  switch (pc.k) {
    case 'line': return sub(pc.b, pc.a);
    case 'arc': { const s = pc.a1 - pc.a0, a = pc.a0 + s * t; return [-pc.r * Math.sin(a) * s, pc.r * Math.cos(a) * s]; }
    case 'circle': { const a = t * TAU; return [-pc.r * Math.sin(a) * TAU, pc.r * Math.cos(a) * TAU]; }
    case 'bez': {
      const [p0, p1, p2, p3] = pc.p, u = 1 - t;
      const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
      return [a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]), a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1])];
    }
  }
  return [1, 0];
}

export function pieceLength(pc) {
  switch (pc.k) {
    case 'line': return dist(pc.a, pc.b);
    case 'arc': return pc.r * (pc.a1 - pc.a0);
    case 'circle': return pc.r * TAU;
    case 'bez': { let L = 0, prev = pc.p[0]; for (let i = 1; i <= 24; i++) { const q = evalAt(pc, i / 24); L += dist(prev, q); prev = q; } return L; }
  }
  return 0;
}

/** Lapítás pontlistává (a paraméterértékekkel). */
export function flatten(pc, { maxSeg = 0.6, minN = 1 } = {}) {
  let n;
  switch (pc.k) {
    case 'line': n = 1; break;
    case 'arc': n = Math.max(2, Math.ceil((pc.a1 - pc.a0) / (TAU / 72))); break;
    case 'circle': n = 72; break;
    case 'bez': n = 24; break;
    default: n = 1;
  }
  n = Math.max(n, minN);
  const pts = [], ts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; ts.push(t); pts.push(evalAt(pc, t)); }
  return { pts, ts };
}

export function bboxOf(pc) {
  if (pc.k === 'circle' || pc.k === 'arc') {
    if (pc.k === 'circle') return [pc.c[0] - pc.r, pc.c[1] - pc.r, pc.c[0] + pc.r, pc.c[1] + pc.r];
  }
  const { pts } = flatten(pc);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (pc.k === 'bez') for (const p of pc.p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (pc.k === 'arc') { const pad = pc.r * 0.02; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; }
  return [x0, y0, x1, y1];
}

const bboxOverlap = (a, b, e) => a[0] <= b[2] + e && b[0] <= a[2] + e && a[1] <= b[3] + e && b[1] <= a[3] + e;

/** A darab paramétere egy adott szögnél (ív/kör), vagy null ha kívül esik. */
function angleParam(pc, ang, epsA) {
  if (pc.k === 'circle') return normAngle(ang) / TAU;
  const span = pc.a1 - pc.a0;
  let d = normAngle(ang - pc.a0);
  if (d > span + epsA) { if (TAU - d < epsA) d = 0; else return null; }
  return Math.min(1, d / span);
}

/** Legközelebbi pont a darabon. */
export function closest(pc, p) {
  switch (pc.k) {
    case 'line': {
      const d = sub(pc.b, pc.a), L2 = dot(d, d);
      let t = L2 > 0 ? dot(sub(p, pc.a), d) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const q = evalAt(pc, t);
      return { t, point: q, d: dist(q, p) };
    }
    case 'circle':
    case 'arc': {
      const ang = angleOf(sub(p, pc.c));
      let t = angleParam(pc, ang, 0);
      if (t === null) {
        const q0 = evalAt(pc, 0), q1 = evalAt(pc, 1);
        return dist(q0, p) < dist(q1, p) ? { t: 0, point: q0, d: dist(q0, p) } : { t: 1, point: q1, d: dist(q1, p) };
      }
      const q = evalAt(pc, t);
      return { t, point: q, d: dist(q, p) };
    }
    case 'bez': {
      let best = { t: 0, d: Infinity };
      for (let i = 0; i <= 32; i++) { const t = i / 32, q = evalAt(pc, t), d = dist(q, p); if (d < best.d) best = { t, d }; }
      let t = best.t;
      for (let it = 0; it < 12; it++) {
        const q = evalAt(pc, t), d1 = derivAt(pc, t);
        const h = 1e-5;
        const d2 = sub(derivAt(pc, Math.min(1, t + h)), derivAt(pc, Math.max(0, t - h)));
        const f = dot(sub(q, p), d1);
        const fp = dot(d1, d1) + dot(sub(q, p), mul(d2, 1 / (2 * h)));
        if (Math.abs(fp) < 1e-14) break;
        t = Math.max(0, Math.min(1, t - f / fp));
      }
      const q = evalAt(pc, t);
      return { t, point: q, d: dist(q, p) };
    }
  }
  return { t: 0, point: p, d: Infinity };
}

// ---------------------------------------------------------------- metszés
function lineLine(A, B, eps) {
  const r = sub(A.b, A.a), s = sub(B.b, B.a);
  const rxs = cross(r, s);
  const qp = sub(B.a, A.a);
  const Lr = len(r), Ls = len(s);
  if (Lr < eps || Ls < eps) return [];
  if (Math.abs(rxs) < 1e-12 * Lr * Ls) {
    // párhuzamos: kollineáris átfedés esetén végpontok
    if (Math.abs(cross(qp, r)) / Lr > eps) return [];
    const out = [];
    const tOnA = (p) => dot(sub(p, A.a), r) / (Lr * Lr);
    const tOnB = (p) => dot(sub(p, B.a), s) / (Ls * Ls);
    const eA = eps / Lr, eB = eps / Ls;
    for (const p of [B.a, B.b]) { const t = tOnA(p); if (t > -eA && t < 1 + eA) out.push({ ta: clamp01(t), tb: tOnB(p) > 0.5 ? 1 : 0, p }); }
    for (const p of [A.a, A.b]) { const t = tOnB(p); if (t > -eB && t < 1 + eB) out.push({ ta: tOnA(p) > 0.5 ? 1 : 0, tb: clamp01(t), p }); }
    return out;
  }
  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;
  const eA = eps / Lr, eB = eps / Ls;
  if (t < -eA || t > 1 + eA || u < -eB || u > 1 + eB) return [];
  return [{ ta: clamp01(t), tb: clamp01(u), p: evalAt(A, clamp01(t)) }];
}

const clamp01 = (t) => Math.max(0, Math.min(1, t));

function lineCirc(L, C, eps, swap) {
  const d = sub(L.b, L.a), f = sub(L.a, C.c);
  const a = dot(d, d), b = 2 * dot(f, d), c = dot(f, f) - C.r * C.r;
  const Ld = Math.sqrt(a);
  if (Ld < eps) return [];
  let disc = b * b - 4 * a * c;
  const out = [];
  const tol = 2 * eps * C.r * 2 * a;
  if (disc < -tol) return [];
  const ts = disc <= tol ? [-b / (2 * a)] : [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
  const eL = eps / Ld;
  const epsA = eps / C.r;
  for (const t of ts) {
    if (t < -eL || t > 1 + eL) continue;
    const tt = clamp01(t);
    const p = evalAt(L, tt);
    const u = angleParam(C, angleOf(sub(p, C.c)), epsA);
    if (u === null) continue;
    out.push(swap ? { ta: u, tb: tt, p } : { ta: tt, tb: u, p });
  }
  return out;
}

function circCirc(A, B, eps) {
  const d = dist(A.c, B.c);
  const out = [];
  if (d < eps && Math.abs(A.r - B.r) < eps) {
    // azonos kör: ívek végpontjai a másikon
    const epsA = eps / A.r;
    const ends = (P) => (P.k === 'arc' ? [0, 1].map((t) => evalAt(P, t)) : []);
    for (const p of ends(B)) { const u = angleParam(A, angleOf(sub(p, A.c)), epsA); if (u !== null) out.push({ ta: u, tb: dist(p, evalAt(B, 0)) < dist(p, evalAt(B, 1)) ? 0 : 1, p }); }
    for (const p of ends(A)) { const u = angleParam(B, angleOf(sub(p, B.c)), epsA); if (u !== null) out.push({ ta: dist(p, evalAt(A, 0)) < dist(p, evalAt(A, 1)) ? 0 : 1, tb: u, p }); }
    return out;
  }
  if (d > A.r + B.r + eps || d < Math.abs(A.r - B.r) - eps || d < 1e-12) return [];
  const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
  const h2 = A.r * A.r - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ex = mul(sub(B.c, A.c), 1 / d);
  const pm = add(A.c, mul(ex, a));
  const pts = h < eps ? [pm] : [add(pm, mul(perp(ex), h)), sub(pm, mul(perp(ex), h))];
  const eA = eps / A.r, eB = eps / B.r;
  for (const p of pts) {
    const ta = angleParam(A, angleOf(sub(p, A.c)), eA);
    const tb = angleParam(B, angleOf(sub(p, B.c)), eB);
    if (ta !== null && tb !== null) out.push({ ta, tb, p });
  }
  return out;
}

/** Általános metszés lapítással + Newton-finomítással (Bézierhez). */
function generic(A, B, eps) {
  const fa = flatten(A, { minN: 24 }), fb = flatten(B, { minN: 24 });
  const out = [];
  for (let i = 0; i < fa.pts.length - 1; i++) {
    const la = { k: 'line', a: fa.pts[i], b: fa.pts[i + 1] };
    for (let j = 0; j < fb.pts.length - 1; j++) {
      const lb = { k: 'line', a: fb.pts[j], b: fb.pts[j + 1] };
      for (const x of lineLine(la, lb, eps * 10)) {
        let ta = fa.ts[i] + (fa.ts[i + 1] - fa.ts[i]) * x.ta;
        let tb = fb.ts[j] + (fb.ts[j + 1] - fb.ts[j]) * x.tb;
        // Newton
        for (let it = 0; it < 10; it++) {
          const F = sub(evalAt(A, ta), evalAt(B, tb));
          if (len(F) < 1e-10) break;
          const da = derivAt(A, ta), db = derivAt(B, tb);
          const det = -da[0] * db[1] + db[0] * da[1];
          if (Math.abs(det) < 1e-14) break;
          const dta = (-F[0] * -db[1] + db[0] * -F[1]) / det;
          const dtb = (da[0] * -F[1] - -F[0] * da[1]) / det;
          ta = clamp01(ta + dta); tb = clamp01(tb + dtb);
        }
        const p = evalAt(A, ta);
        if (dist(p, evalAt(B, tb)) > eps * 50) continue;
        if (!out.some((o) => dist(o.p, p) < eps * 20)) out.push({ ta, tb, p });
      }
    }
  }
  return out;
}

export function intersect(A, B, eps = 1e-6) {
  if (!bboxOverlap(bboxOf(A), bboxOf(B), eps * 10)) return [];
  const isC = (x) => x.k === 'arc' || x.k === 'circle';
  if (A.k === 'line' && B.k === 'line') return lineLine(A, B, eps);
  if (A.k === 'line' && isC(B)) return lineCirc(A, B, eps, false);
  if (isC(A) && B.k === 'line') return lineCirc(B, A, eps, true);
  if (isC(A) && isC(B)) return circCirc(A, B, eps);
  return generic(A, B, eps);
}

// ---------------------------------------------------------------- darabolás
export function subPiece(pc, t0, t1) {
  switch (pc.k) {
    case 'line': return { k: 'line', a: evalAt(pc, t0), b: evalAt(pc, t1) };
    case 'arc': { const s = pc.a1 - pc.a0; return { k: 'arc', c: pc.c, r: pc.r, a0: pc.a0 + s * t0, a1: pc.a0 + s * t1 }; }
    case 'circle': return { k: 'arc', c: pc.c, r: pc.r, a0: t0 * TAU, a1: t1 * TAU };
    case 'bez': return bezSub(pc.p, t0, t1);
  }
  return pc;
}

function bezSplit(p, t) {
  const [p0, p1, p2, p3] = p;
  const a = lerp2(p0, p1, t), b = lerp2(p1, p2, t), c = lerp2(p2, p3, t);
  const d = lerp2(a, b, t), e = lerp2(b, c, t), f = lerp2(d, e, t);
  return [[p0, a, d, f], [f, e, c, p3]];
}

function bezSub(p, t0, t1) {
  let q = p;
  if (t1 < 1) q = bezSplit(q, t1)[0];
  if (t0 > 0) q = bezSplit(q, t0 / t1)[1];
  return { k: 'bez', p: q };
}

/** Darab felosztása a megadott paramétereknél. */
export function splitPiece(pc, params, eps = 1e-9) {
  const L = Math.max(pieceLength(pc), 1e-9);
  const et = 1e-6 / L + eps;
  let ts = [...params].sort((a, b) => a - b);
  if (pc.k === 'circle') {
    ts = ts.map((t) => (t >= 1 - et ? 0 : t));
    ts = uniq(ts.sort((a, b) => a - b), et);
    if (!ts.length) return [pc];
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i], b = i + 1 < ts.length ? ts[i + 1] : ts[0] + 1;
      out.push({ k: 'arc', c: pc.c, r: pc.r, a0: a * TAU, a1: b * TAU });
    }
    return out;
  }
  ts = uniq(ts.filter((t) => t > et && t < 1 - et), et);
  if (!ts.length) return [pc];
  const bounds = [0, ...ts, 1];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) out.push(subPiece(pc, bounds[i], bounds[i + 1]));
  return out;
}

function uniq(ts, e) {
  const out = [];
  for (const t of ts) if (!out.length || t - out[out.length - 1] > e) out.push(t);
  return out;
}

export function reversePiece(pc) {
  switch (pc.k) {
    case 'line': return { k: 'line', a: pc.b, b: pc.a };
    case 'bez': return { k: 'bez', p: [...pc.p].reverse() };
  }
  return pc;
}

// ---------------------------------------------------------------- vázlat entitások -> darabok

/** Centripetális Catmull-Rom -> Bézier darabok. */
export function splineToBeziers(pts, closed = false, alpha = 0.5) {
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2 && !closed) {
    const [a, b] = pts;
    return [{ k: 'bez', p: [a, lerp2(a, b, 1 / 3), lerp2(a, b, 2 / 3), b] }];
  }
  const P = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return sub(mul(pts[0], 2), pts[1]);
    if (i >= n) return sub(mul(pts[n - 1], 2), pts[n - 2]);
    return pts[i];
  };
  const segs = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const d1 = Math.max(Math.pow(dist(p0, p1), alpha), 1e-9);
    const d2 = Math.max(Math.pow(dist(p1, p2), alpha), 1e-9);
    const d3 = Math.max(Math.pow(dist(p2, p3), alpha), 1e-9);
    const b1 = [
      (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
      (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
    ];
    const b2 = [
      (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
      (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
    ];
    segs.push({ k: 'bez', p: [p1, b1, b2, p2] });
  }
  return segs;
}

export function curvePieces(c) {
  switch (c.t) {
    case 'line': return dist(c.a, c.b) > 1e-9 ? [{ k: 'line', a: c.a, b: c.b }] : [];
    case 'circle': return c.r > 1e-9 ? [{ k: 'circle', c: c.c, r: c.r }] : [];
    case 'arc': return c.r > 1e-9 && c.a1 > c.a0 ? [{ k: 'arc', c: c.c, r: c.r, a0: c.a0, a1: c.a1 }] : [];
    case 'spline': return splineToBeziers(c.pts, !!c.closed);
    case 'ellipse': return ellipseBeziers(c);
    default: return [];
  }
}

/** Ellipszis 4 harmadfokú Bézierrel (hiba < 0,03%). */
export function ellipseBeziers(c) {
  const k = 0.5522847498;
  const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0);
  const T = (x, y) => [c.c[0] + x * cs - y * sn, c.c[1] + x * sn + y * cs];
  const { rx, ry } = c;
  const q = [
    [[rx, 0], [rx, k * ry], [k * rx, ry], [0, ry]],
    [[0, ry], [-k * rx, ry], [-rx, k * ry], [-rx, 0]],
    [[-rx, 0], [-rx, -k * ry], [-k * rx, -ry], [0, -ry]],
    [[0, -ry], [k * rx, -ry], [rx, -k * ry], [rx, 0]],
  ];
  return q.map((s) => ({ k: 'bez', p: s.map(([x, y]) => T(x, y)) }));
}

/** Görbe végpontjai (összekötéshez / illesztéshez). */
export function curveEnds(c) {
  switch (c.t) {
    case 'line': return [c.a, c.b];
    case 'arc': return [polar(c.c, c.r, c.a0), polar(c.c, c.r, c.a1)];
    case 'spline': return c.closed ? [] : [c.pts[0], c.pts[c.pts.length - 1]];
    default: return [];
  }
}

/** Nevezetes pontok (illesztéshez): végpontok, középpontok, felezőpontok. */
export function curveKeyPoints(c) {
  const out = [];
  switch (c.t) {
    case 'line': out.push({ p: c.a, kind: 'end' }, { p: c.b, kind: 'end' }, { p: lerp2(c.a, c.b, 0.5), kind: 'mid' }); break;
    case 'circle':
      out.push({ p: c.c, kind: 'center' });
      for (let i = 0; i < 4; i++) out.push({ p: polar(c.c, c.r, i * Math.PI / 2), kind: 'quad' });
      break;
    case 'arc':
      out.push({ p: c.c, kind: 'center' }, { p: polar(c.c, c.r, c.a0), kind: 'end' }, { p: polar(c.c, c.r, c.a1), kind: 'end' }, { p: polar(c.c, c.r, (c.a0 + c.a1) / 2), kind: 'mid' });
      break;
    case 'spline':
      c.pts.forEach((p, i) => out.push({ p, kind: (i === 0 || i === c.pts.length - 1) && !c.closed ? 'end' : 'ctrl' }));
      break;
    case 'point': out.push({ p: c.p, kind: 'point' }); break;
    case 'ellipse': {
      const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0);
      out.push({ p: c.c, kind: 'center' });
      for (const [x, y] of [[c.rx, 0], [0, c.ry], [-c.rx, 0], [0, -c.ry]]) out.push({ p: [c.c[0] + x * cs - y * sn, c.c[1] + x * sn + y * cs], kind: 'quad' });
      break;
    }
  }
  return out;
}

/** Görbe lapított megjelenítési pontsora. */
export function curvePolyline(c) {
  if (c.t === 'point') return [c.p];
  const pcs = curvePieces(c);
  const out = [];
  for (const pc of pcs) {
    const { pts } = flatten(pc, { minN: pc.k === 'bez' ? 20 : 1 });
    if (out.length) pts.shift();
    out.push(...pts);
  }
  return out;
}

/** Görbe és pont távolsága. */
export function curveDistance(c, p) {
  if (c.t === 'point') return { d: dist(c.p, p), point: c.p, t: 0 };
  let best = { d: Infinity };
  for (const pc of curvePieces(c)) { const r = closest(pc, p); if (r.d < best.d) best = r; }
  return best;
}
