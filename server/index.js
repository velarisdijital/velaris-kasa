import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4848);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.VELARIS_DATA_DIR || path.join(__dirname, '..', 'data');

const { app, close } = createApp({ dataDir });
const server = app.listen(port, host, () => {
  console.log(`Velaris Kasa çalışıyor → http://localhost:${port}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Ağdaki diğer kasalar için → http://${a.address}:${port}`);
    }
  }
  console.log(`  Veri klasörü: ${dataDir}`);
});

const shutdown = () => { server.close(); close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
