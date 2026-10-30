import crypto from 'node:crypto';
import { hasFeature } from './license.js';

export function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifySecret(secret, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(secret), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

export function createApiKey(db, name) {
  const key = `vk_${crypto.randomBytes(24).toString('hex')}`;
  const info = db.prepare('INSERT INTO api_keys (name, prefix, key_hash) VALUES (?, ?, ?)').run(name, key.slice(0, 10), sha256(key));
  return { id: info.lastInsertRowid, key };
}

/**
 * Oturum token'ı (kasiyer/yönetici) ya da API anahtarı (Velaris CRM vb.) ile kimlik doğrular.
 * API anahtarıyla gelen istekler "integration" rolündedir.
 */
export function authenticate(db) {
  const touchSession = db.prepare("UPDATE sessions SET last_seen = datetime('now','localtime') WHERE token = ?");
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const apiKey = req.get('x-api-key') || (bearer?.startsWith('vk_') ? bearer : null);

    if (apiKey) {
      const row = db.prepare('SELECT id, name FROM api_keys WHERE key_hash = ?').get(sha256(apiKey));
      if (!row) return res.status(401).json({ error: 'Geçersiz API anahtarı' });
      if (!hasFeature(db, 'api')) return res.status(402).json({ error: 'API erişimi Pro paketinde', code: 'PLAN_REQUIRED' });
      db.prepare("UPDATE api_keys SET last_used = datetime('now','localtime') WHERE id = ?").run(row.id);
      req.user = { id: null, name: `API: ${row.name}`, role: 'integration' };
      return next();
    }

    if (bearer) {
      const user = db.prepare(`
        SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND u.active = 1`).get(bearer);
      if (user) {
        touchSession.run(bearer);
        req.user = user;
        req.token = bearer;
        return next();
      }
    }
    res.status(401).json({ error: 'Oturum gerekli' });
  };
}

/** admin her zaman geçer. */
export const allow = (...roles) => (req, res, next) => {
  if (req.user?.role === 'admin' || roles.includes(req.user?.role)) return next();
  res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
};

export const MANAGERS = ['manager', 'integration'];
