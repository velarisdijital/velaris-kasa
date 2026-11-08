import { useState } from 'react';
import { useConfirm, useToast } from './ui.jsx';

/**
 * Tablet uygulaması: birden çok cihaz için sunucuya bağlanma.
 * hasLocalData: bu tablette kurulmuş veri var mı (varsa boş sunucuya taşıma önerilir)
 */
export default function ServerConnect({ hasLocalData = true, compact = false }) {
  const toast = useToast();
  const ask = useConfirm();
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const probe = async () => {
    setBusy(true); setInfo(null);
    try {
      const m = await import('../serverMode.js');
      setInfo(await m.probeServer(url));
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  };
  const connect = async (migrate) => {
    if (!migrate && hasLocalData && !(await ask('Bu tablet sunucudaki verileri kullanacak. Tabletteki mevcut veriler silinmez, "Bu tablete dön" ile geri dönebilirsiniz. Devam edilsin mi?', { ok: 'Bağlan', danger: false }))) return;
    setBusy(true);
    try {
      const m = await import('../serverMode.js');
      const r = await m.connectToServer(info.url, { migrate });
      toast.ok(r.moved ? `Veriler sunucuya taşındı (${r.moved.products} ürün, ${r.moved.sales} satış). Uygulama yeniden açılıyor…` : 'Sunucuya bağlanıldı. Uygulama yeniden açılıyor…');
      setTimeout(() => location.reload(), 900);
    } catch (e) { toast.err(e); setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {!compact && <div className="muted small-text">Kasa tableti, garson telefonu ve mutfak ekranı aynı veriyi kullansın diye tüm cihazlar aynı sunucuya bağlanır. Sunucu, dükkandaki Windows bilgisayarında çalışan VelarisKasa ya da bulut sunucu olabilir. Windows programı ağdaki adresini açılışta gösterir (ör. 192.168.1.20:4848).</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 220 }} aria-label="Sunucu adresi" placeholder="Sunucu adresi (ör. 192.168.1.20 ya da kasa.isletmem.com)" value={url}
          onChange={(e) => { setUrl(e.target.value); setInfo(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (url.trim()) probe(); } }} />
        <button type="button" className="btn" disabled={busy || !url.trim()} onClick={probe}>Sunucuyu dene</button>
      </div>
      {info && (
        <div className="card card-pad stack" style={{ gap: 8, background: 'var(--primary-soft)', boxShadow: 'none' }}>
          {info.setup_done ? (
            <>
              <div>Sunucu hazır: <b>{info.business_name || 'VelarisKasa'}</b> ({info.url})</div>
              <div><button type="button" className="btn primary" disabled={busy} onClick={() => connect(false)}>Bu sunucuyu kullan</button></div>
            </>
          ) : (
            <>
              <div>Sunucu boş (henüz kurulum yapılmamış): {info.url}</div>
              {hasLocalData
                ? <div className="row wrap" style={{ gap: 8 }}>
                    <button type="button" className="btn primary" disabled={busy} onClick={() => connect(true)}>Bu tabletteki verileri sunucuya taşı ve bağlan</button>
                  </div>
                : <div><button type="button" className="btn primary" disabled={busy} onClick={() => connect(false)}>Bağlan ve kurulumu sunucuda yap</button></div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
