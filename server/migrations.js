// Sıralı veritabanı göçleri. schema.sql 1. sürümdür; her yeni değişiklik buraya
// yeni bir eleman olarak eklenir ve PRAGMA user_version ile bir kez uygulanır.

const MIGRATIONS = [
  // 2: yazarkasa (mali fiş), e-Arşiv, puan, KVKK/İYS onayları, online randevu, bildirimler
  `
  ALTER TABLE sales ADD COLUMN fiscal_status TEXT NOT NULL DEFAULT 'none';  -- none|pending|done|failed
  ALTER TABLE sales ADD COLUMN fiscal_no TEXT;
  ALTER TABLE sales ADD COLUMN fiscal_z_no TEXT;
  ALTER TABLE sales ADD COLUMN fiscal_error TEXT;
  ALTER TABLE sales ADD COLUMN fiscal_at TEXT;
  ALTER TABLE sales ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'none'; -- none|pending|done|failed
  ALTER TABLE sales ADD COLUMN invoice_no TEXT;
  ALTER TABLE sales ADD COLUMN invoice_url TEXT;
  ALTER TABLE sales ADD COLUMN invoice_error TEXT;
  ALTER TABLE sales ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE customers ADD COLUMN tax_number TEXT;      -- VKN (10 hane) veya TCKN (11 hane)
  ALTER TABLE customers ADD COLUMN tax_office TEXT;
  ALTER TABLE customers ADD COLUMN address TEXT;
  ALTER TABLE customers ADD COLUMN city TEXT;
  ALTER TABLE customers ADD COLUMN district TEXT;
  ALTER TABLE customers ADD COLUMN points INTEGER NOT NULL DEFAULT 0;   -- para puan (kuruş)
  ALTER TABLE customers ADD COLUMN sms_consent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE customers ADD COLUMN email_consent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE customers ADD COLUMN consent_at TEXT;
  ALTER TABLE customers ADD COLUMN consent_source TEXT;
  ALTER TABLE customers ADD COLUMN iys_exported_at TEXT;

  ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'kasa'; -- kasa|online|crm
  ALTER TABLE appointments ADD COLUMN reminder_sent_at TEXT;
  ALTER TABLE appointments ADD COLUMN token TEXT;

  CREATE TABLE points_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    sale_id       INTEGER,
    type          TEXT NOT NULL CHECK (type IN ('earn','redeem','refund','adjust')),
    points        INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    note          TEXT,
    user_id       INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE notifications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    channel        TEXT NOT NULL,                 -- sms | whatsapp
    kind           TEXT NOT NULL,                 -- reminder | booking | balance | marketing | test
    to_phone       TEXT NOT NULL,
    customer_id    INTEGER,
    appointment_id INTEGER,
    body           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
    provider       TEXT,
    provider_ref   TEXT,
    error          TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    sent_at        TEXT
  );
  CREATE INDEX idx_notifications_status ON notifications(status, created_at);

  -- Ödeme yöntemlerine 'points' (puanla ödeme) eklemek için tablo yeniden kuruluyor
  CREATE TABLE sale_payments_new (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method  TEXT NOT NULL CHECK (method IN ('cash','card','credit','transfer','points')),
    amount  INTEGER NOT NULL
  );
  INSERT INTO sale_payments_new (id, sale_id, method, amount) SELECT id, sale_id, method, amount FROM sale_payments;
  DROP TABLE sale_payments;
  ALTER TABLE sale_payments_new RENAME TO sale_payments;
  CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);
  `,
  // 3: e-belge sağlayıcısındaki iş/belge kimliği
  `ALTER TABLE sales ADD COLUMN invoice_ref TEXT;`,
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version || 1;
  for (let v = current + 1; v <= MIGRATIONS.length + 1; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v - 2]);
      db.exec(`PRAGMA user_version = ${v}`);
    })();
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length + 1;
