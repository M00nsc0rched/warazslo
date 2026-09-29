// Megfogható fogantyúk (nyíl, forgató gyűrű, mozgató gizmó) és értékbuborékok
import * as THREE from 'three';
import { fmtLen, fmtAngle } from '../util/units.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ACCENT = 0x2b8cff;
const AXIS_COL = [0xe5484d, 0x46a758, 0x3e8ef7];

/** Két egyenes (sugár és tengely) legközelebbi pontja a tengelyen: paraméter */
function closestOnAxis(ray, origin, dir) {
  const w0 = ray.origin.clone().sub(origin);
  const a = ray.direction.dot(ray.direction), b = ray.direction.dot(dir), c = dir.dot(dir);
  const d = ray.direction.dot(w0), e = dir.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (a * e - b * d) / den;
}

class Handle {
  constructor(mgr) { this.mgr = mgr; this.obj = new THREE.Group(); this.enabled = true; this.pxSize = 1; }
  update() {}
  hit() { return null; }
  dispose() {
    this.obj.parent && this.obj.parent.remove(this.obj);
    this.obj.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
  }
}

// ---------------------------------------------------------------- nyíl
export class ArrowHandle extends Handle {
  /**
   * opts: { origin, dir, value, onChange(v, final), onTap(), color, label, kind:'len', min, max, snap }
   * A nyíl a origin + dir*value pontban áll.
   */
  constructor(mgr, opts) {
    super(mgr);
    this.o = opts;
    this.origin = opts.origin.clone();
    this.dir = opts.dir.clone().normalize();
    this.value = opts.value || 0;
    const col = opts.color ?? ACCENT;
    const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), mat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 18), mat.clone());
    head.rotation.x = Math.PI / 2; head.position.z = 1.2;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat.clone());
    this.parts = new THREE.Group();
    this.parts.add(shaft, head, ball);
    this.obj.add(this.parts);
    this.obj.renderOrder = 20;
    this.obj.traverse((o) => { o.renderOrder = 20; });
    // szaggatott vezetővonal az origótól
    const lg = new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, 1)]);
    this.guide = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1, gapSize: 1, depthTest: false, transparent: true, opacity: 0.7 }));
    this.guide.renderOrder = 19;
    mgr.scene.add(this.guide);
    if (opts.bubble !== false) this.bubble = mgr.bubble({ onTap: () => opts.onTap && opts.onTap(), kind: opts.kind || 'len', label: opts.label });
    this.update();
  }

  get tip() { return this.origin.clone().addScaledVector(this.dir, this.value); }

  setValue(v) { this.value = v; this.update(); }
  setFrame(origin, dir) { this.origin.copy(origin); this.dir.copy(dir).normalize(); this.update(); }

  update() {
    const vp = this.mgr.vp;
    const tip = this.tip;
    const s = vp.worldPerPixel(tip) * 44;
    this.pxSize = s;
    // a nyíl mindig "kifelé" mutat a húzás irányába
    const flip = this.value < 0 ? -1 : 1;
    const d = this.dir.clone().multiplyScalar(this.o.fixedDir ? 1 : flip);
    this.parts.position.copy(tip);
    this.parts.quaternion.setFromUnitVectors(V(0, 0, 1), d);
    this.parts.scale.setScalar(s);
    this.guide.geometry.setFromPoints([this.origin, tip]);
    this.guide.computeLineDistances();
    this.guide.material.dashSize = s * 0.12; this.guide.material.gapSize = s * 0.08;
    this.guide.visible = Math.abs(this.value) > 1e-9;
    if (this.bubble) {
      const txt = this.o.kind === 'angle' ? fmtAngle(this.value) : fmtLen(this.o.display ? this.o.display(this.value) : this.value);
      this.bubble.set(this.o.label ? `${this.o.label} ${txt}` : txt);
      const side = vp.camRight.multiplyScalar(s * 0.9);
      this.bubble.at(tip.clone().addScaledVector(d, s * 1.9).add(side));
    }
  }

  hit(x, y, tol) {
    const vp = this.mgr.vp;
    const tip = this.tip;
    const a = vp.project(tip);
    const flip = this.value < 0 ? -1 : 1;
    const b = vp.project(tip.clone().addScaledVector(this.dir, this.pxSize * 1.45 * (this.o.fixedDir ? 1 : flip)));
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
    return d < tol + 6 ? d : null;
  }

  dragStart(ev) {
    const ray = this.mgr.vp.rayAt(ev.x, ev.y);
    const t = closestOnAxis(ray, this.origin, this.dir);
    this.dragOffset = t == null ? 0 : this.value - t;
    this.startValue = this.value;
  }

  dragMove(ev) {
    const ray = this.mgr.vp.rayAt(ev.x, ev.y);
    let t = closestOnAxis(ray, this.origin, this.dir);
    if (t == null) return;
    let v = t + this.dragOffset;
    if (this.o.snap) v = this.o.snap(v, ev);
    if (this.o.min != null) v = Math.max(this.o.min, v);
    if (this.o.max != null) v = Math.min(this.o.max, v);
    this.value = v;
    this.update();
    this.o.onChange && this.o.onChange(v, false);
  }

  dragEnd() { this.o.onChange && this.o.onChange(this.value, true); }

  dispose() { super.dispose(); this.mgr.scene.remove(this.guide); this.guide.geometry.dispose(); this.bubble && this.bubble.remove(); }
}

// ---------------------------------------------------------------- forgató gyűrű
export class RotateHandle extends Handle {
  /** opts: { center, axis, ref (0 szög iránya), value (fok), onChange, onTap, radiusPx } */
  constructor(mgr, opts) {
    super(mgr);
    this.o = opts;
    this.center = opts.center.clone();
    this.axis = opts.axis.clone().normalize();
    this.ref = opts.ref.clone().projectOnPlane(this.axis).normalize();
    this.value = opts.value || 0;
    const col = opts.color ?? ACCENT;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.028, 8, 96), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.9 }));
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
    this.sector = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    this.obj.add(this.ring, this.knob, this.sector);
    this.obj.traverse((o) => { o.renderOrder = 20; });
    if (opts.bubble !== false) this.bubble = mgr.bubble({ onTap: () => opts.onTap && opts.onTap(), kind: 'angle' });
    this.update();
  }

  setValue(v) { this.value = v; this.update(); }

  _basis() {
    const x = this.ref.clone();
    const y = this.axis.clone().cross(x).normalize();
    return { x, y };
  }

  update() {
    const vp = this.mgr.vp;
    const R = vp.worldPerPixel(this.center) * (this.o.radiusPx || 70);
    this.R = R;
    const { x, y } = this._basis();
    const m = new THREE.Matrix4().makeBasis(x, y, this.axis);
    m.setPosition(this.center);
    this.obj.matrixAutoUpdate = false;
    this.obj.matrix.copy(m).multiply(new THREE.Matrix4().makeScale(R, R, R));
    this.obj.matrixWorldNeedsUpdate = true;
    const a = THREE.MathUtils.degToRad(this.value);
    this.knob.position.set(Math.cos(a), Math.sin(a), 0);
    // szektor
    const n = Math.max(2, Math.ceil(Math.abs(a) / 0.08));
    const pos = [0, 0, 0];
    for (let i = 0; i <= n; i++) { const t = (a * i) / n; pos.push(Math.cos(t), Math.sin(t), 0); }
    const idx = [];
    for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
    this.sector.geometry.dispose();
    this.sector.geometry = new THREE.BufferGeometry();
    this.sector.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.sector.geometry.setIndex(idx);
    if (this.bubble) {
      this.bubble.set(fmtAngle(this.value));
      const p = this.center.clone().addScaledVector(x, Math.cos(a) * R * 1.3).addScaledVector(y, Math.sin(a) * R * 1.3);
      this.bubble.at(p);
    }
  }

  _worldOnRing(t) {
    const { x, y } = this._basis();
    return this.center.clone().addScaledVector(x, Math.cos(t) * this.R).addScaledVector(y, Math.sin(t) * this.R);
  }

  hit(x, y, tol) {
    const vp = this.mgr.vp;
    let best = null;
    for (let i = 0; i < 64; i++) {
      const p = vp.project(this._worldOnRing((i / 64) * Math.PI * 2));
      const d = Math.hypot(p.x - x, p.y - y);
      if (best == null || d < best) best = d;
    }
    const k = vp.project(this._worldOnRing(THREE.MathUtils.degToRad(this.value)));
    best = Math.min(best, Math.hypot(k.x - x, k.y - y) - 6);
    return best < tol + 4 ? best : null;
  }

  _angleAt(ev) {
    const p = this.mgr.vp.rayPlane(ev.x, ev.y, this.center, this.axis);
    if (!p) return null;
    const { x, y } = this._basis();
    const d = p.sub(this.center);
    return THREE.MathUtils.radToDeg(Math.atan2(d.dot(y), d.dot(x)));
  }

  dragStart(ev) {
    this.lastA = this._angleAt(ev);
    this.acc = this.value;
  }

  dragMove(ev) {
    const a = this._angleAt(ev);
    if (a == null || this.lastA == null) return;
    let d = a - this.lastA;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    this.lastA = a;
    this.acc += d;
    let v = this.acc;
    const step = ev.shift ? 1 : 5;
    if (this.o.snapAngle !== false) {
      const sv = Math.round(v / step) * step;
      if (Math.abs(sv - v) < (ev.pointerType === 'touch' ? 3 : 2)) v = sv;
    }
    if (this.o.min != null) v = Math.max(this.o.min, v);
    if (this.o.max != null) v = Math.min(this.o.max, v);
    this.value = v;
    this.update();
    this.o.onChange && this.o.onChange(v, false);
  }

  dragEnd() { this.o.onChange && this.o.onChange(this.value, true); }
  dispose() { super.dispose(); this.bubble && this.bubble.remove(); }
}

// ---------------------------------------------------------------- mozgató gizmó
export class MoveGizmo extends Handle {
  /**
   * opts: { center, axes:[x,y,z] (egységvektorok), onChange({translate: Vector3, rotate: {axis, angle}}, final), onTapValue(kind, i) }
   * Nyilak: eltolás a tengelyek mentén; gyűrűk: forgatás; középső gömb: szabad síkbeli mozgatás.
   */
  constructor(mgr, opts) {
    super(mgr);
    this.o = opts;
    this.center0 = opts.center.clone();
    this.axes = (opts.axes || [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]).map((a) => a.clone().normalize());
    this.t = V();
    this.rotAxis = null;
    this.rotAngle = 0;
    this.arrows = [];
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: AXIS_COL[i], depthTest: false, transparent: true });
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 8), mat);
      shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.575;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16), mat);
      head.rotation.x = Math.PI / 2; head.position.z = 1.1;
      g.add(shaft, head);
      g.quaternion.setFromUnitVectors(V(0, 0, 1), this.axes[i]);
      this.obj.add(g);
      this.arrows.push(g);
      const ringMat = new THREE.MeshBasicMaterial({ color: AXIS_COL[i], depthTest: false, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.018, 6, 72, Math.PI / 2), ringMat);
      // a gyűrű a tengelyre merőleges síkban, a két másik tengely közti negyedben
      const a1 = this.axes[(i + 1) % 3], a2 = this.axes[(i + 2) % 3];
      const m = new THREE.Matrix4().makeBasis(a1, a2, this.axes[i]);
      ring.quaternion.setFromRotationMatrix(m);
      this.obj.add(ring);
      this.rings.push(ring);
    }
    // síkbeli mód (vázlatgörbék): csak az első két tengely nyila és a harmadik körüli gyűrű
    if (opts.planar) { this.rings[0].visible = false; this.rings[1].visible = false; }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.obj.add(this.ball);
    this.obj.traverse((o) => { o.renderOrder = 20; });
    this.bubble = mgr.bubble({ onTap: () => this.o.onTapValue && this.o.onTapValue(this.lastKind, this.lastIndex), kind: 'len' });
    this.bubble.hide();
    this.update();
  }

  get center() { return this.center0.clone().add(this.t); }

  update() {
    const vp = this.mgr.vp;
    const c = this.center;
    const s = vp.worldPerPixel(c) * 90;
    this.s = s;
    this.obj.position.copy(c);
    this.obj.scale.setScalar(s);
    // a nyilak a kamera felé forduljanak (negatív tengelyirány, ha az jobban látszik)
    for (let i = 0; i < 3; i++) {
      const toCam = vp.camera.position.clone().sub(c).normalize();
      this.arrows[i].visible = !(this.o.planar && i === 2) && Math.abs(this.axes[i].dot(vp.viewDir)) < 0.985;
      void toCam;
    }
  }

  hit(x, y, tol) {
    const vp = this.mgr.vp;
    const c = this.center;
    const pc = vp.project(c);
    if (Math.hypot(pc.x - x, pc.y - y) < tol + 8) return { d: 0, part: 'ball' };
    let best = null;
    for (let i = 0; i < 3; i++) {
      if (!this.arrows[i].visible) continue;
      const a = vp.project(c.clone().addScaledVector(this.axes[i], this.s * 0.25));
      const b = vp.project(c.clone().addScaledVector(this.axes[i], this.s * 1.25));
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (d < tol + 4 && (!best || d < best.d)) best = { d, part: 'axis', i };
    }
    for (let i = 0; i < 3; i++) {
      if (!this.rings[i].visible) continue;
      const a1 = this.axes[(i + 1) % 3], a2 = this.axes[(i + 2) % 3];
      for (let k = 0; k <= 16; k++) {
        const t = (k / 16) * Math.PI / 2;
        const p = vp.project(c.clone().addScaledVector(a1, Math.cos(t) * this.s * 0.62).addScaledVector(a2, Math.sin(t) * this.s * 0.62));
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < tol + 2 && (!best || d < best.d)) best = { d, part: 'ring', i };
      }
    }
    return best;
  }

  dragStart(ev, part) {
    this.part = part;
    this.startT = this.t.clone();
    this.startAngle = this.rotAngle;
    const vp = this.mgr.vp;
    const c = this.center;
    if (part.part === 'axis') {
      const ray = vp.rayAt(ev.x, ev.y);
      this.off = closestOnAxis(ray, c, this.axes[part.i]);
    } else if (part.part === 'ball') {
      this.planeN = this.o.planar ? this.axes[2].clone() : vp.viewDir.clone();
      this.p0 = vp.rayPlane(ev.x, ev.y, c, this.planeN);
    } else if (part.part === 'ring') {
      this.rotAxisIdx = part.i;
      const p = vp.rayPlane(ev.x, ev.y, c, this.axes[part.i]);
      this.lastA = p ? this._ang(p, part.i) : 0;
      this.acc = this.rotAxisIdx === this.lastRotIdx ? this.rotAngle : 0;
    }
  }

  _ang(p, i) {
    const a1 = this.axes[(i + 1) % 3], a2 = this.axes[(i + 2) % 3];
    const d = p.clone().sub(this.center);
    return THREE.MathUtils.radToDeg(Math.atan2(d.dot(a2), d.dot(a1)));
  }

  dragMove(ev) {
    const vp = this.mgr.vp;
    const part = this.part;
    if (part.part === 'axis') {
      const c0 = this.center0.clone().add(this.startT);
      const ray = vp.rayAt(ev.x, ev.y);
      const t = closestOnAxis(ray, c0, this.axes[part.i]);
      if (t == null || this.off == null) return;
      let d = t - this.off;
      if (this.o.snap) d = this.o.snap(d, ev);
      this.t.copy(this.startT).addScaledVector(this.axes[part.i], d);
      this.lastKind = 'axis'; this.lastIndex = part.i; this.lastValue = d;
      this._emit(false);
      this.bubble.set(fmtLen(d));
      this.bubble.at(this.center.clone().addScaledVector(this.axes[part.i], this.s * 1.6));
      this.bubble.show();
    } else if (part.part === 'ball') {
      const c0 = this.center0.clone().add(this.startT);
      const p = vp.rayPlane(ev.x, ev.y, c0, this.planeN);
      if (!p || !this.p0) return;
      let d = p.sub(this.p0);
      if (this.o.snapPoint) {
        const target = this.o.snapPoint(ev, c0.clone().add(d));
        if (target) d = target.clone().sub(c0);
      }
      this.t.copy(this.startT).add(d);
      this.lastKind = 'free';
      this._emit(false);
      this.bubble.set(fmtLen(this.t.length()));
      this.bubble.at(this.center.clone().addScaledVector(vp.camUp, this.s * 0.6));
      this.bubble.show();
    } else if (part.part === 'ring') {
      const i = part.i;
      const p = vp.rayPlane(ev.x, ev.y, this.center, this.axes[i]);
      if (!p) return;
      const a = this._ang(p, i);
      let d = a - this.lastA;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      this.lastA = a;
      this.acc += d;
      let v = this.acc;
      const sv = Math.round(v / 15) * 15;
      if (Math.abs(sv - v) < 3) v = sv;
      this.rotAxis = this.axes[i].clone();
      this.lastRotIdx = i;
      this.rotAngle = v;
      this.lastKind = 'ring'; this.lastIndex = i; this.lastValue = v;
      this._emit(false);
      this.bubble.set(fmtAngle(v));
      const a1 = this.axes[(i + 1) % 3];
      this.bubble.at(this.center.clone().addScaledVector(a1, this.s * 0.9));
      this.bubble.show();
    }
    this.update();
  }

  dragEnd() { this._emit(true); }

  _emit(final) {
    this.o.onChange && this.o.onChange({ translate: this.t.clone(), rotAxis: this.rotAxis, rotAngle: this.rotAngle, rotCenter: this.center0.clone().add(this.t) }, final);
  }

  set(translate, rotAxisIdx, angle) {
    if (translate) this.t.copy(translate);
    if (rotAxisIdx != null) { this.rotAxis = this.axes[rotAxisIdx].clone(); this.rotAngle = angle; this.lastRotIdx = rotAxisIdx; }
    this.update();
  }

  dispose() { super.dispose(); this.bubble.remove(); }
}

// ---------------------------------------------------------------- menedzser
export class HandleManager {
  constructor(viewport, overlayEl) {
    this.vp = viewport;
    this.overlay = overlayEl;
    this.scene = viewport.overlayScene;
    this.handles = new Set();
    this.bubbles = new Set();
    this.active = null;
    viewport.on('beforeRender', () => { for (const h of this.handles) h.update(); });
    viewport.on('afterRender', () => this._placeBubbles());
  }

  add(h) { this.handles.add(h); this.scene.add(h.obj); this.vp.requestRender(); return h; }
  remove(h) { if (!h) return; this.handles.delete(h); h.dispose(); this.vp.requestRender(); }
  clear() { for (const h of [...this.handles]) this.remove(h); for (const b of [...this.bubbles]) b.remove(); }

  hit(x, y, pointerType) {
    const tol = pointerType === 'touch' ? 16 : pointerType === 'pen' ? 9 : 7;
    let best = null;
    for (const h of this.handles) {
      if (!h.enabled || !h.obj.visible) continue;
      const r = h.hit(x, y, tol);
      if (r == null) continue;
      const d = typeof r === 'number' ? r : r.d;
      if (!best || d < best.d) best = { h, d, part: r };
    }
    return best;
  }

  /** HTML értékbuborék egy világpontnál. */
  bubble({ onTap, kind = 'len', cls = '', passive = false } = {}) {
    const elm = document.createElement('div');
    elm.className = `bubble ${cls} ${passive ? 'passive' : ''}`;
    this.overlay.appendChild(elm);
    const b = {
      elm, world: null, visible: true,
      set: (txt) => { elm.textContent = txt; },
      at: (p) => { b.world = p.clone(); },
      show: () => { b.visible = true; elm.style.display = ''; },
      hide: () => { b.visible = false; elm.style.display = 'none'; },
      remove: () => { elm.remove(); this.bubbles.delete(b); },
    };
    if (onTap && !passive) {
      let down = null;
      elm.addEventListener('pointerdown', (e) => { e.stopPropagation(); down = { x: e.clientX, y: e.clientY }; });
      elm.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) onTap(elm);
        down = null;
      });
    }
    this.bubbles.add(b);
    this.vp.requestRender();
    return b;
  }

  _placeBubbles() {
    for (const b of this.bubbles) {
      if (!b.world || !b.visible) { if (!b.world) b.elm.style.display = 'none'; continue; }
      const p = this.vp.project(b.world);
      if (p.behind) { b.elm.style.display = 'none'; continue; }
      b.elm.style.display = '';
      const hw = (b.elm.offsetWidth || 80) / 2 + 6, hh = (b.elm.offsetHeight || 24) / 2 + 6;
      const x = Math.max(hw, Math.min(this.vp.width - hw, p.x));
      const y = Math.max(hh, Math.min(this.vp.height - hh, p.y));
      b.elm.style.left = `${x}px`;
      b.elm.style.top = `${y}px`;
    }
  }
}
