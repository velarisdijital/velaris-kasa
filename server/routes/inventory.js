// Toplu stok sayımı ve SKT (son kullanma tarihi) takibi.
//
// Sayım: bir sayım oturumu açılır, ürünler barkod okutularak (her okutma +1) ya da miktar yazılarak sayılır,
// fark listesi görülür, "Sayımı uygula" ile sayılan miktarlar stoğa tek seferde işlenir.
// SKT: alışta satır başına SKT girilir (parti), var olan stok için elle parti eklenebilir; satışta en yakın SKT'li
// parti düşer. "SKT yaklaşanlar" listesi ve "fire olarak düş".
import { Router } from 'express';
import { allow, MANAGERS, requirePerm } from '../auth.js';
import { branchStock, changeStock, round3 } from '../stock.js';
import { bad, h, int, notFound, num, str } from '../util.js';
import { resolveBranch } from './products.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString('sv-SE');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

export default function inventoryRoutes(db) {
  const r = Router();
  const stockPerm = requirePerm(db, 'stock');

  // ------------------------------------------------------------------ Sayım
  const loadCount = (id) => {
    const c = db.prepare(`SELECT sc.*, u.name AS user_name, b.name AS branch_name FROM stock_counts sc LEFT JOIN users u ON u.id = sc.user_id
      LEFT JOIN branches b ON b.id = sc.branch_id WHERE sc.id = ?`).get(id);
    if (!c) return null;
    c.items = db.prepare(`SELECT i.product_id, i.counted, i.system_qty, i.updated_at, p.name, p.barcode, p.unit, p.buy_price,
        COALESCE(bs.stock, 0) AS current_stock
      FROM stock_count_items i JOIN products p ON p.id = i.product_id
      LEFT JOIN branch_stock bs ON bs.product_id = i.product_id AND bs.branch_id = ?
      WHERE i.count_id = ? ORDER BY i.updated_at DESC, i.id DESC`).all(c.branch_id, id)
      .map((i) => {
        const sys = c.status === 'applied' ? i.system_qty ?? 0 : i.current_stock;
        return { ...i, system: sys, diff: round3(i.counted - sys), diff_value: Math.round((i.counted - sys) * i.buy_price) };
      });
    c.summary = {
      products: c.items.length,
      plus: c.items.filter((i) => i.diff > 0).length,
      minus: c.items.filter((i) => i.diff < 0).length,
      diff_value: c.items.reduce((a, i) => a + i.diff_value, 0),
    };
    return c;
  };
  const openCount = (id) => {
    const c = db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
    if (!c) throw notFound('Sayım bulunamadı');
    if (c.status !== 'open') throw bad('Bu sayım kapanmış');
    return c;
  };

  r.get('/stock-counts', stockPerm, h((req, res) => {
    res.json(db.prepare(`SELECT sc.*, u.name AS user_name, (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = sc.id) AS item_count
      FROM stock_counts sc LEFT JOIN users u ON u.id = sc.user_id ORDER BY sc.id DESC LIMIT 50`).all());
  }));
  r.post('/stock-counts', stockPerm, h((req, res) => {
    const id = db.prepare('INSERT INTO stock_counts (branch_id, note, user_id) VALUES (?, ?, ?)').run(resolveBranch(db, req), str(req.body?.note), req.user.id).lastInsertRowid;
    res.status(201).json(loadCount(id));
  }));
  r.get('/stock-counts/:id', stockPerm, h((req, res) => {
    const c = loadCount(req.params.id);
    if (!c) throw notFound('Sayım bulunamadı');
    res.json(c);
  }));
  /** Sayılan miktar. body: { product_id | barcode, counted? , add? } — add: okutma başına eklenecek miktar (varsayılan 1) */
  r.put('/stock-counts/:id/items', stockPerm, h((req, res) => {
    const c = openCount(req.params.id);
    const b = req.body || {};
    const p = b.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(int(b.product_id))
      : b.barcode ? db.prepare('SELECT * FROM products WHERE barcode = ? AND active = 1').get(str(b.barcode)) : null;
    if (!p) throw notFound(b.barcode ? `Barkod bulunamadı: ${b.barcode}` : 'Ürün bulunamadı');
    if (p.type === 'service' || !p.track_stock) throw bad(`${p.name}: stok takibi kapalı`);
    const cur = db.prepare('SELECT counted FROM stock_count_items WHERE count_id = ? AND product_id = ?').get(c.id, p.id);
    const counted = b.counted !== undefined && b.counted !== null && b.counted !== '' ? round3(num(b.counted, NaN)) : round3((cur?.counted || 0) + num(b.add, 1));
    if (!Number.isFinite(counted) || counted < 0) throw bad('Sayılan miktar geçersiz');
    db.prepare(`INSERT INTO stock_count_items (count_id, product_id, counted) VALUES (?, ?, ?)
      ON CONFLICT(count_id, product_id) DO UPDATE SET counted = excluded.counted, updated_at = datetime('now','localtime')`).run(c.id, p.id, counted);
    res.json({ product_id: p.id, name: p.name, counted, system: branchStock(db, p.id, c.branch_id), count: loadCount(c.id).summary });
  }));
  r.delete('/stock-counts/:id/items/:productId', stockPerm, h((req, res) => {
    const c = openCount(req.params.id);
    db.prepare('DELETE FROM stock_count_items WHERE count_id = ? AND product_id = ?').run(c.id, int(req.params.productId));
    res.json(loadCount(c.id));
  }));
  /** Sayımı uygula: sayılan miktarlar stok olur. zero_uncounted: bu şubede stoğu olan ama sayılmayan ürünler 0'lanır */
  r.post('/stock-counts/:id/apply', allow(...MANAGERS), h((req, res) => {
    const c = openCount(req.params.id);
    const items = db.prepare('SELECT * FROM stock_count_items WHERE count_id = ?').all(c.id);
    if (!items.length) throw bad('Sayımda ürün yok');
    db.transaction(() => {
      const note = `Sayım #${c.id}${c.note ? ` · ${c.note}` : ''}`;
      for (const i of items) {
        db.prepare('UPDATE stock_count_items SET system_qty = ? WHERE id = ?').run(branchStock(db, i.product_id, c.branch_id), i.id);
        changeStock(db, i.product_id, i.counted, 'count', { absolute: true, branchId: c.branch_id, note, userId: req.user.id });
      }
      if (req.body?.zero_uncounted) {
        const counted = new Set(items.map((i) => i.product_id));
        const rows = db.prepare(`SELECT bs.product_id, bs.stock FROM branch_stock bs JOIN products p ON p.id = bs.product_id
          WHERE bs.branch_id = ? AND bs.stock != 0 AND p.active = 1 AND p.track_stock = 1 AND p.type = 'product'`).all(c.branch_id);
        for (const row of rows) {
          if (counted.has(row.product_id)) continue;
          db.prepare('INSERT INTO stock_count_items (count_id, product_id, counted, system_qty) VALUES (?, ?, 0, ?)').run(c.id, row.product_id, row.stock);
          changeStock(db, row.product_id, 0, 'count', { absolute: true, branchId: c.branch_id, note: `${note} · sayılmadı`, userId: req.user.id });
        }
      }
      db.prepare("UPDATE stock_counts SET status = 'applied', applied_at = datetime('now','localtime') WHERE id = ?").run(c.id);
    })();
    res.json(loadCount(c.id));
  }));
  r.post('/stock-counts/:id/cancel', stockPerm, h((req, res) => {
    const c = openCount(req.params.id);
    db.prepare("UPDATE stock_counts SET status = 'cancelled' WHERE id = ?").run(c.id);
    res.json(loadCount(c.id));
  }));

  // ------------------------------------------------------------------ SKT partileri
  const lotRow = (id) => db.prepare(`SELECT l.*, p.name, p.barcode, p.unit, p.buy_price, b.name AS branch_name,
      CAST(julianday(l.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left
    FROM stock_lots l JOIN products p ON p.id = l.product_id LEFT JOIN branches b ON b.id = l.branch_id WHERE l.id = ?`).get(id);

  r.get('/stock-lots', h((req, res) => {
    const pid = int(req.query.product_id);
    res.json(db.prepare(`SELECT l.*, CAST(julianday(l.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left FROM stock_lots l
      WHERE l.qty > 0 ${pid ? 'AND l.product_id = @pid' : ''} ORDER BY COALESCE(l.expiry_date, '9999-12-31'), l.id`).all({ pid }));
  }));
  /** Var olan stok için SKT gir. body: { product_id, expiry_date, qty } (stok değişmez) */
  r.post('/stock-lots', stockPerm, h((req, res) => {
    const b = req.body || {};
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(int(b.product_id));
    if (!p) throw notFound('Ürün bulunamadı');
    if (!DAY.test(b.expiry_date || '')) throw bad('SKT tarihini girin');
    const qty = round3(num(b.qty, NaN));
    if (!(qty > 0)) throw bad('Miktar gerekli');
    const branchId = resolveBranch(db, req);
    const id = db.prepare('INSERT INTO stock_lots (product_id, branch_id, expiry_date, qty, initial_qty, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.id, branchId, b.expiry_date, qty, qty, str(b.note) || 'Elle girildi').lastInsertRowid;
    res.status(201).json(lotRow(id));
  }));
  r.put('/stock-lots/:id', stockPerm, h((req, res) => {
    const l = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(req.params.id);
    if (!l) throw notFound();
    const expiry = req.body?.expiry_date !== undefined ? (DAY.test(req.body.expiry_date || '') ? req.body.expiry_date : null) : l.expiry_date;
    const qty = req.body?.qty !== undefined ? Math.max(0, round3(num(req.body.qty, l.qty))) : l.qty;
    db.prepare('UPDATE stock_lots SET expiry_date = ?, qty = ? WHERE id = ?').run(expiry, qty, l.id);
    res.json(lotRow(l.id));
  }));
  /** Partiyi fire olarak stoktan düş (tarihi geçti, imha edildi) */
  r.post('/stock-lots/:id/waste', stockPerm, h((req, res) => {
    const l = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(req.params.id);
    if (!l) throw notFound();
    if (!(l.qty > 0)) throw bad('Partide stok kalmamış');
    db.transaction(() => {
      changeStock(db, l.product_id, -l.qty, 'out', { branchId: l.branch_id, note: `SKT fire (${l.expiry_date || 'tarihsiz'})`, userId: req.user.id, lotId: l.id });
    })();
    res.json(lotRow(l.id));
  }));

  /** SKT yaklaşanlar: ?days=30 (geçmişler dahil) */
  r.get('/reports/expiry', h((req, res) => {
    const days = Math.max(0, Math.min(365, int(req.query.days, 30)));
    const rows = db.prepare(`SELECT l.id FROM stock_lots l JOIN products p ON p.id = l.product_id
      WHERE l.qty > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ? AND p.active = 1 ORDER BY l.expiry_date, l.id`).all(addDays(days));
    const list = rows.map((x) => lotRow(x.id));
    res.json({
      today: today(), days, lots: list,
      expired: list.filter((l) => l.expiry_date < today()).length,
      value: list.reduce((a, l) => a + Math.round(l.qty * l.buy_price), 0),
    });
  }));

  return r;
}
