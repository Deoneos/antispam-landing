// ===== LANDING i18n =====
const TRANSLATIONS = {
    // Header
    'header.add': { ru: 'Добавить бота', en: 'Add bot' },

    // Hero
    'hero.badge': { ru: '🛡️ Защита Telegram-групп', en: '🛡️ Telegram group protection' },
    'hero.title': {
        ru: 'Модерация групп музеев без спама и рекламы',
        en: 'Museum group moderation without spam and ads',
    },
    'hero.subtitle': {
        ru: 'Бот автоматически удаляет спам, рекламу и запрещённый контент, чтобы вы могли сосредоточиться на главном — общении с посетителями и коллегами.',
        en: 'The bot automatically removes spam, ads and prohibited content, so you can focus on what matters — talking to visitors and colleagues.',
    },
    'hero.cta': { ru: 'Добавить бота в группу', en: 'Add bot to group' },
    'hero.cta_secondary': { ru: 'Открыть в Telegram', en: 'Open in Telegram' },

    // Trust
    'trust.label': { ru: 'Уже используют группы музеев:', en: 'Already used by museum groups:' },
    'trust.hint': { ru: 'И ещё несколько сообществ', en: 'And a few more communities' },

    // Features
    'features.title': { ru: 'Что умеет бот', en: 'What the bot can do' },
    'features.spam.title': { ru: 'Ловит спам', en: 'Catches spam' },
    'features.spam.text': {
        ru: 'Удаляет рекламу, спам-работу, наркотики и 18+ контент автоматически.',
        en: 'Removes ads, spam-job offers, drugs and 18+ content automatically.',
    },
    'features.ocr.title': { ru: 'Распознаёт текст на картинках', en: 'Reads text on images' },
    'features.ocr.text': {
        ru: 'Если спам спрятан в фото, GIF или видео — бот прочитает текст и удалит его.',
        en: 'If spam is hidden in a photo, GIF or video, the bot will read the text and remove it.',
    },
    'features.punish.title': { ru: 'Прогрессивные наказания', en: 'Progressive punishments' },
    'features.punish.text': {
        ru: '1-е нарушение — мут 1 час, 5-е — бан навсегда. Никаких случайных блокировок.',
        en: '1st violation — 1h mute, 5th — permanent ban. No accidental blocks.',
    },
    'features.flood.title': { ru: 'Защита от флуда', en: 'Antiflood protection' },
    'features.flood.text': {
        ru: 'Если кто-то клеит сообщения пачками — бот временно заглушит нарушителя.',
        en: 'If someone floods the chat, the bot will mute the offender temporarily.',
    },
    'features.stats.title': { ru: 'Понятная статистика', en: 'Clear statistics' },
    'features.stats.text': {
        ru: 'Графики активности, категории спама и топ нарушителей — в Telegram прямо в панели управления.',
        en: 'Activity charts, spam categories and top violators — right in Telegram.',
    },
    'features.lang.title': { ru: 'Русский и английский', en: 'Russian and English' },
    'features.lang.text': {
        ru: 'Интерфейс и уведомления на двух языках. Для групп с иностранными гостями.',
        en: 'Interface and notifications in two languages. For groups with international visitors.',
    },

    // How it works
    'how.title': { ru: 'Как это работает', en: 'How it works' },
    'how.step1.title': { ru: 'Добавьте бота', en: 'Add the bot' },
    'how.step1.text': {
        ru: 'Нажмите «Добавить бота» — откроется Telegram, выберите вашу группу.',
        en: 'Tap "Add bot" — Telegram opens, choose your group.',
    },
    'how.step2.title': { ru: 'Назначьте админом', en: 'Make it admin' },
    'how.step2.text': {
        ru: 'Дайте боту права удалять сообщения и блокировать участников.',
        en: 'Grant the bot rights to delete messages and ban users.',
    },
    'how.step3.title': { ru: 'Готово', en: 'Done' },
    'how.step3.text': {
        ru: 'Бот сразу начнёт защищать группу. Управление — через /my в личке бота.',
        en: 'The bot will start protecting the group. Manage via /my in bot DM.',
    },

    // FAQ
    'faq.title': { ru: 'Частые вопросы', en: 'Frequently asked questions' },
    'faq.q1': { ru: 'Сколько это стоит?', en: 'How much does it cost?' },
    'faq.a1': {
        ru: 'Бесплатно. Бот создан для поддержки групп музеев «Моя страна. Моя история».',
        en: 'Free. The bot was created to support museum groups.',
    },
    'faq.q2': { ru: 'Нужен ли программист для настройки?', en: 'Do I need a programmer to set it up?' },
    'faq.a2': {
        ru: 'Нет. Добавили в группу, дали права — и всё. Дальше управление идёт через кнопки и команды.',
        en: 'No. Add it to the group, grant rights — done. Management is via buttons and commands.',
    },
    'faq.q3': { ru: 'Может ли бот случайно забанить нормального человека?', en: 'Can the bot accidentally ban a normal user?' },
    'faq.a3': {
        ru: 'Бот работает по принципу «сначала мут, потом бан». Первое нарушение — мут на 1 час, а не блокировка. Владелец всегда может снять наказание вручную.',
        en: 'The bot uses "mute first, ban later". First violation is 1-hour mute, not a ban. The owner can always lift a punishment manually.',
    },
    'faq.q4': { ru: 'Что видит владелец группы?', en: 'What does the group owner see?' },
    'faq.a4': {
        ru: 'Статистику: сколько удалено, сколько забанено, топ нарушителей и категории спама. Всё — в удобной панели прямо в Telegram.',
        en: 'Statistics: how many deleted, banned, top violators and spam categories. All in a convenient panel right in Telegram.',
    },
    'faq.q5': { ru: 'Куда обращаться за помощью?', en: 'Where to get help?' },
    'faq.a5': {
        ru: 'Напишите @zakharsakharov в Telegram — ответим в течение дня.',
        en: 'Message @zakharsakharov on Telegram — we usually reply within a day.',
    },

    // Final CTA
    'cta.title': { ru: 'Готовы защитить свою группу?', en: 'Ready to protect your group?' },
    'cta.text': {
        ru: 'Добавьте бота — подключение занимает меньше минуты.',
        en: 'Add the bot — setup takes less than a minute.',
    },
    'cta.button': { ru: 'Добавить бота в группу', en: 'Add bot to group' },

    // Footer
    'footer.bot': { ru: 'Бот', en: 'Bot' },
    'footer.support': { ru: 'Поддержка', en: 'Support' },
    'footer.panel': { ru: 'Панель управления', en: 'Control panel' },
    'footer.made': { ru: 'Сделано с заботой о музеях', en: 'Made with care for museums' },
};

// ===== ОПРЕДЕЛЕНИЕ ЯЗЫКА =====
function detectLanguage() {
    const saved = localStorage.getItem('lang');
    if (saved === 'ru' || saved === 'en') return saved;

    const browserLang = (navigator.language || 'ru').toLowerCase();
    if (browserLang.startsWith('en')) return 'en';

    return 'ru';
}

let currentLang = detectLanguage();

// ===== ПЕРЕВОД =====
function t(key, params = {}) {
    const entry = TRANSLATIONS[key];
    if (!entry) {
        console.warn(`i18n: missing key "${key}"`);
        return key;
    }
    let text = entry[currentLang] || entry.ru || key;
    Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
    return text;
}

// ===== ПРИМЕНЕНИЕ =====
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    document.querySelectorAll('.lang-btn').forEach(btn => {
        const btnLang = btn.getAttribute('data-lang');
        btn.classList.toggle('active', btnLang === currentLang);
    });

    document.documentElement.lang = currentLang;
}

// ===== СМЕНА ЯЗЫКА =====
function setLanguage(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    currentLang = lang;
    localStorage.setItem('lang', lang);
    applyTranslations();
}

// Экспорт
window.t = t;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.currentLang = () => currentLang;