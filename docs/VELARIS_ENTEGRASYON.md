# VelarisKasa ↔ Velaris CRM Entegrasyon Sözleşmesi

VelarisKasa **tek başına** çalışır. Entegrasyon, Ayarlar → Velaris CRM ekranından açılıp kapatılır.
Kapalıyken hiçbir veri dışarı gönderilmez.

Bağlantı iki yönlüdür:

| Yön | Nasıl | Ne için |
|---|---|---|
| Kasa → CRM | `POST {CRM}/api/pos/events` (olay kuyruğu) | Satış, iade, müşteri, veresiye, stok uyarısı, randevu, gün sonu |
| CRM → Kasa (çekme) | Kasa, `GET {CRM}/api/customers` adresini 5 dk'da bir çağırır | CRM'deki müşterileri kasaya almak |
| CRM → Kasa (okuma/yazma) | `{KASA}/api/v1/*` + API anahtarı | Ürün, stok, satış, müşteri sorgulama/ekleme |
| CRM → Kasa (anlık) | `POST {KASA}/api/integration/webhook` (HMAC imzalı) | Müşteri ve randevu aktarımı |

> **Tüm para tutarları kuruş cinsinden tam sayıdır** (`12550` = ₺125,50). Fiyatlar KDV dahildir.
> Tarihler kasanın yerel saatinde `YYYY-MM-DD HH:MM:SS` biçimindedir.

---

## 1. CRM tarafında yazılması gereken uçlar

### 1.1 `GET /api/pos/ping`
Bağlantı testi. `200` ve herhangi bir JSON dönmesi yeterli.

### 1.2 `POST /api/pos/events`

Başlıklar:

```
Authorization: Bearer {crm_api_key}          # kasada girilen CRM API anahtarı
Content-Type: application/json
X-Velaris-Event: sale.completed
X-Velaris-Signature: sha256={HMAC_SHA256(webhook_secret, ham_govde)}
Idempotency-Key: {install_id}-{olay_no}     # aynı olay tekrar gelirse yok sayın
X-Velaris-Install: {install_id}             # hangi kasa/işletme
```

Gövde (zarf):

```json
{
  "id": "3f1c…-42",
  "event": "sale.completed",
  "occurred_at": "2026-10-30 18:26:11",
  "source": { "app": "velaris-kasa", "install_id": "3f1c…", "business": "Yıldız Market" },
  "data": { … }
}
```

Yanıt:
- `2xx` → olay gönderildi sayılır.
- `customer.created` ve `product.upserted` için `{"crm_id": "…"}` dönerseniz kasa bu kimliği kendi kaydına yazar; sonraki olaylarda `crm_id` dolu gelir.
- `2xx` dışı / zaman aşımı → kasa 2, 4, 8 … dakika (en fazla 6 saat) aralıklarla 12 kez yeniden dener. Sonra "Başarısız" olarak işaretler; Ayarlar ekranından tekrar denenebilir.

İmza doğrulama örneği (Node.js):

```js
const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = req.get('X-Velaris-Signature') === `sha256=${expected}`;
```

### 1.3 `GET /api/customers?updated_since=&page=&per_page=200`

Kasa son çekme zamanından sonra değişen müşterileri ister (`updated_since` boşsa tümü).
Kabul edilen yanıt biçimleri:

```json
{ "data": [ { "id": "CRM-7", "name": "Ayşe Yılmaz", "phone": "0555…", "email": "…", "note": "…" } ], "has_more": false }
```

ya da düz dizi. `first_name` + `last_name` da kabul edilir. Eşleştirme önce `crm_id`, yoksa telefon ile yapılır.

---

## 2. Olaylar (`data` içeriği)

| Olay | Ne zaman | `data` |
|---|---|---|
| `sale.completed` | Satış tamamlandı | Satış (aşağıda) |
| `sale.refunded` | İade yapıldı | `{ sale, amount, method, items: [{name, product_id, qty, amount}] }` |
| `customer.created` | Kasada yeni müşteri | Müşteri |
| `customer.updated` | Müşteri bilgisi ya da veresiye bakiyesi değişti | Müşteri |
| `payment.received` | Veresiye tahsilatı | `{ customer, amount, method, balance_after }` |
| `product.upserted` | Ürün eklendi/güncellendi | Ürün satırı (fiyat, stok, barkod…) |
| `stock.low` | Stok kritik seviyenin altına indi | `{ product_id, crm_id, name, barcode, stock, min_stock }` |
| `appointment.created` / `appointment.updated` | Randevu | `{ id, crm_id, start_at, duration_min, status, customer, staff, service, sale_id }` |
| `shift.closed` | Gün sonu (Z raporu) | `{ register_name, opened_at, closed_at, sales, payments, refunds, expected_cash, counted_cash, difference }` |

**Müşteri**

```json
{ "id": 12, "crm_id": "CRM-42", "name": "Mehmet Kaya", "phone": "0532…", "email": null,
  "note": null, "balance": 24000, "credit_limit": 0, "active": 1, "updated_at": "…" }
```
`balance` > 0 → müşterinin işletmeye veresiye borcu (kuruş).

**Satış**

```json
{
  "id": 51, "receipt_no": "20261030-0001", "created_at": "2026-10-30 18:26:11",
  "register_name": "Kasa 1", "cashier": "Ali",
  "customer": { "id": 12, "crm_id": "CRM-42", "name": "Mehmet Kaya", "phone": "0532…" },
  "subtotal": 65000, "discount": 1000, "vat_total": 3412, "total": 64000,
  "refunded_total": 0, "status": "completed",
  "items": [
    { "product_id": 3, "product_crm_id": null, "barcode": "869…", "name": "Peynir", "type": "product",
      "qty": 2, "unit": "kg", "unit_price": 30000, "discount": 0, "vat_rate": 1, "line_total": 60000,
      "staff": null }
  ],
  "payments": [ { "method": "cash", "amount": 40000 }, { "method": "credit", "amount": 24000 } ]
}
```
`method`: `cash` nakit · `card` kart · `credit` veresiye · `transfer` havale/EFT.
Hizmet satırlarında `staff` işlemi yapan personeldir (prim hesabı için).

---

## 3. CRM'in kasaya erişimi — `{KASA}/api/v1`

Kasada Ayarlar → Velaris CRM → **API anahtarı oluştur** ile `vk_…` anahtarı alın ve isteklerde gönderin:

```
Authorization: Bearer vk_…        (ya da  X-API-Key: vk_…)
```

API anahtarı "müdür" yetkisindedir: ayarları ve kullanıcıları değiştiremez.

| Uç | Açıklama |
|---|---|
| `GET /products?q=&category_id=&low=1&updated_since=` | Ürünler ve anlık stok |
| `GET /products/barcode/{kod}` | Barkoddan ürün (terazi barkodu dahil) |
| `POST /products`, `PUT /products/{id}` | Ürün ekle/güncelle |
| `POST /products/{id}/stock` | `{ type: in|out|count, qty, unit_cost?, note? }` |
| `GET /stock-movements?product_id=` | Stok hareketleri |
| `GET /customers?q=&debt=1&updated_since=` | Müşteriler ve veresiye bakiyeleri |
| `GET /customers/{id}` | Müşteri + hesap hareketleri + son satışlar |
| `POST /customers/upsert-by-crm` | `{ crm_id, name, phone, email, note }` — CRM kimliğiyle ekle/güncelle |
| `GET /sales?from=YYYY-MM-DD&to=YYYY-MM-DD` | Satış listesi |
| `GET /sales/{id}` | Satış detayı |
| `GET /appointments?date=YYYY-MM-DD` | Randevular |
| `POST /appointments` | Randevu oluştur |
| `GET /reports/summary?from=&to=` | Ciro, kâr, ödeme türleri, en çok satanlar, personel primi |
| `GET /reports/stock` | Stok değeri, kritik stok listesi |
| `GET /shifts`, `GET /shifts/{id}` | Gün sonu (Z) raporları |

Hatalar `{"error": "açıklama"}` biçimindedir (`400` geçersiz istek, `401` anahtar yok/yanlış, `403` yetki yok, `404`, `409` çakışma).

---

## 4. CRM'den kasaya anlık webhook — `POST {KASA}/api/integration/webhook`

Oturum gerektirmez; gövde, kasada girilen **imza anahtarı** ile imzalanmalıdır:

```
X-Velaris-Signature: sha256={HMAC_SHA256(webhook_secret, ham_govde)}
```

```json
{ "event": "customer.upserted", "data": { "id": "CRM-8", "name": "Zeynep Ak", "phone": "0555…" } }
```

| `event` | `data` |
|---|---|
| `customer.upserted` (`customer.created`, `customer.updated`) | Müşteri (`id` = CRM kimliği) |
| `customer.deleted` | `{ "id": "CRM-8" }` — bakiyesi sıfırsa pasife alınır |
| `appointment.created` | `{ id, start_at: "2026-11-01 14:30", duration_min, staff_id?, service_id?, note?, customer: {id, name, phone} }` |

> Kasa yerel ağda çalışıyorsa CRM'in webhook ile kasaya ulaşabilmesi için kasanın internetten erişilebilir
> olması gerekir (sabit IP/port yönlendirme ya da bulut sunucusu). Bu mümkün değilse webhook yerine
> 5 dakikalık müşteri çekme yeterlidir.
