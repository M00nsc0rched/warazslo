// Oldalsó lapok, menük és egyszeri műveletek (elemek, előzmények, beállítások, export/import)
import * as THREE from 'three';
import { el, onTap, shareOrDownload, pickFile, safeName, uid } from '../util/misc.js';
import { icon } from './icons.js';
import { BODY_COLORS, newBodyId } from '../doc/document.js';
import { canonicalFrame, planeFromJSON } from '../sketch/manager.js';
import { fmtLen, fmtVolume, fmtArea, fmtMass, getUnit, LENGTH_UNITS, evalVariables, fmtVar, isValidVarName } from '../util/units.js';
import { curveEnds } from '../sketch/geom2d.js';
import { MATERIALS, MATERIAL_GROUPS, materialById, swatchCSS, createMaterial, ensureBoxUV } from '../view/materials.js';

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
    { icon: 'palette', label: 'Anyagok modellezéskor is', checked: !!app.settings.materialsInModel, onTap: () => { app.setSetting('materialsInModel', !app.settings.materialsInModel); app._syncScene(false); } },
    { icon: 'dimension', label: 'Vázlatméretek', checked: app.settings.showDims !== false, onTap: () => { app.setSetting('showDims', app.settings.showDims === false); app.annotations.refresh(); } },
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
    { icon: 'importFile', label: 'STEP / STL / DXF importálása', onTap: () => importModel(app) },
    { icon: 'image', label: 'Referencia kép beszúrása', onTap: () => insertImage(app) },
    { icon: 'share', label: 'Projektfájl mentése (.warazslo)', onTap: () => exportProjectFile(app) },
    { sep: true },
    { icon: 'variables', label: 'Változók', onTap: () => openVariables(app) },
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

const EXPORT_FORMATS = [
  ['step', 'STEP', 'CAD csere (SolidWorks, Fusion, NX, CNC/CAM)', 'cube'],
  ['stl', 'STL', '3D nyomtatás', 'cube'],
  ['3mf', '3MF', '3D nyomtatás színekkel (Bambu, Prusa, Orca)', 'cube'],
  ['obj', 'OBJ', 'Háló (grafika)', 'cube'],
  ['glb', 'GLB', '3D web / AR (glTF)', 'ar'],
  ['usdz', 'USDZ', 'AR nézet iPaden / iPhone-on', 'ar'],
  ['html', 'HTML nézet', 'Megosztható 3D nézet böngészőben', 'share'],
  ['brep', 'BREP', 'OpenCascade natív', 'cube'],
  ['drawing', 'Műszaki rajz', 'PDF / SVG / DXF', 'drawing'],
  ['dxf', 'DXF', 'Vázlat vagy sík lap körvonala (lézer, CNC)', 'sketch'],
  ['png', 'Kép', 'PNG képernyőkép', 'camera'],
];
const QUALITY = { base: [0.05, 0.25, 'Alap'], high: [0.01, 0.1, 'Magas'], ultra: [0.003, 0.05, 'Nagyon magas'] };

/** Export párbeszéd (formátum, hatókör, minőség, egység, külön fájlok). */
export function exportMenu(app, anchor, selectionOnly) {
  const hasSel = app.sel.some((s) => s.bodyId);
  const o = { fmt: app._exportFmt || 'step', scope: selectionOnly && hasSel ? 'sel' : 'visible', quality: app._exportQ || 'high', unit: 'mm', separate: false };
  const body = el('div');
  const render = () => {
    body.innerHTML = '';
    const chips = (key, opts) => {
      const c = el('div', { class: 'chips', style: { marginBottom: '10px', flexWrap: 'wrap' } });
      for (const [v, l] of opts) {
        const b = el('button', { class: `chip ${o[key] === v ? 'on' : ''}`, text: l });
        onTap(b, () => { o[key] = v; render(); });
        c.append(b);
      }
      return c;
    };
    const grid = el('div', { class: 'opt-grid', style: { marginBottom: '12px' } });
    for (const [id, name, desc, ic] of EXPORT_FORMATS) {
      const x = el('div', { class: `opt ${o.fmt === id ? 'on' : ''}`, html: `${icon(ic)}<b>${name}</b><small style="color:var(--text-dim)">${desc}</small>` });
      onTap(x, () => { o.fmt = id; render(); });
      grid.append(x);
    }
    body.append(grid);
    const meshFmt = ['stl', '3mf', 'obj', 'glb', 'html', 'usdz'].includes(o.fmt);
    if (!['png', 'drawing', 'dxf'].includes(o.fmt)) body.append(chips('scope', [...(hasSel ? [['sel', 'Kijelölt testek']] : []), ['visible', 'Látható testek'], ['all', 'Minden test']]));
    if (meshFmt) body.append(chips('quality', Object.entries(QUALITY).map(([k, v]) => [k, `${v[2]} felbontás`])));
    if (['step', 'stl', '3mf', 'obj'].includes(o.fmt)) body.append(chips('unit', [['mm', 'Milliméter'], ['in', 'Hüvelyk']]));
    if (['step', 'stl', '3mf', 'obj'].includes(o.fmt)) {
      const t = el('div', { class: `toggle ${o.separate ? 'on' : ''}` }, el('span', { class: 'sw' }), el('span', { text: 'Testenként külön fájl (ZIP)' }));
      onTap(t, () => { o.separate = !o.separate; render(); });
      body.append(t);
    }
  };
  render();
  app.ui.dialog({
    title: 'Exportálás', body,
    buttons: [{ label: 'Mégse', value: null, style: 'ghost' }, { label: 'Exportálás', value: () => ({ ...o }), style: 'primary' }],
  }).then((res) => {
    if (!res) return;
    app._exportFmt = res.fmt; app._exportQ = res.quality;
    runExport(app, res);
  });
}

function scopeBodies(app, scope) {
  const st = app.doc.state;
  if (scope === 'sel') { const ids = new Set(app.sel.filter((s) => s.bodyId).map((s) => s.bodyId)); return st.bodies.filter((b) => ids.has(b.id)); }
  if (scope === 'all') return st.bodies;
  return st.bodies.filter((b) => !app.doc.isHidden(b.id));
}

async function runExport(app, o) {
  if (o.fmt === 'png') return screenshot(app);
  if (o.fmt === 'drawing') return openDrawing(app);
  if (o.fmt === 'dxf') return exportDxf2D(app);
  const bodies = scopeBodies(app, o.scope);
  if (!bodies.length) { app.ui.toast('Nincs exportálható test', 'error'); return; }
  const name = bodies.length === 1 ? bodies[0].name : app.doc.name;
  const [tol, ang] = QUALITY[o.quality] || QUALITY.high;
  const scale = o.unit === 'in' ? 1 / 25.4 : 1;
  try {
    app.ui.toast('Exportálás…', '', 1500);
    const E = await import('../util/export3d.js');
    const meshesOf = async (list) => {
      const r = await app.kernel.query('exportMesh', { bodies: list.map((b) => ({ id: b.id, rev: b.rev })), tolerance: tol, angularTolerance: ang });
      return r.map((m, i) => ({ body: list[i], ...m }));
    };
    const single = async (list, fname) => {
      switch (o.fmt) {
        case 'step': return { name: `${fname}.step`, data: await app.kernel.query('exportFile', { format: 'step', bodies: list.map((b) => ({ id: b.id, rev: b.rev })), names: list.map((b) => b.name), colors: list.map((b) => b.color), unit: o.unit === 'in' ? 'INCH' : 'MM' }) };
        case 'brep': return { name: `${fname}.brep`, data: await app.kernel.query('exportFile', { format: 'brep', bodies: list.map((b) => ({ id: b.id, rev: b.rev })) }) };
        case 'stl': return { name: `${fname}.stl`, data: stlBinary(await meshesOf(list), scale) };
        case '3mf': {
          const ms = await meshesOf(list);
          const items = ms.map((m) => { const w = E.weld(m.vertices, m.triangles); return { name: m.body.name, color: materialColor(m.body), positions: w.positions, indices: w.indices }; });
          return { name: `${fname}.3mf`, data: E.build3MF(items, { unit: o.unit === 'in' ? 'inch' : 'millimeter', scale }) };
        }
        case 'obj': return { name: `${fname}.obj`, data: objText(await meshesOf(list), scale, E) };
        case 'glb': case 'html': {
          const ms = await meshesOf(list);
          const glb = await E.buildGLB(ms.map((m) => ({ name: m.body.name, positions: m.vertices, normals: m.normals, indices: m.triangles, material: bodyThreeMaterial(m.body) })));
          if (o.fmt === 'glb') return { name: `${fname}.glb`, data: glb };
          return { name: `${fname}.html`, data: new TextEncoder().encode(E.buildViewerHTML(glb, fname)), type: 'text/html' };
        }
        case 'usdz': await exportUSDZ(app, list); return null;
        default: return null;
      }
    };
    if (o.separate && bodies.length > 1 && ['step', 'stl', '3mf', 'obj'].includes(o.fmt)) {
      const { zipSync } = await import('three/addons/libs/fflate.module.js');
      const files = {};
      for (const b of bodies) {
        const f = await single([b], safeName(b.name));
        let n = f.name, k = 2;
        while (files[n]) n = f.name.replace(/(\.\w+)$/, ` (${k++})$1`);
        files[n] = new Uint8Array(f.data);
      }
      await shareOrDownload(new Blob([zipSync(files)], { type: 'application/zip' }), `${safeName(app.doc.name)}_${o.fmt}.zip`);
      return;
    }
    const f = await single(bodies, safeName(name));
    if (f) await shareOrDownload(new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name);
  } catch (e) {
    app.ui.toast(`Export hiba: ${e.message}`, 'error', 5000);
  }
}

function materialColor(b) {
  const m = b.material ? materialById(b.material) : null;
  return m ? m.color : b.color;
}

function bodyThreeMaterial(b) {
  const def = b.material ? materialById(b.material) : null;
  if (def && !def.tex) return createMaterial(def);
  return new THREE.MeshStandardMaterial({ color: def ? def.color : b.color, roughness: def ? def.roughness : 0.5, metalness: def ? def.metalness : 0.05 });
}

function stlBinary(meshes, scale) {
  let n = 0;
  for (const m of meshes) n += m.triangles.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = 'Warazslo STL';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (const m of meshes) {
    const v = m.vertices, t = m.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      o += 12;
      for (const k of [a, b, c]) { dv.setFloat32(o, v[k] * scale, true); dv.setFloat32(o + 4, v[k + 1] * scale, true); dv.setFloat32(o + 8, v[k + 2] * scale, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}

function objText(meshes, scale, E) {
  let out = '# Warázsló\n';
  let base = 1;
  for (const m of meshes) {
    const w = E.weld(m.vertices, m.triangles);
    out += `o ${m.body.name.replace(/\s+/g, '_')}\n`;
    for (let i = 0; i < w.positions.length; i += 3) out += `v ${(w.positions[i] * scale).toFixed(5)} ${(w.positions[i + 1] * scale).toFixed(5)} ${(w.positions[i + 2] * scale).toFixed(5)}\n`;
    for (let i = 0; i < w.indices.length; i += 3) out += `f ${w.indices[i] + base} ${w.indices[i + 1] + base} ${w.indices[i + 2] + base}\n`;
    base += w.positions.length / 3;
  }
  return new TextEncoder().encode(out);
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
      const def = b.material ? materialById(b.material) : null;
      let mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0.05 });
      if (def) { mat = createMaterial(def); if (mat.userData.needsUV) ensureBoxUV(g, mat.userData.texScale); }
      root.add(new THREE.Mesh(g, mat));
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
  const file = await pickFile('.step,.stp,.stl,.dxf,.STEP,.STP,.STL,.DXF');
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'dxf') return importDxf(app, file);
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

/** DXF importálása új vázlatba: a kijelölt sík lapra / síkra, különben a rácssíkra (alapból XY). */
export async function importDxf(app, file) {
  try {
    const { parseDxf } = await import('../util/dxf.js');
    const r = parseDxf(await file.text());
    const skipped = Object.entries(r.skipped).map(([k, n]) => `${k} ×${n}`).join(', ');
    if (!r.count) { app.ui.toast(`A DXF-ben nincs olvasható 2D geometria${skipped ? ` (kihagyva: ${skipped})` : ''}`, 'error', 5000); return; }
    if (r.count > 4000 && !(await app.ui.confirm('Nagy DXF', `${r.count} elem – a régiók számítása lassú lehet. Folytatod?`, 'Importálás', false))) return;
    // célsík
    let frame = null;
    const s = app.sel.length === 1 ? app.sel[0] : null;
    if (s && s.type === 'face') {
      const g = app.bodies.gfx.get(s.bodyId);
      const fi = g && g.data.faces && g.data.faces[s.index];
      if (fi && fi.type === 'PLANE') frame = canonicalFrame(new THREE.Vector3(...fi.normal), new THREE.Vector3(...fi.center));
    } else if (s && s.type === 'plane') frame = planeFromJSON(app.doc.plane(s.planeId));
    if (!frame) {
      const gf = app.vp.gridFrame;
      frame = { origin: gf.origin.clone(), xDir: gf.xDir.clone(), yDir: gf.yDir.clone(), normal: gf.normal.clone() };
    }
    let curves = r.curves;
    let moved = false;
    if (r.bbox) {
      // messze az origótól (pl. térképi koordináták): a bal alsó sarkot az origóba toljuk
      const [x0, y0, x1, y1] = r.bbox;
      const size = Math.max(x1 - x0, y1 - y0, 1);
      if (Math.hypot((x0 + x1) / 2, (y0 + y1) / 2) > size * 5) {
        const { convertCurves } = await import('../app.js');
        const from = { origin: new THREE.Vector3(x0, y0, 0), xDir: new THREE.Vector3(1, 0, 0), yDir: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1) };
        const to = { origin: new THREE.Vector3(0, 0, 0), xDir: new THREE.Vector3(1, 0, 0), yDir: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1) };
        curves = convertCurves(curves.map((c) => ({ ...c })), to, from);
        moved = true;
      }
    }
    const res = app.addCurves(frame, curves.map((c) => ({ ...c, id: uid('c') })), 'DXF importálás', 'importFile');
    if (res) {
      const sk = app.doc.sketch(res.sketchId);
      if (sk) {
        const f = planeFromJSON(sk.plane);
        const box = new THREE.Box3();
        for (const c of res.curves) for (const e of curveEnds(c).concat(c.p ? [c.p] : c.c ? [c.c] : c.pts ? c.pts : [])) box.expandByPoint(f.origin.clone().addScaledVector(f.xDir, e[0]).addScaledVector(f.yDir, e[1]));
        if (!box.isEmpty()) app.vp.fitBox(box.union(app.bodies.bounds()));
      }
    }
    app.ui.toast(`${r.count} elem importálva${moved ? ' (az origóhoz igazítva)' : ''}${skipped ? ` · kihagyva: ${skipped}` : ''}`, 'ok', 4500);
  } catch (e) {
    console.error(e);
    app.ui.toast(`DXF hiba: ${e.message}`, 'error', 5000);
  }
}

/** 2D DXF export: a kijelölt vázlat, a kijelölt sík lap körvonala, vagy az aktív vázlat. */
export async function exportDxf2D(app) {
  const { DxfWriter } = await import('../util/dxf.js');
  const w = new DxfWriter({ units: getUnit() === 'in' ? 'in' : 'mm' });
  w.addLayer('KONTUR', 7).addLayer('SEGEDVONAL', 8, 'DASHED');
  const scale = getUnit() === 'in' ? 1 / 25.4 : 1;
  const scaled = (curves) => (scale === 1 ? curves : curves.map((c) => scaleCurve(c, scale)));
  const sel = app.sel;
  let name = app.doc.name;
  let curves = null;
  const skIds = [...new Set(sel.filter((s) => s.sketchId).map((s) => s.sketchId))];
  const faces = sel.filter((s) => s.type === 'face');
  if (skIds.length === 1) {
    const sk = app.doc.sketch(skIds[0]);
    curves = sk.curves; name = `${app.doc.name}_${sk.name}`;
  } else if (faces.length === 1) {
    const s = faces[0];
    const g = app.bodies.gfx.get(s.bodyId);
    const fi = g && g.data.faces && g.data.faces[s.index];
    if (!fi || fi.type !== 'PLANE') { app.ui.toast('Csak sík lap körvonala exportálható', 'error'); return; }
    const b = app.doc.body(s.bodyId);
    const ids = await app.kernel.query('faceEdges', { body: { id: b.id, rev: b.rev }, faces: [s.index] });
    const { projectEdge } = await import('../tools/extra.js');
    const frame = canonicalFrame(new THREE.Vector3(...fi.normal), new THREE.Vector3(...fi.center));
    curves = ids.flatMap((i) => projectEdge(app, s.bodyId, i, frame));
    name = `${app.doc.name}_${b.name}_lap`;
  } else if (app.tool && app.tool.isSketchTool && app.tool.frame) {
    const sk = app.sketches.findSketchOnPlane(app.tool.frame);
    if (sk) { curves = sk.curves; name = `${app.doc.name}_${sk.name}`; }
  } else if (app.doc.state.sketches.length === 1) {
    const sk = app.doc.state.sketches[0];
    curves = sk.curves; name = `${app.doc.name}_${sk.name}`;
  }
  if (!curves || !curves.length) { app.ui.toast('Jelölj ki egy vázlatot (vagy elemét) vagy egy sík lapot a DXF exporthoz', 'error', 4000); return; }
  w.curves(scaled(curves), 'KONTUR', 'SEGEDVONAL');
  shareOrDownload(new Blob([w.toString()], { type: 'application/dxf' }), `${safeName(name)}.dxf`);
}

function scaleCurve(c, k) {
  const S = (p) => [p[0] * k, p[1] * k];
  switch (c.t) {
    case 'line': return { ...c, a: S(c.a), b: S(c.b) };
    case 'circle': return { ...c, c: S(c.c), r: c.r * k };
    case 'arc': return { ...c, c: S(c.c), r: c.r * k };
    case 'ellipse': return { ...c, c: S(c.c), rx: c.rx * k, ry: c.ry * k };
    case 'spline': return { ...c, pts: c.pts.map(S) };
    case 'point': return { ...c, p: S(c.p) };
    case 'text': return { ...c, p: S(c.p), size: c.size * k, spacing: (c.spacing || 0) * k };
    default: return c;
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
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { right: anchor.x, top: anchor.y };
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
  import('../sketch/annotate.js').then(({ addDefaultDimension }) => addDefaultDimension(app));
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
    const box = el('div');
    let tv = 0, ta = 0, tm = 0;
    props.forEach((p, i) => {
      const dens = bodyDensity(app, bodies[i]);
      const mat = bodies[i].material ? materialById(bodies[i].material) : null;
      tv += p.volume; ta += p.area; tm += (p.volume / 1000) * dens;
      const bb = p.bbox;
      box.append(el('div', { class: 'measure-card', style: { marginBottom: '10px' } },
        el('div', { style: { fontWeight: 650, marginBottom: '4px' }, text: bodies[i].name }),
        mrow('Térfogat', fmtVolume(p.volume)), mrow('Felület', fmtArea(p.area)),
        mrow(`Tömeg (${mat ? mat.name : app.settings.material || 'anyag'}, ${String(dens).replace('.', ',')} g/cm³)`, fmtMass((p.volume / 1000) * dens)),
        mrow('Befoglaló méret', `${fmtLen(bb[3] - bb[0], { unit: false })} × ${fmtLen(bb[4] - bb[1], { unit: false })} × ${fmtLen(bb[5] - bb[2])}`),
        mrow('Súlypont', p.center.map((x) => fmtLen(x, { unit: false })).join('; '))));
    });
    if (props.length > 1) box.append(el('div', { class: 'measure-card' }, mrow('Összes térfogat', fmtVolume(tv)), mrow('Összes tömeg', fmtMass(tm))));
    await app.ui.dialog({ title: 'Tömegtulajdonságok', body: box, buttons: [{ label: 'Bezárás', value: true, style: 'primary' }] });
  } catch (e) { app.ui.toast(e.message, 'error'); }
}

const mrow = (k, v) => el('div', { class: 'mrow' }, el('span', { text: k }), el('b', { text: v }));

// ---------------------------------------------------------------- beállítások
const DEFAULT_DENSITIES = [['PLA', 1.24], ['PETG', 1.27], ['ABS', 1.04], ['Nylon', 1.14], ['Alumínium', 2.7], ['Acél', 7.85], ['Sárgaréz', 8.5], ['Fa (fenyő)', 0.5]];

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
      for (const [name, d] of DEFAULT_DENSITIES) {
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

// ---------------------------------------------------------------- változók
export function openVariables(app) {
  if (app.ui.sheetOpen('Változók')) { app.ui.closeSheet(); return; }
  let draft = (app.doc.state.variables || []).map((v) => ({ ...v }));
  const apply = () => {
    const bad = draft.find((v) => v.name && !isValidVarName(v.name));
    if (bad) { app.ui.toast(`Érvénytelen név: ${bad.name}`, 'error'); return; }
    const names = draft.filter((v) => v.name).map((v) => v.name.toLowerCase());
    if (new Set(names).size !== names.length) { app.ui.toast('Két változónak nem lehet azonos a neve', 'error'); return; }
    app.setVariables(draft.filter((v) => v.name && String(v.expr).trim()));
  };
  app.ui.openSheet({
    title: 'Változók', side: 'right',
    build: (body) => {
      const { map, errors } = evalVariables(draft.filter((v) => v.name));
      body.append(el('div', { class: 'list-head', text: 'Név · kifejezés · érték' }));
      body.append(el('div', { class: 'set-row', html: '<div class="sl"><small>Méreteknél és minden számmezőben használhatók, pl. <b>D/2</b>, <b>3*D + 5mm</b>. A változó módosításakor a vázlatok és a hozzájuk kötött lépések újraszámolódnak.</small></div>' }));
      draft.forEach((v, i) => {
        const name = el('input', { type: 'text', value: v.name, placeholder: 'D', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
        const expr = el('input', { type: 'text', value: v.expr, placeholder: '20 mm', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
        const val = map.get((v.name || '').toLowerCase());
        const vEl = el('span', { class: `val ${errors.has(v.name) ? 'err' : ''}`, text: errors.has(v.name) ? '!' : fmtVar(val) });
        const del = el('button', { class: 'act', html: icon('trash') });
        name.addEventListener('change', () => { draft[i].name = name.value.trim(); app.ui.refreshSheet(); });
        expr.addEventListener('change', () => { draft[i].expr = expr.value.trim(); app.ui.refreshSheet(); });
        onTap(del, () => { draft.splice(i, 1); app.ui.refreshSheet(); });
        body.append(el('div', { class: 'var-row' }, name, expr, vEl, del));
      });
      const add = el('button', { class: 'btn', html: `${icon('plus')}<span>Új változó</span>`, style: { margin: '10px 12px' } });
      onTap(add, () => { let n = 1; while (draft.some((v) => v.name === `V${n}`)) n++; draft.push({ name: `V${n}`, expr: '10 mm' }); app.ui.refreshSheet(); });
      body.append(add);
    },
    foot: (f) => {
      const ok = el('button', { class: 'btn primary', html: `${icon('check')}<span>Alkalmaz</span>` });
      onTap(ok, apply);
      f.append(ok);
    },
  });
}

// ---------------------------------------------------------------- helyzetmenü (hosszú nyomás)
export function contextMenu(app, it, at) {
  const doc = app.doc;
  const items = [];
  if (it && it.bodyId) {
    const b = doc.body(it.bodyId);
    app.setSelection([{ type: 'body', bodyId: it.bodyId }]);
    items.push({ head: b ? b.name : 'Test' });
    if (app.mode !== 'view') {
      items.push({ icon: 'move', label: 'Mozgatás / forgatás', onTap: () => app.startTool('move') });
      items.push({ icon: 'copy', label: 'Másolat', onTap: () => duplicateBodies(app) });
      items.push({ icon: 'palette', label: 'Anyag és szín', onTap: () => materialSheet(app, [it.bodyId]) });
    }
    items.push({ icon: 'eyeOff', label: 'Elrejtés', onTap: () => { doc.setHidden(it.bodyId, true); app.clearSelection(); } });
    items.push({ icon: 'isolate', label: 'Izolálás', onTap: () => app.setIsolation(new Set([it.bodyId])) });
    items.push({ icon: 'info', label: 'Tömeg és térfogat', onTap: () => showProperties(app) });
    items.push({ icon: 'exportFile', label: 'Exportálás…', onTap: () => exportMenu(app, at, true) });
    if (app.mode !== 'view') items.push({ sep: true }, { icon: 'trash', label: 'Törlés', danger: true, onTap: () => app.deleteSelection() });
  } else if (it && it.sketchId) {
    const sk = doc.sketch(it.sketchId);
    items.push({ head: sk ? sk.name : 'Vázlat' });
    if (app.mode !== 'view') items.push({ icon: 'sketch', label: 'Vázlat szerkesztése', onTap: () => app.enterSketchMode(planeFromJSON(sk.plane)) });
    items.push({ icon: 'items', label: 'Teljes vázlat kijelölése', onTap: () => app.setSelection([{ type: 'sketch', sketchId: it.sketchId }]) });
    items.push({ icon: 'eyeOff', label: 'Elrejtés', onTap: () => { doc.setHidden(it.sketchId, true); app.clearSelection(); } });
    if (app.mode !== 'view') items.push({ sep: true }, { icon: 'trash', label: 'Vázlat törlése', danger: true, onTap: () => { app.setSelection([{ type: 'sketch', sketchId: it.sketchId }]); app.deleteSelection(); } });
  } else if (it && it.type === 'plane') {
    const p = doc.plane(it.planeId);
    items.push({ head: p ? p.name : 'Sík' });
    items.push({ icon: 'sketch', label: 'Vázlat a síkon', onTap: () => app.enterSketchMode(planeFromJSON(p)) });
    items.push({ icon: 'eyeOff', label: 'Elrejtés', onTap: () => doc.setHidden(it.planeId, true) });
    items.push({ icon: 'trash', label: 'Törlés', danger: true, onTap: () => { app.setSelection([{ type: 'plane', planeId: it.planeId }]); app.deleteSelection(); } });
  } else {
    if (app.mode !== 'view') {
      items.push({ icon: 'sketch', label: 'Vázlat a rácssíkon', onTap: () => app.enterSketchMode(app.vp.gridFrame) });
      items.push({ icon: 'box', label: 'Doboz beszúrása', onTap: () => app.startTool('primitive', { type: 'box' }) });
    }
    items.push({ icon: 'fit', label: 'Minden látszódjon', onTap: () => app.vp.fitBox(app.bodies.bounds()) });
    const hidden = doc.view.hidden || [];
    if (hidden.length) items.push({ icon: 'eye', label: `Rejtettek megjelenítése (${hidden.length})`, onTap: () => doc.setViewProp('hidden', []) });
    if (app.isolated) items.push({ icon: 'isolate', label: 'Izolálás vége', onTap: () => app.setIsolation(null) });
  }
  app.ui.menu(at, items, { side: 'right' });
}

// ---------------------------------------------------------------- anyag és szín
export function materialSheet(app, ids) {
  ids = ids && ids.length ? ids : [...new Set(app.sel.filter((s) => s.bodyId).map((s) => s.bodyId))];
  if (!ids.length) { app.ui.toast('Jelölj ki egy testet', '', 1500); return; }
  let group = app._matGroup || MATERIAL_GROUPS[0];
  const cur = () => { const b = app.doc.body(ids[0]); return b ? b.material || null : null; };
  app.ui.openSheet({
    title: 'Anyag és szín', side: 'right',
    build: (body) => {
      body.append(el('div', { class: 'list-head', text: 'Modellező szín' }));
      const cr = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '4px 14px 10px' } });
      for (const c of [...BODY_COLORS, '#8e8e98', '#3a3a44', '#f2f2f2', '#e8d36a', '#e07b39', '#d9534f', '#5cb85c', '#337ab7']) {
        const b = el('button', { style: { width: '34px', height: '34px', borderRadius: '10px', border: '2px solid rgba(255,255,255,.2)', background: c, cursor: 'pointer' } });
        onTap(b, () => setBodyColor(app, ids, c));
        cr.append(b);
      }
      body.append(cr);
      body.append(el('div', { class: 'list-head', text: `Anyag (${MATERIALS.length}) – a Nézet módban látszik` }));
      const chips = el('div', { class: 'chips', style: { flexWrap: 'wrap', margin: '0 12px 8px' } });
      for (const gname of MATERIAL_GROUPS) {
        const b = el('button', { class: `chip ${gname === group ? 'on' : ''}`, text: gname });
        onTap(b, () => { group = gname; app._matGroup = gname; app.ui.refreshSheet(); });
        chips.append(b);
      }
      body.append(chips);
      const grid = el('div', { class: 'opt-grid', style: { padding: '4px 12px 14px' } });
      const none = el('div', { class: `opt ${!cur() ? 'on' : ''}` }, el('div', { style: { width: '44px', height: '44px', borderRadius: '50%', border: '2px dashed var(--line-2)' } }), el('div', { text: 'Nincs anyag' }));
      onTap(none, () => setBodyMaterial(app, ids, null));
      grid.append(none);
      for (const m of MATERIALS.filter((x) => x.group === group)) {
        const o = el('div', { class: `opt ${cur() === m.id ? 'on' : ''}` },
          el('div', { style: { width: '44px', height: '44px', borderRadius: '50%', background: swatchCSS(m), boxShadow: 'inset 0 -2px 6px rgba(0,0,0,.35)' } }),
          el('div', { text: m.name }), el('small', { text: `${String(m.density).replace('.', ',')} g/cm³`, style: { color: 'var(--text-dim)' } }));
        onTap(o, () => setBodyMaterial(app, ids, m.id));
        grid.append(o);
      }
      body.append(grid);
    },
  });
}

export function setBodyMaterial(app, ids, matId) {
  const st = app.doc.state;
  const m = matId ? materialById(matId) : null;
  app.doc.commit(m ? `Anyag: ${m.name}` : 'Anyag törlése', { ...st, bodies: st.bodies.map((b) => (ids.includes(b.id) ? { ...b, material: matId || undefined } : b)) }, { icon: 'palette' });
  if (m && app.mode !== 'view' && !app.settings.materialsInModel) app.ui.toast('Az anyag a Nézet módban (V) látszik', '', 2200);
}

export function bodyDensity(app, b) {
  const m = b && b.material ? materialById(b.material) : null;
  return m ? m.density : app.settings.density || 1.24;
}
