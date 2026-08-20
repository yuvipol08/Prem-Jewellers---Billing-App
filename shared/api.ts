import type {
  AppSettings,
  BackupManifest,
  CloudStatus,
  Customer,
  DashboardSummary,
  Invoice,
  InvoiceFilter,
  InvoiceListRow,
  OperationResult,
} from './types';

export interface SaveInvoiceResult {
  id: number;
  invoiceNo: string;
}

export interface PdfResult {
  filePath: string;
}

export interface PrinterChoice {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export interface PrinterList {
  printers: PrinterChoice[];
  /** Preselected printer, and why — so the UI can explain its choice. */
  selected: string;
  reason: string;
  systemDefault: string;
}

export interface PrintRequest {
  copyLabel?: string;
  /** OS printer name. Omit to use the system default. */
  deviceName?: string;
  copies?: number;
  /** Opens the OS print dialog instead of printing straight to the printer. */
  useSystemDialog?: boolean;
}

export interface PrintOutcome {
  printed: boolean;
  cancelled: boolean;
  deviceName: string;
}

export interface EmergencyBackupReport {
  uploadedInvoices: number;
  uploadedCustomers: number;
  verified: boolean;
  /** Firestore document id of the uploaded archive, for locating it later. */
  archiveId: string;
  clearedLocalData: boolean;
}

/** The full surface exposed to the renderer through the context bridge. */
export interface BillingApi {
  app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<NodeJS.Platform>;
    getDataPath(): Promise<string>;
  };
  settings: {
    get(): Promise<AppSettings>;
    save(settings: AppSettings): Promise<OperationResult>;
  };
  customers: {
    list(search?: string, limit?: number): Promise<Customer[]>;
    get(id: number): Promise<Customer | null>;
    save(customer: Customer): Promise<OperationResult<Customer>>;
    remove(id: number): Promise<OperationResult>;
    history(id: number): Promise<InvoiceListRow[]>;
  };
  invoices: {
    nextNumber(): Promise<string>;
    list(filter: InvoiceFilter): Promise<InvoiceListRow[]>;
    get(id: number): Promise<Invoice | null>;
    save(invoice: Invoice): Promise<OperationResult<SaveInvoiceResult>>;
    cancel(id: number): Promise<OperationResult>;
    remove(id: number): Promise<OperationResult>;
    duplicate(id: number): Promise<OperationResult<Invoice>>;
    canEdit(id: number): Promise<boolean>;
  };
  documents: {
    previewHtml(invoice: Invoice, copyLabel?: string): Promise<string>;
    exportPdf(invoice: Invoice, copyLabel?: string): Promise<OperationResult<PdfResult>>;
    saveAsPdf(invoice: Invoice, copyLabel?: string): Promise<OperationResult<PdfResult>>;
    listPrinters(): Promise<PrinterList>;
    print(invoice: Invoice, request?: PrintRequest): Promise<OperationResult<PrintOutcome>>;
    openFile(filePath: string): Promise<OperationResult>;
    revealFile(filePath: string): Promise<OperationResult>;
  };
  whatsapp: {
    share(invoice: Invoice): Promise<OperationResult<{ mode: 'cloud-api' | 'deep-link' }>>;
  };
  dashboard: {
    summary(): Promise<DashboardSummary>;
  };
  backup: {
    exportLocal(): Promise<OperationResult<{ filePath: string; manifest: BackupManifest }>>;
    importLocal(): Promise<OperationResult<{ invoices: number; customers: number }>>;
    chooseFolder(): Promise<OperationResult<{ folder: string }>>;
    cloudStatus(): Promise<CloudStatus>;
    cloudBackup(): Promise<OperationResult<{ invoices: number; customers: number }>>;
    cloudRestore(): Promise<OperationResult<{ invoices: number; customers: number }>>;
    testCloud(): Promise<OperationResult>;
    emergency(confirmation: string): Promise<OperationResult<EmergencyBackupReport>>;
  };
  on(channel: 'menu-action', listener: (action: string) => void): () => void;
}

/** IPC channel names, kept in one place so main and preload cannot drift. */
export const IPC = {
  appVersion: 'app:version',
  appPlatform: 'app:platform',
  appDataPath: 'app:data-path',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  customersList: 'customers:list',
  customersGet: 'customers:get',
  customersSave: 'customers:save',
  customersRemove: 'customers:remove',
  customersHistory: 'customers:history',
  invoicesNextNumber: 'invoices:next-number',
  invoicesList: 'invoices:list',
  invoicesGet: 'invoices:get',
  invoicesSave: 'invoices:save',
  invoicesCancel: 'invoices:cancel',
  invoicesRemove: 'invoices:remove',
  invoicesDuplicate: 'invoices:duplicate',
  invoicesCanEdit: 'invoices:can-edit',
  docsPreviewHtml: 'docs:preview-html',
  docsExportPdf: 'docs:export-pdf',
  docsSaveAsPdf: 'docs:save-as-pdf',
  docsPrint: 'docs:print',
  docsListPrinters: 'docs:list-printers',
  docsOpenFile: 'docs:open-file',
  docsRevealFile: 'docs:reveal-file',
  whatsappShare: 'whatsapp:share',
  dashboardSummary: 'dashboard:summary',
  backupExportLocal: 'backup:export-local',
  backupImportLocal: 'backup:import-local',
  backupChooseFolder: 'backup:choose-folder',
  backupCloudStatus: 'backup:cloud-status',
  backupCloudBackup: 'backup:cloud-backup',
  backupCloudRestore: 'backup:cloud-restore',
  backupTestCloud: 'backup:test-cloud',
  backupEmergency: 'backup:emergency',
  menuAction: 'menu-action',
} as const;

/** Typing this exact phrase is what arms the emergency wipe. */
export const EMERGENCY_CONFIRMATION_PHRASE = 'BACKUP AND CLEAR';
