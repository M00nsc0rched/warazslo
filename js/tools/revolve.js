// Forgatás tengely körül (revolve)
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { RotateHandle } from '../view/handles.js';
import { profilesFromSelection, axisFromItem, bodyUnderPoint, refOf } from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class RevolveTool extends KernelTool {
  get toolId() { return 'revolve'; }
  get opName() { return 'revolve'; }
  get label() { return 'Forgatás'; }
  get icon() { return 'revolve'; }
  get clearOnEmptyTap() { return false; }

  start() {
    const profSel = this.app.sel.filter((s) => s.type === 'region' || s.type === 'face');
    this.items = profilesFromSelection(this.app, profSel);
    if (!this.items.length) throw new Error('Jelölj ki egy vázlatrégiót vagy sík lapot');
    // tengely: kijelölt él / vonal, különben a vázlat saját tengelye
    const axSel = this.app.sel.find((s) => (s.type === 'edge' || s.type === 'curve') && axisFromItem(this.app, s));
    this.axis = axSel ? axisFromItem(this.app, axSel) : null;
    this.axisKey = this.axis ? null : 'v';
    this.angle = 360;
    this.op = 'auto';
    const first = this.items[0];
    this.base = first.bodyId ? { bodyId: first.bodyId } : bodyUnderPoint(this.app, first.center, first.normal);
    this.makeHandle();
    this.update();
  }

  axisData() {
    if (this.axis) return this.axis;
    const f = this.items[0].frame;
    const dir = this.axisKey === 'u' ? f.xDir.clone() : f.yDir.clone();
    return { origin: f.origin.clone(), dir, label: this.axisKey === 'u' ? 'Vázlat vízszintes tengelye' : 'Vázlat függőleges tengelye' };
  }

  makeHandle() {
    this.clearHandles();
    const ax = this.axisData();
    const c = this.items[0].center.clone();
    // a tengelyre vetített pont a gyűrű középpontja
    const t = c.clone().sub(ax.origin).dot(ax.dir);
    const center = ax.origin.clone().addScaledVector(ax.dir, t);
    let ref = c.clone().sub(center);
    if (ref.lengthSq() < 1e-9) ref = new THREE.Vector3(1, 0, 0).projectOnPlane(ax.dir);
    this.ring = this.addHandle(new RotateHandle(this.app.handles, {
      center, axis: ax.dir, ref, value: this.angle, radiusPx: 80, min: -360, max: 360,
      onChange: (v) => { this.angle = v; this.update(); },
      onTap: () => this.app.ui.keypad({ label: 'Szög', kind: 'angle', value: this.angle, onDone: (v) => { this.angle = v; this.ring.setValue(v); this.update(); } }),
    }));
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    const ax = axisFromItem(this.app, it);
    if (ax) { this.axis = ax; this.axisKey = null; this.makeHandle(); this.update(); }
    return true;
  }

  args() {
    if (Math.abs(this.angle) < 1e-6) return null;
    const ax = this.axisData();
    let op = this.op, targets = [];
    if (op === 'auto') op = this.base ? 'join' : 'new';
    if (op !== 'new') targets = this.base ? [refOf(this.app, this.base.bodyId)] : this.app.doc.state.bodies.filter((b) => !this.app.doc.isHidden(b.id)).map((b) => ({ id: b.id, rev: b.rev }));
    return { profiles: this.items.map((i) => i.profile), axis: { origin: ax.origin.toArray(), dir: ax.dir.toArray() }, angle: this.angle, op, targets };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Forgatás tengely körül', icon: 'revolve',
      items: [
        this.hint(`Tengely: ${this.axisData().label} – koppints egy élre / vonalra a cseréhez`),
        { type: 'chips', key: 'axisKey', value: this.axisKey, options: [{ value: 'u', label: 'Vízsz. tengely' }, { value: 'v', label: 'Függ. tengely' }] },
        { type: 'number', key: 'angle', label: 'Szög', kind: 'angle', value: this.angle },
        { type: 'chips', key: 'op', value: this.op, options: [{ value: 'auto', label: 'Auto' }, { value: 'new', label: 'Új test' }, { value: 'join', label: 'Egyesítés' }, { value: 'cut', label: 'Kivágás' }] },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'axisKey') { this.axisKey = v; this.axis = null; this.makeHandle(); }
    if (k === 'angle') { this.angle = v; this.ring && this.ring.setValue(v); }
    if (k === 'op') this.op = v;
    this.update();
  }

  async done() {
    const sketchIds = [...new Set(this.items.filter((i) => i.sketchId).map((i) => i.sketchId))];
    await super.done();
    if (this.committing) for (const id of sketchIds) if (this.app.sketches.regions(this.app.doc.sketch(id) || { curves: [] }).length <= this.items.length) this.app.doc.setHidden(id, true);
  }
}
