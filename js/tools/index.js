// Eszköz-regiszter és helyzetérzékeny eszköztárak
import * as THREE from 'three';
import * as sheets from "../ui/sheets.js";
import { icon } from "../ui/icons.js";
import { onTap } from "../util/misc.js";
import { ExtrudeTool } from './extrude.js';
import { FilletTool } from './fillet.js';
import { ShellTool, OffsetFaceTool } from './shell.js';
import { MoveTool, ScaleTool } from './move.js';
import { PrimitiveTool } from './primitive.js';
import { BooleanTool } from './boolean.js';
import { MirrorTool, PatternTool } from './mirror.js';
import { RevolveTool } from './revolve.js';
import { SweepTool, LoftTool } from './sweep.js';
import { SplitTool } from './split.js';
import { HoleTool } from './hole.js';
import { MeasureTool } from './measure.js';
import { SectionTool } from './section.js';
import { PlaneTool } from './plane.js';
import { GearTool } from './gear.js';
import { SKETCH_TOOLS, SketchPaletteTool } from '../sketch/tools.js';

const REGISTRY = {
  extrude: ExtrudeTool, fillet: FilletTool, chamfer: FilletTool, shell: ShellTool, offsetFace: OffsetFaceTool,
  move: MoveTool, scale: ScaleTool, primitive: PrimitiveTool, boolean: BooleanTool, mirror: MirrorTool,
  pattern: PatternTool, revolve: RevolveTool, sweep: SweepTool, loft: LoftTool, split: SplitTool, hole: HoleTool,
  measure: MeasureTool, section: SectionTool, plane: PlaneTool, gear: GearTool, sketch: SketchPaletteTool,
  ...SKETCH_TOOLS,
};

export function createTool(app, id, opts = {}) {
  if (id === 'chamfer') opts = { ...opts, mode: 'chamfer' };
  const C = REGISTRY[id];
  if (!C) throw new Error(`Ismeretlen eszköz: ${id}`);
  return new C(app, opts);
}

// ---------------------------------------------------------------- kijelölés összegzés
const NAMES = { face: 'lap', edge: 'él', vertex: 'csúcs', body: 'test', region: 'régió', curve: 'görbe', spoint: 'pont', sketch: 'vázlat', plane: 'sík' };

export function selectionSummary(app, sel) {
  const counts = {};
  for (const s of sel) counts[s.type] = (counts[s.type] || 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${NAMES[k] || k}`);
  let planarFaces = 0;
  for (const s of sel) {
    if (s.type !== 'face') continue;
    const g = app.bodies.gfx.get(s.bodyId);
    const fi = g && g.data.faces && g.data.faces[s.index];
    if (fi && fi.type === 'PLANE') planarFaces++;
  }
  const bodyIds = new Set(sel.filter((s) => s.bodyId).map((s) => s.bodyId));
  return { text: parts.join(', '), counts, planarFaces, bodyIds, n: sel.length };
}

// ---------------------------------------------------------------- bal eszköztár
export function buildLeftToolbar(app) {
  const sum = selectionSummary(app, app.sel);
  const c = sum.counts;
  const tool = app.tool;
  const T = (id, icon, label, extra = {}) => ({ icon, label, active: tool && tool.toolId === id, onTap: () => (tool && tool.toolId === id ? app.setTool(null) : app.startTool(id)), ...extra });

  const view = app.mode === 'view';
  const top = [
    { icon: 'modeling', label: 'Modellezés', active: !view, onTap: () => app.setMode('model') },
    { icon: 'eye', label: 'Nézet', sub: 'Csak megtekintés', kbd: 'V', active: view, onTap: () => app.setMode('view') },
    { icon: 'drawing', label: 'Rajz', onTap: () => sheets.openDrawing(app) },
    { icon: 'items', label: 'Elemek', active: app.ui.sheetOpen('Elemek'), onTap: () => sheets.toggleItems(app) },
  ];

  if (view) return buildViewToolbar(app, top, sum, tool);

  let ctx = [];
  const only = (...types) => Object.keys(c).length > 0 && Object.keys(c).every((k) => types.includes(k));

  if (tool && tool.isSketchTool) {
    ctx = SketchPaletteTool.palette(app);
  } else if (!sum.n) {
    ctx = [
      { icon: 'sketch', label: 'Vázlat', menu: true, onTap: (t) => sketchMenu(app, t) },
      { icon: 'insert', label: 'Beszúrás', menu: true, onTap: (t) => insertMenu(app, t) },
      { icon: 'construct', label: 'Szerkesztés', menu: true, onTap: (t) => constructMenu(app, t) },
      { icon: 'transform', label: 'Transzformáció', menu: true, onTap: (t) => transformMenu(app, t) },
      { icon: 'tools', label: 'Eszközök', menu: true, onTap: (t) => toolsMenu(app, t) },
    ];
  } else {
    ctx.push({ icon: 'deselect', label: 'Kijelölés törlése', sub: sum.text, onTap: () => app.clearSelection() });
    ctx.push('-');
    const hasProfiles = (c.region || 0) + sum.planarFaces > 0 && only('region', 'face');
    if (only('face')) {
      if (sum.planarFaces) ctx.push(T('extrude', 'extrude', 'Kihúzás', { kbd: 'E', sub: 'Tolás/húzás' }));
      ctx.push(T('offsetFace', 'offsetFace', 'Lap eltolás', { kbd: 'O' }));
      ctx.push(T('fillet', 'fillet', 'Lekerekítés/Letörés', { kbd: 'F', sub: 'A lap élei' }));
      ctx.push(T('shell', 'shell', 'Héjazás', { kbd: 'H', sub: 'Lap eltávolítása' }));
      if (sum.planarFaces === 1 && c.face === 1) {
        ctx.push({ icon: 'sketch', label: 'Vázlat a lapra', onTap: () => sketchOnSelection(app) });
        ctx.push(T('hole', 'hole', 'Furat'));
      }
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M', sub: 'A teljes test' }));
    } else if (only('edge')) {
      ctx.push(T('fillet', 'fillet', 'Lekerekítés', { kbd: 'F' }));
      ctx.push(T('chamfer', 'chamfer', 'Élletörés'));
      ctx.push(T('sweep', 'sweep', 'Söprés útvonal'));
    } else if (only('body')) {
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M' }));
      ctx.push(T('scale', 'scale', 'Méretezés'));
      ctx.push(T('mirror', 'mirror', 'Tükrözés'));
      ctx.push(T('pattern', 'pattern', 'Kiosztás', { sub: 'Lineáris / kör' }));
      if (c.body >= 2) ctx.push(T('boolean', 'boolean', 'Boole-műveletek', { kbd: 'B', sub: 'Egyesítés, kivonás' }));
      ctx.push(T('shell', 'shell', 'Héjazás', { sub: 'Üreges test' }));
      ctx.push(T('split', 'split', 'Szétvágás'));
      ctx.push({ icon: 'palette', label: 'Szín', menu: true, onTap: (t) => sheets.colorMenu(app, t) });
      ctx.push({ icon: 'copy', label: 'Másolat', onTap: () => sheets.duplicateBodies(app) });
      ctx.push({ icon: 'exportFile', label: 'Exportálás', menu: true, onTap: (t) => sheets.exportMenu(app, t, true) });
    } else if (hasProfiles) {
      ctx.push(T('extrude', 'extrude', 'Kihúzás', { kbd: 'E' }));
      ctx.push(T('revolve', 'revolve', 'Forgatás tengely körül'));
      ctx.push(T('sweep', 'sweep', 'Söprés'));
      if ((c.region || 0) + sum.planarFaces >= 2) ctx.push(T('loft', 'loft', 'Átmenet (loft)'));
      if (c.region) ctx.push(T('move', 'move', 'Vázlat mozgatása'));
    } else if (only('curve', 'region', 'spoint', 'sketch')) {
      if (c.region) ctx.push(T('extrude', 'extrude', 'Kihúzás', { kbd: 'E' }));
      if (c.curve) {
        ctx.push({ icon: 'construction', label: 'Segédvonal ki/be', onTap: () => sheets.toggleConstruction(app) });
        ctx.push(T('offsetCurve', 'offsetCurve', 'Görbe eltolás'));
        ctx.push(T('sweep', 'sweep', 'Söprés útvonal'));
      }
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M' }));
      if (c.curve === 1 || c.spoint) ctx.push({ icon: 'rename', label: 'Méret megadása', onTap: () => sheets.editDimension(app) });
    } else if (only('plane')) {
      ctx.push({ icon: 'sketch', label: 'Vázlat a síkon', onTap: () => sketchOnSelection(app) });
      ctx.push(T('section', 'section', 'Metszet itt'));
    } else if (only('body', 'plane', 'face')) {
      ctx.push(T('mirror', 'mirror', 'Tükrözés'));
      ctx.push(T('split', 'split', 'Szétvágás'));
    } else if (only('face', 'edge')) {
      ctx.push(T('fillet', 'fillet', 'Lekerekítés/Letörés', { kbd: 'F' }));
    }
    if (c.region || c.face || c.edge) ctx.push(T('revolve', 'revolve', 'Forgatás tengely körül'));
    ctx = dedupe(ctx);
    ctx.push('-');
    ctx.push({ icon: 'isolate', label: 'Izolálás', sub: app.isolated ? 'Be' : 'Ki', active: !!app.isolated, onTap: () => sheets.toggleIsolate(app) });
    ctx.push({ icon: 'trash', label: 'Törlés', onTap: () => app.deleteSelection() });
  }

  const bottom = [
    [
      { icon: 'section', label: 'Metszet', sub: app.sectionActive ? 'Be' : 'Ki', active: tool && tool.toolId === 'section', onTap: () => (tool && tool.toolId === 'section' ? tool.done() : app.startTool('section')) },
      { icon: 'measure', label: 'Mérés', kbd: 'D', active: tool && tool.toolId === 'measure', onTap: () => (tool && tool.toolId === 'measure' ? app.setTool(null) : app.startTool('measure')) },
    ],
    { row: [
      { icon: 'undo', label: 'Visszavonás', disabled: !(app.doc && app.doc.canUndo()), onTap: () => app.undo() },
      { icon: 'redo', label: 'Újra', disabled: !(app.doc && app.doc.canRedo()), onTap: () => app.redo() },
    ] },
  ];
  return { groups: [top, ctx], bottom };
}

/** Nézet mód: csak megtekintő eszközök. */
function buildViewToolbar(app, top, sum, tool) {
  const vp = app.vp;
  const V = (x, y, z) => ({ x, y, z });
  const go = (d, up) => () => {
    vp.setViewDirection(new THREE.Vector3(d.x, d.y, d.z), true, up ? new THREE.Vector3(up.x, up.y, up.z) : null);
    vp.fitBox(app.bodies.bounds());
  };
  const ctx = [
    { icon: 'cube', label: 'Izometrikus', kbd: '0', onTap: go(V(1, -1.35, 0.95)) },
    { icon: 'box', label: 'Elölnézet', kbd: '1', onTap: go(V(0, -1, 0)) },
    { icon: 'box', label: 'Felülnézet', kbd: '7', onTap: go(V(0, 0, 1), V(0, 1, 0)) },
    { icon: 'box', label: 'Oldalnézet', kbd: '3', onTap: go(V(1, 0, 0)) },
    { icon: 'fit', label: 'Minden látszódjon', kbd: 'Z', onTap: () => vp.fitBox(app.bodies.bounds()) },
    '-',
    { icon: 'rotate', label: 'Körbeforgatás', sub: vp.autoRotate ? 'Be' : 'Ki', active: !!vp.autoRotate, onTap: () => { vp.setAutoRotate(!vp.autoRotate); app.updateToolbar(); } },
    { icon: 'display', label: 'Megjelenítés', sub: sheets.displayName(app.settings.display), onTap: (t) => sheets.displayMenu(app, t) },
    { icon: 'isolate', label: 'Izolálás', sub: app.isolated ? 'Be' : sum.n ? 'Kijelölt' : 'Ki', active: !!app.isolated, onTap: () => sheets.toggleIsolate(app) },
    { icon: 'info', label: 'Tömeg és térfogat', onTap: () => sheets.showProperties(app) },
    { icon: 'ar', label: 'AR nézet', sub: 'USDZ', onTap: (t) => sheets.exportMenu(app, t, false) },
  ];
  if (sum.n) ctx.unshift({ icon: 'deselect', label: 'Kijelölés törlése', sub: sum.text, onTap: () => app.clearSelection() }, '-');
  const bottom = [[
    { icon: 'section', label: 'Metszet', sub: app.sectionActive ? 'Be' : 'Ki', active: tool && tool.toolId === 'section', onTap: () => (tool && tool.toolId === 'section' ? tool.done() : app.startTool('section')) },
    { icon: 'measure', label: 'Mérés', kbd: 'D', active: tool && tool.toolId === 'measure', onTap: () => (tool && tool.toolId === 'measure' ? app.setTool(null) : app.startTool('measure')) },
  ]];
  return { groups: [top, ctx], bottom };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((b) => {
    if (b === '-') return true;
    const k = b.label;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sketchOnSelection(app) {
  const s = app.sel[0];
  let frame = null;
  if (s.type === 'face') {
    const g = app.bodies.gfx.get(s.bodyId);
    const fi = g.data.faces[s.index];
    frame = sheets.frameFromFace(fi);
  } else if (s.type === 'plane') {
    frame = sheets.frameFromPlane(app.doc.plane(s.planeId));
  }
  if (!frame) return;
  app.vp.setGridFrame(frame);
  app.clearSelection();
  // nézet a síkra merőlegesen
  app.vp.setViewDirection(frame.normal.clone(), true, Math.abs(frame.normal.z) > 0.9 ? frame.yDir.clone() : null);
  app.startTool('line', { frame });
}

// ---------------------------------------------------------------- menük
function sketchMenu(app, anchor) {
  app.ui.menu(anchor, [
    { head: 'Vázlateszközök' },
    { icon: 'line', label: 'Vonal', sc: 'L', onTap: () => app.startTool('line') },
    { icon: 'rect', label: 'Téglalap', sc: 'R', onTap: () => app.startTool('rect') },
    { icon: 'rectCenter', label: 'Téglalap középről', onTap: () => app.startTool('rectCenter') },
    { icon: 'circle', label: 'Kör', sc: 'C', onTap: () => app.startTool('circle') },
    { icon: 'arc', label: 'Ív (3 pont)', sc: 'A', onTap: () => app.startTool('arc') },
    { icon: 'arcTangent', label: 'Érintő ív', onTap: () => app.startTool('tangentArc') },
    { icon: 'spline', label: 'Spline', sc: 'S', onTap: () => app.startTool('spline') },
    { icon: 'polygon', label: 'Sokszög', sc: 'P', onTap: () => app.startTool('polygon') },
    { icon: 'slot', label: 'Hosszlyuk', onTap: () => app.startTool('slot') },
    { icon: 'ellipse', label: 'Ellipszis', onTap: () => app.startTool('ellipse') },
    { icon: 'point', label: 'Pont', onTap: () => app.startTool('point') },
    { icon: 'freehand', label: 'Szabadkézi (Pencil)', onTap: () => app.startTool('freehand') },
    { sep: true },
    { icon: 'trim', label: 'Vágás', sc: 'T', onTap: () => app.startTool('trim') },
    { icon: 'sketchFillet', label: 'Sarok lekerekítés', onTap: () => app.startTool('sketchFillet') },
    { icon: 'text', label: 'Szöveg', onTap: () => app.startTool('text') },
  ]);
}

function insertMenu(app, anchor) {
  app.ui.menu(anchor, [
    { head: 'Alaptestek' },
    { icon: 'box', label: 'Doboz', onTap: () => app.startTool('primitive', { type: 'box' }) },
    { icon: 'cylinder', label: 'Henger', onTap: () => app.startTool('primitive', { type: 'cylinder' }) },
    { icon: 'sphere', label: 'Gömb', onTap: () => app.startTool('primitive', { type: 'sphere' }) },
    { icon: 'cone', label: 'Kúp', onTap: () => app.startTool('primitive', { type: 'cone' }) },
    { icon: 'torus', label: 'Tórusz', onTap: () => app.startTool('primitive', { type: 'torus' }) },
    { icon: 'wedge', label: 'Ék', onTap: () => app.startTool('primitive', { type: 'wedge' }) },
    { head: 'Alkatrészek' },
    { icon: 'gear', label: 'Fogaskerék', onTap: () => app.startTool('gear') },
    { icon: 'bolt', label: 'Csavar / anya', onTap: () => app.startTool('gear', { kind: 'bolt' }) },
    { head: 'Fájl' },
    { icon: 'importFile', label: 'STEP / STL importálása', onTap: () => sheets.importModel(app) },
    { icon: 'image', label: 'Referencia kép', onTap: () => sheets.insertImage(app) },
  ]);
}

function constructMenu(app, anchor) {
  app.ui.menu(anchor, [
    { head: 'Szerkesztősík' },
    { icon: 'planeOffset', label: 'Sík eltolással', onTap: () => app.startTool('plane', { mode: 'offset' }) },
    { icon: 'plane', label: 'Sík 3 ponton át', onTap: () => app.startTool('plane', { mode: 'three' }) },
    { icon: 'plane', label: 'Felező sík (két lap közt)', onTap: () => app.startTool('plane', { mode: 'mid' }) },
    { head: 'Rácssík (vázlatsík)' },
    { icon: 'plane', label: 'Felülnézet sík (XY)', onTap: () => sheets.setGridPlane(app, 'XY') },
    { icon: 'plane', label: 'Elölnézet sík (XZ)', onTap: () => sheets.setGridPlane(app, 'XZ') },
    { icon: 'plane', label: 'Oldalnézet sík (YZ)', onTap: () => sheets.setGridPlane(app, 'YZ') },
  ]);
}

function transformMenu(app, anchor) {
  app.ui.menu(anchor, [
    { icon: 'move', label: 'Mozgatás / forgatás', sc: 'M', onTap: () => app.startTool('move') },
    { icon: 'scale', label: 'Méretezés', onTap: () => app.startTool('scale') },
    { icon: 'mirror', label: 'Tükrözés', onTap: () => app.startTool('mirror') },
    { icon: 'pattern', label: 'Kiosztás', onTap: () => app.startTool('pattern') },
  ]);
}

function toolsMenu(app, anchor) {
  app.ui.menu(anchor, [
    { icon: 'extrude', label: 'Kihúzás', sc: 'E', onTap: () => app.startTool('extrude') },
    { icon: 'revolve', label: 'Forgatás tengely körül', onTap: () => app.startTool('revolve') },
    { icon: 'sweep', label: 'Söprés', onTap: () => app.startTool('sweep') },
    { icon: 'loft', label: 'Átmenet (loft)', onTap: () => app.startTool('loft') },
    { sep: true },
    { icon: 'fillet', label: 'Lekerekítés', sc: 'F', onTap: () => app.startTool('fillet') },
    { icon: 'chamfer', label: 'Élletörés', onTap: () => app.startTool('chamfer') },
    { icon: 'shell', label: 'Héjazás', sc: 'H', onTap: () => app.startTool('shell') },
    { icon: 'offsetFace', label: 'Lap eltolás', sc: 'O', onTap: () => app.startTool('offsetFace') },
    { icon: 'hole', label: 'Furat', onTap: () => app.startTool('hole') },
    { sep: true },
    { icon: 'boolean', label: 'Boole-műveletek', sc: 'B', onTap: () => app.startTool('boolean') },
    { icon: 'split', label: 'Szétvágás', onTap: () => app.startTool('split') },
    { icon: 'measure', label: 'Mérés', sc: 'D', onTap: () => app.startTool('measure') },
  ]);
}

// ---------------------------------------------------------------- jobb eszköztár
export function buildRightToolbar(app) {
  const s = app.settings;
  const snapBtn = document.createElement('button');
  snapBtn.className = `tile snap-tile ${s.snapping ? 'active' : ''}`;
  snapBtn.title = 'Illesztés';
  const gridLabel = document.createElement('div');
  gridLabel.className = 'grid-label';
  const upd = () => { gridLabel.textContent = sheets.gridLabel(app); };
  upd();
  if (app._gridLabelOff) app._gridLabelOff();
  app._gridLabelOff = app.vp.on('afterRender', upd);
  snapBtn.innerHTML = icon(s.snapping ? "magnet" : "magnetOff");
  snapBtn.append(gridLabel);
  onTap(snapBtn, () => app.setSetting("snapping", !app.settings.snapping));
  return {
    top: [
      { custom: snapBtn },
      { icon: s.perspective ? 'perspective' : 'ortho', label: s.perspective ? 'Perspektíva' : 'Ortografikus', onTap: () => app.setSetting('perspective', !app.settings.perspective) },
      { icon: 'fit', label: 'Minden látszódjon', onTap: () => app.vp.fitBox(app.bodies.bounds()) },
    ],
    items: [
      { icon: 'display', label: 'Megjelenítés', sub: sheets.displayName(s.display), onTap: (t) => sheets.displayMenu(app, t) },
      { icon: 'camera', label: 'Képernyőkép', onTap: () => sheets.screenshot(app) },
      { icon: 'history', label: 'Előzmények', onTap: () => sheets.toggleHistory(app) },
      { icon: 'settings', label: 'Beállítások', onTap: () => sheets.openSettings(app) },
    ],
  };
}
