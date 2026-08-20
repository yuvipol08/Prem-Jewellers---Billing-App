/**
 * Domain types shared by the Electron main process and the React renderer.
 * Everything money-related is stored as a plain number in rupees; weights are
 * in grams. Rounding is applied only at the points the printed bill shows it.
 */

export type MakingChargeMode = 'flat' | 'per_gram' | 'percent';

export type PaymentMode = 'Cash' | 'Cheque' | 'Online';

export type InvoiceStatus = 'saved' | 'cancelled';

export interface InvoiceItem {
  id?: number;
  hsnCode: string;
  particulars: string;
  /** Weight including stones/beads, in grams. */
  grossWeight: number;
  /** Chargeable metal weight, in grams. */
  netWeight: number;
  /** Rate per gram in rupees. */
  rate: number;
  makingChargeMode: MakingChargeMode;
  /** Raw making-charge input, interpreted according to makingChargeMode. */
  makingChargeValue: number;
  /** GST percentage applied to this line (3% for gold jewellery). */
  gstRate: number;
}

/** A line with every derived money figure resolved. */
export interface ComputedInvoiceItem extends InvoiceItem {
  metalValue: number;
  makingCharge: number;
  amount: number;
}

export interface Customer {
  id?: number;
  name: string;
  mobile: string;
  address: string;
  pan: string;
  gstin: string;
  /** Two-digit GST state code, used to decide CGST+SGST vs IGST. */
  stateCode: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoiceTotals {
  taxableBeforeDiscount: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalBeforeRounding: number;
  roundOff: number;
  grandTotal: number;
  totalGrossWeight: number;
  totalNetWeight: number;
  totalMakingCharges: number;
  balance: number;
}

export interface Invoice {
  id?: number;
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  customerId: number | null;
  customerName: string;
  customerMobile: string;
  customerAddress: string;
  customerPan: string;
  customerGstin: string;
  customerStateCode: string;
  /** true => CGST + SGST, false => IGST. */
  intraState: boolean;
  items: InvoiceItem[];
  discount: number;
  paymentMode: PaymentMode;
  paymentReference: string;
  amountPaid: number;
  notes: string;
  status: InvoiceStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** An invoice plus its resolved money figures — what printing and PDFs consume. */
export interface ComputedInvoice extends Omit<Invoice, 'items'> {
  items: ComputedInvoiceItem[];
  totals: InvoiceTotals;
  amountInWords: string;
}

export interface ShopSettings {
  shopName: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateName: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  upiId: string;
  invoicePrefix: string;
  invoiceStartNumber: number;
  /** Reset the running number every financial year (1 April – 31 March). */
  resetNumberYearly: boolean;
  defaultGstRate: number;
  defaultHsnCode: string;
  defaultMakingChargeMode: MakingChargeMode;
  /** Printer the shop chose. Remembered so billing is one click. Editable. */
  defaultPrinter: string;
  /** Heading printed in the red band, e.g. "TAX INVOICE". Locked. */
  invoiceHeading: string;
  termsAndConditions: string;
  declaration: string;
  signatureLabel: string;
  /** Small line under the sheet, e.g. "This is a computer generated invoice." Locked. */
  footerNote: string;
  theme: 'light' | 'dark';
  autoBackupOnExit: boolean;
  localBackupFolder: string;
}

export interface FirebaseSettings {
  projectId: string;
  apiKey: string;
  email: string;
  password: string;
  /** Collection prefix so several shops can share one Firebase project. */
  namespace: string;
  enabled: boolean;
}

export interface WhatsAppSettings {
  /** Cloud API sends the PDF directly; without it we fall back to wa.me links. */
  useCloudApi: boolean;
  phoneNumberId: string;
  accessToken: string;
  defaultCountryCode: string;
  messageTemplate: string;
}

export interface AppSettings {
  shop: ShopSettings;
  firebase: FirebaseSettings;
  whatsapp: WhatsAppSettings;
}

export interface InvoiceFilter {
  search?: string;
  fromDate?: string;
  toDate?: string;
  customerId?: number | null;
  paymentMode?: PaymentMode | null;
  limit?: number;
  offset?: number;
}

export interface InvoiceListRow {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerMobile: string;
  grandTotal: number;
  paymentMode: PaymentMode;
  status: InvoiceStatus;
  itemCount: number;
}

export interface DashboardSummary {
  todaySales: number;
  todayInvoiceCount: number;
  monthSales: number;
  monthInvoiceCount: number;
  yearSales: number;
  totalCustomers: number;
  totalInvoices: number;
  totalNetWeightThisMonth: number;
  recentInvoices: InvoiceListRow[];
  salesByDay: { date: string; total: number }[];
}

export interface CloudStatus {
  configured: boolean;
  lastBackupAt: string | null;
  lastSyncAt: string | null;
  pendingChanges: number;
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  shopName: string;
  invoiceCount: number;
  customerCount: number;
  checksum: string;
}

export interface OperationResult<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
}
