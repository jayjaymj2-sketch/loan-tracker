// Service Worker สำหรับแอพคำนวณหนี้บ้าน
// หน้าที่: เก็บไฟล์หน้าแอพ (HTML/manifest/ไอคอน) ไว้ใช้ออฟไลน์ได้
// ข้อมูลจริง (จาก Google Sheets/Apps Script) จะไม่ถูก cache เพราะต้องสดเสมอ

const CACHE_NAME = 'loan-tracker-cache-v2';
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
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // อย่า cache คำขอไปยัง Google Apps Script / Google APIs (ข้อมูลต้องสดเสมอ ไม่ใช่ของเก่า)
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return; // ปล่อยให้เบราว์เซอร์จัดการตามปกติ ไม่ผ่าน Service Worker
  }

  // เฉพาะ GET request เท่านั้นที่ cache ได้
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
