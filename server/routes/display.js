// Müşteri ekranı: kasadaki sepet müşteriye dönük ikinci bir ekranda (tablet, telefon, ikinci monitör) görünür.
// Kasa her değişiklikte sepeti gönderir (PUT), ekran kısa aralıklarla sorar (GET). Durum bellekte tutulur:
// kalıcı veri değildir, sunucu yeniden başlarsa ekran boş başlar.
import { Router } from 'express';
import { bad, h, int, num, str } from '../util.js';

const MAX_LINES = 200;
const STALE_MS = 6 * 60 * 60 * 1000; // 6 saattir dokunulmamış kasa listeden düşer

/** Gelen durumu doğrula ve küçült (ekranda gösterilecek kadarı). */
export function cleanDisplayState(body = {}) {
  const mode = ['idle', 'cart', 'paid'].includes(body.mode) ? body.mode : 'idle';
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_LINES).map((l) => ({
    name: String(str(l.name) || '').slice(0, 80),
    qty: num(l.qty) || 0,
    unit: String(str(l.unit) || '').slice(0, 8),
    unit_price: int(l.unit_price) || 0,
    total: int(l.total) || 0,
    promo: String(str(l.promo) || '').slice(0, 60),
  }));
  return {
    mode,
    lines: mode === 'idle' ? [] : lines,
    subtotal: int(body.subtotal) || 0,
    discount: int(body.discount) || 0,
    savings: int(body.savings) || 0,
    total: int(body.total) || 0,
    paid: int(body.paid) || 0,
    change: int(body.change) || 0,
    customer: String(str(body.customer) || '').slice(0, 60),
    message: String(str(body.message) || '').slice(0, 120),
  };
}

export default function displayRoutes() {
  const r = Router();
  const screens = new Map(); // kasa adı → { state, seq, updated_at }
  let seq = 0;
  const prune = () => { const now = Date.now(); for (const [k, v] of screens) if (now - v.updated_at > STALE_MS) screens.delete(k); };

  /** Yayın yapan kasalar (ekranda kasa seçmek için) */
  r.get('/display', h((req, res) => {
    prune();
    res.json([...screens.entries()].map(([register, v]) => ({ register, mode: v.state.mode, updated_at: new Date(v.updated_at).toISOString() })));
  }));

  /** Ekran sorar. ?since=<seq>: değişiklik yoksa { seq, unchanged: true } */
  r.get('/display/:register', h((req, res) => {
    const s = screens.get(req.params.register);
    if (!s) return res.json({ register: req.params.register, seq: 0, state: cleanDisplayState() });
    if (int(req.query.since) === s.seq) return res.json({ register: req.params.register, seq: s.seq, unchanged: true });
    res.json({ register: req.params.register, seq: s.seq, state: s.state, updated_at: new Date(s.updated_at).toISOString() });
  }));

  /** Kasa gönderir */
  r.put('/display/:register', h((req, res) => {
    const register = String(req.params.register || '').slice(0, 60);
    if (!register) throw bad('Kasa adı gerekli');
    seq += 1;
    screens.set(register, { state: cleanDisplayState(req.body), seq, updated_at: Date.now() });
    res.json({ seq });
  }));

  return r;
}
