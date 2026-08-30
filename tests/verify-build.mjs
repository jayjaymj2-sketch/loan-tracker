import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('loan_tracker.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const backend = fs.readFileSync('apps-script/Code.gs', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
new Function(backend);

for(const asset of ['./styles.css', './js/receipt-parser.js', './js/sync-version.js', './js/loan-analytics.js', './js/receipt-store.js', './js/app.js']){
  assert.ok(html.includes(asset), `loan_tracker.html must load ${asset}`);
  assert.ok(worker.includes(asset), `service-worker.js must cache ${asset}`);
}

assert.ok(backend.includes('LockService.getScriptLock()'), 'Apps Script must use ScriptLock');
assert.ok(backend.includes('expectedVersion'), 'Apps Script must validate expectedVersion');
assert.ok(app.includes('accept="application/pdf,image/*"'), 'receipt input must accept images');
assert.ok(app.includes("const APPS_SCRIPT_URL = 'https://script.google.com/"), 'production Apps Script URL must be configured');
assert.ok(app.includes("{id:'overview',label:'ภาพรวม'}"), 'app must expose category navigation');
assert.ok(app.includes("fontSize:'normal'"), 'app must persist a font-size preference');
assert.ok(app.includes("setAppFontSize"), 'app must provide font-size controls');
assert.ok(app.includes("LoanAnalytics.orderPaymentEntries(state.payments).slice(0,5)"), 'overview payments must use the shared payment history order');
assert.ok(app.includes("buildLatestAnnualInterestCard"), 'overview must show the latest annual interest summary');
assert.ok(app.includes("buildCurrentMonthCard"), 'overview must show the current month summary');
assert.ok(app.includes("buildPrincipalInterestChart"), 'overview must show the 12-month principal/interest chart');
assert.ok(app.includes("buildHistoryFilterCard"), 'history must provide search and filters');
assert.ok(html.includes("./js/app.js?v=15"), 'HTML must request the updated app bundle without stale browser cache');
assert.ok(worker.includes("loan-tracker-cache-v15"), 'service worker cache must be bumped for the feature update');
assert.ok(app.includes('ReceiptStore'), 'app must support local receipt attachment storage');
assert.ok(app.includes('LoanAnalytics'), 'app must use shared tested financial analytics');

console.log('Static build verification passed');
