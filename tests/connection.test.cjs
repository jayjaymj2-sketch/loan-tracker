const test=require('node:test');
const assert=require('node:assert/strict');
const {requestJSON,confirmWriteResult}=require('../js/connection.js');

test('JSON transport distinguishes HTTP, invalid payload, network and timeout failures',async()=>{
  const original=global.fetch;
  try{
    global.fetch=async()=>({ok:true,json:async()=>({ok:true,payments:[]})});
    assert.equal((await requestJSON('https://example.test')).ok,true);
    global.fetch=async()=>({ok:false,status:503});
    await assert.rejects(requestJSON('https://example.test'),/503/);
    global.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError();}});
    await assert.rejects(requestJSON('https://example.test'),/อ่านไม่ได้/);
    global.fetch=async()=>({ok:true,json:async()=>({payments:[]})});
    await assert.rejects(requestJSON('https://example.test'),/รูปแบบข้อมูล/);
    global.fetch=async()=>{throw new TypeError('Failed to fetch');};
    await assert.rejects(requestJSON('https://example.test'),/เชื่อมต่อระบบกลางไม่ได้/);
    global.fetch=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
    await assert.rejects(requestJSON('https://example.test',{},10),/ตอบช้าเกินไป/);
  }finally{global.fetch=original;}
});

test('write recovery only acknowledges exact read-back data, never changed amounts or failed auth',()=>{
  const payment={id:'p',date:'2026-10-02',amount:20000,interest:2000,principalPaid:18000,balanceAfter:1700000};
  const listing={ok:true,version:6,payments:[payment],settings:{currentMRR:6.6}};
  assert.equal(confirmWriteResult({action:'add',payment},listing).recovered,true);
  assert.equal(confirmWriteResult({action:'add',payment:{...payment,amount:21000}},listing),null);
  assert.equal(confirmWriteResult({action:'add',payment},{...listing,ok:false}),null);
  assert.equal(confirmWriteResult({action:'delete',id:'p'},listing),null);
  assert.equal(confirmWriteResult({action:'delete',id:'absent'},listing).deletedId,'absent');
  assert.equal(confirmWriteResult({action:'saveSettings',settings:{currentMRR:6.6}},listing).ok,true);
  assert.equal(confirmWriteResult({action:'saveSettings',settings:{currentMRR:6.3}},listing),null);
});

test('Apps Script GET and POST bypass stale redirect tokens without repeating a write',async()=>{
  const original=global.fetch;
  const calls=[];
  try{
    global.fetch=async(url,options)=>{calls.push({url,options}); return {ok:true,json:async()=>({ok:true})};};
    const url='https://script.google.com/macros/s/backend/exec?action=list&pass=test-only';
    await requestJSON(url);
    await requestJSON(url,{method:'POST',body:'test'});
    assert.equal(calls.length,2);
    const first=new URL(calls[0].url), second=new URL(calls[1].url);
    assert.equal(first.searchParams.get('pass'),'test-only');
    assert.ok(first.searchParams.get('_request'));
    assert.notEqual(first.searchParams.get('_request'),second.searchParams.get('_request'));
    assert.equal(calls[1].options.method,'POST');
    assert.equal(calls[1].options.body,'test');
  }finally{global.fetch=original;}
});
