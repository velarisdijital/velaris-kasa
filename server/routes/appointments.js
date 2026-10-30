import { Router } from 'express';
import { emitEvent } from '../db.js';
import { bad, h, int, notFound, str } from '../util.js';

const SELECT = `SELECT a.*, COALESCE(c.name, a.customer_name) AS customer_display, COALESCE(c.phone, a.phone) AS phone_display,
    c.crm_id AS customer_crm_id, u.name AS staff_name, u.color AS staff_color, p.name AS service_name, p.sell_price AS service_price
  FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.staff_id
  LEFT JOIN products p ON p.id = a.service_id`;

const toMin = (s) => {
  const [d, t] = s.split(' ');
  const [hh, mm] = t.split(':').map(Number);
  return Date.parse(`${d}T00:00:00Z`) / 60000 + hh * 60 + mm;
};

const payload = (a) => ({
  id: a.id, crm_id: a.crm_id, start_at: a.start_at, duration_min: a.duration_min, status: a.status, note: a.note,
  customer: { id: a.customer_id, crm_id: a.customer_crm_id, name: a.customer_display, phone: a.phone_display },
  staff: a.staff_id ? { id: a.staff_id, name: a.staff_name } : null,
  service: a.service_id ? { id: a.service_id, name: a.service_name, price: a.service_price } : null,
  sale_id: a.sale_id,
});

export default function appointmentRoutes(db) {
  const r = Router();
  const get = (id) => db.prepare(`${SELECT} WHERE a.id = ?`).get(id);

  function normalize(body, existing = {}) {
    const b = { ...existing, ...body };
    const start_at = str(b.start_at)?.replace('T', ' ').slice(0, 16);
    if (!start_at || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start_at)) throw bad('Randevu tarihi/saati geçersiz');
    const a = {
      customer_id: b.customer_id ? int(b.customer_id) : null,
      customer_name: str(b.customer_name),
      phone: str(b.phone),
      staff_id: b.staff_id ? int(b.staff_id) : null,
      service_id: b.service_id ? int(b.service_id) : null,
      start_at,
      duration_min: int(b.duration_min, 30) || 30,
      note: str(b.note),
      crm_id: str(b.crm_id),
    };
    if (!a.customer_id && !a.customer_name) throw bad('Müşteri seçin veya ad girin');
    return a;
  }

  function conflict(a, ignoreId) {
    if (!a.staff_id) return null;
    const day = a.start_at.slice(0, 10);
    const others = db.prepare(`${SELECT} WHERE a.staff_id = ? AND a.start_at LIKE ? AND a.status IN ('scheduled','done') AND a.id != ?`)
      .all(a.staff_id, `${day}%`, ignoreId || 0);
    const s = toMin(a.start_at);
    const e = s + a.duration_min;
    return others.find((o) => {
      const os = toMin(o.start_at);
      return s < os + o.duration_min && os < e;
    });
  }

  r.get('/appointments', h((req, res) => {
    const where = [];
    const params = {};
    if (req.query.date) { where.push('a.start_at LIKE @day'); params.day = `${req.query.date}%`; }
    if (req.query.from) { where.push('a.start_at >= @from'); params.from = req.query.from; }
    if (req.query.to) { where.push('a.start_at <= @to'); params.to = `${req.query.to} 23:59`; }
    if (req.query.staff_id) { where.push('a.staff_id = @staff'); params.staff = int(req.query.staff_id); }
    if (req.query.customer_id) { where.push('a.customer_id = @cid'); params.cid = int(req.query.customer_id); }
    res.json(db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.start_at LIMIT 1000`).all(params));
  }));

  r.post('/appointments', h((req, res) => {
    const a = normalize(req.body);
    const c = conflict(a);
    if (c && !req.body.force) return res.status(409).json({ error: `${c.staff_name} için ${c.start_at.slice(11)} saatinde randevu var`, conflict: c });
    const id = db.transaction(() => {
      const id = db.prepare(`INSERT INTO appointments (customer_id, customer_name, phone, staff_id, service_id, start_at, duration_min, note, crm_id)
        VALUES (@customer_id, @customer_name, @phone, @staff_id, @service_id, @start_at, @duration_min, @note, @crm_id)`).run(a).lastInsertRowid;
      emitEvent(db, 'appointment.created', payload(get(id)));
      return id;
    })();
    res.status(201).json(get(id));
  }));

  r.put('/appointments/:id', h((req, res) => {
    const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound();
    const a = normalize(req.body, existing);
    const c = conflict(a, existing.id);
    if (c && !req.body.force) return res.status(409).json({ error: `${c.staff_name} için ${c.start_at.slice(11)} saatinde randevu var`, conflict: c });
    db.transaction(() => {
      db.prepare(`UPDATE appointments SET customer_id=@customer_id, customer_name=@customer_name, phone=@phone, staff_id=@staff_id,
        service_id=@service_id, start_at=@start_at, duration_min=@duration_min, note=@note, crm_id=@crm_id WHERE id=@id`)
        .run({ ...a, id: existing.id });
      emitEvent(db, 'appointment.updated', payload(get(existing.id)));
    })();
    res.json(get(existing.id));
  }));

  r.post('/appointments/:id/status', h((req, res) => {
    const a = get(req.params.id);
    if (!a) throw notFound();
    if (!['scheduled', 'done', 'cancelled', 'no_show'].includes(req.body.status)) throw bad('Geçersiz durum');
    db.transaction(() => {
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(req.body.status, a.id);
      emitEvent(db, 'appointment.updated', payload(get(a.id)));
    })();
    res.json(get(a.id));
  }));

  return r;
}
