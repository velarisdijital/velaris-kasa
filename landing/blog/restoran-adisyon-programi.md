---
title: Kafe ve restoran adisyon programı: masa, QR menü, mutfak ekranı ve paket servis
description: Kafe ve restoranlar için adisyon programında olması gerekenler: masa planı, garson telefonundan sipariş, mutfak ekranı (KDS), QR menü, hesap bölme, paket servis ve reçeteli stok.
date: 2026-11-09
keywords: restoran adisyon programı, kafe adisyon programı, mutfak ekranı, qr menü, garson sipariş uygulaması, masa takip programı
---
**Kısa cevap:** Bir kafe ya da restoran adisyon programında masa planı, garsonun telefondan sipariş alması, siparişin mutfak ekranına düşmesi, QR menü, hesap bölme, paket servis ve reçeteli stok olmalı. Tüm cihazlar (kasa tableti, garson telefonları, mutfak ekranı) aynı sunucuya bağlanmalı ki herkes aynı adisyonu görsün.

## Olması gerekenler

| Özellik | Ne sağlar |
|---|---|
| Masa planı | Salon / bahçe, dolu-boş, açık adisyon tutarı |
| Garson modu | Garson yalnızca masaları görür, telefondan sipariş girer |
| Mutfak ekranı (KDS) | Sipariş mutfağa sesli düşer; hazırlanıyor → hazır; süre uyarısı |
| Bar ekranı | İçecekler ayrı ekrana; kategori bazında yönlendirme |
| QR menü | Müşteri masadaki QR'dan menüye bakar, garson çağırır, hesap ister |
| Hesap bölme | Kişi başı ya da ürün ürün ödeme |
| İptal / ikram | Sebebiyle kayıt, yetkiye bağlı |
| Paket servis | Telefon ve gel-al siparişi, kurye, teslim |
| Reçeteli stok | Satılan ürünün malzemeleri stoktan düşer, maliyet hesaplanır |
| Happy hour | Belirli saatlerde otomatik indirim |

## Mutfak ekranı neden fişten iyi?

Mutfak fişi kaybolur, kirlenir, sırası karışır. Mutfak ekranında siparişler geliş sırasıyla görünür, 10 dakikayı geçen sarı, 20 dakikayı geçen kırmızı yanar. Aşçı "Hepsi hazır" dediğinde garsonun ekranında masa "Mutfak: 2 hazır" olarak görünür.

## VelarisKasa'da kafe ve restoran

VelarisKasa'da masa planı, garson modu, mutfak ve bar ekranı, QR menü (masadan garson çağırma ve sipariş isteği), hesap bölme, iptal/ikram raporu, paket servis ve kurye, reçeteli stok ve saatlik kampanyalar vardır. Mutfak için ayrı bir "Mutfak" kullanıcı rolü yalnızca mutfak ekranını görür. Cihazlar dükkândaki Windows bilgisayarına ya da bulut sunucuya bağlanır. Masa ve adisyon Esnaf paketinde (599 ₺/ay, KDV hariç) başlar.

## Sık sorulanlar

### Garson telefondan sipariş alabilir mi?
Evet. Garson rolündeki kullanıcı telefonunda yalnızca masaları görür, sipariş girer ve "Mutfağa" der; ödeme kasada alınır.

### Mutfak ekranı için ne gerekir?
Mutfakta duvara ya da tezgâha koyulan herhangi bir Android tablet. Tablet sunucuya bağlanır, "Mutfak" kullanıcısıyla giriş yapılır.

### Yemeksepeti, Getir, Trendyol siparişleri gelir mi?
VelarisKasa'da yemek platformu siparişleri için bağlantı altyapısı (web kancası) vardır; her platformla API anlaşması yapıldıktan sonra siparişler paket ekranına düşer.
