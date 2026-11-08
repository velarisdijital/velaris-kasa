// Tabletteki verileri (SQLite dosyası) yeni kurulmuş sunucuya taşıma.
// Tablet uygulaması tek başına çalışırken veriler tablette durur; birden çok cihaza geçerken "Bu tabletteki
// verileri sunucuya taşı" bu dosyayı gönderir. Yalnızca kurulumu yapılmamış (boş) sunucuya izin verilir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSetting, openDatabase, setSettings } from './db.js';

const SQLITE_HEADER = 'SQLite format 3\u0000';
const REQUIRED = ['products', 'sales', 'settings', 'users'];
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Gelen veritabanını mevcut veritabanının yerine koyar (tablo tablo, ortak sütunlarla).
 * Gelen dosya önce sunucunun sürümüne göre güncellenir (göçler). Sunucunun kurulum kimliği korunur.
 */
export function importDatabase(db, bytes) {
  if (!bytes?.length || Buffer.from(bytes.subarray(0, 16)).toString('latin1') !== SQLITE_HEADER) {
    throw Object.assign(new Error('Gönderilen dosya bir VelarisKasa verisi değil'), { status: 400 });
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-import-'));
  const file = path.join(tmpDir, 'velaris-kasa.db');
  try {
    fs.writeFileSync(file, bytes);
    let src;
    try {
      src = openDatabase(tmpDir); // göçleri uygular
      const have = src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      if (!REQUIRED.every((t) => have.includes(t))) throw new Error('VelarisKasa tabloları yok');
      src.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      throw Object.assign(new Error(`Veri dosyası açılamadı: ${e.message}`), { status: 400 });
    } finally {
      src?.close();
    }

    const installId = getSetting(db, 'install_id');
    db.pragma('foreign_keys = OFF');
    db.prepare('ATTACH DATABASE ? AS src').run(file);
    try {
      const tables = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
      const counts = {};
      db.transaction(() => {
        for (const t of tables) {
          const mainCols = db.prepare(`PRAGMA main.table_info(${q(t)})`).all().map((c) => c.name);
          const srcCols = new Set(db.prepare(`PRAGMA src.table_info(${q(t)})`).all().map((c) => c.name));
          db.prepare(`DELETE FROM main.${q(t)}`).run();
          const cols = mainCols.filter((c) => srcCols.has(c));
          if (!cols.length) continue;
          const list = cols.map(q).join(', ');
          counts[t] = db.prepare(`INSERT INTO main.${q(t)} (${list}) SELECT ${list} FROM src.${q(t)}`).run().changes;
        }
        if (installId) setSettings(db, { install_id: installId });
      })();
      return counts;
    } finally {
      db.exec('DETACH DATABASE src');
      db.pragma('foreign_keys = ON');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
