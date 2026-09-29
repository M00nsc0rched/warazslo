// Lekerekítés és élletörés
import * as THREE from 'three';
import { KernelTool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { refOf, V3 } from './common.js';

export class FilletTool extends KernelTool {
  get toolId() { return this.mode === 'chamfer' ? 'chamfer' : 'fillet'; }
  get opName() { return this.mode === 'chamfer' ? 'chamfer' : 'fillet'; }
  get label() { return this.mode === 'chamfer' ? 'Élletörés' : 'Lekerekítés'; }
  get icon() { return this.mode === 'chamfer' ? 'chamfer' : 'fillet'; }

  constructor(app, opts) {
    super(app, opts);
    this.mode = opts.mode || app.lastFilletMode || 'fillet';
    this.r = app.lastFilletR || 0;
  }

  start() {
    const sel = this.app.sel.filter((s) => s.type === 'edge' || s.type === 'face');
    if (!sel.length) throw new Error('Jelölj ki éleket vagy lapokat a lekerekítéshez');
    this.bodyId = sel[0].bodyId;
    const same = sel.filter((s) => s.bodyId === this.bodyId);
    if (same.length < sel.length) this.app.ui.toast('Egyszerre egy test éleit kerekítjük', '', 2200);
    this.edges = same.filter((s) => s.type === 'edge').map((s) => s.index);
    const faces = same.filter((s) => s.type === 'face').map((s) => s.index);
    this.ready = this.init(faces);
  }

  async init(faces) {
    const body = refOf(this.app, this.bodyId);
    if (faces.length) {
      const fe = await this.app.kernel.query('faceEdges', { body, faces });
      this.edges = [...new Set([...this.edges, ...fe])];
    }
    if (!this.edges.length || this.app.tool !== this) return;
    const fr = await this.app.kernel.query('edgeFrame', { body, edge: this.edges[0] });
    if (this.app.tool !== this) return;
    let dir = new THREE.Vector3();
    for (const n of fr.normals) dir.add(V3(n));
    if (dir.lengthSq() < 1e-9) dir = V3(fr.normals[0] || [0, 0, 1]);
    dir.normalize().negate(); // az anyag belseje felé
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: V3(fr.point), dir, value: this.r, min: 0, fixedDir: true,
      snap: (v) => { const step = (this.app.vp.gridSpacing || 1) / 2; const q = Math.round(v / step) * step; return Math.abs(q - v) < step * 0.3 ? q : v; },
      onChange: (v) => { this.r = v; this.update(); },
      onTap: () => this.editValue(),
    }));
    this.update();
  }

  editValue() {
    this.app.ui.keypad({
      label: this.mode === 'chamfer' ? 'Letörés mérete' : 'Lekerekítés sugara', kind: 'len', value: this.r,
      anchor: this.arrow && this.arrow.bubble ? this.arrow.bubble.elm : null,
      onDone: (v) => { this.r = Math.max(0, v); this.arrow && this.arrow.setValue(this.r); this.update(); },
    });
  }

  args() {
    if (!(this.r > 1e-6) || !this.edges || !this.edges.length) return null;
    const body = refOf(this.app, this.bodyId);
    return this.mode === 'chamfer' ? { body, edges: this.edges, distance: this.r } : { body, edges: this.edges, radius: this.r };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: this.label, icon: this.icon,
      items: [
        this.hint(this.edges ? `${this.edges.length} él` : 'Élek keresése…'),
        { type: 'chips', key: 'mode', value: this.mode, options: [{ value: 'fillet', label: 'Lekerekítés', icon: 'fillet' }, { value: 'chamfer', label: 'Letörés', icon: 'chamfer' }] },
        { type: 'number', key: 'r', label: this.mode === 'chamfer' ? 'Méret' : 'Sugár', kind: 'len', value: this.r },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(key, v) {
    if (key === 'mode') {
      this.mode = v;
      this.runner.dispose();
      this.runner = new (this.runner.constructor)(this.app.kernel, this.opName, (res) => this.onPreview(res), (err) => this.onPreviewError(err));
    }
    if (key === 'r') { this.r = Math.max(0, v); this.arrow && this.arrow.setValue(this.r); }
    this.update();
  }

  async done() {
    this.app.lastFilletR = this.r;
    this.app.lastFilletMode = this.mode;
    await super.done();
  }
}
