const VERSION = 'v3';
const CACHE = 'baby-' + VERSION;

// Предзагружаем только оболочку приложения. Аудио (16 МБ!) грузится по требованию.
const PRECACHE = [
    '/baby/',
    '/baby/index.html',
    '/baby/styles.css',
    '/baby/app.js',
    '/baby/chart.js',
    '/baby/manifest.json',
    '/baby/icons/icon-192.png',
    '/baby/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // Каждый файл отдельно: один сбой не срывает весь precache
        await Promise.all(PRECACHE.map(async (url) => {
            try {
                const res = await fetch(url, { cache: 'reload' });
                if (res.ok) await cache.put(url, res);
            } catch (err) {
                console.warn('precache skip:', url, err);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// Сеть с таймаутом
function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request).then(
            (res) => { clearTimeout(timer); resolve(res); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // API не кэшируем совсем
    if (url.pathname.includes('/api/')) return;

    // Аудио: cache-first, кладём в кэш при первом проигрывании
    if (url.pathname.startsWith('/baby/sounds/')) {
        e.respondWith((async () => {
            const cached = await caches.match(req);
            if (cached) return cached;
            const res = await fetch(req);
            if (res.ok) {
                const cache = await caches.open(CACHE);
                cache.put(req, res.clone());
            }
            return res;
        })());
        return;
    }

    // Навигация: сеть с таймаутом, иначе кэш, иначе стартовая страница
    if (req.mode === 'navigate') {
        e.respondWith((async () => {
            try {
                const res = await fetchWithTimeout(req, 4000);
                const cache = await caches.open(CACHE);
                cache.put('/baby/', res.clone());
                return res;
            } catch (err) {
                return (await caches.match(req)) || (await caches.match('/baby/')) ||
                       new Response('Нет соединения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        })());
        return;
    }

    // Статика того же origin: stale-while-revalidate
    if (url.origin === self.location.origin) {
        e.respondWith((async () => {
            const cached = await caches.match(req);
            const network = fetch(req).then((res) => {
                if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
                return res;
            }).catch(() => cached);
            return cached || network;
        })());
    }
});

// ========== WEB PUSH ==========
self.addEventListener('push', function (event) {
    if (!event.data) return;
    let data = {};
    try { data = event.data.json(); } catch (e) { data = { title: 'Трекер малыша', body: event.data.text() }; }
    const options = {
        body: data.body,
        icon: '/baby/icons/icon-192.png',
        badge: '/baby/icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: '/baby/' }
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Трекер малыша', options));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(clients.matchAll({ type: 'window' }).then(windowClients => {
        for (const client of windowClients) {
            if (client.url.includes('/baby/') && 'focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow('/baby/');
    }));
});
