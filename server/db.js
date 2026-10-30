import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SETTINGS = {
  business_name: 'İşletmem',
  business_type: 'market',          // market | berber | kafe | genel
  business_address: '',
  business_phone: '',
  tax_number: '',
  receipt_footer: 'Bizi tercih ettiğiniz için teşekkürler!',
  currency: 'TRY',
  default_vat: '20',
  allow_negative_stock: '1',
  scale_barcode_prefixes: '27,28,29', // terazi barkodu (EAN-13, gram cinsinden)
  modules_appointments: '0',
  setup_done: '0',
  crm_enabled: '0',
  crm_base_url: '',
  crm_api_key: '',
  crm_webhook_secret: '',
  crm_sync_customers: '1',
  crm_sync_sales: '1',
  crm_sync_stock: '1',
  crm_sync_appointments: '1',
  crm_last_customer_pull: '',
};

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'velaris-kasa.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);

  db.file = file;
  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? DEFAULT_SETTINGS[key];
}

export function setSettings(db, values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(values)) stmt.run(k, v == null ? '' : String(v));
  })();
}

/**
 * Velaris CRM entegrasyonu açıksa olayı outbox'a yazar. Çağıran transaction'ın
 * içinde kullanılmalı ki satış ile olay aynı anda kaydedilsin.
 */
export function emitEvent(db, event, payload) {
  if (getSetting(db, 'crm_enabled') !== '1') return;
  const group = event.split('.')[0];
  const flag = {
    customer: 'crm_sync_customers',
    sale: 'crm_sync_sales',
    payment: 'crm_sync_customers',
    stock: 'crm_sync_stock',
    product: 'crm_sync_stock',
    appointment: 'crm_sync_appointments',
  }[group];
  if (flag && getSetting(db, flag) !== '1') return;
  db.prepare('INSERT INTO outbox (event, payload) VALUES (?, ?)').run(event, JSON.stringify(payload));
}

export function nextReceiptNo(db) {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const row = db.prepare("SELECT receipt_no FROM sales WHERE receipt_no LIKE ? ORDER BY id DESC LIMIT 1").get(`${ymd}-%`);
  const seq = row ? parseInt(row.receipt_no.split('-')[1], 10) + 1 : 1;
  return `${ymd}-${String(seq).padStart(4, '0')}`;
}
