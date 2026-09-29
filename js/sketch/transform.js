// Vázlatgörbék transzformálása a vázlat síkjában: mozgatás, forgatás, másolás (ismétléssel = vázlat-kiosztás),
// és tükrözés egy kijelölt vonalra. A belső kényszerek (csak a mozgatott görbék között) megmaradnak / másolódnak.
import * as THREE from 'three';
import { Tool } from '../tools/base.js';
import { MoveGizmo } from '../view/handles.js';
import { PreviewLines } from './tools.js';
import { planeFromJSON, toWorld, toLocal } from './manager.js';
import { curvePolylines, transformCurves2D, rigid2D, mirror2D } from './geom2d.js';
import { snap } from './snap.js';
import { uid } from '../util/misc.js';

const rad = (d) => (d * Math.PI) / 180;

/** A kijelölés vázlatgörbéi (egy vázlatból): { sketch, ids:Set, center?:[x,y] (kijelölt pont) } */
export function sketchCurveSelection(app, sel = app.sel) {
  const items = sel.filter((s) => s.sketchId && (s.type === 'curve' || s.type === 'region' || s.type === 'spoint' || s.type === 'sketch'));
  if (!items.length) return null;
  const sketchId = items[0].sketchId;
  const sk = app.doc.sketch(sketchId);
  if (!sk) return null;
  const ids = new Set();
  let center = null;
  for (const s of items) {
    if (s.sketchId !== sketchId) continue;
    if (s.type === 'curve') ids.add(s.curveId);
    else if (s.type === 'sketch') sk.curves.forEach((c) => ids.add(c.id));
    else if (s.type === 'region') {
      const r = app.sketches.regionByKey(sketchId, s.key);
      if (r) r.curveIds.forEach((id) => ids.add(id));
    } else if (s.type === 'spoint') center = s.p;
  }
  return { sketch: sk, ids, center };
}

/** A transzformáció után is érvényes kényszerek (csak a mozgatott görbék között). */
function carryConstraints(cons, ids, ang, mirrored) {
  const inside = (k) => [k.a, k.b, k.c].every((r) => !r || ids.has(r.curve)) && [k.a, k.b, k.c].some((r) => r);
  const q = ((Math.round((ang * 180) / Math.PI) % 180) + 180) % 180; // 0 / 90 / egyéb
  const rotExact = Math.abs(ang * 180 / Math.PI - Math.round(ang * 180 / Math.PI)) < 1e-6;
  const out = [];
  for (const k of cons) {
    if (!inside(k) || k.type === 'fix') continue;
    if (k.type === 'horizontal' || k.type === 'vertical') {
      if (mirrored || !rotExact || (q !== 0 && q !== 90)) continue;
      out.push(q === 90 ? { ...k, type: k.type === 'horizontal' ? 'vertical' : 'horizontal' } : k);
      continue;
    }
    if (k.type === 'hdist' || k.type === 'vdist') {
      if (mirrored || !rotExact || (q !== 0 && q !== 90)) continue;
      out.push(q === 90 ? { ...k, type: k.type === 'hdist' ? 'vdist' : 'hdist' } : k);
      continue;
    }
    out.push(k);
  }
  return out;
}

/** Görbék + belső kényszerek másolása új azonosítókkal. */
function duplicate(curves, cons) {
  const map = new Map(curves.map((c) => [c.id, uid('c')]));
  const R = (r) => (r ? { ...r, curve: map.get(r.curve) || r.curve } : r);
  return {
    curves: curves.map((c) => ({ ...c, id: map.get(c.id) })),
    constraints: cons.map((k) => ({ ...k, id: uid('k'), a: R(k.a), b: R(k.b), c: R(k.c) })),
  };
}

export class SketchTransformTool extends Tool {
  get toolId() { return 'sketchTransform'; }
  get isSketchTool() { return true; }
  get allowsSelection() { return false; }

  start() {
    const s = sketchCurveSelection(this.app);
    if (!s || !s.ids.size) throw new Error('Jelölj ki vázlatgörbéket (vagy régiót) a mozgatáshoz');
    this.sketchId = s.sketch.id;
    this.frame = planeFromJSON(s.sketch.plane);
    this.ids = s.ids;
    this.curves = s.sketch.curves.filter((c) => s.ids.has(c.id));
    // középpont: kijelölt pont, különben a befoglaló doboz közepe
    let c2 = s.center;
    if (!c2) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of this.curves) for (const pl of (c.t === 'point' ? [[c.p]] : curvePolylines(c))) for (const p of pl) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      c2 = Number.isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0];
    }
    this.c2 = c2;
    this.dx = 0; this.dy = 0; this.ang = 0;
    this.copy = false; this.count = 1;
    this.prev = new PreviewLines(this.app, 0x2bb8f0, 2.4);
    const f = this.frame;
    this.gizmo = this.addHandle(new MoveGizmo(this.app.handles, {
      center: toWorld(f, c2), axes: [f.xDir, f.yDir, f.normal], planar: true,
      snap: (d) => { const g = this.app.vp.gridSpacing || 1; const q = Math.round(d / g) * g; return this.app.settings.snapping && Math.abs(q - d) < g * 0.35 ? q : d; },
      snapPoint: (ev, p) => {
        const uv = toLocal(f, p);
        const r = snap(this.app, f, uv, ev, {});
        return r && r.kind && r.kind !== 'none' && r.kind !== 'grid' ? toWorld(f, r.p) : null;
      },
      onChange: (st) => {
        this.dx = st.translate.dot(f.xDir); this.dy = st.translate.dot(f.yDir);
        if (st.rotAxis) this.ang = rad(st.rotAngle);
        this.update();
      },
      onTapValue: (kind, i) => this.editValue(kind, i),
    }));
    this.update();
  }

  cancel() { this.app.finishSketchTool(this.frame); }
  stop() { super.stop(); this.prev && this.prev.dispose(); }

  T(k = 1) {
    // k-szoros ismétlés: forgatás a középpont körül k·szöggel, eltolás k·(dx,dy)
    return rigid2D(this.c2, this.ang * k, this.dx * k, this.dy * k);
  }

  result() {
    const n = this.copy ? Math.max(1, Math.round(this.count)) : 1;
    const out = [];
    for (let k = 1; k <= n; k++) out.push(...transformCurves2D(this.curves, this.T(k)));
    return out;
  }

  update() {
    this.prev.set(this.frame, this.result());
    this.refreshPanel();
  }

  editValue(kind, i) {
    if (kind === 'ring') this.change('angle', null);
    else this.change(i === 1 ? 'dy' : 'dx', null);
  }

  panel() {
    const items = [
      { type: 'number', key: 'dx', label: 'X', kind: 'len', value: this.dx },
      { type: 'number', key: 'dy', label: 'Y', kind: 'len', value: this.dy },
      { type: 'number', key: 'angle', label: 'Szög', kind: 'angle', value: (this.ang * 180) / Math.PI },
      { type: 'toggle', key: 'copy', label: 'Másolat', value: this.copy },
    ];
    if (this.copy) items.push({ type: 'number', key: 'count', label: 'Darab', kind: 'int', value: this.count });
    return { title: 'Görbék mozgatása', icon: 'move', items };
  }

  change(k, v) {
    if (v == null) {
      const spec = { dx: ['X eltolás', 'len', this.dx], dy: ['Y eltolás', 'len', this.dy], angle: ['Forgatás', 'angle', (this.ang * 180) / Math.PI] }[k];
      if (spec) this.app.ui.keypad({ label: spec[0], kind: spec[1], value: spec[2], onDone: (x) => this.change(k, x) });
      return;
    }
    if (k === 'dx') this.dx = v;
    if (k === 'dy') this.dy = v;
    if (k === 'angle') this.ang = rad(v);
    if (k === 'copy') this.copy = v;
    if (k === 'count') this.count = Math.max(1, Math.min(200, Math.round(v)));
    const f = this.frame;
    this.gizmo.set(f.xDir.clone().multiplyScalar(this.dx).addScaledVector(f.yDir, this.dy), 2, (this.ang * 180) / Math.PI);
    this.update();
  }

  done() {
    const moved = Math.abs(this.dx) > 1e-9 || Math.abs(this.dy) > 1e-9 || Math.abs(this.ang) > 1e-9;
    if (!moved) { this.app.finishSketchTool(this.frame); return; }
    const ids = this.ids, copy = this.copy, n = copy ? Math.max(1, Math.round(this.count)) : 1;
    const label = copy ? (n > 1 ? `Vázlat kiosztás (${n})` : 'Görbék másolása') : 'Görbék mozgatása';
    this.app.updateSketch(this.sketchId, (s) => {
      const cons = s.constraints || [];
      const sel = s.curves.filter((c) => ids.has(c.id));
      if (!copy) {
        const moved = new Map(transformCurves2D(sel, this.T(1)).map((c) => [c.id, c]));
        const kept = cons.filter((k) => ![k.a, k.b, k.c].some((r) => r && ids.has(r.curve)));
        return { ...s, curves: s.curves.map((c) => moved.get(c.id) || c), constraints: [...kept, ...carryConstraints(cons, ids, this.ang, false)] };
      }
      const addC = [], addK = [];
      for (let k = 1; k <= n; k++) {
        const d = duplicate(transformCurves2D(sel, this.T(k)), carryConstraints(cons, ids, this.ang * k, false));
        addC.push(...d.curves); addK.push(...d.constraints);
      }
      return { ...s, curves: [...s.curves, ...addC], constraints: [...cons, ...addK] };
    }, label, 'move');
    this.app.finishSketchTool(this.frame);
  }
}

/**
 * Tükrözés: a kijelölt görbék tükörképe az utoljára kijelölt egyenesre (ami maga nem tükröződik).
 */
export function mirrorSketchSelection(app) {
  const s = sketchCurveSelection(app);
  if (!s) { app.ui.toast('Jelölj ki vázlatgörbéket és utoljára egy tükörvonalat', 'error'); return; }
  const curveSel = app.sel.filter((x) => x.type === 'curve' && x.sketchId === s.sketch.id);
  const axisSel = [...curveSel].reverse().find((x) => { const c = s.sketch.curves.find((y) => y.id === x.curveId); return c && c.t === 'line'; });
  if (!axisSel) { app.ui.toast('A tükrözéshez jelölj ki egy vonalat is (tükörtengely)', 'error'); return; }
  const axis = s.sketch.curves.find((c) => c.id === axisSel.curveId);
  const ids = new Set(s.ids); ids.delete(axis.id);
  if (!ids.size) { app.ui.toast('Jelölj ki tükrözendő görbéket is', 'error'); return; }
  app.updateSketch(s.sketch.id, (sk) => {
    const sel = sk.curves.filter((c) => ids.has(c.id));
    const cons = carryConstraints(sk.constraints || [], ids, 0, true);
    const d = duplicate(transformCurves2D(sel, mirror2D(axis.a, axis.b)), cons);
    return { ...sk, curves: [...sk.curves, ...d.curves], constraints: [...(sk.constraints || []), ...d.constraints] };
  }, 'Vázlat tükrözés', 'mirror');
  app.ui.toast(`${ids.size} görbe tükrözve`, 'ok', 1500);
}

void THREE;
