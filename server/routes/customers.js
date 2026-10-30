import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent } from '../db.js';
import { bad, bool, h, int, notFound, str } from '../util.js';
import { openShiftFor } from './shifts.js';

export const customerPayload = (c) => c && ({
  id: c.id, crm_id: c.crm_id, name: c.name, phone: c.phone, email: c.email, note: c.note,
  balance: c.balance, credit_limit: c.credit_limit, active: c.active, updated_at: c.updated_at,
});

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
    res.json({ ...c, transactions, sales, stats });
  }));

  r.post('/customers', h((req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('Müşteri adı gerekli');
    const id = db.transaction(() => {
      const id = db.prepare('INSERT INTO customers (name, phone, email, note, credit_limit, crm_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, str(req.body.phone), str(req.body.email), str(req.body.note), int(req.body.credit_limit), str(req.body.crm_id)).lastInsertRowid;
      emitEvent(db, 'customer.created', customerPayload(get(id)));
      return id;
    })();
    res.status(201).json(get(id));
  }));

  r.put('/customers/:id', h((req, res) => {
    const c = get(req.params.id);
    if (!c) throw notFound();
    const name = str(req.body.name ?? c.name);
    if (!name) throw bad('Müşteri adı gerekli');
    db.transaction(() => {
      db.prepare(`UPDATE customers SET name=?, phone=?, email=?, note=?, credit_limit=?, active=?, updated_at=datetime('now','localtime')
        WHERE id=?`).run(name, str(req.body.phone ?? c.phone), str(req.body.email ?? c.email), str(req.body.note ?? c.note),
        int(req.body.credit_limit ?? c.credit_limit), req.body.active === undefined ? c.active : bool(req.body.active), c.id);
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
