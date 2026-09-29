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

/** A test kiterjedése a lap síkjától a normálissal ellentétes irányban ("Összesen" méret). */
export function extentBehind(app, bodyId, origin, dir) {
  const g = app.bodies.gfx.get(bodyId);
  if (!g) return 0;
  const v = g.data.vertices;
  let mx = 0;
  for (let i = 0; i < v.length; i += 3) {
    const d = (origin.x - v[i]) * dir.x + (origin.y - v[i + 1]) * dir.y + (origin.z - v[i + 2]) * dir.z;
    if (d > mx) mx = d;
  }
  return mx;
}

export class OffsetFaceTool extends KernelTool {
  get toolId() { return 'offsetFace'; }
  get opName() { return 'offsetFaces'; }
  get label() { return 'Lap eltolás'; }
  get icon() { return 'offsetFace'; }
  get commitOnEmptyTap() { return Math.abs(this.d) > 1e-6; }

  start() {
    const sel = this.app.sel.filter((s) => s.type === 'face');
    if (!sel.length) throw new Error('Jelölj ki egy vagy több lapot');
    this.bodyId = sel[sel.length - 1].bodyId;
    this.faces = sel.filter((s) => s.bodyId === this.bodyId).map((s) => s.index);
    this.d = this.opts.initial || 0;
    this.mode = this.app.offsetMode || 'total';
    const fi = faceInfo(this.app, this.bodyId, this.faces[this.faces.length - 1]);
    this.origin = V3(fi.point || fi.center);
    this.dir = V3(fi.normal || [0, 0, 1]);
    this.total0 = fi.type === 'PLANE' ? extentBehind(this.app, this.bodyId, this.origin, this.dir) : 0;
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: this.origin, dir: this.dir, value: this.d,
      snap: axisSnapper(this.app, this.origin, this.dir, new Set([this.bodyId])),
      onChange: (v) => { this.d = v; this.update(); },
      onTap: () => this.editValue(),
    }));
    this.applyMode();
    if (this.d) this.update(); else this.refreshPanel();
  }

  applyMode() {
    const total = this.mode === 'total' && this.total0 > 0;
    this.arrow.o.label = total ? 'Összesen' : '';
    this.arrow.o.display = total ? (v) => this.total0 + v : null;
    this.arrow.update();
  }

  editValue() {
    const total = this.mode === 'total' && this.total0 > 0;
    this.app.ui.keypad({
      label: total ? 'Teljes méret a lap irányában' : 'Eltolás', kind: 'len', value: total ? this.total0 + this.d : this.d,
      anchor: this.arrow.bubble ? this.arrow.bubble.elm : null,
      onDone: (v) => { this.d = total ? v - this.total0 : v; this.arrow.setValue(this.d); this.update(); },
    });
  }

  /** Koppintással további lapok vehetők fel ugyanazon a testen. */
  onSelectionChange() {
    const sel = this.app.sel.filter((s) => s.type === 'face' && s.bodyId === this.bodyId);
    if (!sel.length) { this.app.setTool(null); return; }
    this.faces = sel.map((s) => s.index);
    this.update();
  }

  args() {
    if (Math.abs(this.d) < 1e-6) return null;
    return { body: refOf(this.app, this.bodyId), faces: this.faces, distance: this.d };
  }

  /** A művelet után az eltolt lapok kijelölve maradnak (folytatható tolás/húzás). */
  reselectAfter() {
    return this.faces.map((i) => {
      const f = faceInfo(this.app, this.bodyId, i);
      if (!f) return null;
      const c = f.type === "PLANE" ? f.center.map((x, k) => x + f.normal[k] * this.d) : f.center;
      return { bodyId: this.bodyId, type: f.type, normal: f.type === "PLANE" ? f.normal : null, center: c };
    }).filter(Boolean);
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    const total = this.mode === 'total' && this.total0 > 0;
    return {
      title: 'Lap eltolás', icon: 'offsetFace',
      items: [
        this.hint(this.d === 0 ? 'Húzd a nyilat – kifelé anyagot ad, befelé elvesz; koppints további lapokra' : `${this.faces.length} lap`),
        { type: 'chips', key: 'mode', value: this.mode, hidden: !(this.total0 > 0), options: [{ value: 'total', label: 'Összesen' }, { value: 'offset', label: 'Eltolás' }] },
        { type: 'number', key: 'd', label: total ? 'Összesen' : 'Eltolás', kind: 'len', value: total ? this.total0 + this.d : this.d },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'mode') { this.mode = v; this.app.offsetMode = v; this.applyMode(); this.refreshPanel(); return; }
    if (k === 'd') { this.d = this.mode === 'total' && this.total0 > 0 ? v - this.total0 : v; this.arrow.setValue(this.d); }
    this.update();
  }
}
