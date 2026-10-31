import { useMemo, useState } from 'react';
import { del, get, post, put } from '../api.js';
import { isManager, useCan, useSession } from '../App.jsx';
import CameraScanner, { cameraSupported } from '../components/CameraScanner.jsx';
import { LABEL_LAYOUTS, LabelSheet } from '../components/Labels.jsx';
import { printElement } from '../components/Receipt.jsx';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, money, parseQty, qty, toInput, toKurus } from '../format.js';

const UNITS = ['adet', 'kg', 'lt', 'm', 'paket', 'kutu'];
const MOVE_LABELS = { in: 'Giriş', out: 'Çıkış', sale: 'Satış', refund: 'İade', adjust: 'Düzeltme', count: 'Sayım' };

export default function Products() {
  const { user } = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [cat, setCat] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const can = useCan();
  const [branch, setBranch] = useState('');
  const branches = useLoad(() => (can('branches') ? get('/branches').then((b) => b.branches.filter((x) => x.active)) : Promise.resolve([])), []);
  const multi = (branches.data || []).length > 1;
  const products = useLoad(() => get(`/products${branch ? `?branch_id=${branch}` : ''}`), [branch]);
  const categories = useLoad(() => get('/categories'));
  const manager = isManager(user);

  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr');
    return (products.data || []).filter((p) =>
      (!s || p.name.toLocaleLowerCase('tr').includes(s) || p.barcode?.includes(s))
      && (!cat || p.category_id === Number(cat))
      && (filter === 'all' || (filter === 'low' && p.track_stock && p.stock <= p.min_stock) || (filter === 'service' && p.type === 'service')));
  }, [products.data, q, cat, filter]);

  const lowCount = (products.data || []).filter((p) => p.track_stock && p.stock <= p.min_stock).length;
  const reload = () => { products.reload(); categories.reload(); };

  const exportCsv = () => {
    const rows = [['ad', 'barkod', 'kategori', 'birim', 'alis_fiyati', 'satis_fiyati', 'kdv', 'stok', 'kritik_stok']];
    for (const p of products.data || []) {
      rows.push([p.name, p.barcode || '', p.category_name || '', p.unit, (p.buy_price / 100).toFixed(2), (p.sell_price / 100).toFixed(2), p.vat_rate, p.stock, p.min_stock]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `urunler-${new Date().toLocaleDateString('sv-SE')}.csv`;
    a.click();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Stok & Ürünler</h1>
        <div className="grow" />
        {manager && <button className="btn" onClick={() => setModal({ type: 'bulk' })}>Toplu fiyat</button>}
        <button className="btn" onClick={() => setModal({ type: 'labels' })}>Etiket yazdır</button>
        {manager && <button className="btn" onClick={() => setModal({ type: 'categories' })}>Kategoriler</button>}
        {manager && <button className="btn" onClick={() => setModal({ type: 'import' })}><Icon name="upload" /> İçe aktar</button>}
        <button className="btn" onClick={exportCsv}><Icon name="download" /> Dışa aktar</button>
        {manager && <button className="btn primary" onClick={() => setModal({ type: 'edit', product: null })}><Icon name="plus" /> Yeni ürün</button>}
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Ürün adı veya barkod…" value={q} onChange={(e) => setQ(e.target.value)} />
        {multi && (
          <select className="input" style={{ maxWidth: 220 }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Şube">
            <option value="">Tüm şubeler (toplam stok)</option>
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select className="input" style={{ maxWidth: 200 }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="tabs">
          <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Tümü</button>
          <button className={`tab ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>Kritik stok {lowCount > 0 && <span className="badge red">{lowCount}</span>}</button>
          <button className={`tab ${filter === 'service' ? 'active' : ''}`} onClick={() => setFilter('service')}>Hizmetler</button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" aria-label="Tümünü seç" checked={list.length > 0 && list.every((p) => selected.has(p.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())} /></th>
            <th>Ürün</th><th>Barkod</th><th>Kategori</th><th className="right">Alış</th><th className="right">Satış</th><th className="right">Stok</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => manager && setModal({ type: 'edit', product: p })}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`${p.name} seç`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td><strong>{p.name}</strong> {p.favorite ? '★' : ''} {p.type === 'service' && <span className="badge blue">Hizmet</span>}
                  {p.recipe_count > 0 && <span className="badge green" title="Satılınca bileşenlerin stoğu düşer">Reçeteli</span>}</td>
                <td className="muted">{p.barcode}</td>
                <td>{p.category_name && <span className="badge" style={{ borderLeft: `4px solid ${p.category_color || '#999'}` }}>{p.category_name}</span>}</td>
                <td className="right num">{money(p.buy_price)}</td>
                <td className="right num"><strong>{money(p.sell_price)}</strong></td>
                <td className="right num">
                  {p.track_stock ? <span className={p.stock <= p.min_stock ? 'badge red' : p.stock <= p.min_stock * 2 ? 'badge yellow' : ''}>{qty(p.stock)} {p.unit}</span> : <span className="muted">—</span>}
                </td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  {p.track_stock ? <button className="btn small" onClick={() => setModal({ type: 'stock', product: p })}>Stok</button> : null}
                  {manager && p.type === 'product' && <button className={`btn small ${p.recipe_count ? '' : 'ghost'}`} style={{ marginLeft: 4 }} onClick={() => setModal({ type: 'recipe', product: p })}>Reçete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">{products.loading ? 'Yükleniyor…' : 'Ürün bulunamadı'}</div>}
      </div>

      {modal?.type === 'edit' && <ProductForm product={modal.product} categories={categories.data || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'stock' && <StockModal product={modal.product} branches={multi ? branches.data : null} defaultBranch={branch} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); toast.ok('Stok güncellendi'); }} />}
      {modal?.type === 'bulk' && <BulkPriceModal selected={[...selected]} categories={categories.data || []} defaultCategory={cat}
        onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.type === 'labels' && <LabelModal selected={(products.data || []).filter((p) => selected.has(p.id))} onClose={() => setModal(null)} onPrinted={reload} />}
      {modal?.type === 'categories' && <CategoryModal categories={categories.data || []} onClose={() => { setModal(null); reload(); }} reload={categories.reload} />}
      {modal?.type === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.type === 'recipe' && <RecipeModal product={modal.product} products={products.data || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </div>
  );
}

/** Reçete: 1 birim ürün için hangi bileşenden ne kadar kullanıldığı. Satışta bileşenlerin stoğu düşer. */
function RecipeModal({ product, products, onClose, onSaved }) {
  const toast = useToast();
  const recipe = useLoad(() => get(`/products/${product.id}/recipe`), [product.id]);
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState('');
  const items = rows ?? (recipe.data?.items || []).map((i) => ({ component_id: i.component_id, qty: String(i.qty).replace('.', ',') }));
  const byId = new Map(products.map((p) => [p.id, p]));
  const candidates = products.filter((p) => p.id !== product.id && p.type === 'product' && !p.recipe_count && !items.some((i) => i.component_id === p.id));
  const cost = items.reduce((a, i) => a + (byId.get(i.component_id)?.buy_price || 0) * (parseQty(i.qty) || 0), 0);
  const upd = (n, v) => setRows(items.map((x, j) => (j === n ? { ...x, qty: v } : x)));
  const save = async () => {
    try {
      await put(`/products/${product.id}/recipe`, { items: items.map((i) => ({ component_id: i.component_id, qty: parseQty(i.qty) })) });
      toast.ok(items.length ? 'Reçete kaydedildi' : 'Reçete kaldırıldı');
      onSaved();
    } catch (e) { toast.err(e); }
  };
  const usedIn = recipe.data?.used_in || [];
  return (
    <Modal title={`Reçete · ${product.name}`} onClose={onClose} wide
      footer={<><div className="muted small-text" style={{ flex: 1 }}>1 {product.unit} {product.name} için gereken malzemeler</div>
        <button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={recipe.loading} onClick={save}>Kaydet</button></>}>
      <div className="stack">
        {usedIn.length > 0 ? (
          <div className="banner warn" style={{ borderRadius: 10 }}>Bu ürün başka ürünlerin reçetesinde bileşen ({usedIn.map((u) => u.name).join(', ')}); kendisine reçete eklenemez.</div>
        ) : (
          <>
            <p className="muted small-text">Satıldığında ürünün kendi stoğu değil, aşağıdaki malzemelerin stoğu düşer. Maliyeti malzemelerin alış fiyatından hesaplanır ve alış fiyatları değiştikçe güncellenir.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Malzeme</th><th style={{ width: 140 }}>Miktar</th><th className="right">Maliyet</th><th className="right">Stok</th><th /></tr></thead>
                <tbody>
                  {items.map((i, n) => {
                    const c = byId.get(i.component_id) || {};
                    return (
                      <tr key={i.component_id}>
                        <td><strong>{c.name}</strong></td>
                        <td><div className="row"><input className="input" inputMode="decimal" value={i.qty} onChange={(e) => upd(n, e.target.value)} /><span className="muted">{c.unit}</span></div></td>
                        <td className="right num">{money(Math.round((c.buy_price || 0) * (parseQty(i.qty) || 0)))}</td>
                        <td className="right num">{c.track_stock ? `${qty(c.stock)} ${c.unit}` : '—'}</td>
                        <td className="right"><button className="btn small ghost" onClick={() => setRows(items.filter((_, j) => j !== n))}><Icon name="trash" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!items.length && <div className="empty">Henüz malzeme yok. Örnek: Kaşarlı tost → 2 adet tost ekmeği + 0,05 kg kaşar.</div>}
            </div>
            <div className="row">
              <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Malzeme seçin…</option>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
              <button className="btn" disabled={!pick} onClick={() => { setRows([...items, { component_id: Number(pick), qty: '1' }]); setPick(''); }}><Icon name="plus" /> Ekle</button>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 16 }}>
              <span>Maliyet: <strong>{money(Math.round(cost))}</strong></span>
              <span>Satış: <strong>{money(product.sell_price)}</strong></span>
              {cost > 0 && product.sell_price > 0 && <span className={product.sell_price > cost ? 'success-text' : 'danger-text'}>Kâr %{Math.round(((product.sell_price - cost) / cost) * 100)}</span>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const toast = useToast();
  const ask = useConfirm();
  const { settings } = useSession();
  const p = product || {};
  const [f, setF] = useState({
    name: p.name || '', barcode: p.barcode || '', category_id: p.category_id || '', type: p.type || 'product', unit: p.unit || 'adet',
    buy_price: toInput(p.buy_price), sell_price: toInput(p.sell_price), vat_rate: p.vat_rate ?? Number(settings.default_vat || 20),
    stock: '', min_stock: p.min_stock ?? '', track_stock: p.track_stock ?? 1, duration_min: p.duration_min || '', favorite: p.favorite || 0,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const [camera, setCamera] = useState(false);
  const [suggest, setSuggest] = useState(null);
  const lookup = async (code) => {
    setSuggest(null);
    if (!/^\d{8,14}$/.test(code || '') || f.name) return;
    try { setSuggest(await get(`/products/lookup/${code}`)); } catch { /* bulunamadı */ }
  };
  const buy = toKurus(f.buy_price);
  const sell = toKurus(f.sell_price);
  const margin = buy > 0 && sell > 0 ? (((sell - buy) / buy) * 100).toFixed(0) : null;

  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, buy_price: buy, sell_price: sell, stock: parseQty(f.stock), min_stock: parseQty(f.min_stock), category_id: f.category_id || null };
    try {
      if (product) await put(`/products/${product.id}`, body);
      else await post('/products', body);
      toast.ok('Kaydedildi');
      onSaved();
    } catch (err) { toast.err(err); }
  };
  const remove = async () => {
    if (!(await ask(`${product.name} silinsin mi? Geçmiş satışlar korunur.`, { ok: 'Sil' }))) return;
    try { await del(`/products/${product.id}`); onSaved(); } catch (err) { toast.err(err); }
  };
  const service = f.type === 'service';

  return (
    <Modal title={product ? 'Ürünü düzenle' : 'Yeni ürün / hizmet'} onClose={onClose} wide
      footer={<>{product && <button className="btn danger" onClick={remove}>Sil</button>}<div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" form="pf">Kaydet</button></>}>
      <form id="pf" className="stack" onSubmit={save}>
        <div className="tabs">
          <button type="button" className={`tab ${!service ? 'active' : ''}`} onClick={() => setF({ ...f, type: 'product' })}>Ürün</button>
          <button type="button" className={`tab ${service ? 'active' : ''}`} onClick={() => setF({ ...f, type: 'service', track_stock: 0 })}>Hizmet (stoksuz)</button>
        </div>
        <div className="grid-2">
          <Field label="Ad"><input className="input" autoFocus required value={f.name} onChange={set('name')} /></Field>
          <Field label="Barkod">
            <div className="row">
              <input className="input" value={f.barcode} onChange={set('barcode')} onBlur={(e) => lookup(e.target.value)} placeholder="Okutun veya yazın" />
              {cameraSupported() && <button type="button" className="btn" onClick={() => setCamera(true)} aria-label="Kamerayla okut"><Icon name="camera" /></button>}
            </div>
          </Field>
        </div>
        {suggest && (
          <div className="row small-text success-text">
            <span style={{ flex: 1 }}>İnternette bulundu: <b>{suggest.name}</b></span>
            <button type="button" className="btn small" onClick={() => { setF({ ...f, name: suggest.name }); setSuggest(null); }}>Adı kullan</button>
          </div>
        )}
        {camera && <CameraScanner onClose={() => setCamera(false)} onResult={(code) => { setCamera(false); setF((x) => ({ ...x, barcode: code })); lookup(code); }} />}
        <div className="grid-3">
          <Field label="Kategori">
            <select className="input" value={f.category_id} onChange={set('category_id')}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Birim"><select className="input" value={f.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
          <Field label="KDV %"><select className="input" value={f.vat_rate} onChange={set('vat_rate')}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
        </div>
        <div className="grid-3">
          {!service && (p.recipe_count > 0
            ? <Field label="Maliyet (₺)" hint="Reçeteden hesaplanır"><input className="input" value={f.buy_price} readOnly /></Field>
            : <Field label="Alış fiyatı (₺)"><input className="input" inputMode="decimal" value={f.buy_price} onChange={set('buy_price')} /></Field>)}
          <Field label="Satış fiyatı (₺, KDV dahil)" hint={margin != null ? `Kâr marjı: %${margin}` : null}><input className="input" inputMode="decimal" value={f.sell_price} onChange={set('sell_price')} /></Field>
          {service && <Field label="Süre (dk, randevu için)"><input className="input" inputMode="numeric" value={f.duration_min} onChange={set('duration_min')} /></Field>}
        </div>
        {!service && p.recipe_count > 0 && <div className="muted small-text">Reçeteli ürün: satıldığında malzemelerin stoğu düşer (Stok listesinde "Reçete").</div>}
        {!service && !p.recipe_count && (
          <>
            <label className="check"><input type="checkbox" checked={!!f.track_stock} onChange={set('track_stock')} /> Stok takibi yap</label>
            {!!f.track_stock && (
              <div className="grid-3">
                {!product && <Field label="Açılış stoku"><input className="input" inputMode="decimal" value={f.stock} onChange={set('stock')} /></Field>}
                <Field label="Kritik stok seviyesi" hint="Bu seviyeye düşünce uyarı verilir"><input className="input" inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} /></Field>
              </div>
            )}
          </>
        )}
        <label className="check"><input type="checkbox" checked={!!f.favorite} onChange={set('favorite')} /> Kasada hızlı tuş olarak göster (★)</label>
      </form>
    </Modal>
  );
}

function StockModal({ product, branches, defaultBranch, onClose, onSaved }) {
  const [branchId, setBranchId] = useState(String(defaultBranch || branches?.[0]?.id || 1));
  const perBranch = useLoad(() => (branches ? get(`/products/${product.id}/branches`) : Promise.resolve(null)), [product.id]);
  const [tr, setTr] = useState({ to: '', qty: '' });
  const toast = useToast();
  const [type, setType] = useState('in');
  const [f, setF] = useState({ qty: '', unit_cost: toInput(product.buy_price), note: '' });
  const moves = useLoad(() => get(`/stock-movements?product_id=${product.id}&limit=30`), [product.id]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await post(`/products/${product.id}/stock`, { type, qty: parseQty(f.qty), unit_cost: type === 'in' ? toKurus(f.unit_cost) : null, note: f.note, branch_id: branches ? Number(branchId) : undefined });
      onSaved();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={`${product.name} — Stok`} onClose={onClose} wide>
      <div className="stack">
        <div className="row"><span className="muted">{branches ? 'Toplam stok:' : 'Mevcut stok:'}</span><strong style={{ fontSize: 20 }}>{qty(product.total_stock ?? product.stock)} {product.unit}</strong></div>
        {branches && perBranch.data && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 14 }}>
              {perBranch.data.map((b) => <span key={b.id}><span className="muted">{b.name}:</span> <b className="num">{qty(b.stock)}</b></span>)}
            </div>
            <form className="row wrap" onSubmit={async (e) => {
              e.preventDefault();
              try {
                perBranch.setData(await post('/stock/transfer', { product_id: product.id, from_branch_id: Number(branchId), to_branch_id: Number(tr.to), qty: parseQty(tr.qty) }));
                setTr({ to: '', qty: '' });
                toast.ok('Transfer yapıldı');
              } catch (err) { toast.err(err); }
            }}>
              <span className="small-text muted">Transfer: {branches.find((b) => String(b.id) === branchId)?.name} →</span>
              <select className="input" style={{ width: 160 }} required value={tr.to} onChange={(e) => setTr({ ...tr, to: e.target.value })} aria-label="Hedef şube">
                <option value="">Şube seçin</option>
                {branches.filter((b) => String(b.id) !== branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input className="input" style={{ width: 100 }} required inputMode="decimal" placeholder="Miktar" value={tr.qty} onChange={(e) => setTr({ ...tr, qty: e.target.value })} aria-label="Transfer miktarı" />
              <button className="btn small">Gönder</button>
            </form>
          </div>
        )}
        <form className="stack card card-pad" onSubmit={save}>
          {branches && (
            <Field label="Şube">
              <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <div className="tabs">
            {[['in', 'Mal girişi'], ['out', 'Çıkış / Fire'], ['count', 'Sayım (yeni miktar)']].map(([k, l]) =>
              <button type="button" key={k} className={`tab ${type === k ? 'active' : ''}`} onClick={() => setType(k)}>{l}</button>)}
          </div>
          <div className="grid-3">
            <Field label={type === 'count' ? 'Sayılan miktar' : 'Miktar'}><input className="input" autoFocus required inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            {type === 'in' && <Field label="Birim alış fiyatı (₺)"><input className="input" inputMode="decimal" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} /></Field>}
            <Field label="Not"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={type === 'in' ? 'Tedarikçi / fatura no' : 'Açıklama'} /></Field>
          </div>
          <button className="btn primary">Kaydet</button>
        </form>
        <h3>Son hareketler</h3>
        <div className="table-wrap" style={{ maxHeight: 280 }}>
          <table className="table">
            <thead><tr><th>Tarih</th><th>Tür</th>{branches && <th>Şube</th>}<th className="right">Miktar</th><th className="right">Sonra</th><th>Not</th><th>Kullanıcı</th></tr></thead>
            <tbody>
              {(moves.data || []).map((m) => (
                <tr key={m.id}>
                  <td>{dt(m.created_at)}</td><td>{MOVE_LABELS[m.type]}</td>{branches && <td>{m.branch_name}</td>}
                  <td className={`right num ${m.qty < 0 ? 'danger-text' : 'success-text'}`}>{m.qty > 0 ? '+' : ''}{qty(m.qty)}</td>
                  <td className="right num">{qty(m.stock_after)}</td><td className="muted">{m.note}</td><td>{m.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function LabelModal({ selected, onClose, onPrinted }) {
  const toast = useToast();
  const { settings } = useSession();
  const [source, setSource] = useState(selected.length ? 'selected' : 'due');
  const due = useLoad(() => get('/products?label_due=1'));
  const [layout, setLayout] = useState('a4-shelf');
  const [copies, setCopies] = useState(1);
  const items = source === 'selected' ? selected : due.data || [];
  const print = async () => {
    printElement(<LabelSheet products={items} layout={layout} copies={Number(copies) || 1} business={settings.business_name} />, LABEL_LAYOUTS[layout].page);
    try { await post('/products/labels-printed', { ids: items.map((p) => p.id) }); onPrinted?.(); } catch { /* işaretleme başarısızsa etiket yine basıldı */ }
  };
  return (
    <Modal title="Etiket yazdır" onClose={onClose} wide
      footer={<><span className="muted small-text" style={{ flex: 1 }}>{items.length} ürün × {copies} kopya</span>
        <button className="btn primary" disabled={!items.length} onClick={print}>Yazdır</button></>}>
      <div className="stack">
        <div className="tabs">
          <button className={`tab ${source === 'selected' ? 'active' : ''}`} disabled={!selected.length} onClick={() => setSource('selected')}>Seçili ürünler ({selected.length})</button>
          <button className={`tab ${source === 'due' ? 'active' : ''}`} onClick={() => setSource('due')}>Fiyatı değişenler ({due.data?.length ?? '…'})</button>
        </div>
        {!selected.length && <small className="muted">Belirli ürünler için listede onay kutularıyla seçim yapın.</small>}
        <div className="grid-2">
          <Field label="Etiket türü ve kâğıt">
            <select className="input" value={layout} onChange={(e) => setLayout(e.target.value)}>
              {Object.entries(LABEL_LAYOUTS).map(([k, l]) => <option key={k} value={k}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Her üründen kopya"><input className="input" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} /></Field>
        </div>
        {items.length > 0 ? (
          <div className="label-preview"><LabelSheet products={items.slice(0, 12)} layout={layout} copies={1} business={settings.business_name} /></div>
        ) : <div className="empty">{source === 'due' ? 'Fiyatı değişmiş, etiketi basılmamış ürün yok.' : 'Ürün seçilmedi.'}</div>}
        <small className="muted">Raf etiketinde fiyat değişiklik tarihi yer alır (Fiyat Etiketi Yönetmeliği). Önizlemede ilk 12 etiket gösterilir.</small>
      </div>
    </Modal>
  );
}

function BulkPriceModal({ selected, categories, defaultCategory, onClose, onDone }) {
  const toast = useToast();
  const [scope, setScope] = useState(selected.length ? 'selected' : defaultCategory ? 'category' : 'all');
  const [catId, setCatId] = useState(defaultCategory || categories[0]?.id || '');
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  const [step, setStep] = useState(25);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = (dry) => ({
    scope: scope === 'selected' ? { ids: selected } : scope === 'category' ? { category_id: Number(catId) } : { all: true },
    mode, value: mode === 'amount' ? toKurus(value) : parseQty(value), round: Number(step), dry,
  });
  const run = async (dry) => {
    setBusy(true);
    try {
      const r = await post('/products/bulk-price', body(dry));
      if (dry) setPreview(r);
      else { toast.ok(`${r.count} ürünün fiyatı güncellendi`); onDone(); }
    } catch (err) { toast.err(err); } finally { setBusy(false); }
  };
  const changed = () => setPreview(null);
  return (
    <Modal title="Toplu fiyat güncelleme" onClose={onClose} wide
      footer={<>
        <button className="btn" disabled={busy || value === ''} onClick={() => run(true)}>Önizle</button>
        <button className="btn primary" disabled={busy || !preview?.count} onClick={() => run(false)}>{preview ? `${preview.count} ürünü güncelle` : 'Önce önizleyin'}</button>
      </>}>
      <div className="stack">
        <div className="tabs">
          {selected.length > 0 && <button className={`tab ${scope === 'selected' ? 'active' : ''}`} onClick={() => { setScope('selected'); changed(); }}>Seçili {selected.length} ürün</button>}
          <button className={`tab ${scope === 'category' ? 'active' : ''}`} onClick={() => { setScope('category'); changed(); }}>Kategori</button>
          <button className={`tab ${scope === 'all' ? 'active' : ''}`} onClick={() => { setScope('all'); changed(); }}>Tüm ürünler</button>
        </div>
        {scope === 'category' && (
          <select className="input" value={catId} onChange={(e) => { setCatId(e.target.value); changed(); }} aria-label="Kategori">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="grid-3">
          <Field label="Yöntem">
            <select className="input" value={mode} onChange={(e) => { setMode(e.target.value); changed(); }}>
              <option value="percent">Satış fiyatına % zam / indirim</option>
              <option value="amount">Satış fiyatına TL ekle / çıkar</option>
              <option value="margin">Alış fiyatı + % kâr</option>
            </select>
          </Field>
          <Field label={mode === 'amount' ? 'Tutar (₺, indirim için eksi)' : mode === 'margin' ? 'Kâr oranı (%)' : 'Oran (%, indirim için eksi)'}>
            <input className="input" autoFocus inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); changed(); }} placeholder={mode === 'margin' ? '30' : '10'} />
          </Field>
          <Field label="Yuvarlama">
            <select className="input" value={step} onChange={(e) => { setStep(e.target.value); changed(); }}>
              <option value={0}>Yok</option><option value={25}>0,25 ₺</option><option value={50}>0,50 ₺</option>
              <option value={100}>1 ₺</option><option value={500}>5 ₺</option>
            </select>
          </Field>
        </div>
        {preview && (
          <>
            <div className="muted small-text">{preview.count} ürünün fiyatı değişecek{preview.skipped.length ? `, ${preview.skipped.length} ürün atlanacak (${preview.skipped[0].reason})` : ''}.</div>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="table">
                <thead><tr><th>Ürün</th><th className="right">Alış</th><th className="right">Eski</th><th className="right">Yeni</th><th className="right">Fark</th></tr></thead>
                <tbody>
                  {preview.changes.map((c) => (
                    <tr key={c.id}><td>{c.name}</td><td className="right num muted">{money(c.buy_price)}</td><td className="right num">{money(c.old_price)}</td>
                      <td className="right num"><strong>{money(c.new_price)}</strong></td>
                      <td className={`right num ${c.new_price > c.old_price ? 'danger-text' : 'success-text'}`}>{c.new_price > c.old_price ? '+' : ''}{money(c.new_price - c.old_price)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CategoryModal({ categories, onClose, reload }) {
  const toast = useToast();
  const ask = useConfirm();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const add = async (e) => {
    e.preventDefault();
    try { await post('/categories', { name, color, sort_order: categories.length }); setName(''); reload(); } catch (err) { toast.err(err); }
  };
  return (
    <Modal title="Kategoriler" onClose={onClose}>
      <div className="stack">
        <form className="row" onSubmit={add}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 40, border: 0, background: 'none' }} aria-label="Renk" />
          <input className="input" required placeholder="Yeni kategori adı" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary">Ekle</button>
        </form>
        {categories.map((c) => (
          <div key={c.id} className="row">
            <input type="color" defaultValue={c.color || '#999999'} style={{ width: 44, height: 36, border: 0, background: 'none' }} aria-label="Renk"
              onBlur={(e) => put(`/categories/${c.id}`, { ...c, color: e.target.value }).then(reload)} />
            <input className="input" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && put(`/categories/${c.id}`, { ...c, name: e.target.value }).then(reload)} />
            <span className="muted small-text" style={{ whiteSpace: 'nowrap' }}>{c.product_count} ürün</span>
            <button className="btn small" onClick={async () => (await ask(`${c.name} kategorisi silinsin mi?`, { ok: 'Sil' })) && del(`/categories/${c.id}`).then(reload)} aria-label="Sil"><Icon name="trash" /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** CSV (; veya , ayraçlı) içe aktarma. Başlıklar: ad, barkod, kategori, birim, alis_fiyati, satis_fiyati, kdv, stok, kritik_stok */
function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);

  const parse = async (file) => {
    const text = (await file.text()).replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = (line) => {
      const out = []; let cur = ''; let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
        else if (ch === sep && !quoted) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const head = split(lines[0]).map((h) => h.toLocaleLowerCase('tr').replace(/\s+/g, '_'));
    const idx = (...names) => head.findIndex((h) => names.includes(h));
    const col = { name: idx('ad', 'urun', 'ürün', 'urun_adi', 'ürün_adı', 'name'), barcode: idx('barkod', 'barcode'), category: idx('kategori', 'category'),
      unit: idx('birim', 'unit'), buy: idx('alis_fiyati', 'alış_fiyatı', 'alis', 'alış', 'buy_price'), sell: idx('satis_fiyati', 'satış_fiyatı', 'satis', 'satış', 'fiyat', 'sell_price'),
      vat: idx('kdv', 'vat', 'vat_rate'), stock: idx('stok', 'stock'), min: idx('kritik_stok', 'min_stok', 'min_stock') };
    if (col.name < 0) return toast.err('CSV\'de "ad" sütunu bulunamadı');
    const v = (r, i) => (i >= 0 ? r[i] : undefined);
    setRows(lines.slice(1).map(split).filter((r) => v(r, col.name)).map((r) => ({
      name: v(r, col.name), barcode: v(r, col.barcode) || null, category: v(r, col.category) || null, unit: v(r, col.unit) || 'adet',
      buy_price: toKurus(v(r, col.buy) || 0), sell_price: toKurus(v(r, col.sell) || 0), vat_rate: parseQty(v(r, col.vat) || 20),
      stock: v(r, col.stock) !== undefined && v(r, col.stock) !== '' ? parseQty(v(r, col.stock)) : undefined, min_stock: parseQty(v(r, col.min) || 0),
    })));
  };

  const run = async () => {
    try { setResult(await post('/products/import', { rows })); } catch (err) { toast.err(err); }
  };

  return (
    <Modal title="Ürünleri içe aktar (CSV / Excel)" onClose={result ? onDone : onClose} wide
      footer={result ? <button className="btn primary" onClick={onDone}>Kapat</button> : <button className="btn primary" disabled={!rows.length} onClick={run}>{rows.length} ürünü aktar</button>}>
      <div className="stack">
        <p className="muted">Excel'de dosyayı <b>CSV (noktalı virgülle ayrılmış)</b> olarak kaydedin. Sütunlar: <code>ad; barkod; kategori; birim; alis_fiyati; satis_fiyati; kdv; stok; kritik_stok</code>. Barkodu eşleşen ürünler güncellenir.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0] && parse(e.target.files[0])} />
        {result && <div className="card card-pad"><b>{result.created}</b> yeni, <b>{result.updated}</b> güncellendi{result.errors.length ? `, ${result.errors.length} hata` : ''}.
          {result.errors.slice(0, 10).map((e) => <div key={e.row} className="danger-text small-text">Satır {e.row}: {e.error}</div>)}</div>}
        {!result && rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="table"><thead><tr><th>Ad</th><th>Barkod</th><th>Kategori</th><th className="right">Satış</th><th className="right">Stok</th></tr></thead>
              <tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.barcode}</td><td>{r.category}</td><td className="right">{money(r.sell_price)}</td><td className="right">{r.stock ?? '—'}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
