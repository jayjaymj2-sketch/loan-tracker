const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source=fs.readFileSync('apps-script/Code.gs','utf8')+'\n;globalThis.backendTest={validatePaymentAgainstLedger_,validateLedger_};';
const context={console};
vm.createContext(context);
vm.runInContext(source,context);
const Backend=context.backendTest;

const previous={id:'a',date:'2026-07-26',amount:20000,interest:3000,principalPaid:17000,balanceAfter:1800000};

test('backend accepts a payment whose components and balance are continuous', () => {
  const payment={id:'b',date:'2026-08-26',amount:20000,interest:2500,principalPaid:17500,balanceAfter:1782500};
  assert.equal(Backend.validatePaymentAgainstLedger_(payment,[previous]).ok,true);
});

test('backend rejects principal plus interest mismatch', () => {
  const payment={id:'b',date:'2026-08-26',amount:20000,interest:2500,principalPaid:17000,balanceAfter:1783000};
  assert.equal(Backend.validatePaymentAgainstLedger_(payment,[previous]).code,'PAYMENT_SUM_MISMATCH');
});

test('backend rejects a discontinuous balance before saving', () => {
  const payment={id:'b',date:'2026-08-26',amount:20000,interest:2500,principalPaid:17500,balanceAfter:1700000};
  assert.equal(Backend.validatePaymentAgainstLedger_(payment,[previous]).code,'BALANCE_DISCONTINUITY');
});
