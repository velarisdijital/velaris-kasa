#!/usr/bin/env node
// Open Food Facts'ten (ODbL lisanslı, açık veritabanı) Türkiye'de satılan ürünleri indirir ve temizler.
//   server/data/off-raw.json      ham kayıtlar (her çalıştırmada birikir; Open Food Facts kullanım sınırını aşmamak için)
//   server/data/tr-barcodes.json  { "8690000000000": "Marka Ürün Adı 500 g" }   kasada bilinmeyen barkod araması
//   server/data/tr-products.json  en çok okutulan ürünler, kategori ve örnek fiyatla   hazır market kataloğu
// Kullanım:  node scripts/import-off.mjs --dump   (toplu veri dosyası, önerilen)
//            node scripts/import-off.mjs [sayfa sayısı]   (arama servisi)   ·   --clean (indirmeden yeniden temizle)
// GitHub'da: Actions → "Türkiye ürün kataloğu" (aylık da çalışır).
// Lisans: veriler © Open Food Facts katkıcıları, ODbL; dağıtımda atıf verilir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean } from './off-clean.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'server', 'data');
const rawFile = path.join(dir, 'off-raw.json');
const onlyClean = process.argv.includes('--clean');
const pages = Number(process.argv.find((a) => /^\d+$/.test(a)) || 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ['code', 'product_name', 'product_name_tr', 'brands', 'quantity', 'categories_tags', 'unique_scans_n'];

const raw = new Map((fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile, 'utf8')) : []).map((r) => [r.code, r]));
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;

/**
 * Toplu veri dosyası (Open Food Facts'in önerdiği yol): günlük CSV dökümü akış hâlinde okunur,
 * yalnızca Türkiye'de satılan ürünler alınır. ~1 GB indirme; arama servisinin hız sınırına takılmaz.
 */
async function importDump() {
  const { createGunzip } = await import('node:zlib');
  const { Readable } = await import('node:stream');
  const readline = await import('node:readline');
  const url = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
  const res = await fetch(url, { headers: { 'User-Agent': 'VelarisKasa/1.0 (velarisdijital@gmail.com)' } });
  if (!res.ok) throw new Error(`Döküm indirilemedi: HTTP ${res.status}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  let idx = null;
  let n = 0;
  for await (const line of rl) {
    const cols = line.split('\t');
    if (!idx) { idx = Object.fromEntries(cols.map((c, i) => [c, i])); continue; }
    if (++n % 500000 === 0) process.stdout.write(`\r${n} satır · ${raw.size} Türkiye kaydı`);
    const code = cols[idx.code];
    const countries = cols[idx.countries_tags] || '';
    if (!code || !(countries.includes('en:turkey') || code.startsWith('869'))) continue;
    const name = cols[idx.product_name] || '';
    raw.set(code, {
      code, product_name: name, product_name_tr: TR_LETTERS.test(name) ? name : null, brands: cols[idx.brands] || null,
      quantity: cols[idx.quantity] || null, categories_tags: (cols[idx.categories_tags] || '').split(',').filter(Boolean).slice(0, 12),
      unique_scans_n: Number(cols[idx.unique_scans_n]) || 0,
    });
  }
  console.log(`\n${n} satır okundu, ${raw.size} Türkiye kaydı`);
}

if (process.argv.includes('--dump')) await importDump();
else if (!onlyClean) {
  for (let page = 1; page <= pages; page++) {
    const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=turkey&fields=${FIELDS.join(',')}`
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
      if (!p.code) continue;
      raw.set(String(p.code), {
        ...Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? null])),
        code: String(p.code),
        categories_tags: (p.categories_tags || []).slice(0, 12),
      });
    }
    process.stdout.write(`\rSayfa ${page}/${pages} · ${raw.size} ham kayıt`);
    if (products.length < 100) break;
    await sleep(12000); // Open Food Facts kuralı: arama için dakikada en çok 10 istek
  }
}
if (!raw.size) { console.error('Ham kayıt yok; önce indirme yapın (node scripts/import-off.mjs).'); process.exit(1); }
const list = [...raw.values()].sort((a, b) => (b.unique_scans_n || 0) - (a.unique_scans_n || 0));
const { barcodes, products } = clean(list);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(rawFile, JSON.stringify(list));
fs.writeFileSync(path.join(dir, 'tr-barcodes.json'), JSON.stringify(barcodes));
fs.writeFileSync(path.join(dir, 'tr-products.json'), `[\n${products.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`);
console.log(`\n${raw.size} ham kayıt → ${Object.keys(barcodes).length} Türkiye barkodu, ${products.length} katalog ürünü (server/data/)`);
