// Tarayıcıda Android uygulamasını taklit eden sahte Capacitor köprüsü (yalnızca test içindir).
// Gerçek @capacitor/core bu köprüyü Android sanır; ClassicPrinter ve BluetoothLe eklentilerinin yerel tarafını taklit eder.
// Senaryo: Piranha 5510 eşleşmemiş, eşleşmeye açık; klasik adresi ve BLE adresi farklı.
(() => {
  const PRINTER_CLASSIC = 'DC:0D:30:AA:B3:33';
  const PRINTER_BLE = 'DC:0D:30:AA:B3:34';
  // Eşleşmeler gerçek tablette olduğu gibi uygulama yeniden açılınca da korunur
  const saved = JSON.parse(sessionStorage.getItem('fakeBonded') || 'null');
  const state = { bonded: saved || [{ address: '11:22:33:44:55:66', name: 'Galaxy Buds', type: 1 }, { address: '66:55:44:33:22:11', name: 'RPP02N', type: 1 }], calls: [], written: 0, writes: [], status: 4, files: {} };
  window.__fake = state;
  const listeners = {}; // "Plugin:event" -> [callback]
  let nextId = 1;
  const emit = (plugin, event, data) => (listeners[`${plugin}:${event}`] || []).forEach((cb) => cb(data));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const impl = {
    ClassicPrinter: {
      async bonded() { return { devices: state.bonded.slice() }; },
      async discover({ timeout = 12000 } = {}) {
        await wait(300);
        emit('ClassicPrinter', 'deviceFound', { address: '77:88:99:AA:BB:CC', name: '', type: 1, rssi: -80, bonded: false });
        emit('ClassicPrinter', 'deviceFound', { address: PRINTER_CLASSIC, name: '5510-B333', type: 3, rssi: -52, bonded: state.bonded.some((d) => d.address === PRINTER_CLASSIC) });
        await wait(Math.min(timeout, 1500));
        return { devices: [], locationOn: true };
      },
      async bond({ address }) {
        await wait(300);
        if (!state.bonded.some((d) => d.address === address)) state.bonded.push({ address, name: '5510-B333', type: 3 });
        sessionStorage.setItem('fakeBonded', JSON.stringify(state.bonded));
        return { bonded: true };
      },
      async openSettings() { state.settingsOpened = true; },
      async write({ address, data, chunk, delay }) {
        state.pacing = { chunk, delay };
        if (!state.bonded.some((d) => d.address === address)) throw new Error('read failed, socket might closed or timeout');
        const n = atob(data).length;
        state.written += n;
        state.writes.push({ address, bytes: n, head: atob(data).slice(0, 60), tail: atob(data).slice(-8), escpos: atob(data).startsWith('\x1b@'), raster: atob(data).includes('\x1dv0'), drawer: atob(data).includes('\x1bp'), prints: (atob(data).match(/PRINT 1,/g) || []).length });
        state.lastData = data;
        if (atob(data).includes('GAPDETECT')) state.status = 0;
        return { bytes: n };
      },
      // TSPL durum sorgusu: etiket algılanamıyor (0x04); GAPDETECT sonrası hazır (0x00)
      async transact({ data }) {
        const cmd = atob(data);
        if (cmd !== '\x1b!?') return { data: '', bytes: 0 };
        return { data: btoa(String.fromCharCode(state.status)), bytes: 1 };
      },
      async disconnect() {},
    },
    // Kasa modu ve sürüm (android/.../DevicePlugin.java)
    VKDevice: {
      async appInfo() { return { versionName: '1.0.14', versionCode: 14, android: '13', model: 'Test Tablet', nativeApi: 2 }; },
      async otaDownload({ url, build }) { state.otaUrl = url; return { path: `/data/fake/files/ota/${build}` }; },
      async otaConfirm() { state.otaConfirmed = (state.otaConfirmed || 0) + 1; },
      async otaReset() {},
      async installApk({ url }) { state.installedApk = url; },
      async keepAwake({ on }) { state.keepAwake = on; },
      async immersive({ on }) { state.immersive = on; },
      async pin() { state.pinned = true; },
      async unpin() { state.pinned = false; },
      async isPinned() { return { pinned: !!state.pinned }; },
      async openUrl({ url }) { state.openedUrl = url; },
    },
    // @capacitor/filesystem (bellekte)
    Filesystem: {
      async writeFile({ path, data, directory }) { state.files[`${directory}/${path}`] = { data, mtime: Date.now() }; return { uri: `file:///fake/${directory}/${path}` }; },
      async readFile({ path, directory }) {
        const f = state.files[`${directory}/${path}`];
        if (!f) throw new Error('File does not exist');
        return { data: f.data };
      },
      async readdir({ path, directory }) {
        const prefix = `${directory}/${path}/`;
        const files = Object.entries(state.files).filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .map(([k, f]) => ({ name: k.slice(prefix.length), type: 'file', size: atob(f.data).length, mtime: f.mtime, uri: `file:///fake/${k}` }));
        if (!files.length) throw new Error('Directory does not exist');
        return { files };
      },
      async deleteFile({ path, directory }) { delete state.files[`${directory}/${path}`]; },
      async getUri({ path, directory }) { return { uri: `file:///fake/${directory}/${path}` }; },
    },
    // @capacitor/core WebView (uygulama içi güncelleme: indirilen web paketine geçiş)
    WebView: {
      // Gerçekte WebView yeni klasörden yeniden yüklenir; burada sayfa yeniden yüklenir (aynı paket → tek deneme koruması)
      async setServerBasePath({ path }) { state.serverBasePath = path; sessionStorage.setItem('fakePersisted', path); setTimeout(() => location.reload(), 50); },
      async persistServerBasePath() { state.persisted = state.serverBasePath; },
      async getPersisted() { return { path: sessionStorage.getItem('fakePersisted') || '' }; },
      async getServerBasePath() { return { path: state.serverBasePath || '' }; },
    },
    Share: {
      async share(opts) { state.shared = opts; return {}; },
      async canShare() { return { value: true }; },
    },
    BluetoothLe: {
      async initialize() {},
      async isEnabled() { return { value: true }; },
      async requestLEScan() {
        setTimeout(() => emit('BluetoothLe', 'onScanResult', { device: { deviceId: PRINTER_BLE, name: '5510-B333-BLE' }, rssi: -50 }), 200);
        setTimeout(() => emit('BluetoothLe', 'onScanResult', { device: { deviceId: 'AA:AA:AA:AA:AA:01', name: 'Mi Band' }, rssi: -70 }), 300);
      },
      async stopLEScan() {},
      async getBondedDevices() { return { devices: [] }; },
      async connect() { throw new Error('Connection timeout'); },
      async disconnect() {},
    },
  };
  const headers = Object.entries(impl).map(([name, methods]) => ({
    name,
    methods: [
      ...Object.keys(methods).map((m) => ({ name: m, rtype: 'promise' })),
      { name: 'addListener', rtype: 'callback' },
      { name: 'removeListener', rtype: 'promise' },
      { name: 'removeAllListeners', rtype: 'promise' },
    ],
  }));

  window.androidBridge = { postMessage() {} };
  window.Capacitor = {
    PluginHeaders: headers,
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    nativeCallback(plugin, method, options, callback) {
      const id = String(nextId++);
      if (method === 'addListener') {
        const key = `${plugin}:${options.eventName}`;
        (listeners[key] = listeners[key] || []).push(callback);
        callback.__id = id;
      }
      return id;
    },
    async nativePromise(plugin, method, options) {
      state.calls.push(`${plugin}.${method}`);
      if (method === 'removeListener') {
        const key = `${plugin}:${options.eventName}`;
        listeners[key] = (listeners[key] || []).filter((cb) => cb.__id !== options.callbackId);
        return;
      }
      if (method === 'removeAllListeners') return;
      const fn = impl[plugin]?.[method];
      if (!fn) throw Object.assign(new Error(`${plugin}.${method} not implemented`), { code: 'UNIMPLEMENTED' });
      return fn(options || {});
    },
  };
})();
