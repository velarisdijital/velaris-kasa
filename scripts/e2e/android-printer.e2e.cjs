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
