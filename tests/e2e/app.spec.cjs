const {test,expect}=require('@playwright/test');
const path=require('node:path');

test.beforeEach(async({page})=>{
  await page.goto('/loan_tracker.html?qa=1');
  await expect(page.getByRole('heading',{name:'ภาพรวมสินเชื่อ'})).toBeVisible();
  await expect(page.locator('.reminder-banner')).toHaveCount(0);
});

test('navigation, scenarios, settings and reconciliation render without overflow',async({page},testInfo)=>{
  const isMobile=testInfo.project.name.startsWith('mobile');
  await expect(page.locator('.category-tab')).toHaveCount(4);
  const navPosition=await page.locator('.category-nav').evaluate(element=>getComputedStyle(element).position);
  expect(navPosition).toBe(isMobile?'fixed':'static');
  await page.locator('.category-tab').filter({hasText:'แผนปลดหนี้'}).click();
  await expect(page.getByText('วันหมดหนี้ 3 สถานการณ์')).toBeVisible();
  await expect(page.locator('.scenario-row')).toHaveCount(3);
  await page.locator('.category-tab').filter({hasText:'ตั้งค่า'}).click();
  await expect(page.getByText('อัตราดอกเบี้ยและ MRR')).toBeVisible();
  await expect(page.locator('#receipt-backup-title')).toBeVisible();
  await page.locator('.category-tab').filter({hasText:'ประวัติ'}).click();
  await page.getByRole('button',{name:/รายงานภาษีผู้กู้ร่วม/}).click();
  await expect(page.getByRole('heading',{name:'รายงานภาษีดอกเบี้ยบ้าน'})).toBeVisible();
  await expect(page.locator('.tax-borrower-row')).toHaveCount(3);
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
