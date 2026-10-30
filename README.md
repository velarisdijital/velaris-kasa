# Velaris Kasa

Bakkal, market, berber/kuaför, kafe/büfe ve her türlü küçük işletme için **stok takip ve kasa (POS) programı**.
Tek başına çalışır; istenirse **Velaris CRM** ile entegre olur.

- **Kasa:** barkod okutma, terazi barkodu (kg), hızlı tuşlar, sepet bekletme, satır/fiş indirimi,
  nakit (para üstü hesaplı) / kart / veresiye / havale / parçalı ödeme, 80 mm fiş yazdırma, iade, klavye kısayolları
- **Stok:** ürün ve hizmetler, kategoriler, alış/satış fiyatı ve kâr marjı, KDV, mal girişi, fire/çıkış, sayım,
  kritik stok uyarısı, stok hareket geçmişi, CSV/Excel içe-dışa aktarma
- **Müşteri & veresiye:** müşteri kartı, veresiye defteri, limit, tahsilat, bakiye düzeltme
- **Randevu (berber/kuaför):** personel bazlı günlük takvim, çakışma kontrolü, randevudan tek tıkla kasaya aktarma, personel primi
- **Gün sonu:** kasa açılışı, kasaya para giriş/çıkış (masraf), beklenen/sayılan nakit farkı, Z raporu
- **Raporlar:** ciro, brüt kâr, ortalama sepet, KDV, saatlik/günlük satış, ödeme türleri, kategoriler,
  en çok satanlar, personel performansı ve prim, stok değeri ve sipariş listesi
- **Kullanıcılar:** PIN ile giriş; yönetici / müdür / kasiyer / personel rolleri
- **Çevrimdışı:** internet ya da sunucu kesilirse satış yapmaya devam eder, bağlantı gelince otomatik gönderir
- **Velaris CRM entegrasyonu:** bkz. [docs/VELARIS_ENTEGRASYON.md](docs/VELARIS_ENTEGRASYON.md)

## Nasıl çalışır?

```
┌──────────────────────────┐        yerel ağ (Wi-Fi/kablo)        ┌──────────────────┐
│  Ana kasa (PC)           │  ◄────────────────────────────────── │ Tablet / telefon │
│  Velaris Kasa masaüstü   │      http://192.168.1.20:4848        │ (tarayıcı / PWA) │
│  ├─ sunucu + veritabanı  │                                      └──────────────────┘
│  └─ kasa ekranı          │  ──── internet ────►  Velaris CRM (isteğe bağlı)
└──────────────────────────┘
```

Tüm veriler ana kasadaki tek bir SQLite dosyasında tutulur. Dükkânda başka kasa/tablet varsa tarayıcıdan
ana kasanın adresine girmeleri yeterli; "Ana ekrana ekle" ile uygulama gibi kurulur.
Program bir bulut sunucusuna da kurulabilir; o zaman her şube internetten bağlanır.

## Kurulum

### Masaüstü (Windows)
`npm run dist:win` ile üretilen `release/Velaris Kasa Setup x.y.z.exe` dosyasını çalıştırın.
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
  schema.sql       Veritabanı şeması (tutarlar kuruş)
  routes/          products, sales, customers, shifts, appointments, reports, settings
  integrations/    velaris.js — CRM olay kuyruğu, müşteri çekme
web/               React arayüz (Vite) + PWA
electron/          Masaüstü kabuğu (sunucuyu içinde çalıştırır)
test/              API testleri (node:test)
docs/              Velaris CRM entegrasyon sözleşmesi
```

## Notlar

- Fişler **bilgi fişidir**; yazarkasa/ÖKC veya e-Arşiv yerine geçmez. Yasal belge için mevcut ÖKC/e-Arşiv
  entegrasyonu ayrıca eklenmelidir.
- Yedek: Ayarlar → Yedekleme → "Yedeği indir". Düzenli olarak USB/buluta kopyalayın.
