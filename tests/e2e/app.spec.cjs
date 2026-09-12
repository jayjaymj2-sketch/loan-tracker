const {test,expect}=require('@playwright/test');
const path=require('node:path');

test.beforeEach(async({page})=>{
  await page.goto('/loan_tracker.html?qa=1');
  await expect(page.getByRole('heading',{name:'ภาพรวมสินเชื่อ'})).toBeVisible();
  await expect(page.locator('.reminder-banner')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'สรุปเดือนที่แล้ว'})).toBeVisible();
  await expect(page.getByRole('region',{name:'สรุปเดือนนี้'})).toBeVisible();
});

test('navigation, scenarios, settings and reconciliation render without overflow',async({page},testInfo)=>{
  const isMobile=testInfo.project.name.startsWith('mobile');
  await expect(page.locator('.category-tab')).toHaveCount(4);
  const navPosition=await page.locator('.category-nav').evaluate(element=>getComputedStyle(element).position);
  expect(navPosition).toBe(isMobile?'fixed':'static');
  await page.locator('.category-tab').filter({hasText:'แผนปลดหนี้'}).click();
  await expect(page.getByText('วันหมดหนี้ 3 สถานการณ์')).toBeVisible();
  await expect(page.locator('.scenario-row')).toHaveCount(3);
  const millionMilestone=page.locator('#forecast-chart [data-milestone="1 ล้าน"]');
  const halfMillionMilestone=page.locator('#forecast-chart [data-milestone="5 แสน"]');
  await expect(millionMilestone).toContainText(/[ก-๙.]+ 25\d{2}/);
  await expect(halfMillionMilestone).toContainText(/[ก-๙.]+ 25\d{2}/);
  await expect(millionMilestone).toHaveAttribute('data-date',/^\d{4}-\d{2}$/);
  const initialMillionMonth=await millionMilestone.getAttribute('data-date');
  const averagePayment=await page.evaluate(()=>Math.round(getMonthlyPaymentStats().average));
  await expect(page.locator('#planner-payment-number')).toHaveValue(String(averagePayment));
  await page.locator('#planner-payment-number').fill('80000');
  await expect.poll(()=>millionMilestone.getAttribute('data-date')).not.toBe(initialMillionMonth);
  await page.locator('.category-tab').filter({hasText:'ตั้งค่า'}).click();
  await expect(page.getByText('อัตราดอกเบี้ยและ MRR')).toBeVisible();
  await expect(page.locator('#receipt-backup-title')).toBeVisible();
  await page.locator('.category-tab').filter({hasText:'ประวัติ'}).click();
  await page.getByRole('button',{name:/รายงานภาษีผู้กู้ร่วม/}).click();
  await expect(page.getByRole('heading',{name:'รายงานภาษีดอกเบี้ยบ้าน'})).toBeVisible();
  await expect(page.locator('.tax-borrower-row')).toHaveCount(3);
  await expect(page.locator('.tax-borrower-row').nth(2)).toContainText('ลูก');
  await page.locator('.tax-year-row select').selectOption('2025');
  await expect(page.getByText('พร้อมใช้ประกอบการยื่น')).toBeVisible();
  await page.getByRole('button',{name:/กลับประวัติ/}).click();
  await page.getByRole('button',{name:/กระทบยอดกับธนาคาร/}).click();
  await expect(page.getByRole('heading',{name:'กระทบยอดกับธนาคาร'})).toBeVisible();
  await page.locator('#reconcile-balance').fill('1849208.57');
  await page.getByRole('button',{name:'ตรวจสอบยอด'}).click();
  await expect(page.locator('.reconcile-result')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('legacy planner value starts from the latest 12-month average and a new choice remains saved',async({page})=>{
  await page.evaluate(()=>localStorage.setItem('lt_planner_prefs_v1',JSON.stringify({tab:'simulate',payment:65000,lumpSum:0,targetDate:''})));
  await page.reload();
  await expect(page.getByRole('heading',{name:'ภาพรวมสินเชื่อ'})).toBeVisible();
  const averagePayment=await page.evaluate(()=>Math.round(getMonthlyPaymentStats().average));
  await page.locator('.category-tab').filter({hasText:'แผนปลดหนี้'}).click();
  await expect(page.locator('#planner-payment-number')).toHaveValue(String(averagePayment));
  await page.locator('#planner-payment-number').fill('52000');
  await page.reload();
  await expect(page.locator('#planner-payment-number')).toHaveValue('52000');
});

test('principal and interest chart opens details for paid and empty months',async({page})=>{
  const chart=page.getByRole('region',{name:'เงินต้นเทียบดอกเบี้ย 12 เดือน'});
  await expect(chart.getByRole('button')).toHaveCount(12);

  const paidBar=chart.locator('.split-chart-column:not([data-amount="0"])').first();
  const paidMonth=await paidBar.getAttribute('data-month');
  await paidBar.click();
  await expect(chart.locator('#principal-interest-detail')).toHaveAttribute('data-month',paidMonth);
  await expect(paidBar).toHaveAttribute('aria-pressed','true');
  await expect(chart.locator('.split-detail-metrics')).toContainText('เงินต้น');
  await expect(chart.locator('.split-detail-metrics')).toContainText('ดอกเบี้ย');

  const novemberBar=chart.locator('.split-chart-column[data-month="2025-11"]');
  await novemberBar.click();
  const novemberSplitTotal=await novemberBar.locator('.split-chart-stack > span').evaluateAll(parts=>parts.reduce((sum,part)=>sum+parseFloat(part.style.height||'0'),0));
  expect(novemberSplitTotal).toBeCloseTo(100,5);
  await expect(chart.locator('#principal-interest-detail')).toContainText('ข้อมูลเดิมแยกเงินต้นและดอกเบี้ยรวมต่ำกว่ายอดชำระ');

  const emptyBar=chart.locator('.split-chart-column[data-amount="0"]').last();
  const emptyMonth=await emptyBar.getAttribute('data-month');
  await emptyBar.click();
  await expect(chart.locator('#principal-interest-detail')).toHaveAttribute('data-month',emptyMonth);
  await expect(chart.locator('#principal-interest-detail')).toContainText('เดือนนี้ยังไม่มีรายการชำระ');
});

test('history filtering and image receipt attachment work',async({page})=>{
  await page.locator('.category-tab').filter({hasText:'ประวัติ'}).click();
  await page.locator('.history-search input').fill('19600');
  await expect(page.locator('.history-item').first()).toBeVisible();
  await page.locator('.history-search input').fill('');
  await page.getByRole('button',{name:'แนบใบเสร็จ'}).first().click();
  await page.locator('#history-receipt-input').setInputFiles(path.resolve(__dirname,'../../icon-192.png'));
  await expect(page.locator('.toast')).toContainText('แนบใบเสร็จแล้ว');
  await expect(page.getByRole('button',{name:'ดูใบเสร็จ'}).first()).toBeVisible();
});

test('PDF reports provide a working way back to the app',async({page,context})=>{
  await page.locator('.category-tab').filter({hasText:'ตั้งค่า'}).click();
  const summaryPopupPromise=page.waitForEvent('popup');
  await page.locator('.utility-btn').filter({hasText:'รายงาน PDF'}).click();
  const summaryReport=await summaryPopupPromise;
  await expect(summaryReport.getByRole('heading',{name:'รายงานสรุปหนี้บ้าน'})).toBeVisible();
  const summaryToolbar=summaryReport.locator('.report-actions');
  await expect(summaryReport.getByRole('button',{name:'กลับไปแอป'})).toBeVisible();
  const summaryPrintButton=summaryReport.getByRole('button',{name:'พิมพ์ / บันทึกเป็น PDF'});
  await expect(summaryPrintButton).toBeVisible();
  await expect(summaryReport.locator('html')).not.toHaveAttribute('data-print-requested','true');
  await summaryReport.evaluate(()=>{window.print=()=>document.documentElement.setAttribute('data-print-requested','true');});
  await summaryPrintButton.click();
  await expect(summaryReport.locator('html')).toHaveAttribute('data-print-requested','true');
  await summaryReport.emulateMedia({media:'print'});
  expect(await summaryToolbar.evaluate(element=>getComputedStyle(element).display)).toBe('none');
  await summaryReport.emulateMedia({media:'screen'});
  await summaryReport.evaluate(()=>{window.close=()=>document.documentElement.setAttribute('data-returned-to-app','true');});
  await summaryReport.getByRole('button',{name:'กลับไปแอป'}).click();
  await expect(summaryReport.locator('html')).toHaveAttribute('data-returned-to-app','true');
  await summaryReport.close();
  await expect(page.getByRole('heading',{name:'ตั้งค่าแอป'})).toBeVisible();

  await page.locator('.category-tab').filter({hasText:'ประวัติ'}).click();
  await page.getByRole('button',{name:/รายงานภาษีผู้กู้ร่วม/}).click();
  const taxPopupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'พิมพ์ / บันทึก PDF'}).click();
  const taxReport=await taxPopupPromise;
  await expect(taxReport.getByRole('heading',{name:'รายงานภาษีดอกเบี้ยเงินกู้บ้าน'})).toBeVisible();
  await expect(taxReport.getByRole('button',{name:'กลับไปแอป'})).toBeVisible();
  const taxPrintButton=taxReport.getByRole('button',{name:'พิมพ์ / บันทึกเป็น PDF'});
  await expect(taxPrintButton).toBeVisible();
  await expect(taxReport.locator('html')).not.toHaveAttribute('data-print-requested','true');
  await taxReport.evaluate(()=>{window.print=()=>document.documentElement.setAttribute('data-print-requested','true');});
  await taxPrintButton.click();
  await expect(taxReport.locator('html')).toHaveAttribute('data-print-requested','true');
  await taxReport.evaluate(()=>{window.close=()=>document.documentElement.setAttribute('data-returned-to-app','true');});
  await taxReport.getByRole('button',{name:'กลับไปแอป'}).click();
  await expect(taxReport.locator('html')).toHaveAttribute('data-returned-to-app','true');
  await taxReport.close();
  await expect(page.getByRole('heading',{name:'รายงานภาษีดอกเบี้ยบ้าน'})).toBeVisible();
});
