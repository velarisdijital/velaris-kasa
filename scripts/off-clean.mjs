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
const ENTITIES = { '&quot;': '"', '&amp;': '&', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const decode = (s) => String(s || '').replace(/&(quot|amp|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m]).replace(/["“”]/g, '').replace(/\s+/g, ' ');
function tidy(s) {
  let t = decode(s).trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 4 && letters === letters.toLocaleUpperCase('tr')) t = titleCaseTr(t);
  return t;
}
function cleanBrand(brands) {
  let b = tidy(String(brands || '').split(',')[0]);
  if (b.length >= 2 && b === b.toLocaleUpperCase('tr')) b = titleCaseTr(b);
  if (b) b = b[0].toLocaleUpperCase('tr') + b.slice(1);
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

// Vitrin kataloğu Türkçe adlı ürünlerden oluşur (barkod aramasında tüm kayıtlar kullanılır)
const TR_WORDS = /\b(süt|sut|yoğurt|yogurt|ayran|kefir|peynir|kaşar|tereyağ|krema|su|maden|gazoz|soda|çay|cay|kahve|meyve|suyu|nektar|limonata|bisküvi|biskuvi|kraker|gofret|çikolata|cikolata|kek|cips|çubuk|lokum|helva|sakız|şeker|seker|makarna|spagetti|erişte|şehriye|pirinç|bulgur|un|tuz|salça|salca|ketçap|mayonez|sirke|zeytin|reçel|recel|bal|pekmez|tahin|krem|sucuk|salam|sosis|yumurta|ekmek|lavaş|simit|mercimek|fasulye|nohut|yağ|yag|dondurma|mantı|börek|pul|biber|baharat|kekik|nane|turşu|fındık|fıstık|ceviz|badem|leblebi|kuruyemiş|mısır)\b/i;
const FOREIGN_WORDS = /\b(with|and|the|flavou?r|getrocknet|grüne|mildes|ohne|mit|und|de|la|le|aux|goût|sans|confiture|chewing|wafers?|cookies?|cream|milk|chocolate|cake|oat|bar)\b/i;
export const turkishName = (s) => (/[çğıöşüÇĞİÖŞÜ]/.test(s) || TR_WORDS.test(s)) && !FOREIGN_WORDS.test(s);

// Gramaja göre yaklaşık fiyat (TL, 2026; kg ya da litre başına). Yalnızca örnek kurulum ve demo içindir.
// Anahtar kelime kelimenin başında aranır ("Çikolata" içindeki "kola" eşleşmesin)
const w = (alts) => new RegExp(`(?<![\\p{L}])(${alts})`, 'iu');
const PER_KG = [
  [w('kaşar|tulum|lor|labne|krem peynir|peynir'), 420], [w('tereyağ'), 650], [w('yoğurt|yogurt|ayran|kefir'), 85], [w('süt|sut'), 48],
  [w('bal(?![\\p{L}])'), 550], [w('zeytin'), 260], [w('reçel|marmelat'), 210], [w('tahin|pekmez'), 280], [w('fındık kreması|kakaolu fındık'), 380],
  [w('sucuk|salam|sosis|pastırma'), 600], [w('çikolata|cikolata'), 650], [w('bisküvi|biskuvi|kraker|gofret|kurabiye|kek(?![\\p{L}])'), 280],
  [w('cips|çubuk'), 380], [w('lokum|helva'), 300], [w('fıstık|fındık|badem|ceviz|leblebi'), 600],
  [w('maden suyu|soda'), 70], [w('su(?![\\p{L}])|kaynak suyu'), 18], [w('meyve suyu|nektar|meyveli'), 60], [w('kola(?![\\p{L}])|gazoz|gazlı'), 45],
  [w('çay(?![\\p{L}])|cay(?![\\p{L}])'), 380], [w('kahve'), 900],
  [w('makarna|spagetti|erişte|şehriye'), 58], [w('bulgur|pirinç|mercimek|fasulye|nohut'), 75], [w('salça|salca'), 110],
  [w('ketçap|mayonez|hardal'), 150], [w('yağ(?![\\p{L}])|yag(?![\\p{L}])|ayçiçek'), 120], [w('un(?![\\p{L}])'), 35],
];
const DEFAULT_PER_KG = { 'Süt Ürünleri': 120, Kahvaltılık: 300, İçecek: 45, Atıştırmalık: 350, Gıda: 90, Fırın: 80, Dondurulmuş: 180, Manav: 50, Bebek: 600 };
export function estimatePrice(name, cat) {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s?(?:x\s?(\d+(?:[.,]\d+)?)\s?)?(kg|g|gr|l|lt|ml|cl)\b/i);
  if (!m) return PRICE[cat];
  const n = (s) => Number(String(s).replace(',', '.'));
  let qty = m[2] ? n(m[1]) * n(m[2]) : n(m[1]);
  const unit = m[3].toLowerCase();
  qty = unit === 'kg' || unit === 'l' || unit === 'lt' ? qty : unit === 'cl' ? qty / 100 : qty / 1000;
  if (!(qty > 0) || qty > 20) return PRICE[cat];
  const perKg = PER_KG.find(([re]) => re.test(name))?.[1] ?? DEFAULT_PER_KG[cat] ?? 150;
  return Math.max(5, Math.round(perKg * qty)) - 0.1; // 34,90 gibi
}
const CAP = { Atıştırmalık: 140, İçecek: 110, 'Süt Ürünleri': 90, Kahvaltılık: 70, Gıda: 90, Fırın: 30, Dondurulmuş: 30, Manav: 20, Bebek: 20 };

/** Ham kayıtlar (okutulma sırasıyla) → { barcodes, products } */
export function clean(rawList, { top = 500 } = {}) {
  const barcodes = {};
  const products = [];
  const seen = new Set();
  const perCat = {};
  for (const r of rawList) {
    const code = String(r.code || '');
    if (!/^\d{8,14}$/.test(code) || !isTurkish(r)) continue;
    const name = productName(r);
    if (!name) continue;
    barcodes[code] = name;
    const cat = category(r);
    const key = lowerTr(name);
    if (cat && products.length < top && !seen.has(key) && turkishName(name) && (perCat[cat] || 0) < (CAP[cat] ?? 50)) {
      seen.add(key);
      perCat[cat] = (perCat[cat] || 0) + 1;
      products.push({ code, name, category: cat, sell: estimatePrice(name, cat), vat: VAT[cat] ?? 1 });
    }
  }
  return { barcodes, products };
}
