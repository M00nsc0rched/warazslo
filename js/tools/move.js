// Mozgatás / forgatás és méretezés
import * as THREE from 'three';
import { Tool } from './base.js';
import { MoveGizmo, ArrowHandle } from '../view/handles.js';
import { selectedBodyIds, bodiesBox, refOf } from './common.js';
import { planeFromJSON, planeToJSON, frameMatrix, toWorld } from '../sketch/manager.js';
import { curvePolyline } from '../sketch/geom2d.js';
import { uid } from '../util/misc.js';
import { newSketchId } from '../doc/document.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function toRowMajor(m) {
  const e = m.elements; // oszlopfolytonos
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
}

/** A kijelölésből érintett vázlatok (teljes vázlat mozgatás). */
function selectedSketchIds(app) {
  return [...new Set(app.sel.filter((s) => s.sketchId).map((s) => s.sketchId))];
}

function sketchBox(app, id) {
  const sk = app.doc.sketch(id);
  const box = new THREE.Box3();
  if (!sk) return box;
  const f = planeFromJSON(sk.plane);
  for (const c of sk.curves) for (const p of (c.t === 'point' ? [c.p] : curvePolyline(c))) box.expandByPoint(toWorld(f, p));
  return box;
}

export class MoveTool extends Tool {
  get toolId() { return 'move'; }
  get allowsSelection() { return false; }

  start() {
    this.bodyIds = selectedBodyIds(this.app);
    this.sketchIds = selectedSketchIds(this.app);
    this.planeIds = this.app.sel.filter((s) => s.type === 'plane').map((s) => s.planeId);
    if (!this.bodyIds.length && !this.sketchIds.length && !this.planeIds.length) throw new Error('Jelölj ki testet vagy vázlatot a mozgatáshoz');
    const box = bodiesBox(this.app, this.bodyIds);
    for (const id of this.sketchIds) box.union(sketchBox(this.app, id));
    for (const id of this.planeIds) box.expandByPoint(planeFromJSON(this.app.doc.plane(id)).origin);
    this.center = box.isEmpty() ? V() : box.getCenter(V());
    this.copy = false;
    this.t = V();
    this.axisIdx = 2;
    this.angle = 0;
    this.savedSel = this.app.sel;
    this.app.bodies.setSelection([]);
    this.gizmo = this.addHandle(new MoveGizmo(this.app.handles, {
      center: this.center,
      snap: (d) => { const s = this.app.vp.gridSpacing || 1; const q = Math.round(d / s) * s; return this.app.settings.snapping && Math.abs(q - d) < s * 0.35 ? q : d; },
      onChange: (st) => {
        this.t.copy(st.translate);
        if (st.rotAxis) { this.axisIdx = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)].findIndex((a) => Math.abs(a.dot(st.rotAxis)) > 0.99); this.angle = st.rotAngle; }
        this.preview();
        this.refreshPanel();
      },
      onTapValue: (kind, i) => this.editValue(kind, i),
    }));
    this.preview();
  }

  matrix() {
    const c = this.center;
    const R = new THREE.Matrix4();
    if (this.angle) {
      const ax = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)][this.axisIdx];
      R.makeRotationAxis(ax, THREE.MathUtils.degToRad(this.angle));
    }
    return new THREE.Matrix4().makeTranslation(c.x + this.t.x, c.y + this.t.y, c.z + this.t.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }

  preview() {
    const M = this.matrix();
    for (const id of this.bodyIds) {
      const g = this.app.bodies.gfx.get(id);
      if (!g) continue;
      g.group.matrixAutoUpdate = false;
      g.group.matrix.copy(M);
      g.group.matrixWorldNeedsUpdate = true;
    }
    for (const id of this.sketchIds) {
      const g = this.app.sketches.gfx.get(id);
      if (!g) continue;
      g.group.matrix.copy(M).multiply(frameMatrix(g.frame));
      g.group.matrixWorldNeedsUpdate = true;
    }
    this.app.vp.requestRender();
  }

  resetPreview() {
    for (const id of this.bodyIds) {
      const g = this.app.bodies.gfx.get(id);
      if (!g) continue;
      g.group.matrix.identity();
      g.group.matrixAutoUpdate = true;
      g.group.matrixWorldNeedsUpdate = true;
    }
    for (const id of this.sketchIds) {
      const g = this.app.sketches.gfx.get(id);
      if (g) { g.group.matrix.copy(frameMatrix(g.frame)); g.group.matrixWorldNeedsUpdate = true; }
    }
    this.app.vp.requestRender();
  }

  stop() {
    super.stop();
    this.resetPreview();
    if (this.app.doc) this.app._applySelectionVisuals();
  }

  editValue(kind, i) {
    if (kind === 'ring') {
      this.app.ui.keypad({ label: `Forgatás (${'XYZ'[i]} tengely)`, kind: 'angle', value: this.angle, onDone: (v) => { this.axisIdx = i; this.angle = v; this.gizmo.set(null, i, v); this.preview(); this.refreshPanel(); } });
    } else {
      const k = kind === 'axis' ? 'xyz'[i] : 'x';
      this.editAxis(k);
    }
  }

  editAxis(k) {
    this.app.ui.keypad({ label: `Eltolás ${k.toUpperCase()}`, kind: 'len', value: this.t[k], onDone: (v) => { this.t[k] = v; this.gizmo.set(this.t); this.preview(); this.refreshPanel(); } });
  }

  panel() {
    return {
      title: 'Mozgatás / forgatás', icon: 'move',
      items: [
        { type: 'number', key: 'x', label: 'X', kind: 'len', value: this.t.x },
        { type: 'number', key: 'y', label: 'Y', kind: 'len', value: this.t.y },
        { type: 'number', key: 'z', label: 'Z', kind: 'len', value: this.t.z },
        { type: 'chips', key: 'axis', value: this.axisIdx, options: [{ value: 0, label: '⟳X' }, { value: 1, label: '⟳Y' }, { value: 2, label: '⟳Z' }] },
        { type: 'number', key: 'angle', label: 'Szög', kind: 'angle', value: this.angle },
        { type: 'toggle', key: 'copy', label: 'Másolat', value: this.copy },
      ],
    };
  }

  change(k, v) {
    if (k === 'x' || k === 'y' || k === 'z') { this.t[k] = v; this.gizmo.set(this.t); }
    if (k === 'axis') { this.axisIdx = v; this.gizmo.set(null, v, this.angle); }
    if (k === 'angle') { this.angle = v; this.gizmo.set(null, this.axisIdx, v); }
    if (k === 'copy') this.copy = v;
    this.preview();
    this.refreshPanel();
  }

  async done() {
    const M = this.matrix();
    if (M.equals(new THREE.Matrix4())) { this.app.setTool(null); return; }
    const app = this.app;
    const label = this.copy ? 'Másolat mozgatással' : this.angle && this.t.lengthSq() === 0 ? 'Forgatás' : 'Mozgatás';
    const rot = new THREE.Matrix3().setFromMatrix4(M);
    const tf = (f) => ({
      origin: f.origin.clone().applyMatrix4(M).toArray(),
      xDir: f.xDir.clone().applyMatrix3(rot).normalize().toArray(),
      yDir: f.yDir.clone().applyMatrix3(rot).normalize().toArray(),
      normal: f.normal.clone().applyMatrix3(rot).normalize().toArray(),
    });
    const sketchIds = this.sketchIds, planeIds = this.planeIds, copy = this.copy;
    const after = (state) => {
      let sketches = state.sketches;
      let counters = state.counters;
      for (const id of sketchIds) {
        const s = sketches.find((x) => x.id === id);
        if (!s) continue;
        const np = tf(planeFromJSON(s.plane));
        if (copy) { counters = { ...counters, sketch: (counters.sketch || 0) + 1 }; sketches = [...sketches, { ...s, id: newSketchId(), name: `Vázlat ${counters.sketch}`, plane: np }]; }
        else sketches = sketches.map((x) => (x.id === id ? { ...x, plane: np } : x));
      }
      let planes = state.planes;
      for (const id of planeIds) {
        const p = planes.find((x) => x.id === id);
        if (!p) continue;
        const np = tf(planeFromJSON(p));
        planes = copy ? [...planes, { ...p, ...np, id: uid('pl'), name: `${p.name} másolat` }] : planes.map((x) => (x.id === id ? { ...x, ...np } : x));
      }
      return { ...state, sketches, planes, counters };
    };
    try {
      if (this.bodyIds.length) {
        const res = await app.kernel.op('transform', { bodies: this.bodyIds.map((id) => refOf(app, id)), matrix: toRowMajor(M), copy }, true);
        this.resetPreview();
        await app.commitKernelResult(label, res, { icon: 'move', after });
      } else {
        this.resetPreview();
        app.doc.commit(label, after(app.doc.state), { icon: 'move' });
      }
      app.setTool(null);
    } catch (e) {
      app.ui.toast(e.message, 'error', 4000);
    }
  }
}

export class ScaleTool extends Tool {
  get toolId() { return 'scale'; }
  get allowsSelection() { return false; }

  start() {
    this.bodyIds = selectedBodyIds(this.app);
    if (!this.bodyIds.length) throw new Error('Jelölj ki egy vagy több testet');
    const box = bodiesBox(this.app, this.bodyIds);
    this.box = box;
    this.centerMode = 'center';
    this.factor = 1;
    this.copy = false;
    this.R0 = Math.max(box.getSize(V()).length() / 2, 1);
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: this.center(), dir: V(1, 0, 0), value: this.R0, min: this.R0 * 0.01, fixedDir: true,
      display: () => 0,
      onChange: (v) => { this.factor = Math.round((v / this.R0) * 1000) / 1000; this.preview(); this.refreshPanel(); },
      onTap: () => this.edit(),
    }));
    // a buborék a szorzót mutassa
    const upd = this.arrow.update.bind(this.arrow);
    this.arrow.update = () => { upd(); if (this.arrow.bubble) this.arrow.bubble.set(`× ${String(this.factor).replace('.', ',')}`); };
    this.preview();
  }

  center() {
    return this.centerMode === 'origin' ? V() : this.centerMode === 'bottom' ? V((this.box.min.x + this.box.max.x) / 2, (this.box.min.y + this.box.max.y) / 2, this.box.min.z) : this.box.getCenter(V());
  }

  matrix() {
    const c = this.center();
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(this.factor, this.factor, this.factor)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }

  preview() {
    const M = this.matrix();
    for (const id of this.bodyIds) {
      const g = this.app.bodies.gfx.get(id);
      if (!g) continue;
      g.group.matrixAutoUpdate = false;
      g.group.matrix.copy(M);
      g.group.matrixWorldNeedsUpdate = true;
    }
    this.app.vp.requestRender();
  }

  stop() {
    super.stop();
    for (const id of this.bodyIds) {
      const g = this.app.bodies.gfx.get(id);
      if (g) { g.group.matrix.identity(); g.group.matrixAutoUpdate = true; }
    }
    this.app.vp.requestRender();
  }

  edit() {
    this.app.ui.keypad({ label: 'Méretezési szorzó', kind: 'num', value: this.factor, onDone: (v) => { if (v > 0) { this.factor = v; this.arrow.setValue(v * this.R0); this.preview(); this.refreshPanel(); } } });
  }

  panel() {
    return {
      title: 'Méretezés', icon: 'scale',
      items: [
        { type: 'number', key: 'f', label: 'Szorzó', kind: 'num', value: this.factor },
        { type: 'chips', key: 'center', value: this.centerMode, options: [{ value: 'center', label: 'Középpont' }, { value: 'bottom', label: 'Alja' }, { value: 'origin', label: 'Origó' }] },
        { type: 'toggle', key: 'copy', label: 'Másolat', value: this.copy },
      ],
    };
  }

  change(k, v) {
    if (k === 'f' && v > 0) { this.factor = v; this.arrow.setValue(v * this.R0); }
    if (k === 'center') { this.centerMode = v; this.arrow.setFrame(this.center(), V(1, 0, 0)); }
    if (k === 'copy') this.copy = v;
    this.preview();
    this.refreshPanel();
  }

  async done() {
    if (Math.abs(this.factor - 1) < 1e-9) { this.app.setTool(null); return; }
    try {
      const res = await this.app.kernel.op('scale', { bodies: this.bodyIds.map((id) => refOf(this.app, id)), center: this.center().toArray(), factor: this.factor, copy: this.copy }, true);
      await this.app.commitKernelResult('Méretezés', res, { icon: 'scale' });
      this.app.setTool(null);
    } catch (e) { this.app.ui.toast(e.message, 'error', 4000); }
  }
}
