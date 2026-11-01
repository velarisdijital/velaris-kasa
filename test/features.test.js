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

test('bildirim: deneme sağlayıcısı, borç mesajı, kampanya onay filtresi', async () => {
  let r = await call('POST', '/api/notify/test', { phone: '05321234567' });
  assert.equal(r.status, 400); // sağlayıcı kapalı
  await call('PUT', '/api/settings', { notify_provider: 'log', business_name: 'Yıldız Market' });
  r = await call('POST', '/api/notify/test', { phone: '05321234567' });
  assert.equal(r.body.status, 'sent');
  assert.equal(r.body.to_phone, '905321234567');
  r = await call('POST', '/api/notify/test', { phone: '0212 555 00 00' }); // sabit hat
  assert.equal(r.status, 400);

  const debtor = (await call('POST', '/api/customers', { name: 'Borçlu Ahmet', phone: '05551112233' })).body;
  await call('POST', `/api/customers/${debtor.id}/adjust`, { amount: 12550 });
  r = await call('POST', `/api/customers/${debtor.id}/notify-balance`);
  assert.equal(r.body.status, 'sent');
  assert.equal(r.body.body, 'Merhaba Borçlu, Yıldız Market hesabınızdaki güncel borç: 125,50 TL. Teşekkür ederiz.');

  // Kampanya yalnızca onaylı müşterilere
  await call('POST', '/api/customers', { name: 'Onaysız', phone: '05550000001' });
  await call('POST', '/api/customers', { name: 'Onaylı Ayşe', phone: '05550000002', sms_consent: 1 });
  r = await call('POST', '/api/notify/campaign', { message: 'Merhaba {ad}, hafta sonu %10 indirim!', dry: true });
  const consenting = r.body.count;
  r = await call('POST', '/api/notify/campaign', { message: 'Merhaba {ad}, hafta sonu %10 indirim!' });
  assert.equal(r.body.sent, consenting);
  const log = (await call('GET', '/api/notifications')).body.rows;
  assert.ok(log.some((n) => n.kind === 'marketing' && n.body === 'Merhaba Onaylı, hafta sonu %10 indirim!'));
  assert.ok(!log.some((n) => n.kind === 'marketing' && n.to_phone === '905550000001'));
});

test('bildirim: Netgsm isteği ve hata kodu', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.netgsm.com.tr/')) {
      seen.push(new URL(url));
      const pass = new URL(url).searchParams.get('password');
      return new Response(pass === 'dogru' ? '00 987654321' : '30');
    }
    return realFetch(url, opts);
  };
  try {
    await call('PUT', '/api/settings', { notify_provider: 'netgsm', netgsm_usercode: '8503330000', netgsm_password: 'yanlis', netgsm_header: 'YILDIZMRKT' });
    let r = await call('POST', '/api/notify/test', { phone: '+90 532 123 45 67', message: 'Deneme ğüşıöç' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /kullanıcı adı\/şifre/);
    await call('PUT', '/api/settings', { netgsm_password: 'dogru' });
    r = await call('POST', '/api/notify/test', { phone: '+90 532 123 45 67', message: 'Deneme ğüşıöç' });
    assert.equal(r.body.status, 'sent');
    assert.equal(r.body.provider_ref, '987654321');
    const q = seen.at(-1).searchParams;
    assert.equal(q.get('gsmno'), '905321234567');
    assert.equal(q.get('msgheader'), 'YILDIZMRKT');
    assert.equal(q.get('message'), 'Deneme ğüşıöç');
    assert.equal(q.get('dil'), 'TR');
    // Şifre ayarlarda maskeli döner
    const s = (await call('GET', '/api/settings')).body;
    assert.equal(s.netgsm_password, '••••••••');
  } finally {
    globalThis.fetch = realFetch;
    await call('PUT', '/api/settings', { notify_provider: 'log' });
  }
});

test('randevu hatırlatma zamanlayıcısı', async () => {
  const { runReminders } = await import('../server/notify.js');
  const { openDatabase } = await import('../server/db.js');
  const db = openDatabase(dataDir);
  const pad = (n) => String(n).padStart(2, '0');
  const at = (mins) => { const d = new Date(Date.now() + mins * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  await call('PUT', '/api/settings', { reminder_enabled: '1', reminder_hours: '3', public_base_url: 'https://kasa.ornek.com' });
  const soon = (await call('POST', '/api/appointments', { customer_name: 'Burak Can', phone: '05330001122', start_at: at(90), force: true })).body;
  const later = (await call('POST', '/api/appointments', { customer_name: 'Uzak', phone: '05330001123', start_at: at(60 * 24), force: true })).body;
  const noPhone = (await call('POST', '/api/appointments', { customer_name: 'Telefonsuz', start_at: at(30), force: true })).body;
  assert.ok(soon.id && later.id && noPhone.id);
  const n = await runReminders(db);
  assert.equal(n, 2); // yakın olan iki randevu (biri telefonsuz → atlanır)
  assert.equal(await runReminders(db), 0); // ikinci kez gönderilmez
  const log = (await call('GET', '/api/notifications')).body.rows;
  const msg = log.find((m) => m.appointment_id === soon.id);
  assert.equal(msg.status, 'sent');
  assert.match(msg.body, /^Merhaba Burak, \d\d\.\d\d\.\d{4} \d\d:\d\d için Yıldız Market randevunuzu hatırlatırız\. İptal\/değişiklik: https:\/\/kasa\.ornek\.com\/#\/r\/[0-9a-f]{24}$/);
  assert.equal(log.find((m) => m.appointment_id === noPhone.id).status, 'skipped');
  assert.ok(!log.some((m) => m.appointment_id === later.id));
  db.close();
});

test('online randevu: kapalıyken erişilmez, boş saat, çakışma, iptal', async () => {
  const pub = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  let r = await pub('GET', '/api/public/booking');
  assert.equal(r.status, 403);

  const svc = (await call('POST', '/api/products', { name: 'Saç Kesimi', type: 'service', sell_price: 30000, duration_min: 30 })).body;
  await call('PUT', '/api/settings', { booking_enabled: '1', booking_open: '09:00', booking_close: '12:00', booking_closed_days: '', notify_provider: 'log' });
  r = await pub('GET', '/api/public/booking');
  assert.equal(r.status, 200);
  assert.ok(r.body.services.some((s) => s.id === svc.id));
  const staffId = r.body.staff[0].id;

  const d = new Date(); d.setDate(d.getDate() + 2);
  const date = d.toLocaleDateString('sv-SE');
  r = await pub('GET', `/api/public/booking/slots?date=${date}&service_id=${svc.id}&staff_id=${staffId}`);
  assert.equal(r.body[0].time, '09:00');
  assert.equal(r.body.at(-1).time, '11:30'); // 30 dk hizmet 12:00'de bitmeli

  // Eksik/geçersiz bilgiler
  r = await pub('POST', '/api/public/booking', { service_id: svc.id, date, time: '09:00', name: 'A', phone: '123' });
  assert.equal(r.status, 400);

  r = await pub('POST', '/api/public/booking', { service_id: svc.id, staff_id: staffId, date, time: '10:00', name: 'Kerem Aydın', phone: '0533 444 55 66', sms_consent: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const token = r.body.token;
  // Aynı saat ikinci kez alınamaz, kesişen 10:15 de alınamaz
  r = await pub('POST', '/api/public/booking', { service_id: svc.id, staff_id: staffId, date, time: '10:15', name: 'Başka Biri', phone: '05334445567' });
  assert.equal(r.status, 409);
  r = await pub('GET', `/api/public/booking/slots?date=${date}&service_id=${svc.id}&staff_id=${staffId}`);
  assert.ok(!r.body.some((s) => ['09:45', '10:00', '10:15'].includes(s.time)));
  assert.ok(r.body.some((s) => s.time === '10:30'));

  // Müşteri kaydı ve onay oluştu, onay SMS'i gitti
  const cust = (await call('GET', '/api/customers?q=Kerem')).body[0];
  assert.equal(cust.sms_consent, 1);
  assert.equal(cust.consent_source, 'online');
  const log = (await call('GET', '/api/notifications')).body.rows;
  assert.ok(log.some((m) => m.kind === 'booking' && m.to_phone === '905334445566'));
  // Aynı telefonla ikinci randevu yeni müşteri oluşturmaz
  await pub('POST', '/api/public/booking', { service_id: svc.id, staff_id: staffId, date, time: '11:00', name: 'Kerem A.', phone: '+90 533 444 55 66' });
  assert.equal((await call('GET', '/api/customers?q=Kerem')).body.length, 1);

  // Kasada randevu "online" kaynağıyla görünür; müşteri iptal eder
  const appts = (await call('GET', `/api/appointments?date=${date}`)).body;
  assert.ok(appts.some((a) => a.source === 'online' && a.start_at === `${date} 10:00`));
  r = await pub('GET', `/api/public/booking/r/${token}`);
  assert.equal(r.body.service_name, 'Saç Kesimi');
  r = await pub('POST', `/api/public/booking/r/${token}/cancel`);
  assert.equal(r.body.status, 'cancelled');
  r = await pub('POST', `/api/public/booking/r/${token}/cancel`);
  assert.equal(r.status, 400);
  r = await pub('GET', '/api/public/booking/r/zzz');
  assert.equal(r.status, 404);
});

test('bulunamayan barkod için internetten ürün adı', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://world.openfoodfacts.org/')) {
      const code = String(url).match(/product\/(\d+)/)[1];
      return new Response(JSON.stringify(code === '8690504000017'
        ? { status: 1, product: { product_name: 'Gofret', product_name_tr: 'Çikolatalı Gofret', brands: 'Ülker, Ülker Bisküvi', quantity: '36 g' } }
        : { status: 0 }));
    }
    return realFetch(url, opts);
  };
  try {
    let r = await call('GET', '/api/products/lookup/8690504000017');
    assert.equal(r.body.name, 'Ülker Çikolatalı Gofret 36 g');
    r = await call('GET', '/api/products/lookup/8690000000000');
    assert.equal(r.status, 404);
    r = await call('GET', '/api/products/lookup/abc');
    assert.equal(r.status, 400);
    await call('PUT', '/api/settings', { product_lookup: '0' });
    r = await call('GET', '/api/products/lookup/8690504000018');
    assert.equal(r.status, 404);
  } finally {
    globalThis.fetch = realFetch;
    await call('PUT', '/api/settings', { product_lookup: '1' });
  }
});

test('e-Arşiv: simülatör ve Paraşüt akışı (KDV hariç fiyat, e-Fatura mükellefi kontrolü)', async () => {
  let s = await sell();
  let r = await call('POST', `/api/sales/${s.body.id}/invoice`);
  assert.equal(r.status, 400); // kapalı
  await call('PUT', '/api/settings', { invoice_provider: 'simulator' });
  r = await call('POST', `/api/sales/${s.body.id}/invoice`);
  assert.equal(r.body.invoice_status, 'done');
  assert.match(r.body.invoice_no, /^VLR\d{4}\d{9}$/);
  r = await call('POST', `/api/sales/${s.body.id}/invoice`);
  assert.equal(r.status, 400); // ikinci kez kesilmez

  // Paraşüt (sahte sunucu)
  const realFetch = globalThis.fetch;
  const reqs = [];
  let jobPolls = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.parasut.com/')) return realFetch(url, opts);
    const path = u.replace('https://api.parasut.com', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    reqs.push({ method: opts.method || 'GET', path, body, auth: opts.headers?.Authorization });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === '/oauth/token') return body.password === 'dogru' ? json({ access_token: 'tok', expires_in: 7200 }) : json({ error: 'invalid_grant', error_description: 'Kullanıcı adı veya şifre hatalı' }, 401);
    if (path === '/v4/555/contacts') return json({ data: { id: 'c1', type: 'contacts' } });
    if (path === '/v4/555/sales_invoices') return json({ data: { id: 'inv1', type: 'sales_invoices' } });
    if (path.startsWith('/v4/555/e_invoice_inboxes')) return json({ data: path.includes('1234567890') ? [{ attributes: { e_invoice_address: 'urn:mail:defaultpk@firma.com' } }] : [] });
    if (path === '/v4/555/e_archives') return json({ data: { id: 'job1' } });
    if (path === '/v4/555/e_invoices') return json({ data: { id: 'job2' } });
    if (path.startsWith('/v4/555/trackable_jobs/')) return json({ data: { attributes: { status: ++jobPolls % 2 ? 'running' : 'done' } } });
    if (path.startsWith('/v4/555/sales_invoices/inv1')) return json({ data: { attributes: { invoice_no: 'PRS2026000000042' } }, included: [{ type: 'e_archives', id: 'ea1' }, { type: 'e_invoices', id: 'ei1' }] });
    if (path.endsWith('/pdf')) return json({ data: { attributes: { url: 'https://cdn.parasut.com/fatura.pdf' } } });
    return json({ errors: [{ detail: `bilinmeyen ${path}` }] }, 404);
  };
  try {
    await call('PUT', '/api/settings', { invoice_provider: 'parasut', parasut_client_id: 'id', parasut_client_secret: 'sec', parasut_username: 'a@b.com', parasut_password: 'yanlis', parasut_company_id: '555', parasut_poll_ms: '5' });
    // Nihai tüketici, fiş indirimi: 2 x 50 TL (%20) + 1 x 100 TL (%1), 20 TL indirim
    s = await call('POST', '/api/sales', { register_name: 'Kasa 1', discount: 2000,
      items: [{ name: 'Kalem', qty: 2, unit_price: 5000, vat_rate: 20 }, { name: 'Peynir', qty: 1, unit_price: 10000, vat_rate: 1 }],
      payments: [{ method: 'card', amount: 18000 }] });
    r = await call('POST', `/api/sales/${s.body.id}/invoice`);
    assert.equal(r.body.invoice_status, 'failed');
    assert.match(r.body.invoice_error, /şifre hatalı/);

    await call('PUT', '/api/settings', { parasut_password: 'dogru' });
    r = await call('POST', `/api/sales/${s.body.id}/invoice`);
    assert.equal(r.body.invoice_status, 'done', JSON.stringify(r.body));
    assert.equal(r.body.invoice_no, 'PRS2026000000042');
    assert.equal(r.body.invoice_url, 'https://cdn.parasut.com/fatura.pdf');
    const contact = reqs.find((x) => x.path === '/v4/555/contacts').body.data.attributes;
    assert.equal(contact.tax_number, '11111111111');
    assert.equal(contact.name, 'Nihai Tüketici');
    const details = reqs.find((x) => x.path === '/v4/555/sales_invoices').body.data.relationships.details.data.map((d) => d.attributes);
    // 100 TL'lik satır 10 TL indirim payı alır → 90 TL KDV dahil → 2 adet → birim 45/1,20 = 37,5
    assert.deepEqual(details.map((d) => [d.description, d.quantity, d.unit_price, d.vat_rate]), [['Kalem', 2, 37.5, 20], ['Peynir', 1, 89.1089, 1]]);
    assert.ok(reqs.some((x) => x.path === '/v4/555/e_archives'));
    assert.ok(reqs.every((x) => x.path === '/oauth/token' || x.auth === 'Bearer tok'));

    // VKN'li ve e-Fatura mükellefi müşteri → e-Fatura
    const firm = (await call('POST', '/api/customers', { name: 'ABC Ltd', tax_number: '1234567890', tax_office: 'Kadıköy' })).body;
    s = await sell({ customer_id: firm.id });
    r = await call('POST', `/api/sales/${s.body.id}/invoice`);
    assert.equal(r.body.invoice_status, 'done');
    const einv = reqs.find((x) => x.path === '/v4/555/e_invoices').body.data;
    assert.equal(einv.attributes.to, 'urn:mail:defaultpk@firma.com');
    assert.equal(reqs.filter((x) => x.path === '/oauth/token').length, 2); // oturum tekrar kullanıldı
  } finally {
    globalThis.fetch = realFetch;
    await call('PUT', '/api/settings', { invoice_provider: 'none' });
  }
});

test('rapor: kasa / şube kırılımı ve filtre', async () => {
  for (const reg of ['Kadıköy Kasa 1', 'Kadıköy Kasa 2', 'Beşiktaş Kasa 1']) {
    await call('POST', '/api/sales', { register_name: reg, items: [{ name: 'X', qty: 1, unit_price: 1000, vat_rate: 20 }], payments: [{ method: 'cash', amount: 1000 }] });
  }
  const all = (await call('GET', '/api/reports/summary')).body;
  assert.ok(all.registers.some((r) => r.name === 'Beşiktaş Kasa 1'));
  const kd = (await call('GET', '/api/reports/summary?register=Kadıköy')).body;
  assert.equal(kd.totals.count, 2);
  assert.equal(kd.totals.total, 2000);
  const one = (await call('GET', `/api/reports/summary?register=${encodeURIComponent('Kadıköy Kasa 2')}`)).body;
  assert.equal(one.totals.count, 1);
});

test('şube bazlı stok: kasa-şube eşlemesi, satış, transfer, iade, rapor', async () => {
  const p = (await call('POST', '/api/products', { name: 'Çay 1 kg', barcode: '8690000999001', sell_price: 20000, buy_price: 15000, vat_rate: 1, stock: 50, min_stock: 5 })).body;
  // İlk stok Merkez'e
  let br = (await call('GET', `/api/products/${p.id}/branches`)).body;
  assert.deepEqual(br.map((b) => [b.name, b.stock]), [['Merkez', 50]]);

  const kad = (await call('POST', '/api/branches', { name: 'Kadıköy' })).body;
  assert.ok(kad.id > 1);
  await call('PUT', `/api/registers/${encodeURIComponent('Kadıköy Kasa 1')}`, { branch_id: kad.id });

  // Transfer Merkez → Kadıköy
  let r = await call('POST', '/api/stock/transfer', { product_id: p.id, from_branch_id: 1, to_branch_id: kad.id, qty: 12 });
  assert.deepEqual(r.body.map((b) => [b.name, b.stock]), [['Merkez', 38], ['Kadıköy', 12]]);
  r = await call('POST', '/api/stock/transfer', { product_id: p.id, from_branch_id: 1, to_branch_id: 1, qty: 1 });
  assert.equal(r.status, 400);

  // Kadıköy kasasından satış Kadıköy stoğundan düşer, toplam stok da düşer
  await call('POST', '/api/shifts/open', { register_name: 'Kadıköy Kasa 1' });
  const sale = (await call('POST', '/api/sales', { register_name: 'Kadıköy Kasa 1', items: [{ product_id: p.id, qty: 2 }], payments: [{ method: 'cash', amount: 40000 }] })).body;
  assert.equal(sale.branch_id, kad.id);
  br = (await call('GET', `/api/products/${p.id}/branches`)).body;
  assert.deepEqual(br.map((b) => b.stock), [38, 10]);
  assert.equal((await call('GET', `/api/products/${p.id}`)).body.stock, 48);

  // Kasa görünümünde stok = şube stoğu
  const pos = (await call('GET', `/api/products?register=${encodeURIComponent('Kadıköy Kasa 1')}&q=${encodeURIComponent('Çay 1')}`)).body[0];
  assert.equal(pos.stock, 10);
  assert.equal(pos.total_stock, 48);

  // İade satışın şubesine geri girer
  await call('POST', `/api/sales/${sale.id}/refund`, { method: 'cash', register_name: 'Kadıköy Kasa 1' });
  br = (await call('GET', `/api/products/${p.id}/branches`)).body;
  assert.deepEqual(br.map((b) => b.stock), [38, 12]);

  // Şubeye göre sayım ve hareket kaydı
  await call('POST', `/api/products/${p.id}/stock`, { type: 'count', qty: 9, branch_id: kad.id, note: 'Sayım' });
  const mv = (await call('GET', `/api/stock-movements?product_id=${p.id}&branch_id=${kad.id}`)).body;
  assert.equal(mv[0].branch_name, 'Kadıköy');
  assert.equal(mv[0].stock_after, 9);
  assert.equal((await call('GET', `/api/products/${p.id}`)).body.stock, 47);

  // Şube stok raporu
  const rep = (await call('GET', `/api/reports/stock?branch_id=${kad.id}`)).body;
  assert.equal(rep.value.cost_value, 9 * 15000);

  // Stoklu şube kapatılamaz
  r = await call('PUT', `/api/branches/${kad.id}`, { active: 0 });
  assert.equal(r.status, 400);
  const list = (await call('GET', '/api/branches')).body;
  assert.ok(list.registers.some((g) => g.name === 'Kadıköy Kasa 1' && g.branch_id === kad.id));
});

test('İYS: onayların otomatik yüklenmesi (sahte İYS sunucusu)', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.sandbox.iys.org.tr/')) return realFetch(url, opts);
    const body = JSON.parse(opts.body || '{}');
    seen.push({ path: u.replace('https://api.sandbox.iys.org.tr', ''), body, auth: opts.headers?.Authorization });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.endsWith('/oauth2/token')) return body.password === 'dogru' ? json({ access_token: 'iys-tok', expires_in: 7200 }) : json({ errors: [{ code: 'H102', message: 'Kullanıcı adı veya şifre hatalı' }] }, 401);
    if (u.endsWith('/sps/654321/brands/654322/consents')) {
      if (body.recipient === '+905009999999') return json({ errors: [{ code: 'H174', message: 'Alıcı formatı hatalı' }] }, 400);
      if (body.recipient === 'zaten@ornek.com') return json({ errors: [{ message: 'Kayıt mevcut' }] }, 409);
      return json({ transactionId: 'tx1', creationDate: '2026-10-30 12:00:00' });
    }
    return json({}, 404);
  };
  try {
    // Önceki testlerdeki onaylar dışa aktarılmış sayılsın
    await call('GET', '/api/iys/export?mark=1');
    let r = await call('POST', '/api/iys/push');
    assert.equal(r.status, 400); // kapalı

    await call('PUT', '/api/settings', { iys_enabled: '1', iys_env: 'sandbox', iys_username: 'u', iys_password: 'yanlis', iys_code: '654321', iys_brand_code: '654322' });
    const a = (await call('POST', '/api/customers', { name: 'İYS Bir', phone: '0532 111 00 01', sms_consent: 1 })).body;
    const b = (await call('POST', '/api/customers', { name: 'İYS İki', phone: '0500 999 99 99', email: 'zaten@ornek.com', sms_consent: 1, email_consent: 1 })).body;
    r = await call('POST', '/api/iys/push');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /şifre hatalı/);

    await call('PUT', '/api/settings', { iys_password: 'dogru' });
    r = await call('POST', '/api/iys/push');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.sent >= 1);
    assert.equal(r.body.failed, 1);
    assert.ok(!seen.some((x) => x.path.endsWith('/consents') && x.body.recipient === '+905321112233')); // anonimleştirilmiş müşteri gönderilmez
    const first = seen.find((x) => x.body.recipient === '+905321110001');
    assert.deepEqual(Object.keys(first.body).sort(), ['consentDate', 'recipient', 'recipientType', 'source', 'status', 'type']);
    assert.equal(first.body.status, 'ONAY');
    assert.equal(first.body.source, 'HS_FIZIKSEL_ORTAM');
    assert.equal(first.body.recipientType, 'BIREYSEL');
    assert.match(first.body.consentDate, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(first.auth, 'Bearer iys-tok');
    const st = (await call('GET', '/api/iys/status')).body;
    assert.equal(st.failed, 1);
    assert.match(st.errors[0].iys_error, /Alıcı formatı hatalı/);
    assert.ok((await call('GET', `/api/customers/${a.id}`)).body.iys_exported_at);
    assert.equal((await call('GET', `/api/customers/${b.id}`)).body.iys_exported_at, null);

    // Onay geri alınınca RET olarak yeniden gönderilir
    await call('PUT', `/api/customers/${a.id}`, { sms_consent: 0 });
    await call('POST', '/api/iys/push');
    assert.equal(seen.filter((x) => x.body.recipient === '+905321110001').at(-1).body.status, 'RET');
  } finally {
    globalThis.fetch = realFetch;
    await call('PUT', '/api/settings', { iys_enabled: '0' });
  }
});

test('toplu fiyat güncelleme: önizleme, yüzde, yuvarlama, kâr marjı, geçmiş', async () => {
  const cat = (await call('POST', '/api/categories', { name: 'Zam Test' })).body;
  const a = (await call('POST', '/api/products', { name: 'Zam A', category_id: cat.id, buy_price: 1000, sell_price: 1490 })).body;
  const b = (await call('POST', '/api/products', { name: 'Zam B', category_id: cat.id, buy_price: 0, sell_price: 2000 })).body;
  // Önizleme: değişiklik yapmaz
  let r = await call('POST', '/api/products/bulk-price', { scope: { category_id: cat.id }, mode: 'percent', value: 10, round: 25, dry: true });
  assert.equal(r.body.applied, false);
  assert.deepEqual(r.body.changes.map((c) => [c.name, c.old_price, c.new_price]), [['Zam A', 1490, 1650], ['Zam B', 2000, 2200]]);
  assert.equal((await call('GET', `/api/products/${a.id}`)).body.sell_price, 1490);
  // Uygula
  r = await call('POST', '/api/products/bulk-price', { scope: { category_id: cat.id }, mode: 'percent', value: 10, round: 25 });
  assert.equal(r.body.count, 2);
  const pa = (await call('GET', `/api/products/${a.id}`)).body;
  assert.equal(pa.sell_price, 1650);
  assert.ok(pa.price_changed_at);
  // Alış + %50 kâr, 1 TL'ye yuvarla; alışı olmayan atlanır
  r = await call('POST', '/api/products/bulk-price', { scope: { ids: [a.id, b.id] }, mode: 'margin', value: 50, round: 100 });
  assert.deepEqual(r.body.changes.map((c) => c.new_price), [1500]);
  assert.equal(r.body.skipped[0].name, 'Zam B');
  // TL ekleme
  r = await call('POST', '/api/products/bulk-price', { scope: { ids: [b.id] }, mode: 'amount', value: -250 });
  assert.equal(r.body.changes[0].new_price, 1950);
  // Geçmiş: elle düzenleme de kaydedilir
  await call('PUT', `/api/products/${a.id}`, { ...pa, sell_price: 1600 });
  const hist = (await call('GET', `/api/products/${a.id}/prices`)).body;
  assert.deepEqual(hist.map((x) => [x.old_price, x.new_price]), [[1500, 1600], [1650, 1500], [1490, 1650]]);
  assert.equal(hist[0].reason, 'Ürün düzenleme');
  // Kapsam zorunlu
  r = await call('POST', '/api/products/bulk-price', { scope: {}, mode: 'percent', value: 5 });
  assert.equal(r.status, 400);
});

test('etiket: fiyatı değişenler listesi ve basıldı işareti', async () => {
  const p = (await call('POST', '/api/products', { name: 'Etiket Ürünü', barcode: '8691234567893', sell_price: 1000 })).body;
  let due = (await call('GET', '/api/products?label_due=1')).body;
  assert.ok(!due.some((x) => x.id === p.id)); // fiyatı hiç değişmedi
  await call('POST', '/api/products/bulk-price', { scope: { ids: [p.id] }, mode: 'percent', value: 20 });
  due = (await call('GET', '/api/products?label_due=1')).body;
  assert.ok(due.some((x) => x.id === p.id));
  await call('POST', '/api/products/labels-printed', { ids: [p.id] });
  due = (await call('GET', '/api/products?label_due=1')).body;
  assert.ok(!due.some((x) => x.id === p.id));
});

test('tedarikçi ve alış faturası: stok girişi, alış fiyatı, borç, nakit ödeme, iptal', async () => {
  const p = (await call('POST', '/api/products', { name: 'Alış Ürünü', buy_price: 500, sell_price: 1500, vat_rate: 20, stock: 2 })).body;
  let r = await call('POST', '/api/suppliers', { name: 'Toptancı A', tax_number: '123' });
  assert.equal(r.status, 400); // VKN hatalı
  const s = (await call('POST', '/api/suppliers', { name: 'Toptancı A', tax_number: '1234567890' })).body;

  const shiftBefore = (await call('GET', '/api/shifts/current?register=Kasa%201')).body;
  // KDV hariç 10,00 TL × 12 → brüt 12,00 TL; 50 TL nakit ödendi
  r = await call('POST', '/api/purchases', {
    supplier_id: s.id, doc_type: 'fatura', doc_no: 'A-001', doc_date: '2026-10-30',
    items: [{ product_id: p.id, qty: 12, unit_price: 1000 }],
    payment: { amount: 5000, method: 'cash', register_name: 'Kasa 1' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.net_total, 12000);
  assert.equal(r.body.total, 14400);
  assert.equal(r.body.paid, 5000);
  const prod = (await call('GET', `/api/products/${p.id}`)).body;
  assert.equal(prod.stock, 14);
  assert.equal(prod.buy_price, 1200);
  let sup = (await call('GET', `/api/suppliers/${s.id}`)).body;
  assert.equal(sup.balance, 9400);
  assert.deepEqual(sup.transactions.map((t) => t.type), ['payment', 'purchase']);
  assert.equal(sup.stats.purchase_count, 1);
  const shiftAfter = (await call('GET', '/api/shifts/current?register=Kasa%201')).body;
  const outs = (x) => (x.movements || []).filter((m) => m.type === 'out').length;
  assert.equal(outs(shiftAfter), outs(shiftBefore) + 1);

  // Aynı belge no ikinci kez girilemez
  r = await call('POST', '/api/purchases', { supplier_id: s.id, doc_no: 'A-001', items: [{ product_id: p.id, qty: 1, unit_price: 1000 }] });
  assert.equal(r.status, 400);

  // KDV dahil fiyatla, alış fiyatı güncellenmeden
  r = await call('POST', '/api/purchases', { supplier_id: s.id, doc_no: 'A-002', prices_include_vat: true, update_buy_price: false,
    items: [{ product_id: p.id, qty: 1, unit_price: 1200 }] });
  assert.equal(r.body.net_total, 1000);
  assert.equal((await call('GET', `/api/products/${p.id}`)).body.buy_price, 1200);

  // Tedarikçiye havale
  r = await call('POST', `/api/suppliers/${s.id}/payment`, { amount: 1200, method: 'transfer' });
  assert.equal(r.body.balance, 9400);

  // İptal: stok düşer, fatura tutarı borçtan çıkar (ödenen kısım alacak olarak kalır)
  const first = (await call('GET', `/api/purchases?supplier_id=${s.id}`)).body.find((x) => x.doc_no === 'A-001');
  r = await call('POST', `/api/purchases/${first.id}/cancel`);
  assert.equal(r.body.status, 'cancelled');
  assert.equal((await call('GET', `/api/products/${p.id}`)).body.stock, 3);
  sup = (await call('GET', `/api/suppliers/${s.id}`)).body;
  assert.equal(sup.balance, -5000);
  assert.equal((await call('POST', `/api/purchases/${first.id}/cancel`)).status, 400);
  // İptal edilen belge numarası yeniden girilebilir
  r = await call('POST', '/api/purchases', { supplier_id: s.id, doc_no: 'A-001', items: [{ product_id: p.id, qty: 1, unit_price: 1000 }] });
  assert.equal(r.status, 201);
});

test('kafe: masa aç, sipariş, mutfak, iptal, taşıma/birleştirme, hesap bölme ve kapanış', async () => {
  const tables = (await call('POST', '/api/tables', { count: 3, prefix: 'Masa', zone: 'Salon' })).body;
  assert.equal(tables.length, 3);
  const [m1, m2, m3] = tables;
  const cay = (await call('POST', '/api/products', { name: 'Çay', sell_price: 1500, vat_rate: 10, track_stock: 0 })).body;
  const tost = (await call('POST', '/api/products', { name: 'Tost', sell_price: 9000, vat_rate: 10, stock: 10, track_stock: 1 })).body;

  let t = (await call('POST', `/api/tables/${m1.id}/ticket`, { guest_count: 2, items: [{ product_id: cay.id, qty: 2 }] })).body;
  assert.equal(t.status, 'open');
  // Aynı masayı tekrar açmak mevcut adisyonu döndürür
  assert.equal((await call('POST', `/api/tables/${m1.id}/ticket`)).body.id, t.id);
  t = (await call('POST', `/api/tickets/${t.id}/items`, { items: [{ product_id: cay.id, qty: 1 }, { product_id: tost.id, qty: 2, note: 'kaşarlı' }] })).body;
  assert.equal(t.items.length, 2); // çaylar birleşti
  assert.equal(t.items[0].qty, 3);
  assert.equal(t.total, 3 * 1500 + 2 * 9000);
  assert.equal(t.unsent_count, 2);

  // Mutfak fişi
  let k = await call('POST', `/api/tickets/${t.id}/kitchen`);
  assert.equal(k.body.kitchen.items.length, 2);
  assert.equal(k.body.kitchen.items[1].note, 'kaşarlı');
  assert.equal((await call('POST', `/api/tickets/${t.id}/kitchen`)).status, 400);
  // Gönderilmiş kalem azaltılamaz; sebepli kısmi iptal
  const tostLine = t.items.find((i) => i.product_id === tost.id);
  assert.equal((await call('PUT', `/api/tickets/${t.id}/items/${tostLine.id}`, { qty: 1 })).status, 400);
  assert.equal((await call('POST', `/api/tickets/${t.id}/items/${tostLine.id}/void`, { qty: 1 })).status, 400); // sebep yok
  t = (await call('POST', `/api/tickets/${t.id}/items/${tostLine.id}/void`, { qty: 1, reason: 'İkram' })).body;
  assert.equal(t.total, 3 * 1500 + 9000);
  assert.equal(t.items.filter((i) => i.void_at).length, 1);

  // Masa listesi: açık masa tutarı
  let list = (await call('GET', '/api/tables')).body;
  assert.equal(list.find((x) => x.id === m1.id).remaining_total, 13500);
  assert.equal(list.find((x) => x.id === m2.id).ticket_id, null);

  // Taşıma: boş masaya
  t = (await call('POST', `/api/tickets/${t.id}/move`, { table_id: m2.id })).body;
  assert.equal(t.table_id, m2.id);
  // Birleştirme: Masa 3'te açık adisyon → Masa 2'ye birleşir
  const t3 = (await call('POST', `/api/tables/${m3.id}/ticket`, { guest_count: 1, items: [{ product_id: cay.id, qty: 1 }] })).body;
  t = (await call('POST', `/api/tickets/${t3.id}/move`, { table_id: m2.id })).body;
  assert.equal(t.id, (await call('GET', '/api/tables')).body.find((x) => x.id === m2.id).ticket_id);
  assert.equal(t.guest_count, 3);
  assert.equal(t.remaining_total, 15000);
  assert.equal((await call('GET', `/api/tickets/${t3.id}`)).body.status, 'cancelled');

  // Hesap bölme: önce tost ödenir
  const live = t.items.filter((i) => !i.void_at);
  const tl = live.find((i) => i.product_id === tost.id);
  let r = await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: t.id,
    items: [{ product_id: tost.id, qty: 1, ticket_item_id: tl.id }], payments: [{ method: 'card', amount: 9000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  t = (await call('GET', `/api/tickets/${t.id}`)).body;
  assert.equal(t.status, 'open');
  assert.equal(t.remaining_total, 6000);
  assert.equal(t.sales.length, 1);
  assert.equal((await call('GET', `/api/products/${tost.id}`)).body.stock, 9); // stok satışta düşer
  // Fazla miktar reddedilir
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: t.id,
    items: [{ product_id: tost.id, qty: 1, ticket_item_id: tl.id }], payments: [{ method: 'cash', amount: 9000 }] });
  assert.equal(r.status, 400);
  // Kalan çaylar (iki ayrı satır) → adisyon kapanır
  const rest = t.items.filter((i) => i.remaining_qty > 0);
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: t.id,
    items: rest.map((i) => ({ product_id: i.product_id, qty: i.remaining_qty, ticket_item_id: i.id })), payments: [{ method: 'cash', amount: 10000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.change, 4000);
  t = (await call('GET', `/api/tickets/${t.id}`)).body;
  assert.equal(t.status, 'closed');
  assert.equal(t.paid_total, 15000);
  list = (await call('GET', '/api/tables')).body;
  assert.equal(list.find((x) => x.id === m2.id).ticket_id, null);

  // Kalem aktarma ve adisyon iptali
  const a = (await call('POST', `/api/tables/${m1.id}/ticket`, { items: [{ product_id: cay.id, qty: 4 }] })).body;
  const moved = (await call('POST', `/api/tickets/${a.id}/transfer`, { table_id: m3.id, items: [{ id: a.items[0].id, qty: 1 }] })).body;
  assert.equal(moved.from.remaining_total, 4500);
  assert.equal(moved.to.remaining_total, 1500);
  assert.equal((await call('POST', `/api/tickets/${a.id}/cancel`)).body.status, 'cancelled'); // mutfağa gitmemiş → sebepsiz
  const voids = (await call('GET', '/api/tickets-voids')).body;
  assert.ok(voids.some((v) => v.void_reason === 'İkram'));
});

test('reçete: satışta bileşen stoğu düşer, maliyet reçeteden, iade geri ekler, stok kontrolü', async () => {
  const ekmek = (await call('POST', '/api/products', { name: 'Tost Ekmeği', unit: 'adet', buy_price: 500, sell_price: 0, stock: 10 })).body;
  const kasar = (await call('POST', '/api/products', { name: 'Kaşar', unit: 'kg', buy_price: 40000, sell_price: 0, stock: 1 })).body;
  const tost = (await call('POST', '/api/products', { name: 'Kaşarlı Tost R', sell_price: 9000, vat_rate: 10, stock: 0 })).body;
  // 2 dilim ekmek + 50 g kaşar
  let r = await call('PUT', `/api/products/${tost.id}/recipe`, { items: [{ component_id: ekmek.id, qty: 2 }, { component_id: kasar.id, qty: 0.05 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cost, 3000);
  assert.equal(r.body.product.buy_price, 3000);
  assert.equal(r.body.product.track_stock, 0);
  assert.equal(r.body.product.recipe_count, 2);
  // Geçersiz: kendisi, iç içe
  assert.equal((await call('PUT', `/api/products/${tost.id}/recipe`, { items: [{ component_id: tost.id, qty: 1 }] })).status, 400);
  const menu = (await call('POST', '/api/products', { name: 'Tost Menü', sell_price: 12000 })).body;
  assert.equal((await call('PUT', `/api/products/${menu.id}/recipe`, { items: [{ component_id: tost.id, qty: 1 }] })).status, 400);

  // Satış: 3 tost → 6 ekmek, 0.15 kg kaşar düşer; maliyet 3 × 30 TL
  const sale = await call('POST', '/api/sales', { register_name: 'Kasa 1', items: [{ product_id: tost.id, qty: 3 }], payments: [{ method: 'cash', amount: 27000 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.cost_total, 9000);
  assert.equal((await call('GET', `/api/products/${ekmek.id}`)).body.stock, 4);
  assert.equal((await call('GET', `/api/products/${kasar.id}`)).body.stock, 0.85);
  // Bileşen yetmezse satış durur (negatif stok kapalıyken)
  await call('PUT', '/api/settings', { allow_negative_stock: '0' });
  r = await call('POST', '/api/sales', { register_name: 'Kasa 1', items: [{ product_id: tost.id, qty: 3 }], payments: [{ method: 'cash', amount: 27000 }] });
  await call('PUT', '/api/settings', { allow_negative_stock: '1' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Tost Ekmeği/);
  // İade: bileşenler geri gelir
  await call('POST', `/api/sales/${sale.body.id}/refund`, { method: 'cash' });
  assert.equal((await call('GET', `/api/products/${ekmek.id}`)).body.stock, 10);
  // Bileşenin alış fiyatı değişince reçeteli ürünün maliyeti güncellenir
  const k = (await call('GET', `/api/products/${kasar.id}`)).body;
  await call('PUT', `/api/products/${kasar.id}`, { ...k, buy_price: 60000 });
  assert.equal((await call('GET', `/api/products/${tost.id}`)).body.buy_price, 4000);
  const rec = (await call('GET', `/api/products/${kasar.id}/recipe`)).body;
  assert.equal(rec.used_in[0].name, 'Kaşarlı Tost R');
  // Reçeteyi kaldır
  r = await call('PUT', `/api/products/${tost.id}/recipe`, { items: [] });
  assert.equal(r.body.product.recipe_count, 0);
});

test('QR menü: kapalıyken erişilmez, menü, garson çağır, sipariş isteği onayı adisyona düşer', async () => {
  const pub = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  await call('PUT', '/api/settings', { modules_tables: '1' });
  const [masa] = (await call('POST', '/api/tables', { name: 'QR Masa' })).body;
  const list = (await call('GET', '/api/tables')).body;
  const token = list.find((x) => x.id === masa.id).qr_token;
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.equal((await pub('GET', `/api/public/menu?t=${token}`)).status, 403);

  await call('PUT', '/api/settings', { qrmenu_enabled: '1', qrmenu_note: 'Wi-Fi: kafe123' });
  const kahve = (await call('POST', '/api/products', { name: 'QR Latte', sell_price: 9500, track_stock: 0, menu_description: 'Çift shot' })).body;
  const gizli = (await call('POST', '/api/products', { name: 'Gizli Ürün', sell_price: 100, menu_hidden: 1 })).body;
  let m = await pub('GET', `/api/public/menu?t=${token}`);
  assert.equal(m.status, 200);
  assert.equal(m.body.table.name, 'QR Masa');
  assert.equal(m.body.note, 'Wi-Fi: kafe123');
  assert.equal(m.body.orders_enabled, false);
  assert.ok(m.body.products.some((p) => p.id === kahve.id && p.description === 'Çift shot'));
  assert.ok(!m.body.products.some((p) => p.id === gizli.id));
  // Masasız da menü görülür ama sipariş/istek olmaz
  assert.equal((await pub('GET', '/api/public/menu')).body.table, null);
  assert.equal((await pub('POST', '/api/public/menu/request', { t: 'deadbeefdeadbeef', type: 'waiter' })).status, 400);

  // Garson çağır (tekrar basılırsa çoğalmaz)
  assert.equal((await pub('POST', '/api/public/menu/request', { t: token, type: 'waiter' })).status, 201);
  assert.equal((await pub('POST', '/api/public/menu/request', { t: token, type: 'waiter' })).status, 200);
  // Sipariş kapalıyken reddedilir, açınca gelir
  assert.equal((await pub('POST', '/api/public/menu/request', { t: token, type: 'order', items: [{ product_id: kahve.id, qty: 2 }] })).status, 400);
  await call('PUT', '/api/settings', { qrmenu_orders: '1' });
  assert.equal((await pub('POST', '/api/public/menu/request', { t: token, type: 'order', items: [{ product_id: gizli.id, qty: 1 }] })).status, 400);
  assert.equal((await pub('POST', '/api/public/menu/request', { t: token, type: 'order', items: [{ product_id: kahve.id, qty: 2, note: 'yulaf sütü' }] })).status, 201);

  const tables = (await call('GET', '/api/tables')).body;
  assert.equal(tables.find((x) => x.id === masa.id).requests.split(',').sort().join(','), 'order,waiter');
  const reqs = (await call('GET', '/api/table-requests')).body.filter((q) => q.table_id === masa.id);
  const order = reqs.find((q) => q.type === 'order');
  assert.equal(order.items[0].name, 'QR Latte');
  const acc = (await call('POST', `/api/table-requests/${order.id}/accept`)).body;
  assert.equal(acc.ticket.table_id, masa.id);
  assert.equal(acc.ticket.items[0].qty, 2);
  assert.equal(acc.ticket.items[0].note, 'yulaf sütü · QR');
  assert.equal((await call('POST', `/api/table-requests/${order.id}/accept`)).status, 400);
  const waiter = reqs.find((q) => q.type === 'waiter');
  assert.equal((await call('POST', `/api/table-requests/${waiter.id}/accept`)).body.request.status, 'done');
  assert.equal((await call('GET', '/api/tables')).body.find((x) => x.id === masa.id).requests, null);
  // QR yenilenince eski kod geçersiz
  await call('POST', `/api/tables/${masa.id}/qr-reset`);
  assert.equal((await pub('GET', `/api/public/menu?t=${token}`)).body.table, null);
});

test('garson: hesap bildirimi, ödeme sonrası istek kapanır, masa/garson raporu', async () => {
  await call('PUT', '/api/settings', { modules_tables: '1' });
  const [masa] = (await call('POST', '/api/tables', { name: 'Rapor Masa' })).body;
  const cay = (await call('POST', '/api/products', { name: 'Rapor Çay', sell_price: 1500, track_stock: 0 })).body;
  let t = (await call('POST', `/api/tables/${masa.id}/ticket`, { guest_count: 2, items: [{ product_id: cay.id, qty: 4 }] })).body;
  await call('POST', `/api/tickets/${t.id}/kitchen`);
  t = (await call('POST', `/api/tickets/${t.id}/items/${t.items[0].id}/void`, { qty: 1, reason: 'İkram' })).body;
  await call('POST', `/api/tickets/${t.id}/bill-request`);
  await call('POST', `/api/tickets/${t.id}/bill-request`); // tekrar basılırsa çoğalmaz
  let reqs = (await call('GET', '/api/table-requests')).body.filter((q) => q.table_id === masa.id);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].type, 'bill');
  const live = t.items.find((i) => !i.void_at);
  await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: t.id, items: [{ product_id: cay.id, qty: 3, ticket_item_id: live.id }],
    payments: [{ method: 'cash', amount: 4500 }] });
  reqs = (await call('GET', '/api/table-requests')).body.filter((q) => q.table_id === masa.id);
  assert.equal(reqs.length, 0);
  const rep = (await call('GET', '/api/reports/tables')).body;
  const me = rep.waiters.find((w) => w.name === 'Ali');
  assert.ok(me.order_total >= 4500);
  assert.ok(me.void_total >= 1500);
  assert.ok(rep.tickets.count >= 1);
  assert.ok(rep.voids.some((v) => v.void_reason === 'İkram' && v.table_name === 'Rapor Masa'));
});

test('paket servis: sipariş, ücret, durumlar, kurye, ödeme ve kurye raporu; gel-al', async () => {
  await call('PUT', '/api/settings', { modules_delivery: '1', delivery_fee: '1500', delivery_couriers: 'Ahmet, Mehmet' });
  const doner = (await call('POST', '/api/products', { name: 'Paket Döner', sell_price: 15000, track_stock: 0 })).body;
  const cust = (await call('POST', '/api/customers', { name: 'Paket Müşteri', phone: '0532 999 88 77', address: 'Moda Cad. 5' })).body;
  assert.equal((await call('POST', '/api/deliveries', { kind: 'delivery', customer_name: 'X', items: [{ product_id: doner.id, qty: 1 }] })).status, 400); // adres yok
  // Telefonla müşteri bulma
  const found = (await call('GET', '/api/deliveries/customer?phone=05329998877')).body;
  assert.equal(found.customer.id, cust.id);
  let d = (await call('POST', '/api/deliveries', { kind: 'delivery', source: 'phone', customer_id: cust.id, address: 'Moda Cad. 5 D:3',
    delivery_note: 'Zil bozuk', items: [{ product_id: doner.id, qty: 2 }], delivery_fee: 1500, payment_hint: 'Kapıda nakit' })).body;
  assert.equal(d.kind, 'delivery');
  assert.equal(d.table_name, `Paket #${d.order_no}`);
  assert.equal(d.customer_name, 'Paket Müşteri');
  assert.equal(d.total, 31500);
  assert.equal(d.delivery_status, 'new');
  assert.equal(d.source, 'phone');
  // Mutfak fişinde not
  const k = (await call('POST', `/api/tickets/${d.id}/kitchen`)).body.kitchen;
  assert.equal(k.note, 'Zil bozuk');
  // Masaya taşınamaz
  const [m] = (await call('POST', '/api/tables', { name: 'Paket Test Masa' })).body;
  assert.equal((await call('POST', `/api/tickets/${d.id}/move`, { table_id: m.id })).status, 400);
  // Kuryesiz yola çıkamaz
  assert.equal((await call('PUT', `/api/deliveries/${d.id}`, { delivery_status: 'on_way' })).status, 400);
  d = (await call('PUT', `/api/deliveries/${d.id}`, { delivery_status: 'on_way', courier_name: 'Ahmet' })).body;
  assert.equal(d.courier_name, 'Ahmet');
  let active = (await call('GET', '/api/deliveries')).body;
  assert.ok(active.some((x) => x.id === d.id));
  // Teslim edildi ama ödenmedi → hâlâ listede; ödeme alınınca düşer
  await call('PUT', `/api/deliveries/${d.id}`, { delivery_status: 'delivered' });
  assert.ok((await call('GET', '/api/deliveries')).body.some((x) => x.id === d.id));
  const r = await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: d.id,
    items: d.items.map((i) => ({ product_id: i.product_id, name: i.name, unit_price: i.unit_price, vat_rate: i.vat_rate, qty: i.qty, ticket_item_id: i.id })),
    payments: [{ method: 'cash', amount: 31500 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(!(await call('GET', '/api/deliveries')).body.some((x) => x.id === d.id));
  assert.ok((await call('GET', '/api/deliveries?all=1')).body.some((x) => x.id === d.id));
  const rep = (await call('GET', '/api/reports/tables')).body;
  assert.equal(rep.couriers.find((c) => c.name === 'Ahmet').count, 1);
  assert.ok(rep.channels.some((c) => c.kind === 'delivery' && c.source === 'phone'));
  // Gel-al: adres gerekmez, servis ücreti eklenmez
  const g = (await call('POST', '/api/deliveries', { kind: 'takeaway', customer_name: 'Ayşe', items: [{ product_id: doner.id, qty: 1 }], delivery_fee: 1500 })).body;
  assert.equal(g.total, 15000);
  assert.equal(g.table_name, `Gel-al #${g.order_no}`);
  assert.equal(g.order_no, d.order_no + 1);
  assert.equal((await call('GET', '/api/deliveries/settings')).body.couriers.join('|'), 'Ahmet|Mehmet');
});

test('yemek platformları: imzalı webhook, eşleme, kabul/ret, durum bildirimi, iptal, online ödeme', async () => {
  const crypto = await import('node:crypto');
  const hook = async (body, secret) => {
    const raw = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const res = await fetch(`${base}/api/integrations/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VK-Signature': `sha256=${sig}` }, body: raw });
    return { status: res.status, body: await res.json() };
  };
  // Sahte entegratör: durum bildirimlerini toplar
  const http = await import('node:http');
  const got = [];
  const cb = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push({ sig: req.headers['x-vk-signature'], body: JSON.parse(b) }); res.end('{}'); }); });
  await new Promise((r) => cb.listen(0, r));
  try {
    assert.equal((await hook({ platform: 'yemeksepeti', external_id: 'X' }, 'yanlis')).status, 401); // kapalı
    const secret = (await call('POST', '/api/platforms/secret')).body.secret;
    await call('PUT', '/api/settings', { platforms_enabled: '1', modules_delivery: '1', platform_callback_url: `http://127.0.0.1:${cb.address().port}/cb` });
    assert.equal((await call('GET', '/api/settings')).body.platform_secret, '••••••••');
    assert.equal((await hook({ platform: 'yemeksepeti', external_id: 'X' }, 'yanlis')).status, 401);

    const lahmacun = (await call('POST', '/api/products', { name: 'Lahmacun', sell_price: 6000, track_stock: 0 })).body;
    const order = {
      platform: 'yemeksepeti', external_id: 'YS-1001',
      customer: { name: 'Elif', phone: '0532 123 45 67', address: 'Bağdat Cad. 100', note: 'Acısız' },
      items: [{ external_id: 'p-77', name: 'lahmacun', qty: 3, unit_price: 6000, options: [{ name: 'Ekstra limon', price: 200 }] },
        { external_id: 'p-99', name: 'Ayran (Büyük)', qty: 1, unit_price: 3000 }],
      delivery_fee: 0, discount: 1500, paid_online: true,
    };
    let r = await hook(order, secret);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'created');
    assert.deepEqual(r.body.unmapped, ['Ayran (Büyük)']);
    const id = r.body.ticket_id;
    // Aynı sipariş ikinci kez gelirse çoğalmaz
    assert.equal((await hook(order, secret)).body.action, 'duplicate');
    let t = (await call('GET', `/api/tickets/${id}`)).body;
    assert.equal(t.source, 'yemeksepeti');
    assert.equal(t.external_status, 'pending');
    assert.equal(t.prepaid, 1);
    assert.equal(t.discount, 1500);
    assert.equal(t.items[0].product_id, lahmacun.id); // ada göre eşleşti
    assert.equal(t.items[0].unit_price, 6200);
    assert.equal(t.items[0].note, 'Ekstra limon');
    assert.equal(t.total, 3 * 6200 + 3000);
    // Kabul edilmeden durum ilerlemez
    assert.equal((await call('PUT', `/api/deliveries/${id}`, { delivery_status: 'ready' })).status, 400);
    t = (await call('POST', `/api/deliveries/${id}/accept`, { prep_minutes: 25 })).body;
    assert.equal(t.external_status, 'accepted');
    assert.equal(t.delivery_status, 'preparing');
    await call('PUT', `/api/deliveries/${id}`, { delivery_status: 'ready' });
    await call('PUT', `/api/deliveries/${id}`, { delivery_status: 'on_way', courier_name: 'Ahmet' });
    // Eşlemesiz ürünü eşle
    const un = (await call('GET', '/api/platforms/products?unmapped=1')).body;
    assert.equal(un[0].external_name, 'Ayran (Büyük)');
    const ayran = (await call('POST', '/api/products', { name: 'Ayran Büyük', sell_price: 3000, track_stock: 0 })).body;
    await call('PUT', '/api/platforms/products', { platform: 'yemeksepeti', external_id: 'p-99', product_id: ayran.id });
    assert.equal((await call('GET', '/api/platforms/products?unmapped=1')).body.length, 0);
    // Durumlar entegratöre imzalı gider
    const f = (await call('POST', '/api/platforms/flush')).body;
    assert.equal(f.sent, 3);
    assert.deepEqual(got.map((g) => g.body.event), ['order.accept', 'order.ready', 'order.picked_up']);
    assert.equal(got[0].body.data.prep_minutes, 25);
    const raw0 = JSON.stringify(got[0].body);
    assert.equal(got[0].sig, `sha256=${crypto.createHmac('sha256', secret).update(raw0).digest('hex')}`);
    // Online ödendi olarak kapanır (indirim dahil)
    const live = t.items.filter((i) => !i.void_at);
    const sale = await call('POST', '/api/sales', { register_name: 'Kasa 1', ticket_id: id, discount: 1500,
      items: live.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, unit_price: i.unit_price, vat_rate: i.vat_rate, ticket_item_id: i.id })),
      payments: [{ method: 'online', amount: t.total - 1500 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.payments[0].method, 'online');
    assert.equal((await call('GET', `/api/tickets/${id}`)).body.status, 'closed');

    // Ret ve platform iptali
    const o2 = { ...order, external_id: 'YS-1002' };
    const id2 = (await hook(o2, secret)).body.ticket_id;
    assert.equal((await call('POST', `/api/deliveries/${id2}/reject`, { reason: 'Malzeme bitti' })).body.status, 'cancelled');
    const id3 = (await hook({ ...order, external_id: 'TG-5', platform: 'trendyol' }, secret)).body.ticket_id;
    assert.equal((await hook({ platform: 'trendyol', external_id: 'TG-5', status: 'cancelled', reason: 'Müşteri iptal etti' }, secret)).body.action, 'cancelled');
    assert.equal((await call('GET', `/api/tickets/${id3}`)).body.status, 'cancelled');
    // Otomatik kabul + deneme siparişi
    await call('PUT', '/api/settings', { platform_auto_accept: '1' });
    const sim = (await call('POST', '/api/platforms/simulate', { platform: 'migros' })).body;
    assert.equal(sim.ticket.external_status, 'accepted');
    assert.equal(sim.ticket.unsent_count, 0); // mutfağa gönderilmiş
    const st = (await call('GET', '/api/platforms/status')).body;
    assert.equal(st.enabled, true);
    assert.ok(st.events.pending >= 2);
  } finally {
    cb.close();
    await call('PUT', '/api/settings', { platform_auto_accept: '0' });
  }
});
