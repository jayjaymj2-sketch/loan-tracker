(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.ReceiptStore=api;
})(typeof self!=='undefined'?self:this,function(){
  const DB_NAME='loan-tracker-receipts-v1';
  const STORE_NAME='receipts';

  function open(){
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined') return reject(new Error('อุปกรณ์นี้ไม่รองรับพื้นที่เก็บใบเสร็จ'));
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME,{keyPath:'paymentId'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('เปิดพื้นที่เก็บใบเสร็จไม่สำเร็จ'));
    });
  }

  async function transact(mode,callback){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_NAME,mode);
      const store=transaction.objectStore(STORE_NAME);
      let result;
      try{ result=callback(store); }catch(error){ db.close(); reject(error); return; }
      transaction.oncomplete=()=>{ db.close(); resolve(result&&result.result); };
      transaction.onerror=()=>{ db.close(); reject(transaction.error||new Error('จัดการใบเสร็จไม่สำเร็จ')); };
      transaction.onabort=transaction.onerror;
    });
  }

  function save(record){ return transact('readwrite',store=>store.put(record)); }
  function get(paymentId){ return transact('readonly',store=>store.get(String(paymentId))); }
  function remove(paymentId){ return transact('readwrite',store=>store.delete(String(paymentId))); }
  function listRecords(){ return transact('readonly',store=>store.getAll()).then(records=>records||[]); }
  async function saveMany(records){
    const items=Array.isArray(records)?records:[];
    for(const record of items) await save(record);
    return items.length;
  }
  async function listMeta(){
    const records=await transact('readonly',store=>store.getAll());
    return (records||[]).map(({paymentId,name,type,size,createdAt})=>({paymentId,name,type,size,createdAt}));
  }
  async function stats(){
    const items=await listMeta();
    return {count:items.length,totalBytes:items.reduce((sum,item)=>sum+Number(item.size||0),0)};
  }
  return {save,get,remove,listMeta,listRecords,saveMany,stats};
});
