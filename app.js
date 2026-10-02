// ===== ИНИЦИАЛИЗАЦИЯ =====
// Применяем переводы сразу при загрузке
document.addEventListener('DOMContentLoaded', () => {
    applyTranslations();

    // Переключатель языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const lang = btn.getAttribute('data-lang');
            if (lang === currentLang()) return;
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

// ===== ЛОГИКА ФОРМЫ (заглушка) =====
// Пока нет формы, но если добавим — вот заготовка
// (можно удалить при желании)

// ===== АНАЛИТИКА (заглушка) =====
// Тут можно добавить счётчики: Яндекс.Метрика, Google Analytics
// Например:
// (function(m,e,t,r,i,k,a){...})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym','00000000');