import { BrowserWindow, Menu, app, shell } from 'electron';
import { IPC } from '../../shared/api';

/**
 * A deliberately short menu. Everything here is also a keyboard shortcut in the
 * billing screen; the menu exists so the shortcuts are discoverable and so macOS
 * gets the standard app menu it expects.
 */
export function buildMenu(window: BrowserWindow): void {
  const send = (action: string) => () => {
    if (!window.isDestroyed()) window.webContents.send(IPC.menuAction, action);
  };

  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: send('open-settings') },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '&Billing',
      submenu: [
        { label: 'New Invoice', accelerator: 'F2', click: send('new-invoice') },
        { label: 'Save Invoice', accelerator: 'CmdOrCtrl+S', click: send('save-invoice') },
        { label: 'Print Preview', accelerator: 'CmdOrCtrl+Shift+P', click: send('preview-invoice') },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: send('print-invoice') },
        { label: 'Export PDF', accelerator: 'CmdOrCtrl+E', click: send('export-pdf') },
        { label: 'Share on WhatsApp', accelerator: 'CmdOrCtrl+W', click: send('share-whatsapp') },
        { type: 'separator' },
        ...(isMac ? [] : ([{ label: 'Settings', accelerator: 'Ctrl+,', click: send('open-settings') }] as Electron.MenuItemConstructorOptions[])),
        ...(isMac ? [] : ([{ role: 'quit' }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '&Go',
      submenu: [
        { label: 'Billing', accelerator: 'CmdOrCtrl+1', click: send('go-billing') },
        { label: 'Customers', accelerator: 'CmdOrCtrl+2', click: send('go-customers') },
        { label: 'Invoices', accelerator: 'CmdOrCtrl+3', click: send('go-invoices') },
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+4', click: send('go-dashboard') },
        { label: 'Backup & Settings', accelerator: 'CmdOrCtrl+5', click: send('go-settings') },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: send('show-shortcuts') },
        {
          label: 'Open Data Folder',
          click: () => {
            void shell.openPath(app.getPath('userData'));
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
