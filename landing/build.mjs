// landing/page.html → landing/public/index.html (tek başına barındırılabilir tam sayfa)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Canlı sitede demo bağlantıları aynı sitedeki uygulamaya gider (VK_APP_URL ile değiştirilebilir)
const APP_URL = process.env.VK_APP_URL || 'uygulama/';
const body = fs.readFileSync(path.join(dir, 'page.html'), 'utf8')
  .replaceAll('href="https://claude.ai/artifact/LQ1BwDfuMRHvnQWcFTSVQa" target="_blank" rel="noopener"', `href="${APP_URL}"`);
const out = path.join(dir, 'public');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121212">
<meta property="og:title" content="VelarisKasa">
<meta property="og:description" content="Market, bakkal, berber ve kafeler için stok takip ve kasa programı.">
<meta property="og:image" content="og-image.png">
<link rel="icon" href="icon.svg" type="image/svg+xml">
${body}
</html>
`);
for (const f of ['icon.svg']) fs.copyFileSync(path.join(dir, '..', 'web', 'public', f), path.join(out, f));
console.log('landing/public/index.html');
