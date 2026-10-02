const test=require('node:test');
const assert=require('node:assert/strict');
const {requestJSON}=require('../js/connection.js');

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
