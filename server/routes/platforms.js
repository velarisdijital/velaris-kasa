// Yemek platformları: gelen sipariş webhook'u (girişsiz, imzalı) ve yönetim uçları.
import crypto from 'node:crypto';
import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { getSettings, setSettings } from '../db.js';
import { requireFeature } from '../license.js';
import { flushPlatformEvents, ingestOrder, PLATFORMS, sampleOrder, verifySignature } from '../integrations/platforms.js';
import { bad, h, int, str } from '../util.js';
import { loadTicket } from './tables.js';

/** Girişsiz: entegratör / platform adaptörü siparişleri buraya gönderir. Başlık: X-VK-Signature: sha256=<HMAC(gizli anahtar, gövde)> */
export function platformWebhook(db) {
  const r = Router();
  r.post('/integrations/orders', h((req, res) => {
    if (!verifySignature(db, req.rawBody, req.get('x-vk-signature'))) return res.status(401).json({ error: 'İmza doğrulanamadı ya da entegrasyon kapalı' });
    requireFeature(db, 'tables');
    const orders = Array.isArray(req.body?.orders) ? req.body.orders : [req.body];
    const results = orders.slice(0, 50).map((o) => {
      try { return { ok: true, external_id: o?.external_id, ...ingestOrder(db, o) }; } catch (e) { return { ok: false, external_id: o?.external_id, error: e.message }; }
    });
    res.status(results.every((x) => x.ok) ? 200 : 207).json(orders.length === 1 && !Array.isArray(req.body?.orders) ? results[0] : { results });
  }));
  return r;
}

export default function platformRoutes(db) {
  const r = Router();
  const feature = (req, res, next) => { try { requireFeature(db, 'tables'); next(); } catch (e) { next(e); } };

  r.get('/platforms/status', allow(...MANAGERS), feature, h((req, res) => {
    const s = getSettings(db);
    const events = db.prepare("SELECT status, COUNT(*) AS n FROM platform_events GROUP BY status").all();
    const lastError = db.prepare("SELECT error, created_at FROM platform_events WHERE status = 'failed' ORDER BY id DESC LIMIT 1").get();
    const today = db.prepare(`SELECT source, COUNT(*) AS n FROM tickets WHERE source IN (${Object.keys(PLATFORMS).map(() => '?').join(',')})
      AND substr(opened_at, 1, 10) = date('now','localtime') GROUP BY source`).all(...Object.keys(PLATFORMS));
    res.json({
      enabled: s.platforms_enabled === '1', has_secret: !!s.platform_secret, callback_url: s.platform_callback_url,
      auto_accept: s.platform_auto_accept === '1', prep_minutes: int(s.platform_prep_minutes) || 20,
      webhook_path: '/api/integrations/orders', platforms: PLATFORMS,
      events: Object.fromEntries(events.map((e) => [e.status, e.n])), last_error: lastError || null, today,
      unmapped: db.prepare('SELECT COUNT(*) AS n FROM platform_products WHERE product_id IS NULL').get().n,
    });
  }));

  /** Gizli anahtarı oluşturur / yeniler; yalnızca bu yanıtta tam gösterilir. */
  r.post('/platforms/secret', allow(), h((req, res) => {
    const secret = crypto.randomBytes(24).toString('base64url');
    setSettings(db, { platform_secret: secret });
    res.json({ secret });
  }));

  r.get('/platforms/products', allow(...MANAGERS), h((req, res) => {
    const where = req.query.unmapped === '1' ? 'WHERE pp.product_id IS NULL' : '';
    res.json(db.prepare(`SELECT pp.*, p.name AS product_name FROM platform_products pp LEFT JOIN products p ON p.id = pp.product_id
      ${where} ORDER BY pp.product_id IS NOT NULL, pp.platform, pp.external_name`).all());
  }));

  r.put('/platforms/products', allow(...MANAGERS), h((req, res) => {
    const { platform, external_id: extId } = req.body || {};
    const productId = req.body?.product_id ? int(req.body.product_id) : null;
    if (productId && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw bad('Ürün bulunamadı');
    const n = db.prepare("UPDATE platform_products SET product_id = ?, updated_at = datetime('now','localtime') WHERE platform = ? AND external_id = ?")
      .run(productId, str(platform), str(extId)).changes;
    if (!n) throw bad('Eşleme bulunamadı');
    res.json({ ok: true });
  }));

  /** Deneme siparişi: entegrasyon yokken akışı görmek için. */
  r.post('/platforms/simulate', allow(...MANAGERS), feature, h((req, res) => {
    const platform = PLATFORMS[req.body?.platform] ? req.body.platform : 'yemeksepeti';
    const out = ingestOrder(db, sampleOrder(db, platform));
    res.status(201).json({ ...out, ticket: loadTicket(db, out.ticket_id) });
  }));

  r.post('/platforms/flush', allow(...MANAGERS), h(async (req, res) => {
    res.json(await flushPlatformEvents(db));
  }));

  return r;
}
