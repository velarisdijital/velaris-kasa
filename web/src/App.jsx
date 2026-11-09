import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import logo from './assets/logo.svg';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { flushQueue, get, getToken, offlineQueue, onQueueChange, post, serverUrl, setToken, setUnauthorizedHandler } from './api.js';
import { ConfirmProvider, Icon, ToastProvider } from './components/ui.jsx';
import DemoBar from './demo/DemoBar.jsx';
import Appointments from './pages/Appointments.jsx';
import { BookingPage, ManageBooking } from './pages/Booking.jsx';
import Customers from './pages/Customers.jsx';
import Login from './pages/Login.jsx';
import MenuPage from './pages/Menu.jsx';
import Pos from './pages/Pos.jsx';
import Purchases from './pages/Purchases.jsx';
import Tables from './pages/Tables.jsx';
import Kitchen from './pages/Kitchen.jsx';
import StockCount from './pages/StockCount.jsx';
import Deliveries from './pages/Deliveries.jsx';
import Products from './pages/Products.jsx';
import Reports from './pages/Reports.jsx';
import Sales from './pages/Sales.jsx';
import Settings from './pages/Settings.jsx';
import Setup from './pages/Setup.jsx';
import Shift from './pages/Shift.jsx';

const SessionCtx = createContext(null);
export const useSession = () => useContext(SessionCtx);
export const isManager = (u) => u && ['admin', 'manager'].includes(u.role);
/** Paket özelliği açık mı? (sunucu da ayrıca denetler) */
export const useCan = () => { const s = useSession(); return (f) => !!s?.license?.features?.includes(f); };

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <HashRouter>
          {import.meta.env.VITE_DEMO && !import.meta.env.VITE_APP && <DemoBar />}
          <Gate />
        </HashRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}

/** Online randevu sayfaları girişsiz açılır; geri kalan her şey oturum ister. */
function Gate() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/randevu-al')) return <BookingPage />;
  if (pathname.startsWith('/menu')) return <MenuPage />;
  if (pathname.startsWith('/r/')) {
    return <Routes><Route path="/r/:token" element={<ManageBooking />} /></Routes>;
  }
  return <Root />;
}

function Root() {
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({});
  const [booting, setBooting] = useState(true);

  const [license, setLicense] = useState(null);
  const reloadSettings = useCallback(async () => {
    const [s, l] = await Promise.all([get('/settings'), get('/license').catch(() => null)]);
    setSettings(s);
    setLicense(l);
  }, []);

  const boot = useCallback(async () => {
    try {
      setStatus(await get('/setup/status'));
      if (getToken()) {
        const me = await get('/auth/me');
        setUser(me.user);
        await reloadSettings();
        flushQueue();
      }
    } catch (e) {
      if (e.status === 0) setStatus((s) => s || { offline: true });
    } finally {
      setBooting(false);
    }
  }, [reloadSettings]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    boot();
  }, [boot]);

  const login = async ({ token, user: u }) => {
    setToken(token);
    setUser(u);
    await reloadSettings();
    flushQueue();
  };
  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    setToken(null);
    setUser(null);
    setStatus(await get('/setup/status').catch(() => status));
  };

  if (booting) return <div className="center-screen muted">Yükleniyor…</div>;
  if (status?.offline && !user) {
    return (
      <div className="center-screen">
        <div className="card card-pad stack" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2>Sunucuya ulaşılamıyor</h2>
          <p className="muted">Kasa sunucusu kapalı ya da ağ bağlantısı yok. Ana bilgisayarın açık olduğundan emin olun.{serverUrl() ? ` (${serverUrl()})` : ''}</p>
          <button className="btn primary" onClick={() => { setBooting(true); boot(); }}>Tekrar dene</button>
          {serverUrl() && <button className="btn ghost" onClick={() => import('./serverMode.js').then((m) => { m.useLocalData(); location.reload(); })}>Bu tabletin kendi verisiyle aç</button>}
        </div>
      </div>
    );
  }
  if (!status?.setup_done) {
    return <Setup onDone={async (res) => { await login(res); setStatus(await get('/setup/status')); }} />;
  }
  if (!user) return <Login status={status} onLogin={login} />;

  const appointmentsOn = settings.modules_appointments === '1' && !!license?.features?.includes('appointments');
  const tablesOn = settings.modules_tables === '1' && !!license?.features?.includes('tables');
  const deliveryOn = settings.modules_delivery === '1' && !!license?.features?.includes('tables');
  // Mutfak rolü: yalnızca mutfak ekranı
  if (user.role === 'kitchen') {
    return (
      <SessionCtx.Provider value={{ user, settings, license, reloadSettings, logout, waiter: false }}>
        <div className="app waiter-mode">
          <nav className="sidebar">
            <div className="logo"><img src={logo} alt="VelarisKasa" /></div>
            <NavItem to="/mutfak" icon="chef" label="Mutfak" />
            <div className="spacer" />
            <button className="nav-link btn ghost" onClick={logout} title={`${user.name} — çıkış`}><Icon name="logout" /><span>Çıkış</span></button>
          </nav>
          <div className="main">
            <OfflineBanner />
            <Routes>
              <Route path="/mutfak" element={tablesOn ? <Kitchen /> : <div className="page"><div className="card card-pad">Mutfak ekranı için Ayarlar → İşletme'den masa modülünü açın.</div></div>} />
              <Route path="*" element={<Navigate to="/mutfak" replace />} />
            </Routes>
          </div>
        </div>
      </SessionCtx.Provider>
    );
  }
  // Garson modu: masa modülü açıkken "Personel" rolü yalnızca masaları (ve varsa randevuları) görür, ödeme kasada alınır
  const waiter = tablesOn && user.role === 'staff';
  if (waiter) {
    return (
      <SessionCtx.Provider value={{ user, settings, license, reloadSettings, logout, waiter }}>
        <div className="app waiter-mode">
          <nav className="sidebar">
            <div className="logo"><img src={logo} alt="VelarisKasa" /></div>
            <NavItem to="/masalar" icon="table" label="Masalar" />
            {appointmentsOn && <NavItem to="/randevu" icon="calendar" label="Randevu" />}
            <div className="spacer" />
            <button className="nav-link btn ghost" onClick={logout} title={`${user.name} — çıkış`}><Icon name="logout" /><span>Çıkış</span></button>
          </nav>
          <div className="main">
            <OfflineBanner />
            <UpdateBanner />
            <Routes>
              <Route path="/masalar" element={<Tables />} />
              {appointmentsOn && <Route path="/randevu" element={<Appointments />} />}
              <Route path="*" element={<Navigate to="/masalar" replace />} />
            </Routes>
          </div>
        </div>
      </SessionCtx.Provider>
    );
  }
  return (
    <SessionCtx.Provider value={{ user, settings, license, reloadSettings, logout, waiter: false }}>
      <div className="app">
        <nav className="sidebar">
          <div className="logo"><img src={logo} alt="VelarisKasa" /></div>
          <NavItem to="/kasa" icon="pos" label="Kasa" />
          {tablesOn && <NavItem to="/masalar" icon="table" label="Masalar" />}
          {tablesOn && <NavItem to="/mutfak" icon="chef" label="Mutfak" />}
          {deliveryOn && <NavItem to="/paket" icon="bag" label="Paket" />}
          {appointmentsOn && <NavItem to="/randevu" icon="calendar" label="Randevu" />}
          <NavItem to="/urunler" icon="box" label="Stok" />
          {isManager(user) && <NavItem to="/alis" icon="truck" label="Alış" />}
          <NavItem to="/musteriler" icon="users" label="Müşteri" />
          <NavItem to="/satislar" icon="receipt" label="Satışlar" />
          <NavItem to="/gun-sonu" icon="cash" label="Gün Sonu" />
          {isManager(user) && <NavItem to="/raporlar" icon="chart" label="Raporlar" />}
          {user.role === 'admin' && <NavItem to="/ayarlar" icon="settings" label="Ayarlar" />}
          <div className="spacer" />
          <button className="nav-link btn ghost" onClick={logout} title={`${user.name} — çıkış`}>
            <Icon name="logout" /><span>Çıkış</span>
          </button>
        </nav>
        <div className="main">
          <OfflineBanner />
          <UpdateBanner />
          <LicenseBanner license={license} admin={user.role === 'admin'} />
          <Routes>
            <Route path="/kasa" element={<Pos />} />
            {tablesOn && <Route path="/masalar" element={<Tables />} />}
            {tablesOn && <Route path="/mutfak" element={<Kitchen />} />}
            {deliveryOn && <Route path="/paket" element={<Deliveries />} />}
            {appointmentsOn && <Route path="/randevu" element={<Appointments />} />}
            <Route path="/urunler" element={<Products />} />
            <Route path="/sayim" element={<StockCount />} />
            {isManager(user) && <Route path="/alis" element={<Purchases />} />}
            <Route path="/musteriler" element={<Customers />} />
            <Route path="/satislar" element={<Sales />} />
            <Route path="/gun-sonu" element={<Shift />} />
            {isManager(user) && <Route path="/raporlar" element={<Reports />} />}
            {user.role === 'admin' && <Route path="/ayarlar" element={<Settings />} />}
            <Route path="*" element={<Navigate to="/kasa" replace />} />
          </Routes>
        </div>
      </div>
    </SessionCtx.Provider>
  );
}

function NavItem({ to, icon, label }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <Icon name={icon} /><span>{label}</span>
    </NavLink>
  );
}

function LicenseBanner({ license, admin }) {
  if (license?.status === 'trial') {
    const left = Math.max(0, Math.ceil((new Date(`${license.trial_until}T23:59`) - new Date()) / 86400000));
    return <div className="banner blue">Deneme sürümü: tüm özellikler {left} gün daha açık.{admin && <> Lisans anahtarınızı girin: <NavLink className="btn small" to="/ayarlar?sekme=paket">Paket</NavLink></>}</div>;
  }
  if (license?.trial_ended && license.status === 'free') {
    return <div className="banner warn">Deneme süresi bitti; Ücretsiz paketteyiz (veriler duruyor).{admin && <NavLink className="btn small" to="/ayarlar?sekme=paket">Lisans gir</NavLink>}</div>;
  }
  if (!license || !['grace', 'expired', 'invalid'].includes(license.status)) return null;
  const text = license.status === 'grace'
    ? `${license.plan_name} lisansınızın süresi doldu. ${license.grace_until} tarihine kadar yenilemezseniz Ücretsiz pakete geçilecek.`
    : license.status === 'expired' ? 'Lisans süresi doldu; Ücretsiz pakete geçildi. Yenilemek için Velaris Dijital ile iletişime geçin.'
      : `Lisans geçersiz: ${license.error}`;
  return <div className="banner red">{text}{admin && <NavLink className="btn small" to="/ayarlar?sekme=paket">Paket</NavLink>}</div>;
}

/**
 * Android uygulaması: uygulama içi güncelleme. Yeni sürüm arka planda indirilir; "Yeniden başlat" ile (ya da bir
 * sonraki açılışta kendiliğinden) devreye girer. Android eklentisi de değiştiyse tek dokunuşla APK kurulur.
 */
function UpdateBanner() {
  const [upd, setUpd] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!import.meta.env.VITE_APP) return undefined;
    const check = () => import('./ota.js').then((m) => m.checkAndPrepare()).then(setUpd).catch(() => {});
    const first = setTimeout(check, 5000);
    const every = setInterval(check, 3 * 3600 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  if (!upd || hidden) return null;
  const restart = async () => { setBusy(true); try { const m = await import('./ota.js'); if (!(await m.applyPending())) location.reload(); } catch (e) { setErr(e.message || String(e)); setBusy(false); } };
  const install = async () => { setBusy(true); setErr(''); try { await (await import('./ota.js')).installApk(upd.apkUrl); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); } };
  return (
    <div className="banner blue">
      {upd.kind === 'web' ? (
        <span style={{ flex: 1 }}>Yeni sürüm <b>{upd.version}</b> indirildi. Uygun bir anda <b>Yeniden başlat</b>'a basın (ya da uygulamayı kapatıp açın). Verileriniz silinmez.</span>
      ) : (
        <span style={{ flex: 1 }}>Yeni sürüm <b>{upd.version}</b> uygulama güncellemesi istiyor. <b>Güncelle</b>'ye basın; indirme bitince Android'in ekranında "Güncelle" deyin. Verileriniz silinmez.{err && <span className="danger-text"> {err}</span>}</span>
      )}
      {upd.kind === 'web'
        ? <button className="btn small primary" disabled={busy} onClick={restart}>Yeniden başlat</button>
        : <button className="btn small primary" disabled={busy} onClick={install}>{busy ? 'İndiriliyor…' : 'Güncelle'}</button>}
      <button className="btn small ghost" onClick={() => setHidden(true)}>Daha sonra</button>
    </div>
  );
}

function OfflineBanner() {
  const [queue, setQueue] = useState(offlineQueue());
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const off = onQueueChange(setQueue);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { off(); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online && !queue.length) return null;
  return (
    <div className="banner warn">
      <Icon name="wifi_off" width={18} />
      {!online ? 'Çevrimdışı çalışıyorsunuz. ' : ''}
      {queue.length > 0 && `${queue.length} satış sunucuya gönderilmeyi bekliyor.`}
      {queue.length > 0 && <button className="btn small" onClick={flushQueue}>Şimdi gönder</button>}
    </div>
  );
}
