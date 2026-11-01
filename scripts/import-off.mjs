#!/usr/bin/env node
// Open Food Facts'ten (ODbL lisanslı, açık veritabanı) Türkiye'de satılan ürünleri indirir.
//   server/data/tr-barcodes.json  →  { "8690000000000": "Marka Ürün Adı 500 g", ... }   (kasada bilinmeyen barkod araması)
//   server/data/tr-products.json  →  en çok okutulan ürünler, kategori eşlemesiyle   (hazır market kataloğu)
// Kullanım:  node scripts/import-off.mjs [sayfa sayısı, varsayılan 40]   (sayfa başına 100 ürün)
// GitHub'da: Actions → "Türkiye ürün kataloğu" (aylık da çalışır).
// Lisans: veriler Open Food Facts katkıcılarına aittir, ODbL ile lisanslıdır; dağıtımda atıf verilir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'server', 'data');
const pages = Number(process.argv[2] || 40);
const TOP = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Open Food Facts kategori etiketi → VelarisKasa market kategorisi (ilk eşleşen)
const CATEGORY_MAP = [
  [/en:(milks|yogurts|cheeses|butters|creams|ayran|dairy)/, 'Süt Ürünleri'],
  [/en:(honeys|jams|spreads|olives|eggs|breakfasts|sausages|hams|tahini|molasses)/, 'Kahvaltılık'],
  [/en:(waters|sodas|carbonated|juices|nectars|iced-teas|teas|coffees|beverages|energy-drinks)/, 'İçecek'],
  [/en:(chocolates|biscuits|cookies|crackers|chips|crisps|candies|confectioneries|snacks|nuts|wafers|cakes|chewing-gum|turkish-delight|halva)/, 'Atıştırmalık'],
  [/en:(frozen)/, 'Dondurulmuş'],
  [/en:(breads|bakery)/, 'Fırın'],
  [/en:(fruits|vegetables)/, 'Manav'],
  [/en:(baby)/, 'Bebek'],
  [/en:(pastas|rices|flours|sugars|salts|oils|legumes|pulses|bulgur|spices|condiments|sauces|canned|soups|cereals|tomato-pastes|groceries)/, 'Gıda'],
];
// Kategoriye göre yaklaşık satış fiyatı (TL, 2026); demo ve örnek kurulum içindir, işletme kendi fiyatını girer
const PRICE = { 'Süt Ürünleri': 75, Kahvaltılık: 120, İçecek: 35, Atıştırmalık: 30, Dondurulmuş: 120, Fırın: 30, Manav: 40, Bebek: 200, Gıda: 60 };
const VAT = { İçecek: 20, Atıştırmalık: 10, Bebek: 10 };

const barcodes = fs.existsSync(path.join(dir, 'tr-barcodes.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tr-barcodes.json'), 'utf8')) : {};
const ranked = [];
for (let page = 1; page <= pages; page++) {
  const url = 'https://world.openfoodfacts.org/api/v2/search?countries_tags_en=turkey'
    + '&fields=code,product_name,product_name_tr,brands,quantity,categories_tags,unique_scans_n'
    + `&page_size=100&page=${page}&sort_by=unique_scans_n`;
  let json;
  for (let attempt = 1; attempt <= 4 && !json; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'VelarisKasa/1.0 (velarisdijital@gmail.com)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      console.error(`Sayfa ${page}, deneme ${attempt}: ${e.message}`);
      await sleep(30000 * attempt);
    }
  }
  if (!json) break;
  const products = json.products || [];
  for (const p of products) {
    const code = String(p.code || '');
    if (!/^\d{8,14}$/.test(code)) continue;
    const brand = p.brands?.split(',')[0]?.trim();
    const title = (p.product_name_tr || p.product_name || '').trim();
    if (title.length < 2) continue;
    const name = [brand && !title.toLocaleLowerCase('tr').includes(brand.toLocaleLowerCase('tr')) ? brand : null, title, p.quantity]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    barcodes[code] = name;
    const tags = (p.categories_tags || []).join(' ');
    const cat = CATEGORY_MAP.find(([re]) => re.test(tags))?.[1];
    if (cat && ranked.length < TOP && !ranked.some((r) => r.code === code)) ranked.push({ code, name, category: cat });
  }
  process.stdout.write(`\rSayfa ${page}/${pages} · ${Object.keys(barcodes).length} barkod · ${ranked.length} katalog ürünü`);
  if (products.length < 100) break;
  await sleep(7000); // Open Food Facts kuralı: arama için dakikada en çok 10 istek
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'tr-barcodes.json'), JSON.stringify(barcodes));
// Aynı adlı ürünleri ayıkla; fiyat ve KDV kategoriden
const seen = new Set();
const catalog = ranked.filter((r) => !seen.has(r.name.toLocaleLowerCase('tr')) && seen.add(r.name.toLocaleLowerCase('tr')))
  .map((r) => ({ ...r, sell: PRICE[r.category], vat: VAT[r.category] ?? 1 }));
fs.writeFileSync(path.join(dir, 'tr-products.json'), `${JSON.stringify(catalog, null, 0).replace(/},{/g, '},\n{')}\n`);
console.log(`\n${Object.keys(barcodes).length} barkod, ${catalog.length} katalog ürünü → server/data/`);
