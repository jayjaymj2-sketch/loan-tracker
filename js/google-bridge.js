(function(root){
  let frame=null, ready=null, peer=null, peerOrigin='', channel='';
  const pending=new Map();
  const marker='loan-tracker-bridge';
  const googleOrigin=origin=>/^https:\/\/(?:script\.google\.com|script\.googleusercontent\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/.test(origin);
  function reset(){
    if(frame) frame.remove();
    frame=null; ready=null; peer=null; peerOrigin='';
  }
  function connect(url){
    if(ready) return ready;
    channel=crypto.randomUUID();
    ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        window.removeEventListener('message',handshake);
        reset(); reject(new Error('เชื่อมต่อช่องทาง Google ไม่สำเร็จ กรุณาลองซิงค์อีกครั้ง'));
      },20000);
      function handshake(event){
        const data=event.data;
        if(!googleOrigin(event.origin)||!data||data.marker!==marker||data.channel!==channel||data.kind!=='ready') return;
        clearTimeout(timer); window.removeEventListener('message',handshake);
        peer=event.source; peerOrigin=event.origin; resolve();
      }
      window.addEventListener('message',handshake);
      frame=document.createElement('iframe');
      frame.hidden=true;
      frame.title='ช่องทางซิงค์ข้อมูลครอบครัว';
      const target=new URL(url);
      target.searchParams.set('transport','bridge'); target.searchParams.set('channel',channel);
      frame.src=target.href;
      document.body.appendChild(frame);
    });
    return ready;
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==peer||event.origin!==peerOrigin||!data||data.marker!==marker||data.channel!==channel||data.kind!=='result') return;
    const task=pending.get(data.id);
    if(!task) return;
    pending.delete(data.id); clearTimeout(task.timer);
    if(data.error) task.reject(new Error(data.error));
    else if(!data.result||typeof data.result.ok!=='boolean') task.reject(new Error('รูปแบบข้อมูลจาก Google ไม่ถูกต้อง'));
    else task.resolve(data.result);
  });
  async function request(url,body){
    await connect(url);
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reset();reject(new Error('ระบบกลางตอบช้าเกินไป กรุณาลองซิงค์อีกครั้ง'));},30000);
      pending.set(id,{resolve,reject,timer});
      peer.postMessage({marker,channel,kind:'request',id,body},peerOrigin);
    });
  }
  root.LoanBridge={request};
})(window);
