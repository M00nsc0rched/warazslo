// Söprés (profil útvonal mentén) és átmenet (loft)
import { KernelTool } from './base.js';
import { profilesFromSelection, refOf } from './common.js';
import { planeFromJSON, toWorld } from '../sketch/manager.js';
import { curvePieces, evalAt } from '../sketch/geom2d.js';

/** Vázlatgörbék -> 3D útvonal szegmensek a kernelnek */
function curveSegs3d(app, s) {
  const sk = app.doc.sketch(s.sketchId);
  const c = sk && sk.curves.find((x) => x.id === s.curveId);
  if (!c) return [];
  const f = planeFromJSON(sk.plane);
  const W = (p) => toWorld(f, p).toArray();
  const out = [];
  if (c.t === 'line') out.push({ t: 'line', a: W(c.a), b: W(c.b) });
  else if (c.t === 'circle') out.push({ t: 'circle', c: W(c.c), r: c.r, n: f.normal.toArray() });
  else {
    for (const pc of curvePieces(c)) {
      if (pc.k === 'arc') out.push({ t: 'arc', a: W(evalAt(pc, 0)), m: W(evalAt(pc, 0.5)), b: W(evalAt(pc, 1)) });
      else if (pc.k === 'bez') out.push({ t: 'bez', p: pc.p.map(W) });
      else if (pc.k === 'line') out.push({ t: 'line', a: W(pc.a), b: W(pc.b) });
    }
  }
  return out;
}

export class SweepTool extends KernelTool {
  get toolId() { return 'sweep'; }
  get opName() { return 'sweep'; }
  get label() { return 'Söprés'; }
  get icon() { return 'sweep'; }
  get clearOnEmptyTap() { return false; }

  start() {
    this.profiles = profilesFromSelection(this.app, this.app.sel.filter((s) => s.type === 'region' || s.type === 'face'));
    this.pathItems = this.app.sel.filter((s) => s.type === 'curve' || s.type === 'edge');
    this.slot = this.profiles.length ? 'path' : 'profile';
    this.op = 'new';
    this.frenet = true;
    this.update();
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    if (!it) return true;
    if (this.slot === 'profile' && (it.type === 'region' || it.type === 'face')) {
      const p = profilesFromSelection(this.app, [it]);
      if (p.length) { this.profiles = p; this.slot = 'path'; }
    } else if (it.type === 'curve' || it.type === 'edge') {
      const k = (x) => `${x.type}:${x.sketchId || x.bodyId}:${x.curveId || x.index}`;
      this.pathItems = this.pathItems.some((x) => k(x) === k(it)) ? this.pathItems.filter((x) => k(x) !== k(it)) : [...this.pathItems, it];
    }
    this.app.setSelection([...this.pathItems]);
    this.update();
    return true;
  }

  args() {
    if (!this.profiles.length || !this.pathItems.length) return null;
    const edges = this.pathItems.filter((s) => s.type === 'edge').map((s) => ({ body: refOf(this.app, s.bodyId), edge: s.index }));
    const segs = this.pathItems.filter((s) => s.type === 'curve').flatMap((s) => curveSegs3d(this.app, s));
    return { profiles: this.profiles.map((p) => p.profile), path: { edges, segs }, op: this.op, frenet: this.frenet, targets: this.op !== 'new' ? this.app.doc.state.bodies.map((b) => ({ id: b.id, rev: b.rev })) : [] };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Söprés', icon: 'sweep',
      items: [
        this.hint(''),
        { type: 'slot', key: 'profile', label: 'Profil', value: this.profiles.length ? `${this.profiles.length} profil` : 'koppints egy régióra', empty: !this.profiles.length, active: this.slot === 'profile' },
        { type: 'slot', key: 'path', label: 'Útvonal', value: this.pathItems.length ? `${this.pathItems.length} görbe/él` : 'koppints görbékre', empty: !this.pathItems.length, active: this.slot === 'path' },
        { type: 'toggle', key: 'frenet', label: 'Profil forog', value: this.frenet },
        { type: 'chips', key: 'op', value: this.op, options: [{ value: 'new', label: 'Új test' }, { value: 'join', label: 'Egyesítés' }, { value: 'cut', label: 'Kivágás' }] },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'profile' || k === 'path') this.slot = k;
    if (k === 'op') this.op = v;
    if (k === 'frenet') this.frenet = v;
    this.update();
  }
}

export class LoftTool extends KernelTool {
  get toolId() { return 'loft'; }
  get opName() { return 'loft'; }
  get label() { return 'Átmenet'; }
  get icon() { return 'loft'; }
  get clearOnEmptyTap() { return false; }

  start() {
    this.profiles = profilesFromSelection(this.app, this.app.sel.filter((s) => s.type === 'region' || s.type === 'face'));
    this.ruled = false;
    this.op = 'new';
    this.update();
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    if (it && (it.type === 'region' || it.type === 'face')) {
      const p = profilesFromSelection(this.app, [it]);
      if (p.length) this.profiles.push(p[0]);
      this.update();
    }
    return true;
  }

  args() {
    if (this.profiles.length < 2) return null;
    return { profiles: this.profiles.map((p) => p.profile), ruled: this.ruled, op: this.op, targets: this.op !== 'new' ? this.app.doc.state.bodies.map((b) => ({ id: b.id, rev: b.rev })) : [] };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Átmenet (loft)', icon: 'loft',
      items: [
        this.hint('A profilok a kijelölés sorrendjében kapcsolódnak; koppints további régiókra'),
        { type: 'info', text: `${this.profiles.length} profil` },
        { type: 'toggle', key: 'ruled', label: 'Egyenes vonalú', value: this.ruled },
        { type: 'chips', key: 'op', value: this.op, options: [{ value: 'new', label: 'Új test' }, { value: 'join', label: 'Egyesítés' }, { value: 'cut', label: 'Kivágás' }] },
        { type: 'button', key: 'clear', label: 'Újrakezd', icon: 'undo' },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'ruled') this.ruled = v;
    if (k === 'op') this.op = v;
    if (k === 'clear') this.profiles = [];
    this.update();
  }
}
