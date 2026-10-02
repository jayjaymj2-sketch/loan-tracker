(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.LoanConnection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  async function requestJSON(url, options, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try{
      const response = await fetch(url, {...options, signal:controller.signal, cache:'no-store'});
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
  return {requestJSON};
});
