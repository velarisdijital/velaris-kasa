// Dosya verme: tarayıcıda indirir; Android uygulamasında paylaşım menüsü açılır (WhatsApp, e-posta, Drive…).
import { isNativeApp } from './native.js';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** files: [{ name, content (string | Uint8Array), mime }] */
export async function giveFiles(files, { title = 'VelarisKasa' } = {}) {
  const enc = new TextEncoder();
  const list = files.map((f) => ({ ...f, bytes: typeof f.content === 'string' ? enc.encode(f.content) : f.content }));
  if (!isNativeApp()) {
    for (const f of list) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([f.bytes], { type: f.mime || 'application/octet-stream' }));
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await new Promise((r) => setTimeout(r, 300)); // tarayıcı art arda indirmeleri engellemesin
    }
    return;
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const uris = [];
  for (const f of list) {
    await Filesystem.writeFile({ path: f.name, data: toBase64(f.bytes), directory: Directory.Cache });
    uris.push((await Filesystem.getUri({ path: f.name, directory: Directory.Cache })).uri);
  }
  const { Share } = await import('@capacitor/share');
  try {
    await Share.share({ title, text: title, files: uris, dialogTitle: 'Nereye göndereyim?' });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) throw e;
  }
}
