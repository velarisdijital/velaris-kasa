#!/usr/bin/env node
// VelarisKasa lisans aracı (yalnızca Velaris Dijital kullanır; gizli anahtarı müşteriye vermeyin).
//
//   node scripts/license.mjs keygen [klasör]
//       Yeni Ed25519 anahtar çifti üretir: <klasör>/private.pem (GİZLİ) ve server/license-public.pem
//
//   node scripts/license.mjs issue --plan esnaf --business "Yıldız Market" [--months 12] [--install <kurulum-id>] [--key private.pem]
//       Müşteri için lisans anahtarı üretir. --install verilirse anahtar yalnızca o kurulumda çalışır
//       (kurulum kimliği: Ayarlar → Paket ekranında yazar).
//
//   node scripts/license.mjs show <anahtar>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, signLicense } from '../server/license.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const arg = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };

if (cmd === 'keygen') {
  const dir = rest[0] && !rest[0].startsWith('--') ? rest[0] : path.join(ROOT, '.license');
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = path.join(dir, 'private.pem');
  if (fs.existsSync(priv)) { console.error(`${priv} zaten var; üzerine yazılmadı.`); process.exit(1); }
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(ROOT, 'server', 'license-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`Gizli anahtar: ${priv}  ← güvenli bir yerde saklayın, depoya EKLEMEYİN`);
  console.log('Açık anahtar: server/license-public.pem (depoya eklenir)');
} else if (cmd === 'issue') {
  const plan = arg('plan');
  if (!PLANS[plan] || plan === 'free') { console.error(`--plan şunlardan biri olmalı: ${Object.keys(PLANS).filter((p) => p !== 'free').join(', ')}`); process.exit(1); }
  const months = Number(arg('months', 12));
  const exp = new Date(); exp.setMonth(exp.getMonth() + months);
  const payload = {
    lic: `L${Date.now().toString(36).toUpperCase()}`,
    plan,
    business: arg('business', ''),
    issued: new Date().toLocaleDateString('sv-SE'),
    exp: exp.toLocaleDateString('sv-SE'),
    ...(arg('install') ? { install: arg('install') } : {}),
  };
  const key = fs.readFileSync(arg('key', path.join(ROOT, '.license', 'private.pem')), 'utf8');
  console.log(signLicense(payload, key));
  console.error(`\n${PLANS[plan].name} · ${payload.business || '-'} · bitiş ${payload.exp} · ${payload.lic}`);
} else if (cmd === 'show') {
  const [, data] = String(rest[0] || '').split('.');
  console.log(JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')));
} else {
  console.log('Kullanım: keygen | issue --plan <esnaf|salon|pro> --business <ad> [--months 12] [--install <id>] | show <anahtar>');
}
