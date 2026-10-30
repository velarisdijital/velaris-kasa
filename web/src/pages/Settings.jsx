import { useState } from 'react';
import { api, del, get, post, put, registerName, setRegisterName, storage } from '../api.js';
import { useSession } from '../App.jsx';
import { Avatar, Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, ROLE_LABELS } from '../format.js';

const TABS = [['business', 'İşletme'], ['device', 'Bu cihaz'], ['users', 'Kullanıcılar'], ['fiscal', 'Yazarkasa'], ['loyalty', 'Puan'], ['crm', 'Velaris CRM'], ['backup', 'Yedekleme']];

export default function Settings() {
  const [tab, setTab] = useState('business');
  return (
    <div className="page">
      <div className="page-head"><h1>Ayarlar</h1></div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div style={{ maxWidth: 820 }}>
        {tab === 'business' && <Business />}
        {tab === 'device' && <Device />}
        {tab === 'users' && <Users />}
        {tab === 'fiscal' && <Fiscal />}
        {tab === 'loyalty' && <Loyalty />}
        {tab === 'crm' && <Crm />}
        {tab === 'backup' && <Backup />}
      </div>
    </div>
  );
}

function useSettingsForm(keys) {
  const { settings, reloadSettings } = useSession();
  const toast = useToast();
  const [f, setF] = useState(Object.fromEntries(keys.map((k) => [k, settings[k] ?? ''])));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    try { await put('/settings', f); await reloadSettings(); toast.ok('Ayarlar kaydedildi'); } catch (err) { toast.err(err); }
  };
  return { f, set, save };
}

function Business() {
  const { f, set, save } = useSettingsForm(['business_name', 'business_type', 'business_phone', 'business_address', 'tax_number', 'receipt_footer',
    'default_vat', 'allow_negative_stock', 'modules_appointments', 'scale_barcode_prefixes']);
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <div className="grid-2">
        <Field label="İşletme adı"><input className="input" required value={f.business_name} onChange={set('business_name')} /></Field>
        <Field label="İşletme türü">
          <select className="input" value={f.business_type} onChange={set('business_type')}>
            <option value="market">Market / Bakkal</option><option value="berber">Berber / Kuaför</option><option value="kafe">Kafe / Büfe</option><option value="genel">Genel</option>
          </select>
        </Field>
        <Field label="Telefon"><input className="input" value={f.business_phone} onChange={set('business_phone')} /></Field>
        <Field label="Vergi no"><input className="input" value={f.tax_number} onChange={set('tax_number')} /></Field>
      </div>
      <Field label="Adres"><input className="input" value={f.business_address} onChange={set('business_address')} /></Field>
      <Field label="Fiş alt yazısı"><input className="input" value={f.receipt_footer} onChange={set('receipt_footer')} /></Field>
      <div className="grid-2">
        <Field label="Varsayılan KDV %"><select className="input" value={f.default_vat} onChange={set('default_vat')}>{[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
        <Field label="Terazi barkod önekleri" hint="EAN-13 terazi etiketleri (gram). Örn: 27,28,29"><input className="input" value={f.scale_barcode_prefixes} onChange={set('scale_barcode_prefixes')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.allow_negative_stock === '1'} onChange={set('allow_negative_stock')} /> Stok yetersizken de satışa izin ver (eksi stok)</label>
      <label className="check"><input type="checkbox" checked={f.modules_appointments === '1'} onChange={set('modules_appointments')} /> Randevu modülünü aç (berber, kuaför, güzellik vb.)</label>
      <div><button className="btn primary">Kaydet</button></div>
    </form>
  );
}

function Fiscal() {
  const toast = useToast();
  const { f, set, save } = useSettingsForm(['fiscal_driver', 'fiscal_auto', 'fiscal_bridge_url']);
  const [status, setStatus] = useState(null);
  const test = async () => {
    await save();
    const s = await get('/fiscal/status').catch((e) => ({ ok: false, message: e.message }));
    setStatus(s);
    if (s.ok) toast.ok(`Yazarkasa hazır${s.device ? `: ${s.device}` : ''}`); else toast.err(s.message);
  };
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <h2>Yazarkasa (yeni nesil ÖKC)</h2>
      <p className="muted">Gerçek usulde vergilendirilen işletmeler satışları yazarkasadan mali fişle kaydetmek zorundadır. Velaris Kasa satışı yazarkasaya gönderir, kart ödemesi yazarkasaya bağlı POS'tan alınır ve mali fiş numarası satışa işlenir. Basit usul ve esnaf muaflığındaki işletmeler "Yazarkasa yok" seçeneğiyle bilgi fişi kullanabilir.</p>
      <Field label="Bağlantı">
        <select className="input" value={f.fiscal_driver} onChange={set('fiscal_driver')}>
          <option value="none">Yazarkasa yok (bilgi fişi)</option>
          <option value="bridge">Yazarkasa köprüsü (Beko/Token, Hugin, Ingenico, Pavo …)</option>
          <option value="simulator">Simülatör (cihazsız deneme)</option>
        </select>
      </Field>
      {f.fiscal_driver === 'bridge' && (
        <Field label="Köprü adresi" hint="Kasa bilgisayarında çalışan Velaris yazarkasa köprüsünün adresi">
          <input className="input" value={f.fiscal_bridge_url} onChange={set('fiscal_bridge_url')} placeholder="http://127.0.0.1:4850" />
        </Field>
      )}
      {f.fiscal_driver !== 'none' && (
        <label className="check"><input type="checkbox" checked={f.fiscal_auto === '1'} onChange={set('fiscal_auto')} /> Her satışta mali fişi otomatik bas</label>
      )}
      {status && <div className={status.ok ? 'success-text' : 'danger-text'}>{status.ok ? '✓ ' : '✗ '}{status.device ? `${status.device} — ` : ''}{status.message}</div>}
      <div className="row wrap">
        <button className="btn primary">Kaydet</button>
        {f.fiscal_driver !== 'none' && <button type="button" className="btn" onClick={test}>Bağlantıyı test et</button>}
      </div>
      <div className="muted small-text">
        Gün sonunda (Z raporu) yazarkasanın Z raporu da otomatik alınır. Cihaz yanıt vermezse satış kaydedilir ve Satışlar ekranında "Yazarkasaya tekrar gönder" çıkar.
      </div>
    </form>
  );
}

function Loyalty() {
  const { f, set, save } = useSettingsForm(['loyalty_enabled', 'loyalty_rate']);
  const example = Math.floor((10000 * Number(f.loyalty_rate || 0)) / 100);
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <h2>Puan (para puan)</h2>
      <p className="muted">Kayıtlı müşteriler her alışverişte ödedikleri tutarın belirli bir yüzdesini puan olarak kazanır; puanlarını sonraki alışverişlerde kasada ödeme olarak kullanabilir. 1 puan = 1 kuruş.</p>
      <label className="check"><input type="checkbox" checked={f.loyalty_enabled === '1'} onChange={set('loyalty_enabled')} /> <b>Puan sistemini aç</b></label>
      <Field label="Kazanma oranı (%)" hint={`Örnek: 100 TL'lik alışverişte ${(example / 100).toFixed(2).replace('.', ',')} TL puan`}>
        <input className="input" inputMode="decimal" style={{ maxWidth: 160 }} value={f.loyalty_rate} onChange={set('loyalty_rate')} />
      </Field>
      <div className="muted small-text">Veresiye ve puanla ödenen kısımdan puan kazanılmaz. İade edilen satışta kazanılan puan geri alınır.</div>
      <div><button className="btn primary">Kaydet</button></div>
    </form>
  );
}

function Device() {
  const toast = useToast();
  const [name, setName] = useState(registerName());
  const [autoprint, setAutoprint] = useState(storage.get('vk_autoprint', false));
  const save = (e) => {
    e.preventDefault();
    setRegisterName(name.trim());
    storage.set('vk_autoprint', autoprint);
    toast.ok('Cihaz ayarları kaydedildi');
  };
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <p className="muted">Bu ayarlar yalnızca bu bilgisayar/tablet için geçerlidir. Birden fazla kasanız varsa her cihaza farklı bir kasa adı verin.</p>
      <Field label="Kasa adı"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Kasa 1" /></Field>
      <label className="check"><input type="checkbox" checked={autoprint} onChange={(e) => setAutoprint(e.target.checked)} /> Her satıştan sonra fişi otomatik yazdır</label>
      <div className="muted small-text">
        <b>Barkod okuyucu:</b> USB/Bluetooth okuyucular klavye gibi çalışır, ek ayar gerekmez (okuyucunun sonuna "Enter" eklemesi açık olmalı).<br />
        <b>Fiş yazıcı:</b> 80 mm termal yazıcıyı bilgisayarın varsayılan yazıcısı yapın; masaüstü uygulamasında fiş doğrudan basılır.
      </div>
      <div><button className="btn primary">Kaydet</button></div>
    </form>
  );
}

function Users() {
  const users = useLoad(() => get('/users'));
  const [edit, setEdit] = useState(null);
  return (
    <div className="stack">
      <div className="row"><div className="grow" style={{ flex: 1 }} /><button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" /> Yeni kullanıcı</button></div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Ad</th><th>Rol</th><th className="right">Hizmet primi</th><th>Durum</th></tr></thead>
          <tbody>
            {(users.data || []).map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setEdit(u)}>
                <td><div className="row"><Avatar name={u.name} color={u.color} size={30} /> {u.name}</div></td>
                <td>{ROLE_LABELS[u.role]}</td><td className="right">%{u.commission_rate}</td>
                <td>{u.active ? <span className="badge green">Aktif</span> : <span className="badge">Pasif</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small-text">
        <b>Yönetici:</b> her şey · <b>Müdür:</b> ürün, stok, raporlar · <b>Kasiyer:</b> satış, iade, müşteri, gün sonu · <b>Personel:</b> satış ve randevu (berber/kuaför çalışanları)
      </div>
      {edit && <UserForm user={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); }} />}
    </div>
  );
}

function UserForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const u = user || {};
  const [f, setF] = useState({ name: u.name || '', role: u.role || 'cashier', pin: '', commission_rate: u.commission_rate ?? 0, color: u.color || '#2563eb', active: u.active ?? 1 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      if (user) await put(`/users/${user.id}`, f); else await post('/users', f);
      toast.ok('Kaydedildi');
      onSaved();
    } catch (err) { toast.err(err); }
  };
  return (
    <Modal title={user ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'} onClose={onClose} footer={<button className="btn primary" form="uf">Kaydet</button>}>
      <form id="uf" className="stack" onSubmit={save}>
        <div className="grid-2">
          <Field label="Ad"><input className="input" autoFocus required value={f.name} onChange={set('name')} /></Field>
          <Field label="Rol"><select className="input" value={f.role} onChange={set('role')}>{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label={user ? 'Yeni PIN (boş = değişmez)' : 'PIN (4-8 rakam)'}><input className="input" type="password" inputMode="numeric" pattern="\d{4,8}" required={!user} value={f.pin} onChange={set('pin')} /></Field>
          <Field label="Hizmet primi %"><input className="input" inputMode="decimal" value={f.commission_rate} onChange={set('commission_rate')} /></Field>
        </div>
        <div className="row">
          <input type="color" value={f.color} onChange={set('color')} style={{ width: 44, height: 36, border: 0, background: 'none' }} aria-label="Renk" /> <span className="muted">Takvim rengi</span>
          <div style={{ flex: 1 }} />
          <label className="check"><input type="checkbox" checked={!!f.active} onChange={set('active')} /> Aktif</label>
        </div>
      </form>
    </Modal>
  );
}

function Crm() {
  const toast = useToast();
  const ask = useConfirm();
  const { f, set, save } = useSettingsForm(['crm_enabled', 'crm_base_url', 'crm_api_key', 'crm_webhook_secret',
    'crm_sync_customers', 'crm_sync_sales', 'crm_sync_stock', 'crm_sync_appointments']);
  const status = useLoad(() => get('/integration/status'));
  const keys = useLoad(() => get('/api-keys'));
  const [newKey, setNewKey] = useState(null);

  const action = async (path, body, okMsg) => {
    try {
      const r = await post(path, body);
      toast.ok(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      status.reload();
    } catch (err) { toast.err(err.body?.error || err); }
  };
  const genSecret = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    set('crm_webhook_secret')({ target: { value: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''), type: 'text' } });
  };
  const s = status.data;
  const origin = location.origin + location.pathname.replace(/\/$/, '');

  return (
    <div className="stack">
      <form className="card card-pad stack" onSubmit={save}>
        <div className="row">
          <h2 style={{ flex: 1 }}>Velaris CRM bağlantısı</h2>
          <label className="check"><input type="checkbox" checked={f.crm_enabled === '1'} onChange={set('crm_enabled')} /> <b>Entegrasyon açık</b></label>
        </div>
        <p className="muted">Kapalıyken program tamamen bağımsız çalışır. Açıldığında müşteriler, satışlar, veresiye tahsilatları, kritik stok uyarıları, randevular ve gün sonu raporları Velaris CRM'e otomatik gönderilir; CRM'deki müşteriler 5 dakikada bir kasaya çekilir. İnternet kesilirse olaylar sırada bekler, bağlantı gelince gönderilir.</p>
        <Field label="Velaris CRM adresi"><input className="input" value={f.crm_base_url} onChange={set('crm_base_url')} placeholder="https://crm.velaris.com.tr" /></Field>
        <div className="grid-2">
          <Field label="CRM API anahtarı" hint="Velaris CRM → Ayarlar → Entegrasyonlar'dan alınır"><input className="input" value={f.crm_api_key} onChange={set('crm_api_key')} autoComplete="off" /></Field>
          <Field label="İmza anahtarı (webhook secret)" hint="İki tarafta aynı olmalı">
            <div className="row"><input className="input" value={f.crm_webhook_secret} onChange={set('crm_webhook_secret')} autoComplete="off" /><button type="button" className="btn small" onClick={genSecret}>Üret</button></div>
          </Field>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          {[['crm_sync_customers', 'Müşteriler & veresiye'], ['crm_sync_sales', 'Satışlar'], ['crm_sync_stock', 'Ürün & stok'], ['crm_sync_appointments', 'Randevular']].map(([k, l]) =>
            <label key={k} className="check"><input type="checkbox" checked={f[k] === '1'} onChange={set(k)} /> {l}</label>)}
        </div>
        <div className="row wrap">
          <button className="btn primary">Kaydet</button>
          <button type="button" className="btn" onClick={() => action('/integration/test', {}, 'Bağlantı başarılı ✓')}><Icon name="link" /> Bağlantıyı test et</button>
          <button type="button" className="btn" onClick={() => action('/integration/pull-customers', { full: true }, (r) => `${r.imported} müşteri alındı`)}>CRM'den müşterileri çek</button>
          <button type="button" className="btn" onClick={async () => (await ask('Tüm müşteri ve ürünler CRM\'e gönderilsin mi?', { ok: 'Gönder', danger: false })) && action('/integration/push-all', {}, (r) => `${r.queued} kayıt sıraya alındı`)}>Tümünü CRM'e gönder</button>
        </div>
      </form>

      {s && (
        <div className="card card-pad stack">
          <div className="row wrap">
            <h3 style={{ flex: 1 }}>Gönderim kuyruğu</h3>
            <span className="badge yellow">Bekleyen {s.counts.pending}</span>
            <span className="badge green">Gönderilen {s.counts.sent}</span>
            <span className="badge red">Başarısız {s.counts.failed}</span>
            <button className="btn small" onClick={() => action('/integration/flush', {}, (r) => `${r.sent} gönderildi${r.failed ? `, ${r.failed} hata` : ''}`)}>Şimdi gönder</button>
            {s.counts.failed > 0 && <button className="btn small" onClick={() => action('/integration/retry-failed', {}, 'Tekrar sıraya alındı')}>Başarısızları yeniden dene</button>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="table">
              <tbody>
                {s.recent.map((e) => (
                  <tr key={e.id}>
                    <td className="small-text">{dt(e.created_at)}</td><td><code>{e.event}</code></td>
                    <td><span className={`badge ${e.status === 'sent' ? 'green' : e.status === 'failed' ? 'red' : 'yellow'}`}>{e.status === 'sent' ? 'Gönderildi' : e.status === 'failed' ? 'Başarısız' : `Bekliyor (${e.attempts})`}</span></td>
                    <td className="danger-text small-text">{e.last_error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!s.recent.length && <div className="empty">Henüz olay yok</div>}
          </div>
        </div>
      )}

      <div className="card card-pad stack">
        <div className="row"><h3 style={{ flex: 1 }}>API anahtarları (CRM → Kasa erişimi)</h3>
          <button className="btn small primary" onClick={async () => { setNewKey(await post('/api-keys', { name: 'Velaris CRM' })); keys.reload(); }}><Icon name="plus" /> Anahtar oluştur</button></div>
        <p className="muted small-text">Velaris CRM'in ürün, stok, satış ve müşteri verilerini okuyabilmesi için bir anahtar oluşturup CRM'e girin. Adres: <code>{origin}/api/v1</code> · Gelen webhook: <code>{origin}/api/integration/webhook</code></p>
        {(keys.data || []).map((k) => (
          <div key={k.id} className="row">
            <code style={{ flex: 1 }}>{k.prefix}…  <span className="muted">{k.name}</span></code>
            <span className="muted small-text">{k.last_used ? `Son kullanım ${dt(k.last_used)}` : 'Hiç kullanılmadı'}</span>
            <button className="btn small" onClick={async () => (await ask('Anahtar iptal edilsin mi? CRM bu anahtarla artık bağlanamaz.', { ok: 'İptal et' })) && del(`/api-keys/${k.id}`).then(keys.reload)}>İptal et</button>
          </div>
        ))}
      </div>
      {newKey && (
        <Modal title="Yeni API anahtarı" onClose={() => setNewKey(null)}>
          <div className="stack">
            <p>Bu anahtarı şimdi kopyalayın, <b>bir daha gösterilmeyecek</b>:</p>
            <input className="input" readOnly value={newKey.key} onFocus={(e) => e.target.select()} />
            <button className="btn primary" onClick={() => navigator.clipboard?.writeText(newKey.key).then(() => toast.ok('Kopyalandı'))}>Kopyala</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Backup() {
  const toast = useToast();
  const download = async () => {
    try {
      const res = await api('/backup', { raw: true });
      if (!res.ok) throw new Error('Yedek alınamadı');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = (res.headers.get('content-disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'velaris-kasa-yedek.db';
      a.click();
    } catch (err) { toast.err(err); }
  };
  return (
    <div className="card card-pad stack">
      <h2>Yedekleme</h2>
      <p className="muted">Tüm verileriniz (ürünler, satışlar, müşteriler, ayarlar) tek bir dosyada saklanır. Düzenli olarak yedek alıp USB belleğe veya buluta kopyalayın. Geri yüklemek için programı kapatıp yedek dosyayı veri klasöründeki <code>velaris-kasa.db</code> ile değiştirin.</p>
      <div><button className="btn primary" onClick={download}><Icon name="download" /> Yedeği indir</button></div>
    </div>
  );
}
