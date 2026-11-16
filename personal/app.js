'use strict';

// ===== КОНСТАНТЫ =====
const API_BASE = 'https://telegram-bot-zakharsakharov.msk1.amvera.tech';
const LS_STATE = 'personal_state_v1';
const LS_TOKEN = 'personal_token_v1';
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const DEFAULT_STATE = {
    credits: [],
    payments: [],
    workouts: { days: [0, 2, 4], duration: 60, done: {} },
    tx: [],
    categories: {
        out: ['Продукты', 'Дом', 'Транспорт', 'Здоровье', 'Дети', 'Кредиты', 'Развлечения', 'Прочее'],
        in: ['Зарплата', 'Подработка', 'Подарки', 'Прочее'],
    },
};

let state = clone(DEFAULT_STATE);
let activeTxType = 'out';
let selectedMonth = monthKey(new Date());
let editingCreditId = null;
let saveTimer = null;
let demoMode = false;

// ===== УТИЛИТЫ =====
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayISO() { return isoDate(new Date()); }

function parseISO(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function monthKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }

function money(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function moneyShort(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000) {
        return Math.round(number).toLocaleString('ru-RU') + ' ₽';
    }
    return money(number);
}

function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

function toast(message, isError) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ===== ХРАНЕНИЕ И СИНХРОНИЗАЦИЯ =====
function getToken() {
    try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; }
}

function setToken(value) {
    try { localStorage.setItem(LS_TOKEN, value); } catch (e) { /* приватный режим */ }
}

function headers(isJson) {
    const result = isJson ? { 'Content-Type': 'application/json' } : {};
    const token = getToken();
    if (token) result['X-Api-Token'] = token;
    return result;
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(LS_STATE);
        if (raw) {
            const parsed = JSON.parse(raw);
            state = Object.assign(clone(DEFAULT_STATE), parsed);
            state.workouts = Object.assign(clone(DEFAULT_STATE.workouts), parsed.workouts || {});
            state.categories = Object.assign(clone(DEFAULT_STATE.categories), parsed.categories || {});
        }
    } catch (e) {
        console.error('не смог прочитать локальные данные', e);
    }
}

function saveLocal() {
    if (demoMode) return;
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function scheduleSave() {
    saveLocal();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushToServer, 900);
}

async function pullFromServer() {
    if (!getToken()) return false;
    try {
        const response = await fetch(`${API_BASE}/api/personal/state`, { headers: headers(false) });
        if (response.status === 401) { showBanner('Токен не подошёл — введите заново'); return false; }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (payload.data) {
            state = Object.assign(clone(DEFAULT_STATE), payload.data);
            state.workouts = Object.assign(clone(DEFAULT_STATE.workouts), payload.data.workouts || {});
            state.categories = Object.assign(clone(DEFAULT_STATE.categories), payload.data.categories || {});
            saveLocal();
            hideBanner();
            return true;
        }
        return false;
    } catch (error) {
        console.error('синхронизация: чтение не удалось', error);
        return false;
    }
}

async function pushToServer() {
    if (!getToken()) return;
    try {
        const response = await fetch(`${API_BASE}/api/personal/state`, {
            method: 'PUT',
            headers: headers(true),
            body: JSON.stringify({ data: state }),
        });
        if (response.status === 401) { showBanner('Токен не подошёл — введите заново'); return; }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const status = document.getElementById('sync-status');
        if (status) status.textContent = 'Сохранено в ' + new Date().toLocaleTimeString('ru-RU');
    } catch (error) {
        console.error('синхронизация: запись не удалась', error);
        showBanner('Нет связи с сервером — изменения сохранены на устройстве');
    }
}

function showBanner(text) {
    document.getElementById('banner-text').textContent = text;
    document.getElementById('banner').hidden = false;
}

function hideBanner() { document.getElementById('banner').hidden = true; }

// ===== КРЕДИТЫ =====
function nextPaymentDate(dueDay) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let candidate = new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, daysInMonth(today.getFullYear(), today.getMonth())));
    if (candidate < today) {
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        candidate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dueDay, daysInMonth(nextMonth.getFullYear(), nextMonth.getMonth())));
    }
    return candidate;
}

function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

function creditProgress(credit) {
    const total = (Number(credit.paid) || 0) + (Number(credit.balance) || 0);
    if (total <= 0) return 0;
    return Math.min(100, Math.round(((Number(credit.paid) || 0) / total) * 100));
}

function renderCredits() {
    const credits = state.credits;
    const totalDebt = credits.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
    const monthly = credits.reduce((sum, c) => sum + (Number(c.payment) || 0), 0);

    document.getElementById('sum-debt').textContent = moneyShort(totalDebt);
    document.getElementById('sum-monthly').textContent = moneyShort(monthly);

    let nearest = null;
    credits.forEach((credit) => {
        if (!credit.dueDay) return;
        const date = nextPaymentDate(Number(credit.dueDay));
        if (!nearest || date < nearest.date) nearest = { date, credit };
    });

    if (nearest) {
        document.getElementById('sum-next').textContent = moneyShort(nearest.credit.payment);
        document.getElementById('sum-next-date').textContent =
            nearest.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' · ' + nearest.credit.name;
    } else {
        document.getElementById('sum-next').textContent = '—';
        document.getElementById('sum-next-date').textContent = '';
    }

    const list = document.getElementById('credit-list');
    if (!credits.length) {
        list.innerHTML = '<div class="empty">Пока нет кредитов. Нажмите «+ Добавить».</div>';
    } else {
        list.innerHTML = credits.map((credit) => {
            const progress = creditProgress(credit);
            const next = credit.dueDay ? nextPaymentDate(Number(credit.dueDay)) : null;
            return `
            <div class="credit-card">
                <div class="credit-top">
                    <div class="credit-name">${escapeHtml(credit.name)}</div>
                    <div class="credit-balance">${moneyShort(credit.balance)}</div>
                </div>
                <div class="credit-meta">
                    <span>платёж <b>${moneyShort(credit.payment)}</b></span>
                    ${next ? `<span>далее <b>${next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</b></span>` : ''}
                    <span>выплачено <b>${progress}%</b></span>
                </div>
                <div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div>
                <div class="credit-actions">
                    <button class="pay-btn" data-pay="${credit.id}">Оплатил</button>
                    <button data-edit="${credit.id}">Изменить</button>
                </div>
            </div>`;
        }).join('');
    }

    renderPaymentCalendar();
}

function renderPaymentCalendar() {
    const container = document.getElementById('payment-calendar');
    const now = new Date();
    let html = '';
    for (let offset = 0; offset < 3; offset++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        html += renderMonthGrid(monthDate, (day) => {
            const payments = state.credits.filter((credit) => Number(credit.dueDay) === day);
            if (!payments.length) return { cls: '', dot: '' };
            const sum = payments.reduce((acc, c) => acc + (Number(c.payment) || 0), 0);
            return { cls: 'has-payment', dot: moneyShort(sum) };
        });
    }
    container.innerHTML = html;
}

function renderMonthGrid(monthDate, decorate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const total = daysInMonth(year, month);
    const today = todayISO();

    let html = `<div class="cal-head" style="grid-column:1/8;text-align:left;padding-left:4px">
        ${MONTHS[month]} ${year}</div>`;
    WEEKDAYS.forEach((name) => { html += `<div class="cal-head">${name}</div>`; });
    for (let i = 0; i < startOffset; i++) html += '<div></div>';

    for (let day = 1; day <= total; day++) {
        const date = new Date(year, month, day);
        const key = isoDate(date);
        const info = decorate(day, key) || { cls: '', dot: '' };
        html += `<div class="cal-day ${info.cls} ${key === today ? 'today' : ''}">
            ${day}${info.dot ? `<span class="cal-dot">${info.dot}</span>` : ''}
        </div>`;
    }
    return html;
}

function payCredit(id) {
    const credit = state.credits.find((c) => c.id === id);
    if (!credit) return;
    const amount = Number(credit.payment) || 0;
    if (amount <= 0) { toast('У кредита не указан платёж', true); return; }
    credit.balance = Math.max(0, (Number(credit.balance) || 0) - amount);
    credit.paid = (Number(credit.paid) || 0) + amount;
    state.payments.push({ id: uid(), creditId: id, date: todayISO(), amount });
    state.tx.push({
        id: uid(), date: todayISO(), type: 'out', amount,
        category: 'Кредиты', note: credit.name,
    });
    scheduleSave();
    renderCredits();
    renderMoney();
    toast(`Оплачено ${moneyShort(amount)} — ${credit.name}`);
}

// ===== ТРЕНИРОВКИ =====
function weekdayIndex(date) { return (date.getDay() + 6) % 7; }

function isWorkoutDay(date) {
    return state.workouts.days.includes(weekdayIndex(date));
}

function renderWorkouts() {
    const today = new Date();
    const key = todayISO();
    const card = document.getElementById('workout-today');
    const scheduled = isWorkoutDay(today);
    const done = !!state.workouts.done[key];
    const duration = Number(state.workouts.duration) || 60;

    if (scheduled) {
        card.className = 'workout-today' + (done ? ' done' : '');
        card.innerHTML = `
            <h2>${done ? 'Тренировка выполнена ✓' : 'Сегодня тренировка'}</h2>
            <p>${duration} минут · ${WEEKDAYS[weekdayIndex(today)]}</p>
            <button class="btn-primary" id="btn-workout">${done ? 'Отменить отметку' : 'Отметить выполненной'}</button>`;
        const button = document.getElementById('btn-workout');
        button.onclick = () => {
            if (state.workouts.done[key]) delete state.workouts.done[key];
            else state.workouts.done[key] = true;
            scheduleSave();
            renderWorkouts();
        };
    } else {
        const next = nextWorkoutDay(today);
        card.className = 'workout-today';
        card.innerHTML = `
            <h2>Сегодня отдых</h2>
            <p>Следующая тренировка — ${next.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>`;
    }

    // серия подряд идущих тренировок
    let streak = 0;
    const cursor = new Date(today);
    for (let i = 0; i < 120; i++) {
        if (isWorkoutDay(cursor)) {
            if (state.workouts.done[isoDate(cursor)]) streak++;
            else if (isoDate(cursor) !== key) break;
        }
        cursor.setDate(cursor.getDate() - 1);
    }
    document.getElementById('wo-streak').textContent = streak + ' ' + plural(streak, 'тренировка', 'тренировки', 'тренировок');

    const monthPrefix = monthKey(today);
    const monthCount = Object.keys(state.workouts.done).filter((k) => k.startsWith(monthPrefix)).length;
    document.getElementById('wo-month').textContent = monthCount + ' из ' + countWorkoutDaysInMonth(today);

    // календарь
    document.getElementById('workout-calendar').innerHTML = renderMonthGrid(today, (day, key2) => {
        const date = new Date(today.getFullYear(), today.getMonth(), day);
        if (!isWorkoutDay(date)) return { cls: '', dot: '' };
        return state.workouts.done[key2]
            ? { cls: 'done', dot: '✓' }
            : { cls: 'has-workout', dot: '•' };
    });

    // выбор дней
    const picker = document.getElementById('days-picker');
    picker.innerHTML = WEEKDAYS.map((name, index) => {
        const on = state.workouts.days.includes(index);
        return `<button class="day-chip ${on ? 'on' : ''}" data-day="${index}">${name}</button>`;
    }).join('');
    picker.querySelectorAll('.day-chip').forEach((button) => {
        button.onclick = () => {
            const index = Number(button.dataset.day);
            const days = state.workouts.days;
            if (days.includes(index)) state.workouts.days = days.filter((d) => d !== index);
            else state.workouts.days = [...days, index].sort();
            scheduleSave();
            renderWorkouts();
        };
    });
}

function nextWorkoutDay(from) {
    const date = new Date(from);
    for (let i = 1; i <= 14; i++) {
        date.setDate(date.getDate() + 1);
        if (isWorkoutDay(date)) return date;
    }
    return date;
}

function countWorkoutDaysInMonth(date) {
    const total = daysInMonth(date.getFullYear(), date.getMonth());
    let count = 0;
    for (let day = 1; day <= total; day++) {
        if (isWorkoutDay(new Date(date.getFullYear(), date.getMonth(), day))) count++;
    }
    return count;
}

// ===== ДЕНЬГИ =====
function renderMoney() {
    const month = selectedMonth;
    const items = state.tx.filter((t) => t.date.startsWith(month));
    const income = items.filter((t) => t.type === 'in').reduce((s, t) => s + Number(t.amount || 0), 0);
    const expense = items.filter((t) => t.type === 'out').reduce((s, t) => s + Number(t.amount || 0), 0);
    const loans = state.credits.reduce((s, c) => s + (Number(c.payment) || 0), 0);

    document.getElementById('money-in').textContent = moneyShort(income);
    document.getElementById('money-out').textContent = moneyShort(expense);
    document.getElementById('money-left').textContent = moneyShort(income - expense);
    document.getElementById('money-after-loans').textContent =
        `после платежей по кредитам: ${moneyShort(income - expense - loans)}`;

    const monthSelect = document.getElementById('month-picker');
    if (monthSelect.options.length === 0) {
        const options = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = monthKey(date);
            options.push(`<option value="${key}" ${key === month ? 'selected' : ''}>${MONTHS[date.getMonth()]} ${date.getFullYear()}</option>`);
        }
        monthSelect.innerHTML = options.join('');
        monthSelect.onchange = () => { selectedMonth = monthSelect.value; renderMoney(); };
    }

    const list = document.getElementById('tx-list');
    if (!items.length) {
        list.innerHTML = '<div class="empty">Нет операций за этот месяц.</div>';
    } else {
        list.innerHTML = items.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => `
            <div class="tx-item">
                <div class="tx-icon">${t.type === 'in' ? '⬆️' : '⬇️'}</div>
                <div class="tx-body">
                    <div class="tx-title">${escapeHtml(t.category || 'Без категории')}</div>
                    <div class="tx-sub">${new Date(t.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
                </div>
                <div class="tx-amount ${t.type}">${t.type === 'in' ? '+' : '−'}${moneyShort(t.amount)}</div>
                <button class="tx-del" data-del="${t.id}">✕</button>
            </div>`).join('');
        list.querySelectorAll('[data-del]').forEach((button) => {
            button.onclick = () => {
                state.tx = state.tx.filter((t) => t.id !== button.dataset.del);
                scheduleSave();
                renderMoney();
            };
        });
    }

    const byCategory = {};
    items.filter((t) => t.type === 'out').forEach((t) => {
        const key = t.category || 'Прочее';
        byCategory[key] = (byCategory[key] || 0) + Number(t.amount || 0);
    });
    const max = Math.max(1, ...Object.values(byCategory));
    const bars = document.getElementById('category-bars');
    const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    bars.innerHTML = entries.length
        ? entries.map(([name, value]) => `
            <div class="bar-row">
                <div class="bar-top"><span>${escapeHtml(name)}</span><span>${moneyShort(value)}</span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.round((value / max) * 100)}%"></div></div>
            </div>`).join('')
        : '<div class="empty">Нет расходов за этот месяц.</div>';
}

function renderCategories() {
    const select = document.getElementById('tx-category');
    const list = state.categories[activeTxType] || [];
    select.innerHTML = list.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
}

// ===== МОДАЛКИ =====
function openCreditModal(id) {
    editingCreditId = id || null;
    const credit = id ? state.credits.find((c) => c.id === id) : null;
    document.getElementById('credit-modal-title').textContent = credit ? 'Изменить кредит' : 'Новый кредит';
    document.getElementById('c-name').value = credit ? credit.name : '';
    document.getElementById('c-balance').value = credit ? credit.balance : '';
    document.getElementById('c-payment').value = credit ? credit.payment : '';
    document.getElementById('c-dueday').value = credit ? credit.dueDay : '';
    document.getElementById('c-paid').value = credit ? (credit.paid || 0) : 0;
    document.getElementById('c-delete').hidden = !credit;
    document.getElementById('credit-modal').hidden = false;
}

function saveCredit() {
    const name = document.getElementById('c-name').value.trim() || 'Кредит';
    const balance = Number(document.getElementById('c-balance').value) || 0;
    const payment = Number(document.getElementById('c-payment').value) || 0;
    const dueDay = Math.min(31, Math.max(1, Number(document.getElementById('c-dueday').value) || 1));
    const paid = Number(document.getElementById('c-paid').value) || 0;

    if (editingCreditId) {
        const credit = state.credits.find((c) => c.id === editingCreditId);
        Object.assign(credit, { name, balance, payment, dueDay, paid });
    } else {
        state.credits.push({ id: uid(), name, balance, payment, dueDay, paid });
    }
    document.getElementById('credit-modal').hidden = true;
    scheduleSave();
    renderCredits();
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== НАВИГАЦИЯ =====
function switchView(name) {
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
}


function demoState() {
    const today = new Date();
    const done = {};
    for (let i = 0; i < 9; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i * 2);
        if ([0, 2, 4].includes((d.getDay() + 6) % 7)) done[isoDate(d)] = true;
    }
    const month = monthKey(today);
    return {
        credits: [
            { id: 'yandex', name: 'Яндекс Банк', balance: 55768.14, payment: 5173, dueDay: 15, paid: 0 },
            { id: 'tbank', name: 'Т-Банк', balance: 20382.43, payment: 1300, dueDay: 4, paid: 0 },
            { id: 'ozon', name: 'Озон Банк', balance: 12792.91, payment: 1925.4, dueDay: 11, paid: 0 },
            { id: 'sber-refin', name: 'Сбербанк — рефинансирование', balance: 312404.9, payment: 11231, dueDay: 20, paid: 0 },
            { id: 'sber-card', name: 'Сбербанк — кредитка', balance: 232723.8, payment: 5772.35, dueDay: 30, paid: 0 },
        ],
        payments: [],
        workouts: { days: [0, 2, 4], duration: 60, done },
        tx: [
            { id: 'd1', date: month + '-05', type: 'in', amount: 120000, category: 'Зарплата', note: '' },
            { id: 'd2', date: month + '-06', type: 'out', amount: 18400, category: 'Продукты', note: 'Пятёрочка' },
            { id: 'd3', date: month + '-08', type: 'out', amount: 5173, category: 'Кредиты', note: 'Яндекс Банк' },
            { id: 'd4', date: month + '-10', type: 'out', amount: 6200, category: 'Транспорт', note: 'Бензин' },
            { id: 'd5', date: month + '-12', type: 'out', amount: 9900, category: 'Дети', note: 'Смесь и памперсы' },
        ],
        categories: clone(DEFAULT_STATE.categories),
    };
}

// ===== СТАРТ =====
async function init() {
    demoMode = new URLSearchParams(location.search).has('demo');
    if (demoMode) state = demoState(); else loadLocal();
    renderCredits();
    renderWorkouts();
    renderCategories();
    renderMoney();

    const today = new Date();
    document.getElementById('tx-date').value = todayISO();

    if (getToken()) {
        const pulled = await pullFromServer();
        if (pulled) {
            renderCredits();
            renderWorkouts();
            renderMoney();
        }
    } else if (!state.credits.length) {
        showBanner('Данные хранятся на устройстве. Введите токен, чтобы синхронизировать');
    }

    // вкладки
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.onclick = () => switchView(tab.dataset.view);
    });

    const initialTab = new URLSearchParams(location.search).get('tab');
    if (initialTab && document.getElementById('view-' + initialTab)) switchView(initialTab);

    // кнопки
    document.getElementById('btn-add-credit').onclick = () => openCreditModal(null);
    document.getElementById('c-cancel').onclick = () => { document.getElementById('credit-modal').hidden = true; };
    document.getElementById('c-save').onclick = saveCredit;
    document.getElementById('c-delete').onclick = () => {
        if (!editingCreditId) return;
        state.credits = state.credits.filter((c) => c.id !== editingCreditId);
        document.getElementById('credit-modal').hidden = true;
        scheduleSave();
        renderCredits();
    };

    document.querySelectorAll('.tx-tab').forEach((tab) => {
        tab.onclick = () => {
            activeTxType = tab.dataset.type;
            document.querySelectorAll('.tx-tab').forEach((t) => t.classList.toggle('active', t.dataset.type === activeTxType));
            renderCategories();
        };
    });

    document.getElementById('tx-form').onsubmit = (event) => {
        event.preventDefault();
        const amount = Number(document.getElementById('tx-amount').value);
        if (!amount || amount <= 0) return;
        state.tx.push({
            id: uid(),
            date: document.getElementById('tx-date').value || todayISO(),
            type: activeTxType,
            amount,
            category: document.getElementById('tx-category').value,
            note: document.getElementById('tx-note').value.trim(),
        });
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-note').value = '';
        scheduleSave();
        renderMoney();
        toast('Записано');
    };

    document.getElementById('btn-sync').onclick = async () => {
        const pulled = await pullFromServer();
        renderCredits(); renderWorkouts(); renderMoney();
        toast(pulled ? 'Данные обновлены с сервера' : 'Синхронизация недоступна', !pulled);
    };

    // настройки
    const settings = document.getElementById('settings-modal');
    document.getElementById('btn-settings').onclick = () => {
        document.getElementById('set-token').value = getToken();
        settings.hidden = false;
    };
    document.getElementById('set-cancel').onclick = () => { settings.hidden = true; };
    document.getElementById('set-save').onclick = async () => {
        setToken(document.getElementById('set-token').value.trim());
        settings.hidden = true;
        const pulled = await pullFromServer();
        if (!pulled) await pushToServer();
        renderCredits(); renderWorkouts(); renderMoney();
        toast('Токен сохранён');
    };
    document.getElementById('set-export').onclick = () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `myfinance-${todayISO()}.json`;
        link.click();
    };
    document.getElementById('set-import').onclick = () => document.getElementById('import-file').click();
    document.getElementById('import-file').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            state = Object.assign(clone(DEFAULT_STATE), JSON.parse(await file.text()));
            saveLocal();
            scheduleSave();
            renderCredits(); renderWorkouts(); renderMoney(); renderCategories();
            settings.hidden = true;
            toast('Данные импортированы');
        } catch (error) {
            toast('Не удалось прочитать файл', true);
        }
    };

    document.getElementById('banner-action').onclick = () => {
        document.getElementById('set-token').value = getToken();
        settings.hidden = false;
    };

    // делегирование кликов по кредитам
    document.getElementById('credit-list').onclick = (event) => {
        const payId = event.target.dataset && event.target.dataset.pay;
        const editId = event.target.dataset && event.target.dataset.edit;
        if (payId) payCredit(payId);
        if (editId) openCreditModal(editId);
    };
}

document.addEventListener('DOMContentLoaded', init);
