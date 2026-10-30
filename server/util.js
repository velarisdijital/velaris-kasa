export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Kayıt bulunamadı') => new HttpError(404, msg);

/** async/sync route handler'larındaki hataları error middleware'e iletir. */
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.catch(next);
  } catch (e) {
    next(e);
  }
};

export const int = (v, def = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
};

export const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const str = (v) => (v == null ? null : String(v).trim() || null);

export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/** KDV dahil tutardan KDV payını hesaplar (kuruş). */
export const vatOf = (gross, rate) => Math.round(gross - gross / (1 + rate / 100));

/** Türkiye cep telefonu → "905xxxxxxxxx". Geçersizse null. */
export function phoneTR(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('90')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{9}$/.test(d) ? `90${d}` : null;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** "YYYY-MM-DD" aralığını SQL için [from 00:00:00, to 23:59:59] olarak döndürür. */
export function dateRange(q) {
  const today = new Date().toLocaleDateString('sv-SE');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : from;
  return [`${from} 00:00:00`, `${to} 23:59:59`];
}
