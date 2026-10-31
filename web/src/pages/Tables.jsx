import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { get, loadProducts, post, put, storage } from '../api.js';
import { isManager, useSession } from '../App.jsx';
import { printElement } from '../components/Receipt.jsx';
import { Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, money, plain, qty as fmtQty } from '../format.js';

const minutesSince = (s) => (s ? Math.max(0, Math.round((Date.now() - new Date(s.replace(' ', 'T')).getTime()) / 60000)) : 0);
const since = (s) => { const m = minutesSince(s); return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`; };

const REQ_LABELS = { waiter: 'Garson çağırıyor', bill: 'Hesap istiyor', order: 'QR sipariş' };

export default function Tables() {
  const location = useLocation();
  const toast = useToast();
  const [openTable, setOpenTable] = useState(null);
  const [edit, setEdit] = useState(false);
  const [qr, setQr] = useState(false);
  const { user, settings } = useSession();
  const tables = useLoad(() => get('/tables'));
  const requests = useLoad(() => (settings.qrmenu_enabled === '1' ? get('/table-requests') : Promise.resolve([])), [settings.qrmenu_enabled]);

  // Diğer cihazlardaki değişiklikler ve QR istekleri için ara ara yenile
  useEffect(() => {
    const t = setInterval(() => { if (!openTable) { tables.reload(); requests.reload(); } }, 10000);
    return () => clearInterval(t);
  });
  const handle = async (q, ok) => {
    try {
      await post(`/table-requests/${q.id}/${ok ? 'accept' : 'reject'}`, {});
      toast.ok(ok ? (q.type === 'order' ? `${q.table_name}: sipariş adisyona eklendi, mutfağa göndermeyi unutmayın` : 'Tamamlandı') : 'İstek reddedildi');
      requests.reload(); tables.reload();
    } catch (e) { toast.err(e); }
  };
  useEffect(() => { if (location.state?.paid) tables.reload(); }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = tables.data || [];
  const zones = useMemo(() => {
    const z = new Map();
    for (const t of list) { const k = t.zone || 'Masalar'; if (!z.has(k)) z.set(k, []); z.get(k).push(t); }
    return [...z.entries()];
  }, [list]);
  const open = list.filter((t) => t.ticket_id);

  if (openTable) {
    return <TicketScreen table={openTable} tables={list} onBack={() => { setOpenTable(null); tables.reload(); }}
      onSwitch={(t) => { tables.reload(); setOpenTable(t); }} />;
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Masalar</h1>
        <div className="grow" />
        <div className="muted">{open.length}/{list.length} masa dolu · açık hesap <strong>{money(open.reduce((a, t) => a + t.remaining_total, 0))}</strong></div>
        {isManager(user) && <button className="btn" onClick={() => setQr(true)}>QR menü</button>}
        {isManager(user) && <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" /> Masaları düzenle</button>}
      </div>
      {(requests.data || []).length > 0 && (
        <div className="req-list">
          {requests.data.map((q) => (
            <div key={q.id} className="req-card">
              <div><strong>{q.table_name}</strong> · {REQ_LABELS[q.type]} <span className="muted small-text">{since(q.created_at)} önce</span></div>
              {q.type === 'order' && <div className="req-items">{q.items.map((i) => `${i.qty}× ${i.name}${i.note ? ` (${i.note})` : ''}`).join(', ')}</div>}
              {q.note && <div className="req-items">Not: {q.note}</div>}
              <div className="row">
                <button className="btn small success" onClick={() => handle(q, true)}>{q.type === 'order' ? 'Onayla, adisyona ekle' : 'Tamam'}</button>
                {q.type === 'order' && <button className="btn small ghost danger-text" onClick={() => handle(q, false)}>Reddet</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {zones.map(([zone, ts]) => (
        <section key={zone} style={{ marginBottom: 20 }}>
          <h3 className="muted" style={{ margin: '0 0 10px' }}>{zone}</h3>
          <div className="table-grid">
            {ts.map((t) => (
              <button key={t.id} className={`table-card ${t.ticket_id ? 'busy' : ''} ${t.unsent_count ? 'unsent' : ''}`} onClick={() => setOpenTable(t)}>
                <div className="tc-name">{t.name}</div>
                {t.requests && [...new Set(t.requests.split(','))].map((r) => <span key={r} className="badge red">{REQ_LABELS[r]}</span>)}
                {t.ticket_id ? (
                  <>
                    <div className="tc-total">{money(t.remaining_total)}</div>
                    <div className="tc-meta">{since(t.opened_at)}{t.guest_count ? ` · ${t.guest_count} kişi` : ''}{t.user_name ? ` · ${t.user_name}` : ''}</div>
                    {t.unsent_count > 0 && <span className="badge yellow">{t.unsent_count} yeni sipariş</span>}
                    {t.paid_total > 0 && <span className="badge green">{money(t.paid_total)} ödendi</span>}
                  </>
                ) : <div className="tc-meta">Boş</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {!list.length && <div className="card empty">{tables.loading ? 'Yükleniyor…' : 'Henüz masa yok. "Masaları düzenle" ile ekleyin.'}</div>}
      {edit && <TableEditor tables={list} onClose={() => { setEdit(false); tables.reload(); }} />}
      {qr && <QrMenuModal tables={list} onClose={() => { setQr(false); tables.reload(); requests.reload(); }} />}
    </div>
  );
}

/** QR menü ayarları ve masa QR kodlarının yazdırılması. */
function QrMenuModal({ tables, onClose }) {
  const toast = useToast();
  const { settings, reloadSettings } = useSession();
  const [f, setF] = useState({ qrmenu_enabled: settings.qrmenu_enabled === '1', qrmenu_orders: settings.qrmenu_orders === '1',
    qrmenu_note: settings.qrmenu_note || '', public_base_url: settings.public_base_url || '' });
  const base = (f.public_base_url || `${location.origin}${location.pathname}`).replace(/#.*$/, '');
  const urlFor = (t) => `${base}#/menu?t=${t.qr_token}`;
  const save = async () => {
    try {
      await put('/settings', { qrmenu_enabled: f.qrmenu_enabled ? '1' : '0', qrmenu_orders: f.qrmenu_orders ? '1' : '0',
        qrmenu_note: f.qrmenu_note, public_base_url: f.public_base_url });
      await reloadSettings();
      toast.ok('Kaydedildi');
    } catch (e) { toast.err(e); }
  };
  const print = async () => {
    const QR = (await import('qrcode')).default;
    const cards = await Promise.all(tables.map(async (t) => ({ t, src: await QR.toDataURL(urlFor(t), { margin: 1, width: 400 }) })));
    printElement(
      <div className="qr-sheet">
        {cards.map(({ t, src }) => (
          <div key={t.id} className="qr-card">
            <div className="qr-name">{t.name}</div>
            <img src={src} alt="" />
            <div className="qr-sub">{settings.business_name}<br />Menü, garson çağırma ve sipariş için okutun</div>
          </div>
        ))}
      </div>, 'size: A4; margin: 8mm;');
  };
  return (
    <Modal title="QR menü" onClose={onClose} wide
      footer={<><button className="btn" disabled={!tables.length || !f.qrmenu_enabled} onClick={print}><Icon name="print" /> Masa QR kodlarını yazdır</button>
        <div style={{ flex: 1 }} /><button className="btn primary" onClick={save}>Kaydet</button></>}>
      <div className="stack">
        <p className="muted">Her masaya özel QR kod basılır. Müşteri telefonuyla okutunca menüyü görür, garson çağırır, hesap ister; isterseniz sipariş isteği de gönderir. İstekler bu ekranda belirir, garson onaylayınca adisyona eklenir.</p>
        <label className="check"><input type="checkbox" checked={f.qrmenu_enabled} onChange={(e) => setF({ ...f, qrmenu_enabled: e.target.checked })} /> QR menüyü aç</label>
        <label className="check"><input type="checkbox" checked={f.qrmenu_orders} onChange={(e) => setF({ ...f, qrmenu_orders: e.target.checked })} /> Müşteri QR menüden sipariş isteği gönderebilsin (garson onaylar)</label>
        <Field label="Menü notu" hint="Menünün üstünde görünür (Wi-Fi şifresi, kampanya vb.)">
          <input className="input" value={f.qrmenu_note} onChange={(e) => setF({ ...f, qrmenu_note: e.target.value })} />
        </Field>
        <Field label="Herkese açık adres" hint="Müşterinin telefonu bu adrese gider. Bulut kurulumunda alan adınızı yazın (ör. https://kafem.velariskasa.com). Boşsa bu cihazın adresi kullanılır.">
          <input className="input" placeholder={`${location.origin}${location.pathname}`} value={f.public_base_url} onChange={(e) => setF({ ...f, public_base_url: e.target.value })} />
        </Field>
        {tables[0] && f.qrmenu_enabled && <div className="small-text">Örnek: <a href={urlFor(tables[0])} target="_blank" rel="noreferrer">{tables[0].name} menüsü</a></div>}
        <small className="muted">Menüde fiyatı olan aktif ürünler görünür. Bir ürünü gizlemek ya da açıklama eklemek için Stok → ürün → "QR menü" alanları.</small>
      </div>
    </Modal>
  );
}

// ---------- Adisyon ekranı ----------
function TicketScreen({ table, tables, onBack, onSwitch }) {
  const toast = useToast();
  const ask = useConfirm();
  const navigate = useNavigate();
  const { settings } = useSession();
  const [ticket, setTicket] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tab, setTab] = useState('fav');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({}); // ticket_item_id → miktar (hesap bölme / aktarma)
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadProducts().then((p) => { setProducts(p.filter((x) => x.active !== 0)); if (!p.some((x) => x.favorite)) setTab('all'); }).catch(toast.err);
    get('/categories').then(setCategories).catch(() => setCategories(storage.get('vk_categories_cache', [])));
    (table.ticket_id ? get(`/tickets/${table.ticket_id}`) : Promise.resolve(null)).then(setTicket).catch(toast.err);
  }, [table.id, table.ticket_id, toast]);

  const run = async (fn) => {
    if (busy) return null;
    setBusy(true);
    try { return await fn(); } catch (e) { toast.err(e); return null; } finally { setBusy(false); }
  };
  const add = (p) => run(async () => {
    const t = ticket
      ? await post(`/tickets/${ticket.id}/items`, { items: [{ product_id: p.id, qty: 1 }] })
      : await post(`/tables/${table.id}/ticket`, { items: [{ product_id: p.id, qty: 1 }] });
    setTicket(t);
  });
  const setItemQty = (it, n) => run(async () => {
    if (n <= 0) setTicket(await post(`/tickets/${ticket.id}/items/${it.id}/void`, {}));
    else setTicket(await put(`/tickets/${ticket.id}/items/${it.id}`, { qty: n }));
  });

  const kitchen = () => run(async () => {
    const r = await post(`/tickets/${ticket.id}/kitchen`);
    setTicket(r.ticket);
    printElement(<KitchenTicket k={r.kitchen} />);
    toast.ok('Sipariş mutfağa gönderildi');
  });

  const live = (ticket?.items || []).filter((i) => !i.void_at);
  const payable = live.filter((i) => i.remaining_qty > 0);
  const selected = payable.filter((i) => sel[i.id] > 0);
  const selTotal = selected.reduce((a, i) => a + Math.round(sel[i.id] * i.unit_price), 0);
  const toggle = (i) => setSel((s) => ({ ...s, [i.id]: s[i.id] ? 0 : i.remaining_qty }));

  const checkout = async (lines, partial) => {
    if (ticket.unsent_count && !(await ask('Mutfağa gönderilmemiş sipariş var. Yine de hesaba geçilsin mi?', { ok: 'Devam', danger: false }))) return;
    navigate('/kasa', { state: { ticket: { id: ticket.id, table_name: ticket.table_name, customer_id: ticket.customer_id, partial,
      items: lines.map(([i, n]) => ({ ticket_item_id: i.id, product_id: i.product_id, name: i.note ? `${i.name} (${i.note})` : i.name, unit: i.unit, qty: n, unit_price: i.unit_price, vat_rate: i.vat_rate })) } } });
  };

  const cancelTicket = async () => {
    const sent = live.some((i) => i.sent_at);
    if (sent) { setModal({ type: 'cancel' }); return; }
    if (!(await ask(`${ticket.table_name} adisyonu iptal edilsin mi?`, { ok: 'İptal et' }))) return;
    run(async () => { await post(`/tickets/${ticket.id}/cancel`, {}); onBack(); });
  };

  const tabs = [
    ...(products.some((p) => p.favorite) ? [{ id: 'fav', name: '★ Sık' }] : []),
    { id: 'all', name: 'Tümü' },
    ...categories.filter((c) => c.product_count > 0).map((c) => ({ id: c.id, name: c.name })),
  ];
  const term = q.trim().toLocaleLowerCase('tr');
  const visible = products.filter((p) => (term ? p.name.toLocaleLowerCase('tr').includes(term)
    : tab === 'fav' ? p.favorite : tab === 'all' ? true : p.category_id === tab));

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="row">
          <button className="btn" onClick={onBack}>← Masalar</button>
          <input className="input" placeholder="Ürün ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!term && <div className="tabs">{tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.name}</button>)}</div>}
        <div className="product-grid">
          {visible.map((p) => (
            <button key={p.id} className="tile" disabled={busy} style={{ '--cat': p.category_color || undefined }} onClick={() => add(p)}>
              <span className="t-name">{p.name}</span>
              <span className="t-price">{money(p.sell_price)}</span>
            </button>
          ))}
          {!visible.length && <div className="empty" style={{ gridColumn: '1/-1' }}>Ürün yok</div>}
        </div>
      </div>

      <div className="pos-right">
        <div className="cart-head">
          <Icon name="table" width={22} height={22} />
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 18 }}>{table.name}</strong>
            {ticket && <div className="muted small-text">{since(ticket.opened_at)} · {ticket.user_name}{ticket.customer_name ? ` · ${ticket.customer_name}` : ''}</div>}
          </div>
          {ticket && <button className="btn small" onClick={() => setModal({ type: 'guests' })}>{ticket.guest_count ? `${ticket.guest_count} kişi` : 'Kişi'}</button>}
          {ticket && <button className="btn small" onClick={() => setModal({ type: 'move' })} title="Masayı taşı / birleştir">Taşı</button>}
        </div>

        <div className="cart-items">
          {live.map((i) => {
            const paid = i.remaining_qty <= 0;
            return (
              <div key={i.id} className={`cart-line ${sel[i.id] ? 'sel' : ''} ${paid ? 'paid' : ''}`} onClick={() => !paid && toggle(i)}>
                <div>
                  <div className="l-name">
                    {!paid && <input type="checkbox" readOnly checked={!!sel[i.id]} style={{ marginRight: 8, verticalAlign: 'middle' }} />}
                    {i.name}{!i.sent_at && <span className="badge yellow" style={{ marginLeft: 6 }}>yeni</span>}
                    {paid && <span className="badge green" style={{ marginLeft: 6 }}>ödendi</span>}
                  </div>
                  <div className="l-meta">{fmtQty(i.qty)} × {plain(i.unit_price)}{i.paid_qty > 0 && !paid ? ` · ${fmtQty(i.paid_qty)} ödendi` : ''}{i.note ? ` · ${i.note}` : ''}{i.sent_at ? ` · ${dt(i.sent_at).split(' ').pop()}` : ''}</div>
                </div>
                <div className="l-total">{money(Math.round(i.qty * i.unit_price))}</div>
                {!paid && (
                  <div className="row" style={{ gridColumn: '1 / -1' }} onClick={(e) => e.stopPropagation()}>
                    {!i.sent_at ? (
                      <>
                        <div className="qty-ctl">
                          <button disabled={busy} onClick={() => setItemQty(i, +(i.qty - 1).toFixed(3))}>−</button>
                          <strong style={{ minWidth: 32, textAlign: 'center' }}>{fmtQty(i.qty)}</strong>
                          <button disabled={busy} onClick={() => setItemQty(i, +(i.qty + 1).toFixed(3))}>+</button>
                        </div>
                        <button className="btn small ghost" onClick={() => setModal({ type: 'note', item: i })}>Not</button>
                      </>
                    ) : sel[i.id] && i.remaining_qty > 1 ? (
                      <div className="qty-ctl">
                        <button onClick={() => setSel({ ...sel, [i.id]: Math.max(1, sel[i.id] - 1) })}>−</button>
                        <strong style={{ minWidth: 60, textAlign: 'center' }}>{fmtQty(sel[i.id])}/{fmtQty(i.remaining_qty)}</strong>
                        <button onClick={() => setSel({ ...sel, [i.id]: Math.min(i.remaining_qty, sel[i.id] + 1) })}>+</button>
                      </div>
                    ) : null}
                    <div style={{ flex: 1 }} />
                    {i.sent_at && <button className="btn small ghost danger-text" onClick={() => setModal({ type: 'void', item: i })}>İptal / ikram</button>}
                  </div>
                )}
              </div>
            );
          })}
          {!live.length && <div className="empty"><Icon name="table" width={40} height={40} /><p>Masa boş. Soldan ürün seçerek sipariş açın.</p></div>}
        </div>

        {ticket && (
          <div className="cart-sum">
            {ticket.paid_total > 0 && <div className="line"><span>Ödenen</span><span className="success-text">{money(ticket.paid_total)}</span></div>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn small ghost" disabled={!live.length} onClick={() => printElement(<Bill ticket={ticket} settings={settings} />)}><Icon name="print" /> Adisyon</button>
              {selected.length > 0 && <button className="btn small ghost" onClick={() => setModal({ type: 'transfer' })}>Seçileni aktar</button>}
              <button className="btn small ghost danger-text" onClick={cancelTicket}>İptal</button>
            </div>
            <div className="total"><span>KALAN</span><span>{money(ticket.remaining_total)}</span></div>
          </div>
        )}
        <div className="pay-buttons">
          <button className="btn" disabled={!ticket?.unsent_count || busy} onClick={kitchen}>Mutfağa<small>{ticket?.unsent_count || 0} yeni</small></button>
          <button className="btn" disabled={!selected.length} onClick={() => checkout(selected.map((i) => [i, sel[i.id]]), true)}>Seçileni öde<small>{money(selTotal)}</small></button>
          <button className="btn success" disabled={!payable.length} onClick={() => checkout(payable.map((i) => [i, i.remaining_qty]), false)}>Hesabı al<small>{money(ticket?.remaining_total || 0)}</small></button>
        </div>
      </div>

      {modal?.type === 'note' && <NoteModal item={modal.item} onClose={() => setModal(null)}
        onSave={(note) => run(async () => { setTicket(await put(`/tickets/${ticket.id}/items/${modal.item.id}`, { note })); setModal(null); })} />}
      {modal?.type === 'void' && <VoidModal item={modal.item} onClose={() => setModal(null)}
        onSave={(body) => run(async () => { setTicket(await post(`/tickets/${ticket.id}/items/${modal.item.id}/void`, body)); setSel({}); setModal(null); })} />}
      {modal?.type === 'cancel' && <VoidModal title="Adisyon iptali" onClose={() => setModal(null)}
        onSave={({ reason }) => run(async () => { await post(`/tickets/${ticket.id}/cancel`, { reason }); onBack(); })} />}
      {modal?.type === 'guests' && <GuestsModal ticket={ticket} onClose={() => setModal(null)}
        onSave={(body) => run(async () => { setTicket(await put(`/tickets/${ticket.id}`, body)); setModal(null); })} />}
      {(modal?.type === 'move' || modal?.type === 'transfer') && (
        <PickTable title={modal.type === 'move' ? 'Masayı taşı / birleştir' : `${selected.length} kalemi aktar`} tables={tables} current={table.id}
          hint={modal.type === 'move' ? 'Dolu bir masa seçerseniz iki adisyon birleştirilir.' : 'Seçili kalemler hedef masanın adisyonuna eklenir.'}
          onClose={() => setModal(null)}
          onPick={(target) => run(async () => {
            if (modal.type === 'move') {
              await post(`/tickets/${ticket.id}/move`, { table_id: target.id });
              toast.ok(target.ticket_id ? `${target.name} ile birleştirildi` : `${target.name} masasına taşındı`);
            } else {
              await post(`/tickets/${ticket.id}/transfer`, { table_id: target.id, items: selected.map((i) => ({ id: i.id, qty: sel[i.id] })) });
              toast.ok(`${target.name} masasına aktarıldı`);
            }
            setModal(null); setSel({});
            const fresh = await get('/tables');
            onSwitch(fresh.find((t) => t.id === (modal.type === 'move' ? target.id : table.id)) || target);
          })} />
      )}
    </div>
  );
}

function NoteModal({ item, onClose, onSave }) {
  const [note, setNote] = useState(item.note || '');
  const quick = ['Şekersiz', 'Az şekerli', 'Orta', 'Sade', 'Bol köpüklü', 'Acısız', 'Paket'];
  return (
    <Modal title={`Not · ${item.name}`} onClose={onClose} footer={<button className="btn primary" onClick={() => onSave(note)}>Kaydet</button>}>
      <div className="stack">
        <input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(note)} />
        <div className="row wrap">{quick.map((x) => <button key={x} className="btn small" onClick={() => setNote(note ? `${note}, ${x.toLocaleLowerCase('tr')}` : x)}>{x}</button>)}</div>
      </div>
    </Modal>
  );
}

function VoidModal({ item, title, onClose, onSave }) {
  const [reason, setReason] = useState('');
  const [n, setN] = useState(item ? item.remaining_qty : 0);
  const reasons = ['İkram', 'Müşteri vazgeçti', 'Yanlış sipariş', 'Ürün bozuk / iade'];
  return (
    <Modal title={title || `İptal / ikram · ${item.name}`} onClose={onClose}
      footer={<button className="btn danger" disabled={!reason.trim()} onClick={() => onSave(item ? { qty: n, reason } : { reason })}>Onayla</button>}>
      <div className="stack">
        {item && item.remaining_qty > 1 && (
          <Field label="Miktar">
            <div className="qty-ctl">
              <button onClick={() => setN(Math.max(1, n - 1))}>−</button><strong style={{ minWidth: 40, textAlign: 'center' }}>{fmtQty(n)}</strong>
              <button onClick={() => setN(Math.min(item.remaining_qty, n + 1))}>+</button>
            </div>
          </Field>
        )}
        <Field label="Sebep" hint="Gün sonunda iptal / ikram raporunda görünür">
          <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="row wrap">{reasons.map((x) => <button key={x} className={`btn small ${reason === x ? 'primary' : ''}`} onClick={() => setReason(x)}>{x}</button>)}</div>
      </div>
    </Modal>
  );
}

function GuestsModal({ ticket, onClose, onSave }) {
  const [n, setN] = useState(ticket.guest_count || 1);
  const [note, setNote] = useState(ticket.note || '');
  return (
    <Modal title="Masa bilgisi" onClose={onClose} footer={<button className="btn primary" onClick={() => onSave({ guest_count: n, note })}>Kaydet</button>}>
      <div className="stack">
        <Field label="Kişi sayısı">
          <div className="row wrap">{[1, 2, 3, 4, 5, 6, 8, 10].map((x) => <button key={x} className={`btn ${n === x ? 'primary' : ''}`} onClick={() => setN(x)}>{x}</button>)}</div>
        </Field>
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PickTable({ title, hint, tables, current, onClose, onPick }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="muted">{hint}</p>
      <div className="table-grid">
        {tables.filter((t) => t.id !== current).map((t) => (
          <button key={t.id} className={`table-card small ${t.ticket_id ? 'busy' : ''}`} onClick={() => onPick(t)}>
            <div className="tc-name">{t.name}</div>
            <div className="tc-meta">{t.ticket_id ? `Dolu · ${money(t.remaining_total)}` : 'Boş'}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function TableEditor({ tables, onClose }) {
  const toast = useToast();
  const [bulk, setBulk] = useState({ count: 4, prefix: 'Masa', zone: '', start: tables.length + 1 });
  const [rows, setRows] = useState(tables.map((t) => ({ id: t.id, name: t.name, zone: t.zone || '', busy: !!t.ticket_id })));
  const reload = async () => {
    const t = await get('/tables');
    setRows(t.map((x) => ({ id: x.id, name: x.name, zone: x.zone || '', busy: !!x.ticket_id })));
    setBulk((b) => ({ ...b, start: t.length + 1 }));
  };
  const addBulk = async () => {
    try { await post('/tables', bulk); toast.ok(`${bulk.count} masa eklendi`); reload(); } catch (e) { toast.err(e); }
  };
  const save = async (r, extra = {}) => {
    try { await put(`/tables/${r.id}`, { name: r.name, zone: r.zone, ...extra }); if (extra.active === false) reload(); } catch (e) { toast.err(e); }
  };
  return (
    <Modal title="Masaları düzenle" onClose={onClose} wide>
      <div className="stack">
        <div className="card card-pad row wrap" style={{ background: 'var(--panel-2)', boxShadow: 'none', alignItems: 'flex-end' }}>
          <Field label="Adet"><input className="input" style={{ width: 80 }} inputMode="numeric" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} /></Field>
          <Field label="Ad"><input className="input" style={{ width: 120 }} value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} /></Field>
          <Field label="İlk no"><input className="input" style={{ width: 80 }} inputMode="numeric" value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: e.target.value })} /></Field>
          <Field label="Bölüm"><input className="input" style={{ width: 140 }} placeholder="Salon, Bahçe…" value={bulk.zone} onChange={(e) => setBulk({ ...bulk, zone: e.target.value })} /></Field>
          <button className="btn primary" onClick={addBulk}><Icon name="plus" /> Ekle</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="table">
            <thead><tr><th>Masa</th><th>Bölüm</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td><input className="input" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} onBlur={() => save(r)} /></td>
                  <td><input className="input" value={r.zone} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, zone: e.target.value } : x)))} onBlur={() => save(r)} /></td>
                  <td className="right"><button className="btn small ghost danger-text" disabled={r.busy} title={r.busy ? 'Açık adisyon var' : ''} onClick={() => save(r, { active: false })}><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Yazdırma ----------
function KitchenTicket({ k }) {
  return (
    <div className="receipt kitchen">
      <div className="c b big">{k.table_name}</div>
      <div className="c">{k.zone ? `${k.zone} · ` : ''}{dt(k.sent_at)}</div>
      <div className="c">Garson: {k.waiter}{k.guest_count ? ` · ${k.guest_count} kişi` : ''}</div>
      <hr />
      {k.items.map((i, n) => (
        <div key={n} style={{ marginBottom: 4 }}>
          <div className="b big">{fmtQty(i.qty)} × {i.name}</div>
          {i.note && <div>  → {i.note}</div>}
        </div>
      ))}
      <hr />
    </div>
  );
}

function Bill({ ticket, settings }) {
  const live = ticket.items.filter((i) => !i.void_at);
  return (
    <div className="receipt">
      <div className="c b big">{settings.business_name}</div>
      <div className="c b">ADİSYON · {ticket.table_name}</div>
      <div className="c">{dt(new Date().toLocaleString('sv-SE'))}</div>
      <hr />
      {live.map((i) => (
        <div className="r" key={i.id}><span>{fmtQty(i.qty)} {i.name}</span><span>{plain(Math.round(i.qty * i.unit_price))}</span></div>
      ))}
      <hr />
      <div className="r b"><span>TOPLAM</span><span>{plain(ticket.total)}</span></div>
      {ticket.paid_total > 0 && <div className="r"><span>Ödenen</span><span>{plain(ticket.paid_total)}</span></div>}
      {ticket.paid_total > 0 && <div className="r b"><span>KALAN</span><span>{plain(ticket.remaining_total)}</span></div>}
      {ticket.guest_count > 1 && <div className="r"><span>Kişi başı ({ticket.guest_count})</span><span>{plain(Math.ceil(ticket.remaining_total / ticket.guest_count))}</span></div>}
      <hr />
      <div className="c">Bilgi amaçlıdır, mali değeri yoktur.</div>
    </div>
  );
}
