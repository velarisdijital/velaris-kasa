// Tarayıcı demosunu tek bir HTML dosyasına paketler: dist-demo/velaris-kasa-demo.html
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --config vite.demo.config.js', { stdio: 'inherit' });
const dir = 'dist-demo/assets';
const read = (ext) => fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(ext))), 'utf8');
const js = read('.js').replace(/<\/script/g, '<\\/script');
const html = `<meta charset="utf-8">
<title>Velaris Kasa</title>
<meta name="theme-color" content="#1d4ed8">
<style>
${read('.css')}
</style>
<div id="root"></div>
<div id="print-area"></div>
<script type="module">
${js}
</script>
`;
fs.writeFileSync('dist-demo/velaris-kasa-demo.html', html);
console.log(`dist-demo/velaris-kasa-demo.html (${Math.round(html.length / 1024)} KB)`);
