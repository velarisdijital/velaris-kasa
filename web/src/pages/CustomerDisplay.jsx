import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.svg';
import { get, registerName, serverUrl, storage } from '../api.js';
import { useSession } from '../App.jsx';
import { displayMessage, listenLocal } from '../customerDisplay.js';
import { money, qty as fmtQty } from '../format.js';
import { device, isNativeApp } from '../native.js';

// Müşteri ekranı: kasadaki sepeti müşteriye gösterir. Aynı cihazda ayrı pencerede ya da başka bir cihazda
// (tablet/telefon, sunucuya bağlı) açılır. Durumlar: boşta (hoş geldiniz) → sepet → ödeme (teşekkürler, para üstü).
const PAID_MS = 10000;
const POLL_MS = 1000;
const IDLE = { mode: 'idle', lines: [] };

const pickRegister = () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('kasa');
  return q || storage.get('vk_display_register', null) || registerName();
};

export default function CustomerDisplay() {
  const { settings, logout } = useSession();
  const navigate = useNavigate();
  const [register, setRegister] = useState(pickRegister);
  const [state, setState] = useState(IDLE);
  const [registers, setRegisters] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [conn, setConn] = useState(true);
  const seqRef = useRef(0);
  const listRef = useRef(null);
  // Sunucudan sorulur: sunucu modunda ya da gerçek sunucuya tarayıcıyla bağlıyken (tarayıcı içi veride yalnızca aynı cihaz)
  const remote = !import.meta.env.VITE_DEMO || !!serverUrl();

  useEffect(() => { storage.set('vk_display_register', register); seqRef.current = 0; }, [register]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  // Ekran kararmasın, tam ekran (Android uygulaması)
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    device('keepAwake', { on: true }).catch(() => {});
    device('immersive', { on: true }).catch(() => {});
    // Çıkınca kasa modu ayarlarına dön
    return () => { import('../kiosk.js').then((m) => m.applyKiosk()).catch(() => {}); };
  }, []);

  useEffect(() => listenLocal(register, (s) => setState(s || IDLE)), [register]);

  useEffect(() => {
    if (!remote) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const r = await get(`/display/${encodeURIComponent(register)}?since=${seqRef.current}`);
        if (!stop && !r.unchanged) { seqRef.current = r.seq; setState(r.state || IDLE); }
        setConn(true);
      } catch { setConn(false); }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    get('/display').then(setRegisters).catch(() => {});
    return () => { stop = true; clearTimeout(timer); };
  }, [register, remote]);

  // Ödeme ekranı bir süre kalır, sonra boşta ekranına döner
  useEffect(() => {
    if (state.mode !== 'paid') return undefined;
    const t = setTimeout(() => setState((s) => (s.mode === 'paid' ? IDLE : s)), PAID_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Yeni ürün eklenince listenin sonu görünsün
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [state.lines?.length]);

  const name = settings.business_name || 'VelarisKasa';
  // Çıkış: müşteri ekranı cihazında oturum kapanır (müşteri × ile yönetici ekranına geçemesin)
  const exit = async () => {
    if (!window.confirm('Müşteri ekranından çıkılsın mı?')) return;
    const device_ = storage.get('vk_display_device', false);
    storage.set('vk_display_device', false);
    if (window.opener && !device_) { window.close(); return; } // ayrı pencere
    navigate('/');
    if (device_) await logout();
  };

  return (
    <div className={`cd cd-${state.mode}`} data-mode={state.mode}>
      <button className="cd-exit" onClick={exit} aria-label="Müşteri ekranından çık" title="Çık">×</button>
      {!conn && <div className="cd-conn">Kasaya bağlanılıyor…</div>}

      {state.mode === 'idle' && (
        <div className="cd-idle">
          <img src={logo} alt="" className="cd-logo" />
          <h1>{name}</h1>
          <p className="cd-msg">{state.message || displayMessage()}</p>
          <p className="cd-clock">{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      )}

      {state.mode === 'cart' && (
        <div className="cd-cart">
          <section className="cd-lines" ref={listRef} aria-label="Sepet">
            <header><span>{name}</span>{state.customer && <span className="cd-cust">{state.customer}</span>}</header>
            {state.lines.map((l, i) => (
              <div key={i} className={`cd-line${i === state.lines.length - 1 ? ' last' : ''}`}>
                <div className="cd-name">
                  <b>{l.name}</b>
                  <small>{fmtQty(l.qty)}{l.unit && l.unit !== 'adet' ? ` ${l.unit}` : ''} × {money(l.unit_price)}</small>
                  {l.promo && <span className="promo-tag">🏷 {l.promo}</span>}
                </div>
                <div className="cd-amt">{money(l.total)}</div>
              </div>
            ))}
          </section>
          <aside className="cd-sum">
            <div className="cd-count">{state.lines.reduce((a, l) => a + (l.unit === 'adet' || !l.unit ? l.qty : 1), 0)} ürün</div>
            {state.discount > 0 && <div className="cd-row"><span>İndirim</span><span>−{money(state.discount)}</span></div>}
            <div className="cd-total-label">Toplam</div>
            <div className="cd-total" data-total={state.total}>{money(state.total)}</div>
            {state.savings > 0 && <div className="cd-save">Kazancınız {money(state.savings)}</div>}
          </aside>
        </div>
      )}

      {state.mode === 'paid' && (
        <div className="cd-paid">
          <h1>Teşekkürler!</h1>
          <div className="cd-paid-grid">
            <div><span>Toplam</span><b>{money(state.total)}</b></div>
            {state.paid > 0 && <div><span>Ödenen</span><b>{money(state.paid)}</b></div>}
            {state.change > 0 && <div className="cd-change"><span>Para üstü</span><b data-change={state.change}>{money(state.change)}</b></div>}
          </div>
          <p className="cd-msg">Yine bekleriz</p>
        </div>
      )}

      {remote && registers.length > 1 && (
        <select className="cd-register" value={register} onChange={(e) => setRegister(e.target.value)} aria-label="Kasa">
          {registers.map((r) => <option key={r.register} value={r.register}>{r.register}</option>)}
        </select>
      )}
    </div>
  );
}
