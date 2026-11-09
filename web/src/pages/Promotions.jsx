import { useState } from 'react';
import { del, get, post, put } from '../api.js';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { money, toInput, toKurus } from '../format.js';

const TYPES = [
  ['bxgy', 'X al Y öde', 'Ör. 3 al 2 öde: aynı üründen her 3 adette 1 bedava'],
  ['nth', 'N. ürüne indirim', 'Ör. 2. ürüne %50: aynı üründen her 2. adet yarı fiyat'],
  ['percent', 'Yüzde indirim', 'Kapsamdaki ürünlere %; saat ve gün seçerek "happy hour"'],
  ['basket', 'Sepet tutarı üzeri', 'Ör. 500 ₺ ve üzeri alışverişe %10 ya da 50 ₺ indirim'],
];
const DAYS = [[1, 'Pzt'], [2, 'Sal'], [3, 'Çar'], [4, 'Per'], [5, 'Cum'], [6, 'Cmt'], [7, 'Paz']];

export function describePromo(p) {
  const scope = p.scope === 'product' ? p.product_name : p.scope === 'category' ? `${p.category_name} kategorisi` : 'tüm ürünler';
  const what = p.type === 'bxgy' ? `${p.buy_qty} al ${p.pay_qty} öde` : p.type === 'nth' ? `${p.nth}. ürüne %${p.percent}`
    : p.type === 'percent' ? `%${p.percent} indirim` : `${money(p.min_total)} üzeri ${p.amount ? money(p.amount) : `%${p.percent}`} indirim`;
  const when = [p.days && p.days.split(',').map((d) => DAYS[d - 1]?.[1]).join(' '), p.time_from && `${p.time_from}–${p.time_to}`,
    (p.date_from || p.date_to) && `${p.date_from || '…'} / ${p.date_to || '…'}`].filter(Boolean).join(' · ');
  return `${what}${p.type !== 'basket' ? ` · ${scope}` : ''}${when ? ` · ${when}` : ''}`;
}

/** Stok → Kampanyalar: kampanya listesi, ekle / düzenle / kapat */
export default function PromotionsModal({ onClose }) {
  const toast = useToast();
  const ask = useConfirm();
  const list = useLoad(() => get('/promotions'));
  const [edit, setEdit] = useState(null);
  const toggle = async (p) => { try { await put(`/promotions/${p.id}`, { active: !p.active }); list.reload(); } catch (e) { toast.err(e); } };
  const remove = async (p) => { if (await ask(`"${p.name}" kampanyası silinsin mi?`, { ok: 'Sil' })) { await del(`/promotions/${p.id}`); list.reload(); } };
  if (edit) return <PromotionForm promo={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />;
  return (
    <Modal title="Kampanyalar" onClose={onClose} wide footer={<button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" /> Yeni kampanya</button>}>
      <div className="stack">
        <div className="muted small-text">Kampanyalar kasada sepete kendiliğinden uygulanır ve fişte "Kampanya" olarak yazar. Kasiyerin indirim yetkisi gerekmez.</div>
        {(list.data || []).map((p) => (
          <div key={p.id} className="row card card-pad" style={{ opacity: p.active ? 1 : 0.55 }}>
            <div style={{ flex: 1 }}>
              <strong>{p.name}</strong>{!p.active && <span className="badge" style={{ marginLeft: 6 }}>kapalı</span>}
              <div className="muted small-text">{describePromo(p)}{p.used_count ? ` · ${p.used_count} satırda kullanıldı` : ''}</div>
            </div>
            <button className="btn small" onClick={() => toggle(p)}>{p.active ? 'Kapat' : 'Aç'}</button>
            <button className="btn small" onClick={() => setEdit(p)}><Icon name="edit" /></button>
            <button className="btn small" onClick={() => remove(p)} aria-label="Sil"><Icon name="trash" /></button>
          </div>
        ))}
        {list.data && !list.data.length && <div className="empty">Henüz kampanya yok. "Yeni kampanya" ile ekleyin.</div>}
      </div>
    </Modal>
  );
}

function PromotionForm({ promo, onClose, onSaved }) {
  const toast = useToast();
  const products = useLoad(() => get('/products'));
  const categories = useLoad(() => get('/categories'));
  const [f, setF] = useState({
    name: promo.name || '', type: promo.type || 'bxgy', scope: promo.scope || 'product', product_id: promo.product_id || '', category_id: promo.category_id || '',
    buy_qty: promo.buy_qty ?? 3, pay_qty: promo.pay_qty ?? 2, nth: promo.nth ?? 2, percent: promo.percent ?? (promo.type ? '' : 50),
    amount: promo.amount ? toInput(promo.amount) : '', min_total: promo.min_total ? toInput(promo.min_total) : '',
    days: promo.days ? promo.days.split(',').map(Number) : [], time_from: promo.time_from || '', time_to: promo.time_to || '',
    date_from: promo.date_from || '', date_to: promo.date_to || '', active: promo.active ?? 1,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [q, setQ] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, amount: f.amount ? toKurus(f.amount) : null, min_total: f.min_total ? toKurus(f.min_total) : null, percent: f.percent === '' ? null : Number(String(f.percent).replace(',', '.')) };
    try { if (promo.id) await put(`/promotions/${promo.id}`, body); else await post('/promotions', body); toast.ok('Kampanya kaydedildi'); onSaved(); } catch (err) { toast.err(err); }
  };
  const plist = (products.data || []).filter((p) => !q || p.name.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')) || p.barcode?.includes(q)).slice(0, 50);
  const sel = (products.data || []).find((p) => p.id === Number(f.product_id));
  return (
    <Modal title={promo.id ? 'Kampanyayı düzenle' : 'Yeni kampanya'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" form="promo-form">Kaydet</button></>}>
      <form id="promo-form" className="stack" onSubmit={save}>
        <Field label="Kampanya adı (fişte yazar)"><input className="input" required value={f.name} onChange={set('name')} placeholder="Ör. Kola 3 al 2 öde" /></Field>
        <div className="grid-2">
          {TYPES.map(([k, l, d]) => (
            <button type="button" key={k} className="card card-pad" onClick={() => setF({ ...f, type: k, scope: k === 'basket' ? 'all' : f.scope })}
              style={{ textAlign: 'left', borderColor: f.type === k ? 'var(--primary)' : undefined, boxShadow: f.type === k ? '0 0 0 3px var(--primary-soft)' : undefined }}>
              <strong>{l}</strong><div className="muted small-text">{d}</div>
            </button>
          ))}
        </div>
        {f.type === 'bxgy' && <div className="grid-3"><Field label="Kaç adet alınca (X)"><input className="input" inputMode="numeric" value={f.buy_qty} onChange={set('buy_qty')} /></Field><Field label="Kaç adet ödenir (Y)"><input className="input" inputMode="numeric" value={f.pay_qty} onChange={set('pay_qty')} /></Field></div>}
        {f.type === 'nth' && <div className="grid-3"><Field label="Kaçıncı üründe (N)"><input className="input" inputMode="numeric" value={f.nth} onChange={set('nth')} /></Field><Field label="İndirim (%)"><input className="input" inputMode="decimal" value={f.percent} onChange={set('percent')} /></Field></div>}
        {f.type === 'percent' && <div className="grid-3"><Field label="İndirim (%)"><input className="input" inputMode="decimal" value={f.percent} onChange={set('percent')} /></Field></div>}
        {f.type === 'basket' && (
          <div className="grid-3">
            <Field label="Sepet en az (₺)"><input className="input" inputMode="decimal" value={f.min_total} onChange={set('min_total')} placeholder="500" /></Field>
            <Field label="İndirim (%)"><input className="input" inputMode="decimal" value={f.percent ?? ''} onChange={(e) => setF({ ...f, percent: e.target.value, amount: '' })} placeholder="10" /></Field>
            <Field label="ya da tutar (₺)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value, percent: '' })} placeholder="50" /></Field>
          </div>
        )}
        {f.type !== 'basket' && (
          <>
            <div className="tabs">
              {[['product', 'Bir ürün'], ['category', 'Bir kategori'], ['all', 'Tüm ürünler']].map(([k, l]) => <button type="button" key={k} className={`tab ${f.scope === k ? 'active' : ''}`} onClick={() => setF({ ...f, scope: k })}>{l}</button>)}
            </div>
            {f.scope === 'product' && (
              <div className="stack" style={{ gap: 6 }}>
                {sel && <div>Seçili ürün: <b>{sel.name}</b> ({money(sel.sell_price)})</div>}
                <input className="input" placeholder="Ürün ara (ad ya da barkod)…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <div className="stack" style={{ gap: 4, maxHeight: 200, overflow: 'auto' }}>{plist.map((p) => <button type="button" key={p.id} className="dropdown-item" onClick={() => { setF({ ...f, product_id: p.id }); setQ(''); }}><span>{p.name}</span><span className="muted">{money(p.sell_price)}</span></button>)}</div>}
              </div>
            )}
            {f.scope === 'category' && (
              <Field label="Kategori"><select className="input" value={f.category_id} onChange={set('category_id')}><option value="">— Seçin —</option>{(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            )}
          </>
        )}
        <details>
          <summary style={{ cursor: 'pointer' }}>Ne zaman geçerli? (boş bırakırsanız her zaman)</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {DAYS.map(([d, l]) => <label key={d} className="check"><input type="checkbox" checked={f.days.includes(d)} onChange={(e) => setF({ ...f, days: e.target.checked ? [...f.days, d].sort() : f.days.filter((x) => x !== d) })} /> {l}</label>)}
            </div>
            <div className="grid-3">
              <Field label="Saat başlangıç"><input className="input" type="time" value={f.time_from} onChange={set('time_from')} /></Field>
              <Field label="Saat bitiş"><input className="input" type="time" value={f.time_to} onChange={set('time_to')} /></Field>
              <div />
              <Field label="Başlangıç tarihi"><input className="input" type="date" value={f.date_from} onChange={set('date_from')} /></Field>
              <Field label="Bitiş tarihi"><input className="input" type="date" value={f.date_to} onChange={set('date_to')} /></Field>
            </div>
          </div>
        </details>
      </form>
    </Modal>
  );
}
