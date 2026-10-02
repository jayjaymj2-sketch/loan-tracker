(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.LoanConnection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  async function requestJSON(url, options, timeoutMs){
    // ContentService redirect tokens may expire while an upstream cache still serves them.
    // Unique query parameters bypass that stale redirect without automatically retrying writes.
    const target=new URL(url,typeof location==='undefined'?undefined:location.href);
    if(target.hostname==='script.google.com'){
      target.searchParams.set('_request',Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try{
      const response = await fetch(target.href, {...options, signal:controller.signal, cache:'no-store'});
      if(!response.ok) throw new Error('ระบบกลางตอบกลับผิดพลาด (' + response.status + ') กรุณาลองซิงค์อีกครั้ง');
      let data;
      try{ data = await response.json(); }
      catch(error){
        if(controller.signal.aborted) throw error;
        throw new Error('ระบบกลางส่งข้อมูลที่อ่านไม่ได้ กรุณาลองซิงค์อีกครั้ง');
      }
      if(!data || typeof data.ok !== 'boolean') throw new Error('รูปแบบข้อมูลจากระบบกลางไม่ถูกต้อง');
      return data;
    }catch(error){
      if(controller.signal.aborted) throw new Error('ระบบกลางตอบช้าเกินไป กรุณาลองซิงค์อีกครั้ง');
      if(error instanceof TypeError) throw new Error('เชื่อมต่อระบบกลางไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองซิงค์อีกครั้ง');
      throw error;
    }finally{ clearTimeout(timer); }
  }
  function confirmWriteResult(body, listing){
    if(!listing || !listing.ok || !Array.isArray(listing.payments)) return null;
    const base={ok:true,version:listing.version,recovered:true};
    const samePayment=(expected,actual)=>expected && actual && expected.id===actual.id &&
      ['date','amount','interest','principalPaid','balanceAfter'].every(key=>String(expected[key])===String(actual[key]));
    if(body.action==='add'){
      const actual=listing.payments.find(p=>samePayment(body.payment,p));
      return actual?{...base,payment:actual,duplicate:true}:null;
    }
    if(body.action==='delete') return listing.payments.some(p=>p.id===body.id)?null:{...base,deletedId:body.id};
    if(body.action==='saveSettings' && listing.settings && Number(listing.settings.currentMRR)===Number(body.settings?.currentMRR)){
      return {...base,settings:listing.settings};
    }
    if(body.action==='bulkImport' && Array.isArray(body.payments) && body.payments.length &&
      body.payments.length===listing.payments.length && body.payments.every(expected=>listing.payments.some(actual=>samePayment(expected,actual)))){
      return {...base,count:body.payments.length};
    }
    return null;
  }
  return {requestJSON,confirmWriteResult};
});
