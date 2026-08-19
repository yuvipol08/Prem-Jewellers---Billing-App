import type { AppSettings, Invoice, InvoiceItem, ShopSettings } from './types';

/**
 * Ships with Prem Jewellers' own details pre-filled. Everything here is
 * editable from Settings — the printed bill is driven entirely by these values,
 * so the layout can be matched to the existing bill book without code changes.
 */
export const DEFAULT_SHOP: ShopSettings = {
  shopName: 'Prem Jewellers',
  tagline: 'Gold · Silver · Diamond',
  addressLine1: 'Main Road',
  addressLine2: '',
  city: 'Jalgaon',
  stateName: 'Maharashtra',
  stateCode: '27',
  pincode: '425001',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  bankName: '',
  bankAccount: '',
  bankIfsc: '',
  upiId: '',
  invoicePrefix: 'PJ',
  invoiceStartNumber: 1,
  resetNumberYearly: true,
  defaultGstRate: 3,
  defaultHsnCode: '7113',
  defaultMakingChargeMode: 'flat',
  termsAndConditions:
    'Goods once sold will not be taken back.\nSubject to Jalgaon jurisdiction.\nRates are subject to market fluctuation.',
  declaration:
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  signatureLabel: 'Authorised Signatory',
  theme: 'light',
  autoBackupOnExit: false,
  localBackupFolder: '',
};

export const DEFAULT_SETTINGS: AppSettings = {
  shop: DEFAULT_SHOP,
  firebase: {
    projectId: '',
    apiKey: '',
    email: '',
    password: '',
    namespace: 'prem-jewellers',
    enabled: false,
  },
  whatsapp: {
    useCloudApi: false,
    phoneNumberId: '',
    accessToken: '',
    defaultCountryCode: '91',
    messageTemplate:
      'Namaste {customerName}, thank you for shopping with {shopName}. Your invoice {invoiceNo} dated {invoiceDate} for {grandTotal} is attached.',
  },
};

export function createEmptyItem(shop: ShopSettings = DEFAULT_SHOP): InvoiceItem {
  return {
    hsnCode: shop.defaultHsnCode,
    particulars: '',
    grossWeight: 0,
    netWeight: 0,
    rate: 0,
    makingChargeMode: shop.defaultMakingChargeMode,
    makingChargeValue: 0,
    gstRate: shop.defaultGstRate,
  };
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function createEmptyInvoice(invoiceNo: string, shop: ShopSettings = DEFAULT_SHOP): Invoice {
  return {
    invoiceNo,
    invoiceDate: todayIso(),
    customerId: null,
    customerName: '',
    customerMobile: '',
    customerAddress: '',
    customerPan: '',
    customerGstin: '',
    customerStateCode: shop.stateCode,
    intraState: true,
    items: [createEmptyItem(shop), createEmptyItem(shop), createEmptyItem(shop)],
    discount: 0,
    paymentMode: 'Cash',
    paymentReference: '',
    amountPaid: 0,
    notes: '',
    status: 'saved',
  };
}

/** Indian GST state codes, used for the place-of-supply picker. */
export const STATE_CODES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

/** HSN codes a jewellery shop actually bills against. */
export const COMMON_HSN: { code: string; label: string }[] = [
  { code: '7113', label: 'Gold / Silver jewellery' },
  { code: '7114', label: 'Articles of goldsmiths / silversmiths' },
  { code: '7108', label: 'Gold (unwrought / semi-manufactured)' },
  { code: '7106', label: 'Silver (unwrought / semi-manufactured)' },
  { code: '7102', label: 'Diamonds' },
  { code: '7103', label: 'Precious / semi-precious stones' },
  { code: '7117', label: 'Imitation jewellery' },
];
