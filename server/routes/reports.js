import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { dateRange, h } from '../util.js';

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

  r.get('/reports/summary', allow(...MANAGERS), h((req, res) => {
    const [from, to] = dateRange(req.query);
    const p = { from, to };
    const totals = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(discount),0) AS discount,
        COALESCE(SUM(vat_total),0) AS vat_total, COALESCE(SUM(cost_total),0) AS cost_total, COALESCE(SUM(refunded_total),0) AS refunded
      FROM sales WHERE created_at BETWEEN @from AND @to`).get(p);
    totals.net = totals.total - totals.refunded;
    totals.gross_profit = totals.total - totals.cost_total;
    totals.avg_basket = totals.count ? Math.round(totals.total / totals.count) : 0;

    const payments = db.prepare(`SELECT sp.method, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE s.created_at BETWEEN @from AND @to GROUP BY sp.method`).all(p);
    const daily = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS count, SUM(total) AS total
      FROM sales WHERE created_at BETWEEN @from AND @to GROUP BY day ORDER BY day`).all(p);
    const hourly = db.prepare(`SELECT CAST(substr(created_at,12,2) AS INTEGER) AS hour, COUNT(*) AS count, SUM(total) AS total
      FROM sales WHERE created_at BETWEEN @from AND @to GROUP BY hour ORDER BY hour`).all(p);
    const topProducts = db.prepare(`SELECT i.product_id, i.name, i.unit, SUM(i.qty - i.refunded_qty) AS qty, SUM(i.line_total) AS total,
        SUM(i.line_total - ROUND(i.unit_cost * i.qty)) AS profit
      FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at BETWEEN @from AND @to
      GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC LIMIT 20`).all(p);
    const categories = db.prepare(`SELECT COALESCE(c.name, 'Kategorisiz') AS name, c.color, SUM(i.line_total) AS total
      FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products pr ON pr.id = i.product_id
      LEFT JOIN categories c ON c.id = pr.category_id WHERE s.created_at BETWEEN @from AND @to GROUP BY c.id ORDER BY total DESC`).all(p);
    // Personel performansı: hizmeti yapan (staff_id) yoksa satışı yapan kasiyer
    const staff = db.prepare(`SELECT u.id, u.name, u.commission_rate, COUNT(DISTINCT s.id) AS sale_count,
        SUM(i.line_total) AS total, SUM(CASE WHEN i.type = 'service' THEN i.line_total ELSE 0 END) AS service_total
      FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN users u ON u.id = COALESCE(i.staff_id, s.user_id)
      WHERE s.created_at BETWEEN @from AND @to GROUP BY u.id ORDER BY total DESC`).all(p)
      .map((s) => ({ ...s, commission: Math.round((s.service_total * s.commission_rate) / 100) }));
    const collections = db.prepare(`SELECT COALESCE(-SUM(amount),0) AS total FROM customer_transactions
      WHERE type = 'payment' AND created_at BETWEEN @from AND @to`).get(p).total;
    const newDebt = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM customer_transactions
      WHERE type = 'debt' AND created_at BETWEEN @from AND @to`).get(p).total;

    res.json({ from, to, totals, payments, daily, hourly, top_products: topProducts, categories, staff, collections, new_debt: newDebt });
  }));

  r.get('/reports/stock', allow(...MANAGERS), h((req, res) => {
    const value = db.prepare(`SELECT COUNT(*) AS product_count, COALESCE(SUM(stock * buy_price),0) AS cost_value,
      COALESCE(SUM(stock * sell_price),0) AS sale_value FROM products WHERE active = 1 AND track_stock = 1 AND stock > 0`).get();
    const low = db.prepare(`SELECT id, name, stock, min_stock, unit, barcode FROM products
      WHERE active = 1 AND track_stock = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock - min_stock`).all();
    const negative = db.prepare('SELECT id, name, stock, unit FROM products WHERE active = 1 AND track_stock = 1 AND stock < 0').all();
    res.json({ value: { ...value, cost_value: Math.round(value.cost_value), sale_value: Math.round(value.sale_value) }, low, negative });
  }));

  return r;
}
