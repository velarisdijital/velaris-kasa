// Demo arka ucu: gerçek sunucu kodunu (server/) tarayıcıda, SQLite'ın WebAssembly sürümüyle çalıştırır.
// Veriler bu tarayıcıda saklanır; sunucuya hiçbir şey gönderilmez.
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import { useSqlJs } from './shims/better-sqlite3.js';
import { Router } from './shims/express.js';

const STORE_KEY = 'vk_demo_db';
let ready = null;
let db = null;
let handler = null;
let seeding = false;

const b64encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function loadSaved() {
  try { const s = localStorage.getItem(STORE_KEY); return s ? b64decode(s) : null; } catch { return null; }
}
function persist() {
  try { localStorage.setItem(STORE_KEY, b64encode(db.export())); } catch { /* depolama kapalıysa veriler yalnızca bu sekmede yaşar */ }
}

async function boot(bytes) {
  globalThis.__VK_DEMO__ = true; // demoda tüm paket özellikleri açık
  const SQL = await initSqlJs();
  useSqlJs(SQL, bytes);
  const [{ openDatabase, getSetting, setSettings }, { authenticate }, authR, productR, customerR, shiftR, saleR, apptR, reportR, settingsR, notifyR, bookingR, branchR, purchaseR, tableR, qrR, deliveryR, platformR] = await Promise.all([
    import('../../../server/db.js'), import('../../../server/auth.js'), import('../../../server/routes/auth.js'),
    import('../../../server/routes/products.js'), import('../../../server/routes/customers.js'), import('../../../server/routes/shifts.js'),
    import('../../../server/routes/sales.js'), import('../../../server/routes/appointments.js'), import('../../../server/routes/reports.js'),
    import('../../../server/routes/settings.js'), import('../../../server/routes/notify.js'), import('../../../server/routes/booking.js'), import('../../../server/routes/branches.js'), import('../../../server/routes/purchases.js'), import('../../../server/routes/tables.js'),
    import('../../../server/routes/qrmenu.js'), import('../../../server/routes/deliveries.js'),
    import('../../../server/routes/platforms.js'),
  ]);
  db = openDatabase('/demo');
  if (!getSetting(db, 'install_id')) setSettings(db, { install_id: crypto.randomUUID() });

  const api = Router();
  api.get('/health', (req, res) => res.json({ ok: true, app: 'velaris-kasa', demo: true }));
  api.use(authR.publicRoutes(db));
  api.use(settingsR.inboundWebhook(db));
  api.use(bookingR.default(db));
  api.use(qrR.default(db));
  api.use(authenticate(db));
  api.use(authR.sessionRoutes(db));
  for (const m of [productR, branchR, purchaseR, tableR, deliveryR, platformR, customerR, shiftR, saleR, apptR, reportR, settingsR, notifyR]) api.use(m.default(db));
  handler = api;
}

const start = () => (ready ??= boot(loadSaved()));

/** fetch() yerine geçer: './api/...' isteklerini tarayıcıdaki sunucuya yönlendirir. */
export async function demoFetch(url, init = {}) {
  await start();
  const u = new URL(url, 'http://demo.local/');
  const path = u.pathname.replace(/^.*?\/api(\/v1)?/, '') || '/';
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const raw = init.body || '';
  const method = (init.method || 'GET').toUpperCase();
  const req = {
    method, path, url: path, query: Object.fromEntries(u.searchParams), headers, rawBody: raw,
    body: raw ? JSON.parse(raw) : {}, params: {},
    get: (h) => headers[h.toLowerCase()],
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, finished: false,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      json(body) {
        this.finished = true;
        if (method !== 'GET' && this.statusCode < 400 && !seeding) persist();
        resolve(new Response(JSON.stringify(body ?? null), { status: this.statusCode, headers: { 'Content-Type': 'application/json' } }));
      },
      download() { this.status(400).json({ error: 'Demoda dosya indirme kapalı' }); },
    };
    const fail = (err) => {
      if (res.finished) return;
      if (!err) return res.status(404).json({ error: 'Bulunamadı' });
      if (String(err.message).includes('UNIQUE constraint failed: products.barcode')) return res.status(409).json({ error: 'Bu barkod başka bir üründe kayıtlı' });
      if (!err.status) console.error(err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Sunucu hatası' });
    };
    try { handler(req, res, fail); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------
// Demo verisi

/** Tüm verileri silip seçilen işletme türüyle örnek verilerle (ya da boş) yeniden başlatır. */
export async function resetDemo(type) {
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem('vk_token'); localStorage.removeItem('vk_products_cache'); } catch { /* yok say */ }
  ready = boot(null);
  await ready;
  if (type) await seed(type);
  persist();
}

export async function ensureDemo() {
  await start();
  const status = await (await demoFetch('./api/setup/status')).json();
  if (!status.setup_done && !loadSaved()) { await seed('market'); persist(); }
}

async function call(method, path, body, token) {
  const res = await demoFetch(`./api${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json?.error}`);
  return json;
}

let seedN = 7;
const rnd = () => { seedN = (seedN * 16807) % 2147483647; return (seedN - 1) / 2147483646; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const stamp = (d, h, m) => `${d.toLocaleDateString('sv-SE')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

async function seed(type) {
  seeding = true;
  try { await seedData(type); } finally { seeding = false; }
}

async function seedData(type) {
  seedN = 7;
  const berber = type === 'berber';
  const kafe = type === 'kafe';
  const resto = type === 'restoran';
  const { token } = await call('POST', '/setup', {
    business_name: berber ? 'Makas Erkek Kuaförü' : kafe ? 'Köşe Kahve' : resto ? 'Lezzet Sofrası' : 'Yıldız Market', business_type: type,
    admin_name: berber ? 'Hasan Usta' : kafe ? 'Selin Aydın' : resto ? 'Mert Demir' : 'Ali Yıldız', admin_pin: '1234', seed_samples: true,
    business_phone: '0212 555 00 00',
  });
  const T = token;
  await call('PUT', '/settings', {
    business_address: 'Bağdat Cad. No: 12, Kadıköy / İstanbul', receipt_footer: 'Bizi tercih ettiğiniz için teşekkürler!',
    // Demoda yeni özellikler açık: simülatör yazarkasa ve e-Arşiv, deneme SMS (gönderilmez), puan
    loyalty_enabled: '1', loyalty_rate: '2', notify_provider: 'log', reminder_enabled: '1',
    fiscal_driver: 'simulator', invoice_provider: 'simulator', booking_enabled: berber ? '1' : '0', booking_closed_days: '0',
  }, T);
  const staff = [await call('GET', '/auth/me', null, T).then((r) => r.user)];
  if (berber) {
    staff.push(await call('POST', '/users', { name: 'Emre', role: 'staff', pin: '2222', commission_rate: 40, color: '#db2777' }, T));
    staff.push(await call('POST', '/users', { name: 'Kerem', role: 'staff', pin: '3333', commission_rate: 35, color: '#16a34a' }, T));
  } else {
    await call('POST', '/users', { name: 'Ayşe', role: 'cashier', pin: '0000', color: '#FF4D1A' }, T);
  }
  if (type === 'market') {
    const cats = await call('GET', '/categories', null, T);
    const cat = (n) => cats.find((c) => c.name === n)?.id;
    for (const p of [
      { name: 'Çikolatalı Gofret', barcode: '8690504000017', category_id: cat('Gıda'), buy_price: 1200, sell_price: 2000, vat_rate: 1, stock: 48, min_stock: 12, favorite: 1 },
      { name: 'Makarna 500 g', barcode: '8690000000017', category_id: cat('Gıda'), buy_price: 1800, sell_price: 2750, vat_rate: 1, stock: 30, min_stock: 10 },
      { name: 'Ayçiçek Yağı 1 L', barcode: '8690000000024', category_id: cat('Gıda'), buy_price: 7200, sell_price: 9500, vat_rate: 1, stock: 4, min_stock: 6 },
      { name: 'Beyaz Peynir (terazi)', barcode: '2700123', category_id: cat('Süt Ürünleri'), unit: 'kg', buy_price: 22000, sell_price: 32000, vat_rate: 1, stock: 8.5, min_stock: 2 },
      { name: 'Sigara', barcode: '8690000000031', category_id: cat('Tütün'), buy_price: 8500, sell_price: 9500, vat_rate: 0, stock: 60, min_stock: 20, favorite: 1 },
    ]) await call('POST', '/products', p, T).catch(() => {}); // gerçek katalogda aynı barkod varsa atla
  }
  const customers = [];
  for (const c of [['Mehmet Kaya', '0532 111 22 33', 1], ['Fatma Demir', '0544 222 33 44', 1], ['Hüseyin Çelik', '0505 333 44 55', 0], ['Zeynep Arslan', '0555 444 55 66', 1]]) {
    customers.push(await call('POST', '/customers', { name: c[0], phone: c[1], credit_limit: 0, sms_consent: c[2] }, T));
  }
  customers.push(await call('POST', '/customers', { name: 'ABC Gıda Ltd. Şti.', phone: '0216 333 22 11', tax_number: '1234567890', tax_office: 'Kadıköy', address: 'Moda Cad. No: 5', district: 'Kadıköy', city: 'İstanbul' }, T));
  const products = await call('GET', '/products', null, T);
  const services = products.filter((p) => p.type === 'service');
  const goods = products.filter((p) => p.type === 'product' && p.sell_price > 0);

  const makeSale = async (when, opts = {}) => {
    const items = [];
    if (berber) {
      const s = pick(services.slice(0, 4));
      items.push({ product_id: s.id, qty: 1, staff_id: pick(staff).id });
      if (rnd() < 0.15) items.push({ product_id: pick(goods).id, qty: 1 });
    } else {
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const p = pick(goods);
        const qty = p.unit === 'kg' ? Math.round((0.3 + rnd() * 1.5) * 1000) / 1000 : 1 + Math.floor(rnd() * 2);
        if (!items.some((x) => x.product_id === p.id)) items.push({ product_id: p.id, qty });
      }
    }
    const total = items.reduce((a, it) => a + Math.round(products.find((p) => p.id === it.product_id).sell_price * it.qty), 0);
    const r = rnd();
    const customer = opts.credit || r < 0.12 ? pick(customers) : null;
    const method = customer && !berber ? 'credit' : r < 0.55 ? 'cash' : 'card';
    return call('POST', '/sales', {
      register_name: 'Kasa 1', customer_id: customer?.id, items, offline_created_at: when,
      payments: [{ method, amount: method === 'cash' ? Math.ceil(total / 5000) * 5000 : total }],
    }, T);
  };

  // Son 13 günün satışları (gün sonu kapalı geçmiş)
  const today = new Date();
  for (let back = 13; back >= 1; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const count = (berber ? 6 : 14) + Math.floor(rnd() * (berber ? 6 : 12)) - (d.getDay() === 0 ? 5 : 0);
    for (let i = 0; i < count; i++) {
      const h = 8 + Math.floor(rnd() * 13);
      await makeSale(stamp(d, h, Math.floor(rnd() * 60)));
    }
  }
  // Geçmiş satışların veresiye ve stok hareketlerini satış tarihine taşı
  db.exec(`UPDATE customer_transactions SET created_at = (SELECT created_at FROM sales WHERE sales.id = sale_id) WHERE sale_id IS NOT NULL;
           UPDATE stock_movements SET created_at = (SELECT created_at FROM sales WHERE sales.id = sale_id) WHERE sale_id IS NOT NULL;`);
  // Dünkü sayım: gerçekçi stok seviyeleri (birkaç ürün bilerek kritik seviyede)
  const tracked = (await call('GET', '/products', null, T)).filter((p) => p.track_stock);
  for (const [i, p] of tracked.entries()) {
    const low = i % 4 === 2;
    const qty = low ? Math.max(0, p.min_stock - 1) : Math.round(p.min_stock * 2 + 10 + rnd() * 40);
    await call('POST', `/products/${p.id}/stock`, { type: 'count', qty, note: 'Haftalık sayım' }, T);
  }
  const y = new Date(today); y.setDate(y.getDate() - 1);
  db.exec(`UPDATE stock_movements SET created_at = '${stamp(y, 21, 30)}' WHERE type = 'count'`);

  // Bugün: kasa açık, birkaç satış, bir tahsilat, bir mal girişi
  await call('POST', '/shifts/open', { register_name: 'Kasa 1', opening_cash: 50000 }, T);
  const nowH = Math.max(9, Math.min(today.getHours(), 21));
  for (let i = 0; i < (berber ? 4 : 9); i++) await makeSale(stamp(today, 8 + Math.floor(rnd() * Math.max(1, nowH - 8)), Math.floor(rnd() * 60)));
  if (!berber) {
    await makeSale(stamp(today, nowH, 5), { credit: true });
  }
  if (kafe) {
    // Açık masalar: biri mutfağa gönderilmiş, biri yeni sipariş bekliyor, biri kısmen ödenmiş
    const tables = await call('GET', '/tables', null, T);
    const byName = (n) => products.find((x) => x.name === n);
    const orders = [
      [0, 2, [['Çay', 4], ['Tost', 2], ['Simit', 2]], true],
      [2, 3, [['Türk Kahvesi', 3], ['Cheesecake', 2]], true],
      [3, 2, [['Filtre Kahve', 2]], false],
      [6, 4, [['Çay', 6], ['Ayran', 2], ['Tost', 4]], true],
    ];
    for (const [ti, guests, lines, sent] of orders) {
      const t = await call('POST', `/tables/${tables[ti].id}/ticket`, { guest_count: guests,
        items: lines.filter(([n]) => byName(n)).map(([n, q]) => ({ product_id: byName(n).id, qty: q })) }, T);
      if (sent) await call('POST', `/tickets/${t.id}/kitchen`, {}, T);
    }
    db.exec(`UPDATE tickets SET opened_at = datetime('now','localtime', '-' || (id * 17) || ' minutes') WHERE kind = 'table';
             UPDATE ticket_items SET created_at = (SELECT opened_at FROM tickets WHERE tickets.id = ticket_id),
               sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE datetime((SELECT opened_at FROM tickets WHERE tickets.id = ticket_id), '+4 minutes') END;`);
    const t7 = await call('GET', `/tickets/${(await call('GET', '/tables', null, T))[6].ticket_id}`, null, T);
    const tost = t7.items.find((i) => i.name === 'Tost');
    if (tost) await call('POST', '/sales', { register_name: 'Kasa 1', ticket_id: t7.id, items: [{ product_id: tost.product_id, qty: 2, ticket_item_id: tost.id }],
      payments: [{ method: 'card', amount: tost.unit_price * 2 }] }, T);

    // Garson (Personel rolü masalar açıkken garson modunda açılır), QR menü, paket servis, yemek platformları
    await call('POST', '/users', { name: 'Burak', role: 'staff', pin: '2222', color: '#7B5CFF' }, T);
    await call('PUT', '/settings', { qrmenu_enabled: '1', qrmenu_orders: '1', qrmenu_note: 'Wi-Fi: KoseKahve · şifre: kahve2026',
      modules_delivery: '1', delivery_fee: '1500', delivery_couriers: 'Murat, Deniz', platforms_enabled: '1', platform_prep_minutes: '20' }, T);
    // Reçete: tost satılınca ekmek ve kaşar düşer
    const ekmek = await call('POST', '/products', { name: 'Tost Ekmeği', unit: 'adet', buy_price: 300, sell_price: 0, stock: 40, min_stock: 10, menu_hidden: 1 }, T);
    const kasar = await call('POST', '/products', { name: 'Kaşar Peyniri', unit: 'kg', buy_price: 42000, sell_price: 0, stock: 2.4, min_stock: 1, menu_hidden: 1 }, T);
    if (byName('Tost')) await call('PUT', `/products/${byName('Tost').id}/recipe`, { items: [{ component_id: ekmek.id, qty: 2 }, { component_id: kasar.id, qty: 0.06 }] }, T);
    for (const [n, d] of [['Türk Kahvesi', 'Közde, lokum ile'], ['Filtre Kahve', 'Günün çekirdeği'], ['Cheesecake', 'Frambuaz soslu, ev yapımı']]) {
      const p = byName(n);
      if (p) await call('PUT', `/products/${p.id}`, { ...p, menu_description: d }, T);
    }
    // Masalardan QR istekleri
    const qrTables = await call('GET', '/tables', null, T);
    await call('POST', '/public/menu/request', { t: qrTables[1].qr_token, type: 'waiter' });
    if (byName('Türk Kahvesi')) await call('POST', '/public/menu/request', { t: qrTables[4].qr_token, type: 'order', items: [{ product_id: byName('Türk Kahvesi').id, qty: 2, note: 'orta şekerli' }] });
    // Paket: telefonla gelen (yolda), gel-al (hazır), Yemeksepeti siparişi (kabul bekliyor)
    const p1 = await call('POST', '/deliveries', { kind: 'delivery', source: 'phone', customer_name: 'Mehmet Kaya', phone: '0532 111 22 33',
      address: 'Moda Cad. 45 D:3, Kadıköy', delivery_note: 'Zil bozuk, arayın', payment_hint: 'Kapıda kart', delivery_fee: 1500,
      items: [{ product_id: byName('Tost').id, qty: 2 }, { product_id: byName('Ayran').id, qty: 2 }] }, T);
    await call('POST', `/tickets/${p1.id}/kitchen`, {}, T);
    await call('PUT', `/deliveries/${p1.id}`, { delivery_status: 'preparing' }, T);
    await call('PUT', `/deliveries/${p1.id}`, { delivery_status: 'ready' }, T);
    await call('PUT', `/deliveries/${p1.id}`, { delivery_status: 'on_way', courier_name: 'Murat' }, T);
    const p2 = await call('POST', '/deliveries', { kind: 'takeaway', customer_name: 'Zeynep', phone: '0555 444 55 66',
      items: [{ product_id: byName('Filtre Kahve').id, qty: 2 }, { product_id: byName('Cheesecake').id, qty: 1 }] }, T);
    await call('POST', `/tickets/${p2.id}/kitchen`, {}, T);
    await call('PUT', `/deliveries/${p2.id}`, { delivery_status: 'ready' }, T);
    await call('POST', '/platforms/simulate', { platform: 'yemeksepeti' }, T);
  }
  if (resto) await seedRestaurant(T, products);
  if (type === 'market') {
    const debtor = (await call('GET', '/customers?debt=1', null, T))[0];
    if (debtor) await call('POST', `/customers/${debtor.id}/payment`, { amount: Math.min(debtor.balance, 10000), method: 'cash', register_name: 'Kasa 1' }, T);
    const milk = products.find((p) => p.name.startsWith('Süt'));
    // Tedarikçiler: geçen haftaki vadeli fatura + bugün kısmen nakit ödenen süt irsaliyesi
    const toptan = await call('POST', '/suppliers', { name: 'Anadolu Toptan Gıda', phone: '0216 444 10 20', tax_number: '9876543210', tax_office: 'Üsküdar', note: 'Sipariş: salı · temsilci Murat' }, T);
    const pinar = await call('POST', '/suppliers', { name: 'Pınar Süt Bayi', phone: '0532 600 70 80' }, T);
    const wk = new Date(today); wk.setDate(wk.getDate() - 6);
    const byName = (n) => products.find((x) => x.name === n);
    const lines = [['Makarna 500 g', 24, 1500], ['Ayçiçek Yağı 1 L', 12, 6000], ['Çikolatalı Gofret', 48, 1000]].filter(([n]) => byName(n))
      .map(([n, q, net]) => ({ product_id: byName(n).id, qty: q, unit_price: net }));
    if (lines.length) await call('POST', '/purchases', { supplier_id: toptan.id, doc_type: 'fatura', doc_no: 'ATG2026000184', doc_date: wk.toLocaleDateString('sv-SE'), items: lines }, T);
    if (milk) await call('POST', '/purchases', { supplier_id: pinar.id, doc_type: 'irsaliye', doc_no: '4512', prices_include_vat: true,
      items: [{ product_id: milk.id, qty: 24, unit_price: 2600 }], payment: { amount: 30000, method: 'cash', register_name: 'Kasa 1' } }, T);
    await call('POST', `/shifts/${(await call('GET', '/shifts/current?register=Kasa%201', null, T)).shift.id}/cash`, { type: 'out', amount: 15000, note: 'Ekmek fırınına ödeme' }, T);
    // İkinci şube: Moda (Pro paket özelliği) — birkaç ürün transfer edilir
    const moda = await call('POST', '/branches', { name: 'Moda' }, T);
    await call('PUT', `/registers/${encodeURIComponent('Moda Kasa 1')}`, { branch_id: moda.id }, T);
    for (const name of ['Süt 1 L', 'Su 0.5 L', 'Çikolatalı Gofret', 'Sigara']) {
      const prod = products.find((x) => x.name === name);
      if (prod) await call('POST', '/stock/transfer', { product_id: prod.id, from_branch_id: 1, to_branch_id: moda.id, qty: 4 + Math.floor(rnd() * 6), note: 'Haftalık sevk' }, T).catch(() => {});
    }
  }
  if (berber) {
    const day = today.toLocaleDateString('sv-SE');
    const slots = ['10:00', '11:00', '13:30', '15:00', '16:30', '18:00'];
    for (let i = 0; i < slots.length; i++) {
      const sv = services[i % 4];
      await call('POST', '/appointments', { customer_id: customers[i % customers.length].id, staff_id: staff[i % staff.length].id, service_id: sv.id, start_at: `${day} ${slots[i]}`, duration_min: sv.duration_min || 30, force: true }, T);
    }
  }
  await call('POST', '/auth/logout', {}, T);
}


/**
 * Restoran örneği: iki garson (Burak PIN 2222, Elif PIN 3333) masalarda sipariş alıyor; dolu ve kapanmış masalar,
 * ikram, hesap isteği, QR menü istekleri, paket servis ve kabul bekleyen Trendyol Go siparişi.
 */
async function seedRestaurant(T, products) {
  const byName = (n) => products.find((x) => x.name === n);
  const item = (n, qty, note) => ({ product_id: byName(n).id, qty, note });
  await call('PUT', '/settings', { qrmenu_enabled: '1', qrmenu_orders: '1', qrmenu_note: 'Afiyet olsun! Wi-Fi: LezzetSofrasi · şifre: sofra2026',
    delivery_fee: '2000', delivery_couriers: 'Murat, Deniz', platforms_enabled: '1', platform_prep_minutes: '25' }, T);
  for (const [n, d] of [['Adana Kebap', 'Zırh kıyması, közlenmiş biber ve domatesle'], ['Urfa Kebap', 'Acısız, közlenmiş sebzeyle'],
    ['Tavuk Şiş', 'Marine tavuk but, bulgur pilavıyla'], ['Izgara Köfte', 'Piyaz ve közlenmiş biberle'], ['Künefe', 'Hatay usulü, sıcak servis'],
    ['Mercimek Çorbası', 'Limon ve kıtır ekmekle']]) {
    const p = byName(n);
    if (p) await call('PUT', `/products/${p.id}`, { ...p, menu_description: d }, T);
  }
  // Garsonlar
  const garson = {};
  for (const [name, pin, color] of [['Burak', '2222', '#7B5CFF'], ['Elif', '3333', '#20C4A0']]) {
    const u = await call('POST', '/users', { name, role: 'staff', pin, color }, T);
    garson[name] = (await call('POST', '/auth/login', { user_id: u.id, pin })).token;
  }
  const tables = await call('GET', '/tables', null, T);
  const open = async (who, ti, guests, lines, send = true) => {
    const t = await call('POST', `/tables/${tables[ti].id}/ticket`, { guest_count: guests, items: lines }, garson[who]);
    if (send) await call('POST', `/tickets/${t.id}/kitchen`, {}, garson[who]);
    return t;
  };
  // Bugün kapanmış masalar (garson raporu için)
  const pay = async (t, method) => {
    const full = await call('GET', `/tickets/${t.id}`, null, T);
    const live = full.items.filter((i) => !i.void_at);
    await call('POST', '/sales', { register_name: 'Kasa 1', ticket_id: t.id,
      items: live.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, unit_price: i.unit_price, vat_rate: i.vat_rate, ticket_item_id: i.id })),
      payments: [{ method, amount: method === 'cash' ? Math.ceil(full.total / 10000) * 10000 : full.total }] }, T);
  };
  await pay(await open('Burak', 1, 2, [item('Izgara Köfte', 2), item('Pilav', 2), item('Ayran', 2)]), 'card');
  await pay(await open('Elif', 6, 3, [item('Kuru Fasulye', 3), item('Pilav', 3), item('Çay', 3)]), 'cash');
  // Dolu masalar
  const m1 = await open('Burak', 0, 4, [item('Adana Kebap', 2, 'acılı'), item('Mercimek Çorbası', 2), item('Çoban Salata', 1), item('Ayran', 4)]);
  await call('POST', `/tickets/${m1.id}/items`, { items: [item('Künefe', 2)] }, garson.Burak); // tatlı: henüz mutfağa gitmedi
  const m3 = await open('Elif', 2, 2, [item('Tavuk Şiş', 1), item('Izgara Köfte', 1), item('Pilav', 2), item('Kola 330 ml', 2)]);
  await call('POST', `/tickets/${m3.id}/bill-request`, {}, garson.Elif);
  const m5 = await open('Burak', 4, 6, [item('Urfa Kebap', 3), item('Adana Kebap', 3), item('Humus', 2), item('Ayran', 6)]);
  const ayran = m5.items.find((i) => i.name === 'Ayran');
  await call('POST', `/tickets/${m5.id}/items/${ayran.id}/void`, { qty: 1, reason: 'İkram' }, T);
  await open('Elif', 9, 2, [item('Çay', 2)], false);
  // Masadan QR ile: garson çağırma ve sipariş isteği
  await call('POST', '/public/menu/request', { t: tables[5].qr_token, type: 'waiter' });
  await call('POST', '/public/menu/request', { t: tables[11].qr_token, type: 'order', items: [{ product_id: byName('Mercimek Çorbası').id, qty: 2 }, { product_id: byName('Tavuk Şiş').id, qty: 1, note: 'pilavsız' }] });
  // Gerçekçi süreler: masalar farklı saatlerde açılmış olsun
  db.exec(`UPDATE tickets SET opened_at = datetime('now','localtime', '-' || (12 + (id % 5) * 14) || ' minutes') WHERE kind = 'table' AND status = 'open';
           UPDATE tickets SET opened_at = datetime('now','localtime', '-150 minutes'), closed_at = datetime('now','localtime', '-95 minutes') WHERE kind = 'table' AND status = 'closed';
           UPDATE ticket_items SET created_at = (SELECT opened_at FROM tickets WHERE tickets.id = ticket_id),
             sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE datetime((SELECT opened_at FROM tickets WHERE tickets.id = ticket_id), '+3 minutes') END;`);
  // Paket servis: telefonla gelen (hazırlanıyor) ve Trendyol Go siparişi (kabul bekliyor)
  const p1 = await call('POST', '/deliveries', { kind: 'delivery', source: 'phone', customer_name: 'Fatma Demir', phone: '0544 222 33 44',
    address: 'Caferağa Mah. Moda Cad. 112 D:7, Kadıköy', delivery_note: 'Kapıda kartla ödeyecek', payment_hint: 'Kapıda kart', delivery_fee: 2000,
    items: [item('Adana Kebap', 2), item('Pilav', 2), item('Ayran', 2)] }, T);
  await call('POST', `/tickets/${p1.id}/kitchen`, {}, T);
  await call('PUT', `/deliveries/${p1.id}`, { delivery_status: 'preparing' }, T);
  await call('POST', '/platforms/simulate', { platform: 'trendyol' }, T);
}
