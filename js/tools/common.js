// Eszközök közös segédfüggvényei
import * as THREE from 'three';
import { planeFromJSON, toWorld, canonicalFrame } from '../sketch/manager.js';
import { pickTolerance } from '../view/picking.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function faceInfo(app, bodyId, index) {
  const g = app.bodies.gfx.get(bodyId);
  return g && g.data.faces ? g.data.faces[index] : null;
}

export function edgeInfo(app, bodyId, index) {
  const g = app.bodies.gfx.get(bodyId);
  return g && g.data.edges ? g.data.edges[index] : null;
}

/**
 * Profilok (régiók és sík lapok) a kijelölésből.
 * return: [{ profile, center: Vector3, normal: Vector3, sketchId?, bodyId?, frame }]
 */
export function profilesFromSelection(app, sel = app.sel) {
  const out = [];
  for (const s of sel) {
    if (s.type === 'region') {
      const prof = app.sketches.regionProfile(s.sketchId, s.key);
      const reg = app.sketches.regionByKey(s.sketchId, s.key);
      if (!prof || !reg) continue;
      const f = planeFromJSON(prof.plane);
      out.push({ profile: prof, center: toWorld(f, reg.centroid), normal: f.normal.clone(), sketchId: s.sketchId, frame: f, area: reg.area });
    } else if (s.type === 'face') {
      const fi = faceInfo(app, s.bodyId, s.index);
      if (!fi || fi.type !== 'PLANE' || !fi.normal) continue;
      const b = app.doc.body(s.bodyId);
      out.push({ profile: { kind: 'face', body: { id: b.id, rev: b.rev }, face: s.index }, center: V3(fi.center), normal: V3(fi.normal), bodyId: s.bodyId, frame: canonicalFrame(V3(fi.normal), V3(fi.center)), area: fi.area });
    }
  }
  return out;
}

/**
 * Melyik testen fekszik egy vázlatrégió? Rövid sugárral vizsgáljuk a sík két oldalát.
 * return: { bodyId, side: +1 (a test a normálissal ellentétes oldalon: a régió a test "tetején") | -1 }
 */
export function bodyUnderPoint(app, p, n) {
  const eps = Math.max(1e-3, app.vp.sceneRadius * 1e-5);
  const meshes = [];
  for (const g of app.bodies.gfx.values()) if (g.group.visible) meshes.push(g.mesh);
  for (const side of [1, -1]) {
    const origin = p.clone().addScaledVector(n, side * eps * 4);
    const dir = n.clone().multiplyScalar(-side);
    const rc = new THREE.Raycaster(origin, dir, 0, eps * 8);
    const hits = rc.intersectObjects(meshes, false);
    if (hits.length) return { bodyId: hits[0].object.userData.bodyId, side };
  }
  return null;
}

/** Tengely menti illesztés: rács lépésköz és más testcsúcsok szintje. */
export function axisSnapper(app, origin, dir, exclude = new Set()) {
  const levels = [];
  for (const g of app.bodies.gfx.values()) {
    if (!g.group.visible || exclude.has(g.id)) continue;
    const P = g.data.points;
    if (!P) continue;
    for (let i = 0; i < P.length; i += 3) {
      const d = (P[i] - origin.x) * dir.x + (P[i + 1] - origin.y) * dir.y + (P[i + 2] - origin.z) * dir.z;
      if (Math.abs(d) > 1e-6) levels.push(d);
    }
  }
  return (v, ev) => {
    if (!app.settings.snapping) return v;
    const tip = origin.clone().addScaledVector(dir, v);
    const wpp = app.vp.worldPerPixel(tip);
    const tol = pickTolerance(ev ? ev.pointerType : 'mouse') * 0.7 * wpp;
    let best = null;
    for (const l of levels) if (Math.abs(l - v) < tol && (!best || Math.abs(l - v) < Math.abs(best - v))) best = l;
    if (best != null) return best;
    const step = app.vp.gridSpacing || 1;
    const r = Math.round(v / step) * step;
    return Math.abs(r - v) < tol ? r : v;
  };
}

/** A kijelölt testek azonosítói (lap/él kijelölésből a tulajdonos test). */
export function selectedBodyIds(app, sel = app.sel) {
  return [...new Set(sel.filter((s) => s.bodyId).map((s) => s.bodyId))];
}

export function bodiesBox(app, ids) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const g = app.bodies.gfx.get(id);
    if (g) box.union(g.bbox);
  }
  return box;
}

export function visibleBodyRefs(app, except = []) {
  return app.doc.state.bodies
    .filter((b) => !app.doc.isHidden(b.id) && !except.includes(b.id))
    .map((b) => ({ id: b.id, rev: b.rev }));
}

/** Síkválasztó: kijelölt sík lap / szerkesztősík / fő sík. return { origin, normal } */
export function planeFromSel(app, s) {
  if (!s) return null;
  if (s.type === 'face') {
    const fi = faceInfo(app, s.bodyId, s.index);
    if (fi && fi.type === 'PLANE') return { origin: V3(fi.center), normal: V3(fi.normal), label: 'Lap' };
  }
  if (s.type === 'plane') {
    const p = app.doc.plane(s.planeId);
    if (p) { const f = planeFromJSON(p); return { origin: f.origin, normal: f.normal, label: p.name }; }
  }
  if (s.type === 'region' || s.type === 'sketch' || s.type === 'curve') {
    const sk = app.doc.sketch(s.sketchId);
    if (sk) { const f = planeFromJSON(sk.plane); return { origin: f.origin, normal: f.normal, label: sk.name }; }
  }
  return null;
}

export const MAIN_PLANES = {
  XY: { normal: V(0, 0, 1), label: 'XY' },
  XZ: { normal: V(0, 1, 0), label: 'XZ' },
  YZ: { normal: V(1, 0, 0), label: 'YZ' },
};

/** Tengely egy kijelölt elemből: egyenes él, körél, hengeres lap, vázlatvonal. */
export function axisFromItem(app, s) {
  if (!s) return null;
  if (s.type === 'edge') {
    const e = edgeInfo(app, s.bodyId, s.index);
    if (!e) return null;
    if (e.type === 'LINE') return { origin: V3(e.a), dir: V3(e.dir), label: 'Él' };
    if (e.type === 'CIRCLE') return { origin: V3(e.center), dir: V3(e.normal), label: 'Kör tengelye' };
  }
  if (s.type === 'face') {
    const f = faceInfo(app, s.bodyId, s.index);
    if (f && f.axisOrigin) return { origin: V3(f.axisOrigin), dir: V3(f.axisDir), label: 'Lap tengelye' };
  }
  if (s.type === 'curve') {
    const sk = app.doc.sketch(s.sketchId);
    const c = sk && sk.curves.find((x) => x.id === s.curveId);
    if (!c) return null;
    const f = planeFromJSON(sk.plane);
    if (c.t === 'line') {
      const a = toWorld(f, c.a), b = toWorld(f, c.b);
      return { origin: a, dir: b.clone().sub(a).normalize(), label: 'Vázlatvonal' };
    }
    if (c.t === 'circle' || c.t === 'arc') return { origin: toWorld(f, c.c), dir: f.normal.clone(), label: 'Kör tengelye' };
  }
  return null;
}

export function refOf(app, bodyId) {
  const b = app.doc.body(bodyId);
  return b ? { id: b.id, rev: b.rev } : null;
}
