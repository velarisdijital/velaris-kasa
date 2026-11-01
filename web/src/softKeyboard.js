// Kasa modu: ekran klavyesi yalnızca kullanıcı bir yazı kutusuna dokununca açılır.
// Kasa ekranı barkod okuyucu için arama kutusunu sürekli seçili tutar, pencerelerdeki kutular da kendiliğinden
// seçilir (autoFocus). Tablette bu her seferinde klavyeyi açıyordu. Kodla yapılan odaklamalarda kutuya
// inputmode="none" verilir: kutu seçili kalır (barkod okuyucu ve fiziksel klavye çalışır) ama ekran klavyesi açılmaz.
// Kullanıcı kutuya dokununca asıl klavye türü geri gelir.
import { storage } from './api.js';

const KEY = 'vk_soft_keyboard'; // 'tap' (yalnızca dokununca) | 'auto' (her zaman)
const TEXT_TYPES = /^(text|search|number|tel|email|url|password|)$/;

export const softKeyboardDefault = () => {
  const native = !!globalThis.Capacitor?.isNativePlatform?.();
  const touch = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  return native || touch ? 'tap' : 'auto';
};
export const getSoftKeyboardMode = () => storage.get(KEY, null) || softKeyboardDefault();
export const setSoftKeyboardMode = (mode) => storage.set(KEY, mode);

const isTextField = (el) => !!el && ((el.tagName === 'INPUT' && TEXT_TYPES.test(el.type || '')) || el.tagName === 'TEXTAREA') && !el.readOnly;

function suppress(el) {
  if ('vkKb' in el.dataset) return;
  el.dataset.vkKb = el.getAttribute('inputmode') ?? '';
  el.setAttribute('inputmode', 'none');
}
function allow(el) {
  if (!('vkKb' in el.dataset)) return;
  const orig = el.dataset.vkKb;
  if (orig) el.setAttribute('inputmode', orig); else el.removeAttribute('inputmode');
  delete el.dataset.vkKb;
}

let installed = false;
/** Uygulama açılırken bir kez çağrılır. */
export function installSoftKeyboardGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let tapped = null; // kullanıcının son dokunduğu yazı kutusu

  document.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.('input, textarea');
    tapped = isTextField(el) ? el : null;
    if (!tapped || !('vkKb' in tapped.dataset)) return;
    allow(tapped); // dokunulan kutuda klavye açılsın
    // Kutu zaten seçiliyse dokunuş klavyeyi açmayabilir: bırakıp yeniden seç
    if (document.activeElement === tapped) {
      const el2 = tapped;
      el2.blur();
      setTimeout(() => { tapped = el2; el2.focus(); }, 0);
    }
  }, true);

  // Kodla yapılan odaklama (autoFocus, barkod kutusuna geri dönme): klavye açılmasın
  const origFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(...args) {
    if (getSoftKeyboardMode() === 'tap' && isTextField(this) && this !== tapped) suppress(this);
    return origFocus.apply(this, args);
  };

  // Kutudan çıkınca asıl klavye türü geri yüklenir (sonraki dokunuşta doğru klavye açılsın)
  document.addEventListener('focusout', (e) => {
    if (e.target === tapped) tapped = null;
    if (isTextField(e.target)) allow(e.target);
  }, true);
}
