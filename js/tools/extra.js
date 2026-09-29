// További Shapr3D eszközök: lap cseréje, vetítés / él eltolás, illesztés, szerkesztőtengely
import * as THREE from 'three';
import { Tool, KernelTool } from './base.js';
import { faceInfo, edgeInfo, refOf, V3, planeFromSel, axisFromItem } from './common.js';
import { planeFromJSON, planeToJSON, toLocal, toWorld, canonicalFrame } from '../sketch/manager.js';
import { offsetCurves, PreviewLines } from '../sketch/tools.js';
import { arcFrom3 } from '../sketch/freehand.js';
import { uid } from '../util/misc.js';
import { fmtLen } from '../util/units.js';
import { ArrowHandle } from '../view/handles.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- lap cseréje
export class ReplaceFaceTool extends KernelTool {
  get toolId() { return 'replaceFace'; }
  get opName() { return 'replaceFace'; }
  get label() { return 'Lap cseréje'; }
  get icon() { return 'replaceFace'; }
  get clearOnEmptyTap() { return false; }
  get allowsSelection() { return false; }

  start() {
    const faces = this.app.sel.filter((s) => s.type === 'face');
    if (!faces.length) throw new Error('Jelölj ki egy vagy több sík lapot (amit cserélni kell)');
    this.bodyId = faces[0].bodyId;
    this.faces = faces.filter((f) => f.bodyId === this.bodyId).map((f) => f.index);
    this.target = null;
    this.refreshPanel();
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    if (!it) return true;
    if (it.type === 'face' && it.bodyId === this.bodyId && this.faces.includes(it.index)) return true;
    const pl = planeFromSel(this.app, it);
    if (pl) { this.target = pl; this.update(); }
    return true;
  }

  args() {
    if (!this.target) return null;
    return { body: refOf(this.app, this.bodyId), faces: this.faces, target: { origin: this.target.origin.toArray(), normal: this.target.normal.toArray() } };
  }

  update() { this.requestPreview(); this.refreshPanel(); }

  panel() {
    return {
      title: 'Lap cseréje', icon: 'replaceFace',
      items: [
        this.hint(this.target ? `Cél: ${this.target.label}` : 'Koppints a célfelületre (lap vagy sík), amihez a kijelölt lap(ok) igazodjanak'),
        { type: 'info', text: `${this.faces.length} forráslap` },
      ],
      doneDisabled: !this.args(),
    };
  }
}

// ---------------------------------------------------------------- vetítés / él eltolás
/** Él -> vázlatgörbék a síkon (vonal, kör, ív; egyéb: spline mintavétellel). */
function projectEdge(app, bodyId, index, frame) {
  const g = app.bodies.gfx.get(bodyId);
  const e = g && g.data.edges ? g.data.edges[index] : null;
  if (!e) return [];
  const P = (p) => toLocal(frame, V3(p));
  const n = frame.normal;
  if (e.type === 'LINE') return [{ t: 'line', a: P(e.a), b: P(e.b) }];
  if (e.type === 'CIRCLE' && e.normal && Math.abs(V3(e.normal).dot(n)) > 0.9999) {
    if (e.closed) return [{ t: 'circle', c: P(e.center), r: e.radius }];
    const a = arcFrom3(P(e.a), P(e.mid), P(e.b));
    return a ? [a] : [];
  }
  // általános él: a megjelenítési hálóból mintavétel
  const seg = g.edgeSegments(index);
  if (!seg || seg.length < 6) return [];
  const pts = [];
  for (let i = 0; i < seg.length; i += 3) {
    const p = P([seg[i], seg[i + 1], seg[i + 2]]);
    if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-6) pts.push(p);
  }
  const step = Math.max(1, Math.floor(pts.length / 16));
  const s = pts.filter((_, i) => i % step === 0);
  if (s[s.length - 1] !== pts[pts.length - 1]) s.push(pts[pts.length - 1]);
  const closed = e.closed || Math.hypot(s[0][0] - s[s.length - 1][0], s[0][1] - s[s.length - 1][1]) < 1e-6;
  if (closed) s.pop();
  return s.length >= 2 ? [{ t: 'spline', pts: s, closed }] : [];
}

export class ProjectTool extends Tool {
  get toolId() { return this.opts.offset ? 'offsetEdge' : 'project'; }
  get allowsSelection() { return false; }

  start() {
    this.items = this.app.sel.filter((s) => s.type === 'edge' || s.type === 'face');
    if (!this.items.length) throw new Error('Jelölj ki éleket vagy lapokat a vetítéshez');
    this.offset = this.opts.offset ? (this.app.lastEdgeOffset || 2) : 0;
    this.construction = !this.opts.offset;
    // célsík: az első kijelölt sík lap síkja, különben a rácssík
    const f = this.items.find((s) => s.type === 'face');
    const fi = f ? faceInfo(this.app, f.bodyId, f.index) : null;
    this.frame = fi && fi.type === 'PLANE' ? canonicalFrame(V3(fi.normal), V3(fi.center)) : this.app.vp.gridFrame;
    this.frameLabel = fi && fi.type === 'PLANE' ? 'a kijelölt lap síkja' : 'rácssík';
    this.ready = this.collect();
  }

  async collect() {
    const edgeSet = new Map();
    for (const s of this.items) {
      if (s.type === 'edge') edgeSet.set(`${s.bodyId}:${s.index}`, s);
      else {
        const ids = await this.app.kernel.query('faceEdges', { body: refOf(this.app, s.bodyId), faces: [s.index] });
        for (const i of ids) edgeSet.set(`${s.bodyId}:${i}`, { bodyId: s.bodyId, index: i });
      }
    }
    this.edges = [...edgeSet.values()];
    this.refreshPanel();
    this.previewCurves();
  }

  curves() {
    let out = [];
    for (const e of this.edges || []) out.push(...projectEdge(this.app, e.bodyId, e.index, this.frame));
    if (Math.abs(this.offset) > 1e-9) out = offsetCurves(orderChain(out), this.offset);
    return out;
  }

  previewCurves() {
    if (!this.prev) this.prev = new PreviewLines(this.app, 0xf0c05a, 2.4);
    this.prev.set(this.frame, this.curves());
  }

  stop() { super.stop(); if (this.prev) this.prev.dispose(); }

  tap(ev) {
    const it = this.app.pickItem(ev);
    const pl = planeFromSel(this.app, it);
    if (pl) {
      this.frame = canonicalFrame(pl.normal, pl.origin);
      this.frameLabel = pl.label;
      this.refreshPanel();
      this.previewCurves();
    }
    return true;
  }

  panel() {
    return {
      title: this.opts.offset ? 'Él eltolás' : 'Vetítés vázlatba', icon: this.opts.offset ? 'offsetCurve' : 'project',
      items: [
        { type: 'info', text: `${this.edges ? this.edges.length : '…'} él → ${this.frameLabel} (koppints másik síkra)` },
        { type: 'number', key: 'offset', label: 'Eltolás', kind: 'len', value: this.offset },
        { type: 'toggle', key: 'construction', label: 'Segédvonalként', value: this.construction },
      ],
      doneDisabled: !this.edges || !this.edges.length,
    };
  }

  change(k, v) {
    if (k === 'offset') this.offset = v;
    if (k === 'construction') this.construction = v;
    this.refreshPanel();
    this.previewCurves();
  }

  async done() {
    if (this.ready) await this.ready;
    const cs = this.curves().map((c) => ({ ...c, ...(this.construction ? { construction: true } : {}) }));
    if (!cs.length) { this.app.ui.toast('Nincs vetíthető él', 'error'); return; }
    if (this.opts.offset) this.app.lastEdgeOffset = Math.abs(this.offset);
    this.app.addCurves(this.frame, cs, this.opts.offset ? 'Él eltolás' : 'Vetítés', this.opts.offset ? 'offsetCurve' : 'project');
    this.app.setTool(null);
  }
}

/** Görbék lánc-sorrendbe rendezése (az eltolt vonalak csatlakoztatásához). */
function orderChain(curves) {
  if (curves.length < 3 || curves.some((c) => c.t !== 'line')) return curves;
  const rest = curves.slice(1);
  const out = [curves[0]];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
  while (rest.length) {
    const end = out[out.length - 1].b;
    let i = rest.findIndex((c) => close(c.a, end));
    if (i >= 0) { out.push(rest.splice(i, 1)[0]); continue; }
    i = rest.findIndex((c) => close(c.b, end));
    if (i >= 0) { const c = rest.splice(i, 1)[0]; out.push({ ...c, a: c.b, b: c.a }); continue; }
    out.push(...rest.splice(0));
  }
  // irány: a lánc legyen óramutatóval ellentétes, így a pozitív eltolás befelé mutat
  let area = 0;
  for (const c of out) area += c.a[0] * c.b[1] - c.b[0] * c.a[1];
  return area < 0 ? out.reverse().map((c) => ({ ...c, a: c.b, b: c.a })) : out;
}

// ---------------------------------------------------------------- illesztés (Align)
export class AlignTool extends Tool {
  get toolId() { return 'align'; }
  get allowsSelection() { return false; }

  start() {
    const f = this.app.sel.find((s) => s.type === 'face');
    if (!f) throw new Error('Jelölj ki egy lapot a mozgatandó testen');
    this.src = f;
    this.srcInfo = faceInfo(this.app, f.bodyId, f.index);
    if (!this.srcInfo || this.srcInfo.type !== 'PLANE') throw new Error('Sík lapot jelölj ki');
    this.center = true;
    this.flip = true;
    this.offset = 0;
    this.target = null;
    this.refreshPanel();
  }

  tap(ev) {
    const it = this.app.pickItem(ev);
    if (!it || (it.bodyId && it.bodyId === this.src.bodyId)) return true;
    const pl = planeFromSel(this.app, it);
    if (!pl) return true;
    let center = pl.origin;
    if (it.type === 'face') { const fi = faceInfo(this.app, it.bodyId, it.index); if (fi) center = V3(fi.center); }
    this.target = { ...pl, center };
    this.preview();
    this.refreshPanel();
    return true;
  }

  matrix() {
    const n1 = V3(this.srcInfo.normal), c1 = V3(this.srcInfo.center);
    const n2 = this.target.normal.clone().normalize();
    const want = this.flip ? n2.clone().negate() : n2.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(n1, want);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const c1r = c1.clone().sub(c1).applyMatrix4(R).add(c1); // forgatás a lap középpontja körül
    let dest;
    if (this.center) dest = this.target.center.clone();
    else {
      // csak a síkra illesztés: a lap középpontjának vetülete a célsíkra
      const d = c1r.clone().sub(this.target.origin).dot(n2);
      dest = c1r.clone().addScaledVector(n2, -d);
    }
    dest.addScaledVector(n2, this.offset);
    const T1 = new THREE.Matrix4().makeTranslation(-c1.x, -c1.y, -c1.z);
    const T2 = new THREE.Matrix4().makeTranslation(dest.x, dest.y, dest.z);
    return T2.multiply(R).multiply(T1);
  }

  preview() {
    const g = this.app.bodies.gfx.get(this.src.bodyId);
    if (!g || !this.target) return;
    g.group.matrixAutoUpdate = false;
    g.group.matrix.copy(this.matrix());
    g.group.matrixWorldNeedsUpdate = true;
    this.app.vp.requestRender();
  }

  stop() {
    super.stop();
    const g = this.app.bodies.gfx.get(this.src.bodyId);
    if (g) { g.group.matrix.identity(); g.group.matrixAutoUpdate = true; }
    this.app.vp.requestRender();
  }

  panel() {
    return {
      title: 'Illesztés', icon: 'align',
      items: [
        { type: 'info', text: this.target ? `Cél: ${this.target.label}` : 'Koppints a cél lapra (másik testen) vagy síkra' },
        { type: 'toggle', key: 'center', label: 'Középpontok egybe', value: this.center },
        { type: 'toggle', key: 'flip', label: 'Szembefordítva', value: this.flip },
        { type: 'number', key: 'offset', label: 'Távolság', kind: 'len', value: this.offset },
      ],
      doneDisabled: !this.target,
    };
  }

  change(k, v) { this[k] = v; this.preview(); this.refreshPanel(); }

  async done() {
    if (!this.target) return;
    const e = this.matrix().elements;
    const m = [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
    try {
      const res = await this.app.kernel.op('transform', { bodies: [refOf(this.app, this.src.bodyId)], matrix: m, copy: false }, true);
      const g = this.app.bodies.gfx.get(this.src.bodyId);
      if (g) { g.group.matrix.identity(); g.group.matrixAutoUpdate = true; }
      await this.app.commitKernelResult('Illesztés', res, { icon: 'align' });
      this.app.setTool(null);
    } catch (err) { this.app.ui.toast(err.message, 'error'); }
  }
}

// ---------------------------------------------------------------- szerkesztőtengely
export class AxisTool extends Tool {
  get toolId() { return 'axis'; }
  get allowsSelection() { return false; }

  start() {
    this.pts = [];
    this.axis = axisFromItem(this.app, this.app.sel[0]);
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xf0c05a, dashSize: 3, gapSize: 2, depthTest: false }));
    this.line.renderOrder = 22;
    this.app.vp.overlayScene.add(this.line);
    this.update();
  }

  stop() { super.stop(); this.app.vp.overlayScene.remove(this.line); this.line.geometry.dispose(); this.line.material.dispose(); this.app.vp.requestRender(); }

  tap(ev) {
    const it = this.app.pickItem(ev, { vertices: true });
    const ax = axisFromItem(this.app, it);
    if (ax) { this.axis = ax; this.pts = []; this.update(); return true; }
    const snaps = this.app.picker.snapPoints(ev.x, ev.y, ev.pointerType === 'touch' ? 24 : 14);
    const p = snaps.length ? snaps[0].p : (it && it.point ? V3(it.point) : null);
    if (!p) return true;
    this.pts = this.pts.length >= 2 ? [p] : [...this.pts, p];
    if (this.pts.length === 2) this.axis = { origin: this.pts[0].clone(), dir: this.pts[1].clone().sub(this.pts[0]).normalize(), label: '2 pont' };
    this.update();
    return true;
  }

  update() {
    if (this.axis) {
      const L = Math.max(50, this.app.vp.sceneRadius * 2);
      this.line.geometry.setFromPoints([this.axis.origin.clone().addScaledVector(this.axis.dir, -L), this.axis.origin.clone().addScaledVector(this.axis.dir, L)]);
      this.line.computeLineDistances();
      this.line.visible = true;
    } else this.line.visible = false;
    this.app.vp.requestRender();
    this.refreshPanel();
  }

  panel() {
    return {
      title: 'Szerkesztőtengely', icon: 'axis',
      items: [{ type: 'info', text: this.axis ? `Tengely: ${this.axis.label}` : 'Koppints egy egyenes élre, hengeres lapra, vagy két csúcsra' }],
      doneDisabled: !this.axis,
    };
  }

  done() {
    if (!this.axis) return;
    const st = this.app.doc.state;
    const n = (st.counters.axis || 0) + 1;
    const ax = { id: uid('ax'), name: `Tengely ${n}`, origin: this.axis.origin.toArray(), dir: this.axis.dir.toArray() };
    this.app.doc.commit('Szerkesztőtengely', { ...st, axes: [...(st.axes || []), ax], counters: { ...st.counters, axis: n } }, { icon: 'axis' });
    this.app.setTool(null);
  }
}

export { fmtLen, planeToJSON, planeFromJSON, toWorld, ArrowHandle };
