// Uçtan uca test: Android uygulaması (dist-app) sahte Capacitor köprüsüyle Chromium'da açılır,
// Ayarlar → Bu cihaz → Yazıcı ara akışı gerçek arayüzden tıklanarak denenir.
//   node scripts/build-app.mjs && node scripts/e2e/android-printer.e2e.cjs [ekran-görüntüsü-klasörü]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../dist-app');
const shots = process.argv[2];
const fail = (msg) => { console.error('BAŞARISIZ:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓', msg);
// Sahte "son sürüm": uygulamanın kendi derleme numarasından (CI'da VK_BUILD_NUMBER) bir fazlası
const NEXT = Math.max(Number(process.env.VK_BUILD_NUMBER || 0), 14) + 1;

/** Son gönderilen ESC/POS verisindeki GS v 0 bantlarını birleştirip PNG kaydeder (gözle kontrol için). */
async function saveEscPos(p, file) {
  const url = await p.evaluate(() => {
    const bin = atob(window.__fake.lastData);
    const b = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const bands = [];
    for (let i = 0; i < b.length - 8; i++) {
      if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) {
        const wb = b[i + 4] + b[i + 5] * 256; const h = b[i + 6] + b[i + 7] * 256;
        bands.push({ wb, h, start: i + 8 }); i += 8 + wb * h - 1;
      }
    }
    const W = bands[0].wb * 8; const H = bands.reduce((a, x) => a + x.h, 0);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); const img = x.createImageData(W, H); let y0 = 0;
    for (const band of bands) {
      for (let y = 0; y < band.h; y++) for (let i = 0; i < W; i++) {
        const on = (b[band.start + y * band.wb + (i >> 3)] >> (7 - (i & 7))) & 1;
        const k = ((y0 + y) * W + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = on ? 0 : 255; img.data[k + 3] = 255;
      }
      y0 += band.h;
    }
    x.putImageData(img, 0, 0); return c.toDataURL();
  });
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

/** Son gönderilen TSPL verisindeki her BITMAP'i PNG olarak kaydeder (gözle kontrol için). */
async function saveTsplPages(p, prefix) {
  const urls = await p.evaluate(() => {
    const bin = atob(window.__fake.lastData);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const out = [];
    const re = /BITMAP 0,0,(\d+),(\d+),0,/g;
    let m;
    while ((m = re.exec(bin))) {
      const wb = +m[1]; const h = +m[2]; const start = m.index + m[0].length;
      const c = document.createElement('canvas'); c.width = wb * 8; c.height = h;
      const x = c.getContext('2d'); const img = x.createImageData(c.width, h);
      for (let y = 0; y < h; y++) for (let i = 0; i < wb * 8; i++) {
        const v = ((bytes[start + y * wb + (i >> 3)] >> (7 - (i & 7))) & 1) ? 255 : 0;
        const k = (y * c.width + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
      }
      x.putImageData(img, 0, 0); out.push(c.toDataURL());
    }
    return out;
  });
  urls.forEach((u, i) => fs.writeFileSync(`${prefix}-${i + 1}.png`, Buffer.from(u.split(',')[1], 'base64')));
}

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.addInitScript({ path: path.join(__dirname, 'fake-android-bridge.js') });
    // GitHub'daki son sürüm (uygulama içinden güncelleme): 1.0.15
    await ctx.route('https://api.github.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ name: `VelarisKasa Android 1.0.${NEXT}`, body: 'Sonraki sürümler uygulama içinden gelir. native_api=2', assets: [
        { name: 'VelarisKasa.apk', browser_download_url: 'https://github.com/velarisdijital/velaris-kasa/releases/download/android-latest/VelarisKasa.apk' },
        { name: 'VelarisKasa-web.html', browser_download_url: 'https://github.com/velarisdijital/velaris-kasa/releases/download/android-latest/VelarisKasa-web.html' }] }) }));
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); };

    // Kurulum
    await p.goto(url);
    await p.waitForSelector('input[placeholder="Örn. Yıldız Market"]', { timeout: 20000 });
    await p.fill('input[placeholder="Örn. Yıldız Market"]', 'Deneme Market');
    const inp = p.locator('form input.input');
    await inp.nth(2).fill('Ali'); await inp.nth(3).fill('1234'); await inp.nth(4).fill('1234');
    await p.getByText('Kurulumu tamamla').click();
    await p.waitForTimeout(4000);

    // Lisans: tablet uygulaması lisanssızken 14 gün Pro deneme
    await p.getByText(/Deneme sürümü: tüm özellikler \d+ gün daha açık/).waitFor({ timeout: 10000 });
    ok('Lisanssız tablet: deneme sürümü bilgisi görünüyor');

    // Ayarlar → Bu cihaz
    await p.goto(`${url}#/ayarlar`);
    await p.getByRole('button', { name: 'Bu cihaz' }).click();
    await p.getByText('Bluetooth etiket yazıcısı').waitFor({ timeout: 10000 });
    ok('Etiket yazıcısı ayarları açıldı');

    // Yazıcı ara: eşleşmiş liste, klasik arama ve BLE taraması
    await p.getByRole('button', { name: 'Yazıcı ara' }).click();
    await p.getByText('Galaxy Buds').waitFor({ timeout: 10000 });
    ok('Eşleşmiş cihazlar listelendi (uygulama takılmadı)');
    await p.getByRole('button', { name: /5510-B333-BLE/ }).waitFor({ timeout: 10000 });
    ok('BLE taramasında yazıcı bulundu');
    await p.getByRole('button', { name: /^5510-B333\s*yazıcı\s+klasik \+ BLE · dokunun, eşleşsin/ }).waitFor({ timeout: 10000 });
    ok('Klasik Bluetooth aramasında yazıcı bulundu (eşleşmeye açık)');
    await shot('1-yazici-ara');

    // Bluetooth ayarları kısayolu
    await p.getByRole('button', { name: 'Tabletin Bluetooth ayarlarını aç' }).click();
    await p.waitForFunction(() => window.__fake.settingsOpened === true, null, { timeout: 5000 });
    ok('"Tabletin Bluetooth ayarlarını aç" yerel ekranı açtı');

    // Klasik yazıcıyı seç → eşleştir → klasik Bluetooth (SPP)
    // Kullanıcı genelde listede en üstteki BLE kaydına dokunur: uygulama aynı yazıcının klasik kaydını seçmeli
    await p.getByRole('button', { name: /5510-B333-BLE/ }).click();
    await p.getByText(/Seçili: 5510-B333 · klasik Bluetooth/).waitFor({ timeout: 10000 });
    const bonded = await p.evaluate(() => window.__fake.bonded.map((d) => d.address));
    if (!bonded.includes('DC:0D:30:AA:B3:33')) fail('yazıcı eşleştirilmedi'); else ok('Yazıcı uygulama içinden eşleştirildi');
    await shot('2-secildi');

    // Deneme etiketi
    await p.getByRole('button', { name: 'Deneme etiketi bas' }).click();
    await p.waitForFunction(() => window.__fake.written > 0, null, { timeout: 15000 });
    const w = await p.evaluate(() => window.__fake.writes[0]);
    if (!/^SIZE 50 mm,30 mm/.test(w.head)) fail(`TSPL başlığı beklenmiyor: ${JSON.stringify(w.head)}`);
    else ok(`Deneme etiketi klasik Bluetooth ile gönderildi (${w.bytes} bayt, ${w.address})`);
    await shot('3-baski');

    // Uygulama yeniden açılınca kayıtlı yazıcı korunur ve "Yazıcı ara" yeniden çalışır
    await p.reload();
    await p.goto(`${url}#/ayarlar`);
    await p.getByRole('button', { name: 'Bu cihaz' }).click();
    await p.getByText(/Seçili: 5510-B333/).waitFor({ timeout: 10000 });
    await p.getByRole('button', { name: 'Değiştir' }).click();
    await p.getByRole('button', { name: /^5510-B333\s*yazıcı\s+eşleşmiş/ }).waitFor({ timeout: 10000 });
    ok('Yeniden açılışta yazıcı eşleşmiş listede');
    await p.getByRole('button', { name: 'Kapat' }).click();

    // Deneme fişi (Ayarlar)
    let before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: 'Deneme fişi bas' }).click();
    await p.getByText('Deneme fişi gönderildi').waitFor({ timeout: 20000 });
    const r1 = await p.evaluate((n) => window.__fake.writes.slice(n), before);
    if (r1.length < 2 || r1.some((w) => w.prints !== 1)) fail(`deneme fişi etiket etiket gönderilmedi (${JSON.stringify(r1.map((w) => w.prints))})`);
    else ok(`Deneme fişi ${r1.length} etiket olarak tek tek gönderildi (${r1.map((w) => w.bytes).join(' + ')} bayt)`);
    if (shots) await saveTsplPages(p, path.join(shots, 'fis'));

    // Kırmızı ışık: durum sorgusu ve kalibrasyon
    await p.getByRole('button', { name: 'Yazıcı durumu' }).click();
    await p.getByText(/Yazıcı durumu: Kâğıt yok ya da etiket algılanamıyor/).waitFor({ timeout: 10000 });
    ok('Yazıcı durumu okundu: etiket algılanamıyor (kod 4)');
    await p.getByRole('button', { name: 'Kalibre et' }).click();
    await p.getByText(/Yazıcı durumu: Hazır/).waitFor({ timeout: 15000 });
    ok('Kalibre et → GAPDETECT gönderildi, yazıcı hazır');

    // Düz fiş kâğıdı (56 mm) takıldı: yazıcı sürekli kâğıda alınır, fiş tek parça 48 mm basılır
    await p.getByLabel('Yazıcıda takılı rulo').selectOption('roll');
    await p.waitForFunction(() => /GAP 0 mm,0 mm/.test(atob(window.__fake.lastData)), null, { timeout: 10000 });
    ok('Düz fiş kâğıdı seçildi → yazıcıya GAP 0 (sürekli kâğıt) gönderildi');
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: 'Deneme fişi bas' }).click();
    await p.getByText('Deneme fişi gönderildi').last().waitFor({ timeout: 20000 });
    const r3 = await p.evaluate((n) => window.__fake.writes.slice(n), before);
    if (r3.length !== 1 || !/^SIZE 48 mm,\d+ mm\r\nGAP 0 mm,0 mm/.test(r3[0].head)) fail(`düz kâğıt fişi beklenmiyor: ${JSON.stringify(r3.map((w) => w.head))}`);
    else ok(`Deneme fişi düz kâğıda tek parça gönderildi (${r3[0].head.split('\r\n').slice(0, 2).join(' · ')})`);
    if (shots) await saveTsplPages(p, path.join(shots, 'rulo-fis'));

    // ---- Fiş yazıcısı (ESC/POS) ve para çekmecesi ----
    await p.getByRole('button', { name: 'Fiş yazıcısı ara' }).click();
    await p.getByRole('button', { name: /^RPP02N/ }).click();
    await p.getByText(/Seçili: RPP02N/).waitFor({ timeout: 10000 });
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: 'Deneme fişi bas' }).first().click();
    await p.waitForFunction((n) => window.__fake.writes.slice(n).some((w) => w.address === '66:55:44:33:22:11'), before, { timeout: 15000 });
    const esc = await p.evaluate((n) => window.__fake.writes.slice(n).find((w) => w.address === '66:55:44:33:22:11'), before);
    if (!esc.escpos || !esc.raster || !esc.tail.endsWith('\x1dVB\x00')) fail(`ESC/POS fişi beklenmiyor: ${JSON.stringify(esc)}`);
    else ok(`Deneme fişi fiş yazıcısına ESC/POS olarak gitti (raster, kesim; ${esc.bytes} bayt)`);
    if (shots) await saveEscPos(p, path.join(shots, 'escpos-fis.png'));
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: 'Çekmeceyi aç' }).click();
    await p.waitForFunction((n) => window.__fake.writes.slice(n).some((w) => w.drawer), before, { timeout: 10000 });
    ok('"Çekmeceyi aç" çekmece komutunu (ESC p) gönderdi');

    // Kasa: satış yap → "Fiş yazdır" Bluetooth yazıcıya gider
    await p.goto(`${url}#/`);
    await p.waitForTimeout(1500);
    const opening = p.getByPlaceholder('0,00').first();
    if (await p.getByText('Kasadaki nakit').count()) { await opening.fill('0'); await p.keyboard.press('Enter'); await p.waitForTimeout(800); }
    const search = p.getByLabel('Barkod veya ürün ara');
    // Kasa modu: barkod kutusu seçili ama ekran klavyesi kapalı (inputmode=none); dokununca açılır
    const scanState = () => search.evaluate((el) => ({ focused: document.activeElement === el, mode: el.getAttribute('inputmode') }));
    let st = await scanState();
    if (!st.focused || st.mode !== 'none') fail(`barkod kutusu kasa modunda değil: ${JSON.stringify(st)}`);
    else ok('Barkod kutusu seçili, ekran klavyesi kapalı (inputmode=none)');
    await search.tap().catch(() => search.click());
    await p.waitForTimeout(100);
    st = await scanState();
    if (!st.focused || st.mode === 'none') fail(`dokununca klavye açılmıyor: ${JSON.stringify(st)}`);
    else ok('Barkod kutusuna dokununca ekran klavyesi açılabiliyor');
    // Barkod kutusu seçili değilken (ekrana dokunuldu) okuyucu yine çalışmalı
    await search.fill('Ayran 250');
    const barcode = (await p.locator('.suggest small').first().innerText()).trim();
    await search.fill('');
    await p.locator('h1, .page-head, body').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.evaluate(() => document.activeElement?.blur());
    const focusedTag = await p.evaluate(() => document.activeElement?.tagName);
    await p.keyboard.type(barcode, { delay: 5 }); // okuyucu hızı
    await p.keyboard.press('Enter');
    await p.getByText('Ayran 250 ml').first().waitFor({ timeout: 5000 }).then(
      () => ok(`Barkod kutusu seçili değilken (${focusedTag}) okutulan barkod sepete eklendi (${barcode})`),
      () => fail(`seçili kutu yokken okutulan barkod sepete eklenmedi (${barcode})`));
    await search.fill('Simit'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^Nakit/ }).click();
    const given = p.locator('.modal input.input').first();
    const gm = await given.evaluate((el) => ({ focused: document.activeElement === el, mode: el.getAttribute('inputmode') }));
    if (!gm.focused || gm.mode !== 'none') fail(`nakit penceresindeki kutu klavye açıyor: ${JSON.stringify(gm)}`);
    else ok('Nakit penceresinde tutar kutusu seçili, klavye kendiliğinden açılmıyor');
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: /Satışı tamamla/ }).click();
    await p.waitForFunction((n) => window.__fake.writes.slice(n).some((w) => w.drawer && w.address === '66:55:44:33:22:11'), before, { timeout: 10000 })
      .then(() => ok('Nakit satışta para çekmecesi kendiliğinden açıldı'), () => fail('nakit satışta çekmece açılmadı'));
    await p.getByRole('button', { name: 'Fiş yazdır' }).waitFor({ timeout: 10000 });
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: 'Fiş yazdır' }).click();
    await p.getByText(/Fiş yazıcıya gönderildi/).waitFor({ timeout: 20000 });
    const r2 = await p.evaluate((n) => window.__fake.writes.slice(n), before);
    ok(`Satış fişi Bluetooth yazıcıya gönderildi (${r2.length} etiket)`);
    ok('Kullanıcıya "Fiş yazıcıya gönderildi" bildirimi gösterildi');
    if (shots) { await saveTsplPages(p, path.join(shots, 'satis-fis')); await shot('4-satis'); }

    const pacing = await p.evaluate(() => window.__fake.pacing);
    if (!pacing || pacing.chunk > 512) fail(`klasik Bluetooth gönderimi yavaşlatılmamış: ${JSON.stringify(pacing)}`);
    else ok(`Gönderim parça parça: ${pacing.chunk} bayt / ${pacing.delay} ms`);

    // ---- Gün sonu: Z raporu Bluetooth yazıcıdan ----
    await p.goto(`${url}#/gun-sonu`);
    await p.getByRole('button', { name: /Günü kapat/ }).click();
    await p.locator('.modal input.input').first().fill('15');
    await p.getByRole('button', { name: 'Kapat ve Z raporu al' }).click();
    await p.getByRole('button', { name: 'Günü kapat', exact: true }).click();
    before = await p.evaluate(() => window.__fake.writes.length);
    await p.getByRole('button', { name: /Yazdır/ }).click();
    await p.getByText('Z raporu yazıcıya gönderildi').waitFor({ timeout: 20000 });
    ok(`Z raporu Bluetooth yazıcıya gönderildi (${(await p.evaluate((n) => window.__fake.writes.length - n, before))} parça)`);
    if (shots) await saveTsplPages(p, path.join(shots, 'z-raporu'));
    await p.keyboard.press('Escape').catch(() => {});

    // ---- Kasa modu ----
    await p.goto(`${url}#/ayarlar`);
    await p.getByRole('button', { name: 'Bu cihaz' }).click();
    await p.getByText('Kasa modu (tablet)').waitFor({ timeout: 10000 });
    if (!(await p.evaluate(() => window.__fake.keepAwake === true))) fail('açılışta "ekran kararmasın" uygulanmadı'); else ok('Açılışta ekran kararmasın açıldı');
    await p.getByLabel(/Tam ekran/).check();
    await p.waitForFunction(() => window.__fake.immersive === true, null, { timeout: 5000 });
    ok('Tam ekran açıldı');
    await p.getByRole('button', { name: 'Uygulamayı sabitle' }).click();
    await p.getByRole('button', { name: 'Sabitlemeyi kaldır' }).waitFor({ timeout: 5000 });
    ok('Uygulama sabitlendi, "Sabitlemeyi kaldır" görünüyor');
    await p.getByText(/Uygulama sürümü: 1\.0\.14/).waitFor({ timeout: 5000 });
    ok('Uygulama sürümü gösteriliyor (1.0.14)');

    // ---- Uygulama içinden güncelleme (OTA): web paketi arka planda iner, "Yeniden başlat" ile geçilir ----
    if (!(await p.evaluate(() => window.__fake.otaConfirmed > 0))) fail('açılışta güncelleme onayı (otaConfirm) gönderilmedi');
    const restartBtn = p.getByRole('button', { name: 'Yeniden başlat' });
    await restartBtn.waitFor({ timeout: 20000 });
    if (!(await p.evaluate(() => /VelarisKasa-web\.html$/.test(window.__fake.otaUrl || '')))) fail('web paketi indirilmedi');
    const reloadedOta = p.waitForEvent('load', { timeout: 15000 });
    await restartBtn.click();
    await reloadedOta;
    if ((await p.evaluate(() => sessionStorage.getItem('fakePersisted'))) !== `/data/fake/files/ota/${NEXT}`) fail('yeni pakete geçilmedi');
    await p.getByText(/Uygulama sürümü|Kasa|Ayarlar/).first().waitFor({ timeout: 15000 });
    ok(`Yeni sürüm (1.0.${NEXT}) uygulama içinden indirildi; "Yeniden başlat" yeni pakete geçti (QR / APK kurulumu yok)`);

    // ---- Yedekleme ve geri yükleme ----
    await p.getByRole('button', { name: 'Yedekleme' }).click();
    await p.getByRole('button', { name: 'Tablete kaydet' }).click();
    await p.getByText(/Yedek kaydedildi: Belgeler\/VelarisKasa\//).waitFor({ timeout: 15000 });
    ok('Yedek tablete kaydedildi (Belgeler/VelarisKasa)');
    await p.getByRole('button', { name: /Yedeği paylaş/ }).click();
    await p.waitForFunction(() => window.__fake.shared?.files?.[0]?.startsWith('file:///fake/CACHE/velariskasa-yedek-'), null, { timeout: 15000 });
    ok('Yedek paylaşım menüsüne gönderildi (Drive, WhatsApp…)');
    // Yedekten sonra veri değişsin: işletme adı
    await p.getByRole('button', { name: 'İşletme' }).click();
    const bizName = p.getByLabel('İşletme adı');
    await bizName.fill('Değişmiş Market');
    await p.getByRole('button', { name: 'Kaydet' }).first().click();
    await p.waitForTimeout(800);
    // Geri yükle → uygulama yeniden açılır, eski ad geri gelir
    await p.getByRole('button', { name: 'Yedekleme' }).click();
    await p.getByRole('button', { name: 'Geri yükle' }).first().click();
    const reloaded = p.waitForEvent('load', { timeout: 20000 });
    await p.locator('.modal').getByRole('button', { name: 'Geri yükle' }).click();
    await reloaded;
    await p.goto(`${url}#/ayarlar`);
    await p.getByRole('button', { name: 'İşletme' }).click();
    const nameAfter = await p.getByLabel('İşletme adı').inputValue({ timeout: 15000 });
    if (nameAfter !== 'Deneme Market') fail(`geri yüklemeden sonra işletme adı ${nameAfter}`); else ok('Yedek geri yüklendi: sonradan yapılan değişiklik geri alındı, veriler yedekteki hâlinde');

    const calls = await p.evaluate(() => window.__fake.calls);
    if (calls.some((c) => c.endsWith('.then'))) fail('eklenti nesnesi Promise sanıldı (.then çağrıldı)');
    if (errors.length) fail(`sayfa hataları: ${errors.join(' | ')}`);
    if (!process.exitCode) console.log('\nTüm adımlar başarılı.');
  } catch (e) {
    fail(e.message);
  } finally {
    await browser.close();
    server.close();
  }
})();
