import { useState } from 'react';
import { get, post, registerName } from '../api.js';
import { useSession } from '../App.jsx';
import { printElement } from '../components/Receipt.jsx';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, METHOD_LABELS, money, plain, toKurus } from '../format.js';

export default function Shift() {
  const register = registerName();
  const current = useLoad(() => get(`/shifts/current?register=${encodeURIComponent(register)}`), [register]);
  const history = useLoad(() => get('/shifts?limit=30'));
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const s = current.data;

  const reload = () => { current.reload(); history.reload(); };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Gün Sonu — {register}</h1>
        <div className="grow" />
        {s && <button className="btn" onClick={() => setModal('in')}>Kasaya para girişi</button>}
        {s && <button className="btn" onClick={() => setModal('out')}>Kasadan para çıkışı / masraf</button>}
        {s && <button className="btn primary" onClick={() => setModal('close')}>Günü kapat (Z raporu)</button>}
      </div>
      {!s && !current.loading && <div className="card card-pad">Bu kasada açık vardiya yok. Kasa ekranından kasayı açabilirsiniz.</div>}
      {s && <Summary s={s} />}

      <h2 style={{ margin: '24px 0 12px' }}>Geçmiş gün sonları</h2>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Kasa</th><th>Açılış</th><th>Kapanış</th><th>Açan</th><th className="right">Beklenen</th><th className="right">Sayılan</th><th className="right">Fark</th></tr></thead>
          <tbody>
            {(history.data || []).map((h) => (
              <tr key={h.id} className="clickable" onClick={() => get(`/shifts/${h.id}`).then(setView)}>
                <td>{h.register_name}</td><td>{dt(h.opened_at)}</td><td>{h.closed_at ? dt(h.closed_at) : <span className="badge green">Açık</span>}</td><td>{h.user_name}</td>
                <td className="right num">{h.expected_cash != null ? money(h.expected_cash) : '—'}</td>
                <td className="right num">{h.counted_cash != null ? money(h.counted_cash) : '—'}</td>
                <td className="right num">{h.counted_cash != null ? <Diff v={h.counted_cash - h.expected_cash} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal === 'in' || modal === 'out') && <CashMoveModal shift={s.shift} type={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'close' && <CloseModal s={s} onClose={() => setModal(null)} onDone={(z) => { setModal(null); reload(); setView(z); }} />}
      {view && (
        <Modal title={`Z Raporu — ${view.shift.register_name} #${view.shift.id}`} onClose={() => setView(null)} wide
          footer={<button className="btn" onClick={() => printZ(view)}><Icon name="print" /> Yazdır</button>}>
          <Summary s={view} />
        </Modal>
      )}
    </div>
  );
}

const Diff = ({ v }) => <span className={v === 0 ? 'success-text' : v < 0 ? 'danger-text' : 'warn-text'}>{v > 0 ? '+' : ''}{money(v)}</span>;

function Summary({ s }) {
  return (
    <div className="stack">
      <div className="stats">
        <div className="card stat"><div className="label">Satış</div><div className="value">{money(s.sales.total)}</div><div className="sub">{s.sales.count} fiş · KDV {money(s.sales.vat_total)}</div></div>
        <div className="card stat"><div className="label">İade</div><div className="value danger-text">{money(s.refunds.total)}</div></div>
        <div className="card stat"><div className="label">Net</div><div className="value">{money(s.sales.net_total)}</div><div className="sub">Brüt kâr {money(s.sales.gross_profit)}</div></div>
        <div className="card stat"><div className="label">Kasada olması gereken nakit</div><div className="value">{money(s.expected_cash)}</div>
          {s.shift.counted_cash != null && <div className="sub">Sayılan {money(s.shift.counted_cash)} · Fark <Diff v={s.difference} /></div>}</div>
      </div>
      <div className="grid-2">
        <div className="card card-pad stack" style={{ gap: 6 }}>
          <h3>Ödeme türleri</h3>
          {Object.entries(s.payments).map(([m, a]) => <Row key={m} label={METHOD_LABELS[m]} value={money(a)} />)}
          {Object.keys(s.collections).length > 0 && <h3 style={{ marginTop: 8 }}>Veresiye tahsilatı</h3>}
          {Object.entries(s.collections).map(([m, a]) => <Row key={m} label={METHOD_LABELS[m]} value={money(a)} />)}
        </div>
        <div className="card card-pad stack" style={{ gap: 6 }}>
          <h3>Nakit hesabı</h3>
          <Row label="Açılış" value={money(s.shift.opening_cash)} />
          <Row label="+ Nakit satış" value={money(s.payments.cash)} />
          {s.collections.cash ? <Row label="+ Nakit tahsilat" value={money(s.collections.cash)} /> : null}
          {s.cash_in ? <Row label="+ Para girişi" value={money(s.cash_in)} /> : null}
          {s.refunds.cash ? <Row label="− Nakit iade" value={money(s.refunds.cash)} /> : null}
          {s.cash_out ? <Row label="− Para çıkışı / masraf" value={money(s.cash_out)} /> : null}
          <Row label={<b>= Beklenen nakit</b>} value={<b>{money(s.expected_cash)}</b>} />
          {s.movements.map((m) => <div key={m.id} className="muted small-text">{dt(m.created_at)} · {m.type === 'in' ? '+' : '−'}{money(m.amount)} {m.note}</div>)}
        </div>
      </div>
      <div className="muted small-text">Açılış: {dt(s.shift.opened_at)} ({s.shift.user_name}){s.shift.closed_at ? ` · Kapanış: ${dt(s.shift.closed_at)}` : ''}</div>
    </div>
  );
}

const Row = ({ label, value }) => <div className="row" style={{ justifyContent: 'space-between' }}><span>{label}</span><span className="num">{value}</span></div>;

function CashMoveModal({ shift, type, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await post(`/shifts/${shift.id}/cash`, { type, amount: toKurus(amount), note }); onDone(); } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={type === 'in' ? 'Kasaya para girişi' : 'Kasadan para çıkışı'} onClose={onClose} footer={<button className="btn primary" form="cm">Kaydet</button>}>
      <form id="cm" className="stack" onSubmit={save}>
        <Field label="Tutar (₺)"><input className="input" autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Açıklama"><input className="input" required value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'out' ? 'Örn. tedarikçi ödemesi, fatura, bankaya yatırılan' : 'Örn. bozuk para'} /></Field>
      </form>
    </Modal>
  );
}

function CloseModal({ s, onClose, onDone }) {
  const toast = useToast();
  const ask = useConfirm();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const diff = counted === '' ? null : toKurus(counted) - s.expected_cash;
  const save = async (e) => {
    e.preventDefault();
    if (!(await ask('Gün kapatılsın mı? Bu işlem geri alınamaz.', { ok: 'Günü kapat', danger: false }))) return;
    try {
      const z = await post(`/shifts/${s.shift.id}/close`, { counted_cash: toKurus(counted), note });
      onDone(z);
      if (z.fiscal_z && !z.fiscal_z.ok) toast.err(z.fiscal_z.message);
      else toast.ok(z.fiscal_z ? 'Gün kapatıldı, yazarkasa Z raporu alındı' : 'Gün kapatıldı');
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title="Günü kapat" onClose={onClose} footer={<button className="btn primary" form="zc">Kapat ve Z raporu al</button>}>
      <form id="zc" className="stack" onSubmit={save}>
        <div>Kasada olması gereken nakit: <strong>{money(s.expected_cash)}</strong></div>
        <Field label="Saydığınız nakit (₺)"><input className="input" autoFocus required inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontSize: 22 }} /></Field>
        {diff != null && <div style={{ fontWeight: 700 }}>Fark: <Diff v={diff} /> {diff < 0 ? '(kasa eksik)' : diff > 0 ? '(kasa fazla)' : ''}</div>}
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function printZ(z) {
  const lines = [
    `Z RAPORU - ${z.shift.register_name}`, `Açılış: ${dt(z.shift.opened_at)}`, `Kapanış: ${dt(z.shift.closed_at)}`, '-'.repeat(32),
    `Fiş sayısı: ${z.sales.count}`, `Satış: ${plain(z.sales.total)}`, `İade: ${plain(z.refunds.total)}`, `Net: ${plain(z.sales.net_total)}`, `KDV: ${plain(z.sales.vat_total)}`, '-'.repeat(32),
    ...Object.entries(z.payments).map(([m, a]) => `${METHOD_LABELS[m]}: ${plain(a)}`), '-'.repeat(32),
    `Beklenen nakit: ${plain(z.expected_cash)}`, `Sayılan nakit: ${plain(z.shift.counted_cash ?? 0)}`, `Fark: ${plain(z.difference ?? 0)}`,
  ];
  printElement(<div className="receipt"><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>{lines.join('\n')}</pre></div>);
}
