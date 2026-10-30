// Herkese açık online randevu sayfası (/#/randevu-al) ve randevu yönetimi (/#/r/:token).
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { money } from '../format.js';

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const fmtDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

function Shell({ business, children }) {
  return (
    <div className="booking">
      <header className="booking-head">
        <h1>{business?.name || 'Online randevu'}</h1>
        {business && <div className="muted small-text">{[business.address, business.phone].filter(Boolean).join(' · ')}</div>}
      </header>
      <main className="booking-body">{children}</main>
      <footer className="muted small-text booking-foot">Velaris Kasa ile online randevu</footer>
    </div>
  );
}

export function BookingPage() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [service, setService] = useState(null);
  const [staff, setStaff] = useState('any');
  const [date, setDate] = useState(null);
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', note: '', sms_consent: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { get('/public/booking').then(setInfo, (e) => setError(e.message)); }, []);

  const days = useMemo(() => {
    if (!info) return [];
    return Array.from({ length: info.days_ahead + 1 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      return { iso: d.toLocaleDateString('sv-SE'), label: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : DAYS[d.getDay()], day: d.getDate(), closed: info.closed_days.includes(d.getDay()) };
    });
  }, [info]);

  useEffect(() => {
    if (!service || !date) return;
    setSlots(null); setTime(null);
    get(`/public/booking/slots?date=${date}&service_id=${service.id}${staff !== 'any' ? `&staff_id=${staff}` : ''}`).then(setSlots, (e) => setError(e.message));
  }, [service, staff, date]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      setDone(await post('/public/booking', { service_id: service.id, staff_id: staff === 'any' ? null : staff, date, time, ...form }));
    } catch (err) {
      setError(err.message);
      if (err.status === 409) { setTime(null); setSlots(await get(`/public/booking/slots?date=${date}&service_id=${service.id}${staff !== 'any' ? `&staff_id=${staff}` : ''}`).catch(() => [])); }
    } finally { setBusy(false); }
  };

  if (!info) return <Shell><div className={error ? 'card card-pad danger-text' : 'muted'}>{error || 'Yükleniyor…'}</div></Shell>;

  if (done) {
    return (
      <Shell business={info.business}>
        <div className="card card-pad stack booking-done">
          <div className="booking-check" aria-hidden="true">✓</div>
          <h2>Randevunuz alındı</h2>
          <div><b>{fmtDay(done.start_at.slice(0, 10))}</b>, saat <b>{done.start_at.slice(11, 16)}</b></div>
          <div className="muted">{done.service}{done.staff ? ` · ${done.staff}` : ''}</div>
          <a className="btn" href={`#/r/${done.token}`}>Randevumu görüntüle / iptal et</a>
          <small className="muted">Bu bağlantıyı saklayın; randevunuzu buradan iptal edebilirsiniz.</small>
        </div>
      </Shell>
    );
  }

  return (
    <Shell business={info.business}>
      {info.note && <div className="card card-pad small-text">{info.note}</div>}
      {error && <div className="card card-pad danger-text" role="alert">{error}</div>}

      <section className="stack">
        <h2>1. Hizmet</h2>
        <div className="booking-grid">
          {info.services.map((s) => (
            <button key={s.id} className={`booking-option ${service?.id === s.id ? 'on' : ''}`} onClick={() => setService(s)}>
              <strong>{s.name}</strong>
              <span className="muted small-text">{s.duration_min} dk{s.price ? ` · ${money(s.price)}` : ''}</span>
            </button>
          ))}
        </div>
        {!info.services.length && <div className="muted">Henüz online randevuya açık hizmet yok.</div>}
      </section>

      {service && info.staff.length > 1 && (
        <section className="stack">
          <h2>2. Personel</h2>
          <div className="tabs">
            <button className={`tab ${staff === 'any' ? 'active' : ''}`} onClick={() => setStaff('any')}>Fark etmez</button>
            {info.staff.map((p) => <button key={p.id} className={`tab ${staff === p.id ? 'active' : ''}`} onClick={() => setStaff(p.id)}>{p.name}</button>)}
          </div>
        </section>
      )}

      {service && (
        <section className="stack">
          <h2>{info.staff.length > 1 ? '3' : '2'}. Gün</h2>
          <div className="booking-days">
            {days.map((d) => (
              <button key={d.iso} disabled={d.closed} className={`booking-day ${date === d.iso ? 'on' : ''}`} onClick={() => setDate(d.iso)}>
                <span className="small-text">{d.label}</span><strong>{d.day}</strong>{d.closed && <span className="small-text">Kapalı</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {service && date && (
        <section className="stack">
          <h2>Saat — {fmtDay(date)}</h2>
          {!slots ? <div className="muted">Boş saatler yükleniyor…</div> : !slots.length ? <div className="muted">Bu gün için boş saat kalmadı, başka bir gün seçin.</div> : (
            <div className="booking-times">
              {slots.map((s) => <button key={s.time} className={`booking-time ${time === s.time ? 'on' : ''}`} onClick={() => setTime(s.time)}>{s.time}</button>)}
            </div>
          )}
        </section>
      )}

      {time && (
        <form className="card card-pad stack" onSubmit={submit}>
          <h2>Bilgileriniz</h2>
          <label className="field"><span>Ad Soyad</span><input id="b-name" className="input" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Cep telefonu</span><input id="b-phone" className="input" required inputMode="tel" autoComplete="tel" placeholder="05xx xxx xx xx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field"><span>Not (isteğe bağlı)</span><input id="b-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <label className="check small-text"><input id="b-consent" type="checkbox" checked={form.sms_consent} onChange={(e) => setForm({ ...form, sms_consent: e.target.checked })} /> Kampanya ve fırsatlardan SMS ile haberdar olmak istiyorum (isteğe bağlı)</label>
          <small className="muted">{info.kvkk_text}</small>
          <button className="btn primary big" disabled={busy}>{busy ? 'Kaydediliyor…' : `${fmtDay(date)} ${time} — Randevuyu onayla`}</button>
        </form>
      )}
    </Shell>
  );
}

export function ManageBooking() {
  const { token } = useParams();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { get(`/public/booking/r/${token}`).then(setA, (e) => setError(e.message)); }, [token]);
  const cancel = async () => {
    try { setA({ ...a, ...(await post(`/public/booking/r/${token}/cancel`)) }); setConfirming(false); } catch (e) { setError(e.message); }
  };
  if (!a) return <Shell><div className={error ? 'card card-pad danger-text' : 'muted'}>{error || 'Yükleniyor…'}</div></Shell>;
  return (
    <Shell business={a.business}>
      <div className="card card-pad stack">
        <h2>Randevunuz</h2>
        <div><b>{fmtDay(a.start_at.slice(0, 10))}</b>, saat <b>{a.start_at.slice(11, 16)}</b></div>
        <div className="muted">{a.service_name}{a.staff_name ? ` · ${a.staff_name}` : ''}{a.service_price ? ` · ${money(a.service_price)}` : ''}</div>
        <div>{a.status === 'scheduled' ? <span className="badge green">Onaylı</span> : a.status === 'cancelled' ? <span className="badge red">İptal edildi</span> : <span className="badge">Tamamlandı</span>}</div>
        {error && <div className="danger-text">{error}</div>}
        {a.status === 'scheduled' && !confirming && <button className="btn" onClick={() => setConfirming(true)}>Randevuyu iptal et</button>}
        {confirming && (
          <div className="row wrap">
            <span>Randevu iptal edilsin mi?</span>
            <button className="btn danger" onClick={cancel}>Evet, iptal et</button>
            <button className="btn" onClick={() => setConfirming(false)}>Vazgeç</button>
          </div>
        )}
        <a className="btn ghost" href="#/randevu-al">Yeni randevu al</a>
      </div>
    </Shell>
  );
}
