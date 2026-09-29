// Szöveg a vázlatban: a betűk körvonalai (opentype.js) vonal- és Bézier-darabokká alakítva.
// A szöveg egy vázlatgörbe: { t:'text', text, font, size (betűmagasság mm), p (alapvonal kezdőpontja),
//   rot (radián), align: 'left'|'center'|'right', spacing (betűköz, mm) }
// A régiókeresés és a kernel a darabokat ugyanúgy kezeli, mint a többi görbét.

export const FONTS = [
  { id: 'sans', label: 'Roboto', file: 'Roboto-Regular.woff' },
  { id: 'bold', label: 'Roboto félkövér', file: 'Roboto-Bold.woff' },
  { id: 'italic', label: 'Roboto dőlt', file: 'Roboto-RegularItalic.woff' },
  { id: 'condensed', label: 'Roboto keskeny', file: 'Roboto-Condensed-Regular.woff' },
  { id: 'slab', label: 'Roboto Slab (talpas)', file: 'Roboto-Slab-Regular.woff' },
];

const fonts = new Map();      // id -> opentype Font
const loading = new Map();    // id -> Promise
const listeners = new Set();
let otModule = null;

/** Értesítés, ha egy betűtípus betöltődött (a vázlatok újrarajzolásához). */
export function onFontLoaded(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function fontInfo(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }

export function loadFont(id) {
  const info = fontInfo(id);
  if (fonts.has(info.id)) return Promise.resolve(fonts.get(info.id));
  if (loading.has(info.id)) return loading.get(info.id);
  const pr = (async () => {
    otModule = otModule || await import('../../vendor/opentype/opentype.module.js');
    const res = await fetch(new URL(`../../vendor/fonts/${info.file}`, import.meta.url));
    if (!res.ok) throw new Error('A betűtípus nem tölthető be');
    const font = otModule.parse(await res.arrayBuffer());
    fonts.set(info.id, font);
    for (const fn of listeners) { try { fn(info.id); } catch (e) { console.error(e); } }
    return font;
  })();
  pr.catch(() => loading.delete(info.id));
  loading.set(info.id, pr);
  return pr;
}

export const fontLoaded = (id) => fonts.has(fontInfo(id).id);

// ---------------------------------------------------------------- körvonalak
const localCache = new Map(); // kulcs -> { pieces, width, height, lines }
const curveCache = new WeakMap(); // görbe objektum -> transzformált darabok

function cacheKey(c) { return `${fontInfo(c.font).id}|${c.size}|${c.align || 'left'}|${c.spacing || 0}|${c.text}`; }

/** Egy szöveg darabjai a saját koordinátarendszerében (alapvonal kezdőpontja az origó). */
function localLayout(c) {
  const font = fonts.get(fontInfo(c.font).id);
  if (!font) return null;
  const key = cacheKey(c);
  let L = localCache.get(key);
  if (L) return L;
  const upm = font.unitsPerEm || 1000;
  const os2 = font.tables && font.tables.os2;
  const capU = (os2 && os2.sCapHeight) || upm * 0.7;
  const em = Math.max(1e-6, c.size) * upm / capU; // betűmagasság -> em méret
  const hh = font.tables && font.tables.hhea;
  const lineH = hh ? (hh.ascender - hh.descender + (hh.lineGap || 0)) / upm * em : em * 1.2;
  const lines = String(c.text || '').split('\n');
  const pieces = [];
  let maxW = 0;
  lines.forEach((line, li) => {
    const y0 = -li * lineH;
    const sp = c.spacing || 0;
    // betűnként helyezzük el, hogy a betűköz állítható legyen
    const glyphs = font.stringToGlyphs(line);
    const xs = [];
    let x = 0;
    for (let i = 0; i < glyphs.length; i++) {
      xs.push(x);
      let adv = (glyphs[i].advanceWidth || 0) * em / upm;
      if (i < glyphs.length - 1) adv += font.getKerningValue(glyphs[i], glyphs[i + 1]) * em / upm + sp;
      x += adv;
    }
    const w = x;
    maxW = Math.max(maxW, w);
    const x0 = c.align === 'center' ? -w / 2 : c.align === 'right' ? -w : 0;
    glyphs.forEach((g, i) => pathPieces(g.getPath(x0 + xs[i], 0, em).commands, y0, pieces));
  });
  L = { pieces, width: maxW, height: lineH * (lines.length - 1) + c.size, lineH };
  if (localCache.size > 200) localCache.clear();
  localCache.set(key, L);
  return L;
}

/** opentype útvonal-parancsok (y lefelé) -> darabok (y felfelé). */
function pathPieces(cmds, y0, out) {
  const P = (x, y) => [x, y0 - y];
  let start = null, cur = null;
  const line = (a, b) => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) out.push({ k: 'line', a, b }); };
  for (const m of cmds) {
    switch (m.type) {
      case 'M':
        if (cur && start) line(cur, start);
        start = cur = P(m.x, m.y);
        break;
      case 'L': { const q = P(m.x, m.y); line(cur, q); cur = q; break; }
      case 'Q': {
        const c1 = P(m.x1, m.y1), q = P(m.x, m.y);
        const a = [cur[0] + (c1[0] - cur[0]) * 2 / 3, cur[1] + (c1[1] - cur[1]) * 2 / 3];
        const b = [q[0] + (c1[0] - q[0]) * 2 / 3, q[1] + (c1[1] - q[1]) * 2 / 3];
        if (Math.hypot(cur[0] - q[0], cur[1] - q[1]) > 1e-9) out.push({ k: 'bez', p: [cur, a, b, q] });
        cur = q;
        break;
      }
      case 'C': {
        const q = P(m.x, m.y);
        if (Math.hypot(cur[0] - q[0], cur[1] - q[1]) > 1e-9) out.push({ k: 'bez', p: [cur, P(m.x1, m.y1), P(m.x2, m.y2), q] });
        cur = q;
        break;
      }
      case 'Z':
        if (cur && start) line(cur, start);
        cur = start;
        break;
    }
  }
  if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) line(cur, start);
}

function xform(c) {
  const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0);
  const [px, py] = c.p;
  const my = c.mirror ? -1 : 1; // tükrözött sík (hátulról nézett vázlat)
  return (q) => [px + q[0] * cs - q[1] * my * sn, py + q[0] * sn + q[1] * my * cs];
}

/** A szöveggörbe darabjai a vázlat síkjában. Ha a betűtípus még nincs betöltve, üres (és betölti). */
export function textPieces(c) {
  const hit = curveCache.get(c);
  if (hit) return hit;
  const L = localLayout(c);
  if (!L) { loadFont(c.font).catch(() => {}); return []; }
  const T = xform(c);
  const out = L.pieces.map((pc) => (pc.k === 'line' ? { k: 'line', a: T(pc.a), b: T(pc.b) } : { k: 'bez', p: pc.p.map(T) }));
  curveCache.set(c, out);
  return out;
}

/** A szöveg befoglaló téglalapjának sarkai (a vázlat síkjában) – kijelöléshez, méretbuborékhoz. */
export function textBox(c) {
  const L = localLayout(c);
  const w = L ? L.width : (c.text || '').length * c.size * 0.6;
  const h = c.size;
  let x0 = 0;
  if (c.align === 'center') x0 = -w / 2; else if (c.align === 'right') x0 = -w;
  const T = xform(c);
  const lines = String(c.text || '').split('\n').length;
  const lh = L ? L.lineH : c.size * 1.4;
  const yb = -(lines - 1) * lh;
  return [T([x0, yb]), T([x0 + w, yb]), T([x0 + w, h]), T([x0, h])];
}
