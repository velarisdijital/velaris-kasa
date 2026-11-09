import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { getSetting, openDatabase, setSettings } from './db.js';
import { importDatabase } from './importDb.js';
import { startIntegrationWorker } from './integrations/velaris.js';
import { startNotifyWorker } from './notify.js';
import appointmentRoutes from './routes/appointments.js';
import { publicRoutes, sessionRoutes } from './routes/auth.js';
import bookingRoutes from './routes/booking.js';
import qrMenuRoutes from './routes/qrmenu.js';
import platformRoutes, { platformWebhook } from './routes/platforms.js';
import { startPlatformWorker } from './integrations/platforms.js';
import branchRoutes from './routes/branches.js';
import customerRoutes from './routes/customers.js';
import notifyRoutes from './routes/notify.js';
import productRoutes from './routes/products.js';
import tableRoutes from './routes/tables.js';
import kitchenRoutes from './routes/kitchen.js';
import promotionRoutes from './routes/promotions.js';
import inventoryRoutes from './routes/inventory.js';
import deliveryRoutes from './routes/deliveries.js';
import purchaseRoutes from './routes/purchases.js';
import reportRoutes from './routes/reports.js';
import saleRoutes from './routes/sales.js';
import settingsRoutes, { inboundWebhook } from './routes/settings.js';
import shiftRoutes from './routes/shifts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Sunucuyu oluşturur. Hem komut satırından (server/index.js) hem Electron'dan kullanılır.
 * @param {{ dataDir: string, staticDir?: string, worker?: boolean }} opts
 */
export function createApp({ dataDir, staticDir = path.join(__dirname, '..', 'dist'), worker = true }) {
  const db = openDatabase(dataDir);
  if (!getSetting(db, 'install_id')) setSettings(db, { install_id: crypto.randomUUID() });

  const app = express();
  app.disable('x-powered-by');
  // Ters vekil (Caddy/Nginx) arkasında gerçek istemci IP'si için
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');
  app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  const api = express.Router();
  // Tablet uygulaması (https://localhost) ve ağdaki diğer cihazlar sunucuya doğrudan bağlanabilsin.
  // Kimlik doğrulama çerez değil Bearer anahtarıyla yapıldığından her kaynağa izin vermek güvenlidir.
  api.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-VK-Signature');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Private-Network', 'true');
      res.set('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
    next();
  });
  // Tabletteki verileri boş (kurulumu yapılmamış) sunucuya taşı
  api.post('/setup/import', express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res, next) => {
    try {
      if (getSetting(db, 'setup_done') === '1') return res.status(409).json({ error: 'Bu sunucuda zaten veri var. Taşıma yalnızca yeni kurulmuş sunucuya yapılabilir.' });
      const counts = importDatabase(db, req.body);
      res.json({ ok: true, products: counts.products || 0, sales: counts.sales || 0, customers: counts.customers || 0 });
    } catch (e) { next(e); }
  });
  api.get('/health', (req, res) => res.json({ ok: true, app: 'velaris-kasa', version: process.env.npm_package_version || '1.0.0' }));
  api.use(publicRoutes(db));
  api.use(inboundWebhook(db));
  api.use(bookingRoutes(db));
  api.use(qrMenuRoutes(db));
  api.use(platformWebhook(db));
  api.use(authenticate(db));
  api.use(sessionRoutes(db));
  api.use(productRoutes(db));
  api.use(branchRoutes(db));
  api.use(purchaseRoutes(db));
  api.use(tableRoutes(db));
  api.use(kitchenRoutes(db));
  api.use(promotionRoutes(db));
  api.use(inventoryRoutes(db));
  api.use(deliveryRoutes(db));
  api.use(platformRoutes(db));
  api.use(customerRoutes(db));
  api.use(shiftRoutes(db));
  api.use(saleRoutes(db));
  api.use(appointmentRoutes(db));
  api.use(reportRoutes(db));
  api.use(notifyRoutes(db));
  api.use(settingsRoutes(db));
  api.use((req, res) => res.status(404).json({ error: 'Bulunamadı' }));
  api.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    if (String(err.message).includes('UNIQUE constraint failed: products.barcode')) {
      return res.status(409).json({ error: 'Bu barkod başka bir üründe kayıtlı' });
    }
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Sunucu hatası', ...(err.code ? { code: err.code, required_plan: err.required_plan } : {}) });
  });

  // /api/v1 = harici entegrasyonlar (Velaris CRM) için kararlı adres
  app.use('/api/v1', api);
  app.use('/api', api);

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const stops = worker ? [startIntegrationWorker(db), startNotifyWorker(db), startPlatformWorker(db)] : [];
  return { app, db, close: () => { stops.forEach((s) => s()); db.close(); } };
}


