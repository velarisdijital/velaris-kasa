// Müşteri ekranı: kasa sepeti gönderir, ekran sorar (oturum gerekir)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp } from '../server/app.js';
import { cleanDisplayState } from '../server/routes/display.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'velaris-kasa-cd-'));
const { app, close } = createApp({ dataDir, worker: false });
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const call = (method, url, body, token) => fetch(base + url, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test('durum temizlenir: boşta kalem gösterilmez, alanlar sınırlanır', () => {
  const s = cleanDisplayState({ mode: 'idle', lines: [{ name: 'X', qty: 1 }], total: 500 });
  assert.equal(s.mode, 'idle');
  assert.deepEqual(s.lines, []);
  const c = cleanDisplayState({ mode: 'bogus', lines: [{ name: 'a'.repeat(200), qty: '2', unit_price: '150', total: 300, extra: 'gizli' }] });
  assert.equal(c.mode, 'idle');
  const k = cleanDisplayState({ mode: 'cart', lines: [{ name: 'a'.repeat(200), qty: '2', unit_price: '150', total: 300, extra: 'gizli' }] });
  assert.equal(k.lines[0].name.length, 80);
  assert.equal(k.lines[0].qty, 2);
  assert.equal(k.lines[0].extra, undefined);
});

test('kasa gönderir, ekran görür; değişiklik yoksa unchanged; oturumsuz erişilemez', async () => {
  let r = await call('POST', '/api/setup', { business_name: 'Ekran Market', business_type: 'market', admin_name: 'Ali', admin_pin: '1234' });
  const token = r.body.token;

  r = await call('GET', '/api/display/Kasa%201');
  assert.equal(r.status, 401);

  r = await call('GET', '/api/display/Kasa%201', null, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.state.mode, 'idle');

  r = await call('PUT', '/api/display/Kasa%201', { mode: 'cart', total: 4250, lines: [{ name: 'Süt 1 L', qty: 2, unit_price: 2125, total: 4250 }] }, token);
  assert.equal(r.status, 200);
  const seq = r.body.seq;

  r = await call('GET', '/api/display/Kasa%201', null, token);
  assert.equal(r.body.seq, seq);
  assert.equal(r.body.state.mode, 'cart');
  assert.equal(r.body.state.lines[0].name, 'Süt 1 L');
  assert.equal(r.body.state.total, 4250);

  r = await call('GET', `/api/display/Kasa%201?since=${seq}`, null, token);
  assert.equal(r.body.unchanged, true);

  r = await call('PUT', '/api/display/Kasa%201', { mode: 'paid', total: 4250, paid: 5000, change: 750 }, token);
  r = await call('GET', `/api/display/Kasa%201?since=${seq}`, null, token);
  assert.equal(r.body.state.mode, 'paid');
  assert.equal(r.body.state.change, 750);

  r = await call('GET', '/api/display', null, token);
  assert.deepEqual(r.body.map((x) => x.register), ['Kasa 1']);
});
