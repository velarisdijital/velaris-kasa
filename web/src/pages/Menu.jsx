import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { get, post } from '../api.js';
import { money } from '../format.js';

/** Herkese açık QR menü: /#/menu?t={masa anahtarı}. Girişsiz açılır, telefona göre tasarlandı. */
export default function MenuPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get('t') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cat, setCat] = useState(null);
  const [cart, setCart] = useState({}); // product_id → { qty, note }
  const [sheet, setSheet] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get(`/public/menu${token ? `?t=${encodeURIComponent(token)}` : ''}`).then((d) => { setData(d); document.title = `${d.business.name} · Menü`; })
      .catch((e) => setError(e.message || 'Menü açılamadı'));
  }, [token]);

  const products = data?.products || [];
  const byCat = useMemo(() => {
    const groups = (data?.categories || []).map((c) => ({ ...c, items: products.filter((p) => p.category_id === c.id) }));
    const other = products.filter((p) => !p.category_id || !(data?.categories || []).some((c) => c.id === p.category_id));
    if (other.length) groups.push({ id: 0, name: 'Diğer', items: other });
    return groups.filter((g) => g.items.length);
  }, [data, products]);

  const lines = Object.entries(cart).filter(([, v]) => v.qty > 0).map(([id, v]) => ({ ...products.find((p) => p.id === Number(id)), ...v }));
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const setQty = (id, d) => setCart((c) => ({ ...c, [id]: { note: c[id]?.note || '', qty: Math.max(0, Math.min(20, (c[id]?.qty || 0) + d)) } }));

  const send = async (type, extra = {}) => {
    setBusy(true);
    try {
      const r = await post('/public/menu/request', { t: token, type, ...extra });
      setMsg({ ok: true, text: r.message });
      if (type === 'order') { setCart({}); setSheet(false); }
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  if (error) return <div className="menu-page"><div className="menu-empty"><h2>Menü açılamadı</h2><p>{error}</p></div></div>;
  if (!data) return <div className="menu-page"><div className="menu-empty">Yükleniyor…</div></div>;

  return (
    <div className="menu-page">
      <header className="menu-head">
        <h1>{data.business.name}</h1>
        {data.table && <div className="menu-table">{data.table.zone ? `${data.table.zone} · ` : ''}{data.table.name}</div>}
        {data.note && <div className="menu-note">{data.note}</div>}
      </header>
      <nav className="menu-cats">
        {byCat.map((g) => (
          <a key={g.id} href={`#cat-${g.id}`} className={cat === g.id ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); setCat(g.id); document.getElementById(`cat-${g.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{g.name}</a>
        ))}
      </nav>
      <main>
        {byCat.map((g) => (
          <section key={g.id} id={`cat-${g.id}`} className="menu-section">
            <h2 style={{ '--c': g.color || 'var(--accent)' }}>{g.name}</h2>
            {g.items.map((p) => (
              <div key={p.id} className="menu-item">
                <div style={{ flex: 1 }}>
                  <div className="mi-name">{p.name}</div>
                  {p.description && <div className="mi-desc">{p.description}</div>}
                  <div className="mi-price">{money(p.price)}{p.unit !== 'adet' ? ` / ${p.unit}` : ''}</div>
                </div>
                {data.orders_enabled && (
                  cart[p.id]?.qty ? (
                    <div className="mi-qty"><button onClick={() => setQty(p.id, -1)} aria-label="Azalt">−</button><b>{cart[p.id].qty}</b><button onClick={() => setQty(p.id, 1)} aria-label="Artır">+</button></div>
                  ) : <button className="mi-add" onClick={() => setQty(p.id, 1)} aria-label={`${p.name} ekle`}>+</button>
                )}
              </div>
            ))}
          </section>
        ))}
        {!byCat.length && <div className="menu-empty">Menüde ürün yok.</div>}
        <footer className="menu-foot">{data.business.address}{data.business.phone ? ` · ${data.business.phone}` : ''}<br />VelarisKasa ile</footer>
      </main>

      {data.table && (
        <div className="menu-bar">
          {count > 0 ? (
            <button className="menu-btn primary" onClick={() => setSheet(true)}>Sepet ({count}) · {money(total)}</button>
          ) : (
            <>
              <button className="menu-btn" disabled={busy} onClick={() => send('waiter')}>Garson çağır</button>
              <button className="menu-btn" disabled={busy} onClick={() => send('bill')}>Hesap iste</button>
            </>
          )}
        </div>
      )}

      {sheet && (
        <div className="menu-sheet" onClick={() => setSheet(false)}>
          <div className="menu-sheet-body" onClick={(e) => e.stopPropagation()}>
            <h2>Siparişiniz</h2>
            {lines.map((l) => (
              <div key={l.id} className="menu-item">
                <div style={{ flex: 1 }}>
                  <div className="mi-name">{l.name}</div>
                  <input className="mi-note" placeholder="Not (ör. şekersiz)" value={l.note} maxLength={80}
                    onChange={(e) => setCart((c) => ({ ...c, [l.id]: { ...c[l.id], note: e.target.value } }))} />
                </div>
                <div className="mi-qty"><button onClick={() => setQty(l.id, -1)}>−</button><b>{l.qty}</b><button onClick={() => setQty(l.id, 1)}>+</button></div>
              </div>
            ))}
            <div className="menu-total"><span>Toplam</span><b>{money(total)}</b></div>
            <p className="mi-desc">Siparişiniz garsona iletilir; onaylandıktan sonra hazırlanır.</p>
            <button className="menu-btn primary" disabled={busy || !lines.length}
              onClick={() => send('order', { items: lines.map((l) => ({ product_id: l.id, qty: l.qty, note: l.note })) })}>Siparişi gönder</button>
          </div>
        </div>
      )}
      {msg && <div className={`menu-toast ${msg.ok ? '' : 'err'}`} onClick={() => setMsg(null)}>{msg.text}</div>}
    </div>
  );
}
