// Érintés / Apple Pencil / egér / trackpad kezelés és navigáció
import * as THREE from 'three';

const TAP_MS = 320;
const DOUBLE_TAP_MS = 330;
const MOVE_TOL = { touch: 9, pen: 5, mouse: 4 };

export class InputController {
  /**
   * handler: {
   *   down(ev) -> bool (elkapja-e), move(ev), up(ev), cancel(ev), tap(ev), doubleTap(ev), hover(ev),
   *   pivotAt(x,y) -> THREE.Vector3|null, undoGesture(), redoGesture(), fingerDraws() -> bool
   * }
   */
  constructor(viewport, viewCube, handler) {
    this.vp = viewport;
    this.cube = viewCube;
    this.h = handler;
    this.ptrs = new Map();
    this.session = null;       // érintés-munkamenet (több ujjas koppintások felismerése)
    this.lastTap = null;
    this.penActiveUntil = 0;
    this.sawPen = false;
    const c = viewport.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e, false));
    c.addEventListener('pointercancel', (e) => this._up(e, true));
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.ptrs.has(e.pointerId)) { this.h.hover && this.h.hover(null); this.cube.hover(null); } });
    c.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari trackpad csípés
    c.addEventListener('gesturestart', (e) => { e.preventDefault(); this._gScale = 1; });
    c.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const s = this._gScale / e.scale;
      this._gScale = e.scale;
      const rect = this.vp.rect;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this.vp.zoomAt(s, this._pivot(x, y));
    });
    c.addEventListener('gestureend', (e) => e.preventDefault());
    // iOS: dupla koppintásos nagyítás és görgetés tiltása
    document.addEventListener('touchmove', (e) => { if (e.target === c) e.preventDefault(); }, { passive: false });
  }

  _ev(e, p) {
    const rect = this.vp.rect || this.vp.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      x0: p ? p.x0 : e.clientX - rect.left, y0: p ? p.y0 : e.clientY - rect.top,
      pointerType: e.pointerType || 'mouse', pressure: e.pressure, button: e.button, buttons: e.buttons,
      shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, time: e.timeStamp, id: e.pointerId,
      moved: p ? p.moved : false, original: e,
    };
  }

  _pivot(x, y) {
    return (this.h.pivotAt && this.h.pivotAt(x, y)) || this.vp.pointAtTargetDepth(x, y);
  }

  _touchCount() {
    let n = 0;
    for (const p of this.ptrs.values()) if (p.type === 'touch') n++;
    return n;
  }

  _down(e) {
    const c = this.vp.canvas;
    if (this.vp.autoRotate) { this.vp.setAutoRotate(false); this.h.autoRotateStopped && this.h.autoRotateStopped(); }
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    c.focus({ preventScroll: true });
    const type = e.pointerType || 'mouse';
    if (type === 'pen') { this.sawPen = true; this.penActiveUntil = e.timeStamp + 1500; }
    const rect = this.vp.rect || c.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const p = { id: e.pointerId, type, x, y, x0: x, y0: y, lx: x, ly: y, t0: e.timeStamp, moved: false, mode: null, button: e.button };
    this.ptrs.set(e.pointerId, p);

    if (type === 'touch') {
      // tollhasználat közben a tenyér érintéseit figyelmen kívül hagyjuk
      if (this._penDown()) { p.mode = 'ignore'; return; }
      if (!this.session) this.session = { max: 0, t0: e.timeStamp, moved: false, ids: new Set() };
      this.session.ids.add(e.pointerId);
      const n = this._touchCount();
      this.session.max = Math.max(this.session.max, n);
      if (n === 1) {
        if (this.cube.contains(x, y)) { p.mode = 'cube'; return; }
        const ev = this._ev(e, p);
        if (this.h.down(ev)) { p.mode = 'app'; return; }
        p.mode = 'pending';
      } else {
        // második ujj: az egyujjas művelet megszakítása, két ujjas navigáció
        for (const q of this.ptrs.values()) {
          if (q.type !== 'touch' || q === p) continue;
          if (q.mode === 'app') this.h.cancel && this.h.cancel(this._ev(e, q));
          q.mode = 'multi';
        }
        p.mode = 'multi';
        this._startMulti();
      }
      return;
    }

    // toll vagy egér
    if (this.cube.contains(x, y)) { p.mode = 'cube'; return; }
    if (type === 'mouse' && (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey))) {
      p.mode = e.button === 1 || (e.button === 2 && e.shiftKey) ? 'pan' : 'orbit';
      p.pivot = this._pivot(x, y);
      return;
    }
    const ev = this._ev(e, p);
    if (this.h.down(ev)) { p.mode = 'app'; return; }
    p.mode = type === 'mouse' ? 'pending-mouse' : 'pending-pen';
  }

  _penDown() {
    for (const p of this.ptrs.values()) if (p.type === 'pen') return true;
    return false;
  }

  _startMulti() {
    const pts = [...this.ptrs.values()].filter((q) => q.type === 'touch' && q.mode === 'multi');
    if (pts.length < 2) return;
    const [a, b] = pts;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.multi = { cx, cy, dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), rollAcc: 0, rolling: false, pivot: this._pivot(cx, cy), ids: [a.id, b.id] };
  }

  _move(e) {
    const p = this.ptrs.get(e.pointerId);
    const rect = this.vp.rect || this.vp.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!p) {
      // lebegés (Pencil hover / egér)
      if (e.pointerType !== 'touch') {
        if (this.cube.contains(x, y)) { this.cube.hover(x, y); this.h.hover && this.h.hover(null); }
        else { this.cube.hover(null); this.h.hover && this.h.hover(this._ev(e, null)); }
      }
      return;
    }
    if (e.pointerType === 'pen') this.penActiveUntil = e.timeStamp + 1500;
    const tol = MOVE_TOL[p.type] || 5;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > tol) {
      p.moved = true;
      if (this.session && p.type === 'touch') this.session.moved = true;
    }
    const dx = x - p.lx, dy = y - p.ly;
    p.x = x; p.y = y;

    switch (p.mode) {
      case 'app': this.h.move(this._ev(e, p)); break;
      case 'pending':
        if (p.moved) {
          p.mode = 'orbit';
          p.pivot = this._pivot(p.x0, p.y0);
          this.vp.orbit(x - p.x0, y - p.y0, p.pivot);
        }
        break;
      case 'orbit': this.vp.orbit(dx, dy, p.pivot); break;
      case 'pan': this.vp.pan(dx, dy, p.pivot); break;
      case 'pending-mouse':
        if (p.moved) { p.mode = 'orbit'; p.pivot = this._pivot(p.x0, p.y0); this.vp.orbit(x - p.x0, y - p.y0, p.pivot); }
        break;
      case 'multi': this._moveMulti(); break;
      case 'cube': break;
      default: break;
    }
    p.lx = x; p.ly = y;
  }

  _moveMulti() {
    const m = this.multi;
    if (!m) return;
    const a = this.ptrs.get(m.ids[0]), b = this.ptrs.get(m.ids[1]);
    if (!a || !b) return;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const s = m.dist / dist;
    if (Math.abs(s - 1) > 1e-4) this.vp.zoomAt(s, m.pivot);
    this.vp.pan(cx - m.cx, cy - m.cy, m.pivot);
    // két ujjas csavarás: körkörös forgatás a nézési tengely körül (kis holtjátékkal)
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    let da = ang - m.ang;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    m.ang = ang;
    if (!m.rolling) {
      m.rollAcc += da;
      if (Math.abs(m.rollAcc) > 0.12) { m.rolling = true; da = m.rollAcc; }
    }
    if (m.rolling && Math.abs(da) > 1e-5) this.vp.roll(da, m.pivot);
    m.cx = cx; m.cy = cy; m.dist = dist;
  }

  _up(e, cancelled) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    try { this.vp.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* */ }
    const ev = this._ev(e, p);
    const quick = e.timeStamp - p.t0 < TAP_MS;

    if (p.mode === 'app') {
      if (cancelled) this.h.cancel && this.h.cancel(ev);
      else this.h.up(ev);
    } else if (p.mode === 'cube') {
      if (!p.moved && !cancelled) this.cube.tap(ev.x, ev.y);
    } else if (p.mode === 'pending' || p.mode === 'pending-mouse' || p.mode === 'pending-pen') {
      if (!p.moved && !cancelled && (quick || p.type !== 'touch')) this._tap(ev);
    } else if (p.mode === 'multi') {
      this._startMulti();
    }

    if (p.type === 'touch' && this.session) {
      this.session.ids.delete(e.pointerId);
      if (this._touchCount() === 0) {
        const s = this.session;
        this.session = null;
        this.multi = null;
        const dur = e.timeStamp - s.t0;
        if (!s.moved && !cancelled && dur < 400) {
          if (s.max === 2) this.h.undoGesture && this.h.undoGesture();
          else if (s.max === 3) this.h.redoGesture && this.h.redoGesture();
        }
      }
    }
  }

  _tap(ev) {
    const last = this.lastTap;
    if (last && ev.time - last.time < DOUBLE_TAP_MS && Math.hypot(ev.x - last.x, ev.y - last.y) < 28 && last.pointerType === ev.pointerType) {
      this.lastTap = null;
      this.h.doubleTap && this.h.doubleTap(ev);
      return;
    }
    this.lastTap = ev;
    this.h.tap(ev);
  }

  _wheel(e) {
    e.preventDefault();
    const rect = this.vp.rect;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      // csípés (trackpad) vagy egérgörgő: nagyítás a kurzor felé
      const s = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015));
      this.vp.zoomAt(s, this._pivot(x, y));
    } else if (e.shiftKey) {
      this.vp.pan(-dx, -dy, this._pivot(x, y));
    } else {
      // két ujjas trackpad görgetés: forgatás (mint a Shapr3D-ben)
      if (!this._wheelPivot || e.timeStamp - this._wheelT > 300) this._wheelPivot = this._pivot(x, y);
      this._wheelT = e.timeStamp;
      this.vp.orbit(-dx * 0.6, -dy * 0.6, this._wheelPivot);
    }
  }
}
