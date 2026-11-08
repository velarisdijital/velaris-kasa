// Mutfak ekranı (KDS): mutfağa gönderilen kalemler hazırlanma sırasına göre ekranda görünür.
// Durumlar: new (yeni) → preparing (hazırlanıyor) → ready (hazır, garsona bildirilir) → served (teslim edildi, ekrandan kalkar).
// Kalemin hazırlandığı yer kategorisinden gelir: mutfak | bar | yok (hazır ürün; ekrana düşmez).
import { Router } from 'express';
import { allow } from '../auth.js';
import { requireFeature } from '../license.js';
import { bad, h, int, str } from '../util.js';
import { ticketLabel } from './tables.js';

export const KITCHEN_STATUSES = ['new', 'preparing', 'ready', 'served'];
export const STATIONS = { mutfak: 'Mutfak', bar: 'Bar', yok: 'Ekrana düşmez (hazır ürün)' };

export default function kitchenRoutes(db) {
  const r = Router();
  const feature = (req, res, next) => { try { requireFeature(db, 'tables'); next(); } catch (e) { next(e); } };
  const roles = allow('manager', 'cashier', 'staff', 'kitchen');

  /** Ekrandaki siparişler. ?station=mutfak|bar|all  (hazır olanlar 30 dk boyunca görünür) */
  r.get('/kitchen', roles, feature, h((req, res) => {
    const station = str(req.query.station) || 'all';
    const items = db.prepare(`
      SELECT i.id, i.ticket_id, i.name, i.qty, i.unit, i.note, i.kitchen_status, i.sent_at, i.ready_at,
             COALESCE(c.station, 'mutfak') AS station
      FROM ticket_items i
      JOIN tickets t ON t.id = i.ticket_id
      LEFT JOIN products p ON p.id = i.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE i.void_at IS NULL AND i.kitchen_status IN ('new','preparing','ready')
        AND (t.status = 'open' OR i.kitchen_status != 'ready')
        AND (i.kitchen_status != 'ready' OR i.ready_at >= datetime('now','localtime','-30 minutes'))
        AND COALESCE(c.station, 'mutfak') != 'yok'
        AND (? = 'all' OR COALESCE(c.station, 'mutfak') = ?)
      ORDER BY i.sent_at, i.id`).all(station, station);
    const ids = [...new Set(items.map((i) => i.ticket_id))];
    const tickets = ids.map((id) => {
      const t = db.prepare(`SELECT t.id, t.kind, t.order_no, t.guest_count, t.delivery_note, t.due_at, t.source, d.name AS table_name, d.zone, u.name AS waiter
        FROM tickets t LEFT JOIN dining_tables d ON d.id = t.table_id LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`).get(id);
      const its = items.filter((i) => i.ticket_id === id);
      const st = its.some((i) => i.kitchen_status === 'new') ? 'new' : its.some((i) => i.kitchen_status === 'preparing') ? 'preparing' : 'ready';
      return { ...t, label: ticketLabel(t), status: st, sent_at: its[0].sent_at, items: its };
    });
    const now = db.prepare("SELECT datetime('now','localtime') AS n").get().n;
    res.json({ now, tickets });
  }));

  /** Kalem(ler)in durumunu değiştir. body: { ids: [..], status } ya da { ticket_id, status } (adisyonun ekrandaki tüm kalemleri) */
  r.post('/kitchen/status', roles, feature, h((req, res) => {
    const status = str(req.body?.status);
    if (!KITCHEN_STATUSES.includes(status)) throw bad('Geçersiz durum');
    let ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => int(x)).filter(Boolean) : [];
    if (req.body?.ticket_id) {
      ids = db.prepare(`SELECT id FROM ticket_items WHERE ticket_id = ? AND void_at IS NULL AND kitchen_status IN ('new','preparing','ready')`)
        .all(int(req.body.ticket_id)).map((x) => x.id);
    }
    if (!ids.length) throw bad('Kalem seçilmedi');
    const upd = db.prepare(`UPDATE ticket_items SET kitchen_status = ?,
      ready_at = CASE WHEN ? = 'ready' THEN datetime('now','localtime') WHEN ? IN ('new','preparing') THEN NULL ELSE ready_at END
      WHERE id = ? AND kitchen_status IS NOT NULL AND void_at IS NULL`);
    let changed = 0;
    db.transaction(() => { for (const id of ids) changed += upd.run(status, status, status, id).changes; })();
    res.json({ ok: true, changed });
  }));

  return r;
}
