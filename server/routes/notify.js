import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { getSettings } from '../db.js';
import { requireFeature } from '../license.js';
import { notifyEnabled, NOTIFY_PROVIDERS, render, sendAppointmentReminder, sendMessage } from '../notify.js';
import { bad, h, int, notFound, str } from '../util.js';

const money = (k) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;

export default function notifyRoutes(db) {
  const r = Router();
  const requireProvider = () => {
    requireFeature(db, 'sms');
    if (!notifyEnabled(db)) throw bad('SMS/WhatsApp kapalı (Ayarlar → SMS & WhatsApp)');
  };

  r.get('/notifications', allow(...MANAGERS), h((req, res) => {
    res.json({
      providers: NOTIFY_PROVIDERS,
      counts: Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM notifications GROUP BY status').all().map((x) => [x.status, x.n])),
      rows: db.prepare(`SELECT n.*, c.name AS customer_name FROM notifications n LEFT JOIN customers c ON c.id = n.customer_id
        ORDER BY n.id DESC LIMIT ?`).all(Math.min(int(req.query.limit, 100) || 100, 1000)),
    });
  }));

  r.post('/notify/test', allow(), h(async (req, res) => {
    requireProvider();
    const msg = await sendMessage(db, { phone: req.body.phone, kind: 'test', body: str(req.body.message) || `${getSettings(db).business_name}: VelarisKasa deneme mesajı.` });
    if (msg.status !== 'sent') throw bad(msg.error || 'Gönderilemedi');
    res.json(msg);
  }));

  /** Müşteriye güncel veresiye borcunu bildirir (bilgilendirme mesajı). */
  r.post('/customers/:id/notify-balance', h(async (req, res) => {
    requireProvider();
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw notFound();
    if (c.balance <= 0) throw bad('Müşterinin borcu yok');
    const s = getSettings(db);
    const msg = await sendMessage(db, {
      phone: c.phone, kind: 'balance', customerId: c.id,
      body: render(s.balance_template, { ad: c.name.split(' ')[0], borc: money(c.balance), isletme: s.business_name }),
    });
    if (msg.status === 'skipped' || msg.status === 'failed') throw bad(msg.error || 'Gönderilemedi');
    res.json({ ...msg, message: msg.status === 'sent' ? 'Borç bildirimi gönderildi' : 'Mesaj sıraya alındı' });
  }));

  r.post('/appointments/:id/remind', h(async (req, res) => {
    requireProvider();
    const msg = await sendAppointmentReminder(db, req.params.id);
    if (!msg) throw notFound();
    if (msg.status === 'skipped' || msg.status === 'failed') throw bad(msg.error || 'Gönderilemedi');
    res.json(msg);
  }));

  /**
   * Kampanya mesajı: yalnızca ticari ileti (SMS) onayı olan müşterilere gider.
   * audience: all | debtors | inactive (60 gündür gelmeyen) | dry=1 ile yalnızca sayı döner.
   */
  r.post('/notify/campaign', allow(...MANAGERS), h(async (req, res) => {
    requireFeature(db, 'campaign');
    const message = str(req.body.message);
    if (!message) throw bad('Mesaj metni gerekli');
    if (message.length > 600) throw bad('Mesaj en fazla 600 karakter olabilir');
    const where = ["c.active = 1", "c.sms_consent = 1", "c.phone IS NOT NULL"];
    if (req.body.audience === 'debtors') where.push('c.balance > 0');
    if (req.body.audience === 'inactive') {
      where.push("COALESCE((SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id), c.created_at) < datetime('now','localtime','-60 days')");
    }
    const list = db.prepare(`SELECT c.id, c.name, c.phone FROM customers c WHERE ${where.join(' AND ')}`).all();
    if (req.body.dry) return res.json({ count: list.length });
    requireProvider();
    const s = getSettings(db);
    let sent = 0, failed = 0;
    for (const c of list) {
      const m = await sendMessage(db, { phone: c.phone, kind: 'marketing', customerId: c.id,
        body: render(message, { ad: c.name.split(' ')[0], isletme: s.business_name }) });
      if (m.status === 'sent') sent++; else failed++;
    }
    res.json({ count: list.length, sent, failed });
  }));

  return r;
}
