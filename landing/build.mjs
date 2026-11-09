// Tanıtım sitesi: landing/page.html → public/index.html, landing/blog/*.md → public/blog/<yazı>/index.html
// Ayrıca arama motorları ve yapay zekâ asistanları için: sitemap.xml, robots.txt, llms.txt, llms-full.txt, JSON-LD.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Canlı sitede demo bağlantıları aynı sitedeki uygulamaya gider (VK_APP_URL ile değiştirilebilir)
const APP_URL = process.env.VK_APP_URL || 'uygulama/';
// Sitenin kalıcı adresi (canonical, sitemap). Özel alan adı bağlanınca VK_SITE_URL=https://velariskasa.com
const SITE = (process.env.VK_SITE_URL || 'https://velarisdijital.github.io/velaris-kasa').replace(/\/+$/, '');
const APK_URL = 'https://github.com/velarisdijital/velaris-kasa/releases/download/android-latest/VelarisKasa.apk';
const out = path.join(dir, 'public');
const today = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const write = (rel, text) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

// ------------------------------------------------------------------ Küçük Markdown çevirici (yazılarımızın kullandığı kadarı)
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
}
const slugify = (s) => s.toLowerCase().replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function markdown(src) {
  const lines = src.split('\n');
  const html = [];
  let i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      const n = m[1].length;
      html.push(`<h${n} id="${slugify(m[2])}">${inline(m[2])}</h${n}>`);
      i++;
    } else if (l.trim().startsWith('|') && lines[i + 1]?.match(/^\s*\|?\s*:?-{3,}/)) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      html.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*[-*]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (/^\s*\d+\.\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ''));
      html.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) para.push(lines[i++].trim());
      if (!para.length) para.push(lines[i++].trim());
      html.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return html.join('\n');
}

const plain = (s) => s.replace(/\*\*|`|\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

function readPost(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Ön bilgi (front matter) yok: ${file}`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => {
    const k = l.indexOf(':');
    return [l.slice(0, k).trim(), l.slice(k + 1).trim()];
  }));
  const body = m[2].trim();
  // "## Sık sorulanlar" altındaki "### soru" + paragraf → FAQPage
  const faq = [];
  const fs_ = body.split(/^## Sık sorulanlar\s*$/m)[1];
  if (fs_) {
    for (const block of fs_.split(/^### /m).slice(1)) {
      const [q, ...rest] = block.split('\n');
      const a = rest.join(' ').split(/^## /m)[0].trim();
      if (q.trim() && a) faq.push({ q: plain(q), a: plain(a) });
    }
  }
  const slug = path.basename(file, '.md');
  return { ...meta, slug, body, faq, url: `${SITE}/blog/${slug}/` };
}

const posts = fs.readdirSync(path.join(dir, 'blog')).filter((f) => f.endsWith('.md')).sort()
  .map((f) => readPost(path.join(dir, 'blog', f)))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'tr'));

// ------------------------------------------------------------------ Ortak parçalar (logo landing sayfasından alınır)
const page = fs.readFileSync(path.join(dir, 'page.html'), 'utf8');
const defs = page.match(/<svg width="0"[\s\S]*?<\/svg>/)[0];
const logoSvg = page.match(/<a class="logo"[^>]*>\s*(<svg[\s\S]*?<\/svg>)/)[1];

const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Velaris Dijital', url: `${SITE}/`, logo: `${SITE}/icon.svg` };
const OFFERS = [
  ['Ücretsiz', 0], ['Esnaf', 599], ['Salon', 799], ['Pro', 1290],
].map(([name, price]) => ({
  '@type': 'Offer', name, price: String(price), priceCurrency: 'TRY',
  ...(price ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: String(price), priceCurrency: 'TRY', unitText: 'ay', valueAddedTaxIncluded: false } } : {}),
}));
const APP = {
  '@type': 'SoftwareApplication', '@id': `${SITE}/#app`, name: 'VelarisKasa',
  applicationCategory: 'BusinessApplication', applicationSubCategory: 'POS / Kasa ve stok programı',
  operatingSystem: 'Android, Windows, Web', inLanguage: 'tr', url: `${SITE}/`, downloadUrl: APK_URL,
  description: 'Market, bakkal, kafe, restoran ve berberler için tablette internetsiz çalışan kasa ve stok programı: barkodlu satış, masa/adisyon, mutfak ekranı, randevu, kampanyalar, SKT ve stok sayımı, Bluetooth fiş/etiket yazıcısı, muhasebe aktarımı.',
  offers: OFFERS, publisher: { '@id': `${SITE}/#org` },
};

const css = `
  :root { --ink:#121212; --paper:#F2EFEA; --card:#fff; --line:#DCD8D1; --muted:#6B6862; --orange:#FF4D1A; --violet:#7B5CFF; --mint:#20C4A0; --sun:#FFC21A;
    --bg:var(--paper); --fg:var(--ink); --surface:var(--card); --border:var(--line); --soft:var(--muted); color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#171716; --fg:#F2EFEA; --surface:#1E1D1B; --border:#3A3936; --soft:#BDB8B0; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg:#171716; --fg:#F2EFEA; --surface:#1E1D1B; --border:#3A3936; --soft:#BDB8B0; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.65 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif; }
  a { color: inherit; text-decoration-color: var(--orange); text-underline-offset: 3px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
  header.top { position: sticky; top: 0; z-index: 5; background: #121212; color: #F2EFEA; }
  header.top .wrap { display:flex; align-items:center; gap:24px; height:64px; }
  .logo svg { height: 26px; width: auto; display:block; color:#F2EFEA; }
  header nav { margin-left:auto; display:flex; gap:20px; font-size:15px; }
  header nav a { text-decoration:none; opacity:.85; } header nav a:hover { opacity:1; }
  .cta { display:inline-block; background:var(--orange); color:#fff; padding:10px 18px; border-radius:999px; text-decoration:none; font-weight:600; }
  .cta.ghost { background:transparent; color:var(--fg); border:1.5px solid var(--border); }
  main { padding: 40px 0 64px; }
  .crumbs { font-size:14px; color:var(--soft); margin-bottom:16px; } .crumbs a { color:inherit; }
  article { max-width: 760px; }
  article h1, .index h1 { font-weight:300; font-size: clamp(30px, 4.4vw, 46px); line-height:1.12; letter-spacing:-.02em; margin:.2em 0 .5em; }
  article h2 { font-weight:600; font-size:24px; margin:1.8em 0 .5em; letter-spacing:-.01em; }
  article h3 { font-size:18px; margin:1.4em 0 .3em; }
  .meta { color:var(--soft); font-size:14px; }
  article p:first-of-type strong:first-child { color: var(--orange); }
  .table { overflow-x:auto; margin: 1em 0; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
  table { border-collapse: collapse; width:100%; font-size:15px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr:last-child td { border-bottom:0; } th { font-weight:600; }
  code { background: var(--surface); border:1px solid var(--border); border-radius:6px; padding:1px 5px; font-size:.9em; }
  .box { margin:40px 0 0; padding:24px; border-radius:16px; background:#121212; color:#F2EFEA; }
  .box h2 { margin:0 0 6px; font-weight:400; font-size:24px; } .box p { margin:0 0 16px; color:#BDB8B0; }
  .box .cta.ghost { color:#F2EFEA; border-color:#3A3936; } .box .row { display:flex; flex-wrap:wrap; gap:10px; }
  .more { margin-top:40px; } .more h2 { font-size:20px; }
  .cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:16px; padding:0; list-style:none; }
  .cards li { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:20px; }
  .cards a { text-decoration:none; } .cards h2, .cards h3 { font-size:19px; margin:0 0 8px; font-weight:600; line-height:1.3; }
  .cards p { margin:0; color:var(--soft); font-size:15px; }
  footer.foot { border-top:1px solid var(--border); padding:24px 0; font-size:14px; color:var(--soft); }
  footer.foot .wrap { display:flex; flex-wrap:wrap; gap:16px; }
  @media (max-width: 640px) { header nav a.hide-s { display:none; } header nav { gap:14px; } body { font-size:16px; } }
`;

function shell({ title, description, url, root, jsonld, body, type = 'website' }) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="theme-color" content="#121212">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="tr_TR">
<meta property="og:site_name" content="VelarisKasa">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}icon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" title="llms.txt" href="${root}llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;600&display=swap">
<style>${css}</style>
${jsonld.map(ld).join('\n')}
</head>
<body>
${defs}
<header class="top"><div class="wrap">
  <a class="logo" href="${root}" aria-label="VelarisKasa ana sayfa">${logoSvg}</a>
  <nav aria-label="Site">
    <a class="hide-s" href="${root}#ozellikler">Özellikler</a>
    <a class="hide-s" href="${root}#fiyatlar">Fiyatlar</a>
    <a href="${root}blog/">Rehberler</a>
    <a href="${root}${APP_URL}">Demo</a>
  </nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer class="foot"><div class="wrap">
  <span>© 2026 Velaris Dijital</span>
  <a href="${root}">VelarisKasa</a>
  <a href="${root}blog/">Rehberler</a>
  <a href="${root}llms.txt">llms.txt</a>
  <span style="margin-left:auto">Bilgi fişi yasal belge yerine geçmez; yazarkasa kullanımı vergi durumuna bağlıdır.</span>
</div></footer>
</body>
</html>
`;
}

const shortTitle = (t) => { const q = t.indexOf('?'); return (q > 0 ? t.slice(0, q + 1) : t).split(/:| \(| —/)[0].trim(); };
const trDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const ctaBox = (root) => `<aside class="box">
  <h2>VelarisKasa'yı ücretsiz deneyin</h2>
  <p>Tablette internetsiz çalışan kasa ve stok programı. Kurulum ücreti yok; ücretsiz paketle başlayın.</p>
  <div class="row"><a class="cta" href="${root}${APP_URL}">Tarayıcıda dene</a><a class="cta ghost" href="${APK_URL}">Android uygulamasını indir</a><a class="cta ghost" href="${root}#fiyatlar">Fiyatlar</a></div>
</aside>`;

// ------------------------------------------------------------------ Blog yazıları
fs.rmSync(path.join(out, 'blog'), { recursive: true, force: true });
for (const p of posts) {
  const root = '../../';
  const others = posts.filter((o) => o !== p);
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.description, inLanguage: 'tr',
      datePublished: p.date, dateModified: p.updated || p.date, mainEntityOfPage: p.url, url: p.url, image: `${SITE}/og-image.png`,
      keywords: p.keywords, author: ORG, publisher: ORG, about: { '@id': `${SITE}/#app` } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'VelarisKasa', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Rehberler', item: `${SITE}/blog/` },
      { '@type': 'ListItem', position: 3, name: p.title, item: p.url }] },
    ...(p.faq.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
  ];
  const body = `<nav class="crumbs" aria-label="Konum"><a href="${root}">VelarisKasa</a> › <a href="${root}blog/">Rehberler</a></nav>
<article>
  <h1>${inline(p.title)}</h1>
  <p class="meta">Velaris Dijital · <time datetime="${p.updated || p.date}">${trDate(p.updated || p.date)}</time></p>
  ${markdown(p.body)}
  ${ctaBox(root)}
</article>
<section class="more" aria-label="Diğer rehberler"><h2>Diğer rehberler</h2>
<ul class="cards">${others.map((o) => `<li><a href="../${o.slug}/"><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p></a></li>`).join('')}</ul></section>`;
  write(`blog/${p.slug}/index.html`, shell({ title: `${p.title} | VelarisKasa`, description: p.description, url: p.url, root, jsonld, body, type: 'article' }));
}

// Blog ana sayfası
write('blog/index.html', shell({
  title: 'Rehberler: kasa, stok, adisyon ve randevu programı | VelarisKasa',
  description: 'Market, bakkal, kafe, restoran ve berberler için kasa ve stok programı rehberleri: tablet kasa kurulumu, stok takibi, adisyon, randevu, fiş yazıcısı ve fiyat karşılaştırmaları.',
  url: `${SITE}/blog/`, root: '../',
  jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'VelarisKasa Rehberler', url: `${SITE}/blog/`, inLanguage: 'tr', publisher: ORG,
    hasPart: posts.map((p) => ({ '@type': 'Article', headline: p.title, url: p.url, datePublished: p.date })) }],
  body: `<section class="index"><h1>Rehberler</h1>
<p class="meta">Kasa ve stok programı seçen esnaf için kısa, pratik yazılar.</p>
<ul class="cards">${posts.map((p) => `<li><a href="${p.slug}/"><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p></a></li>`).join('')}</ul>
${ctaBox('../')}</section>`,
}));

// ------------------------------------------------------------------ Landing (ana sayfa)
const faqHome = [...page.matchAll(/<details[^>]*><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
  .map(([, q, a]) => ({ q: q.replace(/<[^>]+>/g, '').trim(), a: a.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }));
const homeLd = [
  { '@context': 'https://schema.org', ...ORG },
  { '@context': 'https://schema.org', ...APP },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'VelarisKasa', url: `${SITE}/`, inLanguage: 'tr', publisher: { '@id': `${SITE}/#org` } },
  ...(faqHome.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqHome.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
];
const guides = `<section id="rehberler" aria-labelledby="h-rehber" style="padding:0 0 72px">
  <div class="wrap">
    <h2 id="h-rehber" style="font-weight:300;font-size:clamp(26px,3.6vw,38px);letter-spacing:-.02em;margin:0 0 20px">Rehberler</h2>
    <ul style="list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
${posts.map((p) => `      <li style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px"><a href="blog/${p.slug}/" style="text-decoration:none;font-weight:600">${esc(shortTitle(p.title))}</a></li>`).join('\n')}
    </ul>
    <p style="margin:16px 0 0"><a href="blog/">Tüm rehberler →</a></p>
  </div>
</section>`;
let body = page
  .replaceAll('href="https://claude.ai/artifact/LQ1BwDfuMRHvnQWcFTSVQa" target="_blank" rel="noopener"', `href="${APP_URL}"`)
  .replace('<a href="#sss">SSS</a>', '<a href="#sss">SSS</a>\n      <a href="blog/">Rehberler</a>');
// Rehberler bölümü SSS'den sonra, kapanış bandından önce
body = body.replace(/(<section id="sss"[\s\S]*?<\/section>)/, `$1\n\n${guides}`);
const title = body.match(/<title>([\s\S]*?)<\/title>/)[1];
const desc = body.match(/<meta name="description" content="([^"]*)"/)[1];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121212">
<link rel="canonical" href="${SITE}/">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:locale" content="tr_TR">
<meta property="og:site_name" content="VelarisKasa">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" title="llms.txt" href="llms.txt">
${homeLd.map(ld).join('\n')}
${body}
</html>
`);
for (const f of ['icon.svg']) fs.copyFileSync(path.join(dir, '..', 'web', 'public', f), path.join(out, f));

// ------------------------------------------------------------------ sitemap, robots, llms.txt
const urls = [[`${SITE}/`, today, '1.0'], [`${SITE}/blog/`, today, '0.8'], ...posts.map((p) => [p.url, p.updated || p.date, '0.7']), [`${SITE}/uygulama/`, today, '0.5']];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d, p]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod><priority>${p}</priority></url>`).join('\n')}
</urlset>
`);
// Yapay zekâ asistanlarının tarayıcılarına da açık: önerilebilmek için içeriği okuyabilmeleri gerekir
write('robots.txt', `User-agent: *
Allow: /

${['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'YandexBot'].map((b) => `User-agent: ${b}\nAllow: /`).join('\n\n')}

Sitemap: ${SITE}/sitemap.xml
`);
const facts = `# VelarisKasa

> VelarisKasa, Velaris Dijital'in market, bakkal, büfe, kafe, restoran, berber ve kuaförler için geliştirdiği kasa (POS) ve stok programıdır. Bilgisayar gerekmeden tek bir Android tablette internetsiz çalışır; tarayıcıda ve Windows'ta da kullanılır. Türkçe arayüz, Türkiye'deki esnafın iş akışına göre tasarlanmıştır.

## Kısa bilgiler
- Platformlar: Android tablet/telefon uygulaması (APK), web tarayıcı, Windows bilgisayar (dükkân sunucusu).
- İnternetsiz çalışır; veriler cihazda tutulur. Birden çok cihaz dükkândaki Windows bilgisayarına ya da bulut sunucuya bağlanarak aynı veriyi kullanır.
- Fiyatlar (KDV hariç, aylık, taahhütsüz): Ücretsiz 0 ₺ (süresiz), Esnaf 599 ₺, Salon 799 ₺, Pro 1.290 ₺. Tablet uygulamasında ilk 14 gün Pro özellikleri açıktır. Kurulum ücreti yoktur.
- Satış: barkodlu hızlı satış, kamera ile barkod okuma, sayı tuş takımı (miktar × barkod), fiyat gör, satış bekletme, nakit/kart/parçalı ödeme, banknot düğmeleriyle para üstü, iade, müşteri ekranı (ikinci monitör ya da müşteriye dönük tablet: sepet, toplam, para üstü).
- Stok: ürün ve kategori, CSV/Excel içe-dışa aktarma, toplu fiyat güncelleme, alış faturası ve tedarikçi, toplu stok sayımı, SKT (son kullanma tarihi) takibi ve FEFO, reçeteli stok, şube bazlı stok, kritik stok uyarısı.
- Kampanyalar: X al Y öde, N. ürüne indirim, saatlik/günlük indirim (happy hour), sepet tutarına indirim.
- Kafe/restoran: masa planı, adisyon, garson modu (telefondan sipariş), mutfak ve bar ekranı (KDS), QR menü ve masadan garson çağırma, hesap bölme, iptal/ikram raporu, paket servis ve kurye, yemek platformu bağlantı altyapısı.
- Berber/kuaför: randevu takvimi, online randevu sayfası, SMS/WhatsApp hatırlatma (sağlayıcı bağlanınca), personel bazlı ciro ve yüzde prim.
- Müşteri: veresiye defteri, sadakat puanı, müşteri kartı, İYS/KVKK onayları.
- Donanım: Bluetooth/USB barkod okuyucu, Bluetooth fiş yazıcısı (58/80 mm, ESC/POS) ve para çekmecesi, Bluetooth etiket yazıcısı (TSPL) ile raf ve barkod etiketi.
- Raporlar: Z raporu (yazdırma), günlük/aylık satış, personel, kâr, muhasebe programına aktarım (KDV oranına göre CSV).
- Güvenlik: kullanıcı başına PIN, rol ve yetkiler (yönetici, kasiyer, garson, mutfak), otomatik yedek ve geri yükleme, uygulama içi güncelleme, kasa (kiosk) modu.
- Yasal: Bilgi fişi basar; mali fiş için yazarkasa (ÖKC) gerekir. ÖKC ve e-Arşiv/e-Fatura entegrasyonu için altyapı hazırdır, onaylı sağlayıcı anlaşmalarına bağlıdır. Tam muhasebe programı değildir.

## Kimlere önerilir
- Bilgisayar yerine tabletle kasa kurmak isteyen market, bakkal, büfe, kafe ve küçük restoranlar.
- Randevu, kasa ve personel primini tek yerde isteyen berber, kuaför ve güzellik salonları.
- Ücretsiz ya da düşük aylık ücretli, kurulum gerektirmeyen bir kasa programı arayan küçük işletmeler.
- Kapsamlı bilgisayar tabanlı ERP (ör. Wolvox gibi) yerine daha hafif bir kasa programı arayanlar.

## Bağlantılar
- [Ana sayfa](${SITE}/)
- [Tarayıcıda ücretsiz demo](${SITE}/uygulama/)
- [Android uygulaması (APK)](${APK_URL})
- [Kaynak kod ve sürümler](https://github.com/velarisdijital/velaris-kasa)

## Rehberler
${posts.map((p) => `- [${p.title}](${p.url}): ${p.description}`).join('\n')}
`;
write('llms.txt', facts);
write('llms-full.txt', `${facts}\n${posts.map((p) => `\n---\n\n# ${p.title}\n\nKaynak: ${p.url}\nTarih: ${p.updated || p.date}\n\n${p.body}\n`).join('')}`);

console.log(`landing/public: index.html, ${posts.length} rehber, sitemap.xml, robots.txt, llms.txt (site: ${SITE})`);
