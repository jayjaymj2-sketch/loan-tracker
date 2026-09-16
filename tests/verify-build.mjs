import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('loan_tracker.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const backend = fs.readFileSync('apps-script/Code.gs', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
new Function(backend);

for(const asset of ['./styles.css', './js/receipt-parser.js', './js/sync-version.js', './js/loan-analytics.js', './js/receipt-store.js', './js/encrypted-backup.js', './js/app.js']){
  assert.ok(html.includes(asset), `loan_tracker.html must load ${asset}`);
  assert.ok(worker.includes(asset), `service-worker.js must cache ${asset}`);
}

assert.ok(backend.includes('LockService.getScriptLock()'), 'Apps Script must use ScriptLock');
assert.ok(backend.includes('expectedVersion'), 'Apps Script must validate expectedVersion');
assert.ok(backend.includes('validatePaymentAgainstLedger_'), 'Apps Script must validate payment arithmetic and continuity');
assert.ok(backend.includes("body.action === 'saveSettings'"), 'Apps Script must persist shared loan settings');
assert.ok(app.includes('accept="application/pdf,image/*"'), 'receipt input must accept images');
assert.ok(app.includes("const APPS_SCRIPT_URL = 'https://script.google.com/"), 'production Apps Script URL must be configured');
assert.ok(app.includes("{id:'overview',label:'ภาพรวม',icon:"), 'app must expose category navigation');
assert.ok(app.includes("fontSize:'normal'"), 'app must persist a font-size preference');
assert.ok(app.includes("setAppFontSize"), 'app must provide font-size controls');
assert.ok(app.includes("LoanAnalytics.orderPaymentEntries(state.payments).slice(0,5)"), 'overview payments must use the shared payment history order');
assert.ok(app.includes("buildLatestAnnualInterestCard"), 'overview must show the latest annual interest summary');
assert.ok(app.includes("buildPreviousMonthCard"), 'overview must show the previous completed month summary');
assert.ok(app.includes("buildCurrentMonthCard"), 'overview must also show the current month summary');
assert.ok(app.includes("LoanAnalytics.summarizePreviousMonth"), 'monthly summary must calculate the previous calendar month');
assert.ok(app.includes("buildPrincipalInterestChart"), 'overview must show the 12-month principal/interest chart');
assert.ok(app.includes("selectPrincipalInterestMonth"), 'principal/interest chart bars must open monthly details');
assert.ok(app.includes("buildPrintReportToolbar"), 'print reports must provide a way back to the app');
assert.ok(app.includes("buildHistoryFilterCard"), 'history must provide search and filters');
assert.ok(app.includes('const SEED_VERSION = 9'), 'seed version must refresh clients after correcting the November 2025 receipt split');
assert.ok(app.includes('{"date":"2025-10-31","amount":19600,"interest":437.83,"principalPaid":19162.17,"balanceAfter":2234833.43'), 'seed data must include the verified 31 October 2025 receipt');
assert.ok(app.includes('{"date":"2025-11-25","amount":20000,"interest":0,"principalPaid":20000.00,"balanceAfter":2200259.79'), 'seed data must include the corrected 25 November 2025 receipt split');
assert.ok(html.includes("./js/app.js?v=26"), 'HTML must request the updated app bundle without stale browser cache');
assert.ok(worker.includes("loan-tracker-cache-v26"), 'service worker cache must be bumped for the feature update');
assert.ok(worker.includes('self.skipWaiting()'), 'service worker updates must activate automatically');
assert.ok(!app.includes('showAppUpdateBanner'), 'app updates must not require an update-confirmation banner');
assert.ok(app.includes('ReceiptStore'), 'app must support local receipt attachment storage');
assert.ok(app.includes('LoanAnalytics'), 'app must use shared tested financial analytics');
assert.ok(app.includes('buildScenarioComparison'), 'app must compare three payoff scenarios');
assert.ok(app.includes('buildReconciliationPage'), 'app must provide bank reconciliation');
assert.ok(app.includes('buildTaxReportPage'), 'app must provide a joint-borrower tax report');
assert.ok(app.includes("const TAX_BORROWERS=['พ่อ','แม่','ลูก']"), 'tax report must label the borrowers as father, mother and child');
assert.ok(!app.includes('พ่อ แม่ และฉัน'), 'tax report must not use the former self label');
assert.ok(!app.includes('${buildReminderBanner(avgPayment)}'), 'overview must not show the monthly goal reminder banner');
assert.ok(app.includes('openReceiptBackupDialog'), 'app must provide encrypted receipt backup');
assert.ok(!html.includes('pdf.min.js'), 'PDF reader must not load during initial page load');
assert.ok(app.includes('PDFJS_SCRIPT_URL') && app.includes("loadScriptOnce(PDFJS_SCRIPT_URL,'pdfjsLib')"), 'PDF reader must load only when a PDF is selected');

console.log('Static build verification passed');
