// Vázlatrajzoló eszközök
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Tool } from '../tools/base.js';
import { planeFromJSON, samePlane, toLocal, toWorld } from './manager.js';
import { snap, SnapViz } from './snap.js';
import { curvePolyline, curvePolylines, curvePieces, intersect, closest, dist, sub, add, mul, norm, perp, polar, angleOf, TAU, derivAt, evalAt, curveEnds, splineToBeziers } from './geom2d.js';
import { arcFrom3, FreehandCapture } from './freehand.js';
import { fmtLen, fmtAngle } from '../util/units.js';
import { uid } from '../util/misc.js';
import { movePoint } from './edit.js';
import { ArrowHandle } from '../view/handles.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- előnézeti vonalak
export class PreviewLines {
  constructor(app, color = 0x2bb8f0, width = 2.6, dashed = false) {
    this.app = app;
    this.line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color, linewidth: width, worldUnits: false, depthTest: false, transparent: true, opacity: 0.95, dashed, dashSize: 4, gapSize: 3 }));
    this.line.renderOrder = 24;
    this.line.visible = false;
    app.vp.overlayScene.add(this.line);
  }
  set(frame, curves) {
    const arr = [];
    for (const c of curves) {
      for (const pl of curvePolylines(c)) {
        for (let i = 0; i < pl.length - 1; i++) {
          const a = toWorld(frame, pl[i]), b = toWorld(frame, pl[i + 1]);
          arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    this.line.visible = arr.length > 0;
    if (arr.length) {
      this.line.geometry.dispose();
      this.line.geometry = new LineSegmentsGeometry();
      this.line.geometry.setPositions(arr);
      if (this.line.material.dashed) this.line.computeLineDistances();
      this.line.material.resolution.set(this.app.vp.width, this.app.vp.height);
    }
    this.app.vp.requestRender();
  }
  clear() { this.line.visible = false; this.app.vp.requestRender(); }
  dispose() { this.app.vp.overlayScene.remove(this.line); this.line.geometry.dispose(); this.line.material.dispose(); }
}

// ---------------------------------------------------------------- alap rajzoló eszköz
export class DrawTool extends Tool {
  get isSketchTool() { return true; }
  get allowsSelection() { return false; }
  get title() { return 'Vázlat'; }
  get icon() { return 'sketch'; }
  get hintText() { return 'Koppints a pontokra, vagy húzd a Pencillel'; }

  start() {
    this.viz = new SnapViz(this.app);
    this.prev = new PreviewLines(this.app);
    this.frame = this.opts.frame || null;
    this.lockedFrame = !!this.opts.frame;
    this.pts = [];
    this.cursor = null;
    this.locks = {};
    this.dimBubbles = new Map();
    if (this.opts.frame) this.app.vp.setGridFrame(this.opts.frame);
  }

  stop() {
    super.stop();
    this.viz.dispose();
    this.prev.dispose();
    for (const b of this.dimBubbles.values()) b.remove();
    this.dimBubbles.clear();
  }

  get construction() { return !!this.app.sketchConstruction; }

  panel() {
    const items = [{ type: 'info', text: this.hintText }];
    items.push({ type: 'toggle', key: 'construction', label: 'Segédvonal', value: this.construction });
    items.push(...this.extraPanel());
    return { title: this.title, icon: this.icon, items, doneLabel: 'Kész', cancel: false };
  }
  extraPanel() { return []; }

  change(key, v) {
    if (key === 'construction') { this.app.sketchConstruction = v; this.refreshPanel(); }
  }

  done() {
    if (this.pts.length && this.finishEntity) this.finishEntity();
    this.app.setTool(null);
  }
  cancel() { this.app.setTool(null); }

  /** Sík meghatározása az első ponthoz. */
  resolveFrame(ev) {
    if (this.lockedFrame && this.frame) return this.frame;
    const { frame } = this.app.sketchFrameAt(ev);
    for (const s of this.app.doc.state.sketches) {
      if (this.app.doc.isHidden(s.id)) continue;
      const sf = planeFromJSON(s.plane);
      if (samePlane(sf, frame)) return sf;
    }
    return frame;
  }

  cursorAt(ev) {
    const frame = this.pts.length ? this.frame : this.resolveFrame(ev);
    const p = this.app.vp.rayPlane(ev.x, ev.y, frame.origin, frame.normal);
    if (!p) return null;
    const uv = toLocal(frame, p);
    const last = this.pts[this.pts.length - 1];
    const s = snap(this.app, frame, uv, ev, { from: last, extra: this.pts.map((q) => ({ p: q, kind: 'end' })) });
    let q = s.p;
    q = this.constrain(q);
    return { frame, uv: q, snap: s };
  }

  constrain(q) { return q; }

  drawPreview() {
    const c = this.cursor ? this.cursor.uv : null;
    const f = this.frame || (this.cursor && this.cursor.frame);
    if (!f) return;
    const curves = this.previewCurves(c);
    this.prev.set(f, curves);
    this.updateDims(f, c);
  }

  previewCurves() { return []; }
  dims() { return []; }

  updateDims(frame, c) {
    const want = c ? this.dims(c) : [];
    const keys = new Set(want.map((d) => d.key));
    for (const [k, b] of this.dimBubbles) if (!keys.has(k)) { b.remove(); this.dimBubbles.delete(k); }
    for (const d of want) {
      let b = this.dimBubbles.get(d.key);
      if (!b) {
        b = this.app.handles.bubble({ onTap: () => this.editDim(d.key) });
        this.dimBubbles.set(d.key, b);
      }
      const txt = d.kind === 'angle' ? fmtAngle(d.value) : d.kind === 'int' ? String(d.value) : fmtLen(d.value);
      b.set(`${d.prefix || ''}${txt}`);
      b.elm.style.borderColor = this.locks[d.key] != null ? '#ffd60a' : '';
      b.at(toWorld(frame, d.at));
      b.show();
      this.dimSpec = this.dimSpec || {};
      this.dimSpec[d.key] = d;
    }
  }

  editDim(key) {
    const d = this.dimSpec && this.dimSpec[key];
    if (!d) return;
    const b = this.dimBubbles.get(key);
    this.app.ui.keypad({
      label: d.label || 'Érték', kind: d.kind || 'len', value: d.value, anchor: b ? b.elm : null,
      onDone: (v) => {
        this.locks[key] = d.kind === 'angle' ? v : v;
        if (this.onLock && this.onLock(key, v)) return;
        if (this.cursor) { this.cursor.uv = this.constrain(this.cursor.uv); this.drawPreview(); }
      },
    });
  }

  /** A fő méret gyors megadása billentyűzettel (számjegy leütése). */
  primaryDimKey() { return null; }

  commit(curves, label, constraints = []) {
    const cons = this.construction;
    const out = curves.map((c) => ({ ...c, id: uid("c"), ...(cons ? { construction: true } : {}) }));
    this.app.addCurves(this.frame, out, label, this.icon, constraints);
    this.locks = {};
    return out;
  }

  resetEntity() {
    this.pts = [];
    this.locks = {};
    if (!this.lockedFrame) this.frame = null;
    this.prev.clear();
    for (const b of this.dimBubbles.values()) b.remove();
    this.dimBubbles.clear();
  }

  // --------------------------- bemenet
  down(ev) {
    if (ev.pointerType === 'touch') return false; // ujjal nem rajzolunk
    const cur = this.cursorAt(ev);
    if (!cur) return true;
    this.cursor = cur;
    this.downPt = [ev.x, ev.y];
    if (!this.pts.length) { this.frame = cur.frame; this.click(cur.uv, ev); this.firstFromDown = true; }
    else this.firstFromDown = false;
    this.drawPreview();
    return true;
  }

  move(ev) {
    const cur = this.cursorAt(ev);
    if (!cur) return;
    this.cursor = cur;
    this.viz.show(this.frame || cur.frame, cur.snap);
    this.drawPreview();
  }

  up(ev) {
    const moved = this.downPt && Math.hypot(ev.x - this.downPt[0], ev.y - this.downPt[1]) > (ev.pointerType === 'pen' ? 6 : 4);
    const cur = this.cursorAt(ev) || this.cursor;
    if (this.firstFromDown) { if (moved && cur) this.click(cur.uv, ev); }
    else if (cur) this.click(cur.uv, ev);
    this.firstFromDown = false;
    this.drawPreview();
  }

  pointerCancel() { this.firstFromDown = false; }

  tap(ev) {
    if (ev.pointerType === 'touch') { touchSelect(this.app, ev); return true; }
    const cur = this.cursorAt(ev);
    if (!cur) return true;
    if (!this.pts.length) this.frame = cur.frame;
    this.cursor = cur;
    this.click(cur.uv, ev);
    this.drawPreview();
    return true;
  }

  doubleTap(ev) {
    if (this.finishEntity && this.pts.length) { this.finishEntity(); return true; }
    return true;
  }

  hover(ev) {
    if (!ev) { this.viz.hide(); return true; }
    const cur = this.cursorAt(ev);
    if (!cur) return true;
    this.cursor = cur;
    this.viz.show(this.frame || cur.frame, cur.snap);
    this.drawPreview();
    return true;
  }

  key(e) {
    if (e.key === 'Escape') {
      if (this.pts.length) { this.resetEntity(); return true; }
      this.app.setTool(null);
      return true;
    }
    if (e.key === 'Enter') { if (this.pts.length && this.finishEntity) this.finishEntity(); else this.app.setTool(null); return true; }
    if (/^[0-9]$/.test(e.key) && this.pts.length) {
      const k = this.primaryDimKey();
      if (k) { this.editDim(k); return true; }
    }
    return false;
  }
}

// ---------------------------------------------------------------- vonal
export class LineTool extends DrawTool {
  get toolId() { return 'line'; }
  get title() { return 'Vonal'; }
  get icon() { return 'line'; }
  get hintText() { return 'Pontról pontra; a kezdőpontra koppintva zárul, dupla koppintás befejezi'; }
  primaryDimKey() { return 'len'; }

  constrain(q) {
    const last = this.pts[this.pts.length - 1];
    if (!last) return q;
    let d = sub(q, last);
    let L = Math.hypot(d[0], d[1]);
    let a = Math.atan2(d[1], d[0]);
    if (this.locks.ang != null) a = rad(this.locks.ang);
    if (this.locks.len != null) L = this.locks.len;
    if (this.locks.ang != null || this.locks.len != null) return [last[0] + Math.cos(a) * L, last[1] + Math.sin(a) * L];
    return q;
  }

  onLock(key) {
    if (key === 'len' && this.locks.ang == null && this.cursor) {
      // hossz megadva: ha az irány is egyértelmű, azonnal lerakjuk
      const q = this.constrain(this.cursor.uv);
      this.click(q);
      this.drawPreview();
      return true;
    }
    return false;
  }

  previewCurves(c) {
    const last = this.pts[this.pts.length - 1];
    if (!last || !c) return [];
    return [{ t: 'line', a: last, b: c }];
  }

  dims(c) {
    const last = this.pts[this.pts.length - 1];
    if (!last || dist(last, c) < 1e-9) return [];
    const mid = [(last[0] + c[0]) / 2, (last[1] + c[1]) / 2];
    const d = sub(c, last);
    const n = norm(perp(d));
    const wpp = this.app.vp.worldPerPixel(toWorld(this.frame, mid));
    let a = deg(Math.atan2(d[1], d[0]));
    return [
      { key: 'len', label: 'Hossz', value: Math.hypot(d[0], d[1]), at: add(mid, mul(n, 22 * wpp)) },
      { key: 'ang', label: 'Szög', kind: 'angle', value: Math.round(a * 100) / 100, at: add(last, mul(norm(d), 30 * wpp)) },
    ];
  }

  click(p) {
    if (!this.pts.length) { this.pts = [p]; this.startSnap = this.cursor && this.cursor.snap; return; }
    const last = this.pts[this.pts.length - 1];
    if (dist(last, p) < 1e-9) return;
    // automatikus kényszerek: vízszintes/függőleges, beírt hossz, görbére illesztett végpont
    const cons = [];
    if (Math.abs(p[1] - last[1]) < 1e-9) cons.push({ type: "horizontal", a: { curve: "#0" } });
    else if (Math.abs(p[0] - last[0]) < 1e-9) cons.push({ type: "vertical", a: { curve: "#0" } });
    if (this.locks.len != null) cons.push({ type: "length", a: { curve: "#0" }, value: this.locks.len });
    const sn = this.cursor && this.cursor.snap;
    if (sn && sn.kind === "curve" && sn.curveId && dist(sn.p, p) < 1e-9) cons.push({ type: "onCurve", a: { curve: "#0", part: "b" }, b: { curve: sn.curveId } });
    if (this.pts.length === 1 && this.startSnap && this.startSnap.kind === "curve" && this.startSnap.curveId && dist(this.startSnap.p, last) < 1e-9) cons.push({ type: "onCurve", a: { curve: "#0", part: "a" }, b: { curve: this.startSnap.curveId } });
    this.commit([{ t: "line", a: last, b: p }], "Vonal", cons);
    if (this.pts.length >= 2 && dist(this.pts[0], p) < 1e-9) { this.resetEntity(); return; }
    this.pts.push(p);
    this.locks = {};
  }

  finishEntity() { this.resetEntity(); }
}

// ---------------------------------------------------------------- téglalap
export class RectTool extends DrawTool {
  get toolId() { return this.centered ? 'rectCenter' : 'rect'; }
  get centered() { return !!this.opts.centered; }
  get title() { return this.centered ? 'Téglalap középről' : 'Téglalap'; }
  get icon() { return this.centered ? 'rectCenter' : 'rect'; }
  get hintText() { return this.centered ? 'Középpont, majd sarok' : 'Két átellenes sarok'; }
  primaryDimKey() { return 'w'; }

  corners(p0, c) {
    if (this.centered) {
      const dx = c[0] - p0[0], dy = c[1] - p0[1];
      return [[p0[0] - dx, p0[1] - dy], [p0[0] + dx, p0[1] - dy], [p0[0] + dx, p0[1] + dy], [p0[0] - dx, p0[1] + dy]];
    }
    return [p0, [c[0], p0[1]], c, [p0[0], c[1]]];
  }

  constrain(q) {
    const p0 = this.pts[0];
    if (!p0) return q;
    const k = this.centered ? 0.5 : 1;
    let dx = q[0] - p0[0], dy = q[1] - p0[1];
    if (this.locks.w != null) dx = Math.sign(dx || 1) * this.locks.w * k;
    if (this.locks.h != null) dy = Math.sign(dy || 1) * this.locks.h * k;
    return [p0[0] + dx, p0[1] + dy];
  }

  previewCurves(c) {
    if (!this.pts.length || !c) return [];
    const k = this.corners(this.pts[0], c);
    return k.map((p, i) => ({ t: 'line', a: p, b: k[(i + 1) % 4] }));
  }

  dims(c) {
    if (!this.pts.length) return [];
    const k = this.corners(this.pts[0], c);
    const w = Math.abs(k[1][0] - k[0][0]), h = Math.abs(k[2][1] - k[1][1]);
    if (w < 1e-9 && h < 1e-9) return [];
    const wpp = this.app.vp.worldPerPixel(toWorld(this.frame, k[0]));
    const minY = Math.min(k[0][1], k[2][1]), maxX = Math.max(k[0][0], k[2][0]);
    return [
      { key: 'w', label: 'Szélesség', value: w, at: [(k[0][0] + k[1][0]) / 2, minY - 18 * wpp] },
      { key: 'h', label: 'Magasság', value: h, at: [maxX + 26 * wpp, (k[1][1] + k[2][1]) / 2] },
    ];
  }

  onLock() {
    if (this.locks.w != null && this.locks.h != null && this.cursor) {
      this.click(this.constrain(this.cursor.uv));
      return true;
    }
    return false;
  }

  click(p) {
    if (!this.pts.length) { this.pts = [p]; return; }
    const k = this.corners(this.pts[0], p);
    if (Math.abs(k[1][0] - k[0][0]) < 1e-9 || Math.abs(k[2][1] - k[1][1]) < 1e-9) return;
    const rc = [{ type: "horizontal", a: { curve: "#0" } }, { type: "vertical", a: { curve: "#1" } }, { type: "horizontal", a: { curve: "#2" } }, { type: "vertical", a: { curve: "#3" } }];
    if (this.locks.w != null) rc.push({ type: "length", a: { curve: "#0" }, value: Math.abs(k[1][0] - k[0][0]) });
    if (this.locks.h != null) rc.push({ type: "length", a: { curve: "#1" }, value: Math.abs(k[2][1] - k[1][1]) });
    this.commit(k.map((q, i) => ({ t: "line", a: q, b: k[(i + 1) % 4] })), "Téglalap", rc);
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- kör
export class CircleTool extends DrawTool {
  get toolId() { return 'circle'; }
  get title() { return 'Kör'; }
  get icon() { return 'circle'; }
  get hintText() { return 'Középpont, majd egy pont a körön'; }
  primaryDimKey() { return 'd'; }

  constrain(q) {
    const c = this.pts[0];
    if (!c || this.locks.d == null) return q;
    const d = norm(sub(q, c));
    return add(c, mul(d[0] || d[1] ? d : [1, 0], this.locks.d / 2));
  }
  onLock() { if (this.cursor) { this.click(this.constrain(this.cursor.uv)); return true; } return false; }

  previewCurves(c) {
    if (!this.pts.length || !c) return [];
    const r = dist(this.pts[0], c);
    return r > 1e-9 ? [{ t: 'circle', c: this.pts[0], r }, { t: 'line', a: this.pts[0], b: c }] : [];
  }

  dims(c) {
    if (!this.pts.length) return [];
    const r = dist(this.pts[0], c);
    if (r < 1e-9) return [];
    return [{ key: 'd', label: 'Átmérő', prefix: 'Ø ', value: 2 * r, at: [(this.pts[0][0] + c[0]) / 2, (this.pts[0][1] + c[1]) / 2] }];
  }

  click(p) {
    if (!this.pts.length) { this.pts = [p]; return; }
    const r = dist(this.pts[0], p);
    if (r < 1e-9) return;
    this.commit([{ t: "circle", c: this.pts[0], r }], "Kör", this.locks.d != null ? [{ type: "diameter", a: { curve: "#0" }, value: 2 * r }] : []);
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- ív (3 pont)
export class ArcTool extends DrawTool {
  get toolId() { return 'arc'; }
  get title() { return 'Ív'; }
  get icon() { return 'arc'; }
  get hintText() { return 'Kezdőpont, végpont, majd egy pont az íven'; }

  previewCurves(c) {
    if (!c) return [];
    if (this.pts.length === 1) return [{ t: 'line', a: this.pts[0], b: c }];
    if (this.pts.length === 2) { const a = arcFrom3(this.pts[0], c, this.pts[1]); return a ? [a] : [{ t: 'line', a: this.pts[0], b: this.pts[1] }]; }
    return [];
  }

  dims(c) {
    if (this.pts.length !== 2) return [];
    const a = arcFrom3(this.pts[0], c, this.pts[1]);
    if (!a) return [];
    return [{ key: 'r', label: 'Sugár', prefix: 'R ', value: a.r, at: polar(a.c, a.r * 0.5, (a.a0 + a.a1) / 2) }];
  }

  onLock(key, v) {
    if (key !== 'r' || this.pts.length !== 2) return false;
    const [A, B] = this.pts;
    const d = dist(A, B);
    if (v < d / 2) { this.app.ui.toast('A sugár túl kicsi', 'error'); return true; }
    // a kurzor oldalán lévő ív
    const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const n = norm(perp(sub(B, A)));
    const side = this.cursor ? Math.sign((this.cursor.uv[0] - M[0]) * n[0] + (this.cursor.uv[1] - M[1]) * n[1]) || 1 : 1;
    const h = Math.sqrt(v * v - (d / 2) ** 2);
    const C = add(M, mul(n, -side * h));
    const mid = add(C, mul(norm(sub(add(M, mul(n, side * v)), C)), v));
    this.click(mid);
    return true;
  }

  click(p) {
    if (this.pts.length < 2) {
      if (this.pts.length === 1 && dist(this.pts[0], p) < 1e-9) return;
      this.pts.push(p);
      return;
    }
    const a = arcFrom3(this.pts[0], p, this.pts[1]);
    if (!a) return;
    this.commit([a], 'Ív');
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- érintő ív
export class TangentArcTool extends DrawTool {
  get toolId() { return 'tangentArc'; }
  get title() { return 'Érintő ív'; }
  get icon() { return 'arcTangent'; }
  get hintText() { return 'Koppints egy vonal vagy ív végpontjára, majd az ív végére'; }

  click(p) {
    if (!this.pts.length) {
      // érintő irány a meglévő görbe végpontjánál
      const t = this.tangentAt(p);
      if (!t) { this.app.ui.toast('Egy meglévő vonal/ív végpontjáról indíts', '', 2200); return; }
      this.tan = t;
      this.pts = [p];
      return;
    }
    const a = this.arc(p);
    if (!a) return;
    const tc = [];
    if (this.tanCurve) {
      const src = this.tanCurve;
      let mode;
      if (src.t === "arc") { const d = dist(src.c, a.c); mode = Math.abs(d - (src.r + a.r)) < Math.abs(d - Math.abs(src.r - a.r)) ? "ext" : "int"; }
      tc.push({ type: "tangent", a: { curve: "#0" }, b: { curve: src.id }, ...(mode ? { mode } : {}) });
    }
    const out = this.commit([a], "Érintő ív", tc);
    this.tanCurve = out[0];
    // folytatható: a következő érintő az ív végén
    const end = p;
    const tangentEnd = this.arcEndTangent(a, end);
    this.pts = [end];
    this.tan = tangentEnd;
  }

  tangentAt(p) {
    for (const s of this.app.doc.state.sketches) {
      const f = planeFromJSON(s.plane);
      if (!samePlane(f, this.frame)) continue;
      for (const c of s.curves) {
        if (c.t === "line") {
          if (dist(c.b, p) < 1e-6) { this.tanCurve = c; return norm(sub(c.b, c.a)); }
          if (dist(c.a, p) < 1e-6) { this.tanCurve = c; return norm(sub(c.a, c.b)); }
        } else if (c.t === "arc") {
          const e0 = polar(c.c, c.r, c.a0), e1 = polar(c.c, c.r, c.a1);
          if (dist(e1, p) < 1e-6) { this.tanCurve = c; return norm(perp(sub(e1, c.c))); }
          if (dist(e0, p) < 1e-6) { this.tanCurve = c; return mul(norm(perp(sub(e0, c.c))), -1); }
        }
      }
    }
    return null;
  }

  arc(p) {
    const A = this.pts[0], t = this.tan;
    const ch = sub(p, A);
    const n = perp(t);
    const den = 2 * (ch[0] * n[0] + ch[1] * n[1]);
    if (Math.abs(den) < 1e-9) return null;
    const k = (ch[0] * ch[0] + ch[1] * ch[1]) / den;
    const C = add(A, mul(n, k));
    const r = Math.abs(k);
    let a0 = angleOf(sub(A, C)), a1 = angleOf(sub(p, C));
    const ccw = k > 0;
    if (ccw) { while (a1 <= a0) a1 += TAU; return { t: 'arc', c: C, r, a0, a1 }; }
    while (a0 <= a1) a0 += TAU;
    return { t: 'arc', c: C, r, a0: a1, a1: a0 };
  }

  arcEndTangent(a, end) {
    const e1 = polar(a.c, a.r, a.a1);
    const tn = norm(perp(sub(end, a.c)));
    return dist(e1, end) < 1e-6 ? tn : mul(tn, -1);
  }

  previewCurves(c) {
    if (!this.pts.length || !c) return [];
    const a = this.arc(c);
    return a ? [a] : [];
  }

  dims(c) {
    if (!this.pts.length) return [];
    const a = this.arc(c);
    return a ? [{ key: 'r', prefix: 'R ', label: 'Sugár', value: a.r, at: polar(a.c, a.r * 0.5, (a.a0 + a.a1) / 2) }] : [];
  }

  finishEntity() { this.resetEntity(); }
}

// ---------------------------------------------------------------- spline
export class SplineTool extends DrawTool {
  get toolId() { return 'spline'; }
  get title() { return 'Spline'; }
  get icon() { return 'spline'; }
  get hintText() { return 'Pontok a görbén; dupla koppintás / Enter befejezi, a kezdőpont zárja'; }

  previewCurves(c) {
    const pts = c ? [...this.pts, c] : this.pts;
    if (pts.length < 2) return [];
    return [{ t: 'spline', pts, closed: false }];
  }

  click(p) {
    if (this.pts.length >= 2 && dist(this.pts[0], p) < 1e-9) {
      this.commit([{ t: 'spline', pts: this.pts.slice(), closed: true }], 'Spline');
      this.resetEntity();
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) < 1e-9) { this.finishEntity(); return; }
    this.pts.push(p);
  }

  finishEntity() {
    if (this.pts.length >= 2) this.commit([{ t: 'spline', pts: this.pts.slice(), closed: false }], 'Spline');
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- sokszög
export class PolygonTool extends DrawTool {
  get toolId() { return 'polygon'; }
  get title() { return 'Sokszög'; }
  get icon() { return 'polygon'; }
  get hintText() { return 'Középpont, majd egy csúcs'; }
  get sides() { return this.app.polygonSides || 6; }
  extraPanel() { return [{ type: 'number', key: 'sides', label: 'Oldalak', kind: 'int', value: this.sides }]; }
  change(k, v) { if (k === 'sides') { this.app.polygonSides = Math.max(3, Math.min(64, Math.round(v))); this.refreshPanel(); this.drawPreview(); } else super.change(k, v); }
  primaryDimKey() { return 'r'; }

  verts(c, p) {
    const r = dist(c, p);
    const a0 = angleOf(sub(p, c));
    const n = this.sides;
    const out = [];
    for (let i = 0; i < n; i++) out.push(polar(c, r, a0 + (i * TAU) / n));
    return out;
  }
  constrain(q) {
    const c = this.pts[0];
    if (!c || this.locks.r == null) return q;
    return add(c, mul(norm(sub(q, c)), this.locks.r));
  }
  onLock() { if (this.cursor) { this.click(this.constrain(this.cursor.uv)); return true; } return false; }
  previewCurves(c) {
    if (!this.pts.length || !c || dist(this.pts[0], c) < 1e-9) return [];
    const v = this.verts(this.pts[0], c);
    return v.map((p, i) => ({ t: 'line', a: p, b: v[(i + 1) % v.length] }));
  }
  dims(c) {
    if (!this.pts.length || dist(this.pts[0], c) < 1e-9) return [];
    return [{ key: 'r', label: 'Körülírt sugár', prefix: 'R ', value: dist(this.pts[0], c), at: [(this.pts[0][0] + c[0]) / 2, (this.pts[0][1] + c[1]) / 2] }];
  }
  click(p) {
    if (!this.pts.length) { this.pts = [p]; return; }
    if (dist(this.pts[0], p) < 1e-9) return;
    const v = this.verts(this.pts[0], p);
    this.commit(v.map((q, i) => ({ t: 'line', a: q, b: v[(i + 1) % v.length] })), 'Sokszög');
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- hosszlyuk
export class SlotTool extends DrawTool {
  get toolId() { return 'slot'; }
  get title() { return 'Hosszlyuk'; }
  get icon() { return 'slot'; }
  get hintText() { return 'Első középpont, második középpont, majd a szélesség'; }

  shape(c1, c2, w) {
    const d = norm(sub(c2, c1));
    const n = perp(d);
    const r = w / 2;
    const a = angleOf(n);
    const p1 = add(c1, mul(n, r)), p2 = add(c2, mul(n, r)), p3 = add(c2, mul(n, -r)), p4 = add(c1, mul(n, -r));
    return [
      { t: 'line', a: p4, b: p3 },
      { t: 'arc', c: c2, r, a0: a - Math.PI, a1: a },
      { t: 'line', a: p2, b: p1 },
      { t: 'arc', c: c1, r, a0: a, a1: a + Math.PI },
    ];
  }
  /** Hosszlyuk kényszerei: érintő ívek, egyenlő sugár; beírt szélesség méretként. */
  slotCons(withW) {
    const T = (a, b) => ({ type: "tangent", a: { curve: `#${a}` }, b: { curve: `#${b}` } });
    const c = [T(0, 1), T(1, 2), T(2, 3), T(3, 0), { type: "equal", a: { curve: "#1" }, b: { curve: "#3" } }];
    if (withW && this.locks.w != null) c.push({ type: "diameter", a: { curve: "#1" }, value: this.locks.w });
    return c;
  }

  width(c) {
    const [c1, c2] = this.pts;
    const d = norm(sub(c2, c1));
    const n = perp(d);
    return Math.abs((c[0] - c1[0]) * n[0] + (c[1] - c1[1]) * n[1]) * 2;
  }
  previewCurves(c) {
    if (!c || !this.pts.length) return [];
    if (this.pts.length === 1) return [{ t: 'line', a: this.pts[0], b: c }];
    const w = this.locks.w ?? this.width(c);
    return w > 1e-9 ? this.shape(this.pts[0], this.pts[1], w) : [];
  }
  dims(c) {
    if (this.pts.length === 1) return [{ key: 'l', label: 'Középpont távolság', value: dist(this.pts[0], c), at: [(this.pts[0][0] + c[0]) / 2, (this.pts[0][1] + c[1]) / 2] }];
    if (this.pts.length === 2) return [{ key: 'w', label: 'Szélesség', value: this.locks.w ?? this.width(c), at: c }];
    return [];
  }
  constrain(q) {
    if (this.pts.length === 1 && this.locks.l != null) return add(this.pts[0], mul(norm(sub(q, this.pts[0])), this.locks.l));
    return q;
  }
  onLock(k) {
    if (k === 'w' && this.pts.length === 2) { this.commit(this.shape(this.pts[0], this.pts[1], this.locks.w), "Hosszlyuk", this.slotCons(true)); this.resetEntity(); return true; }
    if (k === 'l' && this.pts.length === 1 && this.cursor) { this.click(this.constrain(this.cursor.uv)); return true; }
    return false;
  }
  click(p) {
    if (this.pts.length < 2) { if (this.pts.length === 1 && dist(this.pts[0], p) < 1e-9) return; this.pts.push(p); this.locks = {}; return; }
    const w = this.width(p);
    if (w < 1e-9) return;
    this.commit(this.shape(this.pts[0], this.pts[1], w), "Hosszlyuk", this.slotCons(false));
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- ellipszis
export class EllipseTool extends DrawTool {
  get toolId() { return 'ellipse'; }
  get title() { return 'Ellipszis'; }
  get icon() { return 'ellipse'; }
  get hintText() { return 'Középpont, a nagytengely vége, majd a kistengely'; }
  ell(c) {
    const [C, A] = this.pts;
    const rx = dist(C, A);
    const rot = angleOf(sub(A, C));
    const d = [Math.cos(rot), Math.sin(rot)];
    const ry = Math.abs((c[0] - C[0]) * -d[1] + (c[1] - C[1]) * d[0]);
    return { t: 'ellipse', c: C, rx, ry: Math.max(ry, 1e-6), rot };
  }
  previewCurves(c) {
    if (!c || !this.pts.length) return [];
    if (this.pts.length === 1) return [{ t: 'line', a: this.pts[0], b: c }];
    return [this.ell(c)];
  }
  click(p) {
    if (this.pts.length < 2) { if (this.pts.length === 1 && dist(this.pts[0], p) < 1e-9) return; this.pts.push(p); return; }
    const e = this.ell(p);
    if (e.ry < 1e-6) return;
    this.commit([e], 'Ellipszis');
    this.resetEntity();
  }
}

// ---------------------------------------------------------------- pont
export class PointTool extends DrawTool {
  get toolId() { return 'point'; }
  get title() { return 'Pont'; }
  get icon() { return 'point'; }
  get hintText() { return 'Koppints a pont helyére'; }
  click(p) { this.commit([{ t: 'point', p }], 'Pont'); this.resetEntity(); }
}

// ---------------------------------------------------------------- szabadkézi (explicit)
export class FreehandTool extends DrawTool {
  get toolId() { return 'freehand'; }
  get title() { return 'Szabadkézi'; }
  get icon() { return 'freehand'; }
  get hintText() { return 'Rajzolj: vonal, ív, kör, téglalap, sokszög és spline felismerése; firka = törlés'; }
  down(ev) {
    if (ev.pointerType === 'touch') return false;
    this.cap = new FreehandCapture(this.app, ev);
    return true;
  }
  move(ev) { this.cap && this.cap.move(ev); }
  up(ev) { if (this.cap) { this.cap.finish(ev); this.cap = null; } }
  pointerCancel() { if (this.cap) { this.cap.cancel(); this.cap = null; } }
  tap(ev) { if (ev.pointerType === 'touch') touchSelect(this.app, ev); return true; }
  hover() { return true; }
}

// ---------------------------------------------------------------- vágás (trim)
export class TrimTool extends DrawTool {
  get toolId() { return 'trim'; }
  get title() { return 'Vágás'; }
  get icon() { return 'trim'; }
  get hintText() { return 'Koppints a görbe azon szakaszára, amit eltávolítanál (a metszéspontok között)'; }
  down(ev) { if (ev.pointerType === 'touch') return false; this.trimAt(ev); return true; }
  move() {}
  up() {}
  tap(ev) { if (ev.pointerType !== 'touch') this.trimAt(ev); else touchSelect(this.app, ev); return true; }
  hover(ev) {
    if (!ev) return true;
    const pk = this.app.sketches.pick(ev.x, ev.y, 12, { regions: false, points: false });
    this.app.sketches.setHover(pk && pk.type === 'curve' ? pk : null);
    return true;
  }
  stop() { super.stop(); this.app.sketches.setHover(null); }

  trimAt(ev) {
    const tol = ev.pointerType === 'touch' ? 18 : 10;
    const pk = this.app.sketches.pick(ev.x, ev.y, tol, { regions: false, points: false });
    if (!pk || pk.type !== 'curve') return;
    const sk = this.app.doc.sketch(pk.sketchId);
    const c = sk.curves.find((x) => x.id === pk.curveId);
    if (!c) return;
    const res = trimCurve(sk, c, pk.point);
    if (!res) return;
    this.app.updateSketch(sk.id, (s) => ({ ...s, curves: s.curves.flatMap((x) => (x.id === c.id ? res : [x])) }), 'Vágás', 'trim');
  }
}

/** Görbe egy szakaszának eltávolítása a legközelebbi metszéspontok között. */
export function trimCurve(sketch, c, at) {
  if (c.t === 'text' || c.t === 'point') return null; // szöveget nem vágunk
  const others = sketch.curves.filter((x) => x.id !== c.id && x.t !== 'point' && !x.construction);
  const pieces = curvePieces(c);
  if (!pieces.length) return null;
  // paraméterezés: darab index + t -> globális s
  const cuts = [];
  pieces.forEach((pc, i) => {
    for (const o of others) for (const op of curvePieces(o)) for (const h of intersect(pc, op, 1e-6)) cuts.push(i + h.ta);
  });
  // a koppintás paramétere
  let best = { d: Infinity, s: 0 };
  pieces.forEach((pc, i) => { const r = closest(pc, at); if (r.d < best.d) best = { d: r.d, s: i + r.t }; });
  const n = pieces.length;
  const closed = c.t === 'circle' || c.t === 'ellipse' || (c.t === 'spline' && c.closed);
  const S = [...new Set(cuts.map((x) => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b).filter((x) => closed || (x > 1e-7 && x < n - 1e-7));
  if (!S.length) return []; // nincs metszés: az egész görbe törlődik
  let lo, hi;
  if (closed) {
    if (S.length < 2 && c.t !== 'circle') return [];
    lo = S.filter((x) => x <= best.s).pop();
    hi = S.find((x) => x > best.s);
    if (lo == null) lo = S[S.length - 1] - n;
    if (hi == null) hi = S[0] + n;
  } else {
    lo = S.filter((x) => x <= best.s).pop() ?? 0;
    hi = S.find((x) => x > best.s) ?? n;
  }
  const keep = [];
  const evalS = (s) => { const i = Math.min(n - 1, Math.floor(s)); return evalAt(pieces[((i % n) + n) % n], s - i); };
  if (c.t === 'line') {
    if (lo > 1e-7) keep.push({ ...c, id: uid('c'), a: c.a, b: evalS(lo) });
    if (hi < n - 1e-7) keep.push({ ...c, id: uid('c'), a: evalS(hi), b: c.b });
    return keep;
  }
  if (c.t === 'circle') {
    if (S.length < 2) return [];
    const a0 = hi * TAU, a1 = (lo + n) * TAU;
    return [{ id: uid('c'), t: 'arc', c: c.c, r: c.r, a0, a1: a1 <= a0 ? a1 + TAU : a1, ...(c.construction ? { construction: true } : {}) }];
  }
  if (c.t === 'arc') {
    const span = c.a1 - c.a0;
    if (lo > 1e-7) keep.push({ ...c, id: uid('c'), a1: c.a0 + span * lo });
    if (hi < 1 - 1e-7) keep.push({ ...c, id: uid('c'), a0: c.a0 + span * hi });
    return keep;
  }
  // spline / ellipszis: újramintavételezés a megmaradó tartomány(ok)on
  const sample = (s0, s1) => {
    const k = Math.max(4, Math.min(16, Math.ceil((s1 - s0) * 4)));
    const pts = [];
    for (let i = 0; i <= k; i++) pts.push(evalS(((s0 + ((s1 - s0) * i) / k) % n + n) % n));
    return { id: uid('c'), t: 'spline', pts, closed: false, ...(c.construction ? { construction: true } : {}) };
  };
  if (closed) return [sample(hi, lo + n)];
  if (lo > 1e-7) keep.push(sample(0, lo));
  if (hi < n - 1e-7) keep.push(sample(hi, n));
  return keep;
}

// ---------------------------------------------------------------- sarok lekerekítés
export class SketchFilletTool extends DrawTool {
  get toolId() { return 'sketchFillet'; }
  get title() { return 'Sarok lekerekítés'; }
  get icon() { return 'sketchFillet'; }
  get hintText() { return 'Koppints két vonal közös sarokpontjára'; }
  get radius() { return this.app.sketchFilletR || 5; }
  extraPanel() { return [{ type: 'number', key: 'r', label: 'Sugár', kind: 'len', value: this.radius }]; }
  change(k, v) { if (k === 'r') { this.app.sketchFilletR = v; this.refreshPanel(); } else super.change(k, v); }
  down(ev) { if (ev.pointerType === 'touch') return false; this.at(ev); return true; }
  move() {} up() {}
  tap(ev) { if (ev.pointerType !== 'touch') this.at(ev); else touchSelect(this.app, ev); return true; }
  hover() { return true; }

  at(ev) {
    const pk = this.app.sketches.pick(ev.x, ev.y, ev.pointerType === 'touch' ? 18 : 10, { regions: false });
    if (!pk || pk.type !== 'spoint') { this.app.ui.toast('Egy sarokpontra koppints', '', 1500); return; }
    const sk = this.app.doc.sketch(pk.sketchId);
    const P = pk.p;
    const lines = sk.curves.filter((c) => c.t === 'line' && (dist(c.a, P) < 1e-6 || dist(c.b, P) < 1e-6));
    if (lines.length !== 2) { this.app.ui.toast('A sarokban pontosan két vonal találkozzon', '', 2000); return; }
    const r = this.radius;
    const [l1, l2] = lines;
    const o1 = dist(l1.a, P) < 1e-6 ? l1.b : l1.a;
    const o2 = dist(l2.a, P) < 1e-6 ? l2.b : l2.a;
    const d1 = norm(sub(o1, P)), d2 = norm(sub(o2, P));
    const cosT = d1[0] * d2[0] + d1[1] * d2[1];
    const th = Math.acos(Math.max(-1, Math.min(1, cosT)));
    if (th < 1e-3 || th > Math.PI - 1e-3) { this.app.ui.toast('Párhuzamos vonalak', 'error'); return; }
    const t = r / Math.tan(th / 2);
    if (t > dist(P, o1) || t > dist(P, o2)) { this.app.ui.toast('A sugár túl nagy', 'error'); return; }
    const T1 = add(P, mul(d1, t)), T2 = add(P, mul(d2, t));
    const bis = norm(add(d1, d2));
    const C = add(P, mul(bis, r / Math.sin(th / 2)));
    const mid = add(C, mul(norm(sub(P, C)), r));
    const arc = arcFrom3(T1, mid, T2);
    const nl1 = dist(l1.a, P) < 1e-6 ? { ...l1, a: T1 } : { ...l1, b: T1 };
    const nl2 = dist(l2.a, P) < 1e-6 ? { ...l2, a: T2 } : { ...l2, b: T2 };
    const aid = uid('c');
    const tc = [{ id: uid('k'), type: 'tangent', a: { curve: aid }, b: { curve: l1.id } }, { id: uid('k'), type: 'tangent', a: { curve: aid }, b: { curve: l2.id } }];
    this.app.updateSketch(sk.id, (s) => ({ ...s, curves: [...s.curves.map((c) => (c.id === l1.id ? nl1 : c.id === l2.id ? nl2 : c)), { ...arc, id: aid }], constraints: [...(s.constraints || []), ...tc] }), 'Sarok lekerekítés', 'sketchFillet');
  }
}

// ---------------------------------------------------------------- görbe eltolás
export class OffsetCurveTool extends Tool {
  get toolId() { return 'offsetCurve'; }
  get isSketchTool() { return true; }
  start() {
    const sel = this.app.sel.filter((s) => s.type === 'curve');
    if (!sel.length) throw new Error('Jelölj ki egy vagy több vázlatgörbét');
    this.sketchId = sel[0].sketchId;
    const sk = this.app.doc.sketch(this.sketchId);
    this.frame = planeFromJSON(sk.plane);
    this.curves = sk.curves.filter((c) => sel.some((s) => s.sketchId === this.sketchId && s.curveId === c.id));
    this.d = this.app.lastOffset || 2;
    this.prev = new PreviewLines(this.app, 0x2bb8f0, 2.4);
    // fogantyú az első görbe közepén, a normális irányában
    const c0 = this.curves[0];
    const pc = curvePieces(c0)[0];
    const mid = evalAt(pc, 0.5), tan = norm(derivAt(pc, 0.5));
    this.anchor = mid; this.nrm = perp(tan);
    const W = toWorld(this.frame, mid);
    const N = toWorld(this.frame, add(mid, this.nrm)).sub(W).normalize();
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, { origin: W, dir: N, value: this.d, onChange: (v) => { this.d = v; this.update(); }, onTap: () => this.edit() }));
    this.update();
  }
  stop() { super.stop(); this.prev && this.prev.dispose(); }
  edit() { this.app.ui.keypad({ label: 'Eltolás', kind: 'len', value: this.d, onDone: (v) => { this.d = v; this.arrow.setValue(v); this.update(); } }); }
  update() { this.result = offsetCurves(this.curves, this.d); this.prev.set(this.frame, this.result); this.refreshPanel(); }
  panel() { return { title: 'Görbe eltolás', icon: 'offsetCurve', items: [{ type: 'number', key: 'd', label: 'Távolság', kind: 'len', value: this.d }, { type: 'button', key: 'flip', label: 'Megfordít', icon: 'rotate' }] }; }
  change(k, v) { if (k === 'd') { this.d = v; this.arrow.setValue(v); this.update(); } if (k === 'flip') { this.d = -this.d; this.arrow.setValue(this.d); this.update(); } }
  done() {
    this.app.lastOffset = Math.abs(this.d);
    const out = this.result.map((c) => ({ ...c, id: uid('c') }));
    this.app.updateSketch(this.sketchId, (s) => ({ ...s, curves: [...s.curves, ...out] }), 'Görbe eltolás', 'offsetCurve');
    this.app.setTool(null);
  }
}

export function offsetCurves(curves, d) {
  const out = [];
  for (const c of curves) {
    if (c.t === 'line') {
      const n = perp(norm(sub(c.b, c.a)));
      out.push({ t: 'line', a: add(c.a, mul(n, d)), b: add(c.b, mul(n, d)) });
    } else if (c.t === 'circle') {
      if (c.r - d > 1e-6) out.push({ t: 'circle', c: c.c, r: c.r - d });
    } else if (c.t === 'arc') {
      if (c.r - d > 1e-6) out.push({ ...c, r: c.r - d, id: undefined });
    } else if (c.t === 'spline' || c.t === 'ellipse') {
      const pcs = curvePieces(c);
      const pts = [];
      pcs.forEach((pc, i) => {
        for (let k = 0; k < 6; k++) {
          if (i > 0 && k === 0) continue;
          const t = k / 6;
          const p = evalAt(pc, t), n = perp(norm(derivAt(pc, t)));
          pts.push(add(p, mul(n, d)));
        }
      });
      const closed = c.t === 'ellipse' || c.closed;
      if (!closed) { const pc = pcs[pcs.length - 1]; const n = perp(norm(derivAt(pc, 1))); pts.push(add(evalAt(pc, 1), mul(n, d))); }
      out.push({ t: 'spline', pts, closed });
    }
  }
  // szomszédos eltolt vonalak összekötése a metszéspontjukban
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      if (i === j || out[i].t !== 'line' || out[j].t !== 'line') continue;
      const A = out[i], B = out[j];
      const ci = curves[i], cj = curves[j];
      if (ci.t !== 'line' || cj.t !== 'line' || dist(ci.b, cj.a) > 1e-6) continue;
      const r = sub(A.b, A.a), s = sub(B.b, B.a);
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const q = sub(B.a, A.a);
      const t = (q[0] * s[1] - q[1] * s[0]) / den;
      const X = add(A.a, mul(r, t));
      out[i] = { ...A, b: X };
      out[j] = { ...out[j], a: X };
    }
  }
  return out;
}

// ---------------------------------------------------------------- paletta (bal eszköztár vázlatmódban)
export class SketchPaletteTool extends LineTool {
  static palette(app) {
    const t = app.tool;
    const frame = t && t.lockedFrame ? t.frame : t && t.frame;
    const B = (id, icon, label, extra = {}) => ({ icon, label, active: t && t.toolId === id, onTap: () => app.startTool(id, { frame: frame || undefined }), ...extra });
    // az aktív vázlat neve (a síkon lévő vázlat)
    let name = 'Új vázlat';
    if (frame) {
      const sk = app.sketches.findSketchOnPlane(frame);
      if (sk) name = sk.name;
    }
    const cur = app.tool && app.tool.toolId;
    const more = [
      ['tangentArc', 'arcTangent', 'Érintő ív'], ['rectCenter', 'rectCenter', 'Téglalap középről'], ['polygon', 'polygon', 'Sokszög'],
      ['slot', 'slot', 'Hosszlyuk'], ['point', 'point', 'Pont'], ['freehand', 'freehand', 'Szabadkézi (alakfelismerés)'],
      ['sketchFillet', 'sketchFillet', 'Sarok lekerekítés'], ['offsetCurve', 'offsetCurve', 'Görbe eltolás (kijelöltek)'],
      ['text', 'text', 'Szöveg'],
    ];
    const moreActive = more.some((m) => m[0] === cur);
    const selCount = app.sel.filter((s) => s.type === 'curve' || s.type === 'spoint' || s.type === 'region').length;
    const selCurves = app.sel.filter((s) => s.type === 'curve');
    const txt = selCurves.length === 1 && (() => { const sk = app.doc.sketch(selCurves[0].sketchId); const c = sk && sk.curves.find((x) => x.id === selCurves[0].curveId); return c && c.t === 'text'; })() ? selCurves[0] : null;
    return [
      { icon: 'close', label: 'Vázlatból kilépés', sub: name, onTap: () => app.exitSketchMode() },
      '-',
      B('line', 'line', 'Vonal', { kbd: 'L' }),
      B('arc', 'arc', 'Ív', { kbd: 'A' }),
      B('spline', 'spline', 'Spline', { kbd: 'S', sub: 'Illesztett' }),
      B('rect', 'rect', 'Téglalap', { kbd: 'R', sub: 'Átlós' }),
      B('circle', 'circle', 'Kör', { kbd: 'C' }),
      B('ellipse', 'ellipse', 'Ellipszis'),
      { icon: 'dots', label: 'Továbbiak', menu: true, active: moreActive, onTap: (tile) => app.ui.menu(tile, more.map(([id, ic, l]) => ({ icon: ic, label: l, checked: cur === id, onTap: () => app.startTool(id, { frame: frame || undefined }) }))) },
      '-',
      B('trim', 'trim', 'Vágás', { kbd: 'T' }),
      { icon: 'trash', label: 'Törlés', disabled: !selCount, onTap: () => app.deleteSelection() },
      ...(txt ? [{ icon: 'text', label: 'Szöveg szerk.', onTap: () => import('./texttool.js').then((m) => m.editTextCurve(app, txt.sketchId, txt.curveId)) }] : []),
      { icon: 'construction', label: 'Segédvonal', sub: app.sketchConstruction ? 'Be' : 'Ki', active: !!app.sketchConstruction, onTap: () => { app.sketchConstruction = !app.sketchConstruction; app.updateToolbar(); app.tool && app.tool.refreshPanel && app.tool.refreshPanel(); } },
    ];
  }
}

export const SKETCH_TOOLS = {
  line: LineTool,
  rect: RectTool,
  rectCenter: class extends RectTool { constructor(app, opts) { super(app, { ...opts, centered: true }); } },
  circle: CircleTool,
  arc: ArcTool,
  tangentArc: TangentArcTool,
  spline: SplineTool,
  polygon: PolygonTool,
  slot: SlotTool,
  ellipse: EllipseTool,
  point: PointTool,
  freehand: FreehandTool,
  trim: TrimTool,
  sketchFillet: SketchFilletTool,
  offsetCurve: OffsetCurveTool,
};

/** Vázlat módban az ujjal koppintás kijelöl (vázlatgörbe, pont, régió) – a Pencil rajzol. */
export function touchSelect(app, ev) {
  const it = app.pickItem(ev, { edges: false, faces: false });
  if (it && it.sketchId) app.toggleSelect(it);
  else if (!it) app.clearSelection();
}
