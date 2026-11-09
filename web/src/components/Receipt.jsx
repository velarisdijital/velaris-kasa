import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { dt, METHOD_LABELS, plain, qty } from '../format.js';

export function Receipt({ sale, settings, change = 0 }) {
  const vatGroups = {};
  for (const it of sale.items || []) {
    const net = it.line_total;
    vatGroups[it.vat_rate] = (vatGroups[it.vat_rate] || 0) + Math.round(net - net / (1 + it.vat_rate / 100));
  }
  return (
    <div className="receipt">
      <div className="c b big">{settings.business_name}</div>
      {settings.business_address && <div className="c">{settings.business_address}</div>}
      {settings.business_phone && <div className="c">Tel: {settings.business_phone}</div>}
      {settings.tax_number && <div className="c">VKN: {settings.tax_number}</div>}
      <hr />
      <div className="r"><span>Fiş No</span><span>{sale.receipt_no}</span></div>
      <div className="r"><span>Tarih</span><span>{dt(sale.created_at || sale.offline_created_at)}</span></div>
      {sale.user_name && <div className="r"><span>Kasiyer</span><span>{sale.user_name}</span></div>}
      {sale.customer_name && <div className="r"><span>Müşteri</span><span>{sale.customer_name}</span></div>}
      <hr />
      {(sale.items || []).map((it, i) => (
        <div key={i}>
          <div>{it.name}</div>
          <div className="r">
            <span>  {qty(it.qty)} {it.unit} x {plain(it.unit_price)}{it.discount ? ` (-${plain(it.discount)})` : ''} %{it.vat_rate}</span>
            <span>{plain(it.line_total)}</span>
          </div>
          {it.promo_discount > 0 && <div className="r"><span>  Kampanya: {it.promo_name}</span><span>-{plain(it.promo_discount)}</span></div>}
        </div>
      ))}
      <hr />
      {sale.discount > 0 && <div className="r"><span>Ara Toplam</span><span>{plain(sale.subtotal)}</span></div>}
      {sale.discount > 0 && <div className="r"><span>İndirim</span><span>-{plain(sale.discount)}</span></div>}
      {Object.entries(vatGroups).map(([rate, v]) => (
        <div className="r" key={rate}><span>KDV %{rate}</span><span>{plain(v)}</span></div>
      ))}
      <div className="r b big"><span>TOPLAM</span><span>{plain(sale.total)} ₺</span></div>
      {sale.promo_discount > 0 && <div className="r b"><span>Kampanya kazancınız</span><span>{plain(sale.promo_discount)}</span></div>}
      <hr />
      {(sale.payments || []).filter((p) => p.amount > 0).map((p, i) => (
        <div className="r" key={i}><span>{METHOD_LABELS[p.method]}</span><span>{plain(p.amount + (p.method === 'cash' ? change : 0))}</span></div>
      ))}
      {change > 0 && <div className="r"><span>Para Üstü</span><span>{plain(change)}</span></div>}
      {sale.customer_balance > 0 && <div className="r"><span>Güncel Borç</span><span>{plain(sale.customer_balance)}</span></div>}
      {sale.points_earned > 0 && <div className="r"><span>Kazanılan puan</span><span>{plain(sale.points_earned)}</span></div>}
      {sale.customer_points > 0 && <div className="r"><span>Toplam puan</span><span>{plain(sale.customer_points)}</span></div>}
      {sale.fiscal_status === 'done' && <div className="r"><span>Mali fiş no</span><span>{sale.fiscal_no}</span></div>}
      <hr />
      {settings.receipt_footer && <div className="c">{settings.receipt_footer}</div>}
      <div className="c" style={{ fontSize: 10, marginTop: 6 }}>Bilgi fişidir. Mali değeri yoktur.</div>
    </div>
  );
}

let root;
/** Verilen içeriği gizli yazdırma alanına çizip yazdırır (80mm termal yazıcı). */
export function printElement(element, pageCss = null) {
  root ??= createRoot(document.getElementById('print-area'));
  // Etiket gibi farklı kâğıt boyutları için @page kuralı (fiş varsayılanı: 80 mm rulo)
  let style = document.getElementById('print-page');
  if (!style) { style = document.createElement('style'); style.id = 'print-page'; document.head.appendChild(style); }
  style.textContent = pageCss ? `@media print { @page { ${pageCss} } #print-area { width: auto !important; } }` : '';
  flushSync(() => root.render(element));
  if (import.meta.env.VITE_DEMO) {
    // Demo ortamı yazdırma penceresi açamaz; fişi ekranda önizleme olarak göster
    const el = document.getElementById('print-area');
    el.classList.add('preview');
    el.onclick = () => el.classList.remove('preview');
    return;
  }
  if (window.velarisDesktop?.print) window.velarisDesktop.print();
  else window.print();
}

const notify = (type, message) => window.dispatchEvent(new CustomEvent('vk-toast', { detail: { type, message } }));

/**
 * Fişi yazdırır. Android uygulamasında Bluetooth yazıcı seçiliyse fiş oraya gider
 * (Ayarlar → Bu cihaz → "Fişleri bu yazıcıdan bas"); aksi hâlde sistemin yazdırma penceresi.
 */
export async function printReceipt(sale, settings, change = 0, { drawer = false } = {}) {
  try {
    const lp = await import('../printing/labelPrinter.js');
    // 1) Fiş yazıcısı (ESC/POS) seçiliyse oraya (nakit satışta çekmece de açılır)
    if (lp.isNative() && lp.getReceiptPrinter().deviceId) {
      const rp = await import('../printing/receiptPrinter.js');
      await rp.printReceiptEscPos(sale, settings, change, { drawer });
      notify('success', 'Fiş yazıcıya gönderildi');
      return;
    }
    // 2) Yalnızca etiket yazıcısı varsa fiş etikete / sürekli ruloya basılır
    const cfg = lp.getPrinter();
    if (lp.isNative() && cfg.deviceId && cfg.receiptVia !== 'system') {
      const { printReceiptBluetooth } = await import('../printing/receiptBitmap.js');
      const pages = await printReceiptBluetooth(sale, settings, change);
      notify('success', pages > 1 ? `Fiş yazıcıya gönderildi (${pages} etiket)` : 'Fiş yazıcıya gönderildi');
      return;
    }
  } catch (e) {
    notify('error', `Fiş basılamadı: ${e.message || e}. Yazıcının açık olduğundan emin olun.`);
    return;
  }
  printElement(<Receipt sale={sale} settings={settings} change={change} />);
}
