// Apró segédeszközök

export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { const s = this._h.get(ev); if (s) s.delete(fn); }
  emit(ev, ...args) {
    const s = this._h.get(ev);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(...args); } catch (e) { console.error(`[${ev}]`, e); }
    }
  }
}

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${seq.toString(36)}`;
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

/** Egyszerű tap kezelő, ami iPaden is gyors (pointerup alapján). */
export function onTap(elm, fn) {
  let down = null;
  elm.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  elm.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 12) { e.preventDefault(); e.stopPropagation(); fn(e); }
  });
  elm.addEventListener('pointercancel', () => { down = null; });
  elm.addEventListener('click', (e) => { if (e.detail === 0) fn(e); }); // billentyűzetes aktiválás
  return elm;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** iPaden a megosztás lap a legkényelmesebb; ha nincs, letöltés. */
export async function shareOrDownload(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  downloadBlob(blob, filename);
}

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const files = [...(inp.files || [])];
      inp.remove();
      resolve(multiple ? files : files[0] || null);
    });
    inp.click();
  });
}

export function safeName(s) {
  return (s || 'warazslo').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'warazslo';
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'épp most';
  if (d < 3600) return `${Math.floor(d / 60)} perce`;
  if (d < 86400) return `${Math.floor(d / 3600)} órája`;
  const dt = new Date(ts);
  return dt.toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const isTouchDevice = () => (navigator.maxTouchPoints || 0) > 0;
