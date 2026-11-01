import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { get, loadProducts, post, put } from '../api.js';
import { isManager, useSession } from '../App.jsx';
import { printElement } from '../components/Receipt.jsx';
import { Field, Icon, Modal, useLoad, useToast } from '../components/ui.jsx';
import { dt, money, plain, qty as fmtQty, toInput, toKurus } from '../format.js';
import { TicketScreen } from './Tables.jsx';

export const SOURCE_LABELS = { pos: 'Kasa', phone: 'Telefon', qr: 'QR', yemeksepeti: 'Yemeksepeti', getir: 'Getir', trendyol: 'Trendyol Yemek' };
const COLUMNS = [
  ['new', 'Yeni'], ['preparing', 'Hazırlanıyor'], ['ready', 'Hazır'], ['on_way', 'Yolda'], ['delivered', 'Teslim edildi · ödeme bekliyor'],
];
const NEXT = { new: ['preparing', 'Hazırlamaya başla'], preparing: ['ready', 'Hazır'], ready: ['on_way', 'Yola çıkar'], on_way: ['delivered', 'Teslim edildi'] };
const mins = (s) => (s ? Math.max(0, Math.round((Date.now() - new Date(s.replace(' ', 'T')).getTime()) / 60000)) : 0);

export default function Deliveries() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, settings } = useSession();
  const list = useLoad(() => get('/deliveries'));
  const cfg = useLoad(() => get('/deliveries/settings'));
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => { if (!open && !form) list.reload(); }, 10000);
    return () => clearInterval(t);
  });
  useEffect(() => { if (location.state?.paid) list.reload(); }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (d, body) => {
    try { await put(`/deliveries/${d.id}`, body); list.reload(); } catch (e) { toast.err(e); }
  };
  const decide = async (d, accept) => {
    try {
      if (accept) await post(`/deliveries/${d.id}/accept`, {});
      else {
        const reason = window.prompt('Ret sebebi (platforma iletilir):', 'Restoran yoğun');
        if (reason == null) return;
        await post(`/deliveries/${d.id}/reject`, { reason });
      }
      list.reload();
    } catch (e) { toast.err(e); }
  };
  const simulate = async () => {
    try { await post('/platforms/simulate', { platform: 'yemeksepeti' }); list.reload(); toast.ok('Deneme siparişi geldi'); } catch (e) { toast.err(e); }
  };
  const pay = (d) => navigate('/kasa', { state: { ticket: { id: d.id, table_name: d.table_name, customer_id: d.customer_id, back: '/paket',
    prepaid: !!d.prepaid, discount: d.discount, source: d.source,
    items: d.items.filter((i) => i.remaining_qty > 0).map((i) => ({ ticket_item_id: i.id, product_id: i.product_id, name: i.name, unit: i.unit, qty: i.remaining_qty, unit_price: i.unit_price, vat_rate: i.vat_rate })) } } });

  if (open) {
    return <TicketScreen table={{ id: null, name: open.table_name, ticket_id: open.id }} back="/paket" onBack={() => { setOpen(null); list.reload(); }} />;
  }
  const rows = list.data || [];
  const couriers = cfg.data?.couriers || [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Paket servis</h1>
        <div className="grow" />
        <div className="muted">{rows.length} aktif sipariş</div>
        {isManager(user) && settings.platforms_enabled === '1' && <button className="btn" onClick={simulate}>Deneme platform siparişi</button>}
        {isManager(user) && <button className="btn" onClick={() => setSettingsOpen(true)}>Ayarlar</button>}
        <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" /> Yeni sipariş</button>
      </div>
      <div className="kanban">
        {COLUMNS.map(([st, label]) => {
          const col = rows.filter((d) => (d.delivery_status || 'new') === st && (st !== 'delivered' || d.status === 'open'));
          return (
            <section key={st} className="kanban-col">
              <h3>{label} <span className="badge">{col.length}</span></h3>
              {col.map((d) => (
                <div key={d.id} className={`card order-card ${mins(d.opened_at) > 40 && st !== 'delivered' ? 'late' : ''} ${d.external_status === 'pending' ? 'pending' : ''}`}>
                  <div className="row">
                    <strong style={{ flex: 1 }}>{d.table_name}</strong>
                    <span className={`badge ${d.source === 'pos' || d.source === 'phone' ? '' : 'blue'}`}>{SOURCE_LABELS[d.source] || d.source}</span>
                  </div>
                  <div>{d.customer_name || '—'}{d.phone ? <span className="muted"> · {d.phone}</span> : null}</div>
                  {d.address && <div className="small-text">{d.address}</div>}
                  {d.delivery_note && <div className="small-text warn-text">Not: {d.delivery_note}</div>}
                  <div className="small-text muted">{d.items.filter((i) => !i.void_at).map((i) => `${fmtQty(i.qty)}× ${i.name}`).join(', ')}</div>
                  <div className="row">
                    <strong style={{ flex: 1 }}>{money(d.total)}</strong>
                    <span className="muted small-text">{mins(d.opened_at)} dk{d.payment_hint ? ` · ${d.payment_hint}` : ''}{d.prepaid ? ' · online ödendi' : ''}</span>
                  </div>
                  {d.kind === 'delivery' && ['ready', 'on_way'].includes(st) && (
                    <select className="input" value={d.courier_name || ''} onChange={(e) => update(d, { courier_name: e.target.value })} aria-label="Kurye">
                      <option value="">Kurye seçin…</option>
                      {[...new Set([...couriers, d.courier_name].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  )}
                  <div className="row wrap">
                    <button className="btn small" onClick={() => setOpen(d)}>Aç</button>
                    <button className="btn small ghost" onClick={() => printElement(<DeliverySlip d={d} />)}><Icon name="print" /></button>
                    <div style={{ flex: 1 }} />
                    {d.external_status === 'pending' ? (
                      <>
                        <button className="btn small ghost danger-text" onClick={() => decide(d, false)}>Reddet</button>
                        <button className="btn small success" onClick={() => decide(d, true)}>Kabul et</button>
                      </>
                    ) : NEXT[st] && !(st === 'ready' && d.kind === 'takeaway') && (
                      <button className="btn small primary" onClick={() => update(d, { delivery_status: NEXT[st][0] })}>{NEXT[st][1]}</button>
                    )}
                    {st === 'ready' && d.kind === 'takeaway' && <button className="btn small primary" onClick={() => update(d, { delivery_status: 'delivered' })}>Teslim edildi</button>}
                    {d.status === 'open' && d.remaining_total > 0 && <button className="btn small success" onClick={() => pay(d)}>Ödeme al</button>}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {!rows.length && !list.loading && <div className="card empty">Aktif paket siparişi yok. Telefonla gelen siparişi "Yeni sipariş" ile girin.</div>}
      {form && <NewOrder fee={cfg.data?.fee || 0} onClose={() => setForm(false)} onSaved={(d) => { setForm(false); list.reload(); toast.ok(`${d.table_name} oluşturuldu`); }} />}
      {settingsOpen && <DeliverySettings onClose={() => { setSettingsOpen(false); cfg.reload(); }} />}
    </div>
  );
}

function NewOrder({ fee, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: 'delivery', phone: '', customer_name: '', address: '', delivery_note: '', payment_hint: 'Kapıda nakit', fee: toInput(fee), customer_id: null });
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [hint, setHint] = useState(null);
  const [kitchen, setKitchen] = useState(true);
  useEffect(() => { loadProducts().then(setProducts).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const lookup = async () => {
    try {
      const r = await get(`/deliveries/customer?phone=${encodeURIComponent(f.phone)}`);
      setHint(r);
      if (r) setF((x) => ({ ...x, customer_name: x.customer_name || r.name || '', address: x.address || r.address || '', customer_id: r.customer?.id || null }));
    } catch { /* yok */ }
  };
  const term = q.trim().toLocaleLowerCase('tr');
  const visible = useMemo(() => products.filter((p) => p.type === 'product' && p.sell_price > 0 && (term ? p.name.toLocaleLowerCase('tr').includes(term) : p.favorite)).slice(0, 24), [products, term]);
  const add = (p) => setCart((c) => (c.some((l) => l.product_id === p.id) ? c.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { product_id: p.id, name: p.name, price: p.sell_price, qty: 1, note: '' }]));
  const total = cart.reduce((a, l) => a + l.qty * l.price, 0) + (f.kind === 'delivery' ? toKurus(f.fee) : 0);
  const save = async () => {
    try {
      let d = await post('/deliveries', { ...f, source: 'phone', delivery_fee: f.kind === 'delivery' ? toKurus(f.fee) : 0,
        items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, note: l.note })) });
      if (kitchen) {
        const r = await post(`/tickets/${d.id}/kitchen`);
        d = r.ticket;
        printElement(<DeliverySlip d={d} kitchen />);
      }
      onSaved(d);
    } catch (e) { toast.err(e); }
  };
  return (
    <Modal title="Yeni paket siparişi" onClose={onClose} wide
      footer={<><label className="check" style={{ flex: 1 }}><input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} /> Kaydedince mutfağa gönder</label>
        <button className="btn" onClick={onClose}>Vazgeç</button>
        <button className="btn primary" disabled={!cart.length} onClick={save}>Kaydet · {money(total)}</button></>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="tabs">
            <button className={`tab ${f.kind === 'delivery' ? 'active' : ''}`} onClick={() => setF({ ...f, kind: 'delivery' })}>Paket (adrese)</button>
            <button className={`tab ${f.kind === 'takeaway' ? 'active' : ''}`} onClick={() => setF({ ...f, kind: 'takeaway' })}>Gel-al</button>
          </div>
          <Field label="Telefon" hint={hint ? (hint.customer ? `Kayıtlı müşteri: ${hint.customer.name}` : 'Daha önce sipariş vermiş') : 'Yazıp çıkınca kayıtlı müşteri ve son adres gelir'}>
            <input className="input" inputMode="tel" autoFocus value={f.phone} onChange={set('phone')} onBlur={lookup} />
          </Field>
          <Field label="Ad"><input className="input" value={f.customer_name} onChange={set('customer_name')} /></Field>
          {f.kind === 'delivery' && <Field label="Adres"><textarea className="input" value={f.address} onChange={set('address')} style={{ minHeight: 64 }} /></Field>}
          <Field label="Sipariş notu"><input className="input" placeholder="Zil bozuk, kapıda arayın…" value={f.delivery_note} onChange={set('delivery_note')} /></Field>
          <div className="grid-2">
            <Field label="Ödeme">
              <select className="input" value={f.payment_hint} onChange={set('payment_hint')}>
                {['Kapıda nakit', 'Kapıda kart', 'Havale/EFT'].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            {f.kind === 'delivery' && <Field label="Servis ücreti (₺)"><input className="input" inputMode="decimal" value={f.fee} onChange={set('fee')} /></Field>}
          </div>
        </div>
        <div className="stack">
          <input className="input" placeholder="Ürün ara… (boşken sık satılanlar)" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mini-grid">
            {visible.map((p) => <button key={p.id} className="tile" onClick={() => add(p)}><span className="t-name">{p.name}</span><span className="t-price">{money(p.sell_price)}</span></button>)}
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {cart.map((l, n) => (
                  <tr key={l.product_id}>
                    <td>{l.name}<input className="input" style={{ marginTop: 4 }} placeholder="Not" value={l.note} onChange={(e) => setCart(cart.map((x, j) => (j === n ? { ...x, note: e.target.value } : x)))} /></td>
                    <td style={{ width: 120 }}><div className="qty-ctl">
                      <button onClick={() => setCart(l.qty <= 1 ? cart.filter((_, j) => j !== n) : cart.map((x, j) => (j === n ? { ...x, qty: x.qty - 1 } : x)))}>−</button>
                      <strong style={{ minWidth: 24, textAlign: 'center' }}>{l.qty}</strong>
                      <button onClick={() => setCart(cart.map((x, j) => (j === n ? { ...x, qty: x.qty + 1 } : x)))}>+</button></div></td>
                    <td className="right num">{money(l.qty * l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cart.length && <div className="empty">Ürüne dokunarak ekleyin</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeliverySettings({ onClose }) {
  const toast = useToast();
  const { user, settings, reloadSettings } = useSession();
  const [tab, setTab] = useState('general');
  const [f, setF] = useState({
    fee: toInput(Number(settings.delivery_fee || 0)), couriers: settings.delivery_couriers || '',
    platforms_enabled: settings.platforms_enabled === '1', platform_auto_accept: settings.platform_auto_accept === '1',
    platform_prep_minutes: settings.platform_prep_minutes || '20', platform_callback_url: settings.platform_callback_url || '',
  });
  const [secret, setSecret] = useState(null);
  const status = useLoad(() => get('/platforms/status').catch(() => null));
  const mapping = useLoad(() => get('/platforms/products').catch(() => []));
  const products = useLoad(() => get('/products'));
  const save = async () => {
    try {
      await put('/settings', { delivery_fee: String(toKurus(f.fee)), delivery_couriers: f.couriers,
        platforms_enabled: f.platforms_enabled ? '1' : '0', platform_auto_accept: f.platform_auto_accept ? '1' : '0',
        platform_prep_minutes: String(f.platform_prep_minutes), platform_callback_url: f.platform_callback_url });
      await reloadSettings();
      toast.ok('Kaydedildi');
      onClose();
    } catch (e) { toast.err(e); }
  };
  const newSecret = async () => {
    try { setSecret((await post('/platforms/secret')).secret); status.reload(); } catch (e) { toast.err(e); }
  };
  const mapTo = async (m, productId) => {
    try { await put('/platforms/products', { platform: m.platform, external_id: m.external_id, product_id: productId || null }); mapping.reload(); } catch (e) { toast.err(e); }
  };
  const webhook = `${(settings.public_base_url || `${location.origin}${location.pathname}`).replace(/#.*$/, '').replace(/\/$/, '')}/api/integrations/orders`;
  const st = status.data;
  return (
    <Modal title="Paket servis ayarları" onClose={onClose} wide footer={<button className="btn primary" onClick={save}>Kaydet</button>}>
      <div className="stack">
        <div className="tabs">
          <button className={`tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>Genel</button>
          <button className={`tab ${tab === 'platforms' ? 'active' : ''}`} onClick={() => setTab('platforms')}>Yemek platformları</button>
          <button className={`tab ${tab === 'mapping' ? 'active' : ''}`} onClick={() => setTab('mapping')}>Ürün eşleme {st?.unmapped > 0 && <span className="badge red">{st.unmapped}</span>}</button>
        </div>
        {tab === 'general' && <>
          <Field label="Varsayılan servis ücreti (₺)" hint="0 ise eklenmez"><input className="input" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
          <Field label="Kuryeler" hint="Virgülle ayırın: Ahmet, Mehmet"><input className="input" value={f.couriers} onChange={(e) => setF({ ...f, couriers: e.target.value })} /></Field>
        </>}
        {tab === 'platforms' && <>
          <p className="muted small-text">Yemeksepeti, Trendyol Go / Yemek, Migros Yemek ve Getir siparişleri, platformların onaylı entegratörleri üzerinden bu kasaya düşer.
            Entegratör paneline aşağıdaki webhook adresini ve gizli anahtarı girin; kabul, ret, hazır, yolda ve teslim bilgileri geri bildirim adresine gönderilir.
            Ayrıntılar: docs/YEMEK_PLATFORMLARI.md</p>
          <label className="check"><input type="checkbox" checked={f.platforms_enabled} onChange={(e) => setF({ ...f, platforms_enabled: e.target.checked })} /> Platform siparişlerini al</label>
          <Field label="Sipariş webhook adresi (entegratöre verin)" hint="Bulut kurulumunda herkese açık adres gerekir (Ayarlar → QR menü / online randevu adresi)">
            <input className="input" readOnly value={webhook} onFocus={(e) => e.target.select()} />
          </Field>
          <div className="row wrap">
            <span>Gizli anahtar: {st?.has_secret ? <b>tanımlı</b> : <span className="danger-text">yok</span>}</span>
            {user.role === 'admin' && <button className="btn small" onClick={newSecret}>{st?.has_secret ? 'Yenile' : 'Oluştur'}</button>}
          </div>
          {secret && <div className="banner warn" style={{ borderRadius: 10, flexWrap: 'wrap' }}>Bu anahtar yalnızca şimdi gösterilir, entegratöre girin: <code style={{ userSelect: 'all' }}>{secret}</code></div>}
          <Field label="Geri bildirim adresi" hint="Entegratörün durum güncellemesi aldığı adres (X-VK-Signature imzalı POST)">
            <input className="input" placeholder="https://entegrator.example.com/velariskasa" value={f.platform_callback_url} onChange={(e) => setF({ ...f, platform_callback_url: e.target.value })} />
          </Field>
          <div className="grid-2">
            <label className="check"><input type="checkbox" checked={f.platform_auto_accept} onChange={(e) => setF({ ...f, platform_auto_accept: e.target.checked })} /> Gelen siparişi otomatik kabul et ve mutfağa gönder</label>
            <Field label="Hazırlanma süresi (dk)"><input className="input" inputMode="numeric" value={f.platform_prep_minutes} onChange={(e) => setF({ ...f, platform_prep_minutes: e.target.value })} /></Field>
          </div>
          {st && <div className="small-text muted">Bugün: {st.today.map((x) => `${SOURCE_LABELS[x.source] || x.source} ${x.n}`).join(', ') || 'sipariş yok'} ·
            bildirim kuyruğu: {st.events.pending || 0} bekliyor, {st.events.sent || 0} gönderildi, {st.events.failed || 0} hatalı
            {st.last_error ? ` · son hata: ${st.last_error.error}` : ''}</div>}
        </>}
        {tab === 'mapping' && <>
          <p className="muted small-text">Platformdaki ürünler adı aynıysa otomatik eşlenir. Eşleşmeyenler adisyona adı ve platform fiyatıyla düşer; burada eşlerseniz stok, reçete ve raporlar doğru çalışır.</p>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="table">
              <thead><tr><th>Platform</th><th>Platformdaki ad</th><th>VelarisKasa ürünü</th></tr></thead>
              <tbody>{(mapping.data || []).map((m) => (
                <tr key={`${m.platform}-${m.external_id}`}>
                  <td>{SOURCE_LABELS[m.platform] || m.platform}</td><td>{m.external_name}</td>
                  <td><select className="input" value={m.product_id || ''} onChange={(e) => mapTo(m, Number(e.target.value))}>
                    <option value="">— eşlenmedi —</option>
                    {(products.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></td>
                </tr>
              ))}</tbody>
            </table>
            {!(mapping.data || []).length && <div className="empty">Henüz platform siparişi gelmedi</div>}
          </div>
        </>}
      </div>
    </Modal>
  );
}

/** Paket fişi: mutfak ve kurye için (adres, telefon, not, ödeme). */
export function DeliverySlip({ d, kitchen }) {
  const live = d.items.filter((i) => !i.void_at);
  return (
    <div className="receipt kitchen">
      <div className="c b big">{d.table_name}</div>
      <div className="c">{SOURCE_LABELS[d.source] || ''}{d.external_id ? ` · ${d.external_id}` : ''} · {dt(d.opened_at)}</div>
      <hr />
      {d.customer_name && <div className="b">{d.customer_name}</div>}
      {d.phone && <div>Tel: {d.phone}</div>}
      {d.address && <div>{d.address}</div>}
      {d.delivery_note && <div className="b">Not: {d.delivery_note}</div>}
      <hr />
      {live.map((i) => (
        <div key={i.id}>
          <div className="r"><span className={kitchen ? 'b big' : ''}>{fmtQty(i.qty)} × {i.name}</span>{!kitchen && <span>{plain(Math.round(i.qty * i.unit_price))}</span>}</div>
          {i.note && <div>  → {i.note}</div>}
        </div>
      ))}
      {!kitchen && <><hr /><div className="r b"><span>TOPLAM</span><span>{plain(d.total)}</span></div>
        <div>{d.prepaid ? 'Online ödendi' : d.payment_hint || ''}</div></>}
      <hr />
    </div>
  );
}
