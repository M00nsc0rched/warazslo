// Kihúzás (tolás/húzás) régiókból és sík lapokból
import { KernelTool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { profilesFromSelection, bodyUnderPoint, axisSnapper, visibleBodyRefs, refOf } from './common.js';

const OPS = [
  { value: 'auto', label: 'Auto' },
  { value: 'new', label: 'Új test' },
  { value: 'join', label: 'Egyesítés' },
  { value: 'cut', label: 'Kivágás' },
  { value: 'intersect', label: 'Metszet' },
];

export class ExtrudeTool extends KernelTool {
  get toolId() { return 'extrude'; }
  get opName() { return 'extrude'; }
  get label() { return 'Kihúzás'; }
  get icon() { return 'extrude'; }

  start() {
    this.items = profilesFromSelection(this.app);
    if (!this.items.length) throw new Error('Jelölj ki egy vázlatrégiót vagy egy sík lapot a kihúzáshoz');
    const first = this.items[0];
    // a profilok azonos irányba kell, hogy mutassanak: a normálist az első határozza meg
    this.normal = first.normal.clone().normalize();
    this.origin = first.center.clone();
    this.mode = 'one';
    this.op = 'auto';
    this.d1 = 0;
    this.d2 = 0;
    // alapréteg: melyik test "alatt" van a régió
    this.base = null;
    if (first.bodyId) this.base = { bodyId: first.bodyId, side: 1 };
    else {
      const u = bodyUnderPoint(this.app, first.center, this.normal);
      if (u) this.base = u;
    }
    const snapper = axisSnapper(this.app, this.origin, this.normal, new Set(first.bodyId ? [first.bodyId] : []));
    this.a1 = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: this.origin, dir: this.normal, value: 0, label: '',
      snap: snapper,
      onChange: (v) => { this.d1 = v; this.update(); },
      onTap: () => this.editValue('d1'),
    }));
    this.a2 = null;
    this.refreshPanel();
  }

  ensureSecondArrow() {
    if (this.mode === 'two' && !this.a2) {
      this.a2 = this.addHandle(new ArrowHandle(this.app.handles, {
        origin: this.origin, dir: this.normal.clone().negate(), value: this.d2, color: 0x7a5cff, min: 0,
        onChange: (v) => { this.d2 = v; this.update(); },
        onTap: () => this.editValue('d2'),
      }));
    } else if (this.mode !== 'two' && this.a2) {
      this.removeHandle(this.a2);
      this.a2 = null;
    }
  }

  editValue(key) {
    const h = key === 'd1' ? this.a1 : this.a2;
    this.app.ui.keypad({
      label: key === 'd1' ? 'Kihúzás távolsága' : 'Második irány', kind: 'len', value: this[key], anchor: h && h.bubble ? h.bubble.elm : null,
      onDone: (v) => { this[key] = key === 'd2' ? Math.abs(v) : v; h && h.setValue(this[key]); this.update(); },
    });
  }

  /** Az "Auto" művelet feloldása. */
  resolveOp() {
    const d = this.mode === 'one' ? this.d1 : this.d1;
    if (this.op !== 'auto') {
      let targets;
      if (this.base) targets = [refOf(this.app, this.base.bodyId)];
      else targets = visibleBodyRefs(this.app);
      if (this.op === 'cut' || this.op === 'intersect') targets = visibleBodyRefs(this.app);
      return { op: this.op, targets: targets.filter(Boolean) };
    }
    if (!this.base) return { op: 'new', targets: [] };
    const outward = this.base.side * d > 0; // a testtől elfelé
    if (this.mode === 'sym' || this.mode === 'two') return { op: 'join', targets: [refOf(this.app, this.base.bodyId)] };
    return outward ? { op: 'join', targets: [refOf(this.app, this.base.bodyId)] } : { op: 'cut', targets: [refOf(this.app, this.base.bodyId)] };
  }

  args() {
    const nonzero = this.mode === 'two' ? Math.abs(this.d1) + Math.abs(this.d2) > 1e-6 : Math.abs(this.d1) > 1e-6;
    if (!nonzero) return null;
    const { op, targets } = this.resolveOp();
    this.resolved = op;
    return { profiles: this.items.map((i) => i.profile), mode: this.mode, d1: this.d1, d2: this.d2, op, targets };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    const opLabel = { new: 'új test', join: 'egyesítés', cut: 'kivágás', intersect: 'metszet' }[this.resolved] || '';
    return {
      title: 'Kihúzás', icon: 'extrude',
      items: [
        this.hint(this.d1 === 0 ? 'Húzd a nyilat, vagy koppints az értékre' : this.op === 'auto' && opLabel ? `Automatikus: ${opLabel}` : ''),
        { type: 'chips', key: 'mode', value: this.mode, options: [{ value: 'one', label: 'Egyoldalú' }, { value: 'two', label: 'Kétoldalú' }, { value: 'sym', label: 'Szimmetrikus' }] },
        { type: 'number', key: 'd1', label: this.mode === 'sym' ? 'Teljes' : 'Távolság', kind: 'len', value: this.d1 },
        { type: 'number', key: 'd2', label: 'Másik irány', kind: 'len', value: this.d2, hidden: this.mode !== 'two' },
        { type: 'chips', key: 'op', value: this.op, options: OPS },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(key, v) {
    if (key === 'mode') { this.mode = v; this.ensureSecondArrow(); if (v === 'sym') { this.d1 = Math.abs(this.d1); this.a1.setValue(this.d1); } }
    else if (key === 'd1') { this.d1 = v; this.a1.setValue(v); }
    else if (key === 'd2') { this.d2 = Math.abs(v); if (this.a2) this.a2.setValue(this.d2); }
    else if (key === 'op') this.op = v;
    this.update();
  }

  async done() {
    const sketchIds = [...new Set(this.items.filter((i) => i.sketchId).map((i) => i.sketchId))];
    await super.done();
    // a felhasznált vázlatokat elrejtjük (az Elemek panelen visszakapcsolhatók)
    if (!this.committing) return;
    for (const id of sketchIds) {
      const sk = this.app.doc.sketch(id);
      if (!sk) continue;
      // csak akkor rejtjük el, ha a vázlat minden régióját felhasználtuk
      const used = new Set(this.items.filter((i) => i.sketchId === id).map((i) => i.profile.loops.length + ':' + i.area.toFixed(6)));
      const all = this.app.sketches.regions(sk);
      if (all.length <= used.size) this.app.doc.setHidden(id, true);
    }
  }
}
