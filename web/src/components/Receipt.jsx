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
        </div>
      ))}
      <hr />
      {sale.discount > 0 && <div className="r"><span>Ara Toplam</span><span>{plain(sale.subtotal)}</span></div>}
      {sale.discount > 0 && <div className="r"><span>İndirim</span><span>-{plain(sale.discount)}</span></div>}
      {Object.entries(vatGroups).map(([rate, v]) => (
        <div className="r" key={rate}><span>KDV %{rate}</span><span>{plain(v)}</span></div>
      ))}
      <div className="r b big"><span>TOPLAM</span><span>{plain(sale.total)} ₺</span></div>
      <hr />
      {(sale.payments || []).filter((p) => p.amount > 0).map((p, i) => (
        <div className="r" key={i}><span>{METHOD_LABELS[p.method]}</span><span>{plain(p.amount + (p.method === 'cash' ? change : 0))}</span></div>
      ))}
      {change > 0 && <div className="r"><span>Para Üstü</span><span>{plain(change)}</span></div>}
      {sale.customer_balance > 0 && <div className="r"><span>Güncel Borç</span><span>{plain(sale.customer_balance)}</span></div>}
      <hr />
      {settings.receipt_footer && <div className="c">{settings.receipt_footer}</div>}
      <div className="c" style={{ fontSize: 10, marginTop: 6 }}>Bilgi fişidir. Mali değeri yoktur.</div>
    </div>
  );
}

let root;
/** Verilen içeriği gizli yazdırma alanına çizip yazdırır (80mm termal yazıcı). */
export function printElement(element) {
  root ??= createRoot(document.getElementById('print-area'));
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

export const printReceipt = (sale, settings, change = 0) => printElement(<Receipt sale={sale} settings={settings} change={change} />);
