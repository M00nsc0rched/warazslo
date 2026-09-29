// Alaptestek beszúrása: doboz, henger, gömb, kúp, tórusz, ék
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { canonicalFrame } from '../sketch/manager.js';
import { faceInfo, V3, refOf, axisSnapper } from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const DEFS = {
  box: { title: 'Doboz', icon: 'box', p: { w: 40, d: 30, h: 20 }, fields: [['w', 'Szélesség'], ['d', 'Mélység'], ['h', 'Magasság']], hKey: 'h' },
  cylinder: { title: 'Henger', icon: 'cylinder', p: { r: 15, h: 30 }, fields: [['r', 'Sugár'], ['h', 'Magasság']], hKey: 'h' },
  sphere: { title: 'Gömb', icon: 'sphere', p: { r: 20 }, fields: [['r', 'Sugár']], hKey: 'r' },
  cone: { title: 'Kúp', icon: 'cone', p: { r1: 20, r2: 0, h: 30 }, fields: [['r1', 'Alsó sugár'], ['r2', 'Felső sugár'], ['h', 'Magasság']], hKey: 'h' },
  torus: { title: 'Tórusz', icon: 'torus', p: { R: 25, r: 6 }, fields: [['R', 'Gyűrű sugár'], ['r', 'Cső sugár']], hKey: null },
  wedge: { title: 'Ék', icon: 'wedge', p: { w: 40, d: 20, h: 25 }, fields: [['w', 'Hossz'], ['d', 'Szélesség'], ['h', 'Magasság']], hKey: 'h' },
};

export class PrimitiveTool extends KernelTool {
  get toolId() { return 'primitive'; }
  get opName() { return 'primitive'; }
  get label() { return this.def.title; }
  get icon() { return this.def.icon; }
  get allowsSelection() { return false; }

  constructor(app, opts) {
    super(app, opts);
    this.type = opts.type || 'box';
    this.def = DEFS[this.type];
    const saved = (app.primParams || {})[this.type];
    this.p = { ...this.def.p, ...(saved || {}) };
    this.centered = this.type !== 'wedge';
    this.op = 'new';
    this.onBody = null;
  }

  start() {
    // elhelyezés: a rácssík origója, vagy egy kijelölt sík lap közepe
    const f = this.app.sel.find((s) => s.type === 'face');
    const fi = f ? faceInfo(this.app, f.bodyId, f.index) : null;
    if (fi && fi.type === 'PLANE') { this.frame = canonicalFrame(V3(fi.normal), V3(fi.center)); this.frame.origin = V3(fi.center); this.onBody = f.bodyId; this.op = 'join'; }
    else {
      const g = this.app.vp.gridFrame;
      this.frame = { origin: g.origin.clone(), xDir: g.xDir.clone(), yDir: g.yDir.clone(), normal: g.normal.clone() };
    }
    this.makeHandle();
    this.update();
  }

  makeHandle() {
    this.clearHandles();
    const k = this.def.hKey;
    if (!k) return;
    const base = this.type === 'sphere' ? this.frame.origin.clone() : this.frame.origin.clone();
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: base, dir: this.frame.normal.clone(), value: this.p[k], min: 0.01,
      snap: axisSnapper(this.app, base, this.frame.normal.clone()),
      onChange: (v) => { this.p[k] = v; this.update(); },
      onTap: () => this.edit(k),
    }));
  }

  edit(k) {
    const f = this.def.fields.find((x) => x[0] === k);
    this.app.ui.keypad({ label: f ? f[1] : k, kind: 'len', value: this.p[k], onDone: (v) => { this.p[k] = v; if (this.arrow && k === this.def.hKey) this.arrow.setValue(v); this.update(); } });
  }

  tap(ev) {
    // új elhelyezés a koppintás helyén
    const hit = this.app.picker.raycastBodies(ev.x, ev.y);
    if (hit && hit.face >= 0) {
      const fi = faceInfo(this.app, hit.bodyId, hit.face);
      if (fi && fi.type === 'PLANE') {
        this.frame = canonicalFrame(V3(fi.normal), hit.point);
        this.frame.origin = hit.point.clone();
        this.onBody = hit.bodyId;
        if (this.op === 'new') this.op = 'join';
        this.snapOrigin();
        this.makeHandle();
        this.update();
        return true;
      }
    }
    const g = this.app.vp.gridFrame;
    const p = this.app.vp.rayPlane(ev.x, ev.y, g.origin, g.normal);
    if (p) {
      this.frame = { origin: p, xDir: g.xDir.clone(), yDir: g.yDir.clone(), normal: g.normal.clone() };
      this.onBody = null;
      if (this.op === 'join') this.op = 'new';
      this.snapOrigin();
      this.makeHandle();
      this.update();
    }
    return true;
  }

  snapOrigin() {
    const s = this.app.vp.gridSpacing || 1;
    const o = this.frame.origin;
    if (this.app.settings.snapping) o.set(Math.round(o.x / s) * s, Math.round(o.y / s) * s, Math.round(o.z / s) * s);
  }

  args() {
    const f = this.frame;
    const frame = { origin: f.origin.toArray(), xDir: f.xDir.toArray(), yDir: f.yDir.toArray(), normal: f.normal.toArray() };
    const p = { ...this.p, centered: this.centered };
    const targets = this.op !== 'new' ? (this.onBody ? [refOf(this.app, this.onBody)] : this.app.doc.state.bodies.filter((b) => !this.app.doc.isHidden(b.id)).map((b) => ({ id: b.id, rev: b.rev }))) : [];
    return { type: this.type, p, frame, op: this.op, targets };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    const items = [this.hint('Koppints a hely megadásához (rács vagy egy lap)')];
    for (const [k, l] of this.def.fields) items.push({ type: 'number', key: k, label: l, kind: 'len', value: this.p[k] });
    if (this.type === 'box') items.push({ type: 'toggle', key: 'centered', label: 'Középre', value: this.centered });
    items.push({ type: 'chips', key: 'op', value: this.op, options: [{ value: 'new', label: 'Új test' }, { value: 'join', label: 'Egyesítés' }, { value: 'cut', label: 'Kivágás' }] });
    return { title: this.def.title, icon: this.def.icon, items };
  }

  change(k, v) {
    if (k === 'op') this.op = v;
    else if (k === 'centered') this.centered = v;
    else { this.p[k] = v; if (this.arrow && k === this.def.hKey) this.arrow.setValue(v); }
    this.update();
  }

  async done() {
    this.app.primParams = { ...(this.app.primParams || {}), [this.type]: { ...this.p } };
    await super.done();
  }
}
