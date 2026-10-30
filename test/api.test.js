import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';
import { flushOutbox, sign } from '../server/integrations/velaris.js';

let server, base, token, close, db;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-kasa-test-'));

// Sahte Velaris CRM
const crmEvents = [];
let crm, crmUrl;

async function call(method, url, body, auth = token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

before(async () => {
  ({ app: server, close, db } = createApp({ dataDir, worker: false }));
  await new Promise((r) => { server = server.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;

  crm = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/pos/ping') return res.end('{"ok":true}');
      if (req.url === '/api/pos/events') {
        const evt = JSON.parse(raw);
        crmEvents.push({ evt, signature: req.headers['x-velaris-signature'], auth: req.headers.authorization, raw });
        return res.end(JSON.stringify(evt.event === 'customer.created' ? { crm_id: 'CRM-42' } : { ok: true }));
      }
      if (req.url.startsWith('/api/customers')) {
        return res.end(JSON.stringify({ data: [{ id: 'CRM-7', name: 'Ayşe Yılmaz', phone: '05551112233' }], has_more: false }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => crm.listen(0, r));
  crmUrl = `http://127.0.0.1:${crm.address().port}`;
});

after(() => {
  server.close();
  crm.close();
  close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('ilk kurulum ve PIN ile giriş', async () => {
  let r = await call('GET', '/api/setup/status');
  assert.equal(r.body.setup_done, false);
  r = await call('POST', '/api/setup', { business_name: 'Test Market', business_type: 'market', admin_name: 'Ali', admin_pin: '1234', seed_samples: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('POST', '/api/auth/login', { user_id: 1, pin: '0000' });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/auth/login', { user_id: 1, pin: '1234' });
  assert.equal(r.status, 200);
  token = r.body.token;
  r = await call('GET', '/api/products');
  assert.ok(r.body.length >= 5);
  r = await call('GET', '/api/products', null, null);
  assert.equal(r.status, 401);
});

test('CRM entegrasyonu ayarları', async () => {
  const r = await call('PUT', '/api/settings', { crm_enabled: '1', crm_base_url: crmUrl, crm_api_key: 'secret-key', crm_webhook_secret: 'whsec' });
  assert.equal(r.status, 200);
  const t = await call('POST', '/api/integration/test');
  assert.equal(t.body.ok, true);
});

let productId, customerId, saleId;

test('ürün, stok girişi ve terazi barkodu', async () => {
  let r = await call('POST', '/api/products', { name: 'Peynir', barcode: '2700123', unit: 'kg', buy_price: 20000, sell_price: 30000, vat_rate: 1, stock: 10, min_stock: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  productId = r.body.id;
  assert.equal(r.body.stock, 10);
  r = await call('POST', `/api/products/${productId}/stock`, { type: 'in', qty: 5, unit_cost: 21000 });
  assert.equal(r.body.stock, 15);
  assert.equal(r.body.buy_price, 21000);
  r = await call('GET', '/api/products/barcode/2700123012508'); // 1.250 kg
  assert.equal(r.body.product.id, productId);
  assert.equal(r.body.qty, 1.25);
  r = await call('POST', '/api/products', { name: 'Kopya', barcode: '2700123', sell_price: 100 });
  assert.equal(r.status, 409);
});

test('müşteri, kasa açılışı, karma ödemeli satış ve veresiye', async () => {
  let r = await call('POST', '/api/customers', { name: 'Mehmet Kaya', phone: '05320000000' });
  customerId = r.body.id;
  r = await call('POST', '/api/shifts/open', { register_name: 'Kasa 1', opening_cash: 50000 });
  assert.equal(r.status, 201);

  r = await call('POST', '/api/sales', {
    client_uuid: 'u-1', register_name: 'Kasa 1', customer_id: customerId, discount: 1000,
    items: [{ product_id: productId, qty: 2 }, { name: 'Çeşitli', qty: 1, unit_price: 5000, vat_rate: 20 }],
    payments: [{ method: 'cash', amount: 40000 }, { method: 'credit', amount: 24000 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  saleId = r.body.id;
  assert.equal(r.body.total, 64000);
  assert.equal(r.body.change, 0);
  assert.match(r.body.receipt_no, /^\d{8}-0001$/);

  // Aynı client_uuid tekrar gönderilirse ikinci satış oluşmamalı (çevrimdışı kuyruk)
  const dup = await call('POST', '/api/sales', { client_uuid: 'u-1', items: [{ name: 'x', qty: 1, unit_price: 1 }], payments: [{ method: 'cash', amount: 1 }] });
  assert.equal(dup.body.id, saleId);
  assert.equal(dup.body.duplicate, true);

  r = await call('GET', `/api/customers/${customerId}`);
  assert.equal(r.body.balance, 24000);
  r = await call('GET', `/api/products/${productId}`);
  assert.equal(r.body.stock, 13);

  // Eksik ödeme reddedilir, nakit fazlası para üstü olur
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', items: [{ product_id: productId, qty: 1 }], payments: [{ method: 'card', amount: 100 }] });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', items: [{ product_id: productId, qty: 1 }], payments: [{ method: 'cash', amount: 50000 }] });
  assert.equal(r.body.change, 20000);
  // Veresiye müşterisiz olmaz
  r = await call('POST', '/api/sales', { items: [{ product_id: productId, qty: 1 }], payments: [{ method: 'credit', amount: 30000 }] });
  assert.equal(r.status, 400);
});

test('kısmi iade ve tahsilat, gün sonu', async () => {
  const sale = (await call('GET', `/api/sales/${saleId}`)).body;
  let r = await call('POST', `/api/sales/${saleId}/refund`, { items: [{ sale_item_id: sale.items[0].id, qty: 1 }], method: 'cash' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'partial_refund');
  assert.ok(r.body.refunded_total > 29000 && r.body.refunded_total < 30000); // indirim payı düşülür

  r = await call('POST', `/api/customers/${customerId}/payment`, { amount: 10000, method: 'cash', register_name: 'Kasa 1' });
  assert.equal(r.body.balance, 14000);

  const cur = (await call('GET', '/api/shifts/current?register=Kasa%201')).body;
  const refunded = (await call('GET', `/api/sales/${saleId}`)).body.refunded_total;
  // 500 açılış + 400 nakit + 300 nakit (para üstü düşülmüş) - nakit iade + 100 tahsilat
  assert.equal(cur.expected_cash, 50000 + 40000 + 30000 - refunded + 10000);

  r = await call('POST', `/api/shifts/${cur.shift.id}/close`, { counted_cash: cur.expected_cash - 500 });
  assert.equal(r.body.difference, -500);
  r = await call('GET', '/api/shifts/current?register=Kasa%201');
  assert.equal(r.body, null);
});

test('raporlar', async () => {
  const r = await call('GET', '/api/reports/summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.count, 2);
  assert.ok(r.body.top_products.length > 0);
});

test('randevu çakışma kontrolü', async () => {
  const service = (await call('GET', '/api/products?type=service')).body[0];
  const body = { customer_id: customerId, staff_id: 1, service_id: service?.id, start_at: '2030-01-01 10:00', duration_min: 30 };
  let r = await call('POST', '/api/appointments', body);
  assert.equal(r.status, 201);
  r = await call('POST', '/api/appointments', { ...body, start_at: '2030-01-01 10:15' });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/appointments', { ...body, start_at: '2030-01-01 10:30' });
  assert.equal(r.status, 201);
});

test('outbox olayları CRMe imzalı gönderilir ve crm_id geri yazılır', async () => {
  const res = await flushOutbox(db, { limit: 500 });
  assert.equal(res.failed, 0);
  const names = crmEvents.map((e) => e.evt.event);
  for (const n of ['customer.created', 'sale.completed', 'sale.refunded', 'payment.received', 'shift.closed', 'appointment.created']) {
    assert.ok(names.includes(n), `${n} gönderilmedi: ${names.join(',')}`);
  }
  const e = crmEvents[0];
  assert.equal(e.auth, 'Bearer secret-key');
  assert.equal(e.signature, `sha256=${sign('whsec', e.raw)}`);
  const c = (await call('GET', `/api/customers/${customerId}`)).body;
  assert.equal(c.crm_id, 'CRM-42');
});

test('CRMden müşteri çekme ve imzalı webhook', async () => {
  let r = await call('POST', '/api/integration/pull-customers', { full: true });
  assert.equal(r.body.imported, 1);
  const list = (await call('GET', '/api/customers?q=Ayşe')).body;
  assert.equal(list[0].crm_id, 'CRM-7');

  const raw = JSON.stringify({ event: 'customer.upserted', data: { id: 'CRM-8', name: 'Zeynep Ak', phone: '0555' } });
  const bad = await fetch(`${base}/api/integration/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Velaris-Signature': 'sha256=00' }, body: raw });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${base}/api/integration/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Velaris-Signature': `sha256=${sign('whsec', raw)}` }, body: raw });
  assert.equal(ok.status, 200);
});

test('API anahtarı ile /api/v1 erişimi ve yetki sınırı', async () => {
  const { body } = await call('POST', '/api/api-keys', { name: 'Velaris CRM' });
  let r = await call('GET', '/api/v1/products', null, body.key);
  assert.equal(r.status, 200);
  r = await call('PUT', '/api/v1/settings', { business_name: 'Hack' }, body.key);
  assert.equal(r.status, 403);
  r = await call('GET', '/api/v1/products', null, 'vk_yanlis');
  assert.equal(r.status, 401);
});
