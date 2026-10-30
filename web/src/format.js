const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const n2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

/** kuruş -> "₺1.234,50" */
export const money = (k) => tl.format((k || 0) / 100);
/** kuruş -> "1.234,50" (para birimsiz) */
export const plain = (k) => n2.format((k || 0) / 100);
export const qty = (q) => n3.format(q || 0);

/** "1.234,50" / "1234.5" / "12" -> kuruş */
export function toKurus(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input ?? '').trim().replace(/[₺\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

/** kuruş -> input alanı için "12,50" */
export const toInput = (k) => (k ? (k / 100).toFixed(2).replace('.', ',') : '');

export const parseQty = (s) => {
  const v = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

export const today = () => new Date().toLocaleDateString('sv-SE');
export const nowSql = () => new Date().toLocaleString('sv-SE').slice(0, 19);
export const dt = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const d = (s) => (s ? new Date(`${s.slice(0, 10)}T00:00`).toLocaleDateString('tr-TR') : '');

export const METHOD_LABELS = { cash: 'Nakit', card: 'Kart', credit: 'Veresiye', transfer: 'Havale/EFT', points: 'Puan' };
export const FISCAL_LABELS = { none: ['Bilgi fişi', ''], pending: ['Yazarkasada', 'yellow'], done: ['Mali fiş', 'green'], failed: ['Mali fiş basılamadı', 'red'] };
export const ROLE_LABELS = { admin: 'Yönetici', manager: 'Müdür', cashier: 'Kasiyer', staff: 'Personel' };
