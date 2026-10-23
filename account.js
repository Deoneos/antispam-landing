// ===== ЛИЧНЫЙ КАБИНЕТ =====
const API_BASE = 'https://telegram-bot-zakharsakharov.msk1.amvera.tech';

// Ключи localStorage
const ACCOUNTS_KEY = 'accounts';           // [{user_id, first_name, username, photo_url, token, added_at}]
const ACTIVE_ID_KEY = 'active_account_id'; // user_id

// ===== DOM =====
const loadingSection = document.getElementById('loading');
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard');
const userHeader = document.getElementById('user-header');
const switcherAvatar = document.getElementById('switcher-avatar');
const switcherName = document.getElementById('switcher-name');
const accountDropdown = document.getElementById('account-dropdown');
const accountList = document.getElementById('account-list');
const addAccountBtn = document.getElementById('add-account-btn');

// ===== РАБОТА С АККАУНТАМИ =====
function getAccounts() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function getActiveId() {
    const id = localStorage.getItem(ACTIVE_ID_KEY);
    return id ? parseInt(id, 10) : null;
}

function setActiveId(userId) {
    localStorage.setItem(ACTIVE_ID_KEY, String(userId));
}

function getActiveAccount() {
    const id = getActiveId();
    if (id === null) return null;
    return getAccounts().find(a => a.user_id === id) || null;
}

function addOrUpdateAccount(user, token) {
    const accounts = getAccounts();
    const idx = accounts.findIndex(a => a.user_id === user.user_id);

    const account = {
        user_id: user.user_id,
        first_name: user.first_name || '',
        username: user.username || '',
        photo_url: user.photo_url || '',
        token,
        added_at: new Date().toISOString(),
    };

    if (idx >= 0) {
        accounts[idx] = account;
    } else {
        accounts.push(account);
    }

    saveAccounts(accounts);
    setActiveId(user.user_id);
}

function removeAccount(userId) {
    let accounts = getAccounts();
    accounts = accounts.filter(a => a.user_id !== userId);
    saveAccounts(accounts);

    if (getActiveId() === userId) {
        if (accounts.length > 0) {
            setActiveId(accounts[0].user_id);
        } else {
            localStorage.removeItem(ACTIVE_ID_KEY);
        }
    }
}

function switchToAccount(userId) {
    setActiveId(userId);
    closeDropdown();
    loadDashboard();
}

// ===== ТОКЕН ТЕКУЩЕГО АККАУНТА =====
function getToken() {
    const acc = getActiveAccount();
    return acc ? acc.token : null;
}

// ===== API =====
async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        // Токен протух — удаляем этот аккаунт
        const activeId = getActiveId();
        if (activeId) {
            removeAccount(activeId);
        }
        showLogin();
        throw new Error('Unauthorized');
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/csv')) {
        return response.blob();
    }

    return response.json();
}

// ===== АВТОРИЗАЦИЯ =====
async function loginWithTelegram(userData) {
    try {
        const response = await fetch(`${API_BASE}/api/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData),
        });

        if (!response.ok) {
            throw new Error('Auth failed');
        }

        const data = await response.json();
        addOrUpdateAccount(data.user, data.token);
        closeDropdown();
        loadDashboard();
    } catch (e) {
        console.error('Login error:', e);
        alert('Ошибка авторизации. Попробуйте ещё раз.');
    }
}

// ===== ОТОБРАЖЕНИЕ =====
function showLogin() {
    loadingSection.style.display = 'none';
    loginSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    userHeader.style.display = 'none';

    // Сбрасываем состояние magic-формы (плашку, поле, кнопку)
    const status = document.getElementById('magic-status');
    if (status) {
        status.style.display = 'none';
        status.className = 'magic-status';
        status.textContent = '';
    }

    const input = document.getElementById('magic-username');
    if (input) {
        input.value = '';
        input.disabled = false;
    }

    const btn = document.getElementById('magic-submit');
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Получить ссылку для входа';
    }

    renderTelegramWidget();
}

function showDashboard() {
    const acc = getActiveAccount();

    if (!acc) {
        console.warn('showDashboard: нет аккаунта, показываю логин');
        showLogin();
        return;
    }

    loadingSection.style.display = 'none';
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    userHeader.style.display = 'flex';
    renderSwitcher();
    loadDashboard();
}

function renderSwitcher() {
    const acc = getActiveAccount();

    if (!acc) {
        userHeader.style.display = 'none';
        return;
    }

    const name = acc.first_name || acc.username || 'Пользователь';
    switcherName.textContent = name;

    if (acc.photo_url) {
        switcherAvatar.style.backgroundImage = `url('${acc.photo_url}')`;
        switcherAvatar.textContent = '';
    } else {
        switcherAvatar.textContent = name[0].toUpperCase();
        switcherAvatar.style.backgroundImage = '';
    }
}

// ===== DROPDOWN =====
function renderDropdown() {
    const accounts = getAccounts();
    const activeId = getActiveId();

    const accountsHtml = accounts.map(a => {
        const name = a.first_name || a.username || 'Пользователь';
        const initial = name[0].toUpperCase();
        const isActive = a.user_id === activeId;

        const avatarStyle = a.photo_url
            ? `style="background-image: url('${a.photo_url}'); background-size: cover;"` 
            : '';

        const activeBadge = isActive ? ' <span style="color:#5aa9e6;font-size:11px;">✓</span>' : '';

        return `
            <div class="account-item ${isActive ? 'active' : ''}" data-user-id="${a.user_id}">
                <div class="account-item-avatar" ${avatarStyle}>${a.photo_url ? '' : initial}</div>
                <div class="account-item-info">
                    <div class="account-item-name">${escapeHtml(name)}${activeBadge}</div>
                    <div class="account-item-id">ID: ${a.user_id}</div>
                </div>
                <button class="account-item-delete" data-delete-id="${a.user_id}" title="Удалить из списка">✕</button>
            </div>
        `;
    }).join('');

    const logoutText = (typeof t === 'function') ? t('account.logout_full') : '🚪 Выйти из аккаунта';
    const logoutHtml = `
        <button class="account-dropdown-logout" id="logout-active-btn">
            ${logoutText}
        </button>
    `;

    accountList.innerHTML = accountsHtml + logoutHtml;
}

function openDropdown() {
    renderDropdown();
    accountDropdown.style.display = 'block';
}

function closeDropdown() {
    accountDropdown.style.display = 'none';
}

function toggleDropdown() {
    if (accountDropdown.style.display === 'block') {
        closeDropdown();
    } else {
        openDropdown();
    }
}

// ===== TELEGRAM WIDGET =====
function renderTelegramWidget() {
    const container = document.getElementById('tg-widget-container');
    if (!container) return;

    container.innerHTML = '';

    // Если аккаунты уже есть — показываем пояснение
    const hint = document.getElementById('add-account-hint');
    if (hint) {
        hint.style.display = getAccounts().length > 0 ? 'block' : 'none';
    }

    window.onTelegramAuth = function(user) {
        loginWithTelegram(user);
    };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', 'ANTI_SPAM_MWKbot');
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');

    container.appendChild(script);
}

// ===== ЗАГРУЗКА ДАННЫХ =====
async function loadDashboard() {
    try {
        const data = await apiFetch('/api/account/groups');

        document.getElementById('stat-chats').textContent = data.stats.total_chats || 0;
        document.getElementById('stat-deleted').textContent = data.stats.total_deleted || 0;
        document.getElementById('stat-bans').textContent = data.stats.total_bans || 0;
        document.getElementById('stat-violations').textContent = data.stats.total_violations || 0;

        renderGroups(data.groups || []);
        renderSwitcher();
    } catch (e) {
        console.error('Load dashboard error:', e);
        document.getElementById('groups-list').innerHTML = `
            <div class="dashboard-empty">
                <div class="dashboard-empty-icon">⚠️</div>
                <p>Не удалось загрузить данные</p>
            </div>
        `;
    }
}

function renderGroups(groups) {
    const container = document.getElementById('groups-list');

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="dashboard-empty">
                <div class="dashboard-empty-icon">📭</div>
                <p>У вас пока нет групп с ботом</p>
                <p style="font-size: 13px; margin-top: 8px; color: #667;">
                    Добавьте бота в группу — она появится здесь
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = groups.map(g => {
        const title = g.title || 'Без названия';
        const initial = title.trim()[0].toUpperCase();

        return `
            <div class="group-card" data-chat-id="${g.telegram_chat_id}"
                 data-title="${escapeHtml(title)}"
                 data-deleted="${g.deleted_count || 0}"
                 data-bans="${g.bans_count || 0}"
                 data-violations="${g.violations_count || 0}">
                <div class="group-avatar">${initial}</div>
                <div class="group-info">
                    <div class="group-name">${escapeHtml(title)}</div>
                    <div class="group-meta">
                        <span>🗑 ${g.deleted_count || 0}</span>
                        <span>⚖️ ${g.bans_count || 0}</span>
                        <span>⚠️ ${g.violations_count || 0}</span>
                    </div>
                </div>
                <div class="group-arrow">›</div>
            </div>
        `;
    }).join('');

    // Клики обрабатываются через глобальное делегирование ниже
    // (надёжнее, чем addEventListener на каждой карточке)
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ===== МОДАЛКА =====
function openGroupModal(card) {
    const chatId = card.dataset.chatId;
    const title = card.dataset.title;

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-subtitle').textContent = `ID: ${chatId}`;
    document.getElementById('modal-deleted').textContent = card.dataset.deleted;
    document.getElementById('modal-bans').textContent = card.dataset.bans;
    document.getElementById('modal-violations').textContent = card.dataset.violations;

    const exportBtn = document.getElementById('modal-export');
    exportBtn.onclick = (e) => {
        e.preventDefault();
        downloadExport(chatId, title);
    };

    const tgBtn = document.getElementById('modal-open-tg');
    if (tgBtn) {
        tgBtn.href = 'https://t.me/ANTI_SPAM_MWKbot';
    }

    const savedDays = parseInt(localStorage.getItem('chart_days')) || 30;
    loadModalChart(chatId, savedDays);
    loadChatHealth(chatId);
    loadModalViolators(chatId);

    document.getElementById('group-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('group-modal').classList.remove('active');
}

async function downloadExport(chatId, title) {
    try {
        const blob = await apiFetch(`/api/account/group/${chatId}/export?days=30`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${chatId}_30d.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Export error:', e);
        alert('Ошибка экспорта');
    }
}

// ===== ГРАФИК В МОДАЛКЕ =====
let modalChart = null;

async function loadModalChart(chatId, days = 30) {
    const canvas = document.getElementById('modal-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Обновляем заголовок
    const titleEl = document.getElementById('modal-chart-title');
    if (titleEl) {
        const titleKey = `account.modal_chart_title_${days}`;
        titleEl.setAttribute('data-i18n', titleKey);
        titleEl.textContent = (typeof t === 'function')
            ? t(titleKey)
            : `📊 Активность за ${days} дней`;
    }

    // Обновляем активную кнопку
    document.querySelectorAll('.period-btn').forEach(btn => {
        const btnDays = parseInt(btn.getAttribute('data-days'));
        btn.classList.toggle('active', btnDays === days);
    });

    // Запоминаем выбор
    localStorage.setItem('chart_days', days);

    if (modalChart) {
        modalChart.destroy();
        modalChart = null;
    }

    try {
        const response = await fetch(`${API_BASE}/api/timeline?chat_id=${chatId}&days=${days}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const items = data.days || [];

        if (items.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#667';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            const noDataText = (typeof t === 'function') ? t('modal.chart_no_data') : 'Нет данных';
            ctx.fillText(noDataText, canvas.width / 2, canvas.height / 2);
            return;
        }

        const labels = items.map(d => {
            const p = d.date.split('-');
            return `${p[2]}.${p[1]}`;
        });

        modalChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: (typeof t === 'function') ? t('chart.deleted') : '🗑',
                        data: items.map(d => d.deleted || 0),
                        borderColor: '#2481cc',
                        backgroundColor: 'rgba(36, 129, 204, 0.12)',
                        borderWidth: 2, tension: 0.3, pointRadius: 0,
                        pointHoverRadius: 4, fill: true,
                    },
                    {
                        label: (typeof t === 'function') ? t('chart.bans') : '⚖️',
                        data: items.map(d => d.bans || 0),
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.12)',
                        borderWidth: 2, tension: 0.3, pointRadius: 0,
                        pointHoverRadius: 4, fill: true,
                    },
                    {
                        label: (typeof t === 'function') ? t('chart.violations') : '⚠️',
                        data: items.map(d => d.violations || 0),
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243, 156, 18, 0.12)',
                        borderWidth: 2, tension: 0.3, pointRadius: 0,
                        pointHoverRadius: 4, fill: true,
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12, padding: 8, font: { size: 11 },
                            color: '#8899b0',
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.85)',
                        padding: 8,
                        titleFont: { size: 12 },
                        bodyFont: { size: 12 },
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 10 }, color: '#667',
                            maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { size: 10 }, color: '#667', precision: 0,
                        },
                        grid: { color: 'rgba(128,128,128,0.1)' }
                    }
                }
            }
        });

    } catch (e) {
        console.error('Modal chart error:', e);
    }
}

// ===== ПЕРЕКЛЮЧАТЕЛЬ ПЕРИОДА ГРАФИКА =====
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.period-btn');
    if (!btn) return;

    e.preventDefault();

    const days = parseInt(btn.getAttribute('data-days'));
    if (!days) return;

    // Не перезагружаем, если уже выбрано
    const current = parseInt(localStorage.getItem('chart_days')) || 30;
    if (days === current) return;

    // Находим chatId текущей открытой модалки
    const modal = document.getElementById('group-modal');
    if (!modal || !modal.classList.contains('active')) return;

    // chatId можно достать из заголовка модалки (subtitle: "ID: -100...")
    const subtitle = document.getElementById('modal-subtitle');
    if (!subtitle) return;

    const match = subtitle.textContent.match(/-?\d+/);
    if (!match) return;

    const chatId = parseInt(match[0]);
    loadModalChart(chatId, days);
});


// ===== ТОП НАРУШИТЕЛЕЙ =====
async function loadModalViolators(chatId) {
    const container = document.getElementById('modal-violators-list');
    if (!container) return;

    container.innerHTML = '<p class="modal-violators-loading">Загрузка...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/top_violators?chat_id=${chatId}&limit=5`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const items = data.violators || [];

        if (items.length === 0) {
            const emptyText = (typeof t === 'function') ? t('account.modal_no_violators') : 'Нарушителей нет';
            container.innerHTML = `<p class="modal-violators-empty">${emptyText}</p>`;
            return;
        }

        container.innerHTML = items.map((v, i) => {
            const name = v.first_name || v.username || 'Без имени';
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

            return `
                <div class="violator-item">
                    <div class="violator-rank">${medal}</div>
                    <div class="violator-info">
                        <div class="violator-name">${escapeHtml(name)}</div>
                        <div class="violator-meta">${v.last_date || ''}</div>
                    </div>
                    <div class="violator-count">${(typeof t === 'function') ? t('violators.count', {n: v.count}) : v.count + ' наруш.'}</div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('Modal violators error:', e);
        container.innerHTML = '<p class="modal-violators-empty">Не удалось загрузить</p>';
    }
}



// ===== MAGIC LINK =====
async function handleMagicCode(code) {
    // Очищаем URL
    history.replaceState(null, '', window.location.pathname);

    if (!code || code.length < 10) {
        alert('Неверная ссылка. Запросите новую.');
        showLogin();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/verify_magic_link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Invalid code');
        }

        const data = await response.json();
        addOrUpdateAccount(data.user, data.token);
        showDashboard();
    } catch (e) {
        console.error('Magic link error:', e);
        alert('Ссылка устарела или уже использована. Запросите новую.');
        showLogin();
    }
}

function bindMagicForm() {
    const form = document.getElementById('magic-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const input = document.getElementById('magic-username');
        const btn = document.getElementById('magic-submit');
        const status = document.getElementById('magic-status');

let username = (input.value || '').trim();
if (!username) {
    status.className = 'magic-status error';
    status.textContent = 'Введите @username в Telegram';
    status.style.display = 'block';
    return;
}

        username = username.replace(/^@/, '');

        btn.disabled = true;
        btn.textContent = 'Отправляем...';
        status.style.display = 'none';

        try {
            const response = await fetch(`${API_BASE}/api/auth/request_magic_link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            });

            if (!response.ok) throw new Error('Request failed');

            const data = await response.json();

            status.className = 'magic-status success';
            status.innerHTML = `
                📱 <b>Ссылка отправлена в Telegram!</b><br>
                Откройте сообщение на телефоне и нажмите на ссылку — кабинет
                откроется на этом компьютере автоматически.
                <div class="magic-waiting">
                    <span class="magic-spinner"></span> Ожидаем подтверждения...
                </div>
            `;
            status.style.display = 'block';

            input.value = '';

            if (data.poll_token) {
                const ok = await pollMagicLink(data.poll_token);
                if (!ok) {
                    status.className = 'magic-status error';
                    status.textContent = '⏱ Время ожидания истекло. Попробуйте снова.';
                }
                // при успехе showDashboard() переключит экран
            }
        } catch (e) {
            console.error('Magic request error:', e);
            status.className = 'magic-status error';
            status.textContent = 'Не удалось отправить ссылку. Попробуйте позже.';
            status.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Получить ссылку для входа';
        }
    });
}


async function pollMagicLink(pollToken, maxAttempts = 200, interval = 3000) {
    // 200 * 3s ≈ 10 минут — совпадает с TTL magic-ссылки
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, interval));
        try {
            const resp = await fetch(
                `${API_BASE}/api/auth/check_magic_link?poll_token=${encodeURIComponent(pollToken)}`
            );
            if (!resp.ok) continue;

            const data = await resp.json();

            if (data.status === 'used' && data.token && data.user) {
                addOrUpdateAccount(data.user, data.token);
                showDashboard();
                return true;
            }
            if (data.status === 'expired' || data.status === 'not_found') {
                return false;
            }
            // pending / used_no_token — продолжаем опрос
        } catch (e) {
            console.warn('poll error:', e);
        }
    }
    return false;
}




// ===== АВТОЛОГИН ЧЕРЕЗ MINI APP =====
async function handleTelegramWebApp(initData) {
    try {
        const response = await fetch(`${API_BASE}/api/auth/telegram_webapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        const data = await response.json();
        addOrUpdateAccount(data.user, data.token);
        showDashboard();
    } catch (e) {
        console.error('Telegram WebApp auth error:', e);

        const accounts = getAccounts();
        if (accounts.length > 0 && getActiveId()) {
            showDashboard();
        } else {
            showLogin();
        }
    }
}


// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

    // Проверяем Telegram WebApp initData (открытие как Mini App)
    const tg = window.Telegram?.WebApp;

    // В Mini App скрываем magic link (он для браузера)
    if (tg && tg.platform && tg.platform !== 'unknown') {
        const magicSection = document.getElementById('magic-section');
        const addHint = document.getElementById('add-account-hint');
        if (magicSection) magicSection.style.display = 'none';
        if (addHint) addHint.style.display = 'none';
    }

    // ===== ОБРАБОТКА URL ПАРАМЕТРОВ (magic / token) =====
    const urlParams = new URLSearchParams(window.location.search);
    const queryMagic = urlParams.get('magic');
    const queryToken = urlParams.get('token');
    const hash = window.location.hash;
    const hashMagic = hash.startsWith('#magic=') ? hash.slice(7) : null;
    const hashToken = hash.startsWith('#token=') ? hash.slice(7) : null;
    const magicCode = queryMagic || hashMagic;
    const urlToken = queryToken || hashToken;

    // ===== АВТОЛОГИН (НЕ блокирует остальную инициализацию!) =====
    if (tg && tg.initData && tg.initData.length > 10) {
        // Mini App — автологин в фоне
        handleTelegramWebApp(tg.initData);
    } else if (magicCode) {
        handleMagicCode(magicCode);
    } else if (urlToken) {
        handleBotToken(urlToken);
    } else {
        // Стартовый экран (только когда нет автологина)
        let accounts = getAccounts();
        const activeId = getActiveId();

        const cleanAccounts = accounts.filter(a => a && a.user_id && a.token);
        if (cleanAccounts.length !== accounts.length) {
            saveAccounts(cleanAccounts);
            accounts = cleanAccounts;
        }

        if (activeId && !accounts.some(a => a.user_id === activeId)) {
            localStorage.removeItem('active_account_id');
        }

        if (accounts.length > 0 && getActiveId()) {
            showDashboard();
        } else {
            showLogin();
        }
    }

    // ===== ДЕЛЕГИРОВАНИЕ КЛИКОВ НА КАРТОЧКИ ГРУПП =====
    document.addEventListener('click', (e) => {
        const card = e.target.closest('.group-card');
        if (card && !e.target.closest('.modal')) {
            e.preventDefault();
            openGroupModal(card);
        }
    });

    // Привязываем форму magic link
    bindMagicForm();

    // ===== ОБРАБОТЧИК СВИТЧЕРА (главный фикс!) =====
    const switcherBtn = document.getElementById('account-switcher');
    if (switcherBtn) {
        switcherBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown();
        };
    }

    // Переключатель языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const lang = btn.getAttribute('data-lang');
            if (localStorage.getItem('lang') === lang) return;
            if (typeof setLanguage === 'function') {
                setLanguage(lang);
                // Перерисовываем switcher и dropdown на новом языке
                if (typeof renderSwitcher === 'function') renderSwitcher();
                if (typeof renderDropdown === 'function') renderDropdown();
            }
        });
    });

    
    
    // Обработчики dropdown — делегирование на контейнере
    const dropdownEl = document.getElementById('account-dropdown');
    if (dropdownEl) {
        dropdownEl.onclick = (e) => {
            e.stopPropagation();

            const addBtn = e.target.closest('#add-account-btn');
            if (addBtn) {
                closeDropdown();
                showLogin();
                return;
            }

            const logoutBtn = e.target.closest('#logout-active-btn');
            if (logoutBtn) {
                handleLogout();
                return;
            }

            const deleteBtn = e.target.closest('.account-item-delete');
            if (deleteBtn) {
                const userId = parseInt(deleteBtn.dataset.deleteId, 10);
                handleDeleteAccount(userId);
                return;
            }

            const item = e.target.closest('.account-item');
            if (item) {
                const userId = parseInt(item.dataset.userId, 10);
                if (userId !== getActiveId()) {
                    switchToAccount(userId);
                } else {
                    closeDropdown();
                }
                return;
            }
        };
    }

    // Клик вне — закрыть dropdown
    document.addEventListener('click', (e) => {
        if (userHeader && !userHeader.contains(e.target)) {
            closeDropdown();
        }
    });

    // Убираем старую логику для addAccountBtn (если она ещё есть ниже)
    

    // Модалка — закрытие
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('group-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'group-modal') closeModal();
    });

});

// ===== ОБРАБОТЧИКИ =====
function handleLogout() {
    const activeId = getActiveId();
    if (!activeId) return;

    const acc = getAccounts().find(a => a.user_id === activeId);
    const name = acc ? (acc.first_name || acc.username || 'аккаунт') : 'аккаунт';

    if (confirm(`Выйти из аккаунта "${name}"?`)) {
        removeAccount(activeId);
        closeDropdown();
        const accounts = getAccounts();
        if (accounts.length === 0) {
            showLogin();
        } else {
            renderSwitcher();
            loadDashboard();
        }
    }
}

function handleDeleteAccount(userId) {
    const acc = getAccounts().find(a => a.user_id === userId);
    const name = acc ? (acc.first_name || acc.username || 'аккаунт') : 'аккаунт';

    if (confirm(`Удалить "${name}" из списка аккаунтов?`)) {
        removeAccount(userId);
        const accounts = getAccounts();
        if (accounts.length === 0) {
            closeDropdown();
            showLogin();
        } else {
            renderSwitcher();
            renderDropdown();
            loadDashboard();
        }
    }
}


// ===== ЗДОРОВЬЕ БОТА =====

async function loadChatHealth(chatId) {
    const dotEl = document.getElementById('health-dot');
    const statusEl = document.getElementById('health-status');
    const detailsEl = document.getElementById('health-details');
    const lastSyncEl = document.getElementById('health-last-sync');
    const pauseRow = document.getElementById('health-pause-row');
    const pauseUntilEl = document.getElementById('health-pause-until');
    const scheduleEl = document.getElementById('health-schedule');

    if (!dotEl || !statusEl) return;

    // Сброс в состояние загрузки
    dotEl.textContent = '⏳';
    statusEl.textContent = 'Проверка...';
    statusEl.className = 'modal-health-status loading';
    detailsEl.style.display = 'none';

    
    const currentUserId = (window.currentUser?.id || window.Telegram?.WebApp?.initDataUnsafe?.user?.id || localStorage.getItem('telegram_user_id'));
    if (!currentUserId || currentUserId === '0' || currentUserId === 0) {
        console.warn('loadChatHealth: ID пользователя не найден (вы не авторизованы или открыли вне Telegram).');
        dotEl.textContent = '⚪';
        statusEl.textContent = 'Требуется вход';
        statusEl.className = 'modal-health-status loading';
        detailsEl.style.display = 'none';
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/chat/${chatId}/health?user_id=${(currentUserId)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.ok) throw new Error('API error');

        // Статус
        let dot, statusText, statusClass;

        if (!data.is_active) {
            dot = '🔴';
            statusText = 'Бот не в группе';
            statusClass = 'off';
        } else if (data.is_paused) {
            dot = '🟡';
            statusText = 'На паузе';
            statusClass = 'paused';
        } else if (!data.moderation_enabled) {
            dot = '🟡';
            statusText = 'Модерация выключена';
            statusClass = 'paused';
        } else {
            dot = '🟢';
            statusText = 'Активен';
            statusClass = 'ok';
        }

        dotEl.textContent = dot;
        statusEl.textContent = statusText;
        statusEl.className = 'modal-health-status ' + statusClass;

        // Детали
        if (data.last_sync) {
            const syncDate = new Date(data.last_sync);
            const now = new Date();
            const diffMin = Math.round((now - syncDate) / 60000);
            let syncText;
            if (diffMin < 1) syncText = 'только что';
            else if (diffMin < 60) syncText = `${diffMin} мин назад`;
            else syncText = `${Math.round(diffMin / 60)} ч назад`;
            lastSyncEl.textContent = syncText;
        } else {
            lastSyncEl.textContent = 'нет данных';
        }

        if (data.is_paused && data.paused_until) {
            const pauseDate = new Date(data.paused_until);
            pauseUntilEl.textContent = pauseDate.toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
            pauseRow.style.display = 'flex';
        } else {
            pauseRow.style.display = 'none';
        }

        // Расписание
        const s = data.schedule;
        if (s.start === '00:00' && s.end === '23:59' && s.weekends) {
            scheduleEl.textContent = 'круглосуточно, 7 дней';
        } else {
            scheduleEl.textContent = `${s.start}–${s.end}${s.weekends ? ', выходные' : ', будни'}`;
        }

        detailsEl.style.display = 'block';
    } catch (e) {
        console.error('loadChatHealth error:', e);
        dotEl.textContent = '⚪';
        statusEl.textContent = 'Нет данных';
        statusEl.className = 'modal-health-status loading';
    }
}
