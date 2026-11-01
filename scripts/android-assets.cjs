// Android simgeleri ve açılış ekranı: brand/logo/*.svg → android/app/src/main/res/  (node scripts/android-assets.cjs)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
const icon = fs.readFileSync(path.join(root, 'brand/logo/app-icon.svg'), 'utf8');
const maskable = fs.readFileSync(path.join(root, 'brand/logo/app-icon-maskable.svg'), 'utf8');
const foreground = maskable.replace(/<rect width="512" height="512" fill="#121212"\/>/, '');
const BG = '#121212';
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (file, w, h, body, transparent = false) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${transparent ? 'transparent' : BG};overflow:hidden">${body}</body></html>`);
    await p.screenshot({ path: file, omitBackground: transparent });
  };
  const svg = (s, size, extra = '') => s.replace(/width="512" height="512"/, `width="${size}" height="${size}" ${extra}`);
  for (const [d, k] of Object.entries(DENS)) {
    const dir = path.join(res, `mipmap-${d}`);
    const n = Math.round(48 * k);
    await shot(path.join(dir, 'ic_launcher.png'), n, n, svg(icon, n), true);
    await shot(path.join(dir, 'ic_launcher_round.png'), n, n, `<div style="width:${n}px;height:${n}px;border-radius:50%;overflow:hidden">${svg(maskable, n)}</div>`, true);
    const f = Math.round(108 * k);
    await shot(path.join(dir, 'ic_launcher_foreground.png'), f, f, svg(foreground, f), true);
  }
  for (const dir of fs.readdirSync(res).filter((x) => x.startsWith('drawable'))) {
    const file = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    await shot(file, w, h, svg(icon, Math.round(Math.min(w, h) * 0.28)));
  }
  fs.writeFileSync(path.join(res, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  await b.close();
  console.log('Android simgeleri ve açılış ekranı üretildi');
})();
