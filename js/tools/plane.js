// Szerkesztősíkok: eltolt, 3 ponton át, felező
import * as THREE from 'three';
import { Tool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { planeFromSel, MAIN_PLANES } from './common.js';
import { canonicalFrame, planeToJSON } from '../sketch/manager.js';
import { uid } from '../util/misc.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class PlaneTool extends Tool {
  get toolId() { return 'plane'; }
  get allowsSelection() { return false; }

  start() {
    this.mode = this.opts.mode || 'offset';
    this.offset = 10;
    this.pts = [];
    this.faces = [];
    const sp = planeFromSel(this.app, this.app.sel[0]);
    this.base = sp ? { origin: sp.origin, normal: sp.normal, label: sp.label } : { origin: V(), normal: V(0, 0, 1), label: 'XY' };
    this.prev = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xf0c05a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    this.prev.renderOrder = 3;
    this.app.vp.helperGroup.add(this.prev);
    if (this.mode === 'offset') this.makeHandle();
    this.updatePreview();
  }

  stop() { super.stop(); this.app.vp.helperGroup.remove(this.prev); this.prev.geometry.dispose(); this.prev.material.dispose(); this.app.vp.requestRender(); }

  makeHandle() {
    this.clearHandles();
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: this.base.origin, dir: this.base.normal, value: this.offset,
      onChange: (v) => { this.offset = v; this.updatePreview(); this.refreshPanel(); },
      onTap: () => this.app.ui.keypad({ label: 'Eltolás', kind: 'len', value: this.offset, onDone: (v) => { this.offset = v; this.arrow.setValue(v); this.updatePreview(); this.refreshPanel(); } }),
    }));
  }

  frame() {
    if (this.mode === 'offset') {
      const o = this.base.origin.clone().addScaledVector(this.base.normal, this.offset);
      const f = canonicalFrame(this.base.normal, o);
      f.origin = o;
      return f;
    }
    if (this.mode === 'three' && this.pts.length === 3) {
      const [a, b, c] = this.pts;
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.lengthSq() < 1e-12) return null;
      const f = canonicalFrame(n.normalize(), a);
      f.origin = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      return f;
    }
    if (this.mode === 'mid' && this.faces.length === 2) {
      const [p, q] = this.faces;
      if (Math.abs(Math.abs(p.normal.dot(q.normal)) - 1) > 1e-4) return null;
      const o = p.origin.clone().add(q.origin).multiplyScalar(0.5);
      const f = canonicalFrame(p.normal, o);
      f.origin = o;
      return f;
    }
    return null;
  }

  updatePreview() {
    const f = this.frame();
    this.prev.visible = !!f;
    if (f) {
      const s = Math.max(40, this.app.vp.sceneRadius * 1.2);
      const m = new THREE.Matrix4().makeBasis(f.xDir, f.yDir, f.normal);
      m.setPosition(f.origin);
      this.prev.matrixAutoUpdate = false;
      this.prev.matrix.copy(m).multiply(new THREE.Matrix4().makeScale(s, s, 1));
      this.prev.matrixWorldNeedsUpdate = true;
    }
    this.app.vp.requestRender();
  }

  tap(ev) {
    if (this.mode === 'offset' || this.mode === 'mid') {
      const it = this.app.pickItem(ev);
      const pl = planeFromSel(this.app, it);
      if (!pl) return true;
      if (this.mode === 'offset') { this.base = pl; this.makeHandle(); }
      else { this.faces = [...this.faces.slice(-1), pl]; }
    } else {
      const snaps = this.app.picker.snapPoints(ev.x, ev.y, ev.pointerType === 'touch' ? 24 : 14);
      let p = snaps.length ? snaps[0].p.clone() : null;
      if (!p) { const h = this.app.picker.raycastBodies(ev.x, ev.y); p = h ? h.point : null; }
      if (!p) return true;
      if (this.pts.length >= 3) this.pts = [];
      this.pts.push(p);
    }
    this.updatePreview();
    this.refreshPanel();
    return true;
  }

  panel() {
    const hints = { offset: `Alap: ${this.base.label} – koppints másik lapra / síkra`, three: `${this.pts.length}/3 pont – koppints csúcsokra`, mid: `${this.faces.length}/2 párhuzamos lap` };
    return {
      title: 'Szerkesztősík', icon: 'planeOffset',
      items: [
        { type: 'info', text: hints[this.mode] },
        { type: 'chips', key: 'mode', value: this.mode, options: [{ value: 'offset', label: 'Eltolt' }, { value: 'three', label: '3 pont' }, { value: 'mid', label: 'Felező' }] },
        { type: 'chips', key: 'main', value: null, hidden: this.mode !== 'offset', options: ['XY', 'XZ', 'YZ'].map((k) => ({ value: k, label: k })) },
        { type: 'number', key: 'offset', label: 'Eltolás', kind: 'len', value: this.offset, hidden: this.mode !== 'offset' },
      ],
      doneDisabled: !this.frame(),
    };
  }

  change(k, v) {
    if (k === 'mode') { this.mode = v; this.clearHandles(); if (v === 'offset') this.makeHandle(); }
    if (k === 'main') { this.base = { origin: V(), normal: MAIN_PLANES[v].normal.clone(), label: v }; this.makeHandle(); }
    if (k === 'offset') { this.offset = v; this.arrow && this.arrow.setValue(v); }
    this.updatePreview();
    this.refreshPanel();
  }

  done() {
    const f = this.frame();
    if (!f) return;
    const st = this.app.doc.state;
    const n = (st.counters.plane || 0) + 1;
    const pl = { id: uid('pl'), name: `Sík ${n}`, ...planeToJSON(f), size: Math.max(40, this.app.vp.sceneRadius * 1.2) };
    this.app.doc.commit('Szerkesztősík', { ...st, planes: [...st.planes, pl], counters: { ...st.counters, plane: n } }, { icon: 'plane' });
    this.app.setTool(null);
  }
}
