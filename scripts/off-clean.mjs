// Open Food Facts ham kayıtlarını kasaya uygun hâle getirir: Türkiye ürünü süzgeci, ad temizliği, kategori ve fiyat.
// scripts/import-off.mjs kullanır; ham veri server/data/off-raw.json'da tutulur, temizlik internetsiz yeniden çalıştırılabilir:
//   node scripts/import-off.mjs --clean

// Open Food Facts kategori etiketi → VelarisKasa market kategorisi (sıra önemli: ilk eşleşen)
const CATEGORY_MAP = [
  [/en:(tomato-pastes|pepper-pastes|ketchup|mayonnaises|sauces|condiments|pestos|vinegars)/, 'Gıda'],
  [/en:(plant-based-milk|milks|yogurts|cheeses|butters|creams|ayran|kefir|dairies|dairy)/, 'Süt Ürünleri'],
  [/en:(honeys|jams|spreads|olives|eggs|breakfast|sausages|sucuk|hams|tahini|molasses|cocoa-and-hazelnuts-spreads)/, 'Kahvaltılık'],
  [/en:(waters|sodas|carbonated|juices|nectars|iced-teas|teas|coffees|energy-drinks|beverages)/, 'İçecek'],
  [/en:(chocolates|biscuits|cookies|crackers|chips|crisps|candies|confectioneries|snacks|nuts|wafers|cakes|chewing-gum|turkish-delight|halva|crispbreads)/, 'Atıştırmalık'],
  [/en:(frozen)/, 'Dondurulmuş'],
  [/en:(breads|bakery|flatbreads)/, 'Fırın'],
  [/en:(baby)/, 'Bebek'],
  [/en:(pastas|rices|flours|sugars|salts|oils|legumes|pulses|bulgur|spices|canned|soups|cereals|noodles|groceries)/, 'Gıda'],
  [/en:(fresh-vegetables|fresh-fruits)/, 'Manav'],
];
// Kategoriye göre yaklaşık satış fiyatı (TL, 2026) — yalnızca örnek; işletme kendi fiyatını girer
export const PRICE = { 'Süt Ürünleri': 75, Kahvaltılık: 120, İçecek: 35, Atıştırmalık: 30, Dondurulmuş: 120, Fırın: 30, Manav: 40, Bebek: 200, Gıda: 60 };
export const VAT = { İçecek: 20, Atıştırmalık: 10, Bebek: 10 };

const CORP = /\b(a\.?\s?ş|ltd|şti|san|tic|s\.?a|n\.?v|gmbh|inc|llc|sp[oó]łka|z o\.o|services|sanayi|ticaret|ag|corp|company|holding|group|belux|polska)\b/i;
const FOREIGN = /[äßñąęłńśźżœæøåàèòùìãõ]/i;
const QTY_IN = /\d+([.,]\d+)?\s?(x\s?\d+([.,]\d+)?\s?)?(g|gr|kg|ml|cl|l|lt|litre|adet|'?l[iıuü])\b/i;

const lowerTr = (s) => s.toLocaleLowerCase('tr');
function titleCaseTr(s) {
  return lowerTr(s).replace(/(^|[\s(/-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('tr'));
}
function tidy(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 4 && letters === letters.toLocaleUpperCase('tr')) t = titleCaseTr(t);
  return t;
}
function cleanBrand(brands) {
  const b = tidy(String(brands || '').split(',')[0]);
  if (!b || b.length > 18 || CORP.test(b)) return null;
  return b;
}
function cleanQty(q) {
  const t = String(q || '').replace(/\s+/g, ' ').trim();
  return QTY_IN.test(t) && !/[-–]/.test(t) && t.length <= 15 ? t : null;
}
const latinOnly = (s) => /^[\p{Script=Latin}\d\s\p{P}\p{S}]+$/u.test(s) && !FOREIGN.test(s);

/** Türkiye'de satıldığı belli olan kayıt: Türkiye barkodu (869) ya da Türkçe adı var. */
export function isTurkish(r) {
  return String(r.code).startsWith('869') || !!String(r.product_name_tr || '').trim();
}

/** Kasada görünecek ad: "Marka Ürün Adı 500 g" */
export function productName(r) {
  const title = tidy(r.product_name_tr || r.product_name);
  if (title.length < 3 || !latinOnly(title)) return null;
  const brand = cleanBrand(r.brands);
  const qty = QTY_IN.test(title) ? null : cleanQty(r.quantity);
  const parts = [brand && !lowerTr(title).includes(lowerTr(brand)) ? brand : null, title, qty];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function category(r) {
  const tags = (r.categories_tags || []).join(' ');
  return CATEGORY_MAP.find(([re]) => re.test(tags))?.[1] || null;
}

/** Ham kayıtlar (okutulma sırasıyla) → { barcodes, products } */
export function clean(rawList, { top = 500 } = {}) {
  const barcodes = {};
  const products = [];
  const seen = new Set();
  for (const r of rawList) {
    const code = String(r.code || '');
    if (!/^\d{8,14}$/.test(code) || !isTurkish(r)) continue;
    const name = productName(r);
    if (!name) continue;
    barcodes[code] = name;
    const cat = category(r);
    const key = lowerTr(name);
    if (cat && products.length < top && !seen.has(key)) {
      seen.add(key);
      products.push({ code, name, category: cat, sell: PRICE[cat], vat: VAT[cat] ?? 1 });
    }
  }
  return { barcodes, products };
}
