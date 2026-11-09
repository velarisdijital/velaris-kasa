// Android (APK) derlemesi: sunucu kodu cihazda sql.js ile çalışır, veriler tablette (IndexedDB) saklanır.
//   node scripts/build-app.mjs   →   dist-app/   (Capacitor bunu android/ projesine kopyalar)
import demo from './vite.demo.config.js';

export default {
  ...demo,
  // VITE_WEB_BUILD: CI derleme numarası (uygulama içi güncelleme bunu GitHub'daki son sürümle karşılaştırır)
  define: { ...demo.define, 'import.meta.env.VITE_APP': JSON.stringify(true), 'import.meta.env.VITE_WEB_BUILD': JSON.stringify(process.env.VK_BUILD_NUMBER || '0') },
  build: { ...demo.build, outDir: '../dist-app' },
};
