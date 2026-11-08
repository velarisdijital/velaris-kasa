import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { allow, MANAGERS, requirePerm } from '../auth.js';
import { emitEvent, getSetting } from '../db.js';
import { hasFeature, requireFeature } from '../license.js';
import { branchForRegister, branchStock, changeStock, recipeOf, refreshRecipeCosts } from '../stock.js';
import { bad, bool, h, int, notFound, num, str } from '../util.js';

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.color AS category_color,
    (SELECT COUNT(*) FROM recipe_items ri WHERE ri.product_id = p.id) AS recipe_count
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
    menu_description: str(b.menu_description),
    menu_hidden: bool(b.menu_hidden),
  };
  if (!p.name) throw bad('Ürün adı gerekli');
  if (p.sell_price < 0 || p.buy_price < 0) throw bad('Fiyat negatif olamaz');
  if (![0, 1, 8, 10, 18, 20].includes(p.vat_rate) && (p.vat_rate < 0 || p.vat_rate > 100)) throw bad('Geçersiz KDV oranı');
  return p;
}

/** Yerel Türkiye barkod listesi (Open Food Facts'ten, scripts/import-off.mjs). Yoksa boş; VK_BARCODE_DB ile başka dosya. */
const barcodeCache = new Map();
export function localBarcodes() {
  const file = process.env.VK_BARCODE_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tr-barcodes.json');
  if (barcodeCache.has(file)) return barcodeCache.get(file);
  try {
    if (!fs.existsSync(file)) return {};
    barcodeCache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
  return barcodeCache.get(file);
}

/** Terazi barkodu: PP + 5 hane PLU + 5 hane gram + kontrol hanesi (EAN-13). */
export function parseScaleBarcode(code, prefixes) {
  if (!/^\d{13}$/.test(code)) return null;
  if (!prefixes.includes(code.slice(0, 2))) return null;
  const plu = code.slice(2, 7);
  const grams = parseInt(code.slice(7, 12), 10);
  return { candidates: [code.slice(0, 7), plu, String(parseInt(plu, 10))], qty: grams / 1000 };
}

/** İstekteki şube: branch_id ya da kasa adından. Şube özelliği yoksa her zaman Merkez (1). */
export function resolveBranch(db, req) {
  if (!hasFeature(db, 'branches')) return 1;
  const raw = req.body?.branch_id ?? req.query?.branch_id;
  if (raw) {
    const b = db.prepare('SELECT id FROM branches WHERE id = ? AND active = 1').get(int(raw));
    if (!b) throw bad('Şube bulunamadı');
    return b.id;
  }
  const reg = req.body?.register_name ?? req.query?.register;
  return reg ? branchForRegister(db, reg) : 1;
}

export default function productRoutes(db) {
  const r = Router();
  const multiBranch = () => hasFeature(db, 'branches') && db.prepare('SELECT COUNT(*) AS n FROM branches WHERE active = 1').get().n > 1;
  const getProduct = (id) => db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  const recordPrice = (productId, oldPrice, newPrice, reason, userId) => {
    db.prepare('INSERT INTO price_changes (product_id, old_price, new_price, reason, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(productId, oldPrice, newPrice, reason, userId);
    db.prepare("UPDATE products SET price_changed_at = datetime('now','localtime') WHERE id = ?").run(productId);
  };

  /**
   * Toplu fiyat güncelleme. body: {
   *   scope: { ids?: number[], category_id?: number, all?: true },
   *   mode: 'percent' (satış fiyatına % ekle/çıkar) | 'amount' (kuruş ekle/çıkar) | 'margin' (alış fiyatı + %kâr),
   *   value: number, round: kuruş adımı (0, 25, 50, 100, 500), dry: true → yalnızca önizleme }
   */
  r.post('/products/bulk-price', allow(...MANAGERS), h((req, res) => {
    const { scope = {}, mode, round: step = 0, dry } = req.body || {};
    const value = num(req.body?.value, NaN);
    if (!['percent', 'amount', 'margin'].includes(mode)) throw bad('Geçersiz yöntem');
    if (!Number.isFinite(value)) throw bad('Değer gerekli');
    if (mode === 'percent' && value <= -100) throw bad('Yüzde -100 veya altı olamaz');
    if (![0, 1, 10, 25, 50, 100, 500, 1000].includes(int(step))) throw bad('Geçersiz yuvarlama');
    const where = ['p.active = 1'];
    const params = {};
    if (Array.isArray(scope.ids) && scope.ids.length) {
      where.push(`p.id IN (${scope.ids.map((_, i) => `@id${i}`).join(',')})`);
      scope.ids.forEach((id, i) => { params[`id${i}`] = int(id); });
    } else if (scope.category_id) {
      where.push('p.category_id = @cat'); params.cat = int(scope.category_id);
    } else if (!scope.all) {
      throw bad('Ürün, kategori ya da "tüm ürünler" seçin');
    }
    const rows = db.prepare(`SELECT p.id, p.name, p.barcode, p.unit, p.buy_price, p.sell_price FROM products p
      WHERE ${where.join(' AND ')} ORDER BY p.name`).all(params);
    const roundTo = (k) => (int(step) > 0 ? Math.max(int(step), Math.round(k / int(step)) * int(step)) : Math.round(k));
    const changes = [];
    const skipped = [];
    for (const p of rows) {
      let next;
      if (mode === 'percent') next = p.sell_price * (1 + value / 100);
      else if (mode === 'amount') next = p.sell_price + Math.round(value);
      else {
        if (!p.buy_price) { skipped.push({ id: p.id, name: p.name, reason: 'Alış fiyatı yok' }); continue; }
        next = p.buy_price * (1 + value / 100);
      }
      next = roundTo(next);
      if (next < 0) { skipped.push({ id: p.id, name: p.name, reason: 'Fiyat eksiye düşüyor' }); continue; }
      if (next !== p.sell_price) changes.push({ id: p.id, name: p.name, barcode: p.barcode, unit: p.unit, buy_price: p.buy_price, old_price: p.sell_price, new_price: next });
    }
    if (!dry && changes.length) {
      const reason = { percent: `Toplu %${value}`, amount: `Toplu ${value > 0 ? '+' : ''}${(value / 100).toFixed(2)} TL`, margin: `Alış + %${value} kâr` }[mode];
      db.transaction(() => {
        const upd = db.prepare("UPDATE products SET sell_price = ?, updated_at = datetime('now','localtime') WHERE id = ?");
        for (const c of changes) {
          upd.run(c.new_price, c.id);
          recordPrice(c.id, c.old_price, c.new_price, reason, req.user.id);
          emitEvent(db, 'product.upserted', getProduct(c.id));
        }
      })();
    }
    res.json({ applied: !dry, count: changes.length, changes, skipped });
  }));

  /** Etiketi basılan ürünleri işaretler (fiyatı değişenler listesinden düşer). */
  r.post('/products/labels-printed', h((req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => int(x)).filter(Boolean);
    if (!ids.length) throw bad('Ürün seçin');
    db.prepare(`UPDATE products SET label_printed_at = datetime('now','localtime') WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    res.json({ ok: true, count: ids.length });
  }));

  r.get('/products/:id/prices', h((req, res) => {
    res.json(db.prepare(`SELECT c.*, u.name AS user_name FROM price_changes c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.product_id = ? ORDER BY c.id DESC LIMIT 50`).all(req.params.id));
  }));

  // ---- Kategoriler ----
  // Mutfak ekranı: kategorinin hazırlandığı yer
  const station = (v) => (['mutfak', 'bar', 'yok'].includes(v) ? v : 'mutfak');
  r.get('/categories', h((req, res) => {
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
                         FROM categories c ORDER BY sort_order, name`).all());
  }));
  r.post('/categories', allow(...MANAGERS), h((req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('Kategori adı gerekli');
    const id = db.prepare('INSERT INTO categories (name, color, sort_order, station) VALUES (?, ?, ?, ?)')
      .run(name, str(req.body.color), int(req.body.sort_order), station(req.body.station)).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  }));
  r.put('/categories/:id', allow(...MANAGERS), h((req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('Kategori adı gerekli');
    const cur = db.prepare('SELECT station FROM categories WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE categories SET name = ?, color = ?, sort_order = ?, station = ? WHERE id = ?')
      .run(name, str(req.body.color), int(req.body.sort_order), req.body.station === undefined ? (cur?.station || 'mutfak') : station(req.body.station), req.params.id);
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
    // Şube görünümü: ?branch_id= ya da kasadan ?register= → stok o şubenin stoğu olur, toplam total_stock'ta kalır
    const branchView = multiBranch() && (req.query.branch_id || req.query.register);
    const bid = branchView ? resolveBranch(db, req) : null;
    if (branchView) params.bid = bid;
    const stockExpr = branchView ? 'COALESCE(bs.stock, 0)' : 'p.stock';
    if (req.query.low === '1') where.push(`p.track_stock = 1 AND ${stockExpr} <= p.min_stock`);
    if (req.query.favorite === '1') where.push('p.favorite = 1');
    // Etiketi eskiyenler: fiyatı, son etiket basımından sonra değişmiş ürünler
    if (req.query.label_due === '1') where.push('p.price_changed_at IS NOT NULL AND (p.label_printed_at IS NULL OR p.label_printed_at < p.price_changed_at)');
    if (req.query.updated_since) { where.push('p.updated_at >= @since'); params.since = req.query.updated_since; }
    const select = branchView
      ? PRODUCT_SELECT.replace('FROM products p', 'FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @bid')
        .replace('SELECT p.*,', 'SELECT p.*, p.stock AS total_stock, COALESCE(bs.stock, 0) AS branch_stock, @bid AS branch_id,')
      : PRODUCT_SELECT;
    const sql = `${select} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT @limit`;
    params.limit = Math.min(int(req.query.limit, 5000) || 5000, 5000);
    const rows = db.prepare(sql).all(params);
    res.json(branchView ? rows.map((x) => ({ ...x, stock: x.branch_stock })) : rows);
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
    // Önce yerel Türkiye barkod listesi (internetsiz): scripts/import-off.mjs ile üretilir
    const local = localBarcodes()[code];
    if (local) return res.json({ barcode: code, name: local, source: 'local' });
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
          stock, min_stock, track_stock, duration_min, favorite, active, crm_id, menu_description, menu_hidden)
        VALUES (@name, @barcode, @sku, @category_id, @type, @unit, @buy_price, @sell_price, @vat_rate,
          0, @min_stock, @track_stock, @duration_min, @favorite, @active, @crm_id, @menu_description, @menu_hidden)`).run(p).lastInsertRowid;
      if (initial) changeStock(db, id, initial, 'in', { unitCost: p.buy_price, note: 'Açılış stoku', userId: req.user.id, branchId: resolveBranch(db, req) });
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
      if (p.sell_price !== existing.sell_price) recordPrice(existing.id, existing.sell_price, p.sell_price, 'Ürün düzenleme', req.user.id);
      db.prepare(`UPDATE products SET name=@name, barcode=@barcode, sku=@sku, category_id=@category_id, type=@type, unit=@unit,
          buy_price=@buy_price, sell_price=@sell_price, vat_rate=@vat_rate, min_stock=@min_stock, track_stock=@track_stock,
          duration_min=@duration_min, favorite=@favorite, active=@active, crm_id=@crm_id,
          menu_description=@menu_description, menu_hidden=@menu_hidden, updated_at=datetime('now','localtime') WHERE id=@id`).run({ ...p, id: existing.id });
      // Reçeteli ürünün maliyeti reçeteden gelir; bileşenin maliyeti değiştiyse onu kullanan ürünler güncellenir
      refreshRecipeCosts(db, existing.id);
      if (recipeOf(db, existing.id).length) refreshRecipeCosts(db);
      emitEvent(db, 'product.upserted', getProduct(existing.id));
    })();
    res.json(getProduct(existing.id));
  }));

  // ---- Reçete ----
  r.get('/products/:id/recipe', h((req, res) => {
    const p = db.prepare('SELECT id, name, buy_price, sell_price FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    const items = recipeOf(db, p.id);
    const cost = Math.round(items.reduce((a, c) => a + c.buy_price * c.qty, 0));
    const usedIn = db.prepare(`SELECT p.id, p.name, r.qty FROM recipe_items r JOIN products p ON p.id = r.product_id
      WHERE r.component_id = ? ORDER BY p.name`).all(p.id);
    res.json({ product_id: p.id, items, cost, used_in: usedIn });
  }));

  /** Reçeteyi kaydeder. body: { items: [{ component_id, qty }] } — boş liste reçeteyi kaldırır. */
  r.put('/products/:id/recipe', allow(...MANAGERS), h((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    if (p.type === 'service') throw bad('Hizmetlere reçete eklenemez');
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((i) => ({ component_id: int(i.component_id), qty: num(i.qty, NaN) }));
    const seen = new Set();
    for (const i of items) {
      if (!(i.qty > 0)) throw bad('Bileşen miktarı sıfırdan büyük olmalı');
      if (i.component_id === p.id) throw bad('Ürün kendi reçetesinde olamaz');
      if (seen.has(i.component_id)) throw bad('Aynı bileşen iki kez eklenmiş');
      seen.add(i.component_id);
      const c = db.prepare('SELECT id, name, type FROM products WHERE id = ?').get(i.component_id);
      if (!c) throw bad('Bileşen bulunamadı');
      if (c.type === 'service') throw bad(`${c.name} hizmet; bileşen olamaz`);
      if (recipeOf(db, c.id).length) throw bad(`${c.name} kendisi reçeteli; iç içe reçete desteklenmiyor`);
    }
    if (items.length && db.prepare('SELECT 1 FROM recipe_items WHERE component_id = ?').get(p.id)) {
      throw bad(`${p.name} başka bir ürünün reçetesinde bileşen; ona reçete eklenemez`);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(p.id);
      const ins = db.prepare('INSERT INTO recipe_items (product_id, component_id, qty) VALUES (?, ?, ?)');
      for (const i of items) ins.run(p.id, i.component_id, Math.round(i.qty * 1000) / 1000);
      // Reçeteli ürünün kendi stoğu tutulmaz; stok bileşenlerden düşer
      if (items.length) db.prepare("UPDATE products SET track_stock = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(p.id);
      refreshRecipeCosts(db);
      emitEvent(db, 'product.upserted', getProduct(p.id));
    })();
    const fresh = recipeOf(db, p.id);
    res.json({ product_id: p.id, items: fresh, cost: Math.round(fresh.reduce((a, c) => a + c.buy_price * c.qty, 0)), product: getProduct(p.id) });
  }));

  r.delete('/products/:id', allow(...MANAGERS), h((req, res) => {
    db.prepare("UPDATE products SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  }));

  /** Stok girişi / çıkışı / sayım. body: { type: in|out|adjust|count, qty, unit_cost?, note? } */
  r.post('/products/:id/stock', requirePerm(db, 'stock'), h((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    if (p.type === 'service' || !p.track_stock) throw bad('Bu ürün için stok takibi kapalı');
    const type = req.body.type;
    const qty = num(req.body.qty, NaN);
    if (!['in', 'out', 'adjust', 'count'].includes(type)) throw bad('Geçersiz hareket türü');
    if (!Number.isFinite(qty)) throw bad('Miktar gerekli');
    if (type !== 'count' && type !== 'adjust' && qty <= 0) throw bad('Miktar sıfırdan büyük olmalı');
    const unitCost = req.body.unit_cost != null && req.body.unit_cost !== '' ? int(req.body.unit_cost) : null;
    const branchId = resolveBranch(db, req);

    db.transaction(() => {
      const delta = type === 'out' ? -qty : qty;
      changeStock(db, p.id, delta, type, { unitCost, note: str(req.body.note), userId: req.user.id, absolute: type === 'count', branchId });
      // Alışta yeni maliyet geldiyse ürün alış fiyatını güncelle
      if (type === 'in' && unitCost != null && unitCost > 0) {
        db.prepare('UPDATE products SET buy_price = ? WHERE id = ?').run(unitCost, p.id);
      }
    })();
    res.json({ ...getProduct(p.id), branch_id: branchId, branch_stock: branchStock(db, p.id, branchId) });
  }));

  /** Şube stokları (ürün detayı için). */
  r.get('/products/:id/branches', h((req, res) => {
    res.json(db.prepare(`SELECT b.id, b.name, COALESCE(bs.stock, 0) AS stock FROM branches b
      LEFT JOIN branch_stock bs ON bs.branch_id = b.id AND bs.product_id = ? WHERE b.active = 1 ORDER BY b.id`).all(req.params.id));
  }));

  /** Şubeler arası transfer. body: { product_id, from_branch_id, to_branch_id, qty, note } */
  r.post('/stock/transfer', allow(...MANAGERS), h((req, res) => {
    requireFeature(db, 'branches');
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(int(req.body.product_id));
    if (!p) throw notFound('Ürün bulunamadı');
    if (p.type === 'service' || !p.track_stock) throw bad('Bu ürün için stok takibi kapalı');
    const from = db.prepare('SELECT * FROM branches WHERE id = ? AND active = 1').get(int(req.body.from_branch_id));
    const to = db.prepare('SELECT * FROM branches WHERE id = ? AND active = 1').get(int(req.body.to_branch_id));
    if (!from || !to) throw bad('Şube bulunamadı');
    if (from.id === to.id) throw bad('Çıkış ve giriş şubesi aynı olamaz');
    const qty = num(req.body.qty);
    if (!(qty > 0)) throw bad('Miktar sıfırdan büyük olmalı');
    if (getSetting(db, 'allow_negative_stock') !== '1' && branchStock(db, p.id, from.id) < qty) throw bad(`${from.name} şubesinde yeterli stok yok`);
    const note = str(req.body.note);
    db.transaction(() => {
      changeStock(db, p.id, -qty, 'out', { userId: req.user.id, branchId: from.id, note: `Transfer → ${to.name}${note ? ` · ${note}` : ''}` });
      changeStock(db, p.id, qty, 'in', { userId: req.user.id, branchId: to.id, note: `Transfer ← ${from.name}${note ? ` · ${note}` : ''}`, unitCost: p.buy_price });
    })();
    res.json(db.prepare(`SELECT b.id, b.name, COALESCE(bs.stock, 0) AS stock FROM branches b
      LEFT JOIN branch_stock bs ON bs.branch_id = b.id AND bs.product_id = ? WHERE b.active = 1 ORDER BY b.id`).all(p.id));
  }));

  r.get('/stock-movements', h((req, res) => {
    const where = [];
    const params = { limit: Math.min(int(req.query.limit, 200) || 200, 2000) };
    if (req.query.product_id) { where.push('m.product_id = @pid'); params.pid = int(req.query.product_id); }
    if (req.query.type) { where.push('m.type = @type'); params.type = req.query.type; }
    if (req.query.branch_id) { where.push('m.branch_id = @bid'); params.bid = int(req.query.branch_id); }
    res.json(db.prepare(`SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name, b.name AS branch_name
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN branches b ON b.id = m.branch_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT @limit`).all(params));
  }));

  /**
   * Toplu içe aktarma (CSV'den çevrilmiş satırlar). Barkod eşleşirse günceller, yoksa ekler.
   * rows: [{ name, barcode, category, buy_price, sell_price, vat_rate, stock, min_stock, unit }]
   */
  r.post('/products/import', allow(...MANAGERS), h((req, res) => {
    const branchId = resolveBranch(db, req);
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
            if (row.stock !== undefined && row.stock !== '' && num(row.stock) !== branchStock(db, existing.id, branchId)) {
              changeStock(db, existing.id, num(row.stock), 'count', { note: 'İçe aktarma', userId: req.user.id, absolute: true, branchId });
            }
            updated++;
          } else {
            const id = db.prepare(`INSERT INTO products (name, barcode, sku, category_id, type, unit, buy_price, sell_price, vat_rate,
                stock, min_stock, track_stock, duration_min, favorite, active)
              VALUES (@name, @barcode, @sku, @category_id, @type, @unit, @buy_price, @sell_price, @vat_rate,
                0, @min_stock, @track_stock, @duration_min, @favorite, 1)`).run(p).lastInsertRowid;
            if (p.stock) changeStock(db, id, p.stock, 'in', { note: 'İçe aktarma', userId: req.user.id, branchId });
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
