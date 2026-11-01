#!/usr/bin/env node
// Open Food Facts'ten (ODbL lisanslı, açık veritabanı) Türkiye'de satılan ürünlerin barkod + ad listesini indirir.
// Çıktı: server/data/tr-barcodes.json  →  { "8690000000000": "Marka Ürün Adı 500 g", ... }
// Kasada bulunamayan barkod önce bu listede (internetsiz), sonra Open Food Facts'te aranır.
//
// Kullanım:  node scripts/import-off.mjs [sayfa sayısı, varsayılan 60]   (sayfa başına 200 ürün)
// Lisans: Open Food Facts verisi ODbL ile lisanslıdır; dağıtırken atıf verin ("Open Food Facts katkıcıları").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'server', 'data', 'tr-barcodes.json');
const pages = Number(process.argv[2] || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
const before = Object.keys(list).length;
for (let page = 1; page <= pages; page++) {
  const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=turkey&fields=code,product_name,product_name_tr,brands,quantity&page_size=200&page=${page}&sort_by=unique_scans_n`;
  let json;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'VelarisKasa/1.0 (velarisdijital@gmail.com)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error(`Sayfa ${page} alınamadı: ${e.message}`);
    break;
  }
  const products = json.products || [];
  for (const p of products) {
    const code = String(p.code || '');
    if (!/^\d{8,14}$/.test(code)) continue;
    const name = [p.brands?.split(',')[0]?.trim(), p.product_name_tr || p.product_name, p.quantity].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (name.length >= 3) list[code] = name.slice(0, 120);
  }
  process.stdout.write(`\rSayfa ${page}/${pages} · ${Object.keys(list).length} ürün`);
  if (products.length < 200) break;
  await sleep(1200); // Open Food Facts kullanım kuralları: dakikada en fazla ~10 arama
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list));
console.log(`\n${Object.keys(list).length - before} yeni, toplam ${Object.keys(list).length} barkod → ${path.relative(root, out)}`);
