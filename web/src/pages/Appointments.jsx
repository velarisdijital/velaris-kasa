import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put } from '../api.js';
import { Field, Modal, useLoad, useToast } from '../components/ui.jsx';
import { money, today } from '../format.js';
import { CustomerPicker } from './Pos.jsx';

const START = 8;
const END = 22;
const SLOT = 30; // dakika
const SLOT_H = 48; // px
const STATUS = { scheduled: 'Bekliyor', done: 'Tamamlandı', cancelled: 'İptal', no_show: 'Gelmedi' };

const addDays = (s, n) => {
  const d = new Date(`${s}T12:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
};
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function Appointments() {
  const [day, setDay] = useState(today());
  const [modal, setModal] = useState(null);
  const appts = useLoad(() => get(`/appointments?date=${day}`), [day]);
  const users = useLoad(() => get('/users'));
  const services = useLoad(() => get('/products?type=service'));
  const staff = (users.data || []).filter((u) => u.active);
  const slots = Array.from({ length: ((END - START) * 60) / SLOT }, (_, i) => START * 60 + i * SLOT);
  const cols = staff.length ? staff : [{ id: null, name: 'Randevular' }];
  const label = new Date(`${day}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Randevular</h1>
        <div className="row">
          <button className="btn small" onClick={() => setDay(addDays(day, -1))} aria-label="Önceki gün">‹</button>
          <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 160 }} />
          <button className="btn small" onClick={() => setDay(addDays(day, 1))} aria-label="Sonraki gün">›</button>
          <button className="btn small" onClick={() => setDay(today())}>Bugün</button>
        </div>
        <strong style={{ textTransform: 'capitalize' }}>{label}</strong>
        <div className="grow" />
        <button className="btn primary" onClick={() => setModal({ start: `${day} ${fromMin(Math.max(START * 60, Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / SLOT) * SLOT))}` })}>Yeni randevu</button>
      </div>
      <div className="cal" style={{ gridTemplateColumns: `60px repeat(${cols.length}, minmax(140px, 1fr))`, maxHeight: 'calc(100vh - 140px)' }}>
        <div className="cal-col-head" style={{ borderLeft: 0 }} />
        {cols.map((s) => <div key={s.id ?? 'x'} className="cal-col-head" style={{ borderTop: `3px solid ${s.color || 'var(--primary)'}` }}>{s.name}</div>)}
        {slots.map((m) => (
          <Row key={m} m={m} cols={cols} day={day} appts={appts.data || []} onNew={(staffId) => setModal({ start: `${day} ${fromMin(m)}`, staff_id: staffId })} onOpen={(a) => setModal({ appt: a })} />
        ))}
      </div>
      {modal && <ApptModal init={modal} staff={staff} services={services.data || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); appts.reload(); }} />}
    </div>
  );
}

function Row({ m, cols, appts, onNew, onOpen }) {
  return (
    <>
      <div className="cal-time">{m % 60 === 0 ? fromMin(m) : ''}</div>
      {cols.map((s) => {
        const here = appts.filter((a) => (s.id == null || a.staff_id === s.id || (!a.staff_id && s === cols[0]))
          && toMin(a.start_at.slice(11)) >= m && toMin(a.start_at.slice(11)) < m + SLOT);
        return (
          <div key={s.id ?? 'x'} className="cal-cell" onClick={() => onNew(s.id)}>
            {here.map((a) => (
              <div key={a.id} className={`appt ${a.status}`} onClick={(e) => { e.stopPropagation(); onOpen(a); }}
                style={{ background: a.staff_color || 'var(--primary)', top: ((toMin(a.start_at.slice(11)) - m) / SLOT) * SLOT_H + 2, height: Math.max(22, (a.duration_min / SLOT) * SLOT_H - 4) }}>
                <b>{a.start_at.slice(11)}</b> {a.customer_display}
                <div style={{ opacity: 0.9 }}>{a.service_name}</div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function ApptModal({ init, staff, services, onClose, onSaved }) {
  const toast = useToast();
  const navigate = useNavigate();
  const a = init.appt;
  const [f, setF] = useState({
    customer: a?.customer_id ? { id: a.customer_id, name: a.customer_display } : null,
    customer_name: a && !a.customer_id ? a.customer_display || '' : '',
    phone: a && !a.customer_id ? a.phone_display || '' : '',
    staff_id: a?.staff_id ?? init.staff_id ?? '',
    service_id: a?.service_id ?? '',
    date: (a?.start_at || init.start).slice(0, 10),
    time: (a?.start_at || init.start).slice(11, 16),
    duration_min: a?.duration_min ?? 30,
    note: a?.note || '',
  });
  const [picking, setPicking] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e, force = false) => {
    e?.preventDefault();
    const body = {
      customer_id: f.customer?.id ?? null, customer_name: f.customer ? null : f.customer_name, phone: f.customer ? null : f.phone,
      staff_id: f.staff_id || null, service_id: f.service_id || null, start_at: `${f.date} ${f.time}`, duration_min: Number(f.duration_min), note: f.note, force,
    };
    try {
      if (a) await put(`/appointments/${a.id}`, body); else await post('/appointments', body);
      toast.ok('Randevu kaydedildi');
      onSaved();
    } catch (err) {
      if (err.status === 409 && confirm(`${err.message}. Yine de kaydedilsin mi?`)) return save(null, true);
      toast.err(err);
    }
  };
  const setStatus = async (status) => {
    try { await post(`/appointments/${a.id}/status`, { status }); onSaved(); } catch (err) { toast.err(err); }
  };

  return (
    <Modal title={a ? 'Randevu' : 'Yeni randevu'} onClose={onClose}
      footer={<>
        {a && a.status === 'scheduled' && <>
          <button className="btn" onClick={() => setStatus('cancelled')}>İptal et</button>
          <button className="btn" onClick={() => setStatus('no_show')}>Gelmedi</button>
          <button className="btn success" onClick={() => navigate('/kasa', { state: { appointment: a } })}>Kasaya aktar</button>
        </>}
        {a && a.status !== 'scheduled' && <><span className="badge">{STATUS[a.status]}</span><button className="btn" onClick={() => setStatus('scheduled')}>Bekliyor yap</button></>}
        <div style={{ flex: 1 }} />
        <button className="btn primary" form="af">Kaydet</button>
      </>}>
      <form id="af" className="stack" onSubmit={save}>
        <div className="field">
          <span>Müşteri</span>
          {f.customer ? (
            <div className="row"><strong style={{ flex: 1 }}>{f.customer.name}</strong><button type="button" className="btn small" onClick={() => setF({ ...f, customer: null })}>Değiştir</button></div>
          ) : (
            <div className="row">
              <input className="input" placeholder="Ad (kayıtsız müşteri)" value={f.customer_name} onChange={set('customer_name')} />
              <input className="input" placeholder="Telefon" value={f.phone} onChange={set('phone')} />
              <button type="button" className="btn" onClick={() => setPicking(true)}>Kayıtlı seç</button>
            </div>
          )}
        </div>
        <div className="grid-2">
          <Field label="Hizmet">
            <select className="input" value={f.service_id} onChange={(e) => {
              const sv = services.find((s) => s.id === Number(e.target.value));
              setF({ ...f, service_id: e.target.value, duration_min: sv?.duration_min || f.duration_min });
            }}>
              <option value="">—</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({money(s.sell_price)})</option>)}
            </select>
          </Field>
          <Field label="Personel">
            <select className="input" value={f.staff_id} onChange={set('staff_id')}>
              <option value="">—</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Tarih"><input type="date" className="input" required value={f.date} onChange={set('date')} /></Field>
          <Field label="Saat"><input type="time" className="input" required step="300" value={f.time} onChange={set('time')} /></Field>
          <Field label="Süre (dk)"><input className="input" inputMode="numeric" value={f.duration_min} onChange={set('duration_min')} /></Field>
        </div>
        <Field label="Not"><input className="input" value={f.note} onChange={set('note')} /></Field>
      </form>
      {picking && <CustomerPicker onClose={() => setPicking(false)} onPick={(c) => { setF({ ...f, customer: c }); setPicking(false); }} />}
    </Modal>
  );
}
