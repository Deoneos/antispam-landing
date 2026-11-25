        // ТЕМА: авто (по времени суток) или ручной выбор
        const THEME_KEY = 'lad_theme';
        const TZ_KEY = 'lad_tz';

        // Фильтр ленты записей по типу
        const LOG_FILTER_KEY = 'lad_log_filter';
        let logFilter = 'all';
        try {
            logFilter = localStorage.getItem(LOG_FILTER_KEY) || 'all';
        } catch (e) {}

        function themePref() {
            try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; }
        }
        function applyTheme() {
            const pref = themePref();
            const hour = new Date().getHours();
            const auto = (hour >= 9 && hour < 19) ? 'light' : 'dark';
            const theme = pref === 'auto' ? auto : pref;
            document.documentElement.setAttribute('data-theme', theme);
            document.querySelectorAll('#theme-seg button').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-theme-pref') === pref);
            });
        }
        function setThemePref(pref) {
            try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
            applyTheme();
        document.addEventListener('DOMContentLoaded', initSettingsUi);
        }
        function tzPref() {
            try { return localStorage.getItem(TZ_KEY) || 'auto'; } catch (e) { return 'auto'; }
        }
        function tz() {
            const pref = tzPref();
            if (pref && pref !== 'auto') return pref;
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; }
            catch (e) { return 'Europe/Moscow'; }
        }
        applyTheme();
        setInterval(applyTheme, 60 * 60 * 1000);

        // На baby.kustos.ru API проксируется тем же доменом, на GitHub Pages — на RU.
        const API_URL = (location.hostname === 'baby.kustos.ru') ? '/api/baby' : 'https://baby.kustos.ru/api/baby';

        // Минималистичный интерфейс включён по умолчанию.
        // ?min=0 — вернуть старый вид, ?min=1 — снова включить.
        (function initMinUi() {
            try {
                const params = new URLSearchParams(location.search);
                const flag = params.get('min');
                if (flag === '1') localStorage.setItem('lad_min_ui', '1');
                if (flag === '0') localStorage.setItem('lad_min_ui', '0');
                if (localStorage.getItem('lad_min_ui') !== '0') {
                    document.documentElement.classList.add('min-ui');
                }
                moveChildrenToSettings();
                moveTodayCard();
            } catch (e) {}
        })();

        // Токен доступа: один раз приходит в ссылке ?token=..., дальше живёт в localStorage
        (function bootToken() {
            try {
                const params = new URLSearchParams(window.location.search);
                const fromUrl = params.get('token');
                if (fromUrl) {
                    localStorage.setItem('baby_api_token', fromUrl);
                    params.delete('token');
                    const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
                    window.history.replaceState({}, '', clean);
                }
            } catch (e) { /* приватный режим — работаем без токена */ }
        })();
        let activeSleepId = null;
        let activeSleepStart = null;
        let activeAwakeId = null;
        let activeAwakeStart = null;
        let activeFeedStart = null;
        let editingFeedId = null;
        const timerIntervals = {};
        let chartFeeds = null;
        let chartSleep = null;

        function switchView(viewName, btn) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.getElementById(`view-${viewName}`).classList.add('active');
            if (btn) btn.classList.add('active');
            if (viewName === 'growth') { loadGrowth(); return; }
            if (viewName === 'stats') { loadStats(); if (typeof loadInsights === 'function') loadInsights(); }
            if (viewName === 'calendar') loadAppointments();
            if (viewName === 'analytics') {
                if (!familyPremium) {
                    document.getElementById('analytics-lock').style.display = 'block';
                    return;
                }
                document.getElementById('analytics-lock').style.display = 'none';
                loadAnalytics();
            }
        }




        // ===== ТАЙМЕР СНА =====
        let sleepTimerId = null;
        let sleepFadeId = null;

        function resetTimerChips() {
            document.querySelectorAll('.timer-chip').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-min') === '0');
            });
        }

        function setSleepTimer(minutes) {
            if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
            if (sleepFadeId) { clearInterval(sleepFadeId); sleepFadeId = null; }
            document.querySelectorAll('.timer-chip').forEach(function (b) {
                b.classList.toggle('active', Number(b.getAttribute('data-min')) === Number(minutes));
            });
            if (!minutes) return;
            sleepTimerId = setTimeout(fadeOutAndStop, minutes * 60 * 1000);
            toast('Звук выключится через ' + minutes + ' мин');
        }

        function fadeOutAndStop() {
            const startVolume = currentVolume;
            let v = startVolume;
            sleepFadeId = setInterval(function () {
                v = Math.max(0, v - startVolume / 20);
                if (noiseEl) noiseEl.volume = v;
                if (v <= 0.001) {
                    clearInterval(sleepFadeId);
                    sleepFadeId = null;
                    sleepTimerId = null;
                    stopCurrentAudio();
                    if (noiseEl) noiseEl.volume = currentVolume;
                    resetTimerChips();
                }
            }, 500);
        }

        // ===== НАСТРОЙКИ УВЕДОМЛЕНИЙ =====
        const NOTIFY_LABELS = {
            push: 'Push-уведомления',
            whatsnew: 'Что нового',
            reminders: 'Кормление и подгузник',
            appointments: 'Приёмы у врача',
            vaccines: 'Прививки',
            weekly: 'Итоги недели',
            sleepy: 'Пора спать',
            daily: 'Итоги дня'
        };


        let ladReferral = null;

        function refDateLabel(iso) {
            try {
                const d = new Date(iso);
                if (isNaN(d.getTime())) return '';
                return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
            } catch (e) { return ''; }
        }

        function renderRefFriends(box, items, limit) {
            if (!box) return;
            box.innerHTML = '';
            const list = (items || []).slice(0, limit);
            list.forEach(function (it) {
                const row = document.createElement('div');
                row.className = 'ref-friend';
                const name = document.createElement('span');
                name.className = 'rf-name';
                name.textContent = it.name || 'Друг';
                const date = document.createElement('span');
                date.className = 'rf-date';
                date.textContent = refDateLabel(it.date);
                const bonus = document.createElement('span');
                bonus.className = 'rf-bonus';
                bonus.textContent = '+' + (it.days || 7) + ' дн.';
                row.appendChild(name);
                row.appendChild(date);
                row.appendChild(bonus);
                box.appendChild(row);
            });
            if ((items || []).length > limit) {
                const more = document.createElement('div');
                more.className = 'ref-more';
                more.textContent = 'и ещё ' + (items.length - limit);
                box.appendChild(more);
            }
        }

        function renderRefModal(d) {
            const linkEl = document.getElementById('ref-link');
            const invitedEl = document.getElementById('ref-modal-invited');
            const daysEl = document.getElementById('ref-modal-days');
            const listEl = document.getElementById('ref-modal-friends');
            const noteEl = document.getElementById('ref-modal-note');
            if (linkEl) linkEl.textContent = d.link || '';
            if (invitedEl) invitedEl.textContent = d.invited || 0;
            if (daysEl) daysEl.textContent = d.days_earned || 0;
            renderRefFriends(listEl, d.items || [], 20);
            if (listEl) listEl.style.display = (d.items && d.items.length) ? 'block' : 'none';
            if (noteEl) {
                noteEl.textContent = d.invited
                    ? 'Вы получили ' + d.days_earned + ' дн. Премиума. Друг тоже получает ' + (d.friend_bonus_days || d.bonus_days) + ' дн.'
                    : 'Пока никого не пригласили. За каждого друга — ' + d.bonus_days + ' дней Премиума.';
            }
        }

        function renderReferralStats(d) {
            ladReferral = d;
            const invitedEl = document.getElementById('ref-invited');
            const daysEl = document.getElementById('ref-days');
            const monthEl = document.getElementById('ref-month');
            const noteEl = document.getElementById('ref-note');
            const friendsEl = document.getElementById('ref-friends');
            if (invitedEl) invitedEl.textContent = d.invited || 0;
            if (daysEl) daysEl.textContent = d.days_earned || 0;
            if (monthEl) monthEl.textContent = d.this_month || 0;
            if (noteEl) {
                noteEl.textContent = d.invited
                    ? 'Дни Премиума суммируются с текущей подпиской'
                    : 'Пока никого не пригласили. За каждого друга — ' + d.bonus_days + ' дней Премиума.';
            }
            if (friendsEl) {
                renderRefFriends(friendsEl, d.items || [], 3);
                friendsEl.style.display = (d.items && d.items.length) ? 'block' : 'none';
            }
        }

        async function loadReferralStats() {
            if (!ladToken() && !apiToken()) return null;
            try {
                const res = await fetch(`${API_URL}/referral`, { headers: apiHeaders() });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const d = await res.json();
                renderReferralStats(d);
                return d;
            } catch (e) {
                if (!ladReferral) {
                    const noteEl = document.getElementById('ref-note');
                    if (noteEl) noteEl.textContent = 'Статистика временно недоступна';
                }
                return ladReferral;
            }
        }

        async function openRefModal() {
            const modal = document.getElementById('ref-modal');
            if (!modal) return;
            modal.style.display = 'flex';
            const statusEl = document.getElementById('ref-status');
            if (statusEl) statusEl.textContent = '';
            const d = await loadReferralStats();
            if (d) {
                renderRefModal(d);
            } else {
                const linkEl = document.getElementById('ref-link');
                if (linkEl) linkEl.textContent = 'Не удалось загрузить ссылку';
            }
        }

        function closeRefModal(e) {
            if (!e || e.target.id === 'ref-modal') {
                const m = document.getElementById('ref-modal');
                if (m) m.style.display = 'none';
            }
        }

        async function copyRefLink() {
            const text = (document.getElementById('ref-link') || {}).textContent || '';
            const statusEl = document.getElementById('ref-status');
            try {
                await navigator.clipboard.writeText(text);
                if (statusEl) statusEl.textContent = 'Ссылка скопирована';
            } catch (e) {
                if (statusEl) statusEl.textContent = 'Скопируйте вручную: ' + text;
            }
        }

        async function shareRefLink() {
            const text = (document.getElementById('ref-link') || {}).textContent || '';
            const statusEl = document.getElementById('ref-status');
            if (navigator.share) {
                try {
                    await navigator.share({ title: 'Лад', text: 'Дневник малыша «Лад»', url: text });
                } catch (e) {}
                return;
            }
            copyRefLink();
        }

        async function testPush() {
            const status = document.getElementById('notify-status');
            if (status) { status.style.color = ''; status.textContent = 'Отправляю…'; }
            try {
                const res = await fetch(`${API_URL}/push/test`, { method: 'POST', headers: apiHeaders() });
                const d = await res.json();
                if (status) {
                    status.textContent = 'Доставлено: ' + (d.sent || 0) + ' из ' + (d.subs || 0);
                }
            } catch (e) {
                if (status) { status.style.color = '#F87171'; status.textContent = 'Не удалось отправить'; }
            }
        }

        async function loadNotifyPrefs() {
            try {
                const res = await fetch(`${API_URL}/notify/prefs`, { headers: apiHeaders() });
                if (!res.ok) return;
                const prefs = await res.json();
                Object.keys(NOTIFY_LABELS).forEach(function (key) {
                    const el = document.getElementById('np-' + key);
                    if (el) el.checked = prefs[key] !== false;
                });
            } catch (e) {}
        }

        async function setNotifyPref(key, enabled) {
            const status = document.getElementById('notify-status');
            try {
                const res = await fetch(`${API_URL}/notify/prefs`, {
                    method: 'PUT',
                    headers: apiHeaders(true),
                    body: JSON.stringify({ key: key, enabled: !!enabled })
                });
                if (!res.ok) throw new Error();
                if (status) {
                    status.textContent = (NOTIFY_LABELS[key] || key) + ': ' + (enabled ? 'включено' : 'выключено');
                    status.style.color = '';
                }
                setTimeout(function () { if (status) status.textContent = ''; }, 2500);
            } catch (e) {
                const el = document.getElementById('np-' + key);
                if (el) el.checked = !enabled;
                toast('Не удалось сохранить', true);
            }
        }


        // ===== ПОДСКАЗКА ПО ВОЗРАСТУ =====
        const AGE_NORMS = [
            { max: 1,  sleep: '14–17 ч', feeds: '8–12', ml: '60–90 мл' },
            { max: 2,  sleep: '14–17 ч', feeds: '7–9',  ml: '90–120 мл' },
            { max: 3,  sleep: '14–16 ч', feeds: '6–8',  ml: '120–150 мл' },
            { max: 4,  sleep: '14–16 ч', feeds: '5–7',  ml: '150–180 мл' },
            { max: 6,  sleep: '12–16 ч', feeds: '4–6',  ml: '180–210 мл' },
            { max: 9,  sleep: '12–15 ч', feeds: '4–5',  ml: '180–220 мл' },
            { max: 12, sleep: '12–15 ч', feeds: '3–4',  ml: '200–240 мл' },
            { max: 24, sleep: '11–14 ч', feeds: '3',    ml: '220–250 мл' }
        ];

        function renderAgeHint() {
            const el = document.getElementById('age-hint');
            if (!el) return;
            const child = (typeof childInfo === 'function') ? childInfo() : null;
            if (!child || !child.birth_date) { el.style.display = 'none'; return; }
            const birth = new Date(child.birth_date + 'T12:00:00');
            const now = new Date();
            if (isNaN(birth)) { el.style.display = 'none'; return; }
            const months = (now - birth) / (1000 * 60 * 60 * 24 * 30.4375);
            if (months < 0 || months > 36) { el.style.display = 'none'; return; }
            const norm = AGE_NORMS.find(function (n) { return months < n.max; }) || AGE_NORMS[AGE_NORMS.length - 1];
            const label = months < 1 ? 'первый месяц' : Math.floor(months) + ' мес.';
            el.innerHTML = '<b>' + label + '</b> · сон ' + norm.sleep +
                ' · ' + norm.feeds + ' кормлений · ' + norm.ml;
            el.style.display = '';
        }

        // ===== СКРОЛЛ НИЖНЕГО МЕНЮ =====
        function navArrowUpdate() {
            const nav = document.getElementById('bottom-nav');
            const left = document.getElementById('nav-left');
            const right = document.getElementById('nav-right');
            if (!nav || !left || !right) return;
            const max = nav.scrollWidth - nav.clientWidth;
            left.classList.toggle('show', nav.scrollLeft > 4);
            right.classList.toggle('show', max > 8 && nav.scrollLeft < max - 4);
        }

        function navScroll(dir) {
            const nav = document.getElementById('bottom-nav');
            if (!nav) return;
            const step = Math.round(nav.clientWidth * 0.8);
            nav.scrollBy({ left: dir * step, behavior: 'smooth' });
        }

        (function initNavScroll() {
            const nav = document.getElementById('bottom-nav');
            if (!nav) return;
            try {
                const saved = parseInt(localStorage.getItem('lad_nav_scroll') || '0', 10);
                if (saved > 0) nav.scrollLeft = saved;
            } catch (e) {}
            nav.addEventListener('scroll', function () {
                navArrowUpdate();
                try { localStorage.setItem('lad_nav_scroll', String(nav.scrollLeft)); } catch (e) {}
            }, { passive: true });
            function syncArrowHeight() {
                const h = nav.offsetHeight;
                if (!h) return;
                document.querySelectorAll('.nav-arrow').forEach(function (a) {
                    a.style.height = h + 'px';
                });
            }
            window.addEventListener('resize', function () { syncArrowHeight(); navArrowUpdate(); });
            setTimeout(function () { syncArrowHeight(); navArrowUpdate(); }, 150);
            setTimeout(syncArrowHeight, 600);
        })();

        // --- УВЕДОМЛЕНИЯ ---
        function toast(message, isError) {
            const host = document.getElementById('toast-host');
            if (!host) { return; }
            const el = document.createElement('div');
            el.className = 'toast' + (isError ? ' error' : '');
            el.textContent = message;
            host.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
            setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
        }

        // Канонический адрес приложения — baby.kustos.ru.
        // Старое зеркало на kustos.ru отправляем туда же, чтобы вход не терялся.
        if (location.hostname === 'kustos.ru' || location.hostname === 'www.kustos.ru') {
            location.replace('https://baby.kustos.ru' + location.pathname + location.search + location.hash);
        }

        // Резервный адрес API через Cloudflare: работает, когда прямой IP
        // недоступен из-за VPN или блокировки оператора.
        const API_FALLBACK = 'https://api.kustos.ru/api/baby';
        (function () {
            const nativeFetch = window.fetch.bind(window);

            // Без таймаута зависший через VPN запрос держит экран до минуты.
            function fetchWithTimeout(input, init, ms) {
                if (typeof AbortController === 'undefined') return nativeFetch(input, init);
                const ctrl = new AbortController();
                const timer = setTimeout(function () {
                    try { ctrl.abort(); } catch (e) {}
                }, ms);
                const opts = Object.assign({}, init || {});
                opts.signal = ctrl.signal;
                return nativeFetch(input, opts).then(
                    function (res) { clearTimeout(timer); return res; },
                    function (err) { clearTimeout(timer); throw err; }
                );
            }

            window.fetch = function (input, init) {
                const url = (typeof input === 'string') ? input : ((input && input.url) || '');
                if (url.indexOf(API_URL) === 0) {
                    const alt = url.replace(API_URL, API_FALLBACK);
                    const long = /\/ai\/|\/export|\/report|\/admin\//.test(url);
                    const ms = long ? 60000 : 12000;
                    return fetchWithTimeout(input, init, ms).catch(function (err) {
                        return fetchWithTimeout(alt, init, ms);
                    });
                }
                return nativeFetch(input, init);
            };
        })();


        // ?profile=1 — сразу открыть профиль (удобно для ссылок и скриншотов)
        if (/[?&]profile=1/.test(location.search)) {
            setTimeout(function () {
                if (typeof openProfile === 'function') openProfile();
            }, 400);
        }

        function apiToken() {
            try { return localStorage.getItem('baby_api_token') || ''; } catch (e) { return ''; }
        }

        function apiHeaders(isJson) {
            const headers = isJson ? { 'Content-Type': 'application/json' } : {};
            const t = apiToken();
            if (t) headers['X-Api-Token'] = t;
            // Вошли через Telegram — ходим от имени семьи, а не ссылки с токеном.
            const lad = ladToken();
            if (lad) headers['Authorization'] = 'Bearer ' + lad;
            const cid = activeChildId();
            if (cid) headers['X-Child-Id'] = String(cid);
            return headers;
        }

        // Понятная диагностика вместо «пустого списка» при неверном токене
        let tokenModalShown = false;

        function showApiBanner(text) {
            const banner = document.getElementById('api-banner');
            const label = document.getElementById('api-banner-text');
            if (!banner || !label) return;
            label.textContent = text;
            banner.style.display = 'flex';
        }

        function hideApiBanner() {
            const banner = document.getElementById('api-banner');
            if (banner) banner.style.display = 'none';
        }

        function handleAuthError(res) {
            if (res.status === 401) {
                // Баннер висит постоянно, пока доступ не восстановится:
                // иначе приложение молча показывает пустые таймеры.
                showApiBanner('Нет доступа к данным — проверьте токен');
                if (!tokenModalShown) {
                    tokenModalShown = true;
                    toast('Нужен токен доступа', true);
                    setTimeout(openTokenModal, 200);
                }
                return true;
            }
            if (res.status === 429) {
                showApiBanner('Слишком много попыток доступа — подождите минуту');
                toast('Слишком много попыток, подождите минуту', true);
                return true;
            }
            return false;
        }

        function openTokenModal() {
            const modal = document.getElementById('token-modal');
            if (!modal) return;
            const input = document.getElementById('token-input');
            if (input) {
                input.value = apiToken();
                setTimeout(() => input.focus(), 150);
            }
            modal.style.display = 'flex';
        }

        function closeTokenModal(e) {
            if (!e || e.target.id === 'token-modal') {
                const modal = document.getElementById('token-modal');
                if (modal) modal.style.display = 'none';
            }
        }

        function saveTokenFromInput() {
            const input = document.getElementById('token-input');
            const value = (input && input.value ? input.value : '').trim();
            if (!value) {
                toast('Вставьте токен', true);
                return;
            }
            try {
                localStorage.setItem('baby_api_token', value);
            } catch (e) {
                toast('Не удалось сохранить токен', true);
                return;
            }
            tokenModalShown = false;
            closeTokenModal();
            toast('Токен сохранён');
            loadEvents();
            loadAppointments();
            if (document.getElementById('view-analytics') &&
                document.getElementById('view-analytics').classList.contains('active')) {
                loadAnalytics();
            }
        }

        // Экранирование пользовательских данных перед вставкой в HTML
        function esc(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Обёртка над fetch: единая обработка сетевых ошибок
        async function apiFetch(url, options) {
            let res;
            try {
                res = await fetch(url, options);
            } catch (e) {
                toast("Нет связи с сервером", true);
                throw e;
            }
            if (!res.ok) {
                toast(`Ошибка сервера (${res.status})`, true);
                throw new Error('HTTP ' + res.status);
            }
            return res;
        }

        // ===== ЛОКАЛЬНЫЙ КЭШ, ОЧЕРЕДЬ И ЭКСПОРТ =====
        const CACHE_KEY = 'baby_events_cache_v1';
        const QUEUE_KEY = 'baby_queue_v1';

        function readJSON(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return fallback;
                const v = JSON.parse(raw);
                return v == null ? fallback : v;
            } catch (e) { return fallback; }
        }
        function writeJSON(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); }
            catch (e) { console.warn('localStorage:', e); }
        }

        function mergeIntoCache(events) {
            if (!Array.isArray(events) || !events.length) return;
            const cache = readJSON(CACHE_KEY, {});
            let changed = false;
            for (const e of events) {
                if (!e || e.id == null) continue;
                if (JSON.stringify(cache[e.id]) !== JSON.stringify(e)) { cache[e.id] = e; changed = true; }
            }
            if (changed) writeJSON(CACHE_KEY, cache);
        }

        function cachedEvents() {
            return Object.values(readJSON(CACHE_KEY, {}))
                .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        }

        function newId() {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
            return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
        }

        function enqueue(item) {
            const q = readJSON(QUEUE_KEY, []);
            q.push(Object.assign({ ts: Date.now() }, item));
            writeJSON(QUEUE_KEY, q);
            renderStatus();
        }

        async function flushQueue() {
            const q = readJSON(QUEUE_KEY, []);
            if (!q.length) { renderStatus(); return; }
            const left = [];
            for (const item of q) {
                try {
                    const res = await fetch(item.url, {
                        method: item.method || 'POST',
                        headers: apiHeaders(true),
                        body: item.body
                    });
                    if (!res.ok) left.push(item);
                } catch (e) { left.push(item); }
            }
            writeJSON(QUEUE_KEY, left);
            renderStatus();
            if (left.length !== q.length) {
                toast(`Отправлено из очереди: ${q.length - left.length}`);
                loadEvents();
            }
        }

        function renderStatus() {
            const el = document.getElementById('net-status');
            if (!el) return;
            const pending = readJSON(QUEUE_KEY, []).length;
            if (!pending) { el.style.display = 'none'; el.textContent = ''; return; }
            el.style.display = 'inline-block';
            el.textContent = `⏳ ждут отправки: ${pending}`;
        }

        window.addEventListener('online', () => { renderStatus(); flushQueue(); setTimeout(loadEvents, 800); });
        window.addEventListener('offline', renderStatus);


        const EVENT_NAMES = { feed: 'Кормление', sleep: 'Сон', awake: 'Бодрствование',
                              diaper: 'Подгузник', walk: 'Прогулка' };

        async function exportCsv() {
            if (!(await ensurePremium())) {
                toast('Экспорт в Excel — в Премиуме 🔒', true);
                openProfile();
                return;
            }
            const token = ladToken();
            if (!token) { toast('Нужно войти в профиль', true); return; }
            try {
                toast('Готовлю таблицу…');
                const res = await fetch(`${API_URL}/events/history?days=14`, { headers: apiHeaders() });
                const events = await res.json();
                if (!Array.isArray(events) || !events.length) {
                    toast('Нет данных за 90 дней', true);
                    return;
                }
                const rows = [['Дата', 'Время', 'Событие', 'Длительность, мин', 'Детали']];
                events.slice().sort(function (a, b) {
                    return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
                }).forEach(function (e) {
                    const start = new Date(e.start_time);
                    const end = e.end_time ? new Date(e.end_time) : null;
                    const dur = end ? Math.round((end - start) / 60000) : '';
                    rows.push([
                        start.toLocaleDateString('ru-RU'),
                        start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                        EVENT_NAMES[e.event_type] || e.event_type,
                        dur,
                        (e.details || '').replace(/\s+/g, ' ').trim()
                    ]);
                });
                const csv = '\ufeff' + rows.map(function (r) {
                    return r.map(function (v) {
                        return '"' + String(v).replace(/"/g, '""') + '"';
                    }).join(';');
                }).join('\r\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'lad-' + new Date().toISOString().slice(0, 10) + '.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                toast('Таблица скачана');
            } catch (e) {
                toast('Не удалось выгрузить', true);
            }
        }

        async function exportData() {
            let payload = null;
            try {
                const res = await fetch(`${API_URL}/export`, { headers: apiHeaders() });
                if (res.ok) {
                    payload = await res.json();
                    payload.app = 'baby-tracker';
                }
            } catch (e) { /* офлайн — выгрузим кэш */ }
            if (!payload) {
                payload = {
                    app: 'baby-tracker',
                    exported_at: new Date().toISOString(),
                    events: cachedEvents(),
                    appointments: window.__lastAppointments || [],
                    pending: readJSON(QUEUE_KEY, [])
                };
            }
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'lad-export-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
            toast('Файл выгружен');
        }

        function openFeedModal(when) {
            const inp = document.getElementById('feed-time');
            const base = (when instanceof Date && !isNaN(when.getTime())) ? when : new Date();
            if (inp) inp.value = toLocalInputValue(base);
            document.getElementById('feed-modal').style.display = 'flex';
        }
        function closeFeedModal(e) { if (!e || e.target.id === 'feed-modal') document.getElementById('feed-modal').style.display = 'none'; }
        function feedShift(minutes) {
            const inp = document.getElementById('feed-time');
            if (!inp) return;
            const base = inp.value ? new Date(inp.value) : new Date();
            if (isNaN(base.getTime())) return;
            base.setMinutes(base.getMinutes() + minutes);
            inp.value = toLocalInputValue(base);
        }
        async function saveFeedVolume() {
            const ml = document.getElementById('ml-slider').value;
            const inp = document.getElementById('feed-time');
            let when = new Date();
            if (inp && inp.value) {
                const parsed = new Date(inp.value);
                if (!isNaN(parsed.getTime())) when = parsed;
            }
            if (when.getTime() > Date.now() + 60000) { toast('Время ещё не наступило', true); return; }
            closeFeedModal();
            if (navigator.vibrate) navigator.vibrate(50);
            const body = JSON.stringify({ event_type: 'feed', details: ml + ' мл', start_time: when.toISOString(), client_uuid: newId() });
            try {
                const res = await fetch(`${API_URL}/events/quick`, { method: 'POST', headers: apiHeaders(true), body: body });
                if (handleAuthError(res) || !res.ok) throw new Error('HTTP ' + res.status);
                toast(`Записано: ${ml} мл`);
            } catch (e) {
                enqueue({ url: `${API_URL}/events/quick`, method: 'POST', body: body, label: `feed: ${ml} мл` });
                toast("Нет связи — кормление в очереди", true);
            } finally {
                loadEvents();
            }
        }

        function editFeedTime(id, startIso) {
            editingFeedId = id;
            activeFeedStart = startIso;
            openTimerModal('feed', 'edit');
        }

        // --- ГОЛОСОВОЙ ВВОД ---
        let voiceRec = null;
        let voiceTimer = null;
        let voiceAction = null;
        let voiceListening = false;
        let voiceFailed = false;

        function voiceRecognitionCtor() {
            return window.SpeechRecognition || window.webkitSpeechRecognition || null;
        }

        function voiceNorm(text) {
            return String(text || '').toLowerCase().replace(/ё/g, 'е')
                .replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function voiceNumberWords(text) {
            const hundreds = {
                'сто': 100, 'двести': 200, 'триста': 300, 'четыреста': 400,
                'пятьсот': 500, 'шестьсот': 600, 'семьсот': 700,
                'восемьсот': 800, 'девятьсот': 900
            };
            const tens = {
                'двадцать': 20, 'тридцать': 30, 'сорок': 40,
                'пятьдесят': 50, 'шестьдесят': 60, 'семьдесят': 70,
                'восемьдесят': 80, 'девяносто': 90
            };
            const teens = {
                'десять': 10, 'одиннадцать': 11, 'двенадцать': 12,
                'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15,
                'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18,
                'девятнадцать': 19
            };
            const units = {
                'ноль': 0, 'один': 1, 'одна': 1, 'два': 2, 'две': 2,
                'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6,
                'семь': 7, 'восемь': 8, 'девять': 9
            };
            let total = 0;
            let found = false;
            voiceNorm(text).split(' ').forEach(function (word) {
                if (hundreds[word] !== undefined) { total += hundreds[word]; found = true; }
                else if (teens[word] !== undefined) { total += teens[word]; found = true; }
                else if (tens[word] !== undefined) { total += tens[word]; found = true; }
                else if (units[word] !== undefined) { total += units[word]; found = true; }
            });
            return found ? total : null;
        }

        function voiceNumNorm(text) {
            return String(text || '').toLowerCase().replace(/ё/g, 'е')
                .replace(/,/g, '.').replace(/[!?;:]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }

        function voiceWeightLabel(grams) {
            const kg = grams / 1000;
            return (kg % 1 ? kg.toFixed(1) : String(kg)).replace('.', ',') + ' кг';
        }

        function parseVoiceWeight(text) {
            const t = voiceNumNorm(text);
            let m = t.match(/(\d{1,2}(?:\.\d{1,3})?)\s*(?:кг|килограмм)\s*(\d{1,3})?\s*(?:г|грамм)?/);
            if (m) {
                let grams = Math.round(parseFloat(m[1]) * 1000);
                if (m[2]) grams += parseInt(m[2], 10);
                if (grams >= 500 && grams <= 30000) return grams;
            }
            m = t.match(/(\d{3,5})\s*(?:г|грамм)/);
            if (m) {
                const grams = parseInt(m[1], 10);
                if (grams >= 500 && grams <= 30000) return grams;
            }
            if (/вес|масса/.test(t)) {
                m = t.match(/(\d{1,2}[.,]\d{1,3})/);
                if (m) {
                    const grams = Math.round(parseFloat(m[1]) * 1000);
                    if (grams >= 500 && grams <= 30000) return grams;
                }
                m = t.match(/(\d{3,5})/);
                if (m) {
                    const grams = parseInt(m[1], 10);
                    if (grams >= 500 && grams <= 30000) return grams;
                }
            }
            return parseVoiceWeightWords(text);
        }

        function parseVoiceHeight(text) {
            const t = voiceNumNorm(text);
            let m = t.match(/(\d{2,3}(?:\.\d)?)\s*(?:см|сантиметр)/);
            if (!m && /рост/.test(t)) m = t.match(/(\d{2,3}(?:\.\d)?)/);
            if (m) {
                const cm = parseFloat(m[1]);
                if (cm >= 30 && cm <= 150) return cm;
            }
            return parseVoiceHeightWords(text);
        }

        function parseVoiceTemp(text) {
            const t = voiceNumNorm(text);
            let m = t.match(/(3[4-9]|4[0-2])\s*(?:и|\.)\s*(\d)/);
            if (m) return parseFloat(m[1] + '.' + m[2]);
            m = t.match(/(3[4-9](?:\.\d)?|4[0-2](?:\.\d)?)/);
            if (m) return parseFloat(m[1]);
            return parseVoiceTempWords(text);
        }

        function parseVoiceWeightWords(text) {
            const t = voiceNorm(text);
            const m = t.match(/([а-я\s]+?)\s*(?:килограмм|кг)\s*(.*)/);
            if (m) {
                const kg = voiceNumberWords(m[1]);
                const grams = m[2] ? (voiceNumberWords(m[2]) || 0) : 0;
                if (kg !== null) {
                    const total = Math.round(kg * 1000) + grams;
                    if (total >= 500 && total <= 30000) return total;
                }
            }
            if (/грамм|г\b/.test(t)) {
                const grams = voiceNumberWords(t);
                if (grams !== null && grams >= 500 && grams <= 30000) return grams;
            }
            return null;
        }

        function parseVoiceHeightWords(text) {
            const t = voiceNorm(text);
            const m = t.match(/([а-я\s]+?)\s*(?:см|сантиметр)/);
            if (!m) return null;
            const cm = voiceNumberWords(m[1]);
            return (cm !== null && cm >= 30 && cm <= 150) ? cm : null;
        }

        function parseVoiceTempWords(text) {
            const t = voiceNorm(text);
            const m = t.match(/([а-я\s]+?)\s+и\s+([а-я]+)/);
            if (m) {
                const whole = voiceNumberWords(m[1]);
                const frac = voiceNumberWords(m[2]);
                if (whole !== null && whole >= 34 && whole <= 42 && frac !== null && frac >= 0 && frac <= 9) {
                    return whole + frac / 10;
                }
            }
            if (/\sи\s/.test(t)) return null;
            const whole = voiceNumberWords(t);
            return (whole !== null && whole >= 34 && whole <= 42) ? whole : null;
        }

        function voiceTimeAgo(text) {
            const t = voiceNorm(text);
            if (/только что|прямо сейчас|сейчас/.test(t)) {
                return { date: new Date(), label: 'сейчас' };
            }
            let m = t.match(/(\d{1,3})\s*(?:мин|минут[аы]?|минуту)\s*назад/);
            if (m) {
                const n = parseInt(m[1], 10);
                return { date: new Date(Date.now() - n * 60000), label: n + ' мин назад' };
            }
            if (/полчас|пол часа/.test(t)) {
                return { date: new Date(Date.now() - 30 * 60000), label: '30 мин назад' };
            }
            if (/(?:^|\s)час\s*назад/.test(t)) {
                return { date: new Date(Date.now() - 3600000), label: '1 ч назад' };
            }
            m = t.match(/(\d{1,2})\s*(?:час|часа|часов)\s*назад/);
            if (m) {
                const n = parseInt(m[1], 10);
                return { date: new Date(Date.now() - n * 3600000), label: n + ' ч назад' };
            }
            m = t.match(/(?:^|\s)в\s*(\d{1,2})(?::|\.|\s)\s*(\d{2})(?:\s|$)/);
            if (m) {
                const h = parseInt(m[1], 10);
                const min = parseInt(m[2], 10);
                if (h <= 23 && min <= 59) {
                    const d = new Date();
                    d.setHours(h, min, 0, 0);
                    if (d.getTime() > Date.now() + 60000) d.setDate(d.getDate() - 1);
                    return {
                        date: d,
                        label: 'в ' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0')
                    };
                }
            }
            return null;
        }

        function parseVoiceCommand(text) {
            const raw = voiceNorm(text);
            if (!raw) return null;
            const when = voiceTimeAgo(text);
            const whenSuffix = when ? ' · ' + when.label : '';

            if (/покакал|покак|по\s*-?\s*большому/.test(raw)) {
                return {
                    kind: 'diaper', value: 'poop', icon: '💩', title: 'Покакала',
                    sub: 'Подгузник' + whenSuffix, when: when ? when.date : null
                };
            }
            if (/пописал|попис|по\s*-?\s*маленькому/.test(raw)) {
                return {
                    kind: 'diaper', value: 'pee', icon: '💦', title: 'Пописала',
                    sub: 'Подгузник' + whenSuffix, when: when ? when.date : null
                };
            }

            if (/температур|градус/.test(raw)) {
                const temp = parseVoiceTemp(text);
                if (temp !== null) {
                    return { kind: 'temp', value: temp, icon: '🌡', title: 'Температура', sub: String(temp).replace('.', ',') + ' °C' };
                }
            }
            if (/(^|\s)(вес|масса)/.test(raw)) {
                const grams = parseVoiceWeight(text);
                if (grams !== null) {
                    return { kind: 'weight', value: grams, icon: '⚖️', title: 'Записать вес', sub: voiceWeightLabel(grams) };
                }
            }
            if (/(^|\s)рост/.test(raw)) {
                const cm = parseVoiceHeight(text);
                if (cm !== null) {
                    return { kind: 'height', value: cm, icon: '📏', title: 'Записать рост', sub: String(cm).replace('.', ',') + ' см' };
                }
            }

            const feedIntent = /покорм|кормлен|съел|съела|поел|поела|выпил|выпила|бутылоч|смесь|молок|мл|миллилитр/.test(raw);
            if (feedIntent) {
                let ml = null;
                const withUnit = raw.match(/(\d{2,3})\s*(?:мл|миллилитр|ml|грамм|г\b)/);
                if (withUnit) ml = parseInt(withUnit[1], 10);
                if (ml === null) {
                    const anyNumber = raw.match(/\b(\d{2,3})\b/);
                    if (anyNumber) ml = parseInt(anyNumber[1], 10);
                }
                if (ml === null) ml = voiceNumberWords(raw);
                if (ml !== null) {
                    if (ml < 10 || ml > 300) ml = null;
                    else ml = Math.round(ml / 10) * 10;
                }
                return {
                    kind: 'feed',
                    value: ml,
                    icon: '🍼',
                    title: 'Покормить',
                    sub: (ml ? ml + ' мл' : 'Без объёма — откроем форму') + whenSuffix,
                    confirmLabel: ml ? 'Записать' : 'Указать объём',
                    when: when ? when.date : null
                };
            }

            if (/подгузник|памперс/.test(raw)) {
                return {
                    kind: 'diaper_ask', icon: '💧', title: 'Какой подгузник?',
                    sub: 'Покакала или пописала?' + whenSuffix,
                    when: when ? when.date : null
                };
            }

            if (/проснул|встал|разбудил/.test(raw)) {
                return { kind: 'wake', icon: '👀', title: 'Проснулась', sub: 'Сейчас' };
            }
            if (/уснул|заснул|уложил|спать|спит/.test(raw)) {
                return { kind: 'sleep', icon: '😴', title: 'Уложить спать', sub: 'Сейчас' };
            }
            if (/пришл|вернул|с прогулк|закончил.*прогул|завершил.*прогул|закончил.*гулять/.test(raw)) {
                return { kind: 'walk_stop', icon: '🏠', title: 'Закончить прогулку', sub: 'Сейчас' };
            }
            if (/погулял|пошли гулять|вышли|гуляем|прогулк|на улицу/.test(raw)) {
                return { kind: 'walk', icon: '🚶', title: 'Погулять', sub: 'Сейчас' };
            }
            return null;
        }

        function voiceSetStatus(text, listening) {
            const status = document.getElementById('voice-status');
            if (status) status.textContent = text;
            const orb = document.getElementById('voice-orb');
            if (orb) orb.classList.toggle('listening', !!listening);
        }

        function voiceShowPreview(action) {
            voiceAction = action;
            const box = document.getElementById('voice-preview');
            const icon = document.getElementById('voice-preview-icon');
            const title = document.getElementById('voice-preview-title');
            const sub = document.getElementById('voice-preview-sub');
            const confirm = document.getElementById('voice-confirm');
            const retry = document.getElementById('voice-retry');
            const hint = document.getElementById('voice-hint');
            const choices = document.getElementById('voice-choices');
            const ask = action.kind === 'diaper_ask';
            if (box) box.style.display = 'flex';
            if (icon) icon.textContent = action.icon || '🎤';
            if (title) title.textContent = action.title || '';
            if (sub) sub.textContent = action.sub || '';
            if (confirm) {
                confirm.textContent = action.confirmLabel || 'Записать';
                confirm.style.display = ask ? 'none' : 'block';
            }
            if (choices) choices.style.display = ask ? 'flex' : 'none';
            if (retry) retry.style.display = ask ? 'none' : 'block';
            if (hint) hint.style.display = 'none';
            voiceSetStatus(ask ? 'Уточните' : 'Понял', false);
        }

        function voiceFail(message) {
            voiceAction = null;
            voiceListening = false;
            voiceSetStatus(message || 'Не расслышал. Скажите ещё раз.', false);
            const confirm = document.getElementById('voice-confirm');
            const retry = document.getElementById('voice-retry');
            const hint = document.getElementById('voice-hint');
            const choices = document.getElementById('voice-choices');
            if (confirm) confirm.style.display = 'none';
            if (choices) choices.style.display = 'none';
            if (retry) retry.style.display = 'block';
            if (hint) hint.style.display = '';
        }

        function startVoiceRecognition() {
            const Ctor = voiceRecognitionCtor();
            if (!Ctor) {
                toast('Голосовой ввод не поддерживается этим браузером', true);
                return;
            }
            if (voiceRec) {
                try { voiceRec.abort(); } catch (e) {}
                voiceRec = null;
            }
            clearTimeout(voiceTimer);
            voiceAction = null;
            voiceListening = true;
            voiceFailed = false;

            const modal = document.getElementById('voice-modal');
            if (modal) modal.style.display = 'flex';
            const heard = document.getElementById('voice-heard');
            if (heard) heard.textContent = '';
            const preview = document.getElementById('voice-preview');
            if (preview) preview.style.display = 'none';
            const confirm = document.getElementById('voice-confirm');
            if (confirm) { confirm.style.display = 'none'; confirm.disabled = false; }
            const retry = document.getElementById('voice-retry');
            if (retry) retry.style.display = 'none';
            const choices = document.getElementById('voice-choices');
            if (choices) choices.style.display = 'none';
            const hint = document.getElementById('voice-hint');
            if (hint) hint.style.display = '';
            voiceSetStatus('Говорите…', true);

            const rec = new Ctor();
            voiceRec = rec;
            rec.lang = 'ru-RU';
            rec.interimResults = true;
            rec.continuous = false;
            rec.maxAlternatives = 5;

            rec.onresult = function (event) {
                let interim = '';
                const finals = [];
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    for (let j = 0; j < result.length; j++) {
                        const text = (result[j].transcript || '').trim();
                        if (!text) continue;
                        if (result.isFinal) finals.push(text);
                        else interim = text;
                    }
                }
                const heardEl = document.getElementById('voice-heard');
                if (interim && heardEl) heardEl.textContent = interim;
                if (!finals.length) return;

                let found = null;
                let best = finals[0];
                for (let i = 0; i < finals.length; i++) {
                    const parsed = parseVoiceCommand(finals[i]);
                    if (parsed) { found = parsed; best = finals[i]; break; }
                }
                if (heardEl) heardEl.textContent = best;
                voiceListening = false;
                clearTimeout(voiceTimer);
                try { rec.stop(); } catch (e) {}
                if (found) {
                    voiceShowPreview(found);
                } else {
                    voiceFailed = true;
                    voiceFail('Не понял. Скажите, например: «покормила 120 миллилитров».');
                }
            };

            rec.onerror = function (event) {
                const err = event && event.error;
                let message = 'Не получилось распознать. Попробуйте ещё раз.';
                if (err === 'not-allowed' || err === 'service-not-allowed') {
                    message = 'Разрешите доступ к микрофону в настройках браузера.';
                } else if (err === 'no-speech') {
                    message = 'Ничего не услышал. Скажите ещё раз.';
                } else if (err === 'network') {
                    message = 'Нет связи с сервисом распознавания.';
                } else if (err === 'audio-capture') {
                    message = 'Микрофон не найден.';
                }
                voiceFailed = true;
                voiceListening = false;
                clearTimeout(voiceTimer);
                voiceFail(message);
            };

            rec.onend = function () {
                clearTimeout(voiceTimer);
                if (voiceAction || voiceFailed) return;
                if (!voiceListening) return;
                voiceListening = false;
                const modalEl = document.getElementById('voice-modal');
                if (!modalEl || modalEl.style.display !== 'flex') return;
                const heardEl = document.getElementById('voice-heard');
                const heardText = heardEl ? heardEl.textContent : '';
                const parsed = heardText ? parseVoiceCommand(heardText) : null;
                if (parsed) {
                    voiceShowPreview(parsed);
                    return;
                }
                voiceFail('Не расслышал. Скажите ещё раз.');
            };

            try {
                rec.start();
            } catch (e) {
                voiceFailed = true;
                voiceListening = false;
                voiceFail('Не удалось включить микрофон. Попробуйте ещё раз.');
                return;
            }
            voiceTimer = setTimeout(function () {
                try { rec.stop(); } catch (e) {}
            }, 12000);
        }

        function updateVoicePremiumUi(premium) {
            const btn = document.getElementById('voice-btn');
            const pro = document.getElementById('voice-pro');
            if (btn) btn.classList.toggle('locked', !premium);
            if (pro) pro.textContent = premium ? 'PRO' : '🔒';
        }

        function openVoicePremium() {
            const modal = document.getElementById('voice-premium-modal');
            if (modal) modal.style.display = 'flex';
        }

        function closeVoicePremium(e) {
            if (e && e.target.id !== 'voice-premium-modal') return;
            const modal = document.getElementById('voice-premium-modal');
            if (modal) modal.style.display = 'none';
        }

        async function openVoiceModal() {
            if (!voiceRecognitionCtor()) {
                toast('Голосовой ввод не поддерживается этим браузером', true);
                return;
            }
            const premium = await ensurePremium();
            if (!premium) {
                openVoicePremium();
                return;
            }
            const modal = document.getElementById('voice-modal');
            if (modal) modal.style.display = 'flex';
            startVoiceRecognition();
        }

        function closeVoiceModal(e) {
            if (e && e.target.id !== 'voice-modal') return;
            if (voiceRec) {
                try { voiceRec.abort(); } catch (err) {}
                voiceRec = null;
            }
            clearTimeout(voiceTimer);
            voiceListening = false;
            const modal = document.getElementById('voice-modal');
            if (modal) modal.style.display = 'none';
        }

        async function executeVoiceAction(action) {
            if (!action) return;
            const confirm = document.getElementById('voice-confirm');
            if (confirm) confirm.disabled = true;
            try {
                if (action.kind === 'feed') {
                    if (!action.value) {
                        closeVoiceModal();
                        openFeedModal(action.when);
                        return;
                    }
                    await quickEvent('feed', action.value + ' мл', action.when);
                    toast('Записано: ' + action.value + ' мл');
                } else if (action.kind === 'diaper') {
                    await quickEvent('diaper', action.value, action.when);
                    toast(action.value === 'poop' ? 'Записано: покакала' : 'Записано: пописала');
                } else if (action.kind === 'weight' || action.kind === 'height') {
                    const body = { date: toLocalInputValue(new Date()).slice(0, 10) };
                    if (action.kind === 'weight') body.weight_g = action.value;
                    else body.height_cm = action.value;
                    const res = await fetch(`${API_URL}/measurements`, {
                        method: 'POST', headers: apiHeaders(true), body: JSON.stringify(body)
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    toast(action.kind === 'weight'
                        ? 'Записан вес: ' + voiceWeightLabel(action.value)
                        : 'Записан рост: ' + String(action.value).replace('.', ',') + ' см');
                    if (typeof loadGrowth === 'function') loadGrowth();
                } else if (action.kind === 'temp') {
                    const res = await fetch(`${API_URL}/health`, {
                        method: 'POST', headers: apiHeaders(true),
                        body: JSON.stringify({ kind: 'temp', value: action.value, unit: '°C' })
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    toast('Температура: ' + String(action.value).replace('.', ',') + ' °C');
                    if (typeof loadHealthLog === 'function') loadHealthLog();
                } else if (action.kind === 'sleep') {
                    if (activeSleepId) { toast('Уже спит', true); return; }
                    await quickStart('sleep');
                    toast('Записано: сон начался');
                } else if (action.kind === 'wake') {
                    if (!activeSleepId) { toast('Сейчас не спит', true); return; }
                    await quickStart('awake');
                    toast('Записано: проснулась');
                } else if (action.kind === 'walk') {
                    if (activeWalkId) { toast('Уже гуляет', true); return; }
                    await quickStart('walk');
                    toast('Записано: прогулка началась');
                } else if (action.kind === 'walk_stop') {
                    if (!activeWalkId) { toast('Прогулка не начата', true); return; }
                    await fetch(`${API_URL}/events/${activeWalkId}/stop`, {
                        method: 'POST', headers: apiHeaders(true)
                    });
                    loadEvents();
                    toast('Прогулка завершена');
                }
            } catch (e) {
                toast('Не удалось записать', true);
            } finally {
                if (confirm) confirm.disabled = false;
                closeVoiceModal();
            }
        }

        function confirmVoiceAction() {
            executeVoiceAction(voiceAction);
        }

        function chooseVoiceDiaper(kind) {
            const poop = kind === 'poop';
            const when = voiceAction && voiceAction.when ? voiceAction.when : null;
            executeVoiceAction({
                kind: 'diaper',
                value: kind,
                icon: poop ? '💩' : '💦',
                title: poop ? 'Покакала' : 'Пописала',
                sub: 'Подгузник',
                when: when
            });
        }

        (function initVoiceButton() {
            if (!voiceRecognitionCtor()) {
                const btn = document.getElementById('voice-btn');
                if (btn) btn.style.display = 'none';
            }
        })();

        // --- АУДИО ---
        let audioCtx = null, gainNode = null, currentSource = null;
        let audioBuffers = {}, isPlaying = false, currentSound = 'white', isAudioLoading = false;
        const sounds = { 'white': 'sounds/white.mp3?v=3', 'rain': 'sounds/rain.mp3?v=3', 'womb': 'sounds/womb.mp3?v=3', 'heart': 'sounds/heart.mp3?v=3', 'pink': 'sounds/pink.mp3?v=3', 'brown': 'sounds/brown.mp3?v=3', 'ocean': 'sounds/ocean.mp3?v=3', 'heartbeat': 'sounds/heart2.mp3?v=3', 'fan': 'sounds/fan.mp3?v=3', 'wind': 'sounds/wind.mp3?v=3', 'shush': 'sounds/shush.mp3?v=3', 'train': 'sounds/train.mp3?v=3' };
        const playPauseBtn = document.getElementById('play-pause-btn');

        const noiseEl = document.getElementById('noise-audio');
        let currentVolume = 0.5;
        const soundTitles = {};

        function updateMediaSession(name) {
            if (!('mediaSession' in navigator)) return;
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: soundTitles[name] || 'Звук для сна',
                    artist: 'Лад',
                    album: 'Звуки для сна',
                    artwork: [
                        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
                    ]
                });
                navigator.mediaSession.setActionHandler('play', function () {
                    if (!isPlaying) playSound(currentSound);
                });
                navigator.mediaSession.setActionHandler('pause', function () {
                    stopCurrentAudio();
                });
                navigator.mediaSession.setActionHandler('stop', function () {
                    stopCurrentAudio();
                });
            } catch (e) {}
        }

        function stopCurrentAudio() {
            if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
            if (sleepFadeId) { clearInterval(sleepFadeId); sleepFadeId = null; }
            if (typeof resetTimerChips === 'function') resetTimerChips();
            if (noiseEl) { try { noiseEl.pause(); } catch (e) {} }
            isPlaying = false;
            if (playPauseBtn) playPauseBtn.classList.remove('playing');
            if ('mediaSession' in navigator) {
                try { navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
            }
        }

        async function playSound(soundName) {
            if (!noiseEl || isAudioLoading) return;
            isAudioLoading = true;
            try {
                noiseEl.pause();
                noiseEl.src = sounds[soundName] || soundName;
                noiseEl.loop = true;
                noiseEl.volume = currentVolume;
                await noiseEl.play();
                isPlaying = true;
                if (playPauseBtn) playPauseBtn.classList.add('playing');
                updateMediaSession(soundName);
                if ('mediaSession' in navigator) {
                    try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
                }
            } catch (e) {
                toast('Не удалось включить звук', true);
            } finally {
                isAudioLoading = false;
            }
        }

        async function changeNoise(btn) {
            document.querySelectorAll('.noise-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentSound = btn.getAttribute('data-sound');
            if (isPlaying) await playSound(currentSound);
        }

        async function toggleAudio() {
            if (isPlaying) { stopCurrentAudio(); }
            else { await playSound(currentSound); }
        }

        function setVolume(val) {
            currentVolume = Math.max(0, Math.min(1, parseFloat(val) || 0));
            if (noiseEl) noiseEl.volume = currentVolume;
            const slider = document.getElementById('volume');
            if (slider) slider.style.setProperty('--fill', Math.round(currentVolume * 100) + '%');
        }

        if (noiseEl) {
            noiseEl.addEventListener('pause', function () {
                if (noiseEl.ended) stopCurrentAudio();
            });
        }

        async function loadSounds() {
            try {
                const res = await fetch(`${API_URL}/sounds`, { headers: apiHeaders() });
                if (!res.ok) return;
                const list = await res.json();
                if (!Array.isArray(list) || !list.length) return;
                const grid = document.getElementById('noise-grid');
                if (!grid) return;
                grid.innerHTML = '';
                list.forEach(function (s, idx) {
                    sounds[s.id] = s.url;
                    soundTitles[s.id] = s.title;
                    const b = document.createElement('button');
                    b.className = 'noise-btn' + (idx === 0 ? ' active' : '');
                    b.setAttribute('data-sound', s.id);
                    b.innerHTML = '<span class="icon">' + s.emoji + '</span> ' + s.title;
                    b.onclick = function () { changeNoise(b); };
                    grid.appendChild(b);
                });
            } catch (e) {}
        }

        async function openNoiseModal() {
            if (!(await ensurePremium())) {
                toast('Белый шум и звуки — в Премиуме 🔒', true);
                openProfile();
                return;
            }
            loadSounds();
            setVolume(currentVolume);
            document.getElementById('noise-modal').style.display = 'flex';
        }
        function closeNoiseModal(e) { if (!e || e.target.id === 'noise-modal') document.getElementById('noise-modal').style.display = 'none'; }

        // --- ТРЕКЕР ---
        function formatDuration(ms) {
            const totalMinutes = Math.floor(ms / 60000);
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            if (h > 0) return `${h}ч ${m}м`;
            return `${m}м`;
        }

        async function deleteEvent(id) {
            if (!confirm("Удалить эту запись?")) return;
            await fetch(`${API_URL}/events/${id}`, { method: 'DELETE', headers: apiHeaders() });
            loadEvents();
        }

        const expandedDays = new Set();
        const expandedMonths = new Set();
        let activeWalkId = null;
        let activeWalkStart = null;

        async function toggleSleepAwake() {
            if (activeSleepId) {
                // Если спит — будим: спрашиваем, когда проснулась
                openTimerModal('awake', 'wake');
            } else {
                // Укладываем спать: сначала спрашиваем время начала
                openTimerModal('sleep', 'start');
            }
        }

        // --- ВРЕМЯ НАЧАЛА СОБЫТИЙ (сон / бодрствование / прогулка) ---
        let timerModalType = 'sleep';
        let timerModalMode = 'start';

        const TIMER_TEXT = {
            sleep: { title: 'Когда заснула?', hint: 'Если заснула раньше — поправь время, таймер пойдёт с него.', start: 'Уложить спать' },
            awake: { title: 'Когда проснулась?', hint: 'Поставь время, когда малышка проснулась — с него пойдёт бодрствование.', start: 'Разбудить' },
            walk:  { title: 'Когда пошла гулять?', hint: 'Если вышли раньше — поправь время, таймер пойдёт с него.', start: 'Погулять' },
            feed:  { title: 'Когда покормили?', hint: 'Поправь время кормления — запись пересчитается.', start: 'Записать' }
        };

        function toLocalInputValue(d) {
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }

        let editingEventId = null;

        function ensureEventEditModal() {
            if (document.getElementById('event-edit-modal')) return;
            const div = document.createElement('div');
            div.className = 'modal-overlay';
            div.id = 'event-edit-modal';
            div.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header"><h2>Изменить запись</h2>
                        <button class="btn-close" onclick="closeEventEdit()">✕</button></div>
                    <p class="sleep-hint" id="event-edit-hint">Поправь начало и конец записи.</p>
                    <label class="sleep-hint" id="event-edit-start-label">Начало</label>
                    <input type="datetime-local" id="event-edit-start" class="sleep-time-input">
                    <label class="sleep-hint" id="event-edit-end-label">Конец</label>
                    <input type="datetime-local" id="event-edit-end" class="sleep-time-input">
                    <button class="btn-save-ml" id="event-edit-save">Сохранить</button>
                </div>`;
            div.addEventListener('click', (ev) => { if (ev.target === div) closeEventEdit(); });
            document.body.appendChild(div);
            document.getElementById('event-edit-save').onclick = saveEventEdit;
        }

        let editingEventInstant = false;

        function editEventTime(id, startIso, endIso, type) {
            ensureEventEditModal();
            editingEventId = id;
            // Мгновенные записи (подгузник) — это точка во времени, а не промежуток.
            const instant = type === 'diaper'
                || (startIso && endIso && Math.abs(new Date(endIso) - new Date(startIso)) < 2000);
            editingEventInstant = instant;
            document.getElementById('event-edit-start').value = toLocalInputValue(new Date(startIso));
            document.getElementById('event-edit-end').value = endIso && !instant ? toLocalInputValue(new Date(endIso)) : '';
            document.getElementById('event-edit-end-label').style.display = instant ? 'none' : '';
            document.getElementById('event-edit-end').style.display = instant ? 'none' : '';
            document.getElementById('event-edit-start-label').textContent = instant ? 'Когда' : 'Начало';
            document.getElementById('event-edit-hint').textContent = instant
                ? 'Поправь время записи.'
                : 'Поправь начало и конец записи.';
            document.getElementById('event-edit-modal').style.display = 'flex';
        }

        function closeEventEdit() {
            const m = document.getElementById('event-edit-modal');
            if (m) m.style.display = 'none';
        }

        async function saveEventEdit() {
            const sEl = document.getElementById('event-edit-start');
            const eEl = document.getElementById('event-edit-end');
            if (!sEl || !sEl.value) { toast('Укажи начало', true); return; }
            if (!editingEventId) return;
            let start = new Date(sEl.value);
            if (isNaN(start.getTime())) start = new Date();
            const body = { start_time: start.toISOString() };
            if (editingEventInstant) {
                body.end_time = start.toISOString();
            } else if (eEl && eEl.value) {
                const end = new Date(eEl.value);
                if (!isNaN(end.getTime()) && end >= start) body.end_time = end.toISOString();
            }
            const res = await fetch(`${API_URL}/events/${editingEventId}`, {
                method: 'PATCH', headers: apiHeaders(true), body: JSON.stringify(body)
            });
            if (res.ok) { toast('Сохранено'); closeEventEdit(); loadEvents(); }
            else { toast('Не удалось сохранить', true); }
        }

        function activeStartOf(type) {
            if (type === 'sleep') return activeSleepStart;
            if (type === 'awake') return activeAwakeStart;
            if (type === 'feed') return activeFeedStart;
            return activeWalkStart;
        }

        async function quickStart(type) {
            // Резервный путь: если модалка почему-то недоступна (старая оболочка,
            // кэш PWA на iOS) — стартуем таймер сразу, чтобы кнопка не «молчала».
            const iso = new Date().toISOString();
            if (type === 'awake') {
                if (activeSleepId) {
                    await fetch(`${API_URL}/events/${activeSleepId}/stop`, {
                        method: 'POST', headers: apiHeaders(true),
                        body: JSON.stringify({ end_time: iso })
                    });
                }
                await fetch(`${API_URL}/events/start`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ event_type: 'awake', start_time: iso })
                });
            } else {
                await fetch(`${API_URL}/events/start`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ event_type: type, start_time: iso })
                });
            }
            loadEvents();
        }

        function openTimerModal(type, mode) {
            timerModalType = type;
            timerModalMode = mode || 'start';
            const modal = document.getElementById('timer-modal');
            const inp = document.getElementById('timer-time');
            const title = document.getElementById('timer-modal-title');
            const hint = document.getElementById('timer-modal-hint');
            const btn = document.getElementById('timer-confirm');
            if (!modal || !inp || !title || !btn) {
                quickStart(type);
                return;
            }

            const txt = TIMER_TEXT[type] || TIMER_TEXT.sleep;
            title.textContent = txt.title;
            hint.textContent = (timerModalMode === 'edit')
                ? 'Поправь время начала — таймер пересчитается.'
                : txt.hint;

            if (timerModalMode === 'edit') {
                const started = activeStartOf(type);
                inp.value = toLocalInputValue(started ? new Date(started) : new Date());
                btn.textContent = 'Сохранить';
            } else {
                inp.value = toLocalInputValue(new Date());
                btn.textContent = txt.start;
            }
            document.getElementById('timer-modal').style.display = 'flex';
        }

        function closeTimerModal(e) {
            if (!e || e.target.id === 'timer-modal') {
                document.getElementById('timer-modal').style.display = 'none';
            }
        }

        function timerShift(minutes) {
            const inp = document.getElementById('timer-time');
            const base = inp.value ? new Date(inp.value) : new Date();
            if (isNaN(base.getTime())) return;
            base.setMinutes(base.getMinutes() + minutes);
            inp.value = toLocalInputValue(base);
        }

        function timerNow() {
            const inp = document.getElementById('timer-time');
            inp.value = toLocalInputValue(new Date());
            confirmTimerTime();
        }

        async function confirmTimerTime() {
            const inp = document.getElementById('timer-time');
            const val = inp ? inp.value : '';
            // На iOS поле даты иногда остаётся пустым — не ругаемся, а берём «сейчас»
            let when = val ? new Date(val) : new Date();
            if (isNaN(when.getTime())) when = new Date();
            if (when.getTime() > Date.now() + 60000) when = new Date();
            closeTimerModal();

            const iso = when.toISOString();
            const type = timerModalType;

            // Правка начала уже идущего события
            if (timerModalMode === 'edit') {
                if (type === 'feed') {
                    if (!editingFeedId) { toast('Нет записи', true); return; }
                    const res = await fetch(`${API_URL}/events/${editingFeedId}`, {
                        method: 'PATCH', headers: apiHeaders(true),
                        body: JSON.stringify({ start_time: iso, end_time: iso })
                    });
                    if (res.ok) toast('Время кормления обновлено');
                    else toast('Не удалось изменить время', true);
                    loadEvents();
                    return;
                }
                const id = type === 'sleep' ? activeSleepId : (type === 'awake' ? activeAwakeId : activeWalkId);
                if (!id) { toast('Нет активного таймера', true); return; }
                const res = await fetch(`${API_URL}/events/${id}/start`, {
                    method: 'PATCH', headers: apiHeaders(true),
                    body: JSON.stringify({ start_time: iso })
                });
                if (res.ok) toast('Время начала обновлено');
                else toast('Не удалось изменить время', true);
                loadEvents();
                return;
            }

            // Проснулась: закрываем сон временем пробуждения и стартуем бодрствование
            if (type === 'awake') {
                if (activeSleepId) {
                    await fetch(`${API_URL}/events/${activeSleepId}/stop`, {
                        method: 'POST', headers: apiHeaders(true),
                        body: JSON.stringify({ end_time: iso })
                    });
                }
                const res = await fetch(`${API_URL}/events/start`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ event_type: 'awake', start_time: iso })
                });
                if (!res.ok) toast('Не удалось разбудить', true);
                loadEvents();
                return;
            }

            // Старт сна или прогулки
            const res = await fetch(`${API_URL}/events/start`, {
                method: 'POST', headers: apiHeaders(true),
                body: JSON.stringify({ event_type: type, start_time: iso })
            });
            if (!res.ok) toast('Не удалось начать', true);
            loadEvents();
        }

        async function toggleWalk() {
            if (activeWalkId) {
                // Если гуляет — просто заканчиваем прогулку (остальное не трогаем)
                await fetch(`${API_URL}/events/${activeWalkId}/stop`, { method: 'POST', headers: apiHeaders() });
                loadEvents();
            } else {
                // Начинаем прогулку: спрашиваем, когда вышли
                openTimerModal('walk', 'start');
            }
        }


        function updateOnboarding(count) {
            const box = document.getElementById('onboarding-hint');
            if (!box) return;
            let done = false;
            try { done = localStorage.getItem('lad_onboard_done') === '1'; } catch (e) {}
            box.style.display = (count === 0 && !done) ? 'block' : 'none';
        }

        function dismissOnboarding() {
            try { localStorage.setItem('lad_onboard_done', '1'); } catch (e) {}
            const box = document.getElementById('onboarding-hint');
            if (box) box.style.display = 'none';
        }


        // ===== СЕГОДНЯ =====
        function eventVolumeMl(details) {
            if (!details) return 0;
            const m = String(details).match(/(\d+(?:[.,]\d+)?)/);
            return m ? Math.round(parseFloat(m[1].replace(',', '.'))) : 0;
        }

        function renderToday(events) {
            const card = document.getElementById('today-card');
            if (!card) return;
            const list = Array.isArray(events) ? events : [];
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const isToday = function (iso) {
                if (!iso) return false;
                const t = new Date(iso).getTime();
                return !isNaN(t) && t >= startOfDay;
            };

            let feeds = 0, ml = 0, diapers = 0, walks = 0, walkMs = 0, sleepMs = 0;
            list.forEach(function (e) {
                if (!isToday(e.start_time)) return;
                const start = new Date(e.start_time).getTime();
                if (e.event_type === 'feed') {
                    feeds += 1;
                    ml += eventVolumeMl(e.details);
                } else if (e.event_type === 'diaper') {
                    diapers += 1;
                } else if (e.event_type === 'walk') {
                    walks += 1;
                    const end = e.end_time ? new Date(e.end_time).getTime() : now.getTime();
                    if (!isNaN(start) && end > start) walkMs += end - start;
                } else if (e.event_type === 'sleep') {
                    const end = e.end_time ? new Date(e.end_time).getTime() : now.getTime();
                    if (!isNaN(start) && end > start) sleepMs += end - start;
                }
            });

            if (!feeds && !diapers && !walks && !sleepMs) { card.style.display = 'none'; return; }
            card.style.display = '';

            function fmt(ms) {
                const min = Math.floor(ms / 60000);
                const h = Math.floor(min / 60);
                const m = min % 60;
                return h > 0 ? h + ' ч ' + m + ' м' : m + ' м';
            }

            document.getElementById('t-feeds').textContent = feeds;
            const minUiToday = document.documentElement.classList.contains('min-ui');
            document.getElementById('t-ml').textContent = ml
                ? (minUiToday ? ml + ' мл' : '· ' + ml + ' мл')
                : (minUiToday ? 'кормления' : '');
            document.getElementById('t-sleep').textContent = fmt(sleepMs);
            document.getElementById('t-diapers').textContent = diapers;
            document.getElementById('t-walks').textContent = walks;
            document.getElementById('t-walk-min').textContent = walks
                ? (minUiToday ? fmt(walkMs) : '· ' + fmt(walkMs))
                : (minUiToday ? 'прогулки' : '');
        }



        function fetchWithTimeout(url, opts, ms) {
            return Promise.race([
                fetch(url, opts),
                new Promise(function (_, reject) {
                    setTimeout(function () { reject(new Error('timeout')); }, ms);
                })
            ]);
        }

        function renderFeedBadge(events) {
            const feedBadge = document.getElementById('last-feed-badge');
            if (!feedBadge) return;
            const lastFeed = (events || []).find(function (e) { return e.event_type === 'feed'; });
            if (lastFeed) {
                feedBadge.style.display = 'inline-block';
                feedBadge.textContent = '🍼 Последнее: ' + formatDuration(new Date() - new Date(lastFeed.start_time)) + ' назад';
            } else {
                feedBadge.style.display = 'none';
            }
        }

        async function loadEvents() {
            // Мгновенно показываем кэш: даже если сеть медленная или её нет
            try {
                const cachedNow = cachedEvents();
                if (cachedNow.length) {
                    renderToday(cachedNow);
                    renderFeedBadge(cachedNow);
                }
            } catch (e) {}

            try {
                let events = [];
                try {
                    const res = await fetchWithTimeout(`${API_URL}/events/history?days=14`, { headers: apiHeaders() }, 4000);
                    if (handleAuthError(res) || !res.ok) throw new Error('HTTP ' + res.status);
                    events = await res.json();
                    if (!Array.isArray(events)) events = [];
                    mergeIntoCache(events);
                } catch (netErr) {
                    events = cachedEvents();
                    const banner = document.getElementById('api-banner');
                    const bannerHidden = !banner || banner.style.display === 'none';
                    if (events.length) {
                        toast("Нет связи — показаны сохранённые записи", true);
                    } else if (bannerHidden) {
                        // Ни данных, ни кэша: молчать нельзя — иначе «таймер не работает» без причины
                        showApiBanner('Не удалось загрузить записи: ' + (netErr && netErr.message ? netErr.message : 'ошибка'));
                    }
                }
                renderStatus();
                updateOnboarding(events.length);
                renderToday(events);
                
                const activeSleep = events.find(e => e.event_type === 'sleep' && !e.end_time);
                const activeAwake = events.find(e => e.event_type === 'awake' && !e.end_time);
                activeWalkId = events.find(e => e.event_type === 'walk' && !e.end_time)?.id || null;
                const minUi = document.documentElement.classList.contains('min-ui');

                // Настройка таймеров
                if (activeSleep) {
                    activeSleepId = activeSleep.id;
                    activeSleepStart = activeSleep.start_time;
                    document.getElementById('row-sleep').classList.add('timer-active', 'timer-editable');
                    document.getElementById('row-sleep').onclick = () => openTimerModal('sleep', 'edit');
                    startTimer('timer-sleep', new Date(activeSleep.start_time), 'sleep');
                    document.getElementById('awake-btn').style.background = 'var(--sleep)';
                    document.getElementById('state-text').innerText = minUi ? 'Разбудить' : 'Разбудить (Спит)';
                    document.getElementById('state-icon').innerText = '👀';
                } else {
                    activeSleepId = null;
                    activeSleepStart = null;
                    document.getElementById('row-sleep').classList.remove('timer-active', 'timer-editable');
                    document.getElementById('row-sleep').onclick = null;
                    if (timerIntervals.sleep) clearInterval(timerIntervals.sleep);
                    document.getElementById('timer-sleep').textContent = '00:00:00';
                    document.getElementById('awake-btn').style.background = 'var(--awake)';
                    document.getElementById('state-text').innerText = minUi ? 'Сон' : 'Уложить спать';
                    document.getElementById('state-icon').innerText = '😴';
                }

                if (activeAwake) {
                    activeAwakeId = activeAwake.id;
                    activeAwakeStart = activeAwake.start_time;
                    document.getElementById('row-awake').classList.add('timer-active', 'timer-editable');
                    document.getElementById('row-awake').onclick = () => openTimerModal('awake', 'edit');
                    startTimer('timer-awake', new Date(activeAwake.start_time), 'awake');
                } else {
                    activeAwakeId = null;
                    activeAwakeStart = null;
                    document.getElementById('row-awake').classList.remove('timer-active', 'timer-editable');
                    document.getElementById('row-awake').onclick = null;
                    if (timerIntervals.awake) clearInterval(timerIntervals.awake);
                    document.getElementById('timer-awake').textContent = '00:00:00';
                }

                const walkBtn = document.getElementById('walk-btn');
                if (activeWalkId) {
                    const walkStart = events.find(e => e.id === activeWalkId)?.start_time || null;
                    activeWalkStart = walkStart;
                    document.getElementById('row-walk').classList.add('timer-active', 'timer-editable');
                    document.getElementById('row-walk').onclick = () => openTimerModal('walk', 'edit');
                    startTimer('timer-walk', new Date(walkStart), 'walk');
                    if (walkBtn) {
                        if (minUi) {
                            walkBtn.style.background = '';
                            walkBtn.style.color = '';
                        } else {
                            walkBtn.style.background = 'var(--noise)';
                            walkBtn.style.color = '#111827';
                        }
                        document.getElementById('walk-text').innerText = minUi ? 'Закончить' : 'Закончить прогулку';
                    }
                } else {
                    activeWalkStart = null;
                    document.getElementById('row-walk').classList.remove('timer-active', 'timer-editable');
                    document.getElementById('row-walk').onclick = null;
                    if (timerIntervals.walk) clearInterval(timerIntervals.walk);
                    document.getElementById('timer-walk').textContent = '00:00:00';
                    if (walkBtn) {
                        if (minUi) {
                            walkBtn.style.background = '';
                            walkBtn.style.color = '';
                        } else {
                            walkBtn.style.background = 'var(--card)';
                            walkBtn.style.color = 'var(--text)';
                        }
                        document.getElementById('walk-text').innerText = minUi ? 'Прогулка' : 'Погулять';
                    }
                }

                // Лента
                renderFeedBadge(events);

                const list = document.getElementById('log-list');

                // --- АККОРДЕОН ПО ДНЯМ ---
                const grouped = {};
                const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: tz() });
                const todayKey = dayKey(new Date());
                const labelOf = (key) => new Date(key + 'T12:00:00+03:00')
                    .toLocaleDateString('ru-RU', { timeZone: tz(), day: '2-digit', month: 'long' });
                const plural = (n, one, few, many) => {
                    const a = Math.abs(n) % 100;
                    const b = a % 10;
                    if (a > 10 && a < 20) return many;
                    if (b === 1) return one;
                    if (b >= 2 && b <= 4) return few;
                    return many;
                };

                const listEvents = events.filter(e =>
                    logFilter === 'all' || e.event_type === logFilter
                );

                listEvents.forEach(e => {
                    if ((e.event_type === 'sleep' || e.event_type === 'awake' || e.event_type === 'walk') && !e.end_time) return;
                    const k = dayKey(e.start_time);
                    if (!grouped[k]) grouped[k] = [];
                    grouped[k].push(e);
                });

                let html = '';
                const keys = Object.keys(grouped).sort().reverse();
                const orderedKeys = keys.includes(todayKey)
                    ? [todayKey].concat(keys.filter(k => k !== todayKey))
                    : keys;
                let currentMonth = null;
                orderedKeys.forEach(key => {
                    const isToday = key === todayKey;
                    if (!isToday) {
                        const monthKey = key.slice(0, 7);
                        if (monthKey !== currentMonth) {
                            if (currentMonth) html += '</div></div>';
                            const monthOpen = expandedMonths.has(monthKey);
                            const monthDays = Object.keys(grouped).filter(k =>
                                k.startsWith(monthKey) && k !== todayKey
                            );
                            const monthEvents = monthDays.reduce((n, k) => n + grouped[k].length, 0);
                            const rawMonth = new Date(monthKey + '-01T12:00:00+03:00')
                                .toLocaleDateString('ru-RU', { timeZone: tz(), month: 'long', year: 'numeric' });
                            const monthLabel = rawMonth.charAt(0).toUpperCase()
                                + rawMonth.slice(1).replace(' г.', '');
                            html += `<div class="month-section${monthOpen ? ' open' : ''}">`
                                + `<button type="button" class="month-toggle" data-month="${monthKey}" aria-expanded="${monthOpen}">`
                                + `<span class="month-info"><b>${monthLabel}</b>`
                                + `<span>${monthDays.length} ${plural(monthDays.length, 'день', 'дня', 'дней')}`
                                + ` · ${monthEvents} ${plural(monthEvents, 'запись', 'записи', 'записей')}</span></span>`
                                + `<span class="month-chev" aria-hidden="true">▼</span></button>`
                                + `<div class="month-body">`;
                            currentMonth = monthKey;
                        }
                    }
                    const dateStr = labelOf(key);
                    const open = isToday || expandedDays.has(key);

                    // Сводка по дню: что и сколько записей
                    const cnt = { feed: 0, sleep: 0, awake: 0, diaper: 0, walk: 0 };
                    grouped[key].forEach(e => {
                        if (Object.prototype.hasOwnProperty.call(cnt, e.event_type)) {
                            if ((e.event_type === 'sleep' || e.event_type === 'awake' || e.event_type === 'walk') && !e.end_time) return;
                            cnt[e.event_type] += 1;
                        }
                    });
                    const metaParts = [];
                    if (cnt.feed) metaParts.push('🍼 ' + cnt.feed);
                    if (cnt.sleep) metaParts.push('🌙 ' + cnt.sleep);
                    if (cnt.awake) metaParts.push('👀 ' + cnt.awake);
                    if (cnt.diaper) metaParts.push('💧 ' + cnt.diaper);
                    if (cnt.walk) metaParts.push('🚶 ' + cnt.walk);
                    const meta = metaParts.join('  ·  ') || 'записи';
                    const parts = dateStr.split(' ');
                    const dayNum = parts[0];
                    const monShort = (parts[1] || '').slice(0, 3);

                    html += `<div class="day-section${isToday ? ' today' : ''}${open ? ' open' : ''}">`;

                    const tile = `<span class="day-tile"><b>${dayNum}</b><i>${monShort}</i></span>`;
                    const info = `<span class="day-info"><b>${isToday ? 'Сегодня' : dateStr}</b>`
                        + `<span class="day-meta">${meta}</span></span>`;

                    if (isToday) {
                        html += `<div class="log-date-title day-head">${tile}${info}</div>`;
                    } else {
                        html += `<button type="button" class="log-date-title day-toggle day-head" data-day="${key}" aria-expanded="${open}">`
                            + `${tile}${info}<span class="chev" aria-hidden="true">▼</span></button>`;
                    }

                    html += `<div class="day-body">`;

                    grouped[key].forEach(e => {
                    if ((e.event_type === 'sleep' || e.event_type === 'awake') && !e.end_time) return;

                    let icon = "", name = "", sub = "", timeStr = "", badge = "";
                    const startTime = new Date(e.start_time);
                    const timeOptions = { timeZone: tz(), hour: '2-digit', minute: '2-digit' };
                    timeStr = startTime.toLocaleTimeString('ru-RU', timeOptions);

                    if (e.event_type === 'sleep' && e.end_time) {
                        icon = "🌙"; name = g("Спала", "Спал");
                        const endTime = new Date(e.end_time);
                        sub = `${timeStr} - ${endTime.toLocaleTimeString('ru-RU', timeOptions)}`;
                        badge = formatDuration(endTime - startTime);
                        timeStr = "";
                    }
                    else if (e.event_type === 'awake' && e.end_time) {
                        icon = "👀"; name = g("Бодрствовала", "Бодрствовал");
                        const endTime = new Date(e.end_time);
                        sub = `${timeStr} - ${endTime.toLocaleTimeString('ru-RU', timeOptions)}`;
                        badge = formatDuration(endTime - startTime);
                        timeStr = "";
                    }
                    else if (e.event_type === 'feed') { icon = "🍼"; name = g("Покушала", "Покушал"); sub = e.details || "Бутылочка"; }
                    else if (e.event_type === 'diaper') {
                        const det = e.details || '';
                        // «Пописала» / «Пописал» — капля, всё остальное — какашка
                        icon = /^попис/i.test(det) ? "💦" : "💩";
                        name = det || "Подгузник";
                        sub = "";
                    }
                    else if (e.event_type === 'walk' && e.end_time) {
                        icon = "🚶‍♀️"; name = g("Гуляла", "Гулял");
                        const endTime = new Date(e.end_time);
                        sub = `${timeStr} - ${endTime.toLocaleTimeString('ru-RU', timeOptions)}`;
                        badge = formatDuration(endTime - startTime);
                        timeStr = "";
                    }

                    const rightSide = timeStr ? `<div class="log-time">${timeStr}</div>` : `<div class="badge-duration">${badge}</div>`;

                    html += `
                        <div class="log-item">
                            <div class="log-left">
                                <div class="log-icon">${icon}</div>
                                <div class="log-name">${esc(name)}<br><span class="log-sub">${esc(sub)}</span></div>
                            </div>
                            <div class="log-right">
                                ${rightSide}
                                ${e.event_type === 'feed' ? `<button class="btn-delete" title="Изменить время" onclick="editFeedTime(${e.id}, '${e.start_time}')">✎</button>` : (e.end_time ? `<button class="btn-delete" title="Изменить время" onclick="editEventTime(${e.id}, '${e.start_time}', '${e.end_time}', '${e.event_type}')">✎</button>` : '')}
                                <button class="btn-delete" onclick="deleteEvent(${e.id})">✕</button>
                            </div>
                        </div>
                    `;
                    });

                    html += `</div></div>`;
                });
                if (currentMonth) html += '</div></div>';

                if (html) {
                    if (list.innerHTML !== html) list.innerHTML = html;
                } else {
                    list.innerHTML = '<div class="log-empty">Нет записей за выбранный период</div>';
                }
                syncFilterUi();
            } catch(e) { console.error("Ошибка загрузки событий", e); }
        }

        function startTimer(elementId, startTime, type) {
            const display = document.getElementById(elementId);
            if (!display) return;
            const startedAt = startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();
            function update() {
                // Часы телефона и сервера расходятся на секунды: start_time может
                // оказаться «в будущем», и счётчик уходил в -1:-1:-1. Ждём нуля.
                const elapsed = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
                const diff = Math.max(0, Math.floor(elapsed / 1000));
                const h = Math.floor(diff / 3600);
                const m = Math.floor((diff % 3600) / 60);
                const s = diff % 60;
                display.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }
            update();
            if (timerIntervals[type]) clearInterval(timerIntervals[type]);
            timerIntervals[type] = setInterval(update, 1000);
        }

        async function quickEvent(type, details, when) {
            if (navigator.vibrate) navigator.vibrate(50);
            const payload = { event_type: type, details: details, client_uuid: newId() };
            if (when instanceof Date && !isNaN(when.getTime())) payload.start_time = when.toISOString();
            const body = JSON.stringify(payload);
            try {
                const res = await fetch(`${API_URL}/events/quick`, { method: 'POST', headers: apiHeaders(true), body: body });
                if (handleAuthError(res) || !res.ok) throw new Error('HTTP ' + res.status);
            } catch (e) {
                enqueue({ url: `${API_URL}/events/quick`, method: 'POST', body: body, label: `${type}: ${details}` });
                toast("Нет связи — запись в очереди", true);
            } finally {
                loadEvents();
            }
        }

        // --- СТАТИСТИКА ---
        async function loadStats() {
            try {
                const res = await fetch(`${API_URL}/events/week`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                const events = await res.json();
                if (Array.isArray(events)) {
                    mergeIntoCache(events);
                    hideApiBanner();
                }
                
                // Московское время фиксированное (UTC+3), поэтому считаем дни вручную:
                // событие, перешедшее через полночь, режем на части по суткам.
                const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
                const dayKeyOf = (ms) => {
                    const d = new Date(ms + MSK_OFFSET_MS);
                    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                };
                const dayStartOf = (key) => {
                    const [y, m, d] = key.split('-').map(Number);
                    return Date.UTC(y, m - 1, d) - MSK_OFFSET_MS;
                };

                const days = [];
                const dayKeys = [];
                const feedsByDay = {};
                const diapersByDay = {};
                const sleepByDay = {};
                const awakeByDay = {};
                const walkByDay = {};
                const volumeByDay = {};

                for (let i = 6; i >= 0; i--) {
                    const ts = Date.now() - i * 86400000;
                    const key = dayKeyOf(ts);
                    dayKeys.push(key);
                    days.push(new Date(ts).toLocaleDateString('ru-RU', { timeZone: tz(), day: '2-digit', month: '2-digit' }));
                    feedsByDay[key] = 0;
                    diapersByDay[key] = 0;
                    sleepByDay[key] = 0;
                    awakeByDay[key] = 0;
                    walkByDay[key] = 0;
                    volumeByDay[key] = 0;
                }

                // Раскладываем интервал по суткам, обрезая по полуночи.
                // Незакрытый таймер считаем до «сейчас».
                const addInterval = (startIso, endIso, bucket) => {
                    const start = new Date(startIso).getTime();
                    const end = endIso ? new Date(endIso).getTime() : Date.now();
                    if (!isFinite(start) || !isFinite(end) || end <= start) return;
                    let cursor = start;
                    let guard = 0;
                    while (cursor < end && guard++ < 400) {
                        const key = dayKeyOf(cursor);
                        const segEnd = Math.min(end, dayStartOf(key) + 86400000);
                        if (bucket[key] !== undefined) bucket[key] += (segEnd - cursor) / 3600000;
                        cursor = segEnd;
                    }
                };

                // Считаем графики по дням
                events.forEach(e => {
                    if (!e || !e.start_time) return;
                    if (e.event_type === 'feed') {
                        const key = dayKeyOf(new Date(e.start_time).getTime());
                        if (feedsByDay[key] !== undefined) {
                            feedsByDay[key]++;
                            const ml = parseInt(e.details);
                            if (!isNaN(ml)) volumeByDay[key] += ml;
                        }
                    } else if (e.event_type === 'diaper') {
                        const key = dayKeyOf(new Date(e.start_time).getTime());
                        if (diapersByDay[key] !== undefined) diapersByDay[key]++;
                    } else if (e.event_type === 'sleep') {
                        addInterval(e.start_time, e.end_time, sleepByDay);
                    } else if (e.event_type === 'awake') {
                        addInterval(e.start_time, e.end_time, awakeByDay);
                    } else if (e.event_type === 'walk') {
                        addInterval(e.start_time, e.end_time, walkByDay);
                    }
                });

                // Карточки за сегодня берём из тех же корзин — цифры совпадают с графиком
                const todayKey = dayKeyOf(Date.now());
                document.getElementById('stat-feeds').textContent = feedsByDay[todayKey] || 0;
                document.getElementById('stat-sleep').textContent = formatDuration((sleepByDay[todayKey] || 0) * 3600000);
                document.getElementById('stat-volume').textContent = volumeByDay[todayKey] || 0;

                await loadChartLib();
                renderCharts(days, feedsByDay, diapersByDay, sleepByDay, awakeByDay, walkByDay, volumeByDay);

            } catch(e) { console.error("Ошибка статистики", e); toast("Не удалось загрузить статистику", true); }
        }

        // Chart.js (210 КБ) грузим только при первом открытии статистики
        let chartLibPromise = null;
        function loadChartLib() {
            if (typeof Chart !== 'undefined') return Promise.resolve();
            if (!chartLibPromise) {
                chartLibPromise = new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'chart.js';
                    script.onload = () => resolve();
                    script.onerror = () => { chartLibPromise = null; reject(new Error('chart.js не загрузился')); };
                    (document.head || document.body).appendChild(script);
                });
            }
            return chartLibPromise;
        }

        function renderCharts(labels, feeds, diapers, sleep, awake, walk, volume) {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const textColor = isDark ? '#F3F4F6' : '#111827';
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

            const commonOptions = {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: textColor, font: {family: 'Nunito', size: 12, weight: 'bold'} } } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor, font: {family: 'Nunito'} } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, font: {family: 'Nunito'} }, beginAtZero: true }
                }
            };

            if (chartFeeds) chartFeeds.destroy();
            if (chartSleep) chartSleep.destroy();

            const ctx1 = document.getElementById('chart-feeds').getContext('2d');
            chartFeeds = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Кормления', data: Object.values(feeds), backgroundColor: isDark ? '#7F1D1D' : '#FCA5A5', borderRadius: 6 },
                        { label: 'Подгузники', data: Object.values(diapers), backgroundColor: isDark ? '#1E3A8A' : '#93C5FD', borderRadius: 6 }
                    ]
                },
                options: commonOptions
            });

            // График 2: Суточный цикл (Столбчатая диаграмма с накоплением)
            const ctx2 = document.getElementById('chart-sleep').getContext('2d');
            chartSleep = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Сон', data: Object.values(sleep).map(v => v.toFixed(1)), backgroundColor: '#3b82f6', borderRadius: 4, stack: 'Stack 0' },
                        { label: 'Бодрствует', data: Object.values(awake).map(v => v.toFixed(1)), backgroundColor: '#fcd34d', borderRadius: 4, stack: 'Stack 0' },
                        { label: 'Гуляет', data: Object.values(walk).map(v => v.toFixed(1)), backgroundColor: '#10b981', borderRadius: 4, stack: 'Stack 0' }
                    ]
                },
                options: {
                    ...commonOptions,
                    scales: { 
                        x: commonOptions.scales.x, 
                        y: { ...commonOptions.scales.y, stacked: true } 
                    }
                }
            });

            // График 3: Объем смеси
            const ctx3 = document.getElementById('chart-volume').getContext('2d');
            if (window.chartVolume) window.chartVolume.destroy();
            window.chartVolume = new Chart(ctx3, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Выпито (мл)',
                        data: Object.values(volume),
                        backgroundColor: isDark ? '#7F1D1D' : '#FCA5A5',
                        borderRadius: 6
                    }]
                },
                options: commonOptions
            });
        }

        // --- WEB PUSH ---

        // Проверяем подписку при запуске: если она уже есть — прячем кнопку
        // и тихо пересылаем её на сервер (после перезапуска приложения).
        async function initPushState() {
            const btn = document.getElementById('push-btn');
            if (!btn) return;
            try {
                if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
                if (!('Notification' in window) || Notification.permission !== 'granted') return;
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (!sub) return;
                try {
                    await fetch(`${API_URL}/subscribe`, {
                        method: 'POST',
                        headers: apiHeaders(true),
                        body: JSON.stringify(sub)
                    });
                } catch (e) {}
                btn.style.display = 'none';
            } catch (e) {}
        }

        async function subscribePush() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                toast("Push не поддерживается. На iPhone добавьте сайт на экран «Домой».", true);
                return;
            }
            try {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') { toast("Уведомления отклонены", true); return; }

                const res = await fetch(`${API_URL}/vapid-public-key`, { headers: apiHeaders() });
                const { publicKey } = await res.json();
                
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey)
                });

                await fetch(`${API_URL}/subscribe`, {
                    method: 'POST',
                    headers: apiHeaders(true),
                    body: JSON.stringify(subscription)
                });

                toast("✅ Уведомления включены!");
                document.getElementById('push-btn').style.display = 'none';
            } catch (e) {
                console.error(e);
                toast("Ошибка включения уведомлений", true);
            }
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
            return outputArray;
        }

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/baby/sw.js')
                    .then(reg => console.log('✅ SW зарегистрирован:', reg.scope))
                    .catch(err => console.error('❌ Ошибка SW:', err));
            });
        }

        
        // --- КАЛЕНДАРЬ ---
        function openAppModal() { 
            document.getElementById('app-modal').style.display = 'flex'; 
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            document.getElementById('app-date').value = now.toISOString().slice(0,16);
        }
        function closeAppModal(e) { if (!e || e.target.id === 'app-modal') document.getElementById('app-modal').style.display = 'none'; }
        
        async function saveAppointment() {
            const title = document.getElementById('app-title').value;
            const dateTime = document.getElementById('app-date').value;
            const notes = document.getElementById('app-notes').value;
            if (!title || !dateTime) { toast("Заполните название и дату", true); return; }
            await fetch(`${API_URL}/appointments`, {
                method: 'POST',
                headers: apiHeaders(true),
                body: JSON.stringify({ title: title, date_time: dateTime, notes: notes })
            });
            closeAppModal();
            document.getElementById('app-title').value = '';
            document.getElementById('app-notes').value = '';
            loadAppointments();
        }

        async function loadAppointments() {
            try {
                const res = await fetch(`${API_URL}/appointments`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                let apps = await res.json();
                if (!Array.isArray(apps)) apps = [];
                window.__lastAppointments = apps;
                const list = document.getElementById('app-list');
                list.innerHTML = '';
                if (apps.length === 0) {
                    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Нет записей. Добавьте первую!</div>';
                    return;
                }
                apps.forEach(a => {
                    const dt = new Date(a.date_time);
                    const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    list.innerHTML += `
                        <div class="log-item">
                            <div class="log-left">
                                <div class="log-icon">🏥</div>
                                <div class="log-name">${esc(a.title)}<br><span class="log-sub">${esc(dateStr)} в ${esc(timeStr)} ${a.notes ? '· ' + esc(a.notes) : ''}</span></div>
                            </div>
                            <div class="log-right">
                                <button class="btn-delete" onclick="deleteAppointment(${a.id})">✕</button>
                            </div>
                        </div>
                    `;
                });
            } catch(e) { console.error("Ошибка календаря", e); }
        }

        async function deleteAppointment(id) {
            if (!confirm("Удалить эту запись?")) return;
            await fetch(`${API_URL}/appointments/${id}`, { method: 'DELETE', headers: apiHeaders() });
            loadAppointments();
        }

        document.getElementById('log-list').addEventListener('click', (ev) => {
            const monthBtn = ev.target.closest('.month-toggle');
            if (monthBtn) {
                const monthSection = monthBtn.closest('.month-section');
                const willOpenMonth = !monthSection.classList.contains('open');
                monthSection.classList.toggle('open', willOpenMonth);
                monthBtn.setAttribute('aria-expanded', String(willOpenMonth));
                if (willOpenMonth) expandedMonths.add(monthBtn.dataset.month);
                else expandedMonths.delete(monthBtn.dataset.month);
                return;
            }
            const btn = ev.target.closest('.day-toggle');
            if (!btn) return;
            const section = btn.closest('.day-section');
            const willOpen = !section.classList.contains('open');
            section.classList.toggle('open', willOpen);
            btn.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) expandedDays.add(btn.dataset.day);
            else expandedDays.delete(btn.dataset.day);
        });


        // ===== АНАЛИТИКА =====
        let analyticsDays = 7;
        let analyticsEvents = [];
        const anCharts = { cycle: null, hours: null };

        const isoDay = (value) => new Date(value).toLocaleDateString('sv-SE', { timeZone: tz() });

        function setPeriod(days, btn) {
            analyticsDays = days;
            document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
            if (btn) btn.classList.add('active');
            loadAnalytics();
        }

        async function loadAnalytics() {
            try {
                const res = await fetch(`${API_URL}/events/history?days=${analyticsDays}`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                const events = await res.json();
                analyticsEvents = Array.isArray(events) ? events : [];
                mergeIntoCache(analyticsEvents);
                await renderAnalytics();
            } catch (e) {
                console.error('Аналитика:', e);
                toast('Не удалось загрузить аналитику', true);
            }
        }

        async function renderAnalytics() {
            const days = analyticsDays;
            const today = new Date();
            const daysList = [];
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                daysList.push(isoDay(d));
            }

            const byDay = {};
            const rows = daysList.map((k) => {
                const row = { day: k, feeds: 0, volume: 0, diapers: 0, sleep: 0, awake: 0, walk: 0 };
                byDay[k] = row;
                return row;
            });
            const hours = new Array(24).fill(0);

            analyticsEvents.forEach((e) => {
                const row = byDay[isoDay(e.start_time)];
                if (!row) return;
                if (e.event_type === 'feed') {
                    row.feeds += 1;
                    const ml = parseInt(e.details, 10);
                    if (!isNaN(ml)) row.volume += ml;
                    const hour = parseInt(new Date(e.start_time).toLocaleString('ru-RU', {
                        timeZone: tz(), hour: '2-digit', hour12: false
                    }), 10);
                    if (hour >= 0 && hour < 24) hours[hour] += 1;
                } else if (e.event_type === 'diaper') {
                    row.diapers += 1;
                } else if (e.end_time && (e.event_type === 'sleep' || e.event_type === 'awake' || e.event_type === 'walk')) {
                    row[e.event_type] += (new Date(e.end_time) - new Date(e.start_time)) / 3600000;
                }
            });

            const total = (key) => rows.reduce((a, r) => a + r[key], 0);
            const perDay = (key) => (days ? total(key) / days : 0);

            document.getElementById('an-feeds').textContent = perDay('feeds').toFixed(1);
            document.getElementById('an-volume').textContent = Math.round(perDay('volume'));
            document.getElementById('an-sleep').textContent = perDay('sleep').toFixed(1) + 'ч';
            document.getElementById('an-awake').textContent = perDay('awake').toFixed(1) + 'ч';
            document.getElementById('an-walk').textContent = perDay('walk').toFixed(1) + 'ч';
            document.getElementById('an-diapers').textContent = perDay('diapers').toFixed(1);

            try { await loadChartLib(); } catch (e) { return; }

            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const textColor = isDark ? '#F3F4F6' : '#111827';
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            const baseOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: textColor, font: { family: 'Nunito', size: 11, weight: 'bold' } } } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Nunito', size: 10 } } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Nunito', size: 10 } }, beginAtZero: true }
                }
            };

            const labels = rows.map((r) => r.day.slice(8, 10) + '.' + r.day.slice(5, 7));

            if (anCharts.cycle) anCharts.cycle.destroy();
            anCharts.cycle = new Chart(document.getElementById('an-chart-cycle'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Сон', data: rows.map((r) => +r.sleep.toFixed(2)), backgroundColor: '#3b82f6', stack: 'cycle', borderRadius: 4 },
                        { label: 'Бодрствует', data: rows.map((r) => +r.awake.toFixed(2)), backgroundColor: '#fcd34d', stack: 'cycle', borderRadius: 4 },
                        { label: 'Гуляет', data: rows.map((r) => +r.walk.toFixed(2)), backgroundColor: '#10b981', stack: 'cycle', borderRadius: 4 }
                    ]
                },
                options: Object.assign({}, baseOptions, {
                    scales: { x: baseOptions.scales.x, y: Object.assign({}, baseOptions.scales.y, { stacked: true }) }
                })
            });

            if (anCharts.hours) anCharts.hours.destroy();
            anCharts.hours = new Chart(document.getElementById('an-chart-hours'), {
                type: 'bar',
                data: {
                    labels: hours.map((_, i) => String(i).padStart(2, '0')),
                    datasets: [{ label: 'Кормлений', data: hours, backgroundColor: '#FCA5A5', borderRadius: 4 }]
                },
                options: baseOptions
            });
        }

        // ===== PDF-ОТЧЁТ ДЛЯ ВРАЧА =====
        function loadScriptOnce(src) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Не загрузилось: ' + src));
                (document.head || document.body).appendChild(script);
            });
        }

        async function openDoctorReport() {
            if (!(await ensurePremium())) {
                toast('Отчёт для врача — в Премиуме 🔒', true);
                openProfile();
                return;
            }
            window.open('/baby/report.html', '_blank');
        }


        // Реферальная ссылка: ?ref=CODE
        (function captureRef() {
            try {
                const params = new URLSearchParams(location.search);
                const ref = params.get('ref');
                if (ref) {
                    localStorage.setItem('lad_ref', ref);
                    params.delete('ref');
                    const q = params.toString();
                    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
                }
            } catch (e) {}
        })();

        const LAD_TOKEN_KEY = 'lad_token';

        function ladToken() {
            try { return localStorage.getItem(LAD_TOKEN_KEY) || ''; } catch (e) { return ''; }
        }

        function ladStatus(text) {
            ['profile-status', 'login-status'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.textContent = text || '';
            });
        }


        // ===== ВХОД И РЕГИСТРАЦИЯ ПО ЛОГИНУ (основной способ) =====

        function gateTab(tab) {
            const loginBox = document.getElementById('gate-login');
            const regBox = document.getElementById('gate-register');
            const codeBox = document.getElementById('gate-code');
            if (loginBox) loginBox.style.display = tab === 'login' ? 'block' : 'none';
            if (regBox) regBox.style.display = tab === 'register' ? 'block' : 'none';
            if (codeBox) codeBox.style.display = tab === 'code' ? 'block' : 'none';
            document.querySelectorAll('#gate-tabs button').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-auth') === tab);
            });
        }

        function openLoginGate() {
            const gate = document.getElementById('login-gate');
            if (gate) gate.style.display = 'flex';
            if (typeof closeProfileModal === 'function') closeProfileModal();
        }

        function setAuthTab(tab) {
            const loginBox = document.getElementById('auth-login');
            const regBox = document.getElementById('auth-register');
            if (loginBox) loginBox.style.display = tab === 'register' ? 'none' : 'block';
            if (regBox) regBox.style.display = tab === 'register' ? 'block' : 'none';
            document.querySelectorAll('#auth-tabs button').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-auth') === tab);
            });
            const st = document.getElementById('auth-status');
            if (st) st.textContent = '';
        }

        function authNotice(el, text) {
            if (el) el.textContent = text;
        }


        async function authCodeLogin() {
            const input = document.getElementById('auth-code');
            const st = document.getElementById('auth-code-status');
            const code = ((input && input.value) || '').trim();
            if (!code) { if (st) st.textContent = 'Введите код'; return; }
            if (st) st.textContent = 'Проверяю…';
            try {
                const res = await fetch(`${API_URL}/auth/code`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: code })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(d.detail || 'Код не подошёл');
                localStorage.setItem(LAD_TOKEN_KEY, d.token);
                location.reload();
            } catch (e) {
                const msg = (e && e.message) || '';
                if (st) st.textContent = msg === 'Failed to fetch'
                    ? 'Нет связи с сервером — проверьте интернет или VPN'
                    : (msg || 'Ошибка');
            }
        }

        async function authLogin() {
            const login = (document.getElementById('auth-login-name').value || '').trim();
            const pass = document.getElementById('auth-login-pass').value || '';
            const st = document.getElementById('auth-status');
            if (!login || !pass) { authNotice(st, 'Заполните логин и пароль'); return; }
            authNotice(st, 'Вхожу…');
            try {
                const res = await fetch(`${API_URL}/auth/password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: login, password: pass })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(d.detail || 'Не удалось войти');
                localStorage.setItem(LAD_TOKEN_KEY, d.token);
                authNotice(st, 'Готово');
                location.reload();
            } catch (e) {
                const msg = (e && e.message) || '';
                authNotice(st, msg === 'Failed to fetch'
                    ? 'Нет связи с сервером — проверьте интернет или VPN'
                    : (msg || 'Ошибка входа'));
            }
        }

        async function authRegister() {
            const name = (document.getElementById('auth-reg-name').value || '').trim();
            const login = (document.getElementById('auth-reg-login').value || '').trim();
            const pass = document.getElementById('auth-reg-pass').value || '';
            const consent = document.getElementById('auth-consent');
            const st = document.getElementById('auth-reg-status');
            if (!login || !pass) { authNotice(st, 'Заполните логин и пароль'); return; }
            if (!consent || !consent.checked) { authNotice(st, 'Нужно согласие на обработку данных'); return; }
            authNotice(st, 'Создаю аккаунт…');
            try {
                const res = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        login: login, password: pass, name: name, consent_version: '2026-11',
                        ref: (function () { try { return localStorage.getItem('lad_ref') || ''; } catch (e) { return ''; } })()
                    })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(d.detail || 'Не удалось зарегистрироваться');
                localStorage.setItem(LAD_TOKEN_KEY, d.token);
                if (d.personal_code) {
                    document.getElementById('gate-tabs').style.display = 'none';
                    document.getElementById('gate-login').style.display = 'none';
                    document.getElementById('gate-register').style.display = 'none';
                    const codeBox = document.getElementById('gate-code');
                    if (codeBox) codeBox.style.display = 'none';
                    document.getElementById('code-value').textContent = d.personal_code;
                    document.getElementById('gate-code-done').style.display = 'block';
                } else {
                    location.reload();
                }
            } catch (e) {
                const msg = (e && e.message) || '';
                authNotice(st, msg === 'Failed to fetch'
                    ? 'Нет связи с сервером — проверьте интернет или VPN'
                    : (msg || 'Ошибка регистрации'));
            }
        }

        async function prepareTelegramLogin(force) {
            if (ladLoginUrl && !force) return;
            try {
                ladStatus('Готовлю ссылку…');
                const res = await fetch(`${API_URL}/auth/start`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                ladLoginCode = data.code;
                ladLoginUrl = data.url;
                try { localStorage.setItem('lad_login_code', data.code); } catch (e) {}
                const link = document.getElementById('tg-login-btn');
                if (link) link.href = data.url;
                ladStatus('');
            } catch (e) {
                ladStatus('Не получилось: ' + e.message);
            }
        }

        function onLoginClick(e) {
            if (!ladLoginUrl) {
                // Ссылки ещё нет — готовим и открываем после ответа.
                if (e) e.preventDefault();
                prepareTelegramLogin(true).then(function () {
                    if (ladLoginUrl) {
                        startLoginPolling();
                        window.location.href = ladLoginUrl;
                    }
                });
                return true;
            }
            startLoginPolling();
            return true;
        }

        function startLoginPolling() {
            ladStatus('Нажмите «Start» в боте — вход подтвердится сам.');
            pollTelegramLogin();
        }

        async function pollTelegramLogin() {
            if (!ladLoginCode) return;
            clearTimeout(ladPollTimer);
            try {
                const res = await fetch(`${API_URL}/auth/poll?code=${encodeURIComponent(ladLoginCode)}`);
                if (res.status === 202) {
                    ladPollTimer = setTimeout(pollTelegramLogin, 2000);
                    return;
                }
                const data = await res.json().catch(function () { return {}; });
                if (res.ok && data.token) {
                    try { localStorage.setItem(LAD_TOKEN_KEY, data.token); } catch (e) {}
                    ladLoginCode = null;
                    try { localStorage.removeItem('lad_login_code'); } catch (e) {}
                    ladStatus('');
                    if (gateVisible()) { location.reload(); return; }
                    toast('Вы вошли: ' + ((data.user && data.user.name) || 'родитель'));
                    loadProfile();
                    return;
                }
                if (res.status === 410) {
                    ladLoginCode = null;
                    try { localStorage.removeItem('lad_login_code'); } catch (e) {}
                    ladStatus('Ссылка уже использована. Попробуйте войти снова.');
                    return;
                }
                throw new Error(data.detail || ('HTTP ' + res.status));
            } catch (e) {
                ladPollTimer = setTimeout(pollTelegramLogin, 3000);
            }
        }

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && ladLoginCode) pollTelegramLogin();
        });

        function openProfile() {
            if (typeof moveChildrenToSettings === 'function') moveChildrenToSettings();
            document.getElementById('profile-modal').style.display = 'flex';
            const done = loadProfile().then(function () {
                if (typeof updateAppTitle === 'function') updateAppTitle();
            });
            loadNotifyPrefs();
            return done;
        }

        function closeProfileModal(e) {
            if (!e || e.target.id === 'profile-modal') {
                document.getElementById('profile-modal').style.display = 'none';
            }
        }

        function toggleProfileSection(name) {
            const target = document.querySelector('#profile-me .p-acc[data-pacc="' + name + '"]');
            if (!target) return;
            const willOpen = !target.classList.contains('open');
            document.querySelectorAll('#profile-me .p-acc').forEach(function (acc) {
                acc.classList.remove('open');
            });
            if (willOpen) target.classList.add('open');
        }

        function openProfileSectionFor(el) {
            if (!el || !el.closest) return;
            const acc = el.closest('.p-acc');
            if (!acc) return;
            document.querySelectorAll('#profile-me .p-acc').forEach(function (item) {
                item.classList.remove('open');
            });
            acc.classList.add('open');
        }

        function moveChildrenToSettings() {
            if (!document.documentElement.classList.contains('min-ui')) return;
            const box = document.getElementById('children-box');
            const settingsBody = document.querySelector('#profile-me .p-acc[data-pacc="settings"] .p-acc-body');
            if (box && settingsBody && box.parentElement !== settingsBody) {
                settingsBody.insertBefore(box, settingsBody.firstChild);
            }
        }

        function moveTodayCard() {
            if (!document.documentElement.classList.contains('min-ui')) return;
            const card = document.getElementById('today-card');
            const grid = document.querySelector('#view-tracker .grid');
            if (card && grid && grid.nextElementSibling !== card) {
                grid.parentNode.insertBefore(card, grid.nextSibling);
            }
        }


        async function showMyCode() {
            try {
                const res = await fetch(`${API_URL}/auth/code/issue`, {
                    method: 'POST',
                    headers: apiHeaders()
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok || !d.personal_code) throw new Error(d.detail || 'Не удалось получить код');
                document.getElementById('code-modal-value').textContent = d.personal_code;
                document.getElementById('code-modal').style.display = 'flex';
            } catch (e) {
                toast(e.message === 'Failed to fetch' ? 'Нет связи с сервером' : e.message, true);
            }
        }

        function closeCodeModal() {
            const m = document.getElementById('code-modal');
            if (m) m.style.display = 'none';
        }

        async function loadProfile() {
            const login = document.getElementById('profile-login');
            const me = document.getElementById('profile-me');
            const token = ladToken();
            if (!token) {
                login.style.display = 'block';
                me.style.display = 'none';
                prepareTelegramLogin();
                return;
            }
            try {
                const res = await fetch(`${API_URL}/me`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                renderProfile(await res.json());
                login.style.display = 'none';
                me.style.display = 'block';
            } catch (e) {
                const msg = (e && e.message) || '';
                const status = msg.indexOf('HTTP ') === 0 ? parseInt(msg.slice(5), 10) : 0;
                if (status === 401) {
                    // токен правда просрочен — только тогда разлогиниваем
                    try { localStorage.removeItem(LAD_TOKEN_KEY); } catch (err) {}
                    login.style.display = 'block';
                    me.style.display = 'none';
                    return;
                }
                // Сеть, VPN, таймаут — токен НЕ трогаем, иначе выкидывает при каждом сбое.
                const st = document.getElementById('profile-status');
                if (st) st.textContent = 'Нет связи с сервером — проверьте интернет или VPN';
                if (ladProfile) {
                    login.style.display = 'none';
                    me.style.display = 'block';
                } else {
                    login.style.display = 'block';
                    me.style.display = 'none';
                }
            }
        }

        let ladProfile = null;
        let childGender = 'girl';
        let familyPremium = null;

        async function ensurePremium() {
            if (familyPremium !== null) return familyPremium;
            let cached = null;
            try {
                const saved = localStorage.getItem('lad_premium');
                if (saved === '1' || saved === '0') cached = saved === '1';
            } catch (e) {}
            try {
                if (!ladToken() && !apiToken()) { familyPremium = false; return false; }
                const res = await fetch(`${API_URL}/billing/status`, {
                    headers: apiHeaders()
                });
                const d = await res.json().catch(function () { return {}; });
                familyPremium = !!d.active;
                try { localStorage.setItem('lad_premium', familyPremium ? '1' : '0'); } catch (e) {}
            } catch (e) {
                familyPremium = cached === true;
            }
            return familyPremium;
        }

        function g(female, male) { return childGender === 'boy' ? male : female; }

        function quickDiaper(kind) {
            quickEvent('diaper', kind === 'poop' ? g('Покакала', 'Покакал') : g('Пописала', 'Пописал'));
        }

        function applyGenderLabels() {
            const poop = document.getElementById('label-poop');
            const pee = document.getElementById('label-pee');
            if (poop) poop.textContent = g('Покакала', 'Покакал');
            if (pee) pee.textContent = g('Пописала', 'Пописал');
        }



        function activeChildId() {
            try { return parseInt(localStorage.getItem('lad_child') || '0', 10) || 0; } catch (e) { return 0; }
        }

        function renderChildren(children) {
            const box = document.getElementById('children-list');
            if (!box) return;
            box.innerHTML = '';
            if (!children || !children.length) return;
            let active = activeChildId();
            if (!active || !children.some(function (c) { return c.id === active; })) {
                active = children[0].id;
                try { localStorage.setItem('lad_child', String(active)); } catch (e) {}
            }
            children.forEach(function (c) {
                const chip = document.createElement('button');
                chip.className = 'sleep-chip' + (c.id === active ? ' active' : '');
                chip.textContent = (c.id === active ? '✓ ' : '') + (c.name || 'Малыш');
                chip.onclick = function () {
                    try { localStorage.setItem('lad_child', String(c.id)); } catch (e) {}
                    location.reload();
                };
                box.appendChild(chip);
            });
        }

        async function addChild() {
            const st = document.getElementById('child-add-status');
            if (!(await ensurePremium())) {
                toast('Несколько детей — в Премиуме 🔒', true);
                if (st) st.textContent = 'Доступно в Премиуме';
                return;
            }
            const name = prompt('Имя ребёнка');
            if (!name) return;
            if (st) st.textContent = 'Добавляю…';
            try {
                const res = await fetch(`${API_URL}/child`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ladToken() },
                    body: JSON.stringify({ name: name })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(d.detail || 'Не удалось');
                try { localStorage.setItem('lad_child', String(d.id)); } catch (e) {}
                if (st) st.textContent = 'Готово';
                location.reload();
            } catch (e) {
                if (st) st.textContent = e.message || 'Ошибка';
            }
        }


        // ===== НАПОМИНАНИЯ =====
        async function loadReminders() {
            try {
                const res = await fetch(`${API_URL}/reminders`, { headers: apiHeaders() });
                if (!res.ok) return;
                const d = await res.json();
                if (d.feed_hours) document.getElementById('rem-feed').value = d.feed_hours;
                if (d.diaper_hours) document.getElementById('rem-diaper').value = d.diaper_hours;
                const st = document.getElementById('rem-status');
                if (st) st.textContent = d.premium ? '' : 'Настройка интервалов — в Премиуме';
            } catch (e) {}
        }

        async function saveReminders() {
            const st = document.getElementById('rem-status');
            if (!(await ensurePremium())) {
                toast('Настройка напоминаний — в Премиуме 🔒', true);
                if (st) st.textContent = 'Доступно в Премиуме';
                return;
            }
            const feed = parseFloat(document.getElementById('rem-feed').value) || 3.5;
            const diaper = parseFloat(document.getElementById('rem-diaper').value) || 3;
            if (st) st.textContent = 'Сохраняю…';
            try {
                const res = await fetch(`${API_URL}/reminders`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ladToken() },
                    body: JSON.stringify({ feed_hours: feed, diaper_hours: diaper })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(d.detail || 'Не удалось сохранить');
                if (st) st.textContent = 'Сохранено ✅';
            } catch (e) {
                if (st) st.textContent = e.message || 'Ошибка';
            }
        }

        function setTzPref(value) {
            try { localStorage.setItem(TZ_KEY, value); } catch (e) {}
            const st = document.getElementById('settings-status');
            if (st) {
                st.textContent = 'Часовой пояс: ' + (value === 'auto' ? 'как на устройстве' : value);
                setTimeout(function () { st.textContent = ''; }, 2500);
            }
            if (typeof loadEvents === 'function') loadEvents();
        }

        function initSettingsUi() {
            document.querySelectorAll('#theme-seg button').forEach(function (b) {
                b.onclick = function () { setThemePref(b.getAttribute('data-theme-pref')); };
            });
            const sel = document.getElementById('tz-select');
            if (sel) {
                const pref = tzPref();
                if (!sel.querySelector('option[value="' + pref + '"]')) {
                    const opt = document.createElement('option');
                    opt.value = pref; opt.textContent = pref;
                    sel.appendChild(opt);
                }
                sel.value = pref;
                sel.onchange = function () {
                    try { localStorage.setItem(TZ_KEY, sel.value); } catch (e) {}
                    const st = document.getElementById('settings-status');
                    if (st) {
                        st.textContent = 'Часовой пояс: ' + (sel.value === 'auto' ? 'как на устройстве' : sel.value);
                        setTimeout(function () { st.textContent = ''; }, 2500);
                    }
                    if (typeof loadEvents === 'function') loadEvents();
                };
            }
            applyTheme();
        }

        function renderProfile(data) {
            ladProfile = data;
            loadBilling();
            const childForGender = (data.children || [])[0];
            if (childForGender && childForGender.gender) {
                childGender = childForGender.gender;
                applyGenderLabels();
            }
            const u = data.user || {};
            document.getElementById('profile-name').textContent = u.name || 'Родитель';
            document.getElementById('profile-sub').textContent = u.username ? '@' + u.username : 'Telegram';
            document.getElementById('profile-family').textContent = (data.family && data.family.name) || '—';
            const child = data.children && data.children[0];
            document.getElementById('profile-child').textContent = (child && child.name) || '—';
            renderChildren(data.children || []);
            document.getElementById('profile-events').textContent = (data.stats && data.stats.events) || 0;
            const membersBox = document.getElementById('profile-members');
            if (membersBox) {
                membersBox.innerHTML = '';
                (data.members || []).forEach(function (m) {
                    const chip = document.createElement('span');
                    chip.className = 'member-chip';
                    chip.textContent = (m.first_name || 'Родитель') + (m.role === 'owner' ? ' · владелец' : '');
                    membersBox.appendChild(chip);
                });
                const btn = document.getElementById('invite-btn');
                const isOwner = (data.members || []).some(function (m) {
                    return m.id === u.id && m.role === 'owner';
                });
                if (btn) btn.style.display = isOwner ? '' : 'none';
            }
            const accFamilySub = document.getElementById('p-acc-family-sub');
            if (accFamilySub) {
                const names = (data.members || []).map(function (m) { return m.first_name; }).filter(Boolean);
                accFamilySub.textContent = names.length
                    ? names.slice(0, 2).join(' и ')
                    : ((data.family && data.family.name) || 'Семья');
            }

            const ava = document.getElementById('profile-ava');
            ava.innerHTML = '';
            if (u.photo_url) {
                const img = document.createElement('img');
                img.src = u.photo_url;
                img.alt = '';
                ava.appendChild(img);
            } else {
                ava.textContent = (u.name || '👤').trim().charAt(0).toUpperCase();
            }
            loadReferralStats();
        }

        function pickAvatar() {
            const inp = document.getElementById('avatar-input');
            if (inp) inp.click();
        }

        function onAvatarPicked(input) {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                const img = new Image();
                img.onload = function () {
                    const size = 256;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    const min = Math.min(img.width, img.height);
                    const sx = (img.width - min) / 2;
                    const sy = (img.height - min) / 2;
                    ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
                    saveAvatar(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
            input.value = '';
        }

        async function saveAvatar(dataUrl) {
            try {
                const res = await fetch(`${API_URL}/profile`, {
                    method: 'PATCH',
                    headers: apiHeaders(true),
                    body: JSON.stringify({ photo: dataUrl })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                toast('Фото обновлено');
                loadProfile();
            } catch (e) {
                toast('Не удалось сохранить фото', true);
            }
        }

        function logoutProfile() {
            try { localStorage.removeItem(LAD_TOKEN_KEY); } catch (e) {}
            toast('Вы вышли');
            loadProfile();
        }

        // Продолжаем ожидание входа, если страница перезагрузилась
        (function resumeLadLogin() {
            try {
                const saved = localStorage.getItem('lad_login_code');
                if (saved && !ladToken()) {
                    ladLoginCode = saved;
                    startLoginPolling();
                }
            } catch (e) {}
        })();

        // ===== ЭКРАН ВХОДА =====
        function gateVisible() {
            const gate = document.getElementById('login-gate');
            return !!gate && gate.style.display !== 'none';
        }

        function showLoginGate() {
            const gate = document.getElementById('login-gate');
            if (gate) gate.style.display = 'flex';
            try {
                const box = document.getElementById('consent-box');
                if (box && localStorage.getItem('lad_consent') === '1') box.checked = true;
            } catch (e) {}
        }

        function consentGiven() {
            const box = document.getElementById('consent-box');
            if (box && !box.checked) {
                document.getElementById('login-status').textContent = 'Подтвердите согласие с документами';
                return false;
            }
            try { localStorage.setItem('lad_consent', '1'); } catch (e) {}
            return true;
        }

        async function submitPasswordLogin() {
            if (!consentGiven()) return;
            const login = (document.getElementById('login-name').value || '').trim();
            const password = document.getElementById('login-pass').value || '';
            const status = document.getElementById('login-status');
            if (!login || !password) {
                status.textContent = 'Заполните логин и пароль';
                return;
            }
            status.textContent = 'Входим…';
            try {
                const res = await fetch(`${API_URL}/auth/password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: login, password: password })
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || !data.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                try { localStorage.setItem(LAD_TOKEN_KEY, data.token); } catch (e) {}
                location.reload();
            } catch (e) {
                status.textContent = e.message;
            }
        }

        async function gateTelegramLogin() {
            if (!consentGiven()) return;
            const status = document.getElementById('login-status');
            status.textContent = 'Открываю Telegram…';
            await prepareTelegramLogin(true);
            if (ladLoginUrl) {
                startLoginPolling();
                window.location.href = ladLoginUrl;
            } else {
                status.textContent = 'Не получилось получить ссылку';
            }
        }

        // Фиксируем согласие с политикой на сервере (один раз на версию)
        function sendConsentIfNeeded() {
            const token = ladToken();
            if (!token) return;
            let given = false;
            try { given = localStorage.getItem('lad_consent') === '1'; } catch (e) {}
            if (!given) return;
            const version = '2026-11-16';
            try { if (localStorage.getItem('lad_consent_sent') === version) return; } catch (e) {}
            fetch(`${API_URL}/account/consent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ version: version })
            }).then(function (res) {
                if (res.ok) {
                    try { localStorage.setItem('lad_consent_sent', version); } catch (e) {}
                }
            }).catch(function () {});
        }

        // ===== ПРИГЛАШЕНИЯ В СЕМЬЮ =====
        async function inviteParent() {
            const token = ladToken();
            const box = document.getElementById('invite-box');
            if (!token || !box) return;
            box.style.display = 'block';
            box.textContent = 'Готовлю ссылку…';
            try {
                const res = await fetch(`${API_URL}/family/invite`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || !data.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                box.innerHTML = '';
                const link = document.createElement('a');
                link.href = data.link;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = data.link;
                const copy = document.createElement('button');
                copy.className = 'pbtn';
                copy.textContent = 'Скопировать ссылку';
                copy.onclick = function () {
                    if (navigator.clipboard) navigator.clipboard.writeText(data.link);
                    toast('Ссылка скопирована');
                };
                box.appendChild(link);
                box.appendChild(copy);
            } catch (e) {
                box.textContent = 'Не получилось: ' + e.message;
            }
        }

        async function maybeJoinInvite() {
            const code = new URLSearchParams(location.search).get('invite');
            const token = ladToken();
            if (!code || !token) return;
            try {
                const res = await fetch(`${API_URL}/family/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ code: code })
                });
                const data = await res.json().catch(function () { return {}; });
                if (res.ok && data.ok) {
                    toast('Вы присоединились к семье');
                    history.replaceState(null, '', location.pathname);
                    setTimeout(function () { location.reload(); }, 900);
                } else if (res.status === 404) {
                    toast('Приглашение недействительно', true);
                    history.replaceState(null, '', location.pathname);
                }
            } catch (e) {}
        }

        
// ===== ОБРАТНАЯ СВЯЗЬ =====
function openFeedback() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const st = document.getElementById('feedback-status');
    if (st) st.textContent = '';
}

function closeFeedback(event) {
    if (event && event.target && event.target.id !== 'feedback-modal') return;
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.style.display = 'none';
}

async function sendFeedback() {
    const st = document.getElementById('feedback-status');
    const text = (document.getElementById('feedback-text').value || '').trim();
    const contact = (document.getElementById('feedback-contact').value || '').trim();
    if (text.length < 3) {
        if (st) st.textContent = 'Напишите хотя бы пару слов';
        return;
    }
    const token = ladToken();
    if (!token) {
        if (st) st.textContent = 'Нужно войти через Telegram';
        return;
    }
    if (st) st.textContent = 'Отправляю…';
    try {
        const res = await fetch(`${API_URL}/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ text: text, contact: contact })
        });
        const d = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            throw new Error(d.detail || 'Не удалось отправить');
        }
        document.getElementById('feedback-text').value = '';
        document.getElementById('feedback-contact').value = '';
        if (st) st.textContent = 'Спасибо! Сообщение отправлено ✅';
        setTimeout(closeFeedback, 1400);
    } catch (e) {
        if (st) st.textContent = e.message || 'Ошибка отправки';
    }
}

// ===== РЕБЁНОК =====
        function toggleChildEdit() {
            const box = document.getElementById('child-edit');
            if (!box) return;
            const show = box.style.display === 'none';
            box.style.display = show ? 'flex' : 'none';
            if (show && ladProfile) {
                const child = (ladProfile.children || [])[0] || {};
                document.getElementById('child-name').value = child.name || '';
                document.getElementById('child-birth').value = child.birth_date || '';
                const gsel = document.getElementById('child-gender');
                if (gsel) gsel.value = child.gender || 'girl';
                document.getElementById('child-status').textContent = '';
            }
        }

        async function saveChild() {
            const token = ladToken();
            const status = document.getElementById('child-status');
            const name = (document.getElementById('child-name').value || '').trim();
            const birth = document.getElementById('child-birth').value || '';
            if (!ladProfile || !ladProfile.children || !ladProfile.children.length) {
                status.textContent = 'Ребёнок не найден';
                return;
            }
            if (!name) {
                status.textContent = 'Введите имя';
                return;
            }
            const childId = ladProfile.children[0].id;
            status.textContent = 'Сохраняю…';
            try {
                const res = await fetch(`${API_URL}/child/${childId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ name: name, birth_date: birth,
                        gender: (document.getElementById('child-gender') || {}).value || 'girl' })
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || !data.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                status.textContent = '';
                document.getElementById('child-edit').style.display = 'none';
                toast('Сохранено');
                loadProfile();
            } catch (e) {
                status.textContent = e.message;
            }
        }

        // Пол ребёнка нужен и на трекере, не только в профиле
        async function loadChildGender() {
            const token = ladToken();
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/me`, { headers: { 'Authorization': 'Bearer ' + token } });
                const data = await res.json();
                const child = (data.children || [])[0];
                if (child && child.gender) {
                    childGender = child.gender;
                    applyGenderLabels();
                }
            } catch (e) {}
        }

        // Перепривязываем существующую подписку к аккаунту (user_id, семья)
        async function refreshPushSubscription() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
            try {
                if (Notification.permission !== 'granted') return;
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                if (!subscription) return;
                await fetch(`${API_URL}/subscribe`, {
                    method: 'POST',
                    headers: apiHeaders(true),
                    body: JSON.stringify(subscription)
                });
            } catch (e) {}
        }

        function syncFilterUi() {
            document.querySelectorAll('#log-chips .chip').forEach(function (c) {
                c.classList.toggle('active', c.getAttribute('data-f') === logFilter);
            });
        }

        (function initLogFilters() {
            const chips = document.getElementById('log-chips');
            if (chips) {
                chips.addEventListener('click', function (ev) {
                    const btn = ev.target.closest('.chip');
                    if (!btn) return;
                    logFilter = btn.getAttribute('data-f') || 'all';
                    try { localStorage.setItem(LOG_FILTER_KEY, logFilter); } catch (e) {}
                    syncFilterUi();
                    loadEvents();
                });
            }
            syncFilterUi();
        })();

        if (ladToken() || apiToken()) {
            refreshPushSubscription();
            loadBilling();
            loadChildGender();
            maybeJoinInvite();
            sendConsentIfNeeded();
            loadEvents();
            loadAppointments();
            renderStatus();
        } else {
            showLoginGate();
        }
        flushQueue();
        if (!apiToken() && !ladToken()) {
            setTimeout(openTokenModal, 600);
        }
        setInterval(() => { if (document.visibilityState === 'visible') loadEvents(); }, 30000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadEvents(); });



        // ===== ВЕХИ =====
        let healthMilestones = [];
        let growthRangeMonths = 0;

        function msAge(dateStr) {
            try {
                const child = (typeof ladProfile !== 'undefined' && ladProfile && ladProfile.children && ladProfile.children[0]) || null;
                if (!child || !child.birth_date) return '';
                const birth = new Date(child.birth_date + 'T12:00:00');
                const d = new Date(dateStr + 'T12:00:00');
                if (isNaN(birth) || isNaN(d)) return '';
                let months = (d.getFullYear() - birth.getFullYear()) * 12 + (d.getMonth() - birth.getMonth());
                if (d.getDate() < birth.getDate()) months -= 1;
                if (months < 0) return '';
                if (months < 1) {
                    const days = Math.max(0, Math.round((d - birth) / 86400000));
                    return days + ' дн.';
                }
                return months + ' мес.';
            } catch (e) { return ''; }
        }

        async function loadMilestones() {
            try {
                const cid = (typeof activeChildId === 'function' && activeChildId()) ? activeChildId() : 0;
                const res = await fetch(`${API_URL}/milestones?child_id=${cid}`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                healthMilestones = await res.json();
                if (!Array.isArray(healthMilestones)) healthMilestones = [];
                renderMilestones();
            } catch (e) {}
        }

        function renderMilestones() {
            const list = document.getElementById('milestone-list');
            if (!list) return;
            const items = (healthMilestones || []).slice().reverse();
            if (!items.length) {
                list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px 2px">' +
                    'Пока пусто. Отметь первое событие — оно останется здесь навсегда.</div>';
                return;
            }
            list.innerHTML = items.map(function (m) {
                const age = msAge(m.date);
                const thumb = m.photo
                    ? '<img class="ms-thumb" src="' + m.photo + '" alt="" onclick="event.stopPropagation();viewPhoto(this.src)">'
                    : '';
                return '<div class="ms-row" onclick="openMilestoneModal(\'' + esc(m.title).replace(/'/g, '') + '\',' + m.id + ')">' +
                    thumb +
                    '<div><b>' + esc(m.title) + '</b><div class="d" style="color:var(--muted);font-size:12px">' +
                    gFmtDate(m.date) + (m.note ? ' · ' + esc(m.note) : '') + '</div></div>' +
                    '<span class="ms-age">' + age + '</span>' +
                    '<button class="del" onclick="event.stopPropagation();deleteMilestone(' + m.id + ')">✕</button></div>';
            }).join('');
        }


        let pendingMilestonePhoto = '';

        function showMilestonePhoto(path) {
            const prev = document.getElementById('ms-photo-prev');
            const img = document.getElementById('ms-photo-img');
            if (prev && img) {
                if (path) { img.src = path; prev.style.display = 'block'; }
                else { prev.style.display = 'none'; img.removeAttribute('src'); }
            }
        }

        function removeMilestonePhoto() {
            pendingMilestonePhoto = '';
            showMilestonePhoto('');
        }

        function loadImageFile(file) {
            return new Promise(function (resolve, reject) {
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
                img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
                img.src = url;
            });
        }

        async function onMilestonePhoto(input) {
            const file = (input.files && input.files[0]) || null;
            if (!file) return;
            if (!(await ensurePremium())) {
                toast('Фото к вехам — в Премиуме 🔒', true);
                input.value = '';
                return;
            }
            try {
                const img = await loadImageFile(file);
                const max = 1200;
                let w = img.width, h = img.height;
                if (Math.max(w, h) > max) {
                    const k = max / Math.max(w, h);
                    w = Math.round(w * k);
                    h = Math.round(h * k);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', 0.82); });
                if (!blob) throw new Error('no blob');
                const res = await fetch(`${API_URL}/upload`, {
                    method: 'POST', headers: apiHeaders(), body: blob
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const d = await res.json();
                if (d && d.path) {
                    pendingMilestonePhoto = d.path;
                    showMilestonePhoto(d.path);
                    toast('Фото добавлено');
                }
            } catch (e) {
                toast('Не удалось загрузить фото', true);
            } finally {
                input.value = '';
            }
        }


        function viewPhoto(src) {
            const el = document.getElementById('photo-view');
            const img = document.getElementById('photo-view-img');
            if (!el || !img || !src) return;
            img.src = src;
            el.classList.add('show');
        }

        function closePhotoView() {
            const el = document.getElementById('photo-view');
            if (el) el.classList.remove('show');
        }

        function openMilestoneModal(title, id) {
            const m = document.getElementById('milestone-modal');
            if (!m) return;
            document.getElementById('ms-title').value = title || '';
            document.getElementById('ms-date').value = new Date().toISOString().slice(0, 10);
            document.getElementById('ms-note').value = '';
            if (id) {
                const item = (healthMilestones || []).find(function (x) { return x.id === id; });
                if (item) {
                    document.getElementById('ms-title').value = item.title || '';
                    document.getElementById('ms-date').value = item.date || '';
                    document.getElementById('ms-note').value = item.note || '';
                }
            }
            m.dataset.editId = id || '';
            pendingMilestonePhoto = '';
            showMilestonePhoto('');
            if (id) {
                const it = (healthMilestones || []).find(function (x) { return x.id === id; });
                if (it && it.photo) {
                    pendingMilestonePhoto = it.photo;
                    showMilestonePhoto(it.photo);
                }
            }
            m.style.display = 'flex';
        }

        function closeMilestoneModal(e) {
            if (!e || e.target.id === 'milestone-modal') {
                const m = document.getElementById('milestone-modal');
                if (m) m.style.display = 'none';
            }
        }

        async function saveMilestone() {
            const title = (document.getElementById('ms-title').value || '').trim();
            const date = document.getElementById('ms-date').value;
            const note = document.getElementById('ms-note').value || '';
            if (!title) { toast('Укажите событие', true); return; }
            const modal = document.getElementById('milestone-modal');
            const editId = modal.dataset.editId ? Number(modal.dataset.editId) : 0;
            try {
                const cid = (typeof activeChildId === 'function' && activeChildId()) ? activeChildId() : null;
                let url = `${API_URL}/milestones`;
                let method = 'POST';
                let body = { title: title, date: date, note: note, child_id: cid };
                if (pendingMilestonePhoto) body.photo = pendingMilestonePhoto;
                if (editId) { url += '/' + editId; method = 'PATCH'; delete body.child_id; }
                const res = await fetch(url, { method: method, headers: apiHeaders(true), body: JSON.stringify(body) });
                if (!res.ok) throw new Error();
                modal.style.display = 'none';
                toast('Сохранено');
                loadMilestones();
            } catch (e) { toast('Не удалось сохранить', true); }
        }

        async function deleteMilestone(id) {
            try {
                const res = await fetch(`${API_URL}/milestones/${id}`, { method: 'DELETE', headers: apiHeaders() });
                if (!res.ok) throw new Error();
                loadMilestones();
            } catch (e) { toast('Не удалось удалить', true); }
        }

        // ===== ЗДОРОВЬЕ: ВЕС, РОСТ, ПРИВИВКИ =====
        let growthChart = null;
        let healthMeasurements = [];
        let healthVaccines = [];

        function openGrowth() {
            switchView('growth', null);
        }

        function backFromGrowth() {
            const btn = document.querySelector('.nav-item[onclick*="tracker"]');
            switchView('tracker', btn);
        }


        async function loadFeeding() {
            const box = document.getElementById('feeding-list');
            const rules = document.getElementById('feeding-rules');
            const lead = document.getElementById('feeding-lead');
            if (!box) return;
            try {
                const res = await fetch(`${API_URL}/feeding`, { headers: apiHeaders() });
                if (!res.ok) return;
                const d = await res.json();
                const months = (typeof d.months === 'number') ? d.months : null;
                if (lead) {
                    lead.textContent = (months !== null && months < 4)
                        ? 'Прикорм обычно начинают с 4–6 месяцев. Вот что будет дальше:'
                        : 'Что и когда вводить — ориентир, а не строгое правило';
                }
                box.innerHTML = (d.stages || []).map(function (st) {
                    const items = (st.items || []).map(function (it) {
                        return '<div class="feed-item">' +
                            '<div class="feed-check' + (it.tried ? ' on' : '') + '" ' +
                            'onclick="toggleFeed(\'' + esc(it.name).replace(/'/g, "\\'") + '\', this)">' +
                            (it.tried ? '✓' : '') + '</div>' +
                            '<div><div class="feed-name">' + esc(it.name) + '</div>' +
                            (it.note ? '<div class="feed-note">' + esc(it.note) + '</div>' : '') +
                            (it.amount ? '<div class="feed-amount">' + esc(it.amount) + '</div>' : '') +
                            '</div></div>';
                    }).join('');
                    return '<div class="feed-stage' + (st.current ? ' current' : '') + '">' +
                        '<div class="feed-age">' + esc(st.age) + '</div>' +
                        '<div class="feed-title">' + esc(st.title) + '</div>' + items + '</div>';
                }).join('');
                const pbox = document.getElementById('feeding-products');
                if (pbox) {
                    pbox.innerHTML = (d.products || []).map(function (g) {
                        const rows = (g.items || []).map(function (it) {
                            return '<div class="prod-item"><div>' +
                                '<div class="prod-name">' + esc(it.name) +
                                (it.careful ? ' ⚠️' : '') + '</div>' +
                                (it.note ? '<div class="prod-note">' + esc(it.note) + '</div>' : '') +
                                '</div><div class="prod-age">' + esc(it.from) + '</div></div>';
                        }).join('');
                        return '<div class="prod-group"><div class="prod-title">' +
                            g.icon + ' ' + esc(g.group) + '</div>' + rows + '</div>';
                    }).join('');
                }
                if (rules) {
                    rules.innerHTML = '<b>Важно</b>' + (d.rules || []).map(function (t) {
                        return '<div>• ' + esc(t) + '</div>';
                    }).join('');
                }
            } catch (e) {}
        }

        async function toggleFeed(name, el) {
            const on = !el.classList.contains('on');
            el.classList.toggle('on', on);
            el.textContent = on ? '✓' : '';
            try {
                await fetch(`${API_URL}/feeding/tried`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ product: name, tried: on })
                });
            } catch (e) {}
        }


        async function loadTeeth() {
            const box = document.getElementById('teeth-list');
            const lead = document.getElementById('teeth-lead');
            if (!box) return;
            try {
                const res = await fetch(`${API_URL}/teeth`, { headers: apiHeaders() });
                if (!res.ok) return;
                const d = await res.json();
                if (lead) lead.textContent = 'Вылезло ' + d.count + ' из ' + d.total;
                box.innerHTML = (d.items || []).map(function (it) {
                    const on = !!it.date;
                    return '<div class="feed-item">' +
                        '<div class="feed-check' + (on ? ' on' : '') + '" ' +
                        'onclick="toggleTooth(\'' + esc(it.name).replace(/'/g, "\\'") + '\', this)">' +
                        (on ? '✓' : '') + '</div>' +
                        '<div><div class="feed-name">' + esc(it.name) + '</div>' +
                        '<div class="feed-amount">' + esc(it.age) + '</div></div></div>';
                }).join('');
            } catch (e) {}
        }

        async function toggleTooth(name, el) {
            const on = !el.classList.contains('on');
            el.classList.toggle('on', on);
            el.textContent = on ? '✓' : '';
            try {
                await fetch(`${API_URL}/teeth`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ tooth: name, on: on })
                });
                loadTeeth();
            } catch (e) {}
        }

        function switchHealthTab(tab) {
            document.querySelectorAll('.htab').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-tab') === tab);
            });
            document.getElementById('growth-pane').style.display = tab === 'growth' ? '' : 'none';
            document.getElementById('vaccines-pane').style.display = tab === 'vaccines' ? '' : 'none';
            document.getElementById('health-pane').style.display = tab === 'health' ? '' : 'none';
            const msPane = document.getElementById('milestones-pane');
            if (msPane) msPane.style.display = tab === 'milestones' ? '' : 'none';
            if (tab === 'vaccines') loadVaccines();
            if (tab === 'health') loadHealthLog();
            if (tab === 'milestones') loadMilestones();
            const feedPane = document.getElementById('feeding-pane');
            if (feedPane) feedPane.style.display = tab === 'feeding' ? '' : 'none';
            if (tab === 'feeding') loadFeeding();
            const teethPane = document.getElementById('teeth-pane');
            if (teethPane) teethPane.style.display = tab === 'teeth' ? '' : 'none';
            if (tab === 'teeth') loadTeeth();
        }

        function gPad(n) { return n < 10 ? '0' + n : '' + n; }

        function gFmtDate(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T12:00:00');
            if (isNaN(d)) return iso;
            return gPad(d.getDate()) + '.' + gPad(d.getMonth() + 1) + '.' + d.getFullYear();
        }

        function gFmtShort(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T12:00:00');
            if (isNaN(d)) return iso;
            return gPad(d.getDate()) + '.' + gPad(d.getMonth() + 1);
        }

        function gAddDays(iso, days) {
            const d = new Date(iso + 'T12:00:00');
            d.setDate(d.getDate() + days);
            return d.toISOString().slice(0, 10);
        }

        async function loadGrowth() {
            try {
                const cid = (typeof activeChildId === 'function' && activeChildId()) ? activeChildId() : 0;
                const res = await fetch(`${API_URL}/measurements?child_id=${cid}`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                healthMeasurements = await res.json();
                if (!Array.isArray(healthMeasurements)) healthMeasurements = [];
                renderGrowth();
            } catch (e) {}
        }

        async function renderGrowth() {
            const items = healthMeasurements || [];
            const lastW = items.slice().reverse().find(function (m) { return m.weight_g; });
            const lastH = items.slice().reverse().find(function (m) { return m.height_cm; });
            const wEl = document.getElementById('g-last-weight');
            const hEl = document.getElementById('g-last-height');
            if (wEl) wEl.textContent = lastW ? (lastW.weight_g / 1000).toFixed(2) + ' кг' : '—';
            if (hEl) hEl.textContent = lastH ? lastH.height_cm + ' см' : '—';

            const percEl = document.getElementById('g-percentiles');
            if (percEl) {
                const child = childInfo();
                const sex = child && child.gender === 'boy' ? 'boys' : 'girls';
                const parts = [];
                if (lastW && child && child.birth_date) {
                    const age = ageMonthsOf(lastW.date);
                    const p = whoPercentile(sex, 'weight', age, lastW.weight_g / 1000);
                    if (p !== null) parts.push('Вес — ' + p + '-й перцентиль (' + percWord(p) + ')');
                }
                if (lastH && child && child.birth_date) {
                    const ageH = ageMonthsOf(lastH.date);
                    const ph = whoPercentile(sex, 'height', ageH, lastH.height_cm);
                    if (ph !== null) parts.push('Рост — ' + ph + '-й перцентиль (' + percWord(ph) + ')');
                }
                if (!(await ensurePremium())) {
                    percEl.innerHTML = 'Кривые ВОЗ и перцентили — в Премиуме 🔒';
                } else {
                    percEl.textContent = parts.join(' · ') || 'Кривые — нормы ВОЗ для ' + (sex === 'boys' ? 'мальчиков' : 'девочек');
                }
            }

            const list = document.getElementById('measure-list');
            if (list) {
                list.innerHTML = items.slice().reverse().map(function (m) {
                    const parts = [];
                    if (m.weight_g) parts.push('<b>' + (m.weight_g / 1000).toFixed(2) + ' кг</b>');
                    if (m.height_cm) parts.push(m.height_cm + ' см');
                    if (m.head_cm) parts.push('голова ' + m.head_cm + ' см');
                    return '<div class="measure-row" onclick="openMeasurementModal(' + m.id + ')"><div>' + parts.join(' · ') +
                        '<div class="d">' + gFmtDate(m.date) +
                        (m.note ? ' · ' + esc(m.note) : '') + '</div></div>' +
                        '<button class="del" onclick="event.stopPropagation();deleteMeasurement(' + m.id + ')">✕</button></div>';
                }).join('') || '<div style="color:var(--muted);font-size:13px;padding:4px 2px">Пока нет измерений</div>';
            }
            drawGrowthChart(items);
        }

        // Нормы ВОЗ: [возраст, мес, P3, P15, P50, P85, P97]
        const WHO = {
            girls: {
                weight: [
                    [0, 2.4, 2.7, 3.2, 3.7, 4.2], [1, 3.2, 3.6, 4.2, 4.8, 5.5],
                    [2, 3.9, 4.5, 5.1, 5.8, 6.6], [3, 4.5, 5.1, 5.8, 6.6, 7.5],
                    [4, 5.0, 5.6, 6.4, 7.3, 8.2], [5, 5.4, 6.1, 6.9, 7.8, 8.8],
                    [6, 5.7, 6.5, 7.3, 8.3, 9.3], [7, 6.0, 6.8, 7.6, 8.6, 9.8],
                    [8, 6.3, 7.0, 7.9, 9.0, 10.2], [9, 6.5, 7.3, 8.2, 9.3, 10.5],
                    [10, 6.7, 7.5, 8.5, 9.6, 10.9], [11, 6.9, 7.7, 8.7, 9.9, 11.2],
                    [12, 7.0, 7.9, 8.9, 10.1, 11.5], [15, 7.6, 8.5, 9.6, 10.9, 12.4],
                    [18, 8.1, 9.0, 10.2, 11.6, 13.2], [21, 8.6, 9.6, 10.9, 12.3, 14.0],
                    [24, 9.0, 10.0, 11.5, 13.0, 14.8]
                ],
                height: [
                    [0, 45.6, 47.2, 49.1, 51.1, 52.7], [1, 50.0, 51.7, 53.7, 55.7, 57.4],
                    [2, 53.2, 55.0, 57.1, 59.1, 60.9], [3, 55.8, 57.6, 59.8, 61.9, 63.8],
                    [4, 58.0, 59.9, 62.1, 64.3, 66.2], [5, 59.9, 61.8, 64.0, 66.2, 68.2],
                    [6, 61.5, 63.5, 65.7, 68.0, 70.0], [7, 62.9, 64.9, 67.3, 69.6, 71.6],
                    [8, 64.3, 66.3, 68.7, 71.1, 73.2], [9, 65.6, 67.7, 70.1, 72.6, 74.7],
                    [10, 66.8, 69.0, 71.5, 74.0, 76.1], [11, 68.0, 70.2, 72.8, 75.3, 77.5],
                    [12, 69.2, 71.4, 74.0, 76.6, 78.9], [15, 72.4, 74.7, 77.5, 80.2, 82.7],
                    [18, 75.2, 77.7, 80.7, 83.6, 86.2], [21, 77.8, 80.4, 83.5, 86.6, 89.3],
                    [24, 80.3, 82.9, 86.2, 89.4, 92.2]
                ]
            },
            boys: {
                weight: [
                    [0, 2.5, 2.9, 3.3, 3.9, 4.3], [1, 3.4, 3.9, 4.5, 5.1, 5.8],
                    [2, 4.3, 4.9, 5.6, 6.3, 7.1], [3, 5.0, 5.6, 6.4, 7.2, 8.0],
                    [4, 5.6, 6.2, 7.0, 7.8, 8.7], [5, 6.0, 6.7, 7.5, 8.4, 9.3],
                    [6, 6.4, 7.1, 7.9, 8.8, 9.8], [7, 6.7, 7.4, 8.3, 9.3, 10.3],
                    [8, 6.9, 7.7, 8.6, 9.6, 10.7], [9, 7.1, 7.9, 8.9, 9.9, 11.0],
                    [10, 7.4, 8.2, 9.2, 10.2, 11.4], [11, 7.6, 8.4, 9.4, 10.5, 11.7],
                    [12, 7.8, 8.6, 9.6, 10.8, 12.0], [15, 8.4, 9.3, 10.4, 11.6, 12.9],
                    [18, 8.9, 9.9, 11.0, 12.3, 13.7], [21, 9.4, 10.4, 11.6, 13.0, 14.5],
                    [24, 9.8, 10.9, 12.2, 13.6, 15.2]
                ],
                height: [
                    [0, 46.1, 48.0, 49.9, 51.8, 53.7], [1, 50.8, 52.8, 54.7, 56.7, 58.6],
                    [2, 54.4, 56.4, 58.4, 60.4, 62.4], [3, 57.3, 59.3, 61.4, 63.5, 65.5],
                    [4, 59.7, 61.7, 63.9, 66.0, 68.0], [5, 61.7, 63.8, 65.9, 68.1, 70.2],
                    [6, 63.3, 65.5, 67.6, 69.8, 72.0], [7, 64.8, 67.0, 69.2, 71.4, 73.6],
                    [8, 66.2, 68.4, 70.6, 72.9, 75.1], [9, 67.5, 69.7, 72.0, 74.2, 76.5],
                    [10, 68.7, 71.0, 73.3, 75.6, 77.9], [11, 69.9, 72.2, 74.5, 76.9, 79.2],
                    [12, 71.0, 73.4, 75.7, 78.1, 80.5], [15, 74.1, 76.6, 79.1, 81.7, 84.2],
                    [18, 76.9, 79.6, 82.3, 85.0, 87.7], [21, 79.4, 82.3, 85.1, 88.0, 90.9],
                    [24, 81.7, 84.8, 87.8, 90.9, 93.9]
                ]
            }
        };


        function setGrowthRange(months) {
            growthRangeMonths = Number(months) || 0;
            document.querySelectorAll('.range-chip').forEach(function (b) {
                b.classList.toggle('active', Number(b.getAttribute('data-range')) === growthRangeMonths);
            });
            if ((healthMeasurements || []).length) renderGrowth();
        }






        // ===== ПРОВЕРКА ОБНОВЛЕНИЙ =====
        const APP_VERSION = (function () {
            try {
                const sc = Array.prototype.slice.call(document.scripts).find(function (x) {
                    return /app\.js\?v=\d+/.test(x.src || '');
                });
                const m = sc && sc.src.match(/v=(\d+)/);
                return m ? m[1] : '';
            } catch (e) { return ''; }
        })();

        async function checkUpdate() {
            if (!APP_VERSION) return;
            try {
                const res = await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' });
                if (!res.ok) return;
                const v = (await res.text()).trim();
                if (v && /^\d+$/.test(v) && v !== APP_VERSION) {
                    const b = document.getElementById('update-banner');
                    if (b) b.style.display = 'flex';
                }
            } catch (e) {}
        }

        async function applyUpdate() {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(function (r) { return r.unregister(); }));
            } catch (e) {}
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(function (k) { return caches.delete(k); }));
            } catch (e) {}
            location.reload();
        }

        // ===== КОЛОКОЛЬЧИК С ПОДСКАЗКАМИ =====
        let appTips = [];

        function tipsKey() {
            let uid = '';
            try {
                const p = (typeof ladProfile !== 'undefined' && ladProfile) ? ladProfile : null;
                uid = (p && (p.id || (p.user && p.user.id))) ? String(p.id || p.user.id) : '';
            } catch (e) {}
            return 'lad_tips_read' + (uid ? '_' + uid : '');
        }

        function readTipIds() {
            try { return JSON.parse(localStorage.getItem(tipsKey()) || '[]') || []; } catch (e) { return []; }
        }

        function updateBellDot() {
            const dot = document.getElementById('bell-dot');
            if (!dot) return;
            const read = readTipIds();
            const unread = (appTips || []).filter(function (t) { return read.indexOf(t.id) < 0; });
            dot.style.display = unread.length ? 'block' : 'none';
        }



        // ===== ИИ-ПОМОЩНИК =====
        function aiBubble(text, cls) {
            const box = document.getElementById('ai-messages');
            if (!box) return null;
            const el = document.createElement('div');
            el.className = 'ai-msg ' + (cls || 'assistant');
            el.textContent = text;
            box.appendChild(el);
            box.scrollTop = box.scrollHeight;
            return el;
        }

        function updateAiHint(used, limit) {
            const el = document.getElementById('ai-hint');
            if (!el) return;
            if (typeof limit === 'number') {
                el.textContent = 'Осталось сегодня: ' + Math.max(0, limit - used);
            } else if (typeof used === 'number') {
                el.textContent = 'Сегодня задано вопросов: ' + used;
            }
        }



        // ===== ПРОМОКОД =====
        function openPromo() {
            const m = document.getElementById('promo-modal');
            if (!m) return;
            m.style.display = 'flex';
            const input = document.getElementById('promo-input');
            if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 150); }
        }

        function closePromo(e) {
            if (!e || e.target.id === 'promo-modal') {
                const m = document.getElementById('promo-modal');
                if (m) m.style.display = 'none';
            }
        }

        async function redeemPromo() {
            const input = document.getElementById('promo-input');
            const code = (input.value || '').trim();
            if (!code) { toast('Введите код', true); return; }
            try {
                const res = await fetch(`${API_URL}/promo`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ code: code })
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok) { toast(d.detail || 'Не получилось', true); return; }
                closePromo();
                toast('Готово! Добавлено дней: ' + d.days);
                if (typeof loadProfile === 'function') loadProfile();
            } catch (e) {
                toast('Нет связи', true);
            }
        }

        // ===== ЧТО НОВОГО =====
        async function openWhatsNew() {
            const m = document.getElementById('whatsnew-modal');
            const box = document.getElementById('whatsnew-list');
            if (!m || !box) return;
            m.style.display = 'flex';
            box.innerHTML = '<div class="tips-lead">Загружаю…</div>';
            try {
                const res = await fetch(`${API_URL}/whatsnew`, { headers: apiHeaders() });
                const d = await res.json();
                const items = (d && Array.isArray(d.items)) ? d.items : [];
                if (!items.length) { box.innerHTML = '<div class="tips-lead">Пока ничего нового</div>'; return; }
                box.innerHTML = items.map(function (it) {
                    const lines = (it.lines || []).map(function (t) {
                        return '<div class="wn-line"><span>•</span><span>' + esc(t) + '</span></div>';
                    }).join('');
                    return '<div class="wn-item"><div class="wn-date">' + esc(it.date || '') + '</div>' + lines + '</div>';
                }).join('');
            } catch (e) {
                box.innerHTML = '<div class="tips-lead">Не удалось загрузить</div>';
            }
        }

        function closeWhatsNew(e) {
            if (!e || e.target.id === 'whatsnew-modal') {
                const m = document.getElementById('whatsnew-modal');
                if (m) m.style.display = 'none';
            }
        }

        async function openAiChat() {
            const m = document.getElementById('ai-modal');
            if (!m) return;
            m.style.display = 'flex';
            const box = document.getElementById('ai-messages');
            box.innerHTML = '';
            try {
                const res = await fetch(`${API_URL}/ai/history`, { headers: apiHeaders() });
                const d = await res.json();
                (d.messages || []).forEach(function (x) {
                    aiBubble(x.content, x.role === 'user' ? 'user' : 'assistant');
                });
                updateAiHint(d.used);
                if (!(d.messages || []).length) {
                    aiBubble('Привет! Я вижу записи о сне, кормлениях, весе и прививках. Спросите что угодно.', 'assistant');
                }
            } catch (e) {
                aiBubble('Не удалось загрузить историю', 'error');
            }
        }

        function closeAi(e) {
            if (!e || e.target.id === 'ai-modal') {
                const m = document.getElementById('ai-modal');
                if (m) m.style.display = 'none';
            }
        }

        async function sendAi() {
            const input = document.getElementById('ai-input');
            const q = (input.value || '').trim();
            if (!q) return;
            input.value = '';
            aiBubble(q, 'user');
            const wait = aiBubble('Печатаю…', 'assistant');
            try {
                const res = await fetch(`${API_URL}/ai/ask`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ question: q })
                });
                const d = await res.json().catch(function () { return {}; });
                if (wait) wait.remove();
                if (!res.ok) {
                    aiBubble(d.detail || 'Не получилось ответить', 'error');
                    return;
                }
                aiBubble(d.answer, 'assistant');
                updateAiHint(d.used, d.limit);
            } catch (e) {
                if (wait) wait.remove();
                aiBubble('Нет связи с помощником', 'error');
            }
        }

        async function loadInsights() {
            const card = document.getElementById('insights-card');
            const box = document.getElementById('insights-lines');
            if (!card || !box) return;
            try {
                const res = await fetch(`${API_URL}/insights`, { headers: apiHeaders() });
                if (!res.ok) return;
                const d = await res.json();
                const lines = (d && Array.isArray(d.lines)) ? d.lines : [];
                if (!lines.length) { card.style.display = 'none'; return; }
                box.innerHTML = lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('');
                card.style.display = '';
            } catch (e) {}
        }

        async function loadTips() {
            try {
                const res = await fetch(`${API_URL}/tips`, { headers: apiHeaders() });
                if (!res.ok) return;
                const d = await res.json();
                appTips = (d && Array.isArray(d.tips)) ? d.tips : [];
                updateBellDot();
            } catch (e) {}
        }

        function renderTips() {
            const list = document.getElementById('tips-list');
            const lead = document.getElementById('tips-lead');
            if (!list) return;
            if (lead) lead.textContent = appTips.length ? 'Подсказки по вашим данным' : 'Пока всё заполнено — новых подсказок нет';
            list.innerHTML = (appTips || []).map(function (t) {
                return '<div class="tip-item" onclick="tipAction(\'' + t.action + '\')">' +
                    '<div class="tip-icon">' + t.icon + '</div>' +
                    '<div class="tip-body"><b>' + t.title + '</b><span>' + t.text + '</span></div>' +
                    '<div class="tip-go">›</div></div>';
            }).join('') || '<p class="tips-lead">Ничего не осталось — вы молодец.</p>';
        }

        function openTips() {
            renderTips();
            document.getElementById('tips-modal').style.display = 'flex';
            try {
                localStorage.setItem(tipsKey(), JSON.stringify(appTips.map(function (t) { return t.id; })));
            } catch (e) {}
            updateBellDot();
        }

        function closeTips(e) {
            if (!e || e.target.id === 'tips-modal') {
                const m = document.getElementById('tips-modal');
                if (m) m.style.display = 'none';
            }
        }

        function tipAction(action) {
            const m = document.getElementById('tips-modal');
            if (m) m.style.display = 'none';
            if (action === 'profile') { openProfile(); return; }
            if (action === 'premium') { location.href = 'premium.html'; return; }
            if (action === 'report') { openDoctorReport(); return; }
            if (action === 'ai') { openAiChat(); return; }
            if (action === 'whatsnew') { openWhatsNew(); return; }
            const map = { growth: 'growth', tracker: 'tracker', calendar: 'calendar' };
            const view = map[action];
            if (view) {
                const btn = document.querySelector('.nav-item[onclick*="' + view + '"]');
                switchView(view, btn);
            }
        }

        // ===== ПОДСКАЗКА ОБ УСТАНОВКЕ =====
        function installSeenKey() {
            let uid = '';
            try {
                const p = (typeof ladProfile !== 'undefined' && ladProfile) ? ladProfile : null;
                uid = (p && (p.id || (p.user && p.user.id))) ? String(p.id || p.user.id) : '';
            } catch (e) {}
            return 'lad_install_seen' + (uid ? '_' + uid : '');
        }

        function maybeShowInstallBanner() {
            const banner = document.getElementById('install-banner');
            if (!banner) return;
            try {
                if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
                if (navigator.standalone === true) return;
                if (localStorage.getItem(installSeenKey())) return;
                if (document.getElementById('tour') && document.getElementById('tour').style.display === 'block') return;
            } catch (e) { return; }
            banner.style.display = 'flex';
        }

        function dismissInstallBanner() {
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'none';
            try { localStorage.setItem(installSeenKey(), '1'); } catch (e) {}
        }

        function goInstall() {
            const banner = document.getElementById('install-banner');
            if (banner) banner.style.display = 'none';
            try { localStorage.setItem(installSeenKey(), '1'); } catch (e) {}
            try { openProfile(); } catch (e) {}
            setTimeout(function () {
                const row = document.getElementById('install-row');
                if (!row) return;
                try { row.scrollIntoView({ block: 'center' }); } catch (e) {}
                row.classList.add('flash');
                setTimeout(function () { row.classList.remove('flash'); }, 2200);
            }, 450);
        }

        // ===== ОБУЧЕНИЕ ПРИ ПЕРВОМ ЗАПУСКЕ =====
        const TOUR_STEPS = [
            { sel: '#last-feed-badge', title: 'Последнее кормление', text: 'Сколько прошло с последнего кормления — видно сразу, даже если руки заняты.' },
            { sel: '#age-hint', title: 'Нормы по возрасту', text: 'Подсказка для текущего возраста: сколько сна, кормлений и объёма обычно нужно.' },
            { sel: '#btn-feed', title: 'Покормить', text: 'Одно нажатие — и кормление записано. Можно указать объём смеси.' },
            { sel: '#awake-btn', title: 'Сон и бодрствование', text: 'Нажми «Уложить спать» — таймер запустится сам. Потом «Разбудить».' },
            { sel: '#row-walk', title: 'Прогулка', text: 'Свой таймер: нажал — гуляем, нажал ещё раз — закончили.' },
            { sel: '#voice-btn', title: 'Сказать голосом', text: 'Голосовой ввод — в Премиуме. Скажите «покормила 120 миллилитров» — запись появится сама. Голосом можно отметить подгузник, сон, прогулку, вес, рост и температуру, а ещё уточнить «20 минут назад».' },
            { sel: '#btn-poop', title: 'Подгузник', text: 'Покакала или пописала — один тап, без лишних окон.' },
            { sel: '#checklist-card', title: 'Начните с этого', text: 'Если чего-то не хватает — приложение подскажет, что заполнить. Пункты ведут сразу в нужное место.' },
            { sel: '.btn-sos', title: 'Помоги!', text: 'Экстренный сигнал второму родителю: придёт push «Нужна помощь».' },
            { sel: '#today-card', title: 'Итоги дня', text: 'Кормления, сон, подгузники и прогулки за сегодня — одним взглядом.' },
            { sel: '.nav-item[onclick*="stats"]', title: 'Статистика', text: 'Сколько кормлений, сна и смеси за день и за неделю.' },
            { sel: '.nav-item[onclick*="growth"]', title: 'Здоровье', text: 'Вес, рост, прививки, температура, лекарства и вехи развития.' },
            { sel: '.nav-item[onclick*="openAiChat"]', title: 'Помощник', text: 'Спросите про сон, кормления и вес — ответит по вашим записям. Бесплатно 3 вопроса в день.' },
            { sel: '.nav-item[onclick*="openDoctorReport"]', title: 'Отчёт для врача', text: 'Печатная сводка за 30 дней. Доступна в Премиуме.' },
            { sel: '.nav-item[onclick*="analytics"]', title: 'Аналитика', text: 'Графики и сравнение дней. Полностью доступна в Премиуме.' },
            { sel: '#health-tabs', view: 'growth', title: 'Разделы здоровья', text: 'Вес и рост, прививки, температура, вехи, прикорм и зубы — шесть вкладок.' },
            { sel: '[data-tab="feeding"]', view: 'growth', title: 'Прикорм', text: 'Таблица по возрасту и каталог продуктов: что и когда вводить, с порциями.' },
            { sel: '[data-tab="teeth"]', view: 'growth', title: 'Зубы', text: 'Календарь зубов: отмечайте, какие уже вылезли, — счётчик обновится сам.' },
            { sel: '[data-tab="milestones"]', view: 'growth', title: 'Вехи развития', text: 'Первый зуб, улыбка, шаг — сохраняйте с фотографией.' },
            { sel: '.cal-primary', view: 'calendar', title: 'Приём у врача', text: 'Добавьте приём — приложение напомнит заранее.' },
            { sel: '.insights-card', view: 'stats', title: 'Итоги недели', text: 'Сон, кормления и вес — со сравнением с прошлой неделей.' },
            { sel: '#bell-btn', view: 'tracker', title: 'Колокольчик', text: 'Что нового и что стоит заполнить — коротко и по делу.' },
            { sel: '.nav-item[onclick*="calendar"]', title: 'Календарь', text: 'Приёмы у врача и напоминания о них.' },
            { sel: '.nav-item[onclick*="openNoiseModal"]', title: 'Звуки для сна', text: 'Белый шум, дождь, океан — с таймером и фоновым воспроизведением.' },
            { sel: '.profile-btn', view: 'tracker', title: 'Профиль', text: 'Ребёнок, семья, уведомления, премиум и отчёт для врача.' },
            { sel: '#ref-card', profile: true, title: 'Приглашения', text: 'Приглашайте друзей: за каждого — 7 дней Премиума вам и другу. Статистика видна сразу.' },
            { sel: '.row[onclick*="openPromo"]', profile: true, title: 'Промокод', text: 'Если дали код — введите его здесь, дни Премиума добавятся сами.' },
            { sel: '#row-whatsnew', profile: true, title: 'Что нового', text: 'Включите — и приложение сообщит, когда появится новая функция.' },
            { sel: '#row-daily', profile: true, title: 'Итоги дня в 21:00', text: 'Короткая сводка за день приходит в 21:00. Можно выключить в один тап.' }
        ];
        let tourIndex = 0;

        function startTour(force) {
            try {
                if (!force && localStorage.getItem('lad_tour_done')) return;
            } catch (e) { if (!force) return; }

            // закрываем все модалки и возвращаемся на трекер
            document.querySelectorAll('.modal-overlay').forEach(function (m) { m.style.display = 'none'; });
            const trackerBtn = document.querySelector('.nav-item[onclick*="tracker"]');
            if (trackerBtn) {
                try { switchView('tracker', trackerBtn); } catch (e) {}
            }
            try { window.scrollTo(0, 0); } catch (e) {}

            tourIndex = 0;
            const t = document.getElementById('tour');
            if (!t) return;
            t.style.display = 'block';
            setTimeout(showTourStep, 180);
        }

        function showTourStep() {
            const t = document.getElementById('tour');
            if (!t) return;
            if (tourIndex >= TOUR_STEPS.length) { endTour(); return; }
            const step = TOUR_STEPS[tourIndex];

            // шаги в профиле — открываем окно, вне профиля — закрываем
            if (step.profile) {
                const pm = document.getElementById('profile-modal');
                if (!pm || pm.style.display !== 'flex') {
                    Promise.resolve(openProfile()).then(function () {
                        setTimeout(showTourStep, 250);
                    });
                    return;
                }
            } else {
                const pm = document.getElementById('profile-modal');
                if (pm && pm.style.display === 'flex') {
                    pm.style.display = 'none';
                    setTimeout(showTourStep, 250);
                    return;
                }
            }

            if (step.profile) {
                openProfileSectionFor(document.querySelector(step.sel));
            }

            // шаг про другой раздел — сначала переключаем экран
            if (step.view) {
                const active = document.querySelector('.view.active');
                const activeId = active ? active.id : '';
                if (activeId !== 'view-' + step.view) {
                    const navBtn = document.querySelector('.nav-item[onclick*="' + step.view + '"]');
                    switchView(step.view, navBtn);
                    setTimeout(showTourStep, 450);
                    return;
                }
            }

            const el = document.querySelector(step.sel);
            if (!el || !el.offsetParent) { tourIndex += 1; showTourStep(); return; }

            // меню прокручивается плавно — на время замера отключаем это,
            // иначе координаты снимаются в середине анимации
            const navEl = document.querySelector('.bottom-nav');
            if (navEl) navEl.style.scrollBehavior = 'auto';
            try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
            setTimeout(function () { if (navEl) navEl.style.scrollBehavior = ''; }, 120);

            setTimeout(function () {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) { tourIndex += 1; showTourStep(); return; }
                const pad = 6;
                const hole = document.getElementById('tour-hole');
                hole.style.top = (r.top - pad) + 'px';
                hole.style.left = (r.left - pad) + 'px';
                hole.style.width = (r.width + pad * 2) + 'px';
                hole.style.height = (r.height + pad * 2) + 'px';

                document.getElementById('tour-title').textContent = step.title;
                document.getElementById('tour-text').textContent = step.text;
                document.getElementById('tour-step').textContent = (tourIndex + 1) + ' из ' + TOUR_STEPS.length;
                const next = document.getElementById('tour-next');
                if (next) next.textContent = (tourIndex === TOUR_STEPS.length - 1) ? 'Готово' : 'Далее';

                const card = document.getElementById('tour-card');
                card.style.left = '16px';
                card.style.right = '16px';
                const cardH = card.offsetHeight || 170;
                let top = r.bottom + 16;
                if (top + cardH > window.innerHeight - 20) top = Math.max(20, r.top - cardH - 16);
                card.style.top = top + 'px';
            }, 120);
        }

        function nextTourStep() {
            tourIndex += 1;
            showTourStep();
        }

        function endTour() {
            const t = document.getElementById('tour');
            if (t) t.style.display = 'none';
            const pm = document.getElementById('profile-modal');
            if (pm) pm.style.display = 'none';
            try { localStorage.setItem('lad_tour_done', '1'); } catch (e) {}
            try {
                const nav = document.querySelector('.nav-item[onclick*="tracker"]');
                switchView('tracker', nav);
            } catch (e) {}
            setTimeout(function () {
                if (typeof maybeShowInstallBanner === 'function') maybeShowInstallBanner();
            }, 1200);
        }

        // ===== ЗАГОЛОВОК С ИМЕНЕМ РЕБЁНКА =====
        const NAME_EXCEPTIONS = { 'лев': 'Льва', 'любовь': 'Любови', 'пётр': 'Петра', 'петр': 'Петра' };

        function genitiveName(name) {
            name = (name || '').trim();
            if (!name || name.length < 2) return '';
            const lower = name.toLowerCase();
            if (NAME_EXCEPTIONS[lower]) return NAME_EXCEPTIONS[lower];
            if (lower.endsWith('ий')) return name.slice(0, -2) + 'ия';
            if (lower.endsWith('а')) {
                const prev = lower.slice(-2, -1);
                return name.slice(0, -1) + (/[гкхжчшщц]/.test(prev) ? 'и' : 'ы');
            }
            if (lower.endsWith('я')) return name.slice(0, -1) + 'и';
            if (lower.endsWith('ь')) return name.slice(0, -1) + 'я';
            if (lower.endsWith('й')) return name.slice(0, -1) + 'я';
            if (/[оеуыэюи]$/.test(lower)) return name;
            return name + 'а';
        }

        function updateAppTitle() {
            const el = document.getElementById('app-title');
            if (!el) return;
            const child = (typeof childInfo === 'function') ? childInfo() : null;
            const name = child && child.name ? String(child.name).trim() : '';
            if (name && name !== 'Малыш') {
                const gen = genitiveName(name);
                el.textContent = '🌗 Трекер ' + gen;
                try { document.title = 'Трекер ' + gen; } catch (e) {}
            } else {
                el.textContent = '🌗 Лад';
                try { document.title = 'Лад'; } catch (e) {}
            }
        }

        function childInfo() {
            try {
                if (typeof ladProfile !== 'undefined' && ladProfile && ladProfile.children && ladProfile.children[0]) {
                    return ladProfile.children[0];
                }
            } catch (e) {}
            return null;
        }

        function ageMonthsOf(dateStr) {
            const c = childInfo();
            if (!c || !c.birth_date) return null;
            const b = new Date(c.birth_date + 'T12:00:00');
            const d = new Date(dateStr + 'T12:00:00');
            if (isNaN(b) || isNaN(d)) return null;
            return Math.max(0, (d - b) / (1000 * 60 * 60 * 24 * 30.4375));
        }

        function whoAt(sex, type, age) {
            const table = (WHO[sex] || WHO.girls)[type];
            if (!table || !table.length) return null;
            if (age <= table[0][0]) return table[0].slice(1);
            const last = table[table.length - 1];
            if (age >= last[0]) return last.slice(1);
            for (let i = 0; i < table.length - 1; i++) {
                const a = table[i], b = table[i + 1];
                if (age >= a[0] && age <= b[0]) {
                    const k = (age - a[0]) / (b[0] - a[0]);
                    return [1, 2, 3, 4, 5].map(function (j) { return a[j] + (b[j] - a[j]) * k; });
                }
            }
            return null;
        }

        function whoPercentile(sex, type, age, value) {
            const v = whoAt(sex, type, age);
            if (!v || !value) return null;
            const ps = [3, 15, 50, 85, 97];
            if (value <= v[0]) return 1;
            if (value >= v[4]) return 99;
            for (let i = 0; i < 4; i++) {
                if (value <= v[i + 1]) {
                    const k = (value - v[i]) / (v[i + 1] - v[i]);
                    return Math.round(ps[i] + (ps[i + 1] - ps[i]) * k);
                }
            }
            return 50;
        }

        function percWord(p) {
            if (p === null || p === undefined) return '';
            if (p < 3) return 'низкий';
            if (p < 15) return 'ниже среднего';
            if (p <= 85) return 'норма';
            if (p <= 97) return 'выше среднего';
            return 'высокий';
        }

        function whoSeries(sex, type, maxAge) {
            const out = { 3: [], 15: [], 50: [], 85: [], 97: [] };
            const limit = Math.min(24, Math.max(1, Math.ceil(maxAge || 24)));
            for (let a = 0; a <= limit; a += 1) {
                const v = whoAt(sex, type, a);
                if (!v) continue;
                [3, 15, 50, 85, 97].forEach(function (p, idx) {
                    out[p].push({ x: a, y: +v[idx].toFixed(2) });
                });
            }
            return out;
        }

        async function drawGrowthChart(items) {
            const canvas = document.getElementById('growth-chart');
            if (!canvas || !items.length) return;
            try { await loadChartLib(); } catch (e) { return; }
            if (typeof Chart === 'undefined') return;

            const child = childInfo();
            const sex = child && child.gender === 'boy' ? 'boys' : 'girls';
            const ages = items.map(function (m) { return ageMonthsOf(m.date); });
            const premium = await ensurePremium();
            const useAge = premium && child && child.birth_date && ages.every(function (a) { return a !== null; });

            if (growthChart) { growthChart.destroy(); growthChart = null; }

            if (!useAge) {
                const labels = items.map(function (m) { return gFmtShort(m.date); });
                growthChart = new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Вес, кг', data: items.map(function (m) { return m.weight_g ? +(m.weight_g / 1000).toFixed(2) : null; }),
                              borderColor: '#F29B93', backgroundColor: 'rgba(242,155,147,.15)', tension: .35, spanGaps: true, yAxisID: 'y' },
                            { label: 'Рост, см', data: items.map(function (m) { return m.height_cm ? +m.height_cm : null; }),
                              borderColor: '#A9C8F5', backgroundColor: 'rgba(169,200,245,.15)', tension: .35, spanGaps: true, yAxisID: 'y1' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: '#9CA3AF', boxWidth: 12 } } },
                        scales: {
                            x: { ticks: { color: '#9CA3AF', maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,.05)' } },
                            y: { position: 'left', ticks: { color: '#F29B93' }, grid: { color: 'rgba(255,255,255,.05)' } },
                            y1: { position: 'right', ticks: { color: '#A9C8F5' }, grid: { drawOnChartArea: false } }
                        }
                    }
                });
                return;
            }

            const maxAge = Math.max.apply(null, ages.concat([1]));
            const range = growthRangeMonths || Math.max(3, Math.ceil(maxAge + 1));
            const wSeries = whoSeries(sex, 'weight', range);
            const hSeries = whoSeries(sex, 'height', range);
            const wMeas = items.filter(function (m) { return m.weight_g; })
                .map(function (m) { return { x: +ageMonthsOf(m.date).toFixed(2), y: +(m.weight_g / 1000).toFixed(2) }; })
                .filter(function (p) { return p.x <= range; });
            const hMeas = items.filter(function (m) { return m.height_cm; })
                .map(function (m) { return { x: +ageMonthsOf(m.date).toFixed(2), y: +m.height_cm }; })
                .filter(function (p) { return p.x <= range; });

            const whoSet = function (points, label, color, dashed, axis) {
                return {
                    label: label, data: points, borderColor: color, borderWidth: dashed ? 1 : 1.4,
                    borderDash: dashed ? [4, 4] : [], pointRadius: 0, tension: .3,
                    fill: false, yAxisID: axis
                };
            };

            const datasets = [
                whoSet(wSeries[3], 'P3', 'rgba(242,155,147,.22)', true, 'y'),
                whoSet(wSeries[15], 'P15', 'rgba(242,155,147,.30)', true, 'y'),
                whoSet(wSeries[50], 'P50', 'rgba(242,155,147,.55)', false, 'y'),
                whoSet(wSeries[85], 'P85', 'rgba(242,155,147,.30)', true, 'y'),
                whoSet(wSeries[97], 'P97', 'rgba(242,155,147,.22)', true, 'y'),
                whoSet(hSeries[3], 'P3', 'rgba(169,200,245,.22)', true, 'y1'),
                whoSet(hSeries[50], 'P50', 'rgba(169,200,245,.55)', false, 'y1'),
                whoSet(hSeries[97], 'P97', 'rgba(169,200,245,.22)', true, 'y1'),
                { label: 'Вес', data: wMeas, borderColor: '#F29B93', backgroundColor: '#F29B93',
                  borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#F29B93',
                  tension: .25, yAxisID: 'y' },
                { label: 'Рост', data: hMeas, borderColor: '#A9C8F5', backgroundColor: '#A9C8F5',
                  borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#A9C8F5',
                  tension: .25, yAxisID: 'y1' }
            ];

            growthChart = new Chart(canvas, {
                type: 'line',
                data: { datasets: datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'nearest', intersect: false },
                    plugins: {
                        legend: {
                            labels: {
                                color: '#9CA3AF', boxWidth: 12,
                                filter: function (item) { return item.text === 'Вес' || item.text === 'Рост'; }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                title: function (ctx) {
                                    return ctx[0].parsed.x.toFixed(1) + ' мес';
                                },
                                label: function (ctx) {
                                    const unit = ctx.dataset.yAxisID === 'y' ? ' кг' : ' см';
                                    return ctx.dataset.label + ': ' + ctx.parsed.y + unit;
                                }
                            }
                        }
                    },
                    scales: {
                        x: { type: 'linear', min: 0, max: range,
                             title: { display: true, text: 'возраст, мес', color: '#6B7280', font: { size: 10 } },
                             ticks: { color: '#9CA3AF', stepSize: range <= 6 ? 1 : (range <= 12 ? 2 : 3) },
                             grid: { color: 'rgba(255,255,255,.05)' } },
                        y: { position: 'left', ticks: { color: '#F29B93' }, grid: { color: 'rgba(255,255,255,.05)' } },
                        y1: { position: 'right', ticks: { color: '#A9C8F5' }, grid: { drawOnChartArea: false } }
                    }
                }
            });
        }

        let editingMeasurementId = null;

        function openMeasurementModal(id) {
            const m = document.getElementById('measure-modal');
            if (!m) return;
            editingMeasurementId = id || null;
            const title = m.querySelector('h2');
            if (id) {
                const item = (healthMeasurements || []).find(function (x) { return x.id === id; });
                if (item) {
                    document.getElementById('m-date').value = item.date || new Date().toISOString().slice(0, 10);
                    document.getElementById('m-weight').value = item.weight_g ? item.weight_g : '';
                    document.getElementById('m-height').value = item.height_cm || '';
                    document.getElementById('m-head').value = item.head_cm || '';
                    document.getElementById('m-note').value = item.note || '';
                    if (title) title.textContent = 'Изменить измерение';
                }
            } else {
                document.getElementById('m-date').value = new Date().toISOString().slice(0, 10);
                document.getElementById('m-weight').value = '';
                document.getElementById('m-height').value = '';
                document.getElementById('m-head').value = '';
                document.getElementById('m-note').value = '';
                if (title) title.textContent = 'Добавить измерение';
            }
            m.style.display = 'flex';
        }

        function closeMeasureModal(e) {
            if (!e || e.target.id === 'measure-modal' || e.type === 'click') {
                const m = document.getElementById('measure-modal');
                if (m && (!e || e.target.id === 'measure-modal' || e.target.tagName === 'BUTTON')) m.style.display = 'none';
            }
        }

        async function saveMeasurement() {
            const date = document.getElementById('m-date').value;
            const w = parseFloat(document.getElementById('m-weight').value);
            const h = parseFloat(document.getElementById('m-height').value);
            const hd = parseFloat(document.getElementById('m-head').value);
            const note = document.getElementById('m-note').value || '';
            if (!date) { toast('Укажите дату', true); return; }
            if (!w && !h && !hd) { toast('Введите вес или рост', true); return; }
            const cid = (typeof activeChildId === 'function' && activeChildId()) ? activeChildId() : null;
            try {
                const payload = {
                    date: date,
                    weight_g: w ? Math.round(w) : null,
                    height_cm: h || null,
                    head_cm: hd || null,
                    note: note
                };
                let url = `${API_URL}/measurements`;
                let method = 'POST';
                if (editingMeasurementId) {
                    url += '/' + editingMeasurementId;
                    method = 'PATCH';
                    delete payload.date;  // дату тоже можно менять
                    payload.date = date;
                } else {
                    payload.child_id = cid;
                }
                const res = await fetch(url, {
                    method: method,
                    headers: apiHeaders(true),
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                document.getElementById('measure-modal').style.display = 'none';
                editingMeasurementId = null;
                toast('Сохранено');
                loadGrowth();
            } catch (e) {
                toast('Не удалось сохранить', true);
            }
        }

        async function deleteMeasurement(id) {
            try {
                const res = await fetch(`${API_URL}/measurements/${id}`, { method: 'DELETE', headers: apiHeaders() });
                if (!res.ok) throw new Error();
                loadGrowth();
            } catch (e) { toast('Не удалось удалить', true); }
        }



        function openHealthEdit(id) {
            const item = (healthItems || []).find(function (x) { return x.id === id; });
            if (!item) return;
            editingHealthId = id;
            const isTemp = item.kind === 'temp';
            document.getElementById('h-temp-wrap').style.display = isTemp ? '' : 'none';
            document.getElementById('h-med-wrap').style.display = isTemp ? 'none' : '';
            document.getElementById('h-dose-wrap').style.display = isTemp ? 'none' : '';
            document.getElementById('h-temp').value = isTemp ? (item.value || '') : '';
            document.getElementById('h-med').value = !isTemp ? (item.note || '') : '';
            document.getElementById('h-dose').value = !isTemp ? (item.unit || '') : '';
            document.getElementById('health-modal-title').textContent =
                isTemp ? 'Изменить температуру' : 'Изменить лекарство';
            document.getElementById('health-modal').style.display = 'flex';
        }

        function closeHealthModal(e) {
            if (!e || e.target.id === 'health-modal') {
                const m = document.getElementById('health-modal');
                if (m) m.style.display = 'none';
                editingHealthId = null;
            }
        }

        async function saveHealthEdit() {
            if (!editingHealthId) return;
            const item = (healthItems || []).find(function (x) { return x.id === editingHealthId; });
            if (!item) return;
            let payload;
            if (item.kind === 'temp') {
                const v = parseFloat(document.getElementById('h-temp').value);
                if (!v) { toast('Укажите температуру', true); return; }
                payload = { value: v };
            } else {
                const name = (document.getElementById('h-med').value || '').trim();
                const dose = (document.getElementById('h-dose').value || '').trim();
                if (!name) { toast('Укажите лекарство', true); return; }
                payload = { note: name, unit: dose };
            }
            try {
                const res = await fetch(`${API_URL}/health/${editingHealthId}`, {
                    method: 'PATCH',
                    headers: apiHeaders(true),
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error();
                document.getElementById('health-modal').style.display = 'none';
                editingHealthId = null;
                toast('Сохранено');
                loadHealthLog();
            } catch (e) { toast('Не удалось сохранить', true); }
        }


        // ===== НАПОМИНАНИЯ О ЛЕКАРСТВАХ =====
        let medReminders = [];

        async function loadMedReminders() {
            try {
                const res = await fetch(`${API_URL}/med-reminders`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                medReminders = await res.json();
                if (!Array.isArray(medReminders)) medReminders = [];
                renderMedReminders();
            } catch (e) {}
        }

        function renderMedReminders() {
            const list = document.getElementById('med-rem-list');
            if (!list) return;
            if (!medReminders.length) { list.innerHTML = ''; return; }
            const now = Date.now();
            list.innerHTML = medReminders.map(function (m) {
                const t = new Date(m.next_at).getTime();
                let left = Math.max(0, Math.round((t - now) / 60000));
                const when = left >= 60
                    ? Math.floor(left / 60) + ' ч ' + (left % 60) + ' мин'
                    : left + ' мин';
                const dose = m.dose ? ' · ' + esc(m.dose) : '';
                return '<div class="measure-row">' +
                    '<div><b>💊 ' + esc(m.name) + dose + '</b>' +
                    '<div class="d">следующий приём через ' + when + '</div></div>' +
                    '<button class="del" style="font-size:13px;color:#F29B93;font-weight:700" ' +
                    'onclick="takeMedReminder(' + m.id + ')">Принял</button>' +
                    '<button class="del" onclick="deleteMedReminder(' + m.id + ')">✕</button></div>';
            }).join('');
        }

        async function addMedReminder() {
            const name = (document.getElementById('mr-name').value || '').trim();
            const dose = (document.getElementById('mr-dose').value || '').trim();
            const interval = Number(document.getElementById('mr-interval').value || 6);
            if (!name) { toast('Укажите лекарство', true); return; }
            try {
                const res = await fetch(`${API_URL}/med-reminders`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ name: name, dose: dose, interval_hours: interval })
                });
                if (!res.ok) throw new Error();
                document.getElementById('mr-name').value = '';
                document.getElementById('mr-dose').value = '';
                toast('Напомню через ' + interval + ' ч');
                loadMedReminders();
            } catch (e) { toast('Не удалось сохранить', true); }
        }

        async function takeMedReminder(id) {
            try {
                const res = await fetch(`${API_URL}/med-reminders/${id}/take`, { method: 'POST', headers: apiHeaders() });
                if (!res.ok) throw new Error();
                toast('Записано');
                loadMedReminders();
            } catch (e) { toast('Не удалось', true); }
        }

        async function deleteMedReminder(id) {
            try {
                const res = await fetch(`${API_URL}/med-reminders/${id}`, { method: 'DELETE', headers: apiHeaders() });
                if (!res.ok) throw new Error();
                loadMedReminders();
            } catch (e) { toast('Не удалось удалить', true); }
        }


        let tempChart = null;

        async function drawTempChart(items) {
            const wrap = document.getElementById('temp-chart-wrap');
            const canvas = document.getElementById('temp-chart');
            const temps = (items || []).filter(function (h) { return h.kind === 'temp' && h.value; });
            if (!wrap || !canvas) return;
            if (temps.length < 2) { wrap.style.display = 'none'; return; }
            wrap.style.display = '';
            try { await loadChartLib(); } catch (e) { return; }
            if (typeof Chart === 'undefined') return;

            const sorted = temps.slice().sort(function (a, b) {
                return new Date(a.at) - new Date(b.at);
            });
            const labels = sorted.map(function (h) {
                const d = new Date(h.at);
                return gPad(d.getDate()) + '.' + gPad(d.getMonth() + 1) + ' ' +
                    gPad(d.getHours()) + ':' + gPad(d.getMinutes());
            });
            const values = sorted.map(function (h) { return Number(h.value); });
            const colors = values.map(function (v) { return v >= 37.5 ? '#F87171' : '#F29B93'; });

            if (tempChart) { tempChart.destroy(); tempChart = null; }
            tempChart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Температура',
                        data: values,
                        borderColor: '#F29B93',
                        backgroundColor: 'rgba(242,155,147,.15)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointBackgroundColor: colors,
                        tension: .25,
                        fill: false
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (ctx) { return ctx.parsed.y + ' °C'; }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { color: '#9CA3AF', maxTicksLimit: 5, font: { size: 10 } },
                             grid: { color: 'rgba(255,255,255,.04)' } },
                        y: { min: 35.5, max: 40,
                             ticks: { color: '#9CA3AF', stepSize: 1, callback: function (v) { return v + '°'; } },
                             grid: { color: 'rgba(255,255,255,.05)' } }
                    }
                }
            });
        }

        async function loadHealthLog() {
            try {
                const res = await fetch(`${API_URL}/health?days=30`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                const items = await res.json();
                renderHealthLog(Array.isArray(items) ? items : []);
            } catch (e) {}
        }

        let healthItems = [];
        let editingHealthId = null;

        function renderHealthLog(items) {
            healthItems = items || [];
            const list = document.getElementById('health-list');
            if (!list) return;
            if (!items.length) {
                list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px 2px">Пока ничего не записано</div>';
                return;
            }
            drawTempChart(items);
            const icons = { temp: '🌡', med: '💊', symptom: '🤒' };
            list.innerHTML = items.map(function (h) {
                let title = '';
                if (h.kind === 'temp') title = h.value + ' °C';
                else if (h.kind === 'med') title = esc(h.note || 'лекарство');
                else title = esc(h.note || 'симптом');
                const t = new Date(h.at);
                const time = isNaN(t) ? '' : gPad(t.getHours()) + ':' + gPad(t.getMinutes());
                const date = isNaN(t) ? '' : gPad(t.getDate()) + '.' + gPad(t.getMonth() + 1);
                return '<div class="measure-row" onclick="openHealthEdit(' + h.id + ')"><div><b>' + (icons[h.kind] || '•') + ' ' + title + '</b>' +
                    '<div class="d">' + date + ' · ' + time + (h.kind === 'med' && h.unit ? ' · ' + esc(h.unit) : '') + '</div></div>' +
                    '<button class="del" onclick="event.stopPropagation();deleteHealthLog(' + h.id + ')">✕</button></div>';
            }).join('');
        }

        async function addTemp(v) {
            try {
                const res = await fetch(`${API_URL}/health`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ kind: 'temp', value: v, unit: 'C' })
                });
                if (!res.ok) throw new Error();
                toast('Записано: ' + v + ' °C');
                loadHealthLog();
            } catch (e) { toast('Не удалось сохранить', true); }
        }

        async function addMed() {
            const name = (document.getElementById('med-name').value || '').trim();
            const dose = (document.getElementById('med-dose').value || '').trim();
            if (!name) { toast('Укажите лекарство', true); return; }
            try {
                const res = await fetch(`${API_URL}/health`, {
                    method: 'POST', headers: apiHeaders(true),
                    body: JSON.stringify({ kind: 'med', note: name, unit: dose })
                });
                if (!res.ok) throw new Error();
                document.getElementById('med-name').value = '';
                document.getElementById('med-dose').value = '';
                toast('Записано');
                loadHealthLog();
            } catch (e) { toast('Не удалось сохранить', true); }
        }

        async function deleteHealthLog(id) {
            try {
                const res = await fetch(`${API_URL}/health/${id}`, { method: 'DELETE', headers: apiHeaders() });
                if (!res.ok) throw new Error();
                loadHealthLog();
            } catch (e) { toast('Не удалось удалить', true); }
        }

        async function loadVaccines() {
            try {
                const cid = (typeof activeChildId === 'function' && activeChildId()) ? activeChildId() : 0;
                const res = await fetch(`${API_URL}/vaccines?child_id=${cid}`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) return;
                healthVaccines = await res.json();
                if (!Array.isArray(healthVaccines)) healthVaccines = [];
                renderVaccines();
            } catch (e) {}
        }

        function renderVaccines() {
            const list = document.getElementById('vaccine-list');
            if (!list) return;
            const items = healthVaccines || [];
            if (!items.length) {
                list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px 2px">' +
                    'Добавьте дату рождения ребёнка в профиле — календарь прививок построится сам.</div>';
                return;
            }
            const today = new Date().toISOString().slice(0, 10);
            list.innerHTML = items.map(function (v) {
                const done = !!v.done_date;
                const late = !done && v.due_date && v.due_date < today;
                const soon = !done && !late && v.due_date && v.due_date <= gAddDays(today, 30);
                const cls = 'vaccine-row' + (done ? ' done' : '');
                const dcls = late ? 'late' : (soon ? 'soon' : '');
                const right = done ? ('сделана ' + gFmtDate(v.done_date))
                                   : (late ? 'просрочена · ' : '') + gFmtDate(v.due_date);
                return '<label class="' + cls + '">' +
                    '<input type="checkbox"' + (done ? ' checked' : '') +
                    ' onchange="toggleVaccine(' + v.id + ', this.checked)">' +
                    '<span class="vn">' + esc(v.name) + '</span>' +
                    '<span class="vd ' + dcls + '">' + right + '</span></label>';
            }).join('');
        }

        async function toggleVaccine(id, done) {
            try {
                const url = done ? `${API_URL}/vaccines/${id}/done` : `${API_URL}/vaccines/${id}/done`;
                const method = done ? 'POST' : 'DELETE';
                const res = await fetch(url, {
                    method: method,
                    headers: done ? apiHeaders(true) : apiHeaders(),
                    body: done ? JSON.stringify({}) : undefined
                });
                if (!res.ok) throw new Error();
                loadVaccines();
            } catch (e) {
                toast('Не удалось сохранить', true);
                loadVaccines();
            }
        }

        // ===== ПОДПИСКА =====
        async function loadBilling() {
            const dbg = document.getElementById('plan-status');
            if (!ladToken() && !apiToken()) {
                if (dbg) dbg.textContent = 'dbg: нет токена';
                return;
            }
            if (typeof loadReminders === 'function') loadReminders();
            try {
                const res = await fetch(`${API_URL}/billing/status`, {
                    headers: apiHeaders()
                });
                if (!res.ok) {
                    if (dbg) dbg.textContent = 'dbg http ' + res.status;
                    return;
                }
                const d = await res.json();
                const name = document.getElementById('plan-name');
                const until = document.getElementById('plan-until');
                const btn = document.getElementById('plan-btn');
                const st = document.getElementById('plan-status');
                if (!name || !btn) return;
                familyPremium = !!d.active;
                try { localStorage.setItem('lad_premium', familyPremium ? '1' : '0'); } catch (e) {}
                if (typeof updateVoicePremiumUi === 'function') updateVoicePremiumUi(familyPremium);

                // Сначала то, что видит человек: надпись и дата.
                name.textContent = d.active ? 'Премиум' : 'Бесплатная';
                let untilText = '';
                if (d.active && d.plan_until) {
                    try { untilText = 'до ' + new Date(d.plan_until).toLocaleDateString('ru-RU'); } catch (e) {}
                }
                until.textContent = untilText;
                const accPremiumSub = document.getElementById('p-acc-premium-sub');
                if (accPremiumSub) {
                    accPremiumSub.textContent = d.active ? (untilText || 'Премиум') : 'Бесплатный тариф';
                }
                if (st) st.textContent = '';

                // Потом — необязательные элементы интерфейса.
                try {
                    const reportBtn = document.getElementById('report-btn');
                    if (reportBtn) reportBtn.style.display = familyPremium ? '' : 'none';
                    const lockEl = document.getElementById('analytics-lock');
                    const analyticsView = document.getElementById('view-analytics');
                    if (lockEl && analyticsView) {
                        const analyticsOpen = analyticsView.classList.contains('active');
                        lockEl.style.display = (!familyPremium && analyticsOpen) ? 'block' : 'none';
                    }
                } catch (e) { /* не ломаем подписку из-за аналитики */ }

                const promo = document.getElementById('premium-promo');
                if (promo) promo.style.display = d.active ? 'none' : 'block';
                if (btn) {
                    btn.textContent = 'Оформить за ' + d.price_rub + ' руб.';
                    btn.style.display = d.configured ? '' : 'none';
                }
            } catch (e) {
                if (dbg) dbg.textContent = 'dbg err ' + (e && e.message ? e.message : 'fetch');
            }
        }

        async function startPayment() {
            const token = ladToken();
            const st = document.getElementById('plan-status');
            try {
                st.textContent = 'Создаю платёж…';
                const res = await fetch(`${API_URL}/billing/pay`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const d = await res.json().catch(function () { return {}; });
                if (!res.ok || !d.confirmation_url) {
                    throw new Error(d.detail || 'Не удалось создать платёж');
                }
                window.location.href = d.confirmation_url;
            } catch (e) {
                st.textContent = e.message;
            }
        }

        function toggleRegister() {
            const box = document.getElementById('register-box');
            if (!box) return;
            const show = box.style.display === 'none';
            box.style.display = show ? 'block' : 'none';
            const st = document.getElementById('reg-status');
            if (st) st.textContent = '';
        }

        async function submitRegister() {
            if (!consentGiven()) return;
            const login = (document.getElementById('reg-login').value || '').trim();
            const password = document.getElementById('reg-pass').value || '';
            const name = (document.getElementById('reg-name').value || '').trim();
            const st = document.getElementById('reg-status');
            if (!login || !password) {
                st.textContent = 'Заполните логин и пароль';
                return;
            }
            if (password.length < 8) {
                st.textContent = 'Пароль короче 8 символов';
                return;
            }
            st.textContent = 'Создаю аккаунт…';
            try {
                const res = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        login: login,
                        password: password,
                        name: name,
                        consent_version: '2026-11-16'
                    })
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || !data.ok) throw new Error(data.detail || ('HTTP ' + res.status));
                try { localStorage.setItem(LAD_TOKEN_KEY, data.token); } catch (e) {}
                location.reload();
            } catch (e) {
                st.textContent = e.message;
            }
        }



        // ===== ЧЕК-ЛИСТ ПЕРВЫХ ШАГОВ =====
        function renderChecklist(c) {
            const card = document.getElementById('checklist-card');
            const box = document.getElementById('checklist-items');
            if (!card || !box || !c) return;
            try { if (localStorage.getItem('lad_checklist_hidden')) { card.style.display = 'none'; return; } } catch (e) {}
            const items = [
                { k: 'birth', icon: '🎂', text: 'Указать дату рождения', action: 'profile' },
                { k: 'weight', icon: '📏', text: 'Добавить вес и рост', action: 'growth' },
                { k: 'vaccines', icon: '💉', text: 'Отметить прививки', action: 'growth' },
                { k: 'invite', icon: '👨‍👩‍👧', text: 'Пригласить второго родителя', action: 'invite' }
            ];
            const left = items.filter(function (i) { return !c[i.k]; });
            if (!left.length) { card.style.display = 'none'; return; }
            box.innerHTML = left.map(function (i) {
                return '<div class="chk-item" onclick="chkGo(\'' + i.action + '\')">' +
                    '<span class="chk-box"></span><span>' + i.icon + ' ' + i.text + '</span></div>';
            }).join('');
            card.style.display = '';
        }

        function chkGo(action) {
            if (action === 'profile') { openProfile(); return; }
            if (action === 'invite') { openProfile(); setTimeout(function () { inviteParent(); }, 500); return; }
            if (action === 'growth') {
                const b = document.querySelector('.nav-item[onclick*="growth"]');
                switchView('growth', b);
            }
        }

        function hideChecklist() {
            try { localStorage.setItem('lad_checklist_hidden', '1'); } catch (e) {}
            const card = document.getElementById('checklist-card');
            if (card) card.style.display = 'none';
        }

        // Один запрос на старте: профиль, подсказки и тариф
        async function loadBootstrap() {
            const res = await fetch(`${API_URL}/bootstrap`, { headers: apiHeaders() });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const d = await res.json();
            if (d.me) {
                ladProfile = d.me;
                try { renderProfile(d.me); } catch (e) {}
            }
            if (d.tips && Array.isArray(d.tips.tips)) {
                appTips = d.tips.tips;
                updateBellDot();
            }
            if (d.billing) familyPremium = !!d.billing.active;
            if (d.checklist) renderChecklist(d.checklist);
        }

        // Загружаем профиль ребёнка при старте: нужен возраст и пол
        // для кривых ВОЗ и подсказки по возрасту.
        setTimeout(function () {
            if (typeof initPushState === 'function') initPushState();
        }, 1500);
        setTimeout(function () {
            if (typeof ensurePremium === 'function') {
                ensurePremium().then(function (premium) {
                    if (typeof updateVoicePremiumUi === 'function') updateVoicePremiumUi(premium);
                });
            }
        }, 1800);
        setTimeout(function () {
            if (typeof startTour === 'function' && typeof ladToken === 'function' && ladToken()) startTour(false);
        }, 2200);
        setTimeout(function () {
            if (typeof checkUpdate === 'function') checkUpdate();
        }, 4000);
        setInterval(function () {
            if (typeof checkUpdate === 'function') checkUpdate();
        }, 300000);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && typeof checkUpdate === 'function') checkUpdate();
        });
        setTimeout(function () {
            if (typeof maybeShowInstallBanner === 'function') maybeShowInstallBanner();
        }, 5200);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && typeof initPushState === 'function') {
                initPushState();
            }
        });

        (function initChildInfo() {
            try {
                if (typeof ladToken !== 'function' || !ladToken()) return;
                loadBootstrap().then(function () {
                    if (typeof updateAppTitle === 'function') updateAppTitle();
                    if (typeof renderAgeHint === 'function') renderAgeHint();
                    var gv = document.getElementById('view-growth');
                    if (gv && gv.classList.contains('active') && typeof loadGrowth === 'function') loadGrowth();
                }).catch(function () {
                    // bootstrap не ответил — обычный путь (он умеет обрабатывать 401)
                    try { loadProfile().catch(function () {}); } catch (e) {}
                });
            } catch (e) {}
        })();
