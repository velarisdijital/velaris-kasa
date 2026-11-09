import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-ext-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-ext-500.css';
import '@fontsource/archivo/latin-600.css';
import '@fontsource/archivo/latin-ext-600.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo/latin-ext-700.css';
import App from './App.jsx';
import { installSoftKeyboardGuard } from './softKeyboard.js';
import './styles.css';

// Tablette ekran klavyesi yalnızca yazı kutusuna dokununca açılsın (Ayarlar → Bu cihaz)
installSoftKeyboardGuard();

const root = createRoot(document.getElementById('root'));
const render = () => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.VITE_APP) {
  root.render(<div className="center-screen muted">VelarisKasa açılıyor…</div>);
  // Sunucu modunda (birden çok cihaz) tabletteki yerel veritabanı açılmaz; istekler sunucuya gider
  const remote = (() => { try { return JSON.parse(localStorage.getItem('vk_server_url') || 'null'); } catch { return null; } })();
  // Uygulama içi güncelleme: indirilmiş yeni sürüm varsa ona geç (sayfa yeniden yüklenir)
  import('./ota.js').then((o) => o.onBoot()).catch(() => false).then((switched) => {
    if (switched) return null;
    return (remote ? Promise.resolve() : import('./demo/backend.js').then((m) => m.ensureApp())).then(() => {
    render();
    import('./ota.js').then((o) => o.confirmBoot()).catch(() => {});
    // Kasa modu (ekran kararmasın / tam ekran) ve günlük otomatik yedek
    import('./kiosk.js').then((k) => k.applyKiosk()).catch(() => {});
    setTimeout(() => import('./backup.js').then((b) => b.autoBackup()).catch(() => {}), 8000);
    });
  }).catch((e) => {
    root.render(<div className="center-screen danger-text">Uygulama başlatılamadı: {String(e?.message || e)}</div>);
  });
} else if (import.meta.env.VITE_DEMO) {
  root.render(<div className="center-screen muted">Demo hazırlanıyor, örnek satışlar oluşturuluyor…</div>);
  import('./demo/backend.js').then((m) => m.ensureDemo()).then(render, (e) => {
    root.render(<div className="center-screen danger-text">Demo başlatılamadı: {String(e?.message || e)}</div>);
  });
} else {
  render();
}

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
