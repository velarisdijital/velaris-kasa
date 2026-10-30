// e-Arşiv / e-Fatura.
//
// Sağlayıcılar:
//   none       → kapalı
//   simulator  → deneme için GİB biçiminde sahte fatura numarası üretir
//   parasut    → Paraşüt API v4: müşteri (contact) → satış faturası → alıcı e-Fatura mükellefiyse e-Fatura,
//                değilse e-Arşiv. Belge GİB'e Paraşüt üzerinden iletilir.
//
// Fiyatlarımız KDV dahil; faturaya KDV hariç birim fiyat yazılır. Fiş geneli indirim satırlara dağıtılır.

import { getSettings, setSettings } from './db.js';

export const INVOICE_PROVIDERS = { none: 'Kapalı', simulator: 'Simülatör (deneme)', parasut: 'Paraşüt' };
export const FINAL_CONSUMER_TCKN = '11111111111'; // nihai tüketici (kimlik bilgisi verilmeyen)

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Satırları KDV hariç birim fiyatlarla fatura satırlarına çevirir (TL cinsinden). */
export function invoiceLines(sale) {
  const subtotal = sale.items.reduce((a, i) => a + i.line_total, 0);
  let left = sale.discount || 0;
  return sale.items.map((it, idx) => {
    const share = !sale.discount || !subtotal ? 0 : idx === sale.items.length - 1 ? left : Math.round((sale.discount * it.line_total) / subtotal);
    left -= share;
    const qty = it.qty - (it.refunded_qty || 0);
    const gross = ((it.line_total - share) * qty) / it.qty / 100; // TL, KDV dahil
    return { name: it.name, qty, unit: it.unit, vat_rate: it.vat_rate, unit_price_net: qty ? round(gross / (1 + it.vat_rate / 100) / qty) : 0, gross: round(gross, 2) };
  }).filter((l) => l.qty > 0);
}

// ---------------------------------------------------------------------------
// Paraşüt

const PARASUT = 'https://api.parasut.com';

async function parasutToken(db, s) {
  if (s.parasut_access_token && Number(s.parasut_token_expires || 0) > Date.now() + 60_000) return s.parasut_access_token;
  if (!s.parasut_client_id || !s.parasut_client_secret || !s.parasut_username || !s.parasut_password || !s.parasut_company_id) {
    throw new Error('Paraşüt bilgileri eksik (Ayarlar → e-Fatura)');
  }
  const res = await fetch(`${PARASUT}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'password', client_id: s.parasut_client_id, client_secret: s.parasut_client_secret,
      username: s.parasut_username, password: s.parasut_password, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Paraşüt girişi başarısız: ${j.error_description || j.error || res.status}`);
  setSettings(db, { parasut_access_token: j.access_token, parasut_token_expires: String(Date.now() + (j.expires_in || 7200) * 1000) });
  return j.access_token;
}

async function parasut(db, method, path, body) {
  const s = getSettings(db);
  const token = await parasutToken(db, s);
  const res = await fetch(`${PARASUT}/v4/${s.parasut_company_id}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.errors?.map((e) => e.detail || e.title).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Paraşüt: ${msg}`);
  }
  return j;
}

async function parasutCreate(db, sale, customer) {
  const s = getSettings(db);
  const taxNo = customer?.tax_number || FINAL_CONSUMER_TCKN;
  const isCompany = taxNo.length === 10;

  // 1) Müşteri kartı
  const contact = await parasut(db, 'POST', '/contacts', {
    data: {
      type: 'contacts',
      attributes: {
        name: customer?.name || 'Nihai Tüketici', contact_type: isCompany ? 'company' : 'person', account_type: 'customer',
        tax_number: taxNo, tax_office: customer?.tax_office || undefined, email: customer?.email || undefined,
        phone: customer?.phone || undefined, address: customer?.address || undefined, city: customer?.city || undefined,
        district: customer?.district || undefined,
      },
    },
  });

  // 2) Satış faturası
  const date = sale.created_at.slice(0, 10);
  const invoice = await parasut(db, 'POST', '/sales_invoices', {
    data: {
      type: 'sales_invoices',
      attributes: { item_type: 'invoice', description: `VelarisKasa fiş ${sale.receipt_no}`, issue_date: date, due_date: date, currency: 'TRL' },
      relationships: {
        contact: { data: { id: contact.data.id, type: 'contacts' } },
        details: {
          data: invoiceLines(sale).map((l) => ({
            type: 'sales_invoice_details',
            attributes: { quantity: l.qty, unit_price: l.unit_price_net, vat_rate: l.vat_rate, description: l.name },
          })),
        },
      },
    },
  });
  const invoiceId = invoice.data.id;

  // 3) Alıcı e-Fatura mükellefi mi?
  let job;
  let kind = 'e_archive';
  if (isCompany) {
    const inbox = await parasut(db, 'GET', `/e_invoice_inboxes?filter[vkn]=${taxNo}`);
    if (inbox.data?.length) {
      kind = 'e_invoice';
      job = await parasut(db, 'POST', '/e_invoices', {
        data: { type: 'e_invoices', attributes: { scenario: 'basic', to: inbox.data[0].attributes.e_invoice_address },
          relationships: { invoice: { data: { id: invoiceId, type: 'sales_invoices' } } } },
      });
    }
  }
  if (!job) {
    job = await parasut(db, 'POST', '/e_archives', {
      data: { type: 'e_archives', attributes: {}, relationships: { sales_invoice: { data: { id: invoiceId, type: 'sales_invoices' } } } },
    });
  }
  return { ref: `${kind}:${invoiceId}:${job.data.id}`, ...(await parasutPoll(db, `${kind}:${invoiceId}:${job.data.id}`, s)) };
}

/** Paraşüt'te belge oluşturma işini (trackable job) bekler; bitince fatura no ve PDF adresini döner. */
async function parasutPoll(db, ref, s = getSettings(db), tries = 8) {
  const [kind, invoiceId, jobId] = ref.split(':');
  for (let i = 0; i < tries; i++) {
    const job = await parasut(db, 'GET', `/trackable_jobs/${jobId}`);
    const status = job.data?.attributes?.status;
    if (status === 'error') throw new Error(`Paraşüt: ${(job.data.attributes.errors || []).join('; ') || 'belge oluşturulamadı'}`);
    if (status === 'done') {
      const inv = await parasut(db, 'GET', `/sales_invoices/${invoiceId}?include=active_e_document`);
      const doc = inv.included?.find((x) => x.type === (kind === 'e_invoice' ? 'e_invoices' : 'e_archives'));
      let url = null;
      if (doc) {
        try { url = (await parasut(db, 'GET', `/${kind === 'e_invoice' ? 'e_invoices' : 'e_archives'}/${doc.id}/pdf`)).data?.attributes?.url || null; } catch { /* PDF henüz hazır değil */ }
      }
      return { status: 'done', invoice_no: inv.data.attributes.invoice_no || doc?.attributes?.uuid || null, url };
    }
    await new Promise((r) => setTimeout(r, Number(s.parasut_poll_ms || 1500)));
  }
  return { status: 'pending' };
}

// ---------------------------------------------------------------------------

export const invoiceEnabled = (db) => ['simulator', 'parasut'].includes(getSettings(db).invoice_provider);

/** Satış için e-Arşiv/e-Fatura düzenler. Sonucu satışa yazar ve satışı döner. */
export async function createInvoice(db, saleId, loadSale) {
  const s = getSettings(db);
  const sale = loadSale(db, saleId);
  if (!sale) return null;
  if (sale.invoice_status === 'done') throw Object.assign(new Error(`Bu satışın faturası zaten kesildi (${sale.invoice_no})`), { status: 400 });
  if (sale.status === 'refunded') throw Object.assign(new Error('Tamamen iade edilmiş satışa fatura kesilemez'), { status: 400 });
  const customer = sale.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id) : null;
  db.prepare("UPDATE sales SET invoice_status = 'pending', invoice_error = NULL WHERE id = ?").run(saleId);
  try {
    let r;
    if (s.invoice_provider === 'simulator') {
      const n = db.prepare("SELECT COUNT(*) AS n FROM sales WHERE invoice_status = 'done'").get().n + 1;
      r = { status: 'done', invoice_no: `VLR${new Date().getFullYear()}${String(n).padStart(9, '0')}`, url: null, ref: `sim:${n}` };
    } else if (s.invoice_provider === 'parasut') {
      r = await parasutCreate(db, sale, customer);
    } else {
      throw Object.assign(new Error('e-Fatura bağlantısı kapalı (Ayarlar → e-Fatura)'), { status: 400 });
    }
    db.prepare('UPDATE sales SET invoice_status = ?, invoice_no = ?, invoice_url = ?, invoice_ref = ?, invoice_error = NULL WHERE id = ?')
      .run(r.status, r.invoice_no || null, r.url || null, r.ref || null, saleId);
  } catch (e) {
    if (e.status === 400) {
      db.prepare("UPDATE sales SET invoice_status = 'none' WHERE id = ?").run(saleId);
      throw e;
    }
    db.prepare("UPDATE sales SET invoice_status = 'failed', invoice_error = ? WHERE id = ?").run(String(e.message).slice(0, 300), saleId);
  }
  return loadSale(db, saleId);
}

/** Bekleyen (Paraşüt'te işlenmekte olan) faturanın durumunu yeniler. */
export async function refreshInvoice(db, saleId, loadSale) {
  const sale = loadSale(db, saleId);
  if (!sale || sale.invoice_status !== 'pending' || !sale.invoice_ref || getSettings(db).invoice_provider !== 'parasut') return sale;
  try {
    const r = await parasutPoll(db, sale.invoice_ref, getSettings(db), 1);
    if (r.status === 'done') {
      db.prepare("UPDATE sales SET invoice_status = 'done', invoice_no = ?, invoice_url = ? WHERE id = ?").run(r.invoice_no || null, r.url || null, saleId);
    }
  } catch (e) {
    db.prepare("UPDATE sales SET invoice_status = 'failed', invoice_error = ? WHERE id = ?").run(String(e.message).slice(0, 300), saleId);
  }
  return loadSale(db, saleId);
}
