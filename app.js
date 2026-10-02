// ===== ИНИЦИАЛИЗАЦИЯ =====
// Применяем переводы сразу при загрузке
document.addEventListener('DOMContentLoaded', () => {
    applyTranslations();

    // Переключатель языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const lang = btn.getAttribute('data-lang');
            // Проверяем через localStorage — надёжнее
            if (localStorage.getItem('lang') === lang) return;
            setLanguage(lang);
        });
    });

    // Плавное появление секций при скролле (простая анимация)
    setupScrollReveal();
});

// ===== ПЛАВНОЕ ПОЯВЛЕНИЕ =====
function setupScrollReveal() {
    const sections = document.querySelectorAll('section');
    if (!('IntersectionObserver' in window)) return;

    sections.forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
    });

    sections.forEach(section => observer.observe(section));
}
// ===== LIVE STATS =====
const API_BASE = 'https://antispam-api-zakharsakharov.amvera.io';

async function loadGlobalStats() {
    try {
        const response = await fetch(`${API_BASE}/api/global_stats`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        animateNumber('stat-chats', data.total_chats || 0);
        animateNumber('stat-deleted', data.total_deleted || 0);
        animateNumber('stat-bans', data.total_bans || 0);
        animateNumber('stat-violations', data.total_violations || 0);
    } catch (e) {
        console.warn('Failed to load global stats:', e);
        // Показываем прочерки
        ['stat-chats', 'stat-deleted', 'stat-bans', 'stat-violations'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
    }
}

// Анимация числа от 0 до target
function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const duration = 1200;
    const start = performance.now();

    function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(eased * target);
        el.textContent = current.toLocaleString('ru-RU');

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = target.toLocaleString('ru-RU');
        }
    }

    requestAnimationFrame(update);
}

// Вызываем после загрузки страницы
document.addEventListener('DOMContentLoaded', () => {
    // Небольшая задержка для красоты — сначала появляется секция
    setTimeout(loadGlobalStats, 300);
});

window.loadGlobalStats = loadGlobalStats;
// ===== ЛОГИКА ФОРМЫ (заглушка) =====
// Пока нет формы, но если добавим — вот заготовка
// (можно удалить при желании)

// ===== АНАЛИТИКА (заглушка) =====
// Тут можно добавить счётчики: Яндекс.Метрика, Google Analytics
// Например:
// (function(m,e,t,r,i,k,a){...})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym','00000000');