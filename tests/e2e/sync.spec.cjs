const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const app=fs.readFileSync('js/app.js','utf8');
const seed=JSON.parse(app.match(/const SEED_PAYMENTS = (\[[\s\S]*?\n\]);/)[1]).map((p,i)=>({...p,id:'seed-'+i}));
const cached={originalPrincipal:3823247,originalDate:'2016-04-28',trackingAnchorBalance:3553254,trackingAnchorDate:'2020-08-30',payments:seed,currentMRR:6.6,seedVersion:8};
test.use({serviceWorkers:'block'});

test('bundle update retains newer cached payments when server returns invalid data',async({page})=>{
  const newer={id:'newer',date:'2026-09-25',amount:20000,interest:2000,principalPaid:18000,balanceAfter:1712006.33,locked:true};
  await page.addInitScript(cache=>{
    localStorage.setItem('lt_local_cache_v2',JSON.stringify(cache));
    localStorage.setItem('lt_family_pass','test-only');
  },{...cached,payments:[...seed,newer]});
  await page.route('https://script.google.com/**',route=>route.fulfill({contentType:'text/html',body:'Unavailable'}));
  await page.goto('/loan_tracker.html');
  await expect(page.locator('.sync-banner')).toContainText('อ่านไม่ได้');
  expect(await page.evaluate(()=>state.currentBalance)).toBe(1712006.33);
  expect(await page.evaluate(()=>state.payments.length)).toBe(seed.length+1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('lt_local_cache_v2')).seedVersion)).toBe(9);
});

test('concurrent sync uses one request and orders same-day receipts by balance',async({page})=>{
  let gets=0;
  const payments=[...seed,{id:'second',date:'2026-07-25',amount:20000,interest:0,principalPaid:20000,balanceAfter:1811208.57},{id:'first',date:'2026-07-25',amount:20000,interest:2000,principalPaid:18000,balanceAfter:1831208.57}];
  await page.addInitScript(()=>localStorage.setItem('lt_family_pass','test-only'));
  await page.route('https://script.google.com/**',async route=>{
    gets++;
    await route.fulfill({json:{ok:true,payments,version:4,settings:{currentMRR:6.3}}});
  });
  await page.goto('/loan_tracker.html');
  await expect(page.locator('.sync-banner')).toContainText('ซิงค์ล่าสุด');
  const before=gets;
  await page.evaluate(()=>Promise.all([syncFromServer(),syncFromServer(),syncFromServer()]));
  expect(gets-before).toBe(1);
  expect(await page.evaluate(()=>state.payments.slice(-2).map(p=>p.id))).toEqual(['first','second']);
  expect(await page.evaluate(()=>state.currentBalance)).toBe(1811208.57);
});

for(const committedBeforeError of [true,false]) test(`lost save response ${committedBeforeError?'is confirmed by read-back':'keeps draft for retry'} without duplicates`,async({page})=>{
  let saved=null;
  const posts=[];
  let gets=0;
  await page.addInitScript(()=>localStorage.setItem('lt_family_pass','test-only'));
  await page.route('https://script.google.com/**',async route=>{
    if(route.request().method()==='GET'){
      gets++;
      return route.fulfill({json:{ok:true,payments:saved?[...seed,saved]:seed,version:saved?2:1}});
    }
    const body=JSON.parse(route.request().postData());
    posts.push(body);
    if(posts.length===1){if(committedBeforeError) saved=body.payment; return route.abort('failed');}
    saved=body.payment;
    return route.fulfill({json:{ok:true,payment:saved,duplicate:true,version:2}});
  });
  await page.goto('/loan_tracker.html');
  await expect(page.locator('.sync-banner')).toContainText('ซิงค์ล่าสุด');
  await page.evaluate(()=>{
    pendingReceiptFile=new File(['test receipt'],'test.pdf',{type:'application/pdf'});
    showReceiptPreview({ok:true,warnings:[],fields:{date:'2026-07-25',amount:20000,interest:2000,principalPaid:18000,balanceAfter:1831208.57}});
  });
  const before=gets;
  await page.evaluate(()=>{lastAutoSyncAt=0; window.dispatchEvent(new Event('focus'));});
  expect(gets).toBe(before);
  await page.locator('#receipt-confirm').click();
  if(!committedBeforeError){
    await expect(page.locator('#receipt-overlay')).toHaveClass(/show/);
    await expect(page.locator('#receipt-warnings')).toContainText('เชื่อมต่อระบบกลางไม่ได้');
    await expect(page.locator('#rm-amount')).toHaveValue('20000.00');
    expect(await page.evaluate(()=>pendingReceiptFile.name)).toBe('test.pdf');
    await page.locator('#receipt-confirm').click();
  }
  await expect(page.locator('.toast')).toContainText('นำเข้าใบเสร็จเรียบร้อย');
  expect(posts.length).toBe(committedBeforeError?1:2);
  if(!committedBeforeError) expect(posts[0].payment.id).toBe(posts[1].payment.id);
  expect(await page.evaluate(()=>state.payments.filter(p=>p.date==='2026-07-25').length)).toBe(1);
  expect(await page.evaluate(()=>receiptBackupStats.count)).toBe(1);
});

test('receipt reader can load again after failed download instead of hanging',async({page})=>{
  await page.goto('/loan_tracker.html?qa=1');
  let attempts=0;
  await page.route('**/test-reader.js',route=>{
    attempts++;
    return attempts===1?route.abort('failed'):route.fulfill({contentType:'text/javascript',body:'window.TestReader={ready:true};'});
  });
  const first=await page.evaluate(()=>loadScriptOnce('/test-reader.js','TestReader').then(()=>null,error=>error.message));
  expect(first).toContain('โหลดตัวอ่านใบเสร็จไม่สำเร็จ');
  expect(await page.evaluate(()=>loadScriptOnce('/test-reader.js','TestReader'))).toEqual({ready:true});
  expect(attempts).toBe(2);
});
