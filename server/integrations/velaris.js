// Velaris CRM entegrasyonu
//
// Giden: outbox tablosundaki olaylar  POST {crm_base_url}/api/pos/events  adresine gönderilir.
//   Başlıklar: Authorization: Bearer {crm_api_key}, X-Velaris-Event, X-Velaris-Signature (HMAC-SHA256),
//              Idempotency-Key (aynı olay tekrar gönderilirse CRM yinelemeyi atlayabilsin)
// Gelen:  CRM, kasaya API anahtarıyla /api/v1/* uçlarından erişir ya da
//         POST /api/integration/webhook ucuna imzalı olay gönderir.
// Müşteri çekme: GET {crm_base_url}/api/customers?updated_since=...  (5 dakikada bir)
//
// Ayrıntılı sözleşme: docs/VELARIS_ENTEGRASYON.md

import crypto from 'node:crypto';
import { getSetting, getSettings, setSettings } from '../db.js';
import { upsertCustomerFromCrm } from '../routes/customers.js';

const MAX_ATTEMPTS = 12;
const TIMEOUT_MS = 10_000;

export const sign = (secret, body) => crypto.createHmac('sha256', secret || '').update(body).digest('hex');

function config(db) {
  const s = getSettings(db);
  return {
    enabled: s.crm_enabled === '1' && !!s.crm_base_url,
    baseUrl: (s.crm_base_url || '').replace(/\/+$/, ''),
    apiKey: s.crm_api_key,
    secret: s.crm_webhook_secret,
    installId: s.install_id,
    business: s.business_name,
    syncCustomers: s.crm_sync_customers === '1',
  };
}

async function request(cfg, method, path, body, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(cfg.baseUrl + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(raw ? { 'Content-Type': 'application/json', 'X-Velaris-Signature': `sha256=${sign(cfg.secret, raw)}` } : {}),
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        'X-Velaris-Source': 'velaris-kasa',
        'X-Velaris-Install': cfg.installId || '',
        ...extraHeaders,
      },
      body: raw,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON olmayan yanıt */ }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json?.error || json?.message || text).toString().slice(0, 200)}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zaman aşımı (CRM yanıt vermedi)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** CRM yanıtında dönen kimlikleri yerel kayıtlara işler (ör. yeni müşterinin crm_id'si). */
function applyResponse(db, row, payload, response) {
  const crmId = response?.crm_id ?? response?.data?.crm_id ?? response?.id;
  if (!crmId) return;
  if (row.event === 'customer.created' && payload.id && !payload.crm_id) {
    db.prepare('UPDATE customers SET crm_id = ? WHERE id = ? AND crm_id IS NULL').run(String(crmId), payload.id);
  }
  if (row.event === 'product.upserted' && payload.id && !payload.crm_id) {
    db.prepare('UPDATE products SET crm_id = ? WHERE id = ? AND crm_id IS NULL').run(String(crmId), payload.id);
  }
}

export async function flushOutbox(db, { limit = 25 } = {}) {
  const cfg = config(db);
  if (!cfg.enabled) return { sent: 0, failed: 0 };
  const rows = db.prepare(`SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= datetime('now','localtime')
    ORDER BY id LIMIT ?`).all(limit);
  let sent = 0, failed = 0;
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    // Müşteri olayları CRM kimliği öğrenildikten sonra gönderilsin diye güncel crm_id eklenir
    if (payload && row.event.startsWith('customer.') && payload.id && !payload.crm_id) {
      payload.crm_id = db.prepare('SELECT crm_id FROM customers WHERE id = ?').get(payload.id)?.crm_id ?? null;
    }
    const envelope = {
      id: `${cfg.installId}-${row.id}`,
      event: row.event,
      occurred_at: row.created_at,
      source: { app: 'velaris-kasa', install_id: cfg.installId, business: cfg.business },
      data: payload,
    };
    try {
      const response = await request(cfg, 'POST', '/api/pos/events', envelope, {
        'X-Velaris-Event': row.event,
        'Idempotency-Key': envelope.id,
      });
      db.transaction(() => {
        db.prepare("UPDATE outbox SET status = 'sent', sent_at = datetime('now','localtime'), attempts = attempts + 1, last_error = NULL WHERE id = ?").run(row.id);
        applyResponse(db, row, payload, response);
      })();
      sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const delayMin = Math.min(2 ** attempts, 360); // 2, 4, 8 ... en fazla 6 saat
      db.prepare(`UPDATE outbox SET attempts = ?, last_error = ?, status = ?,
        next_attempt_at = datetime('now','localtime', ?) WHERE id = ?`)
        .run(attempts, String(e.message).slice(0, 500), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', `+${delayMin} minutes`, row.id);
      failed++;
      // CRM'e ulaşılamıyorsa kalan olayları zorlamayalım
      if (/Zaman aşımı|fetch failed|ECONNREFUSED|ENOTFOUND/.test(e.message)) break;
    }
  }
  return { sent, failed };
}

/** CRM'deki müşterileri kasaya çeker (artımlı). */
export async function pullCustomers(db) {
  const cfg = config(db);
  if (!cfg.enabled || !cfg.syncCustomers) return { imported: 0 };
  const since = getSetting(db, 'crm_last_customer_pull') || '';
  const startedAt = new Date().toISOString();
  let page = 1, imported = 0;
  for (;;) {
    const res = await request(cfg, 'GET', `/api/customers?updated_since=${encodeURIComponent(since)}&page=${page}&per_page=200`);
    const list = Array.isArray(res) ? res : res?.data || [];
    db.transaction(() => {
      for (const c of list) {
        try { upsertCustomerFromCrm(db, c); imported++; } catch { /* eksik alanlı kayıt atlanır */ }
      }
    })();
    const hasMore = !Array.isArray(res) && (res?.has_more || (res?.meta?.last_page && page < res.meta.last_page));
    if (!hasMore || !list.length || page >= 100) break;
    page++;
  }
  setSettings(db, { crm_last_customer_pull: startedAt });
  return { imported };
}

export async function testConnection(db) {
  const cfg = config(db);
  if (!cfg.baseUrl) throw new Error('CRM adresi girilmemiş');
  const res = await request(cfg, 'GET', '/api/pos/ping');
  return { ok: true, response: res };
}

export function outboxStatus(db) {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status').all().map((r) => [r.status, r.n]));
  const recent = db.prepare('SELECT id, event, status, attempts, last_error, created_at, sent_at FROM outbox ORDER BY id DESC LIMIT 30').all();
  return { counts: { pending: 0, sent: 0, failed: 0, ...counts }, recent };
}

/** Arka plan işçisi: olayları gönderir, müşterileri periyodik çeker. */
export function startIntegrationWorker(db, log = console) {
  let busy = false;
  let lastPull = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await flushOutbox(db);
      if (Date.now() - lastPull > 5 * 60_000 && config(db).enabled) {
        lastPull = Date.now();
        await pullCustomers(db).catch((e) => log.warn?.(`[velaris-crm] müşteri çekme hatası: ${e.message}`));
      }
      // 30 günden eski gönderilmiş olayları temizle
      db.prepare("DELETE FROM outbox WHERE status = 'sent' AND sent_at < datetime('now','localtime','-30 days')").run();
    } catch (e) {
      log.warn?.(`[velaris-crm] ${e.message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
