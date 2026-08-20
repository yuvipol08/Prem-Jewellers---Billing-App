/** Which printer a bill goes to — the rules that stopped OneNote being picked. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { isVirtualPrinter, orderPrinters, parseWindowsDefaultPrinter, selectPrinter } =
  await import('../../dist-electron/shared/printers.js');

const printer = (name, isDefault = false) => ({
  name, displayName: name, description: '', isDefault,
});

test('virtual printers are recognised by name', () => {
  for (const name of [
    'OneNote for Windows 10', 'OneNote (Desktop)', 'Microsoft Print to PDF',
    'Microsoft XPS Document Writer', 'Fax', 'Adobe PDF', 'CutePDF Writer',
    'Send To OneNote 2016', 'Foxit PDF Printer',
  ]) {
    assert.equal(isVirtualPrinter({ name }), true, `should be virtual: ${name}`);
  }
});

test('real printers are not mistaken for virtual ones', () => {
  for (const name of [
    'Brother HL-2270DW', 'HP LaserJet Pro M404', 'EPSON L3150 Series',
    'Canon LBP2900B', 'TVS MSP 250 Star',
  ]) {
    assert.equal(isVirtualPrinter({ name }), false, `should be physical: ${name}`);
  }
});

test('the shop\'s remembered printer wins over everything else', () => {
  const result = selectPrinter({
    printers: [printer('OneNote for Windows 10'), printer('Brother HL-2270DW'), printer('HP LaserJet', true)],
    remembered: 'Brother HL-2270DW',
    systemDefault: 'HP LaserJet',
  });
  assert.equal(result.name, 'Brother HL-2270DW');
  assert.equal(result.reason, 'remembered');
});

test('a remembered printer that has been unplugged is not used', () => {
  const result = selectPrinter({
    printers: [printer('OneNote for Windows 10'), printer('HP LaserJet')],
    remembered: 'Brother HL-2270DW',
  });
  assert.notEqual(result.name, 'Brother HL-2270DW');
  assert.equal(result.name, 'HP LaserJet', 'should fall through to a real printer');
});

test('the Windows default is used when nothing is remembered', () => {
  const result = selectPrinter({
    printers: [printer('OneNote for Windows 10'), printer('Brother HL-2270DW')],
    systemDefault: 'Brother HL-2270DW',
  });
  assert.equal(result.name, 'Brother HL-2270DW');
  assert.equal(result.reason, 'system-default');
});

test('the OS default flag is honoured when the registry says nothing', () => {
  const result = selectPrinter({
    printers: [printer('OneNote for Windows 10'), printer('Canon LBP2900B', true)],
  });
  assert.equal(result.name, 'Canon LBP2900B');
  assert.equal(result.reason, 'system-default');
});

test('a real printer is preferred over a virtual one when guessing', () => {
  // This is the regression: without it, selection fell to printers[0] — OneNote.
  const result = selectPrinter({
    printers: [
      printer('OneNote for Windows 10'),
      printer('Microsoft Print to PDF'),
      printer('Fax'),
      printer('EPSON L3150 Series'),
    ],
  });
  assert.equal(result.name, 'EPSON L3150 Series');
  assert.equal(result.reason, 'first-physical');
});

test('a virtual printer is only ever chosen when it is all there is', () => {
  const result = selectPrinter({
    printers: [printer('OneNote for Windows 10'), printer('Microsoft Print to PDF')],
  });
  assert.equal(result.reason, 'first-available');
});

test('no printers means no selection, not a crash', () => {
  assert.deepEqual(selectPrinter({ printers: [] }), { name: '', reason: 'none' });
});

test('the dropdown lists real printers first, default before the rest', () => {
  const ordered = orderPrinters([
    printer('OneNote for Windows 10'),
    printer('Zebra ZD220'),
    printer('Microsoft Print to PDF'),
    printer('HP LaserJet Pro M404', true),
  ]).map((p) => p.name);

  assert.equal(ordered[0], 'HP LaserJet Pro M404', 'default physical printer first');
  assert.equal(ordered[1], 'Zebra ZD220', 'other physical printers next');
  assert.ok(ordered.slice(2).every((n) => /onenote|print to pdf/i.test(n)), 'virtual printers last');
});

test('the Windows registry value is parsed down to the printer name', () => {
  assert.equal(
    parseWindowsDefaultPrinter('    Device    REG_SZ    Brother HL-2270DW,winspool,Ne01:'),
    'Brother HL-2270DW',
  );
  assert.equal(
    parseWindowsDefaultPrinter('Device REG_SZ OneNote for Windows 10,winspool,nul:'),
    'OneNote for Windows 10',
  );
  assert.equal(parseWindowsDefaultPrinter('nothing useful here'), '');
  assert.equal(parseWindowsDefaultPrinter(''), '');
});
