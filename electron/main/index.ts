import path from 'node:path';
import { BrowserWindow, app, shell } from 'electron';
import { closeDb, getDb } from './db/connection';
import { getSettings } from './db/settings';
import { registerIpcHandlers } from './ipc';
import { buildMenu } from './menu';
import { autoBackupToFolder } from './services/backup';
import { disposeRenderWindow } from './services/documents';

// Date inputs and number formatting follow the Chromium locale, so pin it to
// India: dates read dd/mm/yyyy and amounts group as 1,23,456.
app.commandLine.appendSwitch('lang', 'en-IN');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:5273';

let mainWindow: BrowserWindow | null = null;

// One till, one window: a second instance would fight over the same SQLite file
// and could hand out duplicate invoice numbers.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow(): void {
  const { shop } = getSettings();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: shop.theme === 'dark' ? '#14100f' : '#ffffff',
    title: 'Prem Jewellers — Billing',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // the preload needs `require` for the IPC bridge
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // Paint only once the UI is ready, so startup never shows a white flash.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links belong in the customer's browser, never inside the till app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const allowed = isDev ? target.origin === DEV_SERVER_URL : target.protocol === 'file:';
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  buildMenu(mainWindow);

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../../dist/index.html'));
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void app.whenReady().then(() => {
  // Opening the database before the first window means the billing screen has
  // its invoice number ready the moment it paints.
  getDb();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  autoBackupToFolder();
  disposeRenderWindow();
  closeDb();
});
