import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, get, post, put } from '../api.js';
import { isManager, useSession } from '../App.jsx';
import CameraScanner, { cameraSupported } from '../components/CameraScanner.jsx';
import NumPad, { applyKey } from '../components/NumPad.jsx';
import { Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, money, parseQty, qty } from '../format.js';

/** Toplu stok sayımı: barkod okut (her okutma +1), miktar yaz, farkları gör, sayımı uygula */
export default function StockCount() {
  const toast = useToast();
  const ask = useConfirm();
  const navigate = useNavigate();
  const { user } = useSession();
  const counts = useLoad(() => get('/stock-counts'));
  const [count, setCount] = useState(null);
  const [code, setCode] = useState('');
  const [last, setLast] = useState(null); // son okutulan { product_id, name, counted, system }
  const [entry, setEntry] = useState('');
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const open = async (id) => { setCount(await get(`/stock-counts/${id}`)); setLast(null); setTimeout(() => inputRef.current?.focus(), 50); };
  const reload = async () => setCount(await get(`/stock-counts/${count.id}`));
  useEffect(() => { const o = (counts.data || []).find((c) => c.status === 'open'); if (o && !count) open(o.id); }, [counts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async (barcode) => {
    const b = String(barcode || '').trim();
    if (!b) return;
    try {
      const r = await put(`/stock-counts/${count.id}/items`, { barcode: b });
      setLast(r); setEntry('');
      reload();
    } catch (e) { toast.err(e); }
    setCode(''); inputRef.current?.focus();
  };
  const setCounted = async (pid, counted) => {
    try { const r = await put(`/stock-counts/${count.id}/items`, { product_id: pid, counted }); setLast(r); setEntry(''); reload(); } catch (e) { toast.err(e); }
  };
  const apply = async () => {
    if (!(await ask(`Sayılan ${count.items.length} ürünün stoğu sayılan miktarla değiştirilsin mi? Sayılmayan ürünlere dokunulmaz.`, { ok: 'Sayımı uygula', danger: false }))) return;
    setBusy(true);
    try { setCount(await post(`/stock-counts/${count.id}/apply`, { zero_uncounted: false })); toast.ok('Sayım stoğa işlendi'); counts.reload(); } catch (e) { toast.err(e); } finally { setBusy(false); }
  };

  if (!count) {
    return (
      <div className="page">
        <div className="page-head"><h1>Stok sayımı</h1><div className="grow" /><button className="btn ghost" onClick={() => navigate('/urunler')}>Stok'a dön</button>
          <button className="btn primary" onClick={async () => { const c = await post('/stock-counts', {}); counts.reload(); open(c.id); }}><Icon name="plus" /> Yeni sayım</button></div>
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Sayım</th><th>Başlangıç</th><th>Sayan</th><th className="right">Ürün</th><th>Durum</th></tr></thead>
            <tbody>{(counts.data || []).map((c) => (
              <tr key={c.id} className="clickable" onClick={() => open(c.id)}>
                <td>#{c.id} {c.note}</td><td>{dt(c.created_at)}</td><td>{c.user_name}</td><td className="right">{c.item_count}</td>
                <td>{{ open: <span className="badge blue">Açık</span>, applied: <span className="badge green">Uygulandı</span>, cancelled: <span className="badge">İptal</span> }[c.status]}</td>
              </tr>
            ))}</tbody>
          </table>
          {counts.data && !counts.data.length && <div className="empty">Henüz sayım yok. "Yeni sayım" ile başlayın; rafları gezerek barkod okutun.</div>}
        </div>
      </div>
    );
  }

  const isOpen = count.status === 'open';
  return (
    <div className="page">
      <div className="page-head">
        <h1>Sayım #{count.id}</h1>
        <span className="muted">{dt(count.created_at)} · {count.user_name}</span>
        <div className="grow" />
        <button className="btn ghost" onClick={() => { setCount(null); counts.reload(); }}>Sayımlar</button>
        {isOpen && <button className="btn ghost danger-text" onClick={async () => { if (await ask('Sayım iptal edilsin mi? Stok değişmez.', { ok: 'İptal et' })) { await post(`/stock-counts/${count.id}/cancel`); setCount(null); counts.reload(); } }}>İptal</button>}
        {isOpen && isManager(user) && <button className="btn primary" disabled={busy || !count.items.length} onClick={apply}>Sayımı uygula</button>}
      </div>
      <div className="stats">
        <div className="card card-pad"><div className="muted small-text">Sayılan ürün</div><strong style={{ fontSize: 24 }}>{count.summary.products}</strong></div>
        <div className="card card-pad"><div className="muted small-text">Fazla çıkan</div><strong style={{ fontSize: 24 }} className="success-text">{count.summary.plus}</strong></div>
        <div className="card card-pad"><div className="muted small-text">Eksik çıkan</div><strong style={{ fontSize: 24 }} className="danger-text">{count.summary.minus}</strong></div>
        <div className="card card-pad"><div className="muted small-text">Fark (maliyet)</div><strong style={{ fontSize: 24 }} className={count.summary.diff_value < 0 ? 'danger-text' : ''}>{money(count.summary.diff_value)}</strong></div>
      </div>
      {isOpen && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card card-pad stack">
            <form className="row" onSubmit={(e) => { e.preventDefault(); scan(code); }}>
              <input ref={inputRef} className="input" autoFocus style={{ fontSize: 20 }} placeholder="Barkod okutun (her okutma +1)" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Sayım barkodu" />
              {cameraSupported() && <button type="button" className="btn" onClick={() => setCam(true)}><Icon name="camera" /></button>}
            </form>
            {last ? (
              <div className="card card-pad stack" style={{ background: 'var(--primary-soft)', boxShadow: 'none', gap: 6 }}>
                <strong style={{ fontSize: 18 }}>{last.name}</strong>
                <div>Sayılan: <b style={{ fontSize: 26 }}>{qty(last.counted)}</b> <span className="muted">· sistemde {qty(last.system)}</span></div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn" onClick={() => setCounted(last.product_id, Math.max(0, last.counted - 1))}>−1</button>
                  <button className="btn" onClick={() => setCounted(last.product_id, last.counted + 1)}>+1</button>
                  <span className="muted small-text">ya da miktarı yazın:</span>
                  <strong style={{ minWidth: 60 }}>{entry}</strong>
                </div>
                <NumPad compact onKey={(k) => setEntry((v) => applyKey(v, k))} side={[{ label: 'Bu miktar', className: 'primary', disabled: entry === '', onClick: () => setCounted(last.product_id, parseQty(entry)) }]} />
              </div>
            ) : <div className="muted">Rafları gezerek ürünlerin barkodunu okutun. Aynı ürünü her okuttuğunuzda sayılan miktar 1 artar; koli için miktarı yazabilirsiniz.</div>}
          </div>
          <CountTable count={count} isOpen={isOpen} onEdit={(i) => setLast({ product_id: i.product_id, name: i.name, counted: i.counted, system: i.system })}
            onRemove={async (i) => { setCount(await del(`/stock-counts/${count.id}/items/${i.product_id}`)); }} />
        </div>
      )}
      {!isOpen && <CountTable count={count} isOpen={false} />}
      {cam && <CameraScanner onClose={() => setCam(false)} onResult={(c) => { setCam(false); scan(c); }} />}
    </div>
  );
}

function CountTable({ count, isOpen, onEdit, onRemove }) {
  return (
    <div className="card table-wrap" style={{ maxHeight: 520 }}>
      <table className="table">
        <thead><tr><th>Ürün</th><th className="right">Sistem</th><th className="right">Sayılan</th><th className="right">Fark</th>{isOpen && <th />}</tr></thead>
        <tbody>{count.items.map((i) => (
          <tr key={i.product_id} className={isOpen ? 'clickable' : ''} onClick={() => isOpen && onEdit(i)}>
            <td><strong>{i.name}</strong><div className="muted small-text">{i.barcode}</div></td>
            <td className="right num">{qty(i.system)}</td><td className="right num">{qty(i.counted)}</td>
            <td className={`right num ${i.diff < 0 ? 'danger-text' : i.diff > 0 ? 'success-text' : ''}`}>{i.diff > 0 ? '+' : ''}{qty(i.diff)}</td>
            {isOpen && <td><button className="btn small ghost" onClick={(e) => { e.stopPropagation(); onRemove(i); }} aria-label="Kaldır"><Icon name="trash" /></button></td>}
          </tr>
        ))}</tbody>
      </table>
      {!count.items.length && <div className="empty">Henüz ürün sayılmadı</div>}
    </div>
  );
}

/** Stok → SKT takibi: son kullanma tarihi yaklaşan / geçen partiler, fire olarak düş, var olan stok için SKT gir */
export function ExpiryModal({ onClose }) {
  const toast = useToast();
  const ask = useConfirm();
  const [days, setDays] = useState(30);
  const r = useLoad(() => get(`/reports/expiry?days=${days}`), [days]);
  const products = useLoad(() => get('/products'));
  const [add, setAdd] = useState(null);
  const [q, setQ] = useState('');
  const waste = async (l) => {
    if (!(await ask(`${l.name}: ${qty(l.qty)} ${l.unit} fire olarak stoktan düşülsün mü?`, { ok: 'Fire düş' }))) return;
    try { await post(`/stock-lots/${l.id}/waste`); toast.ok('Fire düşüldü'); r.reload(); } catch (e) { toast.err(e); }
  };
  const save = async (e) => {
    e.preventDefault();
    try { await post('/stock-lots', { product_id: add.product.id, expiry_date: add.expiry, qty: parseQty(add.qty) }); toast.ok('SKT kaydedildi'); setAdd(null); r.reload(); } catch (err) { toast.err(err); }
  };
  const matches = (products.data || []).filter((p) => p.track_stock && q && (p.name.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')) || p.barcode?.includes(q))).slice(0, 8);
  return (
    <Modal title="SKT takibi (son kullanma tarihi)" onClose={onClose} wide
      footer={<button className="btn" onClick={() => setAdd({ product: null, expiry: '', qty: '' })}><Icon name="plus" /> Var olan stok için SKT gir</button>}>
      <div className="stack">
        <div className="tabs">{[7, 30, 60, 90].map((d) => <button key={d} className={`tab ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} gün içinde</button>)}</div>
        {add && (
          <form className="card card-pad stack" onSubmit={save}>
            {!add.product ? (
              <>
                <input className="input" autoFocus placeholder="Ürün ara (ad ya da barkod)…" value={q} onChange={(e) => setQ(e.target.value)} />
                {matches.map((p) => <button type="button" key={p.id} className="dropdown-item" onClick={() => { setAdd({ ...add, product: p, qty: String(p.stock) }); setQ(''); }}><span>{p.name}</span><span className="muted">stok {qty(p.stock)}</span></button>)}
              </>
            ) : (
              <div className="row wrap">
                <strong style={{ flex: 1 }}>{add.product.name}</strong>
                <input className="input" type="date" required style={{ width: 170 }} value={add.expiry} onChange={(e) => setAdd({ ...add, expiry: e.target.value })} aria-label="SKT" />
                <input className="input" inputMode="decimal" required style={{ width: 100 }} value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} aria-label="Miktar" />
                <button className="btn primary">Kaydet</button>
              </div>
            )}
            <small className="muted">Alış faturasında satıra SKT yazarsanız otomatik eklenir. Satışta önce SKT'si en yakın parti düşer.</small>
          </form>
        )}
        {r.data && (
          <div className="muted small-text">{r.data.lots.length} parti · {r.data.expired} tanesinin tarihi geçmiş · maliyet {money(r.data.value)}</div>
        )}
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="table">
            <thead><tr><th>Ürün</th><th>SKT</th><th className="right">Kalan</th><th className="right">Gün</th><th /></tr></thead>
            <tbody>{(r.data?.lots || []).map((l) => (
              <tr key={l.id}>
                <td><strong>{l.name}</strong><div className="muted small-text">{l.barcode}{l.branch_name ? ` · ${l.branch_name}` : ''}</div></td>
                <td>{l.expiry_date.split('-').reverse().join('.')}</td>
                <td className="right num">{qty(l.qty)} {l.unit}</td>
                <td className="right">{l.days_left < 0 ? <span className="badge red">geçti</span> : l.days_left <= 7 ? <span className="badge yellow">{l.days_left} gün</span> : `${l.days_left} gün`}</td>
                <td><button className="btn small" onClick={() => waste(l)}>Fire düş</button></td>
              </tr>
            ))}</tbody>
          </table>
          {r.data && !r.data.lots.length && <div className="empty">Bu aralıkta SKT'si dolan ürün yok</div>}
        </div>
      </div>
    </Modal>
  );
}
