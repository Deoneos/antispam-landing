        // ТЕМА: авто (по времени суток) или ручной выбор
        const THEME_KEY = 'lad_theme';
        const TZ_KEY = 'lad_tz';

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

        const API_URL = 'https://baby.kustos.ru/api/baby';

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
            btn.classList.add('active');
            if (viewName === 'stats') loadStats();
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

        window.addEventListener('online', () => { renderStatus(); flushQueue(); });
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
                const res = await fetch(`${API_URL}/events/history?days=90`, { headers: apiHeaders() });
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

        function openFeedModal() {
            const inp = document.getElementById('feed-time');
            if (inp) inp.value = toLocalInputValue(new Date());
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

        // --- АУДИО ---
        let audioCtx = null, gainNode = null, currentSource = null;
        let audioBuffers = {}, isPlaying = false, currentSound = 'white', isAudioLoading = false;
        const sounds = { 'white': 'sounds/white.mp3', 'rain': 'sounds/rain.mp3', 'womb': 'sounds/womb.mp3', 'heart': 'sounds/heart.mp3', 'pink': 'sounds/pink.mp3', 'brown': 'sounds/brown.mp3', 'ocean': 'sounds/ocean.mp3', 'heartbeat': 'sounds/heart2.mp3', 'fan': 'sounds/fan.mp3' };
        const playPauseBtn = document.getElementById('play-pause-btn');

        async function unlockAudio() {
            if (audioCtx) return;
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            gainNode = audioCtx.createGain(); gainNode.gain.value = 0.5; gainNode.connect(audioCtx.destination);
        }
        async function loadSound(soundName) {
            if (audioBuffers[soundName]) return audioBuffers[soundName];
            const response = await fetch(sounds[soundName]);
            if (!response.ok) throw new Error("Файл не найден");
            const arrayBuffer = await response.arrayBuffer();
            audioBuffers[soundName] = await audioCtx.decodeAudioData(arrayBuffer);
            return audioBuffers[soundName];
        }
        function stopCurrentAudio() {
            if (currentSource) { try { currentSource.stop(); currentSource.disconnect(); } catch(e){} currentSource = null; }
            isPlaying = false; playPauseBtn.textContent = '▶'; playPauseBtn.classList.remove('playing');
        }
        async function playSound(soundName) {
            if (isAudioLoading) return;
            isAudioLoading = true;
            stopCurrentAudio();
            await unlockAudio();
            try {
                const buffer = await loadSound(soundName);
                currentSource = audioCtx.createBufferSource(); currentSource.buffer = buffer;
                currentSource.loop = true; currentSource.connect(gainNode); currentSource.start(0);
                isPlaying = true; playPauseBtn.textContent = '⏸'; playPauseBtn.classList.add('playing');
            } catch (e) { toast("Ошибка загрузки звука", true); }
            finally { isAudioLoading = false; }
        }
        async function changeNoise(btn) {
            document.querySelectorAll('.noise-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); currentSound = btn.getAttribute('data-sound');
            if (isPlaying) await playSound(currentSound);
        }
        async function toggleAudio() { if (isPlaying) { stopCurrentAudio(); } else { await playSound(currentSound); } }
        function setVolume(val) { if (gainNode) gainNode.gain.value = val; }
        async function openNoiseModal() {
            if (!(await ensurePremium())) {
                toast('Белый шум и звуки — в Премиуме 🔒', true);
                openProfile();
                return;
            }
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
                    <p class="sleep-hint">Поправь начало и конец записи.</p>
                    <label class="sleep-hint">Начало</label>
                    <input type="datetime-local" id="event-edit-start" class="sleep-time-input">
                    <label class="sleep-hint">Конец</label>
                    <input type="datetime-local" id="event-edit-end" class="sleep-time-input">
                    <button class="btn-save-ml" id="event-edit-save">Сохранить</button>
                </div>`;
            div.addEventListener('click', (ev) => { if (ev.target === div) closeEventEdit(); });
            document.body.appendChild(div);
            document.getElementById('event-edit-save').onclick = saveEventEdit;
        }

        function editEventTime(id, startIso, endIso) {
            ensureEventEditModal();
            editingEventId = id;
            document.getElementById('event-edit-start').value = toLocalInputValue(new Date(startIso));
            document.getElementById('event-edit-end').value = endIso ? toLocalInputValue(new Date(endIso)) : '';
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
            if (eEl && eEl.value) {
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

        async function loadEvents() {
            try {
                let events = [];
                try {
                    const res = await fetch(`${API_URL}/events/history?days=14`, { headers: apiHeaders() });
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
                
                const activeSleep = events.find(e => e.event_type === 'sleep' && !e.end_time);
                const activeAwake = events.find(e => e.event_type === 'awake' && !e.end_time);
                activeWalkId = events.find(e => e.event_type === 'walk' && !e.end_time)?.id || null;

                // Настройка таймеров
                if (activeSleep) {
                    activeSleepId = activeSleep.id;
                    activeSleepStart = activeSleep.start_time;
                    document.getElementById('row-sleep').classList.add('timer-active', 'timer-editable');
                    document.getElementById('row-sleep').onclick = () => openTimerModal('sleep', 'edit');
                    startTimer('timer-sleep', new Date(activeSleep.start_time), 'sleep');
                    document.getElementById('awake-btn').style.background = 'var(--sleep)';
                    document.getElementById('state-text').innerText = 'Разбудить (Спит)';
                    document.getElementById('state-icon').innerText = '🌙';
                } else {
                    activeSleepId = null;
                    activeSleepStart = null;
                    document.getElementById('row-sleep').classList.remove('timer-active', 'timer-editable');
                    document.getElementById('row-sleep').onclick = null;
                    if (timerIntervals.sleep) clearInterval(timerIntervals.sleep);
                    document.getElementById('timer-sleep').textContent = '00:00:00';
                    document.getElementById('awake-btn').style.background = 'var(--awake)';
                    document.getElementById('state-text').innerText = 'Уложить спать';
                    document.getElementById('state-icon').innerText = '👀';
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
                        walkBtn.style.background = 'var(--noise)';
                        walkBtn.style.color = '#111827';
                        document.getElementById('walk-text').innerText = 'Закончить прогулку';
                    }
                } else {
                    activeWalkStart = null;
                    document.getElementById('row-walk').classList.remove('timer-active', 'timer-editable');
                    document.getElementById('row-walk').onclick = null;
                    if (timerIntervals.walk) clearInterval(timerIntervals.walk);
                    document.getElementById('timer-walk').textContent = '00:00:00';
                    if (walkBtn) {
                        walkBtn.style.background = 'var(--card)';
                        walkBtn.style.color = 'var(--text)';
                        document.getElementById('walk-text').innerText = 'Погулять';
                    }
                }

                // Лента
                const lastFeed = events.find(e => e.event_type === 'feed');
                const feedBadge = document.getElementById('last-feed-badge');
                if (lastFeed) {
                    feedBadge.style.display = 'inline-block';
                    feedBadge.textContent = `🍼 Последнее: ${formatDuration(new Date() - new Date(lastFeed.start_time))} назад`;
                } else { feedBadge.style.display = 'none'; }

                const list = document.getElementById('log-list');

                // --- АККОРДЕОН ПО ДНЯМ ---
                const grouped = {};
                const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: tz() });
                const todayKey = dayKey(new Date());
                const labelOf = (key) => new Date(key + 'T12:00:00+03:00')
                    .toLocaleDateString('ru-RU', { timeZone: tz(), day: '2-digit', month: 'long' });

                events.forEach(e => {
                    if ((e.event_type === 'sleep' || e.event_type === 'awake' || e.event_type === 'walk') && !e.end_time) return;
                    const k = dayKey(e.start_time);
                    if (!grouped[k]) grouped[k] = [];
                    grouped[k].push(e);
                });

                let html = '';
                Object.keys(grouped).sort().reverse().forEach(key => {
                    const isToday = key === todayKey;
                    const dateStr = labelOf(key);
                    const open = isToday || expandedDays.has(key);

                    html += `<div class="day-section${isToday ? ' today' : ''}${open ? ' open' : ''}">`;

                    if (isToday) {
                        html += `<div class="log-date-title">Сегодня</div>`;
                    } else {
                        html += `<button type="button" class="log-date-title day-toggle" data-day="${key}" aria-expanded="${open}">`
                            + `<span>📅 ${dateStr}</span><span class="chev" aria-hidden="true">▼</span></button>`;
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
                                ${e.event_type === 'feed' ? `<button class="btn-delete" title="Изменить время" onclick="editFeedTime(${e.id}, '${e.start_time}')">✎</button>` : (e.end_time ? `<button class="btn-delete" title="Изменить время" onclick="editEventTime(${e.id}, '${e.start_time}', '${e.end_time}')">✎</button>` : '')}
                                <button class="btn-delete" onclick="deleteEvent(${e.id})">✕</button>
                            </div>
                        </div>
                    `;
                    });

                    html += `</div></div>`;
                });

                if (html) {
                    if (list.innerHTML !== html) list.innerHTML = html;
                } else {
                    list.innerHTML = '<div class="log-empty">Пока нет записей за две недели</div>';
                }
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

        async function quickEvent(type, details) {
            if (navigator.vibrate) navigator.vibrate(50);
            const body = JSON.stringify({ event_type: type, details: details, client_uuid: newId() });
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

        async function downloadDoctorReport() {
            if (!(await ensurePremium())) {
                toast('Отчёт для врача — в Премиуме 🔒', true);
                openProfile();
                return;
            }
            try {
                toast('Готовлю отчёт…');

                if (!window.jspdf || !window.jspdf.jsPDF) {
                    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
                }
                if (!window.REPORT_FONT_BASE64) {
                    await loadScriptOnce('report-font.js');
                }

                const res = await fetch(`${API_URL}/events/history?days=7`, { headers: apiHeaders() });
                if (handleAuthError(res) || !res.ok) throw new Error('HTTP ' + res.status);
                const events = await res.json();
                if (!Array.isArray(events)) throw new Error('нет данных');

                const today = new Date();
                const rows = [];
                const byDay = {};
                for (let i = 6; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(d.getDate() - i);
                    const key = isoDay(d);
                    const row = { key: key, feeds: 0, volume: 0, sleep: 0, diapers: 0 };
                    byDay[key] = row;
                    rows.push(row);
                }

                events.forEach((e) => {
                    const row = byDay[isoDay(e.start_time)];
                    if (!row) return;
                    if (e.event_type === 'feed') {
                        row.feeds += 1;
                        const ml = parseInt(e.details, 10);
                        if (!isNaN(ml)) row.volume += ml;
                    } else if (e.event_type === 'diaper') {
                        row.diapers += 1;
                    } else if (e.event_type === 'sleep' && e.end_time) {
                        row.sleep += (new Date(e.end_time) - new Date(e.start_time)) / 3600000;
                    }
                });

                const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
                const avgSleep = sum('sleep') / 7;

                const jsPDFCtor = window.jspdf.jsPDF;
                const doc = new jsPDFCtor({ unit: 'mm', format: 'a4' });
                doc.addFileToVFS('report.ttf', window.REPORT_FONT_BASE64);
                doc.addFont('report.ttf', 'Report', 'normal');
                doc.setFont('Report');

                const fmt = (d) => d.toLocaleDateString('ru-RU');
                const first = new Date(today);
                first.setDate(first.getDate() - 6);

                doc.setFontSize(18);
                doc.text('Отчёт о ребёнке', 15, 20);
                doc.setFontSize(10);
                doc.setTextColor(110);
                doc.text(`Период: ${fmt(first)} — ${fmt(today)}`, 15, 27);
                doc.setTextColor(0);

                doc.setFontSize(13);
                doc.text('Итоги за неделю', 15, 42);
                doc.setFontSize(10);
                const summary = [
                    `Сон в среднем: ${avgSleep.toFixed(1)} ч в сутки`,
                    `Кормлений: ${sum('feeds')} (в среднем ${(sum('feeds') / 7).toFixed(1)} в сутки)`,
                    `Объём смеси: ${sum('volume')} мл (в среднем ${Math.round(sum('volume') / 7)} мл в сутки)`,
                    `Подгузников: ${sum('diapers')}`
                ];
                let y = 50;
                summary.forEach((line) => {
                    doc.text(line, 15, y);
                    y += 6;
                });

                y += 8;
                doc.setFontSize(13);
                doc.text('По дням', 15, y);
                y += 9;

                doc.setFontSize(9);
                const cols = [15, 42, 78, 112, 148];
                const header = ['Дата', 'Кормлений', 'Смесь, мл', 'Сон, ч', 'Подгузники'];
                header.forEach((h, i) => doc.text(h, cols[i], y));
                y += 3;
                doc.line(15, y, 195, y);
                y += 6;

                rows.forEach((r) => {
                    const label = new Date(r.key + 'T12:00:00+03:00')
                        .toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                    doc.text(label, cols[0], y);
                    doc.text(String(r.feeds), cols[1], y);
                    doc.text(String(r.volume), cols[2], y);
                    doc.text(r.sleep.toFixed(1), cols[3], y);
                    doc.text(String(r.diapers), cols[4], y);
                    y += 6;
                });

                y += 8;
                doc.setFontSize(8);
                doc.setTextColor(130);
                doc.text('Отчёт сформирован автоматически в приложении «Трекер малыша».', 15, y);
                doc.text('Не является медицинским заключением.', 15, y + 4);

                doc.save('otchet-' + new Date().toISOString().slice(0, 10) + '.pdf');
                toast('Отчёт готов');
            } catch (e) {
                console.error('PDF:', e);
                toast('Не удалось сформировать отчёт', true);
            }
        }



        // ===== ПРОФИЛЬ / ЛК «ЛАД» =====
        const LAD_TOKEN_KEY = 'lad_token';
        let ladLoginCode = null;
        let ladLoginUrl = '';
        let ladPollTimer = null;

        function ladToken() {
            try { return localStorage.getItem(LAD_TOKEN_KEY) || ''; } catch (e) { return ''; }
        }

        function ladStatus(text) {
            ['profile-status', 'login-status'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.textContent = text || '';
            });
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
            document.getElementById('profile-modal').style.display = 'flex';
            loadProfile();
        }

        function closeProfileModal(e) {
            if (!e || e.target.id === 'profile-modal') {
                document.getElementById('profile-modal').style.display = 'none';
            }
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
                try { localStorage.removeItem(LAD_TOKEN_KEY); } catch (err) {}
                login.style.display = 'block';
                me.style.display = 'none';
            }
        }

        let ladProfile = null;
        let childGender = 'girl';
        let familyPremium = null;

        async function ensurePremium() {
            if (familyPremium !== null) return familyPremium;
            try {
                if (!ladToken() && !apiToken()) { familyPremium = false; return false; }
                const res = await fetch(`${API_URL}/billing/status`, {
                    headers: apiHeaders()
                });
                const d = await res.json().catch(function () { return {}; });
                familyPremium = !!d.active;
            } catch (e) {
                familyPremium = false;
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

        // ===== ПОДПИСКА =====
        async function loadBilling() {
            if (!ladToken() && !apiToken()) return;
            loadReminders();
            try {
                const res = await fetch(`${API_URL}/billing/status`, {
                    headers: apiHeaders()
                });
                if (!res.ok) {
                    const el = document.getElementById('plan-status');
                    if (el) el.textContent = 'http ' + res.status;
                    return;
                }
                const d = await res.json();
                const name = document.getElementById('plan-name');
                const until = document.getElementById('plan-until');
                const btn = document.getElementById('plan-btn');
                const st = document.getElementById('plan-status');
                if (!name || !btn) return;
                familyPremium = !!d.active;

                // Сначала то, что видит человек: надпись и дата.
                name.textContent = d.active ? 'Премиум' : 'Бесплатная';
                let untilText = '';
                if (d.active && d.plan_until) {
                    try { untilText = 'до ' + new Date(d.plan_until).toLocaleDateString('ru-RU'); } catch (e) {}
                }
                until.textContent = untilText;
                if (st) st.textContent = 'dbg a=' + d.active + ' p=' + d.plan + ' f=' + d.family_id + ' c=' + d.configured;

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

                if (btn) {
                    btn.textContent = 'Оформить за ' + d.price_rub + ' ₽';
                    btn.style.display = (d.configured && !d.active) ? '' : 'none';
                }
            } catch (e) {
                const el = document.getElementById('plan-status');
                if (el) el.textContent = 'err ' + (e && e.message ? e.message : 'fetch');
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
