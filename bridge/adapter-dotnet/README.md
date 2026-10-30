# VelarisOkc — yazarkasa ara programı (C#)

VelarisKasa'nın yazarkasa köprüsü (`bridge/okc-bridge.js`) her mali fiş, iade ve Z raporu için bu programı çalıştırır.
Program isteği **stdin**'den JSON olarak alır, cihazla konuşur, sonucu **stdout**'a JSON olarak yazar.

```
VelarisKasa ──HTTP──► okc-bridge.js ──stdin/stdout──► VelarisOkc.exe ──GMP-3 (üretici SDK)──► Yazarkasa
```

## Yapı

| Dosya | Görev |
|---|---|
| `Drivers/GmpDriverBase.cs` | Ortak fiş akışı: doğrulama, KDV grubu ve ödeme eşleme, fiş altı indirim, hata olursa fiş iptali |
| `Drivers/SimulatorDriver.cs` | Cihazsız deneme; ortak akışın tamamından geçer |
| `Drivers/VendorDrivers.cs` | Beko/Token, Hugin, Ingenico, Pavo sürücüleri — `TODO SDK` yerleri üretici çağrılarıyla doldurulur |
| `okc.example.json` | Marka, bağlantı, KDV grupları, ödeme tipleri (`okc.json` olarak kopyalayın) |

## Derleme ve deneme

```bash
dotnet publish bridge/adapter-dotnet -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o okc
```

```bash
echo '{"action":"status"}' | okc/VelarisOkc.exe
```

Köprüyle birlikte (kasa bilgisayarında):

```bash
OKC_ADAPTER=command OKC_COMMAND="C:\velaris\okc\VelarisOkc.exe" node bridge/okc-bridge.js
```

VelarisKasa'da Ayarlar → Yazarkasa → "Yazarkasa köprüsü", adres `http://127.0.0.1:4850`, "Bağlantıyı test et".

## Bir markayı bağlamak

1. Üreticiyle entegrasyon sözleşmesi yapıp GMP-3 SDK'sını ve teknik dokümanı alın; test cihazı isteyin.
2. SDK'yı `lib/` klasörüne koyup `VelarisOkc.csproj` içindeki `Reference` bloğunu açın.
3. `VendorDrivers.cs` içinde ilgili sınıfta temel işlemleri (`Connect`, `BeginSaleReceipt`, `AddItem`,
   `ApplySubtotalDiscount`, `AddPayment`, `CloseReceipt`, `VoidReceipt`, `PrintZReport`) SDK çağrılarıyla doldurun.
   Akış ve hata yönetimine dokunmanız gerekmez.
4. `okc.json`'da cihazdaki KDV gruplarını (departman numaraları) ve ödeme tiplerini cihazın tanımlarına göre ayarlayın.
5. Test cihazında: nakit, kart (onay ve ret), parçalı ödeme, fiş altı indirim, kg'lı ürün, Z raporu senaryolarını deneyin.

Hata olursa program `{ "ok": false, "error": "…" }` döner; VelarisKasa satışı kaydeder ve "Yazarkasaya tekrar gönder"
seçeneğini gösterir. Açık kalan fiş otomatik iptal edilir.
