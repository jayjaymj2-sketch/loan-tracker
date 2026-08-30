const test = require('node:test');
const assert = require('node:assert/strict');
const Backup = require('../js/encrypted-backup.js');

test('encrypted receipt backup round-trips without exposing plaintext', async () => {
  const source={receipts:[{paymentId:'p1',name:'receipt.jpg',data:'secret-image-data'}]};
  const encrypted=await Backup.encryptJson(source,'family-safe-2569');
  assert.equal(encrypted.cipher,'AES-256-GCM');
  assert.equal(JSON.stringify(encrypted).includes('secret-image-data'),false);
  assert.deepEqual(await Backup.decryptJson(encrypted,'family-safe-2569'),source);
});

test('encrypted receipt backup rejects a wrong password', async () => {
  const encrypted=await Backup.encryptJson({receipts:[]},'correct-password');
  await assert.rejects(()=>Backup.decryptJson(encrypted,'wrong-password'),/รหัสไม่ถูกต้อง|ไฟล์เสียหาย/);
});
