import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { get, loadProducts, post, registerName, storage, submitSale, uuid } from '../api.js';
import { useCan, useSession } from '../App.jsx';
import CameraScanner, { cameraSupported } from '../components/CameraScanner.jsx';
import { printReceipt } from '../components/Receipt.jsx';
import { Field, Icon, Modal, useConfirm, useToast } from '../components/ui.jsx';
import NumPad, { applyKey } from '../components/NumPad.jsx';
import { softKeyboardDefault } from '../softKeyboard.js';
import { applyPromotions, localNow } from '../../../server/promotions.js';
import { METHOD_LABELS, money, nowSql, parseQty, plain, qty as fmtQty, toInput, toKurus } from '../format.js';

const lineTotal = (l) => Math.round(l.qty * l.unit_price) - (l.discount || 0);

/** Fiş yazıcısı seçili ve "nakit satışta çekmeceyi aç" açıksa çekmeceyi açar (hata olursa satışı bozmaz). */
async function openDrawerIfAny() {
  try {
    const lp = await import('../printing/labelPrinter.js');
    const cfg = lp.getReceiptPrinter();
    if (!lp.isNative() || !cfg.deviceId || cfg.drawer === false) return;
    await (await import('../printing/receiptPrinter.js')).openDrawer();
  } catch (e) {
    window.dispatchEvent(new CustomEvent('vk-toast', { detail: { type: 'error', message: `Çekmece açılamadı: ${e.message || e}` } }));
  }
}
const HELD_KEY = 'vk_held_carts';

export default function Pos() {
  const { user, settings } = useSession();
  // Rol yetkileri (sunucu da denetler); eski oturumda bilgi yoksa açık kabul edilir
  const perm = (k) => !user.permissions || !!user.permissions[k];
  const toast = useToast();
  const ask = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const register = registerName();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [staff, setStaff] = useState([]);
  const [shift, setShift] = useState(undefined); // undefined: yükleniyor, null: kapalı
  const [tab, setTab] = useState('fav');
  const [cart, setCart] = useState([]);
  const [sel, setSel] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [appointmentId, setAppointmentId] = useState(null);
  const [ticket, setTicket] = useState(null); // masadan gelen adisyon { id, table_name }
  const [modal, setModal] = useState(null);
  const [lastSale, setLastSale] = useState(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(null);
  const typeRef = useRef(null); // ScanBox'a dışarıdan yazı ekler
  const scanBuf = useRef({ text: '', timer: null }); // hiçbir kutu seçili değilken gelen okuyucu tuşları
  // Ekrandaki tuş takımı: "3 ×" sonra ürün → 3 adet; barkodu elle gir; seçili satırın adet / fiyatı
  const [showPad, setShowPad] = useState(() => storage.get('vk_pos_pad', softKeyboardDefault() === 'tap'));
  const [entry, setEntry] = useState('');
  const [pendingQty, setPendingQty] = useState(null);
  const pendingRef = useRef(null);
  const takeQty = () => { const q = pendingRef.current; pendingRef.current = null; setPendingQty(null); return q; };

  // Kampanyalar: sunucuyla aynı modül; satış kaydedilirken sunucu da aynı indirimi hesaplar
  const [promos, setPromos] = useState(() => storage.get('vk_promos_cache', []));
  const [clock, setClock] = useState(() => localNow());
  useEffect(() => { const t = setInterval(() => setClock(localNow()), 60000); return () => clearInterval(t); }, []);
  // Yemek platformu siparişlerinde platformun fiyatı geçerli; kampanya uygulanmaz
  const noPromo = !!ticket?.source && !['pos', 'phone', 'qr'].includes(ticket.source);
  const promo = useMemo(() => (noPromo || !promos.length ? { lines: [], basket: null }
    : applyPromotions(promos, cart.map((l) => ({ product_id: l.product_id, category_id: l.category_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount, type: l.type })), { now: clock })),
  [promos, cart, clock, noPromo]);
  const promoOf = (idx) => promo.lines[idx]?.discount || 0;
  const subtotal = cart.reduce((a, l, i) => a + lineTotal(l) - promoOf(i), 0);
  const basketPromo = Math.min(promo.basket?.discount || 0, subtotal);
  const total = Math.max(0, subtotal - discount - basketPromo);

  const refresh = useCallback(async () => {
    const [p, c, u, s] = await Promise.all([
      loadProducts(),
      get('/categories').catch(() => storage.get('vk_categories_cache', [])),
      get('/users').catch(() => []),
      get(`/shifts/current?register=${encodeURIComponent(register)}`).catch((e) => (e.status === 0 ? false : null)),
    ]);
    setProducts(p);
    setCategories(c);
    get('/promotions').then((list) => { const live = list.filter((x) => x.active); setPromos(live); storage.set('vk_promos_cache', live); }).catch(() => {});
    storage.set('vk_categories_cache', c);
    setStaff(u.filter((x) => x.active));
    setShift(s);
  }, [register]);

  useEffect(() => { refresh().catch(toast.err); }, [refresh, toast]);
  useEffect(() => { if (products.length && !products.some((p) => p.favorite) && tab === 'fav') setTab('all'); }, [products, tab]);

  // Randevudan kasaya: hizmet + müşteri + personel ile sepeti doldur
  useEffect(() => {
    const appt = location.state?.appointment;
    if (!appt || !products.length) return;
    const service = products.find((p) => p.id === appt.service_id);
    if (service) setCart([{ key: uuid(), product_id: service.id, name: service.name, unit: service.unit, type: service.type, qty: 1, unit_price: service.sell_price, discount: 0, vat_rate: service.vat_rate, staff_id: appt.staff_id }]);
    if (appt.customer_id) get(`/customers/${appt.customer_id}`).then(setCustomer).catch(() => {});
    setAppointmentId(appt.id);
    navigate('.', { replace: true, state: null });
  }, [location.state, products, navigate]);

  // Masadan kasaya: adisyonun (seçilen) kalemleri ile sepeti doldur
  useEffect(() => {
    const t = location.state?.ticket;
    if (!t) return;
    setCart(t.items.map((i) => ({ key: uuid(), product_id: i.product_id, name: i.name, unit: i.unit, type: 'product', qty: i.qty,
      unit_price: i.unit_price, discount: 0, vat_rate: i.vat_rate, staff_id: null, ticket_item_id: i.ticket_item_id })));
    setTicket({ id: t.id, table_name: t.table_name, partial: t.partial, back: t.back || '/masalar', prepaid: !!t.prepaid, source: t.source });
    setDiscount(t.partial ? 0 : t.discount || 0); // platform indirimi tam hesapta uygulanır
    if (t.customer_id) get(`/customers/${t.customer_id}`).then(setCustomer).catch(() => {});
    navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);

  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  const addProduct = useCallback((p, q = null) => {
    const weighted = p.unit === 'kg' || p.unit === 'lt';
    setCart((c) => {
      const existing = !weighted && !q && c.find((l) => l.product_id === p.id && !l.staff_id && !l.discount);
      if (existing) {
        setSel(existing.key);
        return c.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      const line = {
        key: uuid(), product_id: p.id, category_id: p.category_id ?? null, name: p.name, unit: p.unit, type: p.type, qty: q || 1, unit_price: p.sell_price,
        discount: 0, vat_rate: p.vat_rate, staff_id: p.type === 'service' && user.role === 'staff' ? user.id : null,
        stock: p.track_stock ? p.stock : null,
      };
      setSel(line.key);
      // Fiyatı olmayan ürün (çeşitli, terazi vb.) için fiyat/miktar sor
      if (!p.sell_price || (weighted && !q)) setTimeout(() => setModal({ type: 'line', key: line.key }), 0);
      return [...c, line];
    });
  }, [user]);

  const updateLine = (key, patch) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => { setCart((c) => c.filter((l) => l.key !== key)); setSel(null); };
  const clearCart = () => { setCart([]); setSel(null); setCustomer(null); setDiscount(0); setAppointmentId(null); setTicket(null); };

  /** Barkod okutma / arama kutusunda Enter */
  const onScan = async (text) => {
    let code = text.trim();
    if (!code) return false;
    let q = null;
    const m = code.match(/^(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.+)$/); // "3*8690..." çarpanlı okutma
    if (m) { q = parseQty(m[1]); code = m[2].trim(); }
    if (q == null && pendingRef.current) q = takeQty(); // tuş takımında "3 ×" denmiş
    const local = products.find((p) => p.barcode === code);
    if (local) { addProduct(local, q); return true; }
    if (/^\d{6,14}$/.test(code)) {
      try {
        const res = await get(`/products/barcode/${encodeURIComponent(code)}`);
        addProduct(res.product, res.qty ?? q);
        return true;
      } catch (e) {
        if (e.status === 404) {
          toast.err(`Barkod bulunamadı: ${code}`);
          if (settings.business_type !== 'berber') setModal({ type: 'quickProduct', barcode: code });
          return true;
        }
        if (e.status !== 0) toast.err(e);
      }
    }
    return false;
  };

  const visible = useMemo(() => {
    if (tab === 'fav') return products.filter((p) => p.favorite);
    if (tab === 'all') return products;
    if (tab === 'service') return products.filter((p) => p.type === 'service');
    return products.filter((p) => p.category_id === tab);
  }, [products, tab]);

  // ---- Ödeme ----
  const complete = async (payments, cust = customer) => {
    if (!cart.length || busy) return;
    setBusy(true);
    const payload = {
      client_uuid: uuid(),
      register_name: register,
      customer_id: cust?.id ?? null,
      appointment_id: appointmentId,
      ticket_id: ticket?.id ?? null,
      discount,
      items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, unit_price: l.unit_price, discount: l.discount, vat_rate: l.vat_rate, staff_id: l.staff_id, ticket_item_id: l.ticket_item_id })),
      ...(noPromo ? { no_promotions: true } : {}),
      payments,
      offline_created_at: nowSql(),
    };
    try {
      const sale = await submitSale(payload);
      const paid = payments.reduce((a, p) => a + p.amount, 0);
      const change = sale.offline ? Math.max(0, paid - total) : sale.change || 0;
      const printable = sale.offline
        ? { ...payload, receipt_no: 'ÇEVRİMDIŞI', subtotal, total, user_name: user.name, customer_name: cust?.name,
          discount: discount + basketPromo, promo_discount: promo.total_discount,
          items: cart.map((l, i) => ({ ...l, discount: (l.discount || 0) + promoOf(i), promo_discount: promoOf(i), promo_name: promo.lines[i]?.promo_name, line_total: lineTotal(l) - promoOf(i) })),
          payments: payments.map((p) => (p.method === 'cash' ? { ...p, amount: p.amount - change } : p)) }
        : sale;
      setLastSale({ sale: printable, change });
      if (sale.offline) toast('Çevrimdışı: satış kaydedildi, bağlantı gelince gönderilecek');
      else if (sale.fiscal_status === 'failed') toast.err(`Satış kaydedildi ama mali fiş basılamadı: ${sale.fiscal_error}`);
      else toast.ok(change > 0 ? `Satış tamam — Para üstü ${money(change)}` : 'Satış tamamlandı');
      // Nakit satış: fiş yazıcısına bağlı para çekmecesi açılır (fiş basılıyorsa aynı işte)
      const cashSale = payments.some((p) => p.method === 'cash' && p.amount > 0);
      if (storage.get('vk_autoprint', false)) printReceipt(printable, settings, change, { drawer: cashSale });
      else if (cashSale) openDrawerIfAny();
      const fromTable = ticket;
      clearCart();
      setModal(null);
      if (fromTable) setTimeout(() => navigate(fromTable.back || '/masalar', { state: { paid: fromTable.id } }), change > 0 ? 2500 : 600);
      // Stokları güncelle (arka planda)
      if (!sale.offline) loadProducts().then(setProducts).catch(() => {});
      else setProducts((ps) => ps.map((p) => {
        const sold = cart.filter((l) => l.product_id === p.id).reduce((a, l) => a + l.qty, 0);
        return sold && p.track_stock ? { ...p, stock: p.stock - sold } : p;
      }));
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
      focusScan();
    }
  };

  const payCard = () => complete([{ method: 'card', amount: total }]);
  const payCredit = () => {
    if (!customer) { toast.err('Veresiye için önce müşteri seçin'); setModal({ type: 'customer', then: 'credit' }); return; }
    complete([{ method: 'credit', amount: total }]);
  };

  // ---- Klavye kısayolları ----
  useEffect(() => {
    const onKey = (e) => {
      if (modal) return;
      const key = e.key;
      if (key === 'F1') { e.preventDefault(); setModal({ type: 'price' }); }
      else if (key === 'F5') { e.preventDefault(); holdCart(); }
      else if (key === 'F2') { e.preventDefault(); if (cart.length) setModal({ type: 'cash' }); }
      else if (key === 'F3') { e.preventDefault(); if (cart.length) payCard(); }
      else if (key === 'F4') { e.preventDefault(); if (cart.length && perm('credit_sale')) payCredit(); }
      else if (key === 'F6') { e.preventDefault(); if (cart.length) setModal({ type: 'split' }); }
      else if (key === 'F8') { e.preventDefault(); setModal({ type: 'customer' }); }
      else if (key === 'F9') { e.preventDefault(); if (cart.length && perm('discount')) setModal({ type: 'discount' }); }
      else if (key === 'Delete' && sel && !scanRef.current?.value) { removeLine(sel); }
      else if ((key === '+' || key === '-') && sel && !scanRef.current?.value) {
        e.preventDefault();
        const l = cart.find((x) => x.key === sel);
        if (l) { const n = l.qty + (key === '+' ? 1 : -1); if (n <= 0) removeLine(sel); else updateLine(sel, { qty: n }); }
      } else if (!isEditable(e.target)) {
        // Barkod kutusu seçili değil (ekrana dokunuldu, uygulama yeni açıldı): okuyucu tuşlarını yine yakala.
        // Okuyucu rakamları çok hızlı gönderip Enter'a basar → barkod; yavaş yazılan harfler arama kutusuna aktarılır.
        const b = scanBuf.current;
        if (key === 'Enter' && b.text) {
          e.preventDefault();
          clearTimeout(b.timer);
          const code = b.text;
          b.text = '';
          onScan(code).then((handled) => { if (!handled) typeRef.current?.(code); });
          focusScan();
        } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          b.text += key;
          clearTimeout(b.timer);
          b.timer = setTimeout(() => { const t = b.text; b.text = ''; if (t) { typeRef.current?.(t); focusScan(); } }, 300);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- Bekleyen sepetler ----
  const held = storage.get(HELD_KEY, []);
  const holdCart = () => {
    if (!cart.length) return;
    storage.set(HELD_KEY, [...held, { id: uuid(), at: new Date().toLocaleTimeString('tr-TR', { timeStyle: 'short' }), cart, customer, discount, total, ticket }]);
    clearCart();
    toast('Sepet bekletildi');
  };
  const restoreCart = (h) => {
    if (cart.length) holdCart();
    setCart(h.cart); setCustomer(h.customer); setDiscount(h.discount); setTicket(h.ticket || null);
    storage.set(HELD_KEY, storage.get(HELD_KEY, []).filter((x) => x.id !== h.id));
    setModal(null);
  };

  if (shift === null) return <OpenShift register={register} onOpened={setShift} />;

  const tabs = [
    ...(products.some((p) => p.favorite) ? [{ id: 'fav', name: '★ Sık' }] : []),
    { id: 'all', name: 'Tümü' },
    ...(products.some((p) => p.type === 'service') && settings.business_type !== 'berber' ? [{ id: 'service', name: 'Hizmetler' }] : []),
    ...categories.filter((c) => c.product_count > 0).map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <div className="pos">
      <div className="pos-left">
        <ScanBox inputRef={scanRef} typeRef={typeRef} products={products} onScan={onScan} onPick={(p) => { addProduct(p, takeQty()); focusScan(); }} />
        <div className="tabs">
          {tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.name}</button>)}
        </div>
        <div className="product-grid">
          {visible.map((p) => (
            <button key={p.id} className="tile" style={{ '--cat': p.category_color || undefined }} onClick={() => { addProduct(p, takeQty()); focusScan(); }}>
              <span className="t-name">{p.name}</span>
              <span>
                <div className="t-price">{p.sell_price ? money(p.sell_price) : 'Fiyat gir'}{p.unit !== 'adet' ? ` / ${p.unit}` : ''}</div>
                {p.track_stock ? <div className={`t-stock ${p.stock <= p.min_stock ? 'danger-text' : ''}`}>Stok: {fmtQty(p.stock)}</div> : null}
                {p.type === 'service' && p.duration_min ? <div className="t-stock">{p.duration_min} dk</div> : null}
              </span>
            </button>
          ))}
          {!visible.length && <div className="empty" style={{ gridColumn: '1/-1' }}>Bu sekmede ürün yok. Ürünleri <b>Stok</b> menüsünden ekleyebilirsiniz.</div>}
        </div>
      </div>

      <div className="pos-right">
        <div className="cart-head">
          <button className="btn small" onClick={() => setModal({ type: 'customer' })} title="F8" style={{ flex: 1, justifyContent: 'flex-start' }}>
            <Icon name="user" />
            {customer ? <span>{customer.name}{customer.balance > 0 && <span className="badge red" style={{ marginLeft: 6 }}>Borç {money(customer.balance)}</span>}
              {settings.loyalty_enabled === '1' && customer.points > 0 && <span className="badge green" style={{ marginLeft: 6 }}>Puan {money(customer.points)}</span>}</span>
              : <span className="muted">Müşteri seç <span className="kbd">F8</span></span>}
          </button>
          {customer && <button className="btn small ghost" onClick={() => setCustomer(null)} aria-label="Müşteriyi kaldır"><Icon name="x" /></button>}
          <button className="btn small" onClick={() => setModal({ type: 'price' })} title="Fiyat gör (F1)">Fiyat gör</button>
          <button className="btn small" onClick={holdCart} disabled={!cart.length} title="Sepeti beklet (F5)"><Icon name="pause" /> Beklet</button>
          {held.length > 0 && <button className="btn small" onClick={() => setModal({ type: 'held' })}>Bekleyen ({held.length})</button>}
        </div>

        {ticket && (
          <div className="ticket-bar">
            <Icon name="table" /><span><b>{ticket.table_name}</b> adisyonu{ticket.partial ? ' · bölünmüş hesap' : ''}</span>
            <div style={{ flex: 1 }} />
            {ticket.prepaid && <button className="btn small success" disabled={busy || !cart.length} onClick={() => complete([{ method: 'online', amount: total }])}>Online ödendi · kapat</button>}
            <button className="btn small ghost" onClick={() => { const back = ticket.back || '/masalar'; clearCart(); navigate(back); }}>Geri dön</button>
          </div>
        )}
        <div className="cart-items">
          {cart.map((l, idx) => (
            <div key={l.key} className={`cart-line ${sel === l.key ? 'sel' : ''}`} onClick={() => setSel(l.key)} onDoubleClick={() => setModal({ type: 'line', key: l.key })}>
              <div>
                <div className="l-name">{l.name}</div>
                <div className="l-meta">
                  {fmtQty(l.qty)} {l.unit} × {plain(l.unit_price)}
                  {l.discount ? <span className="success-text"> −{plain(l.discount)}</span> : null}
                  {l.staff_id ? <span> · {staff.find((s) => s.id === l.staff_id)?.name}</span> : null}
                </div>
              </div>
              <div className="l-total">{promoOf(idx) > 0 && <s className="muted small-text" style={{ marginRight: 6 }}>{money(lineTotal(l))}</s>}{money(lineTotal(l) - promoOf(idx))}</div>
              {promoOf(idx) > 0 && <div className="promo-tag" style={{ gridColumn: '1 / -1' }}>🏷 {promo.lines[idx].promo_name} · −{plain(promoOf(idx))}</div>}
              {sel === l.key && (
                <div className="row" style={{ gridColumn: '1 / -1' }} onClick={(e) => e.stopPropagation()}>
                  <div className="qty-ctl">
                    <button onClick={() => (l.qty <= 1 ? removeLine(l.key) : updateLine(l.key, { qty: +(l.qty - 1).toFixed(3) }))}>−</button>
                    <strong style={{ minWidth: 40, textAlign: 'center' }}>{fmtQty(l.qty)}</strong>
                    <button onClick={() => updateLine(l.key, { qty: +(l.qty + 1).toFixed(3) })}>+</button>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button className="btn small" onClick={() => setModal({ type: 'line', key: l.key })}><Icon name="edit" /> Düzenle</button>
                  <button className="btn small danger" onClick={() => removeLine(l.key)} aria-label="Satırı sil"><Icon name="trash" /></button>
                </div>
              )}
            </div>
          ))}
          {!cart.length && (
            <div className="empty">
              <Icon name="barcode" width={40} height={40} />
              <p>Barkod okutun veya ürüne dokunun</p>
              {lastSale && (
                <div className="card card-pad stack" style={{ textAlign: 'left', marginTop: 12 }}>
                  <div className="row"><strong style={{ flex: 1 }}>Son satış {lastSale.sale.receipt_no}</strong><strong>{money(lastSale.sale.total)}</strong></div>
                  <FiscalLine sale={lastSale.sale} onUpdate={(s) => setLastSale({ ...lastSale, sale: s })} />
                  <InvoiceLine sale={lastSale.sale} onUpdate={(s) => setLastSale({ ...lastSale, sale: s })} />
                  {lastSale.sale.points_earned > 0 && <div className="success-text small-text">Müşteri {money(lastSale.sale.points_earned)} puan kazandı</div>}
                  {lastSale.change > 0 && <div className="change-box">Para üstü: {money(lastSale.change)}</div>}
                  <button className="btn" onClick={() => printReceipt(lastSale.sale, settings, lastSale.change)}><Icon name="print" /> Fiş yazdır</button>
                </div>
              )}
            </div>
          )}
        </div>

        {showPad && (
          <div className="pos-pad">
            <div className="pos-pad-display">
              {pendingQty != null && <span className="pending">{fmtQty(pendingQty)} ×</span>}
              <span style={{ flex: 1 }}>{entry || <span className="muted">{pendingQty != null ? 'Ürünü okutun ya da dokunun' : 'Miktar, fiyat ya da barkod'}</span>}</span>
              {(entry || pendingQty != null) && <button type="button" className="btn small ghost" onClick={() => { setEntry(''); takeQty(); }}>Temizle</button>}
            </div>
            <NumPad compact onKey={(k) => setEntry((v) => applyKey(v, k))} side={[
              { label: 'Miktar ×', title: 'Önce miktarı yazın, sonra ürünü okutun ya da dokunun', disabled: !entry || !(parseQty(entry) > 0),
                onClick: () => { const q = parseQty(entry); pendingRef.current = q; setPendingQty(q); setEntry(''); focusScan(); } },
              { label: 'Adet', title: 'Seçili satırın miktarını değiştir', disabled: !entry || !sel || !(parseQty(entry) > 0),
                onClick: () => { updateLine(sel, { qty: parseQty(entry) }); setEntry(''); } },
              { label: 'Fiyat', title: 'Seçili satırın birim fiyatını değiştir', disabled: !entry || !sel || !(perm('price_edit') || !(cart.find((l) => l.key === sel)?.unit_price > 0)),
                onClick: () => { updateLine(sel, { unit_price: toKurus(entry) }); setEntry(''); } },
              { label: 'Barkod', className: 'primary', title: 'Yazılan barkodu okut', disabled: !entry,
                onClick: async () => { const code = entry; setEntry(''); if (!(await onScan(code))) toast.err(`Barkod bulunamadı: ${code}`); } },
            ]} />
          </div>
        )}
        <div className="cart-sum">
          {(discount > 0 || basketPromo > 0) && <div className="line"><span>Ara toplam</span><span>{money(subtotal)}</span></div>}
          {basketPromo > 0 && <div className="line"><span>🏷 {promo.basket.promo_name}</span><span className="success-text">−{money(basketPromo)}</span></div>}
          {discount > 0 && <div className="line"><span>İndirim</span><span className="success-text">−{money(discount)}</span></div>}
          {promo.total_discount > 0 && <div className="line"><span className="success-text">Kampanya kazancı</span><span className="success-text">{money(promo.total_discount)}</span></div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn small ghost" disabled={!cart.length || !perm('discount')} title={perm('discount') ? '' : 'İndirim yetkiniz yok'} onClick={() => setModal({ type: 'discount' })}>İndirim <span className="kbd">F9</span></button>
            <button className="btn small ghost" disabled={!cart.length} onClick={() => setModal({ type: 'split' })}>Parçalı <span className="kbd">F6</span></button>
            <button className="btn small ghost" onClick={() => { storage.set('vk_pos_pad', !showPad); setShowPad(!showPad); }} title="Ekrandaki sayı tuş takımı">{showPad ? 'Tuşları gizle' : 'Tuş takımı'}</button>
            <button className="btn small ghost danger-text" disabled={!cart.length} onClick={async () => { if (await ask('Sepet temizlensin mi?', { ok: 'Temizle' })) clearCart(); }}>Temizle</button>
          </div>
          <div className="total"><span>TOPLAM</span><span>{money(total)}</span></div>
          {cart.length > 0 && <div className="cart-count">{cart.length} kalem · {fmtQty(cart.reduce((a, l) => a + l.qty, 0))} {cart.every((l) => l.unit === 'adet') ? 'adet' : 'birim'}</div>}
        </div>
        <div className="pay-buttons">
          <button className="btn success" disabled={!cart.length || busy} onClick={() => setModal({ type: 'cash' })}>Nakit<small><span className="kbd">F2</span></small></button>
          <button className="btn primary" disabled={!cart.length || busy} onClick={payCard}>Kart<small><span className="kbd">F3</span></small></button>
          <button className="btn" disabled={!cart.length || busy || !perm('credit_sale')} onClick={payCredit}>Veresiye<small><span className="kbd">F4</span></small></button>
        </div>
      </div>

      {modal?.type === 'cash' && <CashModal total={total} busy={busy} onClose={() => setModal(null)} onPay={(given) => complete([{ method: 'cash', amount: given }])} />}
      {modal?.type === 'split' && <SplitModal total={total} customer={customer} busy={busy} onClose={() => setModal(null)} onPay={complete} />}
      {modal?.type === 'discount' && <DiscountModal subtotal={subtotal} value={discount} onClose={() => { setModal(null); focusScan(); }} onSave={(v) => { setDiscount(v); setModal(null); focusScan(); }} />}
      {modal?.type === 'line' && cart.some((l) => l.key === modal.key) && (
        <LineModal line={cart.find((l) => l.key === modal.key)} staff={staff}
          onClose={() => { setModal(null); focusScan(); }}
          onSave={(patch) => { updateLine(modal.key, patch); setModal(null); focusScan(); }}
          onRemove={() => { removeLine(modal.key); setModal(null); focusScan(); }} />
      )}
      {modal?.type === 'customer' && (
        <CustomerPicker onClose={() => { setModal(null); focusScan(); }} onPick={(c) => {
          setCustomer(c);
          setModal(null);
          if (modal.then === 'credit') complete([{ method: 'credit', amount: total }], c);
          focusScan();
        }} />
      )}
      {modal?.type === 'held' && (
        <Modal title="Bekleyen sepetler" onClose={() => setModal(null)}>
          <div className="stack">
            {held.map((h) => (
              <div key={h.id} className="row card card-pad">
                <div style={{ flex: 1 }}><strong>{h.at}</strong> · {h.cart.length} kalem{h.customer ? ` · ${h.customer.name}` : ''}</div>
                <strong>{money(h.total)}</strong>
                <button className="btn small primary" onClick={() => restoreCart(h)}>Geri al</button>
                <button className="btn small" onClick={() => { storage.set(HELD_KEY, held.filter((x) => x.id !== h.id)); setModal(held.length > 1 ? { type: 'held' } : null); }}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal?.type === 'price' && <PriceCheck products={products} onClose={() => { setModal(null); focusScan(); }}
        onAdd={(p) => { addProduct(p, takeQty()); setModal(null); focusScan(); }} />}
      {modal?.type === 'quickProduct' && (
        <QuickProduct barcode={modal.barcode} onClose={() => { setModal(null); focusScan(); }}
          onCreated={(p) => { setProducts((ps) => [...ps, p]); addProduct(p); setModal(null); focusScan(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Satışın e-Arşiv / e-Fatura durumu ve "Fatura kes" düğmesi. */
export function InvoiceLine({ sale, onUpdate }) {
  const toast = useToast();
  const { settings } = useSession();
  const [busy, setBusy] = useState(false);
  const can = useCan();
  const enabled = can('invoice') && settings.invoice_provider && settings.invoice_provider !== 'none';
  const overLimit = sale.total >= Number(settings.invoice_threshold || 1200000);
  if (!sale.id) return null;
  const run = async (path) => {
    setBusy(true);
    try {
      const s = await post(path);
      onUpdate?.(s);
      if (s.invoice_status === 'done') toast.ok(`Fatura kesildi: ${s.invoice_no}`);
      else if (s.invoice_status === 'pending') toast('Fatura hazırlanıyor, birazdan "Durumu yenile"ye basın');
      else toast.err(s.invoice_error || 'Fatura kesilemedi');
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  };
  if (sale.invoice_status === 'done') {
    return <div className="small-text success-text">✓ Fatura {sale.invoice_no}{sale.invoice_url && <> · <a href={sale.invoice_url} target="_blank" rel="noreferrer">PDF'i aç</a></>}</div>;
  }
  if (!enabled) {
    return overLimit ? <div className="small-text warn-text">Bu satış {money(Number(settings.invoice_threshold))} fatura sınırını aşıyor; fatura düzenlenmeli (e-Fatura bağlantısı kapalı).</div> : null;
  }
  return (
    <div className="row wrap small-text">
      {overLimit && <span className="warn-text">Fatura sınırı aşıldı, fatura düzenleyin.</span>}
      {sale.invoice_status === 'failed' && <span className="danger-text" style={{ flex: 1 }}>Fatura kesilemedi: {sale.invoice_error}</span>}
      {sale.invoice_status === 'pending'
        ? <><span style={{ flex: 1 }}>Fatura hazırlanıyor…</span><button className="btn small" disabled={busy} onClick={() => run(`/sales/${sale.id}/invoice/refresh`)}>Durumu yenile</button></>
        : <button className="btn small" disabled={busy} onClick={() => run(`/sales/${sale.id}/invoice`)}>{busy ? 'Kesiliyor…' : sale.customer_tax_number ? 'e-Fatura / e-Arşiv kes' : 'e-Arşiv fatura kes'}</button>}
    </div>
  );
}

/** Satışın mali fiş durumu; basılamadıysa "Tekrar gönder" düğmesi. */
export function FiscalLine({ sale, onUpdate }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!sale.fiscal_status || sale.fiscal_status === 'none') return null;
  const retry = async () => {
    setBusy(true);
    try {
      const s = await post(`/sales/${sale.id}/fiscal`);
      onUpdate?.(s);
      if (s.fiscal_status === 'done') toast.ok(`Mali fiş basıldı (No ${s.fiscal_no})`); else toast.err(s.fiscal_error);
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  };
  if (sale.fiscal_status === 'done') return <div className="small-text success-text">✓ Mali fiş No {sale.fiscal_no}{sale.fiscal_z_no ? ` · Z ${sale.fiscal_z_no}` : ''}</div>;
  return (
    <div className="row wrap small-text danger-text">
      <span style={{ flex: 1 }}>{sale.fiscal_status === 'pending' ? 'Yazarkasaya gönderiliyor…' : `Mali fiş basılamadı: ${sale.fiscal_error || ''}`}</span>
      <button className="btn small" disabled={busy} onClick={retry}>{busy ? 'Gönderiliyor…' : 'Yazarkasaya tekrar gönder'}</button>
    </div>
  );
}

const isEditable = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

function ScanBox({ inputRef, typeRef, products, onScan, onPick }) {
  const [text, setText] = useState('');
  if (typeRef) typeRef.current = (s) => setText((t) => t + s);
  const [hl, setHl] = useState(0);
  const [camera, setCamera] = useState(false);
  const q = text.trim().toLocaleLowerCase('tr');
  const results = useMemo(() => {
    if (q.length < 2 || /^\d+[*xX]/.test(q)) return [];
    return products.filter((p) => p.name.toLocaleLowerCase('tr').includes(q) || p.barcode?.includes(q)).slice(0, 12);
  }, [q, products]);

  useEffect(() => { inputRef.current?.focus(); }, [inputRef]);
  useEffect(() => setHl(0), [q]);

  const onKeyDown = async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape') setText('');
    else if (e.key === 'Enter') {
      e.preventDefault();
      const value = text;
      setText('');
      const handled = await onScan(value);
      if (!handled && results[hl]) onPick(results[hl]);
    }
  };

  return (
    <div className="scan-box">
      <Icon name="search" />
      <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
        placeholder="Barkod okutun ya da ürün adı yazın… (çoklu: 3*barkod)" autoComplete="off" aria-label="Barkod veya ürün ara" />
      {cameraSupported() && <button className="btn small ghost cam-btn" onClick={() => setCamera(true)} title="Kamerayla okut" aria-label="Kamerayla barkod okut"><Icon name="camera" /></button>}
      {camera && <CameraScanner onClose={() => setCamera(false)} onResult={(code) => { setCamera(false); onScan(code); }} />}
      {results.length > 0 && (
        <div className="suggest card">
          {results.map((p, i) => (
            <button key={p.id} className={i === hl ? 'hl' : ''} onMouseDown={(e) => { e.preventDefault(); setText(''); onPick(p); }}>
              <span>{p.name} {p.barcode && <small className="muted">{p.barcode}</small>}</span>
              <strong>{money(p.sell_price)}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenShift({ register, onOpened }) {
  const toast = useToast();
  const [cash, setCash] = useState('');
  const open = async (e) => {
    e.preventDefault();
    try {
      onOpened(await post('/shifts/open', { register_name: register, opening_cash: toKurus(cash) }));
      toast.ok(`${register} açıldı`);
    } catch (err) { toast.err(err); }
  };
  return (
    <div className="center-screen">
      <form className="card card-pad stack" style={{ maxWidth: 400, width: '100%' }} onSubmit={open}>
        <h2>{register} — Kasa açılışı</h2>
        <p className="muted">Güne başlamak için kasadaki başlangıç nakit tutarını girin.</p>
        <Field label="Kasadaki nakit (₺)"><input className="input amount-display" autoFocus inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0,00" /></Field>
        <NumPad compact onKey={(k) => setCash((v) => applyKey(v, k))} />
        <button className="btn primary big">Kasayı aç</button>
      </form>
    </div>
  );
}

function CashModal({ total, onPay, onClose, busy }) {
  const [given, setGiven] = useState('');
  const g = given ? toKurus(given) : total;
  const change = g - total;
  // Banknotlar (5–200 ₺): dokundukça alınan tutara eklenir (ör. 200 + 50); C sıfırlar
  const notes = [500, 1000, 2000, 5000, 10000, 20000];
  const addNote = (v) => setGiven((x) => toInput((x ? toKurus(x) : 0) + v));
  return (
    <Modal title="Nakit ödeme" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
        <button className="btn success big" disabled={busy || change < 0} onClick={() => onPay(g)}>Satışı tamamla (Enter)</button></>}>
      <form className="pay-layout" onSubmit={(e) => { e.preventDefault(); if (change >= 0) onPay(g); }}>
        <div className="stack">
          <div className="muted" style={{ textAlign: 'center' }}>Toplam</div>
          <div className="pay-total">{money(total)}</div>
          <div className="muted" style={{ textAlign: 'center' }}>Alınan</div>
          <input className="input amount-display" autoFocus inputMode="decimal" aria-label="Alınan tutar" value={given} onChange={(e) => setGiven(e.target.value)} placeholder={toInput(total)} />
          <div className="banknotes">
            <button type="button" className="btn big" onClick={() => setGiven('')}>Tam</button>
            {notes.map((v) => <button type="button" key={v} className="btn big" onClick={() => addNote(v)}>{money(v).replace(',00', '')}</button>)}
          </div>
          {change > 0 && <div className="change-big">Para üstü<strong>{money(change)}</strong></div>}
          {change < 0 && <div className="danger-text" style={{ textAlign: 'center', fontWeight: 800, fontSize: 20 }}>Eksik: {money(-change)}</div>}
        </div>
        <NumPad onKey={(k) => setGiven((v) => applyKey(v, k))} side={[{ label: 'C', onClick: () => setGiven('') }]} />
        <button hidden />
      </form>
    </Modal>
  );
}

function SplitModal({ total, customer, onPay, onClose, busy }) {
  const [vals, setVals] = useState({ cash: '', card: '', transfer: '', credit: '' });
  const amounts = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, toKurus(v)]));
  const paid = Object.values(amounts).reduce((a, b) => a + b, 0);
  const remaining = total - paid;
  const fill = (k) => setVals({ ...vals, [k]: toInput(Math.max(0, amounts[k] + remaining)) });
  const { settings } = useSession();
  const methods = ['cash', 'card', 'transfer', ...(customer ? ['credit'] : []), ...(customer && settings.loyalty_enabled === '1' && customer.points > 0 ? ['points'] : [])];
  return (
    <Modal title="Parçalı ödeme" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
        <button className="btn success" disabled={busy || remaining > 0 || (remaining < 0 && amounts.cash < -remaining)}
          onClick={() => onPay(Object.entries(amounts).filter(([, a]) => a > 0).map(([method, amount]) => ({ method, amount })))}>Tamamla</button></>}>
      <div className="stack">
        <div className="pay-total">{money(total)}</div>
        {methods.map((m) => (
          <div className="row" key={m}>
            <strong style={{ width: 110 }}>{METHOD_LABELS[m]}</strong>
            <input className="input" inputMode="decimal" value={vals[m]} onChange={(e) => setVals({ ...vals, [m]: e.target.value })} placeholder="0,00" />
            <button className="btn small" onClick={() => fill(m)}>Kalanı</button>
          </div>
        ))}
        {!customer && <small className="muted">Veresiye eklemek için önce müşteri seçin.</small>}
        <div className={`row ${remaining > 0 ? 'danger-text' : 'success-text'}`} style={{ justifyContent: 'space-between', fontWeight: 800 }}>
          <span>{remaining > 0 ? 'Kalan' : remaining < 0 ? 'Para üstü (nakitten)' : 'Tamam'}</span>
          <span>{money(Math.abs(remaining))}</span>
        </div>
      </div>
    </Modal>
  );
}

function DiscountModal({ subtotal, value, onSave, onClose }) {
  const [mode, setMode] = useState('pct');
  const [v, setV] = useState('');
  const amount = mode === 'pct' ? Math.round((subtotal * parseQty(v)) / 100) : toKurus(v);
  return (
    <Modal title="Fiş indirimi" onClose={onClose}
      footer={<>{value > 0 && <button className="btn" onClick={() => onSave(0)}>İndirimi kaldır</button>}
        <button className="btn primary" disabled={amount < 0 || amount > subtotal} onClick={() => onSave(amount)}>Uygula</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (amount >= 0 && amount <= subtotal) onSave(amount); }}>
        <div className="tabs">
          <button type="button" className={`tab ${mode === 'pct' ? 'active' : ''}`} onClick={() => setMode('pct')}>Yüzde (%)</button>
          <button type="button" className={`tab ${mode === 'amt' ? 'active' : ''}`} onClick={() => setMode('amt')}>Tutar (₺)</button>
        </div>
        {mode === 'pct' && <div className="row wrap">{[5, 10, 15, 20].map((p) => <button type="button" key={p} className="btn" onClick={() => setV(String(p))}>%{p}</button>)}</div>}
        <input className="input" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={mode === 'pct' ? 'Örn. 10' : '0,00'} />
        <NumPad compact onKey={(k) => setV((x) => applyKey(x, k))} />
        <div className="muted">İndirim: <strong>{money(amount)}</strong> · Yeni toplam: <strong>{money(subtotal - amount)}</strong></div>
      </form>
    </Modal>
  );
}

function LineModal({ line, staff, onSave, onClose, onRemove }) {
  const { user } = useSession();
  const canPrice = !user.permissions || user.permissions.price_edit || !(line.unit_price > 0) || !!line.ticket_item_id;
  const canDiscount = !user.permissions || user.permissions.discount;
  const [f, setF] = useState({ qty: String(line.qty).replace('.', ','), price: toInput(line.unit_price), discount: toInput(line.discount), staff_id: line.staff_id || '' });
  // Tuş takımı hangi kutuya yazar: başta miktar (fiyatı yoksa fiyat); kutuya dokununca o kutu
  const [active, setActive] = useState(line.unit_price > 0 ? 'qty' : 'price');
  const [fresh, setFresh] = useState(true); // ilk tuş eski değerin yerine geçsin
  const writable = (k) => (k === 'qty' || (k === 'price' && canPrice) || (k === 'discount' && canDiscount));
  const padKey = (k) => {
    if (!writable(active)) return;
    setF((x) => ({ ...x, [active]: applyKey(fresh && k !== '⌫' ? '' : x[active], k) }));
    setFresh(false);
  };
  const pick = (k) => { setActive(k); setFresh(true); };
  const hl = (k) => (active === k ? { borderColor: 'var(--primary)', boxShadow: '0 0 0 3px var(--primary-soft)' } : undefined);
  const save = (e) => {
    e?.preventDefault();
    const q = parseQty(f.qty);
    if (q <= 0) return;
    onSave({ qty: q, unit_price: toKurus(f.price), discount: toKurus(f.discount), staff_id: f.staff_id ? Number(f.staff_id) : null });
  };
  return (
    <Modal title={line.name} onClose={onClose}
      footer={<><button className="btn danger" onClick={onRemove}>Satırı sil</button><div style={{ flex: 1 }} /><button className="btn primary" onClick={save}>Kaydet</button></>}>
      <form className="stack" onSubmit={save}>
        <div className="grid-3">
          <Field label={`Miktar (${line.unit})`}><input className="input" autoFocus={line.unit_price > 0} inputMode="decimal" style={hl('qty')} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} onFocus={(e) => { e.target.select(); pick('qty'); }} /></Field>
          <Field label="Birim fiyat (₺)" hint={canPrice ? null : 'Fiyat değiştirme yetkiniz yok'}><input className="input" autoFocus={!(line.unit_price > 0)} inputMode="decimal" style={hl('price')} readOnly={!canPrice} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} onFocus={(e) => { e.target.select(); pick('price'); }} /></Field>
          <Field label="Satır indirimi (₺)"><input className="input" inputMode="decimal" style={hl('discount')} readOnly={!canDiscount} value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} onFocus={() => pick('discount')} /></Field>
        </div>
        {staff.length > 1 && (
          <Field label="İşlemi yapan personel (prim için)">
            <select className="input" value={f.staff_id} onChange={(e) => setF({ ...f, staff_id: e.target.value })}>
              <option value="">— Seçilmedi —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <NumPad compact onKey={padKey} side={[{ label: 'Kaydet', className: 'primary', onClick: save }]} />
        <div className="muted">Satır toplamı: <strong>{money(Math.round(parseQty(f.qty) * toKurus(f.price)) - toKurus(f.discount))}</strong></div>
        <button hidden />
      </form>
    </Modal>
  );
}

/** Fiyat gör: ürünü sepete eklemeden fiyatına ve stoğuna bakma (barkod okutun ya da adını yazın) */
function PriceCheck({ products, onClose, onAdd }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const term = q.trim().toLocaleLowerCase('tr');
  const matches = useMemo(() => (term.length < 2 || found ? [] : products.filter((p) => p.name.toLocaleLowerCase('tr').includes(term) || p.barcode?.includes(term)).slice(0, 8)), [term, products, found]);
  const lookup = async () => {
    const code = q.trim();
    if (!code) return;
    const local = products.find((p) => p.barcode === code) || (matches.length === 1 ? matches[0] : null);
    if (local) { setFound(local); setQ(''); return; }
    try { const r = await get(`/products/barcode/${encodeURIComponent(code)}`); setFound(r.product); setQ(''); } catch { setFound({ missing: code }); setQ(''); }
  };
  return (
    <Modal title="Fiyat gör" onClose={onClose}
      footer={<>{found && !found.missing && <button className="btn primary" onClick={() => onAdd(found)}>Sepete ekle</button>}<button className="btn" onClick={onClose}>Kapat</button></>}>
      <div className="stack">
        <input className="input" autoFocus placeholder="Barkod okutun ya da ürün adı yazın…" value={q} onChange={(e) => { setQ(e.target.value); setFound(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} aria-label="Fiyat sorgula" />
        {matches.map((p) => <button key={p.id} type="button" className="dropdown-item" onClick={() => { setFound(p); setQ(''); }}><span>{p.name}</span><span className="muted">{money(p.sell_price)}</span></button>)}
        {found?.missing && <div className="danger-text" style={{ textAlign: 'center', fontWeight: 700 }}>Barkod bulunamadı: {found.missing}</div>}
        {found && !found.missing && (
          <div className="price-check">
            <div style={{ fontSize: 20, fontWeight: 700 }}>{found.name}</div>
            <div className="pc-price">{money(found.sell_price)}{found.unit !== 'adet' ? <span style={{ fontSize: 20 }}> / {found.unit}</span> : null}</div>
            <div className="muted">{found.barcode || ''}{found.track_stock ? ` · Stok: ${fmtQty(found.stock)} ${found.unit}` : ''}</div>
          </div>
        )}
        {!found && !matches.length && <div className="muted small-text" style={{ textAlign: 'center' }}>Ürün sepete eklenmez; yalnızca fiyatı ve stoğu gösterilir.</div>}
      </div>
    </Modal>
  );
}

export function CustomerPicker({ onPick, onClose }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', phone: '' });

  useEffect(() => {
    const t = setTimeout(() => get(`/customers?limit=30&q=${encodeURIComponent(q)}`).then(setList).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (e) => {
    e.preventDefault();
    try { onPick(await post('/customers', f)); } catch (err) { toast.err(err); }
  };

  return (
    <Modal title="Müşteri seç" onClose={onClose}>
      {!adding ? (
        <div className="stack">
          <div className="row">
            <input className="input" autoFocus placeholder="Ad veya telefon ara…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => { setAdding(true); setF({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }); }}><Icon name="plus" /> Yeni</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="table">
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => onPick(c)}>
                    <td><strong>{c.name}</strong><div className="muted small-text">{c.phone}</div></td>
                    <td className="right">{c.balance > 0 && <span className="badge red">Borç {money(c.balance)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <div className="empty">Müşteri bulunamadı</div>}
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={add}>
          <Field label="Ad Soyad"><input className="input" autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Telefon"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div className="row"><button type="button" className="btn" onClick={() => setAdding(false)}>Geri</button><button className="btn primary">Kaydet ve seç</button></div>
        </form>
      )}
    </Modal>
  );
}

function QuickProduct({ barcode, onCreated, onClose }) {
  const toast = useToast();
  const { user } = useSession();
  const [f, setF] = useState({ name: '', price: '', vat_rate: 20 });
  const [found, setFound] = useState(null);
  useEffect(() => {
    get(`/products/lookup/${encodeURIComponent(barcode)}`).then((r) => { setFound(r); setF((x) => (x.name ? x : { ...x, name: r.name })); }, () => {});
  }, [barcode]);
  if (!['admin', 'manager'].includes(user.role)) {
    return <Modal title="Ürün bulunamadı" onClose={onClose}><p><b>{barcode}</b> barkodlu ürün kayıtlı değil. Yöneticinizden ürünü eklemesini isteyin.</p></Modal>;
  }
  const save = async (e) => {
    e.preventDefault();
    try {
      onCreated(await post('/products', { name: f.name, barcode, sell_price: toKurus(f.price), vat_rate: f.vat_rate, track_stock: 1 }));
      toast.ok('Ürün eklendi');
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title="Yeni ürün ekle" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="muted"><b>{barcode}</b> barkodu kayıtlı değil. Hızlıca ekleyip satışa devam edebilirsiniz.</p>
        {found && <div className="small-text success-text">İnternette bulundu: <b>{found.name}</b> (Open Food Facts). Adı kontrol edip fiyatı girin.</div>}
        <Field label="Ürün adı"><input className="input" autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid-2">
          <Field label="Satış fiyatı (₺)"><input className="input" required inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="KDV %"><select className="input" value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: Number(e.target.value) })}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
        </div>
        <button className="btn primary">Ekle ve sepete at</button>
      </form>
    </Modal>
  );
}
