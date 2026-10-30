import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent, getSetting } from '../db.js';
import { changeStock } from '../stock.js';
import { bad, bool, h, int, notFound, num, str } from '../util.js';

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.color AS category_color
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

function normalizeProduct(body, existing = {}) {
  const b = { ...existing, ...body };
  const type = b.type === 'service' ? 'service' : 'product';
  const p = {
    name: str(b.name),
    barcode: str(b.barcode),
    sku: str(b.sku),
    category_id: b.category_id ? int(b.category_id) : null,
    type,
    unit: str(b.unit) || 'adet',
    buy_price: int(b.buy_price),
    sell_price: int(b.sell_price),
    vat_rate: num(b.vat_rate, 20),
    stock: num(b.stock),
    min_stock: num(b.min_stock),
    track_stock: type === 'service' ? 0 : bool(b.track_stock ?? 1),
    duration_min: b.duration_min ? int(b.duration_min) : null,
    favorite: bool(b.favorite),
    active: b.active === undefined ? 1 : bool(b.active),
    crm_id: str(b.crm_id),
  };
  if (!p.name) throw bad('Ürün adı gerekli');
  if (p.sell_price < 0 || p.buy_price < 0) throw bad('Fiyat negatif olamaz');
  if (![0, 1, 8, 10, 18, 20].includes(p.vat_rate) && (p.vat_rate < 0 || p.vat_rate > 100)) throw bad('Geçersiz KDV oranı');
  return p;
}

/** Terazi barkodu: PP + 5 hane PLU + 5 hane gram + kontrol hanesi (EAN-13). */
export function parseScaleBarcode(code, prefixes) {
  if (!/^\d{13}$/.test(code)) return null;
  if (!prefixes.includes(code.slice(0, 2))) return null;
  const plu = code.slice(2, 7);
  const grams = parseInt(code.slice(7, 12), 10);
  return { candidates: [code.slice(0, 7), plu, String(parseInt(plu, 10))], qty: grams / 1000 };
}

export default function productRoutes(db) {
  const r = Router();
  const getProduct = (id) => db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);

  // ---- Kategoriler ----
  r.get('/categories', h((req, res) => {
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
                         FROM categories c ORDER BY sort_order, name`).all());
  }));
  r.post('/categories', allow(...MANAGERS), h((req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('Kategori adı gerekli');
    const id = db.prepare('INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)')
      .run(name, str(req.body.color), int(req.body.sort_order)).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  }));
  r.put('/categories/:id', allow(...MANAGERS), h((req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('Kategori adı gerekli');
    db.prepare('UPDATE categories SET name = ?, color = ?, sort_order = ? WHERE id = ?')
      .run(name, str(req.body.color), int(req.body.sort_order), req.params.id);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  }));
  r.delete('/categories/:id', allow(...MANAGERS), h((req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  }));

  // ---- Ürünler ----
  r.get('/products', h((req, res) => {
    const where = [];
    const params = {};
    if (req.query.all !== '1') where.push('p.active = 1');
    if (req.query.q) {
      where.push('(p.name LIKE @q OR p.barcode LIKE @q OR p.sku LIKE @q)');
      params.q = `%${req.query.q}%`;
    }
    if (req.query.category_id) { where.push('p.category_id = @cat'); params.cat = int(req.query.category_id); }
    if (req.query.type) { where.push('p.type = @type'); params.type = req.query.type; }
    if (req.query.low === '1') where.push('p.track_stock = 1 AND p.stock <= p.min_stock');
    if (req.query.favorite === '1') where.push('p.favorite = 1');
    if (req.query.updated_since) { where.push('p.updated_at >= @since'); params.since = req.query.updated_since; }
    const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT @limit`;
    params.limit = Math.min(int(req.query.limit, 5000) || 5000, 5000);
    res.json(db.prepare(sql).all(params));
  }));

  r.get('/products/barcode/:code', h((req, res) => {
    const code = String(req.params.code).trim();
    const direct = db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ? AND p.active = 1`).get(code);
    if (direct) return res.json({ product: direct, qty: null });
    const prefixes = getSetting(db, 'scale_barcode_prefixes').split(',').map((s) => s.trim()).filter(Boolean);
    const scale = parseScaleBarcode(code, prefixes);
    if (scale) {
      for (const c of scale.candidates) {
        const p = db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ? AND p.active = 1`).get(c);
        if (p) return res.json({ product: p, qty: scale.qty });
      }
    }
    throw notFound('Barkod bulunamadı');
  }));

  /** Bulunamayan barkod için internette ürün adı arar (Open Food Facts, ücretsiz açık veritabanı). */
  const lookupCache = new Map();
  r.get('/products/lookup/:code', h(async (req, res) => {
    const code = String(req.params.code);
    if (!/^\d{8,14}$/.test(code)) throw bad('Barkod geçersiz');
    if (getSetting(db, 'product_lookup') !== '1') throw notFound('İnternetten ürün arama kapalı');
    if (!lookupCache.has(code)) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r2 = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_tr,brands,quantity`, {
          signal: ctrl.signal, headers: { 'User-Agent': 'VelarisKasa/1.0 (velaris-kasa)' },
        });
        const j = await r2.json();
        const p = j.status === 1 ? j.product : null;
        const name = p && [p.brands?.split(',')[0]?.trim(), p.product_name_tr || p.product_name, p.quantity]
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        lookupCache.set(code, name || null);
      } catch {
        throw notFound('Ürün bilgisi alınamadı');
      } finally {
        clearTimeout(t);
      }
    }
    const name = lookupCache.get(code);
    if (!name) throw notFound('Ürün internette bulunamadı');
    res.json({ barcode: code, name, source: 'openfoodfacts' });
  }));

  r.get('/products/:id', h((req, res) => {
    const p = getProduct(req.params.id);
    if (!p) throw notFound();
    res.json(p);
  }));

  r.post('/products', allow(...MANAGERS), h((req, res) => {
    const p = normalizeProduct(req.body);
    const id = db.transaction(() => {
      const initial = p.stock;
      const id = db.prepare(`INSERT INTO products (name, barcode, sku, category_id, type, unit, buy_price, sell_price, vat_rate,
          stock, min_stock, track_stock, duration_min, favorite, active, crm_id)
        VALUES (@name, @barcode, @sku, @category_id, @type, @unit, @buy_price, @sell_price, @vat_rate,
          0, @min_stock, @track_stock, @duration_min, @favorite, @active, @crm_id)`).run(p).lastInsertRowid;
      if (initial) changeStock(db, id, initial, 'in', { unitCost: p.buy_price, note: 'Açılış stoku', userId: req.user.id });
      emitEvent(db, 'product.upserted', getProduct(id));
      return id;
    })();
    res.status(201).json(getProduct(id));
  }));

  r.put('/products/:id', allow(...MANAGERS), h((req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound();
    // Stok bu uçtan değiştirilmez; /stock ucu hareket kaydı tutar.
    const p = normalizeProduct({ ...req.body, stock: existing.stock }, existing);
    db.transaction(() => {
      db.prepare(`UPDATE products SET name=@name, barcode=@barcode, sku=@sku, category_id=@category_id, type=@type, unit=@unit,
          buy_price=@buy_price, sell_price=@sell_price, vat_rate=@vat_rate, min_stock=@min_stock, track_stock=@track_stock,
          duration_min=@duration_min, favorite=@favorite, active=@active, crm_id=@crm_id,
          updated_at=datetime('now','localtime') WHERE id=@id`).run({ ...p, id: existing.id });
      emitEvent(db, 'product.upserted', getProduct(existing.id));
    })();
    res.json(getProduct(existing.id));
  }));

  r.delete('/products/:id', allow(...MANAGERS), h((req, res) => {
    db.prepare("UPDATE products SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  }));

  /** Stok girişi / çıkışı / sayım. body: { type: in|out|adjust|count, qty, unit_cost?, note? } */
  r.post('/products/:id/stock', allow(...MANAGERS, 'cashier'), h((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    if (p.type === 'service' || !p.track_stock) throw bad('Bu ürün için stok takibi kapalı');
    const type = req.body.type;
    const qty = num(req.body.qty, NaN);
    if (!['in', 'out', 'adjust', 'count'].includes(type)) throw bad('Geçersiz hareket türü');
    if (!Number.isFinite(qty)) throw bad('Miktar gerekli');
    if (type !== 'count' && type !== 'adjust' && qty <= 0) throw bad('Miktar sıfırdan büyük olmalı');
    const unitCost = req.body.unit_cost != null && req.body.unit_cost !== '' ? int(req.body.unit_cost) : null;

    db.transaction(() => {
      const delta = type === 'out' ? -qty : qty;
      changeStock(db, p.id, delta, type, { unitCost, note: str(req.body.note), userId: req.user.id, absolute: type === 'count' });
      // Alışta yeni maliyet geldiyse ürün alış fiyatını güncelle
      if (type === 'in' && unitCost != null && unitCost > 0) {
        db.prepare('UPDATE products SET buy_price = ? WHERE id = ?').run(unitCost, p.id);
      }
    })();
    res.json(getProduct(p.id));
  }));

  r.get('/stock-movements', h((req, res) => {
    const where = [];
    const params = { limit: Math.min(int(req.query.limit, 200) || 200, 2000) };
    if (req.query.product_id) { where.push('m.product_id = @pid'); params.pid = int(req.query.product_id); }
    if (req.query.type) { where.push('m.type = @type'); params.type = req.query.type; }
    res.json(db.prepare(`SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT @limit`).all(params));
  }));

  /**
   * Toplu içe aktarma (CSV'den çevrilmiş satırlar). Barkod eşleşirse günceller, yoksa ekler.
   * rows: [{ name, barcode, category, buy_price, sell_price, vat_rate, stock, min_stock, unit }]
   */
  r.post('/products/import', allow(...MANAGERS), h((req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad('İçe aktarılacak satır yok');
    let created = 0, updated = 0;
    const errors = [];
    db.transaction(() => {
      const catCache = new Map(db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name.toLocaleLowerCase('tr'), c.id]));
      const catId = (name) => {
        if (!str(name)) return null;
        const key = name.trim().toLocaleLowerCase('tr');
        if (!catCache.has(key)) catCache.set(key, db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim()).lastInsertRowid);
        return catCache.get(key);
      };
      rows.forEach((row, i) => {
        try {
          const existing = str(row.barcode) ? db.prepare('SELECT * FROM products WHERE barcode = ?').get(str(row.barcode)) : null;
          const p = normalizeProduct({ ...row, category_id: row.category ? catId(row.category) : row.category_id }, existing || {});
          if (existing) {
            db.prepare(`UPDATE products SET name=@name, category_id=@category_id, unit=@unit, buy_price=@buy_price,
              sell_price=@sell_price, vat_rate=@vat_rate, min_stock=@min_stock, active=1, updated_at=datetime('now','localtime')
              WHERE id=@id`).run({ ...p, id: existing.id });
            if (row.stock !== undefined && row.stock !== '' && num(row.stock) !== existing.stock) {
              changeStock(db, existing.id, num(row.stock), 'count', { note: 'İçe aktarma', userId: req.user.id, absolute: true });
            }
            updated++;
          } else {
            const id = db.prepare(`INSERT INTO products (name, barcode, sku, category_id, type, unit, buy_price, sell_price, vat_rate,
                stock, min_stock, track_stock, duration_min, favorite, active)
              VALUES (@name, @barcode, @sku, @category_id, @type, @unit, @buy_price, @sell_price, @vat_rate,
                0, @min_stock, @track_stock, @duration_min, @favorite, 1)`).run(p).lastInsertRowid;
            if (p.stock) changeStock(db, id, p.stock, 'in', { note: 'İçe aktarma', userId: req.user.id });
            created++;
          }
        } catch (e) {
          errors.push({ row: i + 1, error: e.message });
        }
      });
    })();
    res.json({ created, updated, errors });
  }));

  return r;
}
