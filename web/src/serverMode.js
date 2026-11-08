// Tablet uygulamasında veri konumu: bu tablet (tek cihaz) ya da sunucu (birden çok cihaz aynı veriyi kullanır).
import { normalizeServerUrl, probeServer, serverUrl, setServerUrl, setToken } from './api.js';

export { probeServer, serverUrl };

/**
 * Sunucuya geçer.
 *  - Sunucu boşsa ve migrate=true: bu tabletteki tüm veriler sunucuya taşınır (oturum korunur).
 *  - Sunucuda veri varsa: sunucudaki veriler kullanılır; tabletteki veriler tablette kalır, yeniden giriş yapılır.
 * Dönüş: { moved: { products, sales, customers } | null }. Sonrasında uygulama yeniden açılmalı.
 */
export async function connectToServer(url, { migrate = true } = {}) {
  const info = await probeServer(url);
  let moved = null;
  if (!info.setup_done && migrate) {
    const { exportDatabase } = await import('./demo/backend.js');
    const bytes = await exportDatabase();
    const res = await fetch(`${info.url}/api/setup/import`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Veriler taşınamadı (${res.status})`);
    moved = body;
  } else {
    setToken(null); // sunucunun kendi kullanıcılarıyla giriş yapılır
  }
  setServerUrl(info.url);
  return { moved, info };
}

/** Tabletin kendi verisine döner (sunucudaki veriler sunucuda kalır). */
export function useLocalData() {
  setServerUrl(null);
  setToken(null);
}

export const isServerMode = () => !!serverUrl();
export { normalizeServerUrl };
