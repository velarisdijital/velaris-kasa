// Ekrandaki sayı tuş takımı: tablette ekran klavyesi açmadan miktar, fiyat ve tutar girmek için
// (kasa ekranı, nakit ödeme, satır düzenleme, indirim, kasa açılış / kapanış).

/** Tuşu metne uygular: rakam ekler, tek virgül, ⌫ siler, C temizler. */
export function applyKey(value, key, { decimals = true } = {}) {
  const v = String(value ?? '');
  if (key === 'C') return '';
  if (key === '⌫') return v.slice(0, -1);
  if (key === ',') return !decimals || v.includes(',') ? v : `${v || '0'},`;
  if (/^\d$/.test(key)) {
    if (v === '0') return key;
    const [, frac] = v.split(',');
    if (frac !== undefined && frac.length >= 3) return v;
    return v + key;
  }
  return v;
}

/**
 * keys: tuşa basıldığında onKey(k). side: sağ sütundaki işlev tuşları [{ label, onClick, className, disabled, title }]
 * (en fazla 4; her satıra bir tane). decimals=false: virgül tuşu yerine 00.
 */
export default function NumPad({ onKey, side = [], decimals = true, compact = false, className = '' }) {
  const rows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], [decimals ? ',' : '00', '0', '⌫']];
  const press = (k) => {
    if (k === '00') { onKey('0'); onKey('0'); return; }
    onKey(k);
  };
  return (
    <div className={`numpad-grid ${side.length ? 'with-side' : ''} ${compact ? 'compact' : ''} ${className}`} role="group" aria-label="Sayı tuş takımı">
      {rows.map((row, i) => (
        <div key={i} className="np-row">
          {row.map((k) => (
            <button type="button" key={k} className={`np-key ${k === '⌫' ? 'np-del' : ''}`} onClick={() => press(k)} aria-label={k === '⌫' ? 'Sil' : k}>{k}</button>
          ))}
          {side[i] && (
            <button type="button" className={`np-key np-side ${side[i].className || ''}`} disabled={side[i].disabled} title={side[i].title} onClick={side[i].onClick}>{side[i].label}</button>
          )}
        </div>
      ))}
    </div>
  );
}
