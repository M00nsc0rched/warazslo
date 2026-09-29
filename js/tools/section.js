// Metszeti nézet (vágósík)
import * as THREE from 'three';
import { Tool } from './base.js';
import { ArrowHandle } from '../view/handles.js';
import { planeFromSel, MAIN_PLANES } from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class SectionTool extends Tool {
  get toolId() { return 'section'; }
  get allowsSelection() { return false; }

  start() {
    const st = this.app.sectionState;
    const selPlane = planeFromSel(this.app, this.app.sel[0]);
    if (st && !selPlane) {
      this.base = { origin: st.origin.clone(), normal: st.normal.clone() };
      this.main = st.main;
      this.offset = st.offset;
      this.flip = st.flip;
    } else {
      this.main = selPlane ? null : 'XZ';
      this.base = selPlane ? { origin: selPlane.origin, normal: selPlane.normal } : this.mainBase('XZ');
      this.offset = 0;
      this.flip = false;
    }
    this.makeHandle();
    this.apply();
  }

  mainBase(k) {
    const c = this.app.bodies.bounds().isEmpty() ? V() : this.app.bodies.bounds().getCenter(V());
    return { origin: c, normal: MAIN_PLANES[k].normal.clone() };
  }

  makeHandle() {
    this.clearHandles();
    this.arrow = this.addHandle(new ArrowHandle(this.app.handles, {
      origin: this.base.origin, dir: this.base.normal, value: this.offset, color: 0xffd60a,
      onChange: (v) => { this.offset = v; this.apply(); },
      onTap: () => this.app.ui.keypad({ label: 'Metszet helye', kind: 'len', value: this.offset, onDone: (v) => { this.offset = v; this.arrow.setValue(v); this.apply(); } }),
    }));
  }

  plane() {
    const n = this.base.normal.clone().multiplyScalar(this.flip ? 1 : -1);
    const p = this.base.origin.clone().addScaledVector(this.base.normal, this.offset);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
  }

  apply() {
    this.app.bodies.setClipPlanes([this.plane()]);
    this.app.sectionActive = true;
    this.app.sectionState = { origin: this.base.origin.clone(), normal: this.base.normal.clone(), main: this.main, offset: this.offset, flip: this.flip };
    this.refreshPanel();
  }

  tap(ev) {
    const it = this.app.pickItem(ev, { sketches: true });
    const pl = planeFromSel(this.app, it);
    if (pl) { this.base = { origin: pl.origin, normal: pl.normal }; this.main = null; this.offset = 0; this.makeHandle(); this.apply(); }
    return true;
  }

  panel() {
    return {
      title: 'Metszeti nézet', icon: 'section',
      items: [
        { type: 'info', text: 'Koppints egy lapra, vagy válassz síkot; húzd a sárga nyilat' },
        { type: 'chips', key: 'main', value: this.main, options: ['XY', 'XZ', 'YZ'].map((k) => ({ value: k, label: k })) },
        { type: 'number', key: 'offset', label: 'Hely', kind: 'len', value: this.offset },
        { type: 'button', key: 'flip', label: 'Oldalcsere', icon: 'rotate' },
        { type: 'button', key: 'off', label: 'Kikapcsolás', icon: 'eyeOff', style: 'danger' },
      ],
      doneLabel: 'Bekapcsolva hagy', cancel: false,
    };
  }

  change(k, v) {
    if (k === 'main') { this.main = v; this.base = this.mainBase(v); this.offset = 0; this.makeHandle(); }
    if (k === 'offset') { this.offset = v; this.arrow.setValue(v); }
    if (k === 'flip') this.flip = !this.flip;
    if (k === 'off') { this.turnOff(); return; }
    this.apply();
  }

  turnOff() {
    this.app.bodies.setClipPlanes([]);
    this.app.sectionActive = false;
    this.app.sectionState = null;
    this.app.setTool(null);
  }

  done() { this.app.setTool(null); }
}
