// Szabadkézi rajzolás (Apple Pencil) alakfelismeréssel
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { toLocal, toWorld, planeFromJSON, samePlane } from './manager.js';
import { dist, sub, add, mul, len, norm, angleOf, curvePolyline, curveKeyPoints, TAU } from './geom2d.js';
import { snap } from './snap.js';
import { pointInPoly } from './regions.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class FreehandCapture {
  constructor(app, ev) {
    this.app = app;
    const { frame } = app.sketchFrameAt(ev);
    // meglévő vázlat keretének átvétele (pontos koordináták)
    let f = frame;
    for (const s of app.doc.state.sketches) {
      if (app.doc.isHidden(s.id)) continue;
      const sf = planeFromJSON(s.plane);
      if (samePlane(sf, frame)) { f = sf; break; }
    }
    this.frame = f;
    this.pts = [];
    this.screen = [];
    this.line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 2.2, worldUnits: false, depthTest: false, transparent: true, opacity: 0.9 }));
    this.line.renderOrder = 25;
    this.line.material.resolution.set(app.vp.width, app.vp.height);
    app.vp.overlayScene.add(this.line);
    this.add(ev);
  }

  add(ev) {
    const p = this.app.vp.rayPlane(ev.x, ev.y, this.frame.origin, this.frame.normal);
    if (!p) return;
    const uv = toLocal(this.frame, p);
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, uv) < 1e-9) return;
    this.pts.push(uv);
    this.screen.push([ev.x, ev.y]);
    if (this.pts.length >= 2) {
      const arr = [];
      for (let i = 0; i < this.pts.length - 1; i++) {
        const a = toWorld(this.frame, this.pts[i]), b = toWorld(this.frame, this.pts[i + 1]);
        arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      this.line.geometry.dispose();
      this.line.geometry = new LineSegmentsGeometry();
      this.line.geometry.setPositions(arr);
      this.app.vp.requestRender();
    }
  }

  move(ev) {
    const co = ev.original && ev.original.getCoalescedEvents ? ev.original.getCoalescedEvents() : null;
    if (co && co.length > 1) {
      const rect = this.app.vp.rect;
      for (const c of co) this.add({ x: c.clientX - rect.left, y: c.clientY - rect.top });
    } else this.add(ev);
  }

  longEnough() {
    let L = 0;
    for (let i = 1; i < this.screen.length; i++) L += dist(this.screen[i], this.screen[i - 1]);
    return L > 14;
  }

  cancel() {
    this.app.vp.overlayScene.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.app.vp.requestRender();
  }

  finish(ev) {
    this.add(ev);
    this.cancel();
    if (this.pts.length < 3) return;
    const wpp = this.app.vp.worldPerPixel(toWorld(this.frame, this.pts[0]));
    const res = recognize(this.pts, wpp);
    if (!res) return;
    if (res.scribble) { this.eraseUnder(res.poly, wpp); return; }
    const curves = postProcess(this.app, this.frame, res.curves, wpp);
    if (!curves.length) return;
    const names = { line: 'Vonal', circle: 'Kör', arc: 'Ív', spline: 'Spline' };
    const label = res.label || names[curves[0].t] || 'Vázlat';
    this.app.addCurves(this.frame, curves, label, 'freehand');
  }

  /** Firkálás: a firka által érintett görbék törlése. */
  eraseUnder(poly, wpp) {
    const app = this.app;
    const tol = 10 * wpp;
    for (const s of app.doc.state.sketches) {
      if (app.doc.isHidden(s.id)) continue;
      const f = planeFromJSON(s.plane);
      if (!samePlane(f, this.frame)) continue;
      const conv = (p) => toLocal(f, toWorld(this.frame, p));
      const P = poly.map(conv);
      const hull = convexHull(P);
      const hit = s.curves.filter((c) => {
        const pl = curvePolyline(c);
        let inside = 0;
        for (const q of pl) if (pointInPoly(q, hull) || P.some((x) => dist(x, q) < tol)) inside++;
        return inside / pl.length > 0.35 || (pl.length <= 2 && inside > 0);
      });
      if (hit.length) {
        const ids = new Set(hit.map((c) => c.id));
        app.updateSketch(s.id, (sk) => ({ ...sk, curves: sk.curves.filter((c) => !ids.has(c.id)) }), 'Törlés (firka)', 'trash');
        app.ui.toast(`${hit.length} görbe törölve`, '', 1300);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------- felismerés
function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i], P[i - 1]); return L; }

function resample(P, n) {
  const L = pathLen(P);
  if (L === 0) return [P[0]];
  const step = L / (n - 1);
  const out = [P[0]];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let a = P[i - 1];
    const b = P[i];
    let d = dist(a, b);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(q);
      a = q; d = dist(a, b); acc = 0;
    }
    acc += d;
  }
  while (out.length < n) out.push(P[P.length - 1]);
  return out;
}

function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
}

/** Kåsa kör-illesztés */
export function fitCircle(P) {
  let sx = 0, sy = 0;
  for (const p of P) { sx += p[0]; sy += p[1]; }
  const mx = sx / P.length, my = sy / P.length;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of P) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; suv += u * v; svv += v * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const c = [uc + mx, vc + my];
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / P.length);
  let e = 0;
  for (const p of P) e += (dist(p, c) - r) ** 2;
  return { c, r, rms: Math.sqrt(e / P.length) };
}

function rdp(P, eps) {
  if (P.length < 3) return P.slice();
  const a = P[0], b = P[P.length - 1];
  let idx = -1, dmax = 0;
  const ab = sub(b, a), L = len(ab);
  for (let i = 1; i < P.length - 1; i++) {
    const d = L > 1e-12 ? Math.abs((P[i][0] - a[0]) * ab[1] - (P[i][1] - a[1]) * ab[0]) / L : dist(P[i], a);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = rdp(P.slice(0, idx + 1), eps), r = rdp(P.slice(idx), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [a, b];
}

function segDist(p, a, b) {
  const ab = sub(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1];
  let t = L2 > 0 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

function polyError(P, V2, closed) {
  let e = 0;
  const segs = closed ? V2.length : V2.length - 1;
  for (const p of P) {
    let m = Infinity;
    for (let i = 0; i < segs; i++) m = Math.min(m, segDist(p, V2[i], V2[(i + 1) % V2.length]));
    e = Math.max(e, m);
  }
  return e;
}

function reversals(P) {
  let n = 0, prev = null;
  for (let i = 2; i < P.length; i++) {
    const d1 = sub(P[i - 1], P[i - 2]), d2 = sub(P[i], P[i - 1]);
    if (len(d1) < 1e-12 || len(d2) < 1e-12) continue;
    const c = (d1[0] * d2[0] + d1[1] * d2[1]) / (len(d1) * len(d2));
    if (c < -0.3) { n++; }
    prev = c;
  }
  return n;
}

function turnAngle(a, b, c) {
  const d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
  return Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
}

/** A felismerés magja. P: síkpontok, wpp: világegység/pixel */
export function recognize(raw, wpp) {
  const L0 = pathLen(raw);
  if (L0 < wpp * 10) return null;
  const P = resample(raw, Math.max(24, Math.min(160, Math.round(L0 / (wpp * 3)))));
  const bb = bbox(P);
  const L = pathLen(P);
  // firka
  const coarse = resample(raw, 40);
  if (L / Math.max(bb.diag, 1e-9) > 3.2 && reversals(coarse) >= 4) return { scribble: true, poly: P };

  const closeTol = Math.max(0.2 * bb.diag, wpp * 26);
  const closed = dist(P[0], P[P.length - 1]) < closeTol && L > bb.diag * 1.8;

  if (closed) {
    const Q = P.slice(0, -1);
    const cf = fitCircle(Q);
    const aspect = Math.min(bb.w, bb.h) / Math.max(bb.w, bb.h);
    if (cf && cf.rms / cf.r < 0.075 && aspect > 0.72) {
      return { curves: [{ t: 'circle', c: cf.c, r: cf.r }], label: 'Kör' };
    }
    // sokszög
    let poly = rdp([...Q, Q[0]], 0.075 * bb.diag);
    poly = poly.slice(0, -1);
    poly = mergeClose(poly, 0.12 * bb.diag);
    if (poly.length >= 3 && poly.length <= 8) {
      const err = polyError(Q, poly, true);
      if (err < 0.07 * bb.diag) {
        if (poly.length === 4) {
          const angs = poly.map((p, i) => turnAngle(poly[(i + 3) % 4], p, poly[(i + 1) % 4]));
          if (angs.every((a) => Math.abs(a - Math.PI / 2) < 0.35)) return { curves: rectFrom(poly), label: 'Téglalap' };
        }
        const lines = [];
        for (let i = 0; i < poly.length; i++) lines.push({ t: 'line', a: poly[i], b: poly[(i + 1) % poly.length] });
        return { curves: lines, label: poly.length === 3 ? 'Háromszög' : 'Sokszög' };
      }
    }
    // ellipszis (tengelyekkel)
    const el = fitEllipsePCA(Q);
    if (el && el.err < 0.06 * Math.max(el.rx, el.ry)) return { curves: [{ t: 'ellipse', c: el.c, rx: el.rx, ry: el.ry, rot: el.rot }], label: 'Ellipszis' };
    // zárt spline
    const sp = rdp([...Q, Q[0]], 0.02 * bb.diag).slice(0, -1);
    return { curves: [{ t: 'spline', pts: limitPts(sp, 14), closed: true }], label: 'Spline' };
  }

  // nyitott
  const a = P[0], b = P[P.length - 1];
  const chord = dist(a, b);
  let dev = 0;
  for (const p of P) dev = Math.max(dev, segDist(p, a, b));
  if (dev < Math.max(0.045 * L, wpp * 4) && chord > 0.85 * L) return { curves: [{ t: 'line', a, b }], label: 'Vonal' };

  // sokszögvonal éles sarkokkal
  const pl = mergeClose(rdp(P, Math.max(0.06 * L / Math.max(1, Math.log2(L / (wpp * 40) + 1)), wpp * 5)), wpp * 12);
  if (pl.length >= 3 && pl.length <= 8) {
    const err = polyError(P, pl, false);
    const sharp = pl.slice(1, -1).every((p, i) => turnAngle(pl[i], p, pl[i + 2]) > 0.5);
    if (err < Math.max(0.035 * L, wpp * 5) && sharp) {
      const lines = [];
      for (let i = 0; i < pl.length - 1; i++) lines.push({ t: 'line', a: pl[i], b: pl[i + 1] });
      return { curves: lines, label: 'Vonallánc' };
    }
  }

  // ív
  const cf = fitCircle(P);
  if (cf && cf.rms / cf.r < 0.05 && cf.r < L * 4) {
    const mid = P[Math.floor(P.length / 2)];
    // a köríven lévő pontokra vetítés
    const proj = (p) => add(cf.c, mul(norm(sub(p, cf.c)), cf.r));
    const A = proj(a), M = proj(mid), B = proj(b);
    const arc = arcFrom3(A, M, B);
    if (arc && arc.a1 - arc.a0 < TAU * 0.92) return { curves: [arc], label: 'Ív' };
  }
  // spline
  const sp = rdp(P, 0.012 * L);
  return { curves: [{ t: 'spline', pts: limitPts(sp, 14), closed: false }], label: 'Spline' };
}

function limitPts(P, max) {
  if (P.length <= max) return P;
  const out = [];
  for (let i = 0; i < max; i++) out.push(P[Math.round((i * (P.length - 1)) / (max - 1))]);
  return out;
}

function mergeClose(P, tol) {
  const out = [];
  for (const p of P) if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p);
  return out;
}

/** Téglalap a 4 felismert sarokból (derékszögűre igazítva). */
function rectFrom(poly) {
  // fő irány: az oldalak irányának átlaga (90° modulus)
  let sx = 0, sy = 0;
  for (let i = 0; i < 4; i++) {
    const d = sub(poly[(i + 1) % 4], poly[i]);
    const a = angleOf(d) * 4;
    sx += Math.cos(a) * len(d); sy += Math.sin(a) * len(d);
  }
  let ang = Math.atan2(sy, sx) / 4;
  if (Math.abs(ang) < 0.1) ang = 0; // tengelyirányú, ha közel van
  const ux = [Math.cos(ang), Math.sin(ang)], uy = [-Math.sin(ang), Math.cos(ang)];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of poly) {
    const u = p[0] * ux[0] + p[1] * ux[1], v = p[0] * uy[0] + p[1] * uy[1];
    x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  const P = (u, v) => [u * ux[0] + v * uy[0], u * ux[1] + v * uy[1]];
  const c = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  return c.map((p, i) => ({ t: 'line', a: p, b: c[(i + 1) % 4] }));
}

export function arcFrom3(A, M, B) {
  const ax = A[0], ay = A[1], bx = M[0], by = M[1], cx = B[0], cy = B[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const c = [ux, uy];
  const r = dist(c, A);
  let a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  // CCW A->B átmegy-e M-en?
  const norm2 = (x) => { x %= TAU; return x < 0 ? x + TAU : x; };
  const sM = norm2(am - a0), sB = norm2(a1 - a0);
  if (sM < sB) return { t: 'arc', c, r, a0, a1: a0 + sB };
  // különben B->A CCW
  return { t: 'arc', c, r, a0: a1, a1: a1 + norm2(a0 - a1) };
}

function fitEllipsePCA(P) {
  let mx = 0, my = 0;
  for (const p of P) { mx += p[0]; my += p[1]; }
  mx /= P.length; my /= P.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of P) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; sxy += x * y; syy += y * y; }
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = [Math.cos(rot), Math.sin(rot)], uy = [-Math.sin(rot), Math.cos(rot)];
  let rx = 0, ry = 0;
  for (const p of P) { const x = p[0] - mx, y = p[1] - my; rx = Math.max(rx, Math.abs(x * ux[0] + y * ux[1])); ry = Math.max(ry, Math.abs(x * uy[0] + y * uy[1])); }
  if (rx < 1e-9 || ry < 1e-9) return null;
  let err = 0;
  for (const p of P) {
    const x = p[0] - mx, y = p[1] - my;
    const u = x * ux[0] + y * ux[1], v = x * uy[0] + y * uy[1];
    const k = Math.sqrt((u * u) / (rx * rx) + (v * v) / (ry * ry));
    err = Math.max(err, Math.abs(1 - k) * Math.max(rx, ry));
  }
  let r2 = rot;
  if (Math.abs(r2) < 0.08) r2 = 0;
  return { c: [mx, my], rx, ry, rot: r2, err };
}

function convexHull(P) {
  const pts = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------- utófeldolgozás: illesztés, kerekítés
function niceRound(x, step) { return Math.round(x / step) * step; }

function postProcess(app, frame, curves, wpp) {
  const ev = { pointerType: 'pen' };
  const step = Math.max(1e-3, (app.vp.gridSpacing || 1) / 10);
  const snapP = (p) => snap(app, frame, p, ev, { noCurves: false }).p;
  return curves.map((c) => {
    if (c.t === 'line') {
      let a = snapP(c.a), b = snapP(c.b);
      // vízszintes / függőleges
      const d = sub(b, a);
      const ang = Math.abs(Math.atan2(d[1], d[0]));
      if (Math.abs(ang) < 0.07 || Math.abs(ang - Math.PI) < 0.07) b = [b[0], a[1]];
      else if (Math.abs(ang - Math.PI / 2) < 0.07) b = [a[0], b[1]];
      return { ...c, a, b };
    }
    if (c.t === 'circle') {
      const s = snap(app, frame, c.c, ev, { noCurves: true });
      return { ...c, c: s.kind && s.kind !== 'grid' ? s.p : c.c, r: niceRound(c.r, step) || c.r };
    }
    if (c.t === 'arc') {
      const A = snapP([c.c[0] + c.r * Math.cos(c.a0), c.c[1] + c.r * Math.sin(c.a0)]);
      const B = snapP([c.c[0] + c.r * Math.cos(c.a1), c.c[1] + c.r * Math.sin(c.a1)]);
      const M = [c.c[0] + c.r * Math.cos((c.a0 + c.a1) / 2), c.c[1] + c.r * Math.sin((c.a0 + c.a1) / 2)];
      return arcFrom3(A, M, B) || c;
    }
    if (c.t === 'spline' && !c.closed) {
      const pts = c.pts.slice();
      pts[0] = snapP(pts[0]);
      pts[pts.length - 1] = snapP(pts[pts.length - 1]);
      return { ...c, pts };
    }
    return c;
  });
}

export { convexHull };
