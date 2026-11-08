import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { dateRange, h, int } from '../util.js';

export default function reportRoutes(db) {
  const r = Router();

  /** Ana sayfa için bugünün özeti. */
  r.get('/dashboard', h((req, res) => {
    const [from, to] = dateRange({});
    const today = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(refunded_total),0) AS refunded
      FROM sales WHERE created_at BETWEEN ? AND ?`).get(from, to);
    const lowStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND track_stock = 1 AND stock <= min_stock AND min_stock > 0').get().n;
    const receivables = db.prepare('SELECT COALESCE(SUM(balance),0) AS total, COUNT(*) AS n FROM customers WHERE balance > 0').get();
    const appointments = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE start_at LIKE ? AND status = 'scheduled'")
      .get(`${from.slice(0, 10)}%`).n;
    res.json({ today: { ...today, net: today.total - today.refunded }, low_stock: lowStock, receivables, appointments });
  }));

  /**
   * Muhasebe aktarımı (muhasebeci paketi): seçilen tarihlerdeki satış fişleri, iadeler ve alış faturaları,
   * KDV oranına göre matrah / KDV ve ödeme tipine göre. Tutarlar kuruş. Fiş geneli indirim satırlara dağıtılır.
   */
  r.get('/reports/accounting', allow(...MANAGERS), h((req, res) => {
    const [from, to] = dateRange(req.query);
    const split = (gross, rate) => { const base = Math.round(gross / (1 + rate / 100)); return { base, vat: gross - base }; };
    const addVat = (acc, rate, gross) => {
      const k = String(rate);
      const v = split(gross, Number(rate));
      acc[k] = { base: (acc[k]?.base || 0) + v.base, vat: (acc[k]?.vat || 0) + v.vat };
    };
    const rates = new Set();
    const sales = db.prepare(`SELECT s.*, c.name AS customer_name, c.tax_number AS customer_tax, u.name AS user_name FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
      WHERE s.created_at BETWEEN ? AND ? ORDER BY s.created_at, s.id`).all(from, to);
    const itemsOf = db.prepare('SELECT id, vat_rate, line_total FROM sale_items WHERE sale_id = ? ORDER BY id');
    const payOf = db.prepare('SELECT method, SUM(amount) AS amount FROM sale_payments WHERE sale_id = ? GROUP BY method');
    const shareMap = new Map(); // sale_item_id → indirim sonrası satır tutarı (iadelerin KDV'si için)
    const saleRows = sales.map((s) => {
      const items = itemsOf.all(s.id);
      const sub = items.reduce((a, i) => a + i.line_total, 0);
      let left = s.discount || 0;
      const vat = {};
      items.forEach((it, idx) => {
        const share = !s.discount || !sub ? 0 : idx === items.length - 1 ? left : Math.round((s.discount * it.line_total) / sub);
        left -= share;
        shareMap.set(it.id, { gross: it.line_total - share, rate: it.vat_rate });
        rates.add(String(it.vat_rate));
        addVat(vat, it.vat_rate, it.line_total - share);
      });
      const payments = Object.fromEntries(payOf.all(s.id).map((p) => [p.method, p.amount]));
      return { id: s.id, date: s.created_at, receipt_no: s.receipt_no, register: s.register_name, user: s.user_name, customer: s.customer_name || '',
        customer_tax: s.customer_tax || '', total: s.total, discount: s.discount, refunded: s.refunded_total, vat, payments,
        fiscal_no: s.fiscal_no || '', invoice_no: s.invoice_no || '' };
    });
    const refunds = db.prepare(`SELECT r.*, s.receipt_no FROM refunds r JOIN sales s ON s.id = r.sale_id
      WHERE r.created_at BETWEEN ? AND ? ORDER BY r.created_at, r.id`).all(from, to).map((r) => {
      const vat = {};
      const itemRate = db.prepare('SELECT vat_rate FROM sale_items WHERE id = ?');
      for (const l of JSON.parse(r.items_json || '[]')) {
        const rate = shareMap.get(l.sale_item_id)?.rate ?? itemRate.get(l.sale_item_id)?.vat_rate ?? 0;
        rates.add(String(rate));
        addVat(vat, rate, l.amount);
      }
      return { date: r.created_at, receipt_no: r.receipt_no, amount: r.amount, method: r.method, vat, note: r.note || '' };
    });
    const purchases = db.prepare(`SELECT p.*, sp.name AS supplier, sp.tax_number AS supplier_tax FROM purchases p LEFT JOIN suppliers sp ON sp.id = p.supplier_id
      WHERE p.status = 'posted' AND p.doc_date BETWEEN ? AND ? ORDER BY p.doc_date, p.id`).all(from.slice(0, 10), to.slice(0, 10)).map((p) => {
      const vat = {};
      for (const l of db.prepare('SELECT vat_rate, line_net, line_total FROM purchase_items WHERE purchase_id = ?').all(p.id)) {
        const k = String(l.vat_rate);
        rates.add(k);
        vat[k] = { base: (vat[k]?.base || 0) + l.line_net, vat: (vat[k]?.vat || 0) + (l.line_total - l.line_net) };
      }
      return { date: p.doc_date, supplier: p.supplier || '', supplier_tax: p.supplier_tax || '', doc_type: p.doc_type, doc_no: p.doc_no || '',
        net_total: p.net_total, vat_total: p.vat_total, total: p.total, vat };
    });
    // Günlük özet (satış günü): fiş sayısı, brüt, iade, net, KDV oranına göre, ödeme tipine göre
    const days = new Map();
    const day = (d) => {
      if (!days.has(d)) days.set(d, { day: d, receipts: 0, gross: 0, refunds: 0, vat: {}, refund_vat: {}, payments: {} });
      return days.get(d);
    };
    for (const s of saleRows) {
      const d = day(s.date.slice(0, 10));
      d.receipts += 1; d.gross += s.total;
      for (const [k, v] of Object.entries(s.vat)) d.vat[k] = { base: (d.vat[k]?.base || 0) + v.base, vat: (d.vat[k]?.vat || 0) + v.vat };
      for (const [m, a] of Object.entries(s.payments)) d.payments[m] = (d.payments[m] || 0) + a;
    }
    for (const r of refunds) {
      const d = day(r.date.slice(0, 10));
      d.refunds += r.amount;
      for (const [k, v] of Object.entries(r.vat)) d.refund_vat[k] = { base: (d.refund_vat[k]?.base || 0) + v.base, vat: (d.refund_vat[k]?.vat || 0) + v.vat };
    }
    const daily = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, net: d.gross - d.refunds }));
    const vatRates = [...rates].map(Number).sort((a, b) => a - b).map(String);
    res.json({ from, to, vat_rates: vatRates, daily, sales: saleRows, refunds, purchases });
  }));

  r.get('/reports/summary', allow(...MANAGERS), h((req, res) => {
    const [from, to] = dateRange(req.query);
    const p = { from, to };
    // İsteğe bağlı kasa/şube filtresi: register=Kadıköy (ön ek eşleşmesi: "Kadıköy" → "Kadıköy Kasa 1", "Kadıköy Kasa 2")
    const reg = String(req.query.register || '').trim();
    const regSql = reg ? ' AND (register_name = @reg OR register_name LIKE @regPrefix)' : '';
    if (reg) { p.reg = reg; p.regPrefix = `${reg} %`; }
    const totals = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(discount),0) AS discount,
        COALESCE(SUM(vat_total),0) AS vat_total, COALESCE(SUM(cost_total),0) AS cost_total, COALESCE(SUM(refunded_total),0) AS refunded
      FROM sales WHERE created_at BETWEEN @from AND @to${regSql}`).get(p);
    totals.net = totals.total - totals.refunded;
    totals.gross_profit = totals.total - totals.cost_total;
    totals.avg_basket = totals.count ? Math.round(totals.total / totals.count) : 0;

    const payments = db.prepare(`SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE s.created_at BETWEEN @from AND @to${regSql.replace(/register_name/g, 's.register_name')} GROUP BY sp.method`).all(p);
    const daily = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS count, SUM(total) AS total
      FROM sales WHERE created_at BETWEEN @from AND @to${regSql} GROUP BY day ORDER BY day`).all(p);
    const hourly = db.prepare(`SELECT CAST(substr(created_at,12,2) AS INTEGER) AS hour, COUNT(*) AS count, SUM(total) AS total
      FROM sales WHERE created_at BETWEEN @from AND @to${regSql} GROUP BY hour ORDER BY hour`).all(p);
    const topProducts = db.prepare(`SELECT i.product_id, i.name, i.unit, SUM(i.qty - i.refunded_qty) AS qty, SUM(i.line_total) AS total,
        SUM(i.line_total - ROUND(i.unit_cost * i.qty)) AS profit
      FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at BETWEEN @from AND @to${regSql.replace(/register_name/g, 's.register_name')}
      GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC LIMIT 20`).all(p);
    const categories = db.prepare(`SELECT COALESCE(c.name, 'Kategorisiz') AS name, c.color, SUM(i.line_total) AS total
      FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products pr ON pr.id = i.product_id
      LEFT JOIN categories c ON c.id = pr.category_id WHERE s.created_at BETWEEN @from AND @to${regSql.replace(/register_name/g, 's.register_name')} GROUP BY c.id ORDER BY total DESC`).all(p);
    // Personel performansı: hizmeti yapan (staff_id) yoksa satışı yapan kasiyer
    const staff = db.prepare(`SELECT u.id, u.name, u.commission_rate, COUNT(DISTINCT s.id) AS sale_count,
        SUM(i.line_total) AS total, SUM(CASE WHEN i.type = 'service' THEN i.line_total ELSE 0 END) AS service_total
      FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN users u ON u.id = COALESCE(i.staff_id, s.user_id)
      WHERE s.created_at BETWEEN @from AND @to${regSql.replace(/register_name/g, 's.register_name')} GROUP BY u.id ORDER BY total DESC`).all(p)
      .map((s) => ({ ...s, commission: Math.round((s.service_total * s.commission_rate) / 100) }));
    const collections = db.prepare(`SELECT COALESCE(-SUM(amount),0) AS total FROM customer_transactions
      WHERE type = 'payment' AND created_at BETWEEN @from AND @to`).get(p).total;
    const newDebt = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM customer_transactions
      WHERE type = 'debt' AND created_at BETWEEN @from AND @to`).get(p).total;

    // Alışlar: belge tarihine göre (KDV dahil), tedarikçilere toplam borç
    const purchases = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(vat_total),0) AS vat_total
      FROM purchases WHERE status = 'posted' AND doc_date BETWEEN @f AND @t`).get({ f: from.slice(0, 10), t: to.slice(0, 10) });
    purchases.payable = db.prepare('SELECT COALESCE(SUM(balance),0) AS v FROM suppliers WHERE balance > 0').get().v;

    const registers = db.prepare(`SELECT COALESCE(register_name, 'Kasa 1') AS name, COUNT(*) AS count, SUM(total - refunded_total) AS net
      FROM sales WHERE created_at BETWEEN @from AND @to GROUP BY name ORDER BY net DESC`).all({ from, to });
    res.json({ from, to, register: reg || null, registers, totals, payments, daily, hourly, top_products: topProducts, categories, staff, collections, new_debt: newDebt, purchases });
  }));

  r.get('/reports/stock', allow(...MANAGERS), h((req, res) => {
    // ?branch_id= ile o şubenin stoğu; yoksa tüm şubelerin toplamı
    const bid = req.query.branch_id ? int(req.query.branch_id) : null;
    const src = bid
      ? `(SELECT p.id, p.name, p.unit, p.barcode, p.buy_price, p.sell_price, p.min_stock, p.active, p.track_stock, COALESCE(bs.stock, 0) AS stock
          FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ${bid})`
      : 'products';
    const value = db.prepare(`SELECT COUNT(*) AS product_count, COALESCE(SUM(stock * buy_price),0) AS cost_value,
      COALESCE(SUM(stock * sell_price),0) AS sale_value FROM ${src} WHERE active = 1 AND track_stock = 1 AND stock > 0`).get();
    const low = db.prepare(`SELECT id, name, stock, min_stock, unit, barcode FROM ${src}
      WHERE active = 1 AND track_stock = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock - min_stock`).all();
    const negative = db.prepare(`SELECT id, name, stock, unit FROM ${src} WHERE active = 1 AND track_stock = 1 AND stock < 0`).all();
    res.json({ value: { ...value, cost_value: Math.round(value.cost_value), sale_value: Math.round(value.sale_value) }, low, negative });
  }));

  return r;
}
