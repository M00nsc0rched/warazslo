// Síkbeli elrendezés: a vázlat görbéiből zárt régiók (lyukakkal) számítása.
import { curvePieces, intersect, splitPiece, evalAt, derivAt, flatten, reversePiece, dist, sub, angleOf, TAU, polar } from "./geom2d.js";

const VTOL = 1e-5; // csúcs-összevonási tűrés (mm)

/**
 * curves: vázlat entitások (a szerkesztő görbéket kihagyja)
 * return: { regions: [{ key, loops:[[seg]], polys:[[[x,y]]], area, centroid, curveIds }], edges }
 * seg: {t:'line',a,b} | {t:'arc',a,m,b} | {t:'circle',c,r} | {t:'bez',p:[4]}
 */
export function computeRegions(curves) {
  // 1) darabok
  const pieces = [];
  for (const c of curves) {
    if (c.construction || c.t === 'point') continue;
    for (const pc of curvePieces(c)) pieces.push({ pc, curveId: c.id, params: [] });
  }
  if (!pieces.length) return { regions: [] };

  // 2) páronkénti metszések
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const hits = intersect(pieces[i].pc, pieces[j].pc, 1e-6);
      for (const h of hits) { pieces[i].params.push(h.ta); pieces[j].params.push(h.tb); }
    }
  }

  // 3) élek darabolással
  const rawEdges = [];
  for (const p of pieces) {
    for (const sp of splitPiece(p.pc, p.params)) rawEdges.push({ pc: sp, curveId: p.curveId });
  }

  // 4) csúcsok összevonása
  const verts = [];
  const grid = new Map();
  const cell = VTOL * 10;
  const keyOf = (x, y) => `${Math.floor(x / cell)}_${Math.floor(y / cell)}`;
  function vid(p) {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${gx + dx}_${gy + dy}`);
        if (!list) continue;
        for (const i of list) if (dist(verts[i].p, p) < VTOL) return i;
      }
    }
    const i = verts.length;
    verts.push({ p: [p[0], p[1]], out: [] });
    const k = keyOf(p[0], p[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
    return i;
  }

  let edges = [];
  for (const e of rawEdges) {
    const a = vid(evalAt(e.pc, 0));
    const b = vid(evalAt(e.pc, 1));
    if (a === b && e.pc.k === 'line') continue; // elfajult
    if (a === b && e.pc.k === 'bez' && dist(e.pc.p[0], e.pc.p[1]) + dist(e.pc.p[2], e.pc.p[3]) < VTOL) continue;
    edges.push({ ...e, a, b, mid: evalAt(e.pc, 0.5) });
  }

  // 5) duplikált élek (átfedő görbék) szűrése
  const seen = [];
  edges = edges.filter((e) => {
    for (const s of seen) {
      if (((s.a === e.a && s.b === e.b) || (s.a === e.b && s.b === e.a)) && dist(s.mid, e.mid) < VTOL * 10) return false;
    }
    seen.push(e);
    return true;
  });

  // 6) lógó élek eltávolítása
  let changed = true;
  while (changed) {
    changed = false;
    const deg = new Array(verts.length).fill(0);
    for (const e of edges) { deg[e.a]++; deg[e.b]++; }
    const keep = edges.filter((e) => e.a === e.b || (deg[e.a] > 1 && deg[e.b] > 1));
    if (keep.length !== edges.length) { edges = keep; changed = true; }
  }
  if (!edges.length) return { regions: [] };

  // 7) félélek + szögrendezés
  const half = [];
  edges.forEach((e, i) => {
    const h1 = { e: i, from: e.a, to: e.b, rev: false };
    const h2 = { e: i, from: e.b, to: e.a, rev: true };
    h1.twin = h2; h2.twin = h1;
    half.push(h1, h2);
  });
  for (const v of verts) v.out = [];
  for (const h of half) {
    const e = edges[h.e];
    const t = h.rev ? 1 - 1e-3 : 1e-3;
    const q = evalAt(e.pc, t);
    const p = verts[h.from].p;
    // Szög a kiinduló csúcsból egy közeli pont felé (görbület szerinti holtverseny-feloldás)
    h.angle = angleOf(sub(q, p));
    verts[h.from].out.push(h);
  }
  for (const v of verts) v.out.sort((x, y) => x.angle - y.angle);
  for (const v of verts) v.out.forEach((h, i) => { h.idx = i; });

  const next = (h) => {
    const v = verts[h.to];
    const tw = h.twin;
    const n = v.out.length;
    const i = tw.idx;
    return v.out[(i - 1 + n) % n];
  };

  // 8) ciklusok bejárása
  const cycles = [];
  for (const h of half) {
    if (h.used) continue;
    const cyc = [];
    let cur = h;
    let guard = 0;
    while (!cur.used && guard++ < 100000) {
      cur.used = true;
      cyc.push(cur);
      cur = next(cur);
    }
    if (cur !== h) continue; // nem záródó (nem várt)
    cycles.push(cyc);
  }

  // 9) ciklus geometria: szegmensek, lapított poligon, előjeles terület
  const comp = components(verts.length, edges);
  const infos = cycles.map((cyc) => {
    const segs = [];
    const poly = [];
    let exact = 0;
    for (const h of cyc) {
      const e = edges[h.e];
      const A = verts[h.from].p, B = verts[h.to].p;
      const pc = h.rev && e.pc.k === 'bez' ? reversePiece(e.pc) : e.pc;
      segs.push(toSeg(pc, A, B, h.from === h.to));
      exact += pieceArea(e.pc) * (h.rev ? -1 : 1);
      const { pts } = flatten(e.pc, { minN: e.pc.k === 'bez' ? 16 : 1 });
      if (h.rev) pts.reverse();
      pts.pop();
      poly.push(...pts);
    }
    const area = Math.abs(exact - signedArea(poly)) < Math.abs(exact) * 0.2 + 1e-6 ? exact : signedArea(poly);
    return { cyc, segs, poly, area, comp: comp[cyc[0].from], curveIds: [...new Set(cyc.map((h) => edges[h.e].curveId))] };
  });

  const pos = infos.filter((c) => c.area > 1e-9);
  const neg = infos.filter((c) => c.area < -1e-9);

  // 10) lyukak hozzárendelése: minden negatív (külső határ) ciklus a legkisebb tartalmazó pozitív régió lyuka
  const holes = new Map(pos.map((p) => [p, []]));
  for (const n of neg) {
    const probe = n.poly[0];
    let best = null;
    for (const p of pos) {
      if (p.comp === n.comp) continue;
      if (p.area < Math.abs(n.area) - 1e-9) continue;
      if (pointInPoly(probe, p.poly) && (!best || p.area < best.area)) best = p;
    }
    if (best) holes.get(best).push(n);
  }

  const regions = pos.map((p) => {
    const hs = holes.get(p);
    const area = p.area - hs.reduce((s, h) => s + Math.abs(h.area), 0);
    const loops = [p.segs, ...hs.map((h) => h.segs)];
    const polys = [p.poly, ...hs.map((h) => h.poly)];
    const centroid = regionLabelPoint(p.poly, hs.map((h) => h.poly));
    const curveIds = [...new Set([...p.curveIds, ...hs.flatMap((h) => h.curveIds)])].sort();
    const key = `${curveIds.join(',')}|${Math.round(area * 1000)}|${Math.round(centroid[0] * 100)},${Math.round(centroid[1] * 100)}`;
    return { key, loops, polys, area, centroid, curveIds };
  });
  return { regions };
}

function toSeg(pc, A, B, closedLoop) {
  if (pc.k === 'line') return { t: 'line', a: A, b: B };
  if (pc.k === 'arc' || pc.k === 'circle') {
    if (closedLoop && (pc.k === 'circle' || Math.abs(pc.a1 - pc.a0 - TAU) < 1e-9)) return { t: 'circle', c: pc.c, r: pc.r };
    return { t: 'arc', a: A, m: polar(pc.c, pc.r, (pc.a0 + pc.a1) / 2), b: B };
  }
  if (pc.k === 'bez') {
    const p = pc.p.map((q) => [q[0], q[1]]);
    p[0] = A; p[3] = B;
    return { t: 'bez', p };
  }
  return { t: 'line', a: A, b: B };
}

function components(n, edges) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of edges) { const a = find(e.a), b = find(e.b); if (a !== b) parent[a] = b; }
  return parent.map((_, i) => find(i));
}

export function signedArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInRegion(p, region) {
  if (!pointInPoly(p, region.polys[0])) return false;
  for (let i = 1; i < region.polys.length; i++) if (pointInPoly(p, region.polys[i])) return false;
  return true;
}

/** Címke pont a régió belsejében (nem feltétlenül a súlypont). */
function regionLabelPoint(outer, holes) {
  // súlypont
  let cx = 0, cy = 0, A = 0;
  for (let i = 0, n = outer.length; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n];
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; A += f;
  }
  let c = A !== 0 ? [cx / (3 * A), cy / (3 * A)] : outer[0];
  const reg = { polys: [outer, ...holes] };
  if (pointInRegion(c, reg)) return c;
  // vízszintes pásztázás a súlypont magasságában
  let best = null;
  const ys = [c[1]];
  let minY = Infinity, maxY = -Infinity;
  for (const p of outer) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let k = 1; k < 10; k++) ys.push(minY + (maxY - minY) * k / 10);
  for (const y of ys) {
    const xs = [];
    for (const poly of reg.polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { w, p: [(xs[i] + xs[i + 1]) / 2, y] };
    }
    if (best) return best.p;
  }
  return c;
}

/** Pontos előjeles terület-hozzájárulás (Green-tétel): ½∮(x dy − y dx) */
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
function pieceArea(pc) {
  switch (pc.k) {
    case 'line': return (pc.a[0] * pc.b[1] - pc.b[0] * pc.a[1]) / 2;
    case 'circle': return Math.PI * pc.r * pc.r + (pc.c[0] * 0 - pc.c[1] * 0);
    case 'arc': {
      const { c, r, a0, a1 } = pc;
      return (r * r * (a1 - a0) + r * (c[0] * (Math.sin(a1) - Math.sin(a0)) - c[1] * (Math.cos(a1) - Math.cos(a0)))) / 2;
    }
    default: {
      let s = 0;
      for (let i = 0; i < 8; i++) {
        const t = (GL_X[i] + 1) / 2;
        const p = evalAt(pc, t), d = derivAt(pc, t);
        s += GL_W[i] * (p[0] * d[1] - p[1] * d[0]);
      }
      return s / 4;
    }
  }
}
