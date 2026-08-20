/**
 * Builds the printable A4 invoice as a standalone HTML document.
 *
 * This one function backs all three outputs — the on-screen print preview, the
 * PDF export and the physical print — so what the shop sees is always exactly
 * what comes out of the printer. Everything is inline: no fonts, scripts or
 * images are fetched, which keeps rendering instant and fully offline.
 */

import { formatCurrency, formatWeight, round2 } from './calc';
import { INVOICE_FONT_FACES, INVOICE_SANS_STACK, INVOICE_SERIF_STACK } from './fonts';
import type { ComputedInvoice, ShopSettings } from './types';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${parsed.getFullYear()}`;
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

export interface InvoiceRenderOptions {
  /** Blank rows keep the ruled look of the bill book on short invoices (default 10). */
  minimumRows?: number;
  /** Prints a DUPLICATE / OFFICE COPY banner across the header. */
  copyLabel?: string;
  /** Screen preview adds a page shadow; print/PDF must not. */
  screenPreview?: boolean;
}

const PRINT_CSS = `
  ${INVOICE_FONT_FACES}
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1a1a1a;
    font-family: ${INVOICE_SANS_STACK};
    font-size: 10.3pt;
    font-variant-numeric: tabular-nums lining-nums;
    font-feature-settings: 'tnum' 1, 'lnum' 1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 210mm;
    min-height: 296mm;
    padding: 8mm 8mm 6mm;
    margin: 0 auto;
    background: #ffffff;
    display: flex;
    flex-direction: column;
  }
  .sheet.preview {
    box-shadow: 0 2px 18px rgba(0, 0, 0, 0.16);
    margin: 12px auto;
  }
  .frame {
    border: 1.4pt solid #9b1b1b;
    padding: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .head {
    text-align: center;
    padding: 3.5mm 5mm 2.5mm;
    border-bottom: 1pt solid #9b1b1b;
    position: relative;
  }
  .shop-name {
    font-family: ${INVOICE_SERIF_STACK};
    font-size: 27pt;
    font-weight: 600;
    letter-spacing: 0.3pt;
    color: #9b1b1b;
    line-height: 1.02;
  }
  .tagline {
    font-size: 8pt;
    font-weight: 500;
    letter-spacing: 3.4pt;
    text-transform: uppercase;
    color: #8a7433;
    margin-top: 1.2mm;
  }
  .shop-address { font-size: 9.5pt; margin-top: 1.5mm; line-height: 1.4; }
  .shop-ids { font-size: 9.5pt; margin-top: 1.2mm; font-weight: 600; }
  .shop-ids span { margin: 0 3mm; }
  .copy-label {
    position: absolute;
    top: 3mm;
    right: 4mm;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 1pt;
    color: #9b1b1b;
    border: 0.8pt solid #9b1b1b;
    border-radius: 2mm;
    padding: 0.8mm 2.5mm;
    text-transform: uppercase;
  }
  .title-bar {
    background: #9b1b1b;
    color: #ffffff;
    text-align: center;
    font-size: 10pt;
    font-weight: 600;
    letter-spacing: 4.5pt;
    padding: 1.4mm 0;
  }
  .parties { display: flex; border-bottom: 1pt solid #9b1b1b; }
  .party {
    flex: 1;
    padding: 2.2mm 3.5mm;
    font-size: 9.6pt;
    line-height: 1.45;
  }
  .party.left { border-right: 1pt solid #9b1b1b; }
  .party-heading {
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 1.2pt;
    text-transform: uppercase;
    color: #9b1b1b;
    margin-bottom: 1mm;
  }
  .field { display: flex; gap: 2mm; }
  .field-label { min-width: 22mm; color: #55524d; }
  .field-value { font-weight: 600; flex: 1; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.8pt;
  }
  table.items th {
    background: #f6ecec;
    border-bottom: 1pt solid #9b1b1b;
    border-right: 0.6pt solid #d8bcbc;
    padding: 1.5mm 1.5mm;
    font-size: 7.8pt;
    font-weight: 700;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    color: #6d1414;
  }
  table.items td {
    border-right: 0.6pt solid #e2d3d3;
    border-bottom: 0.4pt solid #f0e6e6;
    padding: 1.2mm 1.5mm;
    height: 6mm;
    vertical-align: top;
  }
  table.items th:last-child, table.items td:last-child { border-right: none; }
  .col-sr { width: 9mm; text-align: center; }
  .col-hsn { width: 17mm; text-align: center; }
  .col-particulars { text-align: left; }
  .col-num { width: 20mm; text-align: right; font-variant-numeric: tabular-nums; }
  .col-amount {
    width: 25mm; text-align: right; font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .item-name { font-weight: 600; letter-spacing: -0.05pt; }
  .item-note { font-size: 8.4pt; color: #6b6b6b; }
  tr.filler td { height: 6mm; }
  tfoot.item-total td {
    border-top: 1pt solid #9b1b1b;
    font-weight: 700;
    background: #faf5f5;
    padding: 1.5mm 1.5mm;
  }
  .summary { display: flex; border-top: 1pt solid #9b1b1b; }
  .summary-left {
    flex: 1;
    border-right: 1pt solid #9b1b1b;
    padding: 2.2mm 3.5mm;
    font-size: 8.8pt;
    line-height: 1.45;
  }
  .summary-right { width: 78mm; padding: 2mm 3.5mm; font-size: 9.8pt; }
  .words { margin-bottom: 2mm; }
  .words-label {
    font-size: 8.2pt;
    letter-spacing: 1pt;
    text-transform: uppercase;
    color: #9b1b1b;
    font-weight: 700;
  }
  .words-value { font-weight: 600; font-size: 9.4pt; line-height: 1.4; }
  .bank-block { margin-top: 1.5mm; font-size: 8.6pt; color: #3d3d3d; line-height: 1.4; }
  .bank-block b { color: #1a1a1a; }
  .terms { margin-top: 1.5mm; font-size: 8pt; color: #5a5a5a; line-height: 1.4; }
  .sum-row { display: flex; justify-content: space-between; padding: 0.8mm 0; }
  .sum-row.divider { border-top: 0.6pt solid #dcc9c9; margin-top: 1mm; padding-top: 1.6mm; }
  .sum-label { color: #4a4a4a; }
  .sum-value { font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.1pt; }
  .grand {
    display: flex;
    justify-content: space-between;
    margin-top: 1.5mm;
    background: #9b1b1b;
    color: #ffffff;
    padding: 2mm 3mm;
    border-radius: 1mm;
    font-size: 12.5pt;
    font-weight: 700;
    letter-spacing: 0.2pt;
    font-variant-numeric: tabular-nums;
  }
  .pay-line {
    margin-top: 2mm;
    font-size: 9pt;
    display: flex;
    justify-content: space-between;
  }
  .signs { display: flex; border-top: 1pt solid #9b1b1b; margin-top: auto; }
  .sign {
    flex: 1;
    padding: 2.2mm 3.5mm 2.5mm;
    font-size: 8.8pt;
    text-align: center;
  }
  .sign.left { border-right: 1pt solid #9b1b1b; text-align: left; }
  .sign-space { height: 10mm; }
  .sign-label { font-weight: 600; }
  .declaration { font-size: 8.2pt; color: #5a5a5a; line-height: 1.4; text-align: left; }
  .foot-note {
    text-align: center;
    font-size: 8pt;
    color: #8a8a8a;
    padding-top: 1.5mm;
  }
  @page { size: A4 portrait; margin: 0; }
  @media print {
    html, body { width: 210mm; }
    .sheet { margin: 0; box-shadow: none; page-break-after: avoid; }
    .no-print { display: none !important; }
  }
`;

export function renderInvoiceHtml(
  invoice: ComputedInvoice,
  shop: ShopSettings,
  options: InvoiceRenderOptions = {},
): string {
  // Ten ruled rows fill the page like the bill book while still keeping bills of
  // up to nine lines on a single A4 sheet; longer bills flow to a second page.
  const minimumRows = options.minimumRows ?? 10;
  const { totals } = invoice;

  const itemRows = invoice.items
    .map((item, index) => {
      const makingNote =
        item.makingChargeMode === 'per_gram'
          ? `${formatCurrency(item.makingChargeValue, false)}/gm`
          : item.makingChargeMode === 'percent'
            ? `${item.makingChargeValue}%`
            : '';
      return `
        <tr>
          <td class="col-sr">${index + 1}</td>
          <td class="col-hsn">${escapeHtml(item.hsnCode)}</td>
          <td class="col-particulars">
            <div class="item-name">${escapeHtml(item.particulars)}</div>
            ${makingNote ? `<div class="item-note">Making @ ${escapeHtml(makingNote)}</div>` : ''}
          </td>
          <td class="col-num">${formatWeight(item.grossWeight)}</td>
          <td class="col-num">${formatWeight(item.netWeight)}</td>
          <td class="col-num">${item.rate ? formatCurrency(item.rate, false) : ''}</td>
          <td class="col-num">${item.makingCharge ? formatCurrency(item.makingCharge, false) : ''}</td>
          <td class="col-amount">${formatCurrency(item.amount, false)}</td>
        </tr>`;
    })
    .join('');

  const fillerCount = Math.max(0, minimumRows - invoice.items.length);
  const fillerRows = Array.from({ length: fillerCount })
    .map(
      () => `
        <tr class="filler">
          <td class="col-sr"></td><td class="col-hsn"></td><td class="col-particulars"></td>
          <td class="col-num"></td><td class="col-num"></td><td class="col-num"></td>
          <td class="col-num"></td><td class="col-amount"></td>
        </tr>`,
    )
    .join('');

  const gstRows = invoice.intraState
    ? `
      <div class="sum-row"><span class="sum-label">CGST</span><span class="sum-value">${formatCurrency(totals.cgst, false)}</span></div>
      <div class="sum-row"><span class="sum-label">SGST</span><span class="sum-value">${formatCurrency(totals.sgst, false)}</span></div>`
    : `<div class="sum-row"><span class="sum-label">IGST</span><span class="sum-value">${formatCurrency(totals.igst, false)}</span></div>`;

  const discountRow =
    totals.discount > 0
      ? `<div class="sum-row"><span class="sum-label">Less: Discount</span><span class="sum-value">- ${formatCurrency(totals.discount, false)}</span></div>`
      : '';

  const roundOffRow =
    round2(totals.roundOff) !== 0
      ? `<div class="sum-row"><span class="sum-label">Round Off</span><span class="sum-value">${totals.roundOff > 0 ? '+ ' : '- '}${formatCurrency(Math.abs(totals.roundOff), false)}</span></div>`
      : '';

  const balanceRow =
    totals.balance > 0 && invoice.amountPaid > 0
      ? `<div class="pay-line"><span>Paid: <b>${formatCurrency(invoice.amountPaid)}</b></span><span>Balance: <b>${formatCurrency(totals.balance)}</b></span></div>`
      : '';

  const addressLines = [shop.addressLine1, shop.addressLine2, `${shop.city} ${shop.pincode}`.trim()]
    .filter((line) => line && line.trim().length > 0)
    .map(escapeHtml)
    .join('<br />');

  const bankBlock =
    shop.bankName || shop.upiId
      ? `<div class="bank-block">
           ${shop.bankName ? `<div><b>Bank:</b> ${escapeHtml(shop.bankName)} &nbsp; <b>A/c:</b> ${escapeHtml(shop.bankAccount)} &nbsp; <b>IFSC:</b> ${escapeHtml(shop.bankIfsc)}</div>` : ''}
           ${shop.upiId ? `<div><b>UPI:</b> ${escapeHtml(shop.upiId)}</div>` : ''}
         </div>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.invoiceNo)} — ${escapeHtml(shop.shopName)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="sheet${options.screenPreview ? ' preview' : ''}">
  <div class="frame">
    <div class="head">
      ${options.copyLabel ? `<div class="copy-label">${escapeHtml(options.copyLabel)}</div>` : ''}
      <div class="shop-name">${escapeHtml(shop.shopName)}</div>
      ${shop.tagline ? `<div class="tagline">${escapeHtml(shop.tagline)}</div>` : ''}
      <div class="shop-address">
        ${addressLines}
        ${shop.phone ? `<br />Mob: ${escapeHtml(shop.phone)}` : ''}${shop.email ? ` &nbsp;|&nbsp; ${escapeHtml(shop.email)}` : ''}
      </div>
      <div class="shop-ids">
        ${shop.gstin ? `<span>GSTIN: ${escapeHtml(shop.gstin)}</span>` : ''}
        ${shop.pan ? `<span>PAN: ${escapeHtml(shop.pan)}</span>` : ''}
        ${shop.stateName ? `<span>State: ${escapeHtml(shop.stateName)} (${escapeHtml(shop.stateCode)})</span>` : ''}
      </div>
    </div>

    <div class="title-bar">${escapeHtml(shop.invoiceHeading ?? 'TAX INVOICE')}</div>

    <div class="parties">
      <div class="party left">
        <div class="party-heading">Billed To</div>
        <div class="field"><span class="field-label">Name</span><span class="field-value">${escapeHtml(invoice.customerName) || '—'}</span></div>
        <div class="field"><span class="field-label">Address</span><span class="field-value">${multiline(invoice.customerAddress) || '—'}</span></div>
        <div class="field"><span class="field-label">Mobile</span><span class="field-value">${escapeHtml(invoice.customerMobile) || '—'}</span></div>
        <div class="field"><span class="field-label">PAN</span><span class="field-value">${escapeHtml(invoice.customerPan) || '—'}</span></div>
        <div class="field"><span class="field-label">GSTIN</span><span class="field-value">${escapeHtml(invoice.customerGstin) || '—'}</span></div>
      </div>
      <div class="party">
        <div class="party-heading">Invoice Details</div>
        <div class="field"><span class="field-label">Invoice No</span><span class="field-value">${escapeHtml(invoice.invoiceNo)}</span></div>
        <div class="field"><span class="field-label">Date</span><span class="field-value">${escapeHtml(formatDate(invoice.invoiceDate))}</span></div>
        <div class="field"><span class="field-label">Payment</span><span class="field-value">${escapeHtml(invoice.paymentMode)}${invoice.paymentReference ? ` — ${escapeHtml(invoice.paymentReference)}` : ''}</span></div>
        <div class="field"><span class="field-label">Place of Supply</span><span class="field-value">${escapeHtml(invoice.customerStateCode || shop.stateCode)}</span></div>
        <div class="field"><span class="field-label">Supply Type</span><span class="field-value">${invoice.intraState ? 'Intra-State' : 'Inter-State'}</span></div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="col-sr">Sr</th>
          <th class="col-hsn">HSN</th>
          <th class="col-particulars">Particulars</th>
          <th class="col-num">Gross Wt<br />(gm)</th>
          <th class="col-num">Net Wt<br />(gm)</th>
          <th class="col-num">Rate<br />(₹/gm)</th>
          <th class="col-num">Making<br />(₹)</th>
          <th class="col-amount">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${fillerRows}
      </tbody>
      <tfoot class="item-total">
        <tr>
          <td class="col-sr"></td>
          <td class="col-hsn"></td>
          <td class="col-particulars">Total</td>
          <td class="col-num">${formatWeight(totals.totalGrossWeight)}</td>
          <td class="col-num">${formatWeight(totals.totalNetWeight)}</td>
          <td class="col-num"></td>
          <td class="col-num">${formatCurrency(totals.totalMakingCharges, false)}</td>
          <td class="col-amount">${formatCurrency(totals.taxableBeforeDiscount, false)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="summary">
      <div class="summary-left">
        <div class="words">
          <div class="words-label">Amount in Words</div>
          <div class="words-value">${escapeHtml(invoice.amountInWords)}</div>
        </div>
        ${bankBlock}
        ${shop.termsAndConditions ? `<div class="terms"><b>Terms:</b><br />${multiline(shop.termsAndConditions)}</div>` : ''}
      </div>
      <div class="summary-right">
        <div class="sum-row"><span class="sum-label">Taxable Value</span><span class="sum-value">${formatCurrency(totals.taxableBeforeDiscount, false)}</span></div>
        ${discountRow}
        <div class="sum-row divider"><span class="sum-label">Net Taxable</span><span class="sum-value">${formatCurrency(totals.taxableValue, false)}</span></div>
        ${gstRows}
        ${roundOffRow}
        <div class="grand"><span>GRAND TOTAL</span><span>${formatCurrency(totals.grandTotal)}</span></div>
        ${balanceRow}
      </div>
    </div>

    <div class="signs">
      <div class="sign left">
        <div class="declaration">${multiline(shop.declaration)}</div>
        <div class="sign-space"></div>
        <div class="sign-label">Customer's Signature</div>
      </div>
      <div class="sign">
        <div>For <b>${escapeHtml(shop.shopName)}</b></div>
        <div class="sign-space"></div>
        <div class="sign-label">${escapeHtml(shop.signatureLabel) || 'Authorised Signatory'}</div>
      </div>
    </div>
  </div>
  <div class="foot-note">${escapeHtml(shop.footerNote ?? '')}</div>
</div>
</body>
</html>`;
}
