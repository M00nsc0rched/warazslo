// Kiválasztás: lapok (sugárkövetés), élek és csúcsok (képernyőtávolság + takarásvizsgálat)
import * as THREE from 'three';

const V = () => new THREE.Vector3();

export function pickTolerance(pointerType) {
  if (pointerType === 'touch') return 18;
  if (pointerType === 'pen') return 10;
  return 7;
}

export class Picker {
  constructor(viewport, bodiesView) {
    this.vp = viewport;
    this.bodies = bodiesView;
  }

  _visibleGfx() {
    const out = [];
    for (const g of this.bodies.gfx.values()) if (g.group.visible) out.push(g);
    return out;
  }

  _clipped(p) {
    for (const pl of this.bodies.clipPlanes) if (pl.distanceToPoint(p) < -1e-6) return true;
    return false;
  }

  /** Legközelebbi felületi találat. */
  raycastBodies(x, y, { includePreview = false } = {}) {
    const rc = this.vp.raycaster(x, y);
    const meshes = this._visibleGfx().filter((g) => g.mesh.visible || this.bodies.displayMode === 'wire').map((g) => g.mesh);
    if (includePreview) for (const g of this.bodies.previewGfx) meshes.push(g.mesh);
    const hits = rc.intersectObjects(meshes, false);
    for (const h of hits) {
      if (this._clipped(h.point)) continue;
      const bodyId = h.object.userData.bodyId;
      const g = this.bodies.gfx.get(bodyId);
      const face = g ? g.faceOfTriangle(h.faceIndex) : -1;
      let normal = null;
      if (h.face) normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      return { bodyId, face, point: h.point.clone(), distance: h.distance, normal };
    }
    return null;
  }

  /** Egy pont látható-e a kamerából (nem takarja másik felület). */
  isVisible(p) {
    const cam = this.vp.camera;
    const camPos = cam.position.clone();
    let dir, dist;
    if (this.vp.useOrtho) {
      dir = this.vp.viewDir;
      const back = camPos.clone().sub(p).dot(dir.clone().negate());
      const origin = p.clone().addScaledVector(dir, -Math.abs(back));
      const rc = new THREE.Raycaster(origin, dir);
      dist = Math.abs(back);
      return this._firstHit(rc, dist);
    }
    dir = p.clone().sub(camPos);
    dist = dir.length();
    dir.normalize();
    const rc = new THREE.Raycaster(camPos, dir);
    return this._firstHit(rc, dist);
  }

  _firstHit(rc, dist) {
    const meshes = this._visibleGfx().filter((g) => g.mesh.visible).map((g) => g.mesh);
    if (this.bodies.displayMode === 'xray' || this.bodies.displayMode === 'wire') return true;
    const hits = rc.intersectObjects(meshes, false);
    for (const h of hits) {
      if (this._clipped(h.point)) continue;
      const eps = Math.max(dist * 0.002, this.vp.worldPerPixel(h.point) * 1.5);
      return h.distance >= dist - eps;
    }
    return true;
  }

  /**
   * Fő kiválasztó. opts: { pointerType, faces=true, edges=true, vertices=false, bodyFilter }
   */
  pick(x, y, opts = {}) {
    const tol = opts.tolerance || pickTolerance(opts.pointerType);
    const wantEdges = opts.edges !== false;
    const wantVerts = !!opts.vertices;
    const wantFaces = opts.faces !== false;
    const hit = this.raycastBodies(x, y);
    const gfxList = this._visibleGfx().filter((g) => !opts.bodyFilter || opts.bodyFilter(g.id));
    const cam = this.vp.camera;
    cam.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const W = this.vp.width, H = this.vp.height;
    const proj = (px, py, pz, out) => {
      const e = m.elements;
      const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
      out.x = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * W;
      out.y = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * H;
      out.w = w;
      return out;
    };
    const a = { x: 0, y: 0, w: 0 }, b = { x: 0, y: 0, w: 0 };

    // csúcsok
    if (wantVerts) {
      const cands = [];
      for (const g of gfxList) {
        const pts = g.data.points;
        if (!pts) continue;
        for (let i = 0; i < pts.length; i += 3) {
          proj(pts[i], pts[i + 1], pts[i + 2], a);
          if (a.w <= 0) continue;
          const d = Math.hypot(a.x - x, a.y - y);
          if (d < tol * 1.15) cands.push({ d, bodyId: g.id, index: i / 3, point: [pts[i], pts[i + 1], pts[i + 2]] });
        }
      }
      cands.sort((p, q) => p.d - q.d);
      for (const c of cands.slice(0, 6)) {
        const p = new THREE.Vector3(...c.point);
        if (this._clipped(p)) continue;
        if (this.isVisible(p)) return { type: 'vertex', bodyId: c.bodyId, index: c.index, point: c.point, screenDist: c.d, hit };
      }
    }

    // élek
    if (wantEdges) {
      const cands = [];
      for (const g of gfxList) {
        if (!g.bbox) continue;
        const lines = g.data.lines;
        for (const [edge, [start, count]] of g.edgeRanges) {
          let best = null;
          for (let k = start; k < start + count - 1; k += 2) {
            const i = k * 3;
            proj(lines[i], lines[i + 1], lines[i + 2], a);
            proj(lines[i + 3], lines[i + 4], lines[i + 5], b);
            if (a.w <= 0 || b.w <= 0) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const L2 = dx * dx + dy * dy;
            let t = L2 > 1e-9 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
            if (d < tol && (!best || d < best.d)) {
              best = { d, point: [lines[i] + (lines[i + 3] - lines[i]) * t, lines[i + 1] + (lines[i + 4] - lines[i + 1]) * t, lines[i + 2] + (lines[i + 5] - lines[i + 2]) * t] };
            }
          }
          if (best) cands.push({ ...best, bodyId: g.id, index: edge });
        }
      }
      cands.sort((p, q) => p.d - q.d);
      for (const c of cands.slice(0, 8)) {
        const p = new THREE.Vector3(...c.point);
        if (this._clipped(p)) continue;
        if (this.isVisible(p)) {
          // Ha a felületi találat sokkal közelebb van a képernyőn (ujj a lap közepén), a lap nyer
          return { type: 'edge', bodyId: c.bodyId, index: c.index, point: c.point, screenDist: c.d, hit };
        }
      }
    }

    if (hit && wantFaces && hit.face >= 0 && (!opts.bodyFilter || opts.bodyFilter(hit.bodyId))) {
      return { type: 'face', bodyId: hit.bodyId, index: hit.face, point: hit.point.toArray(), normal: hit.normal ? hit.normal.toArray() : null, screenDist: 0, hit };
    }
    return { type: 'none', hit };
  }

  /** Pont kigyűjtése illesztéshez: csúcsok és élközéppontok a képernyő közelében. */
  snapPoints(x, y, tol) {
    const out = [];
    for (const g of this._visibleGfx()) {
      const pts = g.data.points;
      if (pts) {
        for (let i = 0; i < pts.length; i += 3) {
          const p = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
          const s = this.vp.project(p);
          if (s.behind) continue;
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < tol) out.push({ kind: 'vertex', p, d });
        }
      }
      if (g.data.edges) {
        for (const e of g.data.edges) {
          if (e.type === 'CIRCLE' && e.center) {
            const p = new THREE.Vector3(...e.center);
            const s = this.vp.project(p);
            const d = Math.hypot(s.x - x, s.y - y);
            if (!s.behind && d < tol) out.push({ kind: 'center', p, d });
          } else if (e.type === 'LINE' && e.mid) {
            const p = new THREE.Vector3(...e.mid);
            const s = this.vp.project(p);
            const d = Math.hypot(s.x - x, s.y - y);
            if (!s.behind && d < tol) out.push({ kind: 'mid', p, d });
          }
        }
      }
    }
    out.sort((p, q) => p.d - q.d);
    return out.filter((c) => this.isVisible(c.p));
  }
}
