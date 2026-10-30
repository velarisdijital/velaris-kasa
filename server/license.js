// Paketler ve lisans.
//
// Lisans anahtarı: "VK1.<veri>.<imza>" — veri base64url JSON { lic, plan, business, exp, issued, install? },
// imza Velaris Dijital'in gizli Ed25519 anahtarıyla. Program yalnızca açık anahtarı taşır, doğrulama internetsiz yapılır.
// Anahtar üretimi: scripts/license.mjs (gizli anahtar depoda TUTULMAZ).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRACE_DAYS = 7;

export const PLANS = {
  free: {
    name: 'Ücretsiz', price: 0,
    limits: { registers: 1, users: 1 },
    features: [],
  },
  esnaf: {
    name: 'Esnaf', price: 599,
    limits: { registers: 3, users: Infinity },
    features: ['fiscal', 'invoice', 'loyalty', 'sms'],
  },
  salon: {
    name: 'Salon', price: 799,
    limits: { registers: 3, users: Infinity },
    features: ['fiscal', 'invoice', 'loyalty', 'sms', 'appointments', 'booking', 'reminders'],
  },
  pro: {
    name: 'Pro', price: 1290,
    limits: { registers: Infinity, users: Infinity },
    features: ['fiscal', 'invoice', 'loyalty', 'sms', 'appointments', 'booking', 'reminders', 'campaign', 'crm', 'branches', 'api'],
  },
};

export const FEATURE_LABELS = {
  fiscal: 'Yazarkasa bağlantısı', invoice: 'e-Arşiv / e-Fatura', loyalty: 'Puan sistemi', sms: 'SMS / WhatsApp bildirimleri',
  appointments: 'Randevu takvimi ve prim', booking: 'Online randevu sayfası', reminders: 'Otomatik randevu hatırlatma',
  campaign: 'Toplu kampanya mesajı', crm: 'Velaris CRM entegrasyonu', branches: 'Şube bazlı stok', api: 'API anahtarları',
};

// En düşük paket (yükseltme önerisi için)
export const featurePlan = (feature) => ['esnaf', 'salon', 'pro'].find((p) => PLANS[p].features.includes(feature));

function publicKey() {
  // Testlerde geçici anahtar kullanılabilir; üretimde yalnızca gömülü açık anahtar geçerlidir.
  if (process.env.NODE_ENV === 'test' && process.env.VK_LICENSE_PUBLIC_KEY) return process.env.VK_LICENSE_PUBLIC_KEY;
  return fs.readFileSync(path.join(__dirname, 'license-public.pem'), 'utf8');
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Gizli anahtarla lisans anahtarı üretir (yalnızca Velaris Dijital'in aracında kullanılır). */
export function signLicense(payload, privateKeyPem) {
  const data = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(data), privateKeyPem);
  return `VK1.${data}.${b64u(sig)}`;
}

/** Anahtarı doğrular; geçersizse hata fırlatır. */
export function verifyLicense(key) {
  const m = /^VK1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || '').trim());
  if (!m) throw new Error('Lisans anahtarı biçimi hatalı');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(m[1]), publicKey(), unb64u(m[2])); } catch { ok = false; }
  if (!ok) throw new Error('Lisans anahtarı geçersiz (imza doğrulanamadı)');
  const payload = JSON.parse(unb64u(m[1]).toString('utf8'));
  if (!PLANS[payload.plan]) throw new Error('Lisanstaki paket tanınmıyor');
  return payload;
}

const today = () => new Date().toLocaleDateString('sv-SE');
const addDays = (d, n) => { const x = new Date(`${d}T12:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };

/** Kurulumun geçerli paketi ve durumu. */
export function currentLicense(db) {
  if (globalThis.__VK_DEMO__) return describe('pro', { status: 'demo' });
  if (process.env.NODE_ENV === 'test' && process.env.VK_TEST_DEFAULT_PLAN && !getSetting(db, 'license_key')) {
    return describe(process.env.VK_TEST_DEFAULT_PLAN, { status: 'active' });
  }
  const key = getSetting(db, 'license_key');
  if (!key) return describe('free', { status: 'free' });
  let p;
  try { p = verifyLicense(key); } catch (e) { return describe('free', { status: 'invalid', error: e.message }); }
  const installId = getSetting(db, 'install_id');
  if (p.install && p.install !== installId) return describe('free', { status: 'invalid', error: 'Lisans başka bir kuruluma ait' });
  const extra = { status: 'active', exp: p.exp || null, business: p.business || null, lic: p.lic || null };
  if (p.exp && today() > p.exp) {
    if (today() > addDays(p.exp, GRACE_DAYS)) return describe('free', { ...extra, status: 'expired', expired_plan: p.plan });
    return describe(p.plan, { ...extra, status: 'grace', grace_until: addDays(p.exp, GRACE_DAYS) });
  }
  return describe(p.plan, extra);
}

function describe(plan, extra) {
  const P = PLANS[plan] || PLANS.free;
  return {
    plan, plan_name: P.name, features: P.features,
    limits: { registers: P.limits.registers === Infinity ? null : P.limits.registers, users: P.limits.users === Infinity ? null : P.limits.users },
    ...extra,
  };
}

export const hasFeature = (db, feature) => currentLicense(db).features.includes(feature);

export class PlanError extends Error {
  constructor(feature) {
    const plan = featurePlan(feature);
    super(`${FEATURE_LABELS[feature] || feature} ${PLANS[plan]?.name || 'üst'} paketinde. Ayarlar → Paket'ten yükseltebilirsiniz.`);
    this.status = 402;
    this.code = 'PLAN_REQUIRED';
    this.feature = feature;
    this.required_plan = plan;
  }
}

export function requireFeature(db, feature) {
  if (!hasFeature(db, feature)) throw new PlanError(feature);
}

/** Express ara katmanı. */
export const feature = (db, name) => (req, res, next) => {
  try { requireFeature(db, name); next(); } catch (e) { next(e); }
};

export function limitError(what, limit, planName) {
  const e = new Error(`${planName} paketinde en fazla ${limit} ${what} kullanılabilir. Ayarlar → Paket'ten yükseltebilirsiniz.`);
  e.status = 402;
  e.code = 'PLAN_LIMIT';
  return e;
}
