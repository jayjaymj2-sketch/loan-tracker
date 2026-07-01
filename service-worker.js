// Service Worker สำหรับแอพคำนวณหนี้บ้าน
// หน้าที่: เก็บไฟล์หน้าแอพ (HTML/manifest/ไอคอน) ไว้ใช้ออฟไลน์ได้
// ข้อมูลจริง (จาก Google Sheets/Apps Script) จะไม่ถูก cache เพราะต้องสดเสมอ

const CACHE_NAME = 'loan-tracker-cache-v3'; // เพิ่มเลขนี้ทุกครั้งที่อัปเดตไฟล์ เพื่อบังคับเครื่องผู้ใช้ดึงเวอร์ชันใหม่
const ASSETS = [
  './loan_tracker.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting(); // ให้ service worker เวอร์ชันใหม่เข้าควบคุมทันที ไม่ต้องรอปิดแท็บ/แอพทั้งหมดก่อน
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // เข้าควบคุมหน้าที่เปิดค้างอยู่ทันที ไม่ต้องรอโหลดใหม่
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // อย่า cache คำขอไปยัง Google Apps Script / Google APIs (ข้อมูลต้องสดเสมอ ไม่ใช่ของเก่า)
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return; // ปล่อยให้เบราว์เซอร์จัดการตามปกติ ไม่ผ่าน Service Worker
  }

  // เฉพาะ GET request เท่านั้นที่ cache ได้
  if (event.request.method !== 'GET') return;

  // สำหรับการนำทางไปหน้า HTML (เช่น เปิดแอพ/รีเฟรช) ให้ข้าม HTTP cache ของเบราว์เซอร์ไปเลย
  // เพื่อให้ได้โค้ดฉบับล่าสุดจริงๆ ทุกครั้งที่มีอินเทอร์เน็ต (ไม่ใช่แค่ข้าม cache ของ Service Worker)
  const isNavigation = event.request.mode === 'navigate' || url.pathname.endsWith('.html');
  const fetchOptions = isNavigation ? { cache: 'no-store' } : {};

  event.respondWith(
    fetch(event.request, fetchOptions)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
