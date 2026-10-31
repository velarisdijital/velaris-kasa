import { Router } from 'express';
import { applyTicketPayment } from './tables.js';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent, getSetting, nextReceiptNo } from '../db.js';
import { fiscalEnabled, fiscalRefund, printFiscal } from '../fiscal.js';
import { createInvoice, refreshInvoice } from '../invoice.js';
import { hasFeature } from '../license.js';
import { branchForRegister, branchStock, moveProductStock, round3, stockNeeds } from '../stock.js';
import { bad, dateRange, h, int, notFound, num, str, vatOf } from '../util.js';
import { addCustomerTx, addPointsTx, customerPayload } from './customers.js';
import { openShiftFor } from './shifts.js';

const METHODS = ['cash', 'card', 'credit', 'transfer', 'points'];

export function loadSale(db, id) {
  const sale = db.prepare(`SELECT s.*, u.name AS user_name, c.name AS customer_name, c.phone AS customer_phone,
      c.crm_id AS customer_crm_id, c.balance AS customer_balance, c.points AS customer_points, c.tax_number AS customer_tax_number
    FROM sales s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`).get(id);
  if (!sale) return null;
  sale.items = db.prepare(`SELECT i.*, u.name AS staff_name, p.barcode, p.crm_id AS product_crm_id FROM sale_items i
    LEFT JOIN users u ON u.id = i.staff_id LEFT JOIN products p ON p.id = i.product_id WHERE i.sale_id = ? ORDER BY i.id`).all(id);
  sale.payments = db.prepare('SELECT method, amount FROM sale_payments WHERE sale_id = ?').all(id);
  sale.refunds = db.prepare('SELECT r.*, u.name AS user_name FROM refunds r LEFT JOIN users u ON u.id = r.user_id WHERE sale_id = ? ORDER BY id').all(id);
  return sale;
}

/** Fiş geneli indirimi satırlara oransal dağıtır (KDV ve iade hesabı için). */
function discountShares(items, discount) {
  const subtotal = items.reduce((a, i) => a + i.line_total, 0);
  if (!discount || !subtotal) return items.map(() => 0);
  let left = discount;
  return items.map((it, idx) => {
    if (idx === items.length - 1) return left;
    const s = Math.round((discount * it.line_total) / subtotal);
    left -= s;
    return s;
  });
}

const salePayload = (sale) => ({
  id: sale.id,
  receipt_no: sale.receipt_no,
  created_at: sale.created_at,
  register_name: sale.register_name,
  cashier: sale.user_name,
  customer: sale.customer_id ? { id: sale.customer_id, crm_id: sale.customer_crm_id, name: sale.customer_name, phone: sale.customer_phone } : null,
  subtotal: sale.subtotal,
  discount: sale.discount,
  vat_total: sale.vat_total,
  total: sale.total,
  refunded_total: sale.refunded_total,
  status: sale.status,
  items: sale.items.map((i) => ({
    product_id: i.product_id, product_crm_id: i.product_crm_id, barcode: i.barcode, name: i.name, type: i.type,
    qty: i.qty, unit: i.unit, unit_price: i.unit_price, discount: i.discount, vat_rate: i.vat_rate,
    line_total: i.line_total, staff: i.staff_id ? { id: i.staff_id, name: i.staff_name } : null,
  })),
  payments: sale.payments,
  points_earned: sale.points_earned,
  fiscal: { status: sale.fiscal_status, fiscal_no: sale.fiscal_no, z_no: sale.fiscal_z_no },
});

export default function saleRoutes(db) {
  const r = Router();

  /**
   * Satış oluşturur.
   * body: { client_uuid?, register_name, customer_id?, appointment_id?, discount?, note?,
   *         items: [{ product_id?, name?, qty, unit_price?, discount?, staff_id? }],
   *         payments: [{ method, amount }] }
   * Tutarlar kuruş. Nakitte fazla ödeme para üstü olarak düşülür.
   */
  r.post('/sales', h(async (req, res) => {
    const b = req.body || {};
    if (b.client_uuid) {
      const dup = db.prepare('SELECT id FROM sales WHERE client_uuid = ?').get(String(b.client_uuid));
      if (dup) return res.json({ ...loadSale(db, dup.id), duplicate: true });
    }
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Sepet boş');
    const defaultVat = num(getSetting(db, 'default_vat'), 20);
    const allowNegative = getSetting(db, 'allow_negative_stock') === '1';
    const customer = b.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id) : null;
    if (b.customer_id && !customer) throw bad('Müşteri bulunamadı');

    const items = b.items.map((it) => {
      const product = it.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id) : null;
      if (it.product_id && !product) throw bad(`Ürün bulunamadı (#${it.product_id})`);
      const name = product?.name || str(it.name);
      if (!name) throw bad('Satır adı gerekli');
      const qty = round3(num(it.qty, NaN));
      if (!(qty > 0)) throw bad(`${name}: miktar geçersiz`);
      const unit_price = it.unit_price != null ? int(it.unit_price) : product?.sell_price ?? 0;
      if (unit_price < 0) throw bad(`${name}: fiyat geçersiz`);
      const discount = Math.max(0, int(it.discount));
      const line_total = Math.round(qty * unit_price) - discount;
      if (line_total < 0) throw bad(`${name}: indirim satır tutarını aşıyor`);
      return {
        product, product_id: product?.id ?? null, name, type: product?.type || 'product', qty, unit: product?.unit || 'adet',
        unit_price, unit_cost: product?.buy_price ?? 0, discount, vat_rate: product ? product.vat_rate : num(it.vat_rate, defaultVat),
        line_total, staff_id: it.staff_id ? int(it.staff_id) : null, ticket_item_id: it.ticket_item_id ? int(it.ticket_item_id) : null,
      };
    });

    const subtotal = items.reduce((a, i) => a + i.line_total, 0);
    const discount = Math.min(Math.max(0, int(b.discount)), subtotal);
    const total = subtotal - discount;
    const shares = discountShares(items, discount);
    const vat_total = items.reduce((a, it, i) => a + vatOf(it.line_total - shares[i], it.vat_rate), 0);
    const cost_total = items.reduce((a, it) => a + Math.round(it.unit_cost * it.qty), 0);

    // Ödemeler
    const pays = {};
    for (const p of Array.isArray(b.payments) ? b.payments : []) {
      if (!METHODS.includes(p.method)) throw bad('Geçersiz ödeme yöntemi');
      const amt = int(p.amount);
      if (amt < 0) throw bad('Ödeme tutarı negatif olamaz');
      if (amt) pays[p.method] = (pays[p.method] || 0) + amt;
    }
    if (!Object.keys(pays).length && total === 0) pays.cash = 0;
    const paid = Object.values(pays).reduce((a, v) => a + v, 0);
    if (paid < total) throw bad('Ödeme tutarı eksik');
    const change = paid - total;
    if (change > 0) {
      if ((pays.cash || 0) < change) throw bad('Fazla ödeme yalnızca nakitte olabilir');
      pays.cash -= change;
    }
    const loyaltyOn = getSetting(db, 'loyalty_enabled') === '1' && hasFeature(db, 'loyalty');
    if (pays.points) {
      if (!loyaltyOn) throw bad('Puan sistemi kapalı');
      if (!customer) throw bad('Puanla ödeme için müşteri seçmelisiniz');
      if (customer.points < pays.points) throw bad(`Yetersiz puan (mevcut ${(customer.points / 100).toFixed(2)} ₺)`);
    }
    // Puan, nakit/kart/havale ile ödenen kısımdan kazanılır (veresiye ve puanla ödenen kısım hariç)
    const pointsEarned = loyaltyOn && customer
      ? Math.floor(((total - (pays.credit || 0) - (pays.points || 0)) * Number(getSetting(db, 'loyalty_rate') || 0)) / 100)
      : 0;
    if (pays.credit) {
      if (!customer) throw bad('Veresiye için müşteri seçmelisiniz');
      if (customer.credit_limit > 0 && customer.balance + pays.credit > customer.credit_limit) {
        throw bad(`Veresiye limiti aşılıyor (limit ${(customer.credit_limit / 100).toFixed(2)} ₺)`);
      }
    }

    const saleId = db.transaction(() => {
      const branchId = branchForRegister(db, b.register_name);
      if (!allowNegative) {
        // Reçeteli ürünlerde bileşenlerin stoğu kontrol edilir
        const getP = db.prepare('SELECT name, type, track_stock FROM products WHERE id = ?');
        for (const [pid, need] of stockNeeds(db, items.filter((i) => i.product))) {
          const p = getP.get(pid);
          if (p?.track_stock && p.type === 'product') {
            const cur = branchStock(db, pid, branchId);
            if (cur < need) throw bad(`${p.name}: yetersiz stok (${cur})`);
          }
        }
      }
      const shift = openShiftFor(db, b.register_name);
      const saleId = db.prepare(`INSERT INTO sales (receipt_no, client_uuid, shift_id, register_name, user_id, customer_id,
          subtotal, discount, vat_total, total, cost_total, note, created_at, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?)`)
        .run(nextReceiptNo(db), b.client_uuid ? String(b.client_uuid) : null, shift?.id ?? null, str(b.register_name) || 'Kasa 1',
          req.user.id, customer?.id ?? null, subtotal, discount, vat_total, total, cost_total, str(b.note),
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b.offline_created_at || '') ? b.offline_created_at : null, branchId).lastInsertRowid;

      const insItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, type, qty, unit, unit_price, unit_cost, discount,
          vat_rate, line_total, staff_id) VALUES (@sale_id, @product_id, @name, @type, @qty, @unit, @unit_price, @unit_cost, @discount,
          @vat_rate, @line_total, @staff_id)`);
      for (const it of items) {
        const { product, ticket_item_id, ...row } = it;
        insItem.run({ ...row, sale_id: saleId });
        if (product) moveProductStock(db, product.id, -it.qty, 'sale', { saleId, userId: req.user.id, branchId });
      }
      const insPay = db.prepare('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)');
      for (const [m, a] of Object.entries(pays)) insPay.run(saleId, m, a);

      if (pays.credit) {
        addCustomerTx(db, customer.id, 'debt', pays.credit, { saleId, userId: req.user.id, note: 'Veresiye satış' });
      }
      if (pays.points) addPointsTx(db, customer.id, 'redeem', -pays.points, { saleId, userId: req.user.id, note: 'Puanla ödeme' });
      if (pointsEarned > 0) {
        addPointsTx(db, customer.id, 'earn', pointsEarned, { saleId, userId: req.user.id });
        db.prepare('UPDATE sales SET points_earned = ? WHERE id = ?').run(pointsEarned, saleId);
      }
      if (b.ticket_id) {
        applyTicketPayment(db, int(b.ticket_id), items.filter((i) => i.ticket_item_id).map((i) => ({ ticket_item_id: i.ticket_item_id, qty: i.qty })), saleId, total);
      }
      if (b.appointment_id) {
        db.prepare("UPDATE appointments SET status = 'done', sale_id = ? WHERE id = ?").run(saleId, int(b.appointment_id));
      }
      const sale = loadSale(db, saleId);
      emitEvent(db, 'sale.completed', salePayload(sale));
      if (pays.credit) emitEvent(db, 'customer.updated', customerPayload(db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id)));
      return saleId;
    })();

    if (fiscalEnabled(db) && getSetting(db, 'fiscal_auto') === '1') await printFiscal(db, saleId, loadSale);
    res.status(201).json({ ...loadSale(db, saleId), change });
  }));

  /** Satış için e-Arşiv / e-Fatura düzenler (müşterinin VKN/TCKN'si yoksa nihai tüketici adına). */
  r.post('/sales/:id/invoice', h(async (req, res) => {
    const sale = await createInvoice(db, req.params.id, loadSale);
    if (!sale) throw notFound();
    res.json(sale);
  }));
  r.post('/sales/:id/invoice/refresh', h(async (req, res) => {
    const sale = await refreshInvoice(db, req.params.id, loadSale);
    if (!sale) throw notFound();
    res.json(sale);
  }));

  /** Mali fişi (yeniden) yazarkasaya gönderir. */
  r.post('/sales/:id/fiscal', h(async (req, res) => {
    const sale = loadSale(db, req.params.id);
    if (!sale) throw notFound();
    if (!fiscalEnabled(db)) throw bad('Yazarkasa bağlı değil (Ayarlar → Yazarkasa)');
    if (sale.fiscal_status === 'done') throw bad(`Bu satışın mali fişi zaten basıldı (No ${sale.fiscal_no})`);
    res.json(await printFiscal(db, sale.id, loadSale));
  }));

  r.get('/sales', h((req, res) => {
    const [from, to] = dateRange(req.query);
    const where = ['s.created_at BETWEEN @from AND @to'];
    const params = { from, to, limit: Math.min(int(req.query.limit, 500) || 500, 5000) };
    if (req.query.q) { where.push('(s.receipt_no LIKE @q OR c.name LIKE @q)'); params.q = `%${req.query.q}%`; }
    if (req.query.customer_id) { where.push('s.customer_id = @cid'); params.cid = int(req.query.customer_id); }
    if (req.query.user_id) { where.push('s.user_id = @uid'); params.uid = int(req.query.user_id); }
    const rows = db.prepare(`SELECT s.*, u.name AS user_name, c.name AS customer_name,
        (SELECT GROUP_CONCAT(method) FROM sale_payments WHERE sale_id = s.id AND amount > 0) AS methods,
        (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS item_count
      FROM sales s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT @limit`).all(params);
    res.json(rows);
  }));

  r.get('/sales/:id', h((req, res) => {
    const sale = loadSale(db, req.params.id);
    if (!sale) throw notFound();
    res.json(sale);
  }));

  /**
   * İade. body: { items: [{ sale_item_id, qty }], method?, note?, register_name? }
   * items verilmezse tüm kalan ürünler iade edilir. Stok geri eklenir.
   */
  r.post('/sales/:id/refund', allow(...MANAGERS, 'cashier'), h(async (req, res) => {
    const sale = loadSale(db, req.params.id);
    if (!sale) throw notFound();
    if (sale.status === 'refunded') throw bad('Bu satış zaten tamamen iade edilmiş');
    const shares = discountShares(sale.items, sale.discount);
    const wanted = Array.isArray(req.body.items) && req.body.items.length
      ? req.body.items
      : sale.items.map((i) => ({ sale_item_id: i.id, qty: i.qty - i.refunded_qty }));

    let amount = 0;
    const lines = [];
    for (const w of wanted) {
      const idx = sale.items.findIndex((i) => i.id === int(w.sale_item_id));
      if (idx < 0) throw bad('İade satırı bu satışa ait değil');
      const it = sale.items[idx];
      const qty = round3(num(w.qty));
      if (qty <= 0) continue;
      if (qty > round3(it.qty - it.refunded_qty)) throw bad(`${it.name}: iade miktarı satılandan fazla`);
      const net = it.line_total - shares[idx];
      const lineAmount = Math.round((net * qty) / it.qty);
      amount += lineAmount;
      lines.push({ item: it, qty, amount: lineAmount });
    }
    if (!lines.length) throw bad('İade edilecek ürün seçin');

    const mainMethod = [...sale.payments].sort((a, b) => b.amount - a.amount)[0]?.method || 'cash';
    const method = METHODS.includes(req.body.method) ? req.body.method : mainMethod;
    if ((method === 'credit' || method === 'points') && !sale.customer_id) throw bad('Bu iade yöntemi için satışta müşteri olmalı');

    db.transaction(() => {
      const shift = openShiftFor(db, req.body.register_name || sale.register_name);
      for (const l of lines) {
        db.prepare('UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?').run(l.qty, l.item.id);
        if (l.item.product_id) moveProductStock(db, l.item.product_id, l.qty, 'refund', { saleId: sale.id, userId: req.user.id, note: `İade ${sale.receipt_no}`, branchId: sale.branch_id || 1 });
      }
      db.prepare('INSERT INTO refunds (sale_id, shift_id, amount, method, items_json, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(sale.id, shift?.id ?? null, amount, method,
          JSON.stringify(lines.map((l) => ({ sale_item_id: l.item.id, name: l.item.name, qty: l.qty, amount: l.amount }))),
          str(req.body.note), req.user.id);
      const remaining = db.prepare('SELECT SUM(qty - refunded_qty) AS r FROM sale_items WHERE sale_id = ?').get(sale.id).r;
      db.prepare('UPDATE sales SET refunded_total = refunded_total + ?, status = ? WHERE id = ?')
        .run(amount, remaining > 0.0005 ? 'partial_refund' : 'refunded', sale.id);
      if (method === 'credit') {
        addCustomerTx(db, sale.customer_id, 'adjust', -amount, { saleId: sale.id, userId: req.user.id, note: `İade ${sale.receipt_no}` });
      }
      if (method === 'points') addPointsTx(db, sale.customer_id, 'refund', amount, { saleId: sale.id, userId: req.user.id, note: `İade ${sale.receipt_no}` });
      // İade edilen kısım için kazanılmış puan geri alınır
      if (sale.points_earned && sale.customer_id && sale.total) {
        const back = Math.round((sale.points_earned * amount) / sale.total);
        if (back) addPointsTx(db, sale.customer_id, 'refund', -back, { saleId: sale.id, userId: req.user.id, note: `İade ${sale.receipt_no} (kazanılan puan)` });
      }
      emitEvent(db, 'sale.refunded', {
        sale: salePayload(loadSale(db, sale.id)), amount, method,
        items: lines.map((l) => ({ name: l.item.name, product_id: l.item.product_id, qty: l.qty, amount: l.amount })),
      });
    })();
    // Mali fişi basılmış satışta yazarkasaya iade bildirimi (köprü destekliyorsa)
    let fiscal_warning = null;
    if (sale.fiscal_status === 'done' && fiscalEnabled(db)) {
      try {
        await fiscalRefund(db, { sale_id: sale.id, receipt_no: sale.receipt_no, fiscal_no: sale.fiscal_no, amount, method,
          items: lines.map((l) => ({ name: l.item.name, qty: l.qty, amount: l.amount, vat_rate: l.item.vat_rate })) });
      } catch (e) {
        fiscal_warning = `Yazarkasaya iade bildirilemedi: ${e.message}. İade için gider pusulası / iade faturası düzenleyin.`;
      }
    }
    res.json({ ...loadSale(db, sale.id), fiscal_warning });
  }));

  return r;
}
