// Test szétvágása síkkal / lappal
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { refOf, selectedBodyIds, bodiesBox, planeFromSel, MAIN_PLANES } from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class SplitTool extends KernelTool {
  get toolId() { return 'split'; }
  get opName() { return 'split'; }
  get label() { return 'Szétvágás'; }
  get icon() { return 'split'; }
  get clearOnEmptyTap() { return false; }

  start() {
    const bodySel = this.app.sel.filter((s) => s.type === 'body');
    this.bodyId = (bodySel[0] || this.app.sel.find((s) => s.bodyId) || {}).bodyId;
    if (!this.bodyId) throw new Error('Jelölj ki egy testet (dupla koppintás)');
    const planeSel = this.app.sel.find((s) => s.type === 'plane' || (s.type === 'face' && bodySel.length));
    this.plane = planeFromSel(this.app, planeSel);
    this.main = this.plane ? null : 'XY';
    this.box = bodiesBox(this.app, [this.bodyId]);
    this.offset = 0;
    this.makeHandle();
    this.update();
  }

  base() {
    if (this.plane) return { origin: this.plane.origin.clone(), normal: this.plane.normal.clone() };
    return { origin: this.box.getCenter(V()), normal: MAIN_PLANES[this.main].normal.clone() };
  }

  makeHandle() {
    this.clearHandles();
    const b = this.base();
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: b.origin, dir: b.normal, value: this.offset,
      onChange: (v) => { this.offset = v; this.update(); },
      onTap: () => this.app.ui.keypad({ label: 'Eltolás', kind: 'len', value: this.offset, onDone: (v) => { this.offset = v; this.arrow.setValue(v); this.update(); } }),
    }));
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    const pl = planeFromSel(this.app, it);
    if (pl) { this.plane = pl; this.main = null; this.offset = 0; this.makeHandle(); this.update(); }
    return true;
  }

  args() {
    const b = this.base();
    const o = b.origin.clone().addScaledVector(b.normal, this.offset);
    return { body: refOf(this.app, this.bodyId), tool: { kind: 'plane', origin: o.toArray(), normal: b.normal.toArray() } };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Szétvágás', icon: 'split',
      items: [
        this.hint(this.plane ? `Sík: ${this.plane.label}` : 'Koppints egy lapra / síkra, vagy válassz fő síkot'),
        { type: 'chips', key: 'main', value: this.main, options: ['XY', 'XZ', 'YZ'].map((k) => ({ value: k, label: k })) },
        { type: 'number', key: 'offset', label: 'Eltolás', kind: 'len', value: this.offset },
      ],
      doneDisabled: !!this.error,
    };
  }

  change(k, v) {
    if (k === 'main') { this.main = v; this.plane = null; this.offset = 0; this.makeHandle(); }
    if (k === 'offset') { this.offset = v; this.arrow.setValue(v); }
    this.update();
  }
}
