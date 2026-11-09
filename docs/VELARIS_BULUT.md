# Velaris Bulut

Müşteriler kurulum yapmadan VelarisKasa'yı internet üzerinden kullanır: kayıt olur, 14 gün dener, kartla öder.
Her işletme kendi adresinde ve **kendi veritabanında** çalışır (`yildizmarket.velariskasa.com`). Tablet, telefon,
garson, mutfak ve müşteri ekranı bu adrese bağlanır.

## Nasıl çalışır

| Adım | Ne olur |
|---|---|
| Kayıt (`/kayit`) | Paket, işletme adı, adres, yetkili, PIN. İşletmenin veritabanı açılır, sektöre göre hazır ayarlar kurulur, yönetici oluşturulur. |
| Deneme | Ücretli paketlerde 14 gün; kart istenmez. İmzalı lisans (bitiş = deneme sonu) işletmenin veritabanına yazılır. |
| Ödeme (`/odeme/<bağlantı>`) | Kasada Ayarlar → Paket → "Öde" bu sayfayı açar. Aylık ya da yıllık (12 ay, 10 ay öde). KDV eklenir. |
| Ödeme sonrası | Süre kalan sürenin üstüne eklenir; yeni lisans hemen yazılır, kasada paket kendiliğinden güncellenir. |
| Ödeme gecikirse | 7 gün ek süre, sonra Ücretsiz paket. **Veriler silinmez**; ödeme yapılınca her şey geri açılır. |
| Yönetim (`/yonetim`) | Velaris Dijital: işletme listesi, durum, elle süre uzatma, askıya alma. |

Kart bilgisi bizim sunucumuza hiç gelmez; iyzico'nun ödeme sayfasında girilir. Ödeme sonucu iyzico'dan
token ile sorgulanır; tutar ve sepet numarası tutmazsa ödeme işlenmez.

> Şu an her ay ödeme bağlantısıyla ödenir (otomatik kart çekimi yok). Ödeme günü yaklaşınca kasadaki Paket ekranında
> "Ödeme günü yaklaştı" görünür. Otomatik yenileme için iyzico Abonelik ürünü ayrıca bağlanabilir.

## Kurulum (sunucu)

Gereken: Ubuntu sunucu (2 GB RAM ile onlarca işletme), Docker, `velariskasa.com` alan adı.

1. **DNS (Hostinger):**
   - `velariskasa.com` ve `www` → GitHub Pages (tanıtım sitesi, olduğu gibi kalır)
   - `bulut` → **A** kaydı, sunucunun IP'si
   - `*` (joker) → **A** kaydı, sunucunun IP'si (her işletmenin alt alan adı)
2. **Lisans gizli anahtarı:** Lisans anahtarlarını imzalayan `private.pem` (bkz. `docs/LISANS.md`).
   `deploy/bulut/secrets/license-private.pem` olarak kopyalayın. Depoya **eklemeyin**.
3. **Ayarlar:** `cd deploy/bulut && cp .env.example .env` ve değerleri doldurun
   (özellikle `VK_CLOUD_ADMIN_TOKEN`: uzun rastgele bir parola).
4. **Başlatın:**

```bash
cd deploy/bulut && docker compose up -d --build
```

5. `https://bulut.velariskasa.com/kayit` açılır. Tanıtım sitesindeki "Hemen başla" düğmeleri buraya bağlanır.

Sertifikalar: Caddy her işletmenin adresi için ilk istekte otomatik sertifika alır; yalnızca kayıtlı adresler için
(`/api/cloud/tls-check`) ister.

Alt alan adı istemezseniz `VK_CLOUD_DOMAIN`'i boş bırakın: işletmeler `https://bulut.velariskasa.com/i/<adres>/` altında açılır
(joker DNS gerekmez).

## Ödeme: deneme modundan iyzico'ya

1. Başlangıçta `VK_PAYMENT_PROVIDER=simulator`: ödeme sayfası çalışır, gerçek para çekilmez ("Ödeme başarılı / başarısız" düğmeleri).
2. iyzico başvurusu onaylanınca iyzico panelinden **Sandbox** API anahtarlarını alın:
   `VK_PAYMENT_PROVIDER=iyzico`, `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`.
   iyzico'nun test kartlarıyla deneyin.
3. Canlıya geçiş: canlı anahtarlar ve `IYZICO_BASE_URL=https://api.iyzipay.com`; `docker compose up -d`.

iyzico başvurusunda istenenler (site incelemesi): ürün ve fiyatlar, satın alma akışı (kayıt → ödeme sayfası),
Mesafeli Satış Sözleşmesi, İptal/İade Koşulları, Gizlilik ve KVKK aydınlatma metni, iletişim bilgileri (unvan, adres, telefon),
sayfa altında kart/iyzico logoları.

## Yedek

Tüm veriler `cloud-data` biriminde: `cloud.db` (işletmeler, ödemeler) ve `tenants/<adres>/velaris-kasa.db`.
Günlük yedek önerisi:

```bash
docker run --rm -v bulut_cloud-data:/data -v $PWD:/out alpine tar czf /out/bulut-$(date +%F).tgz -C /data .
```

## Geliştirme

```bash
node scripts/license.mjs keygen
```

```bash
npm run build && VK_CLOUD_ADMIN_TOKEN=deneme node server/cloud/main.js
```

`http://localhost:4850/kayit` → kayıt; işletme `http://localhost:4850/i/<adres>/` altında açılır.
