# Yazarkasa (YN ÖKC) Entegrasyonu

Gerçek usulde vergilendirilen ve son tüketiciye satış yapan işletmeler satışlarını **yeni nesil ödeme kaydedici
cihazdan (YN ÖKC)** mali fişle kaydetmek zorundadır. Kart ödemesi de ÖKC'ye bağlı (GMP-3 ile eşleşmiş) POS'tan
alınmalıdır. Basit usul ve esnaf muaflığındaki işletmeler bilgi fişiyle çalışabilir.

> Mevzuat özetidir, hukuki görüş değildir. Kendi durumunuz için mali müşavirinize danışın.

## Mimari

```
VelarisKasa sunucusu ──HTTP/JSON──► Yazarkasa köprüsü ──GMP-3 (üretici kütüphanesi)──► YN ÖKC ──► banka POS
 (server/fiscal.js)                  (bridge/okc-bridge.js)
```

- Tarayıcı (PWA) yazarkasaya doğrudan bağlanamaz. Bağlantıyı **kasa bilgisayarında çalışan köprü servisi** kurar.
- Köprü, cihaz üreticisinin GMP-3 kütüphanesini kullanır. Üretici bu kütüphaneyi ve teknik dokümanı
  entegrasyon yapacak yazılım firmasına sözleşmeyle verir (GİB GMP-3 dokümanı, "Harici Sistem Bağlantısı").
- Satış önce Velaris'e kaydedilir, sonra mali fiş için köprüye gönderilir. Cihaz yanıt vermezse satış
  `failed` olur; **Satışlar** ekranında ve kasada "Yazarkasaya tekrar gönder" düğmesi çıkar.

## Kurulum

1. Ayarlar → **Yazarkasa** → "Yazarkasa köprüsü" seçin, köprü adresini girin (varsayılan `http://127.0.0.1:4850`).
2. Köprüyü kasa bilgisayarında çalıştırın:
   - Cihazsız deneme: `node bridge/okc-bridge.js`
   - Gerçek cihaz: `OKC_ADAPTER=command OKC_COMMAND="C:\okc\velaris-okc.exe" node bridge/okc-bridge.js`
3. "Bağlantıyı test et" ile cihazın hazır olduğunu doğrulayın.

## Köprü sözleşmesi (HTTP)

Tüm tutarlar **kuruş**, fiyatlar KDV dahil.

| Uç | Gövde | Başarılı yanıt |
|---|---|---|
| `GET /status` | – | `{ "ok": true, "device": "Beko 400TR", "message": "Hazır" }` |
| `POST /receipt` | Mali fiş (aşağıda) | `{ "ok": true, "fiscal_no": "0042", "z_no": "0153" }` |
| `POST /refund` | `{ sale_id, receipt_no, fiscal_no, amount, method, items: [{name, qty, amount, vat_rate}] }` | `{ "ok": true }` |
| `POST /z-report` | `{}` | `{ "ok": true, "z_no": "0153" }` |
| `POST /x-report` | `{}` | `{ "ok": true }` |

Hata: HTTP 4xx/5xx ve `{ "ok": false, "error": "Kağıt bitti" }`. Hata metni kasiyere aynen gösterilir.

`POST /receipt` gövdesi:

```json
{
  "sale_id": 51, "receipt_no": "20261030-0001", "created_at": "2026-10-30 18:26:11",
  "cashier": "Ali", "register_name": "Kasa 1",
  "business": { "name": "Yıldız Market", "tax_number": "1234567890" },
  "customer": { "name": "Mehmet Kaya", "tax_number": null },
  "items": [
    { "name": "Beyaz Peynir", "barcode": "2700123", "qty": 1.25, "unit": "kg",
      "unit_price": 32000, "discount": 0, "vat_rate": 1, "line_total": 40000 }
  ],
  "subtotal": 40000, "discount": 0, "total": 40000,
  "payments": [ { "method": "card", "amount": 40000 } ]
}
```

Ödeme yöntemlerinin cihazda karşılığı:

| `method` | ÖKC'de |
|---|---|
| `cash` | Nakit |
| `card` | Kredi kartı: ÖKC eşleşmiş POS'ta kartı çeker, onay gelince fişi kapatır |
| `transfer` | Havale/EFT (diğer ödeme tipi) |
| `credit` | Açık hesap / cari (veresiye) |
| `points` | Fiş altı indirim ya da "diğer" ödeme tipi (işletmenin mali müşavirine göre) |
| `online` | Yemek platformunda online ödenmiş sipariş: "diğer" ödeme tipi (`DIGER`) |

Fiş geneli indirim (`discount`) satırlara dağıtılmadan fiş altı indirim olarak gönderilir.

## Hazır ara program şablonu (C#)

`bridge/adapter-dotnet/` — `command` adaptörüyle çalışan C# programı. Fiş akışının tamamı (KDV grubu ve ödeme
eşleme, fiş altı indirim, hata olursa fiş iptali) ortak sınıftadır ve simülatörle test edilir; her marka için
yalnızca üreticinin SDK çağrıları doldurulur. Ayrıntılar: `bridge/adapter-dotnet/README.md`.

## `command` adaptörü (gerçek cihaz)

Köprü her işlemde `OKC_COMMAND` programını çalıştırır; isteği **stdin**'den JSON verir, **stdout**'tan JSON bekler:

```json
// stdin
{ "action": "receipt", "data": { … POST /receipt gövdesi … } }
// stdout
{ "ok": true, "fiscal_no": "0042", "z_no": "0153" }
```

Böylece üreticinin .NET / C++ / Delphi kütüphanesini saran küçük bir program (C# ile birkaç yüz satır)
Node koduna dokunmadan bağlanır. Köprü istekleri sıraya koyar; cihaz aynı anda tek iş yapar.

## Marka bazında yol haritası

| Marka | Yol | Not |
|---|---|---|
| **Beko / Token** (300TR, 400TR, X30TR) | Token geliştirici portalı (developer.tokeninc.com) | Android cihazlarda uygulama-içi entegrasyon da mümkün; en geniş kurulu taban |
| **Pavo** | Pavo entegrasyon kütüphaneleri | Android POS; restoran yazılımlarıyla ortaklıkları var |
| **Hugin** | Üreticiden GMP-3 kütüphanesi | Barkod programlarında yaygın |
| **Ingenico** (Move 5000F) | iKasa GMP-3 entegrasyonu | TÜBİTAK onaylı GMP-3 |

Her marka için: üreticiyle entegrasyon sözleşmesi → SDK ve test cihazı → `command` adaptörü programı → sahada test.

## 2026 notları

- 1 Ocak 2026'dan itibaren büyükşehirlerde birçok bakkal, market ve fırın basit usulden gerçek usule geçti;
  bu işletmeler YN ÖKC kullanmak zorunda.
- VUK Tebliğ 593 (8 Mayıs 2026) ile e-Fatura / e-Arşiv belgeleri YN ÖKC üzerinden de düzenlenebiliyor.
  Köprü sözleşmesine ileride `POST /e-document` ucu eklenebilir.
- 2026 fatura düzenleme sınırı 12.000 TL (KDV dahil): üzerindeki satışlarda fatura gerekir (bkz. e-Arşiv).
