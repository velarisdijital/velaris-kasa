// Android uygulaması için web derlemesi: dist-app/index.html (tek dosya, internetsiz çalışır)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --config vite.app.config.js', { stdio: 'inherit' });
const dir = 'dist-app/assets';
const read = (ext) => fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(ext))), 'utf8');
const js = read('.js').replace(/<\/script/g, '<\\/script');
const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121212">
<title>VelarisKasa</title>
<style>
${read('.css')}
</style>
</head>
<body>
<div id="root"></div>
<div id="print-area"></div>
<script type="module">
${js}
</script>
</body>
</html>
`;
fs.rmSync('dist-app', { recursive: true, force: true });
fs.mkdirSync('dist-app', { recursive: true });
fs.writeFileSync('dist-app/index.html', html);
console.log(`dist-app/index.html (${Math.round(html.length / 1024)} KB)`);
