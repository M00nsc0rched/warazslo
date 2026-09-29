// Dokumentum állapot + visszavonás/újra.
// Az állapot megváltoztathatatlan objektum; minden módosítás új állapotot készít (strukturális megosztással).
import { Emitter, uid } from '../util/misc.js';

export const BODY_COLORS = ['#c3c7ea', '#9fc6e8', '#e8c39f', '#b8e0b0', '#e6a9b6', '#d6d0a4', '#c9b4e6', '#a9d9d6'];

export function emptyState() {
  return {
    version: 1,
    bodies: [],     // { id, name, rev, brep, color }
    sketches: [],   // { id, name, plane:{origin,xDir,yDir,normal}, curves:[] }
    planes: [],     // { id, name, origin, xDir, yDir, normal, size }
    images: [],     // referencia képek { id, name, dataUrl, plane, w, h, opacity }
    variables: [],  // { name, expr }
    counters: { body: 0, sketch: 0, plane: 0, image: 0 },
    meta: { material: 'plastic' },
  };
}

const MAX_UNDO = 120;

export class DocumentStore extends Emitter {
  constructor(project) {
    super();
    this.projectId = project.id;
    this.name = project.name;
    this.state = project.state || emptyState();
    this.view = project.view || { hidden: [] };   // nem visszavonható nézetállapot
    this.undoStack = [];
    this.redoStack = [];
    this.revSeq = Math.max(1, ...this.state.bodies.map((b) => b.rev || 1)) + 1;
    this.dirty = false;
  }

  nextRev() { return this.revSeq++; }

  /** Új állapot rögzítése a visszavonási veremben. */
  commit(label, newState, extra = {}) {
    if (newState === this.state) return;
    this.undoStack.push({ label, state: this.state, icon: extra.icon });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.lastLabel = label;
    this.lastIcon = extra.icon;
    this.state = newState;
    this.dirty = true;
    this.emit('change', { label, kind: 'commit' });
  }

  /** Állapot csere visszavonási bejegyzés nélkül (pl. az utolsó lépés finomítása). */
  replace(newState) {
    this.state = newState;
    this.dirty = true;
    this.emit('change', { kind: 'replace' });
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ label: e.label, state: this.state, icon: e.icon });
    this.state = e.state;
    this.dirty = true;
    this.emit('change', { label: e.label, kind: 'undo' });
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ label: e.label, state: this.state, icon: e.icon });
    this.state = e.state;
    this.dirty = true;
    this.emit('change', { label: e.label, kind: 'redo' });
    return e.label;
  }

  /** Előzmények listája: [{label, index, current, future}] */
  history() {
    const list = [{ label: 'Kezdőállapot', icon: 'home', pos: 0 }];
    // undoStack[i].label = az i. lépés neve (ami után az i+1. állapot jött)
    this.undoStack.forEach((e, i) => list.push({ label: e.label, icon: e.icon, pos: i + 1 }));
    const cur = this.undoStack.length;
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const e = this.redoStack[i];
      list.push({ label: e.label, icon: e.icon, pos: cur + (this.redoStack.length - i) });
    }
    return list.map((x) => ({ ...x, current: x.pos === cur, future: x.pos > cur }));
  }

  /** Ugrás az előzmények adott pontjára. */
  jumpTo(pos) {
    let cur = this.undoStack.length;
    if (pos === cur) return;
    const silent = true;
    while (cur > pos && this.undoStack.length) {
      const e = this.undoStack.pop();
      this.redoStack.push({ label: e.label, state: this.state, icon: e.icon });
      this.state = e.state; cur--;
    }
    while (cur < pos && this.redoStack.length) {
      const e = this.redoStack.pop();
      this.undoStack.push({ label: e.label, state: this.state, icon: e.icon });
      this.state = e.state; cur++;
    }
    this.dirty = true;
    this.emit('change', { kind: 'jump', silent });
  }

  /** BREP keresése a jelenlegi és korábbi állapotokban (a kernel újratöltéséhez). */
  findBrep(id, rev) {
    const look = (st) => st.bodies.find((b) => b.id === id && b.rev === rev);
    let b = look(this.state);
    if (b) return b.brep;
    for (const e of this.undoStack) { b = look(e.state); if (b) return b.brep; }
    for (const e of this.redoStack) { b = look(e.state); if (b) return b.brep; }
    return null;
  }

  // ---------------------------------------------------------------- lekérdezők
  body(id) { return this.state.bodies.find((b) => b.id === id); }
  sketch(id) { return this.state.sketches.find((s) => s.id === id); }
  plane(id) { return this.state.planes.find((p) => p.id === id); }
  isHidden(id) { return this.view.hidden.includes(id); }

  setHidden(id, hidden) {
    const set = new Set(this.view.hidden);
    if (hidden) set.add(id); else set.delete(id);
    this.view = { ...this.view, hidden: [...set] };
    this.dirty = true;
    this.emit('change', { kind: 'view' });
  }

  setViewProp(key, value) {
    this.view = { ...this.view, [key]: value };
    this.dirty = true;
    this.emit('change', { kind: 'view' });
  }

  bodyRef(id) {
    const b = this.body(id);
    return b ? { id: b.id, rev: b.rev } : null;
  }

  // ---------------------------------------------------------------- állapot-építők
  static withBodies(state, bodies) { return { ...state, bodies }; }

  newBodyName(state, base = 'Test') {
    const n = (state.counters.body || 0) + 1;
    return { name: `${base} ${n}`, counters: { ...state.counters, body: n } };
  }

  newSketchName(state) {
    const n = (state.counters.sketch || 0) + 1;
    return { name: `Vázlat ${n}`, counters: { ...state.counters, sketch: n } };
  }

  /**
   * Kernel eredmények beépítése: results: [{role, sourceId, id, rev, brep, name?}], removed: [ids]
   */
  applyKernelResults(state, results, removed = []) {
    let bodies = state.bodies.filter((b) => !removed.includes(b.id));
    let counters = state.counters;
    for (const r of results) {
      if (r.role === 'modified') {
        bodies = bodies.map((b) => (b.id === r.sourceId ? { ...b, rev: r.rev, brep: r.brep } : b));
      } else {
        const src = r.sourceId ? state.bodies.find((b) => b.id === r.sourceId) : null;
        counters = { ...counters, body: (counters.body || 0) + 1 };
        const name = r.name || (src ? `${src.name} másolat` : `Test ${counters.body}`);
        const color = src ? src.color : BODY_COLORS[(counters.body - 1) % BODY_COLORS.length];
        bodies = [...bodies, { id: r.id, name, rev: r.rev, brep: r.brep, color }];
      }
    }
    return { ...state, bodies, counters };
  }
}

export function newBodyId() { return uid('b'); }
export function newSketchId() { return uid('s'); }
