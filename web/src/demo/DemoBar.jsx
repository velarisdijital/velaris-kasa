import { useState } from 'react';
import { useConfirm } from '../components/ui.jsx';

const OPTIONS = [
  ['market', 'Market örneği'],
  ['berber', 'Berber örneği'],
  ['kafe', 'Kafe örneği'],
  ['restoran', 'Restoran örneği'],
  [null, 'Boş kurulum (sihirbaz)'],
];

/** Demo sürümünün üst şeridi: giriş bilgileri ve örnek veriyi sıfırlama. */
export default function DemoBar() {
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const reset = async (type, label) => {
    if (!(await ask(`Demodaki tüm veriler silinip "${label}" ile yeniden başlatılsın mı?`, { ok: 'Sıfırla' }))) return;
    setBusy(true);
    const { resetDemo } = await import('./backend.js');
    await resetDemo(type);
    location.hash = '';
    location.reload();
  };
  return (
    <div className="banner demo-bar">
      <strong>Demo</strong>
      <span>Yönetici PIN <code>1234</code> · Kasiyer PIN <code>0000</code> · Personel / Garson PIN <code>2222</code></span>
      <span className="muted small-text" title="Veriler yalnızca bu tarayıcıda tutulur. Yazarkasa ve e-Arşiv simülatörde çalışır, SMS'ler gönderilmez.">Simülasyon modu</span>
      <span style={{ flex: 1 }} />
      <a className="btn small" href="#/randevu-al">Müşteri randevu sayfası</a>
      <span className="muted small-text">Sıfırla:</span>
      {OPTIONS.map(([type, label]) => (
        <button key={label} className="btn small" disabled={busy} onClick={() => reset(type, label)}>{busy ? '…' : label}</button>
      ))}
    </div>
  );
}
