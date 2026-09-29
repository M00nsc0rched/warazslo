// OpenCascade / replicad segédfüggvények a kernel workerhez.
// Minden hossz mm-ben, szögek fokban (ha külön nincs jelölve).
import * as R from '../../vendor/replicad/replicad.js';

export { R };
export let oc = null;

export function setup(ocInstance) {
  oc = ocInstance;
  R.setOC(ocInstance);
}

export class KernelError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** Nyers OCC objektumok gyűjtése és felszabadítása egy műveleti blokk végén. */
export function scope() {
  const items = [];
  const r = (o) => { items.push(o); return o; };
  r.free = () => {
    for (let i = items.length - 1; i >= 0; i--) {
      try { items[i].delete(); } catch (e) { /* már törölt */ }
    }
    items.length = 0;
  };
  return r;
}

/** OCC C++ kivételek (számként dobódnak) olvasható hibává alakítása. */
const OCCT_HINTS = {
  StdFail_NotDone: 'a geometria nem építhető fel',
  Standard_ConstructionError: 'érvénytelen geometria',
  Standard_DomainError: 'érvénytelen tartomány',
  Standard_NullObject: 'hiányzó geometria',
  Standard_OutOfRange: 'érték tartományon kívül',
  Standard_Failure: 'geometriai hiba',
};

export function wrapError(err, fallback = 'A művelet nem sikerült') {
  if (err instanceof KernelError) return err;
  if (err && err.message && !(typeof WebAssembly !== 'undefined' && WebAssembly.Exception && err instanceof WebAssembly.Exception)) {
    return new KernelError(err.message, err.code);
  }
  // natív OCCT C++ kivétel
  try {
    if (oc && oc.getExceptionMessage && err != null) {
      const [type, msg] = oc.getExceptionMessage(err);
      const hint = OCCT_HINTS[type] || type;
      return new KernelError(`${fallback}: ${hint}${msg && msg !== type ? ` (${msg})` : ''}`, 'OCCT');
    }
  } catch (e) { /* nem kinyerhető */ }
  return new KernelError(`${fallback} (OCCT hiba)`, 'OCCT');
}

// ---------- vektor segédek (sima tömbökön) ----------
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

export const pnt = (p) => new oc.gp_Pnt(p[0], p[1], p[2]);
export const dir = (d) => new oc.gp_Dir(d[0], d[1], d[2]);
export const vec = (v) => new oc.gp_Vec(v[0], v[1], v[2]);
const tup = (p) => [p.X(), p.Y(), p.Z()];

// ---------- alakzat be/ki ----------
export function fromBrep(brep) {
  const s = R.deserializeShape(brep);
  if (!s || s.isNull) throw new KernelError('Sérült test adat', 'BREP');
  return s;
}

export function toBrep(shape) {
  return shape.serialize();
}

/** Nyers TopoDS_Shape becsomagolása replicad objektumba (GC kezeli). */
export function wrap(raw) {
  return R.cast(raw);
}

// ---------- transzformáció ----------
/**
 * 3x4-es mátrix (sorfolytonos: [a11,a12,a13,a14, a21,...,a34]) alkalmazása.
 * Nem törli az eredetit.
 */
export function transformShape(shape, m) {
  const r = scope();
  try {
    const trsf = r(new oc.gp_Trsf());
    trsf.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
    const b = r(new oc.BRepBuilderAPI_Transform(shape.wrapped, trsf, true));
    return wrap(b.Shape());
  } finally { r.free(); }
}

export function translateShape(shape, d) {
  return transformShape(shape, [1, 0, 0, d[0], 0, 1, 0, d[1], 0, 0, 1, d[2]]);
}

export function mirrorShape(shape, origin, normal) {
  const r = scope();
  try {
    const trsf = r(new oc.gp_Trsf());
    trsf.SetMirror(r(new oc.gp_Ax2(r(pnt(origin)), r(dir(normal)))));
    const b = r(new oc.BRepBuilderAPI_Transform(shape.wrapped, trsf, true));
    return wrap(b.Shape());
  } finally { r.free(); }
}

export function scaleShape(shape, center, factor) {
  const r = scope();
  try {
    const trsf = r(new oc.gp_Trsf());
    trsf.SetScale(r(pnt(center)), factor);
    const b = r(new oc.BRepBuilderAPI_Transform(shape.wrapped, trsf, true));
    return wrap(b.Shape());
  } finally { r.free(); }
}

// ---------- boole műveletek ----------
function glue(builder, mode) {
  if (mode === 'shift') builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
}

export function fuse(a, b) {
  const r = scope();
  try {
    const bld = r(new oc.BRepAlgoAPI_Fuse(a.wrapped, b.wrapped));
    bld.Build();
    if (bld.HasErrors()) throw new KernelError('Az egyesítés nem sikerült', 'BOOL');
    bld.SimplifyResult(true, true, 1e-3);
    return wrap(bld.Shape());
  } finally { r.free(); }
}

export function cut(a, b) {
  const r = scope();
  try {
    const bld = r(new oc.BRepAlgoAPI_Cut(a.wrapped, b.wrapped));
    bld.Build();
    if (bld.HasErrors()) throw new KernelError('A kivonás nem sikerült', 'BOOL');
    bld.SimplifyResult(true, true, 1e-3);
    return wrap(bld.Shape());
  } finally { r.free(); }
}

export function common(a, b) {
  const r = scope();
  try {
    const bld = r(new oc.BRepAlgoAPI_Common(a.wrapped, b.wrapped));
    bld.Build();
    if (bld.HasErrors()) throw new KernelError('A metszet nem sikerült', 'BOOL');
    bld.SimplifyResult(true, true, 1e-3);
    return wrap(bld.Shape());
  } finally { r.free(); }
}

export function fuseAll(shapes) {
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) acc = fuse(acc, shapes[i]);
  return acc;
}

// ---------- topológia ----------
export function listSolids(shape) {
  return shape.solids || [];
}

export function volumeOf(shape) {
  const r = scope();
  try {
    const props = r(new oc.GProp_GProps());
    oc.BRepGProp.VolumeProperties(shape.wrapped, props, false, false, false);
    return { volume: props.Mass(), center: tup(r(props.CentreOfMass())) };
  } finally { r.free(); }
}

export function areaOf(shape) {
  const r = scope();
  try {
    const props = r(new oc.GProp_GProps());
    oc.BRepGProp.SurfaceProperties(shape.wrapped, props, false, false);
    return { area: props.Mass(), center: tup(r(props.CentreOfMass())) };
  } finally { r.free(); }
}

/** Kifordított (negatív térfogatú) szilárd test javítása. */
export function fixOrientation(shape) {
  try {
    const { volume } = volumeOf(shape);
    if (volume < 0) {
      const raw = shape.wrapped.Reversed();
      return wrap(raw);
    }
  } catch (e) { /* nem szilárd */ }
  return shape;
}

/** Egy pont a lap felületén (UV tartomány közepén) és ott a kifelé mutató normális. */
export function faceMidPointNormal(face) {
  const r = scope();
  try {
    const { uMin, uMax, vMin, vMax } = face.UVBounds;
    const p = r(new oc.gp_Pnt());
    const n = r(new oc.gp_Vec());
    r(new oc.BRepGProp_Face(face.wrapped, false)).Normal((uMin + uMax) / 2, (vMin + vMax) / 2, p, n);
    return { point: [p.X(), p.Y(), p.Z()], normal: v3.norm([n.X(), n.Y(), n.Z()]) };
  } finally { r.free(); }
}

/** A lap külső hurka (a replicad outerWire() törli a lapot, ez nem). */
export function outerWireOf(face) {
  return wrap(oc.BRepTools.OuterWire(face.wrapped));
}

/** A lap belső hurkai (lyukak). */
export function innerWiresOf(face) {
  const outer = oc.BRepTools.OuterWire(face.wrapped);
  const out = [];
  const exp = new oc.TopExp_Explorer(face.wrapped, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (exp.More()) {
      const w = exp.Current();
      if (!w.IsSame(outer)) out.push(wrap(oc.TopoDS.Wire(w)));
      exp.Next();
    }
  } finally { exp.delete(); outer.delete(); }
  return out;
}

/** Nem törli a bemeneti alakzatokat (a replicad makeCompound igen). */
export function makeCompound(shapes) {
  const r = scope();
  try {
    const builder = r(new oc.TopoDS_Builder());
    const compound = r(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    for (const s of shapes) builder.Add(compound, s.wrapped);
    return wrap(compound);
  } finally { r.free(); }
}

export function faceSurfaceInfo(face) {
  const r = scope();
  try {
    const type = face.geomType;
    const center = face.center.toTuple();
    let normal = null;
    let point = center;
    try {
      const mp = faceMidPointNormal(face);
      normal = mp.normal;
      if (type !== 'PLANE') point = mp.point;
    } catch (e) { normal = null; }
    const info = { type, center, point, normal };
    const ad = r(new oc.BRepAdaptor_Surface(face.wrapped, false));
    if (type === 'CYLINDRE') {
      const cyl = r(ad.Cylinder());
      const axis = r(cyl.Axis());
      info.axisOrigin = tup(r(axis.Location()));
      info.axisDir = tup(r(axis.Direction()));
      info.radius = cyl.Radius();
    } else if (type === 'CONE' || type === 'TORUS' || type === 'REVOLUTION') {
      const axis = r(ad.AxeOfRevolution());
      info.axisOrigin = tup(r(axis.Location()));
      info.axisDir = tup(r(axis.Direction()));
    } else if (type === 'SPHERE') {
      const sph = r(ad.Sphere());
      info.sphereCenter = tup(r(sph.Location()));
      info.radius = sph.Radius();
    }
    try { info.area = areaOf(face).area; } catch (e) { info.area = 0; }
    return info;
  } finally { r.free(); }
}

export function edgeCurveInfo(edge) {
  const r = scope();
  try {
    const type = edge.geomType;
    const info = {
      type,
      a: edge.startPoint.toTuple(),
      b: edge.endPoint.toTuple(),
      mid: edge.pointAt(0.5).toTuple(),
      length: edge.length,
      closed: edge.isClosed,
    };
    if (type === 'CIRCLE') {
      const ad = r(new oc.BRepAdaptor_Curve(edge.wrapped));
      const c = r(ad.Circle());
      const ax = r(c.Axis());
      info.center = tup(r(c.Location()));
      info.normal = tup(r(ax.Direction()));
      info.radius = c.Radius();
    } else if (type === 'LINE') {
      info.dir = v3.norm(v3.sub(info.b, info.a));
    }
    return info;
  } finally { r.free(); }
}

// ---------- háló ----------
export function meshTolerances(shape) {
  let diag = 100;
  try {
    const [lo, hi] = shape.boundingBox.bounds;
    diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  } catch (e) { /* üres */ }
  const tolerance = Math.min(0.5, Math.max(0.004, diag * 0.0004));
  return { tolerance, angularTolerance: 0.12 };
}

/**
 * Megjelenítési háló + topológiai metaadatok egy testhez.
 * Visszaad: { data, transfer }
 */
export function buildBodyMesh(shape, { withInfo = true } = {}) {
  const tol = meshTolerances(shape);
  const m = shape.mesh(tol);
  const e = shape.meshEdges(tol);
  const data = {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    faceGroups: new Int32Array(m.faceGroups.length * 3),
    lines: new Float32Array(e.lines),
    edgeGroups: new Int32Array(e.edgeGroups.length * 3),
  };
  // A hálócsoportok hash-azonosítóit a topológiai sorrend szerinti indexre képezzük le.
  const faces = shape.faces;
  const edges = shape.edges;
  const faceIdx = hashIndex(faces);
  const edgeIdx = hashIndex(edges);
  m.faceGroups.forEach((g, i) => {
    data.faceGroups[i * 3] = g.start; data.faceGroups[i * 3 + 1] = g.count;
    data.faceGroups[i * 3 + 2] = faceIdx.has(g.faceId) ? faceIdx.get(g.faceId) : i;
  });
  e.edgeGroups.forEach((g, i) => {
    data.edgeGroups[i * 3] = g.start; data.edgeGroups[i * 3 + 1] = g.count;
    data.edgeGroups[i * 3 + 2] = edgeIdx.has(g.edgeId) ? edgeIdx.get(g.edgeId) : i;
  });

  if (withInfo) {
    data.faces = faces.map((f) => { try { return faceSurfaceInfo(f); } catch (err) { return { type: 'UNKNOWN' }; } });
    data.edges = edges.map((ed) => { try { return edgeCurveInfo(ed); } catch (err) { return { type: 'UNKNOWN' }; } });
    const verts = [];
    try {
      for (const v of iterVertices(shape)) verts.push(...v);
    } catch (err) { /* nincs csúcs */ }
    data.points = new Float32Array(verts);
    try {
      const [lo, hi] = shape.boundingBox.bounds;
      data.bbox = [...lo, ...hi];
    } catch (err) { data.bbox = [0, 0, 0, 0, 0, 0]; }
    try { data.volume = Math.abs(volumeOf(shape).volume); } catch (err) { data.volume = 0; }
    data.solidCount = (shape.solids || []).length;
  }
  const transfer = [data.vertices.buffer, data.normals.buffer, data.triangles.buffer, data.faceGroups.buffer, data.lines.buffer, data.edgeGroups.buffer];
  if (data.points) transfer.push(data.points.buffer);
  return { data, transfer };
}

function hashIndex(list) {
  const map = new Map();
  list.forEach((s, i) => {
    try { const h = s.hashCode; if (!map.has(h)) map.set(h, i); } catch (e) { /* */ }
  });
  return map;
}

function* iterVertices(shape) {
  const explorer = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const seen = [];
  try {
    while (explorer.More()) {
      const item = explorer.Current();
      if (!seen.some((s) => s.IsSame(item))) {
        seen.push(item);
        const vx = oc.TopoDS.Vertex(item);
        const p = oc.BRep_Tool.Pnt(vx);
        yield [p.X(), p.Y(), p.Z()];
        p.delete();
      }
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }
}

/** i-edik lap / él (a replicad iterTopo sorrendje szerint). */
export function faceAt(shape, index) {
  const f = shape.faces[index];
  if (!f) throw new KernelError('A kijelölt lap már nem létezik', 'REF');
  return f;
}

export function edgeAt(shape, index) {
  const e = shape.edges[index];
  if (!e) throw new KernelError('A kijelölt él már nem létezik', 'REF');
  return e;
}
