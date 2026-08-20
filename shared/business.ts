/**
 * Locked business identity for Prem Jewellers, Jalgaon.
 *
 * This software is built for one shop. Everything that identifies the business
 * on a tax invoice lives here and is NOT editable from Settings — a GSTIN or
 * shop name changed by accident at the counter would make every subsequent
 * invoice non-compliant, and there is no reason for it to be editable when the
 * software serves a single business.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TO UPDATE THESE VALUES: edit this file, then run `npm run build`.
 * They are deliberately not reachable from the running application.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Fields marked PENDING are awaiting the final details from the shop. They are
 * safe to ship as-is (they render as blank rather than wrong), but the invoice
 * is not GST-compliant until at least GSTIN and the address are filled in.
 * `missingBusinessDetails()` reports which are still outstanding, and the app
 * surfaces that as a banner so it cannot be forgotten.
 */

export interface BusinessIdentity {
  readonly shopName: string;
  readonly tagline: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly stateName: string;
  readonly stateCode: string;
  readonly pincode: string;
  readonly phonePrimary: string;
  readonly phoneSecondary: string;
  readonly email: string;
  readonly gstin: string;
  readonly pan: string;
  readonly bankName: string;
  readonly bankAccount: string;
  readonly bankIfsc: string;
  readonly upiId: string;
  readonly invoiceHeading: string;
  readonly termsAndConditions: string;
  readonly declaration: string;
  readonly signatureLabel: string;
  readonly footerNote: string;
}

export const BUSINESS: BusinessIdentity = {
  shopName: 'Prem Jewellers',
  tagline: 'Gold · Silver · Diamond',

  // PENDING — final address from the shop
  addressLine1: '',
  addressLine2: '',
  city: 'Jalgaon',
  stateName: 'Maharashtra',
  stateCode: '27',
  pincode: '',

  // PENDING — final contact details from the shop
  phonePrimary: '',
  phoneSecondary: '',
  email: '',

  // PENDING — statutory identifiers from the registration certificate
  gstin: '',
  pan: '',

  // PENDING — bank details as they should appear on the bill
  bankName: '',
  bankAccount: '',
  bankIfsc: '',
  upiId: '',

  invoiceHeading: 'TAX INVOICE',
  termsAndConditions:
    'Goods once sold will not be taken back.\nSubject to Jalgaon jurisdiction.\nRates are subject to market fluctuation.',
  declaration:
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  signatureLabel: 'Authorised Signatory',
  footerNote: 'This is a computer generated invoice.',
};

/** Fields that must be filled before the invoice is GST-compliant. */
const REQUIRED_FOR_COMPLIANCE: (keyof BusinessIdentity)[] = [
  'addressLine1',
  'pincode',
  'phonePrimary',
  'gstin',
  'pan',
];

const FIELD_LABELS: Partial<Record<keyof BusinessIdentity, string>> = {
  addressLine1: 'Address',
  pincode: 'PIN code',
  phonePrimary: 'Phone number',
  gstin: 'GSTIN',
  pan: 'PAN',
  bankName: 'Bank name',
  bankAccount: 'Bank account number',
  bankIfsc: 'IFSC code',
  upiId: 'UPI ID',
};

/** Human-readable names of the locked fields still awaiting real values. */
export function missingBusinessDetails(): string[] {
  return REQUIRED_FOR_COMPLIANCE.filter((key) => !String(BUSINESS[key]).trim()).map(
    (key) => FIELD_LABELS[key] ?? key,
  );
}

export function isBusinessConfigured(): boolean {
  return missingBusinessDetails().length === 0;
}

/** The company that built and maintains this software. Never shown on an invoice. */
export const DEVELOPER = {
  name: 'TridentCrew',
  mobile: '9096310817',
  email: 'contact@tridentcrew.com',
  credit: 'Developed by TridentCrew',
} as const;
