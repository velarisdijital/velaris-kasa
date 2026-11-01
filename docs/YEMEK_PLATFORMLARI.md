# Yemek Platformları (Yemeksepeti, Trendyol Go / Yemek, Migros Yemek, Getir)

Platform siparişleri **Paket** ekranına düşer: kabul / ret, mutfak fişi, kurye, yolda / teslim ve kasada ödeme
(online ödenmişse "Online ödendi · kapat") aynı ekrandan yürür. Durum değişiklikleri platforma geri bildirilir.

## Platformlar siparişi nasıl verir? (2026)

| Platform | Erişim yolu | Not |
|---|---|---|
| **Yemeksepeti** (Delivery Hero) | Onaylı POS sağlayıcısının "plugin"i, Delivery Hero entegrasyon ara katmanına bağlanır | Zincir kodu / vendor ID ve plugin onayı Yemeksepeti'nden alınır |
| **Trendyol Go / Yemek** | Satıcı paneli API bilgileri (Supplier ID, API Key, API Secret); siparişler sorgulanarak çekilir | Trendyol entegrasyon ekibinin onayı gerekir |
| **Getir Yemek** | GetirYemek API başvuruları kapatıldı; Getir Yemek, Uber Eats Trendyol Go üzerinden devam ediyor | Yeni entegrasyonlar Trendyol Go yolunu izlemeli |
| **Migros Yemek** | Onaylı entegratörler | |

Bu nedenle VelarisKasa siparişleri **tek tip bir webhook** ile alır. İki kullanım:

1. **Entegratör (hemen):** Platformlarla anlaşmalı bir entegratör (ör. birden çok platformu tek JSON'da toplayan
   firmalar) siparişi bu sözleşmeye göre gönderir. Tüm platformlar tek bağlantıyla gelir.
2. **Doğrudan adaptör (onaydan sonra):** Velaris Dijital bir platformdan POS onayı aldığında, o platformun adaptörü
   siparişleri aynı biçime çevirip bu uca verir; kasa tarafında değişiklik gerekmez.

## Kurulum

1. Ayarlar → İşletme → **Paket servis** modülünü açın.
2. Paket → Ayarlar → **Yemek platformları**:
   - "Platform siparişlerini al"ı işaretleyin.
   - **Gizli anahtar** oluşturun (yalnızca bir kez gösterilir) ve **webhook adresiyle** birlikte entegratöre verin.
   - Entegratörün durum bildirimlerini aldığı **geri bildirim adresini** girin.
   - İsterseniz **otomatik kabul** ve hazırlanma süresi.
3. "Deneme platform siparişi" ile akışı deneyin.

## Gelen sipariş — `POST /api/integrations/orders`

Başlık: `X-VK-Signature: sha256=<HMAC-SHA256(gizli anahtar, ham gövde)>` (hex). İmza tutmazsa `401`.
Tutarlar **kuruş**, KDV dahil.

```json
{
  "platform": "yemeksepeti",
  "external_id": "YS-1001",
  "kind": "delivery",
  "customer": { "name": "Elif", "phone": "0532 123 45 67", "address": "Bağdat Cad. 100 D:4", "note": "Acısız" },
  "items": [
    { "external_id": "p-77", "name": "Lahmacun", "qty": 3, "unit_price": 6000,
      "options": [{ "name": "Ekstra limon", "price": 200 }], "note": "" }
  ],
  "delivery_fee": 0,
  "discount": 1500,
  "paid_online": true,
  "payment_text": "Kapıda kart",
  "due_at": "2026-11-01 20:30:00"
}
```

- `platform`: `yemeksepeti` | `trendyol` | `migros` | `getir` | `other`
- `kind`: `delivery` (varsayılan) ya da `takeaway` (gel-al)
- Aynı `platform` + `external_id` ikinci kez gelirse sipariş çoğaltılmaz (`"action": "duplicate"`).
- **İptal:** `{ "platform": "...", "external_id": "...", "status": "cancelled", "reason": "Müşteri iptal etti" }` —
  ödeme alınmamışsa sipariş iptal edilir.
- Toplu gönderim: `{ "orders": [ ... ] }` (en çok 50) → `{ "results": [ ... ] }`.

Yanıt: `{ "ok": true, "action": "created", "ticket_id": 42, "unmapped": ["Ayran (Büyük)"] }`

### Ürün eşleme
Ürünler `external_id` ile kaydedilir. İlk gelişte VelarisKasa'da **aynı adlı** ürün varsa otomatik eşlenir;
yoksa adisyona ad ve platform fiyatıyla düşer ve Paket → Ayarlar → **Ürün eşleme**de görünür. Eşlenen ürünlerde
stok (reçete dahil) ve raporlar doğru çalışır. Seçenek fiyatları (`options`) birim fiyata eklenir, adları nota yazılır.

## Giden durum bildirimi (geri bildirim adresine)

Her durum değişikliği kuyruğa alınır, 10 sn'de bir gönderilir; başarısızlar 10 kez denenir.
Başlıklar: `X-VK-Signature: sha256=<HMAC(gizli anahtar, gövde)>`, `X-VK-Event-Id`.

```json
{ "event": "order.accept", "platform": "yemeksepeti", "external_id": "YS-1001", "data": { "prep_minutes": 25 }, "at": "2026-11-01 19:42:10" }
```

| `event` | Ne zaman | `data` |
|---|---|---|
| `order.accept` | Kabul edildi (ya da otomatik kabul) | `prep_minutes` |
| `order.reject` | Reddedildi | `reason` |
| `order.ready` | Hazır | |
| `order.picked_up` | Kurye yola çıktı | `courier_name` |
| `order.delivered` | Teslim edildi | |

## Ödeme ve mali fiş
- `paid_online: true` siparişler kasada **"Online ödendi · kapat"** ile kapatılır; ödeme yöntemi `online` olarak
  kaydedilir, yazarkasada "diğer ödeme" (`DIGER`) tipine gider.
- Kapıda ödemeli siparişler kurye dönünce nakit / kartla kapatılır.
- Platform indirimi (`discount`) tam hesap kapatılırken fiş indirimi olarak uygulanır.
