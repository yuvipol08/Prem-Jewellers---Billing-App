/** WhatsApp number handling and message templating. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { buildMessage, normaliseMobile } = await import('../../dist-electron/shared/whatsapp.js');

test('Indian mobile numbers normalise from every form a shop types', () => {
  assert.equal(normaliseMobile('9876543210', '91'), '919876543210');
  assert.equal(normaliseMobile('98765 43210', '91'), '919876543210');
  assert.equal(normaliseMobile('+91 98765 43210', '91'), '919876543210');
  assert.equal(normaliseMobile('+91-9876543210', '91'), '919876543210');
  assert.equal(normaliseMobile('09876543210', '91'), '919876543210', 'leading STD zero');
  assert.equal(normaliseMobile('919876543210', '91'), '919876543210', 'already prefixed');
  assert.equal(normaliseMobile('(98765) 43210', '91'), '919876543210');
});

test('an empty or junk number yields empty rather than a bogus recipient', () => {
  assert.equal(normaliseMobile('', '91'), '');
  assert.equal(normaliseMobile('   ', '91'), '');
  assert.equal(normaliseMobile('abc', '91'), '');
});

test('a blank country code falls back to India', () => {
  assert.equal(normaliseMobile('9876543210', ''), '919876543210');
});

test('a non-Indian country code is respected', () => {
  assert.equal(normaliseMobile('5551234567', '1'), '15551234567');
});

const invoice = {
  invoiceNo: 'PJ/25-26/0007', invoiceDate: '2025-06-14', customerId: null,
  customerName: 'Ramesh Patil', customerMobile: '9876543210', customerAddress: '',
  customerPan: '', customerGstin: '', customerStateCode: '27', intraState: true,
  items: [{ hsnCode: '7113', particulars: 'Chain', grossWeight: 10, netWeight: 10,
    rate: 6000, makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3 }],
  discount: 0, paymentMode: 'Cash', paymentReference: '', amountPaid: 0,
  notes: '', status: 'saved',
};

test('every template token is substituted with the real value', () => {
  const message = buildMessage(
    invoice,
    'Namaste {customerName}, {shopName} invoice {invoiceNo} dated {invoiceDate} for {grandTotal}.',
    'Prem Jewellers',
  );
  assert.equal(message,
    'Namaste Ramesh Patil, Prem Jewellers invoice PJ/25-26/0007 dated 2025-06-14 for ₹61,800.00.');
  assert.ok(!message.includes('{'), 'no token left unreplaced');
});

test('a repeated token is replaced everywhere it appears', () => {
  assert.equal(buildMessage(invoice, '{invoiceNo} / {invoiceNo}', 'X'),
    'PJ/25-26/0007 / PJ/25-26/0007');
});

test('a walk-in with no name still gets a readable greeting', () => {
  const message = buildMessage({ ...invoice, customerName: '  ' }, 'Hello {customerName}', 'X');
  assert.equal(message, 'Hello Customer');
});

test('a template with no tokens passes through untouched', () => {
  assert.equal(buildMessage(invoice, 'Your bill is ready.', 'X'), 'Your bill is ready.');
});
