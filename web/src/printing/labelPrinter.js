// Bluetooth (BLE) etiket yazıcısı: TSPL komut dili (Piranha 5510, Xprinter, HPRT, TSC uyumlu mini etiket yazıcıları).
// Etiket tarayıcıda resim olarak çizilir (Türkçe karakterler yazıcı yazı tipine bağlı kalmaz) ve BITMAP komutuyla gönderilir.
// Bağlantı: Android uygulamasında önce klasik Bluetooth (SPP, eşleşmiş yazıcılar; ClassicPrinterPlugin.java),
// olmazsa BLE (@capacitor-community/bluetooth-le); tarayıcıda (Chrome) Web Bluetooth.
import JsBarcode from 'jsbarcode';
import { storage } from '../api.js';
import { money } from '../format.js';

const KEY = 'vk_label_printer';
const DOTS_PER_MM = 8; // 203 dpi
// media: yazıcıda takılı rulo — 'label' (aralıklı etiket, ör. 50×30) | 'roll' (düz fiş kâğıdı, ör. 56 mm)
export const DEFAULT_PRINTER = { width: 50, height: 30, gap: 2, density: 8, speed: 4, invert: false, kind: 'shelf', media: 'label', receiptWidth: 56 };
export const isRoll = (cfg) => cfg.media === 'roll';
/** Fiş kâğıdı eninden basılabilir en (mm): 56–58 mm rulo → 48 mm (yazıcı kafası), 80 mm rulo → 72 mm */
export const receiptPrintWidth = (paperMm) => { const w = Number(paperMm) || 56; return w >= 76 ? 72 : Math.min(48, Math.max(30, w - 8)); };

// Yazıcıların yazma karakteristiği bulunan bilinen BLE servisleri (Web Bluetooth bunları önceden bildirmek ister)
const KNOWN_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '0000ff80-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000fee7-0000-1000-8000-00805f9b34fb',
];
const STANDARD = /^0000(1800|1801|180a|180f)-/; // Generic Access/Attribute, Device Info, Battery

export const getPrinter = () => ({ ...DEFAULT_PRINTER, ...storage.get(KEY, {}) });
export const savePrinter = (p) => storage.set(KEY, { ...getPrinter(), ...p });

// İki yazıcı: etiket yazıcısı (TSPL) ve fiş yazıcısı (ESC/POS, 58 / 80 mm). Bağlantı kodu ortak; prof hangisi olduğunu söyler.
const RECEIPT_KEY = 'vk_receipt_printer';
export const DEFAULT_RECEIPT_PRINTER = { paper: 58, drawer: true, cut: true, btSpeed: 'normal' };
export const getReceiptPrinter = () => ({ ...DEFAULT_RECEIPT_PRINTER, ...storage.get(RECEIPT_KEY, {}) });
export const saveReceiptPrinter = (p) => storage.set(RECEIPT_KEY, { ...getReceiptPrinter(), ...p });
export const forgetReceiptPrinter = () => storage.set(RECEIPT_KEY, {});
const PROFILES = { label: { get: getPrinter, save: savePrinter }, receipt: { get: getReceiptPrinter, save: saveReceiptPrinter } };
const P = (prof) => PROFILES[prof] || PROFILES.label;
const web = { label: { device: null, char: null }, receipt: { device: null, char: null } };
export const forgetPrinter = () => storage.set(KEY, {});
export const isNative = () => !!globalThis.Capacitor?.isNativePlatform?.();
export const bleSupported = () => isNative() || !!globalThis.navigator?.bluetooth;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Bağlantı

async function ble() {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  // Android 12+: konum izni de istenir; yoksa sistem tarama sonuçlarını boş döndürüyor
  await withTimeout(BleClient.initialize({ androidNeverForLocation: false }), 90000, 'Bluetooth izinleri alınamadı');
  return BleClient;
}

// Yazıcıya benzeyen cihaz adları (listede üste alınır, tek eşleşen varsa otomatik seçilir)
const PRINTER_NAME = /5510|piranha|print|label|etiket|xp-|hprt|tsc|niimbot|phomemo|marklife|gprinter|-ble\b/i;
export const looksLikePrinter = (name) => PRINTER_NAME.test(String(name || ''));
const sortDevices = (list) => [...list].sort((a, b) => Number(looksLikePrinter(b.name)) - Number(looksLikePrinter(a.name)) || String(a.name || '~').localeCompare(String(b.name || '~')));

// Klasik Bluetooth (SPP) eklentisi: android/app/src/main/java/.../ClassicPrinterPlugin.java
// DİKKAT: Capacitor eklenti nesnesi bir Proxy'dir ve her alan adına (then dahil) "yerel metot" döndürür.
// Bu nesne async bir fonksiyondan döndürülür ya da await edilirse JavaScript onu Promise sanıp .then'i çağırır
// ve çağrı sonsuza kadar bekler. Bu yüzden nesnenin kendisi asla döndürülmez/await edilmez; yalnızca metotları çağrılır.
const holder = { plugin: null };
async function loadClassic() {
  if (!holder.plugin) {
    const { registerPlugin } = await import('@capacitor/core');
    holder.plugin = registerPlugin('ClassicPrinter');
  }
}
/** Yerel ClassicPrinter metodunu çağırır (zaman aşımıyla: hiçbir çağrı sonsuza kadar beklemez). */
async function classicCall(method, options = {}, ms = 20000) {
  await loadClassic();
  return withTimeout(holder.plugin[method](options), ms, `Bluetooth (${method}) yanıt vermedi`);
}
async function classicListen(event, cb) {
  await loadClassic();
  return holder.plugin.addListener(event, cb); // Promise<{ remove }>
}
export function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message || 'Zaman aşımı')), ms); }),
  ]);
}
export const BT_TYPES = { 1: 'klasik', 2: 'BLE', 3: 'klasik + BLE' };

/** Tabletle eşleşmiş (Bluetooth ayarlarından bağlanmış) cihazlar, türüyle. Yalnızca Android uygulamasında. */
export async function pairedDevices() {
  if (!isNative()) return [];
  try {
    const { devices } = await classicCall('bonded', {}, 8000);
    return sortDevices(devices.map((d) => ({ deviceId: d.address, name: d.name || '', paired: true, type: d.type })));
  } catch {
    const B = await ble();
    const list = await B.getBondedDevices();
    return sortDevices(list.map((d) => ({ deviceId: d.deviceId, name: d.name || '', paired: true })));
  }
}
// Eşleşmiş cihaz yalnızca BLE değilse önce klasik Bluetooth denenir
const transportFor = (d) => (d.paired && d.type !== 2 ? 'spp' : 'ble');

/** Yakındaki BLE cihazlarını tarar; her bulunan için onFound çağrılır. stop() fonksiyonu döner. */
export async function scanNearby(onFound, ms = 12000) {
  const B = await ble();
  const seen = new Set();
  await withTimeout(B.requestLEScan({ allowDuplicates: false }, (r) => {
    const id = r.device.deviceId;
    if (seen.has(id)) return;
    seen.add(id);
    onFound({ deviceId: id, name: r.device.name || r.localName || '', rssi: r.rssi });
  }), 15000, 'BLE taraması başlamadı');
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; try { await B.stopLEScan(); } catch { /* yok say */ } } };
  setTimeout(stop, ms);
  return stop;
}

/**
 * Yakındaki klasik Bluetooth cihazlarını arar (eşleşmeye açık yazıcılar BLE taramasında görünmeyebilir).
 * Yalnızca Android uygulamasında. stop() döner; arama ms sonunda kendiliğinden biter.
 */
export async function discoverClassic(onFound, ms = 12000) {
  if (!isNative()) return { done: Promise.resolve({ devices: [] }), stop: async () => {} };
  const handle = await classicListen('deviceFound', (d) => onFound({
    deviceId: d.address, name: d.name || '', type: d.type, rssi: d.rssi, classic: true, paired: !!d.bonded,
  }));
  const done = classicCall('discover', { timeout: ms }, ms + 30000).finally(() => handle.remove());
  done.catch(() => {});
  return { done, stop: async () => { try { await handle.remove(); } catch { /* yok say */ } } };
}

/** Bluetooth izinlerini tek seferde ister (aynı anda iki izin penceresi açılırsa biri reddediliyor). */
export async function prepareBluetooth() {
  if (!isNative()) return;
  await ble();
}

/** Tabletin Bluetooth ayarlarını açar (oradan eşleştirilen yazıcı uygulamada "eşleşmiş" listesinde görünür). */
export async function openBluetoothSettings() {
  await classicCall('openSettings', {}, 5000);
}

/** Klasik Bluetooth cihazıyla eşleşir (tablet eşleştirme penceresi açabilir; PIN genelde 0000 ya da 1234). */
export async function bondDevice(address) {
  await classicCall('bond', { address }, 60000);
}

/** Listeden seçilen cihazı yazıcı olarak kaydeder ve bağlanır. */
export async function usePrinterDevice(dev, prof = 'label') {
  if (dev.classic && !dev.paired && dev.type !== 2) {
    await bondDevice(dev.deviceId);
    dev = { ...dev, paired: true };
  }
  P(prof).save({ deviceId: dev.deviceId, name: dev.name || dev.deviceId, service: null, characteristic: null, noResponse: false,
    transport: transportFor(dev), paired: !!dev.paired, btType: dev.type ?? null });
  return connectPrinter({ prof });
}

/** Kayıtlı yazıcı yoksa: eşleşmiş cihazlar arasında tek bir yazıcı varsa onu seçer. Dönüş: seçilen cihaz ya da null. */
export async function autoDetectPrinter() {
  if (!isNative() || getPrinter().deviceId) return null;
  const printers = (await pairedDevices()).filter((d) => looksLikePrinter(d.name));
  if (printers.length !== 1) return null;
  savePrinter({ deviceId: printers[0].deviceId, name: printers[0].name, service: null, characteristic: null,
    transport: transportFor(printers[0]), paired: true, btType: printers[0].type ?? null });
  return printers[0];
}

/** Tarayıcıda (Chrome) yazıcı seçimi: tarayıcının kendi listesi. */
export async function choosePrinter(prof = 'label') {
  if (isNative()) {
    const B = await ble();
    const dev = await B.requestDevice({});
    P(prof).save({ deviceId: dev.deviceId, name: dev.name || dev.deviceId, service: null, characteristic: null });
    return dev;
  }
  if (!navigator.bluetooth) throw new Error('Bu tarayıcı Bluetooth desteklemiyor. Android uygulamasını ya da Chrome tarayıcısını kullanın.');
  const w = web[prof] || web.label;
  w.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: KNOWN_SERVICES });
  w.char = null;
  P(prof).save({ deviceId: w.device.id, name: w.device.name || 'Yazıcı', service: null, characteristic: null });
  return { deviceId: w.device.id, name: w.device.name };
}

/** Bağlanır, yazılabilir karakteristiği bulur. Dönüş: tanılama için servis listesi. */
export async function connectPrinter({ ble: forceBle = false, prof = 'label' } = {}) {
  const p = P(prof).get();
  const w = web[prof] || web.label;
  if (!p.deviceId) throw new Error('Önce yazıcıyı seçin');
  if (isNative() && p.transport === 'spp' && !forceBle) {
    // Klasik Bluetooth bağlantısı baskı sırasında kurulur
    return [{ uuid: `Klasik Bluetooth (SPP) · ${p.deviceId}${p.btType ? ` · tür: ${BT_TYPES[p.btType] || p.btType}` : ''}`, characteristics: [] }];
  }
  if (isNative()) {
    const B = await ble();
    try {
      await B.connect(p.deviceId, () => {}, { timeout: 12000 });
    } catch (e) {
      if (/already/i.test(String(e.message))) { /* zaten bağlı */ } else {
        // Eşleşmiş adres çoğu zaman yazıcının klasik Bluetooth adresidir; BLE adresi farklıdır.
        // Yakında aynı adlı (ya da yazıcıya benzeyen) BLE cihazını arayıp ona bağlan.
        const alt = await findByScan(B, p);
        if (!alt) throw new Error(`Yazıcıya bağlanılamadı (${e.message || e}). Yazıcının açık olduğundan ve başka bir uygulamaya (yazıcının kendi uygulaması) bağlı olmadığından emin olun; tabletin Konum ayarını açıp tekrar deneyin.`);
        P(prof).save({ deviceId: alt.deviceId, name: alt.name || p.name, service: null, characteristic: null, transport: 'ble', paired: false });
        await B.connect(alt.deviceId, () => {}, { timeout: 12000 });
        return connectPrinter({ ble: true, prof });
      }
    }
    const services = await B.getServices(p.deviceId);
    const list = services.map((s) => ({ uuid: s.uuid, characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, props: Object.keys(c.properties).filter((k) => c.properties[k]) })) }));
    if (!p.characteristic) {
      const found = findWritable(list);
      if (!found) throw Object.assign(new Error('Yazıcıda yazılabilir bağlantı noktası bulunamadı'), { services: list });
      P(prof).save(found);
    }
    return list;
  }
  if (!w.device) throw new Error('Tarayıcıda yazıcıyı her açılışta yeniden seçin');
  const server = w.device.gatt.connected ? w.device.gatt : await w.device.gatt.connect();
  const services = await server.getPrimaryServices();
  const list = [];
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(() => []);
    list.push({ uuid: s.uuid, characteristics: chars.map((c) => ({ uuid: c.uuid, props: Object.keys(c.properties.toJSON?.() || { write: c.properties.write, writeWithoutResponse: c.properties.writeWithoutResponse }).filter((k) => c.properties[k]), ref: c })) });
  }
  const found = findWritable(list);
  if (!found) throw Object.assign(new Error('Yazıcıda yazılabilir bağlantı noktası bulunamadı'), { services: list });
  w.char = list.flatMap((s) => s.characteristics).find((c) => c.uuid === found.characteristic)?.ref;
  P(prof).save(found);
  return list.map((s) => ({ ...s, characteristics: s.characteristics.map(({ ref, ...c }) => c) }));
}

/** 8 sn BLE taraması: kayıtlı yazıcıyla aynı adlı (yoksa yazıcıya benzeyen) farklı adresli cihazı bulur. */
async function findByScan(B, p) {
  const base = String(p.name || '').replace(/[-_ ]?ble$/i, '').toLowerCase();
  let best = null;
  await B.requestLEScan({ allowDuplicates: false }, (r) => {
    const name = r.device.name || r.localName || '';
    if (r.device.deviceId === p.deviceId || !name) return;
    const n = name.toLowerCase();
    const score = (base && (n === String(p.name).toLowerCase() ? 3 : n.includes(base) || base.includes(n.replace(/[-_ ]?ble$/i, '')) ? 2 : 0)) || (looksLikePrinter(name) ? 1 : 0);
    if (score && (!best || score > best.score)) best = { deviceId: r.device.deviceId, name, score };
  });
  await sleep(8000);
  try { await B.stopLEScan(); } catch { /* yok say */ }
  return best;
}

function findWritable(list) {
  const cands = [];
  for (const s of list) {
    if (STANDARD.test(s.uuid)) continue;
    for (const c of s.characteristics) {
      const noResp = c.props.includes('writeWithoutResponse');
      if (noResp || c.props.includes('write')) cands.push({ service: s.uuid, characteristic: c.uuid, noResponse: noResp, known: KNOWN_SERVICES.includes(s.uuid) });
    }
  }
  cands.sort((a, b) => Number(b.known) - Number(a.known) || Number(b.noResponse) - Number(a.noResponse));
  return cands[0] || null;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Klasik Bluetooth gönderim hızı: yazıcının modülü yavaş okur, hızlı gönderilirse etiket boş çıkar ve yazıcı hataya düşer
export const BT_SPEEDS = {
  slow: { chunk: 128, delay: 40, label: 'Yavaş (en güvenli)' },
  normal: { chunk: 256, delay: 30, label: 'Normal' },
  fast: { chunk: 2048, delay: 20, label: 'Hızlı' },
};

/** Baytları yazıcıya gönderir. Android'de önce kayıtlı yol, olmazsa diğeri (klasik ↔ BLE) denenir. */
export async function sendBytes(bytes, prof = 'label') {
  const p = P(prof).get();
  if (isNative()) {
    const order = p.transport === 'spp' ? ['spp', 'ble'] : p.paired ? ['ble', 'spp'] : ['ble'];
    const errors = [];
    for (const t of order) {
      try {
        if (t === 'spp') {
          const { chunk, delay } = BT_SPEEDS[p.btSpeed] || BT_SPEEDS.normal;
          await classicCall('write', { address: p.deviceId, data: toBase64(bytes), chunk, delay }, 120000);
        }
        else await sendBle(bytes, prof);
        if (t !== p.transport) P(prof).save({ transport: t });
        return;
      } catch (e) {
        errors.push(`${t === 'spp' ? 'Klasik Bluetooth' : 'BLE'}: ${e.message || e}`);
      }
    }
    throw new Error(errors.join(' · '));
  }
  return sendWeb(bytes, prof);
}

async function sendBle(bytes, prof = 'label') {
  {
    const B = await ble();
    await connectPrinter({ ble: true, prof }); // uygulama yeniden açıldıysa bağlantı kopmuş olabilir; bağlıysa hemen döner
    const q = P(prof).get();
    const p0 = q;
    let mtu = 23;
    try { mtu = await B.getMtu(q.deviceId); } catch { /* varsayılan */ }
    const size = Math.max(20, Math.min(180, mtu - 3));
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = new DataView(bytes.buffer, bytes.byteOffset + i, Math.min(size, bytes.length - i));
      if (q.noResponse) await B.writeWithoutResponse(q.deviceId, q.service, q.characteristic, chunk);
      else await B.write(q.deviceId, q.service, q.characteristic, chunk);
      if (q.noResponse) await sleep(p0.btSpeed === 'fast' ? 5 : 20); // yazıcının arabelleği taşmasın
    }
  }
}

async function sendWeb(bytes, prof = 'label') {
  const w = web[prof] || web.label;
  if (!w.char) await connectPrinter({ prof });
  const size = 180;
  for (let i = 0; i < bytes.length; i += size) {
    const chunk = bytes.subarray(i, i + size);
    if (P(prof).get().noResponse && w.char.writeValueWithoutResponse) await w.char.writeValueWithoutResponse(chunk);
    else await w.char.writeValue(chunk);
    if ((i / size) % 8 === 7) await sleep(15);
  }
}

// ---------------------------------------------------------------- Etiket çizimi
function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxWidth || !line) line = t;
    else { lines.push(line); line = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function barcodeCanvas(value, height) {
  const c = document.createElement('canvas');
  const v = String(value || '');
  if (!v) return null;
  const opts = { height, width: 2, margin: 0, displayValue: true, fontSize: 18, textMargin: 0, font: 'Archivo, sans-serif', background: '#fff', lineColor: '#000' };
  try { JsBarcode(c, v, { ...opts, format: /^\d{12,13}$/.test(v) ? 'EAN13' : 'CODE128' }); } catch {
    try { JsBarcode(c, v, { ...opts, format: 'CODE128' }); } catch { return null; }
  }
  return c;
}

/**
 * Bir ürünün etiketini çizer. kind: 'shelf' (raf / fiyat etiketi: büyük fiyat) | 'sticker' (barkod etiketi: büyük barkod).
 * Dönüş: canvas (width×height mm, 203 dpi).
 */
export function drawLabel(p, cfg = getPrinter(), business = '') {
  const W = Math.round(cfg.width * DOTS_PER_MM);
  const H = Math.round(cfg.height * DOTS_PER_MM);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#000'; x.textBaseline = 'top';
  const pad = 12;
  const font = (w, s) => `${w} ${s}px Archivo, "Helvetica Neue", Arial, sans-serif`;
  const price = money(p.sell_price);
  if (cfg.kind === 'sticker') {
    x.font = font(700, 24);
    const lines = wrap(x, p.name, W - pad * 2, 2);
    lines.forEach((l, i) => x.fillText(l, pad, pad + i * 27));
    const bc = barcodeCanvas(p.barcode, Math.round(H * 0.32));
    if (bc) x.drawImage(bc, Math.max(pad, (W - Math.min(bc.width, W - pad * 2)) / 2), pad + 60, Math.min(bc.width, W - pad * 2), bc.height);
    x.font = font(800, 30);
    x.textAlign = 'right'; x.textBaseline = 'bottom';
    x.fillText(price, W - pad, H - 6);
    return c;
  }
  // Raf etiketi: ad (2 satır), büyük fiyat, birim fiyat + tarih, altta barkod
  x.font = font(700, 26);
  const lines = wrap(x, p.name, W - pad * 2, 2);
  lines.forEach((l, i) => x.fillText(l, pad, pad - 2 + i * 28));
  const [lira, kurus] = price.replace('₺', '').trim().split(',');
  x.font = font(800, 72);
  const lw = x.measureText(lira).width;
  const top = pad + 58;
  x.fillText(lira, pad, top);
  x.font = font(800, 34);
  x.fillText(`,${kurus || '00'} ₺`, pad + lw + 4, top + 6);
  x.font = font(500, 16);
  const unit = p.unit && p.unit !== 'adet' ? `${p.unit} fiyatı` : 'Adet fiyatı';
  const date = new Date((p.price_changed_at || '').replace(' ', 'T') || Date.now());
  x.fillText(`${unit} · ${Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR')}`, pad, top + 74);
  const bc = barcodeCanvas(p.barcode, 38);
  if (bc) {
    const bw = Math.min(bc.width, W * 0.55);
    x.drawImage(bc, W - pad - bw, H - bc.height - 6, bw, bc.height);
  }
  if (business) {
    x.font = font(600, 15);
    x.fillText(business.slice(0, 22), pad, H - 22);
  }
  return c;
}

/** Canvas → TSPL BITMAP verisi (1 bit/nokta). TSPL'de 0 = siyah nokta; yazıcı ters basarsa ayarlardan "ters renk". */
function bitmapBytes(canvas, invert) {
  const { width: W, height: H } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const wb = Math.ceil(W / 8);
  const out = new Uint8Array(wb * H).fill(0xff);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (y * W + xx) * 4;
      const dark = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 140 && data[i + 3] > 100;
      if (dark !== invert) out[y * wb + (xx >> 3)] &= ~(0x80 >> (xx & 7));
    }
  }
  return { wb, H, out };
}

const enc = (s) => new TextEncoder().encode(s);
function concat(parts) {
  const n = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Etiketler için TSPL komutları. labels: [{ canvas, copies }] */
export function buildTspl(labels, cfg = getPrinter()) {
  const parts = [enc(`SIZE ${cfg.width} mm,${cfg.height} mm\r\nGAP ${isRoll(cfg) ? 0 : cfg.gap} mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\nDENSITY ${cfg.density}\r\nSPEED ${cfg.speed}\r\nSET TEAR ON\r\n`)];
  for (const { canvas, copies = 1 } of labels) {
    const { wb, H, out } = bitmapBytes(canvas, !!cfg.invert);
    parts.push(enc(`CLS\r\nBITMAP 0,0,${wb},${H},0,`), out, enc(`\r\nPRINT 1,${Math.max(1, copies | 0)}\r\n`));
  }
  return concat(parts);
}

// TSPL durum baytı (ESC ! ?): her bit bir hata
const STATUS_BITS = [
  [0x01, 'Kafa/kapak açık: kapağı "klik" sesi gelene kadar bastırarak kapatın'],
  [0x02, 'Kâğıt sıkışması ya da etiket aralığı bulunamıyor: ruloyu yeniden takıp "Kalibre et"e basın'],
  [0x04, 'Kâğıt yok ya da etiket algılanamıyor: ruloyu yeniden takıp "Kalibre et"e basın'],
  [0x08, 'Ribon yok'],
  [0x10, 'Yazıcı duraklatılmış (pause): yazıcının tuşuna bir kez basın'],
  [0x20, 'Yazdırıyor'],
  [0x80, 'Diğer hata (pil zayıf ya da kafa çok ısındı olabilir)'],
];
export function decodeStatus(byte) {
  if (byte === 0) return { ok: true, text: 'Hazır (hata yok)' };
  const list = STATUS_BITS.filter(([b]) => byte & b).map(([, t]) => t);
  return { ok: byte === 0x20, text: list.join(' · ') || `Bilinmeyen durum (${byte})` };
}

/** Yazıcının durumunu sorar (yalnızca Android uygulamasında, klasik Bluetooth bağlantısında). */
export async function printerStatus() {
  const p = getPrinter();
  if (!p.deviceId) throw new Error('Önce yazıcıyı seçin');
  if (!isNative() || p.transport !== 'spp') throw new Error('Durum sorgusu yalnızca klasik Bluetooth bağlantısında çalışır');
  const r = await classicCall('transact', { address: p.deviceId, data: toBase64(new Uint8Array([0x1b, 0x21, 0x3f])), timeout: 2500 }, 20000);
  if (!r.bytes) return { ok: null, code: null, text: 'Yazıcı durum bilgisi göndermedi (bu model desteklemiyor olabilir)' };
  const byte = atob(r.data).charCodeAt(0);
  return { code: byte, ...decodeStatus(byte) };
}

/** Yazıcıya etiket boyunu ve aralığını yeniden ölçtürür (GAPDETECT). */
// Düz fiş kâğıdında GAP 0 (sürekli kâğıt): yazıcı etiket aralığı aramaz. Etiket rulosunda GAPDETECT ile ölçer.
export async function calibratePrinter(cfg = getPrinter()) {
  if (isRoll(cfg)) await sendBytes(enc(`SIZE ${receiptPrintWidth(cfg.receiptWidth)} mm,40 mm\r\nGAP 0 mm,0 mm\r\n`));
  else await sendBytes(enc(`SIZE ${cfg.width} mm,${cfg.height} mm\r\nGAP ${cfg.gap} mm,0 mm\r\nGAPDETECT\r\n`));
}

/** Yazıcının kendi ayarlarını fabrika değerlerine döndürür (INITIALPRINTER). */
export async function resetPrinter() {
  await sendBytes(enc('INITIALPRINTER\r\n'));
}

/**
 * Etiketleri tek tek gönderir: her etiket ayrı iş, aralarında yazıcının basmasına zaman tanınır.
 * (Tek seferde büyük veri gönderilince ucuz yazıcıların arabelleği taşıyor.)
 */
export async function sendLabels(labels, cfg = getPrinter()) {
  const jobs = labels.flatMap(({ canvas, copies = 1 }) => [{ canvas, copies }]);
  for (let i = 0; i < jobs.length; i++) {
    await sendBytes(buildTspl([jobs[i]], cfg));
    if (i < jobs.length - 1) await sleep(1200);
  }
}

/** Ürün etiketlerini Bluetooth yazıcıya basar. */
export async function printLabels(products, { copies = 1, business = '', kind } = {}) {
  const cfg = { ...getPrinter(), ...(kind ? { kind } : {}) };
  if (document.fonts?.ready) await document.fonts.ready;
  const labels = products.map((p) => ({ canvas: drawLabel(p, cfg, business), copies }));
  await sendLabels(labels, cfg);
}

/** Deneme etiketi */
export async function printTest(business = 'VelarisKasa') {
  await printLabels([{ name: 'Deneme Etiketi · Çay Şekeri İğde Ğ', sell_price: 12990, unit: 'adet', barcode: '8690000000000' }], { business });
}
