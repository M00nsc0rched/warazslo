// Warázsló CAD kernel worker: OpenCascade (replicad build) egy külön szálon.
import initOpenCascade from '../../vendor/occt/replicad_single.js';
import { setup, R, KernelError, wrapError, fromBrep, toBrep, buildBodyMesh } from './occ.js';
import { OPS } from './ops.js';

const MAX_CACHE = 80;
const cache = new Map();   // "bodyId@rev" -> replicad shape (LRU sorrend)
let temp = new Map();      // előnézeti eredmények: handle -> shape
let handleSeq = 1;

const ready = (async () => {
  const oc = await initOpenCascade({
    print: () => {},
    printErr: (t) => { if (/error|fail/i.test(t)) console.warn('[occt]', t); },
    locateFile: (f) => new URL('../../vendor/occt/' + f, import.meta.url).href,
  });
  setup(oc);
})();

ready.then(
  () => postMessage({ type: 'ready' }),
  (err) => postMessage({ type: 'fatal', error: String(err && err.message || err) }),
);

function cacheGet(key) {
  const s = cache.get(key);
  if (s) { cache.delete(key); cache.set(key, s); }
  return s;
}

function cachePut(key, shape) {
  cache.delete(key);
  cache.set(key, shape);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    const old = cache.get(oldest);
    cache.delete(oldest);
    try { old.delete(); } catch (e) { /* GC */ }
  }
}

/** A művelet-implementációk ezen keresztül érik el a testeket. */
const ctx = {
  /** ref: { id, rev, brep? } */
  body(ref) {
    const key = `${ref.id}@${ref.rev}`;
    let s = cacheGet(key);
    if (!s) {
      if (!ref.brep) throw new KernelError('missing', 'MISSING', key);
      s = fromBrep(ref.brep);
      cachePut(key, s);
    }
    return s;
  },
  keyOf(ref) { return `${ref.id}@${ref.rev}`; },
};

function missingKeys(err) {
  return err && err.code === 'MISSING';
}

async function dispatch(method, params) {
  switch (method) {
    case 'ping':
      return { result: 'pong' };

    case 'mesh': {
      // params.bodies: [{id, rev, brep?}]
      const out = [];
      const transfer = [];
      for (const ref of params.bodies) {
        const s = ctx.body(ref);
        const { data, transfer: t } = buildBodyMesh(s);
        out.push({ id: ref.id, rev: ref.rev, mesh: data });
        transfer.push(...t);
      }
      return { result: out, transfer };
    }

    case 'op': {
      // Modellező művelet: params = { name, args, preview }
      const fn = OPS[params.name];
      if (!fn) throw new KernelError(`Ismeretlen művelet: ${params.name}`);
      // Előző előnézeti eredmények eldobása
      for (const s of temp.values()) { try { s.delete(); } catch (e) { /* */ } }
      temp = new Map();
      const res = await fn(params.args, ctx);
      // res: { results: [{shape, role, sourceId?, name?}], removed: [ids], info? }
      const out = [];
      const transfer = [];
      for (const item of res.results || []) {
        const handle = `h${handleSeq++}`;
        temp.set(handle, item.shape);
        const { data, transfer: t } = buildBodyMesh(item.shape, { withInfo: !params.preview });
        transfer.push(...t);
        out.push({ handle, role: item.role, sourceId: item.sourceId, name: item.name, mesh: data });
      }
      return { result: { results: out, removed: res.removed || [], info: res.info || null }, transfer };
    }

    case 'finalize': {
      // params.assign: [{handle, id, rev}] -> gyorsítótárba teszi és BREP-et ad vissza
      const out = [];
      for (const a of params.assign) {
        const s = temp.get(a.handle);
        if (!s) throw new KernelError('Az előnézet elavult, próbáld újra', 'STALE');
        temp.delete(a.handle);
        cachePut(`${a.id}@${a.rev}`, s);
        out.push({ id: a.id, rev: a.rev, brep: toBrep(s) });
      }
      // teljes háló + topológiai adatok a véglegesített testekhez
      const transfer = [];
      for (const o of out) {
        const { data, transfer: t } = buildBodyMesh(cache.get(`${o.id}@${o.rev}`));
        o.mesh = data;
        transfer.push(...t);
      }
      return { result: out, transfer };
    }

    case 'query': {
      const fn = OPS[params.name];
      if (!fn) throw new KernelError(`Ismeretlen lekérdezés: ${params.name}`);
      const res = await fn(params.args, ctx);
      return { result: res.info, transfer: res.transfer || [] };
    }

    case 'forget': {
      for (const key of params.keys || []) {
        const s = cache.get(key);
        if (s) { cache.delete(key); try { s.delete(); } catch (e) { /* */ } }
      }
      return { result: true };
    }

    default:
      throw new KernelError(`Ismeretlen kérés: ${method}`);
  }
}

self.onmessage = async (e) => {
  const { id, method, params } = e.data;
  try {
    await ready;
    const { result, transfer } = await dispatch(method, params);
    postMessage({ id, ok: true, result }, transfer || []);
  } catch (err) {
    const w = wrapError(err);
    if (missingKeys(w)) {
      postMessage({ id, ok: false, error: 'missing', code: 'MISSING' });
    } else {
      console.error('[kernel]', method, params && params.name, err);
      postMessage({ id, ok: false, error: w.message, code: w.code || 'ERR' });
    }
  }
};
