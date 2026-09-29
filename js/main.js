// Warázsló – belépési pont
import { App } from './app.js';

const status = document.getElementById('boot-status');
const setStatus = (t) => { if (status) status.textContent = t; };

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  if (document.getElementById('boot')) setStatus(`Hiba: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

// iOS: a dupla koppintásos nagyítás és a csípéses oldalnagyítás tiltása
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

async function boot() {
  setStatus('Indítás…');
  const app = new App();
  window.app = app; // hibakereséshez
  await app.init();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            app.ui.toast('Új verzió érhető el – a következő indításkor frissül', 'ok', 5000);
          }
        });
      });
    } catch (e) { console.warn('SW regisztráció sikertelen', e); }
  }
}

boot().catch((e) => {
  console.error(e);
  setStatus(`Nem sikerült elindulni: ${e.message}`);
});
