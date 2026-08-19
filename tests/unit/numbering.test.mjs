/** Invoice numbering — the rules that must never hand out a duplicate. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  escapeLikePattern, financialYearLabel, formatInvoiceNo,
  sequenceFromInvoiceNo, seriesPrefix,
} = await import('../../dist-electron/shared/numbering.js');

test('the financial year turns over on 1 April, not 1 January', () => {
  assert.equal(financialYearLabel('2025-03-31'), '24-25');
  assert.equal(financialYearLabel('2025-04-01'), '25-26');
  assert.equal(financialYearLabel('2025-12-31'), '25-26');
  assert.equal(financialYearLabel('2026-01-01'), '25-26');
  assert.equal(financialYearLabel('2026-03-31'), '25-26');
  assert.equal(financialYearLabel('2026-04-01'), '26-27');
});

test('the year label pads across a century boundary', () => {
  assert.equal(financialYearLabel('2099-04-01'), '99-00');
  assert.equal(financialYearLabel('2100-04-01'), '00-01');
});

test('an unparseable date falls back to today rather than producing NaN-NaN', () => {
  assert.match(financialYearLabel('not-a-date'), /^\d{2}-\d{2}$/);
  assert.match(financialYearLabel(''), /^\d{2}-\d{2}$/);
});

test('the series prefix reflects the numbering mode', () => {
  assert.equal(seriesPrefix('PJ', true, '2025-06-01'), 'PJ/25-26/');
  assert.equal(seriesPrefix('PJ', false, '2025-06-01'), 'PJ-');
  assert.equal(seriesPrefix('  ', true, '2025-06-01'), 'PJ/25-26/', 'blank prefix falls back');
});

test('LIKE wildcards in a shop-chosen prefix are escaped, not treated as patterns', () => {
  // A prefix of "PJ_" would otherwise match PJA, PJB... and scan the wrong series.
  assert.equal(escapeLikePattern('PJ_'), 'PJ\\_');
  assert.equal(escapeLikePattern('50%'), '50\\%');
  assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');
  assert.equal(escapeLikePattern('PJ/25-26/'), 'PJ/25-26/');
});

test('a sequence is read only off a number in this exact series', () => {
  assert.equal(sequenceFromInvoiceNo('PJ/25-26/0007', 'PJ/25-26/'), 7);
  assert.equal(sequenceFromInvoiceNo('PJ/25-26/9999', 'PJ/25-26/'), 9999);
  assert.equal(sequenceFromInvoiceNo('PJ/24-25/0007', 'PJ/25-26/'), null, 'other year');
  assert.equal(sequenceFromInvoiceNo('XX/25-26/0007', 'PJ/25-26/'), null, 'other prefix');
  assert.equal(sequenceFromInvoiceNo('PJ/25-26/0007-A', 'PJ/25-26/'), null, 'manual override');
  assert.equal(sequenceFromInvoiceNo('PJ/25-26/', 'PJ/25-26/'), null, 'no sequence at all');
});

test('numbers are zero padded to four digits and grow beyond', () => {
  assert.equal(formatInvoiceNo('PJ/25-26/', 1), 'PJ/25-26/0001');
  assert.equal(formatInvoiceNo('PJ/25-26/', 9999), 'PJ/25-26/9999');
  assert.equal(formatInvoiceNo('PJ/25-26/', 10000), 'PJ/25-26/10000');
});
