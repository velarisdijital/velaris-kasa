#!/usr/bin/env node
// Velaris Kasa — Yazarkasa (YN ÖKC) köprüsü
//
// Velaris Kasa sunucusu ile yazarkasa arasında durur. Kasa, mali fiş için bu servise JSON gönderir;
// köprü, cihaz üreticisinin GMP-3 kütüphanesiyle fişi bastırır ve fiş/Z numarasını döner.
//
// Çalıştırma:
//   node bridge/okc-bridge.js                          → simülatör (cihaz olmadan test)
//   OKC_ADAPTER=command OKC_COMMAND="C:\\okc\\HuginGmp3.exe" node bridge/okc-bridge.js
//
// "command" adaptörü: her istekte OKC_COMMAND programını çalıştırır, isteği stdin'den JSON olarak verir,
// stdout'tan JSON yanıt bekler. Böylece üreticinin .NET/C++/Delphi DLL'ini saran küçük bir program
// (ör. C# ile 100-200 satır) Node koduna dokunmadan bağlanabilir.
//   İstek:  { "action": "receipt" | "refund" | "z-report" | "x-report" | "status", "data": { … } }
//   Yanıt:  { "ok": true, "fiscal_no": "0042", "z_no": "0153" }  ya da  { "ok": false, "error": "Kağıt bitti" }
//
// Ayrıntılar: docs/YAZARKASA_ENTEGRASYON.md

import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.OKC_BRIDGE_PORT || 4850);
const HOST = process.env.OKC_BRIDGE_HOST || '127.0.0.1';
const ADAPTER = process.env.OKC_ADAPTER || 'simulator';

const adapters = {
  simulator() {
    let fiscalNo = 0;
    let zNo = 1;
    return {
      async status() { return { ok: true, device: 'Simülatör', message: 'Hazır' }; },
      async receipt(d) {
        if (!d?.items?.length) throw new Error('Fişte ürün yok');
        const sum = d.items.reduce((a, i) => a + i.line_total, 0) - (d.discount || 0);
        if (sum !== d.total) throw new Error(`Toplam tutmuyor (${sum} ≠ ${d.total})`);
        fiscalNo += 1;
        console.log(`[simülatör] Fiş ${fiscalNo} · ${d.receipt_no} · ${(d.total / 100).toFixed(2)} TL · ${d.payments.map((p) => p.method).join('+')}`);
        return { ok: true, fiscal_no: String(fiscalNo).padStart(4, '0'), z_no: String(zNo).padStart(4, '0') };
      },
      async refund(d) { console.log(`[simülatör] İade ${d.receipt_no} ${(d.amount / 100).toFixed(2)} TL`); return { ok: true }; },
      async 'z-report'() { console.log(`[simülatör] Z raporu ${zNo}`); zNo += 1; fiscalNo = 0; return { ok: true, z_no: String(zNo - 1).padStart(4, '0') }; },
      async 'x-report'() { return { ok: true }; },
    };
  },

  command() {
    const cmd = process.env.OKC_COMMAND;
    if (!cmd) throw new Error('OKC_COMMAND tanımlı değil');
    const run = (action, data) => new Promise((resolve, reject) => {
      const p = spawn(cmd, [], { shell: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { p.kill(); reject(new Error('Cihaz programı zaman aşımına uğradı')); }, 90_000);
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { err += c; });
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(out)); } catch { reject(new Error(err.trim() || `Geçersiz yanıt: ${out.slice(0, 200)}`)); }
      });
      p.stdin.end(JSON.stringify({ action, data }));
    });
    return Object.fromEntries(['status', 'receipt', 'refund', 'z-report', 'x-report'].map((a) => [a, (d) => run(a, d)]));
  },
};

const device = adapters[ADAPTER]?.();
if (!device) {
  console.error(`Bilinmeyen adaptör: ${ADAPTER} (simulator | command)`);
  process.exit(1);
}

// Cihaz aynı anda tek iş yapabilir: istekler sıraya alınır
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

const ROUTES = { 'GET /status': 'status', 'POST /receipt': 'receipt', 'POST /refund': 'refund', 'POST /z-report': 'z-report', 'POST /x-report': 'x-report' };

http.createServer((req, res) => {
  const action = ROUTES[`${req.method} ${req.url}`];
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!action) return send(404, { ok: false, error: 'Bulunamadı' });
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    try {
      const data = raw ? JSON.parse(raw) : {};
      const result = await serial(() => device[action](data));
      send(result?.ok === false ? 502 : 200, { ok: true, ...result });
    } catch (e) {
      send(502, { ok: false, error: e.message });
    }
  });
}).listen(PORT, HOST, () => console.log(`Yazarkasa köprüsü (${ADAPTER}) → http://${HOST}:${PORT}`));
