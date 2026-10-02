const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(overrides={}){
  const events={};
  const context={URL,Response,fetch:global.fetch,self:{location:{origin:'https://example.test'},addEventListener:(name,callback)=>events[name]=callback,skipWaiting:()=>{},clients:{claim:()=>{}}},...overrides};
  vm.runInNewContext(fs.readFileSync('service-worker.js','utf8'),context);
  return {context,events};
}
test('incomplete offline cache does not activate and replace working version',async()=>{
  let activated=false;
  const {context,events}=setup({caches:{open:async()=>({addAll:async()=>{throw new Error('offline');}})}});
  context.self.skipWaiting=()=>{activated=true;};
  let work;
  events.install({waitUntil:promise=>work=promise});
  await assert.rejects(work,/offline/);
  assert.equal(activated,false);
});
test('activation preserves unrelated applications caches',async()=>{
  const removed=[];
  const {events}=setup({caches:{keys:async()=>['other-app','loan-tracker-cache-v26','loan-tracker-cache-v27'],delete:async name=>removed.push(name)}});
  let work;
  events.activate({waitUntil:promise=>work=promise});
  await work;
  assert.deepEqual(removed,['loan-tracker-cache-v26']);
});
test('offline navigation with query parameters opens cached app, while backend is never intercepted',async()=>{
  let options;
  const {events}=setup({fetch:async()=>{throw new Error('offline');},caches:{open:async()=>({match:async(_request,matchOptions)=>{options=matchOptions; return new Response('cached app');}})}});
  let work;
  events.fetch({request:{url:'https://example.test/loan_tracker.html?refresh=1',method:'GET',mode:'navigate'},respondWith:promise=>work=promise});
  assert.equal(await (await work).text(),'cached app');
  assert.equal(options.ignoreSearch,true);
  let intercepted=false;
  events.fetch({request:{url:'https://script.google.com/macros/s/backend/exec',method:'GET'},respondWith:()=>intercepted=true});
  assert.equal(intercepted,false);
});
