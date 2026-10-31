import { emitEvent } from './db.js';

/**
 * Ürün stokunu değiştirir ve hareket kaydı oluşturur. Transaction içinde çağrılmalı.
 * delta: işaretli miktar (+ giriş, - çıkış). type 'count' ise delta yerine yeni stok verilir.
 */
export function changeStock(db, productId, delta, type, { unitCost = null, note = null, saleId = null, userId = null, absolute = false, branchId = 1 } = {}) {
  const p = db.prepare('SELECT id, name, stock, min_stock, track_stock, type, barcode, crm_id FROM products WHERE id = ?').get(productId);
  if (!p || p.type === 'service' || !p.track_stock) return null;

  // Şube stoğu değişir, ürünün toplam stoğu (products.stock) aynı farkla güncellenir
  const before = branchStock(db, p.id, branchId);
  const after = round3(absolute ? delta : before + delta);
  const qty = round3(after - before);
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, stock) VALUES (?, ?, ?)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET stock = excluded.stock`).run(p.id, branchId, after);
  db.prepare("UPDATE products SET stock = round(stock + ?, 3), updated_at = datetime('now','localtime') WHERE id = ?").run(qty, p.id);
  db.prepare(`INSERT INTO stock_movements (product_id, type, qty, stock_after, unit_cost, note, sale_id, user_id, branch_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, type, qty, after, unitCost, note, saleId, userId, branchId);

  if (p.min_stock > 0 && before > p.min_stock && after <= p.min_stock) {
    emitEvent(db, 'stock.low', {
      product_id: p.id, crm_id: p.crm_id, name: p.name, barcode: p.barcode, stock: after, min_stock: p.min_stock,
    });
  }
  return after;
}

export const round3 = (n) => Math.round(n * 1000) / 1000;

// ---- Reçeteler ----
export const recipeOf = (db, productId) =>
  db.prepare(`SELECT r.component_id, r.qty, p.name, p.unit, p.buy_price, p.track_stock, p.stock FROM recipe_items r
    JOIN products p ON p.id = r.component_id WHERE r.product_id = ? ORDER BY p.name`).all(productId);

/**
 * Satış / iade stok hareketi: reçeteli ürünse bileşenlerin stoğu, değilse ürünün kendi stoğu değişir.
 * qty: işaretli ürün miktarı (- satış, + iade).
 */
export function moveProductStock(db, productId, qty, type, opts = {}) {
  const recipe = recipeOf(db, productId);
  if (!recipe.length) return changeStock(db, productId, qty, type, opts);
  const name = db.prepare('SELECT name FROM products WHERE id = ?').get(productId)?.name;
  for (const c of recipe) {
    changeStock(db, c.component_id, round3(qty * c.qty), type, { ...opts, note: [opts.note, `Reçete: ${name}`].filter(Boolean).join(' · ') });
  }
  return null;
}

/** Satılacak kalemlerin gerçek stok ihtiyacı (reçeteler açılmış hâlde): Map<productId, qty> */
export function stockNeeds(db, lines) {
  const need = new Map();
  for (const { product_id: id, qty } of lines) {
    if (!id) continue;
    const recipe = recipeOf(db, id);
    if (recipe.length) for (const c of recipe) need.set(c.component_id, round3((need.get(c.component_id) || 0) + qty * c.qty));
    else need.set(id, round3((need.get(id) || 0) + qty));
  }
  return need;
}

/** Bileşen maliyeti değişince onu kullanan reçeteli ürünlerin alış fiyatını (maliyetini) günceller. */
export function refreshRecipeCosts(db, componentId = null) {
  const ids = componentId
    ? db.prepare('SELECT DISTINCT product_id FROM recipe_items WHERE component_id = ?').all(componentId).map((r) => r.product_id)
    : db.prepare('SELECT DISTINCT product_id FROM recipe_items').all().map((r) => r.product_id);
  const upd = db.prepare("UPDATE products SET buy_price = ?, updated_at = datetime('now','localtime') WHERE id = ? AND buy_price != ?");
  for (const id of ids) {
    const cost = Math.round(recipeOf(db, id).reduce((a, c) => a + c.buy_price * c.qty, 0));
    upd.run(cost, id, cost);
  }
}

export const branchStock = (db, productId, branchId = 1) =>
  db.prepare('SELECT stock FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(productId, branchId)?.stock ?? 0;

/** Kasanın bağlı olduğu şube. Yeni kasa adı ilk görüldüğünde Merkez'e bağlanır. */
export function branchForRegister(db, registerName) {
  const name = String(registerName || '').trim() || 'Kasa 1';
  const row = db.prepare('SELECT branch_id FROM registers WHERE name = ?').get(name);
  if (row) return row.branch_id;
  db.prepare('INSERT OR IGNORE INTO registers (name, branch_id) VALUES (?, 1)').run(name);
  return 1;
}
