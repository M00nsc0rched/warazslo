// Boole-műveletek: egyesítés, kivonás, metszet
import { KernelTool } from './base.js';
import { refOf } from './common.js';

export class BooleanTool extends KernelTool {
  get toolId() { return 'boolean'; }
  get opName() { return 'boolean'; }
  get label() { return { union: 'Egyesítés', subtract: 'Kivonás', intersect: 'Metszet' }[this.type]; }
  get icon() { return { union: 'union', subtract: 'subtract', intersect: 'intersect' }[this.type]; }
  get clearOnEmptyTap() { return false; }

  constructor(app, opts) {
    super(app, opts);
    this.type = opts.type || 'union';
    this.keep = false;
  }

  start() {
    const ids = [...new Set(this.app.sel.filter((s) => s.bodyId).map((s) => s.bodyId))];
    this.target = ids[0] || null;
    this.tools = ids.slice(1);
    this.slot = this.target ? 'tools' : 'target';
    this.update();
  }

  /** Koppintással a célt / szerszámtesteket választjuk. */
  tap(ev) {
    const it = this.app.pickItem(ev, { sketches: false });
    if (!it || !it.bodyId) return true;
    const id = it.bodyId;
    if (this.slot === 'target') {
      this.target = id;
      this.tools = this.tools.filter((x) => x !== id);
      this.slot = 'tools';
    } else {
      if (id === this.target) return true;
      this.tools = this.tools.includes(id) ? this.tools.filter((x) => x !== id) : [...this.tools, id];
    }
    this.app.setSelection([...(this.target ? [{ type: 'body', bodyId: this.target }] : []), ...this.tools.map((t) => ({ type: 'body', bodyId: t }))]);
    this.update();
    return true;
  }

  args() {
    if (!this.target || !this.tools.length) return null;
    return { target: refOf(this.app, this.target), tools: this.tools.map((t) => refOf(this.app, t)), type: this.type, keepTools: this.keep };
  }

  update() { this.requestPreview(); this.refreshPanel(); }
  previewOptions() { return { ghostSources: false }; }

  panel() {
    const nm = (id) => (id ? this.app.doc.body(id)?.name || '?' : 'koppints egy testre');
    return {
      title: 'Boole-műveletek', icon: 'boolean',
      items: [
        this.hint(''),
        { type: 'chips', key: 'type', value: this.type, options: [{ value: 'union', label: 'Egyesítés', icon: 'union' }, { value: 'subtract', label: 'Kivonás', icon: 'subtract' }, { value: 'intersect', label: 'Metszet', icon: 'intersect' }] },
        { type: 'slot', key: 'target', label: 'Céltest', value: nm(this.target), empty: !this.target, active: this.slot === 'target' },
        { type: 'slot', key: 'tools', label: 'Szerszám', value: this.tools.length ? `${this.tools.length} test` : 'koppints testekre', empty: !this.tools.length, active: this.slot === 'tools' },
        { type: 'toggle', key: 'keep', label: 'Szerszám megtartása', value: this.keep },
      ],
      doneDisabled: !this.args(),
    };
  }

  change(k, v) {
    if (k === 'type') this.type = v;
    if (k === 'keep') this.keep = v;
    if (k === 'target' || k === 'tools') this.slot = k;
    this.update();
  }
}
