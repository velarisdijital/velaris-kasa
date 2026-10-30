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
