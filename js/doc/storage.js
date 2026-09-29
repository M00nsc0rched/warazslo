// Projektek tárolása IndexedDB-ben (csak ezen az eszközön).
const DB_NAME = 'warazslo';
const DB_VER = 2;
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('index')) d.createObjectStore('index', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meshes')) d.createObjectStore('meshes');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Tranzakció megszakadt'));
  }));
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** Projektlista (könnyű index: név, dátum, bélyegkép) */
export async function listProjects() {
  const items = await tx('index', 'readonly', (s) => reqP(s.getAll()));
  return (items || []).sort((a, b) => b.modified - a.modified);
}

export async function loadProject(id) {
  return tx('projects', 'readonly', (s) => reqP(s.get(id)));
}

export async function saveProject(p) {
  const now = Date.now();
  const rec = { ...p, modified: now, created: p.created || now };
  await db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(['projects', 'index'], 'readwrite');
    t.objectStore('projects').put(rec);
    t.objectStore('index').put({ id: rec.id, name: rec.name, modified: rec.modified, created: rec.created, thumb: rec.thumb || null, bodies: rec.state?.bodies?.length || 0 });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
  return rec;
}

export async function deleteProject(id) {
  await db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(['projects', 'index'], 'readwrite');
    t.objectStore('projects').delete(id);
    t.objectStore('index').delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}

export async function renameProject(id, name) {
  const p = await loadProject(id);
  if (!p) return;
  p.name = name;
  await saveProject(p);
}

/** Tartós tárolás kérése, hogy a Safari ne törölje az adatokat. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch (e) { /* nem támogatott */ }
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch (e) { return null; }
}

// ---------------------------------------------------------------- beállítások
const SETTINGS_KEY = 'warazslo.settings';
export const DEFAULT_SETTINGS = {
  units: 'mm',
  snapping: true,
  gridSnap: true,
  penDraws: true,         // Pencil húzás = rajzolás
  fingerDraws: false,     // ujj is rajzol (egy ujjas navigáció helyett)
  freehand: true,         // szabadkézi alakfelismerés
  showLabels: true,       // eszköztár feliratok
  perspective: true,
  display: 'shadedEdges',
  shadows: true,
  meshQuality: 'normal',
  density: 1.24,          // g/cm³ (PLA)
  material: 'PLA',
  haptics: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* privát mód */ }
}

// ---------------------------------------------------------------- háló gyorsítótár (gyors megnyitás)
const meshKey = (projectId, bodyId, rev) => `${projectId}|${bodyId}@${rev}`;

export async function putMesh(projectId, bodyId, rev, mesh) {
  try {
    await tx('meshes', 'readwrite', (s) => { s.put(mesh, meshKey(projectId, bodyId, rev)); });
  } catch (e) { /* tárhely tele: nem kritikus */ }
}

export async function getMeshes(projectId, bodies) {
  const out = new Map();
  try {
    await tx('meshes', 'readonly', (s) => Promise.all(bodies.map((b) => reqP(s.get(meshKey(projectId, b.id, b.rev))).then((m) => { if (m) out.set(`${b.id}@${b.rev}`, m); }))));
  } catch (e) { /* nincs */ }
  return out;
}

/** A projekt már nem használt hálóinak törlése. */
export async function pruneMeshes(projectId, bodies) {
  try {
    const keep = new Set(bodies.map((b) => meshKey(projectId, b.id, b.rev)));
    const range = IDBKeyRange.bound(`${projectId}|`, `${projectId}|\uffff`);
    await tx('meshes', 'readwrite', (s) => new Promise((res) => {
      const req = s.openKeyCursor ? s.openKeyCursor(range) : s.openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { res(); return; }
        if (!keep.has(c.key)) s.delete(c.key);
        c.continue();
      };
      req.onerror = () => res();
    }));
  } catch (e) { /* */ }
}

export async function deleteProjectMeshes(projectId) { return pruneMeshes(projectId, []); }
