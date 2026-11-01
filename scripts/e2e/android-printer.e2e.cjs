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
    await search.fill('Simit'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^Nakit/ }).click();
    const given = p.locator('.modal input.input').first();
    const gm = await given.evaluate((el) => ({ focused: document.activeElement === el, mode: el.getAttribute('inputmode') }));
    if (!gm.focused || gm.mode !== 'none') fail(`nakit penceresindeki kutu klavye açıyor: ${JSON.stringify(gm)}`);
    else ok('Nakit penceresinde tutar kutusu seçili, klavye kendiliğinden açılmıyor');
    await p.getByRole('button', { name: /Satışı tamamla/ }).click();
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
