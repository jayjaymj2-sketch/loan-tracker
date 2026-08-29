/**
 * Backend สำหรับ Home Loan Tracker
 *
 * ตั้งค่า Script Properties ก่อน Deploy:
 * - FAMILY_PASS_SHA256: SHA-256 ของรหัสครอบครัว (ตัวพิมพ์เล็ก 64 ตัว)
 * - SPREADSHEET_ID: ไม่บังคับ ถ้าเป็นสคริปต์ที่ผูกกับ Google Sheet อยู่แล้ว
 *
 * ทุกการเปลี่ยนข้อมูลใช้ ScriptLock และ optimistic version เดียวกัน
 * จึงไม่มีสองเครื่องเขียนทับกันโดยไม่รู้ตัว
 */

const SHEET_NAME = 'Payments';
const VERSION_KEY = 'DATA_VERSION';
const HEADERS = [
  'id', 'date', 'amount', 'interest', 'principalPaid', 'balanceAfter',
  'payer', 'locked', 'createdAt', 'updatedAt', 'source'
];

function doGet(e){
  const params = (e && e.parameter) || {};
  if(params.action !== 'list') return json_({ ok:false, error:'ไม่รู้จักคำสั่ง' });
  if(!isAuthorized_(params.pass)) return json_({ ok:false, error:'รหัสผ่านไม่ถูกต้อง' });

  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(10000);
    return json_({ ok:true, payments:readPayments_(), version:getVersion_() });
  }catch(err){
    return json_({ ok:false, error:'ระบบกำลังบันทึกข้อมูล กรุณาลองใหม่' });
  }finally{
    if(lock.hasLock()) lock.releaseLock();
  }
}

function doPost(e){
  let body;
  try{
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  }catch(err){
    return json_({ ok:false, error:'รูปแบบข้อมูลไม่ถูกต้อง' });
  }
  if(!isAuthorized_(body.pass)) return json_({ ok:false, error:'รหัสผ่านไม่ถูกต้อง' });

  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(10000);
    const currentVersion = getVersion_();
    const expectedVersion = normalizeVersion_(body.expectedVersion);

    // Client รุ่นเก่าที่ยังไม่ส่ง expectedVersion ยังใช้งานได้ แต่รุ่นใหม่จะป้องกันข้อมูลชนกันเต็มรูปแบบ
    if(expectedVersion !== null && expectedVersion !== currentVersion){
      return json_({
        ok:false,
        conflict:true,
        code:'VERSION_CONFLICT',
        version:currentVersion,
        error:'ข้อมูลถูกแก้ไขจากอีกเครื่อง กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง'
      });
    }

    let result;
    if(body.action === 'add') result = addPayment_(body.payment);
    else if(body.action === 'delete') result = deletePayment_(body.id);
    else if(body.action === 'bulkImport') result = bulkImport_(body.payments);
    else return json_({ ok:false, error:'ไม่รู้จักคำสั่ง' });

    if(!result.ok) return json_(result);
    const nextVersion = setVersion_(currentVersion + 1);
    result.version = nextVersion;
    return json_(result);
  }catch(err){
    return json_({ ok:false, error:'บันทึกไม่สำเร็จ: ' + err.message });
  }finally{
    if(lock.hasLock()) lock.releaseLock();
  }
}

function addPayment_(raw){
  const payment = sanitizePayment_(raw);
  if(!payment) return { ok:false, error:'ข้อมูลรายการชำระไม่ครบถ้วน' };
  const sheet = getSheet_();
  const existing = readPayments_();
  if(existing.some(function(item){ return item.id === payment.id; })){
    return { ok:false, error:'รายการนี้มีอยู่แล้ว' };
  }
  const now = new Date().toISOString();
  payment.createdAt = payment.createdAt || now;
  payment.updatedAt = now;
  sheet.appendRow(paymentToRow_(payment));
  return { ok:true, payment:payment };
}

function deletePayment_(id){
  if(!id) return { ok:false, error:'ไม่พบรหัสรายการ' };
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const idIndex = HEADERS.indexOf('id');
  for(let row = values.length - 1; row >= 1; row--){
    if(String(values[row][idIndex]) === String(id)){
      sheet.deleteRow(row + 1);
      return { ok:true, deletedId:String(id) };
    }
  }
  return { ok:false, error:'ไม่พบรายการที่ต้องการลบ' };
}

function bulkImport_(payments){
  if(!Array.isArray(payments) || !payments.length) return { ok:false, error:'ไม่มีข้อมูลให้นำเข้า' };
  const sheet = getSheet_();
  if(sheet.getLastRow() > 1) return { ok:false, error:'ระบบกลางมีข้อมูลอยู่แล้ว จึงไม่นำเข้าซ้ำ' };
  const now = new Date().toISOString();
  const cleaned = payments.map(function(item){
    const payment = sanitizePayment_(item);
    if(!payment) throw new Error('พบรายการนำเข้าที่ข้อมูลไม่ครบ');
    payment.createdAt = payment.createdAt || now;
    payment.updatedAt = now;
    return payment;
  });
  sheet.getRange(2, 1, cleaned.length, HEADERS.length).setValues(cleaned.map(paymentToRow_));
  return { ok:true, count:cleaned.length };
}

function sanitizePayment_(raw){
  if(!raw) return null;
  const date = normalizeDate_(raw.date);
  if(!date) return null;
  const amount = Number(raw.amount);
  const interest = Number(raw.interest || 0);
  const principalPaid = Number(raw.principalPaid);
  const balanceAfter = Number(raw.balanceAfter);
  if(![amount, interest, principalPaid, balanceAfter].every(Number.isFinite)) return null;
  if(amount < 0 || interest < 0 || principalPaid < 0 || balanceAfter < 0) return null;
  return {
    id:String(raw.id || Utilities.getUuid()),
    date:date,
    amount:round2_(amount),
    interest:round2_(interest),
    principalPaid:round2_(principalPaid),
    balanceAfter:round2_(balanceAfter),
    payer:String(raw.payer || ''),
    locked:raw.locked === true || Number(raw.locked) === 1 || String(raw.locked).toLowerCase() === 'true',
    createdAt:String(raw.createdAt || ''),
    updatedAt:String(raw.updatedAt || ''),
    source:String(raw.source || '')
  };
}

function readPayments_(){
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  if(values.length <= 1) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function(row){ return row.some(function(value){ return value !== ''; }); }).map(function(row){
    const raw = {};
    headers.forEach(function(header, index){ raw[header] = row[index]; });
    const payment = sanitizePayment_(raw);
    if(!payment) return null;
    payment.createdAt = normalizeTimestamp_(raw.createdAt);
    payment.updatedAt = normalizeTimestamp_(raw.updatedAt);
    return payment;
  }).filter(Boolean).sort(function(a,b){ return a.date.localeCompare(b.date); });
}

function getSheet_(){
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if(!spreadsheet) throw new Error('ไม่พบ Google Sheet กรุณาตั้งค่า SPREADSHEET_ID');
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if(!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if(sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
  HEADERS.forEach(function(header, index){
    if(currentHeaders[index] !== header) sheet.getRange(1, index + 1).setValue(header);
  });
  return sheet;
}

function paymentToRow_(payment){
  return HEADERS.map(function(header){ return payment[header] == null ? '' : payment[header]; });
}

function isAuthorized_(pass){
  const properties = PropertiesService.getScriptProperties();
  let expected = String(properties.getProperty('FAMILY_PASS_SHA256') || '').toLowerCase();
  // ย้ายระบบรุ่นเดิมที่เก็บ PASSPHRASE แบบข้อความธรรมดาไปเป็น SHA-256 อัตโนมัติ
  // เมื่อย้ายสำเร็จจะลบค่าเดิมออกทันที โดยผู้ใช้ยังเข้าสู่ระบบด้วยรหัสเดิมได้ตามปกติ
  if(!expected){
    const legacyPass = properties.getProperty('PASSPHRASE');
    if(legacyPass){
      expected = sha256_(legacyPass);
      properties.setProperty('FAMILY_PASS_SHA256', expected);
      properties.deleteProperty('PASSPHRASE');
    }
  }
  if(!expected || !pass) return false;
  const actual = sha256_(String(pass));
  return constantTimeEqual_(actual, expected);
}

function sha256_(value){
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest.map(function(byte){ return ('0' + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2); }).join('');
}

function constantTimeEqual_(a, b){
  if(a.length !== b.length) return false;
  let mismatch = 0;
  for(let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function getVersion_(){
  return normalizeVersion_(PropertiesService.getScriptProperties().getProperty(VERSION_KEY)) || 0;
}

function setVersion_(version){
  PropertiesService.getScriptProperties().setProperty(VERSION_KEY, String(version));
  return version;
}

function normalizeVersion_(value){
  if(value === null || value === undefined || value === '') return null;
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

function round2_(value){
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeDate_(value){
  // ค่าวันที่จาก Google Sheets อาจเป็นวัตถุ Date ข้าม execution realm
  // ซึ่ง instanceof Date ให้ค่า false แม้มี getTime() ใช้งานได้ตามปกติ
  if(value && typeof value.getTime === 'function' && !isNaN(value.getTime())){
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(!match) return null;
  return `${match[3]}-${('0'+match[2]).slice(-2)}-${('0'+match[1]).slice(-2)}`;
}

function normalizeTimestamp_(value){
  if(!value) return '';
  const date = value && typeof value.getTime === 'function' ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function json_(payload){
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
