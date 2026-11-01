# VelarisKasa

![VelarisKasa](brand/logo/velariskasa-light.png)

Bakkal, market, berber/kuaför, kafe/büfe ve her türlü küçük işletme için **stok takip ve kasa (POS) programı**.
Tek başına çalışır; istenirse **Velaris CRM** ile entegre olur.

- **Kasa:** barkod okutma, terazi barkodu (kg), hızlı tuşlar, sepet bekletme, satır/fiş indirimi,
  nakit (para üstü hesaplı) / kart / veresiye / havale / parçalı ödeme, 80 mm fiş yazdırma, iade, klavye kısayolları
- **Stok:** ürün ve hizmetler, kategoriler, alış/satış fiyatı ve kâr marjı, KDV, mal girişi, fire/çıkış, sayım,
  kritik stok uyarısı, stok hareket geçmişi, CSV/Excel içe-dışa aktarma
- **Alış & tedarikçiler:** alış faturası / irsaliye girişi (barkodla), KDV hariç/dahil fiyat, stok ve alış fiyatı
  otomatik güncellenir, maliyet satış fiyatını geçerse uyarı, tedarikçi borç takibi, vadeli / nakit ödeme (nakit gün sonuna işlenir), belge iptali,
  tedarikçi fiyat karşılaştırma (daha ucuz tedarikçi uyarısı)
- **Masa / adisyon (kafe):** masa planı ve bölümler, dokunmatik sipariş, ürün notu (şekersiz, az pişmiş…),
  mutfak/bar fişi, sebepli iptal/ikram kaydı, masa taşıma-birleştirme, kalem aktarma, hesap bölme (seçili kalemleri öde),
  adisyon yazdırma; ödeme kasada normal satış olarak alınır (yazarkasa, e-Arşiv, puan aynen çalışır)
- **Garson modu:** Personel rolü masalar açıkken telefonda sade masa/sipariş ekranıyla açılır; hesap kasaya bildirilir.
  Raporlarda garson bazında sipariş ve iptal/ikram, ortalama adisyon ve masa süresi
- **QR menü:** her masaya özel QR; müşteri menüyü görür, garson çağırır, hesap ister, sipariş isteği gönderir (garson onaylar)
- **Paket servis / gel-al:** telefonla siparişte kayıtlı müşteri ve son adres, servis ücreti, Yeni → Hazırlanıyor → Hazır →
  Yolda → Teslim, kurye seçimi ve kurye raporu, mutfak ve kurye fişi
- **Yemek platformları:** Yemeksepeti, Trendyol Go / Yemek, Migros, Getir siparişleri imzalı webhook ile; ürün eşleme,
  kabul / ret, otomatik kabul, durumlar platforma geri bildirilir, online ödeme. Bkz. [docs/YEMEK_PLATFORMLARI.md](docs/YEMEK_PLATFORMLARI.md)
- **Reçeteli stok:** ürün satılınca malzemelerin stoğu düşer, maliyet reçeteden hesaplanır
- **Yetkiler:** kasiyer ve personel için indirim sınırı, fiyat değiştirme, iade, veresiye, iptal/ikram, stok ve gün sonu yetkileri
- **Müşteri & veresiye:** müşteri kartı, veresiye defteri, limit, tahsilat, bakiye düzeltme
- **Randevu (berber/kuaför):** personel bazlı günlük takvim, çakışma kontrolü, randevudan tek tıkla kasaya aktarma, personel primi
- **Gün sonu:** kasa açılışı, kasaya para giriş/çıkış (masraf), beklenen/sayılan nakit farkı, Z raporu
- **Raporlar:** ciro, brüt kâr, ortalama sepet, KDV, saatlik/günlük satış, ödeme türleri, kategoriler,
  en çok satanlar, personel performansı ve prim, stok değeri ve sipariş listesi
- **Kullanıcılar:** PIN ile giriş; yönetici / müdür / kasiyer / personel rolleri
- **Çevrimdışı:** internet ya da sunucu kesilirse satış yapmaya devam eder, bağlantı gelince otomatik gönderir
- **Yazarkasa (YN ÖKC):** satış mali fiş için yazarkasaya gönderilir (GMP-3 köprüsü), fiş numarası satışa işlenir,
  gün sonunda yazarkasa Z raporu alınır; cihaz yanıt vermezse "tekrar gönder". Bkz. [docs/YAZARKASA_ENTEGRASYON.md](docs/YAZARKASA_ENTEGRASYON.md)
- **e-Arşiv / e-Fatura:** Paraşüt üzerinden tek tıkla fatura; alıcı e-Fatura mükellefiyse otomatik e-Fatura, 12.000 TL sınırı uyarısı
- **Puan (para puan):** her alışverişte ayarlanabilir oranda puan, kasada puanla ödeme
- **SMS & WhatsApp:** Netgsm, İleti Merkezi, WhatsApp Business; otomatik randevu hatırlatma, borç bildirimi,
  onaylı müşterilere kampanya mesajı
- **Online randevu:** müşterinin kendisi hizmet, personel ve boş saat seçerek randevu alır, linkten iptal eder
- **KVKK & İYS:** ticari ileti onayı (tarih/kaynak), İYS yükleme listesi, müşteri verisini gösterme ve silme
- **Kamera ile barkod:** telefon/tablet kamerasıyla okuma; bulunamayan barkod için internetten ürün adı
- **Bulut kurulumu:** Docker + otomatik HTTPS, şube/kasa bazlı raporlar. Bkz. [docs/BULUT_KURULUM.md](docs/BULUT_KURULUM.md)
- **Velaris CRM entegrasyonu:** bkz. [docs/VELARIS_ENTEGRASYON.md](docs/VELARIS_ENTEGRASYON.md)
- **Paketler ve lisans:** Ücretsiz / Esnaf / Salon / Pro; imzalı lisans anahtarı, internetsiz doğrulama.
  Bkz. [docs/LISANS.md](docs/LISANS.md)
- **Şube bazlı stok:** kasa→şube eşlemesi, şubeler arası transfer, şube stok raporu (Pro)
- **İYS'ye otomatik bildirim:** onay/ret kayıtları birkaç dakika içinde İYS API'ye gönderilir
- **Yazarkasa ara programı (C#):** marka sürücüsü şablonu ve simülatör, `bridge/adapter-dotnet/`

## Marka ve tanıtım

- Marka kiti: [docs/MARKA_KITI.md](docs/MARKA_KITI.md) · tokenlar ve logolar `brand/`
- Tanıtım sayfası: `landing/page.html` (kaynak) → `node landing/build.mjs` → `landing/public/index.html`

## Nasıl çalışır?

```
┌──────────────────────────┐        yerel ağ (Wi-Fi/kablo)        ┌──────────────────┐
│  Ana kasa (PC)           │  ◄────────────────────────────────── │ Tablet / telefon │
│  VelarisKasa masaüstü   │      http://192.168.1.20:4848        │ (tarayıcı / PWA) │
│  ├─ sunucu + veritabanı  │                                      └──────────────────┘
│  └─ kasa ekranı          │  ──── internet ────►  Velaris CRM (isteğe bağlı)
└──────────────────────────┘
```

Tüm veriler ana kasadaki tek bir SQLite dosyasında tutulur. Dükkânda başka kasa/tablet varsa tarayıcıdan
ana kasanın adresine girmeleri yeterli; "Ana ekrana ekle" ile uygulama gibi kurulur.
Program bir bulut sunucusuna da kurulabilir; o zaman her şube internetten bağlanır.

## Kurulum

### Masaüstü (Windows)
`npm run dist:win` ile üretilen `release/VelarisKasa Setup x.y.z.exe` dosyasını çalıştırın.
GitHub'a `v1.0.0` gibi bir etiket gönderildiğinde Actions bu dosyayı otomatik üretir.

### Sunucu / geliştirme
Node.js 20+ gerekir.

```bash
npm install
```

```bash
npm run build && npm start
```

Tarayıcıda `http://localhost:4848` adresini açın; ilk açılışta kurulum sihirbazı işletme türünü sorar
ve örnek ürünleri ekler.

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme (API :4848 + arayüz :5173, anlık yenileme) |
| `npm start` | Sunucuyu başlatır (önce `npm run build`) |
| `npm test` | API testleri |
| `npm run desktop` | Masaüstü uygulamasını çalıştırır |
| `npm run dist:win` / `dist:linux` / `dist:mac` | Kurulum dosyası üretir |
| `npm run demo:build` | Tarayıcıda tek başına çalışan demo (dist-demo/velaris-kasa-demo.html) |
| `node bridge/okc-bridge.js` | Yazarkasa köprüsü (simülatör ya da üretici kütüphanesiyle) |

Ortam değişkenleri: `PORT` (varsayılan 4848), `HOST` (varsayılan 0.0.0.0), `VELARIS_DATA_DIR` (varsayılan `./data`).

## Donanım

- **Barkod okuyucu:** USB/Bluetooth okuyucular klavye gibi çalışır, ek ayar gerekmez (sonuna Enter eklemeli).
- **Terazi barkodu:** EAN-13, önek 27/28/29 + 5 hane PLU + 5 hane gram. Üründe barkod alanına PLU'yu
  (ör. `00123` ya da `2700123`) yazın. Önekler Ayarlar'dan değiştirilebilir.
- **Fiş yazıcı:** 80 mm termal yazıcıyı varsayılan yazıcı yapın. Masaüstünde fiş doğrudan basılır.

## Kısayollar (kasa ekranı)

| Tuş | İşlem |
|---|---|
| F2 | Nakit ödeme |
| F3 | Kart ile ödeme |
| F4 | Veresiye |
| F6 | Parçalı ödeme |
| F8 | Müşteri seç |
| F9 | Fiş indirimi |
| + / − / Delete | Seçili satır miktarı / sil |
| `3*barkod` | Aynı üründen 3 adet |

## Proje yapısı

```
server/            Express API + SQLite (better-sqlite3)
  schema.sql       Veritabanı şeması (tutarlar kuruş); migrations.js sonraki sürümler
  fiscal.js        Yazarkasa sürücüleri · invoice.js e-Arşiv · notify.js SMS/WhatsApp
  routes/          products, sales, customers, purchases, tables, deliveries, qrmenu, platforms, shifts, appointments, reports, settings
  integrations/    velaris.js — CRM olay kuyruğu, müşteri çekme
web/               React arayüz (Vite) + PWA
electron/          Masaüstü kabuğu (sunucuyu içinde çalıştırır)
bridge/            Yazarkasa köprüsü (GMP-3)
test/              API testleri (node:test)
docs/              Velaris CRM entegrasyon sözleşmesi
```

## Notlar

- Yazarkasa bağlı değilken basılan fişler **bilgi fişidir**. Gerçek usuldeki işletmeler satışları yazarkasadan
  mali fişle kaydetmek zorundadır (Ayarlar → Yazarkasa). Gerçek cihaz bağlantısı için üreticinin GMP-3 kütüphanesi gerekir.
- Yedek: Ayarlar → Yedekleme → "Yedeği indir". Düzenli olarak USB/buluta kopyalayın.
