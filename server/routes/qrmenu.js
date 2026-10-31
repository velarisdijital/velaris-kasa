// Herkese açık QR menü (oturum gerektirmez). Sayfa: /#/menu?t={masa QR anahtarı}
// Müşteri menüyü görür; garson çağırır, hesap ister ya da (açıksa) sipariş isteği gönderir — istekleri garson onaylar.
import { Router } from 'express';
import { getSettings } from '../db.js';
import { hasFeature } from '../license.js';
import { bad, h, int, num, str } from '../util.js';

// Kötüye kullanım koruması: IP başına 10 dakikada 20 istek; aynı masadan aynı türde açık istek tekrarlanmaz
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 600_000);
  if (list.length >= 20) throw Object.assign(new Error('Çok fazla istek. Lütfen biraz bekleyin.'), { status: 429 });
  list.push(now);
  hits.set(ip, list);
}

export default function qrMenuRoutes(db) {
  const r = Router();

  const config = () => {
    const s = getSettings(db);
    if (s.qrmenu_enabled !== '1' || s.modules_tables !== '1' || !hasFeature(db, 'tables')) {
      throw Object.assign(new Error('Bu işletmenin QR menüsü kapalı'), { status: 403 });
    }
    return s;
  };
  const tableBy = (token) => (token && /^[0-9a-f]{8,32}$/.test(String(token))
    ? db.prepare('SELECT id, name, zone FROM dining_tables WHERE qr_token = ? AND active = 1').get(String(token)) : null);

  r.get('/public/menu', h((req, res) => {
    const s = config();
    const table = tableBy(req.query.t);
    const products = db.prepare(`SELECT id, name, sell_price AS price, unit, category_id, menu_description AS description FROM products
      WHERE active = 1 AND menu_hidden = 0 AND sell_price > 0 AND type = 'product' ORDER BY name`).all();
    const used = new Set(products.map((p) => p.category_id));
    const categories = db.prepare('SELECT id, name, color FROM categories ORDER BY sort_order, name').all().filter((c) => used.has(c.id));
    res.json({
      business: { name: s.business_name, phone: s.business_phone, address: s.business_address },
      note: s.qrmenu_note || '',
      table: table ? { name: table.name, zone: table.zone } : null,
      orders_enabled: !!table && s.qrmenu_orders === '1',
      categories, products,
    });
  }));

  /** body: { t, type: waiter|bill|order, items?: [{ product_id, qty, note? }], note? } */
  r.post('/public/menu/request', h((req, res) => {
    const s = config();
    const table = tableBy(req.body?.t);
    if (!table) throw bad('Masa bulunamadı. Lütfen masadaki QR kodu yeniden okutun.');
    const type = req.body?.type;
    if (!['waiter', 'bill', 'order'].includes(type)) throw bad('Geçersiz istek');
    rateLimit(req.ip);
    let items = null;
    if (type === 'order') {
      if (s.qrmenu_orders !== '1') throw bad('Bu işletme QR menüden sipariş almıyor; garson çağırabilirsiniz.');
      const raw = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
      const getP = db.prepare("SELECT id, name, sell_price FROM products WHERE id = ? AND active = 1 AND menu_hidden = 0 AND type = 'product' AND sell_price > 0");
      items = raw.map((i) => {
        const p = getP.get(int(i.product_id));
        const qty = Math.round(num(i.qty, 0));
        if (!p || qty < 1 || qty > 20) throw bad('Sepette geçersiz ürün var');
        return { product_id: p.id, name: p.name, qty, price: p.sell_price, note: str(i.note)?.slice(0, 80) || null };
      });
      if (!items.length) throw bad('Sepet boş');
    } else if (db.prepare("SELECT 1 FROM table_requests WHERE table_id = ? AND type = ? AND status = 'new'").get(table.id, type)) {
      return res.json({ ok: true, message: 'İsteğiniz iletildi, garsonumuz geliyor.' });
    }
    db.prepare('INSERT INTO table_requests (table_id, type, items_json, note) VALUES (?, ?, ?, ?)')
      .run(table.id, type, items ? JSON.stringify(items) : null, str(req.body?.note)?.slice(0, 200) || null);
    const msg = { waiter: 'Garsonumuz geliyor.', bill: 'Hesabınız hazırlanıyor.', order: 'Siparişiniz garsona iletildi; onaylanınca hazırlanacak.' }[type];
    res.status(201).json({ ok: true, message: msg });
  }));

  return r;
}
