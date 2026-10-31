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
  // 4: şubeler ve şube bazlı stok. products.stock tüm şubelerin toplamıdır.
  `
  CREATE TABLE branches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    address    TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  INSERT INTO branches (id, name) VALUES (1, 'Merkez');

  CREATE TABLE registers (
    name      TEXT PRIMARY KEY,
    branch_id INTEGER NOT NULL DEFAULT 1 REFERENCES branches(id)
  );
  INSERT OR IGNORE INTO registers (name) SELECT DISTINCT register_name FROM sales WHERE register_name IS NOT NULL;
  INSERT OR IGNORE INTO registers (name) SELECT DISTINCT register_name FROM shifts;

  CREATE TABLE branch_stock (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id  INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    stock      REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, branch_id)
  );
  INSERT INTO branch_stock (product_id, branch_id, stock) SELECT id, 1, stock FROM products WHERE stock != 0;

  ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE sales ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
  `,
  // 5: İYS'ye otomatik yüklemede son hata
  `ALTER TABLE customers ADD COLUMN iys_error TEXT;`,
  // 6: fiyat geçmişi (toplu fiyat güncelleme, etiket yazdırma için "fiyatı değişenler")
  `
  CREATE TABLE price_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    old_price  INTEGER NOT NULL,
    new_price  INTEGER NOT NULL,
    reason     TEXT,
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_price_changes_product ON price_changes(product_id, created_at);
  ALTER TABLE products ADD COLUMN price_changed_at TEXT;
  ALTER TABLE products ADD COLUMN label_printed_at TEXT;
  `,
  // 7: tedarikçiler, alış faturaları, tedarikçi cari hareketleri
  `
  CREATE TABLE suppliers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    tax_number TEXT,
    tax_office TEXT,
    address    TEXT,
    note       TEXT,
    balance    INTEGER NOT NULL DEFAULT 0,          -- + tedarikçiye borcumuz
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE purchases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id),
    doc_type    TEXT NOT NULL DEFAULT 'fatura' CHECK (doc_type IN ('fatura','irsaliye','fis')),
    doc_no      TEXT,
    doc_date    TEXT NOT NULL,
    branch_id   INTEGER NOT NULL DEFAULT 1,
    net_total   INTEGER NOT NULL,                   -- KDV hariç
    vat_total   INTEGER NOT NULL,
    total       INTEGER NOT NULL,                   -- KDV dahil
    paid        INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
    note        TEXT,
    user_id     INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_purchases_date ON purchases(doc_date);
  CREATE TABLE purchase_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id    INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id     INTEGER REFERENCES products(id),
    name           TEXT NOT NULL,
    qty            REAL NOT NULL,
    unit           TEXT,
    unit_cost_net  INTEGER NOT NULL,                -- KDV hariç birim
    vat_rate       REAL NOT NULL,
    unit_cost      INTEGER NOT NULL,                -- KDV dahil birim (ürünün alış fiyatı olur)
    line_net       INTEGER NOT NULL,
    line_total     INTEGER NOT NULL
  );
  CREATE TABLE supplier_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK (type IN ('purchase','payment','adjust')),
    amount        INTEGER NOT NULL,                 -- + borç artar, - borç azalır
    balance_after INTEGER NOT NULL,
    purchase_id   INTEGER,
    method        TEXT,
    note          TEXT,
    user_id       INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
  // 8: Kafe / restoran — masalar ve adisyonlar
  `
  CREATE TABLE dining_tables (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    zone       TEXT,                                -- Salon, Bahçe, Teras…
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id      INTEGER NOT NULL REFERENCES dining_tables(id),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    guest_count   INTEGER,
    customer_id   INTEGER REFERENCES customers(id),
    note          TEXT,
    user_id       INTEGER,                          -- masayı açan garson
    paid_total    INTEGER NOT NULL DEFAULT 0,
    cancel_reason TEXT,
    opened_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    closed_at     TEXT
  );
  CREATE UNIQUE INDEX idx_tickets_open_table ON tickets(table_id) WHERE status = 'open';
  CREATE TABLE ticket_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products(id),
    name        TEXT NOT NULL,
    qty         REAL NOT NULL,
    paid_qty    REAL NOT NULL DEFAULT 0,
    unit        TEXT,
    unit_price  INTEGER NOT NULL,
    vat_rate    REAL NOT NULL,
    note        TEXT,                               -- "şekersiz", "az pişmiş"…
    user_id     INTEGER,
    sent_at     TEXT,                               -- mutfağa/bara gönderildi
    void_at     TEXT,                               -- iptal / ikram
    void_reason TEXT,
    void_user_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_ticket_items_ticket ON ticket_items(ticket_id);
  ALTER TABLE sales ADD COLUMN ticket_id INTEGER;
  `,
  // 9: Reçeteler — reçeteli ürün satılınca bileşenlerin stoğu düşer
  `
  CREATE TABLE recipe_items (
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES products(id),
    qty          REAL NOT NULL,                     -- 1 birim ürün için bileşen miktarı (bileşenin biriminde)
    PRIMARY KEY (product_id, component_id)
  );
  CREATE INDEX idx_recipe_component ON recipe_items(component_id);
  `,
  // 10: QR menü — masa QR anahtarı ve masadan gelen istekler (garson çağır, hesap, sipariş)
  `
  ALTER TABLE dining_tables ADD COLUMN qr_token TEXT;
  CREATE UNIQUE INDEX idx_tables_qr ON dining_tables(qr_token);
  ALTER TABLE products ADD COLUMN menu_description TEXT;
  ALTER TABLE products ADD COLUMN menu_hidden INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE table_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id    INTEGER NOT NULL REFERENCES dining_tables(id),
    type        TEXT NOT NULL CHECK (type IN ('waiter','bill','order')),
    items_json  TEXT,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done','rejected')),
    ticket_id   INTEGER,
    handled_by  INTEGER,
    handled_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_table_requests_status ON table_requests(status);
  `,
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
