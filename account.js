// ===== ЛИЧНЫЙ КАБИНЕТ =====
const API_BASE = 'https://antispam-api-zakharsakharov.amvera.io';
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// ===== DOM =====
const loadingSection = document.getElementById('loading');
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard');
const userHeader = document.getElementById('user-header');
const userHeaderName = document.getElementById('user-header-name');

// ===== СОСТОЯНИЕ =====
let currentToken = localStorage.getItem(TOKEN_KEY);
let currentUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');

// ===== API ХЕЛПЕР =====
async function apiFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        logout();
        throw new Error('Unauthorized');
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    // Для CSV — возвращаем blob
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/csv')) {
        return response.blob();
    }

    return response.json();
}

// ===== АВТОРИЗАЦИЯ =====
function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    currentToken = null;
    currentUser = null;
    showLogin();
}

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

        currentToken = data.token;
        currentUser = data.user;

        localStorage.setItem(TOKEN_KEY, currentToken);
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));

        showDashboard();
    } catch (e) {
        console.error('Login error:', e);
        alert('Ошибка авторизации. Попробуйте ещё раз.');
    }
}

// ===== ОТОБРАЖЕНИЕ СЕКЦИЙ =====
function showLogin() {
    loadingSection.style.display = 'none';
    loginSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    userHeader.style.display = 'none';
    renderTelegramWidget();
}

function showDashboard() {
    loadingSection.style.display = 'none';
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';

    if (currentUser) {
        userHeader.style.display = 'flex';
        userHeaderName.textContent = currentUser.first_name || currentUser.username || 'Пользователь';
    }

    loadDashboard();
}

// ===== TELEGRAM WIDGET =====
function renderTelegramWidget() {
    const container = document.getElementById('tg-widget-container');
    if (!container) return;

    container.innerHTML = '';

    // Callback для виджета — должен быть глобальным
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

        // Сводка
        document.getElementById('stat-chats').textContent = data.stats.total_chats || 0;
        document.getElementById('stat-deleted').textContent = data.stats.total_deleted || 0;
        document.getElementById('stat-bans').textContent = data.stats.total_bans || 0;
        document.getElementById('stat-violations').textContent = data.stats.total_violations || 0;

        // Группы
        renderGroups(data.groups || []);
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
        const added = (g.added_at || '').slice(0, 10);

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

    // Обработчики кликов
    container.querySelectorAll('.group-card').forEach(card => {
        card.addEventListener('click', () => {
            openGroupModal(card);
        });
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

    // Кнопка экспорта
    const exportBtn = document.getElementById('modal-export');
    exportBtn.onclick = (e) => {
        e.preventDefault();
        downloadExport(chatId, title);
    };

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

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    if (typeof applyTranslations === 'function') {
        applyTranslations();
    }

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

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logout);

    // Модалка — закрытие
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('group-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'group-modal') closeModal();
    });

    // Стартовый экран
    if (currentToken && currentUser) {
        showDashboard();
    } else {
        showLogin();
    }
});
