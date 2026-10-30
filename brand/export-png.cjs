// SVG logolardan PNG üretir (Playwright/Chromium ile). node brand/export-png.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const L = path.join(__dirname, 'logo');
const J = (...p) => path.join(__dirname, '..', ...p);
const jobs = [
  ['app-icon.svg', 512, 512, [J('electron/icon.png'), path.join(L, 'app-icon-512.png'), J('web/public/icon-512.png')]],
  ['app-icon.svg', 192, 192, [J('web/public/icon-192.png')]],
  ['app-icon.svg', 180, 180, [J('web/public/apple-touch-icon.png')]],
  ['app-icon-maskable.svg', 512, 512, [J('web/public/icon-maskable-512.png')]],
  ['velariskasa-light.svg', 1200, null, [path.join(L, 'velariskasa-light.png')]],
  ['velariskasa-dark.svg', 1200, null, [path.join(L, 'velariskasa-dark.png')]],
  ['mark.svg', 512, 512, [path.join(L, 'mark-512.png')]],
];

(async () => {
  const browser = await chromium.launch();
  for (const [file, w, h, outs] of jobs) {
    const svg = fs.readFileSync(path.join(L, file), 'utf8');
    const [, vw, vh] = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
    const height = h || Math.round((w * vh) / vw);
    const page = await browser.newPage({ viewport: { width: w, height } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${height}"`)}</body></html>`);
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height } });
    for (const o of outs) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, buf); }
    await page.close();
  }
  await browser.close();
  console.log(`${jobs.length} PNG üretildi`);
})();
