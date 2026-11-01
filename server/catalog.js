// Türkiye için hazır ürün kataloğu (kurulumdaki "örnek ürünleri ekle" ve demo).
// Ürün adları markasızdır; fiyatlar 2026 sonu için yaklaşık TL (KDV dahil) değerlerdir, kurulumdan sonra düzenlenir.
// Barkodlar: paketli ürünlerde mağaza içi EAN-13 ("20" ile başlar, gerçek ürün barkodlarıyla çakışmaz),
// tartılı ürünlerde terazi PLU kodu. Gerçek barkodlar için: scripts/import-off.mjs (Open Food Facts, ODbL).
//
// Satır biçimi:  Kategori | Ad | birim | alış | satış | KDV | seçenekler
// Seçenekler (virgülle): st=40 (açılış stoğu), min=10 (kritik stok), fav (hızlı tuş), nostock (stok takibi yok),
//                        svc=30 (hizmet, dakika), desc=… (QR menü açıklaması)

import OFF_PRODUCTS from './data/tr-products.json' with { type: 'json' };

function ean13(base12) {
  const sum = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}

function parse(text, { barcodes = false, start = 1 } = {}) {
  let seq = start;
  let plu = 10001;
  return text.trim().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    const [cat, name, unit, buy, sell, vat, opts = ''] = line.split('|').map((x) => x.trim());
    const extra = {};
    for (const o of opts.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = o.split('=');
      if (k === 'st') extra.stock = Number(v);
      else if (k === 'min') extra.min_stock = Number(v);
      else if (k === 'fav') extra.favorite = 1;
      else if (k === 'nostock') extra.track_stock = 0;
      else if (k === 'svc') { extra.type = 'service'; extra.duration_min = Number(v); }
      else if (k === 'desc') extra.menu_description = v;
    }
    if (barcodes && extra.type !== 'service') {
      extra.barcode = unit === 'kg' ? String(plu++).padStart(5, '0') : ean13(`20${String(seq++).padStart(10, '0')}`);
    }
    return [name, cat, unit, Number(buy), Number(sell), Number(vat), extra];
  });
}

const cats = (rows, colors) => [...new Set(rows.map((r) => r[1]))].map((c, i) => [c, colors[c] || ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b'][i % 7]]);

// ---------------------------------------------------------------- Market / Bakkal
const MARKET = parse(`
Fırın | Ekmek | adet | 8 | 12 | 1 | nostock, fav
Fırın | Tam Buğday Ekmeği | adet | 14 | 22 | 1 | st=15, min=5
Fırın | Simit | adet | 8 | 15 | 1 | nostock, fav
Fırın | Poğaça | adet | 9 | 17 | 1 | nostock
Fırın | Lavaş 10'lu | paket | 25 | 40 | 1 | st=20, min=5
Fırın | Bazlama 4'lü | paket | 30 | 48 | 1 | st=12, min=4
Süt Ürünleri | Süt 1 L | adet | 32 | 45 | 1 | st=36, min=12, fav
Süt Ürünleri | Süt 500 ml | adet | 18 | 26 | 1 | st=24, min=8
Süt Ürünleri | Laktozsuz Süt 1 L | adet | 42 | 58 | 1 | st=12, min=4
Süt Ürünleri | Ayran 250 ml | adet | 10 | 16 | 1 | st=48, min=12
Süt Ürünleri | Ayran 1 L | adet | 28 | 42 | 1 | st=12, min=4
Süt Ürünleri | Yoğurt 1 kg | adet | 55 | 78 | 1 | st=20, min=6
Süt Ürünleri | Süzme Yoğurt 500 g | adet | 52 | 75 | 1 | st=10, min=3
Süt Ürünleri | Beyaz Peynir 500 g | adet | 130 | 185 | 1 | st=15, min=5
Süt Ürünleri | Kaşar Peyniri 400 g | adet | 160 | 225 | 1 | st=12, min=4
Süt Ürünleri | Tulum Peyniri | kg | 380 | 520 | 1 | st=6, min=2
Süt Ürünleri | Lor Peyniri 500 g | adet | 45 | 68 | 1 | st=8, min=3
Süt Ürünleri | Labne 200 g | adet | 42 | 62 | 1 | st=10, min=3
Süt Ürünleri | Tereyağı 250 g | adet | 120 | 165 | 1 | st=12, min=4
Süt Ürünleri | Krema 200 ml | adet | 32 | 48 | 1 | st=10, min=3
Kahvaltılık | Yumurta 10'lu | paket | 62 | 85 | 1 | st=20, min=6, fav
Kahvaltılık | Yumurta 30'lu | paket | 175 | 235 | 1 | st=8, min=3
Kahvaltılık | Siyah Zeytin 500 g | adet | 95 | 135 | 1 | st=10, min=3
Kahvaltılık | Yeşil Zeytin 500 g | adet | 90 | 128 | 1 | st=10, min=3
Kahvaltılık | Bal 450 g | adet | 190 | 265 | 1 | st=8, min=2
Kahvaltılık | Kaymak 200 g | adet | 75 | 105 | 1 | st=6, min=2
Kahvaltılık | Tahin 300 g | adet | 70 | 98 | 1 | st=8, min=2
Kahvaltılık | Pekmez 700 g | adet | 85 | 120 | 1 | st=6, min=2
Kahvaltılık | Vişne Reçeli 380 g | adet | 55 | 79 | 1 | st=8, min=2
Kahvaltılık | Fındık Kreması 400 g | adet | 95 | 135 | 1 | st=8, min=2
Kahvaltılık | Sucuk 250 g | adet | 120 | 165 | 1 | st=12, min=4
Kahvaltılık | Pastırma 100 g | adet | 145 | 199 | 1 | st=6, min=2
Kahvaltılık | Salam 200 g | adet | 55 | 78 | 1 | st=10, min=3
Gıda | Ayçiçek Yağı 2 L | adet | 165 | 215 | 1 | st=12, min=4
Gıda | Zeytinyağı 1 L | adet | 330 | 450 | 1 | st=8, min=3
Gıda | Un 2 kg | paket | 52 | 72 | 1 | st=15, min=5
Gıda | Toz Şeker 1 kg | paket | 38 | 52 | 1 | st=20, min=6
Gıda | Küp Şeker 750 g | paket | 42 | 58 | 1 | st=10, min=3
Gıda | Tuz 750 g | paket | 12 | 18 | 1 | st=15, min=5
Gıda | Pirinç 1 kg | paket | 62 | 85 | 1 | st=15, min=5
Gıda | Baldo Pirinç 2 kg | paket | 130 | 175 | 1 | st=8, min=3
Gıda | Pilavlık Bulgur 1 kg | paket | 35 | 49 | 1 | st=15, min=5
Gıda | Köftelik Bulgur 1 kg | paket | 35 | 49 | 1 | st=10, min=3
Gıda | Spagetti 500 g | paket | 18 | 26 | 1 | st=30, min=10
Gıda | Burgu Makarna 500 g | paket | 18 | 26 | 1 | st=24, min=8
Gıda | Erişte 500 g | paket | 40 | 58 | 1 | st=10, min=3
Gıda | Şehriye 500 g | paket | 18 | 26 | 1 | st=12, min=4
Gıda | Domates Salçası 830 g | adet | 58 | 82 | 1 | st=15, min=5
Gıda | Biber Salçası 650 g | adet | 65 | 92 | 1 | st=10, min=3
Gıda | Tarhana 500 g | paket | 55 | 78 | 1 | st=8, min=2
Gıda | Mercimek Çorbası Paket | adet | 18 | 27 | 1 | st=20, min=6
Gıda | Ton Balığı 3'lü | paket | 95 | 135 | 1 | st=10, min=3
Gıda | Mısır Konservesi 400 g | adet | 30 | 44 | 1 | st=10, min=3
Gıda | Kırmızı Mercimek 1 kg | paket | 52 | 72 | 1 | st=12, min=4
Gıda | Yeşil Mercimek 1 kg | paket | 62 | 85 | 1 | st=8, min=3
Gıda | Kuru Fasulye 1 kg | paket | 75 | 105 | 1 | st=10, min=3
Gıda | Nohut 1 kg | paket | 58 | 82 | 1 | st=10, min=3
Gıda | Pul Biber 100 g | adet | 28 | 40 | 1 | st=12, min=4
Gıda | Karabiber 50 g | adet | 30 | 44 | 1 | st=10, min=3
Gıda | Kekik 50 g | adet | 18 | 27 | 1 | st=10, min=3
Gıda | Kimyon 50 g | adet | 22 | 32 | 1 | st=8, min=3
Gıda | Nane 50 g | adet | 16 | 24 | 1 | st=8, min=3
Gıda | Sirke 1 L | adet | 22 | 32 | 1 | st=8, min=3
Gıda | Ketçap 400 g | adet | 38 | 55 | 1 | st=10, min=3
Gıda | Mayonez 400 g | adet | 48 | 69 | 1 | st=10, min=3
Gıda | Kabartma Tozu 5'li | paket | 12 | 18 | 1 | st=10, min=3
Gıda | Vanilya 5'li | paket | 10 | 15 | 1 | st=10, min=3
Gıda | Hazır Kek Karışımı | paket | 38 | 55 | 1 | st=8, min=2
Gıda | İrmik Helvası Karışımı | paket | 35 | 49 | 1 | st=6, min=2
Gıda | Sütlaç Karışımı | paket | 22 | 32 | 1 | st=8, min=2
Atıştırmalık | Çikolatalı Bisküvi | adet | 12 | 18 | 10 | st=40, min=12, fav
Atıştırmalık | Kremalı Bisküvi | adet | 10 | 15 | 10 | st=40, min=12
Atıştırmalık | Petibör Bisküvi | adet | 12 | 18 | 10 | st=24, min=8
Atıştırmalık | Kraker | adet | 12 | 18 | 10 | st=30, min=10
Atıştırmalık | Tuzlu Çubuk Kraker | adet | 10 | 15 | 10 | st=30, min=10
Atıştırmalık | Sütlü Çikolata 80 g | adet | 32 | 45 | 10 | st=30, min=10, fav
Atıştırmalık | Bitter Çikolata 80 g | adet | 35 | 49 | 10 | st=20, min=6
Atıştırmalık | Fındıklı Çikolata 80 g | adet | 38 | 55 | 10 | st=20, min=6
Atıştırmalık | Çikolatalı Kek | adet | 9 | 14 | 10 | st=40, min=12
Atıştırmalık | Patates Cipsi Büyük | adet | 38 | 55 | 10 | st=24, min=8
Atıştırmalık | Mısır Cipsi | adet | 32 | 45 | 10 | st=24, min=8
Atıştırmalık | Kavrulmuş Fıstık 150 g | adet | 45 | 65 | 10 | st=15, min=5
Atıştırmalık | Ay Çekirdeği 150 g | adet | 25 | 36 | 10 | st=20, min=6
Atıştırmalık | Leblebi 200 g | adet | 30 | 44 | 10 | st=12, min=4
Atıştırmalık | Antep Fıstığı 150 g | adet | 145 | 199 | 10 | st=8, min=3
Atıştırmalık | Sakız | adet | 8 | 12 | 10 | st=60, min=20
Atıştırmalık | Lokum 250 g | adet | 55 | 79 | 10 | st=10, min=3
Atıştırmalık | Helva 400 g | adet | 65 | 92 | 10 | st=8, min=3
Atıştırmalık | Gofret | adet | 7 | 10 | 10 | st=60, min=20
Atıştırmalık | Dondurma Külah | adet | 18 | 28 | 10 | st=30, min=10
İçecek | Su 0.5 L | adet | 4 | 8 | 1 | st=120, min=24, fav
İçecek | Su 1.5 L | adet | 9 | 15 | 1 | st=48, min=12
İçecek | Damacana Su 19 L | adet | 75 | 110 | 1 | st=10, min=3
İçecek | Maden Suyu 200 ml | adet | 7 | 12 | 1 | st=48, min=12, fav
İçecek | Kola 1 L | adet | 32 | 48 | 20 | st=36, min=6
İçecek | Kola 330 ml | adet | 22 | 32 | 20 | st=48, min=12
İçecek | Gazoz 1 L | adet | 22 | 34 | 20 | st=24, min=6
İçecek | Portakallı Gazoz 1 L | adet | 24 | 36 | 20 | st=12, min=4
İçecek | Soğuk Çay 330 ml | adet | 22 | 32 | 20 | st=24, min=8
İçecek | Meyve Suyu 1 L | adet | 38 | 55 | 10 | st=18, min=6
İçecek | Şalgam Suyu 1 L | adet | 30 | 44 | 1 | st=12, min=4
İçecek | Enerji İçeceği | adet | 35 | 50 | 20 | st=24, min=8
İçecek | Siyah Çay 1 kg | paket | 290 | 390 | 1 | st=12, min=4, fav
İçecek | Türk Kahvesi 100 g | paket | 55 | 79 | 1 | st=15, min=5
İçecek | Hazır Kahve 3'ü 1 Arada 10'lu | paket | 55 | 79 | 10 | st=15, min=5
İçecek | Ihlamur 50 g | adet | 40 | 58 | 1 | st=8, min=2
Dondurulmuş | Dondurulmuş Mantı 1 kg | paket | 120 | 165 | 1 | st=8, min=3
Dondurulmuş | Dondurulmuş Patates 1 kg | paket | 65 | 92 | 1 | st=8, min=3
Dondurulmuş | Dondurulmuş Bezelye 450 g | paket | 40 | 58 | 1 | st=6, min=2
Dondurulmuş | Su Böreği | paket | 110 | 155 | 1 | st=5, min=2
Dondurulmuş | Tavuk Göğüs 1 kg | paket | 175 | 235 | 1 | st=8, min=3
Dondurulmuş | Dana Kıyma 500 g | paket | 280 | 380 | 1 | st=6, min=2
Manav | Domates | kg | 22 | 35 | 1 | st=25, min=5, fav
Manav | Salatalık | kg | 18 | 29 | 1 | st=20, min=5
Manav | Sivri Biber | kg | 30 | 49 | 1 | st=10, min=3
Manav | Patates | kg | 15 | 24 | 1 | st=40, min=10, fav
Manav | Kuru Soğan | kg | 12 | 19 | 1 | st=40, min=10
Manav | Sarımsak | kg | 120 | 175 | 1 | st=5, min=1
Manav | Limon | kg | 30 | 45 | 1 | st=15, min=4
Manav | Elma | kg | 28 | 42 | 1 | st=25, min=5
Manav | Portakal | kg | 22 | 35 | 1 | st=25, min=5
Manav | Mandalina | kg | 25 | 39 | 1 | st=20, min=5
Manav | Muz | kg | 55 | 79 | 1 | st=15, min=4
Manav | Maydanoz | adet | 6 | 10 | 1 | st=20, min=5
Manav | Marul | adet | 18 | 28 | 1 | st=12, min=4
Temizlik | Bulaşık Deterjanı 750 ml | adet | 48 | 70 | 20 | st=12, min=4
Temizlik | Bulaşık Makinesi Tableti 40'lı | paket | 210 | 290 | 20 | st=8, min=3
Temizlik | Toz Çamaşır Deterjanı 4 kg | paket | 230 | 320 | 20 | st=8, min=3
Temizlik | Sıvı Çamaşır Deterjanı 2 L | adet | 165 | 230 | 20 | st=8, min=3
Temizlik | Yumuşatıcı 1.5 L | adet | 75 | 105 | 20 | st=10, min=3
Temizlik | Çamaşır Suyu 1 L | adet | 32 | 45 | 20 | st=15, min=5
Temizlik | Yüzey Temizleyici 1 L | adet | 55 | 79 | 20 | st=10, min=3
Temizlik | Cam Temizleyici 500 ml | adet | 45 | 65 | 20 | st=8, min=3
Temizlik | Bulaşık Süngeri 3'lü | paket | 18 | 27 | 20 | st=20, min=6
Temizlik | Çöp Torbası Büyük 10'lu | paket | 30 | 44 | 20 | st=20, min=6
Kağıt & Ev | Tuvalet Kağıdı 12'li | paket | 140 | 195 | 20 | st=12, min=4
Kağıt & Ev | Kağıt Havlu 6'lı | paket | 95 | 135 | 20 | st=10, min=3
Kağıt & Ev | Peçete 100'lü | paket | 18 | 27 | 20 | st=20, min=6
Kağıt & Ev | Islak Mendil 90'lı | paket | 30 | 44 | 20 | st=20, min=6
Kağıt & Ev | Alüminyum Folyo | adet | 40 | 58 | 20 | st=8, min=3
Kağıt & Ev | Streç Film | adet | 35 | 49 | 20 | st=8, min=3
Kağıt & Ev | Kibrit | paket | 8 | 12 | 20 | st=20, min=5
Kağıt & Ev | Çakmak | adet | 10 | 15 | 20 | st=50, min=10
Kağıt & Ev | Kalem Pil 4'lü | paket | 55 | 79 | 20 | st=12, min=4
Kişisel Bakım | Şampuan 500 ml | adet | 95 | 135 | 20 | st=10, min=3
Kişisel Bakım | Sıvı Sabun 1.5 L | adet | 65 | 92 | 20 | st=8, min=3
Kişisel Bakım | Kalıp Sabun 4'lü | paket | 45 | 65 | 20 | st=10, min=3
Kişisel Bakım | Diş Macunu | adet | 55 | 79 | 20 | st=12, min=4
Kişisel Bakım | Diş Fırçası | adet | 35 | 49 | 20 | st=12, min=4
Kişisel Bakım | Deodorant | adet | 85 | 120 | 20 | st=8, min=3
Kişisel Bakım | Tıraş Bıçağı 5'li | paket | 65 | 92 | 20 | st=8, min=3
Kişisel Bakım | Kolonya 400 ml | adet | 75 | 105 | 20 | st=8, min=3
Kişisel Bakım | Hijyenik Ped | paket | 55 | 79 | 20 | st=10, min=3
Bebek | Bebek Bezi 4 Numara | paket | 330 | 450 | 10 | st=6, min=2
Bebek | Bebek Islak Mendil 3'lü | paket | 85 | 120 | 10 | st=8, min=3
Bebek | Bebek Maması | adet | 190 | 265 | 1 | st=6, min=2
Evcil Hayvan | Kedi Maması 1.5 kg | paket | 230 | 320 | 20 | st=5, min=2
Evcil Hayvan | Köpek Maması 3 kg | paket | 360 | 490 | 20 | st=4, min=1
Gıda | Poşet | adet | 0.15 | 0.25 | 20 | nostock, fav
`, { barcodes: true });

// ---------------------------------------------------------------- Restoran / Lokanta
const RESTORAN = parse(`
Çorbalar | Mercimek Çorbası | adet | 18 | 90 | 10 | nostock, fav, desc=Limon ve kıtır ekmekle
Çorbalar | Ezogelin Çorbası | adet | 18 | 90 | 10 | nostock
Çorbalar | Yayla Çorbası | adet | 20 | 95 | 10 | nostock
Çorbalar | İşkembe Çorbası | adet | 45 | 160 | 10 | nostock, desc=Sarımsaklı sirke ile
Çorbalar | Kelle Paça Çorbası | adet | 55 | 180 | 10 | nostock
Salata & Meze | Çoban Salata | adet | 25 | 110 | 10 | nostock
Salata & Meze | Gavurdağı Salata | adet | 35 | 140 | 10 | nostock, desc=Cevizli, nar ekşili
Salata & Meze | Humus | adet | 30 | 120 | 10 | nostock
Salata & Meze | Haydari | adet | 25 | 100 | 10 | nostock
Salata & Meze | Acılı Ezme | adet | 20 | 90 | 10 | nostock
Salata & Meze | Patlıcan Salatası | adet | 30 | 115 | 10 | nostock
Salata & Meze | Cacık | adet | 15 | 70 | 10 | nostock
Izgaralar | Adana Kebap | adet | 0 | 380 | 10 | fav, desc=Zırh kıyması, közlenmiş biber ve domatesle
Izgaralar | Urfa Kebap | adet | 0 | 380 | 10 | desc=Acısız, közlenmiş sebzeyle
Izgaralar | Tavuk Şiş | adet | 0 | 300 | 10 | fav, desc=Marine tavuk but, bulgur pilavıyla
Izgaralar | Izgara Köfte | adet | 0 | 320 | 10 | fav, desc=Piyaz ve közlenmiş biberle
Izgaralar | Kuzu Şiş | adet | 0 | 460 | 10 | desc=Kuzu but, sumaklı soğanla
Izgaralar | Beyti Sarma | adet | 0 | 420 | 10 | desc=Yoğurt ve tereyağı soslu
Izgaralar | Tavuk Kanat | adet | 0 | 280 | 10 |
Izgaralar | Karışık Izgara | adet | 0 | 650 | 10 | desc=İki kişilik: Adana, tavuk şiş, köfte, kanat
Pide & Lahmacun | Lahmacun | adet | 0 | 90 | 10 | fav
Pide & Lahmacun | Kıymalı Pide | adet | 0 | 220 | 10 |
Pide & Lahmacun | Kaşarlı Pide | adet | 45 | 190 | 10 | nostock
Pide & Lahmacun | Kuşbaşılı Pide | adet | 90 | 280 | 10 | nostock
Pide & Lahmacun | Karışık Pide | adet | 80 | 260 | 10 | nostock
Dürümler | Adana Dürüm | adet | 0 | 260 | 10 | fav
Dürümler | Tavuk Dürüm | adet | 0 | 210 | 10 |
Dürümler | Köfte Dürüm | adet | 0 | 230 | 10 |
Ana Yemekler | Kuru Fasulye | adet | 45 | 180 | 10 | nostock
Ana Yemekler | Pilav | adet | 0 | 80 | 10 | fav
Ana Yemekler | Bulgur Pilavı | adet | 12 | 70 | 10 | nostock
Ana Yemekler | Etli Nohut | adet | 55 | 200 | 10 | nostock
Ana Yemekler | Karnıyarık | adet | 60 | 210 | 10 | nostock
Ana Yemekler | İskender | adet | 140 | 420 | 10 | nostock, desc=Döner, pide, domates sosu, tereyağı ve yoğurt
Ana Yemekler | Mantı | adet | 50 | 220 | 10 | nostock
Tatlılar | Künefe | adet | 70 | 220 | 10 | st=20, min=5, fav, desc=Hatay usulü, sıcak servis
Tatlılar | Sütlaç | adet | 30 | 120 | 10 | st=15, min=4
Tatlılar | Fıstıklı Baklava (4 dilim) | adet | 110 | 280 | 10 | st=12, min=4
Tatlılar | Kazandibi | adet | 32 | 125 | 10 | st=10, min=3
Tatlılar | Kabak Tatlısı | adet | 35 | 130 | 10 | st=8, min=3
İçecekler | Ayran | adet | 12 | 40 | 10 | st=60, min=12, fav
İçecekler | Köpüklü Ayran | adet | 15 | 55 | 10 | nostock
İçecekler | Kola 330 ml | adet | 25 | 60 | 20 | st=48, min=12
İçecekler | Gazoz | adet | 20 | 50 | 20 | st=36, min=12
İçecekler | Şalgam | adet | 12 | 45 | 10 | st=24, min=8
İçecekler | Su 500 ml | adet | 5 | 20 | 10 | st=80, min=24
İçecekler | Maden Suyu | adet | 8 | 30 | 10 | st=48, min=12
İçecekler | Çay | adet | 2 | 25 | 10 | nostock, fav
İçecekler | Türk Kahvesi | adet | 12 | 70 | 10 | nostock
Malzeme | Kıyma | kg | 650 | 0 | 1 | st=12, min=3
Malzeme | Kuzu But | kg | 820 | 0 | 1 | st=6, min=2
Malzeme | Tavuk But | kg | 280 | 0 | 1 | st=10, min=3
Malzeme | Çiğ Tavuk Kanat | kg | 210 | 0 | 1 | st=8, min=2
Malzeme | Lavaş | adet | 5 | 0 | 1 | st=200, min=40
Malzeme | Pide Hamuru | adet | 8 | 0 | 1 | st=80, min=20
Malzeme | Pirinç | kg | 70 | 0 | 1 | st=15, min=4
`);
const RESTORAN_RECIPES = [
  ['Adana Kebap', [['Kıyma', 0.18], ['Lavaş', 2]]],
  ['Urfa Kebap', [['Kıyma', 0.18], ['Lavaş', 2]]],
  ['Beyti Sarma', [['Kıyma', 0.2], ['Lavaş', 1]]],
  ['Tavuk Şiş', [['Tavuk But', 0.2], ['Lavaş', 1]]],
  ['Izgara Köfte', [['Kıyma', 0.15], ['Lavaş', 1]]],
  ['Kuzu Şiş', [['Kuzu But', 0.2], ['Lavaş', 1]]],
  ['Tavuk Kanat', [['Çiğ Tavuk Kanat', 0.35]]],
  ['Karışık Izgara', [['Kıyma', 0.25], ['Tavuk But', 0.15], ['Çiğ Tavuk Kanat', 0.15], ['Lavaş', 3]]],
  ['Lahmacun', [['Kıyma', 0.04], ['Pide Hamuru', 1]]],
  ['Kıymalı Pide', [['Kıyma', 0.1], ['Pide Hamuru', 1]]],
  ['Adana Dürüm', [['Kıyma', 0.15], ['Lavaş', 1]]],
  ['Tavuk Dürüm', [['Tavuk But', 0.15], ['Lavaş', 1]]],
  ['Köfte Dürüm', [['Kıyma', 0.12], ['Lavaş', 1]]],
  ['Pilav', [['Pirinç', 0.1]]],
];

// ---------------------------------------------------------------- Kafe / Büfe
const KAFE = parse(`
Sıcak İçecek | Çay | adet | 2 | 15 | 10 | nostock, fav
Sıcak İçecek | Fincan Çay | adet | 3 | 25 | 10 | nostock
Sıcak İçecek | Türk Kahvesi | adet | 10 | 60 | 10 | nostock, fav, desc=Közde, lokum ile
Sıcak İçecek | Filtre Kahve | adet | 15 | 80 | 10 | nostock, fav, desc=Günün çekirdeği
Sıcak İçecek | Espresso | adet | 12 | 65 | 10 | nostock
Sıcak İçecek | Americano | adet | 14 | 80 | 10 | nostock
Sıcak İçecek | Latte | adet | 20 | 95 | 10 | nostock, fav
Sıcak İçecek | Cappuccino | adet | 20 | 95 | 10 | nostock
Sıcak İçecek | Flat White | adet | 22 | 100 | 10 | nostock
Sıcak İçecek | Sıcak Çikolata | adet | 22 | 95 | 10 | nostock
Sıcak İçecek | Salep | adet | 25 | 90 | 10 | nostock, desc=Tarçınlı
Sıcak İçecek | Bitki Çayı | adet | 8 | 60 | 10 | nostock
Soğuk İçecek | Ayran | adet | 8 | 25 | 10 | st=40, min=10, fav
Soğuk İçecek | Ice Latte | adet | 22 | 105 | 10 | nostock
Soğuk İçecek | Ice Americano | adet | 15 | 90 | 10 | nostock
Soğuk İçecek | Limonata | adet | 15 | 80 | 10 | nostock, desc=Ev yapımı, naneli
Soğuk İçecek | Taze Portakal Suyu | adet | 25 | 95 | 10 | nostock
Soğuk İçecek | Milkshake | adet | 30 | 120 | 10 | nostock
Soğuk İçecek | Kola 330 ml | adet | 22 | 55 | 20 | st=48, min=12
Soğuk İçecek | Maden Suyu | adet | 7 | 25 | 10 | st=48, min=12
Soğuk İçecek | Su 500 ml | adet | 4 | 15 | 10 | st=60, min=12
Yiyecek | Tost | adet | 30 | 90 | 10 | nostock, fav
Yiyecek | Karışık Tost | adet | 45 | 120 | 10 | nostock
Yiyecek | Simit | adet | 8 | 20 | 10 | st=30, min=5
Yiyecek | Peynirli Poğaça | adet | 10 | 30 | 10 | st=24, min=6
Yiyecek | Açma | adet | 10 | 30 | 10 | st=20, min=5
Yiyecek | Su Böreği (porsiyon) | adet | 35 | 110 | 10 | st=10, min=3
Yiyecek | Gözleme | adet | 35 | 120 | 10 | nostock
Yiyecek | Menemen | adet | 40 | 140 | 10 | nostock
Yiyecek | Serpme Kahvaltı (kişi) | adet | 150 | 450 | 10 | nostock, desc=Peynirler, zeytin, bal-kaymak, yumurta, sınırsız çay
Yiyecek | Kruvasan | adet | 25 | 85 | 10 | st=12, min=4
Yiyecek | Sandviç | adet | 40 | 130 | 10 | st=10, min=3
Tatlı | Cheesecake | adet | 40 | 120 | 10 | st=8, min=2, desc=Frambuaz soslu, ev yapımı
Tatlı | San Sebastian | adet | 50 | 150 | 10 | st=8, min=2
Tatlı | Brownie | adet | 30 | 95 | 10 | st=10, min=3
Tatlı | Tiramisu | adet | 45 | 140 | 10 | st=8, min=2
Tatlı | Trileçe | adet | 30 | 100 | 10 | st=8, min=2
Tatlı | Kurabiye | adet | 8 | 30 | 10 | st=30, min=8
Tatlı | Waffle | adet | 55 | 170 | 10 | nostock
Tatlı | Dondurma (2 top) | adet | 20 | 70 | 10 | nostock
`);

// ---------------------------------------------------------------- Berber / Kuaför
const BERBER = parse(`
Saç | Saç Kesimi | adet | 0 | 300 | 20 | svc=30, fav
Saç | Saç + Sakal | adet | 0 | 400 | 20 | svc=45, fav
Saç | Çocuk Tıraşı | adet | 0 | 200 | 20 | svc=20, fav
Saç | Makine ile Kesim | adet | 0 | 200 | 20 | svc=15
Saç | Saç Yıkama + Fön | adet | 0 | 150 | 20 | svc=15
Saç | Saç Boyama | adet | 0 | 600 | 20 | svc=60
Saç | Beyaz Kapatma | adet | 0 | 450 | 20 | svc=40
Saç | Perma | adet | 0 | 900 | 20 | svc=90
Saç | Keratin Bakım | adet | 0 | 1500 | 20 | svc=120
Saç | Damat Tıraşı | adet | 0 | 1500 | 20 | svc=90
Sakal | Sakal Tıraşı | adet | 0 | 150 | 20 | svc=20, fav
Sakal | Sakal Şekillendirme | adet | 0 | 180 | 20 | svc=20
Sakal | Sakal Boyama | adet | 0 | 250 | 20 | svc=25
Sakal | Ustura ile Tıraş | adet | 0 | 200 | 20 | svc=25
Bakım | Cilt Bakımı | adet | 0 | 350 | 20 | svc=30
Bakım | Siyah Maske | adet | 0 | 150 | 20 | svc=15
Bakım | Kaş Alma | adet | 0 | 80 | 20 | svc=10
Bakım | Burun & Kulak Ağda | adet | 0 | 100 | 20 | svc=10
Bakım | Yüz Ağda | adet | 0 | 150 | 20 | svc=15
Bakım | Buhar + Masaj | adet | 0 | 250 | 20 | svc=20
Ürün Satışı | Wax 100 ml | adet | 90 | 180 | 20 | st=12, min=3
Ürün Satışı | Jöle 250 ml | adet | 45 | 95 | 20 | st=12, min=3
Ürün Satışı | Saç Spreyi | adet | 85 | 170 | 20 | st=8, min=2
Ürün Satışı | Kil (Clay) 100 ml | adet | 110 | 220 | 20 | st=8, min=2
Ürün Satışı | Şampuan | adet | 110 | 220 | 20 | st=8, min=2
Ürün Satışı | Sakal Yağı | adet | 95 | 190 | 20 | st=8, min=2
Ürün Satışı | Sakal Şampuanı | adet | 85 | 170 | 20 | st=6, min=2
Ürün Satışı | Tıraş Kolonyası | adet | 60 | 120 | 20 | st=10, min=3
Ürün Satışı | Tıraş Köpüğü | adet | 55 | 110 | 20 | st=8, min=2
Ürün Satışı | Saç Toniği | adet | 120 | 240 | 20 | st=6, min=2
`);

// ---------------------------------------------------------------- Genel perakende (kırtasiye, telefon aksesuarı, hırdavat…)
const GENEL = parse(`
Genel | Çeşitli Ürün | adet | 0 | 0 | 20 | nostock, fav
Hizmet | Hizmet Bedeli | adet | 0 | 0 | 20 | svc=0, fav
Kırtasiye | Tükenmez Kalem | adet | 6 | 15 | 20 | st=50, min=10, fav
Kırtasiye | Kurşun Kalem | adet | 4 | 10 | 20 | st=50, min=10
Kırtasiye | Silgi | adet | 4 | 10 | 20 | st=40, min=10
Kırtasiye | Kalemtıraş | adet | 5 | 12 | 20 | st=30, min=8
Kırtasiye | Çizgili Defter A4 | adet | 25 | 45 | 20 | st=30, min=8
Kırtasiye | Kareli Defter A5 | adet | 18 | 35 | 20 | st=30, min=8
Kırtasiye | Fotokopi Kağıdı A4 500'lü | paket | 140 | 195 | 20 | st=10, min=3
Kırtasiye | Boya Kalemi 12'li | paket | 35 | 65 | 20 | st=15, min=4
Kırtasiye | Yapıştırıcı Stick | adet | 12 | 25 | 20 | st=20, min=5
Kırtasiye | Makas | adet | 18 | 35 | 20 | st=10, min=3
Kırtasiye | Dosya Klasör | adet | 25 | 45 | 20 | st=15, min=4
Kırtasiye | Zarf 10'lu | paket | 10 | 20 | 20 | st=15, min=4
Telefon Aksesuarı | Şarj Kablosu USB-C | adet | 45 | 120 | 20 | st=15, min=4, fav
Telefon Aksesuarı | Şarj Adaptörü 20 W | adet | 120 | 250 | 20 | st=10, min=3
Telefon Aksesuarı | Kulaklık | adet | 80 | 180 | 20 | st=10, min=3
Telefon Aksesuarı | Ekran Koruyucu | adet | 15 | 80 | 20 | st=30, min=8
Telefon Aksesuarı | Telefon Kılıfı | adet | 30 | 120 | 20 | st=20, min=5
Telefon Aksesuarı | Powerbank 10000 mAh | adet | 280 | 450 | 20 | st=6, min=2
Telefon Aksesuarı | Hafıza Kartı 64 GB | adet | 140 | 250 | 20 | st=8, min=2
Elektrik | Kalem Pil 4'lü | paket | 55 | 85 | 20 | st=20, min=5, fav
Elektrik | İnce Pil 4'lü | paket | 55 | 85 | 20 | st=20, min=5
Elektrik | LED Ampul 9 W | adet | 35 | 65 | 20 | st=20, min=5
Elektrik | Uzatma Kablosu 3'lü | adet | 120 | 210 | 20 | st=8, min=2
Elektrik | El Feneri | adet | 65 | 120 | 20 | st=6, min=2
Hırdavat | Koli Bandı | adet | 18 | 35 | 20 | st=20, min=5
Hırdavat | Elektrik Bandı | adet | 10 | 20 | 20 | st=20, min=5
Hırdavat | Japon Yapıştırıcı | adet | 12 | 25 | 20 | st=20, min=5
Hırdavat | Tornavida Seti | adet | 120 | 220 | 20 | st=5, min=2
Hırdavat | Maket Bıçağı | adet | 15 | 30 | 20 | st=10, min=3
Hırdavat | Çivi / Vida Seti | adet | 45 | 85 | 20 | st=8, min=2
Ev & Hediyelik | Mum 6'lı | paket | 30 | 60 | 20 | st=10, min=3
Ev & Hediyelik | Hediye Paketi | adet | 8 | 20 | 20 | st=30, min=8
Ev & Hediyelik | Kupa Bardak | adet | 45 | 95 | 20 | st=12, min=3
Ev & Hediyelik | Anahtarlık | adet | 15 | 40 | 20 | st=20, min=5
Ev & Hediyelik | Doğum Günü Mumu | adet | 5 | 15 | 20 | st=30, min=8
`, { barcodes: true, start: 900001 });

const COLORS = {
  'Süt Ürünleri': '#22c55e', Kahvaltılık: '#eab308', Gıda: '#f59e0b', Atıştırmalık: '#ec4899', İçecek: '#3b82f6', Dondurulmuş: '#06b6d4',
  Manav: '#16a34a', Fırın: '#d97706', Temizlik: '#a855f7', 'Kağıt & Ev': '#64748b', 'Kişisel Bakım': '#14b8a6', Bebek: '#f472b6', 'Evcil Hayvan': '#92400e',
  Çorbalar: '#d97706', Izgaralar: '#dc2626', 'Pide & Lahmacun': '#ea580c', Dürümler: '#b91c1c', 'Ana Yemekler': '#b45309', 'Salata & Meze': '#16a34a',
  Tatlılar: '#db2777', İçecekler: '#3b82f6', Malzeme: '#64748b',
  'Sıcak İçecek': '#b45309', 'Soğuk İçecek': '#3b82f6', Yiyecek: '#f59e0b', Tatlı: '#ec4899',
  Saç: '#3b82f6', Sakal: '#f59e0b', Bakım: '#ec4899', 'Ürün Satışı': '#22c55e',
};

// Open Food Facts'ten indirilen gerçek barkodlu ürünler (scripts/import-off.mjs, ODbL). Fiyatlar kategoriye göre yaklaşıktır.
const marketNames = new Set(MARKET.map((p) => p[0].toLocaleLowerCase('tr')));
const OFF_MARKET = (Array.isArray(OFF_PRODUCTS) ? OFF_PRODUCTS : [])
  .filter((p) => p.code && p.name && !marketNames.has(p.name.toLocaleLowerCase('tr')))
  .map((p) => [p.name, p.category, 'adet', Math.round(p.sell * 0.72), p.sell, p.vat, {
    barcode: p.code, stock: 6 + (Number(p.code.slice(-2)) % 30), min_stock: 3,
  }]);

export const CATALOG = {
  market: { categories: [...cats([...MARKET, ...OFF_MARKET], COLORS), ['Tütün', '#64748b']], products: [...MARKET, ...OFF_MARKET] },
  restoran: { categories: cats(RESTORAN, COLORS), products: RESTORAN, recipes: RESTORAN_RECIPES },
  kafe: { categories: cats(KAFE, COLORS), products: KAFE },
  berber: { categories: cats(BERBER, COLORS), products: BERBER },
  genel: { categories: cats(GENEL, COLORS), products: GENEL },
};

export const catalogSize = () => Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.products.length]));
