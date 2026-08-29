const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSCBReceiptText, normalizeReceiptText } = require('../js/receipt-parser.js');

test('normalizes Thai digits from OCR', () => {
  assert.equal(normalizeReceiptText('วันที่ ๓๐/๐๖/๒๕๖๙'), 'วันที่ 30/06/2569');
});

test('parses inline English labels from SCB PDF', () => {
  const parsed = parseSCBReceiptText('(Date) 30/06/2026 (Principal) 18,883.47 (Interest) 716.53 (Principal) 1,849,208.57 (Total) 19,600.00');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fields, {
    date: '2026-06-30',
    principalPaid: 18883.47,
    balanceAfter: 1849208.57,
    interest: 716.53,
    amount: 19600
  });
});

test('parses batched PDF text ordering', () => {
  const parsed = parseSCBReceiptText('(Date) 25/06/2026 (Principal) (Interest) (Principal) (Interest) (Baht) 16,357.00 3,643.00 1,883,092.00 0.00 (Total) 20,000.00');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fields.principalPaid, 16357);
  assert.equal(parsed.fields.interest, 3643);
  assert.equal(parsed.fields.balanceAfter, 1883092);
  assert.equal(parsed.fields.amount, 20000);
});

test('parses Thai OCR text and converts Buddhist year', () => {
  const parsed = parseSCBReceiptText('วันที่ชำระ 30/06/2569 ยอดชำระรวม 19,600.00 เงินต้นที่ตัด 18,883.47 ดอกเบี้ย 716.53 ยอดเงินต้นคงเหลือหลังชำระ 1,849,208.57');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fields.date, '2026-06-30');
  assert.equal(parsed.fields.amount, 19600);
  assert.equal(parsed.fields.principalPaid, 18883.47);
  assert.equal(parsed.fields.interest, 716.53);
  assert.equal(parsed.fields.balanceAfter, 1849208.57);
});

test('derives missing total from principal and interest', () => {
  const parsed = parseSCBReceiptText('Date 30-06-2026 Principal paid 18,883.47 Interest 716.53 Outstanding balance 1,849,208.57');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.fields.amount, 19600);
  assert.ok(parsed.warnings.some(message => message.includes('คำนวณ')));
});
