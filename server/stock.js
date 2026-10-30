import { emitEvent } from './db.js';

/**
 * Ürün stokunu değiştirir ve hareket kaydı oluşturur. Transaction içinde çağrılmalı.
 * delta: işaretli miktar (+ giriş, - çıkış). type 'count' ise delta yerine yeni stok verilir.
 */
export function changeStock(db, productId, delta, type, { unitCost = null, note = null, saleId = null, userId = null, absolute = false } = {}) {
  const p = db.prepare('SELECT id, name, stock, min_stock, track_stock, type, barcode, crm_id FROM products WHERE id = ?').get(productId);
  if (!p || p.type === 'service' || !p.track_stock) return null;

  const before = p.stock;
  const after = round3(absolute ? delta : before + delta);
  const qty = round3(after - before);
  db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, p.id);
  db.prepare(`INSERT INTO stock_movements (product_id, type, qty, stock_after, unit_cost, note, sale_id, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, type, qty, after, unitCost, note, saleId, userId);

  if (p.min_stock > 0 && before > p.min_stock && after <= p.min_stock) {
    emitEvent(db, 'stock.low', {
      product_id: p.id, crm_id: p.crm_id, name: p.name, barcode: p.barcode, stock: after, min_stock: p.min_stock,
    });
  }
  return after;
}

export const round3 = (n) => Math.round(n * 1000) / 1000;
