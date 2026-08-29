import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('loan_tracker.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const backend = fs.readFileSync('apps-script/Code.gs', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
new Function(backend);

for(const asset of ['./styles.css', './js/receipt-parser.js', './js/sync-version.js', './js/app.js']){
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
assert.ok(app.includes("slice(0,5)"), 'overview must show the five latest payments');
assert.ok(app.includes("buildLatestAnnualInterestCard"), 'overview must show the latest annual interest summary');
assert.ok(worker.includes("loan-tracker-cache-v12"), 'service worker cache must be bumped for the overview update');

console.log('Static build verification passed');
