import { useMemo, useRef, useState } from 'react';
import { get, post, put, registerName } from '../api.js';
import { useCan } from '../App.jsx';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { d, dt, METHOD_LABELS, money, parseQty, qty, today, toInput, toKurus } from '../format.js';

const DOC_TYPES = { fatura: 'Fatura', irsaliye: 'İrsaliye', fis: 'Fiş' };
const monthStart = () => `${today().slice(0, 8)}01`;

export default function Purchases() {
  const [tab, setTab] = useState('purchases');
  const [form, setForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(null);
  const [openSupplier, setOpenSupplier] = useState(null);
  const [openPurchase, setOpenPurchase] = useState(null);
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [q, setQ] = useState('');
  const purchases = useLoad(() => get(`/purchases?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const suppliers = useLoad(() => get(`/suppliers?q=${encodeURIComponent(q)}`), [q]);
  const posted = (purchases.data || []).filter((p) => p.status === 'posted');
  const totalDebt = (suppliers.data || []).reduce((a, s) => a + Math.max(0, s.balance), 0);
  const reload = () => { purchases.reload(); suppliers.reload(); };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Alış & Tedarikçiler</h1>
        <div className="grow" />
        <button className="btn" onClick={() => setSupplierForm({})}><Icon name="plus" /> Tedarikçi</button>
        <button className="btn primary" onClick={() => setForm(true)}><Icon name="truck" /> Mal girişi</button>
      </div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${tab === 'purchases' ? 'active' : ''}`} onClick={() => setTab('purchases')}>Alış belgeleri</button>
        <button className={`tab ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>Tedarikçiler</button>
      </div>

      {tab === 'purchases' ? (
        <>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <input className="input" type="date" style={{ maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <input className="input" type="date" style={{ maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <div className="grow" />
            <div>{posted.length} belge · Toplam <strong>{money(posted.reduce((a, p) => a + p.total, 0))}</strong>
              <span className="muted"> (KDV {money(posted.reduce((a, p) => a + p.vat_total, 0))})</span></div>
          </div>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Tarih</th><th>Belge</th><th>Tedarikçi</th><th className="right">Kalem</th><th className="right">Tutar</th><th className="right">Ödenen</th><th /></tr></thead>
              <tbody>
                {(purchases.data || []).map((p) => (
                  <tr key={p.id} className={`clickable ${p.status === 'cancelled' ? 'muted' : ''}`} onClick={() => setOpenPurchase(p.id)}>
                    <td>{d(p.doc_date)}</td>
                    <td>{DOC_TYPES[p.doc_type]} {p.doc_no && <strong>{p.doc_no}</strong>}</td>
                    <td>{p.supplier_name || <span className="muted">—</span>}</td>
                    <td className="right num">{p.item_count}</td>
                    <td className="right num">{money(p.total)}</td>
                    <td className="right num">{p.paid ? money(p.paid) : <span className="muted">—</span>}</td>
                    <td>{p.status === 'cancelled' && <span className="badge red">İptal</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!purchases.data?.length && <div className="empty">{purchases.loading ? 'Yükleniyor…' : 'Bu tarihlerde alış yok. "Mal girişi" ile faturayı girin; stok ve alış fiyatı otomatik güncellenir.'}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Ad, telefon veya VKN…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="grow" />
            <div>Tedarikçilere borç: <strong className="danger-text">{money(totalDebt)}</strong></div>
          </div>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Tedarikçi</th><th>Telefon</th><th>VKN</th><th className="right">Bakiye</th></tr></thead>
              <tbody>
                {(suppliers.data || []).map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setOpenSupplier(s.id)}>
                    <td><strong>{s.name}</strong>{s.note && <div className="muted small-text">{s.note}</div>}</td>
                    <td>{s.phone}</td>
                    <td>{s.tax_number}</td>
                    <td className="right num"><Balance value={s.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!suppliers.data?.length && <div className="empty">{suppliers.loading ? 'Yükleniyor…' : 'Tedarikçi yok'}</div>}
          </div>
        </>
      )}

      {form && <PurchaseForm suppliers={suppliers.data || []} onClose={() => setForm(false)} onSaved={() => { setForm(false); reload(); }}
        onNewSupplier={() => setSupplierForm({})} />}
      {supplierForm && <SupplierForm supplier={supplierForm.id ? supplierForm : null} onClose={() => setSupplierForm(null)}
        onSaved={() => { setSupplierForm(null); suppliers.reload(); }} />}
      {openSupplier && <SupplierDetail id={openSupplier} onClose={() => { setOpenSupplier(null); reload(); }}
        onEdit={(s) => setSupplierForm(s)} onOpenPurchase={setOpenPurchase} />}
      {openPurchase && <PurchaseDetail id={openPurchase} onClose={() => { setOpenPurchase(null); reload(); }} />}
    </div>
  );
}

function Balance({ value }) {
  if (value > 0) return <span className="badge red">{money(value)}</span>;
  if (value < 0) return <span className="badge green">Alacak {money(-value)}</span>;
  return <span className="muted">0</span>;
}

// ---------- Mal girişi ----------
function PurchaseForm({ suppliers, onClose, onSaved, onNewSupplier }) {
  const toast = useToast();
  const can = useCan();
  const products = useLoad(() => get('/products'));
  const branches = useLoad(() => (can('branches') ? get('/branches').then((b) => b.branches.filter((x) => x.active)) : Promise.resolve([])), []);
  const [h, setH] = useState({ supplier_id: '', doc_type: 'fatura', doc_no: '', doc_date: today(), branch_id: '', note: '' });
  const [incl, setIncl] = useState(false);
  const [updateBuy, setUpdateBuy] = useState(true);
  const [lines, setLines] = useState([]);
  const [pay, setPay] = useState({ method: 'none', amount: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });

  const add = (p) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: String(parseQty(l.qty) + 1).replace('.', ',') } : l));
      // Son alış fiyatı (KDV dahil saklanır) → seçilen moda göre öner
      const net = p.buy_price ? Math.round(p.buy_price / (1 + p.vat_rate / 100)) : 0;
      return [...ls, { product: p, qty: '1', price: toInput(incl ? p.buy_price : net), vat: String(p.vat_rate) }];
    });
  };
  const upd = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const calc = useMemo(() => lines.map((l) => {
    const q = parseQty(l.qty) || 0;
    const price = toKurus(l.price);
    const vat = Number(String(l.vat).replace(',', '.')) || 0;
    const gross = incl ? price : Math.round(price * (1 + vat / 100));
    const net = incl ? Math.round(price / (1 + vat / 100)) : price;
    return { q, gross, lineNet: Math.round(net * q), lineTotal: Math.round(gross * q) };
  }), [lines, incl]);
  const netTotal = calc.reduce((a, c) => a + c.lineNet, 0);
  const total = calc.reduce((a, c) => a + c.lineTotal, 0);

  const switchIncl = (v) => {
    // Girilmiş fiyatları yeni moda çevir ki tutar değişmesin
    setLines((ls) => ls.map((l) => {
      const price = toKurus(l.price);
      const vat = Number(String(l.vat).replace(',', '.')) || 0;
      return { ...l, price: toInput(v ? Math.round(price * (1 + vat / 100)) : Math.round(price / (1 + vat / 100))) };
    }));
    setIncl(v);
  };

  const save = async () => {
    if (!lines.length) return toast.err('Ürün ekleyin');
    setBusy(true);
    try {
      const amount = pay.method === 'none' ? 0 : pay.method === 'all' ? total : toKurus(pay.amount);
      const r = await post('/purchases', {
        supplier_id: h.supplier_id ? Number(h.supplier_id) : null, doc_type: h.doc_type, doc_no: h.doc_no, doc_date: h.doc_date, note: h.note,
        branch_id: h.branch_id ? Number(h.branch_id) : undefined, register_name: registerName(),
        prices_include_vat: incl, update_buy_price: updateBuy,
        items: lines.map((l) => ({ product_id: l.product.id, qty: parseQty(l.qty), unit_price: toKurus(l.price), vat_rate: l.vat })),
        payment: amount > 0 ? { amount, method: pay.method === 'all' ? 'cash' : pay.method, register_name: registerName() } : undefined,
      });
      toast.ok(`Alış kaydedildi · ${r.items.length} ürün stoğa girdi`);
      onSaved();
    } catch (err) { toast.err(err); } finally { setBusy(false); }
  };

  const multi = (branches.data || []).length > 1;
  return (
    <Modal title="Mal girişi (alış faturası)" onClose={onClose} wide
      footer={<><div className="muted small-text" style={{ flex: 1 }}>Kaydedince ürünler stoğa girer{updateBuy ? ', alış fiyatları güncellenir' : ''}.</div>
        <button className="btn" onClick={onClose}>Vazgeç</button>
        <button className="btn primary" disabled={busy || !lines.length} onClick={save}>{busy ? 'Kaydediliyor…' : `Kaydet · ${money(total)}`}</button></>}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Tedarikçi">
            <div className="row">
              <select className="input" value={h.supplier_id} onChange={set('supplier_id')}>
                <option value="">— Tedarikçisiz (borç takibi yok) —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn small" title="Yeni tedarikçi" onClick={onNewSupplier}><Icon name="plus" /></button>
            </div>
          </Field>
          <div className="grid-2">
            <Field label="Belge">
              <select className="input" value={h.doc_type} onChange={set('doc_type')}>
                {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Belge no"><input className="input" value={h.doc_no} onChange={set('doc_no')} /></Field>
          </div>
          <Field label="Belge tarihi"><input className="input" type="date" value={h.doc_date} onChange={set('doc_date')} /></Field>
          {multi ? (
            <Field label="Stok girecek şube">
              <select className="input" value={h.branch_id} onChange={set('branch_id')}>
                <option value="">Bu kasanın şubesi</option>
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : <Field label="Not"><input className="input" value={h.note} onChange={set('note')} /></Field>}
        </div>

        <ProductSearch products={products.data || []} onPick={add} />

        <div className="row wrap">
          <div className="tabs">
            <button className={`tab ${!incl ? 'active' : ''}`} onClick={() => switchIncl(false)}>Fiyatlar KDV hariç</button>
            <button className={`tab ${incl ? 'active' : ''}`} onClick={() => switchIncl(true)}>KDV dahil</button>
          </div>
          <label className="check"><input type="checkbox" checked={updateBuy} onChange={(e) => setUpdateBuy(e.target.checked)} /> Ürünlerin alış fiyatını güncelle</label>
        </div>

        <div className="table-wrap" style={{ maxHeight: 340 }}>
          <table className="table">
            <thead><tr><th>Ürün</th><th style={{ width: 90 }}>Miktar</th><th style={{ width: 120 }}>Birim fiyat</th><th style={{ width: 70 }}>KDV %</th>
              <th className="right">Tutar (KDV dahil)</th><th className="right">Satış fiyatı</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const c = calc[i];
                const low = c.gross > 0 && l.product.sell_price > 0 && c.gross >= l.product.sell_price;
                return (
                  <tr key={l.product.id}>
                    <td><strong>{l.product.name}</strong><div className="muted small-text">{l.product.barcode} · stok {qty(l.product.stock)} {l.product.unit}</div>
                      <SupplierPrices productId={l.product.id} supplierId={Number(h.supplier_id) || null} /></td>
                    <td><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => upd(i, 'qty', e.target.value)} /></td>
                    <td><input className="input" inputMode="decimal" value={l.price} onChange={(e) => upd(i, 'price', e.target.value)} /></td>
                    <td><input className="input" inputMode="decimal" value={l.vat} onChange={(e) => upd(i, 'vat', e.target.value)} /></td>
                    <td className="right num">{money(c.lineTotal)}</td>
                    <td className="right num">{money(l.product.sell_price)}
                      {low ? <div className="badge red" title="Yeni maliyet satış fiyatından yüksek">Zarar!</div>
                        : c.gross > 0 && l.product.sell_price > 0 && <div className="muted small-text">kâr %{Math.round(((l.product.sell_price - c.gross) / c.gross) * 100)}</div>}</td>
                    <td><button className="btn small ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!lines.length && <div className="empty">Barkod okutun ya da ürün adı yazın</div>}
        </div>

        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          {h.supplier_id ? (
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small-text">Ödeme</strong>
              <div className="tabs">
                {[['none', 'Vadeli (borç)'], ['all', 'Tamamı nakit'], ['cash', 'Kısmi nakit'], ['card', 'Kart'], ['transfer', 'Havale']].map(([k, v]) =>
                  <button key={k} className={`tab ${pay.method === k ? 'active' : ''}`} onClick={() => setPay({ ...pay, method: k, amount: pay.amount || toInput(total) })}>{v}</button>)}
              </div>
              {!['none', 'all'].includes(pay.method) && <input className="input" style={{ maxWidth: 180 }} inputMode="decimal" placeholder="Tutar ₺" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}
              {['all', 'cash'].includes(pay.method) && <small className="muted">Nakit ödeme açık kasadan para çıkışı olarak düşülür.</small>}
            </div>
          ) : <small className="muted">Tedarikçi seçerseniz borç / ödeme takibi yapılır.</small>}
          <div className="stack" style={{ gap: 2, textAlign: 'right', marginLeft: 'auto' }}>
            <div className="muted">Ara toplam (KDV hariç): {money(netTotal)}</div>
            <div className="muted">KDV: {money(total - netTotal)}</div>
            <div style={{ fontSize: 22 }}><strong>{money(total)}</strong></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Tedarikçi fiyat karşılaştırma: bu ürünü kimden en son kaça aldık (KDV hariç); seçili tedarikçi pahalıysa uyarır. */
function SupplierPrices({ productId, supplierId }) {
  const r = useLoad(() => get(`/products/${productId}/supplier-prices`), [productId]);
  const list = r.data?.suppliers || [];
  if (!list.length) return null;
  const cheapest = list[0];
  const mine = supplierId ? list.find((x) => x.supplier_id === supplierId) : null;
  const pricier = mine && cheapest.supplier_id !== mine.supplier_id && mine.last_net > cheapest.last_net;
  return (
    <div className="small-text" title={list.map((x) => `${x.supplier_name}: son ${money(x.last_net)}, en düşük ${money(x.min_net)} (${x.purchase_count} alış)`).join('\n')}>
      {pricier
        ? <span className="warn-text">Daha ucuzu: {cheapest.supplier_name} {money(cheapest.last_net)} (bu tedarikçi {money(mine.last_net)})</span>
        : <span className="muted">Son alışlar: {list.slice(0, 3).map((x) => `${x.supplier_name} ${money(x.last_net)}`).join(' · ')} (KDV hariç)</span>}
    </div>
  );
}

function ProductSearch({ products, onPick }) {
  const [term, setTerm] = useState('');
  const ref = useRef(null);
  const toast = useToast();
  const t = term.trim().toLocaleLowerCase('tr');
  const matches = t.length < 2 ? [] : products.filter((p) => p.type !== 'service' &&
    (p.barcode === term.trim() || p.name.toLocaleLowerCase('tr').includes(t))).slice(0, 8);
  const pick = (p) => { onPick(p); setTerm(''); ref.current?.focus(); };
  const onKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = products.find((p) => p.barcode && p.barcode === term.trim());
    if (exact) pick(exact);
    else if (matches.length === 1) pick(matches[0]);
    else if (!matches.length && term.trim()) toast.err('Ürün bulunamadı. Önce Stok ekranından ekleyin.');
  };
  return (
    <div style={{ position: 'relative' }}>
      <div className="row"><Icon name="barcode" width={22} height={22} style={{ flex: "none" }} /><input ref={ref} className="input" autoFocus placeholder="Barkod okutun veya ürün adı yazın…" value={term}
        onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey} /></div>
      {matches.length > 0 && (
        <div className="card dropdown">
          {matches.map((p) => (
            <button key={p.id} className="dropdown-item" onClick={() => pick(p)}>
              <span>{p.name}</span><span className="muted small-text">{p.barcode} · alış {money(p.buy_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Belge detayı ----------
function PurchaseDetail({ id, onClose }) {
  const toast = useToast();
  const ask = useConfirm();
  const p = useLoad(() => get(`/purchases/${id}`), [id]);
  if (!p.data) return null;
  const x = p.data;
  const cancel = async () => {
    if (!(await ask('Bu alış iptal edilsin mi? Ürünler stoktan geri düşülür, tutar tedarikçi bakiyesinden çıkarılır.', { ok: 'İptal et' }))) return;
    try { await post(`/purchases/${x.id}/cancel`); toast.ok('Alış iptal edildi'); onClose(); } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={`${DOC_TYPES[x.doc_type]} ${x.doc_no || `#${x.id}`}`} onClose={onClose} wide
      footer={<>{x.status === 'posted' && <button className="btn danger" onClick={cancel}>Alışı iptal et</button>}<div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Kapat</button></>}>
      <div className="stack">
        <div className="muted">{d(x.doc_date)} · {x.supplier_name || 'Tedarikçisiz'}{x.branch_name ? ` · ${x.branch_name}` : ''} · giren {x.user_name} ({dt(x.created_at)})
          {x.status === 'cancelled' && <> · <span className="badge red">İptal</span></>}</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ürün</th><th className="right">Miktar</th><th className="right">Birim (KDV hariç)</th><th className="right">KDV</th><th className="right">Birim (dahil)</th><th className="right">Tutar</th></tr></thead>
            <tbody>
              {x.items.map((i) => (
                <tr key={i.id}><td>{i.name}</td><td className="right num">{qty(i.qty)} {i.unit}</td><td className="right num">{money(i.unit_cost_net)}</td>
                  <td className="right num">%{i.vat_rate}</td><td className="right num">{money(i.unit_cost)}</td><td className="right num">{money(i.line_total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted">KDV hariç {money(x.net_total)} · KDV {money(x.vat_total)}</div>
          <div style={{ fontSize: 20 }}><strong>{money(x.total)}</strong>{x.paid > 0 && <span className="muted"> · ödenen {money(x.paid)}</span>}</div>
        </div>
        {x.note && <div className="muted">Not: {x.note}</div>}
      </div>
    </Modal>
  );
}

// ---------- Tedarikçi ----------
function SupplierForm({ supplier, onClose, onSaved }) {
  const toast = useToast();
  const s = supplier || {};
  const [f, setF] = useState({ name: s.name || '', phone: s.phone || '', email: s.email || '', tax_number: s.tax_number || '',
    tax_office: s.tax_office || '', address: s.address || '', note: s.note || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      if (supplier) await put(`/suppliers/${supplier.id}`, f); else await post('/suppliers', f);
      toast.ok('Kaydedildi');
      onSaved();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={supplier ? 'Tedarikçiyi düzenle' : 'Yeni tedarikçi'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" form="sf">Kaydet</button></>}>
      <form id="sf" className="stack" onSubmit={save}>
        <Field label="Firma adı"><input className="input" autoFocus required value={f.name} onChange={set('name')} /></Field>
        <div className="grid-2">
          <Field label="Telefon"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-posta"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="VKN / TCKN"><input className="input" inputMode="numeric" maxLength={11} value={f.tax_number} onChange={set('tax_number')} /></Field>
          <Field label="Vergi dairesi"><input className="input" value={f.tax_office} onChange={set('tax_office')} /></Field>
        </div>
        <Field label="Adres"><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Not" hint="Ör. sipariş günü, temsilci adı"><input className="input" value={f.note} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit, onOpenPurchase }) {
  const s = useLoad(() => get(`/suppliers/${id}`), [id]);
  const [pay, setPay] = useState(null);
  if (!s.data) return null;
  const x = s.data;
  const label = (t) => (t.type === 'purchase' ? 'Alış' : t.type === 'payment' ? `Ödeme (${METHOD_LABELS[t.method] || ''})` : 'Düzeltme');
  return (
    <Modal title={x.name} onClose={onClose} wide
      footer={<><button className="btn" onClick={() => { onClose(); onEdit(x); }}><Icon name="edit" /> Düzenle</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setPay('adjust')}>Bakiye düzelt</button>
        <button className="btn success" disabled={x.balance <= 0} onClick={() => setPay('payment')}>Ödeme yap</button></>}>
      <div className="stack">
        <div className="stats">
          <div className="card stat"><div className="label">Borcumuz</div><div className={`value ${x.balance > 0 ? 'danger-text' : ''}`}>{money(x.balance)}</div>
            {x.balance < 0 && <div className="sub">Tedarikçiden alacaklıyız</div>}</div>
          <div className="card stat"><div className="label">Toplam alış</div><div className="value">{money(x.stats.purchase_total)}</div><div className="sub">{x.stats.purchase_count} belge</div></div>
          <div className="card stat"><div className="label">Son alış</div><div className="value" style={{ fontSize: 18 }}>{x.stats.last_purchase ? d(x.stats.last_purchase) : '—'}</div>
            <div className="sub">{x.phone}{x.tax_number ? ` · VKN ${x.tax_number}` : ''}</div></div>
        </div>
        <h3>Hesap hareketleri</h3>
        <div className="table-wrap" style={{ maxHeight: 340 }}>
          <table className="table">
            <thead><tr><th>Tarih</th><th>İşlem</th><th className="right">Tutar</th><th className="right">Bakiye</th><th>Açıklama</th></tr></thead>
            <tbody>
              {x.transactions.map((t) => (
                <tr key={t.id} className={t.purchase_id ? 'clickable' : ''} onClick={() => t.purchase_id && onOpenPurchase(t.purchase_id)}>
                  <td>{dt(t.created_at)}</td><td>{label(t)}</td>
                  <td className={`right num ${t.amount > 0 ? 'danger-text' : 'success-text'}`}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</td>
                  <td className="right num">{money(t.balance_after)}</td>
                  <td className="muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!x.transactions.length && <div className="empty">Hareket yok</div>}
        </div>
      </div>
      {pay && <SupplierPayment supplier={x} mode={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); s.reload(); }} />}
    </Modal>
  );
}

function SupplierPayment({ supplier, mode, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(mode === 'payment' ? toInput(supplier.balance) : '');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [sign, setSign] = useState(1);
  const save = async (e) => {
    e.preventDefault();
    try {
      if (mode === 'payment') await post(`/suppliers/${supplier.id}/payment`, { amount: toKurus(amount), method, note, register_name: registerName() });
      else await post(`/suppliers/${supplier.id}/adjust`, { amount: sign * toKurus(amount), note });
      toast.ok(mode === 'payment' ? 'Ödeme kaydedildi' : 'Bakiye düzeltildi');
      onDone();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={mode === 'payment' ? `Ödeme · ${supplier.name}` : 'Bakiye düzeltme'} onClose={onClose}
      footer={<button className="btn primary" form="sp">Kaydet</button>}>
      <form id="sp" className="stack" onSubmit={save}>
        <div className="muted">Mevcut borcumuz: <strong>{money(supplier.balance)}</strong></div>
        {mode === 'adjust' && (
          <div className="tabs">
            <button type="button" className={`tab ${sign > 0 ? 'active' : ''}`} onClick={() => setSign(1)}>Borç ekle</button>
            <button type="button" className={`tab ${sign < 0 ? 'active' : ''}`} onClick={() => setSign(-1)}>Borç düş</button>
          </div>
        )}
        <Field label="Tutar (₺)"><input className="input" autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {mode === 'payment' && (
          <>
            <div className="tabs">
              {['cash', 'card', 'transfer'].map((m) => <button type="button" key={m} className={`tab ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{METHOD_LABELS[m]}</button>)}
            </div>
            {method === 'cash' && <small className="muted">Nakit ödeme açık kasadan para çıkışı olarak düşülür (gün sonu doğru çıkar).</small>}
          </>
        )}
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
