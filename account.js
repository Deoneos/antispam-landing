// ===== ЛИЧНЫЙ КАБИНЕТ =====
const API_BASE = 'https://antispam-api-zakharsakharov.amvera.io';

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

    const logoutHtml = `
        <button class="account-dropdown-logout" id="logout-active-btn">
            🚪 Выйти из аккаунта
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

    container.querySelectorAll('.group-card').forEach(card => {
        card.addEventListener('click', () => openGroupModal(card));
    });
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

    loadModalChart(chatId);
    loadModalViolators(chatId);

    document.getElementById('group-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('group-modal').style.display = 'none';
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

async function loadModalChart(chatId) {
    const canvas = document.getElementById('modal-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (modalChart) {
        modalChart.destroy();
        modalChart = null;
    }

    try {
        const response = await fetch(`${API_BASE}/api/timeline?chat_id=${chatId}&days=30`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const items = data.days || [];

        if (items.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#667';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Нет данных', canvas.width / 2, canvas.height / 2);
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
                        label: '🗑',
                        data: items.map(d => d.deleted || 0),
                        borderColor: '#2481cc',
                        backgroundColor: 'rgba(36, 129, 204, 0.12)',
                        borderWidth: 2, tension: 0.3, pointRadius: 0,
                        pointHoverRadius: 4, fill: true,
                    },
                    {
                        label: '⚖️',
                        data: items.map(d => d.bans || 0),
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.12)',
                        borderWidth: 2, tension: 0.3, pointRadius: 0,
                        pointHoverRadius: 4, fill: true,
                    },
                    {
                        label: '⚠️',
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
            container.innerHTML = '<p class="modal-violators-empty">Нарушителей нет</p>';
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
                    <div class="violator-count">${v.count} наруш.</div>
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
        if (!username) return;

        // Убираем @, если есть
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

            if (!response.ok) {
                throw new Error('Request failed');
            }

            const data = await response.json();

            status.className = 'magic-status success';
            status.textContent = data.message || 'Ссылка отправлена в Telegram!';
            status.style.display = 'block';

            input.value = '';
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

    if (tg && tg.initData && tg.initData.length > 10) {

        handleTelegramWebApp(tg.initData);
        return;
    }


    // Привязываем форму magic link
    bindMagicForm();

    // Переключатель языка
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const lang = btn.getAttribute('data-lang');
            if (localStorage.getItem('lang') === lang) return;
            if (typeof setLanguage === 'function') {
                setLanguage(lang);
            }
        });
    });

    
    
    // Прямые обработчики (надёжнее в WebView Telegram)
    const switcherBtn = document.getElementById('account-switcher');
    if (switcherBtn) {
        switcherBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown();
        };
    }

    // Обработчики внутри dropdown — через делегирование на контейнере
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

    // Стартовый экран с защитой
    let accounts = getAccounts();
    const activeId = getActiveId();

    // Чистим битые аккаунты (без user_id или token)
    const cleanAccounts = accounts.filter(a => a && a.user_id && a.token);
    if (cleanAccounts.length !== accounts.length) {
        console.warn('Удалены битые аккаунты:', accounts.length - cleanAccounts.length);
        saveAccounts(cleanAccounts);
        accounts = cleanAccounts;
    }

    // Если active_id указывает на несуществующий аккаунт — сбрасываем
    if (activeId && !accounts.some(a => a.user_id === activeId)) {
        console.warn('Сброс active_account_id (аккаунт не найден)');
        localStorage.removeItem('active_account_id');
    }

    if (accounts.length > 0 && getActiveId()) {
        showDashboard();
    } else {
        showLogin();
    }
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
