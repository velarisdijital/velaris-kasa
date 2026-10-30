// Tarayıcıda tek başına çalışan demo derlemesi: sunucu kodu sql.js ile tarayıcıda çalışır.
//   npx vite build --config vite.demo.config.js   →   dist-demo/
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const shim = (f) => fileURLToPath(new URL(`./web/src/demo/shims/${f}`, import.meta.url));

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify(true) },
  resolve: {
    alias: [
      { find: /^express$/, replacement: shim('express.js') },
      { find: /^better-sqlite3$/, replacement: shim('better-sqlite3.js') },
      { find: /^node:crypto$/, replacement: shim('crypto.js') },
      { find: /^node:(fs|path|os|url)$/, replacement: shim('node.js') },
    ],
  },
  build: { outDir: '../dist-demo', emptyOutDir: true, chunkSizeWarningLimit: 4000, rollupOptions: { output: { codeSplitting: false } } },
});
