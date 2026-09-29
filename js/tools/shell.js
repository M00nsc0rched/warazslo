// Héjazás és lap eltolás
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { refOf, faceInfo, V3, bodiesBox, axisSnapper } from './common.js';

export class ShellTool extends KernelTool {
  get toolId() { return 'shell'; }
  get opName() { return 'shell'; }
  get label() { return 'Héjazás'; }
  get icon() { return 'shell'; }

  start() {
    const sel = this.app.sel.filter((s) => s.type === 'face' || s.type === 'body');
    if (!sel.length) throw new Error('Jelölj ki egy testet vagy az eltávolítandó lapo(ka)t');
    this.bodyId = sel[0].bodyId;
    this.faces = sel.filter((s) => s.type === 'face' && s.bodyId === this.bodyId).map((s) => s.index);
    this.t = this.app.lastShellT || 2;
    this.outward = false;
    let origin, dir;
    const fi = this.faces.length ? faceInfo(this.app, this.bodyId, this.faces[0]) : null;
    if (fi && fi.normal) { origin = V3(fi.point || fi.center); dir = V3(fi.normal).negate(); }
    else {
      const box = bodiesBox(this.app, [this.bodyId]);
      origin = new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      dir = new THREE.Vector3(-1, 0, 0);
    }
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin, dir, value: this.t, min: 0, fixedDir: true,
      onChange: (v) => { this.t = v; this.update(); },
      onTap: () => this.app.ui.keypad({ label: 'Falvastagság', kind: 'len', value: this.t, anchor: this.arrow.bubble.elm, onDone: (v) => { this.t = Math.max(0, v); this.arrow.setValue(this.t); this.update(); } }),
    }));
    this.update();
  }

  args() {
    if (!(this.t > 1e-6)) return null;
    return { body: refOf(this.app, this.bodyId), faces: this.faces, thickness: this.t, outward: this.outward };
  }

  update() { this.requestPreview(); this.refreshPanel(); }
  previewOptions() { return {}; }

  panel() {
    return {
      title: 'Héjazás', icon: 'shell',
      items: [
        this.hint(this.faces.length ? `${this.faces.length} lap nyitva marad` : 'Zárt üreges test (lap kijelölésével nyitható)'),
        { type: 'number', key: 't', label: 'Falvastagság', kind: 'len', value: this.t },
        { type: 'toggle', key: 'outward', label: 'Kifelé', value: this.outward },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 't') { this.t = Math.max(0, v); this.arrow.setValue(this.t); }
    if (k === 'outward') this.outward = v;
    this.update();
  }

  async done() { this.app.lastShellT = this.t; await super.done(); }
}

export class OffsetFaceTool extends KernelTool {
  get toolId() { return 'offsetFace'; }
  get opName() { return 'offsetFaces'; }
  get label() { return 'Lap eltolás'; }
  get icon() { return 'offsetFace'; }

  start() {
    const sel = this.app.sel.filter((s) => s.type === 'face');
    if (!sel.length) throw new Error('Jelölj ki egy vagy több lapot');
    this.bodyId = sel[0].bodyId;
    this.faces = sel.filter((s) => s.bodyId === this.bodyId).map((s) => s.index);
    this.d = 0;
    const fi = faceInfo(this.app, this.bodyId, this.faces[0]);
    const origin = V3(fi.point || fi.center), dir = V3(fi.normal || [0, 0, 1]);
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin, dir, value: 0,
      snap: axisSnapper(this.app, origin, dir, new Set([this.bodyId])),
      onChange: (v) => { this.d = v; this.update(); },
      onTap: () => this.app.ui.keypad({ label: 'Eltolás', kind: 'len', value: this.d, anchor: this.arrow.bubble.elm, onDone: (v) => { this.d = v; this.arrow.setValue(v); this.update(); } }),
    }));
    this.refreshPanel();
  }

  args() {
    if (Math.abs(this.d) < 1e-6) return null;
    return { body: refOf(this.app, this.bodyId), faces: this.faces, distance: this.d };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Lap eltolás', icon: 'offsetFace',
      items: [
        this.hint(this.d === 0 ? 'Húzd a nyilat: kifelé anyag hozzáadás, befelé elvétel (furat átmérő is!)' : ''),
        { type: 'number', key: 'd', label: 'Eltolás', kind: 'len', value: this.d },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) { if (k === 'd') { this.d = v; this.arrow.setValue(v); } this.update(); }
}
