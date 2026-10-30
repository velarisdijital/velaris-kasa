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
