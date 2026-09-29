// Illesztés vázlatrajzoláskor: nevezetes pontok, görbék, testcsúcsok, igazítás, rács
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { curveKeyPoints, curveDistance, dist } from './geom2d.js';
import { toLocal, toWorld, samePlane, planeFromJSON } from './manager.js';
import { pickTolerance } from '../view/picking.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Illesztés. frame: vázlatkeret, uv: nyers síkpont, ev: pointer esemény
 * opts: { from: [u,v] (előző pont: V/F igazításhoz), extra: [{p, kind}], exclude: [[u,v]], noCurves }
 * return: { p, kind, guides: [[uvA, uvB]] }
 */
export function snap(app, frame, uv, ev, opts = {}) {
  const s = app.settings;
  const world = toWorld(frame, uv);
  const wpp = app.vp.worldPerPixel(world);
  const tol = pickTolerance(ev ? ev.pointerType : 'mouse') * 1.25 * wpp;
  const res = { p: uv, kind: null, guides: [] };
  if (!s.snapping) return res;
  const excluded = (p) => (opts.exclude || []).some((q) => dist(p, q) < 1e-9);

  // 1) nevezetes pontok (vázlatok ezen a síkon + extra + testcsúcsok a síkon)
  const pts = [];
  const curvesOnPlane = [];
  for (const sk of app.doc.state.sketches) {
    if (app.doc.isHidden(sk.id)) continue;
    const f = planeFromJSON(sk.plane);
    if (!samePlane(f, frame)) continue;
    const same = f.origin.distanceTo(frame.origin) < 1e-9 && f.xDir.distanceTo(frame.xDir) < 1e-9;
    const conv = same ? (p) => p : (p) => toLocal(frame, toWorld(f, p));
    for (const c of sk.curves) {
      for (const kp of curveKeyPoints(c)) pts.push({ p: conv(kp.p), kind: kp.kind });
      if (same) curvesOnPlane.push(c);
    }
  }
  for (const e of opts.extra || []) pts.push(e);
  // világ origó
  const o = toLocal(frame, V());
  if (Math.abs(frame.normal.dot(frame.origin)) < 1e-6) pts.push({ p: o, kind: 'origin' });
  // test csúcsok és körközéppontok a síkon
  for (const g of app.bodies.gfx.values()) {
    if (!g.group.visible) continue;
    const P = g.data.points;
    if (P) {
      for (let i = 0; i < P.length; i += 3) {
        const w = V(P[i], P[i + 1], P[i + 2]);
        const d = Math.abs(frame.normal.dot(w.clone().sub(frame.origin)));
        if (d < 1e-3) pts.push({ p: toLocal(frame, w), kind: 'vertex' });
      }
    }
    for (const e of g.data.edges || []) {
      if (e.type === 'CIRCLE' && e.center) {
        const w = V(...e.center);
        if (Math.abs(frame.normal.dot(w.clone().sub(frame.origin))) < 1e-3) pts.push({ p: toLocal(frame, w), kind: 'center' });
      }
      if (e.type === 'LINE' && e.mid) {
        const w = V(...e.mid);
        if (Math.abs(frame.normal.dot(w.clone().sub(frame.origin))) < 1e-3) pts.push({ p: toLocal(frame, w), kind: 'mid' });
      }
    }
  }
  let best = null;
  for (const c of pts) {
    if (excluded(c.p)) continue;
    const d = dist(c.p, uv);
    const pri = c.kind === 'end' || c.kind === 'vertex' || c.kind === 'point' ? 0 : c.kind === 'center' || c.kind === 'origin' ? 0.1 : 0.25;
    const score = d / tol + pri;
    if (d < tol && (!best || score < best.score)) best = { ...c, score };
  }
  if (best) return { p: best.p, kind: best.kind, guides: [] };

  // 2) V/F igazítás az előző ponthoz, illetve más pontokhoz
  let p = uv.slice();
  let aligned = false;
  const guides = [];
  if (opts.from) {
    const d = [uv[0] - opts.from[0], uv[1] - opts.from[1]];
    if (Math.abs(d[1]) < tol * 0.8 && Math.abs(d[0]) > tol) { p[1] = opts.from[1]; aligned = true; guides.push([opts.from, [p[0], p[1]]]); }
    else if (Math.abs(d[0]) < tol * 0.8 && Math.abs(d[1]) > tol) { p[0] = opts.from[0]; aligned = true; guides.push([opts.from, [p[0], p[1]]]); }
  }
  // igazítás más nevezetes pontok vízszintesére/függőlegesére
  let ax = null, ay = null;
  for (const c of pts) {
    if (excluded(c.p)) continue;
    if (Math.abs(c.p[0] - p[0]) < tol * 0.6 && (!ax || Math.abs(c.p[0] - p[0]) < Math.abs(ax.p[0] - p[0]))) ax = c;
    if (Math.abs(c.p[1] - p[1]) < tol * 0.6 && (!ay || Math.abs(c.p[1] - p[1]) < Math.abs(ay.p[1] - p[1]))) ay = c;
  }
  if (ax && !(aligned && p[0] === opts.from[0])) { p[0] = ax.p[0]; guides.push([ax.p, [p[0], p[1]]]); aligned = true; }
  if (ay && !(aligned && p[1] === (opts.from && opts.from[1]))) { p[1] = ay.p[1]; guides.push([ay.p, [p[0], p[1]]]); aligned = true; }

  // 3) görbére illesztés
  if (!aligned && !opts.noCurves) {
    let bc = null;
    for (const c of curvesOnPlane) {
      const r = curveDistance(c, uv);
      if (r.d < tol * 0.8 && (!bc || r.d < bc.d)) bc = r;
    }
    if (bc) return { p: bc.point, kind: 'curve', guides: [] };
  }
  if (aligned) return { p, kind: 'align', guides };

  // 4) rács
  if (s.gridSnap) {
    const g = app.vp.gridSpacing || 1;
    // a rács a világ origójához igazodik
    const oo = toLocal(frame, V());
    const q = [Math.round((uv[0] - oo[0]) / g) * g + oo[0], Math.round((uv[1] - oo[1]) / g) * g + oo[1]];
    if (dist(q, uv) < tol * 0.9) return { p: q, kind: 'grid', guides: [] };
  }
  return res;
}

/** Illesztési jelző (kör a ponton + szaggatott segédvonalak). */
export class SnapViz {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffd60a, depthTest: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = 30;
    const g = new LineSegmentsGeometry();
    this.guides = new LineSegments2(g, new LineMaterial({ color: 0xffd60a, linewidth: 1.2, dashed: true, dashSize: 3, gapSize: 3, depthTest: false, transparent: true, opacity: 0.8, worldUnits: false }));
    this.guides.renderOrder = 29;
    this.group.add(this.ring, this.guides);
    this.group.visible = false;
    app.vp.overlayScene.add(this.group);
    this._onRender = app.vp.on('beforeRender', () => this._scale());
  }

  show(frame, res) {
    if (!res || !res.kind) { this.hide(); return; }
    this.frame = frame;
    this.world = toWorld(frame, res.p);
    this.ring.position.copy(this.world);
    this.ring.quaternion.copy(this.app.vp.camera.quaternion);
    const col = res.kind === 'grid' ? 0x9aa0b8 : res.kind === 'curve' ? 0x8fd9ff : 0xffd60a;
    this.ring.material.color.set(col);
    if (res.guides && res.guides.length) {
      const arr = [];
      for (const [a, b] of res.guides) { const A = toWorld(frame, a), B = toWorld(frame, b); arr.push(A.x, A.y, A.z, B.x, B.y, B.z); }
      this.guides.geometry.dispose();
      this.guides.geometry = new LineSegmentsGeometry();
      this.guides.geometry.setPositions(arr);
      this.guides.computeLineDistances();
      this.guides.material.resolution.set(this.app.vp.width, this.app.vp.height);
      this.guides.visible = true;
    } else this.guides.visible = false;
    this.group.visible = true;
    this.app.vp.requestRender();
  }

  _scale() {
    if (!this.group.visible || !this.world) return;
    this.ring.scale.setScalar(this.app.vp.worldPerPixel(this.world) * 7);
    this.ring.quaternion.copy(this.app.vp.camera.quaternion);
  }

  hide() { if (this.group.visible) { this.group.visible = false; this.app.vp.requestRender(); } }

  dispose() {
    this.app.vp.overlayScene.remove(this.group);
    this._onRender && this._onRender();
    this.ring.geometry.dispose(); this.ring.material.dispose();
    this.guides.geometry.dispose(); this.guides.material.dispose();
  }
}
