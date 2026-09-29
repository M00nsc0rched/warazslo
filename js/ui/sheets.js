// Oldalsó lapok, menük és egyszeri műveletek (elemek, előzmények, beállítások, export/import)
import * as THREE from 'three';
import { el, onTap, shareOrDownload, pickFile, safeName, uid } from '../util/misc.js';
import { icon } from './icons.js';
import { BODY_COLORS, newBodyId } from '../doc/document.js';
import { canonicalFrame, planeFromJSON } from '../sketch/manager.js';
import { fmtLen, fmtVolume, fmtArea, fmtMass, getUnit, LENGTH_UNITS } from '../util/units.js';
import { curveEnds } from '../sketch/geom2d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- sík segédek
export function frameFromFace(fi) {
  return canonicalFrame(V(...fi.normal), V(...fi.center));
}

export function frameFromPlane(p) { return planeFromJSON(p); }

export function setGridPlane(app, which) {
  const n = which === 'XY' ? V(0, 0, 1) : which === 'XZ' ? V(0, -1, 0) : V(1, 0, 0);
  const f = canonicalFrame(n, V());
  app.vp.setGridFrame(f);
  app.vp.setViewDirection(n.clone(), true, which === 'XY' ? V(0, 1, 0) : null);
  app.ui.toast(`Rácssík: ${which}`, '', 1400);
}

export function gridLabel(app) {
  const g = app.vp.gridSpacing || 1;
  return fmtLen(g).replace(' ', '\n');
}

// ---------------------------------------------------------------- megjelenítés
const DISPLAY = [
  ['shadedEdges', 'Árnyalt élekkel', 'shadedEdges'],
  ['shaded', 'Árnyalt', 'shaded'],
  ['xray', 'Röntgen', 'xray'],
  ['wire', 'Drótváz', 'wireframe'],
];
export const displayName = (m) => (DISPLAY.find((d) => d[0] === m) || DISPLAY[0])[1];

export function displayMenu(app, anchor) {
  app.ui.menu(anchor, [
    { head: 'Megjelenítési mód' },
    ...DISPLAY.map(([k, label, ic]) => ({ icon: ic, label, checked: app.settings.display === k, onTap: () => app.setSetting('display', k) })),
    { sep: true },
    { icon: 'sphere', label: 'Árnyékok', checked: app.settings.shadows, onTap: () => app.setSetting('shadows', !app.settings.shadows) },
    { icon: 'plane', label: 'Rács', checked: app.vp.gridVisible, onTap: () => { app.vp.gridVisible = !app.vp.gridVisible; app.vp.requestRender(); } },
  ], { side: 'left' });
}

export async function screenshot(app) {
  const w = Math.round(app.vp.width * 2), h = Math.round(app.vp.height * 2);
  const sel = app.sel;
  app.bodies.setSelection([]);
  app.bodies.setHover(null);
  const url = app.vp.snapshot({ width: w, height: h, hideGrid: true });
  app._applySelectionVisuals(sel);
  const blob = await (await fetch(url)).blob();
  await shareOrDownload(blob, `${safeName(app.doc.name)}.png`);
}

// ---------------------------------------------------------------- projekt menü
export function projectMenu(app, anchor) {
  app.ui.menu(anchor, [
    { icon: 'rename', label: 'Átnevezés', onTap: () => app.renameProjectDialog() },
    { icon: 'exportFile', label: 'Exportálás…', onTap: () => exportMenu(app, anchor, false) },
    { icon: 'importFile', label: 'STEP / STL importálása', onTap: () => importModel(app) },
    { icon: 'image', label: 'Referencia kép beszúrása', onTap: () => insertImage(app) },
    { icon: 'share', label: 'Projektfájl mentése (.warazslo)', onTap: () => exportProjectFile(app) },
    { sep: true },
    { icon: 'info', label: 'Tömeg és térfogat', onTap: () => showProperties(app) },
    { icon: 'settings', label: 'Beállítások', onTap: () => openSettings(app) },
    { icon: 'keyboard', label: 'Gesztusok és billentyűk', onTap: () => showHelp(app) },
  ], { side: 'below' });
}

// ---------------------------------------------------------------- export
function targetBodies(app, selectionOnly) {
  const st = app.doc.state;
  const selIds = new Set(app.sel.filter((s) => s.bodyId).map((s) => s.bodyId));
  let bodies = st.bodies.filter((b) => !app.doc.isHidden(b.id));
  if (selectionOnly && selIds.size) bodies = st.bodies.filter((b) => selIds.has(b.id));
  return bodies;
}

export function exportMenu(app, anchor, selectionOnly) {
  const bodies = targetBodies(app, selectionOnly);
  const what = selectionOnly && app.sel.some((s) => s.bodyId) ? 'kijelölt' : 'látható';
  app.ui.menu(anchor, [
    { head: `Exportálás (${bodies.length} ${what} test)` },
    { icon: 'cube', label: 'STEP (.step)', sc: 'CAD csere', onTap: () => exportBodies(app, bodies, 'step') },
    { icon: 'cube', label: 'STL (.stl)', sc: '3D nyomtatás', onTap: () => exportBodies(app, bodies, 'stl') },
    { icon: 'cube', label: 'STL finom (.stl)', sc: 'nagy felbontás', onTap: () => exportBodies(app, bodies, 'stl', 0.003) },
    { icon: 'cube', label: 'OBJ (.obj)', onTap: () => exportOBJ(app, bodies) },
    { icon: 'ar', label: 'USDZ (AR nézet)', sc: 'iPad AR', onTap: () => exportUSDZ(app, bodies) },
    { icon: 'drawing', label: 'Műszaki rajz (SVG/PDF)', onTap: () => openDrawing(app) },
    { icon: 'camera', label: 'Kép (.png)', onTap: () => screenshot(app) },
  ], { side: anchor.closest && anchor.closest('#topbar') ? 'below' : 'right' });
}

async function exportBodies(app, bodies, format, tolerance) {
  if (!bodies.length) { app.ui.toast('Nincs exportálható test', 'error'); return; }
  try {
    app.ui.toast('Exportálás…', '', 1200);
    const buf = await app.kernel.query('exportFile', {
      format, tolerance,
      bodies: bodies.map((b) => ({ id: b.id, rev: b.rev })),
      names: bodies.map((b) => b.name), colors: bodies.map((b) => b.color),
    });
    const name = bodies.length === 1 ? bodies[0].name : app.doc.name;
    const ext = format === 'step' ? 'step' : 'stl';
    await shareOrDownload(new Blob([buf], { type: 'application/octet-stream' }), `${safeName(name)}.${ext}`);
  } catch (e) {
    app.ui.toast(`Export hiba: ${e.message}`, 'error', 5000);
  }
}

function exportOBJ(app, bodies) {
  let out = `# Warázsló – ${app.doc.name}\n`;
  let base = 1;
  for (const b of bodies) {
    const m = app.bodies.getCachedMesh(b.id, b.rev);
    if (!m) continue;
    out += `o ${b.name.replace(/\s+/g, '_')}\n`;
    const v = m.vertices, n = m.normals, t = m.triangles;
    for (let i = 0; i < v.length; i += 3) out += `v ${v[i]} ${v[i + 1]} ${v[i + 2]}\n`;
    for (let i = 0; i < n.length; i += 3) out += `vn ${n[i].toFixed(5)} ${n[i + 1].toFixed(5)} ${n[i + 2].toFixed(5)}\n`;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] + base, bb = t[i + 1] + base, c = t[i + 2] + base;
      out += `f ${a}//${a} ${bb}//${bb} ${c}//${c}\n`;
    }
    base += v.length / 3;
  }
  shareOrDownload(new Blob([out], { type: 'text/plain' }), `${safeName(app.doc.name)}.obj`);
}

async function exportUSDZ(app, bodies) {
  try {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    const scene = new THREE.Scene();
    // USDZ méterben: mm -> m
    const root = new THREE.Group();
    root.scale.setScalar(0.001);
    root.rotation.x = -Math.PI / 2; // Z-fel -> Y-fel
    scene.add(root);
    for (const b of bodies) {
      const m = app.bodies.getCachedMesh(b.id, b.rev);
      if (!m) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0.05 })));
    }
    const exporter = new USDZExporter();
    const data = await exporter.parseAsync(scene);
    const blob = new Blob([data], { type: 'model/vnd.usdz+zip' });
    // iPaden az AR Quick Look közvetlenül megnyitja
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = url;
    a.download = `${safeName(app.doc.name)}.usdz`;
    a.appendChild(document.createElement('img'));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    app.ui.toast(`USDZ hiba: ${e.message}`, 'error', 5000);
  }
}

export function exportProjectFile(app) {
  const data = { format: 'warazslo', version: 1, name: app.doc.name, state: app.doc.state, view: app.doc.view };
  shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeName(app.doc.name)}.warazslo`);
}

// ---------------------------------------------------------------- import
export async function importModel(app) {
  const file = await pickFile('.step,.stp,.stl,.STEP,.STP,.STL');
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const format = ext === 'stl' ? 'stl' : 'step';
  try {
    app.ui.toast(`Importálás: ${file.name}…`, '', 2000);
    const data = await file.arrayBuffer();
    const name = file.name.replace(/\.[^.]+$/, '');
    const res = await app.kernel.op('importFile', { format, data, name }, true);
    await app.commitKernelResult('Importálás', res, { icon: 'importFile' });
    app.vp.fitBox(app.bodies.bounds());
    app.ui.toast(`${res.results.length} test importálva`, 'ok');
  } catch (e) {
    app.ui.toast(`Import hiba: ${e.message}`, 'error', 5000);
  }
}

export async function insertImage(app) {
  const file = await pickFile('image/*');
  if (!file) return;
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w = 100, h = (100 * img.height) / img.width;
  const gf = app.vp.gridFrame;
  const st = app.doc.state;
  const n = (st.counters.image || 0) + 1;
  const im = { id: uid('i'), name: `Kép ${n}`, dataUrl: url, plane: { origin: gf.origin.toArray(), xDir: gf.xDir.toArray(), yDir: gf.yDir.toArray(), normal: gf.normal.toArray() }, w, h, opacity: 0.6 };
  app.doc.commit('Kép beszúrása', { ...st, images: [...(st.images || []), im], counters: { ...st.counters, image: n } }, { icon: 'image' });
  app.ui.toast('A kép a rácssíkra került; méretezd az Elemek panelen', '', 3000);
}

// ---------------------------------------------------------------- testek
export function colorMenu(app, anchor) {
  const ids = [...new Set(app.sel.filter((s) => s.bodyId).map((s) => s.bodyId))];
  const colors = [...BODY_COLORS, '#8e8e98', '#3a3a44', '#f2f2f2', '#e8d36a', '#e07b39', '#d9534f', '#5cb85c', '#337ab7'];
  const scrim = el('div', { class: 'menu-scrim' });
  const m = el('div', { class: 'menu', style: { display: 'grid', gridTemplateColumns: 'repeat(4, 44px)', gap: '8px', padding: '12px', minWidth: '0' } });
  for (const c of colors) {
    const b = el('button', { style: { width: '44px', height: '44px', borderRadius: '12px', border: '2px solid rgba(255,255,255,.2)', background: c, cursor: 'pointer' } });
    onTap(b, () => { close(); setBodyColor(app, ids, c); });
    m.append(b);
  }
  const close = () => { scrim.remove(); m.remove(); };
  scrim.addEventListener('pointerdown', close);
  document.body.append(scrim, m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.min(window.innerWidth - m.offsetWidth - 8, r.right + 8)}px`;
  m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 8, r.top)}px`;
}

export function setBodyColor(app, ids, color) {
  const st = app.doc.state;
  app.doc.commit('Szín', { ...st, bodies: st.bodies.map((b) => (ids.includes(b.id) ? { ...b, color } : b)) }, { icon: 'palette' });
}

export async function duplicateBodies(app) {
  const ids = [...new Set(app.sel.filter((s) => s.bodyId).map((s) => s.bodyId))];
  if (!ids.length) return;
  const res = await app.kernel.op('transform', { bodies: ids.map((id) => app.doc.bodyRef(id)), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], copy: true }, true);
  const out = await app.commitKernelResult('Másolat', res, { icon: 'copy' });
  app.setSelection(out.map((r) => ({ type: 'body', bodyId: r.id })));
  app.startTool('move');
}

export function toggleIsolate(app) {
  if (app.isolated) { app.setIsolation(null); return; }
  const ids = new Set();
  for (const s of app.sel) { if (s.bodyId) ids.add(s.bodyId); if (s.sketchId) ids.add(s.sketchId); }
  if (!ids.size) { app.ui.toast('Jelölj ki valamit az izoláláshoz', '', 2000); return; }
  app.setIsolation(ids);
}

// ---------------------------------------------------------------- vázlat segédek
export function toggleConstruction(app) {
  const bySketch = new Map();
  for (const s of app.sel) if (s.type === 'curve') { if (!bySketch.has(s.sketchId)) bySketch.set(s.sketchId, new Set()); bySketch.get(s.sketchId).add(s.curveId); }
  const st = app.doc.state;
  const sketches = st.sketches.map((sk) => {
    const ids = bySketch.get(sk.id);
    if (!ids) return sk;
    return { ...sk, curves: sk.curves.map((c) => (ids.has(c.id) ? { ...c, construction: !c.construction } : c)) };
  });
  app.doc.commit('Segédvonal', { ...st, sketches }, { icon: 'construction' });
}

/** Kijelölt görbe méretének megadása (hossz, sugár). */
export function editDimension(app) {
  const s = app.sel.find((x) => x.type === 'curve');
  if (!s) return;
  const sk = app.doc.sketch(s.sketchId);
  const c = sk && sk.curves.find((x) => x.id === s.curveId);
  if (!c) return;
  import('../sketch/edit.js').then(({ editCurveDimension }) => editCurveDimension(app, sk, c));
}

// ---------------------------------------------------------------- elemek lap
export function toggleItems(app) {
  if (app.ui.sheetOpen('Elemek')) { app.ui.closeSheet(); app.updateToolbar(); return; }
  app.ui.openSheet({
    title: 'Elemek', side: 'left',
    build: (body) => buildItems(app, body),
    onClose: () => app.updateToolbar(),
  });
  app.updateToolbar();
}

function buildItems(app, body) {
  const st = app.doc.state;
  const doc = app.doc;
  const row = ({ ic, swatch, name, sub, hidden, selected, onSel, onEye, onMore }) => {
    const r = el('div', { class: `list-row ${hidden ? 'hidden-item' : ''} ${selected ? 'sel' : ''}` });
    if (swatch) r.append(el('span', { class: 'swatch', style: { background: swatch } }));
    else r.append(el('span', { class: 'ic', html: icon(ic) }));
    r.append(el('div', { class: 'nm' }, el('div', { text: name }), sub ? el('div', { class: 'sub', text: sub }) : null));
    const eye = el('button', { class: 'act', html: icon(hidden ? 'eyeOff' : 'eye') });
    onTap(eye, (e) => { e.stopPropagation(); onEye(); });
    const more = el('button', { class: 'act', html: icon('dots') });
    onTap(more, (e) => { e.stopPropagation(); onMore(more); });
    r.append(eye, more);
    onTap(r, onSel);
    return r;
  };
  const isSel = (t, id) => app.sel.some((s) => s.type === t && (s.bodyId === id || s.sketchId === id || s.planeId === id));
  body.append(el('div', { class: 'list-head', text: `Testek (${st.bodies.length})` }));
  if (!st.bodies.length) body.append(el('div', { class: 'list-row', html: '<span class="sub">Még nincs test. Rajzolj egy vázlatot és húzd ki, vagy szúrj be egy alaptestet.</span>' }));
  for (const b of st.bodies) {
    const m = app.bodies.getCachedMesh(b.id, b.rev);
    body.append(row({
      swatch: b.color, name: b.name, sub: m && m.volume ? fmtVolume(m.volume) : '', hidden: doc.isHidden(b.id), selected: isSel('body', b.id),
      onSel: () => app.toggleSelect({ type: 'body', bodyId: b.id }),
      onEye: () => doc.setHidden(b.id, !doc.isHidden(b.id)),
      onMore: (a) => app.ui.menu(a, [
        { icon: 'rename', label: 'Átnevezés', onTap: async () => { const n = await app.ui.prompt('Test neve', b.name); if (n) renameItem(app, 'bodies', b.id, n); } },
        { icon: 'palette', label: 'Szín', onTap: () => { app.setSelection([{ type: 'body', bodyId: b.id }]); colorMenu(app, a); } },
        { icon: 'isolate', label: 'Izolálás', onTap: () => app.setIsolation(new Set([b.id])) },
        { icon: 'exportFile', label: 'Exportálás', onTap: () => { app.setSelection([{ type: 'body', bodyId: b.id }]); exportMenu(app, a, true); } },
        { icon: 'trash', label: 'Törlés', danger: true, onTap: () => { app.setSelection([{ type: 'body', bodyId: b.id }]); app.deleteSelection(); } },
      ]),
    }));
  }
  body.append(el('div', { class: 'list-head', text: `Vázlatok (${st.sketches.length})` }));
  for (const s of st.sketches) {
    body.append(row({
      ic: 'sketch', name: s.name, sub: `${s.curves.length} görbe · ${app.sketches.regions(s).length} régió`, hidden: doc.isHidden(s.id), selected: isSel('sketch', s.id),
      onSel: () => app.toggleSelect({ type: 'sketch', sketchId: s.id }),
      onEye: () => doc.setHidden(s.id, !doc.isHidden(s.id)),
      onMore: (a) => app.ui.menu(a, [
        { icon: 'rename', label: 'Átnevezés', onTap: async () => { const n = await app.ui.prompt('Vázlat neve', s.name); if (n) renameItem(app, 'sketches', s.id, n); } },
        { icon: 'sketch', label: 'Szerkesztés (nézet a síkra)', onTap: () => { const f = planeFromJSON(s.plane); app.vp.setGridFrame(f); app.vp.setViewDirection(f.normal.clone(), true, Math.abs(f.normal.z) > 0.9 ? f.yDir.clone() : null); app.startTool('line', { frame: f }); } },
        { icon: 'trash', label: 'Törlés', danger: true, onTap: () => { app.setSelection([{ type: 'sketch', sketchId: s.id }]); app.deleteSelection(); } },
      ]),
    }));
  }
  if (st.planes.length) {
    body.append(el('div', { class: 'list-head', text: `Szerkesztősíkok (${st.planes.length})` }));
    for (const p of st.planes) {
      body.append(row({
        ic: 'plane', name: p.name, hidden: doc.isHidden(p.id), selected: isSel('plane', p.id),
        onSel: () => app.toggleSelect({ type: 'plane', planeId: p.id }),
        onEye: () => doc.setHidden(p.id, !doc.isHidden(p.id)),
        onMore: (a) => app.ui.menu(a, [
          { icon: 'rename', label: 'Átnevezés', onTap: async () => { const n = await app.ui.prompt('Sík neve', p.name); if (n) renameItem(app, 'planes', p.id, n); } },
          { icon: 'trash', label: 'Törlés', danger: true, onTap: () => { app.setSelection([{ type: 'plane', planeId: p.id }]); app.deleteSelection(); } },
        ]),
      }));
    }
  }
  if ((st.images || []).length) {
    body.append(el('div', { class: 'list-head', text: `Referencia képek (${st.images.length})` }));
    for (const im of st.images) {
      body.append(row({
        ic: 'image', name: im.name, sub: `${fmtLen(im.w)} széles`, hidden: doc.isHidden(im.id), selected: false,
        onSel: () => {},
        onEye: () => doc.setHidden(im.id, !doc.isHidden(im.id)),
        onMore: (a) => app.ui.menu(a, [
          { icon: 'scale', label: 'Szélesség megadása', onTap: () => app.ui.keypad({ label: 'Kép szélessége', kind: 'len', value: im.w, anchor: a, onDone: (w) => updateImage(app, im.id, { w, h: (w * im.h) / im.w }) }) },
          { icon: 'eye', label: 'Átlátszóság 30%', onTap: () => updateImage(app, im.id, { opacity: 0.3 }) },
          { icon: 'eye', label: 'Átlátszóság 70%', onTap: () => updateImage(app, im.id, { opacity: 0.7 }) },
          { icon: 'trash', label: 'Törlés', danger: true, onTap: () => { const s2 = app.doc.state; app.doc.commit('Kép törlése', { ...s2, images: s2.images.filter((x) => x.id !== im.id) }); } },
        ]),
      }));
    }
  }
}

function renameItem(app, coll, id, name) {
  const st = app.doc.state;
  app.doc.commit('Átnevezés', { ...st, [coll]: st[coll].map((x) => (x.id === id ? { ...x, name } : x)) }, { icon: 'rename' });
}

function updateImage(app, id, patch) {
  const st = app.doc.state;
  app.doc.commit('Kép módosítása', { ...st, images: st.images.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, { icon: 'image' });
}

// ---------------------------------------------------------------- előzmények
export function toggleHistory(app) {
  if (app.ui.sheetOpen('Előzmények')) { app.ui.closeSheet(); return; }
  app.ui.openSheet({
    title: 'Előzmények', side: 'right',
    build: (body) => {
      const list = app.doc.history();
      for (const h of list) {
        const r = el('div', { class: `list-row ${h.current ? 'current' : ''} ${h.future ? 'future' : ''}` },
          el('span', { class: 'ic', html: icon(h.icon || 'cube') }),
          el('div', { class: 'nm', text: h.label }),
          h.current ? el('span', { class: 'sub', text: 'jelenlegi' }) : null);
        onTap(r, () => { app.setTool(null); app.doc.jumpTo(h.pos); });
        body.append(r);
      }
      setTimeout(() => { const c = body.querySelector('.current'); c && c.scrollIntoView({ block: 'center' }); }, 0);
    },
  });
}

// ---------------------------------------------------------------- tulajdonságok
export async function showProperties(app) {
  const bodies = targetBodies(app, true);
  if (!bodies.length) { app.ui.toast('Nincs test', '', 1500); return; }
  try {
    const props = await app.kernel.query('properties', { bodies: bodies.map((b) => ({ id: b.id, rev: b.rev })) });
    const dens = app.settings.density || 1.24;
    const box = el('div');
    let tv = 0, ta = 0;
    props.forEach((p, i) => {
      tv += p.volume; ta += p.area;
      const bb = p.bbox;
      box.append(el('div', { class: 'measure-card', style: { marginBottom: '10px' } },
        el('div', { style: { fontWeight: 650, marginBottom: '4px' }, text: bodies[i].name }),
        mrow('Térfogat', fmtVolume(p.volume)), mrow('Felület', fmtArea(p.area)),
        mrow(`Tömeg (${app.settings.material || 'anyag'}, ${String(dens).replace('.', ',')} g/cm³)`, fmtMass((p.volume / 1000) * dens)),
        mrow('Befoglaló méret', `${fmtLen(bb[3] - bb[0], { unit: false })} × ${fmtLen(bb[4] - bb[1], { unit: false })} × ${fmtLen(bb[5] - bb[2])}`),
        mrow('Súlypont', p.center.map((x) => fmtLen(x, { unit: false })).join('; '))));
    });
    if (props.length > 1) box.append(el('div', { class: 'measure-card' }, mrow('Összes térfogat', fmtVolume(tv)), mrow('Összes tömeg', fmtMass((tv / 1000) * dens))));
    await app.ui.dialog({ title: 'Tömegtulajdonságok', body: box, buttons: [{ label: 'Bezárás', value: true, style: 'primary' }] });
  } catch (e) { app.ui.toast(e.message, 'error'); }
}

const mrow = (k, v) => el('div', { class: 'mrow' }, el('span', { text: k }), el('b', { text: v }));

// ---------------------------------------------------------------- beállítások
const MATERIALS = [['PLA', 1.24], ['PETG', 1.27], ['ABS', 1.04], ['Nylon', 1.14], ['Alumínium', 2.7], ['Acél', 7.85], ['Sárgaréz', 8.5], ['Fa (fenyő)', 0.5]];

export function openSettings(app) {
  app.ui.openSheet({
    title: 'Beállítások', side: 'right',
    build: (body) => {
      const s = app.settings;
      const toggle = (key, label, sub) => {
        const t = el('div', { class: `toggle ${s[key] ? 'on' : ''}` }, el('span', { class: 'sw' }));
        const r = el('div', { class: 'set-row' }, el('div', { class: 'sl' }, label, sub ? el('small', { text: sub }) : null), t);
        onTap(r, () => { app.setSetting(key, !app.settings[key]); app.ui.refreshSheet(); });
        return r;
      };
      const chips = (key, label, opts) => {
        const c = el('div', { class: 'chips' });
        for (const [v, l] of opts) {
          const b = el('button', { class: `chip ${s[key] === v ? 'on' : ''}`, text: l });
          onTap(b, () => { app.setSetting(key, v); app.ui.refreshSheet(); });
          c.append(b);
        }
        return el('div', { class: 'set-row' }, el('div', { class: 'sl', text: label }), c);
      };
      body.append(el('div', { class: 'list-head', text: 'Egységek' }));
      body.append(chips('units', 'Mértékegység', [['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'hüvelyk']]));
      body.append(el('div', { class: 'list-head', text: 'Rajzolás' }));
      body.append(toggle('penDraws', 'Apple Pencil rajzol', 'Pencillel húzva szabadkézi vázlat, alakfelismeréssel'));
      body.append(toggle('snapping', 'Illesztés', 'Végpontokhoz, középpontokhoz, rácshoz'));
      body.append(toggle('gridSnap', 'Rácshoz illesztés', 'A rács lépésközéhez igazít'));
      body.append(el('div', { class: 'list-head', text: 'Megjelenés' }));
      body.append(toggle('showLabels', 'Eszköztár feliratok', 'Kikapcsolva csak ikonok (kis kijelzőn hasznos)'));
      body.append(toggle('shadows', 'Árnyékok'));
      body.append(toggle('perspective', 'Perspektivikus nézet', 'Kikapcsolva ortografikus'));
      body.append(el('div', { class: 'list-head', text: 'Anyag (tömegszámításhoz)' }));
      const mc = el('div', { class: 'opt-grid', style: { padding: '4px 16px 12px' } });
      for (const [name, d] of MATERIALS) {
        const o = el('div', { class: `opt ${s.material === name ? 'on' : ''}` }, el('div', { text: name }), el('small', { text: `${String(d).replace('.', ',')} g/cm³`, style: { color: 'var(--text-dim)' } }));
        onTap(o, () => { app.setSetting('material', name); app.setSetting('density', d); app.ui.refreshSheet(); });
        mc.append(o);
      }
      body.append(mc);
      body.append(el('div', { class: 'list-head', text: 'Névjegy' }));
      body.append(el('div', { class: 'set-row' }, el('div', { class: 'sl', html: 'Warázsló · saját CAD<br><small>OpenCascade (replicad) kernel, Three.js megjelenítés. Minden adat csak ezen az eszközön tárolódik.</small>' })));
    },
  });
}

export async function showHelp(app) {
  const html = `
  <div style="line-height:1.55;font-size:14px">
  <b>Ujjak</b><br>
  1 ujj húzás: a test(ek) forgatása a megfogott pont körül<br>2 ujj húzás: a nézőpont mozgatása · csípés: nagyítás · 2 ujj csavarása: körkörös forgatás<br>Az ujj soha nem rajzol – rajzolni csak az Apple Pencillel lehet<br>
  Koppintás: kijelölés (több elem is) · dupla koppintás: teljes test · üres helyre koppintás: kijelölés törlése<br>
  2 ujjas koppintás: visszavonás · 3 ujjas koppintás: újra<br><br>
  <b>Apple Pencil</b><br>
  Húzás: szabadkézi rajz (csak Pencillel) (vonal, kör, ív, téglalap, spline felismerése) · firkálás egy görbén: törlés<br>
  Vázlatpont megfogása: pont mozgatása · koppintás: kijelölés<br><br>
  <b>Billentyűzet</b><br>
  E kihúzás · F lekerekítés · M mozgatás · H héjazás · O lap eltolás · B boole · D mérés · X metszet<br>
  L vonal · R téglalap · C kör · A ív · S spline · P sokszög · T vágás<br>
  1/3/7 elöl/jobb/felül nézet · 0 izometrikus · Z mindent mutat · I izolálás · V nézet mód<br>
  ⌘Z visszavonás · ⇧⌘Z újra · ⌘S mentés · Enter kész · Esc mégse · Delete törlés
  </div>`;
  await app.ui.dialog({ title: 'Gesztusok és billentyűk', body: el('div', { html }), buttons: [{ label: 'Rendben', value: true, style: 'primary' }] });
}

// ---------------------------------------------------------------- 2D rajz
export async function openDrawing(app) {
  const { DrawingView } = await import('./drawing.js');
  if (!app.drawing) app.drawing = new DrawingView(app);
  app.drawing.open();
}

export { curveEnds, newBodyId, LENGTH_UNITS, getUnit };
