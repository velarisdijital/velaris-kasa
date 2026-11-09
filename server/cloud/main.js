// Velaris Bulut sunucusu: node server/cloud/main.js
//
// Ortam değişkenleri:
//   VK_CLOUD_URL                 Bulutun ana adresi (kayıt ve ödeme sayfaları), ör. https://bulut.velariskasa.com
//   VK_CLOUD_DOMAIN              İşletmelere alt alan adı için, ör. velariskasa.com → https://yildizmarket.velariskasa.com
//                                (boş bırakılırsa işletmeler <VK_CLOUD_URL>/i/<adres>/ altında açılır)
//   VK_LICENSE_PRIVATE_KEY_FILE  Lisans imzalama gizli anahtarı (scripts/license.mjs keygen ile üretilen private.pem)
//   VK_CLOUD_ADMIN_TOKEN         /yonetim sayfasının parolası (kullanıcı adı herhangi bir şey)
//   VK_PAYMENT_PROVIDER          simulator (varsayılan) | iyzico
//   IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL (deneme: https://sandbox-api.iyzipay.com, canlı: https://api.iyzipay.com)
//   VELARIS_DATA_DIR             Veri klasörü (varsayılan ./data-cloud)
//   PORT                         (varsayılan 4850)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloud } from './app.js';
import { providerFromEnv } from './payments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const port = Number(env.PORT || 4850);
const keyFile = env.VK_LICENSE_PRIVATE_KEY_FILE || path.join(__dirname, '..', '..', '.license', 'private.pem');
if (!fs.existsSync(keyFile)) {
  console.error(`Lisans gizli anahtarı bulunamadı: ${keyFile}\nVK_LICENSE_PRIVATE_KEY_FILE ile gösterin.`);
  process.exit(1);
}
if (!env.VK_CLOUD_ADMIN_TOKEN) console.warn('Uyarı: VK_CLOUD_ADMIN_TOKEN yok; /yonetim sayfası kapalı.');

const cloud = createCloud({
  dataDir: env.VELARIS_DATA_DIR || path.join(__dirname, '..', '..', 'data-cloud'),
  baseUrl: env.VK_CLOUD_URL || `http://localhost:${port}`,
  domain: env.VK_CLOUD_DOMAIN || '',
  privateKeyPem: fs.readFileSync(keyFile, 'utf8'),
  provider: providerFromEnv(env),
  adminToken: env.VK_CLOUD_ADMIN_TOKEN || '',
  staticDir: path.join(__dirname, '..', '..', 'dist'),
});
const server = cloud.app.listen(port, env.HOST || '0.0.0.0', () => {
  console.log(`Velaris Bulut çalışıyor → ${env.VK_CLOUD_URL || `http://localhost:${port}`} (ödeme: ${cloud.provider.name})`);
});
const shutdown = () => { server.close(); cloud.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
