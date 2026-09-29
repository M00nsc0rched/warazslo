// Mérés: távolság, szög, hossz, terület, sugár, térfogat
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Tool, escapeHtml } from './base.js';
import { faceInfo, edgeInfo, refOf, V3 } from './common.js';
import { fmtLen, fmtAngle, fmtArea, fmtVolume, fmtMass } from '../util/units.js';
import { curvePolyline, dist } from '../sketch/geom2d.js';
import { planeFromJSON, toWorld } from '../sketch/manager.js';

const NAMES = { face: 'Lap', edge: 'Él', vertex: 'Csúcs', body: 'Test', region: 'Régió', curve: 'Görbe', spoint: 'Pont' };
const SURF = { PLANE: 'sík', CYLINDRE: 'henger', CONE: 'kúp', SPHERE: 'gömb', TORUS: 'tórusz', BSPLINE_SURFACE: 'szabadformájú', REVOLUTION: 'forgási' };

export class MeasureTool extends Tool {
  get toolId() { return 'measure'; }
  get allowsSelection() { return false; }
  get pickVertices() { return true; }

  start() {
    this.items = [];
    this.rows = [];
    this.line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: 0xffd60a, linewidth: 2.2, worldUnits: false, depthTest: false, transparent: true }));
    this.line.renderOrder = 26;
    this.line.visible = false;
    this.app.vp.overlayScene.add(this.line);
    this.app.clearSelection();
    this.refreshPanel();
  }

  stop() {
    super.stop();
    this.app.vp.overlayScene.remove(this.line);
    this.line.geometry.dispose(); this.line.material.dispose();
    this.app.clearSelection();
  }

  tap(ev) {
    const it = this.app.pickItem(ev, { vertices: true, regions: true });
    if (!it) { this.items = []; this.app.clearSelection(); this.measure(); return true; }
    if (this.items.length >= 2) this.items = [];
    this.items.push(it);
    this.app.setSelection(this.items.map((x) => (x.type === 'vertex' ? { ...x } : x)));
    this.measure();
    return true;
  }

  worldPoint(it) {
    if (it.type === 'spoint' || it.type === 'curve' || it.type === 'region') return it.world ? it.world.clone() : null;
    if (it.point) return V3(it.point);
    return null;
  }

  entity(it) {
    if (it.type === 'face') return { kind: 'face', body: refOf(this.app, it.bodyId), index: it.index };
    if (it.type === 'edge') return { kind: 'edge', body: refOf(this.app, it.bodyId), index: it.index };
    if (it.type === 'vertex') return { kind: 'point', point: it.point };
    if (it.type === 'body') return { kind: 'body', body: refOf(this.app, it.bodyId) };
    const p = this.worldPoint(it);
    return p ? { kind: 'point', point: p.toArray() } : null;
  }

  describe(it) {
    const rows = [];
    if (it.type === 'face') {
      const f = faceInfo(this.app, it.bodyId, it.index);
      if (f) {
        rows.push([`${NAMES.face} (${SURF[f.type] || f.type.toLowerCase()})`, fmtArea(f.area || 0)]);
        if (f.radius) rows.push(['Sugár / átmérő', `${fmtLen(f.radius)} / Ø ${fmtLen(f.radius * 2)}`]);
      }
    } else if (it.type === 'edge') {
      const e = edgeInfo(this.app, it.bodyId, it.index);
      if (e) {
        rows.push(['Él hossza', fmtLen(e.length)]);
        if (e.radius) rows.push(['Sugár / átmérő', `${fmtLen(e.radius)} / Ø ${fmtLen(e.radius * 2)}`]);
      }
    } else if (it.type === 'vertex') {
      rows.push(['Csúcs', it.point.map((x) => fmtLen(x, { unit: false })).join('; ')]);
    } else if (it.type === 'body') {
      const g = this.app.bodies.gfx.get(it.bodyId);
      const v = g && g.data.volume;
      if (v) {
        rows.push(['Térfogat', fmtVolume(v)]);
        const dens = this.app.settings.density || 1.24;
        rows.push([`Tömeg (${this.app.settings.material || ''})`, fmtMass((v / 1000) * dens)]);
        const b = g.bbox;
        rows.push(['Méret', `${fmtLen(b.max.x - b.min.x, { unit: false })} × ${fmtLen(b.max.y - b.min.y, { unit: false })} × ${fmtLen(b.max.z - b.min.z)}`]);
      }
    } else if (it.type === 'curve') {
      const sk = this.app.doc.sketch(it.sketchId);
      const c = sk && sk.curves.find((x) => x.id === it.curveId);
      if (c) {
        const pl = curvePolyline(c);
        let L = 0;
        for (let i = 1; i < pl.length; i++) L += dist(pl[i], pl[i - 1]);
        rows.push(['Görbe hossza', fmtLen(L)]);
        if (c.r) rows.push(['Sugár', fmtLen(c.r)]);
      }
    } else if (it.type === 'region') {
      const r = this.app.sketches.regionByKey(it.sketchId, it.key);
      if (r) rows.push(['Régió területe', fmtArea(r.area)]);
    } else if (it.type === 'spoint') {
      rows.push(['Pont', it.world.toArray().map((x) => fmtLen(x, { unit: false })).join('; ')]);
    }
    return rows;
  }

  async measure() {
    this.rows = [];
    this.line.visible = false;
    for (const it of this.items) this.rows.push(...this.describe(it));
    if (this.items.length === 2) {
      const [a, b] = this.items;
      const ea = this.entity(a), eb = this.entity(b);
      // szög: két sík lap vagy két egyenes él
      const na = this.direction(a), nb = this.direction(b);
      if (na && nb) {
        let ang = THREE.MathUtils.radToDeg(na.angleTo(nb));
        if (a.type === 'edge' || b.type === 'edge') ang = Math.min(ang, 180 - ang);
        this.rows.push(['Szög', fmtAngle(ang)]);
      }
      if (ea && eb) {
        try {
          const seq = (this.seq = (this.seq || 0) + 1);
          const r = await this.app.kernel.query('distance', { a: ea, b: eb });
          if (seq !== this.seq || this.app.tool !== this) return;
          this.rows.push(['Távolság', fmtLen(r.distance)]);
          const d = [r.p2[0] - r.p1[0], r.p2[1] - r.p1[1], r.p2[2] - r.p1[2]];
          this.rows.push(['ΔX / ΔY / ΔZ', d.map((x) => fmtLen(Math.abs(x), { unit: false })).join(' / ')]);
          if (r.distance > 1e-9) {
            this.line.geometry.dispose();
            this.line.geometry = new LineSegmentsGeometry();
            this.line.geometry.setPositions([...r.p1, ...r.p2]);
            this.line.material.resolution.set(this.app.vp.width, this.app.vp.height);
            this.line.visible = true;
          }
        } catch (e) { this.rows.push(['Távolság', 'nem mérhető']); }
      }
    }
    this.refreshPanel();
    this.app.vp.requestRender();
  }

  direction(it) {
    if (it.type === 'face') { const f = faceInfo(this.app, it.bodyId, it.index); return f && f.type === 'PLANE' && f.normal ? V3(f.normal) : null; }
    if (it.type === 'edge') { const e = edgeInfo(this.app, it.bodyId, it.index); return e && e.type === 'LINE' ? V3(e.dir) : null; }
    if (it.type === 'curve') {
      const sk = this.app.doc.sketch(it.sketchId);
      const c = sk && sk.curves.find((x) => x.id === it.curveId);
      if (c && c.t === 'line') { const f = planeFromJSON(sk.plane); return toWorld(f, c.b).sub(toWorld(f, c.a)).normalize(); }
    }
    return null;
  }

  panel() {
    const html = this.rows.length
      ? `<div class="measure-card">${this.rows.map(([k, v]) => `<div class="mrow"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>`
      : 'Koppints egy vagy két elemre (csúcs, él, lap, test, vázlat)';
    return { title: 'Mérés', icon: 'measure', items: [{ type: 'info', html }], cancel: false, doneLabel: 'Bezárás' };
  }

  done() { this.app.setTool(null); }
}
