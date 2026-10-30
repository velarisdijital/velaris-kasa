// Herkese açık online randevu (oturum gerektirmez).
// Sayfa: /#/randevu-al  ·  Randevu yönetimi (iptal): /#/r/{token}
import crypto from 'node:crypto';
import { Router } from 'express';
import { emitEvent, getSettings } from '../db.js';
import { appointmentVars, notifyEnabled, render, sendMessage } from '../notify.js';
import { bad, h, int, notFound, phoneTR, str } from '../util.js';

const STEP = 15; // dakika
const LEAD = 30; // bugün için en erken: şimdiden 30 dk sonra
const pad = (n) => String(n).padStart(2, '0');
const toMin = (hhmm) => { const [h2, m] = hhmm.split(':').map(Number); return h2 * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Basit kötüye kullanım koruması: IP başına saatte 10 randevu
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= 10) throw Object.assign(new Error('Çok fazla deneme. Lütfen daha sonra tekrar deneyin.'), { status: 429 });
  list.push(now);
  hits.set(ip, list);
}

export const BOOKING_TEMPLATE_DEFAULT = 'Merhaba {ad}, {tarih} {saat} tarihli {isletme} randevunuz alındı. İptal/değişiklik: {link}';

export default function bookingRoutes(db) {
  const r = Router();

  const config = () => {
    const s = getSettings(db);
    if (s.booking_enabled !== '1') throw Object.assign(new Error('Bu işletme şu an online randevu almıyor'), { status: 403 });
    return s;
  };
  const services = () => db.prepare(`SELECT id, name, sell_price AS price, COALESCE(duration_min, 30) AS duration_min FROM products
    WHERE active = 1 AND type = 'service' ORDER BY name`).all();
  const staff = () => db.prepare("SELECT id, name, color FROM users WHERE active = 1 AND role IN ('admin','manager','staff') ORDER BY name").all();

  /** Seçilen gün için boş saatler. Personel verilmezse herhangi bir personelin boş olduğu saatler. */
  function freeSlots(s, date, duration, staffId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Tarih geçersiz');
    const today = localDate();
    const last = new Date(); last.setDate(last.getDate() + (Number(s.booking_days_ahead) || 14));
    if (date < today || date > localDate(last)) return [];
    const closed = String(s.booking_closed_days || '').split(',').filter(Boolean).map(Number);
    if (closed.includes(new Date(`${date}T12:00`).getDay())) return [];
    const people = staffId ? staff().filter((p) => p.id === staffId) : staff();
    const busy = new Map(people.map((p) => [p.id, []]));
    for (const a of db.prepare(`SELECT staff_id, start_at, duration_min FROM appointments
      WHERE start_at LIKE ? AND status IN ('scheduled','done')`).all(`${date}%`)) {
      const st = toMin(a.start_at.slice(11, 16));
      busy.get(a.staff_id)?.push([st, st + a.duration_min]);
    }
    const now = new Date();
    const earliest = date === today ? now.getHours() * 60 + now.getMinutes() + LEAD : 0;
    const out = [];
    for (let t = toMin(s.booking_open || '09:00'); t + duration <= toMin(s.booking_close || '20:00'); t += STEP) {
      if (t < earliest) continue;
      const free = people.filter((p) => !busy.get(p.id).some(([a, b]) => t < b && a < t + duration)).map((p) => p.id);
      if (free.length) out.push({ time: fromMin(t), staff_ids: free });
    }
    return out;
  }

  r.get('/public/booking', h((req, res) => {
    const s = config();
    res.json({
      business: { name: s.business_name, phone: s.business_phone, address: s.business_address },
      note: s.booking_note, days_ahead: Number(s.booking_days_ahead) || 14,
      closed_days: String(s.booking_closed_days || '').split(',').filter(Boolean).map(Number),
      services: services(), staff: staff(), kvkk_text: s.kvkk_text,
    });
  }));

  r.get('/public/booking/slots', h((req, res) => {
    const s = config();
    const service = services().find((x) => x.id === int(req.query.service_id));
    if (!service) throw bad('Hizmet seçin');
    res.json(freeSlots(s, String(req.query.date || ''), service.duration_min, req.query.staff_id ? int(req.query.staff_id) : null));
  }));

  r.post('/public/booking', h(async (req, res) => {
    const s = config();
    rateLimit(req.ip || req.get('x-forwarded-for') || 'local');
    const b = req.body || {};
    const name = str(b.name);
    const phone = phoneTR(b.phone);
    if (!name || name.length < 2) throw bad('Adınızı yazın');
    if (!phone) throw bad('Geçerli bir cep telefonu yazın (05xx…)');
    const service = services().find((x) => x.id === int(b.service_id));
    if (!service) throw bad('Hizmet seçin');
    const slot = freeSlots(s, String(b.date || ''), service.duration_min, b.staff_id ? int(b.staff_id) : null).find((x) => x.time === b.time);
    if (!slot) throw Object.assign(new Error('Bu saat az önce doldu, lütfen başka bir saat seçin'), { status: 409 });
    const staffId = b.staff_id ? int(b.staff_id) : slot.staff_ids[0];

    const appt = db.transaction(() => {
      // Telefon numarasıyla mevcut müşteriyi bul (kayıtlı numaralar farklı biçimlerde olabilir)
      const last10 = phone.slice(2);
      let customer = db.prepare("SELECT * FROM customers WHERE active = 1 AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') LIKE ?")
        .all(`%${last10}`).find((c) => phoneTR(c.phone) === phone);
      if (!customer) {
        const consent = b.sms_consent ? 1 : 0;
        const id = db.prepare(`INSERT INTO customers (name, phone, sms_consent, consent_at, consent_source)
          VALUES (?, ?, ?, ?, 'online')`).run(name, `0${last10}`, consent, consent ? new Date().toLocaleString('sv-SE').slice(0, 19) : null).lastInsertRowid;
        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      } else if (b.sms_consent && !customer.sms_consent) {
        db.prepare("UPDATE customers SET sms_consent = 1, consent_at = datetime('now','localtime'), consent_source = 'online', iys_exported_at = NULL WHERE id = ?").run(customer.id);
      }
      const token = crypto.randomBytes(12).toString('hex');
      const id = db.prepare(`INSERT INTO appointments (customer_id, staff_id, service_id, start_at, duration_min, note, source, token)
        VALUES (?, ?, ?, ?, ?, ?, 'online', ?)`).run(customer.id, staffId, service.id, `${b.date} ${b.time}`, service.duration_min,
        str(b.note), token).lastInsertRowid;
      const a = db.prepare(`SELECT a.*, c.name AS customer_display, c.phone AS phone_display, c.crm_id AS customer_crm_id, u.name AS staff_name,
          p.name AS service_name, p.sell_price AS service_price FROM appointments a JOIN customers c ON c.id = a.customer_id
          LEFT JOIN users u ON u.id = a.staff_id LEFT JOIN products p ON p.id = a.service_id WHERE a.id = ?`).get(id);
      emitEvent(db, 'appointment.created', {
        id: a.id, start_at: a.start_at, duration_min: a.duration_min, status: a.status, note: a.note, source: 'online',
        customer: { id: a.customer_id, crm_id: a.customer_crm_id, name: a.customer_display, phone: a.phone_display },
        staff: a.staff_id ? { id: a.staff_id, name: a.staff_name } : null,
        service: { id: a.service_id, name: a.service_name, price: a.service_price },
      });
      return a;
    })();

    if (notifyEnabled(db)) {
      await sendMessage(db, { phone, kind: 'booking', customerId: appt.customer_id, appointmentId: appt.id,
        body: render(s.booking_template || BOOKING_TEMPLATE_DEFAULT, appointmentVars(db, appt)) });
    }
    res.status(201).json({ token: appt.token, start_at: appt.start_at, service: appt.service_name, staff: appt.staff_name, business: s.business_name });
  }));

  const byToken = (token) => {
    if (!/^[0-9a-f]{24}$/.test(token)) throw notFound('Randevu bulunamadı');
    const a = db.prepare(`SELECT a.id, a.start_at, a.duration_min, a.status, a.source, COALESCE(c.name, a.customer_name) AS customer_name,
        u.name AS staff_name, p.name AS service_name, p.sell_price AS service_price FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.staff_id LEFT JOIN products p ON p.id = a.service_id
      WHERE a.token = ?`).get(token);
    if (!a) throw notFound('Randevu bulunamadı');
    return a;
  };

  r.get('/public/booking/r/:token', h((req, res) => {
    const s = getSettings(db);
    res.json({ ...byToken(req.params.token), business: { name: s.business_name, phone: s.business_phone, address: s.business_address } });
  }));

  r.post('/public/booking/r/:token/cancel', h((req, res) => {
    const a = byToken(req.params.token);
    if (a.status !== 'scheduled') throw bad('Bu randevu iptal edilemez');
    const now = new Date();
    if (a.start_at <= `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`) throw bad('Geçmiş randevu iptal edilemez');
    db.transaction(() => {
      db.prepare("UPDATE appointments SET status = 'cancelled', note = trim(COALESCE(note,'') || ' (müşteri online iptal etti)') WHERE id = ?").run(a.id);
      emitEvent(db, 'appointment.updated', { id: a.id, start_at: a.start_at, status: 'cancelled', source: 'online' });
    })();
    res.json({ ...byToken(req.params.token) });
  }));

  return r;
}
