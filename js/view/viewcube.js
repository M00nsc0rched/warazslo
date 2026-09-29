// Nézetkocka a jobb felső sarokban
import * as THREE from 'three';

const LABELS = ['JOBB', 'BAL', 'HÁTUL', 'ELÖL', 'FELÜL', 'ALUL'];

function faceTexture(text, rot = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#4a4a55');
  grd.addColorStop(1, '#383841');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  g.translate(128, 128);
  g.rotate(rot);
  g.fillStyle = '#f2f2f6';
  g.font = `600 ${text.length > 5 ? 50 : 56}px -apple-system, "SF Pro Text", "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class ViewCube {
  constructor(viewport, slotEl) {
    this.vp = viewport;
    this.slot = slotEl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    const rots = [Math.PI / 2, -Math.PI / 2, Math.PI, 0, 0, Math.PI];
    this.materials = LABELS.map((l, i) => new THREE.MeshBasicMaterial({ map: faceTexture(l, 0) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.materials);
    this.scene.add(this.cube);
    // élek
    const eg = new THREE.EdgesGeometry(this.cube.geometry);
    this.scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x9a9aa8 })));
    // tengelyek a sarokból
    const o = new THREE.Vector3(-0.5, -0.5, -0.5);
    const axis = (d, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(d, 1.35)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
    };
    this.scene.add(axis(new THREE.Vector3(1, 0, 0), 0xe5484d), axis(new THREE.Vector3(0, 1, 0), 0x46a758), axis(new THREE.Vector3(0, 0, 1), 0x3e8ef7));
    // kiemelő
    this.hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2bb8f0, transparent: true, opacity: 0.45, depthTest: false }));
    this.hl.visible = false;
    this.scene.add(this.hl);
    viewport.on('afterRender', () => this.render());
  }

  rect() {
    const r = this.slot.getBoundingClientRect();
    const c = this.vp.rect || this.vp.canvas.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }

  contains(x, y) {
    const r = this.rect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  render() {
    const r = this.rect();
    if (r.w < 4) return;
    const q = this.vp.quat;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    this.camera.position.copy(back).multiplyScalar(5);
    this.camera.quaternion.copy(q);
    const s = 1.05;
    this.camera.left = -s; this.camera.right = s; this.camera.top = s; this.camera.bottom = -s;
    this.camera.updateProjectionMatrix();
    const R = this.vp.renderer;
    const H = this.vp.height;
    R.setScissorTest(true);
    R.setScissor(r.x, H - r.y - r.h, r.w, r.h);
    R.setViewport(r.x, H - r.y - r.h, r.w, r.h);
    R.clearDepth();
    R.render(this.scene, this.camera);
    R.setScissorTest(false);
    R.setViewport(0, 0, this.vp.width, H);
  }

  /** Képernyő pont -> nézetirány (vagy null). */
  hitDirection(x, y) {
    const r = this.rect();
    const nx = ((x - r.x) / r.w) * 2 - 1;
    const ny = -((y - r.y) / r.h) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = rc.intersectObject(this.cube, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const m = 0.5 - 0.17;
    const d = new THREE.Vector3(Math.abs(p.x) > m ? Math.sign(p.x) : 0, Math.abs(p.y) > m ? Math.sign(p.y) : 0, Math.abs(p.z) > m ? Math.sign(p.z) : 0);
    if (d.lengthSq() === 0) return null;
    return d;
  }

  hover(x, y) {
    const d = x == null ? null : this.hitDirection(x, y);
    if (!d) { if (this.hl.visible) { this.hl.visible = false; this.vp.requestRender(); } return; }
    const n = (Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z));
    const sx = d.x ? 0.34 : 1.02, sy = d.y ? 0.34 : 1.02, sz = d.z ? 0.34 : 1.02;
    this.hl.scale.set(n === 1 ? (d.x ? 0.06 : 0.66) : sx, n === 1 ? (d.y ? 0.06 : 0.66) : sy, n === 1 ? (d.z ? 0.06 : 0.66) : sz);
    this.hl.position.set(d.x * (n === 1 ? 0.52 : 0.34), d.y * (n === 1 ? 0.52 : 0.34), d.z * (n === 1 ? 0.52 : 0.34));
    this.hl.visible = true;
    this.vp.requestRender();
  }

  /** Koppintás a kockán: a nézet átfordul. */
  tap(x, y) {
    const d = this.hitDirection(x, y);
    if (!d) return null;
    // felül/alul nézetben a képernyő felfelé iránya +Y, egyébként +Z
    const upv = d.x === 0 && d.y === 0 ? new THREE.Vector3(0, 1, 0) : null;
    this.vp.setViewDirection(d.clone().normalize(), true, upv);
    return d;
  }
}
