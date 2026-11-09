// Fiş yazıcısı (ESC/POS, 58 / 80 mm termal; Bluetooth klasik ya da BLE) ve para çekmecesi.
// Fiş resim olarak çizilir (Türkçe karakterler yazıcının kod sayfasına bağlı kalmaz) ve GS v 0 raster komutuyla gönderilir.
import { getReceiptPrinter, sendBytes } from './labelPrinter.js';
import { receiptDoc, renderDoc, SAMPLE_SALE, zDoc } from './receiptBitmap.js';

// Basılabilir genişlik (nokta, 203 dpi): 58 mm rulo → 384, 80 mm rulo → 576
export const paperDots = (paper) => (Number(paper) >= 76 ? 576 : 384);

const ESC = 0x1b;
const GS = 0x1d;
export const CMD = {
  init: [ESC, 0x40],
  feed: (n) => [ESC, 0x64, n],
  cut: [GS, 0x56, 0x42, 0x00], // kısmi kesim (beslemeli)
  drawer: (pin = 0) => [ESC, 0x70, pin, 25, 250], // çekmece: pin 2 (0) ya da pin 5 (1)
};

/** Canvas → GS v 0 raster bantları (1 = siyah). Ucuz yazıcıların arabelleği için 64 satırlık bantlar. */
export function rasterBytes(canvas, band = 64) {
  const { width: W, height: H } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const wb = Math.ceil(W / 8);
  const out = [];
  for (let y0 = 0; y0 < H; y0 += band) {
    const h = Math.min(band, H - y0);
    out.push(GS, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, h & 0xff, h >> 8);
    for (let y = y0; y < y0 + h; y++) {
      for (let xb = 0; xb < wb; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x >= W) continue;
          const i = (y * W + x) * 4;
          const dark = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 140 && data[i + 3] > 100;
          if (dark) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  return out;
}

/** Fiş baskı işi: başlat, resim, besle, kes; istenirse çekmeceyi aç. */
export function buildEscPos(canvas, { cut = true, drawer = false } = {}) {
  return new Uint8Array([...CMD.init, ...(drawer ? CMD.drawer(0) : []), ...rasterBytes(canvas), ...CMD.feed(4), ...(cut ? CMD.cut : [])]);
}

export const receiptPrinterReady = () => !!getReceiptPrinter().deviceId;

async function fontsReady() { if (document.fonts?.ready) await document.fonts.ready; }

/** Satış fişini fiş yazıcısına basar. drawer: nakit satışsa çekmeceyi de açar (ayar açıksa). */
export async function printReceiptEscPos(sale, settings, change = 0, { drawer = false } = {}) {
  await fontsReady();
  const cfg = getReceiptPrinter();
  const canvas = renderDoc(receiptDoc(sale, settings, change), paperDots(cfg.paper));
  await sendBytes(buildEscPos(canvas, { cut: cfg.cut !== false, drawer: drawer && cfg.drawer !== false }), 'receipt');
}

export async function printZEscPos(z, settings) {
  await fontsReady();
  const cfg = getReceiptPrinter();
  await sendBytes(buildEscPos(renderDoc(zDoc(z, settings), paperDots(cfg.paper)), { cut: cfg.cut !== false }), 'receipt');
}

export async function printTestReceipt(settings) {
  return printReceiptEscPos(SAMPLE_SALE, settings, 1010);
}

/** Para çekmecesini açar (çekmece fiş yazıcısına RJ11 kabloyla bağlı olmalı). */
export async function openDrawer() {
  await sendBytes(new Uint8Array([...CMD.init, ...CMD.drawer(0), ...CMD.drawer(1)]), 'receipt');
}
