// Szöveg eszköz a vázlatban: Pencil-koppintás a helyre -> szöveg párbeszéd -> betűkörvonalak.
// Kijelölt szöveg kihúzható (a betűk "tintás" régiói), szerkeszthető (szöveg, betűtípus, méret).
import * as THREE from 'three';
import { DrawTool, touchSelect } from './tools.js';
import { planeFromJSON } from './manager.js';
import { FONTS, loadFont, fontLoaded, textBox } from './text.js';
import { curvePolylines } from './geom2d.js';
import { el, onTap } from '../util/misc.js';
import { evaluate, fmtLen, fmtLenParts } from '../util/units.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const TEXT_DEFAULTS = { text: 'Warázsló', font: 'sans', size: 10, align: 'left', spacing: 0, rotDeg: 0 };

/** Szöveg párbeszéd. return { text, font, size, align, spacing, rotDeg } | null */
export function textDialog(app, init = {}, { title = 'Szöveg', okLabel = 'Beszúrás' } = {}) {
  const o = { ...TEXT_DEFAULTS, ...init };
  const body = el('div');
  const ta = el('textarea', { rows: 2, autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', style: { resize: 'vertical', marginBottom: '10px', fontSize: '18px' } });
  ta.value = o.text;
  const sel = el('select', { style: { marginBottom: '10px' } });
  for (const f of FONTS) {
    const op = el('option', { value: f.id, text: f.label });
    if (f.id === o.font) op.selected = true;
    sel.append(op);
  }
  const num = (label, value, unit) => {
    const inp = el('input', { type: 'text', inputmode: 'decimal', value: String(value), autocomplete: 'off' });
    const row = el('div', { class: 'row' }, el('label', { text: `${label}${unit ? ` (${unit})` : ''}` }), inp);
    return { row, inp };
  };
  const sz = fmtLenParts(o.size), spc = fmtLenParts(o.spacing || 0);
  const size = num('Betűmagasság', sz.value, sz.unit);
  const spacing = num('Betűköz', spc.value, spc.unit);
  const rot = num('Elforgatás', Math.round(o.rotDeg * 100) / 100, '°');
  const chips = el('div', { class: 'chips', style: { marginBottom: '10px' } });
  const renderChips = () => {
    chips.innerHTML = '';
    for (const [v, l] of [['left', 'Balra'], ['center', 'Középre'], ['right', 'Jobbra']]) {
      const b = el('button', { class: `chip ${o.align === v ? 'on' : ''}`, text: l });
      onTap(b, () => { o.align = v; renderChips(); });
      chips.append(b);
    }
  };
  renderChips();
  body.append(ta, sel, size.row, spacing.row, rot.row, el('div', { class: 'row' }, el('label', { text: 'Igazítás a ponthoz' })), chips);
  const read = () => {
    const n = (inp, kind, fb) => {
      try { const v = evaluate(inp.value, kind); return Number.isFinite(v) ? v : fb; } catch (e) { return fb; }
    };
    return {
      text: ta.value.replace(/\r/g, ''),
      font: sel.value,
      size: Math.max(0.01, n(size.inp, 'len', o.size)),
      spacing: n(spacing.inp, 'len', 0),
      rotDeg: n(rot.inp, 'angle', 0),
      align: o.align,
    };
  };
  return app.ui.dialog({
    title, body,
    buttons: [{ label: 'Mégse', value: null, style: 'ghost' }, { label: okLabel, value: read, style: 'primary' }],
    onOpen: () => setTimeout(() => { ta.focus(); ta.select(); }, 60),
  });
}

/** A nézethez igazított irány: a szöveg a képernyőn olvasható (nem tükrözött, nem fejjel lefelé). */
export function readableOrientation(app, frame) {
  const cam = app.vp.camera;
  cam.updateMatrixWorld();
  const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const U = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const r2 = [R.dot(frame.xDir), R.dot(frame.yDir)];
  const u2 = [U.dot(frame.xDir), U.dot(frame.yDir)];
  const mirror = r2[0] * u2[1] - r2[1] * u2[0] < 0;
  let a = deg(Math.atan2(r2[1], r2[0]));
  const snapped = Math.round(a / 90) * 90;
  if (Math.abs(a - snapped) < 12) a = snapped;
  if (Math.abs(a) < 1e-9) a = 0;
  return { rotDeg: a, mirror };
}

export class TextTool extends DrawTool {
  get toolId() { return 'text'; }
  get title() { return 'Szöveg'; }
  get icon() { return 'text'; }
  get hintText() { return 'Koppints a Pencillel a szöveg kezdőpontjára'; }

  start() {
    super.start();
    this.settings = { ...TEXT_DEFAULTS, ...(this.app.lastText || {}) };
    loadFont(this.settings.font).then(() => this.drawPreview()).catch(() => this.app.ui.toast('A betűtípus nem tölthető be', 'error'));
  }

  extraPanel() {
    return [{ type: 'info', text: `${FONTS.find((f) => f.id === this.settings.font)?.label || ''}, ${fmtLen(this.settings.size)}` }];
  }

  previewCurves(c) {
    if (!c || this.busy || !fontLoaded(this.settings.font)) return [];
    const f = this.frame || (this.cursor && this.cursor.frame);
    if (!f) return [];
    const o = readableOrientation(this.app, f);
    return [this._curve(c, { ...this.settings, rotDeg: o.rotDeg }, o.mirror)];
  }

  _curve(p, s, mirror) {
    return { t: 'text', text: s.text, font: s.font, size: s.size, align: s.align, spacing: s.spacing || 0, p, rot: rad(s.rotDeg || 0), ...(mirror ? { mirror: true } : {}) };
  }

  down(ev) { return false; } // koppintásra helyezünk el (a húzás a nézetet forgatja)
  up() {}

  tap(ev) {
    if (ev.pointerType === 'touch') { touchSelect(this.app, ev); return true; }
    if (this.busy) return true;
    const cur = this.cursorAt(ev);
    if (!cur) return true;
    this.frame = cur.frame;
    this.place(cur.uv);
    return true;
  }

  async place(p) {
    const frame = this.frame;
    const o = readableOrientation(this.app, frame);
    this.busy = true;
    this.prev.clear();
    const res = await textDialog(this.app, { ...this.settings, rotDeg: o.rotDeg });
    this.busy = false;
    if (!res || !res.text.trim()) { this.resetEntity(); return; }
    try { await loadFont(res.font); } catch (e) { this.app.ui.toast('A betűtípus nem tölthető be', 'error'); return; }
    this.settings = { ...res };
    this.app.lastText = { ...res };
    this.frame = frame;
    this.commit([this._curve(p, res, o.mirror)], 'Szöveg');
    this.resetEntity();
    this.refreshPanel && this.refreshPanel();
  }

  click() {}
  doubleTap() { return true; }
}

/** Kijelölt szöveggörbe szerkesztése. */
export async function editTextCurve(app, sketchId, curveId) {
  const sk = app.doc.sketch(sketchId);
  const c = sk && sk.curves.find((x) => x.id === curveId);
  if (!c || c.t !== 'text') return;
  const res = await textDialog(app, { text: c.text, font: c.font, size: c.size, align: c.align || 'left', spacing: c.spacing || 0, rotDeg: deg(c.rot || 0) }, { title: 'Szöveg szerkesztése', okLabel: 'Mentés' });
  if (!res || !res.text.trim()) return;
  await loadFont(res.font);
  app.lastText = { ...res };
  app.updateSketch(sketchId, (s) => ({
    ...s,
    curves: s.curves.map((x) => (x.id === curveId ? { ...x, text: res.text, font: res.font, size: res.size, align: res.align, spacing: res.spacing, rot: rad(res.rotDeg) } : x)),
  }), 'Szöveg szerkesztése', 'text');
}

// ---------------------------------------------------------------- a szöveg "tintás" régiói
/** Egy belső pont a régióban (vízszintes metszővonalak közül a legszélesebb belső szakasz közepe). */
function interiorPoint(polys) {
  let y0 = Infinity, y1 = -Infinity;
  for (const pl of polys) for (const p of pl) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let best = null;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9, 0.43, 0.57]) {
    const y = y0 + (y1 - y0) * f;
    const xs = [];
    for (const pl of polys) {
      for (let i = 0; i < pl.length; i++) {
        const a = pl[i], b = pl[(i + 1) % pl.length];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { w, p: [(xs[i] + xs[i + 1]) / 2, y] };
    }
    if (best && best.w > (y1 - y0) * 0.05) break;
  }
  return best ? best.p : null;
}

function winding(contours, p) {
  let w = 0;
  for (const pl of contours) {
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i], b = pl[i + 1];
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1]) { if (b[1] > p[1] && cr > 0) w++; }
      else if (b[1] <= p[1] && cr < 0) w--;
    }
  }
  return w;
}

/** A szöveg betűit alkotó régiók (a betűk belső "lyukai" nélkül). */
export function textInkRegions(app, sketch, curve) {
  const contours = curvePolylines(curve);
  if (!contours.length) return [];
  return app.sketches.regions(sketch).filter((r) => {
    if (!r.curveIds.includes(curve.id)) return false;
    const p = interiorPoint(r.polys);
    return p && winding(contours, p) !== 0;
  });
}

/** A kijelölt szöveg befoglaló téglalapja (világ koordinátákban) – pl. a nézet igazításához. */
export function textWorldBox(sketch, curve) {
  const f = planeFromJSON(sketch.plane);
  return textBox(curve).map((q) => f.origin.clone().addScaledVector(f.xDir, q[0]).addScaledVector(f.yDir, q[1]));
}
