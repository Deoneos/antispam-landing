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
}// ===== LIVE STATS =====
const API_BASE = 'https://telegram-bot-zakharsakharov.msk1.amvera.tech';

let liveStatsLastUpdated = null;
let liveStatsPrevValues = {};
let liveStatsFailCount = 0;

async function loadGlobalStats() {
    try {
        const response = await fetch(`${API_BASE}/api/global_stats`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // Анимация перехода от старого к новому
        animateNumber('stat-chats', data.total_chats || 0);
        animateNumber('stat-deleted', data.total_deleted || 0);
        animateNumber('stat-bans', data.total_bans || 0);
        animateNumber('stat-violations', data.total_violations || 0);

        // Скрываем плашку stale, если она была
        const staleEl = document.getElementById('live-stale');
        if (staleEl) staleEl.style.display = 'none';

        liveStatsLastUpdated = Date.now();
        liveStatsFailCount = 0;
        updateTimeAgo();
    } catch (e) {
        console.warn('Failed to load global stats:', e);
        liveStatsFailCount++;

        // Показываем stale-плашку после 2 неудачных попыток
        if (liveStatsFailCount >= 2) {
            const staleEl = document.getElementById('live-stale');
            if (staleEl) staleEl.style.display = 'block';
        }

        // Ставим прочерки, только если не было предыдущих данных
        if (!liveStatsLastUpdated) {
            ['stat-chats', 'stat-deleted', 'stat-bans', 'stat-violations'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '—';
            });
        }
    }
}

// Таймер "обновлено X сек/мин назад"
function updateTimeAgo() {
    const el = document.getElementById('live-updated');
    if (!el || !liveStatsLastUpdated) return;

    const secondsAgo = Math.floor((Date.now() - liveStatsLastUpdated) / 1000);

    let text;
    if (secondsAgo < 5) {
        text = (typeof t === 'function') ? t('live.updated_just_now') : 'обновлено только что';
    } else if (secondsAgo < 60) {
        text = (typeof t === 'function')
            ? t('live.updated_seconds_ago', { n: secondsAgo })
            : `обновлено ${secondsAgo} сек назад`;
    } else {
        const minutes = Math.floor(secondsAgo / 60);
        text = (typeof t === 'function')
            ? t('live.updated_minutes_ago', { n: minutes })
            : `обновлено ${minutes} мин назад`;
    }
    el.textContent = text;
}

// Анимация числа от старого к новому
function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = parseInt(liveStatsPrevValues[elementId] || 0);
    liveStatsPrevValues[elementId] = target;

    // Если число не изменилось — не перерисовываем
    if (start === target) {
        el.textContent = target.toLocaleString('ru-RU');
        return;
    }

    const duration = 1200;
    const t0 = performance.now();

    function update(now) {
        const progress = Math.min((now - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(start + (target - start) * eased);
        el.textContent = current.toLocaleString('ru-RU');

        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = target.toLocaleString('ru-RU');
    }
    requestAnimationFrame(update);
}

// ===== SPARKLINE (14 дней) =====
async function loadSparkline() {
    const canvas = document.getElementById('live-sparkline');
    if (!canvas) return;

    try {
        const response = await fetch(`${API_BASE}/api/global_daily_stats?days=14`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        drawSparkline(canvas, data.days || []);
    } catch (e) {
        console.warn('Sparkline load error:', e);
    }
}

function drawSparkline(canvas, days) {
    const ctx = canvas.getContext('2d');

    // Адаптивный размер (для retina)
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth - 40;
    const cssHeight = 60;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (!days.length) return;

    const values = days.map(d => d.deleted || 0);
    const maxVal = Math.max(...values, 1);
    const padding = { top: 8, right: 4, bottom: 4, left: 4 };
    const w = cssWidth - padding.left - padding.right;
    const h = cssHeight - padding.top - padding.bottom;

    const stepX = w / Math.max(values.length - 1, 1);

    // Точки
    const points = values.map((v, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + h - (v / maxVal) * h,
    }));

    // Заливка
    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + h);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padding.top + h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + h);
    grad.addColorStop(0, 'rgba(36, 129, 204, 0.35)');
    grad.addColorStop(1, 'rgba(36, 129, 204, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Линия
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#2481cc';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Точки на концах
    ctx.fillStyle = '#5aa9e6';
    points.forEach((p, i) => {
        if (i === 0 || i === points.length - 1) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

// Автозагрузка + периодическое обновление
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadGlobalStats, 300);
    setTimeout(loadSparkline, 500);

    // Обновление каждые 30 секунд
    setInterval(loadGlobalStats, 30000);
    setInterval(loadSparkline, 60000);

    // Таймер "обновлено X сек назад" — каждую секунду
    setInterval(updateTimeAgo, 1000);

    // Перерисовка sparkline при ресайзе
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(loadSparkline, 300);
    });
});

window.loadGlobalStats = loadGlobalStats;
window.loadSparkline = loadSparkline;
// ===== АНАЛИТИКА: цели =====
// Отслеживаем клики по кнопкам "Добавить бота"
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href*="ANTI_SPAM_MWKbot?startgroup"]').forEach(link => {
        link.addEventListener('click', () => {
            if (typeof ym === 'function') {
                ym(113334145, 'reachGoal', 'add_to_group');
            }
        });
    });

    // Клики по переключателю языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.getAttribute('data-lang');
            if (typeof ym === 'function') {
                ym(113334145, 'reachGoal', `lang_switch_${lang}`);
            }
        });
    });

    // Клики по ссылке на бота (Открыть в Telegram)
    document.querySelectorAll('a[href="https://t.me/ANTI_SPAM_MWKbot"]').forEach(link => {
        link.addEventListener('click', () => {
            if (typeof ym === 'function') {
                ym(113334145, 'reachGoal', 'open_bot_dm');
            }
        });
    });
});
// ===== ЛОГИКА ФОРМЫ (заглушка) =====
// Пока нет формы, но если добавим — вот заготовка
// (можно удалить при желании)

// ===== АНАЛИТИКА (заглушка) =====
// Тут можно добавить счётчики: Яндекс.Метрика, Google Analytics
// Например:
// (function(m,e,t,r,i,k,a){...})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym','00000000');

// ===== ПРОВЕРКА АВТОРИЗАЦИИ (для кнопки "Войти") =====
function checkAuth() {
    try {
        const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
        const activeId = localStorage.getItem('active_account_id');
        const loginBtn = document.querySelector('.header-account-btn');

        if (!loginBtn) return;

        if (accounts.length > 0 && activeId) {
            // Пользователь залогинен — меняем кнопку
            const active = accounts.find(a => a.user_id === parseInt(activeId, 10));
            const name = active ? (active.first_name || active.username || 'Кабинет') : 'Кабинет';

            loginBtn.innerHTML = `<span data-i18n="header.account_logged">👤 ${name}</span>`;
            loginBtn.href = 'account.html';
            loginBtn.classList.remove('btn-secondary');
            loginBtn.classList.add('btn-primary');
        }
    } catch (e) {
        console.warn('Auth check error:', e);
    }
}

document.addEventListener('DOMContentLoaded', checkAuth);
