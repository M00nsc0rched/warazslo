// Tükrözés és kiosztás (lineáris / kör menti)
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { refOf, selectedBodyIds, bodiesBox, planeFromSel, axisFromItem, MAIN_PLANES } from './common.js';
import { ArrowHandle } from '../view/handles.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class MirrorTool extends KernelTool {
  get toolId() { return 'mirror'; }
  get opName() { return 'mirror'; }
  get label() { return 'Tükrözés'; }
  get icon() { return 'mirror'; }
  get clearOnEmptyTap() { return false; }

  start() {
    this.bodyIds = selectedBodyIds(this.app, this.app.sel.filter((s) => s.type === 'body'));
    if (!this.bodyIds.length) this.bodyIds = selectedBodyIds(this.app);
    if (!this.bodyIds.length) throw new Error('Jelölj ki egy testet (dupla koppintás)');
    const planeSel = this.app.sel.find((s) => s.type === 'plane' || (s.type === 'face' && !this.app.sel.some((b) => b.type === 'body' && b.bodyId === s.bodyId) && this.app.sel.some((b) => b.type === 'body')));
    this.plane = planeFromSel(this.app, planeSel);
    this.main = this.plane ? null : 'YZ';
    this.copy = true;
    this.merge = false;
    this.update();
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    const pl = planeFromSel(this.app, it);
    if (pl) { this.plane = pl; this.main = null; this.update(); }
    return true;
  }

  planeData() {
    if (this.plane) return { origin: this.plane.origin.toArray(), normal: this.plane.normal.toArray() };
    const box = bodiesBox(this.app, this.bodyIds);
    const c = this.mainThrough === 'center' ? box.getCenter(V()) : V();
    return { origin: c.toArray(), normal: MAIN_PLANES[this.main].normal.toArray() };
  }

  args() {
    const pd = this.planeData();
    return { bodies: this.bodyIds.map((id) => refOf(this.app, id)), origin: pd.origin, normal: pd.normal, copy: this.copy, merge: this.merge };
  }

  update() { this.requestPreview(); this.refreshPanel(); }
  previewOptions() { return { ghostSources: this.copy && !this.merge }; }

  panel() {
    return {
      title: 'Tükrözés', icon: 'mirror',
      items: [
        this.hint('Koppints egy sík lapra / síkra, vagy válassz fő síkot'),
        { type: 'chips', key: 'main', value: this.main, options: [{ value: 'YZ', label: 'YZ' }, { value: 'XZ', label: 'XZ' }, { value: 'XY', label: 'XY' }] },
        { type: 'chips', key: 'through', value: this.mainThrough || 'origin', hidden: !!this.plane, options: [{ value: 'origin', label: 'Origón át' }, { value: 'center', label: 'Test közepén' }] },
        { type: 'info', text: this.plane ? `Sík: ${this.plane.label}` : '' },
        { type: 'toggle', key: 'copy', label: 'Másolat', value: this.copy },
        { type: 'toggle', key: 'merge', label: 'Egyesítés', value: this.merge },
      ],
    };
  }

  change(k, v) {
    if (k === 'main') { this.main = v; this.plane = null; }
    if (k === 'through') this.mainThrough = v;
    if (k === 'copy') this.copy = v;
    if (k === 'merge') { this.merge = v; if (v) this.copy = true; }
    this.update();
  }
}

export class PatternTool extends KernelTool {
  get toolId() { return 'pattern'; }
  get opName() { return 'pattern'; }
  get label() { return 'Kiosztás'; }
  get icon() { return this.kind === 'linear' ? 'pattern' : 'patternCirc'; }
  get clearOnEmptyTap() { return false; }

  start() {
    this.bodyIds = selectedBodyIds(this.app, this.app.sel.filter((s) => s.type === 'body'));
    if (!this.bodyIds.length) this.bodyIds = selectedBodyIds(this.app);
    if (!this.bodyIds.length) throw new Error('Jelölj ki egy testet (dupla koppintás)');
    this.kind = 'linear';
    this.count = 3;
    this.spacing = this.app.lastPatternSpacing || 20;
    this.angle = 360;
    this.dirKey = 'X';
    this.axisKey = 'Z';
    this.customAxis = null;
    this.merge = false;
    this.box = bodiesBox(this.app, this.bodyIds);
    this.makeHandle();
    this.update();
  }

  dirVec() {
    if (this.customAxis) return this.customAxis.dir.clone();
    return { X: V(1, 0, 0), Y: V(0, 1, 0), Z: V(0, 0, 1) }[this.dirKey];
  }

  makeHandle() {
    this.clearHandles();
    if (this.kind !== 'linear') return;
    const c = this.box.getCenter(V());
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: c, dir: this.dirVec(), value: this.spacing,
      onChange: (v) => { this.spacing = v; this.update(); },
      onTap: () => this.app.ui.keypad({ label: 'Távolság', kind: 'len', value: this.spacing, onDone: (v) => { this.spacing = v; this.arrow.setValue(v); this.update(); } }),
    }));
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    const ax = axisFromItem(this.app, it);
    if (ax) { this.customAxis = ax; this.makeHandle(); this.update(); }
    return true;
  }

  args() {
    const bodies = this.bodyIds.map((id) => refOf(this.app, id));
    if (this.kind === 'linear') return { bodies, kind: 'linear', dir: this.dirVec().toArray(), spacing: this.spacing, count: this.count, merge: this.merge };
    const axis = this.customAxis ? { origin: this.customAxis.origin.toArray(), dir: this.customAxis.dir.toArray() } : { origin: [0, 0, 0], dir: { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[this.axisKey] };
    return { bodies, kind: 'circular', axis, count: this.count, angle: this.angle, merge: this.merge };
  }

  update() { this.requestPreview(); this.refreshPanel(); }
  previewOptions() { return { ghostSources: false }; }

  panel() {
    const lin = this.kind === 'linear';
    return {
      title: 'Kiosztás', icon: this.icon,
      items: [
        this.hint(this.customAxis ? `Tengely: ${this.customAxis.label}` : 'Koppints egy élre / hengeres lapra saját tengelyhez'),
        { type: 'chips', key: 'kind', value: this.kind, options: [{ value: 'linear', label: 'Lineáris', icon: 'pattern' }, { value: 'circular', label: 'Kör menti', icon: 'patternCirc' }] },
        { type: 'chips', key: lin ? 'dir' : 'axis', value: this.customAxis ? null : lin ? this.dirKey : this.axisKey, options: ['X', 'Y', 'Z'].map((k) => ({ value: k, label: k })) },
        { type: 'number', key: 'count', label: 'Darab', kind: 'int', value: this.count },
        { type: 'number', key: 'spacing', label: 'Távolság', kind: 'len', value: this.spacing, hidden: !lin },
        { type: 'number', key: 'angle', label: 'Szög', kind: 'angle', value: this.angle, hidden: lin },
        { type: 'toggle', key: 'merge', label: 'Egyesítés', value: this.merge },
      ],
    };
  }

  change(k, v) {
    if (k === 'kind') { this.kind = v; this.customAxis = null; this.makeHandle(); }
    if (k === 'dir') { this.dirKey = v; this.customAxis = null; this.makeHandle(); }
    if (k === 'axis') { this.axisKey = v; this.customAxis = null; }
    if (k === 'count') this.count = Math.max(2, Math.min(200, Math.round(v)));
    if (k === 'spacing') { this.spacing = v; this.arrow && this.arrow.setValue(v); }
    if (k === 'angle') this.angle = v;
    if (k === 'merge') this.merge = v;
    this.update();
  }

  async done() { this.app.lastPatternSpacing = this.spacing; await super.done(); }
}
