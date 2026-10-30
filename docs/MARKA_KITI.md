# VelarisKasa Marka Kiti

VelarisKasa, **Velaris Dijital**'in ürün markasıdır. Görsel dili ana markadan gelir: mürekkep siyahı ve kâğıt
beyazı zeminler, sade bir grotesk yazı, renk yalnızca logodaki dört kolda ve küçük vurgularda.

Dosyalar: `brand/` (tokenlar, logo üreticisi, SVG/PNG çıktıları).

## Ad

- Yazımı: **VelarisKasa** (metin içinde, tek kelime, iki büyük harf).
- Logoda: **velaris**kasa — küçük harf, "velaris" kalın, "kasa" ince, bitişik.
- Kullanmayın: "Velaris Kasa", "VELARISKASA", "Velaris-Kasa", "VK".

## Logo

| Dosya | Kullanım |
|---|---|
| `brand/logo/velariskasa-light.svg` | Açık (kâğıt/beyaz) zeminde ana logo |
| `brand/logo/velariskasa-dark.svg` | Koyu (mürekkep) zeminde ana logo |
| `brand/logo/velariskasa-mono-ink.svg` / `-mono-paper.svg` | Tek renk baskı, fiş, damga |
| `brand/logo/mark.svg` | Yalnız simge (alan darsa) |
| `brand/logo/app-icon.svg` | Uygulama ikonu, favicon |

- **Boşluk:** logonun çevresinde en az simge yüksekliğinin yarısı kadar boşluk bırakın.
- **En küçük boyut:** yatay logo 120 px genişlik; altında yalnız simgeyi kullanın.
- **Yapmayın:** simgenin renk sırasını değiştirmek (üst turuncu, sağ mor, alt yeşil, sol sarı), logoyu gerdirmek,
  gölge/degrade eklemek, renkli zemin üzerinde renkli logo kullanmak (renkli zeminde tek renk logo).

Logolar yazı tipinden vektöre çevrilmiştir; yeniden üretmek için: `node brand/build.mjs && node brand/export-png.cjs`.

## Renkler

| Ad | HEX | Rol |
|---|---|---|
| Mürekkep | `#121212` | Koyu zemin, ana metin |
| Kâğıt | `#F2EFEA` | Açık zemin |
| Beyaz | `#FFFFFF` | Kart yüzeyi |
| Çizgi | `#DCD8D1` | Kenarlık (açık zemin) · koyu zeminde `#3A3936` |
| İkincil metin | `#6B6862` | Açıklamalar · koyu zeminde `#BDB8B0` |
| Turuncu | `#FF4D1A` | Vurgu, dikkat çekilecek tek öğe |
| Mor | `#7B5CFF` | Birincil düğme, grafik çubukları |
| Sarı | `#FFC21A` | Logo; koyu zeminde küçük vurgu |
| Yeşil | `#20C4A0` | Logo; olumlu durum vurgusu |

Oran: zeminin ~%80'i mürekkep/kâğıt, metin mürekkep/kâğıt, renk %10'u geçmesin. Bir ekranda tek bir turuncu vurgu.

Erişilebilirlik: turuncu ve sarı **açık zeminde metin rengi olarak kullanılmaz** (kontrast yetersiz); mor üzerinde
beyaz metin kullanılabilir. Arayüzdeki başarı/hata/uyarı renkleri ayrıdır: `#13855F`, `#D6361A`, `#A86A00`.

> Renkler Velaris Dijital'in Canva tasarımlarından (zemin, metin, çizgi, turuncu, mor) ve Velaris logo görselinin
> piksellerinden (dört kolun renkleri) birebir alındı.

## Yazı

- **Archivo** (Velaris marka kılavuzundaki aile). Başlıklar 400–500 ağırlık, büyük ve sıkı satır aralığı (1.05);
  logo ve kısa etiketler 800. Gövde 400, satır aralığı 1.5.
- Rakamlar her yerde eş genişlikli (`font-variant-numeric: tabular-nums`) — fiyat, stok ve rapor sütunları hizalansın.
- Uygulama yazı tipini kendi içinde taşır (`@fontsource/archivo`), internet olmadan da aynı görünür.

## Ses

Velaris gibi: kısa, net, rakamla konuşan. Esnafın diliyle yazın (veresiye, gün sonu, fiş), teknik terimi açıklayın.

- ✓ "Gün sonunu 1 dakikada al." · ✓ "Yazarkasana bağlanır." · ✓ "Sürpriz ücret yok."
- ✗ "Yapay zekâ destekli devrim niteliğinde çözüm" · ✗ ünlem yığını · ✗ İngilizce jargon (dashboard, insight)

## Dosya listesi

```
brand/
  tokens.json   tokens.css        renk / yazı / köşe tokenları
  build.mjs     export-png.cjs    logo üreticileri
  logo/         SVG ve PNG logolar, uygulama ikonu
```
