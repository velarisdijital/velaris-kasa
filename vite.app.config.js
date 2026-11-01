// Android (APK) derlemesi: sunucu kodu cihazda sql.js ile çalışır, veriler tablette (IndexedDB) saklanır.
//   node scripts/build-app.mjs   →   dist-app/   (Capacitor bunu android/ projesine kopyalar)
import demo from './vite.demo.config.js';

export default {
  ...demo,
  define: { ...demo.define, 'import.meta.env.VITE_APP': JSON.stringify(true) },
  build: { ...demo.build, outDir: '../dist-app' },
};
