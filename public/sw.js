/* عامل الخدمة — يتيح تشغيل البوابة على الجوال دون اتصال مستقر */
/* eslint-env serviceworker */

'use strict';

// عند تعديل ملفات الواجهة ارفع رقم الإصدار لتحديث الذاكرة المؤقتة
const VERSION = 'v1';
const SHELL_CACHE = `madad-shell-${VERSION}`;
const DATA_CACHE = `madad-data-${VERSION}`;

/** ملفات هيكل التطبيق التي تُخزَّن عند التثبيت. */
const SHELL_ASSETS = [
  '/',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/api.js',
  '/js/ui.js',
  '/js/pwa.js',
  '/js/app.js',
  '/js/pages/dashboard.js',
  '/js/pages/profile.js',
  '/js/pages/employees.js',
  '/js/pages/departments.js',
  '/js/pages/attendance.js',
  '/js/pages/leaves.js',
  '/js/pages/payroll.js',
  '/js/pages/requests.js',
  '/js/pages/announcements.js',
  '/js/pages/documents.js',
  '/js/pages/fleet.js',
  '/js/pages/trips.js',
  '/js/pages/reports.js',
  '/js/pages/admin.js',
];

/** مسارات قراءة يُسمح بتخزين آخر نسخة منها للعرض دون اتصال. */
const CACHEABLE_API = [
  '/api/auth/me',
  '/api/dashboard',
  '/api/announcements',
  '/api/attendance',
  '/api/leaves',
  '/api/requests',
  '/api/trips',
  '/api/payroll/my-payslips',
  '/api/notifications',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll تفشل كلها إذا فشل ملف واحد، فنخزّن كل ملف على حدة
      .then((cache) => Promise.all(
        SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))
          .catch(() => null)),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('madad-') && !name.endsWith(VERSION))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isCacheableApi(pathname) {
  return CACHEABLE_API.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}?`)
    || pathname.startsWith(`${prefix}/`));
}

/** الشبكة أولاً مع الرجوع إلى النسخة المخزّنة عند الفشل. */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      // نُعلم الواجهة أن البيانات من ذاكرة محلية وليست محدّثة
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', '1');
      return new Response(await cached.blob(), {
        status: cached.status, statusText: cached.statusText, headers,
      });
    }
    throw error;
  }
}

/** الذاكرة أولاً مع تحديثها في الخلفية. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const update = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || update.then((response) => {
    if (response) return response;
    throw new Error('غير متصل ولا توجد نسخة مخزّنة');
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // لا نتعامل إلا مع طلبات النطاق نفسه
  if (url.origin !== self.location.origin) return;

  // تنزيل المستندات وتصدير التقارير يمرّ مباشرة إلى الشبكة
  if (url.pathname.includes('/download') || url.searchParams.get('format') === 'csv') return;

  // طلبات التصفّح: الشبكة أولاً ثم هيكل التطبيق المخزّن
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((cached) => cached
        || new Response('التطبيق غير متاح دون اتصال', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }))),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // عمليات الكتابة لا تُخزَّن أبداً — تُعاد رسالة واضحة عند انقطاع الاتصال
    if (request.method !== 'GET') {
      event.respondWith(
        fetch(request).catch(() => new Response(
          JSON.stringify({ error: 'لا يوجد اتصال بالإنترنت، سيُعاد المحاولة تلقائياً', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        )),
      );
      return;
    }

    if (isCacheableApi(url.pathname)) {
      event.respondWith(networkFirst(request, DATA_CACHE));
    }
    return;
  }

  // ملفات الواجهة الثابتة
  if (/\.(?:css|js|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
