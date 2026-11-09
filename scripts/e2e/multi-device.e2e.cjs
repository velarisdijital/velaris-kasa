// Uçtan uca test: birden çok cihaz aynı sunucuda.
//  - Gerçek VelarisKasa sunucusu başlatılır (dükkandaki Windows bilgisayarı / bulut yerine)
//  - Kasa tableti (Android uygulaması, sahte köprü) kurulur, verilerini sunucuya taşıyıp bağlanır
//  - Mutfak tableti ilk açılışta sunucuya bağlanır, Mutfak kullanıcısıyla girer
//  - Masadan mutfağa gönderilen sipariş mutfak ekranına düşer; "Hepsi hazır" garsonun masasında görünür
//   node scripts/build-app.mjs && node scripts/e2e/multi-device.e2e.cjs [ekran-görüntüsü-klasörü]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../../dist-app');
const repo = path.join(__dirname, '../..');
const shots = process.argv[2];
const fail = (msg) => { console.error('BAŞARISIZ:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓', msg);

function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-multi-'));
  const port = 4800 + Math.floor(Math.random() * 90);
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: repo,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VELARIS_DATA_DIR: dataDir, NODE_ENV: 'test', VK_TEST_DEFAULT_PLAN: 'pro' },
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sunucu açılmadı')), 20000);
    proc.stdout.on('data', (d) => { if (String(d).includes('çalışıyor')) { clearTimeout(t); resolve({ proc, port, dataDir }); } });
    proc.stderr.on('data', (d) => process.stderr.write(`[sunucu] ${d}`));
  });
}

(async () => {
  const srv = await startServer();
  const api = `http://127.0.0.1:${srv.port}`;
  const stat = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const url = `http://127.0.0.1:${stat.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const device = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
    await ctx.addInitScript({ path: path.join(__dirname, 'fake-android-bridge.js') });
    await ctx.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, body: '{}' }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    return p;
  };
  const shot = async (p, n) => { if (shots) await p.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true }); };
  try {
    // ---- Kasa tableti: yerel kurulum, sonra verileri sunucuya taşı ----
    const kasa = await device('kasa');
    await kasa.goto(url);
    await kasa.waitForSelector('input[placeholder="Örn. Yıldız Market"]', { timeout: 20000 });
    await kasa.fill('input[placeholder="Örn. Yıldız Market"]', 'Deneme Kafe');
    await kasa.getByRole('button', { name: /Kafe \/ Büfe/ }).click();
    const inp = kasa.locator('form input.input');
    await inp.nth(2).fill('Ali'); await inp.nth(3).fill('1234'); await inp.nth(4).fill('1234');
    await kasa.getByText('Kurulumu tamamla').click();
    await kasa.waitForTimeout(4000);
    await kasa.goto(`${url}#/ayarlar`);
    await kasa.getByRole('button', { name: 'Bu cihaz' }).click();
    await kasa.getByText('Veri konumu (birden çok cihaz)').waitFor({ timeout: 10000 });
    await kasa.getByLabel('Sunucu adresi').fill(`127.0.0.1:${srv.port}`);
    await kasa.getByRole('button', { name: 'Sunucuyu dene' }).click();
    await kasa.getByText(/Sunucu boş/).waitFor({ timeout: 10000 });
    ok('Kasa tableti sunucuyu buldu (boş sunucu)');
    const reloaded = kasa.waitForEvent('load', { timeout: 20000 });
    await kasa.getByRole('button', { name: 'Bu tabletteki verileri sunucuya taşı ve bağlan' }).click();
    await reloaded;
    const status = await (await fetch(`${api}/api/setup/status`)).json();
    if (status.business_name !== 'Deneme Kafe' || !status.setup_done) fail(`sunucuya taşınmadı: ${JSON.stringify(status)}`);
    else ok('Tabletteki veriler sunucuya taşındı (işletme: Deneme Kafe)');
    const token = await kasa.evaluate(() => JSON.parse(localStorage.getItem('vk_token')));
    const call = (method, u, body) => fetch(api + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await kasa.goto(`${url}#/ayarlar`);
    await kasa.getByRole('button', { name: 'Bu cihaz' }).click();
    await kasa.getByText(`Bu tablet sunucuya bağlı: ${api}`).waitFor({ timeout: 10000 });
    ok('Kasa tableti oturum kapanmadan sunucuyla çalışıyor');

    // Tablette kurulan kullanıcı sunucuda PIN'iyle giriş yapabilmeli (tablet PIN'i sunucuyla aynı scrypt ile saklar)
    const st2 = await (await fetch(`${api}/api/setup/status`)).json();
    const ali = st2.users.find((u) => u.name === 'Ali');
    const login = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: ali.id, pin: '1234' }) });
    if (login.status !== 200) fail(`tabletten taşınan kullanıcı sunucuda giriş yapamadı (${login.status})`);
    else ok('Tabletten taşınan kullanıcı (Ali) sunucuda PIN ile giriş yapabiliyor');

    // Mutfak kullanıcısı (yönetici ekler)
    await call('POST', '/api/users', { name: 'Aşçı Ahmet', pin: '7777', role: 'kitchen' });

    // ---- Mutfak tableti: ilk açılışta sunucuya bağlan, Mutfak kullanıcısıyla gir ----
    const mutfak = await device('mutfak');
    await mutfak.goto(url);
    await mutfak.getByText('Birden çok cihaz mı kullanacaksınız?').click();
    await mutfak.getByLabel('Sunucu adresi').fill(`127.0.0.1:${srv.port}`);
    await mutfak.getByRole('button', { name: 'Sunucuyu dene' }).click();
    await mutfak.getByText(/Sunucu hazır: Deneme Kafe/).waitFor({ timeout: 10000 });
    const r2 = mutfak.waitForEvent('load', { timeout: 20000 });
    await mutfak.getByRole('button', { name: 'Bu sunucuyu kullan' }).click();
    await r2;
    await mutfak.getByRole('button', { name: /Aşçı Ahmet/ }).click();
    for (const d of '7777') await mutfak.locator('.numpad button', { hasText: new RegExp(`^${d}$`) }).click();
    await mutfak.getByRole('button', { name: 'Giriş' }).click();
    await mutfak.getByRole('heading', { name: 'Mutfak' }).waitFor({ timeout: 10000 });
    ok('Mutfak tableti sunucuya bağlandı, Mutfak kullanıcısı yalnızca mutfak ekranını görüyor');

    // ---- Garson: masaya sipariş, mutfağa gönder ----
    const tables = await call('GET', '/api/tables');
    const prods = await call('GET', '/api/products');
    const food = prods.filter((p) => p.type !== 'service').slice(0, 2);
    const tk = await call('POST', `/api/tables/${tables[0].id}/ticket`, { guest_count: 2, items: food.map((p) => ({ product_id: p.id, qty: 1 })) });
    await call('POST', `/api/tickets/${tk.id}/kitchen`);
    const card = mutfak.locator(`.kds-card[data-ticket="${tables[0].name}"]`);
    await card.waitFor({ timeout: 10000 });
    ok(`Masadan gönderilen sipariş mutfak ekranına düştü (${tables[0].name}: ${food.map((p) => p.name).join(', ')})`);
    await shot(mutfak, 'mutfak-1-yeni');
    await card.getByRole('button', { name: /Hepsi hazır/ }).click();
    await mutfak.locator('.kds-col.ready .kds-card').first().waitFor({ timeout: 10000 });
    ok('Mutfak "Hepsi hazır" dedi');
    await shot(mutfak, 'mutfak-2-hazir');

    // ---- Kasa tableti (garson) masada "hazır" görür ----
    await kasa.goto(`${url}#/masalar`);
    const readyBadge = kasa.getByText(/Mutfak: \d+ hazır/).first();
    await readyBadge.waitFor({ timeout: 15000 });
    ok(`Garsonun masasında görünüyor: "${await readyBadge.innerText()}"`);
    await shot(kasa, 'kasa-masalar');

    if (errors.length) fail(`sayfa hataları: ${errors.join(' | ')}`);
    if (!process.exitCode) console.log('\nTüm adımlar başarılı.');
  } catch (e) {
    fail(e.message);
  } finally {
    await browser.close();
    stat.close();
    srv.proc.kill();
    fs.rmSync(srv.dataDir, { recursive: true, force: true });
  }
})();
