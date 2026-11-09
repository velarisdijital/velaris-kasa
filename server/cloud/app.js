// Velaris Bulut: bir sunucuda çok işletme. Her işletme kendi klasöründe kendi VelarisKasa veritabanıyla çalışır;
// bu katman yalnızca kayıt, adresleme (alt alan adı ya da /i/<adres>), abonelik ödemesi ve lisans üretiminden sorumludur.
//
// Adresleme:   https://<adres>.<VK_CLOUD_DOMAIN>/   ya da   <VK_CLOUD_URL>/i/<adres>/
// Lisans:      Ödeme / deneme durumuna göre Velaris Dijital'in gizli anahtarıyla imzalı lisans işletmenin veritabanına yazılır.
//              Ödeme gecikirse lisans 7 gün ek süreden sonra biter ve işletme Ücretsiz pakete düşer (veriler silinmez).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from '../app.js';
import { authenticate } from '../auth.js';
import { getSetting, setSettings } from '../db.js';
import { PLANS, signLicense } from '../license.js';
import { adminPage, BUSINESS_TYPES, messagePage, payPage, priceOf, resultPage, signupPage, simulatorPage, STATUS_LABEL } from './pages.js';
import { simulatorProvider } from './payments.js';
import { addDays, addMonths, openStore, subscriptionStatus, today, TRIAL_DAYS, validSlug } from './store.js';

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * @param {{ dataDir: string, baseUrl: string, domain?: string, privateKeyPem: string, provider?: object,
 *   adminToken?: string, staticDir?: string, worker?: boolean, idleMinutes?: number }} opts
 */
export function createCloud(opts) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const domain = (opts.domain || '').toLowerCase() || null;
  const provider = opts.provider || simulatorProvider();
  const store = openStore(opts.dataDir);
  const internal = crypto.randomBytes(24).toString('hex'); // kayıt sırasında işletmenin kurulumunu yapmak için
  const live = new Map(); // adres → { app, db, close, used }
  const tenantDir = (slug) => path.join(opts.dataDir, 'tenants', slug);
  const urlOf = (t) => (domain ? `https://${t.slug}.${domain}` : `${baseUrl}/i/${t.slug}`);
  const billingUrl = (t) => `${baseUrl}/odeme/${t.billing_token}`;

  function load(t) {
    let x = live.get(t.slug);
    if (!x) {
      x = createApp({ dataDir: tenantDir(t.slug), staticDir: opts.staticDir, worker: opts.worker ?? true });
      live.set(t.slug, x);
    }
    x.used = Date.now();
    return x;
  }
  // Kullanılmayan işletmelerin veritabanını kapat (bellek)
  const idleMs = (opts.idleMinutes ?? 30) * 60000;
  const sweeper = setInterval(() => {
    for (const [slug, x] of live) if (Date.now() - x.used > idleMs) { live.delete(slug); try { x.close(); } catch { /* kapalı */ } }
  }, Math.min(idleMs, 5 * 60000));
  sweeper.unref?.();

  /** Abonelik durumuna göre lisansı yaz (ücretsiz pakette lisans yok) */
  function issueLicense(t) {
    const x = load(t);
    if (t.plan === 'free') {
      setSettings(x.db, { license_key: '' });
      return store.update(t.id, { license_lic: null });
    }
    const install = getSetting(x.db, 'install_id');
    const lic = `C${t.id}-${Date.now().toString(36).toUpperCase()}`;
    const key = signLicense({ lic, plan: t.plan, business: t.business_name, issued: today(), exp: t.paid_until || t.trial_until, install }, opts.privateKeyPem);
    setSettings(x.db, { license_key: key });
    return store.update(t.id, { license_lic: lic, install_id: install });
  }

  function applyPayment(paymentId, extra = {}) {
    const result = store.db.transaction(() => {
      const p = store.payment(paymentId);
      if (!p || p.status === 'paid') return p;
      const t = store.byId(p.tenant_id);
      const start = [today(), t.paid_until, t.trial_until].filter(Boolean).sort().pop();
      const end = addMonths(start, p.months);
      store.update(t.id, { plan: p.plan, paid_until: end, next_plan: null });
      store.event(t.id, 'payment', { payment: p.id, amount: p.amount, plan: p.plan, months: p.months, until: end });
      return store.updatePayment(p.id, { status: 'paid', paid_at: new Date().toLocaleString('sv-SE'), period_start: start, period_end: end, error: null, ...extra });
    })();
    issueLicense(store.byId(result.tenant_id));
    return result;
  }

  // Kayıt istek sınırı (IP başına saatte 5)
  const signups = new Map();
  const limited = (ip) => {
    const now = Date.now();
    const list = (signups.get(ip) || []).filter((x) => now - x < 3600000);
    signups.set(ip, [...list, now]);
    return list.length >= 5;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');
  const json = express.json({ limit: '100kb' });
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const send = (res, status, html) => res.status(status).type('html').send(html);

  // ---------------------------------------------------------------- İşletmeye yönlendirme
  function tenantRoutes(t, x) {
    const r = express.Router();
    const admin = [authenticate(x.db), (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Yalnızca yönetici' }))];
    r.get('/api/cloud/subscription', admin, (req, res) => {
      const cur = store.byId(t.id);
      res.json({
        slug: cur.slug, url: urlOf(cur), plan: cur.plan, plan_name: PLANS[cur.plan]?.name, next_plan: cur.next_plan,
        status: subscriptionStatus(cur), status_label: STATUS_LABEL[subscriptionStatus(cur)],
        trial_until: cur.trial_until, paid_until: cur.paid_until, pay_url: billingUrl(cur), live: !!provider.live,
      });
    });
    return r;
  }

  function serveTenant(slug, req, res, next) {
    const t = store.bySlug(slug);
    const isInternal = req.get('x-vk-cloud-internal') === internal;
    if (!t || (!t.ready && !isInternal)) return send(res, 404, messagePage('İşletme bulunamadı', 'Bu adreste bir VelarisKasa hesabı yok. Adresi kontrol edin.', `<a class="btn" href="${baseUrl}/kayit">Yeni hesap aç</a>`));
    if (t.suspended) return send(res, 403, messagePage('Hesap askıda', 'Bu hesap geçici olarak askıya alındı. Velaris Dijital ile iletişime geçin.'));
    const x = load(t);
    if (req.path.startsWith('/api/cloud/')) return tenantRoutes(t, x)(req, res, next);
    return x.app(req, res, next);
  }

  // Alt alan adı: <adres>.<alan adı>
  app.use((req, res, next) => {
    if (!domain) return next();
    const host = String(req.hostname || '').toLowerCase();
    if (!host.endsWith(`.${domain}`)) return next();
    const sub = host.slice(0, -(domain.length + 1));
    if (!validSlug(sub)) return next(); // www, bulut vb.: ana site
    return serveTenant(sub, req, res, next);
  });
  // Yol ile: /i/<adres>/
  app.use('/i/:slug', (req, res, next) => {
    if (req.originalUrl === `/i/${req.params.slug}`) return res.redirect(301, `/i/${req.params.slug}/`); // göreli adresler için
    return serveTenant(req.params.slug, req, res, next);
  });

  // ---------------------------------------------------------------- Kayıt
  app.get('/', (req, res) => res.redirect(302, `${baseUrl}/kayit`));
  app.get('/kayit', (req, res) => send(res, 200, signupPage({ preset: PLANS[req.query.paket] ? String(req.query.paket) : 'esnaf', domain, baseUrl })));
  app.get('/api/cloud/health', (req, res) => res.json({ ok: true, tenants: store.list().length, live: live.size, provider: provider.name }));

  app.get('/api/cloud/slug', (req, res) => {
    const slug = str(req.query.slug).toLowerCase();
    if (!validSlug(slug)) return res.json({ slug, available: false, reason: '3-30 karakter: küçük harf, rakam, tire (harfle başlar)' });
    res.json({ slug, available: !store.bySlug(slug) });
  });

  app.post('/api/cloud/signup', json, async (req, res) => {
    const b = req.body || {};
    const d = {
      slug: str(b.slug).toLowerCase(), business_name: str(b.business_name).slice(0, 80), business_type: str(b.business_type),
      contact_name: str(b.contact_name).slice(0, 80), email: str(b.email).toLowerCase().slice(0, 120), phone: str(b.phone).replace(/[^\d+]/g, '').slice(0, 16),
      city: str(b.city).slice(0, 40) || null, address: str(b.address).slice(0, 200) || null, tax_id: str(b.tax_id).slice(0, 20) || null,
      plan: PLANS[b.plan] ? b.plan : 'esnaf', pin: str(b.admin_pin),
    };
    const fail = (msg, code = 400) => res.status(code).json({ error: msg });
    if (!d.business_name) return fail('İşletme adı gerekli');
    if (!BUSINESS_TYPES[d.business_type]) return fail('Sektör seçin');
    if (!validSlug(d.slug)) return fail('İşletme adresi 3-30 karakter olmalı: küçük harf, rakam ve tire');
    if (!d.contact_name) return fail('Ad soyad gerekli');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return fail('Geçerli bir e-posta girin');
    if (d.phone.replace(/\D/g, '').length < 10) return fail('Geçerli bir cep telefonu girin');
    if (!/^\d{4,8}$/.test(d.pin)) return fail('PIN 4-8 haneli rakam olmalı');
    if (limited(req.ip)) return fail('Çok fazla deneme. Bir saat sonra tekrar deneyin.', 429);
    if (store.bySlug(d.slug)) return fail('Bu işletme adresi alınmış, başka bir adres seçin', 409);

    let t;
    try {
      t = store.create({ ...d, trial_until: d.plan === 'free' ? null : addDays(today(), TRIAL_DAYS), signup_ip: req.ip });
    } catch { return fail('Bu işletme adresi alınmış, başka bir adres seçin', 409); }
    try {
      // İşletmenin kendi kurulum sihirbazını çalıştır (yönetici + PIN + sektöre göre hazır ayarlar)
      const r = await fetch(`http://127.0.0.1:${req.socket.localPort}/i/${t.slug}/api/setup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vk-cloud-internal': internal },
        body: JSON.stringify({ business_name: d.business_name, business_type: d.business_type, admin_name: d.contact_name, admin_pin: d.pin, business_phone: d.phone, business_address: d.address || d.city || '', seed_samples: true }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `kurulum ${r.status}`);
      t = issueLicense(t);
      t = store.update(t.id, { ready: 1 });
      store.event(t.id, 'signup', { plan: t.plan, ip: req.ip });
      res.status(201).json({ slug: t.slug, url: `${urlOf(t)}/`, billing_url: t.plan === 'free' ? null : billingUrl(t), trial_until: t.trial_until, plan: t.plan });
    } catch (e) {
      const x = live.get(t.slug);
      if (x) { live.delete(t.slug); try { x.close(); } catch { /* */ } }
      fs.rmSync(tenantDir(t.slug), { recursive: true, force: true });
      store.remove(t.id);
      res.status(500).json({ error: `Hesap oluşturulamadı: ${e.message}` });
    }
  });

  // ---------------------------------------------------------------- Ödeme
  app.get('/odeme/:billing', (req, res, next) => {
    if (['simulator', 'sonuc'].includes(req.params.billing)) return next();
    const t = store.byBilling(req.params.billing);
    if (!t) return send(res, 404, messagePage('Bağlantı geçersiz', 'Ödeme bağlantısı bulunamadı. Kasadaki Ayarlar → Paket ekranından yeniden açın.'));
    send(res, 200, payPage({ tenant: t, payments: store.payments(t.id), provider }));
  });

  app.post('/api/cloud/pay/:billing', json, async (req, res) => {
    const t = store.byBilling(req.params.billing);
    if (!t) return res.status(404).json({ error: 'Ödeme bağlantısı geçersiz' });
    if (t.suspended) return res.status(403).json({ error: 'Hesap askıda' });
    const plan = ['esnaf', 'salon', 'pro'].includes(req.body?.plan) ? req.body.plan : null;
    const months = Number(req.body?.months) === 12 ? 12 : 1;
    if (!plan) return res.status(400).json({ error: 'Paket seçin' });
    const price = priceOf(plan, months);
    const p = store.createPayment({ tenant_id: t.id, plan, months, ...price, provider: provider.name });
    try {
      const out = await provider.start({ payment: p, tenant: t, baseUrl, ip: req.ip });
      store.updatePayment(p.id, { ref: out.ref });
      res.json({ redirect: out.redirect });
    } catch (e) {
      store.updatePayment(p.id, { status: 'failed', error: e.message });
      res.status(502).json({ error: `Ödeme başlatılamadı: ${e.message}` });
    }
  });

  // Deneme ödeme sayfası (yalnızca simulator)
  const simPayment = (ref) => (provider.name === 'simulator' ? store.paymentByRef(ref) : null);
  app.get('/odeme/simulator/:ref', (req, res) => {
    const p = simPayment(req.params.ref);
    if (!p) return send(res, 404, messagePage('Ödeme bulunamadı', 'Bu deneme ödemesi yok.'));
    const t = store.byId(p.tenant_id);
    send(res, 200, p.status === 'pending' ? simulatorPage({ payment: p, tenant: t }) : resultHtml(p, t));
  });
  app.post('/odeme/simulator/:ref', form, (req, res) => {
    const p = simPayment(req.params.ref);
    if (!p) return send(res, 404, messagePage('Ödeme bulunamadı', 'Bu deneme ödemesi yok.'));
    if (p.status === 'pending') {
      if (req.body?.ok === '1') applyPayment(p.id, { provider_payment_id: req.params.ref });
      else store.updatePayment(p.id, { status: 'failed', error: 'Deneme: ödeme reddedildi' });
    }
    res.redirect(303, `${baseUrl}/odeme/sonuc/${p.id}?r=${encodeURIComponent(p.ref)}`);
  });

  // iyzico geri dönüşü: token ile sonucu iyzico'dan sorgula (gelen veriye güvenmeden)
  app.post('/api/cloud/iyzico/callback', form, async (req, res) => {
    const token = str(req.body?.token);
    const p = token && store.paymentByRef(token);
    if (!p || provider.name !== 'iyzico') return send(res, 400, messagePage('Ödeme bulunamadı', 'Geçersiz ödeme dönüşü.'));
    if (p.status === 'pending') {
      try {
        const r = await provider.result(token);
        if (r.ok && r.basketId === `P${p.id}` && r.amount === p.amount) applyPayment(p.id, { provider_payment_id: r.paymentId });
        else store.updatePayment(p.id, { status: 'failed', error: r.error || 'Tutar ya da sepet uyuşmadı' });
      } catch (e) {
        store.updatePayment(p.id, { status: 'failed', error: e.message });
      }
    }
    res.redirect(303, `${baseUrl}/odeme/sonuc/${p.id}?r=${encodeURIComponent(p.ref)}`);
  });

  function resultHtml(p, t) {
    return resultPage({ ok: p.status === 'paid', tenant: t, payment: p, tenantUrl: `${urlOf(t)}/`, error: p.error });
  }
  app.get('/odeme/sonuc/:id', (req, res) => {
    const p = store.payment(Number(req.params.id));
    if (!p || p.ref !== str(req.query.r)) return send(res, 404, messagePage('Ödeme bulunamadı', 'Bu ödeme kaydı yok.'));
    send(res, 200, resultHtml(p, store.byId(p.tenant_id)));
  });

  // ---------------------------------------------------------------- Caddy "on demand" sertifika onayı
  app.get('/api/cloud/tls-check', (req, res) => {
    const host = str(req.query.domain).toLowerCase();
    if (!domain) return res.sendStatus(404);
    if (host === domain || host === new URL(baseUrl).hostname) return res.sendStatus(200);
    const sub = host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : '';
    res.sendStatus(validSlug(sub) && store.bySlug(sub)?.ready ? 200 : 404);
  });

  // ---------------------------------------------------------------- Yönetim (Velaris Dijital)
  const adminAuth = (req, res, next) => {
    const [, b64] = String(req.get('authorization') || '').split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString('utf8').split(':').slice(1).join(':') : '';
    const ok = opts.adminToken && pass.length === opts.adminToken.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(opts.adminToken));
    if (ok) return next();
    res.set('WWW-Authenticate', 'Basic realm="Velaris Bulut"').status(401).send('Yetki gerekli');
  };
  app.get('/yonetim', adminAuth, (req, res) => send(res, 200, adminPage({ tenants: store.list(), urlOf })));
  app.get('/api/cloud/admin/tenants', adminAuth, (req, res) => res.json(store.list().map((t) => ({ ...t, billing_token: undefined, status: subscriptionStatus(t) }))));
  app.post('/yonetim/:slug', adminAuth, form, (req, res) => {
    const t = store.bySlug(req.params.slug);
    if (!t) return res.status(404).send('Yok');
    const action = req.body?.action;
    if (action === 'extend' || action === 'extend12') {
      const months = action === 'extend12' ? 12 : 1;
      const start = [today(), t.paid_until].filter(Boolean).sort().pop();
      const plan = t.plan === 'free' ? 'esnaf' : t.plan;
      issueLicense(store.update(t.id, { plan, paid_until: addMonths(start, months) }));
      store.event(t.id, 'admin_extend', { months });
    } else if (action === 'suspend' || action === 'resume') {
      store.update(t.id, { suspended: action === 'suspend' ? 1 : 0 });
      store.event(t.id, `admin_${action}`);
    }
    res.redirect(303, `${baseUrl}/yonetim`);
  });

  app.use((req, res) => send(res, 404, messagePage('Sayfa bulunamadı', 'Aradığınız sayfa yok.')));

  return {
    app, store, provider, urlOf, billingUrl, issueLicense, applyPayment,
    close() { clearInterval(sweeper); for (const x of live.values()) { try { x.close(); } catch { /* */ } } live.clear(); store.db.close(); },
  };
}
