# Yazarkasa (ÖKC) ve e-Fatura: ne hazır, ne gerekiyor

Bu iki konu yalnızca yazılımla bitmez: üretici / sağlayıcı ile anlaşma ve gerçek cihaz gerekir.
Bu belge ne hazır olduğunu ve Velaris Dijital'in yapması gereken adımları listeler.

## 1. Yazarkasa (YN ÖKC)

**Kodda hazır olan:** `server/fiscal.js` sürücü katmanı (satış, iade, Z raporu, durum), Windows köprü
programı şablonu (`bridge/`, Beko/Token, Hugin, Ingenico, Pavo için yer tutucular) ve simülatör. Gerçek bir
cihazla **denenmedi ve onaylı değil**.

"Onaylı entegrasyon" için seçilecek üreticiyle iş ortaklığı yapılmalı. Araştırmada bulunanlar
(kaynaklar bayi ve forum sayfaları; resmî şartlar üreticiden teyit edilmeli):

| Üretici | Entegrasyon yolu | Not |
|---|---|---|
| **PAVO** (Android POS) | REST, A2A (uygulamadan uygulamaya), Cloud, RS232. Java / React Native / Flutter örnekleri var (bildirilen). | **Önerilen.** Cihaz Android olduğu için VelarisKasa doğrudan PAVO cihazında çalışıp PavoPay'e A2A ile fiş kestirebilir; tablet + ayrı ÖKC gerekmez. Çözüm ortağı paneli üzerinden üye işyeri / cihaz eşleştirme yapılıyor. Akınsoft her cihaz için yıllık "mali uygulama ücreti" alıyor (eski bir sayfada 9.750 TL + KDV). İletişim: PAVO kurumsal satış. |
| **Hugin** | Açık SDK: github.com/huginsdk/fpu — LAN / RS232, C# ve Java, Windows/Linux yerel kütüphane | En hızlı başlangıç: köprü programına (`bridge/`) eklenebilir. **GPL-2.0 lisanslı** ve son güncelleme 2020: ayrı süreç (köprü) olarak kullanılmalı, lisans hukukçuya sorulmalı. Yeni Android Hugin modelleri için güncel SDK istenmeli. |
| **Ingenico** (GMP3) | GMP3 kütüphanesi; uygulama Ingenico'ya gönderilip hash alınıyor | Bildirildiğine göre en pahalı ve en uzun süreç. |
| **Beko / Token** (GMP3, TokenX Connect) | Cihaz başına GMP3 entegrasyon lisansı | Kablolu entegrasyon; Token ile anlaşma. |

**Yapılacaklar (Velaris Dijital):**
1. Bir üretici seçin (öneri: PAVO, ya da hızlı deneme için Hugin).
2. Üreticiden: geliştirici dokümanı / SDK, test cihazı (ya da test modu), çözüm ortağı sözleşmesi ve ücretler.
3. Dokümanlar gelince sürücüyü yazarım: PAVO için Android eklentisi (A2A), Hugin için köprü programı.
4. Test cihazıyla satış, iade, Z raporu, kâğıt bitti / bağlantı koptu senaryoları denenir.

## 2. e-Fatura / e-Arşiv

**Kodda hazır olan:** Paraşüt API v4 entegrasyonu (`server/invoice.js`): müşteri kaydı → satış faturası →
alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv; nihai tüketici, fiş indirimi dağıtımı, durum sorgulama.
Paraşüt aynı zamanda ön muhasebe olduğu için her fatura muhasebeye de işlenir.

**Gerekenler:**
1. Paraşüt aboneliği ve hesapta e-Arşiv / e-Fatura başvurusunun tamamlanması.
2. Paraşüt destekten **API erişimi** (client_id, client_secret) istenmesi. Doküman: apidocs.parasut.com
3. Ayarlar → e-Fatura → Paraşüt bilgileri. **Sunucu modunda** çalışır (tablet tek başına Paraşüt'e bağlanamaz).
4. Önce birkaç deneme faturası; ardından gerçek kullanım.

Başka bir entegratör (ör. kendi e-Fatura özel entegratörünüz) istenirse, onun API dokümanı ve test hesabı ile
`server/invoice.js`'e yeni sağlayıcı eklenir.

## 3. Muhasebe aktarımı

Raporlar → *Muhasebe aktarımı*: seçili tarihlerin günlük satış özeti (KDV oranına göre matrah / KDV, ödeme
türleri), satış fişleri, iadeler ve alış faturaları; Excel uyumlu CSV. Muhasebeci Logo, Mikro, Luca, Zirve vb.
programına Excel'den aktarır. Paraşüt kullananlarda faturalar zaten Paraşüt'e işlenir.
