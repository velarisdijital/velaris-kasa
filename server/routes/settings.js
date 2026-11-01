import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allow, createApiKey, hashSecret } from '../auth.js';
import { DEFAULT_SETTINGS, emitEvent, getSettings, setSettings } from '../db.js';
import { FISCAL_DRIVERS, fiscalStatus } from '../fiscal.js';
import { currentLicense, FEATURE_LABELS, limitError, PLANS, requireFeature, verifyLicense } from '../license.js';
import { flushOutbox, outboxStatus, pullCustomers, sign, testConnection } from '../integrations/velaris.js';
import { bad, bool, h, int, notFound, num, str } from '../util.js';
import { upsertCustomerFromCrm } from './customers.js';

const SECRET_KEYS = ['license_key', 'crm_api_key', 'crm_webhook_secret', 'netgsm_password', 'iletimerkezi_hash', 'whatsapp_token', 'parasut_client_secret', 'parasut_password', 'parasut_access_token', 'iys_password', 'iys_access_token', 'platform_secret'];
const ADMIN_ONLY_KEYS = [...SECRET_KEYS, 'crm_base_url', 'install_id', 'netgsm_usercode', 'iletimerkezi_key', 'whatsapp_phone_id', 'parasut_client_id', 'parasut_username', 'parasut_company_id', 'iys_username', 'iys_code', 'iys_brand_code', 'iys_token_expires'];

export default function settingsRoutes(db) {
  const r = Router();

  r.get('/settings', h((req, res) => {
    const s = getSettings(db);
    const isAdmin = req.user.role === 'admin';
    for (const k of ADMIN_ONLY_KEYS) if (!isAdmin) delete s[k];
    for (const k of SECRET_KEYS) if (s[k]) s[k] = '••••••••';
    res.json(s);
  }));

  r.put('/settings', allow(), h((req, res) => {
    const values = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!(k in DEFAULT_SETTINGS) || k === 'setup_done') continue;
      if (SECRET_KEYS.includes(k) && v === '••••••••') continue; // maskeli değer değişmedi
      values[k] = v;
    }
    if (values.crm_base_url && !/^https?:\/\//.test(values.crm_base_url)) throw bad('CRM adresi http:// veya https:// ile başlamalı');
    delete values.license_key; // lisans yalnızca /license ucundan
    // Paket dışı bir özellik açılmaya çalışılıyorsa durdur
    const ON = { fiscal_driver: ['fiscal', (v) => v && v !== 'none'], invoice_provider: ['invoice', (v) => v && v !== 'none'],
      notify_provider: ['sms', (v) => v && v !== 'none'], loyalty_enabled: ['loyalty', (v) => String(v) === '1'],
      booking_enabled: ['booking', (v) => String(v) === '1'], reminder_enabled: ['reminders', (v) => String(v) === '1'],
      crm_enabled: ['crm', (v) => String(v) === '1'], iys_enabled: ['sms', (v) => String(v) === '1'], modules_appointments: ['appointments', (v) => String(v) === '1'], modules_tables: ['tables', (v) => String(v) === '1'], modules_delivery: ['tables', (v) => String(v) === '1'] };
    const before = getSettings(db);
    for (const [k, [feat, isOn]] of Object.entries(ON)) if (k in values && isOn(values[k]) && !isOn(before[k])) requireFeature(db, feat);
    delete values.parasut_access_token;
    delete values.parasut_token_expires;
    delete values.iys_access_token;
    delete values.iys_token_expires;
    if (['iys_username', 'iys_password', 'iys_env'].some((k) => k in values)) { values.iys_access_token = ''; values.iys_token_expires = ''; }
    // Paraşüt bilgileri değiştiyse eski oturum anahtarı geçersiz
    const current = getSettings(db);
    if (Object.keys(values).some((k) => k.startsWith('parasut_') && values[k] !== current[k])) {
      values.parasut_access_token = '';
      values.parasut_token_expires = '';
    }
    setSettings(db, values);
    res.json({ ok: true });
  }));

  // ---- Paket / lisans ----
  r.get('/license', h((req, res) => {
    res.json({
      ...currentLicense(db), install_id: req.user.role === 'admin' ? getSettings(db).install_id : undefined,
      feature_labels: FEATURE_LABELS,
      plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { name: p.name, price: p.price, features: p.features,
        limits: { registers: p.limits.registers === Infinity ? null : p.limits.registers, users: p.limits.users === Infinity ? null : p.limits.users } }])),
    });
  }));
  r.post('/license', allow(), h((req, res) => {
    let p;
    try { p = verifyLicense(req.body.key); } catch (e) { throw bad(e.message); }
    if (p.install && p.install !== getSettings(db).install_id) throw bad('Bu lisans başka bir kuruluma ait');
    setSettings(db, { license_key: String(req.body.key).trim() });
    res.json(currentLicense(db));
  }));
  r.delete('/license', allow(), h((req, res) => {
    setSettings(db, { license_key: '' });
    res.json(currentLicense(db));
  }));

  // ---- Yazarkasa ----
  r.get('/fiscal/status', h(async (req, res) => res.json({ ...(await fiscalStatus(db)), drivers: FISCAL_DRIVERS })));

  // ---- Kullanıcılar / personel ----
  r.get('/users', h((req, res) => {
    const cols = req.user.role === 'admin' ? 'id, name, role, commission_rate, color, active, created_at' : 'id, name, role, color, active';
    res.json(db.prepare(`SELECT ${cols} FROM users ORDER BY active DESC, name`).all());
  }));

  const ROLES = ['admin', 'manager', 'cashier', 'staff'];
  r.post('/users', allow(), h((req, res) => {
    const lic = currentLicense(db);
    const active = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
    if (lic.limits.users != null && active >= lic.limits.users) throw limitError('kullanıcı', lic.limits.users, lic.plan_name);
    const name = str(req.body.name);
    if (!name) throw bad('Ad gerekli');
    if (!/^\d{4,8}$/.test(String(req.body.pin || ''))) throw bad('PIN 4-8 haneli rakam olmalı');
    const role = ROLES.includes(req.body.role) ? req.body.role : 'cashier';
    const id = db.prepare('INSERT INTO users (name, pin_hash, role, commission_rate, color) VALUES (?, ?, ?, ?, ?)')
      .run(name, hashSecret(req.body.pin), role, num(req.body.commission_rate), str(req.body.color)).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT id, name, role, commission_rate, color, active FROM users WHERE id = ?').get(id));
  }));

  r.put('/users/:id', allow(), h((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw notFound();
    const role = ROLES.includes(req.body.role) ? req.body.role : u.role;
    const active = req.body.active === undefined ? u.active : bool(req.body.active);
    if (u.role === 'admin' && (role !== 'admin' || !active)) {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw bad('En az bir aktif yönetici kalmalı');
    }
    if (req.body.pin && !/^\d{4,8}$/.test(String(req.body.pin))) throw bad('PIN 4-8 haneli rakam olmalı');
    db.prepare('UPDATE users SET name = ?, role = ?, commission_rate = ?, color = ?, active = ?, pin_hash = ? WHERE id = ?')
      .run(str(req.body.name) || u.name, role, num(req.body.commission_rate ?? u.commission_rate), str(req.body.color) ?? u.color,
        active, req.body.pin ? hashSecret(req.body.pin) : u.pin_hash, u.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    res.json(db.prepare('SELECT id, name, role, commission_rate, color, active FROM users WHERE id = ?').get(u.id));
  }));

  // ---- API anahtarları (Velaris CRM'in kasaya erişmesi için) ----
  r.get('/api-keys', allow(), h((req, res) => {
    res.json(db.prepare('SELECT id, name, prefix, last_used, created_at FROM api_keys ORDER BY id DESC').all());
  }));
  r.post('/api-keys', allow(), h((req, res) => {
    requireFeature(db, 'api');
    const name = str(req.body.name) || 'Velaris CRM';
    res.status(201).json({ ...createApiKey(db, name), name });
  }));
  r.delete('/api-keys/:id', allow(), h((req, res) => {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  }));

  // ---- Yedekleme ----
  r.get('/backup', allow(), h(async (req, res) => {
    const file = path.join(os.tmpdir(), `velaris-kasa-yedek-${Date.now()}.db`);
    await db.backup(file);
    const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
    res.download(file, `velaris-kasa-yedek-${stamp}.db`, () => fs.rm(file, { force: true }, () => {}));
  }));

  // ---- Velaris CRM entegrasyonu ----
  r.get('/integration/status', allow(), h((req, res) => res.json(outboxStatus(db))));

  r.post('/integration/test', allow(), h(async (req, res) => {
    try {
      res.json(await testConnection(db));
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  }));

  r.post('/integration/flush', allow(), h(async (req, res) => {
    db.prepare("UPDATE outbox SET next_attempt_at = datetime('now','localtime') WHERE status = 'pending'").run();
    res.json(await flushOutbox(db, { limit: 200 }));
  }));

  r.post('/integration/retry-failed', allow(), h((req, res) => {
    const n = db.prepare("UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = datetime('now','localtime') WHERE status = 'failed'").run().changes;
    res.json({ requeued: n });
  }));

  r.post('/integration/pull-customers', allow(), h(async (req, res) => {
    if (req.body?.full) setSettings(db, { crm_last_customer_pull: '' });
    try {
      res.json(await pullCustomers(db));
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }));

  /** Mevcut tüm müşteri ve ürünleri CRM'e gönderilmek üzere kuyruğa ekler (ilk eşitleme). */
  r.post('/integration/push-all', allow(), h((req, res) => {
    let n = 0;
    db.transaction(() => {
      for (const c of db.prepare('SELECT * FROM customers WHERE active = 1').all()) {
        emitEvent(db, c.crm_id ? 'customer.updated' : 'customer.created', {
          id: c.id, crm_id: c.crm_id, name: c.name, phone: c.phone, email: c.email, note: c.note,
          balance: c.balance, credit_limit: c.credit_limit, active: c.active, updated_at: c.updated_at,
        });
        n++;
      }
      for (const p of db.prepare('SELECT * FROM products WHERE active = 1').all()) { emitEvent(db, 'product.upserted', p); n++; }
    })();
    res.json({ queued: n });
  }));

  return r;
}

/**
 * CRM'den kasaya imzalı webhook (oturum gerektirmez, HMAC ile doğrulanır).
 * Desteklenen olaylar: customer.upserted, customer.deleted, appointment.created
 */
export function inboundWebhook(db) {
  const r = Router();
  r.post('/integration/webhook', h((req, res) => {
    const s = getSettings(db);
    if (s.crm_enabled !== '1' || !s.crm_webhook_secret) return res.status(403).json({ error: 'Entegrasyon kapalı' });
    const given = String(req.get('x-velaris-signature') || '').replace(/^sha256=/, '');
    const expected = sign(s.crm_webhook_secret, req.rawBody || '');
    if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(401).json({ error: 'İmza doğrulanamadı' });
    }
    const { event, data } = req.body || {};
    const result = db.transaction(() => {
      switch (event) {
        case 'customer.upserted':
        case 'customer.created':
        case 'customer.updated':
          return { customer_id: upsertCustomerFromCrm(db, data) };
        case 'customer.deleted': {
          const n = db.prepare("UPDATE customers SET active = 0, updated_at = datetime('now','localtime') WHERE crm_id = ? AND balance = 0")
            .run(String(data?.crm_id ?? data?.id)).changes;
          return { deactivated: n };
        }
        case 'appointment.created': {
          const customerId = data?.customer ? upsertCustomerFromCrm(db, data.customer) : null;
          const start = String(data?.start_at || '').replace('T', ' ').slice(0, 16);
          if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start)) throw bad('start_at geçersiz');
          const id = db.prepare(`INSERT INTO appointments (customer_id, staff_id, service_id, start_at, duration_min, note, crm_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(customerId, data.staff_id ? int(data.staff_id) : null,
            data.service_id ? int(data.service_id) : null, start, int(data.duration_min, 30) || 30, str(data.note), str(data.crm_id ?? data.id)).lastInsertRowid;
          return { appointment_id: id };
        }
        default:
          throw bad(`Desteklenmeyen olay: ${event}`);
      }
    })();
    res.json({ ok: true, ...result });
  }));
  return r;
}
