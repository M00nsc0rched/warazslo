// 2D műszaki rajz: vetületek rejtett élekkel, befoglaló méretek, szövegmező
import { el, onTap, shareOrDownload, safeName } from '../util/misc.js';
import { icon } from './icons.js';
import { fmtLen } from '../util/units.js';

const SHEETS = { A4: [297, 210], A3: [420, 297] };

export class DrawingView {
  constructor(app) {
    this.app = app;
    this.root = el('div', { id: 'drawing', class: 'hidden' });
    document.body.append(this.root);
    this.opts = { sheet: 'A4', scale: 'auto', hidden: true, dims: true, iso: true };
  }

  open() {
    this.root.classList.remove('hidden');
    this.renderBar();
    this.compute();
  }

  close() { this.root.classList.add('hidden'); }

  renderBar() {
    const bar = el('div', { class: 'dbar' });
    const close = el('button', { class: 'btn', html: `${icon('chevronLeft')}<span>Vissza</span>` });
    onTap(close, () => this.close());
    bar.append(close, el('h3', { text: `Műszaki rajz – ${this.app.doc.name}` }));
    const chips = (key, opts) => {
      const c = el('div', { class: 'chips' });
      for (const [v, l] of opts) {
        const b = el('button', { class: `chip ${this.opts[key] === v ? 'on' : ''}`, text: l });
        onTap(b, () => { this.opts[key] = v; this.renderBar(); this.render(); });
        c.append(b);
      }
      return c;
    };
    const tog = (key, label) => {
      const t = el('div', { class: `toggle ${this.opts[key] ? 'on' : ''}` }, el('span', { class: 'sw' }), el('span', { text: label }));
      onTap(t, () => { this.opts[key] = !this.opts[key]; this.renderBar(); this.render(); });
      return t;
    };
    bar.append(chips('sheet', [['A4', 'A4'], ['A3', 'A3']]));
    bar.append(chips('scale', [['auto', 'Auto'], ['5', '5:1'], ['2', '2:1'], ['1', '1:1'], ['0.5', '1:2'], ['0.2', '1:5'], ['0.1', '1:10']]));
    bar.append(tog('hidden', 'Rejtett élek'), tog('dims', 'Méretek'), tog('iso', 'Izometrikus'));
    const svgBtn = el('button', { class: 'btn', html: `${icon('exportFile')}<span>SVG</span>` });
    onTap(svgBtn, () => this.exportSVG());
    const pdfBtn = el('button', { class: 'btn primary', html: `${icon('share')}<span>PDF / nyomtatás</span>` });
    onTap(pdfBtn, () => this.print());
    bar.append(svgBtn, pdfBtn);
    this.root.innerHTML = '';
    this.canvas = el('div', { class: 'dcanvas' });
    this.root.append(bar, this.canvas);
    if (this.svg) this.canvas.append(this.svg);
  }

  async compute() {
    const app = this.app;
    const bodies = app.doc.state.bodies.filter((b) => !app.doc.isHidden(b.id)).map((b) => ({ id: b.id, rev: b.rev }));
    if (!bodies.length) { this.canvas.innerHTML = '<p style="color:#555">Nincs látható test.</p>'; return; }
    this.canvas.innerHTML = '<p style="color:#555">Vetületek számítása…</p>';
    try {
      const views = ['front', 'top', 'left', 'iso'];
      this.data = {};
      for (const v of views) this.data[v] = await app.kernel.query('projection', { bodies, view: v });
      this.render();
    } catch (e) {
      this.canvas.innerHTML = `<p style="color:#c00">Hiba: ${e.message}</p>`;
    }
  }

  render() {
    if (!this.data) return;
    const [W, H] = SHEETS[this.opts.sheet];
    const margin = 10, titleH = 22;
    const bb = (v) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const pl of [...this.data[v].visible, ...this.data[v].hidden]) for (const [x, y] of pl) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    };
    const B = { front: bb('front'), top: bb('top'), left: bb('left'), iso: bb('iso') };
    // európai (első szögű) elrendezés: elöl bal-fent, felülnézet alatta, bal oldalnézet jobbra
    const gap = 18;
    const availW = W - 2 * margin, availH = H - 2 * margin - titleH;
    const needW = B.front.w + B.left.w + gap * 3 + (this.opts.iso ? Math.max(B.iso.w * 0.8, 0) : 0);
    const needH = B.front.h + B.top.h + gap * 3;
    let s = this.opts.scale === 'auto' ? Math.min(availW / needW, availH / needH) : +this.opts.scale;
    if (this.opts.scale === 'auto') {
      const nice = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
      s = nice.find((n) => n <= s) || s;
    }
    this.scale = s;
    const ox = margin + gap, oy = margin + gap;
    const place = {
      front: { x: ox, y: oy },
      left: { x: ox + B.front.w * s + gap * 1.5, y: oy },
      top: { x: ox, y: oy + B.front.h * s + gap * 1.5 },
    };
    const isoS = this.opts.iso ? Math.min(s, (availW - (B.front.w + B.left.w) * s - gap * 4) / Math.max(B.iso.w, 1), (availH / 2) / Math.max(B.iso.h, 1)) : 0;
    if (this.opts.iso && isoS > 0) place.iso = { x: W - margin - gap - B.iso.w * isoS, y: H - margin - titleH - gap - B.iso.h * isoS, s: isoS };

    const parts = [];
    const pathOf = (pl, v, sc, P) => {
      const b = B[v];
      return pl.map(([x, y], i) => `${i ? 'L' : 'M'}${(P.x + (x - b.x0) * sc).toFixed(3)} ${(P.y + (b.y1 - y) * sc).toFixed(3)}`).join('');
    };
    const drawView = (v, P, sc) => {
      const d = this.data[v];
      if (this.opts.hidden && v !== 'iso') parts.push(`<path d="${d.hidden.map((pl) => pathOf(pl, v, sc, P)).join('')}" fill="none" stroke="#333" stroke-width="0.25" stroke-dasharray="2 1.2"/>`);
      parts.push(`<path d="${d.visible.map((pl) => pathOf(pl, v, sc, P)).join('')}" fill="none" stroke="#000" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    };
    for (const v of ['front', 'top', 'left']) drawView(v, place[v], s);
    if (place.iso) drawView('iso', place.iso, place.iso.s);

    // méretek
    if (this.opts.dims) {
      const dimH = (x1, x2, y, val, above = false) => {
        const yy = above ? y - 7 : y + 7;
        parts.push(`<g stroke="#000" stroke-width="0.18" fill="none"><path d="M${x1} ${y}V${yy + (above ? -1.5 : 1.5)}M${x2} ${y}V${yy + (above ? -1.5 : 1.5)}M${x1} ${yy}H${x2}"/></g>`);
        parts.push(arrow(x1, yy, 0), arrow(x2, yy, Math.PI));
        parts.push(`<text x="${(x1 + x2) / 2}" y="${yy - 1.2}" font-size="3.2" text-anchor="middle" font-family="Helvetica, Arial, sans-serif">${val}</text>`);
      };
      const dimV = (y1, y2, x, val) => {
        const xx = x + 7;
        parts.push(`<g stroke="#000" stroke-width="0.18" fill="none"><path d="M${x} ${y1}H${xx + 1.5}M${x} ${y2}H${xx + 1.5}M${xx} ${y1}V${y2}"/></g>`);
        parts.push(arrow(xx, y1, Math.PI / 2), arrow(xx, y2, -Math.PI / 2));
        parts.push(`<text x="${xx + 1.3}" y="${(y1 + y2) / 2}" font-size="3.2" font-family="Helvetica, Arial, sans-serif" transform="rotate(-90 ${xx + 1.3} ${(y1 + y2) / 2})" text-anchor="middle" dy="-0.4">${val}</text>`);
      };
      const f = place.front, fb = B.front;
      dimH(f.x, f.x + fb.w * s, f.y, fmtLen(fb.w, { unit: false }), true);
      dimV(f.y, f.y + fb.h * s, f.x + fb.w * s + 0.5, fmtLen(fb.h, { unit: false }));
      const l = place.left, lb = B.left;
      dimH(l.x, l.x + lb.w * s, l.y, fmtLen(lb.w, { unit: false }), true);
      const t = place.top, tb = B.top;
      dimV(t.y, t.y + tb.h * s, t.x + tb.w * s + 0.5, fmtLen(tb.h, { unit: false }));
    }

    // keret + szövegmező
    const name = this.app.doc.name;
    const scaleTxt = s >= 1 ? `${+s.toFixed(3)}:1` : `1:${+(1 / s).toFixed(3)}`;
    const date = new Date().toLocaleDateString('hu-HU');
    const tbW = 120, tbX = W - margin - tbW, tbY = H - margin - titleH;
    parts.push(`<rect x="${margin}" y="${margin}" width="${W - 2 * margin}" height="${H - 2 * margin}" fill="none" stroke="#000" stroke-width="0.7"/>`);
    parts.push(`<g font-family="Helvetica, Arial, sans-serif" fill="#000"><rect x="${tbX}" y="${tbY}" width="${tbW}" height="${titleH}" fill="#fff" stroke="#000" stroke-width="0.5"/>
      <path d="M${tbX} ${tbY + 11}H${tbX + tbW}M${tbX + 80} ${tbY}V${tbY + titleH}" stroke="#000" stroke-width="0.3"/>
      <text x="${tbX + 3}" y="${tbY + 8}" font-size="5.5" font-weight="700">${escapeXml(name)}</text>
      <text x="${tbX + 3}" y="${tbY + 17.5}" font-size="3.2">Warázsló · ${date} · mm</text>
      <text x="${tbX + 83}" y="${tbY + 5}" font-size="2.6">Méretarány</text><text x="${tbX + 83}" y="${tbY + 9.5}" font-size="4.2" font-weight="700">${scaleTxt}</text>
      <text x="${tbX + 83}" y="${tbY + 15}" font-size="2.6">Lap</text><text x="${tbX + 83}" y="${tbY + 19.5}" font-size="4">${this.opts.sheet}</text>
      <g transform="translate(${tbX - 18} ${tbY + 11})" stroke="#000" stroke-width="0.3" fill="none"><path d="M0 -4L6 -2V2L0 4Z"/><circle cx="12" cy="0" r="4"/><circle cx="12" cy="0" r="1.8"/></g></g>`);
    // nézetnevek
    const lbl = (v, txt) => { const p = place[v]; if (p) parts.push(`<text x="${p.x}" y="${p.y - 2}" font-size="2.8" fill="#555" font-family="Helvetica, Arial, sans-serif">${txt}</text>`); };
    if (!this.opts.dims) { lbl('front', 'ELÖLNÉZET'); lbl('left', 'OLDALNÉZET'); lbl('top', 'FELÜLNÉZET'); }
    lbl('iso', 'IZOMETRIKUS');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="sheet-svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
    this.svgText = svg;
    const wrap = el('div', { html: svg });
    this.svg = wrap.firstChild;
    this.svg.style.width = '100%';
    this.svg.style.maxWidth = `${Math.min(1400, window.innerWidth - 40)}px`;
    this.canvas.innerHTML = '';
    this.canvas.append(this.svg);
  }

  exportSVG() {
    if (!this.svgText) return;
    shareOrDownload(new Blob([this.svgText], { type: 'image/svg+xml' }), `${safeName(this.app.doc.name)}_rajz.svg`);
  }

  print() {
    if (!this.svgText) return;
    const [W, H] = SHEETS[this.opts.sheet];
    const w = window.open('', '_blank');
    if (!w) { this.app.ui.toast('A felugró ablak tiltva van; használd az SVG exportot', 'error', 4000); return; }
    w.document.write(`<!doctype html><html><head><title>${escapeXml(this.app.doc.name)}</title><style>@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0}svg{width:${W}mm;height:${H}mm;display:block}</style></head><body>${this.svgText}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }
}

function arrow(x, y, ang) {
  const L = 2.2, Wd = 0.7;
  const c = Math.cos(ang), s = Math.sin(ang);
  const p1 = [x + c * L - s * Wd, y + s * L + c * Wd], p2 = [x + c * L + s * Wd, y + s * L - c * Wd];
  return `<path d="M${x} ${y}L${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}Z" fill="#000"/>`;
}

function escapeXml(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
