# Bulutta Kurulum ve Şubeler

Velaris Kasa üç şekilde çalışabilir:

| Kurulum | Ne zaman | İnternet kesilirse |
|---|---|---|
| **Masaüstü (ana kasa PC)** | Tek dükkân; veriler dükkânda | Dükkân içi ağda çalışmaya devam eder |
| **Bulut sunucusu** | Online randevu, uzaktan rapor, birden çok şube | Kasalar çevrimdışı satış yapar, bağlantı gelince gönderir |
| **İkisi birlikte** | Dükkânda masaüstü + uzaktan erişim | — |

Online randevu sayfasının ve randevu SMS'lerindeki bağlantının müşterilerce açılabilmesi, telefon kamerasıyla barkod
okuma (tarayıcılar kamerayı yalnızca `https` adreste açar) için programın **https** bir adreste çalışması gerekir.

## Docker ile (önerilen)

Gereken: Ubuntu/Debian bir sunucu (1 vCPU, 1 GB RAM yeterli), Docker, bir alan adı.

1. Alan adınızın (ör. `kasa.isletmem.com`) **A kaydını** sunucunun IP adresine yönlendirin.
2. Projeyi sunucuya alın ve başlatın:

```bash
git clone https://github.com/velarisdijital/velaris-kasa.git
```

```bash
cd velaris-kasa && DOMAIN=kasa.isletmem.com docker compose up -d
```

3. `https://kasa.isletmem.com` adresini açın; kurulum sihirbazı başlar. Sertifikayı Caddy otomatik alır ve yeniler.
4. Ayarlar → **Online randevu** ve **SMS & WhatsApp** → "İnternet adresi" alanına `https://kasa.isletmem.com` yazın.

- Veriler `kasa-data` Docker biriminde (`/data/velaris-kasa.db`) durur. Ayarlar → Yedekleme'den indirilebilir.
- Saat dilimi imajda `Europe/Istanbul` olarak ayarlıdır (raporlar ve randevular için önemli).
- Güncelleme: `git pull && docker compose up -d --build`

## Docker olmadan

Node.js 20+ ve bir ters vekil (Nginx/Caddy) ile:

```bash
npm ci && npm run build
```

```bash
TZ=Europe/Istanbul VELARIS_DATA_DIR=/var/lib/velaris-kasa PORT=4848 node server/index.js
```

Ters vekil `X-Forwarded-For` başlığını iletmeli (online randevudaki kötüye kullanım sınırı gerçek IP'ye göre çalışır).
Farklı bir vekil ağı için `TRUST_PROXY` ortam değişkenini ayarlayın.

## Şubeler ve birden çok kasa

- Her cihaz Ayarlar → **Bu cihaz** → "Kasa adı" ile adlandırılır. Şubeli işletmelerde adı
  **"Şube Kasa N"** biçiminde verin: `Kadıköy Kasa 1`, `Kadıköy Kasa 2`, `Beşiktaş Kasa 1`.
- Gün sonu (Z raporu) her kasa için ayrıdır.
- **Raporlar** ekranında kasa/şube seçilebilir; "Kadıköy (tüm kasalar)" seçeneği o şubenin bütün kasalarını toplar.
- Stok şu sürümde tek depodur (bütün şubeler aynı stoğu görür). Şube bazlı ayrı stok gerekiyorsa her şube için
  ayrı kurulum yapılabilir; raporlar Velaris CRM'de birleşir.

## Yazarkasa ile bulut

Yazarkasa köprüsü (`bridge/okc-bridge.js`) her zaman **dükkândaki** bilgisayarda çalışır. Program buluttaysa
kasa sunucusunun köprüye ulaşabilmesi için köprü adresi dükkânın erişilebilir bir adresi olmalı (VPN önerilir).
Yazarkasalı dükkânlarda en basit yol, dükkânda masaüstü kurulum kullanmaktır.
