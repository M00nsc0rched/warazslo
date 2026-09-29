// Háló alapú exportok: 3MF, GLB, megosztható HTML nézet, DXF
import * as THREE from 'three';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

/** Csúcsok összevarrása (a CAD háló lapjai külön csúcsokat használnak) – szeletelőknek zárt háló kell. */
export function weld(vertices, triangles, tol = 1e-5) {
  const map = new Map();
  const pos = [];
  const remap = new Uint32Array(vertices.length / 3);
  const q = (x) => Math.round(x / tol);
  for (let i = 0; i < vertices.length / 3; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    const k = `${q(x)},${q(y)},${q(z)}`;
    let idx = map.get(k);
    if (idx == null) { idx = pos.length / 3; map.set(k, idx); pos.push(x, y, z); }
    remap[i] = idx;
  }
  const idx = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = remap[triangles[i]], b = remap[triangles[i + 1]], c = remap[triangles[i + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/**
 * 3MF (3D Manufacturing Format) – testenként külön objektum, színekkel.
 * items: [{ name, color, positions, indices }], unit: 'millimeter' | 'inch'
 */
export function build3MF(items, { unit = 'millimeter', scale = 1 } = {}) {
  const f = (x) => (Math.round(x * scale * 1e5) / 1e5).toString();
  let objs = '';
  let build = '';
  const colors = items.map((it) => (it.color || '#c3c7ea').toUpperCase() + 'FF');
  const base = `<basematerials id="1">${items.map((it, i) => `<base name="${xmlEsc(it.name)}" displaycolor="${colors[i]}"/>`).join('')}</basematerials>`;
  items.forEach((it, i) => {
    const id = i + 2;
    const v = [];
    for (let k = 0; k < it.positions.length; k += 3) v.push(`<vertex x="${f(it.positions[k])}" y="${f(it.positions[k + 1])}" z="${f(it.positions[k + 2])}"/>`);
    const t = [];
    for (let k = 0; k < it.indices.length; k += 3) t.push(`<triangle v1="${it.indices[k]}" v2="${it.indices[k + 1]}" v3="${it.indices[k + 2]}"/>`);
    objs += `<object id="${id}" name="${xmlEsc(it.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`;
    build += `<item objectid="${id}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="hu-HU" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Warázsló</metadata>
<resources>${base}${objs}</resources>
<build>${build}</build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipSync({ '[Content_Types].xml': strToU8(types), '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(model) }, { level: 6 });
}

/** GLB (bináris glTF) – mm -> m, Z-fel -> Y-fel. meshes: [{name, positions, normals, indices, material(THREE)}] */
export async function buildGLB(meshes) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.scale.setScalar(0.001);
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const mesh = new THREE.Mesh(g, m.material);
    mesh.name = m.name;
    root.add(mesh);
  }
  const exp = new GLTFExporter();
  return exp.parseAsync(scene, { binary: true });
}

/** Önálló, bárhol megnyitható HTML 3D nézet (a GLB beágyazva; a three.js a netről töltődik). */
export function buildViewerHTML(glb, title) {
  const bytes = new Uint8Array(glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${xmlEsc(title)} – Warázsló 3D nézet</title>
<style>html,body{margin:0;height:100%;background:#111114;color:#eee;font-family:-apple-system,system-ui,sans-serif;overflow:hidden}#c{width:100%;height:100%;display:block;touch-action:none}#t{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#1c1c20cc;padding:8px 16px;border-radius:12px;font-weight:600}#h{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);color:#888;font-size:12px}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"}}</script>
</head><body><canvas id="c"></canvas><div id="t">${xmlEsc(title)}</div><div id="h">1 ujj: forgatás · 2 ujj: mozgatás, nagyítás · Warázsló</div>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const c = document.getElementById('c');
const r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
r.setPixelRatio(Math.min(devicePixelRatio, 2));
r.toneMapping = THREE.NeutralToneMapping;
const s = new THREE.Scene(); s.background = new THREE.Color('#111114');
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const cam = new THREE.PerspectiveCamera(40, 1, 0.001, 100);
const ctl = new OrbitControls(cam, c); ctl.enableDamping = true;
const d = Uint8Array.from(atob('${b64}'), (ch) => ch.charCodeAt(0));
new GLTFLoader().parse(d.buffer, '', (g) => {
  s.add(g.scene);
  const b = new THREE.Box3().setFromObject(g.scene), ctr = b.getCenter(new THREE.Vector3()), R = b.getSize(new THREE.Vector3()).length() / 2;
  ctl.target.copy(ctr); cam.position.copy(ctr).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(R * 2.8)); cam.near = R / 100; cam.far = R * 100; cam.updateProjectionMatrix();
});
const k = new THREE.DirectionalLight(0xffffff, 1.6); k.position.set(1, 2, 1.5); s.add(k, new THREE.HemisphereLight(0xdfe4ff, 0x30303a, 0.5));
function size() { const w = innerWidth, h = innerHeight; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', size); size();
r.setAnimationLoop(() => { ctl.update(); r.render(s, cam); });
</script></body></html>`;
}
