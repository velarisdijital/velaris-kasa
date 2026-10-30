import { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import { post } from '../api.js';
import { Avatar } from '../components/ui.jsx';
import { ROLE_LABELS } from '../format.js';

export default function Login({ status, onLogin }) {
  const [user, setUser] = useState(status.users.length === 1 ? status.users[0] : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value) => {
    if (busy || value.length < 4) return;
    setBusy(true);
    try {
      onLogin(await post('/auth/login', { user_id: user.id, pin: value }));
    } catch (e) {
      setError(e.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (k) => {
    setError('');
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return submit(pin);
    const next = (pin + k).slice(0, 8);
    setPin(next);
  };

  useEffect(() => {
    if (!user) return undefined;
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (e.key === 'Escape') { setUser(null); setPin(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="center-screen">
      <div className="card login-card stack">
        <div className="row" style={{ justifyContent: 'center' }}>
          <img src={logo} width="44" height="44" alt="" />
          <div>
            <h1>{status.business_name}</h1>
            <div className="muted small-text">Velaris Kasa</div>
          </div>
        </div>
        {!user ? (
          <>
            <h3 className="muted" style={{ textAlign: 'center' }}>Kullanıcı seçin</h3>
            <div className="user-grid">
              {status.users.map((u) => (
                <button key={u.id} className="user-btn" onClick={() => setUser(u)}>
                  <Avatar name={u.name} color={u.color} />
                  <span>{u.name}</span>
                  <small className="muted">{ROLE_LABELS[u.role]}</small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Avatar name={user.name} color={user.color} size={36} />
              <strong>{user.name}</strong>
              {status.users.length > 1 && <button className="btn small ghost" onClick={() => { setUser(null); setPin(''); }}>Değiştir</button>}
            </div>
            <div className="pin-dots" aria-label="PIN">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
            </div>
            {error && <div className="danger-text" style={{ textAlign: 'center', fontWeight: 600 }}>{error}</div>}
            <div className="numpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
                <button key={k} onClick={() => press(k)} disabled={busy}
                  style={k === 'ok' ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : undefined}>
                  {k === 'del' ? '⌫' : k === 'ok' ? 'Giriş' : k}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
