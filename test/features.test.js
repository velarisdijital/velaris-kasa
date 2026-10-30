import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-kasa-feat-'));
const BRIDGE_PORT = 4900 + Math.floor(Math.random() * 90);
let server, base, token, close, bridge;

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  ({ app: server, close } = createApp({ dataDir, worker: false }));
  await new Promise((r) => { server = server.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_name: 'Test', business_type: 'market', admin_name: 'Ali', admin_pin: '1234' }) });
  token = (await r.json()).token;
  bridge = spawn(process.execPath, ['bridge/okc-bridge.js'], { env: { ...process.env, OKC_BRIDGE_PORT: String(BRIDGE_PORT) } });
  await new Promise((resolve) => bridge.stdout.once('data', resolve));
  r = await call('POST', '/api/shifts/open', { register_name: 'Kasa 1', opening_cash: 0 });
  assert.equal(r.status, 201);
});

after(() => {
  bridge?.kill();
  server.close();
  close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const sell = (extra = {}) => call('POST', '/api/sales', {
  register_name: 'Kasa 1', items: [{ name: 'Ürün', qty: 2, unit_price: 5000, vat_rate: 20 }],
  payments: [{ method: 'cash', amount: 10000 }], ...extra,
});

test('yazarkasa kapalıyken satış bilgi fişiyle kalır', async () => {
  const r = await sell();
  assert.equal(r.status, 201);
  assert.equal(r.body.fiscal_status, 'none');
  const f = await call('POST', `/api/sales/${r.body.id}/fiscal`);
  assert.equal(f.status, 400);
});

test('köprü üzerinden mali fiş, hata ve yeniden deneme', async () => {
  await call('PUT', '/api/settings', { fiscal_driver: 'bridge', fiscal_bridge_url: `http://127.0.0.1:${BRIDGE_PORT}` });
  const st = await call('GET', '/api/fiscal/status');
  assert.equal(st.body.ok, true, JSON.stringify(st.body));

  const ok = await sell();
  assert.equal(ok.body.fiscal_status, 'done', JSON.stringify(ok.body));
  assert.equal(ok.body.fiscal_no, '0001');

  // Köprü kapalı → satış kaydedilir, mali fiş "failed" olur
  await call('PUT', '/api/settings', { fiscal_bridge_url: 'http://127.0.0.1:9' });
  const failed = await sell();
  assert.equal(failed.status, 201);
  assert.equal(failed.body.fiscal_status, 'failed');
  assert.match(failed.body.fiscal_error, /köprü|ulaşılamıyor/i);

  // Köprü geri geldi → tekrar gönder
  await call('PUT', '/api/settings', { fiscal_bridge_url: `http://127.0.0.1:${BRIDGE_PORT}` });
  const retry = await call('POST', `/api/sales/${failed.body.id}/fiscal`);
  assert.equal(retry.body.fiscal_status, 'done');
  assert.equal(retry.body.fiscal_no, '0002');
  const again = await call('POST', `/api/sales/${failed.body.id}/fiscal`);
  assert.equal(again.status, 400);

  // İade yazarkasaya bildirilir (uyarı yok)
  const refund = await call('POST', `/api/sales/${ok.body.id}/refund`, { method: 'cash' });
  assert.equal(refund.body.status, 'refunded');
  assert.equal(refund.body.fiscal_warning, null);
});

test('simülatör sürücüsü ve gün sonunda yazarkasa Z raporu', async () => {
  await call('PUT', '/api/settings', { fiscal_driver: 'simulator' });
  const s = await sell();
  assert.equal(s.body.fiscal_status, 'done');
  const bad = await sell({ items: [{ name: 'HATA-TEST', qty: 1, unit_price: 100, vat_rate: 20 }], payments: [{ method: 'cash', amount: 100 }] });
  assert.equal(bad.body.fiscal_status, 'failed');

  await call('PUT', '/api/settings', { fiscal_driver: 'bridge' });
  const cur = (await call('GET', '/api/shifts/current?register=Kasa%201')).body;
  const z = await call('POST', `/api/shifts/${cur.shift.id}/close`, { counted_cash: cur.expected_cash });
  assert.equal(z.body.fiscal_z.ok, true, JSON.stringify(z.body.fiscal_z));
  await call('PUT', '/api/settings', { fiscal_driver: 'none' });
  await call('POST', '/api/shifts/open', { register_name: 'Kasa 1', opening_cash: 0 });
});

test('puan: kazanma, puanla ödeme, iadede geri alma', async () => {
  const c = (await call('POST', '/api/customers', { name: 'Puanlı Müşteri', phone: '0532 000 00 01' })).body;
  // Puan sistemi kapalıyken puan kazanılmaz
  let r = await sell({ customer_id: c.id });
  assert.equal(r.body.points_earned, 0);

  await call('PUT', '/api/settings', { loyalty_enabled: '1', loyalty_rate: '5' });
  r = await sell({ customer_id: c.id }); // 100 TL nakit → %5 = 5 TL puan
  assert.equal(r.body.points_earned, 500);
  let cust = (await call('GET', `/api/customers/${c.id}`)).body;
  assert.equal(cust.points, 500);

  // Fazla puan kullanılamaz
  const tooMuch = await sell({ customer_id: c.id, payments: [{ method: 'points', amount: 600 }, { method: 'cash', amount: 9400 }] });
  assert.equal(tooMuch.status, 400);

  // 3 TL puan + 97 TL kart: puan yalnızca karttan kazanılır
  r = await sell({ customer_id: c.id, payments: [{ method: 'points', amount: 300 }, { method: 'card', amount: 9700 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.points_earned, 485);
  cust = (await call('GET', `/api/customers/${c.id}`)).body;
  assert.equal(cust.points, 500 - 300 + 485);
  assert.equal(cust.points_transactions.length, 3);

  // Tam iade → kazanılan 485 geri alınır
  await call('POST', `/api/sales/${r.body.id}/refund`, { method: 'card' });
  cust = (await call('GET', `/api/customers/${c.id}`)).body;
  assert.equal(cust.points, 200);

  // Müşterisiz puanla ödeme olmaz
  r = await sell({ payments: [{ method: 'points', amount: 10000 }] });
  assert.equal(r.status, 400);
  await call('PUT', '/api/settings', { loyalty_enabled: '0' });
});

test('KVKK/İYS: onay kaydı, İYS dışa aktarma, veri silme', async () => {
  const c = (await call('POST', '/api/customers', { name: 'Onaylı', phone: '0 (532) 111 22 33', email: 'a@b.com', sms_consent: 1 })).body;
  assert.equal(c.sms_consent, 1);
  assert.ok(c.consent_at);
  assert.equal(c.consent_source, 'kasa');
  const bad = await call('POST', '/api/customers', { name: 'X', tax_number: '123' });
  assert.equal(bad.status, 400);

  let x = await call('GET', '/api/iys/export?mark=1');
  const rows = x.body.rows.filter((r) => r.customer_id === c.id);
  assert.deepEqual(rows.map((r) => [r.type, r.recipient, r.status, r.source]), [
    ['MESAJ', '+905321112233', 'ONAY', 'HS_FIZIKSEL_ORTAM'],
    ['EPOSTA', 'a@b.com', 'RET', 'HS_FIZIKSEL_ORTAM'],
  ]);
  x = await call('GET', '/api/iys/export');
  assert.equal(x.body.rows.filter((r) => r.customer_id === c.id).length, 0);

  // Onay geri alınınca tekrar İYS'ye gönderilecekler listesine düşer
  await call('PUT', `/api/customers/${c.id}`, { sms_consent: 0 });
  x = await call('GET', '/api/iys/export');
  assert.equal(x.body.rows.find((r) => r.customer_id === c.id && r.type === 'MESAJ').status, 'RET');

  const exp = await call('GET', `/api/customers/${c.id}/export`);
  assert.equal(exp.body.customer.name, 'Onaylı');
  await call('POST', `/api/customers/${c.id}/anonymize`);
  const after = (await call('GET', `/api/customers/${c.id}`)).body;
  assert.equal(after.phone, null);
  assert.match(after.name, /Silinmiş müşteri/);
});
