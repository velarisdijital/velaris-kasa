// Tablet uygulamasında verilerin yedeklenmesi ve geri yüklenmesi.
// Veriler tabletin içinde (IndexedDB) durur; uygulama silinir ya da tablet bozulursa kaybolur. Bu yüzden:
//  - Her gün ilk açılışta ve gün sonunda otomatik yedek: Belgeler/VelarisKasa/Otomatik (son 7 gün)
//  - Elle: "Paylaş" (Google Drive, WhatsApp, e-posta…) ya da "Tablete kaydet" (Belgeler/VelarisKasa)
//  - Geri yükleme: listeden ya da dosya seçerek
import { api, serverUrl, storage } from './api.js';
import { isNativeApp } from './native.js';

const AUTO_KEY = 'vk_auto_backup_day';
const KEEP_AUTO = 7;
const FOLDER = 'VelarisKasa';
const AUTO_FOLDER = `${FOLDER}/Otomatik`;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
const today = () => stamp().slice(0, 10);
export const backupFileName = () => `velariskasa-yedek-${stamp()}.db`;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function backend() { return import('./demo/backend.js'); }
async function fs() { return import('@capacitor/filesystem'); } // modül nesnesi döner (Proxy değil)

/** Veritabanı baytları */
export async function backupBytes() {
  if (serverUrl()) {
    // Sunucu modu: sunucudaki verinin yedeği bu tablete de alınır (yönetici yetkisi gerekir)
    const res = await api('/backup', { raw: true });
    if (!res.ok) throw new Error(res.status === 403 ? 'Sunucudan yedek almak için yönetici olarak giriş yapın' : `Sunucudan yedek alınamadı (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return (await backend()).exportDatabase();
}

/**
 * Dosyayı önce herkese açık Belgeler klasörüne (uygulama silinse de kalır), olmazsa uygulamanın kendi klasörüne yazar.
 * Dönüş: { where: 'Belgeler/VelarisKasa/…' }
 */
async function writeFile(path, bytes) {
  const { Filesystem, Directory } = await fs();
  const data = toBase64(bytes);
  try {
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    return { where: `Belgeler/${path}`, directory: 'DOCUMENTS' };
  } catch {
    await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
    return { where: `uygulama klasörü/${path} (Belgeler'e yazılamadı)`, directory: 'DATA' };
  }
}

/** Yedeği tablete kaydeder: Belgeler/VelarisKasa/velariskasa-yedek-….db */
export async function saveBackupToDevice() {
  const bytes = await backupBytes();
  if (!isNativeApp()) { downloadInBrowser(bytes); return { where: 'İndirilenler' }; }
  return writeFile(`${FOLDER}/${backupFileName()}`, bytes);
}

/** Yedeği paylaşır (Google Drive, WhatsApp, e-posta, Bluetooth…) */
export async function shareBackup() {
  const bytes = await backupBytes();
  if (!isNativeApp()) { downloadInBrowser(bytes); return; }
  const { Filesystem, Directory } = await fs();
  const name = backupFileName();
  await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  const { Share } = await import('@capacitor/share');
  try {
    await Share.share({ title: 'VelarisKasa yedeği', text: `VelarisKasa yedeği (${name})`, files: [uri], dialogTitle: 'Yedeği nereye göndereyim?' });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) throw e; // kullanıcı paylaşımı kapattı
  }
}

function downloadInBrowser(bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Günde bir kez otomatik yedek (force: gün sonunda her zaman). Son 7 yedek tutulur. Hata fırlatmaz. */
export async function autoBackup({ force = false } = {}) {
  if (!isNativeApp()) return null;
  if (!force && storage.get(AUTO_KEY, '') === today()) return null;
  try {
    const bytes = await backupBytes();
    const r = await writeFile(`${AUTO_FOLDER}/velariskasa-otomatik-${stamp()}.db`, bytes);
    storage.set(AUTO_KEY, today());
    await pruneAuto(r.directory);
    return r;
  } catch {
    return null;
  }
}

async function pruneAuto(directory) {
  try {
    const { Filesystem } = await fs();
    const { files } = await Filesystem.readdir({ path: AUTO_FOLDER, directory });
    const names = files.map((f) => (typeof f === 'string' ? f : f.name)).filter((n) => n.endsWith('.db')).sort();
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_AUTO))) {
      await Filesystem.deleteFile({ path: `${AUTO_FOLDER}/${n}`, directory }).catch(() => {});
    }
  } catch { /* klasör yok */ }
}

/** Tabletteki yedekler (yeniden eskiye): [{ name, path, directory, size, mtime, auto }] */
export async function listBackups() {
  if (!isNativeApp()) return [];
  const { Filesystem } = await fs();
  const out = [];
  for (const directory of ['DOCUMENTS', 'DATA']) {
    for (const [path, auto] of [[FOLDER, false], [AUTO_FOLDER, true]]) {
      try {
        const { files } = await Filesystem.readdir({ path, directory });
        for (const f of files) {
          const name = typeof f === 'string' ? f : f.name;
          if (!name.endsWith('.db')) continue;
          out.push({ name, path: `${path}/${name}`, directory, auto, size: f.size || 0, mtime: Number(f.mtime) || 0 });
        }
      } catch { /* klasör yok */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}

/** Listeden geri yükleme */
export async function restoreFromDevice(b) {
  const { Filesystem } = await fs();
  const { data } = await Filesystem.readFile({ path: b.path, directory: b.directory });
  await restoreBytes(typeof data === 'string' ? fromBase64(data) : new Uint8Array(await data.arrayBuffer()));
}

/** Dosya seçerek geri yükleme (<input type="file">) */
export async function restoreFromFile(file) {
  await restoreBytes(new Uint8Array(await file.arrayBuffer()));
}

/** Önce mevcut veriyi güvenlik yedeği olarak kaydeder, sonra yedeği yükler ve uygulamayı yeniden açar. */
async function restoreBytes(bytes) {
  if (serverUrl()) throw new Error('Bu tablet sunucuya bağlı. Önce Ayarlar → Bu cihaz → "Bu tablete dön" deyin ya da yedeği sunucunun kendisinde geri yükleyin.');
  const be = await backend();
  const err = await be.checkBackup(bytes);
  if (err) throw new Error(err);
  if (isNativeApp()) {
    try { await writeFile(`${FOLDER}/geri-yukleme-oncesi-${stamp()}.db`, await be.exportDatabase()); } catch { /* yer yoksa da devam */ }
  }
  await be.importDatabase(bytes);
  storage.set(AUTO_KEY, '');
  setTimeout(() => location.reload(), 300);
}
