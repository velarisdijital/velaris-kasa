import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Bu dosya Ücretsiz paketle başlar ve geçici bir anahtar çiftiyle imzalı lisanslar dener
process.env.VK_TEST_DEFAULT_PLAN = '';
const keys = crypto.generateKeyPairSync('ed25519');
process.env.VK_LICENSE_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
const PRIV = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

const { createApp } = await import('../server/app.js');
const { signLicense } = await import('../server/license.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-kasa-lic-'));
let server, base, token, close;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const lic = (extra) => signLicense({ lic: 'T1', plan: 'esnaf', business: 'Test', exp: day(30), ...extra }, PRIV);

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  ({ app: server, close } = createApp({ dataDir, worker: false }));
  await new Promise((r) => { server = server.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_name: 'Test', business_type: 'market', admin_name: 'Ali', admin_pin: '1234' }) });
  token = (await r.json()).token;
});
after(() => { server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('Ücretsiz paket: temel satış açık, ücretli özellikler kapalı', async () => {
  let r = await call('GET', '/api/license');
  assert.equal(r.body.plan, 'free');
  assert.equal(r.body.status, 'free');
  assert.equal(r.body.plans.esnaf.price, 599);

  r = await call('POST', '/api/shifts/open', { register_name: 'Kasa 1' });
  assert.equal(r.status, 201);
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', items: [{ name: 'X', qty: 1, unit_price: 100, vat_rate: 20 }], payments: [{ method: 'cash', amount: 100 }] });
  assert.equal(r.status, 201);

  r = await call('PUT', '/api/settings', { fiscal_driver: 'simulator' });
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'PLAN_REQUIRED');
  assert.equal(r.body.required_plan, 'esnaf');
  r = await call('PUT', '/api/settings', { fiscal_driver: 'none', business_name: 'Yeni Ad' }); // kapatmak serbest
  assert.equal(r.status, 200);
  // Kurulumda açılmış bir ayar (ör. berber randevu modülü) kaydedilirken engellenmez, yalnız yeni açılış engellenir
  r = await call('PUT', '/api/settings', { modules_appointments: '0' });
  assert.equal(r.status, 200);
  r = await call('PUT', '/api/settings', { modules_appointments: '1' });
  assert.equal(r.status, 402);
  r = await call('POST', `/api/sales/1/invoice`);
  assert.equal(r.status, 402);
  r = await call('POST', '/api/appointments', { customer_name: 'A', start_at: '2030-01-01 10:00' });
  assert.equal(r.status, 402);
  r = await call('POST', '/api/api-keys', { name: 'x' });
  assert.equal(r.status, 402);

  // Limitler: 1 kullanıcı, aynı anda 1 açık kasa
  r = await call('POST', '/api/users', { name: 'Ayşe', pin: '0000' });
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'PLAN_LIMIT');
  r = await call('POST', '/api/shifts/open', { register_name: 'Kasa 2' });
  assert.equal(r.status, 402);
});

test('lisans: sahte, biçimsiz ve başka kuruluma ait anahtarlar reddedilir', async () => {
  let r = await call('POST', '/api/license', { key: 'rastgele' });
  assert.equal(r.status, 400);
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  r = await call('POST', '/api/license', { key: signLicense({ plan: 'pro', exp: day(30) }, other) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /imza/);
  // İmzalı ama verisi değiştirilmiş anahtar
  const [v, , sig] = lic().split('.');
  const forged = Buffer.from(JSON.stringify({ plan: 'pro', exp: '2099-01-01' })).toString('base64url');
  r = await call('POST', '/api/license', { key: `${v}.${forged}.${sig}` });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/license', { key: lic({ install: 'baska-kurulum' }) });
  assert.equal(r.status, 400);
  assert.equal((await call('GET', '/api/license')).body.plan, 'free');
});

test('Esnaf lisansı özellikleri açar, Salon/Pro özellikleri kapalı kalır', async () => {
  const installId = (await call('GET', '/api/license')).body.install_id;
  let r = await call('POST', '/api/license', { key: lic({ install: installId }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.plan, 'esnaf');
  assert.equal(r.body.status, 'active');
  r = await call('PUT', '/api/settings', { fiscal_driver: 'simulator', loyalty_enabled: '1' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/users', { name: 'Ayşe', pin: '0000' });
  assert.equal(r.status, 201);
  r = await call('POST', '/api/shifts/open', { register_name: 'Kasa 2' });
  assert.equal(r.status, 201);
  r = await call('PUT', '/api/settings', { booking_enabled: '1' });
  assert.equal(r.status, 402);
  assert.equal(r.body.required_plan, 'salon');
  r = await call('PUT', '/api/settings', { crm_enabled: '1' });
  assert.equal(r.body.required_plan, 'pro');
  // Ayarlarda lisans anahtarı maskeli
  assert.equal((await call('GET', '/api/settings')).body.license_key, '••••••••');
  await call('PUT', '/api/settings', { fiscal_driver: 'none' });
});

test('süresi biten lisans: 7 gün ek süre, sonra Ücretsiz paket', async () => {
  let r = await call('POST', '/api/license', { key: lic({ plan: 'pro', exp: day(-3) }) });
  assert.equal(r.body.status, 'grace');
  assert.equal(r.body.plan, 'pro');
  r = await call('POST', '/api/license', { key: lic({ plan: 'pro', exp: day(-10) }) });
  assert.equal(r.body.status, 'expired');
  assert.equal(r.body.plan, 'free');
  assert.equal(r.body.expired_plan, 'pro');
  r = await call('DELETE', '/api/license');
  assert.equal(r.body.plan, 'free');
});

test('şube özelliği yalnızca Pro paketinde', async () => {
  let r = await call('POST', '/api/branches', { name: 'Beşiktaş' });
  assert.equal(r.status, 402);
  assert.equal(r.body.required_plan, 'pro');
  r = await call('POST', '/api/stock/transfer', { product_id: 1, from_branch_id: 1, to_branch_id: 2, qty: 1 });
  assert.equal(r.status, 402);
});
