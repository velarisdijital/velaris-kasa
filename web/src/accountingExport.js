// Muhasebe aktarımı: muhasebecinin Excel'de açıp kendi programına (Logo, Mikro, Luca, Zirve, Paraşüt…)
// aktarabileceği CSV dosyaları. Türkçe Excel uyumlu: ";" ayraç, ondalık virgül, UTF-8 (BOM), tarih gg.aa.yyyy.
import { get } from './api.js';
import { METHOD_LABELS } from './format.js';

const METHODS = ['cash', 'card', 'credit', 'transfer', 'points', 'online'];
const tl = (k) => ((k || 0) / 100).toFixed(2).replace('.', ',');
const trDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const time = (s) => (s && s.length > 10 ? s.slice(11, 16) : '');
const cell = (v) => {
  const t = String(v ?? '');
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (rows) => `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
const vatHead = (rates) => rates.flatMap((r) => [`KDV %${r} Matrah`, `KDV %${r} Tutar`]);
const vatCells = (rates, vat) => rates.flatMap((r) => [tl(vat?.[r]?.base), tl(vat?.[r]?.vat)]);
const minus = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
  .map((k) => [k, { base: (a[k]?.base || 0) - (b[k]?.base || 0), vat: (a[k]?.vat || 0) - (b[k]?.vat || 0) }]));

export function buildFiles(d) {
  const rates = d.vat_rates;
  const usedMethods = METHODS.filter((m) => d.daily.some((x) => x.payments[m]) || d.sales.some((s) => s.payments[m]));
  const range = `${d.from.slice(0, 10)}_${d.to.slice(0, 10)}`;

  // 1) Günlük satış özeti: net (iadeler düşülmüş) KDV matrahı / tutarı ve ödeme tipleri
  const sum = { receipts: 0, gross: 0, refunds: 0, net: 0, vat: {}, payments: {} };
  const daily = [['Tarih', 'Fiş sayısı', 'Brüt satış', 'İade', 'Net satış', ...vatHead(rates), ...usedMethods.map((m) => METHOD_LABELS[m] || m)]];
  for (const x of d.daily) {
    const net = minus(x.vat, x.refund_vat);
    daily.push([trDate(x.day), x.receipts, tl(x.gross), tl(x.refunds), tl(x.net), ...vatCells(rates, net), ...usedMethods.map((m) => tl(x.payments[m]))]);
    sum.receipts += x.receipts; sum.gross += x.gross; sum.refunds += x.refunds; sum.net += x.net;
    for (const [k, v] of Object.entries(net)) sum.vat[k] = { base: (sum.vat[k]?.base || 0) + v.base, vat: (sum.vat[k]?.vat || 0) + v.vat };
    for (const m of usedMethods) sum.payments[m] = (sum.payments[m] || 0) + (x.payments[m] || 0);
  }
  daily.push(['TOPLAM', sum.receipts, tl(sum.gross), tl(sum.refunds), tl(sum.net), ...vatCells(rates, sum.vat), ...usedMethods.map((m) => tl(sum.payments[m]))]);

  // 2) Satış fişleri
  const sales = [['Tarih', 'Saat', 'Fiş no', 'Kasa', 'Kasiyer', 'Müşteri', 'VKN/TCKN', 'Toplam (KDV dahil)', 'Fiş indirimi', 'İade edilen',
    ...vatHead(rates), ...usedMethods.map((m) => METHOD_LABELS[m] || m), 'Mali fiş no', 'e-Arşiv / e-Fatura no']];
  for (const s of d.sales) {
    sales.push([trDate(s.date), time(s.date), s.receipt_no, s.register || '', s.user || '', s.customer, s.customer_tax, tl(s.total), tl(s.discount), tl(s.refunded),
      ...vatCells(rates, s.vat), ...usedMethods.map((m) => tl(s.payments[m])), s.fiscal_no, s.invoice_no]);
  }

  // 3) İadeler
  const refunds = [['Tarih', 'Saat', 'Fiş no', 'İade tutarı', 'İade yöntemi', ...vatHead(rates), 'Not']];
  for (const r of d.refunds) refunds.push([trDate(r.date), time(r.date), r.receipt_no, tl(r.amount), METHOD_LABELS[r.method] || r.method, ...vatCells(rates, r.vat), r.note]);

  // 4) Alış faturaları
  const purchases = [['Belge tarihi', 'Tedarikçi', 'VKN/TCKN', 'Belge türü', 'Belge no', 'Matrah (KDV hariç)', 'KDV', 'Toplam', ...vatHead(rates)]];
  for (const p of d.purchases) purchases.push([trDate(p.date), p.supplier, p.supplier_tax, { fatura: 'Fatura', irsaliye: 'İrsaliye', fis: 'Fiş' }[p.doc_type] || p.doc_type, p.doc_no, tl(p.net_total), tl(p.vat_total), tl(p.total), ...vatCells(rates, p.vat)]);

  const mime = 'text/csv;charset=utf-8';
  return {
    summary: sum,
    files: [
      { name: `gunluk-satis-ozeti_${range}.csv`, content: csv(daily), mime, rows: daily.length - 2 },
      { name: `satis-fisleri_${range}.csv`, content: csv(sales), mime, rows: sales.length - 1 },
      { name: `iadeler_${range}.csv`, content: csv(refunds), mime, rows: refunds.length - 1 },
      { name: `alis-faturalari_${range}.csv`, content: csv(purchases), mime, rows: purchases.length - 1 },
    ],
  };
}

export async function loadAccounting(from, to) {
  return get(`/reports/accounting?from=${from}&to=${to}`);
}
