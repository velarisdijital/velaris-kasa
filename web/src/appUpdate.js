// Uygulama içinden güncelleme: GitHub'daki son APK sürümüyle tabletteki sürüm karşılaştırılır.
// Yeni sürüm varsa üstte "Yeni sürüm var · Güncelle" çıkar; dokununca APK tarayıcıda indirilir, Android kurulumu sorar.
import { device, isNativeApp } from './native.js';

const RELEASE_API = 'https://api.github.com/repos/velarisdijital/velaris-kasa/releases/tags/android-latest';
const APK_URL = 'https://github.com/velarisdijital/velaris-kasa/releases/download/android-latest/VelarisKasa.apk';

/** Tabletteki sürüm: { versionName: '1.0.14', versionCode: 14 } */
export async function currentVersion() {
  if (!isNativeApp()) return null;
  return device('appInfo');
}

/** Yeni sürüm varsa { version, build, url, current } döner, yoksa null. İnternet yoksa null. */
export async function checkForUpdate() {
  if (!isNativeApp()) return null;
  const cur = await currentVersion();
  const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) return null;
  const rel = await res.json();
  const m = String(rel.name || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const build = Number(m[3]);
  if (!(build > Number(cur.versionCode))) return null;
  const asset = (rel.assets || []).find((a) => a.name?.endsWith('.apk'));
  return { version: m[0], build, url: `${asset?.browser_download_url || APK_URL}?v=${m[0]}`, current: cur.versionName };
}

/** APK'yı indirir (tarayıcıda). İndirme bitince bildirimine dokunup "Güncelle" denir. */
export async function installUpdate(url = APK_URL) {
  await device('openUrl', { url });
}
