const ORIGINAL_PRINCIPAL = 3823247.00; // ยอดกู้เริ่มต้นตามสัญญา (28 เม.ย. 2559) ตรงกับแอพ SCB
const ORIGINAL_DATE = '2016-04-28';
// จุดอ้างอิงก่อนเริ่มเก็บประวัติละเอียด (ยอดคงเหลือจริงตามใบเสร็จ ก่อนรายการแรกที่บันทึกไว้)
const TRACKING_ANCHOR_BALANCE = 3553254.00; // ยอดคงเหลือก่อนรายการแรกที่บันทึกไว้ (= 3546070.86 + 7183.14 ตามใบเสร็จ 31 ส.ค. 2563)
const TRACKING_ANCHOR_DATE = '2020-08-30';
const ANNUAL_RATE = 0.028;


// ตารางอัตราดอกเบี้ยตามประกาศปรับลดดอกเบี้ย (18 มี.ค. 2569)
// ปีที่ 1-3 นับจาก 9 มี.ค. 2569 = 2.8% คงที่ / ปีที่ 4 เป็นต้นไป = MRR - 1.5% (ลอยตัว)
const RATE_RESET_DATE = '2026-03-09';
const FIXED_RATE = 0.028;
const FLOATING_SPREAD = 0.015; // MRR - 1.5%
const FIXED_PERIOD_YEARS = 3;

const STORAGE_KEY = 'loan_state_v1';
const SEED_VERSION = 7; // เพิ่มเลขนี้เมื่อต้องการบังคับโหลดข้อมูลตั้งต้นใหม่
// หมายเหตุ: currentBalance เก็บเฉพาะ "เงินต้น" หลังตัดชำระงวดล่าสุดเท่านั้น
// ดอกเบี้ยที่ค้างนับจาก lastUpdateDate จะถูกคำนวณสดทุกครั้งที่เปิดแอพ (ดู liveBalance ใน render)

// ============================================================
// ตั้งค่าระบบซิงค์กับ Google Sheets (ดู apps-script/README.md)
// แก้ค่า APPS_SCRIPT_URL ด้านล่างเป็นลิงก์ที่ได้จากตอน Deploy Apps Script
// (ลิงก์จะลงท้ายด้วย /exec)
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzGxP7pb_aVptv9rxn_UR61W895yjDeqL-ujLjRqNP0KZmB5sgNhYSIZ15pcX4LI5Ka/exec';
const PASS_KEY = 'lt_family_pass';
const CACHE_KEY = 'lt_local_cache_v2';

// ล็อกไม่ให้ลบรายการที่มีอยู่แล้วก่อนเวลานี้ทั้งหมด (รวมที่นำเข้า/บันทึกไปก่อนหน้าแล้ว)
// ลบได้เฉพาะรายการที่ "กรอกใหม่หลังจากนี้" เท่านั้น (เช็คจาก updatedAt ที่เซิร์ฟเวอร์ประทับเวลาให้ตอนบันทึก)
const DELETE_LOCK_BEFORE = '2026-06-29T19:19:05.000Z';

function canDeletePayment(p){
  if(!p) return false;
  if(p.locked) return false; // ข้อมูลจากใบเสร็จจริงห้ามลบเสมอ ไม่ว่ากรณีใด
  const ts = p.updatedAt || p.createdAt;
  if(!ts) return false; // ไม่มีเวลาบันทึก = ข้อมูลเก่าก่อนอัปเดตนี้ -> ลบไม่ได้
  return ts > DELETE_LOCK_BEFORE;
}


function isConfigured(){
  return !!APPS_SCRIPT_URL && APPS_SCRIPT_URL.indexOf('PASTE_') !== 0;
}
function getSavedPass(){
  try{ return localStorage.getItem(PASS_KEY); }catch(e){ return null; }
}
function savePass(p){
  try{ localStorage.setItem(PASS_KEY, p); }catch(e){}
}
function clearPass(){
  try{ localStorage.removeItem(PASS_KEY); }catch(e){}
}
function genId(){
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function localCacheGet(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function localCacheSet(obj){
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); }catch(e){}
}

let syncStatus = { online: false, lastSync: null, error: null, syncing: false };
let serverVersion = null;

function absorbServerVersion(data){
  if(typeof SyncVersion === 'undefined' || !data) return;
  const version = SyncVersion.normalizeVersion(data.version);
  if(version != null) serverVersion = version;
}

function versionedRequest(payload){
  return typeof SyncVersion === 'undefined' ? payload : SyncVersion.withExpectedVersion(payload, serverVersion);
}

async function handleServerConflict(data){
  if(typeof SyncVersion === 'undefined' || !SyncVersion.isConflictResponse(data)) return false;
  absorbServerVersion(data);
  await syncFromServer();
  render();
  showToast('มีคนแก้ข้อมูลก่อนหน้านี้ โหลดข้อมูลล่าสุดแล้ว กรุณาลองอีกครั้ง');
  return true;
}


// ดอกเบี้ยที่จ่ายจริงแต่ละปี ตามหนังสือรับรองดอกเบี้ยเงินกู้ยืมจากธนาคาร (ยอดรวมทุกผู้กู้ร่วม 3 คน)
// ปี 2561 และ 2562 มาจากแบบภาษี ภ.ง.ด.91 (ยอดต่อคน x 3 เพราะหารเฉลี่ยกัน 3 คนแล้ว)
const ANNUAL_INTEREST_HISTORY = [
  { year: 2017, amount: 144270.10, source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2018, amount: 181374.87, source: 'แบบภาษี ภ.ง.ด.91 (60,458.29 x 3)' },
  { year: 2019, amount: 152007.60, source: 'แบบภาษี ภ.ง.ด.91 (50,669.20 x 3)' },
  { year: 2020, amount: 125741.56, source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2021, amount: 91488.31,  source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2022, amount: 85792.47,  source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2023, amount: 109266.03, source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2024, amount: 112593.76, source: 'หนังสือรับรองดอกเบี้ย' },
  { year: 2025, amount: 90709.01,  source: 'หนังสือรับรองดอกเบี้ย (ทั้งปี)' },
];
// ปีที่ยังไม่มีหนังสือรับรองดอกเบี้ย จะรวมจากช่อง interest ของรายการชำระจริงโดยอัตโนมัติ
// เมื่อเพิ่มรายการใหม่หรือซิงค์ข้อมูลจากระบบกลาง ยอดรายปีและยอดสะสมจะอัปเดตตามทันที
const LAST_CERTIFIED_INTEREST_YEAR = Math.max(...ANNUAL_INTEREST_HISTORY.map(y => y.year));

const PAYERS = {
  me:  { label: 'ฉัน',  short: 'ฉัน',  color: '#e8cd7a' },
  mom: { label: 'แม่',   short: 'แม่',  color: '#7fb3d5' },
  dad: { label: 'พ่อ',   short: 'พ่อ',  color: '#a3d9a5' }
};

let state = null;
// (ไม่มีการเก็บ "ผู้ชำระ" อีกต่อไป — ยกเลิกตามที่ต้องการ)

const PLANNER_PREFS_KEY = 'lt_planner_prefs_v1';
const BACKUP_HISTORY_KEY = 'lt_backup_history_v1';
const UI_PREFS_KEY = 'lt_ui_prefs_v1';
let plannerState = { tab:'simulate', payment:null, lumpSum:0, targetDate:'' };
let uiState = { page:'overview', fontSize:'normal' };
let historyFilters = { query:'', year:'all', type:'all' };
let receiptAttachmentMeta = new Map();
let pendingReceiptFile = null;
let pendingReceiptTargetId = null;
let currentReceiptViewer = null;
let currentReceiptObjectUrl = '';
let appUpdateRegistration = null;
try{
  const savedPlanner = JSON.parse(localStorage.getItem(PLANNER_PREFS_KEY) || 'null');
  if(savedPlanner && typeof savedPlanner === 'object') plannerState = Object.assign(plannerState, savedPlanner);
}catch(e){}
try{
  const savedUi = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || 'null');
  if(savedUi && typeof savedUi === 'object') uiState = Object.assign(uiState, savedUi);
}catch(e){}
if(!['overview','plan','history','settings'].includes(uiState.page)) uiState.page='overview';
if(!['normal','large','xlarge'].includes(uiState.fontSize)) uiState.fontSize='normal';

function saveUiPrefs(){
  try{ localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiState)); }catch(e){}
}

function applyFontPreference(){
  document.documentElement.dataset.fontSize=uiState.fontSize;
}

function setAppPage(page){
  if(!['overview','plan','history','settings'].includes(page)) return;
  uiState.page=page;
  if(page==='plan' && plannerState.tab==='data') plannerState.tab='simulate';
  saveUiPrefs();
  render();
  requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
}

function setAppFontSize(size){
  if(!['normal','large','xlarge'].includes(size)) return;
  uiState.fontSize=size;
  saveUiPrefs();
  applyFontPreference();
  render();
  showToast(size==='normal'?'ใช้ตัวอักษรขนาดปกติ':size==='large'?'เพิ่มขนาดตัวอักษรแล้ว':'ใช้ตัวอักษรขนาดใหญ่มากแล้ว');
}

function cycleFontSize(){
  const sizes=['normal','large','xlarge'];
  setAppFontSize(sizes[(sizes.indexOf(uiState.fontSize)+1)%sizes.length]);
}

applyFontPreference();

const SEED_PAYMENTS = [
  {"date":"2020-08-31","amount":18500.0,"interest":11316.86,"principalPaid":7183.14,"balanceAfter":3546070.86,"payer":"dad","locked":true},
  {"date":"2021-08-31","amount":24300.0,"interest":6885.22,"principalPaid":17414.78,"balanceAfter":3395973.82,"payer":"dad","locked":true},
  {"date":"2021-09-30","amount":24300.0,"interest":6629.13,"principalPaid":17670.87,"balanceAfter":3378302.95,"payer":"dad","locked":true},
  {"date":"2021-10-31","amount":24300.0,"interest":6814.45,"principalPaid":17485.55,"balanceAfter":3360817.4,"payer":"dad","locked":true},
  {"date":"2021-11-30","amount":24300.0,"interest":6560.5,"principalPaid":17739.5,"balanceAfter":3343077.9,"payer":"dad","locked":true},
  {"date":"2021-12-31","amount":24300.0,"interest":6743.41,"principalPaid":17556.59,"balanceAfter":3325521.31,"payer":"dad","locked":true},
  {"date":"2022-01-31","amount":24300.0,"interest":6707.97,"principalPaid":17592.03,"balanceAfter":3307929.28,"payer":"dad","locked":true},
  {"date":"2022-02-28","amount":24300.0,"interest":6026.78,"principalPaid":18273.22,"balanceAfter":3289656.06,"payer":"dad","locked":true},
  {"date":"2022-04-30","amount":24300.0,"interest":6500.05,"principalPaid":17799.95,"balanceAfter":3254191.76,"payer":"dad","locked":true},
  {"date":"2022-05-31","amount":30447.12,"interest":8305.33,"principalPaid":12494.67,"balanceAfter":3241697.09,"payer":"dad","locked":true},
  {"date":"2022-06-30","amount":20800.0,"interest":8006.55,"principalPaid":12793.45,"balanceAfter":3228903.64,"payer":"dad","locked":true},
  {"date":"2022-07-31","amount":20800.0,"interest":8240.78,"principalPaid":12559.22,"balanceAfter":3216344.42,"payer":"dad","locked":true},
  {"date":"2022-09-30","amount":20800.0,"interest":7912.83,"principalPaid":12887.17,"balanceAfter":3190865.97,"payer":"dad","locked":true},
  {"date":"2022-10-31","amount":20800.0,"interest":8143.7,"principalPaid":12656.3,"balanceAfter":3178209.67,"payer":"dad","locked":true},
  {"date":"2022-11-30","amount":20800.0,"interest":7849.75,"principalPaid":12950.25,"balanceAfter":3165259.42,"payer":"dad","locked":true},
  {"date":"2022-12-31","amount":20800.0,"interest":8338.51,"principalPaid":12461.49,"balanceAfter":3152797.93,"payer":"dad","locked":true},
  {"date":"2023-02-28","amount":20800.0,"interest":8334.67,"principalPaid":12465.33,"balanceAfter":3128959.03,"payer":"dad","locked":true},
  {"date":"2023-03-31","amount":20800.0,"interest":9008.82,"principalPaid":11791.18,"balanceAfter":3117167.85,"payer":"dad","locked":true},
  {"date":"2023-04-30","amount":20800.0,"interest":9197.8,"principalPaid":11602.2,"balanceAfter":3105565.65,"payer":"dad","locked":true},
  {"date":"2023-05-31","amount":20800.0,"interest":9600.87,"principalPaid":11199.13,"balanceAfter":3094366.52,"payer":"dad","locked":true},
  {"date":"2023-06-30","amount":20800.0,"interest":9578.11,"principalPaid":11221.89,"balanceAfter":3083144.63,"payer":"me","locked":true},
  {"date":"2023-06-30","amount":20800.0,"interest":0.0,"principalPaid":20800.0,"balanceAfter":3062344.63,"payer":"dad","locked":true},
  {"date":"2023-07-31","amount":20800.0,"interest":9935.44,"principalPaid":10864.56,"balanceAfter":3051480.07,"payer":"me","locked":true},
  {"date":"2023-07-31","amount":20800.0,"interest":0.0,"principalPaid":20800.0,"balanceAfter":3030680.07,"payer":"dad","locked":true},
  {"date":"2023-08-31","amount":20800.0,"interest":9832.69,"principalPaid":10967.31,"balanceAfter":3019712.76,"payer":"dad","locked":true},
  {"date":"2023-09-30","amount":20800.0,"interest":9481.06,"principalPaid":11318.94,"balanceAfter":3008393.82,"payer":"dad","locked":true},
  {"date":"2023-10-02","amount":20800.0,"interest":629.7,"principalPaid":20170.3,"balanceAfter":2988223.52,"payer":"me","locked":true},
  {"date":"2023-10-31","amount":20800.0,"interest":9642.55,"principalPaid":11157.45,"balanceAfter":2977066.07,"payer":"me","locked":true},
  {"date":"2023-10-31","amount":20800.0,"interest":0.0,"principalPaid":20800.0,"balanceAfter":2956266.07,"payer":"dad","locked":true},
  {"date":"2023-11-29","amount":20800.0,"interest":9559.67,"principalPaid":11240.33,"balanceAfter":2945025.74,"payer":"me","locked":true},
  {"date":"2023-11-30","amount":20800.0,"interest":328.4,"principalPaid":20471.6,"balanceAfter":2924554.14,"payer":"dad","locked":true},
  {"date":"2023-12-31","amount":20800.0,"interest":10109.34,"principalPaid":10690.66,"balanceAfter":2913863.48,"payer":"dad","locked":true},
  {"date":"2024-01-31","amount":20800.0,"interest":10072.38,"principalPaid":10727.62,"balanceAfter":2903135.86,"payer":"dad","locked":true},
  {"date":"2024-02-29","amount":20800.0,"interest":9387.87,"principalPaid":11412.13,"balanceAfter":2891723.73,"payer":"dad","locked":true},
  {"date":"2024-03-27","amount":20800.0,"interest":8706.07,"principalPaid":12093.93,"balanceAfter":2879629.8,"payer":"me","locked":true},
  {"date":"2024-03-31","amount":20800.0,"interest":1284.39,"principalPaid":19515.61,"balanceAfter":2860114.19,"payer":"dad","locked":true},
  {"date":"2024-04-30","amount":20800.0,"interest":317.63,"principalPaid":20482.37,"balanceAfter":2828080.58,"payer":"dad","locked":true},
  {"date":"2024-05-30","amount":20800.0,"interest":9460.51,"principalPaid":11339.49,"balanceAfter":2816741.09,"payer":"me","locked":true},
  {"date":"2024-05-31","amount":20800.0,"interest":314.08,"principalPaid":20485.92,"balanceAfter":2796255.17,"payer":"dad","locked":true},
  {"date":"2024-06-30","amount":19800.0,"interest":9354.05,"principalPaid":10445.95,"balanceAfter":2785809.22,"payer":"me","locked":true},
  {"date":"2024-06-30","amount":19800.0,"interest":0.0,"principalPaid":19800.0,"balanceAfter":2766009.22,"payer":"dad","locked":true},
  {"date":"2024-07-31","amount":19600.0,"interest":9561.3,"principalPaid":10038.7,"balanceAfter":2755970.52,"payer":"dad","locked":true},
  {"date":"2024-08-31","amount":19600.0,"interest":9526.6,"principalPaid":10073.4,"balanceAfter":2745897.12,"payer":"dad","locked":true},
  {"date":"2024-09-30","amount":19600.0,"interest":9185.59,"principalPaid":10414.41,"balanceAfter":2735482.71,"payer":"dad","locked":true},
  {"date":"2024-10-31","amount":19600.0,"interest":911.38,"principalPaid":18688.62,"balanceAfter":2705734.79,"payer":"dad","locked":true},
  {"date":"2024-11-26","amount":19600.0,"interest":7612.75,"principalPaid":11987.25,"balanceAfter":2693747.54,"payer":"me","locked":true},
  {"date":"2024-11-30","amount":19600.0,"interest":1164.58,"principalPaid":18435.42,"balanceAfter":2675312.12,"payer":"dad","locked":true},
  {"date":"2024-12-29","amount":19600.0,"interest":8385.46,"principalPaid":11214.54,"balanceAfter":2664097.58,"payer":"me","locked":true},
  {"date":"2024-12-31","amount":19600.0,"interest":575.88,"principalPaid":19024.12,"balanceAfter":2645073.46,"payer":"dad","locked":true},
  {"date":"2025-01-28","amount":20000.0,"interest":8004.79,"principalPaid":11995.21,"balanceAfter":2633078.25,"payer":"me","locked":true},
  {"date":"2025-01-31","amount":19600.0,"interest":853.77,"principalPaid":18746.23,"balanceAfter":2614332.02,"payer":"dad","locked":true},
  {"date":"2025-02-05","amount":19600.0,"interest":1412.81,"principalPaid":18187.19,"balanceAfter":2596144.83,"payer":"me","locked":true},
  {"date":"2025-02-25","amount":20000.0,"interest":5611.94,"principalPaid":14388.06,"balanceAfter":2581756.77,"payer":"me","locked":true},
  {"date":"2025-02-28","amount":19600.0,"interest":837.13,"principalPaid":18762.87,"balanceAfter":2562993.9,"payer":"dad","locked":true},
  {"date":"2025-03-31","amount":19600.0,"interest":1343.13,"principalPaid":18256.87,"balanceAfter":2531777.89,"payer":"dad","locked":true},
  {"date":"2025-04-30","amount":19600.0,"interest":1326.5,"principalPaid":18273.5,"balanceAfter":2500171.98,"payer":"dad","locked":true},
  {"date":"2025-05-27","amount":20000.0,"interest":7083.71,"principalPaid":3269.17,"balanceAfter":2496902.81,"payer":"me","locked":true},
  {"date":"2025-05-31","amount":20000.0,"interest":1038.43,"principalPaid":18961.57,"balanceAfter":2477941.24,"payer":"me","locked":true},
  {"date":"2025-05-31","amount":19600.0,"interest":0.0,"principalPaid":19600.0,"balanceAfter":2458341.24,"payer":"dad","locked":true},
  {"date":"2025-06-25","amount":20000.0,"interest":6390.01,"principalPaid":13609.99,"balanceAfter":2444731.25,"payer":"me","locked":true},
  {"date":"2025-06-26","amount":12000.0,"interest":254.18,"principalPaid":11745.82,"balanceAfter":2432985.43,"payer":"me","locked":true},
  {"date":"2025-06-30","amount":19600.0,"interest":1011.86,"principalPaid":18588.14,"balanceAfter":2414397.29,"payer":"dad","locked":true},
  {"date":"2025-07-25","amount":20000.0,"interest":6275.78,"principalPaid":13724.22,"balanceAfter":2400673.07,"payer":"me","locked":true},
  {"date":"2025-07-31","amount":19600.0,"interest":1497.62,"principalPaid":18102.38,"balanceAfter":2382570.69,"payer":"dad","locked":true},
  {"date":"2025-08-26","amount":20000.0,"interest":6261.27,"principalPaid":13738.73,"balanceAfter":2368831.96,"payer":"me","locked":true},
  {"date":"2025-08-27","amount":20000.0,"interest":230.07,"principalPaid":19769.93,"balanceAfter":2349062.03,"payer":"me","locked":true},
  {"date":"2025-08-31","amount":19600.0,"interest":912.59,"principalPaid":18687.41,"balanceAfter":2330374.62,"payer":"dad","locked":true},
  {"date":"2025-09-30","amount":19600.0,"interest":895.97,"principalPaid":18704.03,"balanceAfter":2287553.87,"payer":"dad","locked":true},
  {"date":"2025-10-28","amount":20000,"interest":6220.89,"principalPaid":13779.11,"balanceAfter":2273774.76,"payer":"me","locked":true},
  {"date":"2025-10-29","amount":20000,"interest":220.84,"principalPaid":19779.16,"balanceAfter":2253995.6,"payer":"me","locked":true},
  {"date":"2025-11-25","amount":20000,"interest":5426.36,"principalPaid":14573.64,"balanceAfter":2220259.79,"payer":"me","locked":true},
  {"date":"2025-11-25","amount":20000,"interest":0,"principalPaid":14793.35,"balanceAfter":2200259.79,"payer":"me","locked":true},
  {"date":"2025-11-30","amount":19600,"interest":1068.48,"principalPaid":18531.52,"balanceAfter":2181728.27,"payer":"me","locked":true},
  {"date":"2025-12-25","amount":20000,"interest":5285.46,"principalPaid":14714.54,"balanceAfter":2167013.73,"payer":"me","locked":true},
  {"date":"2025-12-25","amount":20000,"interest":0,"principalPaid":20000.0,"balanceAfter":2147013.73,"payer":"me","locked":true},
  {"date":"2025-12-31","amount":19600,"interest":1215.86,"principalPaid":18384.14,"balanceAfter":2128629.59,"payer":"me","locked":true},
  {"date":"2026-01-27","amount":20000,"interest":5424.5,"principalPaid":14575.5,"balanceAfter":2114054.09,"payer":"me","locked":true},
  {"date":"2026-01-27","amount":20000,"interest":0,"principalPaid":20000.0,"balanceAfter":2094054.09,"payer":"me","locked":true},
  {"date":"2026-01-31","amount":19600,"interest":790.58,"principalPaid":18809.42,"balanceAfter":2075244.67,"payer":"me","locked":true},
  {"date":"2026-02-24","amount":20000,"interest":6274.63,"principalPaid":13725.37,"balanceAfter":2061519.3,"payer":"me","locked":true},
  {"date":"2026-02-26","amount":10000,"interest":584.57,"principalPaid":9415.43,"balanceAfter":2052103.87,"payer":"me","locked":true},
  {"date":"2026-02-28","amount":19600,"interest":581.9,"principalPaid":19018.1,"balanceAfter":2033085.77,"payer":"me","locked":true},
  {"date":"2026-03-26","amount":20000,"interest":5206.65,"principalPaid":14793.35,"balanceAfter":2018292.42,"payer":"me","locked":true},
  {"date":"2026-03-26","amount":10000,"interest":0,"principalPaid":10000.0,"balanceAfter":2008292.42,"payer":"me","locked":true},
  {"date":"2026-03-31","amount":19600,"interest":770.3,"principalPaid":18829.7,"balanceAfter":1989462.72,"payer":"me","locked":true},
  {"date":"2026-04-27","amount":20000,"interest":4120.64,"principalPaid":15879.36,"balanceAfter":1973583.36,"payer":"me","locked":true},
  {"date":"2026-04-27","amount":10000,"interest":0,"principalPaid":10000.0,"balanceAfter":1963583.36,"payer":"me","locked":true},
  {"date":"2026-04-30","amount":19600,"interest":451.89,"principalPaid":19148.11,"balanceAfter":1944435.25,"payer":"me","locked":true},
  {"date":"2026-05-26","amount":20000,"interest":3878.22,"principalPaid":16121.78,"balanceAfter":1928313.47,"payer":"me","locked":true},
  {"date":"2026-05-26","amount":10000,"interest":0,"principalPaid":10000.0,"balanceAfter":1918313.47,"payer":"me","locked":true},
  {"date":"2026-05-31","amount":19600,"interest":735.79,"principalPaid":18864.21,"balanceAfter":1899449.26,"payer":"me","locked":true},
  {"date":"2026-06-25","amount":20000,"interest":3642.78,"principalPaid":16357.22,"balanceAfter":1883092.04,"payer":"me","locked":true},
  {"date":"2026-06-25","amount":15000,"interest":0,"principalPaid":15000.0,"balanceAfter":1868092.04,"payer":"me","locked":true},
  {"date":"2026-06-30","amount":19600,"interest":716.53,"principalPaid":18883.47,"balanceAfter":1849208.57,"payer":"","locked":true,"source":"receipt-upload"}
];

function fmt(n, dec=0){
  return Number(n).toLocaleString('th-TH', {minimumFractionDigits:dec, maximumFractionDigits:dec});
}

function daysBetween(d1, d2){
  return Math.round((d2 - d1) / 86400000);
}

// แปลง Date object เป็นสตริง YYYY-MM-DD ตามเขตเวลาท้องถิ่นของเครื่อง (ไม่ใช่ UTC)
// ใช้แทน toISOString().slice(0,10) ทุกที่ เพราะ toISOString() จะคืนค่าวันที่แบบ UTC
// ซึ่งสำหรับไทย (UTC+7) จะถอยวันที่ไปเป็นเมื่อวานในช่วงเที่ยงคืน-ตี 7 หรือคลาดเคลื่อนได้ในการคำนวณวันต่อวัน
function localDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(){
  return localDateStr(new Date());
}

function thaiDate(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()+543}`;
}

// รวมดอกเบี้ยรายปี: ใช้ยอดจากหนังสือรับรองสำหรับปีที่ปิดยอดแล้ว
// และใช้รายการชำระจริงสำหรับปีถัดจากหนังสือรับรองล่าสุด เพื่อไม่ให้ยอดปัจจุบันหยุดค้างอยู่ที่ค่าคงที่
function buildAnnualInterestSummary(){
  if(typeof LoanAnalytics==='undefined') return ANNUAL_INTEREST_HISTORY.map(y=>({...y,certified:true}));
  return LoanAnalytics.buildAnnualInterestSummary(ANNUAL_INTEREST_HISTORY,state.payments,LAST_CERTIFIED_INTEREST_YEAR,thaiDate);
}

async function loadState(){
  // โหลดจากแคชในเครื่อง (localStorage) ก่อน เพื่อให้เปิดแอพได้ทันทีแม้ออฟไลน์
  const cached = localCacheGet();
  if(cached && cached.seedVersion === SEED_VERSION){
    state = cached;
    return;
  }

  // ไม่มีข้อมูลเดิม หรือยังไม่ได้รับข้อมูลย้อนหลังชุดนี้ -> โหลดประวัติย้อนหลังให้
  const lastPayment = SEED_PAYMENTS[SEED_PAYMENTS.length - 1];
  state = {
    originalPrincipal: ORIGINAL_PRINCIPAL,
    originalDate: ORIGINAL_DATE,
    trackingAnchorBalance: TRACKING_ANCHOR_BALANCE,
    trackingAnchorDate: TRACKING_ANCHOR_DATE,
    currentBalance: lastPayment.balanceAfter, // เงินต้นล้วนๆ หลังตัดงวดล่าสุด (25 มิ.ย. 2026)
    lastUpdateDate: lastPayment.date,
    payments: SEED_PAYMENTS.slice(),
    seedVersion: SEED_VERSION,
    needsImport: false
  };
  saveState();
}

function saveState(){
  localCacheSet(state);
}

// จัดเรียงรายการตามวันที่ แล้วอัปเดตยอดคงเหลือ/วันที่อัปเดตล่าสุดให้ตรงกับรายการสุดท้าย
function recomputeFromPayments(payments){
  payments = payments.slice().sort((a,b)=> a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  state.payments = payments;
  if(payments.length === 0){
    state.currentBalance = state.trackingAnchorBalance != null ? state.trackingAnchorBalance : state.originalPrincipal;
    state.lastUpdateDate = state.trackingAnchorDate != null ? state.trackingAnchorDate : state.originalDate;
  } else {
    const last = payments[payments.length - 1];
    state.currentBalance = last.balanceAfter;
    state.lastUpdateDate = last.date;
  }
}

// ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์กลาง (Google Sheets ผ่าน Apps Script)
async function syncFromServer(){
  const pass = getSavedPass();
  if(!isConfigured() || !pass){ return false; }
  syncStatus.syncing = true;
  try{
    const res = await fetch(APPS_SCRIPT_URL + '?action=list&pass=' + encodeURIComponent(pass));
    const data = await res.json();
    syncStatus.syncing = false;
    if(!data.ok){
      syncStatus.online = false;
      syncStatus.error = data.error || 'ซิงค์ไม่สำเร็จ';
      return false;
    }
    syncStatus.online = true;
    syncStatus.error = null;
    syncStatus.lastSync = new Date();
    absorbServerVersion(data);

    if(data.payments.length === 0){
      state.needsImport = true; // ระบบกลางยังไม่มีข้อมูล -> เสนอให้นำเข้าประวัติเดิม
    } else {
      state.needsImport = false;
      recomputeFromPayments(data.payments);
    }
    state.seedVersion = SEED_VERSION;
    saveState();
    return true;
  }catch(err){
    syncStatus.syncing = false;
    syncStatus.online = false;
    syncStatus.error = 'เชื่อมต่อไม่ได้ (ตรวจสอบอินเทอร์เน็ต)';
    return false;
  }
}

// นำเข้าประวัติย้อนหลังที่มีอยู่ในไฟล์นี้ (SEED_PAYMENTS) เข้าสู่ระบบกลางครั้งแรก
async function importSeedData(){
  const pass = getSavedPass();
  if(!pass) return;
  showToast('กำลังนำเข้าข้อมูล...');
  const payload = SEED_PAYMENTS.map(p => Object.assign({}, p, { id: genId() }));
  try{
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(versionedRequest({ action: 'bulkImport', pass: pass, payments: payload }))
    });
    const data = await res.json();
    if(data.ok){
      absorbServerVersion(data);
      showToast(`นำเข้าข้อมูลสำเร็จ ✓ (${data.count} รายการ)`);
      await syncFromServer();
      render();
    } else if(!(await handleServerConflict(data))){
      showToast(data.error || 'นำเข้าไม่สำเร็จ');
    }
  }catch(err){
    showToast('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง');
  }
}

// ---------- หน้ากรอกรหัสครอบครัว ----------
function renderGate(message, isLoading){
  const root = document.getElementById('gate-root');
  if(!root) return;
  root.innerHTML = `
    <div class="gate-overlay">
      <div class="gate-card">
        <div class="gate-icon">🔐</div>
        <h2>เข้าระบบครอบครัว</h2>
        <p>กรอกรหัสครอบครัวเพื่อดูและบันทึกยอดหนี้บ้าน<br>ข้อมูลจะซิงค์ตรงกันทุกคนทุกเครื่อง</p>
        <input type="password" id="gate-pass" placeholder="รหัสครอบครัว" autocomplete="off">
        <div class="gate-error">${message ? message : ''}</div>
        <button id="gate-submit" ${isLoading ? 'disabled' : ''}>${isLoading ? 'กำลังตรวจสอบ...' : 'เข้าใช้งาน'}</button>
      </div>
    </div>`;
  const input = document.getElementById('gate-pass');
  const btn = document.getElementById('gate-submit');
  function submit(){ handleGateSubmit(input.value); }
  if(btn) btn.addEventListener('click', submit);
  if(input){
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') submit(); });
    input.focus();
  }
}

function hideGate(){
  const root = document.getElementById('gate-root');
  if(root) root.innerHTML = '';
}

async function handleGateSubmit(pass){
  if(!pass){ renderGate('กรุณากรอกรหัสผ่าน'); return; }
  if(!isConfigured()){
    renderGate('ยังไม่ได้ตั้งค่าลิงก์ Apps Script ในไฟล์นี้ (ดู apps-script/README.md)');
    return;
  }
  renderGate('', true);
  try{
    const res = await fetch(APPS_SCRIPT_URL + '?action=list&pass=' + encodeURIComponent(pass));
    const data = await res.json();
    if(!data.ok){
      renderGate(data.error || 'รหัสผ่านไม่ถูกต้อง');
      return;
    }
    savePass(pass);
    hideGate();
    syncStatus.online = true;
    syncStatus.error = null;
    syncStatus.lastSync = new Date();
    absorbServerVersion(data);
    if(data.payments.length === 0){
      state.needsImport = true;
    } else {
      state.needsImport = false;
      recomputeFromPayments(data.payments);
    }
    state.seedVersion = SEED_VERSION;
    saveState();
    render();
  }catch(err){
    renderGate('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือลิงก์ Apps Script');
  }
}

function logoutFamily(){
  showConfirm('ออกจากระบบบนเครื่องนี้? (ต้องกรอกรหัสครอบครัวใหม่อีกครั้งเพื่อใช้งาน)', () => {
    clearPass();
    renderGate();
  }, 'ออกจากระบบ');
}

async function manualSync(){
  syncStatus.syncing = true;
  render();
  const ok = await syncFromServer();
  render();
  showToast(ok ? 'ซิงค์ข้อมูลล่าสุดแล้ว ✓' : (syncStatus.error || 'ซิงค์ไม่สำเร็จ'));
}

// ---------- รูดลงบนสุดของจอเพื่อรีเฟรช (Pull-to-refresh) ----------
// จำเป็นเพราะเมื่อเปิดแอพแบบ "ติดตั้งจากโฮมจอ" (standalone) ท่ารูดรีเฟรชของตัวเบราว์เซอร์เองจะหายไป
// (มันเป็นฟีเจอร์ของกรอบเบราว์เซอร์ ไม่ใช่ของหน้าเว็บ พอไม่มีกรอบเบราว์เซอร์ ท่านี้ก็หายไปด้วย)
// เลยต้องทำท่ารูดรีเฟรชเองในแอพ โดยดึงข้อมูลใหม่จากระบบกลางเหมือนปุ่ม "↻ ซิงค์"
function setupPullToRefresh(){
  const indicator = document.getElementById('ptr-indicator');
  const textEl = document.getElementById('ptr-text');
  if(!indicator || !textEl) return;

  const THRESHOLD = 70; // px ที่ต้องรูดลงถึงจะถือว่า "ปล่อยแล้วรีเฟรช"
  const MAX_PULL = 110;
  let startY = 0;
  let pulling = false;
  let ready = false;

  function scrollTopNow(){
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  window.addEventListener('touchstart', (e) => {
    if(scrollTopNow() > 0){ pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    ready = false;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if(!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if(dy <= 0 || scrollTopNow() > 0){
      pulling = false;
      indicator.style.marginTop = '-60px';
      return;
    }
    e.preventDefault(); // เข้าควบคุมท่านี้เอง แทนพฤติกรรมยืด/รีเฟรชเริ่มต้นของเบราว์เซอร์
    const pull = Math.min(dy, MAX_PULL);
    indicator.style.marginTop = (pull - 60) + 'px';
    ready = pull >= THRESHOLD;
    textEl.textContent = ready ? 'ปล่อยเพื่อรีเฟรช' : 'รูดลงเพื่อรีเฟรช';
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if(!pulling) return;
    pulling = false;
    if(ready){
      indicator.style.marginTop = '0px';
      indicator.classList.add('ptr-loading');
      textEl.textContent = 'กำลังรีเฟรช...';
      doPullRefresh(indicator, textEl);
    } else {
      indicator.style.marginTop = '-60px';
    }
    ready = false;
  }, { passive: true });
}

async function doPullRefresh(indicator, textEl){
  try{
    if(isConfigured() && getSavedPass()){
      await syncFromServer();
    }
    render();
  }catch(e){}
  setTimeout(() => {
    indicator.classList.remove('ptr-loading');
    indicator.style.marginTop = '-60px';
    textEl.textContent = 'รูดลงเพื่อรีเฟรช';
  }, 400);
}

function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;

  let hasReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(hasReloaded) return;
    hasReloaded = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    appUpdateRegistration=reg;
    if(reg.waiting&&navigator.serviceWorker.controller) showAppUpdateBanner();
    reg.addEventListener('updatefound',()=>{
      const worker=reg.installing;
      if(!worker) return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed'&&navigator.serviceWorker.controller) showAppUpdateBanner();
      });
    });
    reg.update().catch(()=>{});
  }).catch(()=>{});
}

function showAppUpdateBanner(){
  const root=document.getElementById('update-root');
  if(!root) return;
  root.innerHTML=`<div class="app-update-banner" role="status"><div><strong>มีแอปเวอร์ชันใหม่</strong><span>อัปเดตเพื่อรับฟีเจอร์และการแก้ไขล่าสุด</span></div><div><button onclick="dismissAppUpdate()">ภายหลัง</button><button class="update-now" onclick="applyAppUpdate()">อัปเดตตอนนี้</button></div></div>`;
}

function dismissAppUpdate(){
  const root=document.getElementById('update-root');
  if(root) root.innerHTML='';
}

function applyAppUpdate(){
  const waiting=appUpdateRegistration&&appUpdateRegistration.waiting;
  if(waiting) waiting.postMessage({type:'SKIP_WAITING'});
  else window.location.reload();
}


function rateOnDate(dateStr){
  const reset = new Date(RATE_RESET_DATE + 'T00:00:00');
  const d = new Date(dateStr + 'T00:00:00');
  if(d < reset) return FIXED_RATE; // ก่อนวันปรับลด ใช้อัตราที่ใบเสร็จระบุ ณ ขณะนั้น (ใกล้เคียง 2.8%)
  const fixedEnd = new Date(reset);
  fixedEnd.setFullYear(fixedEnd.getFullYear() + FIXED_PERIOD_YEARS);
  if(d < fixedEnd) return FIXED_RATE;
  const mrr = (state && state.currentMRR) ? state.currentMRR : 6.6;
  return Math.max(mrr / 100 - FLOATING_SPREAD, 0);
}

function interestOverRange(balance, fromDateStr, toDateStr){
  const from = new Date(fromDateStr + 'T00:00:00');
  const to = new Date(toDateStr + 'T00:00:00');
  const totalDays = Math.max(daysBetween(from, to), 0);
  if(totalDays === 0) return 0;
  // ถ้าอัตราดอกเบี้ยไม่เปลี่ยนระหว่างช่วงนี้ คิดแบบเดียว
  const rateStart = rateOnDate(fromDateStr);
  const rateEnd = rateOnDate(toDateStr);
  if(rateStart === rateEnd){
    return balance * rateStart / 365 * totalDays;
  }
  // อัตราเปลี่ยนระหว่างช่วง -> แบ่งคิดเป็นวันต่อวัน
  let total = 0;
  let cursor = new Date(from);
  for(let i = 0; i < totalDays; i++){
    const dStr = localDateStr(cursor);
    total += balance * rateOnDate(dStr) / 365;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function dailyInterest(balance, dateStr){
  const rate = rateOnDate(dateStr || todayStr());
  return balance * rate / 365;
}

function monthlyInterestEstimate(balance){
  return dailyInterest(balance, todayStr()) * 30;
}

function projectPayoff(balance, monthlyPayment){
  if(monthlyPayment <= 0) return null;
  let bal = balance;
  let months = 0;
  let totalInterest = 0;
  let cursor = new Date(todayStr() + 'T00:00:00');
  while(bal > 0 && months < 600){
    months++;
    cursor.setMonth(cursor.getMonth() + 1);
    const rate = rateOnDate(localDateStr(cursor));
    const monthlyRate = rate / 12;
    const interest = bal * monthlyRate;
    let principalPaid = monthlyPayment - interest;
    if(principalPaid <= 0){ return {months: Infinity, totalInterest: Infinity}; }
    if(principalPaid > bal) principalPaid = bal;
    bal -= principalPaid;
    totalInterest += interest;
  }
  return {months, totalInterest};
}

function addMonths(dateStr, n){
  const source = new Date(dateStr + 'T00:00:00');
  const wantedDay = source.getDate();
  const d = new Date(source.getFullYear(), source.getMonth() + n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(wantedDay, lastDay));
  return d;
}

function getMonthlyPaymentStats(){
  return LoanAnalytics.getMonthlyPaymentStats(state.payments,12);
}

function savePlannerPrefs(){
  try{ localStorage.setItem(PLANNER_PREFS_KEY, JSON.stringify(plannerState)); }catch(e){}
}

function ensurePlannerDefaults(avgPayment, baselineProjection){
  if(!Number.isFinite(Number(plannerState.payment)) || Number(plannerState.payment) <= 0){
    plannerState.payment = Math.round(avgPayment);
  }
  plannerState.lumpSum = Math.max(0, Number(plannerState.lumpSum) || 0);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(plannerState.targetDate || '')){
    const months = baselineProjection && Number.isFinite(baselineProjection.months) ? baselineProjection.months : 36;
    plannerState.targetDate = localDateStr(addMonths(todayStr(), Math.max(months,1)));
  }
}

function buildProjectionSchedule(balance, monthlyPayment, lumpSum=0, maxMonths=600){
  const appliedLump = Math.min(Math.max(Number(lumpSum) || 0, 0), Math.max(balance,0));
  let bal = Math.max(balance - appliedLump, 0);
  const payment = Number(monthlyPayment) || 0;
  const startDate = todayStr();
  const series = [{ date:startDate, balance:bal }];
  let totalInterest = 0;
  let months = 0;
  if(bal <= 0) return { months:0, totalInterest:0, series, appliedLump, finite:true };
  if(payment <= 0) return { months:Infinity, totalInterest:Infinity, series, appliedLump, finite:false };

  while(bal > 0.01 && months < maxMonths){
    months++;
    const paymentDate = localDateStr(addMonths(startDate, months));
    const interest = bal * rateOnDate(paymentDate) / 12;
    let principalPaid = payment - interest;
    if(principalPaid <= 0){
      return { months:Infinity, totalInterest:Infinity, series, appliedLump, finite:false };
    }
    principalPaid = Math.min(principalPaid, bal);
    bal = Math.max(bal - principalPaid, 0);
    totalInterest += interest;
    series.push({ date:paymentDate, balance:bal });
  }
  const finite = bal <= 0.01;
  return {
    months: finite ? months : Infinity,
    totalInterest: finite ? totalInterest : Infinity,
    series,
    appliedLump,
    finite
  };
}

function monthsUntilDate(targetDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '')) return 0;
  const from = new Date(todayStr() + 'T00:00:00');
  const to = new Date(targetDate + 'T00:00:00');
  if(to <= from) return 0;
  let months = (to.getFullYear()-from.getFullYear())*12 + (to.getMonth()-from.getMonth());
  if(to.getDate() < from.getDate()) months--;
  return Math.max(months, 1);
}

function requiredPaymentForMonths(balance, targetMonths){
  if(targetMonths <= 0 || balance <= 0) return balance <= 0 ? 0 : null;
  let low = 0;
  let high = Math.max(balance + monthlyInterestEstimate(balance), 1);
  for(let i=0; i<60; i++){
    const mid = (low + high) / 2;
    const result = buildProjectionSchedule(balance, mid, 0, targetMonths + 1);
    if(result.finite && result.months <= targetMonths) high = mid;
    else low = mid;
  }
  return Math.ceil(high / 10) * 10;
}

function formatMonthDuration(months){
  if(!Number.isFinite(months)) return 'ยังไม่หมดหนี้';
  if(months <= 0) return 'ทันที';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if(years && rest) return `${years} ปี ${rest} เดือน`;
  if(years) return `${years} ปี`;
  return `${rest} เดือน`;
}

function getPlannerScenario(balance, avgPayment){
  const baseline = buildProjectionSchedule(balance, avgPayment, 0);
  const planned = buildProjectionSchedule(balance, plannerState.payment, plannerState.lumpSum);
  const sameAsBaseline = Math.abs(Number(plannerState.payment)-avgPayment) < 1 && Number(plannerState.lumpSum) === 0;
  return {
    baseline,
    planned,
    monthsSaved: baseline.finite && planned.finite ? Math.max(baseline.months - planned.months, 0) : 0,
    interestSaved: sameAsBaseline ? 0 : (baseline.finite && planned.finite ? Math.max(baseline.totalInterest - planned.totalInterest, 0) : 0),
    payoffDate: planned.finite ? localDateStr(addMonths(todayStr(), planned.months)) : ''
  };
}

function buildForecastSVG(actualSeries, projection){
  if(!projection || !projection.series || projection.series.length < 2){
    return '<div class="planner-note">ยอดผ่อนยังไม่เพียงพอสำหรับสร้างแนวโน้ม</div>';
  }
  const cutoff = addMonths(todayStr(), -12);
  let actual = actualSeries.filter(p => new Date(p.date+'T00:00:00') >= cutoff);
  if(actual.length < 2) actual = actualSeries.slice(-8);
  const forecast = projection.series;
  const W=320, H=176, padL=8, padR=8, padT=18, padB=24;
  const startT = new Date(actual[0].date+'T00:00:00').getTime();
  const endT = new Date(forecast[forecast.length-1].date+'T00:00:00').getTime();
  const maxBalance = Math.max(...actual.map(p=>p.balance), ...forecast.map(p=>p.balance), 1) * 1.06;
  const xOf = date => padL + (new Date(date+'T00:00:00').getTime()-startT) / Math.max(endT-startT,1) * (W-padL-padR);
  const yOf = bal => padT + (1 - bal/maxBalance) * (H-padT-padB);
  const pathOf = pts => pts.map((p,i)=>`${i?'L':'M'}${xOf(p.date).toFixed(1)},${yOf(p.balance).toFixed(1)}`).join(' ');
  let grid='';
  for(let i=0;i<=2;i++){
    const val=maxBalance*i/2, y=yOf(val);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="rgba(180,150,80,0.14)"/>`;
    grid += `<text x="${padL+2}" y="${(y-3).toFixed(1)}" font-size="7.5" fill="#5a6378" font-family="Chakra Petch">${(val/1e6).toFixed(1)}M</text>`;
  }
  const milestones=[];
  for(const item of [{value:1000000,label:'1 ล้าน'},{value:500000,label:'5 แสน'},{value:0,label:'หมดหนี้'}]){
    if(forecast[0].balance <= item.value && item.value !== 0) continue;
    const point = item.value === 0 ? forecast[forecast.length-1] : forecast.find(p=>p.balance<=item.value);
    if(point && !milestones.some(m=>m.date===point.date)) milestones.push({ ...point, label:item.label });
  }
  const markerHtml = milestones.map((p,i)=>{
    const x=xOf(p.date), y=yOf(p.balance);
    const anchor=x>W-62?'end':'start';
    const tx=x>W-62?x-4:x+4;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#c89730" stroke="#fff" stroke-width="1.5"/><text x="${tx.toFixed(1)}" y="${Math.max(y-6,9).toFixed(1)}" text-anchor="${anchor}" font-size="7.5" fill="#8a6418" font-family="Chakra Petch">${p.label}</text>`;
  }).join('');
  const labelPoints=[actual[0], actual[actual.length-1], forecast[forecast.length-1]];
  const xLabels=labelPoints.map((p,i)=>`<text x="${xOf(p.date).toFixed(1)}" y="${H-6}" text-anchor="${i===0?'start':i===labelPoints.length-1?'end':'middle'}" font-size="7.5" fill="#5a6378" font-family="Chakra Petch">${thaiDate(p.date)}</text>`).join('');
  return `<svg class="forecast-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <path d="${pathOf(actual)}" fill="none" stroke="#16315a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${pathOf(forecast)}" fill="none" stroke="#c89730" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>
    ${markerHtml}${xLabels}
  </svg>`;
}

function analyzeDataQuality(){
  const issues=[];
  const seen=new Map();
  const payments=state.payments.slice().sort((a,b)=>a.date.localeCompare(b.date));
  let previousBalance = state.trackingAnchorBalance != null ? state.trackingAnchorBalance : state.originalPrincipal;
  let previousDate = state.trackingAnchorDate != null ? state.trackingAnchorDate : state.originalDate;
  let zeroInterestCount=0;
  payments.forEach((p,index)=>{
    const row=index+1;
    const amount=Number(p.amount), interest=Number(p.interest), principal=Number(p.principalPaid), balance=Number(p.balanceAfter);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || ![amount,interest,principal,balance].every(Number.isFinite)){
      issues.push(`รายการที่ ${row} มีข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง`);
      return;
    }
    const signature=`${p.date}|${amount.toFixed(2)}|${balance.toFixed(2)}`;
    if(seen.has(signature)) issues.push(`อาจมีรายการซ้ำวันที่ ${thaiDate(p.date)} ยอด ${fmt(amount,0)} บาท`);
    seen.set(signature,true);
    if(Math.abs((interest+principal)-amount) > 1) issues.push(`ยอดแยกต้น/ดอกไม่ตรงยอดชำระ วันที่ ${thaiDate(p.date)}`);
    const actualDrop=previousBalance-balance;
    if(Math.abs(actualDrop-principal) > 1){
      const gap=daysBetween(new Date(previousDate+'T00:00:00'),new Date(p.date+'T00:00:00'));
      issues.push(gap>45?`มีช่วงข้อมูลขาดก่อนวันที่ ${thaiDate(p.date)}`:`ยอดคงเหลือไม่ต่อเนื่อง วันที่ ${thaiDate(p.date)}`);
    }
    if(balance > previousBalance + 1) issues.push(`ยอดคงเหลือเพิ่มขึ้นผิดปกติ วันที่ ${thaiDate(p.date)}`);
    if(interest === 0 && principal > 0) zeroInterestCount++;
    previousBalance=balance;
    previousDate=p.date;
  });
  return { issues:[...new Set(issues)], zeroInterestCount };
}

function getCurrentMonthSummary(avgPayment){
  return LoanAnalytics.summarizeMonth(state.payments,todayStr(),avgPayment);
}

function setPlannerTab(tab){
  if(!['simulate','target'].includes(tab)) return;
  plannerState.tab=tab;
  savePlannerPrefs();
  render();
  requestAnimationFrame(()=>document.getElementById('planning-hub')?.scrollIntoView({block:'start'}));
}

function updatePlannerPayment(value){
  const payment=Math.max(0,Number(value)||0);
  plannerState.payment=payment;
  const numberInput=document.getElementById('planner-payment-number');
  const slider=document.getElementById('planner-payment-slider');
  if(numberInput && document.activeElement!==numberInput) numberInput.value=payment;
  if(slider) slider.value=Math.min(Math.max(payment,Number(slider.min)),Number(slider.max));
  const display=document.getElementById('planner-payment-display');
  if(display) display.textContent=`${fmt(payment,0)} บาท/เดือน`;
  savePlannerPrefs();
  refreshPlannerSimulation();
}

function updatePlannerLumpSum(value){
  plannerState.lumpSum=Math.max(0,Number(value)||0);
  const input=document.getElementById('planner-lump-number');
  if(input && document.activeElement!==input) input.value=plannerState.lumpSum;
  const display=document.getElementById('planner-lump-display');
  if(display) display.textContent=`${fmt(plannerState.lumpSum,0)} บาท`;
  document.querySelectorAll('[data-lump]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.lump)===plannerState.lumpSum));
  savePlannerPrefs();
  refreshPlannerSimulation();
}

function refreshPlannerSimulation(){
  const stats=getMonthlyPaymentStats();
  const scenario=getPlannerScenario(state.currentBalance,stats.average);
  const setText=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
  setText('planner-payoff-result',scenario.payoffDate?thaiDate(scenario.payoffDate):'ยังไม่หมดหนี้');
  setText('planner-time-result',scenario.planned.finite?formatMonthDuration(scenario.planned.months):'เพิ่มยอดผ่อน');
  setText('planner-saved-result',scenario.planned.finite?`${fmt(scenario.interestSaved,0)} บาท`:'—');
  setText('planner-months-note',scenario.planned.finite?(scenario.monthsSaved>0?`เร็วขึ้น ${formatMonthDuration(scenario.monthsSaved)}`:'เท่าแผนปัจจุบัน'):'ยอดผ่อนต่ำกว่าดอกเบี้ย');
  const chart=document.getElementById('forecast-chart');
  if(chart) chart.innerHTML=buildForecastSVG(buildBalanceSeries(),scenario.planned);
}

function updatePlannerTarget(value){
  plannerState.targetDate=value;
  savePlannerPrefs();
  render();
  requestAnimationFrame(()=>document.getElementById('planning-hub')?.scrollIntoView({block:'start'}));
}

function saveAutoSnapshot(label){
  if(!state) return;
  try{
    const history=JSON.parse(localStorage.getItem(BACKUP_HISTORY_KEY)||'[]');
    history.unshift({label:label||'ก่อนแก้ไข',createdAt:new Date().toISOString(),state:JSON.parse(JSON.stringify(state))});
    localStorage.setItem(BACKUP_HISTORY_KEY,JSON.stringify(history.slice(0,5)));
  }catch(e){}
}

function getBackupHistory(){
  try{ const data=JSON.parse(localStorage.getItem(BACKUP_HISTORY_KEY)||'[]'); return Array.isArray(data)?data:[]; }
  catch(e){ return []; }
}

function downloadBlob(content,type,filename){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

function exportPaymentsCSV(){
  const rows=[['วันที่','ยอดชำระ','ดอกเบี้ย','ตัดเงินต้น','ยอดคงเหลือ','แหล่งข้อมูล']];
  state.payments.forEach(p=>rows.push([p.date,p.amount,p.interest,p.principalPaid,p.balanceAfter,p.source||'บันทึกในแอป']));
  const csv='\ufeff'+rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  downloadBlob(csv,'text/csv;charset=utf-8',`loan-tracker-${todayStr()}.csv`);
  showToast('ดาวน์โหลด CSV แล้ว ✓');
}

function exportBackupJSON(){
  const payload={app:'loan-tracker',schemaVersion:1,exportedAt:new Date().toISOString(),state};
  downloadBlob(JSON.stringify(payload,null,2),'application/json',`loan-tracker-backup-${todayStr()}.json`);
  showToast('สำรองข้อมูลแล้ว ✓');
}

function restoreStateLocally(restoredState,label){
  saveAutoSnapshot(label||'ก่อนกู้คืนข้อมูล');
  state=JSON.parse(JSON.stringify(restoredState));
  state.seedVersion=SEED_VERSION;
  recomputeFromPayments(Array.isArray(state.payments)?state.payments:[]);
  clearPass();
  syncStatus={online:false,lastSync:null,error:'ข้อมูลกู้คืนในเครื่อง',syncing:false};
  saveState();
  render();
  showToast('กู้คืนในเครื่องแล้ว ✓ ระบบกลางยังไม่ถูกเปลี่ยน');
}

function handleBackupRestore(event){
  const file=event.target.files&&event.target.files[0];
  event.target.value='';
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result);
      const restored=parsed&&parsed.state?parsed.state:parsed;
      if(!restored || !Array.isArray(restored.payments) || !Number.isFinite(Number(restored.originalPrincipal))){
        throw new Error('invalid backup');
      }
      showConfirm('กู้คืนสำเนานี้ในเครื่อง? แอพจะออกจากระบบครอบครัวเพื่อไม่ให้ข้อมูลในระบบกลางถูกเขียนทับ',()=>restoreStateLocally(restored,'ก่อนกู้คืนจากไฟล์'),'กู้คืนข้อมูล');
    }catch(e){ showToast('ไฟล์สำรองไม่ถูกต้อง'); }
  };
  reader.readAsText(file);
}

function restoreLatestSnapshot(){
  const latest=getBackupHistory()[0];
  if(!latest || !latest.state){ showToast('ยังไม่มีประวัติก่อนแก้ไข'); return; }
  showConfirm(`ย้อนกลับไปก่อนการแก้ไขล่าสุด (${latest.label})? ระบบกลางจะไม่ถูกเปลี่ยน`,()=>restoreStateLocally(latest.state,'ก่อนย้อนกลับข้อมูล'),'ย้อนกลับ');
}

function exportPDFReport(){
  const stats=getMonthlyPaymentStats();
  const projection=buildProjectionSchedule(state.currentBalance,stats.average,0);
  const annual=buildAnnualInterestSummary();
  const paidInterest=annual.reduce((s,y)=>s+y.amount,0);
  const win=window.open('','_blank');
  if(!win){ showToast('เบราว์เซอร์ปิดกั้นหน้ารายงาน กรุณาอนุญาตป๊อปอัป'); return; }
  const annualRows=annual.map(y=>`<tr><td>ปี ${y.year+543}</td><td>${fmt(y.amount,2)} บาท</td><td>${y.source}</td></tr>`).join('');
  const paymentRows=state.payments.slice().reverse().map(p=>`<tr><td>${thaiDate(p.date)}</td><td>${fmt(p.amount,2)}</td><td>${fmt(p.interest,2)}</td><td>${fmt(p.principalPaid,2)}</td><td>${fmt(p.balanceAfter,2)}</td></tr>`).join('');
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานหนี้บ้าน ${todayStr()}</title><style>body{font-family:Arial,sans-serif;color:#10223d;margin:32px}h1{font-size:24px}h2{font-size:17px;margin-top:26px;color:#8a6418}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.box{border:1px solid #dccda8;border-radius:10px;padding:12px}.box small{display:block;color:#667085}.box strong{display:block;font-size:18px;margin-top:5px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}th,td{padding:7px;border-bottom:1px solid #e8dfca;text-align:right}th:first-child,td:first-child{text-align:left}@media print{button{display:none}body{margin:16mm}}</style></head><body><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button><h1>รายงานสรุปหนี้บ้าน</h1><p>ข้อมูล ณ ${thaiDate(todayStr())}</p><div class="summary"><div class="box"><small>เงินต้นคงเหลือ</small><strong>${fmt(state.currentBalance,2)} บาท</strong></div><div class="box"><small>ยอดผ่อนเฉลี่ย</small><strong>${fmt(stats.average,0)} บาท/เดือน</strong></div><div class="box"><small>คาดว่าหมดหนี้</small><strong>${projection.finite?thaiDate(localDateStr(addMonths(todayStr(),projection.months))):'ยังประมาณการไม่ได้'}</strong></div><div class="box"><small>ดอกเบี้ยจ่ายแล้ว</small><strong>${fmt(paidInterest,2)} บาท</strong></div><div class="box"><small>ดอกเบี้ยในอนาคต</small><strong>${projection.finite?fmt(projection.totalInterest,2):'—'} บาท</strong></div><div class="box"><small>ดอกเบี้ยตลอดสัญญาโดยประมาณ</small><strong>${projection.finite?fmt(paidInterest+projection.totalInterest,2):'—'} บาท</strong></div></div><h2>สรุปดอกเบี้ยรายปี</h2><table><thead><tr><th>ปี</th><th>ดอกเบี้ย</th><th>ที่มา</th></tr></thead><tbody>${annualRows}</tbody></table><h2>ประวัติการผ่อนชำระ</h2><table><thead><tr><th>วันที่</th><th>ยอดชำระ</th><th>ดอกเบี้ย</th><th>เงินต้น</th><th>คงเหลือ</th></tr></thead><tbody>${paymentRows}</tbody></table></body></html>`);
  win.document.close();
  setTimeout(()=>win.print(),350);
}

function buildPlannerHub(balance,avgPayment,avgBasisMonths,lifetimeInterestTotal){
  ensurePlannerDefaults(avgPayment,projectPayoff(balance,avgPayment));
  const scenario=getPlannerScenario(balance,avgPayment);
  const actualSeries=buildBalanceSeries();
  const targetMonths=monthsUntilDate(plannerState.targetDate);
  const requiredPayment=requiredPaymentForMonths(balance,targetMonths);
  const paymentDifference=requiredPayment==null?null:requiredPayment-avgPayment;
  const month=getCurrentMonthSummary(avgPayment);
  const quality=analyzeDataQuality();
  const history=getBackupHistory();
  const latestBackup=history[0];
  const maxPayment=Math.max(100000,Math.ceil(avgPayment*2/1000)*1000,Number(plannerState.payment)||0);
  const payoffDate=scenario.payoffDate?thaiDate(scenario.payoffDate):'ยังไม่หมดหนี้';
  const qualityItems=quality.issues.slice(0,3).map(x=>`<li>${x}</li>`).join('');
  const extraIssues=Math.max(quality.issues.length-3,0);
  const targetDescription=paymentDifference==null?'เลือกวันที่ในอนาคต':paymentDifference>0?`มากกว่าค่าเฉลี่ยปัจจุบัน ${fmt(paymentDifference,0)} บาท/เดือน`:`น้อยกว่าค่าเฉลี่ยปัจจุบัน ${fmt(Math.abs(paymentDifference),0)} บาท/เดือน`;

  let pane='';
  if(plannerState.tab==='simulate'){
    pane=`<div class="planner-pane" id="planner-pane-simulate">
      <div class="planner-heading">ลองปรับยอดผ่อนต่อเดือน</div>
      <div class="planner-field">
        <div class="planner-field-head"><span>ยอดผ่อน</span><strong id="planner-payment-display">${fmt(plannerState.payment,0)} บาท/เดือน</strong></div>
        <div class="planner-input-wrap"><input id="planner-payment-number" type="number" inputmode="numeric" min="1000" step="1000" value="${Math.round(plannerState.payment)}" oninput="updatePlannerPayment(this.value)"><span>บาท/เดือน</span></div>
        <input id="planner-payment-slider" class="planner-slider" type="range" min="10000" max="${maxPayment}" step="1" value="${Math.min(plannerState.payment,maxPayment)}" oninput="updatePlannerPayment(this.value)">
        <div class="planner-slider-labels"><span>10,000</span><span>${fmt(maxPayment,0)}+</span></div>
      </div>
      <div class="planner-field">
        <div class="planner-field-head"><span>เงินก้อนเพิ่ม (ไม่บังคับ)</span><strong id="planner-lump-display">${fmt(plannerState.lumpSum,0)} บาท</strong></div>
        <div class="planner-input-wrap"><input id="planner-lump-number" type="number" inputmode="numeric" min="0" step="10000" value="${Math.round(plannerState.lumpSum)}" oninput="updatePlannerLumpSum(this.value)"><span>บาท</span></div>
        <div class="planner-quick">${[0,50000,100000,200000].map(v=>`<button data-lump="${v}" class="${plannerState.lumpSum===v?'active':''}" onclick="updatePlannerLumpSum(${v})">${v===0?'ไม่เพิ่ม':'+'+fmt(v/1000,0)+'k'}</button>`).join('')}</div>
      </div>
      <div class="planner-result-grid">
        <div class="planner-result"><strong id="planner-time-result">${scenario.planned.finite?formatMonthDuration(scenario.planned.months):'เพิ่มยอดผ่อน'}</strong><span id="planner-months-note">${scenario.planned.finite?(scenario.monthsSaved>0?`เร็วขึ้น ${formatMonthDuration(scenario.monthsSaved)}`:'เท่าแผนปัจจุบัน'):'ยอดผ่อนต่ำกว่าดอกเบี้ย'}</span></div>
        <div class="planner-result"><strong class="gold" id="planner-saved-result">${scenario.planned.finite?fmt(scenario.interestSaved,0)+' บาท':'—'}</strong><span>ประหยัดดอกเบี้ย</span></div>
        <div class="planner-result"><strong id="planner-payoff-result">${payoffDate}</strong><span>คาดว่าหมดหนี้</span></div>
      </div>
      <div class="forecast-head"><strong>แนวโน้มในอนาคต</strong><div class="forecast-legend"><span><i></i>ยอดจริง</span><span><i class="dashed"></i>ประมาณการ</span></div></div>
      <div id="forecast-chart">${buildForecastSVG(actualSeries,scenario.planned)}</div>
      <div class="planner-note">ประมาณการจากเงินต้นปัจจุบัน อัตราดอกเบี้ยตามเงื่อนไขที่บันทึกไว้ และยอดผ่อนที่เลือก</div>
    </div>`;
  }else if(plannerState.tab==='target'){
    pane=`<div class="planner-pane" id="planner-pane-target">
      <div class="planner-heading">ตั้งเป้าหมายวันปลดหนี้</div>
      <div class="planner-field"><div class="planner-field-head"><span>อยากปิดหนี้ภายในวันที่</span><strong>${thaiDate(plannerState.targetDate)}</strong></div><div class="planner-input-wrap"><input type="date" min="${todayStr()}" value="${plannerState.targetDate}" onchange="updatePlannerTarget(this.value)"></div></div>
      <div class="target-result"><span>ต้องผ่อนอย่างน้อย</span><strong>${requiredPayment==null?'—':fmt(requiredPayment,0)+' บาท/เดือน'}</strong><span>${targetDescription}</span></div>
      <div class="planner-heading" style="margin-bottom:8px;">สรุปเดือนนี้</div>
      <div class="month-summary"><div><strong>${fmt(month.paid,0)}</strong><span>ยอดชำระทั้งหมด</span></div><div><strong>${fmt(month.principal,0)}</strong><span>ตัดเงินต้น</span></div><div><strong>${fmt(month.interest,0)}</strong><span>ดอกเบี้ย</span></div></div>
      <div class="month-progress"><div class="month-progress-head"><span>${month.goalMet?'ถึงเป้าหมายเดือนนี้แล้ว':'ความคืบหน้าเทียบค่าเฉลี่ย'}</span><strong>${month.pct.toFixed(0)}%</strong></div><div class="month-progress-track"><div class="month-progress-fill" style="width:${month.pct}%"></div></div></div>
      <div class="planner-note">เป้าหมายรายเดือนอ้างอิงยอดผ่อนเฉลี่ย ${fmt(avgPayment,0)} บาท (${avgBasisMonths} เดือนล่าสุด)</div>
    </div>`;
  }else{
    pane=`<div class="planner-pane" id="planner-pane-data">
      <div class="planner-heading">ข้อมูล รายงาน และการสำรอง</div>
      <div class="interest-summary"><div><strong>${scenario.baseline.finite?fmt(scenario.baseline.totalInterest,0):'—'}</strong><span>ดอกเบี้ยที่คาดว่าจะจ่ายในอนาคต</span></div><div><strong>${scenario.baseline.finite?fmt(lifetimeInterestTotal+scenario.baseline.totalInterest,0):'—'}</strong><span>ดอกเบี้ยตลอดสัญญาโดยประมาณ</span></div></div>
      <div class="quality-box ${quality.issues.length?'':'ok'}"><div class="quality-title"><span>${quality.issues.length?'พบข้อมูลที่ควรตรวจสอบ':'ข้อมูลต่อเนื่องดี'}</span><strong>${quality.issues.length?quality.issues.length+' จุด':'ผ่าน'}</strong></div>${quality.issues.length?`<ul class="quality-list">${qualityItems}${extraIssues?`<li>และอีก ${extraIssues} จุด</li>`:''}</ul>`:`<div class="planner-note" style="text-align:left;">ไม่พบรายการซ้ำหรือยอดคงเหลือขาดช่วง · มีรายการตัดเงินต้นเพิ่ม ${quality.zeroInterestCount} รายการ</div>`}</div>
      <div class="utility-grid">
        <button class="utility-btn" onclick="exportPDFReport()">รายงาน PDF<span>เปิดหน้าพิมพ์และบันทึก PDF</span></button>
        <button class="utility-btn" onclick="exportPaymentsCSV()">ส่งออก CSV<span>ประวัติทุกรายการ</span></button>
        <button class="utility-btn" onclick="exportBackupJSON()">สำรองข้อมูล<span>ไฟล์ JSON สำหรับกู้คืน</span></button>
        <button class="utility-btn" onclick="document.getElementById('backup-restore-input').click()">กู้คืนข้อมูล<span>กู้คืนในเครื่องอย่างปลอดภัย</span></button>
        <button class="utility-btn" onclick="restoreLatestSnapshot()" style="grid-column:1/-1;">ย้อนกลับการแก้ไขล่าสุด<span>${latestBackup?`${latestBackup.label} · ${new Date(latestBackup.createdAt).toLocaleString('th-TH')}`:'ยังไม่มีประวัติการแก้ไข'}</span></button>
      </div>
      <input id="backup-restore-input" type="file" accept="application/json,.json" style="display:none" onchange="handleBackupRestore(event)">
      <div class="backup-meta">ไฟล์สำรองเก็บข้อมูลหนี้และประวัติการผ่อนทั้งหมด · การกู้คืนไม่เขียนทับระบบกลางอัตโนมัติ</div>
    </div>`;
  }

  return `<section class="planner-shell" id="planning-hub" aria-label="เครื่องมือวางแผนปลดหนี้"><div class="planner-tabs planner-tabs-two" role="tablist"><button class="planner-tab ${plannerState.tab==='simulate'?'active':''}" role="tab" aria-selected="${plannerState.tab==='simulate'}" onclick="setPlannerTab('simulate')">จำลองยอดผ่อน</button><button class="planner-tab ${plannerState.tab==='target'?'active':''}" role="tab" aria-selected="${plannerState.tab==='target'}" onclick="setPlannerTab('target')">ตั้งเป้าหมาย</button></div>${pane}</section>`;
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 2200);
}

function showConfirm(message, onConfirm, confirmLabel='ลบรายการ'){
  const overlay = document.getElementById('confirm-overlay');
  const textEl = document.getElementById('confirm-text');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  textEl.textContent = message;
  okBtn.textContent = confirmLabel;
  overlay.classList.add('show');

  function close(){
    overlay.classList.remove('show');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    overlay.removeEventListener('click', onOverlayClick);
  }
  function onOk(){
    close();
    onConfirm();
  }
  function onCancel(){
    close();
  }
  function onOverlayClick(e){
    if(e.target === overlay) close();
  }
  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  overlay.addEventListener('click', onOverlayClick);
}

// ---------- กราฟแนวโน้มยอดหนี้ ----------
let chartRangeMonths = 0; // 0 = ทั้งหมด

// สร้างชุดข้อมูลจุดบนกราฟ: เริ่มจากจุดอ้างอิง (ยอดกู้/anchor) แล้วตามด้วย balanceAfter ของแต่ละงวด
// บวกจุดสุดท้าย = ยอดเรียลไทม์วันนี้ เพื่อให้เส้นลากมาถึงปัจจุบัน
function buildBalanceSeries(){
  const pts = [];
  const anchorBal = state.trackingAnchorBalance != null ? state.trackingAnchorBalance : state.originalPrincipal;
  const anchorDate = state.trackingAnchorDate != null ? state.trackingAnchorDate : state.originalDate;
  pts.push({ date: anchorDate, balance: anchorBal });
  for(const p of state.payments){
    pts.push({ date: p.date, balance: p.balanceAfter });
  }
  // จุดปัจจุบัน (เงินต้นล่าสุด — ไม่รวมดอกเบี้ยค้าง เพื่อให้เทียบกับ balanceAfter ในอดีตได้ตรงกัน)
  const today = todayStr();
  if(state.payments.length === 0 || today > state.payments[state.payments.length-1].date){
    pts.push({ date: today, balance: state.currentBalance });
  }
  return pts;
}

function filterSeriesByRange(series){
  if(!chartRangeMonths || series.length === 0) return series;
  const last = new Date(series[series.length-1].date + 'T00:00:00');
  const cutoff = new Date(last);
  cutoff.setMonth(cutoff.getMonth() - chartRangeMonths);
  const filtered = series.filter(p => new Date(p.date+'T00:00:00') >= cutoff);
  return filtered.length >= 2 ? filtered : series.slice(-2);
}

function buildChartSVG(series){
  const W = 320, H = 150;
  const padL = 8, padR = 8, padT = 12, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const times = series.map(p => new Date(p.date+'T00:00:00').getTime());
  const bals = series.map(p => p.balance);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const bMaxRaw = Math.max(...bals), bMinRaw = Math.min(...bals);
  // เพิ่มขอบบน/ล่างเล็กน้อยให้เส้นไม่ชนขอบ
  const span = (bMaxRaw - bMinRaw) || bMaxRaw || 1;
  const bMax = bMaxRaw + span*0.08;
  const bMin = Math.max(0, bMinRaw - span*0.08);

  const xOf = t => padL + (tMax===tMin ? plotW/2 : (t - tMin)/(tMax - tMin) * plotW);
  const yOf = b => padT + (bMax===bMin ? plotH/2 : (1 - (b - bMin)/(bMax - bMin)) * plotH);

  const coords = series.map((p,i) => ({ x: xOf(times[i]), y: yOf(p.balance), p }));

  const linePath = coords.map((c,i)=> (i===0?'M':'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${coords[coords.length-1].x.toFixed(1)},${(padT+plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT+plotH).toFixed(1)} Z`;

  // เส้นกริดแนวนอน 3 เส้น + ป้ายค่า (ย่อเป็นล้าน)
  let grid = '';
  const gridN = 3;
  for(let g=0; g<=gridN; g++){
    const val = bMin + (bMax - bMin) * g/gridN;
    const y = yOf(val);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W-padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(180,150,80,0.14)" stroke-width="1"/>`;
    grid += `<text x="${padL+2}" y="${(y-3).toFixed(1)}" font-size="8" fill="#5a6378" font-family="Chakra Petch">${(val/1e6).toFixed(2)}M</text>`;
  }

  // ป้ายแกน x แบบปรับอัตโนมัติ: ช่วงสั้นแสดงเดือน+ปี ช่วงยาวแสดงปี เว้นระยะไม่ให้ทับกัน
  const monthsShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const spanDays = (tMax - tMin) / 86400000;
  const showMonth = spanDays <= 400; // ~13 เดือน
  let xlabels = '';
  const usedX = []; // กันป้ายซ้อนกัน
  const minGap = showMonth ? 34 : 28; // ระยะห่างขั้นต่ำระหว่างป้าย (px ใน viewBox)
  function placeLabel(x, txt){
    if(usedX.some(ux => Math.abs(ux - x) < minGap)) return;
    usedX.push(x);
    xlabels += `<text x="${x.toFixed(1)}" y="${(H-6)}" font-size="8" fill="#5a6378" text-anchor="middle" font-family="Chakra Petch">${txt}</text>`;
  }
  if(showMonth){
    // แสดงเดือนของแต่ละจุด (เว้นระยะอัตโนมัติ) รูปแบบ "ม.ค. 68"
    coords.forEach((c,i)=>{
      const dt = new Date(times[i]);
      const yy = String((dt.getFullYear()+543) % 100).padStart(2,'0');
      placeLabel(c.x, `${monthsShort[dt.getMonth()]} ${yy}`);
    });
  } else {
    // แสดงปีเมื่อปีเปลี่ยน
    let lastYear = null;
    coords.forEach((c,i)=>{
      const yr = new Date(times[i]).getFullYear();
      if(yr !== lastYear){ lastYear = yr; placeLabel(c.x, String(yr+543)); }
    });
  }

  // จุด interactive (วงกลมโปร่ง คลิก/แตะเพื่อดู tooltip)
  const dots = coords.map((c,i)=>{
    const d = c.p.date, b = c.p.balance;
    return `<circle class="ch-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="9" fill="transparent" data-x="${c.x.toFixed(1)}" data-y="${c.y.toFixed(1)}" data-date="${d}" data-bal="${b}" style="cursor:pointer"/>`;
  }).join('');

  // จุดสุดท้าย เน้นเป็นจุดทอง
  const lastC = coords[coords.length-1];

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="chArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(200,151,48,0.28)"/>
        <stop offset="100%" stop-color="rgba(200,151,48,0.02)"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${areaPath}" fill="url(#chArea)" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="#c89730" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xlabels}
    <circle cx="${lastC.x.toFixed(1)}" cy="${lastC.y.toFixed(1)}" r="3.5" fill="#16315a" stroke="#e3b94a" stroke-width="1.5"/>
    ${dots}
  </svg>`;
}

function attachChartInteract(){
  const wrap = document.getElementById('chart-wrap');
  if(!wrap) return;
  const tip = document.getElementById('chart-tip');
  const dots = wrap.querySelectorAll('.ch-dot');
  const svg = wrap.querySelector('svg');

  function showTip(dot){
    const date = dot.getAttribute('data-date');
    const bal = parseFloat(dot.getAttribute('data-bal'));
    // แปลงพิกัด viewBox -> พิกัดจริงใน wrap
    const rect = svg.getBoundingClientRect();
    const vbX = parseFloat(dot.getAttribute('data-x'));
    const vbY = parseFloat(dot.getAttribute('data-y'));
    const px = (vbX/320) * rect.width;
    const py = (vbY/150) * rect.height;
    tip.innerHTML = `${thaiDate(date)}<br>คงเหลือ <b>${fmt(bal,0)}</b> บาท`;
    tip.style.left = px + 'px';
    tip.style.top = (py - 8) + 'px';
    tip.style.opacity = '1';
  }
  function hideTip(){ tip.style.opacity = '0'; }

  dots.forEach(dot=>{
    dot.addEventListener('mouseenter', ()=>showTip(dot));
    dot.addEventListener('mouseleave', hideTip);
    dot.addEventListener('click', (e)=>{ e.stopPropagation(); showTip(dot); });
    dot.addEventListener('touchstart', (e)=>{ showTip(dot); }, {passive:true});
  });
  wrap.addEventListener('click', (e)=>{ if(e.target.tagName!=='circle') hideTip(); });
}

// ปีที่เปิดดูรายละเอียดในประวัติ (เริ่มต้นเปิดปีล่าสุดปีเดียว)
let expandedYears = null; // Set ของปี ค.ศ.

function toggleYear(year){
  if(!expandedYears) expandedYears = new Set();
  if(expandedYears.has(year)) expandedYears.delete(year);
  else expandedYears.add(year);
  render();
}

function setChartRange(months){
  chartRangeMonths = months;
  render();
}

function buildChartCard(){
  const fullSeries = buildBalanceSeries();
  const series = filterSeriesByRange(fullSeries);

  // สถิติประกอบกราฟ
  const startBal = series[0].balance;
  const endBal = series[series.length-1].balance;
  const dropped = startBal - endBal;
  const startD = new Date(series[0].date+'T00:00:00');
  const endD = new Date(series[series.length-1].date+'T00:00:00');
  const months = Math.max(1, (endD.getFullYear()-startD.getFullYear())*12 + (endD.getMonth()-startD.getMonth()));
  const perMonth = dropped / months;

  const ranges = [
    { m: 3,  label: '3 ด.' },
    { m: 6,  label: '6 ด.' },
    { m: 12, label: '1 ปี' },
    { m: 36, label: '3 ปี' },
    { m: 60, label: '5 ปี' },
    { m: 0,  label: 'ทั้งหมด' },
  ];
  const rangeBtns = ranges.map(r =>
    `<button class="${chartRangeMonths===r.m?'active':''}" onclick="setChartRange(${r.m})">${r.label}</button>`
  ).join('');

  return `
  <div class="section-title">แนวโน้มยอดหนี้</div>
  <div class="chart-card">
    <div class="chart-head">
      <span class="chart-caption">เงินต้นคงเหลือตามใบเสร็จจริง (${thaiDate(series[0].date)} – ปัจจุบัน)</span>
    </div>
    <div class="chart-range">${rangeBtns}</div>
    <div class="chart-wrap" id="chart-wrap">
      ${buildChartSVG(series)}
      <div class="chart-tip" id="chart-tip"></div>
    </div>
    <div class="chart-legend">
      <span><i style="background:#c89730"></i> เงินต้นคงเหลือ</span>
      <span>แตะจุดบนเส้นเพื่อดูยอดแต่ละงวด</span>
    </div>
    <div class="chart-stat-row">
      <div class="chart-stat">
        <div class="cs-val gold">${fmt(dropped,0)}</div>
        <div class="cs-lbl">เงินต้นลดลง (ช่วงนี้)</div>
      </div>
      <div class="chart-stat">
        <div class="cs-val">${fmt(perMonth,0)}</div>
        <div class="cs-lbl">ลดเฉลี่ย/เดือน</div>
      </div>
      <div class="chart-stat">
        <div class="cs-val">${months}</div>
        <div class="cs-lbl">เดือน</div>
      </div>
    </div>
  </div>`;
}

function buildCategoryNav(){
  const pages=[
    {id:'overview',label:'ภาพรวม'},
    {id:'plan',label:'แผนปลดหนี้'},
    {id:'history',label:'ประวัติ'},
    {id:'settings',label:'ตั้งค่า'}
  ];
  return `<nav class="category-nav" aria-label="หมวดหมู่หลัก">${pages.map(page=>`<button class="category-tab ${uiState.page===page.id?'active':''}" aria-current="${uiState.page===page.id?'page':'false'}" onclick="setAppPage('${page.id}')">${page.label}</button>`).join('')}</nav>`;
}

function buildPageHeading(title,description){
  return `<header class="page-heading"><h2>${title}</h2><p>${description}</p></header>`;
}

function thaiMonthYear(monthKey){
  const names=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const [year,month]=String(monthKey).split('-').map(Number);
  return `${names[Math.max(0,month-1)]} ${year+543}`;
}

function buildCurrentMonthCard(avgPayment){
  const summary=getCurrentMonthSummary(avgPayment);
  const status=summary.goalMet?'ถึงค่าเฉลี่ยแล้ว':`เหลืออีก ${fmt(summary.remaining,0)} บาทถึงค่าเฉลี่ย`;
  return `<section class="month-summary-card" aria-label="สรุปเดือนนี้"><div class="month-summary-head"><div><h3>สรุปเดือนนี้</h3><span>${thaiMonthYear(summary.key)}</span></div><strong>${fmt(summary.paid,0)} <small>บาท</small></strong></div><div class="month-summary-metrics"><div><span>เงินต้น</span><strong>${fmt(summary.principal,0)}</strong></div><div><span>ดอกเบี้ย</span><strong>${fmt(summary.interest,0)}</strong></div><div><span>เป้าหมายเฉลี่ย</span><strong>${fmt(avgPayment,0)}</strong></div></div><div class="month-progress"><div><span style="width:${summary.pct}%"></span></div><p><strong>${Math.round(summary.pct)}%</strong> ของค่าเฉลี่ย 12 เดือน · ${status}</p></div></section>`;
}

function buildPrincipalInterestChart(){
  const series=LoanAnalytics.buildMonthlySeries(state.payments,todayStr(),12);
  const maxAmount=Math.max(...series.map(row=>row.amount),1);
  const bars=series.map(row=>{
    const totalHeight=row.amount/maxAmount*100;
    const interestPct=row.amount>0?row.interest/row.amount*100:0;
    const principalPct=row.amount>0?row.principal/row.amount*100:0;
    const [year]=row.key.split('-').map(Number);
    const month=thaiMonthYear(row.key).split(' ')[0];
    return `<div class="split-chart-column" title="${thaiMonthYear(row.key)} · เงินต้น ${fmt(row.principal,0)} · ดอกเบี้ย ${fmt(row.interest,0)}"><div class="split-chart-track"><div class="split-chart-stack" style="height:${totalHeight}%"><span class="split-interest" style="height:${interestPct}%"></span><span class="split-principal" style="height:${principalPct}%"></span></div></div><span>${month}<small>${String(year+543).slice(-2)}</small></span></div>`;
  }).join('');
  return `<section class="split-chart-card" aria-label="เงินต้นเทียบดอกเบี้ย 12 เดือน"><div class="split-chart-head"><h3>เงินต้นเทียบดอกเบี้ย 12 เดือน</h3><div><span><i class="principal"></i>เงินต้น</span><span><i class="interest"></i>ดอกเบี้ย</span></div></div><div class="split-chart-plot">${bars}</div><p>รวมยอดชำระจริงรายเดือน · แตะแท่งเพื่อดูรายละเอียด</p></section>`;
}

function buildRecentPayments(){
  const recent=LoanAnalytics.orderPaymentEntries(state.payments).slice(0,5).map(entry=>entry.payment);
  if(!recent.length) return '';
  return `<section class="recent-card" aria-label="การชำระล่าสุด 5 ครั้ง"><div class="recent-head"><h3>การชำระล่าสุด 5 ครั้ง</h3><button onclick="setAppPage('history')">ดูประวัติทั้งหมด</button></div>${recent.map(payment=>`<div class="recent-row"><div><strong>${thaiDate(payment.date)}</strong><span>ดอกเบี้ย ${fmt(payment.interest)} · เงินต้น ${fmt(payment.principalPaid)}</span></div><div><strong>-${fmt(payment.amount)} บาท</strong><span>คงเหลือ ${fmt(payment.balanceAfter)}</span></div></div>`).join('')}</section>`;
}

function buildLatestAnnualInterestCard(annualInterestSummary){
  const latest=annualInterestSummary[annualInterestSummary.length-1];
  if(!latest) return '';
  const cutoff=latest.lastPaymentDate||`${latest.year}-12-31`;
  const comparison=LoanAnalytics.compareInterestYTD(state.payments,latest.year,cutoff);
  const hasPrevious=comparison.previousAmount>0;
  const deltaText=hasPrevious?`${comparison.delta<=0?'ลดลง':'เพิ่มขึ้น'} ${fmt(Math.abs(comparison.delta),2)} บาท (${Math.abs(comparison.pct).toFixed(1)}%)`:'ยังไม่มีข้อมูลช่วงเดียวกันของปีก่อน';
  return `<section class="overview-interest-card" aria-label="สรุปดอกเบี้ยปีล่าสุด"><div class="overview-interest-head"><div><span>สรุปดอกเบี้ยปีล่าสุด</span><strong>ปี ${latest.year+543}</strong></div><button onclick="setAppPage('history')">ดูรายปีทั้งหมด</button></div><div class="overview-interest-summary"><span>ดอกเบี้ยจ่ายแล้ว</span><strong>${fmt(latest.amount,2)} บาท</strong><small>${latest.source}</small></div><div class="interest-comparison"><div><span>เทียบช่วงเดียวกันของปี ${comparison.previousYear+543}</span><strong class="${comparison.delta<=0?'good':'bad'}">${deltaText}</strong></div><div><span>คาดการณ์ทั้งปี</span><strong>${fmt(comparison.projected,0)} บาท</strong></div></div></section>`;
}

function buildAnnualInterestCard(annualInterestSummary,lifetimeInterestTotal,lifetimeInterestAsOf){
  const latest=annualInterestSummary[annualInterestSummary.length-1];
  return `<div class="section-title">สรุปดอกเบี้ยรายปี</div><details class="form-card annual-interest-card annual-interest-details"><summary><div><span>ปีล่าสุด ${latest?latest.year+543:'—'}</span><strong>${latest?fmt(latest.amount,2):'—'} บาท</strong></div><div><span>ดอกเบี้ยสะสม</span><strong>${fmt(lifetimeInterestTotal,2)} บาท</strong></div><small>แตะเพื่อดูรายปีทั้งหมด</small></summary><div class="annual-interest-list">${annualInterestSummary.map(y=>`<div class="annual-interest-row"><span>ปี ${y.year+543}</span><span><strong>${fmt(y.amount,2)} บาท</strong><small>${y.source}</small></span></div>`).join('')}<div class="annual-interest-total"><span>รวมทั้งหมด${lifetimeInterestAsOf?`ถึง ${thaiDate(lifetimeInterestAsOf)}`:''}</span><strong>${fmt(lifetimeInterestTotal,2)} บาท</strong></div></div></details>`;
}

function escapeHtml(value){
  return String(value==null?'':value).replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function receiptKeyForPayment(payment){
  if(payment&&payment.id) return String(payment.id);
  const p=payment||{};
  return `legacy:${p.date||''}:${Number(p.amount||0).toFixed(2)}:${Number(p.balanceAfter||0).toFixed(2)}:${Number(p.principalPaid||0).toFixed(2)}`;
}

function getHistoryEntries(){
  return LoanAnalytics.orderPaymentEntries(state.payments).map(entry=>Object.assign({},entry,{
    receiptKey:receiptKeyForPayment(entry.payment),
    payment:Object.assign({},entry.payment,{receiptKey:receiptKeyForPayment(entry.payment),searchText:thaiDate(entry.payment.date)})
  }));
}

function getFilteredHistoryEntries(){
  return LoanAnalytics.filterPaymentEntries(getHistoryEntries(),historyFilters,[...receiptAttachmentMeta.keys()]);
}

function buildHistoryFilterCard(totalCount,filteredCount){
  const years=[...new Set(state.payments.map(payment=>String(payment.date||'').slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  return `<section class="history-filter-card" aria-label="ค้นหาและกรองประวัติ"><label class="history-search"><span>ค้นหารายการ</span><input type="search" value="${escapeHtml(historyFilters.query)}" placeholder="วันที่ หรือจำนวนเงิน" oninput="setHistoryQuery(this.value)"></label><div class="history-filter-controls"><label><span>ปี</span><select onchange="setHistoryYear(this.value)"><option value="all">ทุกปี</option>${years.map(year=>`<option value="${year}" ${historyFilters.year===year?'selected':''}>ปี ${Number(year)+543}</option>`).join('')}</select></label><label><span>ประเภท</span><select onchange="setHistoryType(this.value)"><option value="all" ${historyFilters.type==='all'?'selected':''}>ทุกรายการ</option><option value="regular" ${historyFilters.type==='regular'?'selected':''}>ผ่อนปกติ</option><option value="extra" ${historyFilters.type==='extra'?'selected':''}>ตัดเงินต้นเพิ่ม</option><option value="receipt" ${historyFilters.type==='receipt'?'selected':''}>มีใบเสร็จ</option></select></label></div><div class="history-filter-foot"><strong id="history-result-count">พบ ${filteredCount} จาก ${totalCount} รายการ</strong><span>รูปใบเสร็จเก็บเฉพาะเครื่องนี้</span></div><input id="history-receipt-input" type="file" accept="application/pdf,image/*" hidden onchange="handleHistoryReceiptAttachment(event)"></section>`;
}

function buildHistoryResultsHtml(entries){
  if(!entries.length) return `<div class="history-empty">${state.payments.length?'ไม่พบรายการที่ตรงกับตัวกรอง':'ยังไม่มีประวัติการผ่อนชำระ<br>เริ่มบันทึกครั้งแรกได้เลย'}</div>`;
  const groups={};
  entries.forEach(entry=>{
    const year=Number(String(entry.payment.date||'').slice(0,4));
    (groups[year]=groups[year]||[]).push(entry);
  });
  const years=Object.keys(groups).map(Number).sort((a,b)=>b-a);
  if(expandedYears===null) expandedYears=new Set([years[0]]);
  const filtering=historyFilters.query.trim()||historyFilters.year!=='all'||historyFilters.type!=='all';
  return years.map(year=>{
    const items=groups[year];
    const total=items.reduce((sum,entry)=>sum+Number(entry.payment.amount||0),0);
    const endBalance=items[0].payment.balanceAfter;
    const isOpen=filtering||expandedYears.has(year);
    const rows=items.map(entry=>{
      const payment=entry.payment;
      const synced=isConfigured()&&!!getSavedPass();
      const showDelete=canDeletePayment(payment)&&(!synced||entry.index===state.payments.length-1);
      const hasReceipt=receiptAttachmentMeta.has(entry.receiptKey);
      const encodedKey=encodeURIComponent(entry.receiptKey);
      return `<div class="history-item"><div class="hi-left"><div class="hi-date">${thaiDate(payment.date)}</div><div class="hi-meta">ดอกเบี้ย ${fmt(payment.interest)} · เงินต้น ${fmt(payment.principalPaid)}</div><div class="hi-actions"><button class="receipt-action ${hasReceipt?'attached':''}" onclick="event.stopPropagation(); ${hasReceipt?'openReceiptAttachment':'chooseReceiptForPayment'}(decodeURIComponent('${encodedKey}'))">${hasReceipt?'ดูใบเสร็จ':'แนบใบเสร็จ'}</button></div></div><div class="hi-right"><div><div class="hi-amount">-${fmt(payment.amount)} บาท</div><div class="hi-balance">คงเหลือ ${fmt(payment.balanceAfter)}</div></div>${showDelete?`<button class="delete-btn" onclick="event.stopPropagation(); deletePayment(${entry.index})">ลบ</button>`:''}</div></div>`;
    }).join('');
    return `<div class="year-group ${isOpen?'open':''}"><div class="year-head" onclick="toggleYear(${year})"><div class="yh-left"><span class="yh-chevron">▶</span><span class="yh-year">ปี ${year+543}</span><span class="yh-count">${items.length} งวด</span></div><div class="yh-right"><div class="yh-paid">${fmt(total,0)} บาท</div><div class="yh-endbal">คงเหลือสิ้นปี ${fmt(endBalance,0)}</div></div></div><div class="year-body">${rows}</div></div>`;
  }).join('');
}

function refreshHistoryResults(){
  const root=document.getElementById('history-results-root');
  const entries=getFilteredHistoryEntries();
  if(root) root.innerHTML=buildHistoryResultsHtml(entries);
  const count=document.getElementById('history-result-count');
  if(count) count.textContent=`พบ ${entries.length} จาก ${state.payments.length} รายการ`;
}

function setHistoryQuery(value){ historyFilters.query=value; refreshHistoryResults(); }
function setHistoryYear(value){ historyFilters.year=value; refreshHistoryResults(); }
function setHistoryType(value){ historyFilters.type=value; refreshHistoryResults(); }

function formatFileSize(bytes){
  const size=Number(bytes||0);
  if(size<1024) return `${size} B`;
  if(size<1024*1024) return `${(size/1024).toFixed(1)} KB`;
  return `${(size/1024/1024).toFixed(1)} MB`;
}

async function loadReceiptAttachmentMeta(){
  if(typeof ReceiptStore==='undefined') return;
  try{
    const items=await ReceiptStore.listMeta();
    receiptAttachmentMeta=new Map(items.map(item=>[String(item.paymentId),item]));
  }catch(error){
    console.warn('Receipt metadata unavailable:',error);
  }
}

async function imageSourceFromFile(file){
  if(typeof createImageBitmap==='function'){
    const bitmap=await createImageBitmap(file);
    return {image:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close()};
  }
  const url=URL.createObjectURL(file);
  const image=await new Promise((resolve,reject)=>{
    const element=new Image();
    element.onload=()=>resolve(element);
    element.onerror=()=>reject(new Error('เปิดรูปใบเสร็จไม่สำเร็จ'));
    element.src=url;
  });
  return {image,width:image.naturalWidth,height:image.naturalHeight,cleanup:()=>URL.revokeObjectURL(url)};
}

async function prepareReceiptArchiveRecord(file,paymentId){
  const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  const isImage=file.type.startsWith('image/');
  if(!isPdf&&!isImage) throw new Error('รองรับไฟล์ PDF, JPG, PNG และ WebP');
  if(file.size>15*1024*1024) throw new Error('ไฟล์มีขนาดเกิน 15 MB');
  let blob=file;
  let name=file.name||`ใบเสร็จ.${isPdf?'pdf':'jpg'}`;
  if(isImage){
    const source=await imageSourceFromFile(file);
    try{
      const scale=Math.min(1,1800/Math.max(source.width,source.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(source.width*scale));
      canvas.height=Math.max(1,Math.round(source.height*scale));
      const context=canvas.getContext('2d');
      context.drawImage(source.image,0,0,canvas.width,canvas.height);
      const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
      if(compressed){ blob=compressed; name=name.replace(/\.[^.]+$/,'.jpg'); }
    }finally{
      source.cleanup();
    }
  }
  return {paymentId:String(paymentId),name,type:blob.type||(isPdf?'application/pdf':'image/jpeg'),size:blob.size,createdAt:new Date().toISOString(),blob};
}

async function storeReceiptForPayment(paymentId,file){
  if(typeof ReceiptStore==='undefined') throw new Error('โหลดคลังใบเสร็จไม่สำเร็จ');
  const record=await prepareReceiptArchiveRecord(file,paymentId);
  await ReceiptStore.save(record);
  receiptAttachmentMeta.set(String(paymentId),{
    paymentId:String(paymentId),name:record.name,type:record.type,size:record.size,createdAt:record.createdAt
  });
  return record;
}

function chooseReceiptForPayment(paymentId){
  pendingReceiptTargetId=String(paymentId);
  const input=document.getElementById('history-receipt-input');
  if(input) input.click();
}

async function handleHistoryReceiptAttachment(event){
  const file=event.target.files&&event.target.files[0];
  event.target.value='';
  const paymentId=pendingReceiptTargetId;
  pendingReceiptTargetId=null;
  if(!file||!paymentId) return;
  showToast('กำลังเก็บใบเสร็จในเครื่องนี้...');
  try{
    await storeReceiptForPayment(paymentId,file);
    refreshHistoryResults();
    showToast('แนบใบเสร็จแล้ว ✓ เก็บเฉพาะเครื่องนี้');
  }catch(error){
    showToast(error.message||'เก็บใบเสร็จไม่สำเร็จ');
  }
}

async function openReceiptAttachment(paymentId){
  try{
    const record=await ReceiptStore.get(String(paymentId));
    if(!record){
      receiptAttachmentMeta.delete(String(paymentId));
      refreshHistoryResults();
      showToast('ไม่พบไฟล์ใบเสร็จในเครื่องนี้');
      return;
    }
    closeReceiptViewer();
    currentReceiptViewer=record;
    currentReceiptObjectUrl=URL.createObjectURL(record.blob);
    const payment=state.payments.find(item=>receiptKeyForPayment(item)===String(paymentId));
    document.getElementById('receipt-viewer-title').textContent=payment?`ใบเสร็จ ${thaiDate(payment.date)}`:'ใบเสร็จ';
    const preview=document.getElementById('receipt-viewer-preview');
    preview.innerHTML=String(record.type||'').startsWith('image/')?`<img src="${currentReceiptObjectUrl}" alt="รูปใบเสร็จ">`:`<div class="receipt-pdf-preview"><strong>PDF</strong><span>แตะ “เปิดไฟล์” เพื่อดูใบเสร็จ</span></div>`;
    document.getElementById('receipt-viewer-meta').textContent=`${record.name} · ${formatFileSize(record.size)}`;
    document.getElementById('receipt-viewer-open').onclick=()=>window.open(currentReceiptObjectUrl,'_blank','noopener');
    document.getElementById('receipt-viewer-delete').onclick=removeCurrentReceiptAttachment;
    document.getElementById('receipt-viewer-overlay').classList.add('show');
  }catch(error){
    showToast(error.message||'เปิดใบเสร็จไม่สำเร็จ');
  }
}

function closeReceiptViewer(){
  const overlay=document.getElementById('receipt-viewer-overlay');
  if(overlay) overlay.classList.remove('show');
  if(currentReceiptObjectUrl) URL.revokeObjectURL(currentReceiptObjectUrl);
  currentReceiptObjectUrl='';
  currentReceiptViewer=null;
}

function removeCurrentReceiptAttachment(){
  if(!currentReceiptViewer) return;
  const paymentId=String(currentReceiptViewer.paymentId);
  showConfirm('ลบไฟล์ใบเสร็จจากเครื่องนี้? รายการผ่อนจะยังอยู่',async()=>{
    try{
      await ReceiptStore.remove(paymentId);
      receiptAttachmentMeta.delete(paymentId);
      closeReceiptViewer();
      refreshHistoryResults();
      showToast('ลบไฟล์ใบเสร็จแล้ว');
    }catch(error){ showToast('ลบไฟล์ไม่สำเร็จ'); }
  },'ลบไฟล์');
}

function buildPaymentForm(){
  return `<div class="section-title">บันทึกการผ่อนชำระ</div><details class="form-card payment-form-details"><summary><div><strong>+  เพิ่มรายการชำระ</strong><span>กรอกยอดเอง หรืออ่านจาก PDF / รูปใบเสร็จ</span></div><small>แตะเพื่อเปิด</small></summary><div class="payment-form-body"><div class="form-row"><label>วันที่ชำระ</label><input type="date" id="pay-date" value="${todayStr()}"><div class="date-thai" id="date-thai"></div></div><div class="form-row"><label>จำนวนเงินที่ชำระ (บาท)</label><input type="number" id="pay-amount" placeholder="เช่น 19600" inputmode="decimal" value=""></div><div class="preview-box" id="preview-box"></div><div class="btn-row payment-submit-row"><button class="btn btn-primary" onclick="submitPayment()">บันทึกการผ่อน</button></div><div class="receipt-upload-row"><div class="ru-label">หรือเลือกใบเสร็จ SCB แบบ PDF หรือรูปถ่าย แอพจะอ่านข้อมูลในเครื่องนี้โดยไม่อัปโหลดไฟล์</div><button class="btn-upload" id="receipt-upload-btn" onclick="document.getElementById('receipt-file-input').click()">🧾 PDF / รูปภาพ</button><input type="file" id="receipt-file-input" accept="application/pdf,image/*" style="display:none" onchange="handleReceiptFile(event)"></div></div></details>`;
}

function buildSettingsPage(balance,avgPayment,lifetimeInterestTotal){
  const quality=analyzeDataQuality();
  const latestBackup=getBackupHistory()[0];
  const projection=buildProjectionSchedule(balance,avgPayment,0);
  const qualityItems=quality.issues.slice(0,3).map(issue=>`<li>${issue}</li>`).join('');
  const extraIssues=Math.max(quality.issues.length-3,0);
  const fontOptions=[
    {id:'normal',sample:'Aa',label:'ปกติ'},
    {id:'large',sample:'Aa',label:'ใหญ่'},
    {id:'xlarge',sample:'Aa',label:'ใหญ่มาก'}
  ];
  return `${buildPageHeading('ตั้งค่าแอป','ปรับการแสดงผล การซิงค์ และจัดการสำเนาข้อมูล')}
    <section class="settings-card font-settings" aria-labelledby="font-size-title"><div class="settings-title" id="font-size-title">ขนาดตัวอักษร</div><p class="settings-description">ปรับขนาดตัวอักษรทุกหน้าของแอป</p><div class="font-size-options" role="group" aria-label="เลือกขนาดตัวอักษร">${fontOptions.map(option=>`<button class="font-size-option ${uiState.fontSize===option.id?'active':''}" aria-pressed="${uiState.fontSize===option.id}" onclick="setAppFontSize('${option.id}')"><span>${option.sample}</span><strong>${option.label}</strong></button>`).join('')}</div><div class="font-preview"><span>ตัวอย่างข้อความ</span><div><small>ยอดหนี้คงเหลือ</small><strong>1,768,117 บาท</strong></div><div><small>ดอกเบี้ยสะสม</small><strong>${fmt(lifetimeInterestTotal,0)} บาท</strong></div></div></section>
    <section class="settings-card settings-sync"><div><div class="settings-title">การซิงค์ข้อมูล</div><p class="settings-description">${syncStatus.online?'เชื่อมต่อแล้ว · ข้อมูลครอบครัวเป็นชุดเดียวกัน':'ออฟไลน์ · แสดงข้อมูลล่าสุดที่มีในเครื่อง'}</p></div><button class="settings-action" onclick="manualSync()">↻ ซิงค์ข้อมูล</button></section>
    <section class="settings-card"><div class="settings-title">ข้อมูลและรายงาน</div><div class="interest-summary"><div><strong>${projection.finite?fmt(projection.totalInterest,0):'—'}</strong><span>ดอกเบี้ยที่คาดว่าจะจ่ายในอนาคต</span></div><div><strong>${projection.finite?fmt(lifetimeInterestTotal+projection.totalInterest,0):'—'}</strong><span>ดอกเบี้ยตลอดสัญญาโดยประมาณ</span></div></div><div class="quality-box ${quality.issues.length?'':'ok'}"><div class="quality-title"><span>${quality.issues.length?'พบข้อมูลที่ควรตรวจสอบ':'ข้อมูลต่อเนื่องดี'}</span><strong>${quality.issues.length?quality.issues.length+' จุด':'ผ่าน'}</strong></div>${quality.issues.length?`<ul class="quality-list">${qualityItems}${extraIssues?`<li>และอีก ${extraIssues} จุด</li>`:''}</ul>`:`<div class="planner-note settings-quality-note">ไม่พบรายการซ้ำหรือยอดคงเหลือขาดช่วง · มีรายการตัดเงินต้นเพิ่ม ${quality.zeroInterestCount} รายการ</div>`}</div><div class="utility-grid"><button class="utility-btn" onclick="exportPDFReport()">รายงาน PDF<span>เปิดหน้าพิมพ์และบันทึก PDF</span></button><button class="utility-btn" onclick="exportPaymentsCSV()">ส่งออก CSV<span>ประวัติทุกรายการ</span></button><button class="utility-btn" onclick="exportBackupJSON()">สำรองข้อมูล<span>ไฟล์ JSON สำหรับกู้คืน</span></button><button class="utility-btn" onclick="document.getElementById('backup-restore-input').click()">กู้คืนข้อมูล<span>กู้คืนในเครื่องอย่างปลอดภัย</span></button><button class="utility-btn utility-wide" onclick="restoreLatestSnapshot()">ย้อนกลับการแก้ไขล่าสุด<span>${latestBackup?`${latestBackup.label} · ${new Date(latestBackup.createdAt).toLocaleString('th-TH')}`:'ยังไม่มีประวัติการแก้ไข'}</span></button></div><input id="backup-restore-input" type="file" accept="application/json,.json" style="display:none" onchange="handleBackupRestore(event)"><div class="backup-meta">ไฟล์สำรองเก็บข้อมูลหนี้และประวัติการผ่อนทั้งหมด · การกู้คืนไม่เขียนทับระบบกลางอัตโนมัติ</div></section>
    <button class="logout-card" onclick="logoutFamily()"><strong>ออกจากระบบ</strong><span>ต้องกรอกรหัสครอบครัวใหม่เมื่อกลับมาใช้งาน</span></button>`;
}

function render(){
  const app = document.getElementById('app');
  const balance = state.currentBalance; // เงินต้นคงเหลือ (หลังตัดชำระงวดล่าสุด)
  const accruedInterest = interestOverRange(balance, state.lastUpdateDate, todayStr());
  const liveBalance = balance + accruedInterest; // ยอดหนี้คงเหลือแบบเรียลไทม์ (รวมดอกเบี้ยค้าง) เหมือนแอพธนาคาร
  const progress = Math.max(0, Math.min(100, (1 - balance/state.originalPrincipal) * 100));
  const dInterest = dailyInterest(balance, todayStr());
  const mInterest = monthlyInterestEstimate(balance);
  const annualInterestSummary = buildAnnualInterestSummary();
  const lifetimeInterestTotal = annualInterestSummary.reduce((sum, y) => sum + y.amount, 0);
  const latestActualInterest = annualInterestSummary.slice().reverse().find(y => !y.certified && y.lastPaymentDate);
  const lifetimeInterestAsOf = latestActualInterest ? latestActualInterest.lastPaymentDate : '';

  // ยอดผ่อนเฉลี่ย/เดือน: ใช้ "12 เดือนล่าสุด" เพื่อสะท้อนกำลังผ่อนปัจจุบัน
  // (ถ้าเฉลี่ยทุกเดือนตั้งแต่อดีต ช่วงที่เคยผ่อนน้อยจะถ่วงให้ประมาณการช้ากว่าความจริง)
  const paymentStats = getMonthlyPaymentStats();
  const monthlyTotals = paymentStats.monthlyTotals;
  const avgPayment = paymentStats.average;
  const avgBasisMonths = paymentStats.basisMonths;
  const proj = projectPayoff(balance, avgPayment);

  let payoffYearsText = '—';
  let payoffMonthsText = 'ยังไม่มีข้อมูล';
  let payoffDateText = 'ยังประมาณการไม่ได้';
  let payoffBasisText = 'ต้องมีข้อมูลการผ่อนก่อนจึงจะประมาณการได้';
  if(proj && proj.months !== Infinity){
    const payoffDate = addMonths(todayStr(), proj.months);
    const y = proj.months / 12;
    payoffYearsText = `≈ ${y.toFixed(1)} ปี`;
    payoffMonthsText = `${proj.months} เดือน`;
    payoffDateText = thaiDate(localDateStr(payoffDate));
    payoffBasisText = `จาก ${avgBasisMonths} เดือนล่าสุด`;
  } else if(proj && proj.months === Infinity){
    payoffYearsText = 'ยังไม่หมดหนี้';
    payoffMonthsText = 'ควรเพิ่มยอดผ่อน';
    payoffDateText = 'ยอดผ่อนต่ำกว่าดอกเบี้ยต่อเดือน';
    payoffBasisText = 'ปรับยอดผ่อนเพื่อให้เงินต้นลดลง';
  }

  const historyEntries=getFilteredHistoryEntries();
  const historyHtml=buildHistoryResultsHtml(historyEntries);

  // แถบสถานะซิงค์ + ปุ่มนำเข้าข้อมูลเริ่มต้น (เฉพาะตอนเชื่อมระบบกลางไว้แล้ว)
  let syncBannerHtml = '';
  if(isConfigured() && getSavedPass()){
    const statusText = syncStatus.syncing
      ? 'กำลังซิงค์...'
      : (syncStatus.online
          ? `ซิงค์ล่าสุด ${syncStatus.lastSync ? syncStatus.lastSync.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : ''}`
          : 'ออฟไลน์ — แสดงข้อมูลล่าสุดที่มี');
    syncBannerHtml = `
    <div class="sync-banner ${syncStatus.online ? '' : 'offline'}">
      <span><span class="sb-dot"></span>${statusText}</span>
      <span class="sync-actions">
        <button onclick="manualSync()">↻ ซิงค์</button>
        <button class="font-quick" onclick="cycleFontSize()" aria-label="เปลี่ยนขนาดตัวอักษร">ก ก+</button>
        <button onclick="logoutFamily()" style="background:transparent; color:var(--ink-soft); margin-left:4px;">ออกจากระบบ</button>
      </span>
    </div>`;

    if(state.needsImport){
      syncBannerHtml += `
      <div class="import-banner">
        ระบบกลางยังไม่มีข้อมูล — นำเข้าประวัติเดิม ${SEED_PAYMENTS.length} รายการที่มีอยู่ในเครื่องนี้เข้าสู่ระบบกลางหรือไม่?
        <br><button onclick="importSeedData()">นำเข้าข้อมูลเริ่มต้น</button>
      </div>`;
    }
  }

  app.innerHTML = `
    ${syncBannerHtml}
    ${buildCategoryNav()}
    <main class="page-panel" data-page="overview" ${uiState.page==='overview'?'':'hidden'}>
    ${buildPageHeading('ภาพรวมสินเชื่อ','ยอดคงเหลือ ความคืบหน้า และประมาณการวันหมดหนี้')}
    <div class="hero-card">
      <div class="hero-label">💰 ยอดหนี้คงเหลือ (เรียลไทม์)</div>
      <div class="hero-balance">${fmt(liveBalance, 2)}<span class="unit">บาท</span></div>
      <div class="hero-sub">เงินต้น ${fmt(balance, 2)} + ดอกเบี้ยค้าง ${fmt(accruedInterest, 2)} บาท (ตั้งแต่ ${thaiDate(state.lastUpdateDate)})</div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      <div class="progress-labels">
        <span>ผ่อนไปแล้ว <span class="progress-pct">${progress.toFixed(1)}%</span></span>
        <span>เหลือ ${fmt(liveBalance,0)} บาท</span>
      </div>
      <div class="hero-meta-row hero-meta-first">
        <span>ยอดหนี้เงินกู้ทั้งหมด (ตั้งต้น)</span>
        <span style="color:var(--gold-300); font-weight:600;">${fmt(state.originalPrincipal, 2)} บาท</span>
      </div>
      <div class="hero-meta-row">
        <span>วันที่กู้</span>
        <span style="color:var(--gold-300); font-weight:600;">${thaiDate(state.originalDate)}</span>
      </div>
    </div>

    <div class="ticker-card">
      <div class="label">ดอกเบี้ยที่เกิดขึ้นวันนี้ (โดยประมาณ)</div>
      <div class="ticker-value">${fmt(dInterest, 2)} บาท / วัน</div>
      <div class="ticker-note">≈ ${fmt(mInterest, 0)} บาท ต่อเดือน ที่อัตรา ${(rateOnDate(todayStr())*100).toFixed(2)}% ต่อปี</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="icon-row"><span class="label">ผ่อนแล้วทั้งหมด (ต้น+ดอก)</span></div>
        <div class="value">${fmt((state.originalPrincipal - balance) + lifetimeInterestTotal, 0)}<small>บาท</small></div>
      </div>
      <div class="stat-card">
        <div class="icon-row"><span class="label">ผ่อนต้นเงินไปแล้ว</span></div>
        <div class="value">${fmt(state.originalPrincipal - balance, 0)}<small>บาท</small></div>
      </div>
      <div class="stat-card">
        <div class="icon-row"><span class="label">ดอกเบี้ยจ่ายไปแล้วทั้งหมด</span></div>
        <div class="value">${fmt(lifetimeInterestTotal, 0)}<small>บาท</small></div>
      </div>
      <div class="stat-card">
        <div class="icon-row"><span class="label">ยอดผ่อนเฉลี่ย/เดือน</span></div>
        <div class="value">${fmt(avgPayment,0)}<small>บาท</small></div>
      </div>
    </div>

    <section class="payoff-card" aria-label="ประมาณการวันหมดหนี้">
      <div class="payoff-title">ประมาณการวันหมดหนี้</div>
      <div class="payoff-date-label">คาดว่าจะหมดหนี้ราว</div>
      <div class="payoff-date">${payoffDateText}</div>
      <div class="payoff-divider" aria-hidden="true"><span></span></div>
      <div class="payoff-metrics">
        <div class="payoff-metric">
          <strong>${payoffYearsText}</strong>
          <span>ระยะเวลาโดยประมาณ</span>
        </div>
        <div class="payoff-metric">
          <strong>${payoffMonthsText}</strong>
          <span>จำนวนเดือนที่เหลือ</span>
        </div>
      </div>
      <div class="payoff-basis">
        <span>อ้างอิงยอดผ่อนเฉลี่ย</span>
        <strong>${fmt(avgPayment,0)} บาท/เดือน</strong>
        <span>${payoffBasisText}</span>
      </div>
    </section>

    ${buildCurrentMonthCard(avgPayment)}

    ${buildPrincipalInterestChart()}

    ${buildLatestAnnualInterestCard(annualInterestSummary)}

    ${buildRecentPayments()}
    </main>

    <main class="page-panel" data-page="plan" ${uiState.page==='plan'?'':'hidden'}>
    ${buildPageHeading('แผนปลดหนี้','ทดลองยอดผ่อน ตั้งเป้าหมาย และดูแนวโน้มเงินต้น')}
    ${buildPlannerHub(balance, avgPayment, avgBasisMonths, lifetimeInterestTotal)}

    ${buildChartCard()}

    </main>
    <main class="page-panel" data-page="history" ${uiState.page==='history'?'':'hidden'}>
    ${buildPageHeading('ประวัติและการชำระ','ตรวจดอกเบี้ยรายปี เพิ่มรายการ และดูประวัติย้อนหลัง')}

    ${buildAnnualInterestCard(annualInterestSummary,lifetimeInterestTotal,lifetimeInterestAsOf)}

    ${buildPaymentForm()}

    <div class="section-title">ประวัติการผ่อนชำระ</div>
    ${buildHistoryFilterCard(state.payments.length,historyEntries.length)}
    <div class="history-list" id="history-results-root">${historyHtml}</div>
    </main>

    <main class="page-panel" data-page="settings" ${uiState.page==='settings'?'':'hidden'}>
    ${buildSettingsPage(balance,avgPayment,lifetimeInterestTotal)}
    </main>
  `;

  const amtInput = document.getElementById('pay-amount');
  const dateInput = document.getElementById('pay-date');
  attachChartInteract();
  // แสดงวันที่ที่เลือกเป็นไทย พ.ศ. ใต้ช่อง (ปฏิทินมือถือยังเป็น ค.ศ. แต่ยืนยันผลเป็น พ.ศ.)
  function updateDateThai(){
    const box = document.getElementById('date-thai');
    if(!box) return;
    const pdate = dateInput.value;
    if(!pdate){
      box.classList.add('empty');
      box.textContent = '';
      return;
    }
    box.classList.remove('empty');
    box.textContent = thaiDate(pdate);
  }
  function updatePreview(){
    const amt = parseFloat(amtInput.value);
    const pdate = dateInput.value;
    const box = document.getElementById('preview-box');
    if(!amt || amt <= 0 || !pdate){
      box.classList.remove('show');
      return;
    }
    const days = Math.max(daysBetween(new Date(state.lastUpdateDate+'T00:00:00'), new Date(pdate+'T00:00:00')), 0);
    const interest = interestOverRange(state.currentBalance, state.lastUpdateDate, pdate);
    const principalPaid = Math.max(amt - interest, 0);
    const newBalance = Math.max(state.currentBalance - principalPaid, 0);
    box.innerHTML = `วันที่ <b>${thaiDate(pdate)}</b> · ช่วงเวลา ${days} วัน · ดอกเบี้ยประมาณ <b>${fmt(interest,2)}</b> บาท · เงินต้นที่ตัด <b>${fmt(principalPaid,2)}</b> บาท<br>ยอดคงเหลือใหม่โดยประมาณ: <b>${fmt(newBalance,2)} บาท</b>`;
    box.classList.add('show');
  }
  amtInput.addEventListener('input', updatePreview);
  dateInput.addEventListener('input', () => { updateDateThai(); updatePreview(); });
  updateDateThai();
  updatePreview();
}

// ============================================================
// อ่านใบเสร็จ SCB จาก PDF หรือรูปภาพในเบราว์เซอร์ทั้งหมด ไม่ส่งไฟล์การเงินขึ้นเซิร์ฟเวอร์
// PDF ใช้ pdf.js ส่วนรูปภาพโหลด Tesseract.js เมื่อต้องใช้เท่านั้น แล้ว OCR ภาษาไทย+อังกฤษในเครื่อง
// ============================================================
let pendingReceiptData = null;
const TESSERACT_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function loadScriptOnce(src, globalName){
  if(globalName && window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[data-dynamic-src="${src}"]`);
    if(existing){
      existing.addEventListener('load',()=>resolve(globalName?window[globalName]:true),{once:true});
      existing.addEventListener('error',reject,{once:true});
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.async=true;
    script.dataset.dynamicSrc=src;
    script.onload=()=>resolve(globalName?window[globalName]:true);
    script.onerror=()=>reject(new Error('โหลดตัวอ่านรูปภาพไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

function setReceiptReadProgress(btn,label,progress){
  if(!btn) return;
  const pct=Number.isFinite(progress)?` ${Math.round(progress*100)}%`:'';
  btn.textContent=`${label}${pct}`;
}

async function prepareReceiptImage(file){
  let bitmap;
  let cleanup=()=>{};
  if(typeof createImageBitmap === 'function'){
    bitmap=await createImageBitmap(file);
    cleanup=()=>bitmap.close();
  }else{
    const url=URL.createObjectURL(file);
    bitmap=await new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('เปิดรูปภาพไม่สำเร็จ'));
      image.src=url;
    });
    cleanup=()=>URL.revokeObjectURL(url);
  }
  const maxSide = 2400;
  const upscale = Math.min(2, maxSide / Math.max(bitmap.width,bitmap.height));
  const scale = Math.max(Math.min(upscale,2), Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  cleanup();

  // เพิ่มความต่างระหว่างตัวอักษรกับพื้นกระดาษ ช่วยรูปที่แสงไม่สม่ำเสมอ
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const pixels=image.data;
  for(let i=0;i<pixels.length;i+=4){
    const gray=0.299*pixels[i]+0.587*pixels[i+1]+0.114*pixels[i+2];
    const contrasted=Math.max(0,Math.min(255,(gray-128)*1.35+128));
    pixels[i]=pixels[i+1]=pixels[i+2]=contrasted;
  }
  ctx.putImageData(image,0,0);
  return canvas;
}

async function readReceiptImage(file,btn){
  if(file.size>15*1024*1024) throw new Error('รูปมีขนาดเกิน 15 MB กรุณาลดขนาดรูปก่อน');
  setReceiptReadProgress(btn,'กำลังโหลดตัวอ่าน',null);
  await loadScriptOnce(TESSERACT_SCRIPT_URL,'Tesseract');
  const canvas=await prepareReceiptImage(file);
  let worker;
  try{
    worker=await Tesseract.createWorker('tha+eng',1,{
      logger:message=>{
        if(message.status==='recognizing text') setReceiptReadProgress(btn,'กำลังอ่านข้อความ',message.progress);
      }
    });
    const result=await worker.recognize(canvas);
    return result.data.text || '';
  }finally{
    if(worker) await worker.terminate();
  }
}

function showReceiptDebug(rawText,kind){
  const debugEl = document.createElement('div');
  debugEl.id = 'receipt-debug-box';
  debugEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;padding:16px;overflow:auto;display:flex;align-items:flex-start;justify-content:center;';
  const rawEscaped = rawText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  debugEl.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:20px;max-width:640px;width:100%;font-size:12px;line-height:1.5;">
      <div style="font-size:15px;font-weight:700;color:#16315a;margin-bottom:4px;">📋 ข้อความที่อ่านได้จาก${kind}</div>
      <div style="color:#666;font-size:11px;margin-bottom:12px;">แอพยังจับคู่ตัวเลขได้ไม่ครบ สามารถก๊อปข้อความนี้ส่งให้ผู้พัฒนาเพื่อปรับตัวอ่านได้</div>
      <pre id="receipt-raw-text" style="white-space:pre-wrap;word-break:break-all;background:#f5f5f5;padding:12px;border-radius:8px;max-height:55vh;overflow:auto;font-size:10.5px;border:1px solid #ddd;">${rawEscaped}</pre>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button onclick="navigator.clipboard.writeText(document.getElementById('receipt-raw-text').textContent).then(()=>{this.textContent='ก๊อปแล้ว ✓';setTimeout(()=>this.textContent='📋 ก๊อปทั้งหมด',2000)})" style="flex:1;padding:10px;background:#16315a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12.5px;">📋 ก๊อปทั้งหมด</button>
        <button onclick="document.getElementById('receipt-debug-box').remove()" style="padding:10px 16px;background:#eee;color:#333;border:none;border-radius:8px;cursor:pointer;">ปิด</button>
      </div>
    </div>`;
  document.body.appendChild(debugEl);
}

async function handleReceiptFile(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // เคลียร์ค่า input ไว้ เผื่ออัปโหลดไฟล์เดิมซ้ำได้
  if(!file) return;
  const isImage=file.type.startsWith('image/');
  const isPdf=file.type==='application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if(!isImage && !isPdf){ showToast('รองรับไฟล์ PDF, JPG, PNG และ WebP'); return; }
  pendingReceiptFile=file;

  const btn = document.getElementById('receipt-upload-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'กำลังอ่าน...'; }

  try{
    let rawText='';
    if(isImage){
      rawText=await readReceiptImage(file,btn);
    }else{
      if(typeof pdfjsLib === 'undefined') throw new Error('โหลดตัวอ่าน PDF ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      if(pdf.numPages > 1){
        showToast(`ไฟล์นี้มี ${pdf.numPages} หน้า — แอพอ่านหน้าแรกเท่านั้น ถ้ามีหลายใบกรุณาแยกไฟล์ก่อน`);
      }
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      rawText = content.items.map(it => it.str).join(' ');
    }
    const parsed = parseSCBReceiptText(rawText);
    if(!parsed.ok) showReceiptDebug(rawText,isImage?'รูปภาพ':'PDF');
    showReceiptPreview(parsed);
  }catch(err){
    pendingReceiptFile=null;
    showToast(err.message || (isImage?'อ่านรูปไม่สำเร็จ กรุณาถ่ายให้ตรงและตัวหนังสือชัด':'อ่าน PDF ไม่สำเร็จ กรุณาใช้ไฟล์ที่ปลดรหัสแล้ว'));
    console.error('Receipt parse error:', err);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = '🧾 PDF / รูปภาพ'; }
  }
}

function parseSCBReceiptText(text){
  if(typeof ReceiptParser === 'undefined'){
    return { ok:false, fields:{}, warnings:['โหลดตัวอ่านใบเสร็จไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่'] };
  }
  return ReceiptParser.parseSCBReceiptText(text);
}

function showReceiptPreview(parsed){
  pendingReceiptData = parsed;
  const overlay = document.getElementById('receipt-overlay');
  const warnBox = document.getElementById('receipt-warnings');

  if(parsed.warnings.length > 0){
    warnBox.innerHTML = `<div class="rm-warning">⚠️ ${parsed.warnings.join('<br>⚠️ ')}<br><br>ตรวจสอบและแก้ตัวเลขในช่องด้านล่างให้ถูกต้องก่อนกดยืนยัน</div>`;
  } else {
    warnBox.innerHTML = '';
  }

  document.getElementById('rm-date').value = parsed.fields.date || todayStr();
  document.getElementById('rm-principal').value = parsed.fields.principalPaid != null ? parsed.fields.principalPaid.toFixed(2) : '';
  document.getElementById('rm-interest').value = parsed.fields.interest != null ? parsed.fields.interest.toFixed(2) : '';
  document.getElementById('rm-amount').value = parsed.fields.amount != null ? parsed.fields.amount.toFixed(2) : '';
  document.getElementById('rm-balance').value = parsed.fields.balanceAfter != null ? parsed.fields.balanceAfter.toFixed(2) : '';

  overlay.classList.add('show');

  const cancelBtn = document.getElementById('receipt-cancel');
  const confirmBtn = document.getElementById('receipt-confirm');
  function close(){
    overlay.classList.remove('show');
    cancelBtn.removeEventListener('click', onCancel);
    confirmBtn.removeEventListener('click', onConfirm);
  }
  function onCancel(){ close(); pendingReceiptData = null; pendingReceiptFile=null; }
  function onConfirm(){ close(); confirmReceiptImport(); }
  cancelBtn.addEventListener('click', onCancel);
  confirmBtn.addEventListener('click', onConfirm);
}

async function confirmReceiptImport(){
  const date = document.getElementById('rm-date').value;
  const principalPaid = parseFloat(document.getElementById('rm-principal').value);
  const interest = parseFloat(document.getElementById('rm-interest').value) || 0;
  const amount = parseFloat(document.getElementById('rm-amount').value);
  const balanceAfter = parseFloat(document.getElementById('rm-balance').value);

  if(!date || isNaN(principalPaid) || isNaN(amount) || isNaN(balanceAfter)){
    pendingReceiptFile=null;
    showToast('กรุณากรอกข้อมูลให้ครบถ้วนก่อนยืนยัน');
    return;
  }

  // กันบันทึกซ้ำ: เช็ครายการที่มีวันที่และยอดคงเหลือตรงกันเป๊ะอยู่แล้วในระบบ
  const dup = state.payments.find(p => p.date === date && Math.abs(p.balanceAfter - balanceAfter) < 0.01);
  if(dup){
    pendingReceiptFile=null;
    showToast('ดูเหมือนมีรายการวันนี้+ยอดนี้อยู่แล้ว — ไม่ได้บันทึกซ้ำ');
    return;
  }

  // ใบเสร็จจริง = ข้อมูลล็อก เหมือนกับ SEED_PAYMENTS (ห้ามลบ ป้องกันข้อมูลทางการเงินจริงถูกแก้/ลบโดยไม่ตั้งใจ)
  const newPayment = {
    id: genId(),
    date: date,
    amount: Math.round(amount*100)/100,
    interest: Math.round(interest*100)/100,
    principalPaid: Math.round(principalPaid*100)/100,
    balanceAfter: Math.round(balanceAfter*100)/100,
    payer: '', // ไม่เก็บผู้ชำระอีกต่อไป (คงคอลัมน์ไว้เพื่อความเข้ากันได้กับ Google Sheet เดิม)
    locked: true,
    source: 'receipt-upload'
  };

  const pass = getSavedPass();
  if(isConfigured() && pass){
    showToast('กำลังบันทึก...');
    try{
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(versionedRequest({ action: 'add', pass: pass, payment: newPayment }))
      });
      const data = await res.json();
      if(!data.ok){
        if(await handleServerConflict(data)){ pendingReceiptFile=null; return; }
        pendingReceiptFile=null;
        showToast(data.error || 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
        return;
      }
      absorbServerVersion(data);
      if(data.payment) Object.assign(newPayment, data.payment);
      syncStatus.online = true;
      syncStatus.error = null;
      syncStatus.lastSync = new Date();
    }catch(err){
      pendingReceiptFile=null;
      showToast('ไม่มีอินเทอร์เน็ต บันทึกไม่สำเร็จ ลองใหม่เมื่อมีเน็ต');
      return;
    }
  }

  saveAutoSnapshot('ก่อนนำเข้าใบเสร็จ');
  state.payments.push(newPayment);
  recomputeFromPayments(state.payments); // จัดเรียงตามวันที่ใหม่ เผื่อใบเสร็จนี้เป็นรายการเก่าที่เติมช่องว่างย้อนหลัง

  await saveState();
  let receiptSaved=false;
  if(pendingReceiptFile){
    try{
      await storeReceiptForPayment(receiptKeyForPayment(newPayment),pendingReceiptFile);
      receiptSaved=true;
    }catch(error){
      console.warn('Receipt archive save failed:',error);
    }
  }
  render();
  pendingReceiptData = null;
  pendingReceiptFile=null;
  const syncText=isConfigured()&&pass?' · ซิงค์รายการแล้ว':'';
  showToast(`นำเข้าใบเสร็จเรียบร้อย ✓${receiptSaved?' · เก็บไฟล์ในเครื่องนี้':''}${syncText}`);
}

async function submitPayment(){
  const amtInput = document.getElementById('pay-amount');
  const dateInput = document.getElementById('pay-date');
  const amount = parseFloat(amtInput.value);
  const payDate = dateInput.value;

  if(!amount || amount <= 0){
    showToast('กรุณากรอกจำนวนเงินให้ถูกต้อง');
    return;
  }
  if(!payDate){
    showToast('กรุณาเลือกวันที่');
    return;
  }

  const interest = interestOverRange(state.currentBalance, state.lastUpdateDate, payDate);
  let principalPaid = amount - interest;
  if(principalPaid < 0) principalPaid = 0;
  if(principalPaid > state.currentBalance) principalPaid = state.currentBalance;
  const newBalance = Math.max(state.currentBalance - principalPaid, 0);

  const newPayment = {
    id: genId(),
    date: payDate,
    amount: amount,
    interest: Math.round(interest*100)/100,
    principalPaid: Math.round(principalPaid*100)/100,
    balanceAfter: Math.round(newBalance*100)/100,
    payer: '', // ไม่เก็บผู้ชำระอีกต่อไป (คงคอลัมน์ไว้เพื่อความเข้ากันได้กับ Google Sheet เดิม)
    locked: false,
    createdAt: new Date().toISOString() // ใช้เป็นจุดอ้างอิงว่า "เป็นรายการใหม่" สำหรับการอนุญาตให้ลบได้
  };

  // ถ้าเชื่อมระบบกลางไว้แล้ว ต้องบันทึกขึ้นเซิร์ฟเวอร์ก่อน เพื่อให้ทุกคนเห็นตรงกันแน่นอน
  const pass = getSavedPass();
  if(isConfigured() && pass){
    const submitBtn = document.querySelector('.btn-primary');
    if(submitBtn) submitBtn.disabled = true;
    showToast('กำลังบันทึก...');
    try{
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(versionedRequest({ action: 'add', pass: pass, payment: newPayment }))
      });
      const data = await res.json();
      if(!data.ok){
        if(submitBtn) submitBtn.disabled = false;
        if(await handleServerConflict(data)) return;
        showToast(data.error || 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
        return;
      }
      absorbServerVersion(data);
      if(data.payment) Object.assign(newPayment, data.payment);
      syncStatus.online = true;
      syncStatus.error = null;
      syncStatus.lastSync = new Date();
    }catch(err){
      if(submitBtn) submitBtn.disabled = false;
      syncStatus.online = false;
      showToast('ไม่มีอินเทอร์เน็ต บันทึกไม่สำเร็จ ลองใหม่เมื่อมีเน็ต');
      return;
    }
    if(submitBtn) submitBtn.disabled = false;
  }

  saveAutoSnapshot('ก่อนบันทึกการผ่อน');
  state.payments.push(newPayment);
  state.currentBalance = newBalance;
  state.lastUpdateDate = payDate;

  await saveState();
  render();
  showToast(isConfigured() && pass ? 'บันทึกเรียบร้อย ✓ ซิงค์กับทุกคนแล้ว' : 'บันทึกเรียบร้อย ✓');
}

function deletePayment(idx){
  const target = state.payments[idx];

  if(!canDeletePayment(target)){
    showToast('รายการนี้ถูกล็อกไว้ — ลบได้เฉพาะรายการที่กรอกใหม่หลังจากนี้เท่านั้น');
    return;
  }

  const synced = isConfigured() && !!getSavedPass();

  if(synced){
    // ในโหมดซิงค์กับระบบกลาง: อนุญาตลบเฉพาะ "รายการล่าสุด" เท่านั้น
    // (ลบรายการกลางๆ ต้องคำนวณยอดของรายการถัดไปทั้งหมดใหม่ ซึ่งจะทำให้ข้อมูลของทุกคนไม่ตรงกัน)
    if(idx !== state.payments.length - 1){
      showToast('โหมดซิงค์: ลบได้เฉพาะรายการล่าสุดเท่านั้น เพื่อไม่ให้ข้อมูลของทุกคนไม่ตรงกัน');
      return;
    }
    showConfirm('ลบรายการล่าสุดนี้? ข้อมูลจะถูกลบออกจากระบบกลางทันที', () => {
      doDeleteSynced(idx);
    });
    return;
  }

  // โหมดยังไม่ได้ซิงค์ (ใช้ในเครื่องเดียวเท่านั้น) -> รายการนี้ผ่านการเช็คคัตออฟแล้ว (เป็นรายการใหม่จริง) คำนวณยอดคงเหลือใหม่ได้ตามเดิม
  showConfirm('ลบรายการนี้แล้วจะคำนวณยอดคงเหลือใหม่ทั้งหมด ดำเนินการต่อ?', () => {
    doDeletePayment(idx);
  });
}

// ลบรายการล่าสุดในโหมดซิงค์: ลบที่เซิร์ฟเวอร์ก่อน แล้วค่อยอัปเดตในเครื่อง
async function doDeleteSynced(idx){
  const target = state.payments[idx];
  const pass = getSavedPass();
  if(!target || !target.id){
    showToast('ไม่พบ id ของรายการนี้ (อาจยังไม่เคยซิงค์) — กรุณาซิงค์ใหม่ก่อนลบ');
    return;
  }
  try{
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(versionedRequest({ action: 'delete', pass: pass, id: target.id }))
    });
    const data = await res.json();
    if(!data.ok){
      if(await handleServerConflict(data)) return;
      showToast(data.error || 'ลบไม่สำเร็จ');
      return;
    }
    absorbServerVersion(data);
  }catch(err){
    showToast('ไม่มีอินเทอร์เน็ต ลบไม่สำเร็จ');
    return;
  }
  saveAutoSnapshot('ก่อนลบรายการล่าสุด');
  state.payments.splice(idx, 1);
  recomputeFromPayments(state.payments);
  saveState();
  render();
  showToast('ลบรายการแล้ว ✓ ซิงค์กับทุกคนแล้ว');
}

async function doDeletePayment(idx){
  saveAutoSnapshot('ก่อนลบรายการ');
  const removedWasLocked = !!(state.payments[idx] && state.payments[idx].locked);
  state.payments.splice(idx, 1);

  if(removedWasLocked){
    // ลบรายการที่มาจากใบเสร็จจริง -> ไม่มีจุดอ้างอิงที่แน่นอนแล้ว ต้องคำนวณใหม่ทั้งหมด
    // โดยใช้อัตราดอกเบี้ยประมาณการ (rateOnDate) ซึ่งอาจไม่ตรง 100% กับอัตราจริงในอดีต
    let bal = state.trackingAnchorBalance != null ? state.trackingAnchorBalance : state.originalPrincipal;
    let lastDate = state.trackingAnchorDate != null ? state.trackingAnchorDate : state.originalDate;
    for(const p of state.payments){
      const interest = interestOverRange(bal, lastDate, p.date);
      let principalPaid = p.amount - interest;
      if(principalPaid < 0) principalPaid = 0;
      if(principalPaid > bal) principalPaid = bal;
      bal -= principalPaid;
      p.interest = Math.round(interest*100)/100;
      p.principalPaid = Math.round(principalPaid*100)/100;
      p.balanceAfter = Math.round(bal*100)/100;
      p.locked = false; // ค่าที่คำนวณใหม่นี้ไม่ใช่ข้อมูลล็อกจากใบเสร็จแล้ว
      lastDate = p.date;
    }
    state.currentBalance = bal;
    state.lastUpdateDate = state.payments.length > 0 ? state.payments[state.payments.length-1].date : lastDate;
  } else {
    // ลบรายการที่ผู้ใช้บันทึกเอง -> ข้อมูลล็อกอื่นๆยังถูกต้อง คำนวณใหม่แค่ส่วนที่ไม่ล็อก
    let anchorBal = state.trackingAnchorBalance != null ? state.trackingAnchorBalance : state.originalPrincipal;
    let anchorDate = state.trackingAnchorDate != null ? state.trackingAnchorDate : state.originalDate;
    for(const p of state.payments){
      if(p.locked){
        anchorBal = p.balanceAfter;
        anchorDate = p.date;
      } else {
        const interest = interestOverRange(anchorBal, anchorDate, p.date);
        let principalPaid = p.amount - interest;
        if(principalPaid < 0) principalPaid = 0;
        if(principalPaid > anchorBal) principalPaid = anchorBal;
        anchorBal -= principalPaid;
        p.interest = Math.round(interest*100)/100;
        p.principalPaid = Math.round(principalPaid*100)/100;
        p.balanceAfter = Math.round(anchorBal*100)/100;
        anchorDate = p.date;
      }
    }
    state.currentBalance = anchorBal;
    state.lastUpdateDate = state.payments.length > 0 ? state.payments[state.payments.length-1].date : anchorDate;
  }

  await saveState();
  render();
  showToast('ลบรายการแล้ว');
}

// ---------- ซิงค์อัตโนมัติเมื่อกลับมาเปิดแอพอีกครั้ง ----------
// สำคัญมากสำหรับแอพที่ติดตั้งจากโฮมจอ (โดยเฉพาะ iOS): เวลาสลับออกไปแล้วกลับมาเปิดใหม่
// ระบบมักจะ "แช่แข็ง" หน้าเดิมไว้ในหน่วยความจำ ไม่โหลดใหม่ทั้งหน้า จึงไม่มีการดึงข้อมูลล่าสุดให้เอง
// ต้องดักจับตอนแอพ "กลับมาโฟกัส/มองเห็นได้" แล้วสั่งซิงค์ข้อมูลใหม่เองตรงนี้
let lastAutoSyncAt = 0;
const AUTO_SYNC_MIN_GAP_MS = 15000; // กันซิงค์รัวเกินไปถ้าสลับแอพไปมาถี่ๆ

async function autoResyncIfNeeded(){
  if(!isConfigured() || !getSavedPass()) return;
  const now = Date.now();
  if(now - lastAutoSyncAt < AUTO_SYNC_MIN_GAP_MS) return;
  lastAutoSyncAt = now;
  const ok = await syncFromServer();
  render();
  if(ok) showToast('อัปเดตข้อมูลล่าสุดแล้ว ✓');
}

function setupAutoResync(){
  // เวลาสลับกลับมาที่แท็บ/แอพนี้ (จากโฮมจอ, สลับแอพ, หรือสลับแท็บ)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') autoResyncIfNeeded();
  });
  // เวลาเบราว์เซอร์ดึงหน้าเดิมจาก back-forward cache กลับมาโชว์ (พบบ่อยใน Safari/iOS)
  window.addEventListener('pageshow', (e) => {
    if(e.persisted) autoResyncIfNeeded();
  });
  // เผื่อกรณีกลับมาโฟกัสหน้าต่าง/แอพโดยตรง
  window.addEventListener('focus', () => autoResyncIfNeeded());
}

(async function init(){
  await loadState();
  await loadReceiptAttachmentMeta();
  render();
  registerServiceWorker();
  setupPullToRefresh();
  setupAutoResync();

  if(!isConfigured()){
    return; // ยังไม่ได้ตั้งค่า Apps Script URL -> ใช้แอพแบบในเครื่องเดียวไปก่อน (ดู apps-script/README.md)
  }

  const pass = getSavedPass();
  if(!pass){
    renderGate(); // ยังไม่เคยกรอกรหัสครอบครัวบนเครื่องนี้ -> ให้กรอกก่อนใช้งาน
    return;
  }

  // มีรหัสอยู่แล้ว -> ซิงค์ข้อมูลล่าสุดจากระบบกลางแบบเงียบๆ ในพื้นหลัง
  const ok = await syncFromServer();
  render();
  if(!ok){
    showToast('ออฟไลน์ — แสดงข้อมูลล่าสุดที่มีในเครื่อง');
  }
})();
