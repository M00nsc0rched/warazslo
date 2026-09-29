// Testek megjelenítése: árnyalt háló, élek, kiemelések, előnézet
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const ACCENT = new THREE.Color('#2bb8f0');
const HOVER = new THREE.Color('#8fd9ff');

/** Egy test renderelhető reprezentációja (a kernel hálóadataiból). */
export class BodyGfx {
  constructor(id, mesh, color) {
    this.id = id;
    this.data = mesh;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    this.geo = geo;
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color || '#c3c7ea'), roughness: 0.5, metalness: 0.04,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.bodyId = id;

    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(mesh.lines, 3));
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x14141c, transparent: true, opacity: 0.75 });
    this.edges = new THREE.LineSegments(eg, this.edgeMaterial);
    this.edges.userData.bodyId = id;
    this.edges.raycast = () => {};

    this.group = new THREE.Group();
    this.group.add(this.mesh, this.edges);
    this.group.userData.bodyId = id;

    // háromszög -> lap index
    const nt = mesh.triangles.length / 3;
    this.triFace = new Int32Array(nt).fill(-1);
    const fg = mesh.faceGroups;
    this.faceRanges = new Map();
    for (let i = 0; i < fg.length; i += 3) {
      const start = fg[i], count = fg[i + 1], face = fg[i + 2];
      for (let t = start / 3; t < (start + count) / 3; t++) this.triFace[t] = face;
      this.faceRanges.set(face, [start, count]);
    }
    // él index -> szakasz csúcs-tartomány
    const eg2 = mesh.edgeGroups;
    this.edgeRanges = new Map();
    for (let i = 0; i < eg2.length; i += 3) this.edgeRanges.set(eg2[i + 2], [eg2[i], eg2[i + 1]]);
    this.bbox = geo.boundingBox.clone();
  }

  setColor(c) { this.material.color.set(c); }

  faceOfTriangle(t) { return this.triFace[t] ?? -1; }

  /** Egy lap háromszögeit tartalmazó geometria (kiemeléshez). */
  faceGeometry(face) {
    const r = this.faceRanges.get(face);
    if (!r) return null;
    const idx = this.data.triangles.subarray(r[0], r[0] + r[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.geo.getAttribute('position'));
    g.setAttribute('normal', this.geo.getAttribute('normal'));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    return g;
  }

  /** A lap határoló szakaszai (körvonal kiemeléshez). */
  faceOutline(face) {
    const r = this.faceRanges.get(face);
    if (!r) return null;
    const tri = this.data.triangles;
    const pos = this.data.vertices;
    const count = new Map();
    const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let i = r[0]; i < r[0] + r[1]; i += 3) {
      const a = tri[i], b = tri[i + 1], c = tri[i + 2];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const k = key(p, q);
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
    const out = [];
    for (const [k, n] of count) {
      if (n !== 1) continue;
      const [a, b] = k.split('_').map(Number);
      out.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    return out;
  }

  /** Él szakaszai lapos tömbként. */
  edgeSegments(edge) {
    const r = this.edgeRanges.get(edge);
    if (!r) return null;
    return Array.from(this.data.lines.subarray(r[0] * 3, (r[0] + r[1]) * 3));
  }

  dispose() {
    this.geo.dispose();
    this.edges.geometry.dispose();
    this.material.dispose();
    this.edgeMaterial.dispose();
  }
}

function thickLines(positions, color, width, opacity = 1, depthTest = true) {
  const g = new LineSegmentsGeometry();
  g.setPositions(positions);
  const m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, depthTest, worldUnits: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
  const l = new LineSegments2(g, m);
  l.renderOrder = 5;
  l.raycast = () => {};
  return l;
}

export class BodiesView {
  constructor(viewport) {
    this.vp = viewport;
    this.gfx = new Map();          // bodyId -> BodyGfx (aktuális)
    this.cacheByKey = new Map();   // "id@rev" -> mesh data (LRU)
    this.previewGfx = [];          // előnézeti objektumok
    this.hiddenByPreview = new Set();
    this.highlightGroup = new THREE.Group();
    this.hoverGroup = new THREE.Group();
    viewport.scene.add(this.highlightGroup, this.hoverGroup);
    this.lineMaterials = new Set();
    this.displayMode = 'shadedEdges';
    this.clipPlanes = [];
    viewport.on('resize', () => this._updateResolution());
  }

  _updateResolution() {
    const w = this.vp.width, h = this.vp.height;
    this.vp.scene.traverse((o) => { if (o.material && o.material.isLineMaterial) o.material.resolution.set(w, h); });
    this.vp.overlayScene.traverse((o) => { if (o.material && o.material.isLineMaterial) o.material.resolution.set(w, h); });
  }

  cacheMesh(id, rev, mesh) {
    const k = `${id}@${rev}`;
    this.cacheByKey.delete(k);
    this.cacheByKey.set(k, mesh);
    while (this.cacheByKey.size > 200) this.cacheByKey.delete(this.cacheByKey.keys().next().value);
  }

  getCachedMesh(id, rev) { return this.cacheByKey.get(`${id}@${rev}`) || null; }

  /**
   * Szinkronizálás a dokumentummal. list: [{id, rev, color, visible, mesh}]
   */
  sync(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let g = this.gfx.get(b.id);
      if (g && g.rev !== b.rev) { this.vp.bodiesGroup.remove(g.group); g.dispose(); g = null; this.gfx.delete(b.id); }
      if (!g && b.mesh) {
        g = new BodyGfx(b.id, b.mesh, b.color);
        g.rev = b.rev;
        this.gfx.set(b.id, g);
        this.vp.bodiesGroup.add(g.group);
        this._applyMode(g);
      }
      if (g) {
        g.setColor(b.color);
        g.group.visible = b.visible && !this.hiddenByPreview.has(b.id);
        g.visibleFlag = b.visible;
      }
    }
    for (const [id, g] of this.gfx) {
      if (!seen.has(id)) { this.vp.bodiesGroup.remove(g.group); g.dispose(); this.gfx.delete(id); }
    }
    this.vp.requestRender();
  }

  bounds({ visibleOnly = true } = {}) {
    const box = new THREE.Box3();
    for (const g of this.gfx.values()) {
      if (visibleOnly && !g.visibleFlag) continue;
      box.union(g.bbox);
    }
    for (const p of this.previewGfx) box.union(p.bbox);
    return box;
  }

  // ---------------------------------------------------------------- megjelenítési mód
  setDisplayMode(mode) {
    this.displayMode = mode;
    for (const g of this.gfx.values()) this._applyMode(g);
    for (const g of this.previewGfx) this._applyMode(g, true);
    this.vp.requestRender();
  }

  _applyMode(g, preview = false) {
    const m = this.displayMode;
    g.mesh.visible = m !== 'wire';
    g.edges.visible = m !== 'shaded';
    g.material.transparent = m === 'xray' || preview === 'ghost';
    g.material.opacity = m === 'xray' ? 0.28 : preview === 'ghost' ? 0.45 : 1;
    g.material.depthWrite = !(m === 'xray');
    g.edgeMaterial.color.set(m === 'wire' || m === 'xray' ? 0xc9cdf0 : 0x14141c);
    g.edgeMaterial.opacity = m === 'wire' || m === 'xray' ? 0.9 : 0.75;
    g.mesh.castShadow = m !== 'xray';
    g.material.clippingPlanes = this.clipPlanes.length ? this.clipPlanes : null;
    g.edgeMaterial.clippingPlanes = this.clipPlanes.length ? this.clipPlanes : null;
    g.material.needsUpdate = true;
    g.edgeMaterial.needsUpdate = true;
  }

  setClipPlanes(planes) {
    this.clipPlanes = planes || [];
    for (const g of this.gfx.values()) this._applyMode(g);
    for (const g of this.previewGfx) this._applyMode(g, true);
    this.vp.requestRender();
  }

  // ---------------------------------------------------------------- előnézet
  /**
   * results: kernel op eredmények [{role, sourceId, mesh}], removed: [ids]
   * A módosított/eltávolított testeket elrejti és az előnézetet mutatja helyettük.
   */
  showPreview(results, removed = [], { ghostSources = false } = {}) {
    this.clearPreview(false);
    this.highlightGroup.visible = false;
    for (const r of results) {
      if (r.role === 'modified' && r.sourceId) this.hiddenByPreview.add(r.sourceId);
      const g = new BodyGfx('__preview', r.mesh, this._previewColor(r));
      g.material.emissive = new THREE.Color(r.role === 'new' ? '#0b3550' : '#000000');
      g.material.emissiveIntensity = 0.6;
      this.previewGfx.push(g);
      this.vp.previewGroup.add(g.group);
      this._applyMode(g, true);
    }
    for (const id of removed) this.hiddenByPreview.add(id);
    for (const id of this.hiddenByPreview) {
      const g = this.gfx.get(id);
      if (!g) continue;
      if (ghostSources) { g.group.visible = g.visibleFlag; this._applyMode(g, 'ghost'); }
      else g.group.visible = false;
    }
    this.vp.requestRender();
  }

  _previewColor(r) {
    if (r.sourceId && this.gfx.get(r.sourceId)) return '#' + this.gfx.get(r.sourceId).material.color.getHexString();
    return '#c3c7ea';
  }

  clearPreview(render = true) {
    this.highlightGroup.visible = true;
    for (const g of this.previewGfx) { this.vp.previewGroup.remove(g.group); g.dispose(); }
    this.previewGfx = [];
    for (const id of this.hiddenByPreview) {
      const g = this.gfx.get(id);
      if (g) { g.group.visible = g.visibleFlag; this._applyMode(g); }
    }
    this.hiddenByPreview.clear();
    if (render) this.vp.requestRender();
  }

  // ---------------------------------------------------------------- kiemelések
  _clearGroup(grp) {
    for (const o of [...grp.children]) {
      grp.remove(o);
      o.geometry && o.geometry.dispose();
      o.material && o.material.dispose();
    }
  }

  /** sel: [{type:'face'|'edge'|'body'|'vertex', bodyId, index, point?}] */
  setSelection(sel) { this._highlight(this.highlightGroup, sel, false); }
  setHover(item) { this._highlight(this.hoverGroup, item ? [item] : [], true); }

  _highlight(grp, items, hover) {
    this._clearGroup(grp);
    const w = this.vp.width, h = this.vp.height;
    const col = hover ? HOVER : ACCENT;
    for (const it of items) {
      const g = this.gfx.get(it.bodyId);
      if (!g || !g.group.visible) continue;
      if (it.type === 'face') {
        const fg = g.faceGeometry(it.index);
        if (fg) {
          const m = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: hover ? 0.18 : 0.32, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
            clippingPlanes: this.clipPlanes.length ? this.clipPlanes : null,
          }));
          m.renderOrder = 4;
          m.raycast = () => {};
          grp.add(m);
        }
        const ol = g.faceOutline(it.index);
        if (ol && ol.length) {
          const l = thickLines(ol, col, hover ? 1.6 : 2.6);
          l.material.resolution.set(w, h);
          grp.add(l);
        }
      } else if (it.type === 'edge') {
        const seg = g.edgeSegments(it.index);
        if (seg) {
          const l = thickLines(seg, col, hover ? 3 : 4.2);
          l.material.resolution.set(w, h);
          grp.add(l);
        }
      } else if (it.type === 'body') {
        const m = new THREE.Mesh(g.geo, new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: hover ? 0.12 : 0.22, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        m.raycast = () => {};
        m.renderOrder = 4;
        grp.add(m);
        const l = thickLines(Array.from(g.data.lines), col, hover ? 1.4 : 2);
        l.material.resolution.set(w, h);
        grp.add(l);
      } else if (it.type === 'vertex' && it.point) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
        s.position.set(...it.point);
        s.userData.screenSize = hover ? 5 : 6;
        s.renderOrder = 10;
        grp.add(s);
      }
    }
    this.vp.requestRender();
  }

  /** Képernyőn állandó méretű elemek skálázása (renderelés előtt hívandó). */
  updateScreenSized() {
    for (const grp of [this.highlightGroup, this.hoverGroup]) {
      for (const o of grp.children) {
        if (o.userData.screenSize) o.scale.setScalar(this.vp.worldPerPixel(o.position) * o.userData.screenSize);
      }
    }
  }
}
