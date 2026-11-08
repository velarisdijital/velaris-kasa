// Kafe / restoran: masalar ve adisyonlar.
// Adisyon açık kaldıkça stok düşmez; ödeme kasada normal satış olarak alınır (POST /sales { ticket_id, items[].ticket_item_id }),
// böylece yazarkasa, e-Arşiv, puan ve veresiye aynen çalışır. Hesap bölme = adisyonun bir kısmını ödemek.
import { Router } from 'express';
import { allow, can, MANAGERS, requirePerm } from '../auth.js';
import { getSetting } from '../db.js';
import { requireFeature } from '../license.js';
import { round3 } from '../stock.js';
import { bad, h, int, notFound, num, str } from '../util.js';

const remaining = (i) => round3(i.qty - i.paid_qty);

export const KIND_LABELS = { delivery: 'Paket', takeaway: 'Gel-al' };
export const ticketLabel = (t) => t.table_name || `${KIND_LABELS[t.kind] || 'Adisyon'} #${t.order_no ?? t.id}`;

export function loadTicket(db, id) {
  const t = db.prepare(`SELECT t.*, d.name AS table_name, d.zone, u.name AS user_name, COALESCE(c.name, t.customer_name) AS customer_name FROM tickets t
    LEFT JOIN dining_tables d ON d.id = t.table_id LEFT JOIN users u ON u.id = t.user_id LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.id = ?`).get(id);
  if (!t) return null;
  t.table_name = ticketLabel(t);
  t.items = db.prepare(`SELECT i.*, u.name AS user_name FROM ticket_items i LEFT JOIN users u ON u.id = i.user_id
    WHERE i.ticket_id = ? ORDER BY i.id`).all(id).map((i) => ({ ...i, remaining_qty: i.void_at ? 0 : remaining(i) }));
  const live = t.items.filter((i) => !i.void_at);
  t.total = live.reduce((a, i) => a + Math.round(i.qty * i.unit_price), 0);
  t.remaining_total = live.reduce((a, i) => a + Math.round(i.remaining_qty * i.unit_price), 0);
  t.unsent_count = live.filter((i) => !i.sent_at).length;
  t.ready_count = live.filter((i) => i.kitchen_status === 'ready').length;
  t.sales = db.prepare('SELECT id, receipt_no, total, created_at FROM sales WHERE ticket_id = ? ORDER BY id').all(id);
  return t;
}

/**
 * Satış kaydedilirken adisyonun ödenen kalemlerini işaretler (sales.js transaction içinden çağrılır).
 * lines: [{ ticket_item_id, qty }]. Kalan tutar sıfırlanınca adisyon kapanır.
 */
export function applyTicketPayment(db, ticketId, lines, saleId, saleTotal) {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!t) throw bad('Adisyon bulunamadı');
  if (t.status !== 'open') throw bad('Bu adisyon kapalı');
  const getItem = db.prepare('SELECT * FROM ticket_items WHERE id = ? AND ticket_id = ?');
  const upd = db.prepare('UPDATE ticket_items SET paid_qty = paid_qty + ? WHERE id = ?');
  for (const l of lines) {
    const it = getItem.get(l.ticket_item_id, t.id);
    if (!it || it.void_at) throw bad('Adisyon kalemi bulunamadı');
    if (l.qty > remaining(it) + 1e-9) throw bad(`${it.name}: adisyonda kalan miktar ${remaining(it)}`);
    upd.run(l.qty, it.id);
  }
  db.prepare('UPDATE sales SET ticket_id = ? WHERE id = ?').run(t.id, saleId);
  db.prepare('UPDATE tickets SET paid_total = paid_total + ? WHERE id = ?').run(saleTotal, t.id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM ticket_items WHERE ticket_id = ? AND void_at IS NULL AND qty - paid_qty > 0.0005').get(t.id).n;
  if (!left) {
    db.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now','localtime') WHERE id = ?").run(t.id);
    // Masa kapandı: bekleyen "hesap istiyor / garson çağırıyor" istekleri de kapanır
    db.prepare("UPDATE table_requests SET status = 'done', handled_at = datetime('now','localtime') WHERE table_id = ? AND status = 'new' AND type IN ('bill','waiter')").run(t.table_id);
  }
}

/**
 * Adisyona kalem ekler. items: [{ product_id?, name?, qty, unit_price?, vat_rate?, note? }].
 * Mutfağa henüz gitmemiş, aynı ürün/not/fiyattaki satır varsa miktarı artırır.
 */
/** Mutfak ekranı: hazırlanmayan ürünler (kategorisi "ekrana düşmez") gönderilince doğrudan teslim edilmiş sayılır */
export function skipNonKitchen(db, ticketId) {
  db.prepare(`UPDATE ticket_items SET kitchen_status = 'served' WHERE ticket_id = ? AND kitchen_status = 'new'
    AND product_id IN (SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE c.station = 'yok')`).run(ticketId);
}

export function addTicketItems(db, ticketId, items, userId, { sent = false } = {}) {
  const getP = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const same = db.prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND product_id = ? AND sent_at IS NULL AND void_at IS NULL
    AND paid_qty = 0 AND unit_price = ? AND COALESCE(note, '') = COALESCE(?, '')`);
  const inc = db.prepare('UPDATE ticket_items SET qty = qty + ? WHERE id = ?');
  const ins = db.prepare(`INSERT INTO ticket_items (ticket_id, product_id, name, qty, unit, unit_price, vat_rate, note, user_id, sent_at, kitchen_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${sent ? "datetime('now','localtime'), 'new'" : 'NULL, NULL'})`);
  const defaultVat = num(getSetting(db, 'default_vat'), 20);
  for (const it of items) {
    const p = it.product_id ? getP.get(int(it.product_id)) : null;
    if (it.product_id && !p) throw bad(`Ürün bulunamadı (#${it.product_id})`);
    const name = p?.name || str(it.name);
    if (!name) throw bad('Ürün gerekli');
    const qty = round3(num(it.qty, 1));
    if (!(qty > 0)) throw bad(`${name}: miktar geçersiz`);
    const price = it.unit_price != null && it.unit_price !== '' ? int(it.unit_price) : p?.sell_price ?? 0;
    if (price < 0) throw bad(`${name}: fiyat geçersiz`);
    const note = str(it.note);
    const row = !sent && p && same.get(ticketId, p.id, price, note);
    if (row) inc.run(qty, row.id);
    else ins.run(ticketId, p?.id ?? null, name, qty, p?.unit || 'adet', price, p ? p.vat_rate : num(it.vat_rate, defaultVat), note, userId);
  }
  if (sent) skipNonKitchen(db, ticketId);
}

export default function tableRoutes(db) {
  const r = Router();
  const feature = (req, res, next) => { try { requireFeature(db, 'tables'); next(); } catch (e) { next(e); } };
  const openTicket = (id) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!t) throw notFound('Adisyon bulunamadı');
    if (t.status !== 'open') throw bad('Bu adisyon kapalı');
    return t;
  };

  // ---- Masalar ----
  r.get('/tables', feature, h((req, res) => {
    // QR menü için her masaya tahmin edilemez bir anahtar
    db.prepare('UPDATE dining_tables SET qr_token = lower(hex(randomblob(8))) WHERE qr_token IS NULL').run();
    const tables = db.prepare(`SELECT d.*, t.id AS ticket_id, t.opened_at, t.guest_count, t.paid_total, u.name AS user_name,
        (SELECT GROUP_CONCAT(q.type) FROM table_requests q WHERE q.table_id = d.id AND q.status = 'new') AS requests,
        (SELECT COALESCE(SUM(ROUND((i.qty - i.paid_qty) * i.unit_price)),0) FROM ticket_items i WHERE i.ticket_id = t.id AND i.void_at IS NULL) AS remaining_total,
        (SELECT COUNT(*) FROM ticket_items i WHERE i.ticket_id = t.id AND i.void_at IS NULL AND i.sent_at IS NULL) AS unsent_count,
        (SELECT COUNT(*) FROM ticket_items i WHERE i.ticket_id = t.id AND i.void_at IS NULL) AS item_count,
        (SELECT COUNT(*) FROM ticket_items i WHERE i.ticket_id = t.id AND i.void_at IS NULL AND i.kitchen_status = 'ready') AS ready_count
      FROM dining_tables d LEFT JOIN tickets t ON t.table_id = d.id AND t.status = 'open' LEFT JOIN users u ON u.id = t.user_id
      WHERE d.active = 1
      ORDER BY (SELECT MIN(x.sort_order) FROM dining_tables x WHERE x.active = 1 AND COALESCE(x.zone, '') = COALESCE(d.zone, '')), d.sort_order, d.id`).all();
    res.json(tables);
  }));

  /** Yeni masa(lar). body: { name, zone } ya da toplu { count, prefix, zone } */
  r.post('/tables', allow(...MANAGERS), feature, h((req, res) => {
    const b = req.body || {};
    const zone = str(b.zone);
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM dining_tables').get().m;
    const ins = db.prepare('INSERT INTO dining_tables (name, zone, sort_order) VALUES (?, ?, ?)');
    const names = [];
    if (b.count) {
      const count = int(b.count);
      if (count < 1 || count > 100) throw bad('1-100 arası masa eklenebilir');
      const prefix = str(b.prefix) || 'Masa';
      const start = int(b.start, 1) || 1;
      for (let i = 0; i < count; i++) names.push(`${prefix} ${start + i}`);
    } else {
      if (!str(b.name)) throw bad('Masa adı gerekli');
      names.push(str(b.name));
    }
    const ids = db.transaction(() => names.map((n, i) => ins.run(n, zone, max + i + 1).lastInsertRowid))();
    res.status(201).json(db.prepare(`SELECT * FROM dining_tables WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids));
  }));

  r.put('/tables/:id', allow(...MANAGERS), h((req, res) => {
    const t = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(req.params.id);
    if (!t) throw notFound();
    const b = req.body || {};
    const active = b.active === undefined ? t.active : (b.active ? 1 : 0);
    if (!active && db.prepare("SELECT 1 FROM tickets WHERE table_id = ? AND status = 'open'").get(t.id)) throw bad('Açık adisyonu olan masa kaldırılamaz');
    db.prepare('UPDATE dining_tables SET name = ?, zone = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(str(b.name) ?? t.name, b.zone !== undefined ? str(b.zone) : t.zone, b.sort_order !== undefined ? int(b.sort_order) : t.sort_order, active, t.id);
    res.json(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(t.id));
  }));

  // ---- Adisyon ----
  /** Masayı açar (açıksa mevcut adisyonu döndürür). body: { guest_count?, items? } */
  r.post('/tables/:id/ticket', feature, h((req, res) => {
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND active = 1').get(req.params.id);
    if (!table) throw notFound('Masa bulunamadı');
    const id = db.transaction(() => {
      const cur = db.prepare("SELECT id FROM tickets WHERE table_id = ? AND status = 'open'").get(table.id);
      const id = cur?.id ?? db.prepare('INSERT INTO tickets (table_id, guest_count, user_id) VALUES (?, ?, ?)')
        .run(table.id, int(req.body?.guest_count) || null, req.user.id).lastInsertRowid;
      if (Array.isArray(req.body?.items) && req.body.items.length) addItems(id, req.body.items, req.user.id);
      return id;
    })();
    res.status(201).json(loadTicket(db, id));
  }));

  r.get('/tickets/:id', h((req, res) => {
    const t = loadTicket(db, req.params.id);
    if (!t) throw notFound();
    res.json(t);
  }));

  r.put('/tickets/:id', h((req, res) => {
    const t = openTicket(req.params.id);
    const b = req.body || {};
    if (b.customer_id && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(int(b.customer_id))) throw bad('Müşteri bulunamadı');
    db.prepare('UPDATE tickets SET guest_count = ?, customer_id = ?, note = ? WHERE id = ?').run(
      b.guest_count !== undefined ? int(b.guest_count) || null : t.guest_count,
      b.customer_id !== undefined ? int(b.customer_id) || null : t.customer_id,
      b.note !== undefined ? str(b.note) : t.note, t.id);
    res.json(loadTicket(db, t.id));
  }));

  const addItems = (ticketId, items, userId) => addTicketItems(db, ticketId, items, userId);

  /** Sipariş ekle. body: { items: [{ product_id, qty, note?, unit_price? }] } */
  r.post('/tickets/:id/items', h((req, res) => {
    const t = openTicket(req.params.id);
    if (!Array.isArray(req.body?.items) || !req.body.items.length) throw bad('Ürün seçin');
    db.transaction(() => addItems(t.id, req.body.items, req.user.id))();
    res.json(loadTicket(db, t.id));
  }));

  /** Mutfağa gitmemiş kalemi düzenle (miktar / not). */
  r.put('/tickets/:id/items/:itemId', h((req, res) => {
    const t = openTicket(req.params.id);
    const it = db.prepare('SELECT * FROM ticket_items WHERE id = ? AND ticket_id = ? AND void_at IS NULL').get(req.params.itemId, t.id);
    if (!it) throw notFound('Kalem bulunamadı');
    const b = req.body || {};
    const qty = b.qty !== undefined ? round3(num(b.qty, NaN)) : it.qty;
    if (!(qty > 0)) throw bad('Miktar geçersiz');
    if (it.sent_at && qty < it.qty) throw bad('Mutfağa gönderilmiş kalem azaltılamaz; iptal edin');
    if (qty < it.paid_qty) throw bad('Ödenmiş miktarın altına inilemez');
    db.prepare('UPDATE ticket_items SET qty = ?, note = ? WHERE id = ?').run(qty, b.note !== undefined ? str(b.note) : it.note, it.id);
    res.json(loadTicket(db, t.id));
  }));

  /**
   * Kalemi iptal / ikram et. body: { qty?, reason }. Mutfağa gönderilmemiş kalem iz bırakmadan silinir;
   * gönderilmiş kalem için sebep zorunlu ve kayıt kalır (raporda iptal/ikram olarak görünür).
   */
  r.post('/tickets/:id/items/:itemId/void', h((req, res) => {
    const t = openTicket(req.params.id);
    const it = db.prepare('SELECT * FROM ticket_items WHERE id = ? AND ticket_id = ? AND void_at IS NULL').get(req.params.itemId, t.id);
    if (!it) throw notFound('Kalem bulunamadı');
    const left = remaining(it);
    const qty = req.body?.qty !== undefined ? round3(num(req.body.qty, NaN)) : left;
    if (!(qty > 0) || qty > left + 1e-9) throw bad(`İptal miktarı 0 ile ${left} arasında olmalı`);
    const reason = str(req.body?.reason);
    db.transaction(() => {
      if (!it.sent_at && it.paid_qty === 0) {
        if (qty >= it.qty) db.prepare('DELETE FROM ticket_items WHERE id = ?').run(it.id);
        else db.prepare('UPDATE ticket_items SET qty = ? WHERE id = ?').run(round3(it.qty - qty), it.id);
        return;
      }
      if (!reason) throw bad('İptal / ikram sebebi yazın');
      if (!can(db, req.user, 'void')) throw Object.assign(new Error('Yetkiniz yok: mutfağa gitmiş siparişi iptal / ikram'), { status: 403, code: 'PERMISSION' });
      if (qty < it.qty) {
        // Kısmi iptal: iptal edilen kısım ayrı satır olarak saklanır
        db.prepare('UPDATE ticket_items SET qty = ? WHERE id = ?').run(round3(it.qty - qty), it.id);
        db.prepare(`INSERT INTO ticket_items (ticket_id, product_id, name, qty, unit, unit_price, vat_rate, note, user_id, sent_at, created_at,
            void_at, void_reason, void_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?)`)
          .run(t.id, it.product_id, it.name, qty, it.unit, it.unit_price, it.vat_rate, it.note, it.user_id, it.sent_at, it.created_at, reason, req.user.id);
      } else {
        db.prepare("UPDATE ticket_items SET void_at = datetime('now','localtime'), void_reason = ?, void_user_id = ? WHERE id = ?").run(reason, req.user.id, it.id);
      }
    })();
    res.json(loadTicket(db, t.id));
  }));

  /** Mutfağa / bara gönder: gönderilmemiş kalemleri işaretler ve mutfak fişi için döndürür. */
  r.post('/tickets/:id/kitchen', h((req, res) => {
    const t = openTicket(req.params.id);
    const items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id = ? AND sent_at IS NULL AND void_at IS NULL ORDER BY id').all(t.id);
    if (!items.length) throw bad('Mutfağa gönderilecek yeni sipariş yok');
    const now = db.prepare("SELECT datetime('now','localtime') AS n").get().n;
    db.prepare("UPDATE ticket_items SET sent_at = ?, kitchen_status = 'new' WHERE ticket_id = ? AND sent_at IS NULL AND void_at IS NULL").run(now, t.id);
    skipNonKitchen(db, t.id);
    const ticket = loadTicket(db, t.id);
    res.json({ ticket, kitchen: { table_name: ticket.table_name, zone: ticket.zone, waiter: req.user.name, sent_at: now, guest_count: ticket.guest_count,
      kind: ticket.kind, note: ticket.delivery_note, due_at: ticket.due_at,
      items: items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, note: i.note })) } });
  }));

  /** Masayı taşı; hedef masada açık adisyon varsa birleştirir. body: { table_id } */
  r.post('/tickets/:id/move', h((req, res) => {
    const t = openTicket(req.params.id);
    if (!t.table_id) throw bad('Paket / gel-al siparişi masaya taşınamaz');
    const target = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND active = 1').get(int(req.body?.table_id));
    if (!target) throw bad('Hedef masa bulunamadı');
    if (target.id === t.table_id) throw bad('Adisyon zaten bu masada');
    const id = db.transaction(() => {
      const other = db.prepare("SELECT * FROM tickets WHERE table_id = ? AND status = 'open'").get(target.id);
      if (!other) {
        db.prepare('UPDATE tickets SET table_id = ? WHERE id = ?').run(target.id, t.id);
        return t.id;
      }
      db.prepare('UPDATE ticket_items SET ticket_id = ? WHERE ticket_id = ?').run(other.id, t.id);
      db.prepare('UPDATE sales SET ticket_id = ? WHERE ticket_id = ?').run(other.id, t.id);
      db.prepare(`UPDATE tickets SET guest_count = NULLIF(COALESCE(guest_count,0) + ?, 0), paid_total = paid_total + ?,
        customer_id = COALESCE(customer_id, ?) WHERE id = ?`).run(t.guest_count || 0, t.paid_total, t.customer_id, other.id);
      db.prepare("UPDATE tickets SET status = 'cancelled', closed_at = datetime('now','localtime'), paid_total = 0, cancel_reason = ? WHERE id = ?")
        .run(`${target.name} ile birleştirildi`, t.id);
      return other.id;
    })();
    res.json(loadTicket(db, id));
  }));

  /** Seçili kalemleri başka masaya aktar. body: { table_id, items: [{ id, qty }] } */
  r.post('/tickets/:id/transfer', h((req, res) => {
    const t = openTicket(req.params.id);
    if (!t.table_id) throw bad('Paket / gel-al siparişinden masaya aktarma yapılamaz');
    const target = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND active = 1').get(int(req.body?.table_id));
    if (!target || target.id === t.table_id) throw bad('Hedef masa geçersiz');
    const lines = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!lines.length) throw bad('Aktarılacak kalem seçin');
    const targetId = db.transaction(() => {
      const cur = db.prepare("SELECT id FROM tickets WHERE table_id = ? AND status = 'open'").get(target.id);
      const targetId = cur?.id ?? db.prepare('INSERT INTO tickets (table_id, user_id) VALUES (?, ?)').run(target.id, req.user.id).lastInsertRowid;
      for (const l of lines) {
        const it = db.prepare('SELECT * FROM ticket_items WHERE id = ? AND ticket_id = ? AND void_at IS NULL').get(int(l.id), t.id);
        if (!it) throw bad('Kalem bulunamadı');
        const left = remaining(it);
        const qty = l.qty !== undefined ? round3(num(l.qty, NaN)) : left;
        if (!(qty > 0) || qty > left + 1e-9) throw bad(`${it.name}: aktarılabilecek miktar ${left}`);
        if (qty >= it.qty && it.paid_qty === 0) {
          db.prepare('UPDATE ticket_items SET ticket_id = ? WHERE id = ?').run(targetId, it.id);
        } else {
          db.prepare('UPDATE ticket_items SET qty = ? WHERE id = ?').run(round3(it.qty - qty), it.id);
          db.prepare(`INSERT INTO ticket_items (ticket_id, product_id, name, qty, unit, unit_price, vat_rate, note, user_id, sent_at, created_at, kitchen_status, ready_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(targetId, it.product_id, it.name, qty, it.unit, it.unit_price, it.vat_rate, it.note, it.user_id, it.sent_at, it.created_at, it.kitchen_status, it.ready_at);
        }
      }
      const left = db.prepare('SELECT COUNT(*) AS n FROM ticket_items WHERE ticket_id = ? AND void_at IS NULL AND qty - paid_qty > 0.0005').get(t.id).n;
      if (!left) {
        db.prepare(`UPDATE tickets SET status = ?, closed_at = datetime('now','localtime'), cancel_reason = ? WHERE id = ?`)
          .run(t.paid_total ? 'closed' : 'cancelled', t.paid_total ? null : `${target.name} masasına aktarıldı`, t.id);
      }
      return targetId;
    })();
    res.json({ from: loadTicket(db, t.id), to: loadTicket(db, targetId) });
  }));

  /** Adisyonu iptal et (ödeme alınmamışsa). */
  r.post('/tickets/:id/cancel', requirePerm(db, 'cancel_ticket'), h((req, res) => {
    const t = openTicket(req.params.id);
    if (t.paid_total > 0) throw bad('Kısmen ödenmiş adisyon iptal edilemez; kalan kalemleri iptal edin');
    const reason = str(req.body?.reason);
    const sent = db.prepare('SELECT 1 FROM ticket_items WHERE ticket_id = ? AND sent_at IS NOT NULL AND void_at IS NULL').get(t.id);
    if (sent && !reason) throw bad('Mutfağa gitmiş sipariş var; iptal sebebi yazın');
    db.transaction(() => {
      db.prepare("UPDATE ticket_items SET void_at = datetime('now','localtime'), void_reason = ?, void_user_id = ? WHERE ticket_id = ? AND void_at IS NULL")
        .run(reason || 'Adisyon iptali', req.user.id, t.id);
      db.prepare("UPDATE tickets SET status = 'cancelled', closed_at = datetime('now','localtime'), cancel_reason = ? WHERE id = ?").run(reason, t.id);
    })();
    res.json(loadTicket(db, t.id));
  }));

  // ---- QR menüden gelen istekler (garson çağır / hesap / sipariş) ----
  const loadRequest = (id) => {
    const q = db.prepare(`SELECT q.*, d.name AS table_name FROM table_requests q JOIN dining_tables d ON d.id = q.table_id WHERE q.id = ?`).get(id);
    if (q) q.items = q.items_json ? JSON.parse(q.items_json) : [];
    return q;
  };
  r.get('/table-requests', feature, h((req, res) => {
    const rows = db.prepare(`SELECT q.*, d.name AS table_name FROM table_requests q JOIN dining_tables d ON d.id = q.table_id
      WHERE q.status = 'new' ORDER BY q.id`).all();
    res.json(rows.map((q) => ({ ...q, items: q.items_json ? JSON.parse(q.items_json) : [] })));
  }));

  /** Kabul: sipariş isteğiyse kalemler masanın adisyonuna eklenir (masa kapalıysa açılır); diğerleri "tamam" olur. */
  r.post('/table-requests/:id/accept', feature, h((req, res) => {
    const q = loadRequest(req.params.id);
    if (!q) throw notFound();
    if (q.status !== 'new') throw bad('Bu istek zaten işlendi');
    const ticketId = db.transaction(() => {
      let ticketId = null;
      if (q.type === 'order') {
        const cur = db.prepare("SELECT id FROM tickets WHERE table_id = ? AND status = 'open'").get(q.table_id);
        ticketId = cur?.id ?? db.prepare('INSERT INTO tickets (table_id, user_id) VALUES (?, ?)').run(q.table_id, req.user.id).lastInsertRowid;
        addItems(ticketId, q.items.map((i) => ({ product_id: i.product_id, qty: i.qty, note: [i.note, 'QR'].filter(Boolean).join(' · ') })), req.user.id);
      }
      db.prepare("UPDATE table_requests SET status = 'done', handled_by = ?, handled_at = datetime('now','localtime'), ticket_id = ? WHERE id = ?")
        .run(req.user.id, ticketId, q.id);
      return ticketId;
    })();
    res.json({ request: loadRequest(q.id), ticket: ticketId ? loadTicket(db, ticketId) : null });
  }));

  r.post('/table-requests/:id/reject', feature, h((req, res) => {
    const q = loadRequest(req.params.id);
    if (!q) throw notFound();
    if (q.status !== 'new') throw bad('Bu istek zaten işlendi');
    db.prepare("UPDATE table_requests SET status = 'rejected', handled_by = ?, handled_at = datetime('now','localtime'), note = trim(COALESCE(note,'') || ' ' || ?) WHERE id = ?")
      .run(req.user.id, str(req.body?.reason) || '', q.id);
    res.json(loadRequest(q.id));
  }));

  /** Garson modu: hesabı kasaya bildir (Masalar ekranında "Hesap istiyor" olarak görünür). */
  r.post('/tickets/:id/bill-request', h((req, res) => {
    const t = openTicket(req.params.id);
    if (!db.prepare("SELECT 1 FROM table_requests WHERE table_id = ? AND type = 'bill' AND status = 'new'").get(t.table_id)) {
      db.prepare("INSERT INTO table_requests (table_id, type, note) VALUES (?, 'bill', ?)").run(t.table_id, `${req.user.name} bildirdi`);
    }
    res.json({ ok: true });
  }));

  /** Masanın QR anahtarını yenile (eski QR geçersiz olur). */
  r.post('/tables/:id/qr-reset', allow(...MANAGERS), h((req, res) => {
    db.prepare('UPDATE dining_tables SET qr_token = lower(hex(randomblob(8))) WHERE id = ?').run(req.params.id);
    res.json(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(req.params.id));
  }));

  /** Masa / garson raporu: garson bazında sipariş, iptal-ikram; adisyon süresi ve ortalaması. */
  r.get('/reports/tables', allow(...MANAGERS), feature, h((req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date().toLocaleDateString('sv-SE');
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : from;
    const p = { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
    const waiters = db.prepare(`SELECT u.id, u.name,
        COUNT(DISTINCT i.ticket_id) AS ticket_count,
        COALESCE(SUM(CASE WHEN i.void_at IS NULL THEN ROUND(i.qty * i.unit_price) END), 0) AS order_total,
        COALESCE(SUM(CASE WHEN i.void_at IS NULL THEN i.qty END), 0) AS item_qty,
        COALESCE(SUM(CASE WHEN i.void_at IS NOT NULL THEN ROUND(i.qty * i.unit_price) END), 0) AS void_total
      FROM ticket_items i JOIN users u ON u.id = i.user_id
      WHERE i.created_at BETWEEN @from AND @to GROUP BY u.id ORDER BY order_total DESC`).all(p);
    const tickets = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(paid_total), 0) AS total, COALESCE(SUM(guest_count), 0) AS guests,
        COALESCE(AVG((julianday(closed_at) - julianday(opened_at)) * 1440), 0) AS avg_minutes
      FROM tickets WHERE status = 'closed' AND closed_at BETWEEN @from AND @to`).get(p);
    tickets.avg_minutes = Math.round(tickets.avg_minutes);
    tickets.avg_total = tickets.count ? Math.round(tickets.total / tickets.count) : 0;
    const voids = db.prepare(`SELECT i.id, i.name, i.qty, i.unit_price, i.void_reason, i.void_at, i.sent_at, COALESCE(d.name, CASE t.kind WHEN 'delivery' THEN 'Paket' ELSE 'Gel-al' END || ' #' || COALESCE(t.order_no, t.id)) AS table_name,
        u.name AS void_user_name, w.name AS waiter_name
      FROM ticket_items i JOIN tickets t ON t.id = i.ticket_id LEFT JOIN dining_tables d ON d.id = t.table_id
      LEFT JOIN users u ON u.id = i.void_user_id LEFT JOIN users w ON w.id = i.user_id
      WHERE i.void_at BETWEEN @from AND @to ORDER BY i.void_at DESC`).all(p);
    const couriers = db.prepare(`SELECT courier_name AS name, COUNT(*) AS count, COALESCE(SUM(paid_total), 0) AS total,
        COALESCE(AVG((julianday(status_at) - julianday(opened_at)) * 1440), 0) AS avg_minutes
      FROM tickets WHERE kind = 'delivery' AND delivery_status = 'delivered' AND courier_name IS NOT NULL AND opened_at BETWEEN @from AND @to
      GROUP BY courier_name ORDER BY count DESC`).all(p).map((c) => ({ ...c, avg_minutes: Math.round(c.avg_minutes) }));
    const channels = db.prepare(`SELECT kind, source, COUNT(*) AS count, COALESCE(SUM(paid_total), 0) AS total FROM tickets
      WHERE kind != 'table' AND status != 'cancelled' AND opened_at BETWEEN @from AND @to GROUP BY kind, source ORDER BY count DESC`).all(p);
    res.json({ from, to, waiters, tickets, voids, couriers, channels });
  }));

  /** İptal / ikram raporu */
  r.get('/tickets-voids', allow(...MANAGERS), h((req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date().toLocaleDateString('sv-SE');
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : from;
    res.json(db.prepare(`SELECT i.*, COALESCE(d.name, 'Paket #' || COALESCE(t.order_no, t.id)) AS table_name, u.name AS void_user_name FROM ticket_items i JOIN tickets t ON t.id = i.ticket_id
      LEFT JOIN dining_tables d ON d.id = t.table_id LEFT JOIN users u ON u.id = i.void_user_id
      WHERE i.void_at BETWEEN ? AND ? ORDER BY i.void_at DESC`).all(`${from} 00:00:00`, `${to} 23:59:59`));
  }));

  return r;
}
