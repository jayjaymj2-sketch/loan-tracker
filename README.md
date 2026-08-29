# Home Loan Tracker

แอปติดตามหนี้บ้านแบบ static PWA ใช้ Google Apps Script และ Google Sheets เป็นระบบกลาง

หน้าจอแบ่งเป็น 4 หมวด — ภาพรวม, แผนปลดหนี้, ประวัติและการชำระ, ตั้งค่า — และปรับขนาดตัวอักษรได้ 3 ระดับ โดยจดจำค่าที่เลือกไว้ในอุปกรณ์

## โครงสร้าง

- `loan_tracker.html` — โครงหน้าและหน้าต่างยืนยัน
- `styles.css` — รูปแบบทั้งหมดของแอป
- `js/app.js` — การแสดงผล การคำนวณ และการเชื่อมหน้าจอ
- `js/receipt-parser.js` — แปลงข้อความจาก PDF/OCR เป็นข้อมูลใบเสร็จ
- `js/sync-version.js` — จัดการเลขเวอร์ชันและตรวจข้อมูลชนกัน
- `apps-script/Code.gs` — backend ที่ใช้ ScriptLock และ optimistic concurrency
- `tests/` — ชุดทดสอบ parser, versioning และโครงสร้าง build

## ทดสอบ

```bash
npm install
npm run ci
```

GitHub Actions จะรันคำสั่งเดียวกันทุกครั้งที่ push หรือเปิด pull request

## ใบเสร็จรูปภาพ

รูปถูกประมวลผลในเบราว์เซอร์ด้วย Tesseract.js ภาษาไทยและอังกฤษ ไฟล์รูปไม่ถูกอัปโหลดไปยัง Apps Script ส่วน PDF ใช้ pdf.js เหมือนเดิม ข้อมูลที่อ่านได้จะต้องผ่านหน้าตรวจสอบก่อนบันทึกเสมอ

## เปิดใช้การป้องกันข้อมูลพร้อมกัน

หน้าเว็บรองรับเลขเวอร์ชันแล้ว แต่ต้อง deploy `apps-script/Code.gs` เป็นเวอร์ชันใหม่ด้วยจึงจะเปิดใช้การล็อกเต็มรูปแบบ ดูขั้นตอนที่ `apps-script/README.md`
