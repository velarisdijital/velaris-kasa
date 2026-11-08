import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, storage } from '../api.js';
import { Icon, useToast } from '../components/ui.jsx';
import { qty } from '../format.js';

// Mutfak ekranı (KDS): garsonun "Mutfağa" gönderdiği siparişler burada görünür.
// Kart: masa / paket, garson, geçen süre, kalemler. Kaleme dokun → hazırlanıyor → hazır. "Hazır" garsona bildirilir.
const STATIONS = [['all', 'Tümü'], ['mutfak', 'Mutfak'], ['bar', 'Bar']];
const NEXT = { new: 'preparing', preparing: 'ready', ready: 'new' };
const STATUS_LABEL = { new: 'Yeni', preparing: 'Hazırlanıyor', ready: 'Hazır' };

const parse = (s) => new Date(String(s).replace(' ', 'T'));
function elapsed(from, now) {
  const sec = Math.max(0, Math.round((now - parse(from)) / 1000));
  const m = Math.floor(sec / 60);
  return { text: m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m}:${String(sec % 60).padStart(2, '0')}`, min: m };
}

/** Yeni sipariş gelince kısa uyarı sesi */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* ses yok */ }
}

export default function Kitchen() {
  const toast = useToast();
  const [station, setStation] = useState(storage.get('vk_kds_station', 'all'));
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0); // sunucu saati ile cihaz saati farkı
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(storage.get('vk_kds_sound', true));
  const seen = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await get(`/kitchen?station=${station}`);
      setOffset(parse(r.now) - Date.now());
      const ids = new Set(r.tickets.flatMap((t) => t.items.filter((i) => i.kitchen_status === 'new').map((i) => i.id)));
      if (seen.current && sound && [...ids].some((id) => !seen.current.has(id))) beep();
      seen.current = ids;
      setData(r.tickets);
    } catch (e) {
      if (e.status !== 0) toast.err(e);
    }
  }, [station, sound, toast]);

  useEffect(() => { seen.current = null; load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const setStatus = async (body) => {
    try { await post('/kitchen/status', body); load(); } catch (e) { toast.err(e); }
  };
  const chooseStation = (s) => { setStation(s); storage.set('vk_kds_station', s); };
  const toggleSound = () => { setSound(!sound); storage.set('vk_kds_sound', !sound); if (!sound) beep(); };

  const tickets = data || [];
  const cols = [['new', 'Yeni'], ['preparing', 'Hazırlanıyor'], ['ready', 'Hazır']];
  return (
    <div className="page kds">
      <div className="page-head">
        <h1>Mutfak</h1>
        <div className="tabs">
          {STATIONS.map(([k, l]) => <button key={k} className={`tab ${station === k ? 'active' : ''}`} onClick={() => chooseStation(k)}>{l}</button>)}
        </div>
        <div className="grow" />
        <button className="btn small ghost" onClick={toggleSound}>{sound ? 'Ses açık' : 'Ses kapalı'}</button>
      </div>
      {data && !tickets.length && <div className="card card-pad muted" style={{ textAlign: 'center' }}>Bekleyen sipariş yok. Garson "Mutfağa" dediğinde siparişler burada görünür.</div>}
      <div className="kds-cols">
        {cols.map(([st, title]) => {
          const list = tickets.filter((t) => t.status === st);
          return (
            <section key={st} className={`kds-col ${st}`}>
              <h2>{title} <span className="badge">{list.length}</span></h2>
              {list.map((t) => {
                const el = elapsed(t.sent_at, now + offset);
                return (
                  <div key={t.id} className={`kds-card ${st} ${st !== 'ready' && el.min >= 20 ? 'late' : st !== 'ready' && el.min >= 10 ? 'slow' : ''}`} data-ticket={t.label}>
                    <div className="kds-head">
                      <strong>{t.label}</strong>
                      <span className="kds-time">{el.text}</span>
                    </div>
                    <div className="muted small-text">{[t.zone, t.waiter, t.guest_count ? `${t.guest_count} kişi` : null, t.kind === 'delivery' ? 'Paket' : t.kind === 'takeaway' ? 'Gel-al' : null].filter(Boolean).join(' · ')}</div>
                    {t.delivery_note && <div className="kds-note">{t.delivery_note}</div>}
                    <ul className="kds-items">
                      {t.items.map((i) => (
                        <li key={i.id}>
                          <button type="button" className={`kds-item ${i.kitchen_status}`} onClick={() => setStatus({ ids: [i.id], status: NEXT[i.kitchen_status] })} title="Dokun: durumu değiştir">
                            <span className="kds-qty">{qty(i.qty)}×</span>
                            <span className="kds-name">{i.name}{i.note && <em> — {i.note}</em>}</span>
                            <span className="kds-st">{STATUS_LABEL[i.kitchen_status]}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="row" style={{ gap: 6 }}>
                      {st === 'new' && <button className="btn small" onClick={() => setStatus({ ticket_id: t.id, status: 'preparing' })}>Hazırlamaya başla</button>}
                      {st !== 'ready' && <button className="btn small primary" onClick={() => setStatus({ ticket_id: t.id, status: 'ready' })}><Icon name="chef" /> Hepsi hazır</button>}
                      {st === 'ready' && <button className="btn small" onClick={() => setStatus({ ticket_id: t.id, status: 'served' })}>Teslim edildi</button>}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
