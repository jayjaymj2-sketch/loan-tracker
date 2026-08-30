const test = require('node:test');
const assert = require('node:assert/strict');
const Analytics = require('../js/loan-analytics.js');

const payments = [
  { id:'a', date:'2025-08-10', amount:20000, interest:4000, principalPaid:16000, balanceAfter:2000000 },
  { id:'b', date:'2026-07-23', amount:20000, interest:3200, principalPaid:16800, balanceAfter:1900000 },
  { id:'c', date:'2026-07-23', amount:15000, interest:0, principalPaid:15000, balanceAfter:1885000, source:'receipt-upload' },
  { id:'d', date:'2026-08-26', amount:20000, interest:3500, principalPaid:16500, balanceAfter:1868500 },
  { id:'e', date:'2026-08-26', amount:15000, interest:0, principalPaid:15000, balanceAfter:1853500 }
];

test('history order preserves newest insertion first for same-day payments', () => {
  const ordered = Analytics.orderPaymentEntries(payments).map(entry => entry.payment.id);
  assert.deepEqual(ordered, ['e','d','c','b','a']);
});

test('monthly summary combines multiple payments in the same month', () => {
  const summary = Analytics.summarizeMonth(payments, '2026-08-30', 48417);
  assert.equal(summary.paid, 35000);
  assert.equal(summary.principal, 31500);
  assert.equal(summary.interest, 3500);
  assert.equal(summary.count, 2);
  assert.ok(summary.pct > 72 && summary.pct < 73);
});

test('twelve-month series includes empty calendar months in order', () => {
  const series = Analytics.buildMonthlySeries(payments, '2026-08-30', 12);
  assert.equal(series.length, 12);
  assert.equal(series[0].key, '2025-09');
  assert.equal(series.at(-1).key, '2026-08');
  assert.equal(series.at(-1).amount, 35000);
});

test('monthly average uses the latest twelve months that have payments', () => {
  const stats = Analytics.getMonthlyPaymentStats(payments, 12);
  assert.deepEqual(stats.allMonthKeys, ['2025-08','2026-07','2026-08']);
  assert.equal(stats.average, 30000);
});

test('annual interest summary uses certified years and actual later payments', () => {
  const certified = [{year:2025,amount:90000,source:'certificate'}];
  const summary = Analytics.buildAnnualInterestSummary(certified,payments,2025,value=>value);
  assert.equal(summary.length, 2);
  assert.equal(summary[1].year, 2026);
  assert.equal(summary[1].amount, 6700);
  assert.equal(summary[1].paymentCount, 4);
  assert.equal(summary[1].lastPaymentDate, '2026-08-26');
});

test('year-to-date comparison uses the same cutoff in the previous year', () => {
  const comparison = Analytics.compareInterestYTD(payments, 2026, '2026-08-26');
  assert.equal(comparison.currentAmount, 6700);
  assert.equal(comparison.previousAmount, 4000);
  assert.equal(comparison.delta, 2700);
  assert.ok(comparison.projected > comparison.currentAmount);
});

test('history filters find extra-principal and receipt payments', () => {
  const entries = Analytics.orderPaymentEntries(payments).map(entry=>({
    ...entry,
    payment:{...entry.payment,searchText:entry.payment.date==='2026-08-26'?'26 ส.ค. 2569':''}
  }));
  assert.deepEqual(Analytics.filterPaymentEntries(entries,{type:'extra'},[]).map(entry=>entry.payment.id),['e','c']);
  assert.deepEqual(Analytics.filterPaymentEntries(entries,{type:'receipt'},[]).map(entry=>entry.payment.id),['c']);
  assert.deepEqual(Analytics.filterPaymentEntries(entries,{query:'15000'},[]).map(entry=>entry.payment.id),['e','c']);
  assert.deepEqual(Analytics.filterPaymentEntries(entries,{query:'26 ส.ค. 2569'},[]).map(entry=>entry.payment.id),['e','d']);
});

test('fixed-rate payoff rejects payments below monthly interest', () => {
  const impossible = Analytics.projectPayoffFixedRate(1000000,1000,0.12);
  assert.equal(impossible.finite,false);
  const possible = Analytics.projectPayoffFixedRate(1000000,50000,0.03);
  assert.equal(possible.finite,true);
  assert.ok(possible.months > 20 && possible.months < 24);
  assert.ok(possible.totalInterest > 0);
});
