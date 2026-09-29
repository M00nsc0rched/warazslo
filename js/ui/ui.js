// Felhasználói felület: eszköztárak, panelek, billentyűzet, menük, párbeszédek
import { el, onTap } from '../util/misc.js';
import { icon } from './icons.js';
import { evaluate, fmtLen, fmtAngle, getUnit, LENGTH_UNITS } from '../util/units.js';

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.overlay = document.getElementById('overlay');
    this._build();
  }

  _build() {
    const R = this.root;
    this.left = el('div', { id: 'leftbar' });
    this.top = el('div', { id: 'topbar' });
    this.right = el('div', { id: 'rightbar' });
    this.bottom = el('div', { id: 'bottombar' });
    this.toasts = el('div', { id: 'toasts' });
    this.busyEl = el('div', { class: 'busy' });
    R.append(this.left, this.top, this.right, this.bottom, this.toasts, this.busyEl);

    // felső cím
    this.titleName = el('div', { class: 'name', text: '' });
    this.dirtyDot = el('div', { class: 'dirty' });
    const homeBtn = el('button', { class: 'icon-btn', html: icon('home'), title: 'Projektek' });
    const moreBtn = el('button', { class: 'icon-btn', html: icon('more'), title: 'Menü' });
    onTap(homeBtn, () => this.app.goHome());
    onTap(moreBtn, () => this.app.projectMenu(moreBtn));
    onTap(this.titleName, () => this.app.renameProjectDialog());
    this.titleBox = el('div', { class: 'title' }, homeBtn, this.titleName, this.dirtyDot, moreBtn);
    this.statusPill = el('div', { class: 'pill info', style: { display: 'none' } });
    this.top.append(this.titleBox, this.statusPill);

    // alsó sáv
    this.selInfo = el('div', { class: 'selinfo' });
    this.panelBox = el('div', { class: 'toolpanel', style: { display: 'none' } });
    this.bottom.append(this.panelBox, this.selInfo);
  }

  setTitle(name) { this.titleName.textContent = name || ''; }
  setDirty(d) { this.dirtyDot.classList.toggle('on', !!d); }
  setBusy(b) { this.busyEl.classList.toggle('on', !!b); }
  setSelectionInfo(t) { this.selInfo.textContent = t || ''; }

  setStatus(text, kind = 'info') {
    if (!text) { this.statusPill.style.display = 'none'; return; }
    this.statusPill.className = `pill ${kind}`;
    this.statusPill.textContent = text;
    this.statusPill.style.display = '';
  }

  // ---------------------------------------------------------------- gombok
  button(b) {
    const tile = el('button', { class: `tile ${b.active ? 'active' : ''} ${b.disabled ? 'disabled' : ''}`, html: icon(b.icon), title: b.label || '' });
    if (b.menu) tile.append(el('span', { class: 'corner' }));
    if (b.badge) tile.append(el('span', { class: 'badge', text: String(b.badge) }));
    const wrap = el('div', { class: `tbtn ${b.side === 'right' ? 'right' : ''}` }, tile);
    if (b.label && b.showLabel !== false) {
      const lab = el('div', { class: 'label' }, el('span', {}, b.label, b.kbd ? el('kbd', { text: b.kbd }) : null));
      if (b.sub) lab.append(el('small', { text: b.sub }));
      wrap.append(lab);
      onTap(lab, (e) => b.onTap && b.onTap(tile, e));
    }
    onTap(tile, (e) => b.onTap && b.onTap(tile, e));
    return wrap;
  }

  /** Bal eszköztár. spec: { groups: [[btn...], ...], bottom: [[btn...]] } */
  renderLeft(spec) {
    this.left.innerHTML = '';
    const mk = (group) => el('div', { class: 'group' }, group.map((b) => (b === '-' ? el('div', { class: 'sep' }) : this.button(b))));
    const scroll = el('div', { class: 'scroll' });
    spec.groups.forEach((g, i) => {
      if (i > 0) scroll.append(el('div', { class: 'sep' }));
      scroll.append(mk(g));
    });
    this.left.append(scroll, el('div', { class: 'spacer' }));
    for (const g of spec.bottom || []) {
      if (g.row) this.left.append(el('div', { class: 'row' }, g.row.map((b) => this.button({ ...b, showLabel: false }))));
      else { this.left.append(el('div', { class: 'sep' })); this.left.append(mk(g)); }
    }
  }

  /** Jobb eszköztár. */
  renderRight(spec) {
    this.right.innerHTML = '';
    this.cubeSlot = el('div', { id: 'viewcube-slot' });
    const top = el('div', { class: 'cube-row' }, this.cubeSlot, el('div', { class: 'group' }, spec.top.map((b) => b.custom || this.button({ ...b, showLabel: false }))));
    this.right.append(top);
    const g = el('div', { class: 'group' }, spec.items.map((b) => this.button({ ...b, side: 'right' })));
    this.right.append(g);
    return this.cubeSlot;
  }

  /** Vázlat módban a jobb oldali kényszeroszlop (null = elrejtés). */
  renderSketchBar(spec) {
    if (!this.sketchBar) {
      this.sketchBar = el('div', { id: 'sketchbar' });
      this.root.append(this.sketchBar);
    }
    const bar = this.sketchBar;
    bar.innerHTML = '';
    bar.style.display = spec ? '' : 'none';
    if (!spec) return;
    if (spec.title) bar.append(el('div', { class: 'sb-title' }, el('span', { text: spec.title }), spec.dof != null ? el('span', { class: `dof-pill ${spec.dof === 0 ? 'ok' : ''}`, text: spec.dof === 0 ? 'meghatározott' : `${spec.dof} szabadsági fok` }) : null));
    for (const b of spec.items) {
      if (b === '-') { bar.append(el('div', { class: 'sep', style: { alignSelf: 'flex-end' } })); continue; }
      bar.append(this.button({ ...b, side: 'right' }));
    }
  }

  // ---------------------------------------------------------------- eszközpanel
  showPanel(spec, handlers) {
    this.panelSpec = spec;
    this.panelHandlers = handlers;
    this._renderPanel();
  }

  hidePanel() {
    this.panelSpec = null;
    this.panelBox.style.display = 'none';
    this.panelBox.innerHTML = '';
  }

  refreshPanel(spec) {
    if (!this.panelSpec) return;
    if (spec) this.panelSpec = spec;
    this._renderPanel();
  }

  _renderPanel() {
    const s = this.panelSpec;
    const h = this.panelHandlers;
    const box = this.panelBox;
    box.innerHTML = '';
    box.style.display = '';
    box.append(el('div', { class: 'tp-title', html: `${icon(s.icon || 'tools')}<span>${s.title}</span>` }));
    if (s.hint) box.append(el('div', { class: 'tp-hint', text: s.hint }));
    for (const it of s.items || []) {
      if (it.hidden) continue;
      if (it.type === 'chips') {
        const c = el('div', { class: 'chips' });
        for (const o of it.options) {
          const b = el('button', { class: `chip ${o.value === it.value ? 'on' : ''}`, html: `${o.icon ? icon(o.icon) : ''}${o.label ? `<span>${o.label}</span>` : ''}`, title: o.title || o.label || '' });
          onTap(b, () => h.change(it.key, o.value));
          c.append(b);
        }
        box.append(c);
      } else if (it.type === 'number') {
        const txt = it.kind === 'angle' ? fmtAngle(it.value) : it.kind === 'int' || it.kind === 'num' ? String(it.value) : fmtLen(it.value);
        const f = el('div', { class: `field ${it.active ? 'active' : ''}` }, el('span', { class: 'fl', text: it.label }), el('span', { class: 'fv', text: txt }));
        onTap(f, () => this.keypad({
          label: it.label, kind: it.kind, value: it.value, anchor: f,
          onDone: (v) => h.change(it.key, it.kind === 'int' ? Math.round(v) : v),
        }));
        box.append(f);
      } else if (it.type === 'slot') {
        const f = el('div', { class: `field slot ${it.active ? 'active' : ''} ${it.empty ? 'empty' : ''}` }, el('span', { class: 'fl', text: it.label }), el('span', { class: 'fv', text: it.value }));
        onTap(f, () => h.change(it.key, '__activate'));
        box.append(f);
      } else if (it.type === 'toggle') {
        const t = el('div', { class: `toggle ${it.value ? 'on' : ''}` }, el('span', { class: 'sw' }), el('span', { text: it.label }));
        onTap(t, () => h.change(it.key, !it.value));
        box.append(t);
      } else if (it.type === 'button') {
        const b = el('button', { class: `btn ${it.style || ''}`, html: `${it.icon ? icon(it.icon) : ''}<span>${it.label}</span>` });
        onTap(b, () => h.change(it.key, true));
        box.append(b);
      } else if (it.type === 'info') {
        box.append(el('div', { class: 'tp-hint', html: it.html || '', text: it.html ? null : it.text }));
      } else if (it.type === 'sep') {
        box.append(el('div', { class: 'vsep' }));
      }
    }
    if (s.cancel !== false || s.done !== false) box.append(el('div', { class: 'vsep' }));
    if (s.cancel !== false) {
      const c = el('button', { class: 'btn ghost', html: `${icon('close')}<span>${s.cancelLabel || 'Mégse'}</span>` });
      onTap(c, () => h.cancel());
      box.append(c);
    }
    if (s.done !== false) {
      const d = el('button', { class: 'btn primary', html: `${icon('check')}<span>${s.doneLabel || 'Kész'}</span>` });
      if (s.doneDisabled) d.disabled = true;
      onTap(d, () => h.done());
      box.append(d);
    }
  }

  // ---------------------------------------------------------------- értesítés
  toast(msg, kind = '', ms = 2600) {
    const t = el('div', { class: `toast ${kind}`, text: msg });
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
  }

  // ---------------------------------------------------------------- menü
  menu(anchor, items, { side = 'right' } = {}) {
    this.closeMenu();
    const scrim = el('div', { class: 'menu-scrim' });
    const m = el('div', { class: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { m.append(el('div', { class: 'ms' })); continue; }
      if (it.head) { m.append(el('div', { class: 'mh', text: it.head })); continue; }
      const row = el('div', { class: `mi ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`, html: `${it.icon ? icon(it.icon) : ''}<span>${it.label}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ''}` });
      onTap(row, () => { this.closeMenu(); it.onTap && it.onTap(); });
      m.append(row);
    }
    document.body.append(scrim, m);
    scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); this.closeMenu(); });
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = side === 'right' ? r.right + 8 : side === 'left' ? r.left - mw - 8 : r.left + r.width / 2 - mw / 2;
    let y = side === 'below' ? r.bottom + 8 : r.top;
    x = Math.max(8, Math.min(window.innerWidth - mw - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - mh - 8, y));
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    this._menu = [scrim, m];
  }

  closeMenu() {
    if (this._menu) { this._menu.forEach((e) => e.remove()); this._menu = null; }
  }

  // ---------------------------------------------------------------- numerikus billentyűzet
  keypad({ label, kind = "len", value, expr, anchor, onDone, onCancel, actions = [] }) {
    this.closeKeypad();
    const unit = kind === 'len' ? LENGTH_UNITS[getUnit()].label : kind === 'angle' ? '°' : '';
    let text = '';
    let fresh = true;
    const initial = expr ? String(expr) : value == null ? "" : kind === "len" ? fmtLen(value, { unit: false }) : kind === "angle" ? fmtAngle(value, { unit: false }) : String(value);
    const disp = el('div', { class: 'kp-display' });
    const prev = el('div', { class: 'kp-preview' });
    const render = () => {
      const shown = fresh ? initial : text;
      disp.innerHTML = '';
      disp.append(document.createTextNode(shown || ''), el('span', { class: 'caret' }));
      disp.classList.remove('err');
      prev.textContent = '';
      const src = fresh ? initial : text;
      if (src && /[+\-*/×÷()a-z"']/.test(src.replace(/^-/, ''))) {
        try {
          const v = evaluate(src, kind === 'int' ? 'num' : kind);
          prev.textContent = `= ${kind === 'len' ? fmtLen(v) : kind === 'angle' ? fmtAngle(v) : v}`;
        } catch (e) { prev.textContent = ''; }
      } else if (unit) prev.textContent = unit;
    };
    const press = (k) => {
      if (fresh && k !== 'OK') {
        // műveleti jel a kezdőértékhez fűz (pl. "20" + "+5"), szám felülírja
        text = '+-*/⌫±'.includes(k) ? initial : '';
        fresh = false;
      }
      if (k === '⌫') text = text.slice(0, -1);
      else if (k === 'C') text = '';
      else if (k === '±') text = text.startsWith('-') ? text.slice(1) : `-${text}`;
      else if (k === 'OK') return commit();
      else text += k;
      render();
    };
    const commit = () => {
      const src = fresh ? initial : text;
      if (!src.trim()) { close(); onCancel && onCancel(); return; }
      try {
        const v = evaluate(src, kind === "int" ? "num" : kind);
        close();
        onDone && onDone(v, src.trim());
      } catch (e) {
        disp.classList.add('err');
        prev.textContent = e.message;
      }
    };
    const close = () => this.closeKeypad();
    const keys = [
      ['C', '(', ')', '⌫'],
      ['7', '8', '9', '÷'],
      ['4', '5', '6', '×'],
      ['1', '2', '3', '−'],
      [',', '0', '±', '+'],
    ];
    const grid = el('div', { class: 'kp-grid' });
    for (const row of keys) {
      for (const k of row) {
        const op = '÷×−+()C⌫±'.includes(k);
        const b = el('button', { class: `k ${op ? 'op' : ''}`, text: k });
        onTap(b, () => press(k === '÷' ? '/' : k === '×' ? '*' : k === '−' ? '-' : k));
        grid.append(b);
      }
    }
    const units = kind === 'len' ? ['mm', 'cm', 'in'] : kind === 'angle' ? ['°'] : [];
    for (const u of units) {
      const b = el('button', { class: 'k unit', text: u });
      onTap(b, () => press(u));
      grid.append(b);
    }
    const ok = el('button', { class: `k ok ${units.length === 1 ? 'wide' : ''}`, text: 'OK' });
    if (units.length === 0) ok.classList.add('wide');
    onTap(ok, () => press('OK'));
    if (units.length === 1) {
      const cancel = el('button', { class: 'k unit', text: 'Mégse' });
      onTap(cancel, () => { close(); onCancel && onCancel(); });
      grid.append(cancel);
    }
    grid.append(ok);
    if (units.length === 0) {
      const cancel = el('button', { class: 'k unit wide', text: 'Mégse' });
      onTap(cancel, () => { close(); onCancel && onCancel(); });
      grid.insertBefore(cancel, ok);
    }
    const kp = el("div", { class: "keypad" }, el("div", { class: "kp-label", text: label || "" }), disp, prev, grid);
    const names = this.varNames ? this.varNames() : [];
    if (names.length) {
      const vr = el("div", { class: "kp-vars" });
      for (const nm of names.slice(0, 12)) { const b = el("button", { class: "chip", text: nm }); onTap(b, () => press(nm)); vr.append(b); }
      kp.insertBefore(vr, grid);
    }
    if (actions.length) {
      const ar = el("div", { class: "kp-actions" });
      for (const a of actions) { const b = el("button", { class: `btn ${a.style || ""}`, text: a.label }); onTap(b, () => { close(); a.onTap(); }); ar.append(b); }
      kp.append(ar);
    }
    const scrim = el('div', { class: 'menu-scrim', style: { zIndex: 59 } });
    scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); commit(); });
    document.body.append(scrim, kp);
    render();
    // elhelyezés
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0 };
    const kw = kp.offsetWidth, kh = kp.offsetHeight;
    let x = r.left + (r.width || 0) / 2 - kw / 2;
    let y = r.top - kh - 10;
    if (y < 10) y = (r.bottom || r.top) + 10;
    x = Math.max(10, Math.min(window.innerWidth - kw - 10, x));
    y = Math.max(10, Math.min(window.innerHeight - kh - 10, y));
    kp.style.left = `${x}px`;
    kp.style.top = `${y}px`;
    const onKey = (e) => {
      const k = e.key;
      if (/^[0-9]$/.test(k) || '+-*/(),.'.includes(k) || /^[a-z"'°]$/i.test(k)) { e.preventDefault(); press(k === '.' ? ',' : k); }
      else if (k === 'Backspace') { e.preventDefault(); press('⌫'); }
      else if (k === 'Enter') { e.preventDefault(); press('OK'); }
      else if (k === 'Escape') { e.preventDefault(); close(); onCancel && onCancel(); }
    };
    window.addEventListener('keydown', onKey, true);
    this._keypad = { els: [scrim, kp], onKey };
  }

  closeKeypad() {
    if (!this._keypad) return;
    this._keypad.els.forEach((e) => e.remove());
    window.removeEventListener('keydown', this._keypad.onKey, true);
    this._keypad = null;
  }

  isKeypadOpen() { return !!this._keypad; }

  // ---------------------------------------------------------------- párbeszéd
  dialog({ title, text, body, buttons = [{ label: 'OK', value: true, style: 'primary' }], onOpen }) {
    return new Promise((resolve) => {
      const scrim = el('div', { class: 'dialog-scrim' });
      const d = el('div', { class: 'dialog' });
      if (title) d.append(el('h3', { text: title }));
      if (text) d.append(el('p', { text }));
      if (body) d.append(body);
      const acts = el('div', { class: 'actions' });
      const close = (v) => { scrim.remove(); window.removeEventListener('keydown', onKey, true); resolve(v); };
      for (const b of buttons) {
        const bt = el('button', { class: `btn ${b.style || ''}`, text: b.label });
        onTap(bt, () => close(typeof b.value === 'function' ? b.value() : b.value));
        acts.append(bt);
      }
      d.append(acts);
      scrim.append(d);
      scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(null); });
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
          const primary = buttons.find((b) => b.style === 'primary');
          if (primary) { e.preventDefault(); close(typeof primary.value === 'function' ? primary.value() : primary.value); }
        }
      };
      window.addEventListener('keydown', onKey, true);
      document.body.append(scrim);
      onOpen && onOpen(d);
    });
  }

  async prompt(title, value = '', { placeholder = '', okLabel = 'Mentés' } = {}) {
    const inp = el('input', { type: 'text', value, placeholder, autocomplete: 'off', autocapitalize: 'sentences' });
    const res = await this.dialog({
      title, body: inp,
      buttons: [{ label: 'Mégse', value: null, style: 'ghost' }, { label: okLabel, value: () => inp.value, style: 'primary' }],
      onOpen: () => setTimeout(() => { inp.focus(); inp.select(); }, 50),
    });
    return res == null ? null : String(res).trim();
  }

  confirm(title, text, okLabel = 'Törlés', danger = true) {
    return this.dialog({ title, text, buttons: [{ label: 'Mégse', value: false, style: 'ghost' }, { label: okLabel, value: true, style: danger ? 'danger' : 'primary' }] });
  }

  // ---------------------------------------------------------------- oldalsó lap
  openSheet({ title, side = 'left', build, foot, onClose }) {
    this.closeSheet();
    const body = el('div', { class: 'body' });
    const x = el('button', { class: 'x-btn', html: icon('close') });
    const sheet = el('div', { class: `sheet ${side}` }, el('header', {}, el('h3', { text: title }), x), body);
    if (foot) { const f = el('div', { class: 'foot' }); foot(f); sheet.append(f); }
    onTap(x, () => this.closeSheet());
    this.root.append(sheet);
    this._sheet = { sheet, body, build, onClose, title };
    build(body);
    return this._sheet;
  }

  refreshSheet() {
    if (!this._sheet) return;
    const st = this._sheet.body.scrollTop;
    this._sheet.body.innerHTML = '';
    this._sheet.build(this._sheet.body);
    this._sheet.body.scrollTop = st;
  }

  closeSheet() {
    if (!this._sheet) return;
    const s = this._sheet;
    this._sheet = null;
    s.sheet.remove();
    s.onClose && s.onClose();
  }

  sheetOpen(title) { return this._sheet && (!title || this._sheet.title === title); }
}
