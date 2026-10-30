// VelarisKasa logo üreticisi: yazılar Archivo'dan vektöre çevrilir (yazı tipi kurulu olmadan her yerde aynı görünür).
//   node brand/build.mjs   →   brand/logo/*.svg  (+ PNG'ler için: node brand/export-png.cjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'logo');
fs.mkdirSync(OUT, { recursive: true });
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));
const C = tokens.color;

const font = (w) => opentype.parse(fs.readFileSync(
  path.join(ROOT, '..', 'node_modules', '@fontsource', 'archivo', 'files', `archivo-latin-${w}-normal.woff`)).buffer);
const BOLD = font(800);
const REGULAR = font(400);

/** Velaris simgesi: dört renkli kol, rüzgârgülü düzeninde. (-100..100 koordinatlarında) */
function markPaths(colors = [C.orange, C.violet, C.mint, C.sun]) {
  const arm = 'M-34 -66 L-1 -17 L29 -68';
  return `<g fill="none" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">${
    colors.map((c, i) => `<path d="${arm}" stroke="${c}"${i ? ` transform="rotate(${i * 90})"` : ''}/>`).join('')}</g>`;
}

function text(fontObj, str, x, baseline, size, fill) {
  const p = fontObj.getPath(str, x, baseline, size);
  return { svg: `<path d="${p.toPathData(2)}" fill="${fill}"/>`, width: fontObj.getAdvanceWidth(str, size) };
}

/** Yatay logo: simge + "velaris" (kalın) + "kasa" (ince), bitişik. */
function horizontal({ ink, markColors }) {
  const H = 200;            // simge yüksekliği
  const size = 150;         // yazı boyutu
  const baseline = 147;
  const gap = 46;
  const x0 = H + gap;
  const v = text(BOLD, 'velaris', x0, baseline, size, ink);
  const k = text(REGULAR, 'kasa', x0 + v.width + 4, baseline, size, ink);
  const W = Math.ceil(x0 + v.width + 4 + k.width + 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="VelarisKasa">
  <g transform="translate(100 100)">${markPaths(markColors)}</g>
  ${v.svg}${k.svg}
</svg>
`;
}

function mark(colors) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="200" height="200" role="img" aria-label="Velaris">
  ${markPaths(colors)}
</svg>
`;
}

/** Uygulama ikonu: mürekkep zemin, ortada simge. */
function appIcon(bg = C.ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="VelarisKasa">
  <rect width="512" height="512" rx="116" fill="${bg}"/>
  <g transform="translate(256 256) scale(1.9)">${markPaths()}</g>
</svg>
`;
}

/** Maskelenebilir ikon (Android): tam kare zemin, simge güvenli alanda. */
function maskable() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${C.ink}"/>
  <g transform="translate(256 256) scale(1.45)">${markPaths()}</g>
</svg>
`;
}

const files = {
  'app-icon-maskable.svg': maskable(),
  'mark.svg': mark(),
  'mark-ink.svg': mark([C.ink, C.ink, C.ink, C.ink]),
  'mark-paper.svg': mark([C.paper, C.paper, C.paper, C.paper]),
  'velariskasa-light.svg': horizontal({ ink: C.ink }),
  'velariskasa-dark.svg': horizontal({ ink: C.paper }),
  'velariskasa-mono-ink.svg': horizontal({ ink: C.ink, markColors: [C.ink, C.ink, C.ink, C.ink] }),
  // Uygulama içinde temaya göre renk alan sürüm (yazı currentColor)
  'velariskasa-current.svg': horizontal({ ink: 'currentColor' }),
  'velariskasa-mono-paper.svg': horizontal({ ink: C.paper, markColors: [C.paper, C.paper, C.paper, C.paper] }),
  'app-icon.svg': appIcon(),
};
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), svg);
console.log(`${Object.keys(files).length} SVG → ${path.relative(process.cwd(), OUT)}`);
