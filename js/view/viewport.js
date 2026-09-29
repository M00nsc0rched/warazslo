// 3D nézetablak: renderelés, kamera, rács, fények, árnyék
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Emitter, clamp } from '../util/misc.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WORLD_Z = V(0, 0, 1);

// ---------------------------------------------------------------- rács shader
const gridVert = /* glsl */`
  uniform vec3 uOrigin;
  uniform vec3 uXDir;
  uniform vec3 uYDir;
  varying vec2 vLocal;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vLocal = vec2(dot(w.xyz - uOrigin, uXDir), dot(w.xyz - uOrigin, uYDir));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const gridFrag = /* glsl */`
  uniform float uMinor;
  uniform float uMajor;
  uniform float uFade;
  uniform vec3 uCenter;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uMinorAlpha;
  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  varying vec2 vLocal;
  varying vec3 vWorld;
  float lineAA(vec2 p, float size, float width) {
    vec2 r = p / size;
    vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r);
    float l = min(g.x, g.y);
    return 1.0 - smoothstep(width - 0.5, width + 0.5, l);
  }
  void main() {
    float d = length(vWorld - uCenter);
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
    float minor = lineAA(vLocal, uMinor, 0.6) * uMinorAlpha;
    float major = lineAA(vLocal, uMajor, 0.9);
    float a = max(minor * 0.22, major * 0.5);
    vec3 col = uColor;
    // tengelyek
    vec2 fw = fwidth(vLocal);
    float ax = 1.0 - smoothstep(0.8, 1.8, abs(vLocal.y) / fw.y);
    float ay = 1.0 - smoothstep(0.8, 1.8, abs(vLocal.x) / fw.x);
    if (ax > 0.01) { col = mix(col, uAxisX, ax); a = max(a, ax * 0.95); }
    if (ay > 0.01) { col = mix(col, uAxisY, ay); a = max(a, ay * 0.95); }
    a *= fade * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export class Viewport extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this._frame = this._frame.bind(this);
    this._raf = 0;
    this.width = 1;
    this.height = 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.bgColor = new THREE.Color('#0c0c0e');
    this.scene.background = this.bgColor;
    this.overlayScene = new THREE.Scene(); // fogantyúk, mindig felül

    // rétegek
    this.bodiesGroup = new THREE.Group(); this.bodiesGroup.name = 'bodies';
    this.sketchGroup = new THREE.Group(); this.sketchGroup.name = 'sketches';
    this.helperGroup = new THREE.Group(); this.helperGroup.name = 'helpers';
    this.previewGroup = new THREE.Group(); this.previewGroup.name = 'preview';
    this.scene.add(this.bodiesGroup, this.sketchGroup, this.helperGroup, this.previewGroup);

    this._setupLights();
    this._setupGrid();

    // kamera
    this.fov = 40;
    this.persp = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 10000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    this.useOrtho = false;
    this.camera = this.persp;
    this.target = V(0, 0, 0);
    this.distance = 250;
    this.quat = new THREE.Quaternion();
    this.sceneRadius = 100;
    this.sceneCenter = V(0, 0, 0);
    this._anim = null;
    this.setViewDirection(V(1, -1.35, 0.95), false);

    this.width = 1; this.height = 1;
    this._needsRender = true;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    this.resize();
    this.displayMode = 'shadedEdges';
  }

  // ------------------------------------------------------------ fények
  _setupLights() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight(0xdfe4ff, 0x30303a, 0.55);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xffffff, 1.9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 6;
    this.scene.add(this.key, this.key.target);
    this.keyDir = V(0.45, 0.55, 1).normalize();

    this.fill = new THREE.DirectionalLight(0xc8d0ff, 0.45);
    this.scene.add(this.fill, this.fill.target);

    // árnyékfogó talaj
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55 }));
    this.ground.receiveShadow = true;
    this.ground.renderOrder = -1;
    this.ground.visible = false;
    this.scene.add(this.ground);
  }

  /** Árnyék és fények igazítása a modell befoglaló dobozához. */
  updateSceneBounds(box) {
    if (!box || box.isEmpty()) {
      this.ground.visible = false;
      this.sceneRadius = 100;
      this.sceneCenter.set(0, 0, 0);
      this.requestRender();
      return;
    }
    const c = box.getCenter(V());
    const size = box.getSize(V());
    const r = Math.max(size.length() / 2, 1);
    this.sceneRadius = r;
    this.sceneCenter.copy(c);
    const lightDist = r * 4;
    this.key.position.copy(c).addScaledVector(this.keyDir, lightDist);
    this.key.target.position.copy(c);
    const cam = this.key.shadow.camera;
    cam.left = -r * 1.6; cam.right = r * 1.6; cam.top = r * 1.6; cam.bottom = -r * 1.6;
    cam.near = lightDist - r * 2.5; cam.far = lightDist + r * 3;
    cam.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
    this.fill.position.copy(c).add(V(-r * 3, r * 2, r * 1.5));
    this.fill.target.position.copy(c);
    this.ground.position.set(c.x, c.y, box.min.z - r * 0.002);
    this.ground.scale.set(r * 8, r * 8, 1);
    this.ground.visible = this.shadows !== false;
    this.requestRender();
  }

  // ------------------------------------------------------------ rács
  _setupGrid() {
    this.gridUniforms = {
      uMinor: { value: 1 }, uMajor: { value: 10 }, uFade: { value: 500 }, uCenter: { value: V() },
      uColor: { value: new THREE.Color('#8c8c9c') }, uOpacity: { value: 1 }, uMinorAlpha: { value: 1 },
      uAxisX: { value: new THREE.Color("#e5484d") }, uAxisY: { value: new THREE.Color("#46a758") },
      uOrigin: { value: V() }, uXDir: { value: V(1, 0, 0) }, uYDir: { value: V(0, 1, 0) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: gridVert, fragmentShader: gridFrag, uniforms: this.gridUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    mat.extensions = { derivatives: true };
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.grid.renderOrder = -2;
    this.grid.frustumCulled = false;
    this.helperGroup.add(this.grid);
    this.gridFrame = { origin: V(), xDir: V(1, 0, 0), yDir: V(0, 1, 0), normal: V(0, 0, 1) };
    this.gridSpacing = 1;
    this.gridVisible = true;
  }

  /** Rácssík beállítása (vázlatsík). frame: {origin, xDir, yDir, normal} THREE.Vector3-okkal */
  setGridFrame(frame) {
    this.gridFrame = {
      origin: frame.origin.clone(), xDir: frame.xDir.clone().normalize(),
      yDir: frame.yDir.clone().normalize(), normal: frame.normal.clone().normalize(),
    };
    this.requestRender();
  }

  _updateGrid() {
    const g = this.grid;
    g.visible = this.gridVisible;
    if (!this.gridVisible) return;
    const f = this.gridFrame;
    // lépésköz a kamera távolsága alapján
    const camPos = this.camera.position;
    const toPlane = Math.abs(f.normal.dot(V().subVectors(camPos, f.origin)));
    const ref = this.useOrtho ? this.orthoHeight() : Math.max(toPlane, this.distance * 0.25);
    const raw = ref / 40;
    const base = Math.pow(10, Math.floor(Math.log10(raw)));
    const minor = raw / base < 2.5 ? base : raw / base < 6 ? base * 5 : base * 10;
    this.gridSpacing = minor;
    const u = this.gridUniforms;
    u.uMinor.value = minor;
    u.uMajor.value = minor * (Math.abs(minor / base - 5) < 1e-9 ? 2 : 10);
    u.uMinorAlpha.value = clamp(1.6 - raw / minor, 0.3, 1);
    const size = Math.max(ref * 14, this.sceneRadius * 6);
    // a rács középpontja: a célpont vetülete a síkra
    const t = V().subVectors(this.target, f.origin);
    const cu = t.dot(f.xDir), cv = t.dot(f.yDir);
    const m = new THREE.Matrix4().makeBasis(f.xDir, f.yDir, f.normal);
    m.setPosition(f.origin);
    const local = new THREE.Matrix4().makeTranslation(cu, cv, 0).multiply(new THREE.Matrix4().makeScale(size, size, 1));
    g.matrixAutoUpdate = false;
    g.matrix.copy(m).multiply(local);
    g.matrixWorldNeedsUpdate = true;
    u.uOrigin.value.copy(f.origin);
    u.uXDir.value.copy(f.xDir);
    u.uYDir.value.copy(f.yDir);
    u.uCenter.value.copy(f.origin).addScaledVector(f.xDir, cu).addScaledVector(f.yDir, cv);
    u.uFade.value = size * 0.5;
  }

  // ------------------------------------------------------------ kamera
  orthoHeight() { return 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.fov / 2)); }

  get viewDir() { return V(0, 0, -1).applyQuaternion(this.quat); }
  get camRight() { return V(1, 0, 0).applyQuaternion(this.quat); }
  get camUp() { return V(0, 1, 0).applyQuaternion(this.quat); }

  setViewDirection(dirFromTarget, animate = true, up = null) {
    // dirFromTarget: a kamera helyzete a célponthoz képest (normalizálva)
    const back = dirFromTarget.clone().normalize();
    let upv = up ? up.clone() : WORLD_Z.clone();
    if (Math.abs(back.dot(upv)) > 0.999) upv = V(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(back, V(0, 0, 0), upv);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    if (animate) this.animateTo({ quat: q });
    else { this.quat.copy(q); this._applyCamera(); }
  }

  _applyCamera() {
    const back = V(0, 0, 1).applyQuaternion(this.quat);
    const aspect = this.width / this.height;
    const r = this.sceneRadius;
    if (this.useOrtho) {
      const h = this.orthoHeight();
      const w = h * aspect;
      const o = this.ortho;
      o.left = -w / 2; o.right = w / 2; o.top = h / 2; o.bottom = -h / 2;
      const dist = Math.max(this.distance, r * 4) + r * 2;
      o.position.copy(this.target).addScaledVector(back, dist);
      o.quaternion.copy(this.quat);
      o.near = 0.01;
      o.far = dist + r * 6 + this.distance * 4;
      o.updateProjectionMatrix();
      o.updateMatrixWorld();
      this.camera = o;
    } else {
      const p = this.persp;
      p.fov = this.fov;
      p.aspect = aspect;
      p.position.copy(this.target).addScaledVector(back, this.distance);
      p.quaternion.copy(this.quat);
      const distToCenter = p.position.distanceTo(this.sceneCenter);
      p.near = Math.max(0.005, this.distance * 0.002);
      p.far = Math.max(this.distance * 60, distToCenter + r * 8);
      p.updateProjectionMatrix();
      p.updateMatrixWorld();
      this.camera = p;
    }
    this.requestRender();
    this.emit('camera');
  }

  setOrtho(on) {
    this.useOrtho = !!on;
    this._applyCamera();
  }

  /** Forgatás egy pont körül (képernyő-pixel elmozdulás). */
  orbit(dx, dy, pivot) {
    const k = 0.0065;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(WORLD_Z, -dx * k);
    const right = this.camRight;
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -dy * k);
    const R = qYaw.multiply(qPitch);
    const P = pivot || this.target;
    const camPos = this.target.clone().addScaledVector(V(0, 0, 1).applyQuaternion(this.quat), this.distance);
    camPos.sub(P).applyQuaternion(R).add(P);
    this.target.sub(P).applyQuaternion(R).add(P);
    this.quat.premultiply(R).normalize();
    this.distance = camPos.distanceTo(this.target);
    this._cancelAnim();
    this._applyCamera();
  }

  /**
   * Körkörös forgatás a nézési tengely körül (két ujjas csavarás).
   * angle: a képernyőn mért szögváltozás (radián, óramutató járása szerint pozitív).
   */
  roll(angle, pivot) {
    const R = new THREE.Quaternion().setFromAxisAngle(this.viewDir, -angle);
    const P = pivot || this.target;
    const camPos = this.target.clone().addScaledVector(V(0, 0, 1).applyQuaternion(this.quat), this.distance);
    camPos.sub(P).applyQuaternion(R).add(P);
    this.target.sub(P).applyQuaternion(R).add(P);
    this.quat.premultiply(R).normalize();
    this.distance = camPos.distanceTo(this.target);
    this._cancelAnim();
    this._applyCamera();
  }

  /** Lassú automatikus körbeforgatás (bemutató / nézet mód). */
  setAutoRotate(on) {
    this.autoRotate = !!on;
    this._lastAuto = 0;
    this.setContinuous(this.autoRotate);
  }

  /** Eltolás képernyő-pixelekkel; depthPoint: az a pont, amelyiknek követnie kell az ujjat. */
  pan(dx, dy, depthPoint) {
    const per = this.worldPerPixel(depthPoint || this.target);
    const move = this.camRight.multiplyScalar(-dx * per).add(this.camUp.multiplyScalar(dy * per));
    this.target.add(move);
    this._cancelAnim();
    this._applyCamera();
  }

  /** Nagyítás egy pont felé; s < 1 közelít. */
  zoomAt(s, point) {
    const P = point || this.target;
    const nd = clamp(this.distance * s, 0.02, 2e6);
    const k = nd / this.distance;
    this.target.sub(P).multiplyScalar(k).add(P);
    this.distance = nd;
    this._cancelAnim();
    this._applyCamera();
  }

  /** Világegység / CSS pixel egy adott pont mélységében. */
  worldPerPixel(point) {
    if (this.useOrtho) return this.orthoHeight() / this.height;
    const camPos = this.camera.position;
    const depth = Math.max(1e-6, V().subVectors(point, camPos).dot(this.viewDir));
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.fov / 2))) / this.height;
  }

  fitBox(box, animate = true, dirOverride = null) {
    if (!box || box.isEmpty()) {
      box = new THREE.Box3(V(-50, -50, 0), V(50, 50, 20));
    }
    const c = box.getCenter(V());
    const r = Math.max(box.getSize(V()).length() / 2, 1);
    const aspect = this.width / this.height;
    const fovV = THREE.MathUtils.degToRad(this.fov / 2);
    const fovH = Math.atan(Math.tan(fovV) * aspect);
    const d = r / Math.sin(Math.min(fovV, fovH)) * 1.15;
    const q = dirOverride ? null : (this._anim ? this._anim.to.quat.clone() : this.quat.clone());
    if (animate) this.animateTo({ target: c, distance: d, quat: q || undefined });
    else { this.target.copy(c); this.distance = d; this._applyCamera(); }
  }

  animateTo({ target, distance, quat }, ms = 380) {
    const from = { target: this.target.clone(), distance: this.distance, quat: this.quat.clone() };
    const to = { target: target ? target.clone() : from.target, distance: distance ?? from.distance, quat: quat ? quat.clone() : from.quat };
    this._anim = { from, to, t0: performance.now(), ms };
    this.requestRender();
  }

  _cancelAnim() { this._anim = null; }

  _stepAnim(now) {
    const a = this._anim;
    if (!a) return false;
    let t = (now - a.t0) / a.ms;
    if (t >= 1) t = 1;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.target.lerpVectors(a.from.target, a.to.target, e);
    this.distance = a.from.distance + (a.to.distance - a.from.distance) * e;
    this.quat.slerpQuaternions(a.from.quat, a.to.quat, e);
    const done = t >= 1;
    if (done) this._anim = null;
    this._applyCamera();
    return !done;
  }

  // ------------------------------------------------------------ vetítés és sugarak
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.rect = rect;
    this.renderer.setSize(this.width, this.height, false);
    this._applyCamera();
    this.emit('resize');
  }

  /** világ -> képernyő (CSS px, a vászonhoz képest). z: NDC mélység */
  project(p) {
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height, z: v.z, behind: v.z > 1 };
  }

  ndc(x, y) { return new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1); }

  rayAt(x, y) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(x, y), this.camera);
    return rc.ray;
  }

  raycaster(x, y) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc(x, y), this.camera);
    rc.params.Line.threshold = 0;
    return rc;
  }

  /** A sugár metszéspontja egy síkkal (origin, normal). */
  rayPlane(x, y, origin, normal) {
    const ray = this.rayAt(x, y);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const out = V();
    if (ray.intersectPlane(pl, out)) return out;
    return null;
  }

  /** Pont a nézetsíkon a célpont mélységében (ha nincs találat). */
  pointAtTargetDepth(x, y) {
    return this.rayPlane(x, y, this.target, this.viewDir) || this.target.clone();
  }

  // ------------------------------------------------------------ renderelés
  requestRender() {
    this._needsRender = true;
    if (!this._raf) this._raf = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this._raf = 0;
    if (this.autoRotate) {
      const dt = this._lastAuto ? Math.min(0.1, (now - this._lastAuto) / 1000) : 0;
      this._lastAuto = now;
      if (dt > 0 && !this._anim) {
        const q = new THREE.Quaternion().setFromAxisAngle(WORLD_Z, dt * 0.35);
        const P = this.sceneCenter;
        const camPos = this.target.clone().addScaledVector(V(0, 0, 1).applyQuaternion(this.quat), this.distance);
        camPos.sub(P).applyQuaternion(q).add(P);
        this.target.sub(P).applyQuaternion(q).add(P);
        this.quat.premultiply(q).normalize();
        this._applyCamera();
      }
    }
    const animating = this._stepAnim(now);
    this._updateGrid();
    this.emit('beforeRender');
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.overlayScene, this.camera);
    this.emit('afterRender');
    this._needsRender = false;
    if (animating || this._continuous) this.requestRender();
  }

  setContinuous(on) { this._continuous = on; if (on) this.requestRender(); }

  /** Képernyőkép PNG-ként (a rács nélkül). */
  snapshot({ width, height, hideGrid = true, transparent = false } = {}) {
    const gridWas = this.gridVisible;
    if (hideGrid) this.gridVisible = false;
    const oldW = this.width, oldH = this.height;
    const r = this.renderer;
    const pr = r.getPixelRatio();
    if (width && height) {
      r.setPixelRatio(1);
      this.width = width; this.height = height;
      r.setSize(width, height, false);
      this._applyCamera();
    }
    const bg = this.scene.background;
    if (transparent) this.scene.background = null;
    this._updateGrid();
    this.emit('beforeRender');
    r.setViewport(0, 0, this.width, this.height);
    r.setClearColor(0x000000, transparent ? 0 : 1);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.scene.background = bg;
    r.setClearColor(0x000000, 1);
    if (width && height) {
      r.setPixelRatio(pr);
      this.width = oldW; this.height = oldH;
      r.setSize(oldW, oldH, false);
      this._applyCamera();
    }
    this.gridVisible = gridWas;
    this.requestRender();
    return url;
  }
}

