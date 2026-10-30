import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));
const render = () => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.VITE_DEMO) {
  root.render(<div className="center-screen muted">Demo hazırlanıyor, örnek satışlar oluşturuluyor…</div>);
  import('./demo/backend.js').then((m) => m.ensureDemo()).then(render, (e) => {
    root.render(<div className="center-screen danger-text">Demo başlatılamadı: {String(e?.message || e)}</div>);
  });
} else {
  render();
}

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
