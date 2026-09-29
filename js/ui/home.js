// Kezdőképernyő: projektlista
import { el, onTap, timeAgo, pickFile, uid, shareOrDownload, safeName } from '../util/misc.js';
import { icon } from './icons.js';
import * as storage from '../doc/storage.js';
import { emptyState } from '../doc/document.js';

export class HomeScreen {
  constructor(app) {
    this.app = app;
    this.root = el('div', { id: 'home', class: 'hidden' });
    document.body.append(this.root);
  }

  hide() { this.root.classList.add('hidden'); }

  async show() {
    const boot = document.getElementById('boot');
    const projects = await storage.listProjects();
    this.render(projects);
    this.root.classList.remove('hidden');
    if (boot) { boot.classList.add('hidden'); setTimeout(() => boot.remove(), 400); }
  }

  render(projects) {
    const app = this.app;
    const r = this.root;
    r.innerHTML = '';
    const newBtn = el('button', { class: 'btn primary', html: `${icon('plus')}<span>Új projekt</span>` });
    onTap(newBtn, () => app.newProject());
    const impBtn = el('button', { class: 'btn', html: `${icon('importFile')}<span>Importálás</span>` });
    onTap(impBtn, () => this.importFile());
    const setBtn = el('button', { class: 'btn', html: `${icon('settings')}<span>Beállítások</span>` });
    onTap(setBtn, () => import('./sheets.js').then((s) => s.openSettings(app)));
    r.append(el('div', { class: 'home-head' },
      el('img', { src: 'icons/logo-256.png', alt: '' }),
      el('h1', { text: 'Warázsló' }),
      el('div', { class: 'home-actions' }, impBtn, setBtn, newBtn)));

    const grid = el('div', { class: 'grid' });
    const nw = el('div', { class: 'proj new-proj' }, el('div', { class: 'thumb', html: icon('plus') }), el('div', { class: 'meta' }, el('div', { class: 't' }, el('div', { class: 'n', text: 'Új projekt' }), el('div', { class: 'd', text: 'Üres munkaterület' }))));
    onTap(nw, () => app.newProject());
    grid.append(nw);
    for (const p of projects) {
      const thumb = el('div', { class: 'thumb' });
      if (p.thumb) thumb.style.backgroundImage = `url(${p.thumb})`;
      else thumb.innerHTML = icon('cube');
      const more = el('button', { class: 'more', html: icon('dots') });
      const card = el('div', { class: 'proj' }, thumb, el('div', { class: 'meta' }, el('div', { class: 't' }, el('div', { class: 'n', text: p.name }), el('div', { class: 'd', text: `${timeAgo(p.modified)} · ${p.bodies || 0} test` })), more));
      onTap(card, () => app.openProject(p.id));
      onTap(more, (e) => { e.stopPropagation(); this.projectMenu(p, more); });
      grid.append(card);
    }
    r.append(grid);
    if (!projects.length) r.append(el('div', { class: 'empty-note', html: 'Még nincs projekted. Kezdj egy <b>Új projekt</b>tel!<br><br>Tipp: iPaden a Safari <b>Megosztás → Főképernyőhöz adás</b> menüjével teljes képernyős alkalmazásként használhatod.' }));
    const foot = el('div', { class: 'home-foot', text: 'A projektek ezen az eszközön, a böngésző tárhelyén vannak. Fontos munkákról készíts biztonsági mentést (… → Projektfájl mentése).' });
    storage.storageEstimate().then((e) => { if (e && e.usage != null) foot.textContent += ` · Tárhely: ${(e.usage / 1e6).toFixed(1)} MB`; });
    r.append(foot);
  }

  projectMenu(p, anchor) {
    const app = this.app;
    app.ui.menu(anchor, [
      { icon: 'folder', label: 'Megnyitás', onTap: () => app.openProject(p.id) },
      { icon: 'eye', label: 'Megnyitás nézet módban', onTap: async () => { await app.openProject(p.id); app.setMode('view'); } },
      { icon: 'rename', label: 'Átnevezés', onTap: async () => { const n = await app.ui.prompt('Projekt neve', p.name); if (n) { await storage.renameProject(p.id, n); this.show(); } } },
      { icon: 'copy', label: 'Másolat készítése', onTap: async () => { const full = await storage.loadProject(p.id); await storage.saveProject({ ...full, id: uid('p'), name: `${p.name} másolat`, created: Date.now() }); this.show(); } },
      { icon: 'share', label: 'Projektfájl mentése', onTap: async () => { const full = await storage.loadProject(p.id); shareOrDownload(new Blob([JSON.stringify({ format: 'warazslo', version: 1, name: full.name, state: full.state, view: full.view })], { type: 'application/json' }), `${safeName(full.name)}.warazslo`); } },
      { sep: true },
      { icon: 'trash', label: 'Törlés', danger: true, onTap: async () => { if (await app.ui.confirm('Projekt törlése', `Biztosan törlöd: „${p.name}”? Ez nem vonható vissza.`)) { await storage.deleteProject(p.id); storage.deleteProjectMeshes(p.id); this.show(); } } },
    ], { side: 'left' });
  }

  async importFile() {
    const app = this.app;
    const file = await pickFile('.warazslo,.json,.step,.stp,.stl,application/json');
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'warazslo' || ext === 'json') {
        const data = JSON.parse(await file.text());
        if (data.format !== 'warazslo' || !data.state) throw new Error('Nem Warázsló projektfájl');
        const p = { id: uid('p'), name: data.name || file.name.replace(/\.[^.]+$/, ''), state: data.state, view: data.view || { hidden: [] } };
        await storage.saveProject(p);
        await app.openProject(p.id);
      } else {
        const name = file.name.replace(/\.[^.]+$/, '');
        const p = { id: uid('p'), name, state: emptyState(), view: { hidden: [] } };
        await storage.saveProject(p);
        await app.openProject(p.id);
        const res = await app.kernel.op('importFile', { format: ext === 'stl' ? 'stl' : 'step', data: await file.arrayBuffer(), name }, true);
        await app.commitKernelResult('Importálás', res, { icon: 'importFile' });
        app.vp.fitBox(app.bodies.bounds());
      }
    } catch (e) {
      app.ui.toast(`Import hiba: ${e.message}`, 'error', 5000);
    }
  }
}
