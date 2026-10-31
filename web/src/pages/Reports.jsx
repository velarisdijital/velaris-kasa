import { useState } from 'react';
import { get } from '../api.js';
import { useCan } from '../App.jsx';
import { useLoad } from '../components/ui.jsx';
import { METHOD_LABELS, money, qty, today } from '../format.js';

const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE'); };
const PRESETS = [
  ['Bugün', () => [today(), today()]],
  ['Dün', () => [addDays(-1), addDays(-1)]],
  ['Son 7 gün', () => [addDays(-6), today()]],
  ['Bu ay', () => [monthStart(), today()]],
  ['Son 30 gün', () => [addDays(-29), today()]],
];

export default function Reports() {
  const [[from, to], setRange] = useState([today(), today()]);
  const [register, setRegister] = useState('');
  const r = useLoad(() => get(`/reports/summary?from=${from}&to=${to}&register=${encodeURIComponent(register)}`), [from, to, register]);
  const can = useCan();
  const [stockBranch, setStockBranch] = useState('');
  const branchList = useLoad(() => (can('branches') ? get('/branches').then((b) => b.branches.filter((x) => x.active)) : Promise.resolve([])), []);
  const stock = useLoad(() => get(`/reports/stock${stockBranch ? `?branch_id=${stockBranch}` : ''}`), [stockBranch]);
  const x = r.data;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Raporlar</h1>
        <div className="grow" />
        <div className="tabs">
          {PRESETS.map(([label, fn]) => {
            const [f, t] = fn();
            return <button key={label} className={`tab ${f === from && t === to ? 'active' : ''}`} onClick={() => setRange([f, t])}>{label}</button>;
          })}
        </div>
        <input type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => setRange([e.target.value, to])} aria-label="Başlangıç" />
        <input type="date" className="input" style={{ width: 160 }} value={to} onChange={(e) => setRange([from, e.target.value])} aria-label="Bitiş" />
        {x?.registers?.length > 1 && (
          <select className="input" style={{ width: 200 }} value={register} onChange={(e) => setRegister(e.target.value)} aria-label="Kasa / şube">
            <option value="">Tüm kasalar</option>
            {[...new Set(x.registers.map((g) => g.name.split(' Kasa')[0]))].filter((b) => !x.registers.some((g) => g.name === b))
              .map((b) => <option key={`b-${b}`} value={b}>{b} (tüm kasalar)</option>)}
            {x.registers.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        )}
      </div>
      {x && (
        <div className="stack">
          <div className="stats">
            <Stat label="Ciro (net)" value={money(x.totals.net)} sub={`${x.totals.count} satış · iade ${money(x.totals.refunded)}`} />
            <Stat label="Brüt kâr" value={money(x.totals.gross_profit)} sub={x.totals.total ? `Marj %${((x.totals.gross_profit / x.totals.total) * 100).toFixed(1)}` : ''} />
            <Stat label="Ortalama sepet" value={money(x.totals.avg_basket)} />
            <Stat label="KDV" value={money(x.totals.vat_total)} sub={`İndirim ${money(x.totals.discount)}`} />
            <Stat label="Veresiye" value={money(x.new_debt)} sub={`Tahsilat ${money(x.collections)}`} />
            {x.purchases && (x.purchases.count > 0 || x.purchases.payable > 0) &&
              <Stat label="Alışlar" value={money(x.purchases.total)} sub={`${x.purchases.count} belge · tedarikçilere borç ${money(x.purchases.payable)}`} />}
          </div>

          <div className="grid-2">
            <div className="card card-pad">
              <h3>{x.daily.length > 1 ? 'Günlük satış' : 'Saatlik satış'}</h3>
              <Bars data={x.daily.length > 1 ? x.daily.map((d) => ({ label: d.day.slice(8, 10) + '.' + d.day.slice(5, 7), value: d.total }))
                : hourRange(x.hourly).map((h) => ({ label: `${h}`, value: x.hourly.find((r) => r.hour === h)?.total || 0 }))} />
            </div>
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <h3>Ödeme türleri</h3>
              <HBars data={x.payments.map((p) => ({ label: METHOD_LABELS[p.method], value: p.amount }))} />
              {x.registers.length > 1 && !register && <>
                <h3 style={{ marginTop: 8 }}>Kasalar / şubeler</h3>
                <HBars data={x.registers.map((g) => ({ label: `${g.name} · ${g.count} satış`, value: g.net }))} />
              </>}
              <h3 style={{ marginTop: 8 }}>Kategoriler</h3>
              <HBars data={x.categories.map((c) => ({ label: c.name, value: c.total, color: c.color }))} />
            </div>
          </div>

          <div className="grid-2">
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>En çok satan</th><th className="right">Miktar</th><th className="right">Tutar</th><th className="right">Kâr</th></tr></thead>
                <tbody>{x.top_products.map((p, i) => <tr key={i}><td>{p.name}</td><td className="right num">{qty(p.qty)} {p.unit}</td><td className="right num">{money(p.total)}</td><td className="right num">{money(p.profit)}</td></tr>)}</tbody>
              </table>
              {!x.top_products.length && <div className="empty">Satış yok</div>}
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Personel</th><th className="right">Satış</th><th className="right">Hizmet</th><th className="right">Prim</th></tr></thead>
                <tbody>{x.staff.map((s) => <tr key={s.id}><td>{s.name} <span className="muted small-text">%{s.commission_rate}</span></td><td className="right num">{money(s.total)}</td><td className="right num">{money(s.service_total)}</td><td className="right num"><strong>{money(s.commission)}</strong></td></tr>)}</tbody>
              </table>
              {!x.staff.length && <div className="empty">Veri yok</div>}
            </div>
          </div>
        </div>
      )}

      {stock.data && (
        <div className="stack" style={{ marginTop: 24 }}>
          <div className="row wrap">
            <h2 style={{ flex: 1 }}>Stok durumu</h2>
            {(branchList.data || []).length > 1 && (
              <select className="input" style={{ width: 220 }} value={stockBranch} onChange={(e) => setStockBranch(e.target.value)} aria-label="Şube">
                <option value="">Tüm şubeler</option>
                {branchList.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
          <div className="stats">
            <Stat label="Stok değeri (maliyet)" value={money(stock.data.value.cost_value)} sub={`${stock.data.value.product_count} ürün`} />
            <Stat label="Stok değeri (satış)" value={money(stock.data.value.sale_value)} />
            <Stat label="Kritik stok" value={stock.data.low.length} sub={stock.data.negative.length ? `${stock.data.negative.length} ürün eksi stokta` : ''} />
          </div>
          {stock.data.low.length > 0 && (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Kritik stoktaki ürünler (sipariş listesi)</th><th>Barkod</th><th className="right">Stok</th><th className="right">Kritik</th></tr></thead>
                <tbody>{stock.data.low.map((p) => <tr key={p.id}><td>{p.name}</td><td className="muted">{p.barcode}</td><td className="right danger-text">{qty(p.stock)} {p.unit}</td><td className="right">{qty(p.min_stock)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Satış olmayan saatler de görünsün diye 08-20 aralığını (ve satış olan saatleri) kapsar. */
function hourRange(rows) {
  const hours = rows.map((r) => r.hour);
  const from = Math.min(8, ...hours);
  const to = Math.max(20, ...hours);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const Stat = ({ label, value, sub }) => (
  <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div>{sub ? <div className="sub">{sub}</div> : null}</div>
);

function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="empty">Veri yok</div>;
  return (
    <>
      <div className="bars">{data.map((d, i) => <div key={i} className="bar" style={{ height: `${(d.value / max) * 100}%` }} title={`${d.label}: ${money(d.value)}`} />)}</div>
      <div className="bar-labels">{data.map((d, i) => <span key={i}>{d.label}</span>)}</div>
    </>
  );
}

function HBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="muted small-text">Veri yok</div>;
  return data.map((d, i) => (
    <div key={i}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>{d.label}</span><strong className="num">{money(d.value)}</strong></div>
      <div className="hbar" style={{ width: `${(d.value / max) * 100}%`, background: d.color || undefined }} />
    </div>
  ));
}
