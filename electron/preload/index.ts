import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/api';
import type { BillingApi } from '../../shared/api';

/**
 * The only bridge between the renderer and Node. Node integration is off and
 * context isolation is on, so the UI can reach exactly these calls and nothing
 * else — no fs, no child_process, no arbitrary IPC.
 */
const api: BillingApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.appVersion),
    getPlatform: () => ipcRenderer.invoke(IPC.appPlatform),
    getDataPath: () => ipcRenderer.invoke(IPC.appDataPath),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  },
  customers: {
    list: (search = '', limit = 100) => ipcRenderer.invoke(IPC.customersList, search, limit),
    get: (id) => ipcRenderer.invoke(IPC.customersGet, id),
    save: (customer) => ipcRenderer.invoke(IPC.customersSave, customer),
    remove: (id) => ipcRenderer.invoke(IPC.customersRemove, id),
    history: (id) => ipcRenderer.invoke(IPC.customersHistory, id),
  },
  invoices: {
    nextNumber: () => ipcRenderer.invoke(IPC.invoicesNextNumber),
    list: (filter) => ipcRenderer.invoke(IPC.invoicesList, filter),
    get: (id) => ipcRenderer.invoke(IPC.invoicesGet, id),
    save: (invoice) => ipcRenderer.invoke(IPC.invoicesSave, invoice),
    cancel: (id) => ipcRenderer.invoke(IPC.invoicesCancel, id),
    remove: (id) => ipcRenderer.invoke(IPC.invoicesRemove, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.invoicesDuplicate, id),
    canEdit: (id) => ipcRenderer.invoke(IPC.invoicesCanEdit, id),
  },
  documents: {
    previewHtml: (invoice, copyLabel) =>
      ipcRenderer.invoke(IPC.docsPreviewHtml, invoice, copyLabel),
    exportPdf: (invoice, copyLabel) => ipcRenderer.invoke(IPC.docsExportPdf, invoice, copyLabel),
    saveAsPdf: (invoice, copyLabel) => ipcRenderer.invoke(IPC.docsSaveAsPdf, invoice, copyLabel),
    listPrinters: () => ipcRenderer.invoke(IPC.docsListPrinters),
    print: (invoice, request) => ipcRenderer.invoke(IPC.docsPrint, invoice, request),
    openFile: (filePath) => ipcRenderer.invoke(IPC.docsOpenFile, filePath),
    revealFile: (filePath) => ipcRenderer.invoke(IPC.docsRevealFile, filePath),
  },
  whatsapp: {
    share: (invoice) => ipcRenderer.invoke(IPC.whatsappShare, invoice),
  },
  dashboard: {
    summary: () => ipcRenderer.invoke(IPC.dashboardSummary),
  },
  backup: {
    exportLocal: () => ipcRenderer.invoke(IPC.backupExportLocal),
    importLocal: () => ipcRenderer.invoke(IPC.backupImportLocal),
    chooseFolder: () => ipcRenderer.invoke(IPC.backupChooseFolder),
    cloudStatus: () => ipcRenderer.invoke(IPC.backupCloudStatus),
    cloudBackup: () => ipcRenderer.invoke(IPC.backupCloudBackup),
    cloudRestore: () => ipcRenderer.invoke(IPC.backupCloudRestore),
    testCloud: () => ipcRenderer.invoke(IPC.backupTestCloud),
    emergency: (confirmation) => ipcRenderer.invoke(IPC.backupEmergency, confirmation),
  },
  on: (channel, listener) => {
    if (channel !== 'menu-action') return () => undefined;
    const handler = (_event: unknown, action: string) => listener(action);
    ipcRenderer.on(IPC.menuAction, handler);
    return () => ipcRenderer.removeListener(IPC.menuAction, handler);
  },
};

contextBridge.exposeInMainWorld('billing', api);
