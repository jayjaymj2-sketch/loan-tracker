const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source=fs.readFileSync('apps-script/Code.gs','utf8')+'\n;globalThis.backendTest={validatePaymentAgainstLedger_,validateLedger_,findExistingPayment_,comparePayments_};';
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

test('earlier same-day receipt can be inserted after the later one',()=>{
  const first={id:'b',date:'2026-08-26',amount:20000,interest:2500,principalPaid:17500,balanceAfter:1782500};
  const second={id:'c',date:'2026-08-26',amount:20000,interest:0,principalPaid:20000,balanceAfter:1762500};
  assert.equal(Backend.validatePaymentAgainstLedger_(first,[previous,second]).ok,true);
  assert.equal([second,first].sort(Backend.comparePayments_)[0].id,'b');
});

test('same receipt with another id is rejected',()=>{
  assert.equal(Backend.validatePaymentAgainstLedger_({...previous,id:'copy'},[previous]).code,'DUPLICATE_PAYMENT');
});

test('lost-response retry succeeds but changed data cannot overwrite an id',()=>{
  assert.equal(Backend.findExistingPayment_({...previous},[previous]).duplicate,true);
  assert.equal(Backend.findExistingPayment_({...previous,amount:21000},[previous]).code,'DUPLICATE_ID');
});

test('doPost acknowledges exact retry even with stale version and does not write again',()=>{
  const isolated={console,LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})}};
  vm.createContext(isolated);
  vm.runInContext(source,isolated);
  isolated.isAuthorized_=()=>true;
  isolated.readPayments_=()=>[previous];
  isolated.getVersion_=()=>4;
  isolated.json_=payload=>payload;
  isolated.setVersion_=()=>{throw new Error('Must not bump version');};
  isolated.addPayment_=()=>{throw new Error('Must not append again');};
  const result=isolated.doPost({postData:{contents:JSON.stringify({action:'add',payment:previous,pass:'test-only',expectedVersion:3})}});
  assert.equal(result.ok,true);
  assert.equal(result.duplicate,true);
  assert.equal(result.version,4);
});

test('historic seed imports preserve known gaps and amounts, but new ledgers stay strict',()=>{
  const app=fs.readFileSync('js/app.js','utf8');
  const seed=JSON.parse(app.match(/const SEED_PAYMENTS = (\[[\s\S]*?\n\]);/)[1]).map((p,i)=>({...p,id:String(i),source:'legacy-import'}));
  const before=JSON.stringify(seed);
  const legacy=Backend.validateLedger_(seed,true);
  assert.equal(legacy.ok,true);
  assert.ok(legacy.warnings.length>0);
  assert.equal(JSON.stringify(seed),before);
  assert.equal(Backend.validateLedger_(seed,false).ok,false);
  assert.equal(Backend.validateLedger_([previous,{...previous,id:'copy'}],true).code,'DUPLICATE_PAYMENT');
});
