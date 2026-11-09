// Satış fişini Bluetooth (TSPL) yazıcıya basar: fiş resim olarak çizilir (Türkçe karakterler sorunsuz).
// Etiket rulosunda fiş, etiket boyunda sayfalara bölünür; sürekli rulo (fiş kâğıdı) seçiliyse tek parça basılır.
import { dt, METHOD_LABELS, plain, qty } from '../format.js';
import { getPrinter, isRoll, receiptPrintWidth, sendLabels } from './labelPrinter.js';

const DOTS_PER_MM = 8;
const font = (w, s) => `${w} ${s}px Archivo, "Helvetica Neue", Arial, sans-serif`;

/** Belge satırlarını hazırlar: build({ center, left, lr, hr }) çağrılır; her satır { h, draw(ctx, y, W) } */
function docRows(W, build) {
  const rows = [];
  const pad = 6;
  const measure = document.createElement('canvas').getContext('2d');
  const wrap = (text, size, weight, max) => {
    measure.font = font(weight, size);
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (measure.measureText(t).width <= max || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const center = (text, size = 20, weight = 500) => {
    for (const l of wrap(text, size, weight, W - pad * 2)) {
      rows.push({ h: size + 6, draw: (x, y) => { x.font = font(weight, size); x.textAlign = 'center'; x.fillText(l, W / 2, y); } });
    }
  };
  const left = (text, size = 20, weight = 500, keepNext = false) => {
    for (const l of wrap(text, size, weight, W - pad * 2)) {
      rows.push({ h: size + 6, keepNext, draw: (x, y) => { x.font = font(weight, size); x.textAlign = 'left'; x.fillText(l, pad, y); } });
    }
  };
  const lr = (l, r, size = 20, weight = 500) => rows.push({ h: size + 6, draw: (x, y) => {
    x.font = font(weight, size);
    x.textAlign = 'right'; x.fillText(r, W - pad, y);
    const rw = x.measureText(r).width;
    x.textAlign = 'left';
    let t = String(l);
    while (t.length > 1 && x.measureText(t).width > W - pad * 2 - rw - 8) t = t.slice(0, -1);
    x.fillText(t, pad, y);
  } });
  const hr = () => rows.push({ h: 10, draw: (x, y) => { x.fillRect(pad, y + 4, W - pad * 2, 2); } });
  build({ center, left, lr, hr });
  return rows;
}

/** Satış fişinin içeriği */
const receiptContent = (sale, settings, change) => ({ center, left, lr, hr }) => {
  center(settings.business_name || 'VelarisKasa', 26, 800);
  if (settings.business_address) center(settings.business_address, 17);
  if (settings.business_phone) center(`Tel: ${settings.business_phone}`, 17);
  if (settings.tax_number) center(`VKN: ${settings.tax_number}`, 17);
  hr();
  lr('Fiş No', String(sale.receipt_no || ''), 18);
  lr('Tarih', dt(sale.created_at || sale.offline_created_at), 18);
  if (sale.user_name) lr('Kasiyer', sale.user_name, 18);
  if (sale.customer_name) lr('Müşteri', sale.customer_name, 18);
  hr();
  for (const it of sale.items || []) {
    left(it.name, 20, 600, true); // ürün adı fiyat satırıyla aynı etikette kalsın
    lr(`${qty(it.qty)} ${it.unit || ''} x ${plain(it.unit_price)}${it.discount ? ` -${plain(it.discount)}` : ''}`, plain(it.line_total), 18);
  }
  hr();
  if (sale.discount > 0) { lr('Ara Toplam', plain(sale.subtotal), 18); lr('İndirim', `-${plain(sale.discount)}`, 18); }
  const vat = {};
  for (const it of sale.items || []) vat[it.vat_rate] = (vat[it.vat_rate] || 0) + Math.round(it.line_total - it.line_total / (1 + it.vat_rate / 100));
  for (const [rate, v] of Object.entries(vat)) lr(`KDV %${rate}`, plain(v), 17);
  lr('TOPLAM', `${plain(sale.total)} ₺`, 28, 800);
  hr();
  for (const p of (sale.payments || []).filter((p) => p.amount > 0)) lr(METHOD_LABELS[p.method] || p.method, plain(p.amount + (p.method === 'cash' ? change : 0)), 18);
  if (change > 0) lr('Para Üstü', plain(change), 18);
  if (sale.customer_balance > 0) lr('Güncel Borç', plain(sale.customer_balance), 18);
  if (sale.points_earned > 0) lr('Kazanılan puan', plain(sale.points_earned), 18);
  if (sale.fiscal_status === 'done') lr('Mali fiş no', String(sale.fiscal_no), 18);
  hr();
  if (settings.receipt_footer) center(settings.receipt_footer, 18);
  center('Bilgi fişidir. Mali değeri yoktur.', 15);
};

/** Gün sonu (Z) raporunun içeriği */
const zContent = (z, settings) => ({ center, lr, hr }) => {
  center(settings.business_name || 'VelarisKasa', 24, 800);
  center(`GÜN SONU (Z) RAPORU`, 20, 700);
  if (z.shift.register_name) center(z.shift.register_name, 17);
  hr();
  lr('Açılış', dt(z.shift.opened_at), 17);
  lr('Kapanış', dt(z.shift.closed_at) || '—', 17);
  hr();
  lr('Fiş sayısı', String(z.sales.count), 18);
  lr('Satış', plain(z.sales.total), 18);
  lr('İade', plain(z.refunds.total), 18);
  lr('KDV', plain(z.sales.vat_total), 18);
  lr('NET', `${plain(z.sales.net_total)} ₺`, 26, 800);
  hr();
  for (const [m, a] of Object.entries(z.payments || {})) lr(METHOD_LABELS[m] || m, plain(a), 18);
  hr();
  lr('Beklenen nakit', plain(z.expected_cash), 18);
  lr('Sayılan nakit', plain(z.shift.counted_cash ?? 0), 18);
  lr('Fark', plain(z.difference ?? 0), 20, 700);
  hr();
  center(`Basım: ${new Date().toLocaleString('tr-TR')}`, 15);
};

function paint(rows, W, H, top) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#000'; x.textBaseline = 'top';
  let y = top;
  for (const r of rows) { r.draw(x, y, W); y += r.h; }
  return c;
}

/**
 * Fişi sayfalara çizer. Dönüş: { pages: [canvas], cfg } — cfg TSPL boyutudur.
 * paper: 'label' (etiket rulosu: etiket boyunda sayfalar) | 'continuous' (fiş kâğıdı: tek uzun sayfa)
 */
export function drawReceipt(sale, settings, change = 0, cfg = getPrinter()) {
  return drawDoc(receiptContent(sale, settings, change), cfg);
}

/** Belgeyi verilen genişlikte (nokta) tek uzun resim olarak çizer (fiş yazıcısı, sürekli rulo). */
export function renderDoc(build, W, { margin = 10, tail = 24 } = {}) {
  const rows = docRows(W, build);
  const H = rows.reduce((a, r) => a + r.h, 0) + margin * 2 + tail;
  return paint(rows, W, H, margin);
}

export const receiptDoc = (sale, settings, change = 0) => receiptContent(sale, settings, change);
export const zDoc = (z, settings) => zContent(z, settings);

/** Herhangi bir belgeyi (fiş, Z raporu) yazıcının kâğıdına göre sayfalara çizer. */
export function drawDoc(build, cfg = getPrinter()) {
  const margin = 10;
  if (isRoll(cfg)) {
    // Düz fiş kâğıdı: 56 mm kâğıtta 48 mm basılır; fiş tek parça, içeriği kadar uzun
    const mm = receiptPrintWidth(cfg.receiptWidth);
    const W = mm * DOTS_PER_MM;
    const rows = docRows(W, build);
    const H = rows.reduce((a, r) => a + r.h, 0) + margin * 2 + 80; // sonda yırtma payı
    return { pages: [paint(rows, W, H, margin)], cfg: { ...cfg, width: mm, height: Math.ceil(H / DOTS_PER_MM), gap: 0 } };
  }
  const W = Math.round(cfg.width * DOTS_PER_MM);
  const rows = docRows(W, build);
  const H = Math.round(cfg.height * DOTS_PER_MM);
  const pages = [];
  let cur = [];
  let used = 0;
  // keepNext satırları sonraki satırla tek blok: blok etikete sığmıyorsa bütünüyle sonraki etikete geçer
  const blocks = [];
  for (const r of rows) {
    const last = blocks.at(-1);
    if (last && last.at(-1).keepNext) last.push(r); else blocks.push([r]);
  }
  for (const b of blocks) {
    const bh = b.reduce((a, r) => a + r.h, 0);
    if (used + bh > H - margin * 2 && cur.length) { pages.push(cur); cur = []; used = 0; }
    cur.push(...b); used += bh;
  }
  if (cur.length) pages.push(cur);
  return { pages: pages.map((p) => paint(p, W, H, margin)), cfg };
}

/** Fişi Bluetooth yazıcıya gönderir. */
export async function printReceiptBluetooth(sale, settings, change = 0) {
  if (document.fonts?.ready) await document.fonts.ready;
  const { pages, cfg } = drawReceipt(sale, settings, change);
  await sendLabels(pages.map((canvas) => ({ canvas, copies: 1 })), cfg);
  return pages.length;
}

/** Gün sonu (Z) raporunu Bluetooth yazıcıya gönderir. */
export async function printZBluetooth(z, settings) {
  if (document.fonts?.ready) await document.fonts.ready;
  const { pages, cfg } = drawDoc(zContent(z, settings));
  await sendLabels(pages.map((canvas) => ({ canvas, copies: 1 })), cfg);
  return pages.length;
}

/** Ayarlardaki "Deneme fişi bas" için örnek satış */
export const SAMPLE_SALE = {
  receipt_no: 'DENEME-1', created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), user_name: 'Kasiyer',
  items: [
    { name: 'Çaykur Rize Turist Çayı 1 kg', qty: 1, unit: 'adet', unit_price: 32990, line_total: 32990, vat_rate: 1 },
    { name: 'Simit', qty: 3, unit: 'adet', unit_price: 1500, line_total: 4500, vat_rate: 1 },
    { name: 'Ayran 200 ml', qty: 2, unit: 'adet', unit_price: 1250, line_total: 2500, vat_rate: 1 },
  ],
  subtotal: 39990, discount: 0, total: 39990, payments: [{ method: 'cash', amount: 39990 }],
};
