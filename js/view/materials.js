// Anyagkönyvtár (PBR) – vizualizációhoz és tömegszámításhoz
import * as THREE from 'three';

// alap anyagok: [id, név, csoport, szín, fémesség, érdesség, sűrűség g/cm³, extra]
const BASE = [
  // fémek
  ['steel', 'Acél', 'Fémek', '#b9bcc2', 1, 0.32, 7.85],
  ['steel-brushed', 'Szálcsiszolt acél', 'Fémek', '#b3b6bc', 1, 0.42, 7.85, { tex: 'brushed' }],
  ['steel-polished', 'Polírozott acél', 'Fémek', '#d6d9de', 1, 0.08, 7.85],
  ['stainless', 'Rozsdamentes acél', 'Fémek', '#c8cbd0', 1, 0.22, 8.0, { tex: 'brushed' }],
  ['steel-black', 'Feketített acél', 'Fémek', '#2c2d31', 1, 0.45, 7.85],
  ['galvanized', 'Horganyzott acél', 'Fémek', '#a9b0b6', 1, 0.5, 7.85, { tex: 'noise' }],
  ['cast-iron', 'Öntöttvas', 'Fémek', '#55575b', 1, 0.7, 7.2, { tex: 'noise' }],
  ['aluminum', 'Alumínium', 'Fémek', '#d2d5da', 1, 0.3, 2.7],
  ['aluminum-brushed', 'Szálcsiszolt alumínium', 'Fémek', '#cdd0d5', 1, 0.38, 2.7, { tex: 'brushed' }],
  ['aluminum-polished', 'Polírozott alumínium', 'Fémek', '#eceef2', 1, 0.06, 2.7],
  ['aluminum-cast', 'Öntött alumínium', 'Fémek', '#b8bbc0', 1, 0.62, 2.68, { tex: 'noise' }],
  ['titanium', 'Titán', 'Fémek', '#9a9790', 1, 0.35, 4.5],
  ['brass', 'Sárgaréz', 'Fémek', '#d9b56a', 1, 0.25, 8.5],
  ['bronze', 'Bronz', 'Fémek', '#b4814b', 1, 0.35, 8.8],
  ['copper', 'Réz (vörösréz)', 'Fémek', '#d58a5c', 1, 0.25, 8.96],
  ['gold', 'Arany', 'Fémek', '#f1c75b', 1, 0.15, 19.3],
  ['silver', 'Ezüst', 'Fémek', '#e4e6ea', 1, 0.12, 10.5],
  ['chrome', 'Króm', 'Fémek', '#f3f4f6', 1, 0.03, 7.19],
  ['nickel', 'Nikkel', 'Fémek', '#cfc9bb', 1, 0.2, 8.9],
  ['zinc', 'Cink', 'Fémek', '#b9bec2', 1, 0.45, 7.14],
  ['magnesium', 'Magnézium', 'Fémek', '#c4c6c8', 1, 0.4, 1.74],
  // műanyagok (külön generálva színenként)
  // 3D nyomtatás
  ['pla', 'PLA', '3D nyomtatás', '#e8e8ea', 0, 0.55, 1.24, { layers: true }],
  ['pla-silk-gold', 'PLA selyem arany', '3D nyomtatás', '#d9a441', 0.55, 0.28, 1.24, { layers: true }],
  ['pla-silk-silver', 'PLA selyem ezüst', '3D nyomtatás', '#c9ccd2', 0.55, 0.28, 1.24, { layers: true }],
  ['pla-silk-copper', 'PLA selyem réz', '3D nyomtatás', '#c47a4d', 0.55, 0.28, 1.24, { layers: true }],
  ['petg-clear', 'PETG átlátszó', '3D nyomtatás', '#dfeff5', 0, 0.12, 1.27, { transmission: 0.85, layers: true }],
  ['petg-black', 'PETG fekete', '3D nyomtatás', '#1d1e21', 0, 0.35, 1.27, { layers: true }],
  ['abs', 'ABS', '3D nyomtatás', '#efefe9', 0, 0.6, 1.04, { layers: true }],
  ['asa', 'ASA', '3D nyomtatás', '#e4e2da', 0, 0.62, 1.07, { layers: true }],
  ['tpu', 'TPU (rugalmas)', '3D nyomtatás', '#3a3d44', 0, 0.8, 1.21, { layers: true }],
  ['nylon', 'Nylon (PA12)', '3D nyomtatás', '#e6e1d6', 0, 0.75, 1.01, { tex: 'noise' }],
  ['resin-gray', 'Gyanta szürke', '3D nyomtatás', '#8d9096', 0, 0.35, 1.18],
  ['resin-clear', 'Gyanta átlátszó', '3D nyomtatás', '#e6f3f7', 0, 0.05, 1.18, { transmission: 0.95 }],
  // gumi
  ['rubber-black', 'Gumi fekete', 'Gumi', '#1f2022', 0, 0.9, 1.15],
  ['rubber-gray', 'Gumi szürke', 'Gumi', '#5c5f64', 0, 0.9, 1.15],
  ['rubber-red', 'Gumi piros', 'Gumi', '#9c2b25', 0, 0.9, 1.15],
  ['rubber-blue', 'Gumi kék', 'Gumi', '#2a4c8c', 0, 0.9, 1.15],
  ['silicone', 'Szilikon', 'Gumi', '#d9dcd9', 0, 0.55, 1.1, { transmission: 0.3 }],
  // üveg
  ['glass', 'Üveg', 'Üveg', '#ffffff', 0, 0.02, 2.5, { transmission: 1, ior: 1.5 }],
  ['glass-frosted', 'Matt üveg', 'Üveg', '#f4f7f8', 0, 0.35, 2.5, { transmission: 1, ior: 1.5 }],
  ['glass-blue', 'Kék üveg', 'Üveg', '#9cc4e8', 0, 0.02, 2.5, { transmission: 1, ior: 1.5 }],
  ['glass-green', 'Zöld üveg', 'Üveg', '#9fd3a8', 0, 0.02, 2.5, { transmission: 1, ior: 1.5 }],
  ['glass-smoke', 'Füstüveg', 'Üveg', '#6b6f75', 0, 0.02, 2.5, { transmission: 0.9, ior: 1.5 }],
  ['glass-amber', 'Borostyán üveg', 'Üveg', '#d8a45a', 0, 0.02, 2.5, { transmission: 1, ior: 1.5 }],
  ['acrylic', 'Plexi (PMMA)', 'Üveg', '#ffffff', 0, 0.04, 1.18, { transmission: 1, ior: 1.49 }],
  ['polycarbonate', 'Polikarbonát', 'Üveg', '#f4f8fa', 0, 0.06, 1.2, { transmission: 0.95, ior: 1.58 }],
  // fa
  ['oak', 'Tölgy', 'Fa', '#b8874f', 0, 0.62, 0.75, { tex: 'wood' }],
  ['walnut', 'Dió', 'Fa', '#6a4630', 0, 0.55, 0.65, { tex: 'wood' }],
  ['pine', 'Fenyő', 'Fa', '#dcb57a', 0, 0.68, 0.5, { tex: 'wood' }],
  ['maple', 'Juhar', 'Fa', '#e2c39a', 0, 0.58, 0.7, { tex: 'wood' }],
  ['cherry', 'Cseresznye', 'Fa', '#a45f3c', 0, 0.55, 0.6, { tex: 'wood' }],
  ['beech', 'Bükk', 'Fa', '#d6a676', 0, 0.6, 0.72, { tex: 'wood' }],
  ['plywood', 'Rétegelt lemez', 'Fa', '#d9ba88', 0, 0.7, 0.6, { tex: 'wood' }],
  ['mdf', 'MDF', 'Fa', '#b69a78', 0, 0.8, 0.75, { tex: 'noise' }],
  ['bamboo', 'Bambusz', 'Fa', '#cfae6d', 0, 0.55, 0.7, { tex: 'wood' }],
  // kő, beton, kerámia
  ['concrete', 'Beton', 'Kő és kerámia', '#9d9c97', 0, 0.9, 2.4, { tex: 'concrete' }],
  ['granite', 'Gránit', 'Kő és kerámia', '#7e7b78', 0, 0.45, 2.7, { tex: 'granite' }],
  ['marble-white', 'Fehér márvány', 'Kő és kerámia', '#ecebe8', 0, 0.2, 2.7, { tex: 'marble' }],
  ['marble-black', 'Fekete márvány', 'Kő és kerámia', '#262628', 0, 0.2, 2.7, { tex: 'marble' }],
  ['sandstone', 'Homokkő', 'Kő és kerámia', '#c8ab83', 0, 0.9, 2.3, { tex: 'concrete' }],
  ['ceramic-white', 'Fehér kerámia', 'Kő és kerámia', '#f3f2ef', 0, 0.12, 2.4, { clearcoat: 1 }],
  ['ceramic-black', 'Fekete kerámia', 'Kő és kerámia', '#1c1c1e', 0, 0.12, 2.4, { clearcoat: 1 }],
  ['terracotta', 'Terrakotta', 'Kő és kerámia', '#b8643f', 0, 0.85, 1.9, { tex: 'noise' }],
  ['porcelain', 'Porcelán', 'Kő és kerámia', '#f7f6f2', 0, 0.06, 2.4, { clearcoat: 1 }],
  // egyéb
  ['carbon', 'Szénszál', 'Egyéb', '#26282c', 0.2, 0.28, 1.6, { tex: 'carbon', clearcoat: 1 }],
  ['carbon-matte', 'Szénszál matt', 'Egyéb', '#2a2c30', 0.2, 0.55, 1.6, { tex: 'carbon' }],
  ['leather-black', 'Fekete bőr', 'Egyéb', '#1e1d1c', 0, 0.7, 0.86, { tex: 'noise' }],
  ['leather-brown', 'Barna bőr', 'Egyéb', '#6b4027', 0, 0.7, 0.86, { tex: 'noise' }],
  ['fabric-gray', 'Szürke szövet', 'Egyéb', '#7b7e84', 0, 0.95, 0.3, { tex: 'fabric' }],
  ['fabric-blue', 'Kék szövet', 'Egyéb', '#3c5378', 0, 0.95, 0.3, { tex: 'fabric' }],
  ['cork', 'Parafa', 'Egyéb', '#b58c5b', 0, 0.95, 0.24, { tex: 'noise' }],
  ['cardboard', 'Karton', 'Egyéb', '#b99a6d', 0, 0.9, 0.7, { tex: 'noise' }],
  ['paper', 'Papír', 'Egyéb', '#f4f1e8', 0, 0.9, 0.8],
  ['light', 'Világító', 'Egyéb', '#fff4d6', 0, 0.5, 1.2, { emissive: 1 }],
];

const COLORS = [
  ['feher', 'fehér', '#f2f2f0'], ['fekete', 'fekete', '#1d1e21'], ['szurke', 'szürke', '#8a8d93'], ['piros', 'piros', '#c8312b'],
  ['narancs', 'narancs', '#e6772b'], ['sarga', 'sárga', '#f0c332'], ['zold', 'zöld', '#3a9a4f'], ['kek', 'kék', '#2f63c2'],
  ['egkek', 'égkék', '#5fb1e6'], ['lila', 'lila', '#7a4bb3'], ['rozsaszin', 'rózsaszín', '#e27aa8'], ['barna', 'barna', '#7a5230'],
];
const ANOD = [['piros', 'piros', '#b0302a'], ['kek', 'kék', '#2c58a8'], ['fekete', 'fekete', '#2a2b2f'], ['arany', 'arany', '#c9a24a'], ['zold', 'zöld', '#3f8a4c'], ['lila', 'lila', '#6b3e9e'], ['narancs', 'narancs', '#d06a2a'], ['titan', 'titánszürke', '#6f737a']];

export const MATERIALS = [];
for (const [id, name, group, color, metalness, roughness, density, extra] of BASE) MATERIALS.push({ id, name, group, color, metalness, roughness, density, ...(extra || {}) });
for (const [cid, cn, c] of COLORS) {
  MATERIALS.push({ id: `plastic-gloss-${cid}`, name: `Fényes műanyag, ${cn}`, group: 'Műanyagok', color: c, metalness: 0, roughness: 0.18, density: 1.1, clearcoat: 0.6 });
  MATERIALS.push({ id: `plastic-matte-${cid}`, name: `Matt műanyag, ${cn}`, group: 'Műanyagok', color: c, metalness: 0, roughness: 0.62, density: 1.1 });
  MATERIALS.push({ id: `pla-${cid}`, name: `PLA ${cn}`, group: '3D nyomtatás', color: c, metalness: 0, roughness: 0.5, density: 1.24, layers: true });
}
for (const [cid, cn, c] of ANOD) MATERIALS.push({ id: `anodized-${cid}`, name: `Eloxált alumínium, ${cn}`, group: 'Eloxált alumínium', color: c, metalness: 1, roughness: 0.34, density: 2.7 });

export const MATERIAL_GROUPS = [...new Set(MATERIALS.map((m) => m.group))];
export const materialById = (id) => MATERIALS.find((m) => m.id === id) || null;

// ---------------------------------------------------------------- eljárásos textúrák
const texCache = new Map();
function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function makeTexture(kind, color) {
  const key = `${kind}:${color}`;
  if (texCache.has(key)) return texCache.get(key);
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const base = new THREE.Color(color);
  const css = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  g.fillStyle = css(base);
  g.fillRect(0, 0, N, N);
  const R = rand(kind.length * 997 + N);
  const shade = (k) => base.clone().multiplyScalar(k);
  if (kind === 'wood') {
    for (let y = 0; y < N; y++) {
      const w = Math.sin(y * 0.09 + Math.sin(y * 0.013) * 4) * 0.5 + 0.5;
      const k = 0.78 + w * 0.3 + (R() - 0.5) * 0.05;
      g.fillStyle = css(shade(k));
      g.fillRect(0, y, N, 1);
    }
    g.globalAlpha = 0.08;
    for (let i = 0; i < 900; i++) { g.fillStyle = css(shade(0.6)); g.fillRect(R() * N, R() * N, 20 + R() * 60, 1); }
  } else if (kind === 'brushed') {
    for (let i = 0; i < 4000; i++) { g.globalAlpha = 0.05 + R() * 0.07; g.fillStyle = R() > 0.5 ? '#ffffff' : '#000000'; g.fillRect(0, R() * N, N, 1); }
  } else if (kind === 'carbon') {
    const s = 16;
    for (let y = 0; y < N; y += s) for (let x = 0; x < N; x += s) {
      const on = ((x / s) + (y / s)) % 2 === 0;
      const grd = on ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
      grd.addColorStop(0, css(shade(0.6))); grd.addColorStop(0.5, css(shade(1.5))); grd.addColorStop(1, css(shade(0.6)));
      g.fillStyle = grd; g.fillRect(x, y, s, s);
    }
  } else if (kind === 'marble') {
    g.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = base.getHSL({}).l > 0.5 ? '#8c8c90' : '#d8d8dc';
      g.lineWidth = 0.5 + R() * 2;
      g.beginPath();
      let x = R() * N, y = R() * N;
      g.moveTo(x, y);
      for (let k = 0; k < 20; k++) { x += (R() - 0.3) * 40; y += (R() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (kind === 'fabric') {
    g.globalAlpha = 0.25;
    for (let i = 0; i < N; i += 3) { g.fillStyle = css(shade(0.7)); g.fillRect(i, 0, 1, N); g.fillRect(0, i, N, 1); }
  } else {
    // zaj: beton, gránit, öntvény
    const img = g.getImageData(0, 0, N, N);
    const amp = kind === 'granite' ? 0.35 : kind === 'concrete' ? 0.18 : 0.1;
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (R() - 0.5) * amp * 2;
      img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
    }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** THREE anyag egy könyvtári anyaghoz. */
export function createMaterial(m, { clipPlanes = null, color = null } = {}) {
  const physical = m.transmission || m.clearcoat;
  const Ctor = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Ctor({
    color: new THREE.Color(color || m.color), metalness: m.metalness, roughness: m.roughness, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, envMapIntensity: m.metalness > 0.5 ? 1.25 : 1,
  });
  if (physical) {
    if (m.transmission) { mat.transmission = m.transmission; mat.thickness = 2; mat.ior = m.ior || 1.5; mat.transparent = false; }
    if (m.clearcoat) { mat.clearcoat = m.clearcoat; mat.clearcoatRoughness = 0.08; }
  }
  if (m.emissive) { mat.emissive = new THREE.Color(m.color); mat.emissiveIntensity = 1.4; }
  if (m.tex) { mat.map = makeTexture(m.tex, color || m.color); mat.color.set('#ffffff'); }
  if (clipPlanes && clipPlanes.length) mat.clippingPlanes = clipPlanes;
  mat.userData.needsUV = !!m.tex;
  mat.userData.texScale = m.tex === 'wood' ? 0.012 : m.tex === 'carbon' ? 0.05 : 0.02;
  return mat;
}

/** Doboz-vetítéses UV koordináták (a textúrázott anyagokhoz). */
export function ensureBoxUV(geo, scale = 0.02) {
  if (geo.getAttribute('uv') && geo.userData.uvScale === scale) return;
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (nz >= nx && nz >= ny) { uv[i * 2] = x * scale; uv[i * 2 + 1] = y * scale; }
    else if (nx >= ny) { uv[i * 2] = y * scale; uv[i * 2 + 1] = z * scale; }
    else { uv[i * 2] = x * scale; uv[i * 2 + 1] = z * scale; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.userData.uvScale = scale;
}

/** CSS minta a választóhoz (gömbszerű árnyalás). */
export function swatchCSS(m) {
  const c = new THREE.Color(m.color);
  const hi = c.clone().lerp(new THREE.Color('#ffffff'), m.metalness > 0.5 ? 0.7 : 0.45 * (1 - m.roughness));
  const lo = c.clone().multiplyScalar(m.metalness > 0.5 ? 0.35 : 0.55);
  const h = (x) => `#${x.getHexString()}`;
  let bg = `radial-gradient(circle at 32% 28%, ${h(hi)} 0%, ${h(c)} 42%, ${h(lo)} 100%)`;
  if (m.transmission) bg = `radial-gradient(circle at 32% 28%, #ffffff 0%, ${h(c)}88 45%, ${h(lo)}66 100%)`;
  return bg;
}
