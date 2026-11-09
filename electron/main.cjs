// VelarisKasa masaüstü uygulaması.
// Sunucuyu aynı süreçte başlatır ve yerel ağa açar; böylece bu bilgisayar "ana kasa" olur,
// dükkândaki diğer tablet/telefon/bilgisayarlar tarayıcıdan http://<bu-pc-ip>:4848 adresine bağlanabilir.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PORT = Number(process.env.PORT || 4848);
let win;
let server;
let port = PORT;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${port}`);
}

async function startServer() {
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'app.js')).href);
  const { app: express, close } = createApp({
    dataDir: path.join(app.getPath('userData'), 'data'),
    staticDir: path.join(__dirname, '..', 'dist'),
  });
  await new Promise((resolve) => {
    server = express.listen(PORT, '0.0.0.0', resolve);
    server.on('error', (e) => {
      if (e.code !== 'EADDRINUSE') throw e;
      // Port doluysa (ör. başka bir kopya) rastgele bir porta geç
      server = express.listen(0, '0.0.0.0', resolve);
    });
  });
  port = server.address().port;
  app.on('before-quit', () => { server.close(); close(); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'VelarisKasa',
    backgroundColor: '#F2EFEA',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  win.loadURL(`http://localhost:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Müşteri ekranı: ikinci monitör varsa orada tam ekran açılır
    if (url.startsWith(`http://localhost:${port}/`) && url.includes('#/musteri-ekrani')) {
      const { screen } = require('electron');
      const primary = screen.getPrimaryDisplay();
      const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
      const b = (other || primary).bounds;
      return { action: 'allow', overrideBrowserWindowOptions: {
        x: b.x + 40, y: b.y + 40, width: 1024, height: 700, fullscreen: !!other, autoHideMenuBar: true,
        title: 'Müşteri ekranı', backgroundColor: '#121212', icon: path.join(__dirname, 'icon.png'),
      } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'VelarisKasa',
      submenu: [
        { label: 'Ağ adresleri (diğer kasalar için)', click: () => dialog.showMessageBox(win, {
          type: 'info',
          title: 'Ağ adresleri',
          message: 'Aynı ağdaki tablet, telefon veya bilgisayarlardan tarayıcıyla şu adrese girin:',
          detail: lanAddresses().join('\n') || 'Ağ bağlantısı bulunamadı',
        }) },
        { label: 'Veri klasörünü aç', click: () => shell.openPath(path.join(app.getPath('userData'), 'data')) },
        { type: 'separator' },
        { role: 'reload', label: 'Yenile' },
        { role: 'togglefullscreen', label: 'Tam ekran' },
        { role: 'toggleDevTools', label: 'Geliştirici araçları' },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    { label: 'Düzen', submenu: [{ role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' }, { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { role: 'selectAll', label: 'Tümünü seç' }] },
    { label: 'Görünüm', submenu: [{ role: 'zoomIn', label: 'Büyüt' }, { role: 'zoomOut', label: 'Küçült' }, { role: 'resetZoom', label: 'Normal boyut' }] },
  ]));
}

// Fişi diyalog göstermeden varsayılan yazıcıya bas
require('electron').ipcMain.handle('velaris:print', (event) => new Promise((resolve) => {
  BrowserWindow.fromWebContents(event.sender).webContents.print({ silent: true, printBackground: false, margins: { marginType: 'none' } }, (ok, err) => resolve({ ok, err }));
}));

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('VelarisKasa başlatılamadı', String(e?.stack || e));
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
