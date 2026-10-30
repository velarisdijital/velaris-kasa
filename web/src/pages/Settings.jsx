import { useState } from 'react';
import { api, del, get, post, put, registerName, setRegisterName, storage } from '../api.js';
import { useSession } from '../App.jsx';
import { Avatar, Field, Icon, Modal, useConfirm, useLoad, useToast } from '../components/ui.jsx';
import { dt, ROLE_LABELS } from '../format.js';

const TABS = [['business', 'İşletme'], ['device', 'Bu cihaz'], ['users', 'Kullanıcılar'], ['fiscal', 'Yazarkasa'], ['loyalty', 'Puan'], ['sms', 'SMS & WhatsApp'], ['booking', 'Online randevu'], ['invoice', 'e-Fatura'], ['crm', 'Velaris CRM'], ['backup', 'Yedekleme']];

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
        {tab === 'sms' && <Sms />}
        {tab === 'booking' && <BookingSettings />}
        {tab === 'invoice' && <InvoiceSettings />}
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

const NOTIFY_STATUS = { sent: ['Gönderildi', 'green'], pending: ['Bekliyor', 'yellow'], failed: ['Başarısız', 'red'], skipped: ['Atlandı', ''] };
const NOTIFY_KIND = { reminder: 'Randevu hatırlatma', booking: 'Randevu onayı', balance: 'Borç bildirimi', marketing: 'Kampanya', test: 'Deneme' };

function Sms() {
  const toast = useToast();
  const { f, set, save } = useSettingsForm(['notify_provider', 'netgsm_usercode', 'netgsm_password', 'netgsm_header', 'iletimerkezi_key',
    'iletimerkezi_hash', 'iletimerkezi_sender', 'whatsapp_token', 'whatsapp_phone_id', 'whatsapp_template', 'reminder_enabled', 'reminder_hours',
    'reminder_template', 'balance_template', 'kvkk_text', 'public_base_url']);
  const log = useLoad(() => get('/notifications?limit=50'));
  const [phone, setPhone] = useState('');
  const test = async () => {
    await save();
    try { await post('/notify/test', { phone }); toast.ok('Deneme mesajı gönderildi'); } catch (err) { toast.err(err); }
    log.reload();
  };
  const p = f.notify_provider;
  return (
    <div className="stack">
      <form className="card card-pad stack" onSubmit={save}>
        <h2>SMS & WhatsApp</h2>
        <p className="muted">Randevu hatırlatma, borç bildirimi ve kampanya mesajları için. Hatırlatma ve borç bildirimi bilgilendirme mesajıdır; kampanya mesajları yalnızca ticari ileti onayı veren müşterilere gider (İYS).</p>
        <Field label="Sağlayıcı">
          <select className="input" value={p} onChange={set('notify_provider')}>
            <option value="none">Kapalı</option>
            <option value="netgsm">Netgsm SMS</option>
            <option value="iletimerkezi">İleti Merkezi SMS</option>
            <option value="whatsapp">WhatsApp Business (Meta)</option>
            <option value="log">Deneme (gönderilmez, kayda yazılır)</option>
          </select>
        </Field>
        {p === 'netgsm' && (
          <div className="grid-3">
            <Field label="Kullanıcı kodu"><input className="input" value={f.netgsm_usercode} onChange={set('netgsm_usercode')} autoComplete="off" /></Field>
            <Field label="API şifresi"><input className="input" type="password" value={f.netgsm_password} onChange={set('netgsm_password')} autoComplete="off" /></Field>
            <Field label="Mesaj başlığı" hint="Netgsm'de onaylı gönderici adı"><input className="input" value={f.netgsm_header} onChange={set('netgsm_header')} /></Field>
          </div>
        )}
        {p === 'iletimerkezi' && (
          <div className="grid-3">
            <Field label="API anahtarı (key)"><input className="input" value={f.iletimerkezi_key} onChange={set('iletimerkezi_key')} autoComplete="off" /></Field>
            <Field label="API hash"><input className="input" type="password" value={f.iletimerkezi_hash} onChange={set('iletimerkezi_hash')} autoComplete="off" /></Field>
            <Field label="Gönderici adı"><input className="input" value={f.iletimerkezi_sender} onChange={set('iletimerkezi_sender')} /></Field>
          </div>
        )}
        {p === 'whatsapp' && (
          <>
            <div className="grid-2">
              <Field label="Kalıcı erişim anahtarı (token)"><input className="input" type="password" value={f.whatsapp_token} onChange={set('whatsapp_token')} autoComplete="off" /></Field>
              <Field label="Telefon numarası kimliği (Phone number ID)"><input className="input" value={f.whatsapp_phone_id} onChange={set('whatsapp_phone_id')} /></Field>
            </div>
            <Field label="Onaylı şablon adı" hint="Meta'da gövdesi {{1}} olan, Türkçe bir yardımcı (utility) şablon oluşturun; mesaj metni bu değişkene yazılır.">
              <input className="input" value={f.whatsapp_template} onChange={set('whatsapp_template')} placeholder="velaris_bildirim" />
            </Field>
          </>
        )}
        <div className="card card-pad stack" style={{ background: 'var(--panel-2)', boxShadow: 'none', gap: 10 }}>
          <label className="check"><input type="checkbox" checked={f.reminder_enabled === '1'} onChange={set('reminder_enabled')} /> <b>Randevu hatırlatmasını otomatik gönder</b></label>
          <div className="row wrap">
            <span>Randevudan</span>
            <input className="input" style={{ width: 80 }} inputMode="numeric" value={f.reminder_hours} onChange={set('reminder_hours')} aria-label="Saat" />
            <span>saat önce</span>
          </div>
          <Field label="Hatırlatma metni" hint="Kullanılabilir alanlar: {ad} {tarih} {saat} {hizmet} {personel} {isletme} {link}">
            <textarea className="input" value={f.reminder_template} onChange={set('reminder_template')} />
          </Field>
          <Field label="Borç bildirimi metni" hint="{ad} {borc} {isletme}">
            <textarea className="input" value={f.balance_template} onChange={set('balance_template')} />
          </Field>
          <Field label="İnternet adresi (randevu bağlantıları için)" hint="Program bulutta çalışıyorsa adresi; {link} alanında kullanılır">
            <input className="input" value={f.public_base_url} onChange={set('public_base_url')} placeholder="https://kasa.isletmem.com" />
          </Field>
        </div>
        <Field label="KVKK aydınlatma metni" hint="Müşteri kaydında gösterilir"><textarea className="input" value={f.kvkk_text} onChange={set('kvkk_text')} /></Field>
        <div className="row wrap">
          <button className="btn primary">Kaydet</button>
          {p !== 'none' && <>
            <input className="input" style={{ maxWidth: 200 }} inputMode="tel" placeholder="05xx xxx xx xx" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Deneme numarası" />
            <button type="button" className="btn" onClick={test}>Deneme mesajı gönder</button>
          </>}
        </div>
      </form>
      <div className="card card-pad stack">
        <h3>Son mesajlar</h3>
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="table">
            <tbody>
              {(log.data?.rows || []).map((m) => (
                <tr key={m.id}>
                  <td className="small-text">{dt(m.created_at)}</td>
                  <td className="small-text">{NOTIFY_KIND[m.kind] || m.kind}</td>
                  <td className="small-text">{m.customer_name || m.to_phone}</td>
                  <td className="small-text" style={{ maxWidth: 320 }}>{m.body}</td>
                  <td><span className={`badge ${NOTIFY_STATUS[m.status][1]}`}>{NOTIFY_STATUS[m.status][0]}</span>{m.error && <div className="danger-text small-text">{m.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!log.data?.rows?.length && <div className="empty">Henüz mesaj yok</div>}
        </div>
      </div>
    </div>
  );
}

function BookingSettings() {
  const toast = useToast();
  const { f, set, save } = useSettingsForm(['booking_enabled', 'booking_open', 'booking_close', 'booking_closed_days', 'booking_days_ahead',
    'booking_note', 'booking_template', 'public_base_url', 'modules_appointments']);
  const closed = String(f.booking_closed_days || '').split(',').filter(Boolean);
  const toggleDay = (d) => {
    const next = closed.includes(d) ? closed.filter((x) => x !== d) : [...closed, d];
    set('booking_closed_days')({ target: { value: next.sort().join(','), type: 'text' } });
  };
  const base = (f.public_base_url || `${location.origin}${location.pathname}`).replace(/\/+$/, '').replace(/\/index\.html$/, '');
  const link = `${base}/#/randevu-al`;
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <h2>Online randevu</h2>
      <p className="muted">Müşterileriniz bağlantıya tıklayıp hizmet, personel ve boş saati seçerek kendileri randevu alır; randevu takvime düşer, müşteriye onay SMS'i gider. Bağlantıyı Instagram profilinize, Google İşletme sayfanıza ve WhatsApp'a ekleyin.</p>
      <label className="check"><input type="checkbox" checked={f.booking_enabled === '1'} onChange={set('booking_enabled')} /> <b>Online randevuyu aç</b></label>
      {f.modules_appointments !== '1' && <div className="warn-text small-text">Randevu modülü kapalı. Ayarlar → İşletme'den açın.</div>}
      <Field label="Randevu bağlantınız">
        <div className="row"><input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.ok('Kopyalandı'), () => {})}>Kopyala</button></div>
      </Field>
      {!f.public_base_url && <small className="warn-text">Müşterilerin internetten açabilmesi için programın bulutta çalışması ve aşağıya internet adresinin yazılması gerekir. Yerel ağda bu bağlantı yalnızca dükkândaki cihazlarda açılır.</small>}
      <Field label="İnternet adresi"><input className="input" value={f.public_base_url} onChange={set('public_base_url')} placeholder="https://kasa.isletmem.com" /></Field>
      <div className="grid-3">
        <Field label="Açılış"><input type="time" className="input" value={f.booking_open} onChange={set('booking_open')} /></Field>
        <Field label="Kapanış"><input type="time" className="input" value={f.booking_close} onChange={set('booking_close')} /></Field>
        <Field label="Kaç gün sonrasına kadar"><input className="input" inputMode="numeric" value={f.booking_days_ahead} onChange={set('booking_days_ahead')} /></Field>
      </div>
      <div className="field">
        <span>Kapalı günler</span>
        <div className="tabs">
          {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((label, i) => {
            const d = String((i + 1) % 7);
            return <button type="button" key={d} className={`tab ${closed.includes(d) ? 'active' : ''}`} onClick={() => toggleDay(d)}>{label}</button>;
          })}
        </div>
      </div>
      <Field label="Sayfada gösterilecek not"><input className="input" value={f.booking_note} onChange={set('booking_note')} placeholder="Örn. Randevu saatinden 5 dk önce gelmenizi rica ederiz." /></Field>
      <Field label="Onay mesajı" hint="{ad} {tarih} {saat} {hizmet} {personel} {isletme} {link} — SMS & WhatsApp açıksa gönderilir">
        <textarea className="input" value={f.booking_template} onChange={set('booking_template')} />
      </Field>
      <div className="row wrap"><button className="btn primary">Kaydet</button><a className="btn" href="#/randevu-al" target="_blank" rel="noreferrer">Sayfayı aç</a></div>
    </form>
  );
}

function InvoiceSettings() {
  const { f, set, save } = useSettingsForm(['invoice_provider', 'invoice_threshold', 'parasut_client_id', 'parasut_client_secret',
    'parasut_username', 'parasut_password', 'parasut_company_id']);
  return (
    <form className="card card-pad stack" onSubmit={save}>
      <h2>e-Arşiv / e-Fatura</h2>
      <p className="muted">Satış ekranından ya da Satışlar listesinden tek tıkla fatura kesilir. Müşterinin VKN/TCKN'si kayıtlıysa onun adına, değilse nihai tüketici adına e-Arşiv düzenlenir; alıcı e-Fatura mükellefiyse otomatik e-Fatura gönderilir.</p>
      <Field label="Bağlantı">
        <select className="input" value={f.invoice_provider} onChange={set('invoice_provider')}>
          <option value="none">Kapalı</option>
          <option value="parasut">Paraşüt</option>
          <option value="simulator">Simülatör (deneme)</option>
        </select>
      </Field>
      {f.invoice_provider === 'parasut' && (
        <>
          <p className="small-text muted">Paraşüt hesabınızda e-Arşiv/e-Fatura açık olmalı. API bilgilerini Paraşüt destek ekibinden alabilirsiniz; firma numarası Paraşüt adres çubuğundaki sayıdır.</p>
          <div className="grid-2">
            <Field label="Client ID"><input className="input" value={f.parasut_client_id} onChange={set('parasut_client_id')} autoComplete="off" /></Field>
            <Field label="Client Secret"><input className="input" type="password" value={f.parasut_client_secret} onChange={set('parasut_client_secret')} autoComplete="off" /></Field>
            <Field label="Paraşüt e-posta"><input className="input" value={f.parasut_username} onChange={set('parasut_username')} autoComplete="off" /></Field>
            <Field label="Paraşüt şifre"><input className="input" type="password" value={f.parasut_password} onChange={set('parasut_password')} autoComplete="off" /></Field>
            <Field label="Firma numarası (company id)"><input className="input" inputMode="numeric" value={f.parasut_company_id} onChange={set('parasut_company_id')} /></Field>
          </div>
        </>
      )}
      <Field label="Fatura uyarı sınırı (₺, KDV dahil)" hint="2026 için 12.000 TL; bu tutarın üzerindeki satışlarda kasada fatura uyarısı çıkar">
        <input className="input" style={{ maxWidth: 200 }} inputMode="decimal" value={(Number(f.invoice_threshold || 0) / 100).toString()} onChange={(e) => set('invoice_threshold')({ target: { value: String(Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0), type: 'text' } })} />
      </Field>
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
