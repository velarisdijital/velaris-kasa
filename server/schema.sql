-- Velaris Kasa veritabanı şeması
-- Tüm para tutarları KURUŞ cinsinden tam sayı (INTEGER) olarak saklanır.
-- Fiyatlar KDV dahildir.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  pin_hash        TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin','manager','cashier','staff','kitchen')),
  commission_rate REAL NOT NULL DEFAULT 0,          -- hizmet primi yüzdesi (berber vb.)
  color           TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  barcode      TEXT UNIQUE,
  sku          TEXT,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'product' CHECK (type IN ('product','service')),
  unit         TEXT NOT NULL DEFAULT 'adet',          -- adet, kg, lt, m, paket
  buy_price    INTEGER NOT NULL DEFAULT 0,
  sell_price   INTEGER NOT NULL DEFAULT 0,
  vat_rate     REAL NOT NULL DEFAULT 20,
  stock        REAL NOT NULL DEFAULT 0,
  min_stock    REAL NOT NULL DEFAULT 0,
  track_stock  INTEGER NOT NULL DEFAULT 1,
  duration_min INTEGER,                               -- hizmet süresi (randevu)
  favorite     INTEGER NOT NULL DEFAULT 0,             -- kasa hızlı tuşu
  active       INTEGER NOT NULL DEFAULT 1,
  crm_id       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('in','out','sale','refund','adjust','count')),
  qty         REAL NOT NULL,                          -- işaretli: + giriş, - çıkış
  stock_after REAL NOT NULL,
  unit_cost   INTEGER,
  note        TEXT,
  sale_id     INTEGER,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  note         TEXT,
  balance      INTEGER NOT NULL DEFAULT 0,             -- + müşteri borçlu (veresiye)
  credit_limit INTEGER NOT NULL DEFAULT 0,             -- 0 = limitsiz
  crm_id       TEXT UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('debt','payment','adjust')),
  amount      INTEGER NOT NULL,                        -- işaretli: + borç, - ödeme
  balance_after INTEGER NOT NULL,
  method      TEXT,
  sale_id     INTEGER,
  shift_id    INTEGER,
  note        TEXT,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  register_name  TEXT NOT NULL DEFAULT 'Kasa 1',
  user_id        INTEGER NOT NULL REFERENCES users(id),
  opening_cash   INTEGER NOT NULL DEFAULT 0,
  counted_cash   INTEGER,
  expected_cash  INTEGER,
  note           TEXT,
  opened_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at      TEXT,
  closed_by      INTEGER
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id   INTEGER NOT NULL REFERENCES shifts(id),
  type       TEXT NOT NULL CHECK (type IN ('in','out')),
  amount     INTEGER NOT NULL,
  note       TEXT,
  user_id    INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no    TEXT NOT NULL UNIQUE,
  client_uuid   TEXT UNIQUE,                           -- çevrimdışı kuyruktan çift kayıt önleme
  shift_id      INTEGER REFERENCES shifts(id),
  register_name TEXT,
  user_id       INTEGER REFERENCES users(id),
  customer_id   INTEGER REFERENCES customers(id),
  subtotal      INTEGER NOT NULL,                      -- satır toplamları (indirim öncesi)
  discount      INTEGER NOT NULL DEFAULT 0,            -- fiş geneli indirim
  vat_total     INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  cost_total    INTEGER NOT NULL DEFAULT 0,
  refunded_total INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partial_refund','refunded')),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'product',
  qty          REAL NOT NULL,
  unit         TEXT,
  unit_price   INTEGER NOT NULL,
  unit_cost    INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  vat_rate     REAL NOT NULL,
  line_total   INTEGER NOT NULL,
  staff_id     INTEGER REFERENCES users(id),           -- hizmeti yapan personel (prim)
  refunded_qty REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method  TEXT NOT NULL CHECK (method IN ('cash','card','credit','transfer')),
  amount  INTEGER NOT NULL                             -- iadelerde negatif
);

CREATE TABLE IF NOT EXISTS refunds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  shift_id   INTEGER REFERENCES shifts(id),
  amount     INTEGER NOT NULL,
  method     TEXT NOT NULL,
  items_json TEXT NOT NULL,
  note       TEXT,
  user_id    INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  phone       TEXT,
  staff_id    INTEGER REFERENCES users(id),
  service_id  INTEGER REFERENCES products(id),
  start_at    TEXT NOT NULL,                           -- 'YYYY-MM-DD HH:MM'
  duration_min INTEGER NOT NULL DEFAULT 30,
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','no_show')),
  note        TEXT,
  sale_id     INTEGER REFERENCES sales(id),
  crm_id      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  prefix     TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  last_used  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Velaris CRM'e gönderilecek olaylar (transactional outbox)
CREATE TABLE IF NOT EXISTS outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event           TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, next_attempt_at);
