import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent } from '../db.js';
import { bad, h, int, notFound, str } from '../util.js';

const regName = (v) => str(v) || 'Kasa 1';

export function openShiftFor(db, registerName) {
  return db.prepare('SELECT * FROM shifts WHERE register_name = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1').get(regName(registerName));
}

/** X / Z raporu: vardiya boyunca kasadaki hareketlerin özeti. */
export function shiftSummary(db, shift) {
  const id = shift.id;
  const sales = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(discount),0) AS discount,
    COALESCE(SUM(vat_total),0) AS vat_total, COALESCE(SUM(total - cost_total),0) AS gross_profit
    FROM sales WHERE shift_id = ?`).get(id);
  const byMethod = Object.fromEntries(db.prepare(`SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id WHERE s.shift_id = ? GROUP BY sp.method`).all(id).map((r) => [r.method, r.amount]));
  const refunds = Object.fromEntries(db.prepare(`SELECT method, SUM(amount) AS amount FROM refunds WHERE shift_id = ? GROUP BY method`)
    .all(id).map((r) => [r.method, r.amount]));
  const collections = Object.fromEntries(db.prepare(`SELECT method, -SUM(amount) AS amount FROM customer_transactions
    WHERE shift_id = ? AND type = 'payment' GROUP BY method`).all(id).map((r) => [r.method, r.amount]));
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='in' THEN amount END),0) AS cash_in,
    COALESCE(SUM(CASE WHEN type='out' THEN amount END),0) AS cash_out FROM cash_movements WHERE shift_id = ?`).get(id);
  const movements = db.prepare(`SELECT m.*, u.name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE shift_id = ? ORDER BY id`).all(id);

  const expected_cash = shift.opening_cash + (byMethod.cash || 0) - (refunds.cash || 0)
    + (collections.cash || 0) + cash.cash_in - cash.cash_out;
  const refund_total = Object.values(refunds).reduce((a, b) => a + b, 0);

  return {
    shift: { ...shift, user_name: db.prepare('SELECT name FROM users WHERE id = ?').get(shift.user_id)?.name },
    sales: { ...sales, net_total: sales.total - refund_total },
    payments: { cash: 0, card: 0, credit: 0, transfer: 0, ...byMethod },
    refunds: { total: refund_total, ...refunds },
    collections,
    cash_in: cash.cash_in,
    cash_out: cash.cash_out,
    movements,
    expected_cash,
    difference: shift.counted_cash != null ? shift.counted_cash - expected_cash : null,
  };
}

export default function shiftRoutes(db) {
  const r = Router();
  const get = (id) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);

  r.get('/shifts/current', h((req, res) => {
    const shift = openShiftFor(db, req.query.register);
    res.json(shift ? shiftSummary(db, shift) : null);
  }));

  r.get('/shifts', h((req, res) => {
    res.json(db.prepare(`SELECT s.*, u.name AS user_name FROM shifts s LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.id DESC LIMIT ?`).all(Math.min(int(req.query.limit, 50) || 50, 500)));
  }));

  r.get('/shifts/:id', h((req, res) => {
    const shift = get(req.params.id);
    if (!shift) throw notFound();
    res.json(shiftSummary(db, shift));
  }));

  r.post('/shifts/open', h((req, res) => {
    const name = regName(req.body.register_name);
    if (openShiftFor(db, name)) throw bad(`${name} zaten açık`);
    const opening = int(req.body.opening_cash);
    if (opening < 0) throw bad('Açılış tutarı negatif olamaz');
    const id = db.prepare('INSERT INTO shifts (register_name, user_id, opening_cash) VALUES (?, ?, ?)')
      .run(name, req.user.id, opening).lastInsertRowid;
    res.status(201).json(shiftSummary(db, get(id)));
  }));

  /** Kasaya para girişi / kasadan para çıkışı (masraf, bankaya yatırma vb.) */
  r.post('/shifts/:id/cash', h((req, res) => {
    const shift = get(req.params.id);
    if (!shift || shift.closed_at) throw bad('Açık kasa bulunamadı');
    const amount = int(req.body.amount);
    if (!['in', 'out'].includes(req.body.type)) throw bad('Geçersiz hareket türü');
    if (amount <= 0) throw bad('Tutar sıfırdan büyük olmalı');
    db.prepare('INSERT INTO cash_movements (shift_id, type, amount, note, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(shift.id, req.body.type, amount, str(req.body.note), req.user.id);
    res.json(shiftSummary(db, shift));
  }));

  /** Gün sonu (Z raporu). body: { counted_cash, note } */
  r.post('/shifts/:id/close', allow(...MANAGERS, 'cashier'), h((req, res) => {
    const shift = get(req.params.id);
    if (!shift || shift.closed_at) throw bad('Açık kasa bulunamadı');
    const counted = int(req.body.counted_cash, NaN);
    if (!Number.isFinite(counted) || counted < 0) throw bad('Sayılan nakit tutarı gerekli');
    const summary = db.transaction(() => {
      const expected = shiftSummary(db, shift).expected_cash;
      db.prepare(`UPDATE shifts SET counted_cash = ?, expected_cash = ?, note = ?, closed_at = datetime('now','localtime'),
        closed_by = ? WHERE id = ?`).run(counted, expected, str(req.body.note), req.user.id, shift.id);
      const summary = shiftSummary(db, get(shift.id));
      emitEvent(db, 'shift.closed', {
        shift_id: shift.id, register_name: shift.register_name, opened_at: shift.opened_at, closed_at: summary.shift.closed_at,
        sales: summary.sales, payments: summary.payments, refunds: summary.refunds,
        expected_cash: summary.expected_cash, counted_cash: counted, difference: summary.difference,
      });
      return summary;
    })();
    res.json(summary);
  }));

  return r;
}
