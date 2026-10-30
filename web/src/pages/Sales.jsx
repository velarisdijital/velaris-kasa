import { useState } from 'react';
import { get, post, registerName } from '../api.js';
import { useSession } from '../App.jsx';
import { printReceipt } from '../components/Receipt.jsx';
import { Icon, Modal, useLoad, useToast } from '../components/ui.jsx';
import { dt, METHOD_LABELS, money, parseQty, plain, qty, today } from '../format.js';

const STATUS = { completed: ['Tamamlandı', 'green'], partial_refund: ['Kısmi iade', 'yellow'], refunded: ['İade edildi', 'red'] };

export default function Sales() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const list = useLoad(() => get(`/sales?from=${from}&to=${to}&q=${encodeURIComponent(q)}`), [from, to, q]);
  const rows = list.data || [];
  const total = rows.reduce((a, s) => a + s.total - s.refunded_total, 0);

  return (
    <div className="page">
      <div className="page-head"><h1>Satışlar</h1></div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input type="date" className="input" style={{ maxWidth: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Başlangıç" />
        <input type="date" className="input" style={{ maxWidth: 170 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Bitiş" />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Fiş no veya müşteri…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grow" />
        <div>{rows.length} satış · Net <strong>{money(total)}</strong></div>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Fiş No</th><th>Tarih</th><th>Müşteri</th><th>Kasiyer</th><th>Ödeme</th><th>Durum</th><th className="right">Tutar</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)}>
                <td><strong>{s.receipt_no}</strong></td>
                <td>{dt(s.created_at)}</td>
                <td>{s.customer_name || <span className="muted">—</span>}</td>
                <td>{s.user_name}</td>
                <td>{(s.methods || '').split(',').filter(Boolean).map((m) => METHOD_LABELS[m]).join(' + ')}</td>
                <td><span className={`badge ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span></td>
                <td className="right num"><strong>{money(s.total)}</strong>{s.refunded_total > 0 && <div className="danger-text small-text">−{money(s.refunded_total)}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{list.loading ? 'Yükleniyor…' : 'Bu tarihlerde satış yok'}</div>}
      </div>
      {open && <SaleDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function SaleDetail({ id, onClose }) {
  const { settings } = useSession();
  const sale = useLoad(() => get(`/sales/${id}`), [id]);
  const [refund, setRefund] = useState(false);
  const s = sale.data;
  if (!s) return null;
  return (
    <Modal title={`Fiş ${s.receipt_no}`} onClose={onClose} wide
      footer={<>
        {s.status !== 'refunded' && <button className="btn danger" onClick={() => setRefund(true)}><Icon name="refund" /> İade</button>}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => printReceipt(s, settings)}><Icon name="print" /> Fiş yazdır</button>
      </>}>
      <div className="stack">
        <div className="row wrap muted">
          <span>{dt(s.created_at)}</span>·<span>{s.register_name}</span>·<span>Kasiyer: {s.user_name}</span>
          {s.customer_name && <><span>·</span><span>Müşteri: <b>{s.customer_name}</b></span></>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ürün</th><th className="right">Miktar</th><th className="right">Fiyat</th><th className="right">KDV</th><th className="right">Tutar</th></tr></thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}{i.staff_name && <span className="muted small-text"> · {i.staff_name}</span>}{i.refunded_qty > 0 && <span className="badge red" style={{ marginLeft: 6 }}>{qty(i.refunded_qty)} iade</span>}</td>
                  <td className="right num">{qty(i.qty)} {i.unit}</td>
                  <td className="right num">{plain(i.unit_price)}{i.discount > 0 && <div className="success-text small-text">−{plain(i.discount)}</div>}</td>
                  <td className="right">%{i.vat_rate}</td>
                  <td className="right num"><strong>{money(i.line_total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid-2">
          <div className="card card-pad stack" style={{ gap: 4 }}>
            <h3>Ödeme</h3>
            {s.payments.map((p, i) => <div key={i} className="row" style={{ justifyContent: 'space-between' }}><span>{METHOD_LABELS[p.method]}</span><span className="num">{money(p.amount)}</span></div>)}
            {s.refunds.map((r) => <div key={r.id} className="row danger-text" style={{ justifyContent: 'space-between' }}><span>İade ({METHOD_LABELS[r.method]}) {dt(r.created_at)}</span><span className="num">−{money(r.amount)}</span></div>)}
          </div>
          <div className="card card-pad stack" style={{ gap: 4 }}>
            {s.discount > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span>Ara toplam</span><span>{money(s.subtotal)}</span></div>}
            {s.discount > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span>İndirim</span><span>−{money(s.discount)}</span></div>}
            <div className="row" style={{ justifyContent: 'space-between' }}><span>KDV</span><span>{money(s.vat_total)}</span></div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 20, fontWeight: 800 }}><span>Toplam</span><span>{money(s.total)}</span></div>
          </div>
        </div>
      </div>
      {refund && <RefundModal sale={s} onClose={() => setRefund(false)} onDone={() => { setRefund(false); sale.reload(); }} />}
    </Modal>
  );
}

function RefundModal({ sale, onClose, onDone }) {
  const toast = useToast();
  const items = sale.items.filter((i) => i.qty - i.refunded_qty > 0);
  const [q, setQ] = useState(Object.fromEntries(items.map((i) => [i.id, String(+(i.qty - i.refunded_qty).toFixed(3))])));
  const mainMethod = [...sale.payments].sort((a, b) => b.amount - a.amount)[0]?.method || 'cash';
  const [method, setMethod] = useState(mainMethod);
  const [note, setNote] = useState('');
  const run = async () => {
    try {
      await post(`/sales/${sale.id}/refund`, {
        items: items.map((i) => ({ sale_item_id: i.id, qty: parseQty(q[i.id]) })).filter((x) => x.qty > 0),
        method, note, register_name: registerName(),
      });
      toast.ok('İade yapıldı, stok geri eklendi');
      onDone();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title="İade" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn danger" onClick={run}>İadeyi onayla</button></>}>
      <div className="stack">
        {items.map((i) => (
          <div key={i.id} className="row">
            <span style={{ flex: 1 }}>{i.name} <span className="muted small-text">(en fazla {qty(i.qty - i.refunded_qty)})</span></span>
            <input className="input" style={{ width: 100 }} inputMode="decimal" value={q[i.id]} onChange={(e) => setQ({ ...q, [i.id]: e.target.value })} />
          </div>
        ))}
        <div className="tabs">
          {['cash', 'card', 'transfer', ...(sale.customer_id ? ['credit'] : [])].map((m) =>
            <button key={m} className={`tab ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m === 'credit' ? 'Veresiyeden düş' : METHOD_LABELS[m]}</button>)}
        </div>
        <input className="input" placeholder="İade nedeni" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
