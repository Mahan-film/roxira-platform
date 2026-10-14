/*
 * Service Worker «قاضی هوشمند» — نسخهٔ ۱
 *
 * سیاست کش:
 *   • درخواست‌های /api/* هرگز کش نمی‌شوند (همیشه شبکه؛ داده‌های حساس/پویا).
 *   • ناوبری صفحه‌ها (mode === "navigate") → فقط شبکه؛ HTML صفحه‌ها کش نمی‌شود (صفحه‌های
 *     واردشده داده‌های کاربر دارند) و در قطعی شبکه صفحهٔ آفلاین /offline نمایش داده می‌شود.
 *   • دارایی‌های استاتیک (_next/static، فونت، آیکون، تصویر، css/js) → cache-first.
 *   • سایر درخواست‌ها (از جمله RSC) دست‌نخورده به شبکه می‌روند.
 * درخواست‌های غیر GET و درخواست‌های cross-origin دست‌نخورده رها می‌شوند.
 */

const CACHE_VERSION = "ghazi-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [OFFLINE_URL, "/icons/ghazi-192.svg", "/icons/ghazi-512.svg"];

const STATIC_DESTINATIONS = ["style", "script", "font", "image"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ghazi-") && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url, request) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname.startsWith("/fonts/")) return true;
  return STATIC_DESTINATIONS.includes(request.destination);
}

async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // هرگز مسیرهای API را کش نکن.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigateOrOffline(request));
    return;
  }

  if (isStaticAsset(url, request)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE).catch(() => caches.match(request).then((r) => r || Response.error())));
  }
});
