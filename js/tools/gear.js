// Alkatrész generátorok: evolvens fogaskerék, hatlapfejű csavar, anya
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { canonicalFrame, planeToJSON } from '../sketch/manager.js';
import { faceInfo, V3 } from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const inv = (a) => Math.tan(a) - a;

/** Evolvens homlokfogaskerék profil (egy zárt hurok + furat). */
export function gearLoops({ m, z, alpha = 20, bore = 0, clearance = 0.25, backlash = 0 }) {
  const a = (alpha * Math.PI) / 180;
  const rp = (m * z) / 2;
  const rb = rp * Math.cos(a);
  const ra = rp + m;
  const rf = Math.max(rp - (1 + clearance) * m, 0.5 * m);
  const invA = inv(a);
  const half = (r) => {
    const b = Math.acos(Math.min(1, rb / r));
    return Math.PI / (2 * z) - backlash / (2 * rp) + invA - inv(b);
  };
  const r0 = Math.max(rb, rf);
  const loop = [];
  const N = 6;
  const flank = (psi, side) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const r = r0 + ((ra - r0) * i) / N;
      const h = Math.max(half(r), 0.002);
      pts.push(polar(r, psi + side * h));
    }
    return pts;
  };
  const bezFromPts = (P) => {
    // Hermite -> Bézier a végpontokban vett érintőkkel
    const n = P.length - 1;
    const t0 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
    const t1 = [P[n][0] - P[n - 1][0], P[n][1] - P[n - 1][1]];
    const L = Math.hypot(P[n][0] - P[0][0], P[n][1] - P[0][1]) / 3;
    const nt0 = Math.hypot(...t0) || 1, nt1 = Math.hypot(...t1) || 1;
    return { t: 'bez', p: [P[0], [P[0][0] + (t0[0] / nt0) * L, P[0][1] + (t0[1] / nt0) * L], [P[n][0] - (t1[0] / nt1) * L, P[n][1] - (t1[1] / nt1) * L], P[n]] };
  };
  const step = (2 * Math.PI) / z;
  for (let i = 0; i < z; i++) {
    const psi = i * step;
    const right = flank(psi, -1);          // alulról felfelé
    const left = flank(psi, 1).reverse();  // felülről lefelé
    const bottomR = right[0], topR = right[N], topL = left[0], bottomL = left[N];
    // gyökér vonal (ha az alapkör a lábkör fölött van)
    if (rb > rf) {
      const aR = Math.atan2(bottomR[1], bottomR[0]);
      loop.push({ t: 'line', a: polar(rf, aR), b: bottomR });
    }
    loop.push(bezFromPts(right));
    // fejkör ív
    const aT0 = Math.atan2(topR[1], topR[0]), aT1 = Math.atan2(topL[1], topL[0]);
    let am = (aT0 + aT1) / 2;
    if (Math.abs(aT1 - aT0) > Math.PI) am += Math.PI;
    loop.push({ t: 'arc', a: topR, m: polar(ra, am), b: topL });
    loop.push(bezFromPts(left));
    const aL = Math.atan2(bottomL[1], bottomL[0]);
    const footL = rb > rf ? polar(rf, aL) : bottomL;
    if (rb > rf) loop.push({ t: 'line', a: bottomL, b: footL });
    // lábkör ív a következő fogig
    const nextPsi = psi + step;
    const nb = flank(nextPsi, -1)[0];
    const aN = Math.atan2(nb[1], nb[0]);
    const footN = rb > rf ? polar(rf, aN) : nb;
    let a0 = Math.atan2(footL[1], footL[0]), a1 = Math.atan2(footN[1], footN[0]);
    while (a1 < a0) a1 += 2 * Math.PI;
    loop.push({ t: 'arc', a: footL, m: polar(rf, (a0 + a1) / 2), b: footN });
  }
  const loops = [loop];
  if (bore > 0 && bore / 2 < rf - 0.5) loops.push([{ t: 'circle', c: [0, 0], r: bore / 2 }]);
  return { loops, rp, ra, rf };
}

function hexLoop(s, holeD = 0) {
  const R = s / Math.sqrt(3);
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push(polar(R, (i * Math.PI) / 3 + Math.PI / 6));
  const loop = pts.map((p, i) => ({ t: 'line', a: p, b: pts[(i + 1) % 6] }));
  const loops = [loop];
  if (holeD > 0) loops.push([{ t: 'circle', c: [0, 0], r: holeD / 2 }]);
  return loops;
}

const BOLTS = {
  M3: { d: 3, s: 5.5, k: 2, m: 2.4 }, M4: { d: 4, s: 7, k: 2.8, m: 3.2 }, M5: { d: 5, s: 8, k: 3.5, m: 4 },
  M6: { d: 6, s: 10, k: 4, m: 5 }, M8: { d: 8, s: 13, k: 5.3, m: 6.5 }, M10: { d: 10, s: 16, k: 6.4, m: 8 }, M12: { d: 12, s: 18, k: 7.5, m: 10 },
};

export class GearTool extends KernelTool {
  get toolId() { return this.kind === 'gear' ? 'gear' : 'bolt'; }
  get opName() { return 'compose'; }
  get label() { return { gear: 'Fogaskerék', bolt: 'Csavar', nut: 'Anya' }[this.kind]; }
  get icon() { return this.kind === 'gear' ? 'gear' : this.kind === 'nut' ? 'nut' : 'bolt'; }
  get allowsSelection() { return false; }

  constructor(app, opts) {
    super(app, opts);
    this.kind = opts.kind || 'gear';
    this.g = { m: 2, z: 20, t: 8, bore: 8, alpha: 20, ...(app.gearParams || {}) };
    this.b = { size: 'M6', L: 20, ...(app.boltParams || {}) };
  }

  start() {
    const g = this.app.vp.gridFrame;
    this.frame = { origin: g.origin.clone(), xDir: g.xDir.clone(), yDir: g.yDir.clone(), normal: g.normal.clone() };
    this.update();
  }

  tap(ev) {
    const hit = this.app.picker.raycastBodies(ev.x, ev.y);
    if (hit && hit.face >= 0) {
      const fi = faceInfo(this.app, hit.bodyId, hit.face);
      if (fi && fi.type === 'PLANE') { this.frame = canonicalFrame(V3(fi.normal), hit.point); this.frame.origin = hit.point.clone(); this.update(); return true; }
    }
    const g = this.app.vp.gridFrame;
    const p = this.app.vp.rayPlane(ev.x, ev.y, g.origin, g.normal);
    if (p) {
      const s = this.app.vp.gridSpacing || 1;
      p.set(Math.round(p.x / s) * s, Math.round(p.y / s) * s, Math.round(p.z / s) * s);
      this.frame = { origin: p, xDir: g.xDir.clone(), yDir: g.yDir.clone(), normal: g.normal.clone() };
      this.update();
    }
    return true;
  }

  plane(offset = 0) {
    const f = this.frame;
    const o = f.origin.clone().addScaledVector(f.normal, offset);
    return { origin: o.toArray(), xDir: f.xDir.toArray(), yDir: f.yDir.toArray(), normal: f.normal.toArray() };
  }

  args() {
    if (this.kind === 'gear') {
      const { m, z, t, bore, alpha } = this.g;
      if (!(m > 0 && z >= 6 && t > 0)) return null;
      const { loops } = gearLoops({ m, z, alpha, bore });
      return { parts: [{ name: 'extrude', args: { profiles: [{ kind: 'region', plane: this.plane(), loops }], mode: 'one', d1: t, op: 'new' } }], name: `Fogaskerék m${m} z${z}` };
    }
    const B = BOLTS[this.b.size];
    if (this.kind === 'nut') {
      return { parts: [{ name: 'extrude', args: { profiles: [{ kind: 'region', plane: this.plane(), loops: hexLoop(B.s, B.d) }], mode: 'one', d1: B.m, op: 'new' } }], name: `Anya ${this.b.size}` };
    }
    const head = { name: 'extrude', args: { profiles: [{ kind: 'region', plane: this.plane(), loops: hexLoop(B.s) }], mode: 'one', d1: B.k, op: 'new' } };
    const shank = { name: 'extrude', args: { profiles: [{ kind: 'region', plane: this.plane(), loops: [[{ t: 'circle', c: [0, 0], r: B.d / 2 }]] }], mode: 'one', d1: -this.b.L, op: 'new' } };
    return { parts: [head, shank], name: `Csavar ${this.b.size}×${this.b.L}` };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    const items = [this.hint('Koppints a hely megadásához (rács vagy lap)')];
    items.push({ type: 'chips', key: 'kind', value: this.kind, options: [{ value: 'gear', label: 'Fogaskerék', icon: 'gear' }, { value: 'bolt', label: 'Csavar', icon: 'bolt' }, { value: 'nut', label: 'Anya', icon: 'nut' }] });
    if (this.kind === 'gear') {
      const rp = (this.g.m * this.g.z) / 2;
      items.push(
        { type: 'number', key: 'm', label: 'Modul', kind: 'num', value: this.g.m },
        { type: 'number', key: 'z', label: 'Fogszám', kind: 'int', value: this.g.z },
        { type: 'number', key: 't', label: 'Vastagság', kind: 'len', value: this.g.t },
        { type: 'number', key: 'bore', label: 'Furat Ø', kind: 'len', value: this.g.bore },
        { type: 'number', key: 'alpha', label: 'Kapcsolószög', kind: 'angle', value: this.g.alpha },
        { type: 'info', text: `Osztókör Ø ${String(Math.round(rp * 200) / 100).replace('.', ',')} mm · tengelytáv párhoz: m·(z₁+z₂)/2` },
      );
    } else {
      items.push({ type: 'chips', key: 'size', value: this.b.size, options: Object.keys(BOLTS).map((k) => ({ value: k, label: k })) });
      if (this.kind === 'bolt') items.push({ type: 'number', key: 'L', label: 'Hossz', kind: 'len', value: this.b.L });
      items.push({ type: 'info', text: 'Egyszerűsített (menet nélküli) modell' });
    }
    return { title: this.label, icon: this.icon, items, doneDisabled: !this.args() };
  }

  change(k, v) {
    if (k === 'kind') {
      this.kind = v;
    } else if (this.kind === 'gear') {
      if (k === 'z') v = Math.max(6, Math.min(300, Math.round(v)));
      this.g[k] = v;
    } else {
      this.b[k] = v;
    }
    this.update();
  }

  async done() {
    this.app.gearParams = { ...this.g };
    this.app.boltParams = { ...this.b };
    await super.done();
  }
}
