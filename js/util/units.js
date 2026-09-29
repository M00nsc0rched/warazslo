// Mértékegységek, számformázás és kifejezés-kiértékelés (belső egység: mm, fok)

export const LENGTH_UNITS = {
  mm: { f: 1, label: 'mm', dec: 2 },
  cm: { f: 10, label: 'cm', dec: 3 },
  m: { f: 1000, label: 'm', dec: 4 },
  in: { f: 25.4, label: 'in', dec: 3 },
};

let currentUnit = "mm";
let currentVars = new Map(); // név (kisbetűs) -> { v, dim }
export function setVariables(map) { currentVars = map || new Map(); }
export function getVariables() { return currentVars; }
export function setUnit(u) { if (LENGTH_UNITS[u]) currentUnit = u; }
export function getUnit() { return currentUnit; }

function trimNum(x, dec) {
  if (!isFinite(x)) return '–';
  let s = x.toFixed(dec);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s.replace('.', ',');
}

/** mm -> kijelzett szöveg a beállított egységben */
export function fmtLen(mm, { unit = true, dec } = {}) {
  const u = LENGTH_UNITS[currentUnit];
  const s = trimNum(mm / u.f, dec ?? u.dec);
  return unit ? `${s} ${u.label}` : s;
}

export function fmtLenParts(mm) {
  const u = LENGTH_UNITS[currentUnit];
  return { value: trimNum(mm / u.f, u.dec), unit: u.label };
}

export function fmtAngle(deg, { unit = true } = {}) {
  const s = trimNum(deg, 2);
  return unit ? `${s}°` : s;
}

export function fmtArea(mm2) {
  const u = LENGTH_UNITS[currentUnit];
  return `${trimNum(mm2 / (u.f * u.f), 2)} ${u.label}²`;
}

export function fmtVolume(mm3) {
  const u = LENGTH_UNITS[currentUnit];
  if (currentUnit === 'mm' && mm3 > 1e5) return `${trimNum(mm3 / 1000, 2)} cm³`;
  return `${trimNum(mm3 / (u.f ** 3), 2)} ${u.label}³`;
}

export function fmtMass(g) {
  if (g >= 1000) return `${trimNum(g / 1000, 3)} kg`;
  return `${trimNum(g, 2)} g`;
}

export function fmtNumber(x, dec = 3) { return trimNum(x, dec); }

/** hossz (mm) -> szerkeszthető szöveg a jelenlegi egységben */
export function lenToInput(mm) {
  const u = LENGTH_UNITS[currentUnit];
  return trimNum(mm / u.f, 4);
}

// ---------------------------------------------------------------- kifejezés

const UNIT_TOKENS = {
  mm: { dim: 1, f: 1 }, cm: { dim: 1, f: 10 }, m: { dim: 1, f: 1000 }, in: { dim: 1, f: 25.4 },
  '"': { dim: 1, f: 25.4 }, ft: { dim: 1, f: 304.8 }, "'": { dim: 1, f: 304.8 },
  '°': { dim: 2, f: 1 }, deg: { dim: 2, f: 1 }, rad: { dim: 2, f: 180 / Math.PI },
};

function tokenize(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').trim();
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const raw = s.slice(i, j).replace(',', '.');
      const v = parseFloat(raw);
      if (!isFinite(v)) throw new Error('Hibás szám');
      toks.push({ t: 'num', v });
      i = j; continue;
    }
    if ('+-*/^()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '"' || c === "'" || c === '°') { toks.push({ t: 'unit', v: c }); i++; continue; }
    if (/[a-zA-Z_áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(s[j])) j++;
      const w = s.slice(i, j).toLowerCase();
      if (UNIT_TOKENS[w]) toks.push({ t: 'unit', v: w });
      else toks.push({ t: 'id', v: w });
      i = j; continue;
    }
    throw new Error(`Ismeretlen karakter: ${c}`);
  }
  return toks;
}

/**
 * Kifejezés kiértékelése. kind: 'len' (eredmény mm) | 'angle' (fok) | 'num'
 * Egység nélküli számok a jelenlegi egységben értendők (összeadásnál/végeredménynél).
 */
export function evaluate(src, kind = "len", vars = currentVars) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (t, v) => { const k = toks[p]; if (k && k.t === t && (v === undefined || k.v === v)) { p++; return k; } return null; };
  const defF = kind === 'len' ? LENGTH_UNITS[currentUnit].f : 1;
  const wantDim = kind === 'len' ? 1 : kind === 'angle' ? 2 : 0;
  const lift = (a) => (a.dim === 0 && wantDim ? { v: a.v * defF, dim: wantDim } : a);

  function primary() {
    const k = peek();
    if (!k) throw new Error('Hiányos kifejezés');
    let val;
    if (eat('num')) val = { v: k.v, dim: 0 };
    else if (eat('op', '(')) {
      val = expr();
      if (!eat('op', ')')) throw new Error('Hiányzó zárójel');
    } else if (k.t === 'id') {
      p++;
      if (k.v === "pi") val = { v: Math.PI, dim: 0 };
      else if (vars && vars.has(k.v)) { const vv = vars.get(k.v); val = { v: vv.v, dim: vv.dim }; }
      else {
        const fns = { sqrt: Math.sqrt, sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), abs: Math.abs };
        const fn = fns[k.v];
        if (!fn) throw new Error(`Ismeretlen: ${k.v}`);
        if (!eat('op', '(')) throw new Error('Hiányzó zárójel');
        const a = expr();
        if (!eat('op', ')')) throw new Error('Hiányzó zárójel');
        val = { v: fn(a.v), dim: 0 };
      }
    } else throw new Error('Váratlan jel');
    const u = peek();
    if (u && u.t === 'unit') {
      p++;
      const ut = UNIT_TOKENS[u.v];
      if (val.dim !== 0) throw new Error('Kettőzött egység');
      val = { v: val.v * ut.f, dim: ut.dim };
    }
    return val;
  }
  function power() {
    const a = primary();
    if (eat('op', '^')) {
      const b = unary();
      return { v: Math.pow(a.v, b.v), dim: a.dim };
    }
    return a;
  }
  function unary() {
    if (eat('op', '-')) { const a = unary(); return { v: -a.v, dim: a.dim }; }
    if (eat('op', '+')) return unary();
    return power();
  }
  function term() {
    let a = unary();
    for (;;) {
      if (eat('op', '*')) { const b = unary(); a = { v: a.v * b.v, dim: a.dim || b.dim }; }
      else if (eat('op', '/')) {
        const b = unary();
        if (b.v === 0) throw new Error('Nullával osztás');
        a = { v: a.v / b.v, dim: a.dim && b.dim ? 0 : a.dim };
      } else return a;
    }
  }
  function expr() {
    let a = term();
    for (;;) {
      if (eat('op', '+')) { const b = term(); a = mix(a, b, 1); }
      else if (eat('op', '-')) { const b = term(); a = mix(a, b, -1); }
      else return a;
    }
  }
  function mix(a, b, s) {
    if (a.dim === b.dim) return { v: a.v + s * b.v, dim: a.dim };
    const A = lift(a), B = lift(b);
    return { v: A.v + s * B.v, dim: A.dim || B.dim };
  }
  if (!toks.length) throw new Error('Üres');
  const res = expr();
  if (p < toks.length) throw new Error('Váratlan folytatás');
  if (kind === "raw") { if (!isFinite(res.v)) throw new Error("Érvénytelen eredmény"); return res; }
  const out = lift(res);
  if (!isFinite(out.v)) throw new Error('Érvénytelen eredmény');
  return out.v;
}

/** Kiértékelés egységdimenzióval: { v, dim } (dim: 0 szám, 1 hossz mm-ben, 2 szög fokban) */
export function evaluateRaw(src, vars = currentVars) { return evaluate(src, 'raw', vars); }

const RESERVED = new Set(['mm', 'cm', 'm', 'in', 'ft', 'deg', 'rad', 'pi', 'sqrt', 'sin', 'cos', 'tan', 'abs']);
export function isValidVarName(name) {
  return /^[a-zA-Z_áéíóöőúüűÁÉÍÓÖŐÚÜŰ][a-zA-Z0-9_áéíóöőúüűÁÉÍÓÖŐÚÜŰ]*$/.test(name) && !RESERVED.has(name.toLowerCase());
}

/** Változólista kiértékelése (egymásra hivatkozhatnak). return { map, errors } */
export function evalVariables(list = []) {
  const map = new Map();
  const errors = new Map();
  let pending = list.filter((v) => v && v.name);
  for (let pass = 0; pass <= list.length && pending.length; pass++) {
    const next = [];
    for (const v of pending) {
      try { map.set(v.name.toLowerCase(), evaluateRaw(String(v.expr), map)); }
      catch (e) { next.push(v); errors.set(v.name, e.message); }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  for (const v of pending) if (!errors.has(v.name)) errors.set(v.name, 'Nem kiértékelhető');
  for (const k of map.keys()) errors.delete(k);
  for (const v of list) if (map.has(v.name.toLowerCase())) errors.delete(v.name);
  return { map, errors };
}

/** Egy változó értékének szöveges formája. */
export function fmtVar(val) {
  if (!val) return '–';
  if (val.dim === 1) return fmtLen(val.v);
  if (val.dim === 2) return fmtAngle(val.v);
  return trimNum(val.v, 4);
}
