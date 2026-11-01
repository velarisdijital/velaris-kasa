// Yemek platformu siparişleri (Yemeksepeti, Trendyol Go / Yemek, Migros Yemek, Getir…).
//
// Yol: platformlar siparişleri onaylı POS / entegratör firmalarına verir. VelarisKasa, entegratörün (ya da ileride doğrudan
// platform adaptörünün) gönderdiği tek tip sipariş JSON'unu imzalı webhook ile alır, ürünleri eşler, Paket ekranına düşürür;
// personelin kabul / ret / hazır / yolda / teslim işlemleri imzalı istekle geri bildirilir.
// Sözleşme: docs/YEMEK_PLATFORMLARI.md
import crypto from 'node:crypto';
import { getSettings } from '../db.js';
import { bad, int, num, str } from '../util.js';
import { createDeliveryOrder } from '../routes/deliveries.js';

export const PLATFORMS = { yemeksepeti: 'Yemeksepeti', trendyol: 'Trendyol Go / Yemek', migros: 'Migros Yemek', getir: 'Getir', other: 'Diğer' };
export const sign = (secret, body) => crypto.createHmac('sha256', secret || '').update(body).digest('hex');

export function verifySignature(db, rawBody, header) {
  const s = getSettings(db);
  if (s.platforms_enabled !== '1' || !s.platform_secret) return false;
  const given = String(header || '').replace(/^sha256=/, '');
  const expected = sign(s.platform_secret, rawBody || '');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Platform ürününü bizim ürünle eşle: kayıtlı eşleme → aynı ad → eşlemesiz (ad + fiyatla). */
function mapItem(db, platform, it) {
  const extId = str(it.external_id) || str(it.name);
  let row = extId && db.prepare('SELECT product_id FROM platform_products WHERE platform = ? AND external_id = ?').get(platform, extId);
  if (!row) {
    const p = db.prepare("SELECT id FROM products WHERE active = 1 AND lower(name) = lower(?) LIMIT 1").get(str(it.name) || '');
    db.prepare(`INSERT INTO platform_products (platform, external_id, external_name, product_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET external_name = excluded.external_name`).run(platform, extId, str(it.name), p?.id ?? null);
    row = { product_id: p?.id ?? null };
  }
  return row.product_id;
}

/**
 * Tek tip siparişi işler. o: { platform, external_id, status?, customer: { name, phone, address, note }, items: [{ external_id, name,
 *   qty, unit_price, note, options: [{ name, price }] }], delivery_fee, discount, paid_online, payment_text, due_at, kind? }
 * Tutarlar kuruş, KDV dahil. Aynı sipariş tekrar gelirse çoğaltılmaz. status 'cancelled' ise sipariş iptal edilir.
 */
export function ingestOrder(db, o) {
  const platform = PLATFORMS[o?.platform] ? o.platform : 'other';
  const externalId = str(o?.external_id);
  if (!externalId) throw bad('external_id gerekli');
  const existing = db.prepare('SELECT * FROM tickets WHERE source = ? AND external_id = ?').get(platform, externalId);

  if (o.status === 'cancelled') {
    if (!existing) return { ticket_id: null, action: 'ignored' };
    if (existing.status === 'open' && existing.paid_total === 0) {
      db.transaction(() => {
        db.prepare("UPDATE ticket_items SET void_at = datetime('now','localtime'), void_reason = ? WHERE ticket_id = ? AND void_at IS NULL")
          .run(`${PLATFORMS[platform]} iptal etti`, existing.id);
        db.prepare("UPDATE tickets SET status = 'cancelled', external_status = 'cancelled', closed_at = datetime('now','localtime'), cancel_reason = ? WHERE id = ?")
          .run(str(o.reason) || `${PLATFORMS[platform]} iptal etti`, existing.id);
      })();
    }
    return { ticket_id: existing.id, action: 'cancelled' };
  }
  if (existing) return { ticket_id: existing.id, action: 'duplicate' };

  const items = (Array.isArray(o.items) ? o.items : []).map((it) => {
    const qty = num(it.qty, 1);
    const options = Array.isArray(it.options) ? it.options : [];
    const optPrice = options.reduce((a, x) => a + int(x.price), 0);
    const productId = mapItem(db, platform, it);
    return {
      product_id: productId, name: str(it.name) || 'Ürün', qty, unit_price: int(it.unit_price) + optPrice, vat_rate: it.vat_rate ?? undefined,
      note: [options.map((x) => x.name).filter(Boolean).join(', '), str(it.note)].filter(Boolean).join(' · ') || null,
    };
  });
  if (!items.length) throw bad('Siparişte ürün yok');
  const c = o.customer || {};
  const s = getSettings(db);
  const auto = s.platform_auto_accept === '1';
  const ticketId = db.transaction(() => {
    const id = createDeliveryOrder(db, {
      kind: o.kind === 'takeaway' ? 'takeaway' : 'delivery', customer_name: c.name, phone: c.phone, address: c.address || (o.kind === 'takeaway' ? null : '-'),
      delivery_note: [str(c.note), str(o.note)].filter(Boolean).join(' · ') || null, items, delivery_fee: int(o.delivery_fee),
      source: platform, external_id: externalId, external_status: auto ? 'accepted' : 'pending',
      payment_hint: o.paid_online ? 'Online ödendi' : str(o.payment_text) || 'Kapıda ödeme', prepaid: !!o.paid_online,
      due_at: str(o.due_at), sent: auto,
    }, null);
    const discount = Math.max(0, int(o.discount));
    if (discount) db.prepare('UPDATE tickets SET discount = ? WHERE id = ?').run(discount, id);
    if (auto) {
      db.prepare("UPDATE tickets SET delivery_status = 'preparing', status_at = datetime('now','localtime') WHERE id = ?").run(id);
      queueEvent(db, { platform, external_id: externalId, ticket_id: id }, 'accept', { prep_minutes: int(s.platform_prep_minutes) || 20 });
    }
    return id;
  })();
  return { ticket_id: ticketId, action: 'created', unmapped: items.filter((i) => !i.product_id).map((i) => i.name) };
}

export function queueEvent(db, t, action, data = {}) {
  const platform = t.source || t.platform;
  if (!platform || platform === 'pos' || platform === 'phone' || !t.external_id) return;
  db.prepare('INSERT INTO platform_events (platform, external_id, ticket_id, action, data_json) VALUES (?, ?, ?, ?, ?)')
    .run(platform, t.external_id, t.ticket_id ?? t.id, action, JSON.stringify(data));
}

/** Bekleyen durum bildirimlerini entegratöre gönderir (imzalı POST). Başarısız olan 10 denemeye kadar tekrarlanır. */
export async function flushPlatformEvents(db, { fetchImpl = fetch } = {}) {
  const s = getSettings(db);
  if (s.platforms_enabled !== '1' || !s.platform_callback_url) return { sent: 0, failed: 0 };
  const rows = db.prepare("SELECT * FROM platform_events WHERE status = 'pending' OR (status = 'failed' AND attempts < 10) ORDER BY id LIMIT 25").all();
  let sent = 0; let failed = 0;
  for (const e of rows) {
    const body = JSON.stringify({ event: `order.${e.action}`, platform: e.platform, external_id: e.external_id, data: JSON.parse(e.data_json || '{}'), at: e.created_at });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetchImpl(s.platform_callback_url, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-VK-Signature': `sha256=${sign(s.platform_secret, body)}`, 'X-VK-Event-Id': String(e.id) },
        body,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      db.prepare("UPDATE platform_events SET status = 'sent', attempts = attempts + 1, sent_at = datetime('now','localtime'), error = NULL WHERE id = ?").run(e.id);
      sent++;
    } catch (err) {
      db.prepare("UPDATE platform_events SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?").run(String(err.message || err).slice(0, 300), e.id);
      failed++;
    }
  }
  return { sent, failed };
}

export function startPlatformWorker(db) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await flushPlatformEvents(db); } catch { /* sonraki turda */ } finally { busy = false; }
  }, 10_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Denemeler için örnek sipariş (gerçek platforma gitmez). */
export function sampleOrder(db, platform = 'yemeksepeti') {
  const products = db.prepare("SELECT id, name, sell_price FROM products WHERE active = 1 AND type = 'product' AND sell_price > 0 ORDER BY favorite DESC, id LIMIT 3").all();
  if (!products.length) throw bad('Önce satışta olan ürün ekleyin');
  return {
    platform, external_id: `TEST-${Date.now().toString(36).toUpperCase()}`,
    customer: { name: 'Deneme Müşteri', phone: '0555 000 00 00', address: 'Deneme Mah. Örnek Sok. No:1 D:2', note: 'Zili çalmayın' },
    items: products.map((p, i) => ({ external_id: `ext-${p.id}`, name: p.name, qty: i === 0 ? 2 : 1, unit_price: p.sell_price, options: i === 0 ? [{ name: 'Ekstra sos', price: 500 }] : [] })),
    delivery_fee: 0, discount: 1000, paid_online: true,
  };
}
