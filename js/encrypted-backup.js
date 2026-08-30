(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.EncryptedBackup=api;
})(typeof self!=='undefined'?self:this,function(){
  const ITERATIONS=250000;

  function cryptoApi(){
    if(typeof crypto!=='undefined'&&crypto.subtle) return crypto;
    try{ return require('node:crypto').webcrypto; }catch(error){ throw new Error('อุปกรณ์นี้ไม่รองรับการเข้ารหัส'); }
  }
  function toBase64(bytes){
    if(typeof Buffer!=='undefined') return Buffer.from(bytes).toString('base64');
    let binary='';
    new Uint8Array(bytes).forEach(value=>{ binary+=String.fromCharCode(value); });
    return btoa(binary);
  }
  function fromBase64(value){
    if(typeof Buffer!=='undefined') return new Uint8Array(Buffer.from(String(value),'base64'));
    const binary=atob(String(value));
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  async function derive(password,salt,usages){
    if(String(password||'').length<8) throw new Error('รหัสสำหรับไฟล์สำรองต้องมีอย่างน้อย 8 ตัวอักษร');
    const api=cryptoApi();
    const material=await api.subtle.importKey('raw',new TextEncoder().encode(String(password)),'PBKDF2',false,['deriveKey']);
    return api.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usages);
  }
  async function encryptJson(value,password){
    const api=cryptoApi();
    const salt=api.getRandomValues(new Uint8Array(16));
    const iv=api.getRandomValues(new Uint8Array(12));
    const key=await derive(password,salt,['encrypt']);
    const plaintext=new TextEncoder().encode(JSON.stringify(value));
    const ciphertext=await api.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
    return {format:'loan-tracker-receipts',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(ciphertext)};
  }
  async function decryptJson(payload,password){
    const data=typeof payload==='string'?JSON.parse(payload):payload;
    if(!data||data.format!=='loan-tracker-receipts'||data.version!==1) throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
    try{
      const api=cryptoApi();
      const key=await derive(password,fromBase64(data.salt),['decrypt']);
      const plaintext=await api.subtle.decrypt({name:'AES-GCM',iv:fromBase64(data.iv)},key,fromBase64(data.ciphertext));
      return JSON.parse(new TextDecoder().decode(plaintext));
    }catch(error){
      if(String(error&&error.message||'').includes('อย่างน้อย')) throw error;
      throw new Error('เปิดไฟล์ไม่ได้ รหัสไม่ถูกต้องหรือไฟล์เสียหาย');
    }
  }
  return {encryptJson,decryptJson,toBase64,fromBase64};
});
