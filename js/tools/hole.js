// Furat varázsló: egyszerű, kúpos süllyesztés, hengeres süllyesztés; szabványos méretek
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { faceInfo, V3, refOf } from './common.js';

// metrikus csavarok: [név, átmenő furat (közepes), süllyesztő átmérő (kúpos), hengeres fej átmérő, fejmagasság, menetfúró]
const METRIC = [
  ['M2', 2.4, 4.4, 4.4, 2.2, 1.6], ['M2.5', 2.9, 5.5, 5.5, 2.7, 2.05], ['M3', 3.4, 6.6, 6.5, 3.3, 2.5], ['M4', 4.5, 8.8, 8.0, 4.4, 3.3],
  ['M5', 5.5, 11.0, 10.0, 5.4, 4.2], ['M6', 6.6, 13.2, 11.0, 6.5, 5.0], ['M8', 9.0, 17.6, 15.0, 8.6, 6.8], ['M10', 11.0, 22.0, 18.0, 10.8, 8.5], ['M12', 13.5, 26.4, 20.0, 13.0, 10.2],
];

export class HoleTool extends KernelTool {
  get toolId() { return 'hole'; }
  get opName() { return 'hole'; }
  get label() { return 'Furat'; }
  get icon() { return 'hole'; }
  get allowsSelection() { return false; }

  start() {
    const saved = this.app.holeParams || {};
    this.kind = saved.kind || 'simple';
    this.d = saved.d || 5;
    this.depth = saved.depth ?? 0;
    this.cd = saved.cd || 10;
    this.cdepth = saved.cdepth || 5;
    this.size = saved.size || null;
    this.points = [];
    const f = this.app.sel.find((s) => s.type === 'face');
    const fi = f ? faceInfo(this.app, f.bodyId, f.index) : null;
    if (fi && fi.type === 'PLANE') this.points.push({ bodyId: f.bodyId, point: V3(fi.center), normal: V3(fi.normal) });
    this.markers = new THREE.Group();
    this.app.vp.overlayScene.add(this.markers);
    this.update();
  }

  stop() { super.stop(); this.app.vp.overlayScene.remove(this.markers); }

  tap(ev) {
    const hit = this.app.picker.raycastBodies(ev.x, ev.y);
    if (!hit || hit.face < 0) return true;
    const fi = faceInfo(this.app, hit.bodyId, hit.face);
    if (!fi || fi.type !== 'PLANE') { this.app.ui.toast('Sík lapra koppints', '', 1500); return true; }
    let p = hit.point.clone();
    // illesztés körél középpontra / csúcsra
    const snaps = this.app.picker.snapPoints(ev.x, ev.y, ev.pointerType === 'touch' ? 22 : 12);
    if (snaps.length && this.app.settings.snapping) p = snaps[0].p.clone();
    this.points.push({ bodyId: hit.bodyId, point: p, normal: V3(fi.normal) });
    this.update();
    return true;
  }

  args() {
    if (!this.points.length) return null;
    // több furat: sorban, egyetlen előnézethez az első testre
    const p = this.points[0];
    return { body: refOf(this.app, p.bodyId), point: p.point.toArray(), normal: p.normal.toArray(), d: this.d, depth: this.depth, kind: this.kind, cd: this.cd, cdepth: this.cdepth, angle: 90, extra: this.points.slice(1).map((q) => ({ point: q.point.toArray(), normal: q.normal.toArray() })), targets: [...new Set(this.points.map((q) => q.bodyId))].map((id) => refOf(this.app, id)) };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    const sizes = METRIC.map((m) => ({ value: m[0], label: m[0] }));
    return {
      title: 'Furat', icon: 'hole',
      items: [
        this.hint(this.points.length ? `${this.points.length} furat – koppints további helyekre` : 'Koppints egy sík lapra a furat helyéhez'),
        { type: 'chips', key: 'kind', value: this.kind, options: [{ value: 'simple', label: 'Egyszerű' }, { value: 'countersink', label: 'Kúpos süllyesztés' }, { value: 'counterbore', label: 'Hengeres süllyesztés' }] },
        { type: 'chips', key: 'size', value: this.size, options: [...sizes.slice(2, 8)] },
        { type: 'number', key: 'd', label: 'Átmérő', kind: 'len', value: this.d },
        { type: 'number', key: 'depth', label: 'Mélység (0 = átmenő)', kind: 'len', value: this.depth },
        { type: 'number', key: 'cd', label: 'Süllyesztés Ø', kind: 'len', value: this.cd, hidden: this.kind === 'simple' },
        { type: 'number', key: 'cdepth', label: 'Süllyesztés mélység', kind: 'len', value: this.cdepth, hidden: this.kind !== 'counterbore' },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'size') {
      const m = METRIC.find((x) => x[0] === v);
      if (m) { this.size = v; this.d = m[1]; this.cd = this.kind === 'counterbore' ? m[3] : m[2]; this.cdepth = m[4]; }
    } else if (k === 'kind') {
      this.kind = v;
      const m = METRIC.find((x) => x[0] === this.size);
      if (m) this.cd = v === 'counterbore' ? m[3] : m[2];
    } else { this[k] = Math.max(0, v); if (k === 'd') this.size = null; }
    this.update();
  }

  async done() {
    this.app.holeParams = { kind: this.kind, d: this.d, depth: this.depth, cd: this.cd, cdepth: this.cdepth, size: this.size };
    await super.done();
  }
}
