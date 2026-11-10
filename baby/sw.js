const CACHE_NAME = 'baby-tracker-v1';
const ASSETS = [
    '/baby/',
    '/baby/chart.js',
    '/baby/sounds/white.mp3',
    '/baby/sounds/rain.mp3',
    '/baby/sounds/womb.mp3',
    '/baby/sounds/heart.mp3',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Установка: кэшируем файлы для мгновенной загрузки
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS).catch(err => console.log('Ошибка кэша:', err));
        })
    );
});

// Активация: удаляем старые кэши
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        })
    );
});

// Перехват запросов
self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/')) return; // API не кэшируем
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});

// ========== WEB PUSH ==========
self.addEventListener('push', function(event) {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👶</text></svg>',
            vibrate: [200, 100, 200],
            data: { url: '/baby/' }
        };
        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

// Клик по уведомлению — открываем приложение
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url.includes('/baby/') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/baby/');
            }
        })
    );
});