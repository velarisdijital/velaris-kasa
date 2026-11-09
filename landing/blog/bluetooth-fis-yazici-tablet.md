---
title: Tablete Bluetooth fiş ve etiket yazıcısı nasıl bağlanır? (ESC/POS, TSPL, 58/80 mm) — 2026
description: Android tablete Bluetooth fiş yazıcısı, etiket yazıcısı ve para çekmecesi bağlama rehberi. ESC/POS ve TSPL farkı, eşleştirme, boş çıktı ve kırmızı ışık sorunlarının çözümü.
date: 2026-11-09
keywords: bluetooth fiş yazıcısı, tablet fiş yazıcı bağlama, esc/pos yazıcı, etiket yazıcısı tablet, 58mm termal yazıcı, para çekmecesi
---
**Kısa cevap:** Tablete Bluetooth fiş yazıcısı bağlamak için yazıcıyı açın, kasa programının yazıcı ayarlarından "Yazıcı ara" deyin, listeden yazıcıyı seçip eşleştirin ve deneme fişi basın. Fiş yazıcıları genellikle **ESC/POS**, barkod etiket yazıcıları **TSPL** komut dili konuşur; programın doğru dili seçmesi gerekir. VelarisKasa her ikisini de destekler, fiş yazıcısına bağlı para çekmecesini nakit satışta otomatik açar.

## Hangi yazıcı ne işe yarar?

| Yazıcı | Komut dili | Kâğıt | Kullanım |
|---|---|---|---|
| Fiş yazıcısı | ESC/POS | 58 mm / 80 mm termal rulo | Satış fişi, Z raporu, mutfak fişi |
| Etiket yazıcısı | TSPL (bazen ZPL) | Etiket rulosu (ör. 40×30 mm) | Raf etiketi, barkod etiketi |
| Para çekmecesi | Fiş yazıcısından (RJ11) | — | Nakit satışta açılır |

## Adım adım bağlama

1. **Yazıcıyı şarj edin ve açın.** Kâğıdı termal yüzü dışa bakacak şekilde takın (ters takılan kâğıt boş çıkar).
2. **Tabletin Bluetooth ve konum izinlerini açın.** Android, yakındaki cihazları aramak için bu izinleri ister.
3. **Programdan arayın.** VelarisKasa'da Ayarlar → Fiş yazıcısı (ya da Etiket yazıcısı) → "Yazıcı ara". Eşleşmemiş yazıcılar da listelenir; seçince eşleştirme istenir (PIN genellikle 0000 ya da 1234).
4. **Deneme fişi basın.** Yazı soluksa yoğunluğu artırın; karakterler bozuksa doğru kâğıt genişliğini seçin.
5. **Çekmeceyi deneyin.** Çekmece kablosu yazıcının arkasındaki RJ11 girişine takılır; "Çekmeceyi aç" ile denenir.

## Sık karşılaşılan sorunlar

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Program yazıcıyı bulamıyor | Konum/yakındaki cihaz izni kapalı | İzinleri açın, yeniden arayın |
| Boş kâğıt çıkıyor | Kâğıt ters takılı | Rulonun yönünü çevirin |
| Etiket yazıcısı kırmızı yanıyor | Etiket aralığı algılanmıyor ya da düz rulo takılı | Programda "Kalibre et"; düz rulo için "Yazıcıda takılı rulo" seçin |
| Yazı yarım kalıyor | Veri çok hızlı gönderiliyor | Programda yazdırma hızını "Yavaş" yapın |
| Türkçe karakter bozuk | Kod sayfası uyumsuz | Fişi görüntü (raster) olarak basan program kullanın |

VelarisKasa fişi görüntü olarak bastığı için Türkçe karakter sorunu yaşanmaz; yazdırma hızı ayarı ve etiket yazıcısı için kalibrasyon/durum sorgusu vardır.

## Hangi yazıcıyı almalı?

- **Fiş için:** ESC/POS destekli, Bluetooth'lu 58 mm (küçük tezgâh) ya da 80 mm (market, restoran) termal yazıcı.
- **Etiket için:** TSPL destekli, Bluetooth'lu taşınabilir etiket yazıcısı.
- **Hem fiş hem etiket:** İki ayrı yazıcı tanımlanabilir; program fişi fiş yazıcısına, etiketi etiket yazıcısına gönderir.

## Sık sorulanlar

### Her Bluetooth yazıcı tabletle çalışır mı?
Klasik Bluetooth (SPP) ya da BLE üzerinden ESC/POS veya TSPL komutu kabul eden yazıcıların çoğu çalışır. Yalnızca kendi uygulamasıyla çalışan kapalı yazıcılar çalışmayabilir.

### Bluetooth fiş yazıcısı mali fiş basar mı?
Hayır. Bluetooth fiş yazıcısı bilgi fişi basar; mali fiş yalnızca yazarkasa (ÖKC) ile kesilir.

### USB barkod okuyucu tablete bağlanır mı?
Evet, OTG kablosuyla. Bluetooth barkod okuyucular da klavye gibi çalışır; VelarisKasa kasa ekranındayken hiçbir yere dokunmadan okutulan barkodu sepete ekler.
