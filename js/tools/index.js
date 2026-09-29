// Eszköz-regiszter és helyzetérzékeny eszköztárak
import * as THREE from 'three';
import * as sheets from "../ui/sheets.js";
import { icon } from "../ui/icons.js";
import { onTap } from "../util/misc.js";
import { sketchSelection, applicable, CONSTRAINTS, disconnectPoint, sketchDof } from '../sketch/constraints.js';
import { applyConstraint, addDefaultDimension } from '../sketch/annotate.js';
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
import { ReplaceFaceTool, ProjectTool, AlignTool, AxisTool } from './extra.js';
import { TextTool, editTextCurve } from '../sketch/texttool.js';

const REGISTRY = {
  extrude: ExtrudeTool, fillet: FilletTool, chamfer: FilletTool, shell: ShellTool, offsetFace: OffsetFaceTool,
  move: MoveTool, scale: ScaleTool, primitive: PrimitiveTool, boolean: BooleanTool, mirror: MirrorTool,
  pattern: PatternTool, revolve: RevolveTool, sweep: SweepTool, loft: LoftTool, split: SplitTool, hole: HoleTool,
  measure: MeasureTool, section: SectionTool, plane: PlaneTool, gear: GearTool, sketch: SketchPaletteTool,
  replaceFace: ReplaceFaceTool, project: ProjectTool, offsetEdge: ProjectTool, align: AlignTool, axis: AxisTool,
  text: TextTool,
  ...SKETCH_TOOLS,
};

export function createTool(app, id, opts = {}) {
  if (id === 'chamfer') opts = { ...opts, mode: 'chamfer' };
  if (id === 'offsetEdge') opts = { ...opts, offset: true };
  const C = REGISTRY[id];
  if (!C) throw new Error(`Ismeretlen eszköz: ${id}`);
  return new C(app, opts);
}

// ---------------------------------------------------------------- kijelölés összegzés
const NAMES = { face: 'lap', edge: 'él', vertex: 'csúcs', body: 'test', region: 'régió', curve: 'görbe', spoint: 'pont', sketch: 'vázlat', plane: 'sík', axis: 'tengely' };

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
      if (sum.planarFaces) ctx.push(T('replaceFace', 'replaceFace', 'Lap cseréje', { sub: 'Másik lap síkjáig' }));
      if (sum.planarFaces) ctx.push(T('align', 'align', 'Illesztés', { sub: 'Lap a laphoz' }));
      ctx.push(T('offsetEdge', 'offsetCurve', 'Él eltolás', { sub: 'Vázlatba' }));
      ctx.push(T('project', 'project', 'Vetítés', { sub: 'Élek vázlatba' }));
      if (sum.planarFaces === 1 && c.face === 1) {
        ctx.push({ icon: 'sketch', label: 'Vázlat a lapra', onTap: () => sketchOnSelection(app) });
        ctx.push(T('hole', 'hole', 'Furat'));
      }
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M', sub: 'A teljes test' }));
    } else if (only('edge')) {
      ctx.push(T('fillet', 'fillet', 'Lekerekítés', { kbd: 'F' }));
      ctx.push(T('chamfer', 'chamfer', 'Élletörés'));
      ctx.push(T('sweep', 'sweep', 'Söprés útvonal'));
      ctx.push(T('project', 'project', 'Vetítés', { sub: 'Élek vázlatba' }));
      ctx.push(T('axis', 'axis', 'Tengely az élből'));
    } else if (only('body')) {
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M' }));
      ctx.push(T('scale', 'scale', 'Méretezés'));
      ctx.push(T('mirror', 'mirror', 'Tükrözés'));
      ctx.push(T('pattern', 'pattern', 'Kiosztás', { sub: 'Lineáris / kör' }));
      if (c.body >= 2) ctx.push(T('boolean', 'boolean', 'Boole-műveletek', { kbd: 'B', sub: 'Egyesítés, kivonás' }));
      ctx.push(T('shell', 'shell', 'Héjazás', { sub: 'Üreges test' }));
      ctx.push(T('split', 'split', 'Szétvágás'));
      ctx.push({ icon: 'palette', label: 'Anyag és szín', onTap: () => sheets.materialSheet(app) });
      ctx.push({ icon: 'copy', label: 'Másolat', onTap: () => sheets.duplicateBodies(app) });
      ctx.push({ icon: 'exportFile', label: 'Exportálás', menu: true, onTap: (t) => sheets.exportMenu(app, t, true) });
    } else if (hasProfiles) {
      ctx.push(T('extrude', 'extrude', 'Kihúzás', { kbd: 'E' }));
      ctx.push(T('revolve', 'revolve', 'Forgatás tengely körül'));
      ctx.push(T('sweep', 'sweep', 'Söprés'));
      if ((c.region || 0) + sum.planarFaces >= 2) ctx.push(T('loft', 'loft', 'Átmenet (loft)'));
      if (c.region) ctx.push(T('move', 'move', 'Vázlat mozgatása'));
    } else if (only('curve', 'region', 'spoint', 'sketch')) {
      const textSel = selectedTextCurve(app);
      if (c.region || textSel) ctx.push(T('extrude', 'extrude', 'Kihúzás', { kbd: 'E' }));
      if (textSel) ctx.push({ icon: 'text', label: 'Szöveg szerkesztése', onTap: () => editTextCurve(app, textSel.sketchId, textSel.curveId) });
      if (c.curve) {
        ctx.push({ icon: 'construction', label: 'Segédvonal ki/be', onTap: () => sheets.toggleConstruction(app) });
        ctx.push(T('offsetCurve', 'offsetCurve', 'Görbe eltolás'));
        ctx.push(T('sweep', 'sweep', 'Söprés útvonal'));
      }
      ctx.push(T('move', 'move', 'Mozgatás/Forgatás', { kbd: 'M' }));
      // kényszerek és méretek a kijelölt vázlatelemekre
      const ss = sketchSelection(app);
      const opts = applicable(ss);
      if (opts.some((o) => CONSTRAINTS[o.type].dim)) ctx.push({ icon: 'dimension', label: 'Méret', kbd: 'K', onTap: () => addDefaultDimension(app) });
      const geo = opts.filter((o) => !CONSTRAINTS[o.type].dim);
      if (geo.length) {
        ctx.push('-');
        for (const o of geo) ctx.push({ icon: CONSTRAINTS[o.type].icon || 'dimension', label: CONSTRAINTS[o.type].label, onTap: () => applyConstraint(app, o) });
      }
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
    { icon: 'palette', label: 'Anyagok', sub: sum.n ? 'Kijelölt testek' : 'Jelölj ki testet', onTap: () => sheets.materialSheet(app) },
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
  app.enterSketchMode(frame);
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
    { icon: 'text', label: 'Szöveg', onTap: () => app.startTool('text') },
    { icon: 'point', label: 'Pont', onTap: () => app.startTool('point') },
    { icon: 'freehand', label: 'Szabadkézi (Pencil)', onTap: () => app.startTool('freehand') },
    { sep: true },
    { icon: 'trim', label: 'Vágás', sc: 'T', onTap: () => app.startTool('trim') },
    { icon: 'sketchFillet', label: 'Sarok lekerekítés', onTap: () => app.startTool('sketchFillet') },
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
    { head: 'Szerkesztőtengely' },
    { icon: 'axis', label: 'Tengely (él, henger, 2 pont)', onTap: () => app.startTool('axis') },
    { head: 'Paraméterek' },
    { icon: 'variables', label: 'Változók', onTap: () => sheets.openVariables(app) },
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

// ---------------------------------------------------------------- vázlat mód: kényszeroszlop (jobb oldal)
export function buildSketchBar(app) {
  const t = app.tool;
  if (!t || !t.isSketchTool || app.mode === 'view') return null;
  const ss = sketchSelection(app);
  const opts = applicable(ss);
  const find = (type) => opts.find((o) => o.type === type);
  const act = (o) => () => applyConstraint(app, o);
  const B = (type, label, kbd, o, icon) => ({ icon: icon || CONSTRAINTS[type]?.icon || 'dimension', label, kbd, disabled: !o, onTap: o ? (typeof o === 'function' ? o : act(o)) : () => {} });
  // vízszintes/függőleges: a jelenlegi irány szerint
  let hv = null;
  const h = find('horizontal'), v = find('vertical');
  if (h && v && ss) {
    let dx = 0, dy = 0;
    if (ss.lines.length === 1) { const c = ss.sketch.curves.find((x) => x.id === ss.lines[0].curve); dx = c.b[0] - c.a[0]; dy = c.b[1] - c.a[1]; }
    else if (ss.points.length === 2) {
      const P = (r) => { const c = ss.sketch.curves.find((x) => x.id === r.curve); return (c.t === 'line' ? (r.part === 'a' ? c.a : c.b) : c.c || c.p) || [0, 0]; };
      const a = P(ss.points[0]), b = P(ss.points[1]); dx = b[0] - a[0]; dy = b[1] - a[1];
    }
    hv = Math.abs(dx) >= Math.abs(dy) ? h : v;
  }
  const coin = find('coincident') || find('onCurve');
  // szétválasztás: egyetlen kijelölt pont, amiben több görbe találkozik
  let disc = null;
  const sp = app.sel.filter((s) => s.type === 'spoint');
  if (sp.length === 1 && app.sel.length === 1) {
    const sk = app.doc.sketch(sp[0].sketchId);
    const n = sk ? sk.curves.filter((c) => c.t !== 'point').filter((c) => {
      const ends = c.t === 'line' ? [c.a, c.b] : c.t === 'arc' ? [[c.c[0] + c.r * Math.cos(c.a0), c.c[1] + c.r * Math.sin(c.a0)], [c.c[0] + c.r * Math.cos(c.a1), c.c[1] + c.r * Math.sin(c.a1)]] : c.pts ? [c.pts[0], c.pts[c.pts.length - 1]] : [];
      return ends.some((q) => Math.abs(q[0] - sp[0].p[0]) < 1e-6 && Math.abs(q[1] - sp[0].p[1]) < 1e-6);
    }).length : 0;
    if (n >= 2) disc = () => {
      const g = (app.vp.gridSpacing || 1) * 0.6;
      app.updateSketch(sk.id, (s) => disconnectPoint(s, sp[0].p, g), 'Szétválasztás', 'coincident');
      app.clearSelection();
    };
  }
  const curvesSel = app.sel.some((s) => s.type === 'curve');
  const dimOpt = opts.find((o) => CONSTRAINTS[o.type].dim);
  const sketch = ss ? ss.sketch : app.sketches.findSketchOnPlane(t.frame || app.vp.gridFrame);
  let dof = null;
  if (sketch && sketch.curves.length && sketch.curves.length < 400) dof = sketchDof(sketch);
  return {
    title: 'Kényszerek', dof,
    items: [
      B('parallel', 'Párhuzamos', '⇧A', find('parallel')),
      B('perpendicular', 'Merőleges', '⇧P', find('perpendicular')),
      B('tangent', 'Érintő', '⇧T', find('tangent')),
      B('coincident', coin && coin.type === 'onCurve' ? 'Pont a görbén' : 'Egybeeső', '⇧N', coin),
      B('midpoint', 'Felezőpont', '⇧M', find('midpoint')),
      B('concentric', 'Koncentrikus', '⇧C', find('concentric')),
      B('horizontal', 'Vízszintes/Függőleges', '⇧V', hv),
      B('equal', 'Egyenlő', '⇧E', find('equal')),
      B('symmetric', 'Szimmetria', '⇧S', find('symmetric')),
      B('coincident', 'Szétválasztás', '', disc, 'disconnect'),
      B('fix', 'Rögzítés', '⇧L', find('fix'), 'lock'),
      B('construction', 'Segédvonallá', '', curvesSel ? () => sheets.toggleConstruction(app) : null, 'construction'),
      '-',
      B('length', 'Méret', 'K', dimOpt ? () => addDefaultDimension(app) : null, 'dimension'),
    ],
  };
}

/** Az egyetlen kijelölt szöveggörbe (vagy null). */
export function selectedTextCurve(app) {
  const cs = app.sel.filter((s) => s.type === 'curve');
  if (cs.length !== 1) return null;
  const sk = app.doc.sketch(cs[0].sketchId);
  const c = sk && sk.curves.find((x) => x.id === cs[0].curveId);
  return c && c.t === 'text' ? cs[0] : null;
}
