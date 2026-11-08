# Birden çok cihaz (kasa, garson, mutfak)

Tablet uygulaması kutudan çıktığı gibi **tek başına** çalışır: veriler o tablettedir. Birden çok cihaz aynı
veriyi kullanacaksa (iki kasa, garson telefonu, mutfak ekranı) hepsi aynı **VelarisKasa sunucusuna** bağlanır.

## Sunucu nerede çalışır?

| Seçenek | Ne gerekir | Ne zaman |
|---|---|---|
| **Dükkandaki Windows bilgisayarı** | VelarisKasa Windows programı (kurulum dosyası) | İnternet kesilse de dükkan çalışsın isteniyorsa. Program açılışta ağ adresini gösterir (ör. `192.168.1.20:4848`). Bilgisayar açık kalmalı. |
| **Bulut sunucu** | `docs/BULUT_KURULUM.md` (Docker + HTTPS) | Şubeler, evden rapor bakma, e-Fatura ve yemek platformları için. Adres: `https://kasa.isletmeniz.com` |

Sunucu, tablet uygulamasının bağlanabilmesi için CORS'a izin verir (kimlik doğrulama Bearer anahtarıyla).
Bulutta lisans anahtarı girilmelidir (tablet uygulamasında tüm özellikler açıktır, sunucuda lisansa bakılır).

## Tableti sunucuya bağlama

**Var olan tablet (verileri sunucuya taşır):** Ayarlar → Bu cihaz → *Veri konumu* → sunucu adresi →
*Sunucuyu dene* → *Bu tabletteki verileri sunucuya taşı ve bağlan*. Yalnızca **boş** (kurulumu yapılmamış)
sunucuya taşınır; ürünler, satışlar, müşteriler, kullanıcılar ve ayarlar gider, oturum açık kalır.
Önce Ayarlar → Yedekleme'den bir yedek almanız önerilir.

**Yeni cihaz (garson telefonu, mutfak tableti):** İlk açılışta kurulum ekranının altındaki
*Birden çok cihaz mı kullanacaksınız?* → adres → *Bu sunucuyu kullan* → kendi kullanıcınızla giriş.

**Geri dönmek:** Ayarlar → Bu cihaz → *Bu tablete dön*. Sunucudaki veriler sunucuda kalır, tablette
sunucuya geçmeden önceki veriler açılır.

Sunucuya ulaşılamazsa uygulama "Sunucuya ulaşılamıyor" der; *Tekrar dene* ya da geçici olarak
*Bu tabletin kendi verisiyle aç*. Kasa ekranı çevrimdışıyken satışlar kuyruğa alınır, bağlantı gelince gönderilir.

## Mutfak ekranı

- Ayarlar → Kullanıcılar → yeni kullanıcı, rol **Mutfak**: bu kullanıcı yalnızca mutfak ekranını görür.
- Stok → Kategoriler: her kategori için *Mutfak ekranı / Bar ekranı / Ekrana düşmez* (paketli su, kola…).
- Garson "Mutfağa" dediğinde siparişler mutfak ekranına düşer (sesli uyarı). Kaleme dokun → hazırlanıyor →
  hazır; *Hepsi hazır* garsonun masasında "Mutfak: n hazır" olarak görünür; *Teslim edildi* ekrandan kaldırır.
- 10 dakikayı geçen sipariş sarı, 20 dakikayı geçen kırmızı çerçevelenir.

## Neler yalnızca sunucu modunda çalışır?

- e-Fatura / e-Arşiv (Paraşüt): tablet uygulaması Paraşüt'e doğrudan bağlanamaz.
- Yemek platformlarından gelen siparişler (web kancası) ve QR menüden sipariş: müşterinin telefonu
  sunucuya ulaşabilmeli (bulut ya da dışarı açılmış adres).

## Test

`node scripts/build-app.mjs && node scripts/e2e/multi-device.e2e.cjs` — gerçek sunucu + iki tablet
(sahte Android köprüsü): veri taşıma, ikinci cihazın bağlanması, mutfak kullanıcısı, masadan mutfağa
sipariş, "hazır"ın garsona görünmesi. APK derlemesinden önce CI'da çalışır.
