// Sunucu ile iletişim + çevrimdışı satış kuyruğu
const TOKEN_KEY = 'vk_token';
const QUEUE_KEY = 'vk_offline_sales';
const PRODUCTS_KEY = 'vk_products_cache';

const safe = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depolama kapalı */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* yok say */ } },
};

export const storage = safe;
export const getToken = () => safe.get(TOKEN_KEY, null);
export const setToken = (t) => (t ? safe.set(TOKEN_KEY, t) : safe.del(TOKEN_KEY));
export const registerName = () => safe.get('vk_register', 'Kasa 1');
export const setRegisterName = (n) => safe.set('vk_register', n || 'Kasa 1');

// ---- Sunucu modu (Android uygulaması): birden çok cihaz aynı veriyi kullanır ----
// Boşsa uygulama tabletin kendi verisiyle çalışır (tek cihaz). Doluysa tüm istekler o sunucuya gider
// (bulut sunucu ya da dükkandaki Windows bilgisayarında çalışan VelarisKasa).
const SERVER_KEY = 'vk_server_url';
export const serverUrl = () => (import.meta.env.VITE_APP ? safe.get(SERVER_KEY, null) : null);
export const setServerUrl = (u) => (u ? safe.set(SERVER_KEY, normalizeServerUrl(u)) : safe.del(SERVER_KEY));
/** "192.168.1.20" → "http://192.168.1.20:4848"; "kasa.ornek.com" → "https://kasa.ornek.com" */
export function normalizeServerUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '').replace(/\/api$/, '').replace(/\/#.*$/, '');
  if (!s) return '';
  const ip = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s) || /^localhost(:\d+)?$/.test(s);
  if (!/^https?:\/\//i.test(s)) s = `${ip ? 'http' : 'https'}://${s}`;
  const m = s.match(/^(https?:\/\/)([^/]+)(.*)$/i);
  if (m && ip && !/:\d+$/.test(m[2])) s = `${m[1]}${m[2]}:4848${m[3]}`;
  return s.replace(/\/+$/, '');
}
/** QR menü, online randevu ve web kancası bağlantıları için uygulamanın herkese açık adresi */
export const publicBaseUrl = (configured) => (configured || serverUrl() || `${location.origin}${location.pathname}`)
  .replace(/#.*$/, '').replace(/\/index\.html$/, '').replace(/\/+$/, '');

/** Sunucuya ulaşılabiliyor mu? Dönüş: { ok, setup_done, business_name } ya da hata fırlatır. */
export async function probeServer(url) {
  const base = normalizeServerUrl(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const h = await fetch(`${base}/api/health`, { signal: ctl.signal }).then((r) => r.json());
    if (h?.app !== 'velaris-kasa') throw new Error('Bu adreste VelarisKasa sunucusu yok');
    const st = await fetch(`${base}/api/setup/status`, { signal: ctl.signal }).then((r) => r.json());
    return { ok: true, url: base, setup_done: !!st.setup_done, business_name: st.business_name || '' };
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error(`Sunucuya ulaşılamadı (${base}). Adresi, sunucunun açık olduğunu ve tabletin aynı ağda olduğunu kontrol edin.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw } = {}) {
  const token = getToken();
  let res;
  try {
    const remote = serverUrl();
    const send = remote ? fetch : import.meta.env.VITE_DEMO ? (await import('./demo/backend.js')).demoFetch : fetch;
    res = await send(remote ? `${remote}/api${path}` : `./api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'Sunucuya ulaşılamıyor', null);
  }
  if (raw) return res;
  const json = await res.json().catch(() => null);
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, json?.error || `Hata (${res.status})`, json);
  return json;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

// ---- Ürün önbelleği (kasa çevrimdışı açılabilsin) ----
export async function loadProducts() {
  try {
    const list = await get(`/products?register=${encodeURIComponent(registerName())}`);
    safe.set(PRODUCTS_KEY, list);
    return list;
  } catch (e) {
    if (e.status === 0) return safe.get(PRODUCTS_KEY, []);
    throw e;
  }
}

// ---- Çevrimdışı satış kuyruğu ----
export const offlineQueue = () => safe.get(QUEUE_KEY, []);
const listeners = new Set();
export const onQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => fn(offlineQueue()));

/** Satışı gönderir; sunucuya ulaşılamazsa kuyruğa alır ve { offline: true } döner. */
export async function submitSale(payload) {
  try {
    return await post('/sales', payload);
  } catch (e) {
    if (e.status !== 0) throw e;
    safe.set(QUEUE_KEY, [...offlineQueue(), payload]);
    notify();
    return { offline: true, receipt_no: 'ÇEVRİMDIŞI', ...payload };
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    for (const sale of offlineQueue()) {
      try {
        await post('/sales', sale);
      } catch (e) {
        if (e.status === 0 || e.status === 401) break; // hâlâ çevrimdışı / oturum yok
        // Sunucu satışı reddetti (ör. stok yetersiz): kaybolmasın diye not ekleyip zorlamadan bırak
        sale.error = e.message;
        safe.set('vk_rejected_sales', [...safe.get('vk_rejected_sales', []), sale]);
      }
      safe.set(QUEUE_KEY, offlineQueue().filter((s) => s.client_uuid !== sale.client_uuid));
      notify();
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushQueue);
  setInterval(() => { if (offlineQueue().length && getToken()) flushQueue(); }, 15000);
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
