import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent } from '../db.js';
import { bad, bool, h, int, notFound, phoneTR, str } from '../util.js';
import { openShiftFor } from './shifts.js';

export const customerPayload = (c) => c && ({
  id: c.id, crm_id: c.crm_id, name: c.name, phone: c.phone, email: c.email, note: c.note,
  balance: c.balance, credit_limit: c.credit_limit, points: c.points, active: c.active, updated_at: c.updated_at,
  tax_number: c.tax_number, tax_office: c.tax_office, address: c.address, city: c.city, district: c.district,
  consent: { sms: !!c.sms_consent, email: !!c.email_consent, at: c.consent_at, source: c.consent_source },
});

const IYS_SOURCE = { kasa: 'HS_FIZIKSEL_ORTAM', online: 'HS_WEB', crm: 'HS_EORTAM', imza: 'HS_ISLAK_IMZA' };

/** Müşteri formundaki alanları doğrular. Onay değişirse tarih/kaynak güncellenir. */
function customerFields(body, c = {}) {
  const v = (k) => (body[k] !== undefined ? str(body[k]) : c[k] ?? null);
  const f = {
    name: v('name'), phone: v('phone'), email: v('email'), note: v('note'),
    credit_limit: body.credit_limit !== undefined ? int(body.credit_limit) : c.credit_limit ?? 0,
    tax_number: v('tax_number'), tax_office: v('tax_office'), address: v('address'), city: v('city'), district: v('district'),
    sms_consent: body.sms_consent !== undefined ? bool(body.sms_consent) : c.sms_consent ?? 0,
    email_consent: body.email_consent !== undefined ? bool(body.email_consent) : c.email_consent ?? 0,
    consent_at: c.consent_at ?? null,
    consent_source: c.consent_source ?? null,
  };
  if (!f.name) throw bad('Müşteri adı gerekli');
  if (f.tax_number && !/^\d{10,11}$/.test(f.tax_number)) throw bad('VKN 10, TCKN 11 haneli olmalı');
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw bad('E-posta adresi geçersiz');
  if (f.sms_consent !== (c.sms_consent ?? 0) || f.email_consent !== (c.email_consent ?? 0)) {
    f.consent_at = new Date().toLocaleString('sv-SE').slice(0, 19);
    f.consent_source = str(body.consent_source) || 'kasa';
    f.iys_exported_at = null;
  }
  return f;
}

/** Veresiye hareketi ekler ve bakiyeyi günceller. Transaction içinde çağrılmalı. */
export function addCustomerTx(db, customerId, type, amount, extra = {}) {
  const c = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
  if (!c) throw notFound('Müşteri bulunamadı');
  const after = c.balance + amount;
  db.prepare("UPDATE customers SET balance = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, customerId);
  db.prepare(`INSERT INTO customer_transactions (customer_id, type, amount, balance_after, method, sale_id, shift_id, note, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(customerId, type, amount, after, extra.method ?? null, extra.saleId ?? null, extra.shiftId ?? null, extra.note ?? null, extra.userId ?? null);
  return after;
}

/** Puan hareketi ekler (kuruş cinsinden para puan). Transaction içinde çağrılmalı. Bakiye eksiye düşmez. */
export function addPointsTx(db, customerId, type, points, extra = {}) {
  const c = db.prepare('SELECT points FROM customers WHERE id = ?').get(customerId);
  if (!c || !points) return c?.points ?? 0;
  const delta = Math.max(points, -c.points);
  if (!delta) return c.points;
  const after = c.points + delta;
  db.prepare("UPDATE customers SET points = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, customerId);
  db.prepare(`INSERT INTO points_transactions (customer_id, sale_id, type, points, balance_after, note, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(customerId, extra.saleId ?? null, type, delta, after, extra.note ?? null, extra.userId ?? null);
  return after;
}

/** CRM'den gelen müşteriyi crm_id (yoksa telefon) ile eşleştirip ekler/günceller. */
export function upsertCustomerFromCrm(db, data) {
  const crmId = str(data.crm_id ?? data.id);
  if (!crmId) throw bad('crm_id gerekli');
  const name = str(data.name) || [str(data.first_name), str(data.last_name)].filter(Boolean).join(' ');
  if (!name) throw bad('Müşteri adı gerekli');
  let existing = db.prepare('SELECT * FROM customers WHERE crm_id = ?').get(crmId);
  if (!existing && str(data.phone)) {
    existing = db.prepare('SELECT * FROM customers WHERE phone = ? AND crm_id IS NULL').get(str(data.phone));
  }
  const values = { name, phone: str(data.phone), email: str(data.email), note: str(data.note), crm_id: crmId };
  if (existing) {
    db.prepare(`UPDATE customers SET name=@name, phone=COALESCE(@phone, phone), email=COALESCE(@email, email),
      note=COALESCE(@note, note), crm_id=@crm_id, active=1, updated_at=datetime('now','localtime') WHERE id=@id`)
      .run({ ...values, id: existing.id });
    return existing.id;
  }
  return db.prepare('INSERT INTO customers (name, phone, email, note, crm_id) VALUES (@name, @phone, @email, @note, @crm_id)')
    .run(values).lastInsertRowid;
}

export default function customerRoutes(db) {
  const r = Router();
  const get = (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id);

  r.get('/customers', h((req, res) => {
    const where = ['active = 1'];
    const params = { limit: Math.min(int(req.query.limit, 500) || 500, 5000) };
    if (req.query.q) {
      where.push('(name LIKE @q OR phone LIKE @q OR email LIKE @q)');
      params.q = `%${req.query.q}%`;
    }
    if (req.query.debt === '1') where.push('balance > 0');
    if (req.query.updated_since) { where.push('updated_at >= @since'); params.since = req.query.updated_since; }
    res.json(db.prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY name LIMIT @limit`).all(params));
  }));

  r.get('/customers/:id', h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const transactions = db.prepare(`SELECT t.*, s.receipt_no, u.name AS user_name FROM customer_transactions t
      LEFT JOIN sales s ON s.id = t.sale_id LEFT JOIN users u ON u.id = t.user_id
      WHERE t.customer_id = ? ORDER BY t.id DESC LIMIT 200`).all(c.id);
    const sales = db.prepare(`SELECT id, receipt_no, total, status, created_at FROM sales WHERE customer_id = ?
      ORDER BY id DESC LIMIT 50`).all(c.id);
    const stats = db.prepare(`SELECT COUNT(*) AS visit_count, COALESCE(SUM(total - refunded_total),0) AS total_spent,
      MAX(created_at) AS last_visit FROM sales WHERE customer_id = ?`).get(c.id);
    const points_transactions = db.prepare(`SELECT p.*, s.receipt_no FROM points_transactions p LEFT JOIN sales s ON s.id = p.sale_id
      WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 100`).all(c.id);
    res.json({ ...c, transactions, points_transactions, sales, stats });
  }));

  r.post('/customers', h((req, res) => {
    const f = customerFields(req.body);
    const id = db.transaction(() => {
      const id = db.prepare(`INSERT INTO customers (name, phone, email, note, credit_limit, crm_id, tax_number, tax_office, address, city,
          district, sms_consent, email_consent, consent_at, consent_source)
        VALUES (@name, @phone, @email, @note, @credit_limit, @crm_id, @tax_number, @tax_office, @address, @city,
          @district, @sms_consent, @email_consent, @consent_at, @consent_source)`).run({ ...f, crm_id: str(req.body.crm_id) }).lastInsertRowid;
      emitEvent(db, 'customer.created', customerPayload(get(id)));
      return id;
    })();
    res.status(201).json(get(id));
  }));

  r.put('/customers/:id', h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const f = customerFields(req.body, c);
    db.transaction(() => {
      db.prepare(`UPDATE customers SET name=@name, phone=@phone, email=@email, note=@note, credit_limit=@credit_limit, active=@active,
          tax_number=@tax_number, tax_office=@tax_office, address=@address, city=@city, district=@district,
          sms_consent=@sms_consent, email_consent=@email_consent, consent_at=@consent_at, consent_source=@consent_source,
          iys_exported_at=@iys_exported_at, updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({ ...f, iys_exported_at: f.iys_exported_at === null ? null : c.iys_exported_at,
          active: req.body.active === undefined ? c.active : bool(req.body.active), id: c.id });
      emitEvent(db, 'customer.updated', customerPayload(get(c.id)));
    })();
    res.json(get(c.id));
  }));

  r.delete('/customers/:id', allow(...MANAGERS), h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    if (c.balance !== 0) throw bad('Bakiyesi olan müşteri silinemez');
    db.prepare("UPDATE customers SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(c.id);
    res.json({ ok: true });
  }));

  /** Elle puan düzeltme (yönetici). points işaretli, kuruş. */
  r.post('/customers/:id/points', allow(...MANAGERS), h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const points = int(req.body.points);
    if (!points) throw bad('Puan gerekli');
    db.transaction(() => addPointsTx(db, c.id, 'adjust', points, { note: str(req.body.note) || 'Puan düzeltme', userId: req.user.id }))();
    res.json(get(c.id));
  }));

  /** KVKK: müşterinin tüm verisini dışa aktar (bilgi talebi). */
  r.get('/customers/:id/export', allow(...MANAGERS), h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    res.json({
      exported_at: new Date().toISOString(),
      customer: c,
      transactions: db.prepare('SELECT * FROM customer_transactions WHERE customer_id = ?').all(c.id),
      points: db.prepare('SELECT * FROM points_transactions WHERE customer_id = ?').all(c.id),
      sales: db.prepare('SELECT id, receipt_no, total, created_at FROM sales WHERE customer_id = ?').all(c.id),
      appointments: db.prepare('SELECT id, start_at, status FROM appointments WHERE customer_id = ?').all(c.id),
      notifications: db.prepare('SELECT channel, kind, body, status, created_at FROM notifications WHERE customer_id = ?').all(c.id),
    });
  }));

  /** KVKK: kişisel verileri sil (anonimleştir). Satış kayıtları yasal saklama için kalır, kişiyle bağı kopar. */
  r.post('/customers/:id/anonymize', allow(...MANAGERS), h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    if (c.balance !== 0) throw bad('Veresiye bakiyesi kapanmadan müşteri verisi silinemez');
    db.transaction(() => {
      db.prepare(`UPDATE customers SET name = ?, phone = NULL, email = NULL, note = NULL, tax_number = NULL, tax_office = NULL,
        address = NULL, city = NULL, district = NULL, sms_consent = 0, email_consent = 0, crm_id = NULL, active = 0,
        updated_at = datetime('now','localtime') WHERE id = ?`).run(`Silinmiş müşteri #${c.id}`, c.id);
      db.prepare("UPDATE appointments SET customer_name = NULL, phone = NULL WHERE customer_id = ?").run(c.id);
      db.prepare("UPDATE notifications SET to_phone = '***', body = '[silindi]' WHERE customer_id = ?").run(c.id);
    })();
    res.json({ ok: true });
  }));

  /**
   * İYS'ye yüklenecek onaylar (3 iş günü içinde yüklenmeli). ?mark=1 ile dışa aktarılmış olarak işaretler.
   * Satırlar İYS toplu yükleme şablonundaki alanlara karşılık gelir.
   */
  r.get('/iys/export', allow(...MANAGERS), h((req, res) => {
    const rows = db.prepare(`SELECT id, name, phone, email, sms_consent, email_consent, consent_at, consent_source FROM customers
      WHERE active = 1 AND consent_at IS NOT NULL AND iys_exported_at IS NULL ORDER BY consent_at`).all();
    const out = [];
    for (const c of rows) {
      const source = IYS_SOURCE[c.consent_source] || 'HS_FIZIKSEL_ORTAM';
      const phone = phoneTR(c.phone);
      if (phone) out.push({ customer_id: c.id, name: c.name, type: 'MESAJ', recipient: `+${phone}`, status: c.sms_consent ? 'ONAY' : 'RET', source, consent_date: c.consent_at });
      if (c.email) out.push({ customer_id: c.id, name: c.name, type: 'EPOSTA', recipient: c.email, status: c.email_consent ? 'ONAY' : 'RET', source, consent_date: c.consent_at });
    }
    if (req.query.mark === '1' && rows.length) {
      db.prepare(`UPDATE customers SET iys_exported_at = datetime('now','localtime') WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id));
    }
    res.json({ count: out.length, rows: out });
  }));

  /** Veresiye tahsilatı. body: { amount (kuruş), method: cash|card|transfer, note, register_name } */
  r.post('/customers/:id/payment', h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const amount = int(req.body.amount);
    const method = req.body.method || 'cash';
    if (amount <= 0) throw bad('Tutar sıfırdan büyük olmalı');
    if (!['cash', 'card', 'transfer'].includes(method)) throw bad('Geçersiz ödeme yöntemi');
    db.transaction(() => {
      const shift = openShiftFor(db, req.body.register_name);
      const after = addCustomerTx(db, c.id, 'payment', -amount, { method, shiftId: shift?.id, note: str(req.body.note), userId: req.user.id });
      emitEvent(db, 'payment.received', { customer: customerPayload(get(c.id)), amount, method, balance_after: after });
    })();
    res.json(get(c.id));
  }));

  /** Elle bakiye düzeltme (yalnızca yönetici). amount işaretli: + borç ekler. */
  r.post('/customers/:id/adjust', allow(...MANAGERS), h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const amount = int(req.body.amount);
    if (!amount) throw bad('Tutar gerekli');
    db.transaction(() => {
      addCustomerTx(db, c.id, amount > 0 ? 'debt' : 'adjust', amount, { note: str(req.body.note) || 'Bakiye düzeltme', userId: req.user.id });
      emitEvent(db, 'customer.updated', customerPayload(get(c.id)));
    })();
    res.json(get(c.id));
  }));

  /** CRM tarafının müşteri göndermesi için (API anahtarı ile). */
  r.post('/customers/upsert-by-crm', allow(...MANAGERS), h((req, res) => {
    const id = db.transaction(() => upsertCustomerFromCrm(db, req.body))();
    res.json(get(id));
  }));

  return r;
}
