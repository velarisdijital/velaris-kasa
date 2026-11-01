// Tarayıcıda Android uygulamasını taklit eden sahte Capacitor köprüsü (yalnızca test içindir).
// Gerçek @capacitor/core bu köprüyü Android sanır; ClassicPrinter ve BluetoothLe eklentilerinin yerel tarafını taklit eder.
// Senaryo: Piranha 5510 eşleşmemiş, eşleşmeye açık; klasik adresi ve BLE adresi farklı.
(() => {
  const PRINTER_CLASSIC = 'DC:0D:30:AA:B3:33';
  const PRINTER_BLE = 'DC:0D:30:AA:B3:34';
  // Eşleşmeler gerçek tablette olduğu gibi uygulama yeniden açılınca da korunur
  const saved = JSON.parse(sessionStorage.getItem('fakeBonded') || 'null');
  const state = { bonded: saved || [{ address: '11:22:33:44:55:66', name: 'Galaxy Buds', type: 1 }], calls: [], written: 0, writes: [] };
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
      async write({ address, data }) {
        if (!state.bonded.some((d) => d.address === address)) throw new Error('read failed, socket might closed or timeout');
        const n = atob(data).length;
        state.written += n;
        state.writes.push({ address, bytes: n, head: atob(data).slice(0, 60), prints: (atob(data).match(/PRINT 1,/g) || []).length });
        state.lastData = data;
        return { bytes: n };
      },
      async disconnect() {},
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
