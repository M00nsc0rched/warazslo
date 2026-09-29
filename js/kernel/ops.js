// Modellező műveletek. Minden művelet: (args, ctx) => { results, removed, info }
// results: [{ shape, role: 'modified'|'new', sourceId?, name? }]
import { R, oc, scope, KernelError, v3, pnt, dir, vec, wrap, fuse, cut, common, fuseAll,
  translateShape, transformShape, mirrorShape, scaleShape, fixOrientation, faceAt, edgeAt,
  volumeOf, areaOf, faceMidPointNormal, makeCompound, outerWireOf, innerWiresOf } from './occ.js';

export const OPS = {};

const EPS = 1e-7;

// ================================================================ segédek

/** Síkkeret: { origin, xDir, yDir, normal } — 2D (u,v) -> 3D */
function planeMap(pl) {
  const { origin: o, xDir: x, yDir: y } = pl;
  return (p) => [o[0] + p[0] * x[0] + p[1] * y[0], o[1] + p[0] * x[1] + p[1] * y[1], o[2] + p[0] * x[2] + p[1] * y[2]];
}

/** Egy vázlat-hurok (szegmenslista) -> Wire */
function loopToWire(loop, plane) {
  const P = planeMap(plane);
  const edges = [];
  for (const s of loop) {
    if (s.t === 'line') {
      const a = P(s.a), b = P(s.b);
      if (v3.len(v3.sub(a, b)) < 1e-9) continue;
      edges.push(R.makeLine(a, b));
    } else if (s.t === 'arc') {
      edges.push(R.makeThreePointArc(P(s.a), P(s.m), P(s.b)));
    } else if (s.t === 'circle') {
      edges.push(R.makeCircle(s.r, P(s.c), plane.normal));
    } else if (s.t === 'bez') {
      edges.push(R.makeBezierCurve(s.p.map(P)));
    } else if (s.t === 'ellipse') {
      const xd = v3.add(v3.mul(plane.xDir, Math.cos(s.rot || 0)), v3.mul(plane.yDir, Math.sin(s.rot || 0)));
      if (s.rx >= s.ry) edges.push(R.makeEllipse(s.rx, s.ry, P(s.c), plane.normal, xd));
      else edges.push(R.makeEllipse(s.ry, s.rx, P(s.c), plane.normal, v3.cross(plane.normal, xd)));
    }
  }
  if (!edges.length) throw new KernelError('Üres profil');
  return R.assembleWire(edges);
}

/** Vázlat régió (külső hurok + lyukak) -> sík lap, normálisa = vázlat normálisa */
function regionFace(region) {
  const r = scope();
  try {
    const pl = region.plane;
    const outer = loopToWire(region.loops[0], pl);
    const holes = region.loops.slice(1).map((l) => loopToWire(l, pl));
    const ax3 = r(new oc.gp_Ax3(r(pnt(pl.origin)), r(dir(pl.normal)), r(dir(pl.xDir))));
    const gpln = r(new oc.gp_Pln(ax3));
    const fm = r(new oc.BRepBuilderAPI_MakeFace(gpln, outer.wrapped, true));
    for (const h of holes) fm.Add(h.wrapped);
    if (!fm.IsDone()) throw new KernelError('A profilból nem lehet lapot készíteni');
    const fixer = r(new oc.ShapeFix_Face(fm.Face()));
    fixer.FixOrientation();
    fixer.Perform();
    return wrap(fixer.Face());
  } finally { r.free(); }
}

/** Profil -> { face, normal } ; profil: {kind:'face', body, face} | {kind:'region', plane, loops} */
function profileFace(p, ctx) {
  if (p.kind === 'face') {
    const body = ctx.body(p.body);
    const face = faceAt(body, p.face);
    if (face.geomType !== 'PLANE') throw new KernelError('Csak sík lap húzható ki');
    const n = faceMidPointNormal(face).normal;
    return { face, normal: n, sourceBodyId: p.body.id };
  }
  if (p.kind === 'region') {
    return { face: regionFace(p), normal: v3.norm(p.plane.normal) };
  }
  throw new KernelError('Ismeretlen profil');
}

function prism(face, v) {
  const r = scope();
  try {
    const b = r(new oc.BRepPrimAPI_MakePrism(face.wrapped, r(vec(v)), false, true));
    return fixOrientation(wrap(b.Shape()));
  } finally { r.free(); }
}

function revol(face, origin, axis, angleDeg) {
  const r = scope();
  try {
    const ax = r(new oc.gp_Ax1(r(pnt(origin)), r(dir(axis))));
    const ang = Math.max(-360, Math.min(360, angleDeg));
    const b = Math.abs(Math.abs(ang) - 360) < 1e-9
      ? r(new oc.BRepPrimAPI_MakeRevol(face.wrapped, ax, false))
      : r(new oc.BRepPrimAPI_MakeRevol(face.wrapped, ax, ang * Math.PI / 180, false));
    return fixOrientation(wrap(b.Shape()));
  } finally { r.free(); }
}

/** Test szétbontása különálló szilárd testekre. */
function explode(shape) {
  const solids = shape.solids || [];
  if (solids.length <= 1) return solids.length === 1 ? [solids[0]] : (isEmpty(shape) ? [] : [shape]);
  return solids;
}

function isEmpty(shape) {
  try {
    if (shape.isNull) return true;
    return (shape.faces || []).length === 0;
  } catch (e) { return true; }
}

/** Egy forrás test módosított eredménye (több darab esetén új testek is). */
function pushModified(results, removed, sourceId, shape) {
  const parts = explode(shape);
  if (!parts.length) { removed.push(sourceId); return; }
  results.push({ shape: parts[0], role: 'modified', sourceId });
  for (let i = 1; i < parts.length; i++) results.push({ shape: parts[i], role: 'new', sourceId });
}

function pushNew(results, shape, name) {
  for (const s of explode(shape)) results.push({ shape: s, role: 'new', name });
}

/**
 * Az eszköz-test (tool) alkalmazása a célokra a művelettípus szerint.
 * op: 'new' | 'join' | 'cut' | 'intersect'
 */
/** Érintkezik-e / metszi-e a két test (befoglaló doboz + távolság). */
function touches(a, b) {
  const r = scope();
  try {
    if (a.boundingBox.isOut(b.boundingBox)) return false;
    const d = r(new oc.BRepExtrema_DistShapeShape(a.wrapped, b.wrapped));
    return d.IsDone() ? d.Value() <= 1e-6 : true;
  } catch (e) {
    return true;
  } finally { r.free(); }
}

function applyTool(tool, op, targets, ctx, name) {
  const results = [];
  const removed = [];
  if (op !== 'new' && targets && targets.length) {
    const hit = targets.filter((t) => touches(ctx.body(t), tool));
    if (!hit.length) {
      if (op === 'join') op = 'new';
      else throw new KernelError(op === 'cut' ? 'A kivágás egyetlen testet sem érint' : 'Nincs közös rész egyetlen testtel sem');
    }
    targets = hit;
  }
  if (op === 'new' || !targets || !targets.length) {
    pushNew(results, tool, name);
    return { results, removed };
  }
  if (op === 'join') {
    // az első célhoz fűzzük; a többi érintett célt is beolvasztjuk
    let acc = ctx.body(targets[0]);
    acc = fuse(acc, tool);
    for (let i = 1; i < targets.length; i++) {
      acc = fuse(acc, ctx.body(targets[i]));
      removed.push(targets[i].id);
    }
    pushModified(results, removed, targets[0].id, acc);
  } else if (op === 'cut') {
    for (const t of targets) pushModified(results, removed, t.id, cut(ctx.body(t), tool));
  } else if (op === 'intersect') {
    for (const t of targets) pushModified(results, removed, t.id, common(ctx.body(t), tool));
  }
  return { results, removed };
}

// ================================================================ primitívek

function frameTrsf(frame) {
  // lokális (x,y,z) -> globális, frame: {origin, xDir, yDir, normal}
  const { origin: o, xDir: x, yDir: y, normal: z } = frame;
  return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2]];
}

OPS.primitive = ({ type, p, frame, op = 'new', targets }, ctx) => {
  const r = scope();
  let s;
  try {
    switch (type) {
      case 'box': {
        const w = p.w, d = p.d, h = p.h;
        if (!(w > 0 && d > 0 && Math.abs(h) > 0)) throw new KernelError('Érvénytelen méret');
        s = R.makeBox([p.centered ? -w / 2 : 0, p.centered ? -d / 2 : 0, Math.min(0, h)], [p.centered ? w / 2 : w, p.centered ? d / 2 : d, Math.max(0, h)]);
        break;
      }
      case 'cylinder': {
        if (!(p.r > 0 && Math.abs(p.h) > 0)) throw new KernelError('Érvénytelen méret');
        s = R.makeCylinder(p.r, Math.abs(p.h), [0, 0, Math.min(0, p.h)], [0, 0, 1]);
        break;
      }
      case 'sphere': {
        if (!(p.r > 0)) throw new KernelError('Érvénytelen méret');
        s = wrap(r(new oc.BRepPrimAPI_MakeSphere(r(pnt([0, 0, 0])), p.r)).Shape());
        break;
      }
      case 'cone': {
        const r1 = Math.max(0, p.r1), r2 = Math.max(0, p.r2), h = Math.abs(p.h);
        if (!(h > 0) || (r1 <= 0 && r2 <= 0)) throw new KernelError('Érvénytelen méret');
        const pts = [[0, 0], [r1, 0], [r2, h], [0, h]].filter((q, i, arr) => i === 0 || Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) > 1e-9);
        const loop = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) loop.push({ t: 'line', a, b });
        }
        const face = regionFace({ plane: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] }, loops: [loop] });
        s = revol(face, [0, 0, 0], [0, 0, 1], 360);
        break;
      }
      case 'torus': {
        if (!(p.R > p.r && p.r > 0)) throw new KernelError('A csőátmérő túl nagy');
        s = wrap(r(new oc.BRepPrimAPI_MakeTorus(p.R, p.r)).Shape());
        break;
      }
      case 'wedge': {
        const face = regionFace({ plane: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
          loops: [[{ t: 'line', a: [0, 0], b: [p.w, 0] }, { t: 'line', a: [p.w, 0], b: [0, p.h] }, { t: 'line', a: [0, p.h], b: [0, 0] }]] });
        s = prism(face, [0, p.d, 0]);
        break;
      }
      default: throw new KernelError('Ismeretlen primitív');
    }
  } finally { r.free(); }
  const placed = frame ? transformShape(s, frameTrsf(frame)) : s;
  return applyTool(placed, op, targets, ctx, p.name);
};

// ================================================================ kihúzás

/**
 * args: { profiles, mode: 'one'|'two'|'sym', d1, d2, op, targets, taper? }
 * d1: kihúzás a normális irányába (lehet negatív), d2: ellenkező irány (two módban)
 */
OPS.extrude = (args, ctx) => {
  const { profiles, mode = 'one', d1 = 10, d2 = 0, op = 'new', targets = [] } = args;
  if (!profiles || !profiles.length) throw new KernelError('Nincs kijelölt profil');
  const solids = [];
  for (const p of profiles) {
    const { face, normal } = profileFace(p, ctx);
    if (mode === 'one') {
      if (Math.abs(d1) < 1e-6) continue;
      solids.push(prism(face, v3.mul(normal, d1)));
    } else if (mode === 'sym') {
      if (Math.abs(d1) < 1e-6) continue;
      const shifted = translateShape(face, v3.mul(normal, -Math.abs(d1) / 2));
      solids.push(prism(shifted, v3.mul(normal, Math.abs(d1))));
    } else {
      const parts = [];
      if (Math.abs(d1) > 1e-6) parts.push(prism(face, v3.mul(normal, d1)));
      if (Math.abs(d2) > 1e-6) parts.push(prism(face, v3.mul(normal, -d2)));
      if (parts.length) solids.push(fuseAll(parts));
    }
  }
  if (!solids.length) throw new KernelError('Nulla hosszú kihúzás');
  const tool = fuseAll(solids);
  return applyTool(tool, op, targets, ctx, args.name);
};

// ================================================================ forgatás (revolve)

OPS.revolve = (args, ctx) => {
  const { profiles, axis, angle = 360, op = 'new', targets = [], sym = false } = args;
  if (!profiles || !profiles.length) throw new KernelError('Nincs kijelölt profil');
  if (!axis) throw new KernelError('Nincs kijelölt tengely');
  const solids = [];
  for (const p of profiles) {
    const { face } = profileFace(p, ctx);
    if (sym) {
      const r = scope();
      try {
        // forgatás -angle/2-ről
        const trsf = r(new oc.gp_Trsf());
        trsf.SetRotation(r(new oc.gp_Ax1(r(pnt(axis.origin)), r(dir(axis.dir)))), -angle / 2 * Math.PI / 180);
        const b = r(new oc.BRepBuilderAPI_Transform(face.wrapped, trsf, true));
        solids.push(revol(wrap(b.Shape()), axis.origin, axis.dir, angle));
      } finally { r.free(); }
    } else {
      solids.push(revol(face, axis.origin, axis.dir, angle));
    }
  }
  const tool = fuseAll(solids);
  return applyTool(tool, op, targets, ctx, args.name);
};

// ================================================================ söprés (sweep) és átmenet (loft)

function pathWire(path, ctx) {
  // path: { edges: [{body, edge}] } vagy { segs3d: [{t:'line',a,b}|{t:'arc',a,m,b}|{t:'bez',p}] }
  const edges = [];
  if (path.edges) {
    for (const e of path.edges) edges.push(edgeAt(ctx.body(e.body), e.edge));
  }
  if (path.segs) {
    for (const s of path.segs) {
      if (s.t === 'line') edges.push(R.makeLine(s.a, s.b));
      else if (s.t === 'arc') edges.push(R.makeThreePointArc(s.a, s.m, s.b));
      else if (s.t === 'bez') edges.push(R.makeBezierCurve(s.p));
      else if (s.t === 'circle') edges.push(R.makeCircle(s.r, s.c, s.n));
    }
  }
  if (!edges.length) throw new KernelError('Nincs kijelölt útvonal');
  return R.assembleWire(edges);
}

/** Többszakaszos útvonal helyettesítése egyetlen sima B-spline éllel. */
function smoothSpine(spine) {
  const N = 80;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(spine.pointAt(i / N).toTuple());
  return R.assembleWire([R.makeBSplineApproximation(pts, { tolerance: 1e-3, degMax: 6, degMin: 3 })]);
}

OPS.sweep = (args, ctx) => {
  const { profiles, path, op = 'new', targets = [], frenet = true } = args;
  const spine = pathWire(path, ctx);
  const faces = profiles.map((p) => profileFace(p, ctx).face);
  const sweepAll = (sp, mode) => faces.map((face) => {
    let s = R.genericSweep(outerWireOf(face), sp, { frenet, transitionMode: mode });
    for (const hole of innerWiresOf(face)) s = cut(s, R.genericSweep(hole, sp, { frenet, transitionMode: mode }));
    return fixOrientation(s);
  });
  // Az OCCT csősöprése többszakaszos gerincnél néha elhasal: fokozatos visszalépés
  const attempts = [() => sweepAll(spine, 'round'), () => sweepAll(spine, 'transformed'), () => sweepAll(smoothSpine(spine), 'round')];
  let lastErr = null;
  for (const a of attempts) {
    try {
      const solids = a();
      return applyTool(fuseAll(solids), op, targets, ctx, args.name);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
};

OPS.loft = (args, ctx) => {
  const { profiles, op = 'new', targets = [], ruled = false } = args;
  if (!profiles || profiles.length < 2) throw new KernelError('Legalább két profil kell');
  const wires = profiles.map((p) => outerWireOf(profileFace(p, ctx).face));
  const s = R.loft(wires, { ruled });
  return applyTool(fixOrientation(s), op, targets, ctx, args.name);
};

// ================================================================ lekerekítés / élletörés

OPS.fillet = ({ body, edges, radius }, ctx) => {
  const shape = ctx.body(body);
  if (!(radius > 0)) throw new KernelError('A sugár legyen pozitív');
  const r = scope();
  try {
    const mk = r(new oc.BRepFilletAPI_MakeFillet(shape.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    const all = shape.edges;
    for (const i of edges) {
      if (!all[i]) throw new KernelError('A kijelölt él már nem létezik');
      mk.Add(radius, all[i].wrapped);
    }
    mk.Build();
    if (!mk.IsDone()) throw new KernelError('A lekerekítés nem sikerült (túl nagy sugár?)');
    const res = [];
    const removed = [];
    pushModified(res, removed, body.id, wrap(mk.Shape()));
    return { results: res, removed };
  } finally { r.free(); }
};

OPS.chamfer = ({ body, edges, distance, distance2 }, ctx) => {
  const shape = ctx.body(body);
  if (!(distance > 0)) throw new KernelError('A távolság legyen pozitív');
  const r = scope();
  try {
    const mk = r(new oc.BRepFilletAPI_MakeChamfer(shape.wrapped));
    const all = shape.edges;
    for (const i of edges) {
      if (!all[i]) throw new KernelError('A kijelölt él már nem létezik');
      mk.Add(distance, all[i].wrapped);
    }
    mk.Build();
    if (!mk.IsDone()) throw new KernelError('Az élletörés nem sikerült (túl nagy érték?)');
    const res = [];
    const removed = [];
    pushModified(res, removed, body.id, wrap(mk.Shape()));
    return { results: res, removed };
  } finally { r.free(); }
};

// ================================================================ héjazás

OPS.shell = ({ body, faces = [], thickness, outward = false }, ctx) => {
  const shape = ctx.body(body);
  if (!(thickness > 0)) throw new KernelError('A falvastagság legyen pozitív');
  const r = scope();
  try {
    const list = r(new oc.NCollection_List_TopoDS_Shape());
    const all = shape.faces;
    for (const i of faces) {
      if (!all[i]) throw new KernelError('A kijelölt lap már nem létezik');
      list.Append(all[i].wrapped);
    }
    // több stratégia: ív-illesztés, metszés, önmetszés-kezelés
    const J = oc.GeomAbs_JoinType;
    const variants = [[J.GeomAbs_Arc, false, false], [J.GeomAbs_Intersection, true, false], [J.GeomAbs_Arc, true, true], [J.GeomAbs_Intersection, false, false]];
    let out = null;
    for (const [join, inter, self] of variants) {
      try {
        const mk = r(new oc.BRepOffsetAPI_MakeThickSolid());
        mk.MakeThickSolidByJoin(shape.wrapped, list, outward ? thickness : -thickness, 1e-3,
          oc.BRepOffset_Mode.BRepOffset_Skin, inter, self, join, false);
        mk.Build();
        if (!mk.IsDone()) continue;
        const s = fixOrientation(wrap(mk.Shape()));
        const v = Math.abs(volumeOf(s).volume);
        if (!(v > 1e-9) || v >= Math.abs(volumeOf(shape).volume) * (outward ? 100 : 1.0001)) continue;
        out = s;
        break;
      } catch (e) { /* következő változat */ }
    }
    if (!out) throw new KernelError('A héjazás nem sikerült (túl vastag fal vagy túl bonyolult geometria)');
    const res = [];
    const removed = [];
    pushModified(res, removed, body.id, out);
    return { results: res, removed };
  } finally { r.free(); }
};

// ================================================================ lap eltolás

function thickenFace(face, d) {
  // Általános lap vastagítás: eltolt lap + vonalzott oldalfalak, összevarrva
  const r = scope();
  try {
    const off = r(new oc.BRepOffsetAPI_MakeOffsetShape());
    off.PerformBySimple(face.wrapped, d);
    off.Build();
    if (!off.IsDone()) throw new KernelError('A lap eltolása nem sikerült');
    const offShape = wrap(off.Shape());
    const offFaces = offShape.faces;
    if (offFaces.length !== 1) throw new KernelError('A lap eltolása nem sikerült');
    const f2 = offFaces[0];
    const sew = r(new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false));
    sew.Add(face.wrapped);
    sew.Add(f2.wrapped);
    const w1 = [outerWireOf(face), ...innerWiresOf(face)];
    const w2 = [outerWireOf(f2), ...innerWiresOf(f2)];
    if (w1.length !== w2.length) throw new KernelError('A lap eltolása nem sikerült');
    for (let i = 0; i < w1.length; i++) {
      const side = R.loft([w1[i], w2[i]], { ruled: true }, true);
      for (const sf of side.faces) sew.Add(sf.wrapped);
    }
    sew.Perform();
    const sewed = wrap(sew.SewedShape());
    const shells = [];
    const exp = new oc.TopExp_Explorer(sewed.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) { shells.push(oc.TopoDS.Shell(exp.Current())); exp.Next(); }
    exp.delete();
    if (shells.length !== 1) throw new KernelError('A lap eltolása nem sikerült');
    const ms = r(new oc.BRepBuilderAPI_MakeSolid(shells[0]));
    const fix = r(new oc.ShapeFix_Solid(ms.Solid()));
    fix.Perform();
    return fixOrientation(wrap(fix.Solid()));
  } finally { r.free(); }
}

/** Hengeres lap sugarának változtatása: gyűrűszelet a lap szög- és tengelyirányú tartományán. */
function cylinderSlab(face, d) {
  const r = scope();
  try {
    const ad = r(new oc.BRepAdaptor_Surface(face.wrapped, false));
    const cyl = r(ad.Cylinder());
    const pos = r(cyl.Position());
    const t = (p) => [p.X(), p.Y(), p.Z()];
    const O = t(r(pos.Location()));
    const Z = t(r(pos.Direction()));
    const X = t(r(pos.XDirection()));
    const Y = t(r(pos.YDirection()));
    const rad = cyl.Radius();
    const { uMin, uMax, vMin, vMax } = face.UVBounds;
    const mp = faceMidPointNormal(face);
    const rel = v3.sub(mp.point, O);
    const radial = v3.norm(v3.sub(rel, v3.mul(Z, v3.dot(rel, Z))));
    const s = v3.dot(mp.normal, radial) >= 0 ? 1 : -1;
    const r2 = rad + s * d;
    if (r2 <= 1e-6) throw new KernelError('A sugár nullára vagy negatívra csökkenne');
    const ra = Math.min(rad, r2), rb = Math.max(rad, r2);
    const xDir = v3.add(v3.mul(X, Math.cos(uMin)), v3.mul(Y, Math.sin(uMin)));
    const plane = { origin: O, xDir, yDir: Z, normal: v3.cross(xDir, Z) };
    const loop = [
      { t: 'line', a: [ra, vMin], b: [rb, vMin] }, { t: 'line', a: [rb, vMin], b: [rb, vMax] },
      { t: 'line', a: [rb, vMax], b: [ra, vMax] }, { t: 'line', a: [ra, vMax], b: [ra, vMin] },
    ];
    const prof = regionFace({ plane, loops: [loop] });
    const ang = (uMax - uMin) * 180 / Math.PI;
    // a forgatás iránya: növekvő u felé (balsodrású tengelykeretnél Z ellentétes)
    const dirSign = v3.dot(Y, v3.cross(Z, X)) >= 0 ? 1 : -1;
    return revol(prof, O, v3.mul(Z, dirSign), Math.min(360, ang));
  } finally { r.free(); }
}

OPS.offsetFaces = ({ body, faces, distance }, ctx) => {
  let shape = ctx.body(body);
  if (Math.abs(distance) < 1e-6) throw new KernelError('Nulla eltolás');
  const all = shape.faces;
  const add = [];
  const sub = [];
  for (const i of faces) {
    const f = all[i];
    if (!f) throw new KernelError('A kijelölt lap már nem létezik');
    const n = faceMidPointNormal(f).normal;
    let slab;
    if (f.geomType === 'PLANE') slab = prism(f, v3.mul(n, distance));
    else if (f.geomType === 'CYLINDRE') slab = cylinderSlab(f, Math.abs(distance) * (distance > 0 ? 1 : -1));
    else slab = thickenFace(f, distance);
    (distance > 0 ? add : sub).push(slab);
  }
  if (add.length) shape = fuse(shape, fuseAll(add));
  if (sub.length) shape = cut(shape, fuseAll(sub));
  const res = [];
  const removed = [];
  pushModified(res, removed, body.id, shape);
  return { results: res, removed };
};

// ================================================================ boole

OPS.boolean = ({ target, tools, type, keepTools = false }, ctx) => {
  let acc = ctx.body(target);
  for (const t of tools) {
    const ts = ctx.body(t);
    if (type === 'union') acc = fuse(acc, ts);
    else if (type === 'subtract') acc = cut(acc, ts);
    else if (type === 'intersect') acc = common(acc, ts);
  }
  const res = [];
  const removed = keepTools ? [] : tools.map((t) => t.id);
  pushModified(res, removed, target.id, acc);
  return { results: res, removed };
};

// ================================================================ transzformációk

OPS.transform = ({ bodies, matrix, copy = false }, ctx) => {
  const results = [];
  for (const b of bodies) {
    const s = transformShape(ctx.body(b), matrix);
    if (copy) results.push({ shape: s, role: 'new', sourceId: b.id });
    else results.push({ shape: s, role: 'modified', sourceId: b.id });
  }
  return { results, removed: [] };
};

OPS.scale = ({ bodies, center, factor, copy = false }, ctx) => {
  if (!(factor > 0)) throw new KernelError('A szorzó legyen pozitív');
  const results = [];
  for (const b of bodies) {
    const s = scaleShape(ctx.body(b), center, factor);
    results.push({ shape: s, role: copy ? 'new' : 'modified', sourceId: b.id });
  }
  return { results, removed: [] };
};

OPS.mirror = ({ bodies, origin, normal, copy = true, merge = false }, ctx) => {
  const results = [];
  const removed = [];
  for (const b of bodies) {
    const src = ctx.body(b);
    const m = mirrorShape(src, origin, normal);
    if (merge) pushModified(results, removed, b.id, fuse(src, m));
    else if (copy) results.push({ shape: m, role: 'new', sourceId: b.id });
    else results.push({ shape: m, role: 'modified', sourceId: b.id });
  }
  return { results, removed };
};

function rotationMatrix(origin, axis, angleRad) {
  const [x, y, z] = v3.norm(axis);
  const c = Math.cos(angleRad), s = Math.sin(angleRad), t = 1 - c;
  const m = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
  const o = origin;
  const tx = o[0] - (m[0] * o[0] + m[1] * o[1] + m[2] * o[2]);
  const ty = o[1] - (m[3] * o[0] + m[4] * o[1] + m[5] * o[2]);
  const tz = o[2] - (m[6] * o[0] + m[7] * o[1] + m[8] * o[2]);
  return [m[0], m[1], m[2], tx, m[3], m[4], m[5], ty, m[6], m[7], m[8], tz];
}

OPS.pattern = (args, ctx) => {
  const { bodies, kind, count = 3, merge = false } = args;
  if (!(count >= 2)) throw new KernelError('Legalább 2 példány kell');
  const results = [];
  const removed = [];
  for (const b of bodies) {
    const src = ctx.body(b);
    const copies = [];
    for (let i = 1; i < count; i++) {
      let m;
      if (kind === 'linear') {
        const d = v3.mul(v3.norm(args.dir), args.spacing * i);
        m = [1, 0, 0, d[0], 0, 1, 0, d[1], 0, 0, 1, d[2]];
      } else {
        const total = args.angle ?? 360;
        const step = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / count : total / (count - 1);
        m = rotationMatrix(args.axis.origin, args.axis.dir, step * i * Math.PI / 180);
      }
      copies.push(transformShape(src, m));
    }
    if (merge) pushModified(results, removed, b.id, fuseAll([src, ...copies]));
    else for (const c of copies) results.push({ shape: c, role: 'new', sourceId: b.id });
  }
  return { results, removed };
};

// ================================================================ szétvágás

OPS.split = ({ body, tool }, ctx) => {
  const shape = ctx.body(body);
  const r = scope();
  try {
    const args = r(new oc.NCollection_List_TopoDS_Shape());
    args.Append(shape.wrapped);
    const tools = r(new oc.NCollection_List_TopoDS_Shape());
    let toolShape;
    if (tool.kind === 'plane') {
      const size = 1e5;
      const pl = r(new oc.gp_Pln(r(pnt(tool.origin)), r(dir(tool.normal))));
      toolShape = wrap(r(new oc.BRepBuilderAPI_MakeFace(pl, -size, size, -size, size)).Face());
    } else if (tool.kind === 'face') {
      toolShape = faceAt(ctx.body(tool.body), tool.face);
    } else if (tool.kind === 'body') {
      toolShape = ctx.body(tool.body);
    } else if (tool.kind === 'region') {
      toolShape = regionFace(tool);
    }
    tools.Append(toolShape.wrapped);
    const sp = r(new oc.BRepAlgoAPI_Splitter());
    sp.SetArguments(args);
    sp.SetTools(tools);
    sp.Build();
    if (sp.HasErrors()) throw new KernelError('A szétvágás nem sikerült');
    const out = wrap(sp.Shape());
    const res = [];
    const removed = [];
    pushModified(res, removed, body.id, out);
    if (res.length < 2) throw new KernelError('A vágósík nem metszi a testet');
    return { results: res, removed };
  } finally { r.free(); }
};

// ================================================================ furat varázsló

/**
 * args: { body, point, normal (a lap kifelé mutató normálisa), d, depth (0=átmenő),
 *         kind: 'simple'|'counterbore'|'countersink', cd, cdepth, angle, targets }
 */
function holeSolid(args, point, normal) {
  const { d, kind = "simple" } = args;
  if (!(d > 0)) throw new KernelError('Az átmérő legyen pozitív');
  const n = v3.norm(normal);
  const through = !(args.depth > 0);
  const depth = through ? 1e4 : args.depth;
  // profil a tengelyen átmenő síkban, lokális (radiális u, mélység v lefelé)
  let xDir = Math.abs(n[2]) < 0.9 ? v3.norm(v3.cross([0, 0, 1], n)) : [1, 0, 0];
  const plane = { origin: v3.add(point, v3.mul(n, 0.01)), xDir, yDir: v3.mul(n, -1), normal: v3.cross(xDir, v3.mul(n, -1)) };
  const r0 = d / 2;
  const pts = [[0, 0]];
  const top = 0.01; // kicsit a lap fölé nyúlik
  if (kind === 'counterbore' && args.cd > d && args.cdepth > 0) {
    pts.push([args.cd / 2, 0], [args.cd / 2, args.cdepth + top], [r0, args.cdepth + top]);
  } else if (kind === 'countersink' && args.cd > d) {
    const ang = (args.angle || 90) * Math.PI / 180;
    const h = (args.cd / 2 - r0) / Math.tan(ang / 2);
    pts.push([args.cd / 2, 0], [r0, h + top]);
  } else {
    pts.push([r0, 0]);
  }
  const tipDepth = depth + top;
  pts.push([r0, tipDepth]);
  if (!through && args.tip !== false) pts.push([0, tipDepth + r0 / Math.tan(59 * Math.PI / 180)]);
  else pts.push([0, tipDepth]);
  const loop = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) loop.push({ t: 'line', a, b });
  }
  const face = regionFace({ plane, loops: [loop] });
  return revol(face, plane.origin, n, 360);
}

OPS.hole = (args, ctx) => {
  const tools = [holeSolid(args, args.point, args.normal)];
  for (const e of args.extra || []) tools.push(holeSolid(args, e.point, e.normal));
  const targets = args.targets && args.targets.length ? args.targets : [args.body];
  return applyTool(fuseAll(tools), "cut", targets, ctx);
};

// ================================================================ import / export

OPS.importFile = async ({ format, data, name }) => {
  const blob = new Blob([data]);
  let shape;
  if (format === 'step') shape = await R.importSTEP(blob);
  else if (format === 'stl') shape = await R.importSTL(blob);
  else throw new KernelError('Nem támogatott formátum');
  const results = [];
  const solids = shape.solids || [];
  if (solids.length) solids.forEach((s, i) => results.push({ shape: s, role: 'new', name: solids.length > 1 ? `${name} ${i + 1}` : name }));
  else results.push({ shape, role: 'new', name });
  return { results, removed: [] };
};

OPS.exportFile = async ({ format, bodies, names, colors, tolerance }, ctx) => {
  const shapes = bodies.map((b) => ctx.body(b));
  let blob;
  if (format === 'step') {
    blob = R.exportSTEP(shapes.map((shape, i) => ({ shape, name: names?.[i] || `Test ${i + 1}`, color: colors?.[i] })), { unit: 'MM', modelUnit: 'MM' });
  } else if (format === 'stl') {
    const comp = shapes.length === 1 ? shapes[0] : makeCompound(shapes);
    blob = comp.blobSTL({ binary: true, tolerance: tolerance || 0.01, angularTolerance: 0.1 });
  } else if (format === 'brep') {
    const comp = shapes.length === 1 ? shapes[0] : makeCompound(shapes);
    blob = new Blob([comp.serialize()]);
  } else throw new KernelError('Nem támogatott formátum');
  const buf = await blob.arrayBuffer();
  return { info: buf, transfer: [buf] };
};

// ================================================================ mérés és tulajdonságok

function entityShape(ent, ctx) {
  if (ent.kind === 'point') return R.makeVertex(ent.point);
  const body = ctx.body(ent.body);
  if (ent.kind === 'body') return body;
  if (ent.kind === 'face') return faceAt(body, ent.index);
  if (ent.kind === 'edge') return edgeAt(body, ent.index);
  throw new KernelError('Ismeretlen elem');
}

OPS.distance = ({ a, b }, ctx) => {
  const sa = entityShape(a, ctx);
  const sb = entityShape(b, ctx);
  const r = scope();
  try {
    const d = r(new oc.BRepExtrema_DistShapeShape(sa.wrapped, sb.wrapped));
    if (!d.IsDone() || d.NbSolution() < 1) throw new KernelError('A távolság nem mérhető');
    const p1 = r(d.PointOnShape1(1));
    const p2 = r(d.PointOnShape2(1));
    return { info: { distance: d.Value(), p1: [p1.X(), p1.Y(), p1.Z()], p2: [p2.X(), p2.Y(), p2.Z()] } };
  } finally { r.free(); }
};

OPS.properties = ({ bodies }, ctx) => {
  const out = [];
  for (const b of bodies) {
    const s = ctx.body(b);
    const v = volumeOf(s);
    const a = areaOf(s);
    const [lo, hi] = s.boundingBox.bounds;
    out.push({ id: b.id, volume: Math.abs(v.volume), center: v.center, area: a.area, bbox: [...lo, ...hi] });
  }
  return { info: out };
};

OPS.faceProps = ({ body, face }, ctx) => {
  const f = faceAt(ctx.body(body), face);
  return { info: { area: areaOf(f).area } };
};

// ================================================================ 2D rajz (vetület, rejtett élek)

OPS.projection = ({ bodies, view }, ctx) => {
  // view: 'front'|'top'|'right'|'iso'|... ; eredmény: 2D szakaszlisták (látható + rejtett)
  const shapes = bodies.map((b) => ctx.body(b));
  const comp = shapes.length === 1 ? shapes[0] : makeCompound(shapes);
  const camMap = {
    front: [[0, -1, 0], [1, 0, 0]], back: [[0, 1, 0], [-1, 0, 0]], top: [[0, 0, 1], [1, 0, 0]],
    bottom: [[0, 0, -1], [1, 0, 0]], right: [[1, 0, 0], [0, 1, 0]], left: [[-1, 0, 0], [0, -1, 0]],
    iso: [[1, -1, 1], [1, 1, 0]],
  };
  const [d, x] = camMap[view] || camMap.front;
  const cam = new R.ProjectionCamera([0, 0, 0], d, x);
  const { visible, hidden } = R.makeProjectedEdges(comp, cam, true);
  const toPolys = (edges) => edges.map((e) => {
    const n = Math.max(2, Math.min(64, Math.ceil(e.length / 0.5)));
    const isLine = e.geomType === 'LINE';
    const pts = [];
    const cnt = isLine ? 1 : n;
    for (let i = 0; i <= cnt; i++) { const p = e.pointAt(i / cnt).toTuple(); pts.push([p[0], p[1]]); }
    return pts;
  });
  return { info: { visible: toPolys(visible), hidden: toPolys(hidden) } };
};

// ================================================================ topológiai lekérdezések

/** A megadott lapokat határoló élek indexei. */
OPS.faceEdges = ({ body, faces }, ctx) => {
  const shape = ctx.body(body);
  const edges = shape.edges;
  const allFaces = shape.faces;
  const out = new Set();
  for (const fi of faces) {
    const f = allFaces[fi];
    if (!f) continue;
    for (const fe of f.edges) {
      const idx = edges.findIndex((e) => e.isSame(fe));
      if (idx >= 0) out.add(idx);
    }
  }
  return { info: [...out] };
};

/** Él középpontja, érintője és a szomszédos lapok normálisai (a fogantyúkhoz). */
OPS.edgeFrame = ({ body, edge }, ctx) => {
  const shape = ctx.body(body);
  const e = edgeAt(shape, edge);
  const mid = e.pointAt(0.5).toTuple();
  const tangent = v3.norm(e.tangentAt(0.5).toTuple());
  const normals = [];
  for (const f of shape.faces) {
    if (!f.edges.some((x) => x.isSame(e))) continue;
    try { normals.push(v3.norm(f.normalAt(mid).toTuple())); } catch (err) { /* */ }
  }
  return { info: { point: mid, tangent, normals } };
};

/** Egy test adott lapjai egy tengelyhez / síkhoz (pl. forgatási tengely hengeres lapból). */
OPS.faceAxis = ({ body, face }, ctx) => {
  const f = faceAt(ctx.body(body), face);
  const info = faceSurfaceInfoLite(f);
  return { info };
};

function faceSurfaceInfoLite(f) {
  const mp = faceMidPointNormal(f);
  return { type: f.geomType, point: mp.point, normal: mp.normal, center: f.center.toTuple() };
}

// ================================================================ összetett (generátorok)
/** Több részművelet eredményének egyesítése egy testté. */
OPS.compose = async (args, ctx) => {
  const shapes = [];
  for (const part of args.parts) {
    const fn = OPS[part.name];
    if (!fn) throw new KernelError(`Ismeretlen részművelet: ${part.name}`);
    const r = await fn(part.args, ctx);
    for (const x of r.results) shapes.push(x.shape);
  }
  if (!shapes.length) throw new KernelError('Üres eredmény');
  return applyTool(fuseAll(shapes), args.op || 'new', args.targets || [], ctx, args.name);
};
