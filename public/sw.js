// 只為了讓瀏覽器把網站視為可安裝的 App；刻意不快取任何內容，
// 商品資料一律即時向 Notion 取得，避免顯示過期的購買狀態
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
