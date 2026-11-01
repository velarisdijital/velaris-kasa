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

export const PRESETS = {
  market: {
    categories: [
      ['Gıda', '#f59e0b'], ['İçecek', '#3b82f6'], ['Süt Ürünleri', '#22c55e'],
      ['Temizlik', '#a855f7'], ['Tütün', '#64748b'], ['Manav', '#16a34a'], ['Fırın', '#d97706'],
    ],
    products: [
      ['Ekmek', 'Fırın', 'adet', 8, 10, 1, { barcode: null, favorite: 1, track_stock: 0 }],
      ['Su 0.5 L', 'İçecek', 'adet', 4, 7.5, 1, { stock: 120, min_stock: 24, favorite: 1 }],
      ['Kola 1 L', 'İçecek', 'adet', 28, 40, 1, { stock: 36, min_stock: 6 }],
      ['Süt 1 L', 'Süt Ürünleri', 'adet', 26, 35, 1, { stock: 24, min_stock: 6, favorite: 1 }],
      ['Yumurta 10\'lu', 'Gıda', 'paket', 50, 70, 1, { stock: 20, min_stock: 5 }],
      ['Domates', 'Manav', 'kg', 20, 35, 1, { stock: 25, min_stock: 5, favorite: 1 }],
      ['Bulaşık Deterjanı', 'Temizlik', 'adet', 45, 70, 20, { stock: 10, min_stock: 3 }],
      ['Poşet', 'Gıda', 'adet', 0.15, 0.25, 20, { track_stock: 0, favorite: 1 }],
    ],
  },
  berber: {
    categories: [['Saç', '#3b82f6'], ['Sakal', '#f59e0b'], ['Bakım', '#ec4899'], ['Ürün Satışı', '#22c55e']],
    products: [
      ['Saç Kesimi', 'Saç', 'adet', 0, 300, 20, { type: 'service', duration_min: 30, favorite: 1 }],
      ['Sakal Tıraşı', 'Sakal', 'adet', 0, 150, 20, { type: 'service', duration_min: 20, favorite: 1 }],
      ['Saç + Sakal', 'Saç', 'adet', 0, 400, 20, { type: 'service', duration_min: 45, favorite: 1 }],
      ['Çocuk Tıraşı', 'Saç', 'adet', 0, 200, 20, { type: 'service', duration_min: 20, favorite: 1 }],
      ['Cilt Bakımı', 'Bakım', 'adet', 0, 350, 20, { type: 'service', duration_min: 30 }],
      ['Saç Boyama', 'Saç', 'adet', 0, 600, 20, { type: 'service', duration_min: 60 }],
      ['Wax 100 ml', 'Ürün Satışı', 'adet', 90, 180, 20, { stock: 12, min_stock: 3 }],
      ['Şampuan', 'Ürün Satışı', 'adet', 110, 220, 20, { stock: 8, min_stock: 2 }],
    ],
  },
  kafe: {
    categories: [['Sıcak İçecek', '#b45309'], ['Soğuk İçecek', '#3b82f6'], ['Yiyecek', '#f59e0b'], ['Tatlı', '#ec4899']],
    products: [
      ['Çay', 'Sıcak İçecek', 'adet', 2, 15, 10, { track_stock: 0, favorite: 1 }],
      ['Türk Kahvesi', 'Sıcak İçecek', 'adet', 10, 60, 10, { track_stock: 0, favorite: 1 }],
      ['Filtre Kahve', 'Sıcak İçecek', 'adet', 15, 80, 10, { track_stock: 0, favorite: 1 }],
      ['Ayran', 'Soğuk İçecek', 'adet', 8, 25, 10, { stock: 40, min_stock: 10, favorite: 1 }],
      ['Tost', 'Yiyecek', 'adet', 30, 90, 10, { track_stock: 0, favorite: 1 }],
      ['Simit', 'Yiyecek', 'adet', 8, 20, 10, { stock: 30, min_stock: 5 }],
      ['Cheesecake', 'Tatlı', 'adet', 40, 120, 10, { stock: 8, min_stock: 2 }],
    ],
  },
  restoran: {
    categories: [['Çorbalar', '#d97706'], ['Izgaralar', '#dc2626'], ['Ana Yemekler', '#b45309'], ['Salata & Meze', '#16a34a'],
      ['Tatlılar', '#db2777'], ['İçecekler', '#3b82f6'], ['Malzeme', '#64748b']],
    products: [
      ['Mercimek Çorbası', 'Çorbalar', 'adet', 18, 90, 10, { track_stock: 0, favorite: 1 }],
      ['Ezogelin Çorbası', 'Çorbalar', 'adet', 18, 90, 10, { track_stock: 0 }],
      ['Adana Kebap', 'Izgaralar', 'adet', 0, 380, 10, { favorite: 1 }],
      ['Urfa Kebap', 'Izgaralar', 'adet', 0, 380, 10, {}],
      ['Tavuk Şiş', 'Izgaralar', 'adet', 0, 300, 10, { favorite: 1 }],
      ['Izgara Köfte', 'Izgaralar', 'adet', 0, 320, 10, { favorite: 1 }],
      ['Kuru Fasulye', 'Ana Yemekler', 'adet', 45, 180, 10, { track_stock: 0 }],
      ['Pilav', 'Ana Yemekler', 'adet', 0, 80, 10, { favorite: 1 }],
      ['Çoban Salata', 'Salata & Meze', 'adet', 25, 110, 10, { track_stock: 0 }],
      ['Humus', 'Salata & Meze', 'adet', 30, 120, 10, { track_stock: 0 }],
      ['Künefe', 'Tatlılar', 'adet', 70, 220, 10, { stock: 20, min_stock: 5, favorite: 1 }],
      ['Sütlaç', 'Tatlılar', 'adet', 30, 120, 10, { stock: 15, min_stock: 4 }],
      ['Ayran', 'İçecekler', 'adet', 12, 40, 10, { stock: 60, min_stock: 12, favorite: 1 }],
      ['Kola 330 ml', 'İçecekler', 'adet', 25, 60, 20, { stock: 48, min_stock: 12 }],
      ['Su 500 ml', 'İçecekler', 'adet', 5, 20, 10, { stock: 80, min_stock: 24 }],
      ['Çay', 'İçecekler', 'adet', 2, 25, 10, { track_stock: 0, favorite: 1 }],
      // Malzemeler (satılmaz; reçetelerle stoktan düşer)
      ['Kıyma', 'Malzeme', 'kg', 650, 0, 1, { stock: 12, min_stock: 3 }],
      ['Tavuk But', 'Malzeme', 'kg', 280, 0, 1, { stock: 10, min_stock: 3 }],
      ['Lavaş', 'Malzeme', 'adet', 5, 0, 1, { stock: 200, min_stock: 40 }],
      ['Pirinç', 'Malzeme', 'kg', 70, 0, 1, { stock: 15, min_stock: 4 }],
    ],
    // Reçeteler: 1 porsiyon için malzeme miktarı
    recipes: [
      ['Adana Kebap', [['Kıyma', 0.18], ['Lavaş', 2]]],
      ['Urfa Kebap', [['Kıyma', 0.18], ['Lavaş', 2]]],
      ['Tavuk Şiş', [['Tavuk But', 0.2], ['Lavaş', 1]]],
      ['Izgara Köfte', [['Kıyma', 0.15], ['Lavaş', 1]]],
      ['Pilav', [['Pirinç', 0.1]]],
    ],
  },
  genel: {
    categories: [['Genel', '#3b82f6'], ['Hizmet', '#22c55e']],
    products: [
      ['Çeşitli Ürün', 'Genel', 'adet', 0, 0, 20, { track_stock: 0, favorite: 1 }],
      ['Hizmet Bedeli', 'Hizmet', 'adet', 0, 0, 20, { type: 'service', favorite: 1 }],
    ],
  },
};

const kurus = (tl) => Math.round(tl * 100);

export function seedPreset(db, type) {
  const preset = PRESETS[type] || PRESETS.genel;
  const catIds = {};
  const insCat = db.prepare('INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)');
  preset.categories.forEach(([name, color], i) => {
    catIds[name] = insCat.run(name, color, i).lastInsertRowid;
  });
  const insProd = db.prepare(`
    INSERT INTO products (name, category_id, unit, buy_price, sell_price, vat_rate, type, stock, min_stock,
      track_stock, duration_min, favorite)
    VALUES (@name, @category_id, @unit, @buy_price, @sell_price, @vat_rate, @type, @stock, @min_stock,
      @track_stock, @duration_min, @favorite)`);
  for (const [name, cat, unit, buy, sell, vat, extra] of preset.products) {
    const isService = extra.type === 'service';
    insProd.run({
      name, category_id: catIds[cat] ?? null, unit,
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
