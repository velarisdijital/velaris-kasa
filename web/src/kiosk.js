// Tam kasa modu (Android uygulaması): ekran kararmasın, tam ekran, uygulamayı sabitle.
import { storage } from './api.js';
import { device, isNativeApp } from './native.js';

const KEY = 'vk_kiosk';
const DEFAULTS = { keepAwake: true, immersive: false };

export const getKiosk = () => ({ ...DEFAULTS, ...storage.get(KEY, {}) });

/** Ayarları uygular (açılışta ve değişince). Hata fırlatmaz. */
export async function applyKiosk(k = getKiosk()) {
  if (!isNativeApp()) return;
  await device('keepAwake', { on: !!k.keepAwake }).catch(() => {});
  await device('immersive', { on: !!k.immersive }).catch(() => {});
}

export async function saveKiosk(patch) {
  const k = { ...getKiosk(), ...patch };
  storage.set(KEY, k);
  await applyKiosk(k);
  return k;
}

export const pinApp = () => device('pin');
export const unpinApp = () => device('unpin');
export const isPinned = async () => !!(await device('isPinned')).pinned;
