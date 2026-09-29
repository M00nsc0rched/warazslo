// DXF (AutoCAD R12, ASCII) írás és olvasás.
// Írás: vonal, polivonal, kör, ív, szöveg – rétegekkel és szaggatott vonaltípussal (rejtett élek).
// Olvasás: LINE, ARC, CIRCLE, LWPOLYLINE / POLYLINE (ívszakaszokkal), SPLINE, ELLIPSE, POINT,
// TEXT / MTEXT, INSERT (blokkok, eltolás/forgatás/méretezés) -> Warázsló vázlatgörbék (mm).
import { curvePolylines, transformCurves2D as transformCurves } from '../sketch/geom2d.js';

const TAU = Math.PI * 2;
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const num = (v) => (Math.abs(v) < 1e-12 ? '0.0' : String(+v.toFixed(9)));

/** Nem-ASCII karakterek DXF kódolása (\U+XXXX). */
function dxfString(s) {
  return String(s).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

export class DxfWriter {
  constructor({ units = 'mm' } = {}) {
    this.units = units;
    this.layers = new Map();
    this.out = [];
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
    this.addLayer('0', 7);
  }

  addLayer(name, color = 7, ltype = 'CONTINUOUS') { this.layers.set(name, { color, ltype }); return this; }

  _g(code, v) { this.out.push(String(code), typeof v === 'number' ? num(v) : String(v)); }
  _ext(x, y) { const b = this.box; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  _ent(type, layer) { this._g(0, type); this._g(8, layer || '0'); }

  line(a, b, layer) {
    this._ent('LINE', layer);
    this._g(10, a[0]); this._g(20, a[1]); this._g(30, 0);
    this._g(11, b[0]); this._g(21, b[1]); this._g(31, 0);
    this._ext(a[0], a[1]); this._ext(b[0], b[1]);
  }

  polyline(pts, layer, closed = false) {
    if (pts.length < 2) return;
    if (pts.length === 2 && !closed) { this.line(pts[0], pts[1], layer); return; }
    this._ent('POLYLINE', layer);
    this._g(66, 1); this._g(10, 0); this._g(20, 0); this._g(30, 0); this._g(70, closed ? 1 : 0);
    for (const p of pts) {
      this._ent('VERTEX', layer);
      this._g(10, p[0]); this._g(20, p[1]); this._g(30, 0);
      this._ext(p[0], p[1]);
    }
    this._ent('SEQEND', layer);
  }

  circle(c, r, layer) {
    this._ent('CIRCLE', layer);
    this._g(10, c[0]); this._g(20, c[1]); this._g(30, 0); this._g(40, r);
    this._ext(c[0] - r, c[1] - r); this._ext(c[0] + r, c[1] + r);
  }

  /** Ív az óramutatóval ellentétes irányban, a0 -> a1 (radián). */
  arc(c, r, a0, a1, layer) {
    this._ent('ARC', layer);
    this._g(10, c[0]); this._g(20, c[1]); this._g(30, 0); this._g(40, r);
    let s = deg(a0) % 360; if (s < 0) s += 360;
    let e = deg(a1) % 360; if (e < 0) e += 360;
    this._g(50, s); this._g(51, e);
    for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; this._ext(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)); }
  }

  /** Szöveg: halign 0 bal, 1 közép, 2 jobb; valign 0 alapvonal, 2 közép. */
  text(p, h, s, layer, { rot = 0, halign = 0, valign = 0 } = {}) {
    this._ent('TEXT', layer);
    this._g(10, p[0]); this._g(20, p[1]); this._g(30, 0);
    this._g(40, h); this._g(1, dxfString(s));
    if (rot) this._g(50, rot);
    if (halign || valign) {
      this._g(72, halign);
      this._g(11, p[0]); this._g(21, p[1]); this._g(31, 0);
      this._g(73, valign);
    }
    this._ext(p[0], p[1]);
  }

  /** Warázsló vázlatgörbék (2D) kiírása. A spline, ellipszis és szöveg polivonalként kerül ki. */
  curves(curves, layer = '0', constructionLayer = null) {
    for (const c of curves) {
      const L = c.construction ? constructionLayer : layer;
      if (c.construction && !constructionLayer) continue;
      switch (c.t) {
        case 'line': this.line(c.a, c.b, L); break;
        case 'circle': this.circle(c.c, c.r, L); break;
        case 'arc': this.arc(c.c, c.r, c.a0, c.a1, L); break;
        case 'point':
          this._ent('POINT', L); this._g(10, c.p[0]); this._g(20, c.p[1]); this._g(30, 0); this._ext(c.p[0], c.p[1]);
          break;
        default:
          for (const pl of curvePolylines(c)) {
            if (pl.length < 2) continue;
            const closed = Math.hypot(pl[0][0] - pl[pl.length - 1][0], pl[0][1] - pl[pl.length - 1][1]) < 1e-9;
            this.polyline(closed ? pl.slice(0, -1) : pl, L, closed);
          }
      }
    }
  }

  toString() {
    const o = [];
    const g = (c, v) => o.push(String(c), typeof v === 'number' ? num(v) : String(v));
    const b = Number.isFinite(this.box[0]) ? this.box : [0, 0, 0, 0];
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, this.units === 'in' ? 1 : 4);
    g(9, '$MEASUREMENT'); g(70, this.units === 'in' ? 0 : 1);
    g(9, '$EXTMIN'); g(10, b[0]); g(20, b[1]); g(30, 0);
    g(9, '$EXTMAX'); g(10, b[2]); g(20, b[3]); g(30, 0);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed __ __ __'); g(72, 65); g(73, 2); g(40, 3); g(49, 2); g(49, -1);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, this.layers.size);
    for (const [name, l] of this.layers) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, l.color); g(6, l.ltype); }
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    o.push(...this.out);
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
}

// ================================================================ olvasás
const UNIT_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 14: 100 };

function tokenize(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; } // hibás sor: újraszinkronizálás
    pairs.push([code, lines[i + 1]]);
  }
  return pairs;
}

function decodeText(s) {
  return String(s)
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z][^;\\]*;/g, '') // MTEXT formázókódok (\fArial;, \H2.5; …)
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
}

/** Entitások csoportosítása (0-s kódnál új entitás kezdődik). */
function entitiesOf(pairs, start, endName) {
  const ents = [];
  let cur = null, i = start;
  for (; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      const name = v.trim();
      if (name === endName || name === 'ENDSEC') break;
      cur = { type: name, g: [] };
      ents.push(cur);
    } else if (cur) cur.g.push([c, v]);
  }
  return { ents, end: i };
}

const gv = (e, code, def) => { const p = e.g.find((x) => x[0] === code); return p ? p[1] : def; };
const gf = (e, code, def = 0) => { const v = gv(e, code); return v == null ? def : parseFloat(v); };
const ga = (e, code) => e.g.filter((x) => x[0] === code).map((x) => parseFloat(x[1]));

/** Ívszakasz két pont között (bulge = tan(θ/4)). */
function bulgeArc(p1, p2, b) {
  const th = 4 * Math.atan(b);
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return null;
  const r = d / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const h = r * Math.cos(th / 2) * Math.sign(b); // a középpont a húrtól balra (b>0)
  const nx = -dy / d, ny = dx / d;
  const c = [mx + nx * h, my + ny * h];
  let a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  let a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  if (b < 0) [a0, a1] = [a1, a0];
  while (a1 <= a0) a1 += TAU;
  return { t: 'arc', c, r: Math.abs(r), a0, a1 };
}

function polyCurves(verts, closed) {
  const out = [];
  const n = verts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 1e-9) continue;
    if (Math.abs(a.b || 0) > 1e-9) { const arc = bulgeArc(a.p, b.p, a.b); if (arc) out.push(arc); }
    else out.push({ t: 'line', a: a.p, b: b.p });
  }
  return out;
}

/** B-spline kiértékelése (de Boor), mintavételezés pontsorrá. */
function sampleBSpline(deg, knots, ctrl, weights, n) {
  const p = deg, K = knots, P = ctrl;
  const lo = K[p], hi = K[K.length - p - 1];
  const out = [];
  for (let s = 0; s <= n; s++) {
    let u = lo + (hi - lo) * s / n;
    if (s === n) u = hi - 1e-12 * Math.max(1, Math.abs(hi));
    let k = p;
    while (k < K.length - p - 2 && u >= K[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= p; j++) {
      const i = k - p + j, w = weights ? weights[i] : 1;
      d.push([P[i][0] * w, P[i][1] * w, w]);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = K[i + p - r + 1] - K[i];
        const al = den ? (u - K[i]) / den : 0;
        d[j] = [0, 1, 2].map((t) => (1 - al) * d[j - 1][t] + al * d[j][t]);
      }
    }
    out.push([d[p][0] / d[p][2], d[p][1] / d[p][2]]);
  }
  return out;
}

function compose(A, B) { // A ∘ B
  const [a, b, c, d] = A.m, [e, f, g, h] = B.m;
  return { m: [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h], t: [a * B.t[0] + b * B.t[1] + A.t[0], c * B.t[0] + d * B.t[1] + A.t[1]] };
}

/**
 * DXF szöveg -> { curves (mm), units, count, skipped: {TYPE: n}, bbox }
 * Csak a 2D (XY) geometriát olvassuk; a Z koordinátát elhagyjuk.
 */
export function parseDxf(text) {
  const pairs = tokenize(text);
  let unit = 0;
  const blocks = new Map();
  let entities = [];
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 9 && v.trim() === '$INSUNITS') { const n = pairs[i + 1]; if (n && n[0] === 70) unit = parseInt(n[1], 10); }
    if (c === 2 && pairs[i - 1] && pairs[i - 1][0] === 0 && pairs[i - 1][1].trim() === 'SECTION') {
      const sec = v.trim();
      if (sec === 'ENTITIES') { const r = entitiesOf(pairs, i + 1, 'ENDSEC'); entities = r.ents; i = r.end; }
      else if (sec === 'BLOCKS') {
        const r = entitiesOf(pairs, i + 1, 'ENDSEC');
        let curBlock = null;
        for (const e of r.ents) {
          if (e.type === 'BLOCK') { curBlock = { name: gv(e, 2, '').trim(), base: [gf(e, 10), gf(e, 20)], ents: [] }; blocks.set(curBlock.name, curBlock); }
          else if (e.type === 'ENDBLK') curBlock = null;
          else if (curBlock) curBlock.ents.push(e);
        }
        i = r.end;
      }
    }
  }
  const skipped = {};
  let count = 0;

  const convert = (ents, depth) => {
    const out = [];
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      switch (e.type) {
        case 'LINE': out.push({ t: 'line', a: [gf(e, 10), gf(e, 20)], b: [gf(e, 11), gf(e, 21)] }); break;
        case 'CIRCLE': out.push({ t: 'circle', c: [gf(e, 10), gf(e, 20)], r: gf(e, 40) }); break;
        case 'ARC': {
          const a0 = rad(gf(e, 50)); let a1 = rad(gf(e, 51));
          while (a1 <= a0) a1 += TAU;
          out.push({ t: 'arc', c: [gf(e, 10), gf(e, 20)], r: gf(e, 40), a0, a1 });
          break;
        }
        case 'POINT': out.push({ t: 'point', p: [gf(e, 10), gf(e, 20)] }); break;
        case 'LWPOLYLINE': {
          const verts = [];
          let cur = null;
          for (const [c, v] of e.g) {
            if (c === 10) { cur = { p: [parseFloat(v), 0], b: 0 }; verts.push(cur); }
            else if (c === 20 && cur) cur.p[1] = parseFloat(v);
            else if (c === 42 && cur) cur.b = parseFloat(v);
          }
          out.push(...polyCurves(verts, (parseInt(gv(e, 70, '0'), 10) & 1) === 1));
          break;
        }
        case 'POLYLINE': {
          const flags = parseInt(gv(e, 70, '0'), 10);
          const verts = [];
          while (k + 1 < ents.length && ents[k + 1].type === 'VERTEX') {
            k++;
            const vx = ents[k];
            if (parseInt(gv(vx, 70, '0'), 10) & 16) continue; // spline keretpont
            verts.push({ p: [gf(vx, 10), gf(vx, 20)], b: gf(vx, 42, 0) });
          }
          if (k + 1 < ents.length && ents[k + 1].type === 'SEQEND') k++;
          if (flags & (16 | 64)) { skipped['3D POLYLINE'] = (skipped['3D POLYLINE'] || 0) + 1; break; }
          out.push(...polyCurves(verts, (flags & 1) === 1));
          break;
        }
        case 'SPLINE': {
          const degree = parseInt(gv(e, 71, '3'), 10);
          const knots = ga(e, 40);
          const cx = ga(e, 10), cy = ga(e, 20);
          const ctrl = cx.map((x, i) => [x, cy[i]]);
          const w = ga(e, 41);
          const fx = ga(e, 11), fy = ga(e, 21);
          const closed = (parseInt(gv(e, 70, '0'), 10) & 1) === 1;
          let pts;
          if (degree === 1 && ctrl.length >= 2) { // elsőfokú spline = töröttvonal
            out.push(...polyCurves(ctrl.map((p) => ({ p, b: 0 })), closed));
            break;
          }
          if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
            pts = sampleBSpline(degree, knots, ctrl, w.length === ctrl.length ? w : null, Math.max(8, ctrl.length * 4));
          } else if (fx.length >= 2) pts = fx.map((x, i) => [x, fy[i]]);
          else { skipped.SPLINE = (skipped.SPLINE || 0) + 1; break; }
          if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
          out.push({ t: 'spline', pts, closed });
          break;
        }
        case 'ELLIPSE': {
          const c = [gf(e, 10), gf(e, 20)];
          const mx = gf(e, 11), my = gf(e, 21);
          const ratio = gf(e, 40, 1);
          const s = gf(e, 41, 0), en = gf(e, 42, TAU);
          const rx = Math.hypot(mx, my), ry = rx * ratio, rot = Math.atan2(my, mx);
          const span = ((en - s) % TAU + TAU) % TAU;
          if (span < 1e-6 || Math.abs(span - TAU) < 1e-6) out.push({ t: 'ellipse', c, rx, ry, rot });
          else {
            const n = Math.max(8, Math.ceil(span / (TAU / 48)));
            const cs = Math.cos(rot), sn = Math.sin(rot);
            const pts = [];
            for (let i = 0; i <= n; i++) {
              const t = s + span * i / n;
              const x = rx * Math.cos(t), y = ry * Math.sin(t);
              pts.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
            }
            out.push({ t: 'spline', pts });
          }
          break;
        }
        case 'TEXT': case 'MTEXT': {
          let str = e.type === 'MTEXT' ? e.g.filter((x) => x[0] === 3).map((x) => x[1]).join('') + (gv(e, 1, '')) : gv(e, 1, '');
          str = decodeText(str).trim();
          if (!str) break;
          const h = gf(e, 40, 2.5);
          let p = [gf(e, 10), gf(e, 20)];
          let align = 'left';
          let rot = rad(gf(e, 50, 0));
          if (e.type === 'TEXT') {
            const ha = parseInt(gv(e, 72, '0'), 10);
            if (ha === 1 || ha === 4) align = 'center'; else if (ha === 2) align = 'right';
            if (ha) p = [gf(e, 11, p[0]), gf(e, 21, p[1])];
          } else {
            const ap = parseInt(gv(e, 71, '1'), 10);
            const col = (ap - 1) % 3;
            align = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
            const dx = gf(e, 11, NaN), dy = gf(e, 21, NaN);
            if (Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy)) rot = Math.atan2(dy, dx);
            if (ap <= 3) p = [p[0] + Math.sin(rot) * h, p[1] - Math.cos(rot) * h]; // felső igazítás -> alapvonal (közelítés)
          }
          out.push({ t: 'text', text: str, font: 'sans', size: h, p, rot, align, spacing: 0 });
          break;
        }
        case 'INSERT': {
          const b = blocks.get(gv(e, 2, '').trim());
          if (!b || depth > 8) { skipped.INSERT = (skipped.INSERT || 0) + 1; break; }
          const sx = gf(e, 41, 1), sy = gf(e, 42, 1), r = rad(gf(e, 50, 0));
          const cs = Math.cos(r), sn = Math.sin(r);
          const nx = Math.max(1, parseInt(gv(e, 70, '1'), 10)), ny = Math.max(1, parseInt(gv(e, 71, '1'), 10));
          const colS = gf(e, 44, 0), rowS = gf(e, 45, 0);
          const inner = convert(b.ents, depth + 1);
          for (let ix = 0; ix < nx; ix++) {
            for (let iy = 0; iy < ny; iy++) {
              // x' = R·S·(x - base) + ins + R·(ix·colS, iy·rowS)
              const S = { m: [sx, 0, 0, sy], t: [-b.base[0] * sx, -b.base[1] * sy] };
              const off = [ix * colS, iy * rowS];
              const R = { m: [cs, -sn, sn, cs], t: [gf(e, 10) + cs * off[0] - sn * off[1], gf(e, 20) + sn * off[0] + cs * off[1]] };
              out.push(...transformCurves(inner, compose(R, S)));
            }
          }
          break;
        }
        case 'VERTEX': case 'SEQEND': case 'ATTRIB': case 'ATTDEF': break;
        default: skipped[e.type] = (skipped[e.type] || 0) + 1;
      }
    }
    return out;
  };

  let curves = convert(entities, 0);
  const f = UNIT_MM[unit] || 1;
  if (f !== 1) curves = transformCurves(curves, { m: [f, 0, 0, f], t: [0, 0] });
  curves = curves.filter((c) => (c.t === 'circle' || c.t === 'arc' ? c.r > 1e-9 : c.t === 'line' ? Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]) > 1e-9 : true));
  count = curves.length;
  // befoglaló doboz
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p) => { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); };
  for (const c of curves) {
    if (c.t === 'line') { add(c.a); add(c.b); }
    else if (c.t === 'circle' || c.t === 'arc') { add([c.c[0] - c.r, c.c[1] - c.r]); add([c.c[0] + c.r, c.c[1] + c.r]); }
    else if (c.t === 'ellipse') { const r = Math.max(c.rx, c.ry); add([c.c[0] - r, c.c[1] - r]); add([c.c[0] + r, c.c[1] + r]); }
    else if (c.t === 'spline') c.pts.forEach(add);
    else if (c.p) add(c.p);
  }
  return { curves, units: unit, count, skipped, bbox: Number.isFinite(bb[0]) ? bb : null };
}
