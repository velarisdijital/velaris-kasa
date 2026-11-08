import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// ---------- Bildirimler ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'info') => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, message, type }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), type === 'error' ? 5000 : 2800);
  }, []);
  // Bileşen dışından bildirim: window.dispatchEvent(new CustomEvent('vk-toast', { detail: { type, message } }))
  useEffect(() => {
    const on = (e) => push(e.detail?.message, e.detail?.type || 'info');
    window.addEventListener('vk-toast', on);
    return () => window.removeEventListener('vk-toast', on);
  }, [push]);
  const api = useMemo(() => Object.assign((m) => push(m), {
    ok: (m) => push(m, 'success'),
    err: (e) => push(typeof e === 'string' ? e : e?.message || 'Hata', 'error'),
  }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Onay penceresi (tarayıcının confirm() kutusu yerine) ----------
const ConfirmCtx = createContext(async () => false);
/** const ask = useConfirm(); if (await ask('Silinsin mi?')) … */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const ask = useCallback((message, { ok = 'Evet', danger = true } = {}) => new Promise((resolve) => {
    setState({ message, ok, danger, resolve });
  }), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Modal title="Onay" onClose={() => close(false)}
          footer={<><button className="btn" onClick={() => close(false)}>Vazgeç</button>
            <button className={`btn ${state.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{state.ok}</button></>}>
          <p style={{ margin: 0 }}>{state.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Kapat"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Basit veri yükleme kancası */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const toast = useToast();
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e }));
      toast.err(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function Avatar({ name, color, size = 44 }) {
  const initials = String(name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toLocaleUpperCase('tr');
  return <div className="avatar" style={{ background: color || undefined, width: size, height: size, fontSize: size * 0.36 }}>{initials}</div>;
}

// ---------- İkonlar (inline SVG, harici bağımlılık yok) ----------
const PATHS = {
  pos: 'M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm4-4h10v4H7zM7 11h2m4 0h2m-8 4h2m4 0h2',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3zm4 5h6m-6 4h6m-6 4h4',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4m8-4v4',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14l5-5-5-5m5 5H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.3-4.3',
  barcode: 'M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  pause: 'M8 5v14m8-14v14',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  download: 'M12 3v12m-5-5l5 5 5-5M4 21h16',
  upload: 'M12 21V9m-5 5l5-5 5 5M4 3h16',
  refund: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  wifi_off: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  camera: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  truck: 'M2 6h12v11H2zM14 10h4l4 4v3h-8M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  table: 'M3 8h18M5 8v12m14-12v12M8 4h8M9 8l-1 6h8l-1-6',
  chef: 'M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V20H6zM6 17h12',
};

export function Icon({ name, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
