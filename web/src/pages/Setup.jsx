import { useState } from 'react';
import { post } from '../api.js';
import { Wordmark } from '../components/Brand.jsx';
import { Field, useToast } from '../components/ui.jsx';

const TYPES = [
  { id: 'market', label: 'Market / Bakkal', desc: 'Barkodlu ürünler, terazi, stok takibi' },
  { id: 'berber', label: 'Berber / Kuaför', desc: 'Hizmetler, randevu, personel primi' },
  { id: 'kafe', label: 'Kafe / Büfe', desc: 'Hızlı tuşlar, stoksuz ürünler' },
  { id: 'genel', label: 'Genel', desc: 'Diğer tüm işletmeler' },
];

export default function Setup({ onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ business_name: '', business_type: 'market', business_phone: '', admin_name: '', admin_pin: '', pin2: '', seed_samples: true });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.admin_pin !== f.pin2) return toast.err('PIN kodları eşleşmiyor');
    setBusy(true);
    try {
      await onDone(await post('/setup', f));
    } catch (err) {
      toast.err(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card card-pad stack" style={{ width: '100%', maxWidth: 620 }} onSubmit={submit}>
        <div className="stack" style={{ gap: 10 }}>
          <Wordmark height={28} />
          <div>
            <h1>Hoş geldiniz</h1>
            <div className="muted">İşletmenizi birkaç adımda kuralım.</div>
          </div>
        </div>
        <Field label="İşletme adı"><input className="input" required value={f.business_name} onChange={set('business_name')} placeholder="Örn. Yıldız Market" /></Field>
        <div className="field">
          <span>İşletme türü</span>
          <div className="grid-2">
            {TYPES.map((t) => (
              <button type="button" key={t.id} onClick={() => setF({ ...f, business_type: t.id })}
                className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', borderColor: f.business_type === t.id ? 'var(--primary)' : undefined, boxShadow: f.business_type === t.id ? '0 0 0 3px var(--primary-soft)' : undefined }}>
                <strong>{t.label}</strong>
                <div className="muted small-text">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <Field label="Telefon (fişte görünür)"><input className="input" value={f.business_phone} onChange={set('business_phone')} /></Field>
        <div className="grid-3">
          <Field label="Yönetici adı"><input className="input" required value={f.admin_name} onChange={set('admin_name')} /></Field>
          <Field label="PIN (4-8 rakam)"><input className="input" required inputMode="numeric" type="password" pattern="\d{4,8}" value={f.admin_pin} onChange={set('admin_pin')} /></Field>
          <Field label="PIN tekrar"><input className="input" required inputMode="numeric" type="password" pattern="\d{4,8}" value={f.pin2} onChange={set('pin2')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.seed_samples} onChange={set('seed_samples')} /> Örnek kategori ve ürünleri ekle (sonra silebilirsiniz)</label>
        <button className="btn primary big" disabled={busy}>{busy ? 'Kuruluyor…' : 'Kurulumu tamamla'}</button>
      </form>
    </div>
  );
}
