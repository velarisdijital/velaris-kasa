// Raf etiketi ve ürün barkod etiketi (A4'e çoklu ya da rulo etiket yazıcısı).
import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { d, money, plain } from '../format.js';

/** EAN-13 geçerliyse EAN-13, değilse Code128 çizer. */
export function Barcode({ value, height = 34, width = 1.4, fontSize = 11 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    const v = String(value);
    const opts = { height, width, fontSize, margin: 0, displayValue: true, background: 'transparent', lineColor: '#000' };
    try {
      if (/^\d{12,13}$/.test(v)) JsBarcode(ref.current, v, { ...opts, format: 'EAN13' });
      else JsBarcode(ref.current, v, { ...opts, format: 'CODE128' });
    } catch {
      try { JsBarcode(ref.current, v, { ...opts, format: 'CODE128' }); } catch { /* çizilemeyen barkod boş kalır */ }
    }
  }, [value, height, width, fontSize]);
  return value ? <svg ref={ref} className="bc" /> : null;
}

export const LABEL_LAYOUTS = {
  'a4-shelf': { name: 'Raf etiketi · A4 (3×8)', kind: 'shelf', page: 'size: A4; margin: 8mm', cols: 3 },
  'roll-shelf': { name: 'Raf etiketi · rulo 60×40 mm', kind: 'shelf', page: 'size: 60mm 40mm; margin: 0', cols: 1, roll: true },
  'a4-sticker': { name: 'Barkod etiketi · A4 (4×10)', kind: 'sticker', page: 'size: A4; margin: 8mm', cols: 4 },
  'roll-sticker': { name: 'Barkod etiketi · rulo 40×30 mm', kind: 'sticker', page: 'size: 40mm 30mm; margin: 0', cols: 1, roll: true },
};

function ShelfLabel({ p, business }) {
  return (
    <div className="lbl shelf">
      <div className="lbl-name">{p.name}</div>
      <div className="lbl-price"><span>{plain(p.sell_price)}</span><small>₺</small></div>
      <div className="lbl-row">
        <span>{p.unit === 'adet' ? 'Adet fiyatı' : `${p.unit} fiyatı`}: {money(p.sell_price)}</span>
        <span>{d(p.price_changed_at || new Date().toLocaleDateString('sv-SE'))}</span>
      </div>
      <div className="lbl-row bottom">
        <Barcode value={p.barcode} height={22} width={1.1} fontSize={9} />
        <span className="lbl-biz">{business}</span>
      </div>
    </div>
  );
}

function StickerLabel({ p }) {
  return (
    <div className="lbl sticker">
      <div className="lbl-name">{p.name}</div>
      <Barcode value={p.barcode} height={28} width={1.2} fontSize={10} />
      <div className="lbl-price small">{money(p.sell_price)}</div>
    </div>
  );
}

/** Yazdırılacak sayfa: ürünler × kopya, seçilen düzende. */
export function LabelSheet({ products, layout, copies = 1, business }) {
  const L = LABEL_LAYOUTS[layout];
  const items = products.flatMap((p) => Array.from({ length: copies }, () => p));
  return (
    <div className={`labels ${L.kind} ${L.roll ? 'roll' : 'a4'}`} style={{ '--cols': L.cols }}>
      {items.map((p, i) => (L.kind === 'shelf' ? <ShelfLabel key={i} p={p} business={business} /> : <StickerLabel key={i} p={p} />))}
    </div>
  );
}
