import { useState } from 'react';
import { del, get, post, put, registerName } from '../api.js';
import { isManager, useSession } from '../App.jsx';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { d, dt, METHOD_LABELS, money, toInput, toKurus } from '../format.js';

export default function Customers() {
  const [q, setQ] = useState('');
  const [debt, setDebt] = useState(false);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const list = useLoad(() => get(`/customers?q=${encodeURIComponent(q)}${debt ? '&debt=1' : ''}`), [q, debt]);
  const totalDebt = (list.data || []).reduce((a, c) => a + Math.max(0, c.balance), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Müşteriler & Veresiye</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" /> Yeni müşteri</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Ad, telefon veya e-posta…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tabs">
          <button className={`tab ${!debt ? 'active' : ''}`} onClick={() => setDebt(false)}>Tümü</button>
          <button className={`tab ${debt ? 'active' : ''}`} onClick={() => setDebt(true)}>Borçlular</button>
        </div>
        <div className="grow" />
        {debt && <div>Toplam alacak: <strong className="danger-text">{money(totalDebt)}</strong></div>}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Müşteri</th><th>Telefon</th><th>CRM</th><th className="right">Bakiye</th></tr></thead>
          <tbody>
            {(list.data || []).map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                <td><strong>{c.name}</strong>{c.note && <div className="muted small-text">{c.note}</div>}</td>
                <td>{c.phone}</td>
                <td>{c.crm_id ? <span className="badge blue" title={`CRM ID: ${c.crm_id}`}>Bağlı</span> : <span className="muted">—</span>}</td>
                <td className="right num">{c.balance > 0 ? <span className="badge red">{money(c.balance)}</span> : c.balance < 0 ? <span className="badge green">Alacaklı {money(-c.balance)}</span> : <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.data?.length && <div className="empty">{list.loading ? 'Yükleniyor…' : 'Müşteri yok'}</div>}
      </div>
      {open && <CustomerDetail id={open} onClose={() => { setOpen(null); list.reload(); }} onEdit={(c) => setEditing(c)} />}
      {editing && <CustomerForm customer={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function CustomerForm({ customer, onClose, onSaved }) {
  const toast = useToast();
  const c = customer || {};
  const [f, setF] = useState({ name: c.name || '', phone: c.phone || '', email: c.email || '', note: c.note || '', credit_limit: toInput(c.credit_limit) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...f, credit_limit: toKurus(f.credit_limit) };
      if (customer) await put(`/customers/${customer.id}`, body); else await post('/customers', body);
      toast.ok('Kaydedildi');
      onSaved();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={customer ? 'Müşteriyi düzenle' : 'Yeni müşteri'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" form="cf">Kaydet</button></>}>
      <form id="cf" className="stack" onSubmit={save}>
        <Field label="Ad Soyad / Firma"><input className="input" autoFocus required value={f.name} onChange={set('name')} /></Field>
        <div className="grid-2">
          <Field label="Telefon"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-posta"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Veresiye limiti (₺)" hint="0 veya boş = limitsiz"><input className="input" inputMode="decimal" value={f.credit_limit} onChange={set('credit_limit')} /></Field>
        <Field label="Not"><textarea className="input" value={f.note} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function CustomerDetail({ id, onClose, onEdit }) {
  const toast = useToast();
  const ask = useConfirm();
  const { user } = useSession();
  const c = useLoad(() => get(`/customers/${id}`), [id]);
  const [pay, setPay] = useState(null);
  if (!c.data) return null;
  const x = c.data;

  const remove = async () => {
    if (!(await ask(`${x.name} silinsin mi?`, { ok: 'Sil' }))) return;
    try { await del(`/customers/${x.id}`); onClose(); } catch (err) { toast.err(err); }
  };

  return (
    <Modal title={x.name} onClose={onClose} wide
      footer={<>{isManager(user) && <button className="btn danger" onClick={remove}>Sil</button>}<div style={{ flex: 1 }} />
        <button className="btn" onClick={() => { onClose(); onEdit(x); }}><Icon name="edit" /> Düzenle</button>
        {isManager(user) && <button className="btn" onClick={() => setPay('adjust')}>Bakiye düzelt</button>}
        <button className="btn success" disabled={x.balance <= 0} onClick={() => setPay('payment')}>Tahsilat al</button></>}>
      <div className="stack">
        <div className="stats">
          <div className="card stat"><div className="label">Bakiye (borç)</div><div className={`value ${x.balance > 0 ? 'danger-text' : ''}`}>{money(x.balance)}</div>
            {x.credit_limit > 0 && <div className="sub">Limit {money(x.credit_limit)}</div>}</div>
          <div className="card stat"><div className="label">Toplam alışveriş</div><div className="value">{money(x.stats.total_spent)}</div><div className="sub">{x.stats.visit_count} ziyaret</div></div>
          <div className="card stat"><div className="label">Son ziyaret</div><div className="value" style={{ fontSize: 18 }}>{x.stats.last_visit ? d(x.stats.last_visit) : '—'}</div>
            <div className="sub">{x.phone}{x.crm_id ? ` · CRM #${x.crm_id}` : ''}</div></div>
        </div>
        <h3>Hesap hareketleri</h3>
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="table">
            <thead><tr><th>Tarih</th><th>İşlem</th><th className="right">Tutar</th><th className="right">Bakiye</th><th>Açıklama</th></tr></thead>
            <tbody>
              {x.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{dt(t.created_at)}</td>
                  <td>{t.type === 'debt' ? 'Veresiye' : t.type === 'payment' ? `Tahsilat (${METHOD_LABELS[t.method] || ''})` : 'Düzeltme'}</td>
                  <td className={`right num ${t.amount > 0 ? 'danger-text' : 'success-text'}`}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</td>
                  <td className="right num">{money(t.balance_after)}</td>
                  <td className="muted">{t.receipt_no ? `Fiş ${t.receipt_no}` : t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!x.transactions.length && <div className="empty">Hareket yok</div>}
        </div>
      </div>
      {pay && <PaymentModal customer={x} mode={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); c.reload(); }} />}
    </Modal>
  );
}

function PaymentModal({ customer, mode, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(mode === 'payment' ? toInput(customer.balance) : '');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [sign, setSign] = useState(1);
  const save = async (e) => {
    e.preventDefault();
    try {
      if (mode === 'payment') await post(`/customers/${customer.id}/payment`, { amount: toKurus(amount), method, note, register_name: registerName() });
      else await post(`/customers/${customer.id}/adjust`, { amount: sign * toKurus(amount), note });
      toast.ok(mode === 'payment' ? 'Tahsilat kaydedildi' : 'Bakiye düzeltildi');
      onDone();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={mode === 'payment' ? 'Tahsilat' : 'Bakiye düzeltme'} onClose={onClose}
      footer={<button className="btn primary" form="pm">Kaydet</button>}>
      <form id="pm" className="stack" onSubmit={save}>
        <div className="muted">Mevcut borç: <strong>{money(customer.balance)}</strong></div>
        {mode === 'adjust' && (
          <div className="tabs">
            <button type="button" className={`tab ${sign > 0 ? 'active' : ''}`} onClick={() => setSign(1)}>Borç ekle</button>
            <button type="button" className={`tab ${sign < 0 ? 'active' : ''}`} onClick={() => setSign(-1)}>Borç düş</button>
          </div>
        )}
        <Field label="Tutar (₺)"><input className="input" autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {mode === 'payment' && (
          <div className="tabs">
            {['cash', 'card', 'transfer'].map((m) => <button type="button" key={m} className={`tab ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{METHOD_LABELS[m]}</button>)}
          </div>
        )}
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
