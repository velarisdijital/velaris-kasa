import { Router } from 'express';
import { allow, MANAGERS } from '../auth.js';
import { requireFeature } from '../license.js';
import { bad, bool, h, int, notFound, str } from '../util.js';

export default function branchRoutes(db) {
  const r = Router();

  r.get('/branches', h((req, res) => {
    const branches = db.prepare(`SELECT b.*,
        (SELECT COUNT(*) FROM registers g WHERE g.branch_id = b.id) AS register_count,
        (SELECT COALESCE(SUM(bs.stock * p.buy_price), 0) FROM branch_stock bs JOIN products p ON p.id = bs.product_id
          WHERE bs.branch_id = b.id AND bs.stock > 0 AND p.active = 1) AS stock_cost_value
      FROM branches b ORDER BY b.active DESC, b.id`).all();
    const registers = db.prepare('SELECT g.name, g.branch_id, b.name AS branch_name FROM registers g JOIN branches b ON b.id = g.branch_id ORDER BY g.name').all();
    res.json({ branches: branches.map((b) => ({ ...b, stock_cost_value: Math.round(b.stock_cost_value) })), registers });
  }));

  r.post('/branches', allow(...MANAGERS), h((req, res) => {
    requireFeature(db, 'branches');
    const name = str(req.body.name);
    if (!name) throw bad('Şube adı gerekli');
    if (db.prepare('SELECT 1 FROM branches WHERE name = ?').get(name)) throw bad('Bu adda şube var');
    const id = db.prepare('INSERT INTO branches (name, address) VALUES (?, ?)').run(name, str(req.body.address)).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(id));
  }));

  r.put('/branches/:id', allow(...MANAGERS), h((req, res) => {
    requireFeature(db, 'branches');
    const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
    if (!b) throw notFound();
    const active = req.body.active === undefined ? b.active : bool(req.body.active);
    if (b.id === 1 && !active) throw bad('Merkez şube kapatılamaz');
    if (!active) {
      const stock = db.prepare('SELECT COUNT(*) AS n FROM branch_stock WHERE branch_id = ? AND stock != 0').get(b.id).n;
      if (stock) throw bad('Şubede stok varken kapatılamaz; önce stoğu başka şubeye transfer edin');
      db.prepare('UPDATE registers SET branch_id = 1 WHERE branch_id = ?').run(b.id);
    }
    db.prepare('UPDATE branches SET name = ?, address = ?, active = ? WHERE id = ?')
      .run(str(req.body.name) || b.name, str(req.body.address ?? b.address), active, b.id);
    res.json(db.prepare('SELECT * FROM branches WHERE id = ?').get(b.id));
  }));

  /** Kasayı (cihazı) bir şubeye bağlar. */
  r.put('/registers/:name', allow(...MANAGERS), h((req, res) => {
    requireFeature(db, 'branches');
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND active = 1').get(int(req.body.branch_id));
    if (!branch) throw bad('Şube bulunamadı');
    db.prepare(`INSERT INTO registers (name, branch_id) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET branch_id = excluded.branch_id`).run(String(req.params.name), branch.id);
    res.json({ ok: true });
  }));

  return r;
}
