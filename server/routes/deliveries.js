// Paket servis ve gel-al siparişleri. Masasız adisyondur: kalem ekleme, mutfak fişi, iptal ve ödeme masalarla aynı uçlardan
// (/tickets/:id/...) yapılır; ödeme kasada normal satış olarak alınır. Platform siparişleri (Yemeksepeti, Getir, Trendyol) de buraya düşer.
import { Router } from 'express';
import { getSettings } from '../db.js';
import { requireFeature } from '../license.js';
import { bad, h, int, notFound, phoneTR, str } from '../util.js';
import { addTicketItems, loadTicket } from './tables.js';

export const DELIVERY_STATUSES = ['new', 'preparing', 'ready', 'on_way', 'delivered'];

/** Sıradaki günlük sipariş numarası (her gün 1'den başlar). */
function nextOrderNo(db) {
  return db.prepare(`SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM tickets
    WHERE kind != 'table' AND substr(opened_at, 1, 10) = date('now','localtime')`).get().n;
}

/**
 * Paket / gel-al siparişi oluşturur (platform entegrasyonları da kullanır).
 * o: { kind, customer_id?, customer_name, phone, address, delivery_note, items, delivery_fee?, source?, external_id?,
 *      external_status?, payment_hint?, prepaid?, due_at?, sent? }
 */
export function createDeliveryOrder(db, o, userId) {
  const kind = o.kind === 'takeaway' ? 'takeaway' : 'delivery';
  if (!Array.isArray(o.items) || !o.items.length) throw bad('Siparişte ürün yok');
  let customer = o.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(int(o.customer_id)) : null;
  if (o.customer_id && !customer) throw bad('Müşteri bulunamadı');
  const name = str(o.customer_name) || customer?.name || null;
  const address = str(o.address) || customer?.address || null;
  if (kind === 'delivery' && !address) throw bad('Teslimat adresi gerekli');
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO tickets (kind, status, customer_id, user_id, order_no, source, external_id, external_status, customer_name, phone,
        address, delivery_note, delivery_status, payment_hint, prepaid, due_at, status_at)
      VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, datetime('now','localtime'))`)
      .run(kind, customer?.id ?? null, userId ?? null, nextOrderNo(db), str(o.source) || 'pos', str(o.external_id), str(o.external_status), name,
        str(o.phone) || customer?.phone || null, kind === 'delivery' ? address : null, str(o.delivery_note), str(o.payment_hint),
        o.prepaid ? 1 : 0, str(o.due_at)).lastInsertRowid;
    const items = [...o.items];
    const fee = int(o.delivery_fee);
    if (kind === 'delivery' && fee > 0) items.push({ name: 'Paket servis ücreti', qty: 1, unit_price: fee, vat_rate: 20 });
    addTicketItems(db, id, items, userId ?? null, { sent: !!o.sent });
    return id;
  })();
}

export default function deliveryRoutes(db) {
  const r = Router();
  const feature = (req, res, next) => { try { requireFeature(db, 'tables'); next(); } catch (e) { next(e); } };

  /** Aktif siparişler: teslim edilmemiş ya da ödemesi alınmamış. ?all=1&date=YYYY-MM-DD ile o günün tümü. */
  r.get('/deliveries', feature, h((req, res) => {
    const where = ["t.kind != 'table'"];
    const p = {};
    if (req.query.all === '1') {
      where.push('substr(t.opened_at, 1, 10) = @date');
      p.date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toLocaleDateString('sv-SE');
    } else {
      where.push("t.status != 'cancelled'", "(t.status = 'open' OR t.delivery_status != 'delivered')");
    }
    const ids = db.prepare(`SELECT t.id FROM tickets t WHERE ${where.join(' AND ')} ORDER BY COALESCE(t.due_at, t.opened_at), t.id`).all(p);
    res.json(ids.map((x) => loadTicket(db, x.id)));
  }));

  r.post('/deliveries', feature, h((req, res) => {
    const id = createDeliveryOrder(db, { ...req.body, source: req.body?.source === 'phone' ? 'phone' : 'pos', external_id: null, prepaid: false }, req.user.id);
    res.status(201).json(loadTicket(db, id));
  }));

  /** Durum, kurye ve teslimat bilgileri. body: { delivery_status?, courier_name?, customer_name?, phone?, address?, delivery_note?, payment_hint? } */
  r.put('/deliveries/:id', feature, h((req, res) => {
    const t = db.prepare("SELECT * FROM tickets WHERE id = ? AND kind != 'table'").get(req.params.id);
    if (!t) throw notFound('Sipariş bulunamadı');
    if (t.status === 'cancelled') throw bad('Sipariş iptal edilmiş');
    const b = req.body || {};
    const status = b.delivery_status ?? t.delivery_status;
    if (!DELIVERY_STATUSES.includes(status)) throw bad('Geçersiz durum');
    if (status === 'on_way' && t.kind === 'delivery' && !(str(b.courier_name) || t.courier_name)) throw bad('Yola çıkarmak için kurye seçin');
    const v = (k) => (b[k] !== undefined ? str(b[k]) : t[k]);
    db.prepare(`UPDATE tickets SET delivery_status = ?, courier_name = ?, customer_name = ?, phone = ?, address = ?, delivery_note = ?, payment_hint = ?,
        status_at = CASE WHEN ? != COALESCE(delivery_status, '') THEN datetime('now','localtime') ELSE status_at END WHERE id = ?`)
      .run(status, v('courier_name'), v('customer_name'), v('phone'), v('address'), v('delivery_note'), v('payment_hint'), status, t.id);
    res.json(loadTicket(db, t.id));
  }));

  /** Telefonla siparişte müşteriyi numarasından bul (son adresiyle). */
  r.get('/deliveries/customer', feature, h((req, res) => {
    const digits = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length < 7) return res.json(null);
    const c = db.prepare(`SELECT * FROM customers WHERE replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') LIKE ? ORDER BY id DESC`).get(`%${digits}`);
    const last = db.prepare(`SELECT customer_name, address FROM tickets WHERE kind = 'delivery' AND replace(phone,' ','') LIKE ? ORDER BY id DESC`).get(`%${digits}`);
    res.json(c || last ? { customer: c || null, name: c?.name || last?.customer_name || null, address: last?.address || c?.address || null,
      phone_ok: !!phoneTR(req.query.phone) } : null);
  }));

  r.get('/deliveries/settings', feature, h((req, res) => {
    const s = getSettings(db);
    res.json({ fee: int(s.delivery_fee), couriers: String(s.delivery_couriers || '').split(',').map((x) => x.trim()).filter(Boolean) });
  }));

  return r;
}
