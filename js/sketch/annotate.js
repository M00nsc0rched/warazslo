// Vázlat annotációk: vezérlő méretek (koppintható buborékok) és kényszerjelek
import { planeFromJSON, toWorld } from './manager.js';
import { CONSTRAINTS, isDim, addConstraint, setDimValue, removeConstraint, sketchSelection, applicable, makeDim } from './constraints.js';
import { buildSystem } from './solver.js';
import { fmtLen, fmtAngle, evaluateRaw } from '../util/units.js';

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const nrm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

function pt(sketch, ref) {
  const c = sketch.curves.find((x) => x.id === ref.curve);
  if (!c) return null;
  if (!ref.part) return null;
  switch (ref.part) {
    case 'a': return c.a;
    case 'b': return c.b;
    case 'c': return c.c;
    case 'p': return c.p;
    case 's': return [c.c[0] + c.r * Math.cos(c.a0), c.c[1] + c.r * Math.sin(c.a0)];
    case 'e': return [c.c[0] + c.r * Math.cos(c.a1), c.c[1] + c.r * Math.sin(c.a1)];
    default: if (ref.part.startsWith('p') && c.pts) return c.pts[+ref.part.slice(1)];
  }
  return null;
}

function curveMid(sketch, ref) {
  const c = sketch.curves.find((x) => x.id === ref.curve);
  if (!c) return null;
  if (c.t === 'line') return { p: mid(c.a, c.b), n: nrm([-(c.b[1] - c.a[1]), c.b[0] - c.a[0]]) };
  if (c.t === 'circle') return { p: [c.c[0] + c.r * 0.7071, c.c[1] + c.r * 0.7071], n: [0.7071, 0.7071] };
  if (c.t === 'arc') { const m = (c.a0 + c.a1) / 2; return { p: [c.c[0] + c.r * Math.cos(m), c.c[1] + c.r * Math.sin(m)], n: [Math.cos(m), Math.sin(m)] }; }
  if (c.t === 'ellipse') return { p: c.c, n: [0, 1] };
  if (c.t === 'spline') return { p: c.pts[Math.floor(c.pts.length / 2)], n: [0, 1] };
  if (c.t === 'point' || c.t === 'text') return { p: c.p, n: [0, 1] };
  return null;
}

/** Méret szövegének helye (uv) és a leképezéshez szükséges eltolásirány (pixelben kerül skálázásra). */
function dimAnchor(sketch, k) {
  switch (k.type) {
    case 'length': { const m = curveMid(sketch, k.a); return m && { p: m.p, n: m.n, px: 18 }; }
    case 'radius': case 'diameter': { const m = curveMid(sketch, k.a); return m && { p: m.p, n: m.n, px: 14 }; }
    case 'angle': {
      const a = curveMid(sketch, k.a), b = curveMid(sketch, k.b);
      return a && b && { p: mid(a.p, b.p), n: [0, 1], px: 0 };
    }
    case 'distance': case 'hdist': case 'vdist': {
      const pa = k.a.part ? pt(sketch, k.a) : curveMid(sketch, k.a)?.p;
      const pb = k.b && k.b.part ? pt(sketch, k.b) : curveMid(sketch, k.b)?.p;
      if (!pa || !pb) return null;
      if (k.type === 'hdist') return { p: [(pa[0] + pb[0]) / 2, Math.max(pa[1], pb[1])], n: [0, 1], px: 16 };
      if (k.type === 'vdist') return { p: [Math.max(pa[0], pb[0]), (pa[1] + pb[1]) / 2], n: [1, 0], px: 22 };
      return { p: mid(pa, pb), n: nrm([-(pb[1] - pa[1]), pb[0] - pa[0]]), px: 14 };
    }
    default: return null;
  }
}

function glyphAnchor(sketch, k) {
  if (k.a && k.a.part) { const p = pt(sketch, k.a); return p && { p, n: [0.7, 0.7] }; }
  const m = k.a ? curveMid(sketch, k.a) : null;
  return m && { p: m.p, n: [-m.n[0], -m.n[1]] };
}

export function dimText(k) {
  const def = CONSTRAINTS[k.type];
  const val = def.kind === 'angle' ? fmtAngle(k.value) : fmtLen(k.value);
  const pre = def.prefix || '';
  if (k.expr && /[a-zA-Záéíóöőúüű]/.test(k.expr)) return `${pre}${val}  ƒ ${k.expr}`;
  return `${pre}${val}`;
}

// ---------------------------------------------------------------- overlay
export class SketchAnnotations {
  constructor(app) {
    this.app = app;
    this.items = [];
    app.vp.on('beforeRender', () => this.place());
  }

  clear() { for (const it of this.items) it.b.remove(); this.items = []; }

  /** Újraépítés a dokumentum/kijelölés alapján. */
  refresh() {
    this.clear();
    const app = this.app;
    if (!app.doc || app.mode === 'view' || app.settings.showDims === false) return;
    const hidden = app.doc.view.hidden || [];
    const active = new Set(app.sel.filter((s) => s.sketchId).map((s) => s.sketchId));
    if (app.tool && app.tool.isSketchTool && app.tool.frame) {
      for (const s of app.doc.state.sketches) if (app.sketches.gfx.get(s.id) && app.tool.frame && Math.abs(planeFromJSON(s.plane).normal.dot(app.tool.frame.normal)) > 0.999) active.add(s.id);
    }
    for (const s of app.doc.state.sketches) {
      if (hidden.includes(s.id) || !(s.constraints && s.constraints.length)) continue;
      if (app.isolated && !app.isolated.has(s.id)) continue;
      const f = planeFromJSON(s.plane);
      const glyphsOn = active.has(s.id);
      const perCurve = new Map();
      for (const k of s.constraints) {
        if (isDim(k)) {
          const an = dimAnchor(s, k);
          if (!an) continue;
          const b = app.handles.bubble({ cls: `dim ${k.expr && /[a-zA-Z]/.test(k.expr) ? 'expr' : ''}`, onTap: (elm) => editDimension(app, s.id, k.id, elm) });
          b.set(dimText(k));
          this.items.push({ b, frame: f, an });
        } else if (glyphsOn && CONSTRAINTS[k.type] && k.type !== 'fix' || glyphsOn && k.type === 'fix') {
          const an = glyphAnchor(s, k);
          if (!an) continue;
          const key = k.a ? `${k.a.curve}:${k.a.part || ''}` : k.id;
          const n = perCurve.get(key) || 0;
          perCurve.set(key, n + 1);
          const b = app.handles.bubble({ cls: 'glyph', onTap: (elm) => glyphMenu(app, s.id, k, elm) });
          b.set(CONSTRAINTS[k.type].glyph);
          this.items.push({ b, frame: f, an: { ...an, px: 16, stack: n } });
        }
      }
    }
    this.place();
    app.vp.requestRender();
  }

  place() {
    const vp = this.app.vp;
    for (const it of this.items) {
      const { an, frame } = it;
      const w = toWorld(frame, an.p);
      const wpp = vp.worldPerPixel(w);
      const off = (an.px || 0) * wpp;
      let uv = [an.p[0] + an.n[0] * off, an.p[1] + an.n[1] * off];
      if (an.stack) uv = [uv[0] + an.stack * 22 * wpp, uv[1]];
      it.b.at(toWorld(frame, uv));
    }
  }
}

// ---------------------------------------------------------------- műveletek
function commitSketch(app, sketch, label, icon = 'dimension') {
  const st = app.doc.state;
  app.doc.commit(label, { ...st, sketches: st.sketches.map((s) => (s.id === sketch.id ? sketch : s)) }, { icon });
}

export function applyConstraint(app, spec) {
  const ss = sketchSelection(app);
  if (!ss) return;
  const r = addConstraint(ss.sketch, spec);
  if (!r.ok) { app.ui.toast(r.message, 'error', 3500); return; }
  commitSketch(app, r.sketch, CONSTRAINTS[spec.type].label, CONSTRAINTS[spec.type].icon || 'dimension');
  if (CONSTRAINTS[spec.type].dim && r.constraint) {
    // azonnal szerkeszthető
    setTimeout(() => editDimension(app, r.sketch.id, r.constraint.id, null), 50);
  }
}

/** Alapértelmezett méret a kijelöléshez (vonal: hossz, kör: átmérő, ív: sugár, két pont: távolság…) */
export function addDefaultDimension(app) {
  const ss = sketchSelection(app);
  const opts = applicable(ss).filter((o) => CONSTRAINTS[o.type].dim);
  if (!opts.length) { app.ui.toast('Ehhez a kijelöléshez nem adható méret', '', 2000); return; }
  let pick = opts[0];
  if (ss.lines.length === 2 && ss.n === 2) {
    // párhuzamos vonalaknál távolság, egyébként szög
    const sys = buildSystem(ss.sketch.curves);
    const c1 = ss.sketch.curves.find((c) => c.id === ss.lines[0].curve), c2 = ss.sketch.curves.find((c) => c.id === ss.lines[1].curve);
    const d1 = nrm(sub(c1.b, c1.a)), d2 = nrm(sub(c2.b, c2.a));
    const par = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-6;
    pick = opts.find((o) => o.type === (par ? 'distance' : 'angle')) || opts[0];
    void sys;
  }
  const c = ss.circs.length === 1 && ss.n === 1 ? ss.sketch.curves.find((x) => x.id === ss.circs[0].curve) : null;
  if (c && c.t === 'arc') pick = opts.find((o) => o.type === 'radius') || pick;
  // ha már van ilyen méret, azt szerkesztjük
  const ex = (ss.sketch.constraints || []).find((k) => k.type === pick.type && JSON.stringify([k.a, k.b || null]) === JSON.stringify([pick.refs[0], pick.refs[1] || null]));
  if (ex) { editDimension(app, ss.sketch.id, ex.id, null); return; }
  applyConstraint(app, pick);
}

export function editDimension(app, sketchId, kid, anchor) {
  const sk = app.doc.sketch(sketchId);
  const k = sk && (sk.constraints || []).find((x) => x.id === kid);
  if (!k) return;
  const def = CONSTRAINTS[k.type];
  app.ui.keypad({
    label: def.label, kind: def.kind || 'len', value: k.value, expr: k.expr, anchor: anchor || app.ui.selInfo,
    actions: [{ label: 'Méret törlése', style: 'danger', onTap: () => commitSketch(app, removeConstraint(app.doc.sketch(sketchId), kid), 'Méret törlése', 'trash') }],
    onDone: (v, text) => {
      if (def.kind !== 'angle' && !(v > 0) && k.type !== 'hdist' && k.type !== 'vdist') { app.ui.toast('A méret legyen pozitív', 'error'); return; }
      const usesVar = /[a-zA-Záéíóöőúüű]/.test(text.replace(/\b(mm|cm|m|in|ft|deg|rad)\b/gi, ''));
      const cur = app.doc.sketch(sketchId);
      const r = setDimValue(cur, kid, v, usesVar ? text : undefined);
      if (!r.ok) { app.ui.toast(r.message, 'error', 3500); return; }
      commitSketch(app, r.sketch, `${def.label}: ${def.kind === 'angle' ? fmtAngle(v) : fmtLen(v)}`);
    },
  });
}

function glyphMenu(app, sketchId, k, anchor) {
  app.ui.menu(anchor, [
    { head: CONSTRAINTS[k.type].label },
    { icon: 'trash', label: 'Kényszer törlése', danger: true, onTap: () => commitSketch(app, removeConstraint(app.doc.sketch(sketchId), k.id), 'Kényszer törlése', 'trash') },
  ], { side: 'below' });
}

/** A kijelölt görbe méretének megadása (régi "Méret megadása" gomb). */
export function editCurveDimension(app) { addDefaultDimension(app); }

export { makeDim, evaluateRaw };
