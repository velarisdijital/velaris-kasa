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

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw } = {}) {
  const token = getToken();
  let res;
  try {
    const send = import.meta.env.VITE_DEMO ? (await import('./demo/backend.js')).demoFetch : fetch;
    res = await send(`./api${path}`, {
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
