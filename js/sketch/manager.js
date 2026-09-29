// Vázlatok: síkkezelés, megjelenítés, régiók és kiválasztás
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { computeRegions, pointInRegion } from './regions.js';
import { curvePolyline, curveDistance, curveKeyPoints, curveEnds, dist } from './geom2d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COL = {
  curve: new THREE.Color('#f1f2f8'),
  construct: new THREE.Color('#8fb3c9'),
  sel: new THREE.Color('#2bb8f0'),
  hover: new THREE.Color('#8fd9ff'),
  region: new THREE.Color('#6c8ff0'),
};

// ---------------------------------------------------------------- sík segédek
export function canonicalFrame(normal, point) {
  const n = normal.clone().normalize();
  let x;
  if (Math.abs(n.z) > 0.9) x = V(1, 0, 0).addScaledVector(n, -n.x).normalize();
  else x = V(0, 0, 1).cross(n).normalize();
  const y = n.clone().cross(x).normalize();
  const origin = n.clone().multiplyScalar(n.dot(point));
  return { origin, xDir: x, yDir: y, normal: n };
}

export const planeToJSON = (f) => ({ origin: f.origin.toArray(), xDir: f.xDir.toArray(), yDir: f.yDir.toArray(), normal: f.normal.toArray() });
export const planeFromJSON = (p) => ({ origin: V(...p.origin), xDir: V(...p.xDir), yDir: V(...p.yDir), normal: V(...p.normal) });

export function toLocal(frame, p) {
  const d = p.clone().sub(frame.origin);
  return [d.dot(frame.xDir), d.dot(frame.yDir)];
}

export function toWorld(frame, uv) {
  return frame.origin.clone().addScaledVector(frame.xDir, uv[0]).addScaledVector(frame.yDir, uv[1]);
}

export function samePlane(a, b, tol = 1e-4) {
  const dotn = a.normal.dot(b.normal);
  if (Math.abs(Math.abs(dotn) - 1) > 1e-6) return false;
  return Math.abs(a.normal.dot(b.origin.clone().sub(a.origin))) < tol;
}

export function frameMatrix(f) {
  const m = new THREE.Matrix4().makeBasis(f.xDir, f.yDir, f.normal);
  m.setPosition(f.origin);
  return m;
}

// ---------------------------------------------------------------- vonal segéd
function makeLines(width, color, opts = {}) {
  const g = new LineSegmentsGeometry();
  const m = new LineMaterial({ color, linewidth: width, worldUnits: false, transparent: true, opacity: opts.opacity ?? 1, dashed: !!opts.dashed, dashSize: 1, gapSize: 1, depthTest: opts.depthTest ?? true });
  m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -6;
  const l = new LineSegments2(g, m);
  l.raycast = () => {};
  l.renderOrder = 6;
  return l;
}

function setLinePositions(line, polylines) {
  const arr = [];
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) arr.push(pl[i][0], pl[i][1], 0, pl[i + 1][0], pl[i + 1][1], 0);
  }
  line.visible = arr.length > 0;
  if (!arr.length) return;
  line.geometry.dispose();
  line.geometry = new LineSegmentsGeometry();
  line.geometry.setPositions(arr);
  if (line.material.dashed) line.computeLineDistances();
}

const dotTexture = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 8; g.strokeStyle = '#1b1b22'; g.stroke();
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

// ---------------------------------------------------------------- vázlat grafika
class SketchGfx {
  constructor(sketch, vp) {
    this.vp = vp;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.lines = makeLines(2.2, COL.curve);
    this.cons = makeLines(1.6, COL.construct, { dashed: true, opacity: 0.9 });
    this.selLines = makeLines(3.6, COL.sel);
    this.hoverLines = makeLines(3.2, COL.hover, { opacity: 0.9 });
    this.regionGroup = new THREE.Group();
    this.points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, map: dotTexture(), transparent: true, alphaTest: 0.3, depthTest: true, color: 0xffffff }));
    this.points.renderOrder = 7;
    this.points.raycast = () => {};
    this.selPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, map: dotTexture(), transparent: true, alphaTest: 0.3, color: COL.sel }));
    this.selPoints.renderOrder = 8;
    this.selPoints.raycast = () => {};
    this.group.add(this.regionGroup, this.lines, this.cons, this.selLines, this.hoverLines, this.points, this.selPoints);
    this.update(sketch);
  }

  update(sketch) {
    this.sketch = sketch;
    this.frame = planeFromJSON(sketch.plane);
    this.group.matrix.copy(frameMatrix(this.frame));
    this.group.matrixWorldNeedsUpdate = true;
    const normal = [], cons = [];
    for (const c of sketch.curves) {
      if (c.t === 'point') continue;
      (c.construction ? cons : normal).push(curvePolyline(c));
    }
    setLinePositions(this.lines, normal);
    setLinePositions(this.cons, cons);
    // pontok: végpontok, középpontok
    const pts = [];
    for (const c of sketch.curves) {
      if (c.t === 'point') pts.push(c.p);
      for (const e of curveEnds(c)) pts.push(e);
      if (c.t === 'circle' || c.t === 'arc' || c.t === 'ellipse') pts.push(c.c);
    }
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = 0; });
    this.points.geometry.dispose();
    this.points.geometry = new THREE.BufferGeometry();
    this.points.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.points.visible = pts.length > 0;
  }

  setRegions(regions, selKeys, hoverKey) {
    for (const o of [...this.regionGroup.children]) { this.regionGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
    for (const r of regions) {
      const sel = selKeys.has(r.key);
      const hov = hoverKey === r.key;
      const geo = regionGeometry(r);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: sel ? COL.sel : hov ? COL.hover : COL.region, transparent: true, opacity: sel ? 0.42 : hov ? 0.26 : 0.1,
        side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }));
      m.renderOrder = 3;
      m.raycast = () => {};
      this.regionGroup.add(m);
    }
  }

  setCurveHighlights(selCurves, hoverCurve, selPoints) {
    const sel = this.sketch.curves.filter((c) => selCurves.has(c.id) && c.t !== 'point').map(curvePolyline);
    setLinePositions(this.selLines, sel);
    const hov = hoverCurve ? this.sketch.curves.filter((c) => c.id === hoverCurve && c.t !== 'point').map(curvePolyline) : [];
    setLinePositions(this.hoverLines, hov);
    const arr = new Float32Array((selPoints || []).length * 3);
    (selPoints || []).forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; });
    this.selPoints.geometry.dispose();
    this.selPoints.geometry = new THREE.BufferGeometry();
    this.selPoints.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.selPoints.visible = arr.length > 0;
  }

  setResolution(w, h) {
    for (const l of [this.lines, this.cons, this.selLines, this.hoverLines]) l.material.resolution.set(w, h);
  }

  dispose() {
    this.group.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
  }
}

function regionGeometry(r) {
  try {
    const toV = (poly) => poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const contour = toV(r.polys[0]);
    const holes = r.polys.slice(1).map(toV);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...contour, ...holes.flat()];
    const pos = new Float32Array(all.length * 3);
    all.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; });
    const idx = [];
    for (const t of tris) idx.push(t[0], t[1], t[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- menedzser
export class SketchManager {
  constructor(app) {
    this.app = app;
    this.vp = app.vp;
    this.gfx = new Map();        // sketchId -> SketchGfx
    this.regionCache = new Map(); // sketchId -> { curves, regions }
    this.selRegions = new Set();  // "sketchId|key"
    this.selCurves = new Set();   // "sketchId|curveId"
    this.selPoints = [];          // [{sketchId, p}]
    this.hover = null;
    this.vp.on('resize', () => { for (const g of this.gfx.values()) g.setResolution(this.vp.width, this.vp.height); });
  }

  /** Szinkronizálás a dokumentummal. */
  sync(state, hidden) {
    const seen = new Set();
    for (const s of state.sketches) {
      seen.add(s.id);
      let g = this.gfx.get(s.id);
      if (!g) {
        g = new SketchGfx(s, this.vp);
        g.setResolution(this.vp.width, this.vp.height);
        this.gfx.set(s.id, g);
        this.vp.sketchGroup.add(g.group);
      } else if (g.sketch !== s) {
        g.update(s);
      }
      g.group.visible = !hidden.includes(s.id);
    }
    for (const [id, g] of this.gfx) {
      if (!seen.has(id)) { this.vp.sketchGroup.remove(g.group); g.dispose(); this.gfx.delete(id); this.regionCache.delete(id); }
    }
    this.refreshHighlights();
  }

  regions(sketch) {
    const c = this.regionCache.get(sketch.id);
    if (c && c.curves === sketch.curves) return c.regions;
    let regions = [];
    try { regions = computeRegions(sketch.curves).regions; } catch (e) { console.warn('régió hiba', e); }
    this.regionCache.set(sketch.id, { curves: sketch.curves, regions });
    return regions;
  }

  refreshHighlights() {
    const st = this.app.doc ? this.app.doc.state : null;
    if (!st) return;
    for (const s of st.sketches) {
      const g = this.gfx.get(s.id);
      if (!g) continue;
      const regs = this.regions(s);
      const selKeys = new Set([...this.selRegions].filter((k) => k.startsWith(s.id + '|')).map((k) => k.slice(s.id.length + 1)));
      const hoverKey = this.hover && this.hover.sketchId === s.id && this.hover.type === 'region' ? this.hover.key : null;
      g.setRegions(regs, selKeys, hoverKey);
      const selC = new Set([...this.selCurves].filter((k) => k.startsWith(s.id + '|')).map((k) => k.slice(s.id.length + 1)));
      const hovC = this.hover && this.hover.sketchId === s.id && this.hover.type === 'curve' ? this.hover.curveId : null;
      const selP = this.selPoints.filter((p) => p.sketchId === s.id).map((p) => p.p);
      g.setCurveHighlights(selC, hovC, selP);
    }
    this.vp.requestRender();
  }

  frameOf(sketch) { return planeFromJSON(sketch.plane); }

  /** Képernyőpont -> vázlat síkkoordináta (vagy null, ha a sík mögött/éllel néz). */
  rayToSketch(sketch, x, y) {
    const f = this.frameOf(sketch);
    const p = this.vp.rayPlane(x, y, f.origin, f.normal);
    return p ? toLocal(f, p) : null;
  }

  /**
   * Kiválasztás a látható vázlatokon. Görbe (képernyőtávolság) előnyt élvez a régióval szemben.
   * opts.maxDepth: csak ennél közelebbi vázlatok (felületi takarás)
   */
  pick(x, y, tol, opts = {}) {
    const st = this.app.doc.state;
    let best = null;
    const ray = this.vp.rayAt(x, y);
    for (const s of st.sketches) {
      const g = this.gfx.get(s.id);
      if (!g || !g.group.visible) continue;
      const f = this.frameOf(s);
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(f.normal, f.origin);
      const hit = V();
      if (!ray.intersectPlane(pl, hit)) continue;
      const depth = hit.distanceTo(ray.origin);
      if (opts.maxDepth != null && depth > opts.maxDepth * 1.002 + this.vp.worldPerPixel(hit) * 2) continue;
      const uv = toLocal(f, hit);
      const wpp = this.vp.worldPerPixel(hit);
      // ferde rálátásnál a képernyőtávolság nagyobb lehet: a síkbeli tűrést növeljük
      const cosA = Math.max(0.2, Math.abs(ray.direction.dot(f.normal)));
      const tolW = tol * wpp;
      // pontok
      if (opts.points !== false) {
        for (const c of s.curves) {
          for (const kp of curveKeyPoints(c)) {
            if (kp.kind === 'quad' || kp.kind === 'mid') continue;
            const d = dist(kp.p, uv) / tolW;
            if (d < 1 && (!best || best.rank > 0 || d < best.score)) {
              best = { type: 'spoint', sketchId: s.id, p: kp.p, kind: kp.kind, curveId: c.id, score: d, rank: 0, depth, world: toWorld(f, kp.p) };
            }
          }
        }
      }
      // görbék
      for (const c of s.curves) {
        const r = curveDistance(c, uv);
        const d = (r.d * cosA) / tolW;
        if (d < 1 && (!best || best.rank > 1 || (best.rank === 1 && d < best.score))) {
          best = { type: 'curve', sketchId: s.id, curveId: c.id, point: r.point, score: d, rank: 1, depth, world: toWorld(f, r.point) };
        }
      }
      // régiók
      if (opts.regions !== false && (!best || best.rank > 2)) {
        for (const r of this.regions(s)) {
          if (pointInRegion(uv, r) && (!best || (best.rank === 2 && r.area < best.area) || best.rank > 2)) {
            best = { type: 'region', sketchId: s.id, key: r.key, area: r.area, rank: 2, depth, uv, world: hit.clone() };
          }
        }
      }
    }
    return best;
  }

  regionByKey(sketchId, key) {
    const s = this.app.doc.sketch(sketchId);
    if (!s) return null;
    return this.regions(s).find((r) => r.key === key) || null;
  }

  /** Kernel-profil egy régióból. */
  regionProfile(sketchId, key) {
    const s = this.app.doc.sketch(sketchId);
    const r = s && this.regions(s).find((x) => x.key === key);
    if (!r) return null;
    return { kind: 'region', plane: s.plane, loops: r.loops };
  }

  /** Egy vázlat, ami az adott síkon fekszik (vagy null). */
  findSketchOnPlane(frame) {
    for (const s of this.app.doc.state.sketches) {
      if (this.app.doc.isHidden(s.id)) continue;
      if (samePlane(this.frameOf(s), frame)) return s;
    }
    return null;
  }

  // ------------------------------------------------ kijelölés állapot
  clearSelection() {
    this.selRegions.clear(); this.selCurves.clear(); this.selPoints = [];
    this.refreshHighlights();
  }

  setHover(h) {
    const same = JSON.stringify(h && { t: h.type, s: h.sketchId, k: h.key, c: h.curveId }) === JSON.stringify(this.hover && { t: this.hover.type, s: this.hover.sketchId, k: this.hover.key, c: this.hover.curveId });
    this.hover = h;
    if (!same) this.refreshHighlights();
  }
}
