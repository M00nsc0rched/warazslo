// Fő szál oldali kliens a CAD kernel workerhez.
import { Emitter } from '../util/misc.js';

const TIMEOUT_MS = 90000;

export class KernelError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

export class KernelClient extends Emitter {
  /** getBrep(id, rev) -> string | null : a dokumentumból és a visszavonási veremből */
  constructor(getBrep) {
    super();
    this.getBrep = getBrep;
    this.pending = new Map();
    this.seq = 1;
    this.readyPromise = null;
    this.busyCount = 0;
    this.worker = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker = w;
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { resolve(); this.emit('ready'); return; }
        if (m.type === 'fatal') { reject(new Error(m.error)); return; }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        this._busy(-1);
        if (m.ok) p.resolve(m.result);
        else p.reject(new KernelError(m.error, m.code));
      };
      w.onerror = (e) => {
        console.error('Kernel worker hiba', e);
        e.preventDefault?.();
        reject(new Error(e.message || 'A CAD kernel nem indult el'));
        this._crash('A CAD kernel hibába futott és újraindult');
      };
    });
    return this.readyPromise;
  }

  _busy(d) {
    this.busyCount = Math.max(0, this.busyCount + d);
    this.emit('busy', this.busyCount > 0);
  }

  _crash(msg) {
    const pend = [...this.pending.values()];
    this.pending.clear();
    for (const p of pend) { clearTimeout(p.timer); p.reject(new KernelError(msg, 'CRASH')); }
    this.busyCount = 0;
    this.emit('busy', false);
    try { this.worker && this.worker.terminate(); } catch (e) { /* */ }
    this.worker = null;
    this.readyPromise = null;
    this.emit('restart', msg);
    // újraindítás
    this.start().catch(() => {});
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) this._crash('A művelet túl sokáig tartott, a kernel újraindult');
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this._busy(1);
      this.worker.postMessage({ id, method, params });
    });
  }

  /** Kérés; ha a workerből hiányzik egy test, BREP-pel együtt újraküldi. */
  async call(method, params = {}) {
    await this.start();
    try {
      return await this._send(method, params);
    } catch (err) {
      if (err.code === 'MISSING') {
        const withBrep = attachBreps(params, this.getBrep);
        await this.start();
        return await this._send(method, withBrep);
      }
      throw err;
    }
  }

  op(name, args, preview = false) { return this.call('op', { name, args, preview }); }
  query(name, args) { return this.call('query', { name, args }); }
  finalize(assign) { return this.call('finalize', { assign }); }
  mesh(bodies) { return this.call('mesh', { bodies }); }
}

/** Mély másolat, minden {id, rev} objektumhoz hozzáadja a BREP-et. */
function attachBreps(obj, getBrep) {
  if (Array.isArray(obj)) return obj.map((x) => attachBreps(x, getBrep));
  if (obj && typeof obj === 'object' && !(obj instanceof ArrayBuffer) && !ArrayBuffer.isView(obj)) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = attachBreps(v, getBrep);
    if (typeof obj.id === 'string' && typeof obj.rev === 'number' && !obj.brep) {
      const b = getBrep(obj.id, obj.rev);
      if (b) out.brep = b;
    }
    return out;
  }
  return obj;
}

/**
 * Előnézet-futtató: egyszerre egy kérés fut, a közben érkezők közül csak a legutolsó.
 * onResult(result, args), onError(err, args)
 */
export class PreviewRunner {
  constructor(kernel, name, onResult, onError) {
    this.kernel = kernel;
    this.name = name;
    this.onResult = onResult;
    this.onError = onError;
    this.inflight = false;
    this.next = null;
    this.lastArgs = null;
    this.lastResult = null;
    this.lastKey = null;
    this.disposed = false;
    this.waiters = [];
  }

  request(args) {
    this.next = args;
    if (!this.inflight) this._pump();
  }

  async _pump() {
    if (this.disposed) return;
    const args = this.next;
    this.next = null;
    if (!args) { this._flushWaiters(); return; }
    this.inflight = true;
    const key = JSON.stringify(args);
    try {
      const res = await this.kernel.op(this.name, args, true);
      if (this.disposed) return;
      this.lastArgs = args;
      this.lastKey = key;
      this.lastResult = res;
      this.lastError = null;
      if (!this.next) this.onResult && this.onResult(res, args);
    } catch (err) {
      if (this.disposed) return;
      this.lastArgs = args;
      this.lastKey = key;
      this.lastResult = null;
      this.lastError = err;
      if (!this.next) this.onError && this.onError(err, args);
    } finally {
      this.inflight = false;
    }
    if (this.next) this._pump();
    else this._flushWaiters();
  }

  _flushWaiters() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Megvárja, amíg nincs futó/sorban álló kérés. */
  idle() {
    if (!this.inflight && !this.next) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  /** Az utolsó előnézet eredménye, ha pontosan ezekkel a paraméterekkel készült. */
  resultFor(args) {
    return this.lastKey === JSON.stringify(args) ? this.lastResult : null;
  }

  dispose() { this.disposed = true; this.next = null; this._flushWaiters(); }
}
