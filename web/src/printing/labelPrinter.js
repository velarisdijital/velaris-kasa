// Bluetooth (BLE) etiket yazıcısı: TSPL komut dili (Piranha 5510, Xprinter, HPRT, TSC uyumlu mini etiket yazıcıları).
// Etiket tarayıcıda resim olarak çizilir (Türkçe karakterler yazıcı yazı tipine bağlı kalmaz) ve BITMAP komutuyla gönderilir.
// Bağlantı: Android uygulamasında @capacitor-community/bluetooth-le, tarayıcıda (Chrome) Web Bluetooth.
import JsBarcode from 'jsbarcode';
import { storage } from '../api.js';
import { money } from '../format.js';

const KEY = 'vk_label_printer';
const DOTS_PER_MM = 8; // 203 dpi
export const DEFAULT_PRINTER = { width: 50, height: 30, gap: 2, density: 8, speed: 4, invert: false, kind: 'shelf' };

// Yazıcıların yazma karakteristiği bulunan bilinen BLE servisleri (Web Bluetooth bunları önceden bildirmek ister)
const KNOWN_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '0000ff80-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000fee7-0000-1000-8000-00805f9b34fb',
];
const STANDARD = /^0000(1800|1801|180a|180f)-/; // Generic Access/Attribute, Device Info, Battery

export const getPrinter = () => ({ ...DEFAULT_PRINTER, ...storage.get(KEY, {}) });
export const savePrinter = (p) => storage.set(KEY, { ...getPrinter(), ...p });
export const forgetPrinter = () => storage.set(KEY, {});
export const isNative = () => !!globalThis.Capacitor?.isNativePlatform?.();
export const bleSupported = () => isNative() || !!globalThis.navigator?.bluetooth;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Bağlantı
let webDevice = null; // Web Bluetooth cihaz nesnesi (sayfa yenilenince yeniden seçilir)
let webChar = null;

async function ble() {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  await BleClient.initialize({ androidNeverForLocation: true });
  return BleClient;
}

// Yazıcıya benzeyen cihaz adları (listede üste alınır, tek eşleşen varsa otomatik seçilir)
const PRINTER_NAME = /5510|piranha|print|label|etiket|xp-|hprt|tsc|niimbot|phomemo|marklife|gprinter|-ble\b/i;
export const looksLikePrinter = (name) => PRINTER_NAME.test(String(name || ''));
const sortDevices = (list) => [...list].sort((a, b) => Number(looksLikePrinter(b.name)) - Number(looksLikePrinter(a.name)) || String(a.name || '~').localeCompare(String(b.name || '~')));

/** Tabletle eşleşmiş (Bluetooth ayarlarından bağlanmış) cihazlar. Yalnızca Android uygulamasında. */
export async function pairedDevices() {
  if (!isNative()) return [];
  const B = await ble();
  const list = await B.getBondedDevices();
  return sortDevices(list.map((d) => ({ deviceId: d.deviceId, name: d.name || '', paired: true })));
}

/** Yakındaki BLE cihazlarını tarar; her bulunan için onFound çağrılır. stop() fonksiyonu döner. */
export async function scanNearby(onFound, ms = 12000) {
  const B = await ble();
  const seen = new Set();
  await B.requestLEScan({ allowDuplicates: false }, (r) => {
    const id = r.device.deviceId;
    if (seen.has(id)) return;
    seen.add(id);
    onFound({ deviceId: id, name: r.device.name || r.localName || '', rssi: r.rssi });
  });
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; try { await B.stopLEScan(); } catch { /* yok say */ } } };
  setTimeout(stop, ms);
  return stop;
}

/** Listeden seçilen cihazı yazıcı olarak kaydeder ve bağlanır. */
export async function usePrinterDevice(dev) {
  savePrinter({ deviceId: dev.deviceId, name: dev.name || dev.deviceId, service: null, characteristic: null, noResponse: false });
  return connectPrinter();
}

/** Kayıtlı yazıcı yoksa: eşleşmiş cihazlar arasında tek bir yazıcı varsa onu seçer. Dönüş: seçilen cihaz ya da null. */
export async function autoDetectPrinter() {
  if (!isNative() || getPrinter().deviceId) return null;
  const printers = (await pairedDevices()).filter((d) => looksLikePrinter(d.name));
  if (printers.length !== 1) return null;
  savePrinter({ deviceId: printers[0].deviceId, name: printers[0].name, service: null, characteristic: null });
  return printers[0];
}

/** Tarayıcıda (Chrome) yazıcı seçimi: tarayıcının kendi listesi. */
export async function choosePrinter() {
  if (isNative()) {
    const B = await ble();
    const dev = await B.requestDevice({});
    savePrinter({ deviceId: dev.deviceId, name: dev.name || dev.deviceId, service: null, characteristic: null });
    return dev;
  }
  if (!navigator.bluetooth) throw new Error('Bu tarayıcı Bluetooth desteklemiyor. Android uygulamasını ya da Chrome tarayıcısını kullanın.');
  webDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: KNOWN_SERVICES });
  webChar = null;
  savePrinter({ deviceId: webDevice.id, name: webDevice.name || 'Yazıcı', service: null, characteristic: null });
  return { deviceId: webDevice.id, name: webDevice.name };
}

/** Bağlanır, yazılabilir karakteristiği bulur. Dönüş: tanılama için servis listesi. */
export async function connectPrinter() {
  const p = getPrinter();
  if (!p.deviceId) throw new Error('Önce yazıcıyı seçin');
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
        savePrinter({ deviceId: alt.deviceId, name: alt.name || p.name, service: null, characteristic: null });
        await B.connect(alt.deviceId, () => {}, { timeout: 12000 });
        return connectPrinter();
      }
    }
    const services = await B.getServices(p.deviceId);
    const list = services.map((s) => ({ uuid: s.uuid, characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, props: Object.keys(c.properties).filter((k) => c.properties[k]) })) }));
    if (!p.characteristic) {
      const found = findWritable(list);
      if (!found) throw Object.assign(new Error('Yazıcıda yazılabilir bağlantı noktası bulunamadı'), { services: list });
      savePrinter(found);
    }
    return list;
  }
  if (!webDevice) throw new Error('Tarayıcıda yazıcıyı her açılışta yeniden seçin');
  const server = webDevice.gatt.connected ? webDevice.gatt : await webDevice.gatt.connect();
  const services = await server.getPrimaryServices();
  const list = [];
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(() => []);
    list.push({ uuid: s.uuid, characteristics: chars.map((c) => ({ uuid: c.uuid, props: Object.keys(c.properties.toJSON?.() || { write: c.properties.write, writeWithoutResponse: c.properties.writeWithoutResponse }).filter((k) => c.properties[k]), ref: c })) });
  }
  const found = findWritable(list);
  if (!found) throw Object.assign(new Error('Yazıcıda yazılabilir bağlantı noktası bulunamadı'), { services: list });
  webChar = list.flatMap((s) => s.characteristics).find((c) => c.uuid === found.characteristic)?.ref;
  savePrinter(found);
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

/** Baytları parça parça gönderir. */
export async function sendBytes(bytes) {
  const p = getPrinter();
  if (isNative()) {
    const B = await ble();
    await connectPrinter(); // uygulama yeniden açıldıysa bağlantı kopmuş olabilir; bağlıysa hemen döner
    const q = getPrinter();
    let mtu = 23;
    try { mtu = await B.getMtu(q.deviceId); } catch { /* varsayılan */ }
    const size = Math.max(20, Math.min(180, mtu - 3));
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = new DataView(bytes.buffer, bytes.byteOffset + i, Math.min(size, bytes.length - i));
      if (q.noResponse) await B.writeWithoutResponse(q.deviceId, q.service, q.characteristic, chunk);
      else await B.write(q.deviceId, q.service, q.characteristic, chunk);
      if (q.noResponse && (i / size) % 8 === 7) await sleep(15); // yazıcının arabelleği taşmasın
    }
    return;
  }
  if (!webChar) await connectPrinter();
  const size = 180;
  for (let i = 0; i < bytes.length; i += size) {
    const chunk = bytes.subarray(i, i + size);
    if (getPrinter().noResponse && webChar.writeValueWithoutResponse) await webChar.writeValueWithoutResponse(chunk);
    else await webChar.writeValue(chunk);
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
  const parts = [enc(`SIZE ${cfg.width} mm,${cfg.height} mm\r\nGAP ${cfg.gap} mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\nDENSITY ${cfg.density}\r\nSPEED ${cfg.speed}\r\nSET TEAR ON\r\n`)];
  for (const { canvas, copies = 1 } of labels) {
    const { wb, H, out } = bitmapBytes(canvas, !!cfg.invert);
    parts.push(enc(`CLS\r\nBITMAP 0,0,${wb},${H},0,`), out, enc(`\r\nPRINT 1,${Math.max(1, copies | 0)}\r\n`));
  }
  return concat(parts);
}

/** Ürün etiketlerini Bluetooth yazıcıya basar. */
export async function printLabels(products, { copies = 1, business = '', kind } = {}) {
  const cfg = { ...getPrinter(), ...(kind ? { kind } : {}) };
  if (document.fonts?.ready) await document.fonts.ready;
  const labels = products.map((p) => ({ canvas: drawLabel(p, cfg, business), copies }));
  await sendBytes(buildTspl(labels, cfg));
}

/** Deneme etiketi */
export async function printTest(business = 'VelarisKasa') {
  await printLabels([{ name: 'Deneme Etiketi · Çay Şekeri İğde Ğ', sell_price: 12990, unit: 'adet', barcode: '8690000000000' }], { business });
}
