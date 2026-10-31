import { Router } from 'express';
import { createSession, hashSecret, verifySecret } from '../auth.js';
import { getSetting, setSettings } from '../db.js';
import { BUSINESS_TYPES, seedPreset } from '../presets.js';
import { bad, h, str } from '../util.js';

// Basit kaba kuvvet koruması: kullanıcı başına 5 hatalı PIN -> 30 sn kilit
const failures = new Map();

export function publicRoutes(db) {
  const r = Router();

  r.get('/setup/status', h((req, res) => {
    res.json({
      setup_done: getSetting(db, 'setup_done') === '1',
      business_name: getSetting(db, 'business_name'),
      business_type: getSetting(db, 'business_type'),
      business_types: BUSINESS_TYPES,
      users: db.prepare('SELECT id, name, role, color FROM users WHERE active = 1 ORDER BY id').all(),
    });
  }));

  r.post('/setup', h((req, res) => {
    if (getSetting(db, 'setup_done') === '1') throw bad('Kurulum zaten tamamlanmış');
    const { business_name, business_type, admin_name, admin_pin, seed_samples } = req.body || {};
    if (!str(business_name)) throw bad('İşletme adı gerekli');
    if (!BUSINESS_TYPES[business_type]) throw bad('Geçersiz işletme türü');
    if (!str(admin_name)) throw bad('Yönetici adı gerekli');
    if (!/^\d{4,8}$/.test(String(admin_pin || ''))) throw bad('PIN 4-8 haneli rakam olmalı');

    const result = db.transaction(() => {
      setSettings(db, {
        business_name: str(business_name),
        business_type,
        business_phone: str(req.body.business_phone) || '',
        business_address: str(req.body.business_address) || '',
        modules_appointments: BUSINESS_TYPES[business_type].appointments ? '1' : '0',
        modules_tables: BUSINESS_TYPES[business_type].tables ? '1' : '0',
        setup_done: '1',
      });
      const userId = db.prepare("INSERT INTO users (name, pin_hash, role, color) VALUES (?, ?, 'admin', '#7B5CFF')")
        .run(str(admin_name), hashSecret(admin_pin)).lastInsertRowid;
      if (seed_samples) seedPreset(db, business_type);
      if (BUSINESS_TYPES[business_type].tables) {
        const ins = db.prepare('INSERT INTO dining_tables (name, zone, sort_order) VALUES (?, ?, ?)');
        for (let i = 1; i <= 8; i++) ins.run(`Masa ${i}`, i <= 6 ? 'Salon' : 'Bahçe', i);
      }
      return userId;
    })();

    const token = createSession(db, result);
    res.json({ token, user: db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(result) });
  }));

  r.post('/auth/login', h((req, res) => {
    const userId = Number(req.body?.user_id);
    const pin = String(req.body?.pin ?? '');
    const f = failures.get(userId);
    if (f && f.count >= 5 && Date.now() - f.at < 30_000) {
      return res.status(429).json({ error: 'Çok fazla hatalı deneme. 30 saniye bekleyin.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
    if (!user || !verifySecret(pin, user.pin_hash)) {
      const cur = failures.get(userId);
      failures.set(userId, { count: (cur && Date.now() - cur.at < 30_000 ? cur.count : 0) + 1, at: Date.now() });
      return res.status(401).json({ error: 'Hatalı PIN' });
    }
    failures.delete(userId);
    const token = createSession(db, user.id);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  }));

  return r;
}

export function sessionRoutes(db) {
  const r = Router();
  r.get('/auth/me', (req, res) => res.json({ user: req.user }));
  r.post('/auth/logout', (req, res) => {
    if (req.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });
  return r;
}
