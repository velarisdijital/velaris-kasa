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
  const SQL = await initSqlJs();
  useSqlJs(SQL, bytes);
  const [{ openDatabase, getSetting, setSettings }, { authenticate }, authR, productR, customerR, shiftR, saleR, apptR, reportR, settingsR, notifyR, bookingR] = await Promise.all([
    import('../../../server/db.js'), import('../../../server/auth.js'), import('../../../server/routes/auth.js'),
    import('../../../server/routes/products.js'), import('../../../server/routes/customers.js'), import('../../../server/routes/shifts.js'),
    import('../../../server/routes/sales.js'), import('../../../server/routes/appointments.js'), import('../../../server/routes/reports.js'),
    import('../../../server/routes/settings.js'), import('../../../server/routes/notify.js'), import('../../../server/routes/booking.js'),
  ]);
  db = openDatabase('/demo');
  if (!getSetting(db, 'install_id')) setSettings(db, { install_id: crypto.randomUUID() });

  const api = Router();
  api.get('/health', (req, res) => res.json({ ok: true, app: 'velaris-kasa', demo: true }));
  api.use(authR.publicRoutes(db));
  api.use(settingsR.inboundWebhook(db));
  api.use(bookingR.default(db));
  api.use(authenticate(db));
  api.use(authR.sessionRoutes(db));
  for (const m of [productR, customerR, shiftR, saleR, apptR, reportR, settingsR, notifyR]) api.use(m.default(db));
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
  const { token } = await call('POST', '/setup', {
    business_name: berber ? 'Makas Erkek Kuaförü' : 'Yıldız Market', business_type: type,
    admin_name: berber ? 'Hasan Usta' : 'Ali Yıldız', admin_pin: '1234', seed_samples: true,
    business_phone: '0212 555 00 00',
  });
  const T = token;
  await call('PUT', '/settings', { business_address: 'Bağdat Cad. No: 12, Kadıköy / İstanbul', receipt_footer: 'Bizi tercih ettiğiniz için teşekkürler!' }, T);
  const staff = [await call('GET', '/auth/me', null, T).then((r) => r.user)];
  if (berber) {
    staff.push(await call('POST', '/users', { name: 'Emre', role: 'staff', pin: '2222', commission_rate: 40, color: '#db2777' }, T));
    staff.push(await call('POST', '/users', { name: 'Kerem', role: 'staff', pin: '3333', commission_rate: 35, color: '#16a34a' }, T));
  } else {
    await call('POST', '/users', { name: 'Ayşe', role: 'cashier', pin: '0000', color: '#9333ea' }, T);
    const cats = await call('GET', '/categories', null, T);
    const cat = (n) => cats.find((c) => c.name === n)?.id;
    for (const p of [
      { name: 'Çikolatalı Gofret', barcode: '8690504000017', category_id: cat('Gıda'), buy_price: 1200, sell_price: 2000, vat_rate: 1, stock: 48, min_stock: 12, favorite: 1 },
      { name: 'Makarna 500 g', barcode: '8690000000017', category_id: cat('Gıda'), buy_price: 1800, sell_price: 2750, vat_rate: 1, stock: 30, min_stock: 10 },
      { name: 'Ayçiçek Yağı 1 L', barcode: '8690000000024', category_id: cat('Gıda'), buy_price: 7200, sell_price: 9500, vat_rate: 1, stock: 4, min_stock: 6 },
      { name: 'Beyaz Peynir (terazi)', barcode: '2700123', category_id: cat('Süt Ürünleri'), unit: 'kg', buy_price: 22000, sell_price: 32000, vat_rate: 1, stock: 8.5, min_stock: 2 },
      { name: 'Sigara', barcode: '8690000000031', category_id: cat('Tütün'), buy_price: 8500, sell_price: 9500, vat_rate: 0, stock: 60, min_stock: 20, favorite: 1 },
    ]) await call('POST', '/products', p, T);
  }
  const customers = [];
  for (const c of [['Mehmet Kaya', '0532 111 22 33'], ['Fatma Demir', '0544 222 33 44'], ['Hüseyin Çelik', '0505 333 44 55'], ['Zeynep Arslan', '0555 444 55 66']]) {
    customers.push(await call('POST', '/customers', { name: c[0], phone: c[1], credit_limit: 0 }, T));
  }
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
    const debtor = (await call('GET', '/customers?debt=1', null, T))[0];
    if (debtor) await call('POST', `/customers/${debtor.id}/payment`, { amount: Math.min(debtor.balance, 10000), method: 'cash', register_name: 'Kasa 1' }, T);
    const milk = products.find((p) => p.name.startsWith('Süt'));
    if (milk) await call('POST', `/products/${milk.id}/stock`, { type: 'in', qty: 24, unit_cost: 2600, note: 'Pınar - İrsaliye 4512' }, T);
    await call('POST', `/shifts/${(await call('GET', '/shifts/current?register=Kasa%201', null, T)).shift.id}/cash`, { type: 'out', amount: 15000, note: 'Ekmek fırınına ödeme' }, T);
  } else {
    const day = today.toLocaleDateString('sv-SE');
    const slots = ['10:00', '11:00', '13:30', '15:00', '16:30', '18:00'];
    for (let i = 0; i < slots.length; i++) {
      const sv = services[i % 4];
      await call('POST', '/appointments', { customer_id: customers[i % customers.length].id, staff_id: staff[i % staff.length].id, service_id: sv.id, start_at: `${day} ${slots[i]}`, duration_min: sv.duration_min || 30, force: true }, T);
    }
  }
  await call('POST', '/auth/logout', {}, T);
}
