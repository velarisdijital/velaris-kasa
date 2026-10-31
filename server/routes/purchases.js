// Tedarikçiler ve alış faturaları: alış → stok girişi + alış fiyatı + tedarikçi borcu.
import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { emitEvent } from '../db.js';
import { changeStock, round3 } from '../stock.js';
import { bad, bool, dateRange, h, int, notFound, num, str } from '../util.js';
import { resolveBranch } from './products.js';
import { openShiftFor } from './shifts.js';

export default function purchaseRoutes(db) {
  const r = Router();
  const getSupplier = (id) => db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);

  function supplierTx(supplierId, type, amount, extra = {}) {
    const s = getSupplier(supplierId);
    if (!s) throw notFound('Tedarikçi bulunamadı');
    const after = s.balance + amount;
    db.prepare("UPDATE suppliers SET balance = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, s.id);
    db.prepare(`INSERT INTO supplier_transactions (supplier_id, type, amount, balance_after, purchase_id, method, note, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(s.id, type, amount, after, extra.purchaseId ?? null, extra.method ?? null, extra.note ?? null, extra.userId ?? null);
    return after;
  }

  /** Tedarikçiye ödeme. Nakit ve açık kasa varsa kasadan para çıkışı olarak da işlenir (gün sonu doğru çıksın). */
  function paySupplier(supplierId, amount, method, { registerName, note, userId, purchaseId } = {}) {
    if (amount <= 0) throw bad('Tutar sıfırdan büyük olmalı');
    if (!['cash', 'card', 'transfer'].includes(method)) throw bad('Geçersiz ödeme yöntemi');
    const s = getSupplier(supplierId);
    supplierTx(supplierId, 'payment', -amount, { method, note, userId, purchaseId });
    if (method === 'cash') {
      const shift = openShiftFor(db, registerName);
      if (shift) {
        db.prepare('INSERT INTO cash_movements (shift_id, type, amount, note, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(shift.id, 'out', amount, `Tedarikçi ödemesi: ${s.name}${note ? ` · ${note}` : ''}`, userId);
      }
    }
  }

  // ---- Tedarikçiler ----
  r.get('/suppliers', allow(...MANAGERS), h((req, res) => {
    const where = ['active = 1'];
    const params = {};
    if (req.query.q) { where.push('(name LIKE @q OR phone LIKE @q OR tax_number LIKE @q)'); params.q = `%${req.query.q}%`; }
    if (req.query.debt === '1') where.push('balance > 0');
    res.json(db.prepare(`SELECT * FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name`).all(params));
  }));

  r.get('/suppliers/:id', allow(...MANAGERS), h((req, res) => {
    const s = getSupplier(req.params.id);
    if (!s) throw notFound();
    const transactions = db.prepare(`SELECT t.*, p.doc_no, u.name AS user_name FROM supplier_transactions t
      LEFT JOIN purchases p ON p.id = t.purchase_id LEFT JOIN users u ON u.id = t.user_id
      WHERE t.supplier_id = ? ORDER BY t.id DESC LIMIT 200`).all(s.id);
    const stats = db.prepare(`SELECT COUNT(*) AS purchase_count, COALESCE(SUM(total),0) AS purchase_total, MAX(doc_date) AS last_purchase
      FROM purchases WHERE supplier_id = ? AND status = 'posted'`).get(s.id);
    res.json({ ...s, transactions, stats });
  }));

  const supplierFields = (b, s = {}) => {
    const v = (k) => (b[k] !== undefined ? str(b[k]) : s[k] ?? null);
    const f = { name: v('name'), phone: v('phone'), email: v('email'), tax_number: v('tax_number'), tax_office: v('tax_office'), address: v('address'), note: v('note') };
    if (!f.name) throw bad('Tedarikçi adı gerekli');
    if (f.tax_number && !/^\d{10,11}$/.test(f.tax_number)) throw bad('VKN 10, TCKN 11 haneli olmalı');
    return f;
  };

  r.post('/suppliers', allow(...MANAGERS), h((req, res) => {
    const f = supplierFields(req.body);
    const id = db.prepare(`INSERT INTO suppliers (name, phone, email, tax_number, tax_office, address, note)
      VALUES (@name, @phone, @email, @tax_number, @tax_office, @address, @note)`).run(f).lastInsertRowid;
    res.status(201).json(getSupplier(id));
  }));

  r.put('/suppliers/:id', allow(...MANAGERS), h((req, res) => {
    const s = getSupplier(req.params.id);
    if (!s) throw notFound();
    const f = supplierFields(req.body, s);
    const active = req.body.active === undefined ? s.active : bool(req.body.active);
    if (!active && s.balance !== 0) throw bad('Bakiyesi olan tedarikçi kapatılamaz');
    db.prepare(`UPDATE suppliers SET name=@name, phone=@phone, email=@email, tax_number=@tax_number, tax_office=@tax_office,
      address=@address, note=@note, active=@active, updated_at=datetime('now','localtime') WHERE id=@id`).run({ ...f, active, id: s.id });
    res.json(getSupplier(s.id));
  }));

  r.post('/suppliers/:id/payment', allow(...MANAGERS), h((req, res) => {
    const s = getSupplier(req.params.id);
    if (!s) throw notFound();
    db.transaction(() => paySupplier(s.id, int(req.body.amount), req.body.method || 'cash',
      { registerName: req.body.register_name, note: str(req.body.note), userId: req.user.id }))();
    res.json(getSupplier(s.id));
  }));

  r.post('/suppliers/:id/adjust', allow(...MANAGERS), h((req, res) => {
    const s = getSupplier(req.params.id);
    if (!s) throw notFound();
    const amount = int(req.body.amount);
    if (!amount) throw bad('Tutar gerekli');
    db.transaction(() => supplierTx(s.id, 'adjust', amount, { note: str(req.body.note) || 'Bakiye düzeltme', userId: req.user.id }))();
    res.json(getSupplier(s.id));
  }));

  // ---- Alış faturaları ----
  const loadPurchase = (id) => {
    const p = db.prepare(`SELECT p.*, s.name AS supplier_name, b.name AS branch_name, u.name AS user_name FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN branches b ON b.id = p.branch_id LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`).get(id);
    if (p) p.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(id);
    return p;
  };

  r.get('/purchases', allow(...MANAGERS), h((req, res) => {
    const where = [];
    const params = { limit: Math.min(int(req.query.limit, 500) || 500, 5000) };
    if (req.query.from || req.query.to) {
      const [from, to] = dateRange(req.query);
      where.push('p.doc_date BETWEEN @from AND @to'); params.from = from.slice(0, 10); params.to = to.slice(0, 10);
    }
    if (req.query.supplier_id) { where.push('p.supplier_id = @sid'); params.sid = int(req.query.supplier_id); }
    res.json(db.prepare(`SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) AS item_count
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.doc_date DESC, p.id DESC LIMIT @limit`).all(params));
  }));

  r.get('/purchases/:id', allow(...MANAGERS), h((req, res) => {
    const p = loadPurchase(req.params.id);
    if (!p) throw notFound();
    res.json(p);
  }));

  /**
   * Alış girişi. body: { supplier_id?, doc_type, doc_no, doc_date, branch_id?, prices_include_vat?: bool,
   *   items: [{ product_id, qty, unit_price, vat_rate? }], update_buy_price?: bool (varsayılan true),
   *   payment?: { amount, method, register_name } }   — unit_price kuruş; prices_include_vat değilse KDV hariç.
   */
  r.post('/purchases', allow(...MANAGERS), h((req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Faturada ürün yok');
    const supplier = b.supplier_id ? getSupplier(int(b.supplier_id)) : null;
    if (b.supplier_id && !supplier) throw bad('Tedarikçi bulunamadı');
    const docType = ['fatura', 'irsaliye', 'fis'].includes(b.doc_type) ? b.doc_type : 'fatura';
    const docDate = /^\d{4}-\d{2}-\d{2}$/.test(b.doc_date || '') ? b.doc_date : new Date().toLocaleDateString('sv-SE');
    const incl = !!b.prices_include_vat;
    const items = b.items.map((it) => {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(int(it.product_id));
      if (!p) throw bad(`Ürün bulunamadı (#${it.product_id})`);
      const qty = round3(num(it.qty, NaN));
      if (!(qty > 0)) throw bad(`${p.name}: miktar geçersiz`);
      const price = int(it.unit_price);
      if (price < 0) throw bad(`${p.name}: fiyat geçersiz`);
      const vat = it.vat_rate != null && it.vat_rate !== '' ? num(it.vat_rate) : p.vat_rate;
      const net = incl ? Math.round(price / (1 + vat / 100)) : price;
      const gross = incl ? price : Math.round(price * (1 + vat / 100));
      const lineNet = Math.round(net * qty);
      const lineTotal = Math.round(gross * qty);
      return { p, qty, net, gross, vat, lineNet, lineTotal };
    });
    const netTotal = items.reduce((a, i) => a + i.lineNet, 0);
    const total = items.reduce((a, i) => a + i.lineTotal, 0);
    const pay = b.payment && int(b.payment.amount) > 0 ? b.payment : null;
    if (pay && !supplier) throw bad('Ödeme için tedarikçi seçin');
    if (pay && int(pay.amount) > total) throw bad('Ödeme fatura tutarından fazla olamaz');
    const updateBuy = b.update_buy_price !== false;

    const id = db.transaction(() => {
      if (supplier && b.doc_no && db.prepare("SELECT 1 FROM purchases WHERE supplier_id = ? AND doc_no = ? AND status = 'posted'").get(supplier.id, str(b.doc_no))) {
        throw bad(`Bu tedarikçinin ${b.doc_no} numaralı belgesi zaten girilmiş`);
      }
      const branchId = resolveBranch(db, req);
      const id = db.prepare(`INSERT INTO purchases (supplier_id, doc_type, doc_no, doc_date, branch_id, net_total, vat_total, total, note, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(supplier?.id ?? null, docType, str(b.doc_no), docDate, branchId, netTotal, total - netTotal, total,
        str(b.note), req.user.id).lastInsertRowid;
      const ins = db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, name, qty, unit, unit_cost_net, vat_rate, unit_cost, line_net, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const label = `${{ fatura: 'Alış faturası', irsaliye: 'İrsaliye', fis: 'Alış fişi' }[docType]}${b.doc_no ? ` ${str(b.doc_no)}` : ''}${supplier ? ` · ${supplier.name}` : ''}`;
      for (const i of items) {
        ins.run(id, i.p.id, i.p.name, i.qty, i.p.unit, i.net, i.vat, i.gross, i.lineNet, i.lineTotal);
        changeStock(db, i.p.id, i.qty, 'in', { unitCost: i.gross, note: label, userId: req.user.id, branchId });
        if (updateBuy && i.gross !== i.p.buy_price) {
          db.prepare("UPDATE products SET buy_price = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(i.gross, i.p.id);
        }
      }
      if (supplier) {
        supplierTx(supplier.id, 'purchase', total, { purchaseId: id, note: label, userId: req.user.id });
        if (pay) {
          paySupplier(supplier.id, int(pay.amount), pay.method || 'cash', { registerName: pay.register_name, note: label, userId: req.user.id, purchaseId: id });
          db.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(int(pay.amount), id);
        }
      }
      for (const i of items) emitEvent(db, 'product.upserted', db.prepare('SELECT * FROM products WHERE id = ?').get(i.p.id));
      return id;
    })();
    res.status(201).json(loadPurchase(id));
  }));

  /** İptal: stok geri çıkar, tedarikçi borcu düzeltilir. */
  r.post('/purchases/:id/cancel', allow(...MANAGERS), h((req, res) => {
    const p = loadPurchase(req.params.id);
    if (!p) throw notFound();
    if (p.status === 'cancelled') throw bad('Bu alış zaten iptal edilmiş');
    db.transaction(() => {
      const label = `İptal: alış ${p.doc_no || `#${p.id}`}`;
      for (const i of p.items) if (i.product_id) changeStock(db, i.product_id, -i.qty, 'out', { note: label, userId: req.user.id, branchId: p.branch_id });
      if (p.supplier_id) supplierTx(p.supplier_id, 'adjust', -p.total, { purchaseId: p.id, note: label, userId: req.user.id });
      db.prepare("UPDATE purchases SET status = 'cancelled', note = trim(COALESCE(note, '') || ' ' || ?) WHERE id = ?").run(str(req.body?.note) || '', p.id);
    })();
    res.json(loadPurchase(p.id));
  }));

  return r;
}
