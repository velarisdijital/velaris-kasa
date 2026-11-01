import { CATALOG } from './catalog.js';
import { refreshRecipeCosts } from './stock.js';

// İşletme türüne göre ilk kurulumda eklenen kategori ve örnek ürünler.
// Fiyatlar TL cinsindendir, kayıt sırasında kuruşa çevrilir.

export const BUSINESS_TYPES = {
  market: { label: 'Market / Bakkal', appointments: false },
  berber: { label: 'Berber / Kuaför / Güzellik', appointments: true },
  kafe: { label: 'Kafe / Büfe', appointments: false, tables: true },
  restoran: { label: 'Restoran / Lokanta', appointments: false, tables: true, tableLayout: [['Salon', 8], ['Bahçe', 4]], delivery: true },
  genel: { label: 'Genel Perakende', appointments: false },
};

// Ürün listeleri: server/catalog.js (Türkiye için hazır katalog)
export const PRESETS = CATALOG;

const kurus = (tl) => Math.round(tl * 100);

export function seedPreset(db, type) {
  const preset = PRESETS[type] || PRESETS.genel;
  const catIds = {};
  const insCat = db.prepare('INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)');
  preset.categories.forEach(([name, color], i) => {
    catIds[name] = insCat.run(name, color, i).lastInsertRowid;
  });
  const insProd = db.prepare(`
    INSERT INTO products (name, barcode, category_id, unit, buy_price, sell_price, vat_rate, type, stock, min_stock,
      track_stock, duration_min, favorite, menu_description)
    VALUES (@name, @barcode, @category_id, @unit, @buy_price, @sell_price, @vat_rate, @type, @stock, @min_stock,
      @track_stock, @duration_min, @favorite, @menu_description)`);
  for (const [name, cat, unit, buy, sell, vat, extra] of preset.products) {
    const isService = extra.type === 'service';
    insProd.run({
      name, barcode: extra.barcode ?? null, menu_description: extra.menu_description ?? null, category_id: catIds[cat] ?? null, unit,
      buy_price: kurus(buy), sell_price: kurus(sell), vat_rate: vat,
      type: extra.type || 'product',
      stock: extra.stock ?? 0, min_stock: extra.min_stock ?? 0,
      track_stock: isService ? 0 : (extra.track_stock ?? 1),
      duration_min: extra.duration_min ?? null, favorite: extra.favorite ?? 0,
    });
  }
  // Açılış stokları Merkez şubesine de yazılır (şube stoğu toplamla tutarlı olsun)
  db.prepare(`INSERT OR REPLACE INTO branch_stock (product_id, branch_id, stock)
    SELECT id, 1, stock FROM products WHERE track_stock = 1 AND stock != 0`).run();
  // Reçeteler
  const byName = (n) => db.prepare('SELECT * FROM products WHERE name = ?').get(n);
  if (preset.recipes) {
    const ins = db.prepare('INSERT INTO recipe_items (product_id, component_id, qty) VALUES (?, ?, ?)');
    for (const [name, parts] of preset.recipes) {
      const p = byName(name);
      if (!p) continue;
      for (const [c, q] of parts) { const comp = byName(c); if (comp) ins.run(p.id, comp.id, q); }
      db.prepare('UPDATE products SET track_stock = 0 WHERE id = ?').run(p.id);
    }
    refreshRecipeCosts(db);
  }
}
