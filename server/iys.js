// İYS (İleti Yönetim Sistemi) — ticari ileti onaylarının otomatik yüklenmesi.
//
// Kasada / online randevuda alınan onay ya da ret, 3 iş günü içinde İYS'ye bildirilmelidir. Açıkken işçi her dakika
// bekleyen kayıtları gönderir.
//   Oturum:  POST {host}/oauth2/token                                  { username, password, grant_type: 'password' }
//   Onay:    POST {host}/sps/{iysCode}/brands/{brandCode}/consents      { type, source, recipient, status, consentDate, recipientType }
//   Ortam:   deneme https://api.sandbox.iys.org.tr · canlı https://api.iys.org.tr
// (Uç noktalar açık kaynak İYS istemcilerinden doğrulandı; canlıya geçmeden önce İYS deneme ortamında test edin.)

import { getSettings, setSettings } from './db.js';
import { hasFeature } from './license.js';
import { phoneTR } from './util.js';

const HOSTS = { sandbox: 'https://api.sandbox.iys.org.tr', live: 'https://api.iys.org.tr' };
const SOURCE = { kasa: 'HS_FIZIKSEL_ORTAM', online: 'HS_WEB', crm: 'HS_EORTAM', imza: 'HS_ISLAK_IMZA' };
const TIMEOUT_MS = 15_000;

export const iysEnabled = (db) => {
  const s = getSettings(db);
  return s.iys_enabled === '1' && hasFeature(db, 'sms');
};

async function req(url, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'İYS yanıt vermedi' : e.message);
  } finally {
    clearTimeout(t);
  }
}

const errText = (j, status) => j?.errors?.map((e) => [e.code, e.message].filter(Boolean).join(' ')).join('; ') || j?.message || j?.error_description || `HTTP ${status}`;

async function token(db) {
  const s = getSettings(db);
  if (s.iys_access_token && Number(s.iys_token_expires || 0) > Date.now() + 60_000) return s.iys_access_token;
  if (!s.iys_username || !s.iys_password || !s.iys_code || !s.iys_brand_code) throw new Error('İYS bilgileri eksik (Ayarlar → SMS & WhatsApp → İYS)');
  const r = await req(`${HOSTS[s.iys_env] || HOSTS.sandbox}/oauth2/token`, { username: s.iys_username, password: s.iys_password, grant_type: 'password' });
  if (!r.ok || !r.json.access_token) throw new Error(`İYS girişi başarısız: ${errText(r.json, r.status)}`);
  setSettings(db, { iys_access_token: r.json.access_token, iys_token_expires: String(Date.now() + (Number(r.json.expires_in) || 3600) * 1000) });
  return r.json.access_token;
}

/** Bekleyen onay/ret kayıtlarını İYS'ye gönderir. */
export async function pushConsents(db, { limit = 50 } = {}) {
  if (!iysEnabled(db)) return { sent: 0, failed: 0, skipped: 0 };
  const s = getSettings(db);
  const host = HOSTS[s.iys_env] || HOSTS.sandbox;
  const rows = db.prepare(`SELECT * FROM customers WHERE active = 1 AND consent_at IS NOT NULL AND iys_exported_at IS NULL
    ORDER BY consent_at LIMIT ?`).all(limit);
  let sent = 0, failed = 0, skipped = 0;
  if (!rows.length) return { sent, failed, skipped };
  const tok = await token(db);
  const url = `${host}/sps/${encodeURIComponent(s.iys_code)}/brands/${encodeURIComponent(s.iys_brand_code)}/consents`;

  for (const c of rows) {
    const items = [];
    const phone = phoneTR(c.phone);
    if (phone) items.push({ type: 'MESAJ', recipient: `+${phone}`, status: c.sms_consent ? 'ONAY' : 'RET' });
    if (c.email) items.push({ type: 'EPOSTA', recipient: c.email, status: c.email_consent ? 'ONAY' : 'RET' });
    if (!items.length) {
      db.prepare("UPDATE customers SET iys_exported_at = datetime('now','localtime'), iys_error = 'Telefon/e-posta yok' WHERE id = ?").run(c.id);
      skipped++;
      continue;
    }
    const errors = [];
    for (const it of items) {
      const r = await req(url, {
        ...it, source: SOURCE[c.consent_source] || 'HS_FIZIKSEL_ORTAM', consentDate: c.consent_at, recipientType: 'BIREYSEL',
      }, tok);
      // 409: aynı onay İYS'de zaten kayıtlı → başarılı say
      if (!r.ok && r.status !== 409) errors.push(`${it.type}: ${errText(r.json, r.status)}`);
    }
    if (errors.length) {
      db.prepare('UPDATE customers SET iys_error = ? WHERE id = ?').run(errors.join(' | ').slice(0, 300), c.id);
      failed++;
    } else {
      db.prepare("UPDATE customers SET iys_exported_at = datetime('now','localtime'), iys_error = NULL WHERE id = ?").run(c.id);
      sent++;
    }
  }
  return { sent, failed, skipped };
}

export function iysStatus(db) {
  return {
    enabled: iysEnabled(db),
    pending: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE active = 1 AND consent_at IS NOT NULL AND iys_exported_at IS NULL').get().n,
    failed: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE iys_exported_at IS NULL AND iys_error IS NOT NULL').get().n,
    sent: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE iys_exported_at IS NOT NULL AND iys_error IS NULL').get().n,
    errors: db.prepare(`SELECT id, name, iys_error FROM customers WHERE iys_exported_at IS NULL AND iys_error IS NOT NULL
      ORDER BY id DESC LIMIT 10`).all(),
  };
}
