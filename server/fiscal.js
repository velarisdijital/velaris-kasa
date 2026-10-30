// Yazarkasa (YN ÖKC) entegrasyonu.
//
// Sürücüler:
//   none       → yazarkasa yok, yalnızca bilgi fişi (basit usul / muaf işletmeler)
//   simulator  → test ve demo için sahte mali fiş numarası üretir
//   bridge     → yerel ÖKC köprüsüne HTTP ile bağlanır. Köprü, cihaz üreticisinin GMP-3
//                kütüphanesini (Beko/Token, Hugin, Ingenico, Pavo …) kullanan küçük bir servistir.
//                Sözleşme: docs/YAZARKASA_ENTEGRASYON.md · örnek köprü: bridge/okc-bridge.js
//
// Akış: satış veritabanına yazılır → mali fiş cihaza gönderilir → sonuç satışa işlenir.
// Cihaz yanıt vermezse satış "failed" olarak işaretlenir ve kasada "Tekrar gönder" çıkar.

import { getSettings } from './db.js';
import { hasFeature } from './license.js';

const TIMEOUT_MS = 60_000; // kartla ödemede müşteri şifre girerken bekleyebilir

export const FISCAL_DRIVERS = {
  none: 'Yazarkasa yok (bilgi fişi)',
  simulator: 'Simülatör (test)',
  bridge: 'Yazarkasa köprüsü (GMP-3)',
};

/** Satışı cihaza gönderilecek standart biçime çevirir. Tutarlar kuruş. */
export function receiptPayload(sale, settings) {
  return {
    sale_id: sale.id,
    receipt_no: sale.receipt_no,
    created_at: sale.created_at,
    cashier: sale.user_name,
    register_name: sale.register_name,
    business: { name: settings.business_name, tax_number: settings.tax_number || null },
    customer: sale.customer_id ? { name: sale.customer_name, tax_number: sale.customer_tax_number || null } : null,
    items: sale.items.map((i) => ({
      name: i.name, barcode: i.barcode || null, qty: i.qty, unit: i.unit, unit_price: i.unit_price,
      discount: i.discount, vat_rate: i.vat_rate, line_total: i.line_total,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    // credit = açık hesap (veresiye), points = puanla ödeme (cihazda indirim/diğer olarak işlenir)
    payments: sale.payments.filter((p) => p.amount > 0),
  };
}

async function http(url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `Köprü hatası (HTTP ${res.status})`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Yazarkasa yanıt vermedi (zaman aşımı)');
    if (/fetch failed|ECONNREFUSED/.test(e.message)) throw new Error('Yazarkasa köprüsüne ulaşılamıyor. Köprü servisi çalışıyor mu?');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function driverFor(settings) {
  const base = (settings.fiscal_bridge_url || '').replace(/\/+$/, '');
  switch (settings.fiscal_driver) {
    case 'simulator': {
      return {
        async status() { return { ok: true, device: 'Simülatör', message: 'Hazır' }; },
        async printSale(receipt, db) {
          const n = db.prepare("SELECT COUNT(*) AS n FROM sales WHERE fiscal_status = 'done'").get().n + 1;
          const z = db.prepare("SELECT COUNT(*) AS n FROM shifts WHERE closed_at IS NOT NULL").get().n + 1;
          if (receipt.items.some((i) => /HATA-TEST/i.test(i.name))) throw new Error('Simülatör: kağıt bitti');
          return { fiscal_no: String(n).padStart(4, '0'), z_no: String(z).padStart(4, '0') };
        },
        async zReport() { return { ok: true, message: 'Simülatör Z raporu alındı' }; },
      };
    }
    case 'bridge':
      return {
        status: () => http(`${base}/status`),
        printSale: (receipt) => http(`${base}/receipt`, receipt),
        refund: (payload) => http(`${base}/refund`, payload),
        zReport: () => http(`${base}/z-report`, {}),
        xReport: () => http(`${base}/x-report`, {}),
      };
    default:
      return null;
  }
}

export const fiscalEnabled = (db) => hasFeature(db, 'fiscal') && !!driverFor(getSettings(db));

/** Satışın mali fişini cihaza gönderir ve sonucu satışa yazar. Hata fırlatmaz. */
export async function printFiscal(db, saleId, loadSale) {
  const settings = getSettings(db);
  const driver = driverFor(settings);
  if (!driver || !hasFeature(db, 'fiscal')) return null;
  const sale = loadSale(db, saleId);
  if (!sale || sale.fiscal_status === 'done') return sale;
  db.prepare("UPDATE sales SET fiscal_status = 'pending', fiscal_error = NULL WHERE id = ?").run(saleId);
  try {
    const r = await driver.printSale(receiptPayload(sale, settings), db);
    db.prepare(`UPDATE sales SET fiscal_status = 'done', fiscal_no = ?, fiscal_z_no = ?, fiscal_error = NULL,
      fiscal_at = datetime('now','localtime') WHERE id = ?`).run(String(r.fiscal_no ?? ''), r.z_no != null ? String(r.z_no) : null, saleId);
  } catch (e) {
    db.prepare("UPDATE sales SET fiscal_status = 'failed', fiscal_error = ? WHERE id = ?").run(String(e.message).slice(0, 300), saleId);
  }
  return loadSale(db, saleId);
}

export async function fiscalStatus(db) {
  const driver = driverFor(getSettings(db));
  if (!driver) return { ok: true, driver: 'none', message: 'Yazarkasa bağlı değil; bilgi fişi basılır.' };
  if (!hasFeature(db, 'fiscal')) return { ok: false, driver: getSettings(db).fiscal_driver, message: 'Yazarkasa bağlantısı Esnaf paketinde.' };
  try {
    return { ...(await driver.status()), driver: getSettings(db).fiscal_driver };
  } catch (e) {
    return { ok: false, driver: getSettings(db).fiscal_driver, message: e.message };
  }
}

export async function fiscalZReport(db) {
  const driver = driverFor(getSettings(db));
  if (!driver?.zReport) return null;
  return driver.zReport();
}

export async function fiscalRefund(db, payload) {
  const driver = driverFor(getSettings(db));
  if (!driver?.refund) return null;
  return driver.refund(payload);
}
