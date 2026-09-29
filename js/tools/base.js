// Eszközök alaposztályai
import * as THREE from 'three';
import { PreviewRunner } from '../kernel/client.js';

export class Tool {
  constructor(app, opts = {}) {
    this.app = app;
    this.opts = opts;
    this.handles = [];
    this.bubbles = [];
  }
  get ui() { return this.app.ui; }
  get vp() { return this.app.vp; }
  get doc() { return this.app.doc; }

  start() {}
  stop() {
    this.clearHandles();
    for (const b of this.bubbles) b.remove();
    this.bubbles = [];
  }

  addHandle(h) { this.app.handles.add(h); this.handles.push(h); return h; }
  removeHandle(h) { this.app.handles.remove(h); this.handles = this.handles.filter((x) => x !== h); }
  clearHandles() { for (const h of this.handles) this.app.handles.remove(h); this.handles = []; }
  bubble(opts) { const b = this.app.handles.bubble(opts); this.bubbles.push(b); return b; }

  panel() { return null; }
  refreshPanel() { const p = this.panel(); if (p) this.app.ui.refreshPanel(p); }
  change() {}
  done() { this.app.setTool(null); }
  cancel() { this.app.setTool(null); }

  // bemenet: true = elkapva
  down() { return false; }
  move() {}
  up() {}
  pointerCancel() {}
  tap() { return false; }
  doubleTap() { return false; }
  hover() { return false; }
  key() { return false; }
  /** Engedi-e a kijelölés módosítását koppintással (alapból igen). */
  get allowsSelection() { return true; }
  onSelectionChange() {}
}

/**
 * Kernel-műveletre épülő eszköz élő előnézettel.
 * Leszármazott: opName, label, icon, args() -> objektum | null
 */
export class KernelTool extends Tool {
  constructor(app, opts) {
    super(app, opts);
    this.error = null;
    this._runner = null;
  }

  // lusta létrehozás: a leszármazott konstruktora után derül ki az opName
  get runner() {
    if (!this._runner) this._runner = new PreviewRunner(this.app.kernel, this.opName, (res) => this.onPreview(res), (err) => this.onPreviewError(err));
    return this._runner;
  }

  set runner(r) { this._runner = r; }

  get opName() { return 'noop'; }
  get label() { return 'Művelet'; }
  get icon() { return 'tools'; }
  args() { return null; }
  previewOptions() { return {}; }

  requestPreview() {
    const a = this.args();
    if (!a) { this.app.bodies.clearPreview(); this.error = null; this.refreshPanel(); return; }
    this.runner.request(a);
  }

  onPreview(res) {
    this.error = null;
    this.lastRes = res;
    this.app.bodies.showPreview(res.results, res.removed, this.previewOptions());
    this.refreshPanel();
  }

  onPreviewError(err) {
    this.error = err.message || String(err);
    this.app.bodies.clearPreview();
    this.refreshPanel();
  }

  stop() {
    super.stop();
    if (this._runner) this._runner.dispose();
    this.app.bodies.clearPreview();
  }

  /** Extra állapotmódosítás a véglegesítéskor (pl. vázlat elrejtése). */
  afterCommit(state) { return state; }

  async done() {
    const a = this.args();
    if (!a) { this.app.setTool(null); return; }
    this.committing = true;
    try {
      await this.app.commitOp(this.label, this.opName, a, { runner: this.runner, icon: this.icon, after: (s) => this.afterCommit(s) });
      this.app.setTool(null);
    } catch (e) {
      this.committing = false;
      this.app.ui.toast(e.message || String(e), 'error', 4000);
    }
  }

  hint(text) {
    return this.error ? { type: 'info', html: `<span style="color:#ff6961">⚠ ${escapeHtml(this.error)}</span>` } : { type: 'info', text };
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
