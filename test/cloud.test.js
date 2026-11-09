// Velaris Bulut: kayıt, adresleme, deneme lisansı, ödeme (deneme ve iyzico), yönetim
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { after, test } from 'node:test';

// Testte geçici lisans anahtar çifti (license.js NODE_ENV=test'te bu açık anahtarı kabul eder)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.VK_LICENSE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const { createCloud } = await import('../server/cloud/app.js');
const { iyzicoHeaders, iyzicoProvider } = await import('../server/cloud/payments.js');
const { addMonths, subscriptionStatus, validSlug, slugify } = await import('../server/cloud/store.js');
const { priceOf } = await import('../server/cloud/pages.js');

const dirs = [];
const clouds = [];
async function start(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-cloud-'));
  dirs.push(dataDir);
  let base;
  const cloud = createCloud({ dataDir, baseUrl: 'http://placeholder', privateKeyPem, adminToken: 'gizli-yonetim', worker: false, ...extra, get _() { return base; } });
  const server = await new Promise((r) => { const s = cloud.app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  clouds.push({ cloud, server });
  return { cloud, base };
}
after(() => {
  for (const { cloud, server } of clouds) { server.close(); cloud.close(); }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const req = (base, method, url, body, headers = {}) => fetch(base + url, {
  method, redirect: 'manual', headers: { ...(body && typeof body === 'object' && !(body instanceof URLSearchParams) ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() })).then((r) => { try { r.body = JSON.parse(r.text); } catch { r.body = null; } return r; });

// Host başlığıyla istek (fetch Host başlığını değiştirmeye izin vermez)
const hostGet = (base, url, host) => new Promise((resolve, reject) => {
  const u = new URL(base + url);
  http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Host: host } }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { let body = null; try { body = JSON.parse(d); } catch { /* html */ } resolve({ status: res.statusCode, body, text: d }); });
  }).on('error', reject);
});
const signup = (base, extra = {}) => req(base, 'POST', '/api/cloud/signup', {
  business_name: 'Yıldız Market', business_type: 'market', slug: 'yildizmarket', contact_name: 'Ayşe Yıldız', phone: '05321234567', email: 'ayse@example.com', admin_pin: '2468', plan: 'esnaf', city: 'İzmir', ...extra,
});

test('adres kuralları ve yardımcılar', () => {
  assert.equal(slugify('Çiçek Büfe & Kafe'), 'cicek-bufe-kafe');
  assert.ok(validSlug('yildizmarket'));
  assert.ok(!validSlug('www'));
  assert.ok(!validSlug('ab'));
  assert.ok(!validSlug('-abc'));
  assert.ok(!validSlug('Abc'));
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(subscriptionStatus({ plan: 'esnaf', paid_until: '2026-01-10' }, '2026-01-05'), 'active');
  assert.equal(subscriptionStatus({ plan: 'esnaf', paid_until: '2026-01-10' }, '2026-01-08'), 'due');
  assert.equal(subscriptionStatus({ plan: 'esnaf', paid_until: '2026-01-10' }, '2026-01-15'), 'grace');
  assert.equal(subscriptionStatus({ plan: 'esnaf', paid_until: '2026-01-10' }, '2026-01-20'), 'expired');
  assert.deepEqual(priceOf('esnaf', 1), { net: 59900, vat: 11980, amount: 71880 });
  assert.equal(priceOf('pro', 12).net, 129000 * 10);
});

test('kayıt: işletme açılır, deneme lisansı yazılır, yol ile erişilir, yönetici girer', async () => {
  const { cloud, base } = await start();
  let r = await req(base, 'GET', '/kayit');
  assert.equal(r.status, 200);
  assert.match(r.text, /Hesabı oluştur/);
  r = await req(base, 'GET', '/api/cloud/slug?slug=yildizmarket');
  assert.equal(r.body.available, true);

  r = await signup(base);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.plan, 'esnaf');
  assert.ok(r.body.trial_until);
  assert.match(r.body.url, /\/i\/yildizmarket\/$/);

  r = await signup(base);
  assert.equal(r.status, 409);
  r = await signup(base, { slug: 'www' });
  assert.equal(r.status, 400);

  // /i/<adres> → sondaki eğik çizgiye yönlendirir
  r = await req(base, 'GET', '/i/yildizmarket');
  assert.equal(r.status, 301);
  r = await req(base, 'GET', '/i/yildizmarket/api/setup/status');
  assert.equal(r.body.business_name, 'Yıldız Market');
  assert.equal(r.body.setup_done, true);
  // Kurulum tekrar yapılamaz (hesap ele geçirilemez)
  r = await req(base, 'POST', '/i/yildizmarket/api/setup', { business_name: 'X', business_type: 'market', admin_name: 'Kötü', admin_pin: '1111' });
  assert.equal(r.status, 400);

  const ayse = (await req(base, 'GET', '/i/yildizmarket/api/setup/status')).body.users.find((u) => u.name === 'Ayşe Yıldız');
  r = await req(base, 'POST', '/i/yildizmarket/api/auth/login', { user_id: ayse.id, pin: '2468' });
  assert.equal(r.status, 200);
  const token = r.body.token;
  const auth = { Authorization: `Bearer ${token}` };
  r = await req(base, 'GET', '/i/yildizmarket/api/license', null, auth);
  assert.equal(r.body.plan, 'esnaf');
  assert.equal(r.body.status, 'active');

  r = await req(base, 'GET', '/i/yildizmarket/api/cloud/subscription', null, auth);
  assert.equal(r.body.status, 'trial');
  assert.match(r.body.pay_url, /\/odeme\//);
  r = await req(base, 'GET', '/i/yildizmarket/api/cloud/subscription');
  assert.equal(r.status, 401);

  r = await req(base, 'GET', '/i/yokboyle/api/setup/status');
  assert.equal(r.status, 404);
  assert.equal(cloud.store.list().length, 1);
});

test('deneme ödemesi: başarısız ödeme paketi değiştirmez, başarılı ödeme süreyi uzatır ve lisansı yeniler', async () => {
  const { cloud, base } = await start();
  await signup(base, { slug: 'berberali', business_type: 'berber', plan: 'salon' });
  const t = cloud.store.bySlug('berberali');
  let r = await req(base, 'GET', `/odeme/${t.billing_token}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Kartla öde/);
  r = await req(base, 'GET', '/odeme/yanlis-token');
  assert.equal(r.status, 404);

  // Başarısız
  r = await req(base, 'POST', `/api/cloud/pay/${t.billing_token}`, { plan: 'pro', months: 1 });
  assert.equal(r.status, 200);
  let ref = r.body.redirect.split('/').pop();
  r = await req(base, 'POST', `/odeme/simulator/${ref}`, new URLSearchParams({ ok: '0' }));
  assert.equal(r.status, 303);
  assert.equal(cloud.store.bySlug('berberali').plan, 'salon');

  // Başarılı: Pro, 12 ay
  r = await req(base, 'POST', `/api/cloud/pay/${t.billing_token}`, { plan: 'pro', months: 12 });
  ref = r.body.redirect.split('/').pop();
  r = await req(base, 'GET', `/odeme/simulator/${ref}`);
  assert.match(r.text, /Ödeme başarılı/);
  r = await req(base, 'POST', `/odeme/simulator/${ref}`, new URLSearchParams({ ok: '1' }));
  const resultUrl = new URL(r.headers.get('location')).pathname + new URL(r.headers.get('location')).search;
  r = await req(base, 'GET', resultUrl.replace(/^\/\/[^/]+/, ''));
  assert.match(r.text, /ödemeniz alındı/);
  const after1 = cloud.store.bySlug('berberali');
  assert.equal(after1.plan, 'pro');
  assert.equal(after1.paid_until, addMonths(t.trial_until, 12)); // deneme süresinin üstüne eklenir
  const pay = cloud.store.payments(t.id).find((p) => p.status === 'paid');
  assert.equal(pay.amount, priceOf('pro', 12).amount);
  // Aynı ödeme ikinci kez işlenmez
  await req(base, 'POST', `/odeme/simulator/${ref}`, new URLSearchParams({ ok: '1' }));
  assert.equal(cloud.store.bySlug('berberali').paid_until, after1.paid_until);

  // İşletmenin lisansı Pro ve yeni bitiş tarihi
  const ali = (await req(base, 'GET', '/i/berberali/api/setup/status')).body.users[0];
  const tok = (await req(base, 'POST', '/i/berberali/api/auth/login', { user_id: ali.id, pin: '2468' })).body.token;
  r = await req(base, 'GET', '/i/berberali/api/license', null, { Authorization: `Bearer ${tok}` });
  assert.equal(r.body.plan, 'pro');
  assert.equal(r.body.exp, after1.paid_until);
});

test('alt alan adı, sertifika onayı ve yönetim', async () => {
  const { cloud, base } = await start({ domain: 'velariskasa.test' });
  await signup(base, { slug: 'kafemoda', business_type: 'kafe', plan: 'free' });
  assert.equal(cloud.store.bySlug('kafemoda').plan, 'free');
  let r = await hostGet(base, '/api/setup/status', 'kafemoda.velariskasa.test');
  assert.equal(r.body.business_name, 'Yıldız Market');
  r = await req(base, 'GET', '/api/cloud/tls-check?domain=kafemoda.velariskasa.test');
  assert.equal(r.status, 200);
  r = await req(base, 'GET', '/api/cloud/tls-check?domain=baskasi.velariskasa.test');
  assert.equal(r.status, 404);
  r = await req(base, 'GET', '/api/cloud/tls-check?domain=evil.example.com');
  assert.equal(r.status, 404);

  r = await req(base, 'GET', '/yonetim');
  assert.equal(r.status, 401);
  const admin = { Authorization: `Basic ${Buffer.from('v:gizli-yonetim').toString('base64')}` };
  r = await req(base, 'GET', '/yonetim', null, admin);
  assert.match(r.text, /kafemoda/);
  r = await req(base, 'POST', '/yonetim/kafemoda', new URLSearchParams({ action: 'suspend' }), admin);
  assert.equal(r.status, 303);
  r = await hostGet(base, '/api/setup/status', 'kafemoda.velariskasa.test');
  assert.equal(r.status, 403);
  r = await hostGet(base, '/kayit', 'bulut.velariskasa.test');
  assert.match(r.text, /Hesabı oluştur/); // ayrılmış alt alan: ana site
  await req(base, 'POST', '/yonetim/kafemoda', new URLSearchParams({ action: 'resume' }), admin);
  await req(base, 'POST', '/yonetim/kafemoda', new URLSearchParams({ action: 'extend' }), admin);
  const t = cloud.store.bySlug('kafemoda');
  assert.equal(t.plan, 'esnaf');
  assert.ok(t.paid_until);
});

test('iyzico: imza başlığı ve ödeme akışı (sahte iyzico)', async () => {
  const h = iyzicoHeaders({ apiKey: 'k', secretKey: 's', uriPath: '/x', body: '{"a":1}', randomKey: '123' });
  const sig = crypto.createHmac('sha256', 's').update('123/x{"a":1}').digest('hex');
  assert.equal(h.Authorization, `IYZWSv2 ${Buffer.from(`apiKey:k&randomKey:123&signature:${sig}`).toString('base64')}`);
  assert.equal(h['x-iyzi-rnd'], '123');

  const seen = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, body, auth: init.headers.Authorization });
    if (url.endsWith('/initialize/auth/ecom')) return { json: async () => ({ status: 'success', token: 'TOK123', paymentPageUrl: 'https://sandbox.iyzico.test/pay/TOK123' }) };
    if (url.endsWith('/detail')) return { json: async () => ({ status: 'success', paymentStatus: 'SUCCESS', paymentId: '999', paidPrice: seen[0].body.paidPrice, basketId: seen[0].body.basketId }) };
    return { json: async () => ({ status: 'failure' }) };
  };
  const provider = iyzicoProvider({ apiKey: 'k', secretKey: 's', baseUrl: 'https://sandbox-api.iyzipay.test', fetchImpl: fake });
  const { cloud, base } = await start({ provider });
  await signup(base, { slug: 'iyzimarket' });
  const t = cloud.store.bySlug('iyzimarket');
  let r = await req(base, 'POST', `/api/cloud/pay/${t.billing_token}`, { plan: 'esnaf', months: 1 });
  assert.equal(r.body.redirect, 'https://sandbox.iyzico.test/pay/TOK123');
  assert.equal(seen[0].body.price, '718.80');
  assert.equal(seen[0].body.buyer.identityNumber, '11111111111');
  assert.match(seen[0].body.callbackUrl, /\/api\/cloud\/iyzico\/callback$/);
  r = await req(base, 'POST', '/api/cloud/iyzico/callback', new URLSearchParams({ token: 'TOK123' }));
  assert.equal(r.status, 303);
  const after1 = cloud.store.bySlug('iyzimarket');
  assert.ok(after1.paid_until);
  assert.equal(cloud.store.payments(t.id)[0].provider_payment_id, '999');
  // Bilinmeyen token işlenmez
  r = await req(base, 'POST', '/api/cloud/iyzico/callback', new URLSearchParams({ token: 'SAHTE' }));
  assert.equal(r.status, 400);
});
