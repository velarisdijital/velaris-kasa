// Velaris Bulut sayfaları (sunucuda üretilen sade HTML; ek kütüphane yok)
import { PLANS } from '../license.js';
import { subscriptionStatus, VAT_RATE } from './store.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tl = (kurus) => `${(kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const trDate = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
export const STATUS_LABEL = { free: 'Ücretsiz paket', trial: 'Deneme', active: 'Etkin', due: 'Ödeme günü yaklaştı', grace: 'Ödeme bekleniyor (ek süre)', expired: 'Süresi doldu', suspended: 'Askıya alındı' };
export const BUSINESS_TYPES = { market: 'Market / bakkal', kafe: 'Kafe / büfe', restoran: 'Restoran', berber: 'Berber / kuaför', genel: 'Diğer' };

/** Ödeme tutarı: aylık net fiyat; 12 ay seçilirse 10 ay öder (2 ay hediye). KDV eklenir. */
export function priceOf(plan, months) {
  const monthly = (PLANS[plan]?.price || 0) * 100;
  const net = months === 12 ? monthly * 10 : monthly * months;
  const vat = Math.round((net * VAT_RATE) / 100);
  return { net, vat, amount: net + vat };
}

const CSS = `
:root{--ink:#121212;--paper:#F2EFEA;--card:#fff;--line:#DCD8D1;--muted:#6B6862;--orange:#FF4D1A;--mint:#20C4A0;--bg:var(--paper);--fg:var(--ink);--surface:var(--card);--border:var(--line);--soft:var(--muted);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171716;--fg:#F2EFEA;--surface:#1E1D1B;--border:#3A3936;--soft:#BDB8B0;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171716;--fg:#F2EFEA;--surface:#1E1D1B;--border:#3A3936;--soft:#BDB8B0;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif}
header{background:#121212;color:#F2EFEA}header .w{display:flex;align-items:center;height:60px;gap:12px}header b{font-size:19px;letter-spacing:-.01em}header span{color:#BDB8B0;font-size:14px}
.w{max-width:960px;margin:0 auto;padding:0 16px}main{padding:32px 0 64px}
h1{font-weight:300;font-size:clamp(28px,4vw,42px);letter-spacing:-.02em;line-height:1.15;margin:0 0 8px}h2{font-size:20px;margin:28px 0 10px}
p.lead{color:var(--soft);margin:0 0 24px}.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px}
label{display:grid;gap:6px;font-size:14px;font-weight:600}input,select{font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--fg);width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.plan{position:relative;display:block;border:1.5px solid var(--border);border-radius:14px;padding:14px;cursor:pointer;background:var(--surface);font-weight:400}
.plan input{position:absolute;opacity:0;width:0}.plan:has(input:checked){border-color:var(--orange);box-shadow:0 0 0 3px color-mix(in srgb,var(--orange) 20%,transparent)}
.plan b{display:block;font-size:17px}.plan small{color:var(--soft)}.btn{display:inline-block;font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 22px;background:var(--orange);color:#fff;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--fg);border:1.5px solid var(--border)}.btn:disabled{opacity:.6;cursor:wait}
.hint{font-size:13px;color:var(--soft);font-weight:400}.err{color:#D9381E;font-weight:600;min-height:1.4em}.ok{color:var(--mint);font-weight:600}
.addr{display:flex;align-items:center;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)}.addr input{border:0;border-radius:0}.addr span{padding:0 12px;color:var(--soft);white-space:nowrap;font-weight:400}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.sum{display:grid;grid-template-columns:1fr auto;gap:4px 16px;font-variant-numeric:tabular-nums}.sum .t{font-size:22px;font-weight:700}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}.tw{overflow-x:auto}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;background:var(--border)}.badge.g{background:#D3F5EC;color:#0B6B53}.badge.r{background:#FFE2D7;color:#A3290C}
footer{color:var(--soft);font-size:13px;padding:24px 0;border-top:1px solid var(--border)}footer .w{display:flex;flex-wrap:wrap;gap:14px}footer a{color:inherit}
`;

export function layout(title, body, { description = 'Velaris Bulut: VelarisKasa internet üzerinden, her cihazdan.' } = {}) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Velaris Bulut</title><meta name="description" content="${esc(description)}"><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;600;700&display=swap"><style>${CSS}</style></head>
<body><header><div class="w"><b>velaris<span style="color:#FF4D1A;font-size:19px">kasa</span></b><span>Bulut</span></div></header>
<main><div class="w">${body}</div></main>
<footer><div class="w"><span>© ${new Date().getFullYear()} Velaris Dijital</span><span>Kart bilgileriniz ödeme kuruluşunun güvenli sayfasında girilir, bizde saklanmaz.</span></div></footer></body></html>`;
}

export const messagePage = (title, text, extra = '') => layout(title, `<h1>${esc(title)}</h1><p class="lead">${esc(text)}</p>${extra}`);

export function signupPage({ preset = 'esnaf', domain, baseUrl }) {
  const plans = ['esnaf', 'salon', 'pro', 'free'].map((k) => `<label class="plan"><input type="radio" name="plan" value="${k}" ${k === preset ? 'checked' : ''}>
    <b>${PLANS[k].name}</b><small>${PLANS[k].price ? `${PLANS[k].price.toLocaleString('tr-TR')} ₺/ay + KDV · 14 gün ücretsiz` : 'Süresiz ücretsiz · temel özellikler'}</small></label>`).join('');
  const suffix = domain ? `.${domain}` : '';
  const prefix = domain ? '' : `${baseUrl.replace(/^https?:\/\//, '')}/i/`;
  return layout('Hemen başla', `
<h1>VelarisKasa'yı bulutta başlat</h1>
<p class="lead">Kurulum yok. Tablet, telefon ve bilgisayardan aynı verilerle çalışın. Ücretli paketler 14 gün ücretsiz; deneme bitmeden kart istenmez.</p>
<form id="f" class="card" novalidate>
  <h2 style="margin-top:0">Paket</h2><div class="plans">${plans}</div>
  <h2>İşletme</h2>
  <div class="grid">
    <label>İşletme adı<input name="business_name" required maxlength="80" autocomplete="organization" placeholder="Örn. Yıldız Market"></label>
    <label>Sektör<select name="business_type">${Object.entries(BUSINESS_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>İşletme adresi (internet)<div class="addr"><span>${esc(prefix)}</span><input name="slug" required maxlength="30" pattern="[a-z][a-z0-9-]{1,28}[a-z0-9]" placeholder="yildizmarket" autocapitalize="off" spellcheck="false"><span>${esc(suffix)}</span></div><span class="hint" id="slugHint">Küçük harf, rakam ve tire.</span></label>
    <label>Şehir<input name="city" maxlength="40" autocomplete="address-level2" placeholder="İstanbul"></label>
  </div>
  <h2>Yetkili</h2>
  <div class="grid">
    <label>Ad soyad<input name="contact_name" required maxlength="80" autocomplete="name"></label>
    <label>Cep telefonu<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="05xx xxx xx xx"></label>
    <label>E-posta<input name="email" type="email" required autocomplete="email"></label>
    <label>Kasa giriş PIN'i (4-8 rakam)<input name="admin_pin" required inputmode="numeric" pattern="\\d{4,8}" maxlength="8" autocomplete="new-password"></label>
  </div>
  <label style="display:flex;gap:10px;align-items:flex-start;font-weight:400;margin-top:18px"><input type="checkbox" name="terms" style="width:auto;margin-top:4px" required> <span>Kullanım koşullarını ve KVKK aydınlatma metnini okudum, kabul ediyorum.</span></label>
  <p class="err" id="err"></p>
  <button class="btn" id="go">Hesabı oluştur</button>
</form>
<div id="done" class="card" hidden></div>
<script>
const f = document.getElementById('f'), err = document.getElementById('err'), hint = document.getElementById('slugHint');
const slugify = (s) => s.toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => ({ç:'c',ğ:'g',ı:'i',ö:'o',ş:'s',ü:'u',â:'a',î:'i',û:'u'})[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\\d)/, 'x$1').slice(0, 30).replace(/-+$/, '');
let touched = false, t;
f.business_name.addEventListener('input', () => { if (!touched) { f.slug.value = slugify(f.business_name.value); check(); } });
f.slug.addEventListener('input', () => { touched = true; f.slug.value = f.slug.value.toLowerCase(); check(); });
function check() { clearTimeout(t); t = setTimeout(async () => { if (!f.slug.value) return; const r = await fetch('api/cloud/slug?slug=' + encodeURIComponent(f.slug.value)).then((r) => r.json()).catch(() => null); if (!r) return; hint.textContent = r.available ? 'Uygun ✓' : (r.reason || 'Bu adres alınmış'); hint.className = r.available ? 'hint ok' : 'hint err'; }, 300); }
f.addEventListener('submit', async (e) => {
  e.preventDefault(); err.textContent = '';
  if (!f.terms.checked) { err.textContent = 'Koşulları kabul etmeniz gerekiyor.'; return; }
  const data = Object.fromEntries(new FormData(f)); delete data.terms;
  const b = document.getElementById('go'); b.disabled = true; b.textContent = 'Hesap hazırlanıyor…';
  try {
    const r = await fetch('api/cloud/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Hesap oluşturulamadı');
    f.hidden = true;
    const d = document.getElementById('done'); d.hidden = false;
    d.innerHTML = '<h1>Hesabınız hazır</h1><p class="lead">' + (j.trial_until ? 'Deneme süreniz ' + new Date(j.trial_until + 'T12:00').toLocaleDateString('tr-TR') + ' tarihine kadar.' : 'Ücretsiz paketle başladınız.') + '</p>'
      + '<p><b>Adresiniz:</b> <a href="' + j.url + '">' + j.url + '</a></p>'
      + '<p class="hint">Tablette: VelarisKasa uygulamasında <b>Birden çok cihaz mı kullanacaksınız?</b> → sunucu adresine bu adresi yazın. Bilgisayarda tarayıcıdan açın. Giriş: adınız ve seçtiğiniz PIN.</p>'
      + '<div class="row"><a class="btn" href="' + j.url + '">Kasayı aç</a>' + (j.billing_url ? '<a class="btn ghost" href="' + j.billing_url + '">Ödeme ve paket</a>' : '') + '</div>';
  } catch (x) { err.textContent = x.message; b.disabled = false; b.textContent = 'Hesabı oluştur'; }
});
</script>`);
}

export function payPage({ tenant, payments, provider }) {
  const st = subscriptionStatus(tenant);
  const sel = tenant.next_plan || (tenant.plan === 'free' ? 'esnaf' : tenant.plan);
  const opts = ['esnaf', 'salon', 'pro'].map((k) => {
    const m1 = priceOf(k, 1);
    return `<label class="plan"><input type="radio" name="plan" value="${k}" ${k === sel ? 'checked' : ''}><b>${PLANS[k].name}</b><small>${tl(m1.net)}/ay + KDV</small></label>`;
  }).join('');
  const until = tenant.paid_until || tenant.trial_until;
  const hist = payments.filter((p) => p.status === 'paid').slice(0, 12).map((p) => `<tr><td>${esc(p.paid_at?.slice(0, 10))}</td><td>${esc(PLANS[p.plan]?.name)} · ${p.months} ay</td><td>${tl(p.amount)}</td><td>${trDate(p.period_end)}</td></tr>`).join('');
  return layout('Ödeme ve paket', `
<h1>${esc(tenant.business_name)}</h1>
<p class="lead">Paket: <b>${esc(PLANS[tenant.plan]?.name)}</b> · <span class="badge ${['active', 'trial', 'free'].includes(st) ? 'g' : 'r'}">${STATUS_LABEL[st]}</span>${until && tenant.plan !== 'free' ? ` · ${tenant.paid_until ? 'Geçerlilik' : 'Deneme bitişi'}: <b>${trDate(until)}</b>` : ''}</p>
${provider.live ? '' : '<p class="card" style="border-color:#FFC21A">Deneme ortamı: gerçek ödeme alınmaz.</p>'}
<form id="f" class="card">
  <h2 style="margin-top:0">Paket</h2><div class="plans">${opts}</div>
  <h2>Süre</h2>
  <div class="plans">
    <label class="plan"><input type="radio" name="months" value="1" checked><b>Aylık</b><small>Her ay öde</small></label>
    <label class="plan"><input type="radio" name="months" value="12"><b>Yıllık</b><small>12 ay, 10 ay öde (2 ay hediye)</small></label>
  </div>
  <h2>Tutar</h2>
  <div class="sum" id="sum"></div>
  <p class="err" id="err"></p>
  <button class="btn" id="go">Kartla öde</button>
  <p class="hint">Ödeme sonrası paket hemen açılır; geçerlilik süresi kalan sürenin üstüne eklenir. Faturanız e-posta adresinize gönderilir.</p>
</form>
${hist ? `<h2>Ödemeler</h2><div class="card tw"><table><thead><tr><th>Tarih</th><th>Paket</th><th>Tutar</th><th>Geçerlilik</th></tr></thead><tbody>${hist}</tbody></table></div>` : ''}
<script>
const P = ${JSON.stringify(Object.fromEntries(['esnaf', 'salon', 'pro'].map((k) => [k, [priceOf(k, 1), priceOf(k, 12)]])))};
const f = document.getElementById('f'), sum = document.getElementById('sum');
const tl = (k) => (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
function upd() { const p = P[f.plan.value][f.months.value === '12' ? 1 : 0]; sum.innerHTML = '<span>Tutar</span><span>' + tl(p.net) + '</span><span>KDV (%${VAT_RATE})</span><span>' + tl(p.vat) + '</span><span class="t">Toplam</span><span class="t">' + tl(p.amount) + '</span>'; }
f.addEventListener('change', upd); upd();
f.addEventListener('submit', async (e) => {
  e.preventDefault(); const b = document.getElementById('go'); b.disabled = true; document.getElementById('err').textContent = '';
  try {
    const r = await fetch(location.pathname.replace(/\\/odeme\\/.*/, '') + '/api/cloud/pay/${esc(tenant.billing_token)}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: f.plan.value, months: Number(f.months.value) }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Ödeme başlatılamadı'); location.href = j.redirect;
  } catch (x) { document.getElementById('err').textContent = x.message; b.disabled = false; }
});
</script>`);
}

export function simulatorPage({ payment, tenant }) {
  return layout('Deneme ödemesi', `
<h1>Deneme ödemesi</h1>
<p class="lead">${esc(tenant.business_name)} · ${esc(PLANS[payment.plan]?.name)} · ${payment.months} ay · <b>${tl(payment.amount)}</b></p>
<div class="card"><p>Bu sayfa gerçek ödeme kuruluşunun yerine geçer; kart bilgisi istenmez, para çekilmez.</p>
<form method="post" class="row"><button class="btn" name="ok" value="1">Ödeme başarılı</button><button class="btn ghost" name="ok" value="0">Ödeme başarısız</button></form></div>`);
}

export function resultPage({ ok, tenant, payment, tenantUrl, error }) {
  return layout(ok ? 'Ödeme alındı' : 'Ödeme tamamlanmadı', ok
    ? `<h1>Teşekkürler, ödemeniz alındı</h1><p class="lead">${esc(PLANS[payment.plan]?.name)} paketi <b>${trDate(tenant.paid_until)}</b> tarihine kadar geçerli. Kasanızda paket hemen açıldı.</p><div class="row"><a class="btn" href="${esc(tenantUrl)}">Kasaya dön</a></div>`
    : `<h1>Ödeme tamamlanmadı</h1><p class="lead">${esc(error || 'Ödeme onaylanmadı.')} Kartınızdan para çekilmedi.</p><div class="row"><a class="btn" href="../${esc(tenant.billing_token)}">Tekrar dene</a></div>`);
}

export function adminPage({ tenants, urlOf }) {
  const rows = tenants.map((t) => {
    const st = subscriptionStatus(t);
    return `<tr><td><a href="${esc(urlOf(t))}">${esc(t.slug)}</a><br><small>${esc(t.business_name)}</small></td><td>${esc(t.contact_name)}<br><small>${esc(t.phone)} · ${esc(t.email)}</small></td>
<td>${esc(PLANS[t.plan]?.name)}</td><td><span class="badge ${['active', 'trial', 'free'].includes(st) ? 'g' : 'r'}">${STATUS_LABEL[st]}</span></td><td>${esc(t.paid_until || t.trial_until || '—')}</td><td>${esc(t.created_at?.slice(0, 10))}</td>
<td><form method="post" action="yonetim/${esc(t.slug)}" class="row"><select name="action"><option value="extend">+1 ay</option><option value="extend12">+12 ay</option><option value="${t.suspended ? 'resume' : 'suspend'}">${t.suspended ? 'Askıdan al' : 'Askıya al'}</option></select><button class="btn ghost" style="padding:6px 12px">Uygula</button></form></td></tr>`;
  }).join('');
  return layout('Yönetim', `<h1>İşletmeler (${tenants.length})</h1><div class="card tw"><table><thead><tr><th>Adres</th><th>Yetkili</th><th>Paket</th><th>Durum</th><th>Geçerlilik</th><th>Kayıt</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7">Henüz işletme yok</td></tr>'}</tbody></table></div>`);
}
