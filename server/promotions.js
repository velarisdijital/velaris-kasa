// Kampanyalar: satış sırasında otomatik uygulanır. Bu modül saftır (veritabanı yok): sunucu satışı kaydederken
// indirimi kendisi hesaplar (kasiyer indirim yetkisine takılmaz), kasa ekranı da aynı modülle sepette gösterir.
//
// Türler:
//   bxgy    "X al Y öde"          → aynı üründen her X adette (X−Y) adet bedava   (ör. 3 al 2 öde)
//   nth     "N. ürüne %P indirim" → aynı üründen her N. adet %P indirimli         (ör. 2. ürüne %50)
//   percent "% indirim"           → kapsamdaki satırlara %P (saat / gün aralığıyla "happy hour")
//   basket  "Sepet tutarı üzeri"  → sepet en az T ₺ ise %P ya da A ₺ indirim (fiş geneli)
// Kapsam: all (tüm ürünler) | product | category. Bir satıra en çok bir kampanya (en kârlısı) uygulanır.
// Tutarlar kuruş. Gün: 1 = Pazartesi … 7 = Pazar.

export const PROMO_TYPES = {
  bxgy: 'X al Y öde',
  nth: 'N. ürüne indirim',
  percent: 'Yüzde indirim (saatlik / günlük olabilir)',
  basket: 'Sepet tutarı üzeri indirim',
};

const pad = (n) => String(n).padStart(2, '0');
/** "2026-11-09 14:30:00" biçiminde yerel saat */
export const localNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Kampanya şu an geçerli mi? (etkin, tarih aralığı, gün, saat aralığı; gece yarısını aşan saatler desteklenir) */
export function promoActiveAt(p, now = localNow()) {
  if (!p.active) return false;
  const day = now.slice(0, 10);
  if (p.date_from && day < p.date_from) return false;
  if (p.date_to && day > p.date_to) return false;
  if (p.days) {
    const d = new Date(`${day}T12:00:00`).getDay() || 7; // 1..7
    if (!String(p.days).split(',').map(Number).includes(d)) return false;
  }
  const hm = now.slice(11, 16);
  if (p.time_from && p.time_to) {
    if (p.time_from <= p.time_to) { if (hm < p.time_from || hm >= p.time_to) return false; }
    else if (hm < p.time_from && hm >= p.time_to) return false; // ör. 22:00–02:00
  }
  return true;
}

const inScope = (p, it) => p.scope === 'all' || !p.scope
  || (p.scope === 'product' && it.product_id && Number(p.product_id) === Number(it.product_id))
  || (p.scope === 'category' && it.category_id && Number(p.category_id) === Number(it.category_id));

/**
 * items: [{ product_id, category_id, qty, unit_price, discount (elle), type }]
 * Dönüş: { lines: [{ discount, promo_id, promo_name } | null], basket: { discount, promo_id, promo_name } | null, total_discount }
 */
export function applyPromotions(promos, items, { now = localNow() } = {}) {
  const live = (promos || []).filter((p) => promoActiveAt(p, now));
  const lines = items.map(() => null);
  // Aynı ürünün satırları birlikte sayılır (ör. 3 al 2 öde, iki ayrı satırda 2 + 1 adet)
  const groups = new Map();
  items.forEach((it, idx) => {
    if (!it.product_id || it.free) return;
    const k = String(it.product_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(idx);
  });
  const best = (idx, cand) => { if (cand.discount > 0 && (!lines[idx] || cand.discount > lines[idx].discount)) lines[idx] = cand; };

  for (const p of live) {
    if (p.type === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(p.percent) || 0));
      items.forEach((it, idx) => {
        if (!inScope(p, it)) return;
        const gross = Math.round(it.qty * it.unit_price) - (it.discount || 0);
        best(idx, { discount: Math.round((gross * pct) / 100), promo_id: p.id, promo_name: p.name });
      });
    } else if (p.type === 'bxgy' || p.type === 'nth') {
      for (const idxs of groups.values()) {
        const first = items[idxs[0]];
        if (!inScope(p, first)) continue;
        const qty = idxs.reduce((a, i) => a + (Number.isInteger(items[i].qty) ? items[i].qty : 0), 0); // tartılı ürünlerde uygulanmaz
        let units = 0; let pct = 100;
        if (p.type === 'bxgy') {
          const x = Number(p.buy_qty) || 0; const y = Number(p.pay_qty) || 0;
          if (x < 2 || y < 1 || y >= x) continue;
          units = Math.floor(qty / x) * (x - y);
        } else {
          const n = Number(p.nth) || 0;
          if (n < 2) continue;
          units = Math.floor(qty / n);
          pct = Math.min(100, Math.max(0, Number(p.percent) || 0));
        }
        if (!units) continue;
        // İndirim, grubun satırlarına adetleri oranında dağıtılır
        const price = Math.min(...idxs.map((i) => items[i].unit_price));
        let left = Math.round((units * price * pct) / 100);
        idxs.forEach((i, k) => {
          const share = k === idxs.length - 1 ? left : Math.round((Math.round((units * price * pct) / 100) * items[i].qty) / (qty || 1));
          left -= share;
          const max = Math.round(items[i].qty * items[i].unit_price) - (items[i].discount || 0);
          best(i, { discount: Math.max(0, Math.min(max, share)), promo_id: p.id, promo_name: p.name });
        });
      }
    }
  }
  const lineTotal = items.reduce((a, it, i) => a + Math.round(it.qty * it.unit_price) - (it.discount || 0) - (lines[i]?.discount || 0), 0);
  let basket = null;
  for (const p of live.filter((x) => x.type === 'basket')) {
    if (lineTotal < (Number(p.min_total) || 0)) continue;
    const d = p.amount ? Math.min(lineTotal, Number(p.amount)) : Math.round((lineTotal * Math.min(100, Number(p.percent) || 0)) / 100);
    if (d > 0 && (!basket || d > basket.discount)) basket = { discount: d, promo_id: p.id, promo_name: p.name };
  }
  const total_discount = lines.reduce((a, l) => a + (l?.discount || 0), 0) + (basket?.discount || 0);
  return { lines, basket, total_discount };
}
