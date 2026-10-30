// SMS / WhatsApp bildirimleri.
//
// Sağlayıcılar: log (deneme), netgsm, iletimerkezi, whatsapp (Meta WhatsApp Cloud API).
// Mesajlar notifications tablosuna yazılır, hemen gönderilmeye çalışılır, olmazsa işçi 3 kez yeniden dener.
//
// İYS: randevu hatırlatma, randevu onayı ve borç bildirimi "bilgilendirme" mesajıdır, ticari ileti onayı
// gerekmez (içine kampanya eklenmemeli). Kampanya mesajları yalnızca SMS onayı olan müşterilere gider.

import crypto from 'node:crypto';
import { getSettings } from './db.js';
import { hasFeature } from './license.js';
import { phoneTR } from './util.js';

export const NOTIFY_PROVIDERS = {
  none: 'Kapalı',
  log: 'Deneme (gönderilmez, kayda yazılır)',
  netgsm: 'Netgsm SMS',
  iletimerkezi: 'İleti Merkezi SMS',
  whatsapp: 'WhatsApp Business (Meta Cloud API)',
};

const TIMEOUT_MS = 15_000;

async function request(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Sağlayıcı yanıt vermedi' : e.message);
  } finally {
    clearTimeout(t);
  }
}

const NETGSM_ERRORS = {
  20: 'Mesaj metni hatalı ya da çok uzun', 30: 'Netgsm kullanıcı adı/şifre hatalı veya API izni yok',
  40: 'Mesaj başlığı (gönderici adı) tanımlı değil', 50: 'İYS kontrollü gönderimde hata', 51: 'İYS marka bilgisi bulunamadı',
  70: 'Hatalı istek parametresi', 80: 'Gönderim sınırı aşıldı', 85: 'Aynı numaraya çok sık gönderim',
};

const providers = {
  async log(s, msg) {
    return { ref: `log-${msg.id}` };
  },

  async netgsm(s, msg) {
    if (!s.netgsm_usercode || !s.netgsm_password || !s.netgsm_header) throw new Error('Netgsm bilgileri eksik (Ayarlar → SMS & WhatsApp)');
    const q = new URLSearchParams({
      usercode: s.netgsm_usercode, password: s.netgsm_password, gsmno: msg.to_phone, message: msg.body,
      msgheader: s.netgsm_header, dil: 'TR',
    });
    const r = await request(`https://api.netgsm.com.tr/sms/send/get?${q}`, { method: 'GET' });
    const [code, ref] = r.text.trim().split(/\s+/);
    if (code === '00' || code === '01' || code === '02') return { ref };
    throw new Error(NETGSM_ERRORS[Number(code)] || `Netgsm hatası: ${r.text.slice(0, 100)}`);
  },

  async iletimerkezi(s, msg) {
    if (!s.iletimerkezi_key || !s.iletimerkezi_hash || !s.iletimerkezi_sender) throw new Error('İleti Merkezi bilgileri eksik (Ayarlar → SMS & WhatsApp)');
    const body = {
      request: {
        authentication: { key: s.iletimerkezi_key, hash: s.iletimerkezi_hash },
        order: {
          sender: s.iletimerkezi_sender,
          sendDateTime: [],
          iys: msg.kind === 'marketing' ? '1' : '0',
          iysList: 'BIREYSEL',
          message: { text: msg.body, receipents: { number: [msg.to_phone] } },
        },
      },
    };
    const r = await request('https://api.iletimerkezi.com/v1/send-sms/json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let json = null;
    try { json = JSON.parse(r.text); } catch { /* yok say */ }
    const status = json?.response?.status;
    if (Number(status?.code) === 200) return { ref: String(json.response.order?.id ?? '') };
    throw new Error(`İleti Merkezi: ${status?.message || r.text.slice(0, 100)}`);
  },

  async whatsapp(s, msg) {
    if (!s.whatsapp_token || !s.whatsapp_phone_id) throw new Error('WhatsApp bilgileri eksik (Ayarlar → SMS & WhatsApp)');
    // İşletmenin başlattığı konuşmalar için Meta onaylı şablon gerekir. Şablon gövdesi: {{1}} mesaj metni.
    const payload = s.whatsapp_template && msg.kind !== 'test-text'
      ? { type: 'template', template: { name: s.whatsapp_template, language: { code: 'tr' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: msg.body }] }] } }
      : { type: 'text', text: { body: msg.body } };
    const r = await request(`https://graph.facebook.com/v20.0/${encodeURIComponent(s.whatsapp_phone_id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.whatsapp_token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: msg.to_phone, ...payload }),
    });
    let json = null;
    try { json = JSON.parse(r.text); } catch { /* yok say */ }
    if (r.ok && json?.messages?.[0]?.id) return { ref: json.messages[0].id };
    throw new Error(`WhatsApp: ${json?.error?.message || r.text.slice(0, 120)}`);
  },
};

export const notifyEnabled = (db) => {
  const p = getSettings(db).notify_provider;
  return !!p && p !== 'none' && hasFeature(db, 'sms');
};

/** Şablondaki {alan} yer tutucularını doldurur. */
export function render(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s*[^.!?:]*:\s*$/, '') // değeri boş kalan son "Etiket:" kısmını at (ör. bağlantı yoksa)
    .trim();
}

/**
 * Mesajı kuyruğa ekler ve hemen göndermeyi dener.
 * @returns kayıt (status: sent | failed | skipped)
 */
export async function sendMessage(db, { phone, body, kind, customerId = null, appointmentId = null }) {
  const s = getSettings(db);
  const to = phoneTR(phone);
  const provider = s.notify_provider;
  const channel = provider === 'whatsapp' ? 'whatsapp' : 'sms';
  const id = db.prepare(`INSERT INTO notifications (channel, kind, to_phone, customer_id, appointment_id, body, provider, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(channel, kind, to || String(phone || '-'), customerId, appointmentId, body, provider,
    !to ? 'skipped' : provider === 'none' ? 'skipped' : 'pending',
    !to ? 'Geçerli bir cep telefonu yok' : provider === 'none' ? 'Bildirim sağlayıcısı kapalı' : null).lastInsertRowid;
  if (to && provider !== 'none') await deliver(db, id);
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

async function deliver(db, id) {
  const msg = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  const s = getSettings(db);
  const fn = providers[s.notify_provider];
  if (!fn) return;
  try {
    const r = await fn(s, msg);
    db.prepare("UPDATE notifications SET status = 'sent', provider_ref = ?, error = NULL, attempts = attempts + 1, sent_at = datetime('now','localtime') WHERE id = ?")
      .run(r.ref ?? null, id);
  } catch (e) {
    const attempts = msg.attempts + 1;
    db.prepare('UPDATE notifications SET status = ?, error = ?, attempts = ? WHERE id = ?')
      .run(attempts >= 3 ? 'failed' : 'pending', String(e.message).slice(0, 300), attempts, id);
  }
}

const fmtDate = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

export function appointmentToken(db, apptId) {
  const a = db.prepare('SELECT token FROM appointments WHERE id = ?').get(apptId);
  if (a?.token) return a.token;
  const token = crypto.randomBytes(12).toString('hex');
  db.prepare('UPDATE appointments SET token = ? WHERE id = ?').run(token, apptId);
  return token;
}

/** Randevu yönetim bağlantısı; program internete açık değilse işletme telefonu. */
export function appointmentLink(db, apptId) {
  const s = getSettings(db);
  const base = (s.public_base_url || '').replace(/\/+$/, '');
  return base ? `${base}/#/r/${appointmentToken(db, apptId)}` : s.business_phone || '';
}

export function appointmentVars(db, a) {
  const s = getSettings(db);
  return {
    ad: (a.customer_display || '').split(' ')[0], tarih: fmtDate(a.start_at), saat: a.start_at.slice(11, 16),
    hizmet: a.service_name || '', personel: a.staff_name || '', isletme: s.business_name, link: appointmentLink(db, a.id),
  };
}

const APPT_SELECT = `SELECT a.*, COALESCE(c.name, a.customer_name) AS customer_display, COALESCE(c.phone, a.phone) AS phone_display,
    u.name AS staff_name, p.name AS service_name
  FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.staff_id
  LEFT JOIN products p ON p.id = a.service_id`;

export async function sendAppointmentReminder(db, apptId) {
  const a = db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(apptId);
  if (!a) return null;
  db.prepare("UPDATE appointments SET reminder_sent_at = datetime('now','localtime') WHERE id = ?").run(a.id);
  return sendMessage(db, {
    phone: a.phone_display, kind: 'reminder', customerId: a.customer_id, appointmentId: a.id,
    body: render(getSettings(db).reminder_template, appointmentVars(db, a)),
  });
}

/** Yaklaşan randevular için hatırlatma gönderir (işçi her dakika çağırır). */
export async function runReminders(db) {
  const s = getSettings(db);
  if (s.reminder_enabled !== '1' || !notifyEnabled(db) || !hasFeature(db, 'reminders')) return 0;
  const hours = Math.max(1, Number(s.reminder_hours) || 3);
  const due = db.prepare(`SELECT id FROM appointments WHERE status = 'scheduled' AND reminder_sent_at IS NULL
    AND start_at > strftime('%Y-%m-%d %H:%M', 'now', 'localtime')
    AND start_at <= strftime('%Y-%m-%d %H:%M', 'now', 'localtime', ?)`).all(`+${hours} hours`);
  for (const { id } of due) await sendAppointmentReminder(db, id);
  return due.length;
}

export async function retryPending(db) {
  if (!notifyEnabled(db)) return;
  const rows = db.prepare("SELECT id FROM notifications WHERE status = 'pending' ORDER BY id LIMIT 20").all();
  for (const { id } of rows) await deliver(db, id);
}

export function startNotifyWorker(db, log = console) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runReminders(db);
      await retryPending(db);
    } catch (e) {
      log.warn?.(`[bildirim] ${e.message}`);
    } finally {
      busy = false;
    }
  }, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
