// Automatikus végigtesztelés a böngészőben: await (await import('/tools/app-test.js')).run()
import * as THREE from 'three';
import { canonicalFrame } from '../js/sketch/manager.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run() {
  const app = window.app;
  const log = [];
  const ok = (m) => { log.push(`OK   ${m}`); console.log('OK', m); };
  const fail = (m, e) => { log.push(`FAIL ${m}: ${e && (e.stack || e.message) || e}`); console.error('FAIL', m, e); };
  const step = async (name, fn) => { try { const r = await fn(); ok(`${name}${r ? ' – ' + r : ''}`); } catch (e) { fail(name, e); } };
  const settle = async () => { await sleep(50); for (let i = 0; i < 100 && app.kernel.busyCount > 0; i++) await sleep(50); await sleep(30); };
  const bodies = () => app.doc.state.bodies;
  const gfx = (id) => app.bodies.gfx.get(id);
  const faceWhere = (id, pred) => { const g = gfx(id); return g.data.faces.findIndex((f, i) => pred(f, i)); };
  const runTool = async (id, opts, fn) => {
    app.startTool(id, opts);
    const t = app.tool;
    if (!t) throw new Error('az eszköz nem indult el');
    if (t.ready) await t.ready;
    if (fn) await fn(t);
    await settle();
    if (t.runner) await t.runner.idle();
    if (t.error) throw new Error('előnézet hiba: ' + t.error);
    await t.done();
    await settle();
    if (app.tool === t) throw new Error('az eszköz nem zárult le');
  };
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p, i, a) => ({ t: 'line', a: p, b: a[(i + 1) % 4] }));

  await step('új projekt', async () => { await app.newProject('Automata teszt'); await settle(); });
  const XY = canonicalFrame(V(0, 0, 1), V());
  let sk;
  await step('téglalap + kör vázlat', async () => {
    const r = app.addCurves(XY, [...rect(0, 0, 60, 40), { t: 'circle', c: [45, 20], r: 8 }], 'Vázlat');
    sk = r.sketchId;
    await settle();
    const regs = app.sketches.regions(app.doc.sketch(sk));
    if (regs.length !== 2) throw new Error(`régiók: ${regs.length}`);
    return `${regs.length} régió`;
  });
  await step('kihúzás (lyukas lap) 20 mm', async () => {
    const regs = app.sketches.regions(app.doc.sketch(sk));
    const big = regs.find((r) => r.loops.length === 2);
    app.setSelection([{ type: 'region', sketchId: sk, key: big.key }]);
    await runTool('extrude', {}, (t) => t.change('d1', 20));
    if (bodies().length !== 1) throw new Error('nincs test');
    return `térfogat ${Math.round(gfx(bodies()[0].id).data.volume)}`;
  });
  const b1 = () => bodies()[0].id;
  await step('lap tolása +5 (tetőlap)', async () => {
    const f = faceWhere(b1(), (x) => x.type === 'PLANE' && x.normal[2] > 0.9);
    app.setSelection([{ type: 'face', bodyId: b1(), index: f, rev: app.doc.body(b1()).rev }]);
    await runTool('extrude', {}, (t) => t.change('d1', 5));
    return `térfogat ${Math.round(gfx(b1()).data.volume)}`;
  });
  await step('lekerekítés 3 mm (függőleges élek)', async () => {
    const g = gfx(b1());
    const edges = g.data.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'LINE' && Math.abs(e.dir[2]) > 0.99).map(({ i }) => i);
    app.setSelection(edges.map((i) => ({ type: 'edge', bodyId: b1(), index: i, rev: app.doc.body(b1()).rev })));
    await runTool('fillet', {}, (t) => t.change('r', 3));
    return `${edges.length} él`;
  });
  await step('élletörés 1 mm (tetőlap élei)', async () => {
    const f = faceWhere(b1(), (x) => x.type === 'PLANE' && x.normal[2] > 0.9);
    app.setSelection([{ type: 'face', bodyId: b1(), index: f, rev: app.doc.body(b1()).rev }]);
    await runTool('chamfer', {}, (t) => t.change('r', 1));
  });
  await step('héjazás 2 mm (alsó lap nyitva)', async () => {
    const f = faceWhere(b1(), (x) => x.type === 'PLANE' && x.normal[2] < -0.9);
    app.setSelection([{ type: 'face', bodyId: b1(), index: f, rev: app.doc.body(b1()).rev }]);
    await runTool('shell', {}, (t) => t.change('t', 2));
    return `térfogat ${Math.round(gfx(b1()).data.volume)}`;
  });
  await step('furat M5 kúpos a tetőn', async () => {
    const f = faceWhere(b1(), (x) => x.type === 'PLANE' && x.normal[2] > 0.9);
    app.setSelection([{ type: 'face', bodyId: b1(), index: f, rev: app.doc.body(b1()).rev }]);
    await runTool('hole', {}, (t) => { t.change('kind', 'countersink'); t.change('size', 'M5'); });
  });
  await step('henger beszúrás', async () => {
    await runTool('primitive', { type: 'cylinder' }, (t) => { t.frame.origin.set(100, 0, 0); t.change('r', 10); t.change('h', 30); });
    return `${bodies().length} test`;
  });
  const cyl = () => bodies()[bodies().length - 1].id;
  await step('mozgatás +20 Y, forgatás 30°', async () => {
    app.setSelection([{ type: 'body', bodyId: cyl() }]);
    await runTool('move', {}, (t) => { t.change('y', 20); t.change('axis', 2); t.change('angle', 30); });
  });
  await step('tükrözés YZ síkra (másolat)', async () => {
    app.setSelection([{ type: 'body', bodyId: cyl() }]);
    await runTool('mirror', {}, (t) => t.change('main', 'YZ'));
    return `${bodies().length} test`;
  });
  await step('kör menti kiosztás 4 db', async () => {
    app.setSelection([{ type: 'body', bodyId: cyl() }]);
    await runTool('pattern', {}, (t) => { t.change('kind', 'circular'); t.change('count', 4); });
    return `${bodies().length} test`;
  });
  await step('boole egyesítés (2 test)', async () => {
    const ids = bodies().slice(-2).map((b) => b.id);
    app.setSelection(ids.map((id) => ({ type: 'body', bodyId: id })));
    const n0 = bodies().length;
    await runTool('boolean', { type: 'union' });
    return `${n0} -> ${bodies().length} test`;
  });
  await step('boole kivonás', async () => {
    await runTool('primitive', { type: 'box' }, (t) => { t.frame.origin.set(30, 20, 20); t.change('w', 10); t.change('d', 100); t.change('h', 10); });
    const box = bodies()[bodies().length - 1].id;
    app.setSelection([{ type: 'body', bodyId: b1() }, { type: 'body', bodyId: box }]);
    await runTool('boolean', { type: 'subtract' });
    return `${bodies().length} test`;
  });
  await step('forgatás (revolve) XZ vázlatból', async () => {
    const XZ = canonicalFrame(V(0, -1, 0), V(0, 0, 0));
    const r = app.addCurves(XZ, rect(-80, 0, -70, 20), 'Vázlat');
    await settle();
    const reg = app.sketches.regions(app.doc.sketch(r.sketchId))[0];
    app.setSelection([{ type: 'region', sketchId: r.sketchId, key: reg.key }]);
    const n0 = bodies().length;
    await runTool('revolve', {}, (t) => { t.change('axisKey', 'v'); t.change('angle', 270); });
    return `${n0} -> ${bodies().length} test`;
  });
  await step('loft két régió között', async () => {
    const F1 = canonicalFrame(V(0, 0, 1), V(0, 0, 0));
    const r1 = app.addCurves(F1, rect(-40, -80, -20, -60), 'Vázlat');
    const F2 = canonicalFrame(V(0, 0, 1), V(0, 0, 30));
    const r2 = app.addCurves(F2, [{ t: 'circle', c: [-30, -70], r: 6 }], 'Vázlat');
    await settle();
    const a = app.sketches.regions(app.doc.sketch(r1.sketchId))[0], b = app.sketches.regions(app.doc.sketch(r2.sketchId))[0];
    app.setSelection([{ type: 'region', sketchId: r1.sketchId, key: a.key }, { type: 'region', sketchId: r2.sketchId, key: b.key }]);
    await runTool('loft');
  });
  await step('söprés spline mentén', async () => {
    const XZ = canonicalFrame(V(0, -1, 0), V(0, 100, 0));
    const prof = app.addCurves(canonicalFrame(V(0, 0, 1), V(0, 0, 0)), [{ t: 'circle', c: [0, 100], r: 3 }], 'Vázlat');
    const path = app.addCurves(XZ, [{ t: 'spline', pts: [[0, 0], [10, 20], [30, 30], [50, 40]], closed: false }], 'Vázlat');
    await settle();
    const pr = app.sketches.regions(app.doc.sketch(prof.sketchId)).find((r) => Math.abs(r.area - Math.PI * 9) < 1);
    app.setSelection([{ type: 'region', sketchId: prof.sketchId, key: pr.key }, { type: 'curve', sketchId: path.sketchId, curveId: path.curves[0].id }]);
    await runTool('sweep');
  });
  await step('szétvágás XZ síkkal', async () => {
    app.setSelection([{ type: 'body', bodyId: b1() }]);
    const n0 = bodies().length;
    await runTool('split', {}, (t) => t.change('main', 'XZ'));
    return `${n0} -> ${bodies().length} test`;
  });
  await step('lap eltolás (hengeres lap)', async () => {
    const id = bodies().find((b) => gfx(b.id).data.faces.some((f) => f.type === 'CYLINDRE')).id;
    const f = faceWhere(id, (x) => x.type === 'CYLINDRE');
    app.setSelection([{ type: 'face', bodyId: id, index: f, rev: app.doc.body(id).rev }]);
    await runTool('offsetFace', {}, (t) => t.change('d', 1));
  });
  await step('méretezés ×1,5', async () => {
    const id = bodies()[bodies().length - 1].id;
    app.setSelection([{ type: 'body', bodyId: id }]);
    await runTool('scale', {}, (t) => t.change('f', 1.5));
  });
  await step('fogaskerék m2 z18', async () => {
    await runTool('gear', {}, (t) => { t.frame.origin.set(0, -150, 0); t.change('z', 18); });
  });
  await step('csavar M6×20', async () => {
    await runTool('gear', { kind: 'bolt' }, (t) => { t.frame.origin.set(60, -150, 0); });
  });
  await step('szerkesztősík eltolva', async () => {
    app.setSelection([]);
    await runTool('plane', { mode: 'offset' }, (t) => t.change('offset', 40));
    return `${app.doc.state.planes.length} sík`;
  });
  await step('mérés két lap között', async () => {
    const id = b1();
    const top = faceWhere(id, (x) => x.type === 'PLANE' && x.normal[2] > 0.9);
    const r = await app.kernel.query('distance', { a: { kind: 'face', body: app.doc.bodyRef(id), index: top }, b: { kind: 'point', point: [0, 0, 0] } });
    return `távolság ${r.distance.toFixed(2)}`;
  });
  await step('metszeti nézet be/ki', async () => {
    app.startTool('section');
    app.tool.change('offset', 5);
    app.tool.turnOff();
  });
  await step('STEP export', async () => { const buf = await app.kernel.query('exportFile', { format: 'step', bodies: bodies().map((b) => ({ id: b.id, rev: b.rev })) }); return `${buf.byteLength} bájt`; });
  await step('STL export', async () => { const buf = await app.kernel.query('exportFile', { format: 'stl', bodies: bodies().map((b) => ({ id: b.id, rev: b.rev })) }); return `${buf.byteLength} bájt`; });
  await step('vetület (rajz)', async () => { const p = await app.kernel.query('projection', { bodies: [app.doc.bodyRef(b1())], view: 'front' }); return `${p.visible.length} látható, ${p.hidden.length} rejtett él`; });
  await step('visszavonás / újra / ugrás', async () => {
    const n = app.doc.history().length;
    app.undo(); app.undo(); await settle();
    app.redo(); await settle();
    app.doc.jumpTo(3); await settle();
    app.doc.jumpTo(n - 1); await settle();
    return `${n} lépés`;
  });
  await step('mentés', async () => { await app.saveNow(true); });
  console.log(log.join('\n'));
  return log.join('\n');
}
