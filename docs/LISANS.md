# Paketler ve Lisans

| | Ücretsiz | Esnaf | Salon | Pro |
|---|---|---|---|---|
| Aylık (KDV hariç) | 0 ₺ | 599 ₺ | 799 ₺ | 1.290 ₺ |
| Aynı anda açık kasa | 1 | 3 | 3 | Sınırsız |
| Kullanıcı | 1 | Sınırsız | Sınırsız | Sınırsız |
| Satış, stok, alış/tedarikçi, veresiye, gün sonu, raporlar | ✓ | ✓ | ✓ | ✓ |
| Yazarkasa, e-Arşiv, puan, SMS/WhatsApp, masa/adisyon | | ✓ | ✓ | ✓ |
| Randevu, online randevu, otomatik hatırlatma | | | ✓ | ✓ |
| Toplu kampanya, Velaris CRM, şube bazlı stok, API | | | | ✓ |

Tanım: `server/license.js` (`PLANS`). Fiyatları ve paket içeriklerini burada değiştirin; landing
(`landing/page.html`) ve Ayarlar → Paket ekranı aynı bilgiyi gösterir.

## Lisans anahtarı

- Biçim: `VK1.<veri>.<imza>`. Veri: `{ lic, plan, business, issued, exp, install? }`, imza: Ed25519.
- Program yalnızca **açık anahtarı** (`server/license-public.pem`) taşır, doğrulama internetsiz yapılır.
  Anahtarın verisi değiştirilirse imza tutmaz.
- Süre bitince 7 gün ek süre verilir, sonra program Ücretsiz pakete döner. **Veriler silinmez.**
- `install` verilirse anahtar yalnızca o kurulumda çalışır (kurulum kimliği Ayarlar → Paket'te yazar).

## Lisans üretme (yalnızca Velaris Dijital)

Gizli anahtar `.license/private.pem` dosyasındadır; depoya **eklenmez** (`.gitignore`). Kaybederseniz yeni
anahtar çifti üretip programı yeniden dağıtmanız ve bütün lisansları yeniden vermeniz gerekir.

```bash
node scripts/license.mjs issue --plan esnaf --business "Yıldız Market" --months 12
```

```bash
node scripts/license.mjs issue --plan salon --business "Makas Kuaför" --months 1 --install 3f1c-…
```

Çıkan `VK1.…` anahtarını müşteri Ayarlar → Paket → "Etkinleştir" ile girer.

Yeni anahtar çifti (bir kez): `node scripts/license.mjs keygen` → `server/license-public.pem` güncellenir.

## Not

Masaüstü programda lisans denetimi dürüst kullanıcıyı yönlendirmek içindir; kaynak kodu değiştiren biri
denetimi atlatabilir. Bulut kurulumunda (sunucu sizde) denetim tam etkilidir.
