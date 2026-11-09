// Velaris Bulut kontrol veritabanı: işletmeler (kiracılar), abonelik durumu, ödemeler.
// Her işletmenin kendi VelarisKasa veritabanı ayrı klasördedir (tenants/<adres>/velaris-kasa.db).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7; // lisans da bitişten sonra 7 gün çalışır (server/license.js)
export const VAT_RATE = 20;

export const RESERVED = new Set(['www', 'api', 'admin', 'yonetim', 'app', 'bulut', 'mail', 'smtp', 'cdn', 'static', 'assets', 'demo',
  'uygulama', 'kayit', 'odeme', 'i', 'velaris', 'velariskasa', 'test', 'destek', 'blog', 'docs', 'status', 'panel', 'giris']);

/** İşletme adresi (alt alan adı): küçük harf, rakam, tire; 3-30 karakter */
export function validSlug(s) {
  return typeof s === 'string' && /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(s) && !s.includes('--') && !RESERVED.has(s);
}

export function slugify(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  return String(name || '').toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'x$1').slice(0, 30).replace(/-+$/, '');
}

export const today = () => new Date().toLocaleDateString('sv-SE');
export function addDays(d, n) { const x = new Date(`${d}T12:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); }
export function addMonths(d, n) {
  const x = new Date(`${d}T12:00`);
  const day = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x.toLocaleDateString('sv-SE');
}

/** Abonelik durumu: free | trial | active | due (ödeme günü 3 gün içinde) | grace | expired | suspended */
export function subscriptionStatus(t, now = today()) {
  if (t.suspended) return 'suspended';
  if (t.plan === 'free') return 'free';
  if (t.paid_until) {
    if (now <= t.paid_until) return addDays(now, 3) >= t.paid_until ? 'due' : 'active';
    if (now <= addDays(t.paid_until, GRACE_DAYS)) return 'grace';
    return 'expired';
  }
  if (t.trial_until && now <= t.trial_until) return 'trial';
  if (t.trial_until && now <= addDays(t.trial_until, GRACE_DAYS)) return 'grace';
  return 'expired';
}

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'cloud.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      business_name TEXT NOT NULL,
      business_type TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      tax_id TEXT,
      city TEXT,
      address TEXT,
      plan TEXT NOT NULL,
      next_plan TEXT,
      trial_until TEXT,
      paid_until TEXT,
      suspended INTEGER NOT NULL DEFAULT 0,
      ready INTEGER NOT NULL DEFAULT 0,
      billing_token TEXT NOT NULL UNIQUE,
      install_id TEXT,
      license_lic TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      signup_ip TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      plan TEXT NOT NULL,
      months INTEGER NOT NULL DEFAULT 1,
      net INTEGER NOT NULL,
      vat INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      provider TEXT NOT NULL,
      ref TEXT,
      provider_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
      error TEXT,
      period_start TEXT,
      period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS payments_ref ON payments(ref);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  const s = {
    db,
    bySlug: (slug) => db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug),
    byBilling: (tok) => db.prepare('SELECT * FROM tenants WHERE billing_token = ?').get(tok),
    byId: (id) => db.prepare('SELECT * FROM tenants WHERE id = ?').get(id),
    list: () => db.prepare('SELECT * FROM tenants ORDER BY id DESC').all(),
    create(t) {
      const billing = crypto.randomBytes(18).toString('base64url');
      const id = db.prepare(`INSERT INTO tenants (slug, business_name, business_type, contact_name, email, phone, tax_id, city, address, plan, trial_until, billing_token, signup_ip)
        VALUES (@slug, @business_name, @business_type, @contact_name, @email, @phone, @tax_id, @city, @address, @plan, @trial_until, @billing, @signup_ip)`)
        .run({ ...t, billing }).lastInsertRowid;
      return s.byId(id);
    },
    update(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return s.byId(id);
      db.prepare(`UPDATE tenants SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
      return s.byId(id);
    },
    remove: (id) => db.prepare('DELETE FROM tenants WHERE id = ?').run(id),
    event: (tenantId, type, detail) => db.prepare('INSERT INTO events (tenant_id, type, detail) VALUES (?, ?, ?)')
      .run(tenantId ?? null, type, detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail)),
    payment: (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(id),
    paymentByRef: (ref) => db.prepare('SELECT * FROM payments WHERE ref = ?').get(ref),
    payments: (tenantId) => db.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY id DESC').all(tenantId),
    createPayment(p) {
      const id = db.prepare('INSERT INTO payments (tenant_id, plan, months, net, vat, amount, provider) VALUES (@tenant_id, @plan, @months, @net, @vat, @amount, @provider)').run(p).lastInsertRowid;
      return s.payment(id);
    },
    updatePayment(id, patch) {
      const keys = Object.keys(patch);
      db.prepare(`UPDATE payments SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
      return s.payment(id);
    },
  };
  return s;
}
