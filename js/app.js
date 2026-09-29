// Warázsló – az alkalmazás központi vezérlője
import * as THREE from 'three';
import { Viewport } from './view/viewport.js';
import { BodiesView } from './view/bodies.js';
import { Picker, pickTolerance } from './view/picking.js';
import { ViewCube } from './view/viewcube.js';
import { InputController } from './view/input.js';
import { HandleManager } from './view/handles.js';
import { KernelClient } from './kernel/client.js';
import { DocumentStore, emptyState, newBodyId, newSketchId, BODY_COLORS } from './doc/document.js';
import * as storage from './doc/storage.js';
import { SketchManager, canonicalFrame, planeToJSON, planeFromJSON, toLocal, toWorld, samePlane } from './sketch/manager.js';
import { UI } from './ui/ui.js';
import { Emitter, uid, debounce, el } from './util/misc.js';
import { setUnit } from './util/units.js';
import { buildLeftToolbar, buildRightToolbar, createTool, selectionSummary } from './tools/index.js';
import { HomeScreen } from './ui/home.js';
import { FreehandCapture } from './sketch/freehand.js';
import { PointDrag } from './sketch/edit.js';
import * as sheets from './ui/sheets.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class App extends Emitter {
  async init() {
    this.settings = storage.loadSettings();
    setUnit(this.settings.units);
    this.ui = new UI(this);
    this.vp = new Viewport(document.getElementById('viewport'));
    this.bodies = new BodiesView(this.vp);
    this.bodies.setDisplayMode(this.settings.display);
    this.vp.shadows = this.settings.shadows;
    this.picker = new Picker(this.vp, this.bodies);
    this.handles = new HandleManager(this.vp, document.getElementById('overlay'));
    this.kernel = new KernelClient((id, rev) => (this.doc ? this.doc.findBrep(id, rev) : null));
    this.kernel.on('busy', (b) => this.ui.setBusy(b));
    this.kernel.on('restart', (msg) => this.ui.toast(msg, 'error', 4500));
    this.sketches = new SketchManager(this);
    this.sel = [];
    this.tool = null;
    this.isolated = null;
    this.doc = null;
    this.mode = 'model';
    this.vp.setOrtho(!this.settings.perspective);
    this.vp.on('beforeRender', () => this.bodies.updateScreenSized());

    const slot = this.ui.renderRight(buildRightToolbar(this));
    this.cube = new ViewCube(this.vp, slot);
    this.input = new InputController(this.vp, this.cube, this._inputHandler());
    this.home = new HomeScreen(this);
    this._setupKeyboard();
    this._saveDebounced = debounce(() => this.saveNow(false), 1200);
    this.ui.root.classList.toggle('hide-labels', !this.settings.showLabels);
    document.getElementById('app').classList.toggle('hide-labels', !this.settings.showLabels);
    window.addEventListener('beforeunload', () => { if (this.doc && this.doc.dirty) this.saveNow(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.doc && this.doc.dirty) this.saveNow(true); });

    storage.requestPersistence();
    this.kernelReady = this.kernel.start();
    this.kernelReady.then(() => this.emit('kernel-ready')).catch((e) => {
      this.ui.toast(`A CAD kernel nem töltődött be: ${e.message}`, 'error', 8000);
    });
    await this.home.show();
  }

  // ================================================================ projektek
  async newProject(name) {
    const list = await storage.listProjects();
    const n = list.length + 1;
    const p = { id: uid('p'), name: name || `Projekt ${n}`, state: emptyState(), view: { hidden: [] } };
    await storage.saveProject(p);
    await this.openProject(p.id);
  }

  async openProject(id) {
    const p = await storage.loadProject(id);
    if (!p) { this.ui.toast('A projekt nem található', 'error'); return; }
    this.setTool(null);
    this.clearSelection();
    this.mode = 'model';
    this.vp.gridVisible = true;
    this.vp.setAutoRotate(false);
    this.ui.setStatus(null);
    if (this.doc) this.doc = null;
    const doc = new DocumentStore(p);
    this.doc = doc;
    this.projectCreated = p.created;
    this.ui.setTitle(doc.name);
    doc.on('change', (e) => this._onDocChange(e));
    this.home.hide();
    this.ui.setStatus(this.kernel.readyPromise ? null : 'CAD kernel betöltése…');
    // elmentett hálók: azonnali megjelenítés a kernel nélkül
    const cached = await storage.getMeshes(p.id, doc.state.bodies);
    for (const [k, m] of cached) { const [id, rev] = k.split("@"); this.bodies.cacheMesh(id, +rev, m); }
    if (cached.size < doc.state.bodies.length) {
      try {
        await this.kernelReady;
      } catch (e) { /* hibaüzenet már ment */ }
    }
    this.ui.setStatus(null);
    await this._syncScene(true);
    this.vp.fitBox(this.bodies.bounds(), false);
    if (doc.view.camera) this._restoreCamera(doc.view.camera);
    this.updateToolbar();
  }

  async goHome() {
    this.setTool(null);
    if (this.doc) {
      await this.saveNow(true);
      storage.pruneMeshes(this.doc.projectId, this.doc.state.bodies);
    }
    this.doc = null;
    this.clearSelection();
    this.bodies.sync([]);
    this.sketches.sync(emptyState(), []);
    await this.home.show();
  }

  async saveNow(withThumb = true) {
    const doc = this.doc;
    if (!doc) return;
    this._saveDebounced.cancel();
    const rec = {
      id: doc.projectId, name: doc.name, created: this.projectCreated,
      state: doc.state, view: { ...doc.view, camera: this._cameraState() },
    };
    if (withThumb || !this._lastThumb) {
      try { this._lastThumb = this.makeThumbnail(); } catch (e) { /* */ }
    }
    rec.thumb = this._lastThumb || null;
    try {
      await storage.saveProject(rec);
      doc.dirty = false;
      this.ui.setDirty(false);
    } catch (e) {
      this.ui.toast(`Mentési hiba: ${e.message}`, 'error', 5000);
    }
  }

  makeThumbnail() {
    const sel = this.sel;
    this.bodies.setSelection([]);
    this.bodies.setHover(null);
    const url = this.vp.snapshot({ width: 400, height: 300, hideGrid: true });
    this._applySelectionVisuals(sel);
    return url;
  }

  _cameraState() {
    const vp = this.vp;
    return { target: vp.target.toArray(), distance: vp.distance, quat: vp.quat.toArray(), ortho: vp.useOrtho };
  }

  _restoreCamera(c) {
    try {
      this.vp.target.fromArray(c.target);
      this.vp.distance = c.distance;
      this.vp.quat.fromArray(c.quat);
      this.vp._applyCamera();
    } catch (e) { /* */ }
  }

  async renameProjectDialog() {
    if (!this.doc) return;
    const name = await this.ui.prompt('Projekt átnevezése', this.doc.name);
    if (!name) return;
    this.doc.name = name;
    this.doc.dirty = true;
    this.ui.setTitle(name);
    this.saveNow(false);
  }

  projectMenu(anchor) { sheets.projectMenu(this, anchor); }

  // ================================================================ dokumentum szinkron
  async _onDocChange(e) {
    this.ui.setDirty(true);
    if (e.kind !== 'view') {
      // tartalmi változás után a kijelölés elavulhat
      this.pruneSelection();
    }
    await this._syncScene(false);
    this.updateToolbar();
    this._saveDebounced();
    if (this.ui.sheetOpen()) this.ui.refreshSheet();
    this.emit('doc-change', e);
  }

  async _syncScene(initial) {
    const doc = this.doc;
    if (!doc) return;
    const seq = (this._syncSeq = (this._syncSeq || 0) + 1);
    const st = doc.state;
    const missing = st.bodies.filter((b) => !this.bodies.getCachedMesh(b.id, b.rev));
    if (missing.length) {
      try {
        const res = await this.kernel.mesh(missing.map((b) => ({ id: b.id, rev: b.rev, brep: b.brep })));
        for (const r of res) { this.bodies.cacheMesh(r.id, r.rev, r.mesh); storage.putMesh(doc.projectId, r.id, r.rev, r.mesh); }
      } catch (e) {
        this.ui.toast(`Háló hiba: ${e.message}`, 'error', 5000);
      }
    }
    if (seq !== this._syncSeq || doc !== this.doc) return;
    const hidden = doc.view.hidden || [];
    const iso = this.isolated;
    this.bodies.sync(st.bodies.map((b) => ({
      id: b.id, rev: b.rev, color: b.color,
      visible: !hidden.includes(b.id) && (!iso || iso.has(b.id)),
      mesh: this.bodies.getCachedMesh(b.id, b.rev),
    })));
    this.sketches.sync(st, iso ? [...hidden, ...st.sketches.map((s) => s.id).filter((id) => !iso.has(id))] : hidden);
    this._syncPlanes();
    this._syncImages();
    this.vp.updateSceneBounds(this.bodies.bounds());
    this._applySelectionVisuals();
  }

  _syncPlanes() {
    if (!this._planeGroup) { this._planeGroup = new THREE.Group(); this.vp.helperGroup.add(this._planeGroup); }
    const g = this._planeGroup;
    for (const o of [...g.children]) { g.remove(o); o.traverse((x) => { x.geometry && x.geometry.dispose(); x.material && x.material.dispose(); }); }
    const hidden = this.doc.view.hidden || [];
    for (const p of this.doc.state.planes) {
      if (hidden.includes(p.id)) continue;
      const f = planeFromJSON(p);
      const s = p.size || 60;
      const sel = this.sel.some((x) => x.type === 'plane' && x.planeId === p.id);
      const geo = new THREE.PlaneGeometry(s, s);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: sel ? 0x2bb8f0 : 0xf0c05a, transparent: true, opacity: sel ? 0.28 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: sel ? 0x2bb8f0 : 0xf0c05a, transparent: true, opacity: 0.8 }));
      const grp = new THREE.Group();
      grp.add(mesh, edges);
      const m = new THREE.Matrix4().makeBasis(f.xDir, f.yDir, f.normal);
      m.setPosition(f.origin);
      grp.matrixAutoUpdate = false;
      grp.matrix.copy(m);
      grp.userData.planeId = p.id;
      mesh.userData.planeId = p.id;
      g.add(grp);
    }
    this.vp.requestRender();
  }

  /** Referencia képek (textúrázott síkok) szinkronizálása. */
  _syncImages() {
    if (!this._imageGroup) { this._imageGroup = new THREE.Group(); this.vp.helperGroup.add(this._imageGroup); this._imageTex = new Map(); }
    const g = this._imageGroup;
    for (const o of [...g.children]) { g.remove(o); o.geometry.dispose(); o.material.dispose(); }
    const hidden = this.doc.view.hidden || [];
    const imgs = this.doc.state.images || [];
    const alive = new Set(imgs.map((i) => i.id));
    for (const [id, t] of this._imageTex) if (!alive.has(id)) { t.dispose(); this._imageTex.delete(id); }
    for (const im of imgs) {
      if (hidden.includes(im.id)) continue;
      let tex = this._imageTex.get(im.id);
      if (!tex || tex.userData.src !== im.dataUrl) {
        tex = new THREE.TextureLoader().load(im.dataUrl, () => this.vp.requestRender());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.userData.src = im.dataUrl;
        this._imageTex.set(im.id, tex);
      }
      const f = planeFromJSON(im.plane);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(im.w, im.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: im.opacity ?? 0.6, side: THREE.DoubleSide, depthWrite: false }));
      const m = new THREE.Matrix4().makeBasis(f.xDir, f.yDir, f.normal);
      m.setPosition(f.origin.clone().addScaledVector(f.normal, -0.01));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m).multiply(new THREE.Matrix4().makeTranslation(im.w / 2, im.h / 2, 0));
      mesh.renderOrder = -1;
      mesh.raycast = () => {};
      g.add(mesh);
    }
    this.vp.requestRender();
  }

  setIsolation(ids) {
    this.isolated = ids && ids.size ? ids : null;
    this._syncScene(false);
    this.updateToolbar();
  }

  // ================================================================ kijelölés
  static selKey(it) {
    switch (it.type) {
      case 'face': case 'edge': case 'vertex': return `${it.type}:${it.bodyId}:${it.index}`;
      case 'body': return `body:${it.bodyId}`;
      case 'region': return `region:${it.sketchId}:${it.key}`;
      case 'curve': return `curve:${it.sketchId}:${it.curveId}`;
      case 'spoint': return `spoint:${it.sketchId}:${it.p[0].toFixed(6)},${it.p[1].toFixed(6)}`;
      case 'sketch': return `sketch:${it.sketchId}`;
      case 'plane': return `plane:${it.planeId}`;
      default: return JSON.stringify(it);
    }
  }

  isSelected(it) { const k = App.selKey(it); return this.sel.some((s) => App.selKey(s) === k); }

  setSelection(items) {
    const seen = new Set();
    this.sel = items.filter((it) => { const k = App.selKey(it); if (seen.has(k)) return false; seen.add(k); return true; });
    this._applySelectionVisuals();
    this.updateToolbar();
    if (this.tool) this.tool.onSelectionChange();
    this.emit('selection');
  }

  toggleSelect(it) {
    const k = App.selKey(it);
    if (this.sel.some((s) => App.selKey(s) === k)) this.setSelection(this.sel.filter((s) => App.selKey(s) !== k));
    else this.setSelection([...this.sel, it]);
  }

  clearSelection() { if (this.sel.length) this.setSelection([]); else this._applySelectionVisuals(); }

  pruneSelection() {
    const st = this.doc.state;
    const ok = this.sel.filter((it) => {
      if (it.bodyId) { const b = st.bodies.find((x) => x.id === it.bodyId); return b && (it.type === 'body' || b.rev === it.rev); }
      if (it.sketchId) {
        const s = st.sketches.find((x) => x.id === it.sketchId);
        if (!s) return false;
        if (it.type === 'region') return this.sketches.regions(s).some((r) => r.key === it.key);
        if (it.type === 'curve') return s.curves.some((c) => c.id === it.curveId);
        return it.type === 'sketch';
      }
      if (it.planeId) return st.planes.some((p) => p.id === it.planeId);
      return false;
    });
    if (ok.length !== this.sel.length) this.setSelection(ok);
  }

  _applySelectionVisuals(sel = this.sel) {
    this.bodies.setSelection(sel.filter((s) => ['face', 'edge', 'body', 'vertex'].includes(s.type)));
    const sk = this.sketches;
    sk.selRegions = new Set(sel.filter((s) => s.type === 'region').map((s) => `${s.sketchId}|${s.key}`));
    const curves = new Set(sel.filter((s) => s.type === 'curve').map((s) => `${s.sketchId}|${s.curveId}`));
    for (const s of sel.filter((x) => x.type === 'sketch')) {
      const sketch = this.doc && this.doc.sketch(s.sketchId);
      if (sketch) for (const c of sketch.curves) curves.add(`${s.sketchId}|${c.id}`);
    }
    sk.selCurves = curves;
    sk.selPoints = sel.filter((s) => s.type === 'spoint').map((s) => ({ sketchId: s.sketchId, p: s.p }));
    if (this.doc) sk.refreshHighlights();
    if (this.doc && this.doc.state.planes.length) this._syncPlanes();
    const sum = selectionSummary(this, sel);
    this.ui.setSelectionInfo(sum.text);
  }

  /** Koppintás alatti elem (egységes kiválasztási logika). */
  pickItem(ev, opts = {}) {
    if (!this.doc) return null;
    const tol = pickTolerance(ev.pointerType);
    const bp = this.picker.pick(ev.x, ev.y, { pointerType: ev.pointerType, vertices: opts.vertices, edges: opts.edges !== false, faces: opts.faces !== false });
    const surfDepth = bp.hit ? bp.hit.distance : null;
    let sk = opts.sketches === false ? null : this.sketches.pick(ev.x, ev.y, tol, { maxDepth: surfDepth, regions: opts.regions !== false });
    // vázlatpont csak pontos koppintásra nyer (egyébként a régió/görbe a gyakoribb szándék)
    if (sk && sk.type === 'spoint' && sk.score > 0.45) {
      const alt = this.sketches.pick(ev.x, ev.y, tol, { maxDepth: surfDepth, regions: opts.regions !== false, points: false });
      if (alt) sk = alt;
    }
    const body = (id) => this.doc.body(id);
    const mk = (p) => {
      const b = body(p.bodyId);
      return { type: p.type, bodyId: p.bodyId, index: p.index, rev: b ? b.rev : 0, point: p.point, normal: p.normal };
    };
    if (sk && sk.type === 'spoint' && opts.points !== false) return { type: 'spoint', sketchId: sk.sketchId, p: sk.p, world: sk.world };
    if (sk && sk.type === 'curve') return { type: 'curve', sketchId: sk.sketchId, curveId: sk.curveId, point: sk.point, world: sk.world };
    if (bp.type === 'vertex' || bp.type === 'edge') return mk(bp);
    if (sk && sk.type === 'region') return { type: 'region', sketchId: sk.sketchId, key: sk.key, world: sk.world };
    // szerkesztősíkok
    const pl = this._pickPlane(ev, surfDepth);
    if (pl) return pl;
    if (bp.type === 'face') return mk(bp);
    return null;
  }

  _pickPlane(ev, maxDepth) {
    if (!this._planeGroup || !this._planeGroup.children.length) return null;
    const rc = this.vp.raycaster(ev.x, ev.y);
    const meshes = [];
    this._planeGroup.children.forEach((g) => { g.updateMatrixWorld(true); meshes.push(g.children[0]); });
    const hits = rc.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    if (maxDepth != null && h.distance > maxDepth + 1e-3) {
      // a sík a felület mögött van: csak ha a széléhez közel koppintottak, egyébként a lap nyer
      return null;
    }
    return { type: 'plane', planeId: h.object.userData.planeId, point: h.point.toArray() };
  }

  // ================================================================ eszközök
  setTool(tool) {
    if (this.tool) {
      const t = this.tool;
      this.tool = null;
      try { t.stop(); } catch (e) { console.error(e); }
    }
    this.ui.closeKeypad();
    this.tool = tool;
    this.bodies.setHover(null);
    if (tool) {
      try { tool.start(); } catch (e) { console.error(e); this.ui.toast(e.message, 'error'); this.tool = null; }
    }
    if (this.tool) {
      const p = this.tool.panel();
      if (p) this.ui.showPanel(p, { change: (k, v) => this.tool && this.tool.change(k, v), done: () => this.tool && this.tool.done(), cancel: () => this.tool && this.tool.cancel() });
      else this.ui.hidePanel();
    } else {
      this.ui.hidePanel();
    }
    this.updateToolbar();
    this.vp.requestRender();
  }

  /** Munkaterület: 'model' (modellezés) | 'view' (csak megtekintés) */
  setMode(mode) {
    if (this.mode === mode) return;
    this.setTool(null);
    this.mode = mode;
    const view = mode === 'view';
    this.vp.gridVisible = !view;
    if (!view) this.vp.setAutoRotate(false);
    this.ui.setStatus(view ? 'Nézet mód – csak megtekintés' : null, 'info');
    clearTimeout(this._modePill);
    if (view) this._modePill = setTimeout(() => { if (this.mode === 'view') this.ui.setStatus(null); }, 2500);
    this.updateToolbar();
    this.vp.requestRender();
  }

  startTool(id, opts) {
    if (!this.doc) return;
    if (this.mode === 'view' && !['measure', 'section'].includes(id)) return;
    try {
      const t = createTool(this, id, opts);
      if (t) this.setTool(t);
    } catch (e) {
      this.ui.toast(e.message || String(e), 'error', 3500);
    }
  }

  updateToolbar() {
    if (!this.doc) return;
    this.ui.renderLeft(buildLeftToolbar(this));
  }

  // ================================================================ kernel műveletek véglegesítése
  /**
   * Egy kernel művelet eredményének beépítése a dokumentumba.
   * opts: { runner, icon, after(state) -> state, preview: már kész előnézeti eredmény }
   */
  async commitOp(label, opName, args, opts = {}) {
    let res = null;
    if (opts.runner) {
      await opts.runner.idle();
      res = opts.runner.resultFor(args);
    }
    if (!res) res = await this.kernel.op(opName, args, true);
    return this.commitKernelResult(label, res, opts);
  }

  async commitKernelResult(label, res, opts = {}) {
    const doc = this.doc;
    const assign = res.results.map((r) => ({ handle: r.handle, id: r.role === 'modified' ? r.sourceId : newBodyId(), rev: doc.nextRev() }));
    const fin = assign.length ? await this.kernel.finalize(assign) : [];
    fin.forEach((f) => { this.bodies.cacheMesh(f.id, f.rev, f.mesh); storage.putMesh(doc.projectId, f.id, f.rev, f.mesh); });
    const results = res.results.map((r, i) => ({ role: r.role, sourceId: r.sourceId, name: r.name, id: assign[i].id, rev: assign[i].rev, brep: fin[i].brep }));
    let state = doc.applyKernelResults(doc.state, results, res.removed || []);
    if (opts.after) state = opts.after(state, results) || state;
    this.bodies.clearPreview(false);
    this.sel = [];
    doc.commit(label, state, { icon: opts.icon });
    this._applySelectionVisuals();
    return results;
  }

  undo() {
    if (!this.doc) return;
    if (this.tool) { this.setTool(null); return; }
    const l = this.doc.undo();
    if (l) this.ui.toast(`Visszavonva: ${l}`, '', 1400);
  }

  redo() {
    if (!this.doc) return;
    if (this.tool) this.setTool(null);
    const l = this.doc.redo();
    if (l) this.ui.toast(`Újra: ${l}`, '', 1400);
  }

  // ================================================================ vázlat segédek
  /** Vázlatsík a képernyőpont alatt: sík lap, szerkesztősík vagy az aktív rácssík. */
  sketchFrameAt(ev) {
    const hit = this.picker.raycastBodies(ev.x, ev.y);
    // meglévő látható vázlat síkja, ha előbb van mint a felület
    if (hit && hit.face >= 0) {
      const g = this.bodies.gfx.get(hit.bodyId);
      const fi = g && g.data.faces ? g.data.faces[hit.face] : null;
      if (fi && fi.type === 'PLANE' && fi.normal) {
        const n = V(...fi.normal);
        return { frame: canonicalFrame(n, V(...fi.center)), onFace: { bodyId: hit.bodyId, face: hit.face } };
      }
    }
    const pl = this._pickPlane(ev, hit ? hit.distance : null);
    if (pl) return { frame: planeFromJSON(this.doc.plane(pl.planeId)) };
    const gf = this.vp.gridFrame;
    return { frame: canonicalFrame(gf.normal, gf.origin) };
  }

  /** Vázlat keresése/létrehozása a síkon; visszaadja a (esetleg új) állapotot és a vázlatot. */
  ensureSketch(state, frame) {
    for (const s of state.sketches) {
      if ((this.doc.view.hidden || []).includes(s.id)) continue;
      if (samePlane(planeFromJSON(s.plane), frame)) return { state, sketch: s, frame: planeFromJSON(s.plane) };
    }
    const n = (state.counters.sketch || 0) + 1;
    const sketch = { id: newSketchId(), name: `Vázlat ${n}`, plane: planeToJSON(frame), curves: [] };
    return { state: { ...state, sketches: [...state.sketches, sketch], counters: { ...state.counters, sketch: n } }, sketch, frame };
  }

  /** Görbék hozzáadása egy vázlathoz (a görbék a megadott keret koordinátáiban). */
  addCurves(frame, curves, label = 'Vázlat', icon = 'sketch') {
    if (!curves.length) return null;
    const { state, sketch, frame: sf } = this.ensureSketch(this.doc.state, frame);
    const conv = convertCurves(curves, frame, sf);
    const withIds = conv.map((c) => ({ ...c, id: c.id || uid('c') }));
    const ns = { ...sketch, curves: [...sketch.curves, ...withIds] };
    const newState = { ...state, sketches: state.sketches.map((s) => (s.id === sketch.id ? ns : s)) };
    this.doc.commit(label, newState, { icon });
    return { sketchId: sketch.id, curves: withIds };
  }

  updateSketch(sketchId, fn, label, icon = 'sketch', replace = false) {
    const st = this.doc.state;
    const s = st.sketches.find((x) => x.id === sketchId);
    if (!s) return;
    const ns = fn(s);
    if (!ns || ns === s) return;
    let sketches;
    if (ns.curves && ns.curves.length === 0) sketches = st.sketches.filter((x) => x.id !== sketchId);
    else sketches = st.sketches.map((x) => (x.id === sketchId ? ns : x));
    const newState = { ...st, sketches };
    if (replace) this.doc.replace(newState);
    else this.doc.commit(label, newState, { icon });
  }

  // ================================================================ törlés
  deleteSelection() {
    if (!this.doc || !this.sel.length || this.mode === 'view') return;
    const st = this.doc.state;
    const bodyIds = new Set(this.sel.filter((s) => s.type === 'body').map((s) => s.bodyId));
    const sketchIds = new Set(this.sel.filter((s) => s.type === 'sketch').map((s) => s.sketchId));
    const planeIds = new Set(this.sel.filter((s) => s.type === 'plane').map((s) => s.planeId));
    const curveBySketch = new Map();
    for (const s of this.sel) {
      if (s.type === 'curve') {
        if (!curveBySketch.has(s.sketchId)) curveBySketch.set(s.sketchId, new Set());
        curveBySketch.get(s.sketchId).add(s.curveId);
      }
      if (s.type === 'region') {
        // régió törlése = a régió határoló görbéinek törlése
        const r = this.sketches.regionByKey(s.sketchId, s.key);
        if (r) {
          if (!curveBySketch.has(s.sketchId)) curveBySketch.set(s.sketchId, new Set());
          r.curveIds.forEach((id) => curveBySketch.get(s.sketchId).add(id));
        }
      }
    }
    const faceOrEdge = this.sel.some((s) => s.type === 'face' || s.type === 'edge');
    if (!bodyIds.size && !sketchIds.size && !curveBySketch.size && !planeIds.size) {
      if (faceOrEdge) this.ui.toast('Lapot/élt nem lehet törölni – jelöld ki a testet (dupla koppintás)', '', 3000);
      return;
    }
    let sketches = st.sketches.filter((s) => !sketchIds.has(s.id)).map((s) => {
      const del = curveBySketch.get(s.id);
      return del ? { ...s, curves: s.curves.filter((c) => !del.has(c.id)) } : s;
    }).filter((s) => s.curves.length > 0 || !curveBySketch.has(s.id));
    const ns = {
      ...st,
      bodies: st.bodies.filter((b) => !bodyIds.has(b.id)),
      sketches,
      planes: st.planes.filter((p) => !planeIds.has(p.id)),
    };
    this.setSelection([]);
    this.doc.commit('Törlés', ns, { icon: 'trash' });
  }

  // ================================================================ bemenet
  _inputHandler() {
    const app = this;
    return {
      down(ev) { return app._down(ev); },
      move(ev) { app._move(ev); },
      up(ev) { app._up(ev); },
      cancel(ev) { app._cancelDrag(ev); },
      tap(ev) { app._tap(ev); },
      doubleTap(ev) { app._doubleTap(ev); },
      hover(ev) { app._hover(ev); },
      pivotAt(x, y) {
        if (!app.doc) return null;
        const h = app.picker.raycastBodies(x, y);
        return h ? h.point : null;
      },
      undoGesture() { if (app.mode !== 'view') app.undo(); },
      redoGesture() { if (app.mode !== 'view') app.redo(); },
      autoRotateStopped() { app.updateToolbar(); },
    };
  }

  _down(ev) {
    if (!this.doc) return false;
    const hh = this.handles.hit(ev.x, ev.y, ev.pointerType);
    if (hh) {
      this.drag = { kind: 'handle', h: hh.h, part: hh.part, x0: ev.x, y0: ev.y };
      hh.h.dragStart(ev, hh.part);
      return true;
    }
    if (this.tool) {
      if (this.tool.down(ev)) { this.drag = { kind: 'tool' }; return true; }
      if (!this.tool.allowFreehand) return false;
    }
    // Rajzolni és vázlatot szerkeszteni csak Apple Pencillel (asztali gépen egérrel) lehet;
    // az ujj mindig navigál.
    if (this.mode === 'view' || ev.pointerType === 'touch') return false;
    const isPen = ev.pointerType === 'pen';
    // vázlatpont húzása
    if (!this.tool || this.tool.allowPointDrag) {
      const tol = pickTolerance(ev.pointerType);
      const hit = this.picker.raycastBodies(ev.x, ev.y);
      const sk = this.sketches.pick(ev.x, ev.y, tol, { regions: false, maxDepth: hit ? hit.distance : null });
      if (sk && sk.type === 'spoint') {
        this.drag = { kind: 'edit', edit: new PointDrag(this, sk, ev) };
        return true;
      }
    }
    if (isPen && this.settings.penDraws && (!this.tool || this.tool.allowFreehand)) {
      this.drag = { kind: 'freehand', cap: new FreehandCapture(this, ev) };
      return true;
    }
    return false;
  }

  _move(ev) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'handle') { d.h.dragMove(ev); this.vp.requestRender(); }
    else if (d.kind === 'tool') this.tool && this.tool.move(ev);
    else if (d.kind === 'edit') d.edit.move(ev);
    else if (d.kind === 'freehand') d.cap.move(ev);
  }

  _up(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const small = Math.hypot(ev.x - ev.x0, ev.y - ev.y0) < (ev.pointerType === 'touch' ? 9 : 5);
    if (d.kind === 'handle') {
      if (small && d.h.bubble && d.h.o && d.h.o.onTap) { d.h.dragEnd(ev); d.h.o.onTap(); }
      else d.h.dragEnd(ev);
    } else if (d.kind === 'tool') this.tool && this.tool.up(ev);
    else if (d.kind === 'edit') { if (small) { d.edit.cancel(); this._tap(ev); } else d.edit.finish(ev); }
    else if (d.kind === 'freehand') { if (small && !d.cap.longEnough()) { d.cap.cancel(); this._tap(ev); } else d.cap.finish(ev); }
  }

  _cancelDrag(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'handle') d.h.dragEnd(ev);
    else if (d.kind === 'tool') this.tool && this.tool.pointerCancel(ev);
    else if (d.kind === 'edit') d.edit.cancel();
    else if (d.kind === 'freehand') d.cap.cancel();
  }

  _tap(ev) {
    if (!this.doc) return;
    if (this.tool && this.tool.tap(ev)) return;
    if (this.tool && !this.tool.allowsSelection) return;
    const it = this.pickItem(ev, { vertices: this.tool && this.tool.pickVertices });
    if (!it) { if (!this.tool || this.tool.clearOnEmptyTap !== false) this.clearSelection(); return; }
    this.toggleSelect(it);
  }

  _doubleTap(ev) {
    if (!this.doc) return;
    if (this.tool && this.tool.doubleTap(ev)) return;
    const it = this.pickItem(ev);
    if (!it) { this.vp.fitBox(this.bodies.bounds()); return; }
    if (it.bodyId) {
      // az első koppintás által kijelölt lap/él helyett a teljes test
      const rest = this.sel.filter((s) => !(s.bodyId === it.bodyId));
      this.setSelection([...rest, { type: 'body', bodyId: it.bodyId }]);
    } else if (it.sketchId) {
      const rest = this.sel.filter((s) => s.sketchId !== it.sketchId);
      this.setSelection([...rest, { type: 'sketch', sketchId: it.sketchId }]);
    }
  }

  _hover(ev) {
    if (!this.doc || this.drag) return;
    if (this.tool && this.tool.hover(ev)) return;
    if (!ev) { this.bodies.setHover(null); this.sketches.setHover(null); return; }
    if (this._hoverRaf) { this._hoverEv = ev; return; }
    this._hoverEv = ev;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = 0;
      const e = this._hoverEv;
      const it = this.pickItem(e);
      if (it && ['face', 'edge', 'vertex'].includes(it.type)) { this.bodies.setHover(it); this.sketches.setHover(null); }
      else if (it && ['region', 'curve'].includes(it.type)) { this.bodies.setHover(null); this.sketches.setHover(it); }
      else { this.bodies.setHover(null); this.sketches.setHover(null); }
    });
  }

  // ================================================================ billentyűzet
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.doc || this.ui.isKeypadOpen()) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (this.tool && this.tool.key(e)) { e.preventDefault(); return; }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && this.mode !== 'view') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && k === 'y' && this.mode !== 'view') { e.preventDefault(); this.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); this.saveNow(true).then(() => this.ui.toast('Mentve', 'ok', 1200)); return; }
      if (mod && k === 'a') { e.preventDefault(); this.setSelection(this.doc.state.bodies.map((b) => ({ type: 'body', bodyId: b.id }))); return; }
      if (mod) return;
      if (k === 'escape') { if (this.tool) this.tool.cancel(); else this.clearSelection(); return; }
      if (k === 'enter') { if (this.tool) this.tool.done(); return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelection(); return; }
      if (k === 'v' && !e.repeat) { this.setMode(this.mode === 'view' ? 'model' : 'view'); return; }
      const map = { e: 'extrude', f: 'fillet', m: 'move', h: 'shell', l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'spline', t: 'trim', d: 'measure', x: 'section', o: 'offsetFace', b: 'boolean', p: 'polygon' };
      if (map[k] && !e.repeat) { e.preventDefault(); this.startTool(map[k]); return; }
      const views = { 1: [0, -1, 0], 3: [1, 0, 0], 7: [0, 0, 1], 2: [0, 1, 0], 4: [-1, 0, 0], 8: [0, 0, -1] };
      if (views[k]) { this.vp.setViewDirection(V(...views[k]), true, Math.abs(views[k][2]) ? V(0, 1, 0) : null); return; }
      if (k === '0') { this.vp.setViewDirection(V(1, -1.35, 0.95)); this.vp.fitBox(this.bodies.bounds()); return; }
      if (k === '.' || k === 'z') { this.vp.fitBox(this.bodies.bounds()); return; }
      if (k === 'i') { sheets.toggleIsolate(this); return; }
    });
  }

  // ================================================================ beállítások
  setSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    storage.saveSettings(this.settings);
    if (key === 'units') { setUnit(value); this.updateToolbar(); this.ui.refreshPanel(this.tool && this.tool.panel()); }
    if (key === 'display') this.bodies.setDisplayMode(value);
    if (key === 'perspective') this.vp.setOrtho(!value);
    if (key === 'shadows') { this.vp.shadows = value; this.vp.ground.visible = value && !this.bodies.bounds().isEmpty(); this.vp.requestRender(); }
    if (key === 'showLabels') document.getElementById('app').classList.toggle('hide-labels', !value);
    this.ui.renderRight(buildRightToolbar(this));
    this.cube.slot = this.ui.cubeSlot;
    this.vp.requestRender();
  }
}

/** Görbék átszámítása egyik síkkeretből a másikba (azonos sík, esetleg más orientáció). */
export function convertCurves(curves, from, to) {
  if (from.origin.distanceTo(to.origin) < 1e-9 && from.xDir.distanceTo(to.xDir) < 1e-9 && from.yDir.distanceTo(to.yDir) < 1e-9) return curves;
  const P = (uv) => toLocal(to, toWorld(from, uv));
  const flip = from.normal.dot(to.normal) < 0;
  const ang = (a, c) => { const p = P([c[0] + Math.cos(a), c[1] + Math.sin(a)]); const cc = P(c); return Math.atan2(p[1] - cc[1], p[0] - cc[0]); };
  return curves.map((c) => {
    switch (c.t) {
      case 'line': return { ...c, a: P(c.a), b: P(c.b) };
      case 'circle': return { ...c, c: P(c.c) };
      case 'point': return { ...c, p: P(c.p) };
      case 'spline': return { ...c, pts: c.pts.map(P) };
      case 'arc': {
        let a0 = ang(c.a0, c.c), a1 = ang(c.a1, c.c);
        if (flip) [a0, a1] = [a1, a0];
        while (a1 <= a0) a1 += Math.PI * 2;
        return { ...c, c: P(c.c), a0, a1 };
      }
      default: return c;
    }
  });
}
