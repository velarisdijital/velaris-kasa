// Kampanya yönetimi: liste herkese açık (kasa ekranı sepette gösterir), ekleme / düzenleme yönetici ve müdürde.
import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { PROMO_TYPES } from '../promotions.js';
import { bad, h, int, notFound, num, str } from '../util.js';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function clean(db, b) {
  const type = str(b.type);
  if (!PROMO_TYPES[type]) throw bad('Kampanya türü seçin');
  const name = str(b.name);
  if (!name) throw bad('Kampanya adı gerekli');
  const scope = ['all', 'product', 'category'].includes(b.scope) ? b.scope : 'all';
  const f = {
    name, type, scope,
    product_id: scope === 'product' ? int(b.product_id) || null : null,
    category_id: scope === 'category' ? int(b.category_id) || null : null,
    buy_qty: type === 'bxgy' ? int(b.buy_qty) : null,
    pay_qty: type === 'bxgy' ? int(b.pay_qty) : null,
    nth: type === 'nth' ? int(b.nth) : null,
    percent: ['nth', 'percent', 'basket'].includes(type) && b.percent !== '' && b.percent != null ? num(b.percent) : null,
    amount: type === 'basket' && b.amount ? int(b.amount) : null,
    min_total: type === 'basket' ? int(b.min_total) : null,
    days: Array.isArray(b.days) ? b.days.map(Number).filter((d) => d >= 1 && d <= 7).join(',') || null : str(b.days) || null,
    time_from: HM.test(b.time_from || '') ? b.time_from : null,
    time_to: HM.test(b.time_to || '') ? b.time_to : null,
    date_from: DAY.test(b.date_from || '') ? b.date_from : null,
    date_to: DAY.test(b.date_to || '') ? b.date_to : null,
    active: b.active === undefined ? 1 : b.active ? 1 : 0,
  };
  if (scope === 'product' && !f.product_id) throw bad('Kampanyanın ürününü seçin');
  if (scope === 'category' && !f.category_id) throw bad('Kampanyanın kategorisini seçin');
  if (type === 'bxgy' && !(f.buy_qty >= 2 && f.pay_qty >= 1 && f.pay_qty < f.buy_qty)) throw bad('"X al Y öde": X en az 2, Y en az 1 ve X\'ten küçük olmalı (ör. 3 al 2 öde)');
  if (type === 'nth' && !(f.nth >= 2 && f.percent > 0 && f.percent <= 100)) throw bad('"N. ürüne indirim": N en az 2, indirim %1–100 (ör. 2. ürüne %50)');
  if (type === 'percent' && !(f.percent > 0 && f.percent <= 100)) throw bad('İndirim oranı %1–100 olmalı');
  if (type === 'basket' && !(f.min_total > 0) ) throw bad('Sepet alt sınırını yazın (ör. 500 ₺)');
  if (type === 'basket' && !(f.amount > 0) && !(f.percent > 0 && f.percent <= 100)) throw bad('Sepet indirimi için yüzde ya da tutar yazın');
  if ((f.time_from && !f.time_to) || (!f.time_from && f.time_to)) throw bad('Saat aralığının başlangıcını ve bitişini yazın');
  if (f.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(f.product_id)) throw bad('Ürün bulunamadı');
  if (f.category_id && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(f.category_id)) throw bad('Kategori bulunamadı');
  return f;
}

export default function promotionRoutes(db) {
  const r = Router();
  const one = (id) => db.prepare(`SELECT p.*, pr.name AS product_name, c.name AS category_name FROM promotions p
    LEFT JOIN products pr ON pr.id = p.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(id);

  r.get('/promotions', h((req, res) => {
    res.json(db.prepare(`SELECT p.*, pr.name AS product_name, c.name AS category_name,
        (SELECT COUNT(*) FROM sale_items i WHERE i.promo_name = p.name) AS used_count
      FROM promotions p LEFT JOIN products pr ON pr.id = p.product_id LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.active DESC, p.id DESC`).all());
  }));
  r.post('/promotions', allow(...MANAGERS), h((req, res) => {
    const f = clean(db, req.body || {});
    const cols = Object.keys(f);
    const id = db.prepare(`INSERT INTO promotions (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(f).lastInsertRowid;
    res.status(201).json(one(id));
  }));
  r.put('/promotions/:id', allow(...MANAGERS), h((req, res) => {
    const cur = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!cur) throw notFound();
    const f = clean(db, { ...cur, days: cur.days, ...req.body });
    db.prepare(`UPDATE promotions SET ${Object.keys(f).map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id: cur.id });
    res.json(one(cur.id));
  }));
  r.delete('/promotions/:id', allow(...MANAGERS), h((req, res) => {
    db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  }));
  return r;
}
