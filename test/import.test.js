// Tabletteki verilerin sunucuya taşınması (/api/setup/import) ve tablet uygulaması için CORS
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp } from '../server/app.js';

const dirs = [];
const apps = [];
async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-kasa-imp-'));
  dirs.push(dataDir);
  const { app, close } = createApp({ dataDir, worker: false });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  apps.push({ server, close });
  return `http://127.0.0.1:${server.address().port}`;
}
const json = (base, method, url, body, token) => fetch(base + url, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

after(() => {
  for (const a of apps) { a.server.close(); a.close(); }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('tabletteki veriler boş sunucuya taşınır, oturum korunur, dolu sunucuya taşınamaz', async () => {
  // "Tablet": kurulum + ürün
  const tablet = await start();
  let r = await json(tablet, 'POST', '/api/setup', { business_name: 'Tablet Market', business_type: 'market', admin_name: 'Ali', admin_pin: '1234' });
  const token = r.body.token;
  r = await json(tablet, 'POST', '/api/products', { name: 'Taşınan Ürün', sell_price: 1250, barcode: '8690000099999' }, token);
  assert.equal(r.status, 201);
  const bytes = Buffer.from(await (await fetch(`${tablet}/api/backup`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString('latin1'), 'SQLite format 3');

  // Yeni sunucu: önce CORS ön isteği
  const server = await start();
  const pre = await fetch(`${server}/api/setup/import`, { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);

  // Bozuk dosya reddedilir
  r = await fetch(`${server}/api/setup/import`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('merhaba') });
  assert.equal(r.status, 400);

  r = await fetch(`${server}/api/setup/import`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  const imp = await r.json();
  assert.equal(r.status, 200, JSON.stringify(imp));
  assert.ok(imp.products >= 1);

  r = await json(server, 'GET', '/api/setup/status');
  assert.equal(r.body.setup_done, true);
  // Tabletteki oturum anahtarı sunucuda da geçerli (yeniden giriş gerekmez)
  r = await json(server, 'GET', '/api/products', null, token);
  assert.equal(r.status, 200);
  assert.ok(r.body.some((p) => p.name === 'Taşınan Ürün'));
  r = await json(server, 'GET', '/api/settings', null, token);
  assert.equal(r.body.business_name, 'Tablet Market');

  // Artık dolu: ikinci taşıma reddedilir
  r = await fetch(`${server}/api/setup/import`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal(r.status, 409);
});
