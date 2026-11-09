// Uygulama içi güncelleme (OTA):
//  - Web paketi (arayüz + tablette çalışan sunucu kodu): arka planda indirilir, bir sonraki açılışta (ya da
//    "Yeniden başlat" ile) devreye girer. QR / APK kurulumu gerekmez. Açılmazsa uygulama eski sürüme döner.
//  - Yeni web paketi daha yeni bir Android eklentisi isterse (REQUIRED_NATIVE_API) önce APK güncellenir:
//    uygulama APK'yı indirir ve Android'in kurulum ekranını açar (tek dokunuş, veriler silinmez).
import { storage } from './api.js';
import { device, isNativeApp, nativeCall } from './native.js';

/** Bu web paketinin istediği en düşük yerel eklenti sürümü (DevicePlugin.NATIVE_API). Yerel kod değişince artırın. */
export const REQUIRED_NATIVE_API = 2;
export const WEB_BUILD = Number(import.meta.env.VITE_WEB_BUILD || 0);

const RELEASE_API = 'https://api.github.com/repos/velarisdijital/velaris-kasa/releases/tags/android-latest';
const PENDING = 'vk_ota_pending';

export async function nativeInfo() {
  if (!isNativeApp()) return null;
  try { return await device('appInfo'); } catch { return null; }
}

/** GitHub'daki son sürüm: { build, version, nativeApi, webUrl, apkUrl } */
export async function latestRelease() {
  const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) return null;
  const rel = await res.json();
  const m = String(rel.name || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const asset = (n) => (rel.assets || []).find((a) => a.name === n)?.browser_download_url;
  return {
    build: Number(m[3]), version: m[0],
    nativeApi: Number(String(rel.body || '').match(/native_api=(\d+)/)?.[1] || 1),
    webUrl: asset('VelarisKasa-web.html'), apkUrl: asset('VelarisKasa.apk'),
  };
}

/**
 * Güncelleme var mı? Dönüş:
 *  { kind: 'web', version, ready: true }  → indirildi, yeniden başlatınca açılır
 *  { kind: 'apk', version, apkUrl }       → yerel kod da değişmiş, APK kurulmalı
 *  null                                   → güncel
 */
export async function checkAndPrepare() {
  const info = await nativeInfo();
  if (!info) return null;
  const rel = await latestRelease();
  if (!rel) return null;
  const nativeApi = Number(info.nativeApi || 1);
  const current = Math.max(WEB_BUILD, Number(info.versionCode || 0));
  if (!(rel.build > current)) return null;
  if (nativeApi >= rel.nativeApi && rel.webUrl && nativeApi >= 2) {
    const p = storage.get(PENDING, null);
    if (p?.build === rel.build) return { kind: 'web', version: rel.version, ready: true };
    const { path } = await nativeCall('VKDevice', 'otaDownload', { url: rel.webUrl, build: String(rel.build) }, 180000);
    storage.set(PENDING, { build: rel.build, version: rel.version, path });
    return { kind: 'web', version: rel.version, ready: true };
  }
  return { kind: 'apk', version: rel.version, apkUrl: rel.apkUrl };
}

/** İndirilmiş web paketine geç (uygulama yeniden yüklenir). */
export async function applyPending() {
  const p = storage.get(PENDING, null);
  if (!p?.path || !(p.build > WEB_BUILD)) return false;
  const { WebView } = await import('@capacitor/core');
  await WebView.setServerBasePath({ path: p.path });
  await WebView.persistServerBasePath();
  return true;
}

/** Açılışta: bekleyen paket varsa ona geç; bu paket sorunsuz açıldıysa yerel tarafa bildir. */
export async function onBoot() {
  if (!isNativeApp()) return false;
  const p = storage.get(PENDING, null);
  if (!p) return false;
  if (!(p.build > WEB_BUILD)) { storage.set(PENDING, null); return false; } // yeni sürüm açıldı
  // Her sürüm için tek deneme: geçtikten sonra hâlâ eski sürümdeysek (paket açılmadı) bekleyeni at, sonsuz döngüye girme
  if (storage.get('vk_ota_tried', null) === p.build) { storage.set(PENDING, null); return false; }
  storage.set('vk_ota_tried', p.build);
  try { return await applyPending(); } catch { return false; }
}

export async function confirmBoot() {
  if (!isNativeApp()) return;
  try { await device('otaConfirm'); } catch { /* eski APK: yok */ }
}

/** APK'yı indirip Android kurulum ekranını açar (eski APK'larda tarayıcıda indirir). */
export async function installApk(url) {
  try {
    await nativeCall('VKDevice', 'installApk', { url }, 300000);
  } catch (e) {
    if (/not implemented|UNIMPLEMENTED/i.test(String(e?.message || e))) { await device('openUrl', { url }); return; }
    throw e;
  }
}
