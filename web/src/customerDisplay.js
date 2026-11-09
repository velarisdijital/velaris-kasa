// Müşteri ekranına yayın: aynı cihazdaki pencerelere BroadcastChannel ile, başka cihazlara sunucu üzerinden.
import { api, registerName, serverUrl, storage } from './api.js';

const CHANNEL = 'vk-customer-display';
let channel = null;
const chan = () => {
  if (channel === null) {
    try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : false; } catch { channel = false; }
  }
  return channel || null;
};

/** Müşteri ekranı bu kasada açık mı (Ayarlar → Müşteri ekranı). Kapalıyken hiçbir şey gönderilmez. */
export const displayEnabled = () => storage.get('vk_display_on', false);
export const setDisplayEnabled = (on) => storage.set('vk_display_on', !!on);
/** Boşta ekranda görünen yazı (cihaza özel) */
export const displayMessage = () => storage.get('vk_display_msg', 'Hoş geldiniz');
export const setDisplayMessage = (m) => storage.set('vk_display_msg', String(m || '').slice(0, 120));

let timer = null;
let pending = null;
let lastSent = '';

/**
 * Ekran durumunu yayınla. state: { mode: 'idle'|'cart'|'paid', lines, subtotal, discount, savings, total, paid, change, customer }
 * Sepet hızlı değişir (okutma); sunucuya en fazla 250 ms'de bir gönderilir. Ödeme anı hemen gider.
 */
export function publishDisplay(state, { now = false } = {}) {
  if (!displayEnabled()) return;
  const register = registerName();
  const msg = { register, state: { ...state, message: displayMessage() }, at: Date.now() };
  try { chan()?.postMessage(msg); } catch { /* yok */ }
  // Sunucu yalnızca başka cihazdaki ekran için gerekir: sunucu modunda ya da tarayıcıdan gerçek sunucuya bağlıyken
  if (import.meta.env.VITE_DEMO && !serverUrl()) return; // tarayıcı içi veri: başka cihaz göremez
  pending = msg;
  const flush = () => {
    timer = null;
    const m = pending; pending = null;
    const body = JSON.stringify(m.state);
    if (body === lastSent) return;
    lastSent = body;
    api(`/display/${encodeURIComponent(m.register)}`, { method: 'PUT', body: m.state }).catch(() => { lastSent = ''; });
  };
  if (now) { clearTimeout(timer); flush(); } else if (!timer) timer = setTimeout(flush, 250);
}

/** Ekran tarafı: aynı cihazdan gelenleri dinle. Dönüş: aboneliği bitiren fonksiyon. */
export function listenLocal(register, cb) {
  const c = chan();
  if (!c) return () => {};
  const on = (e) => { if (e.data?.register === register) cb(e.data.state); };
  c.addEventListener('message', on);
  return () => c.removeEventListener('message', on);
}
