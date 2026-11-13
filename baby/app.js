        // УМНАЯ ТЕМА (темная по умолчанию)
        const currentHour = new Date().getHours();
        const theme = (currentHour >= 9 && currentHour < 19) ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);

        const API_URL = 'https://telegram-bot-zakharsakharov.msk1.amvera.tech/api/baby';

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
        let activeAwakeId = null;
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
            if (viewName === 'analytics') loadAnalytics();
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
                        headers: { 'Content-Type': 'application/json' },
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
            const offline = !navigator.onLine;
            if (!pending && !offline) { el.style.display = 'none'; el.textContent = ''; return; }
            el.style.display = 'inline-block';
            el.textContent = offline
                ? (pending ? `📴 офлайн · ${pending} в очереди` : '📴 офлайн')
                : `⏳ ждут отправки: ${pending}`;
        }

        window.addEventListener('online', () => { renderStatus(); flushQueue(); });
        window.addEventListener('offline', renderStatus);

        function exportData() {
            const payload = {
                app: 'baby-tracker',
                exported_at: new Date().toISOString(),
                events: cachedEvents(),
                appointments: window.__lastAppointments || [],
                pending: readJSON(QUEUE_KEY, [])
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'baby-backup-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast(`Экспортировано записей: ${payload.events.length}`);
        }

        // --- SOS ---
        async function sendSOS() {
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
            try {
                await fetch(`${API_URL}/sos`, { method: 'POST', headers: apiHeaders() });
                toast("🆘 SOS отправлен!");
            } catch(e) { toast("Ошибка отправки SOS", true); }
        }

        // --- КОРМЛЕНИЕ ---
        function openFeedModal() { document.getElementById('feed-modal').style.display = 'flex'; }
        function closeFeedModal(e) { if (!e || e.target.id === 'feed-modal') document.getElementById('feed-modal').style.display = 'none'; }
        async function saveFeedVolume() {
            const ml = document.getElementById('ml-slider').value;
            closeFeedModal();
            if (navigator.vibrate) navigator.vibrate(50);
            const body = JSON.stringify({ event_type: 'feed', details: ml + ' мл', client_uuid: newId() });
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

        // --- АУДИО ---
        let audioCtx = null, gainNode = null, currentSource = null;
        let audioBuffers = {}, isPlaying = false, currentSound = 'white', isAudioLoading = false;
        const sounds = { 'white': 'sounds/white.mp3', 'rain': 'sounds/rain.mp3', 'womb': 'sounds/womb.mp3', 'heart': 'sounds/heart.mp3' };
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
        function openNoiseModal() { document.getElementById('noise-modal').style.display = 'flex'; }
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

        async function toggleSleepAwake() {
            if (activeSleepId) {
                // Если спит — будим (гуляние не трогаем)
                await fetch(`${API_URL}/events/${activeSleepId}/stop`, { method: 'POST', headers: apiHeaders() });
                await fetch(`${API_URL}/events/start`, { method: 'POST', headers: apiHeaders(true), body: JSON.stringify({event_type: 'awake'}) });
            } else {
                // Укладываем спать (гуляние не трогаем)
                if (activeAwakeId) await fetch(`${API_URL}/events/${activeAwakeId}/stop`, { method: 'POST', headers: apiHeaders() });
                await fetch(`${API_URL}/events/start`, { method: 'POST', headers: apiHeaders(true), body: JSON.stringify({event_type: 'sleep'}) });
            }
            loadEvents();
        }

        async function toggleWalk() {
            if (activeWalkId) {
                // Если гуляет — просто заканчиваем прогулку (остальное не трогаем)
                await fetch(`${API_URL}/events/${activeWalkId}/stop`, { method: 'POST', headers: apiHeaders() });
            } else {
                // Начинаем прогулку (сон или бодрствование не трогаем)
                await fetch(`${API_URL}/events/start`, { method: 'POST', headers: apiHeaders(true), body: JSON.stringify({event_type: 'walk'}) });
            }
            loadEvents();
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
                    if (events.length) toast("Нет связи — показаны сохранённые записи", true);
                }
                renderStatus();
                
                const activeSleep = events.find(e => e.event_type === 'sleep' && !e.end_time);
                const activeAwake = events.find(e => e.event_type === 'awake' && !e.end_time);
                activeWalkId = events.find(e => e.event_type === 'walk' && !e.end_time)?.id || null;

                // Настройка таймеров
                if (activeSleep) {
                    activeSleepId = activeSleep.id;
                    document.getElementById('row-sleep').classList.add('timer-active');
                    startTimer('timer-sleep', new Date(activeSleep.start_time), 'sleep');
                    document.getElementById('awake-btn').style.background = 'var(--sleep)';
                    document.getElementById('state-text').innerText = 'Разбудить (Спит)';
                    document.getElementById('state-icon').innerText = '🌙';
                } else {
                    activeSleepId = null;
                    document.getElementById('row-sleep').classList.remove('timer-active');
                    if (timerIntervals.sleep) clearInterval(timerIntervals.sleep);
                    document.getElementById('awake-btn').style.background = 'var(--awake)';
                    document.getElementById('state-text').innerText = 'Уложить спать';
                    document.getElementById('state-icon').innerText = '👀';
                }

                if (activeAwake) {
                    activeAwakeId = activeAwake.id;
                    document.getElementById('row-awake').classList.add('timer-active');
                    startTimer('timer-awake', new Date(activeAwake.start_time), 'awake');
                } else {
                    activeAwakeId = null;
                    document.getElementById('row-awake').classList.remove('timer-active');
                    if (timerIntervals.awake) clearInterval(timerIntervals.awake);
                }

                const walkBtn = document.getElementById('walk-btn');
                if (activeWalkId) {
                    document.getElementById('row-walk').classList.add('timer-active');
                    startTimer('timer-walk', new Date(events.find(e=>e.id===activeWalkId).start_time), 'walk');
                    if (walkBtn) {
                        walkBtn.style.background = 'var(--noise)';
                        walkBtn.style.color = '#111827';
                        document.getElementById('walk-text').innerText = 'Закончить прогулку';
                    }
                } else {
                    document.getElementById('row-walk').classList.remove('timer-active');
                    if (timerIntervals.walk) clearInterval(timerIntervals.walk);
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
                const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
                const todayKey = dayKey(new Date());
                const labelOf = (key) => new Date(key + 'T12:00:00+03:00')
                    .toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'long' });

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
                    const timeOptions = { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' };
                    timeStr = startTime.toLocaleTimeString('ru-RU', timeOptions);

                    if (e.event_type === 'sleep' && e.end_time) {
                        icon = "🌙"; name = "Спала";
                        const endTime = new Date(e.end_time);
                        sub = `${timeStr} - ${endTime.toLocaleTimeString('ru-RU', timeOptions)}`;
                        badge = formatDuration(endTime - startTime);
                        timeStr = "";
                    }
                    else if (e.event_type === 'awake' && e.end_time) {
                        icon = "👀"; name = "Бодрствовала";
                        const endTime = new Date(e.end_time);
                        sub = `${timeStr} - ${endTime.toLocaleTimeString('ru-RU', timeOptions)}`;
                        badge = formatDuration(endTime - startTime);
                        timeStr = "";
                    }
                    else if (e.event_type === 'feed') { icon = "🍼"; name = "Покушала"; sub = e.details || "Бутылочка"; }
                    else if (e.event_type === 'diaper') { const det = e.details || ''; icon = det.includes('Пописиюлькала') ? "💦" : "💩"; name = det || "Подгузник"; sub = ""; }
                    else if (e.event_type === 'walk' && e.end_time) {
                        icon = "🚶‍♀️"; name = "Гуляла";
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
            function update() {
                const diff = Math.floor((new Date() - startTime) / 1000);
                display.textContent = `${String(Math.floor(diff / 3600)).padStart(2, '0')}:${String(Math.floor((diff % 3600) / 60)).padStart(2, '0')}:${String(diff % 60).padStart(2, '0')}`;
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
                
                const todayStr = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
                let todayFeeds = 0;
                let todayVolume = 0;
                let todaySleepMs = 0;

                // Считаем карточки за сегодня
                events.forEach(e => {
                    const d = new Date(e.start_time).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
                    if (d === todayStr) {
                        if (e.event_type === 'feed') { todayFeeds++; const ml = parseInt(e.details); if (!isNaN(ml)) todayVolume += ml; }
                        if (e.event_type === 'sleep' && e.end_time) { todaySleepMs += (new Date(e.end_time) - new Date(e.start_time)); }
                    }
                });

                document.getElementById('stat-feeds').textContent = todayFeeds;
                document.getElementById('stat-sleep').textContent = formatDuration(todaySleepMs);
                document.getElementById('stat-volume').textContent = todayVolume;

                const days = [];
                const feedsByDay = {};
                const diapersByDay = {};
                const sleepByDay = {};
                const awakeByDay = {};
                const walkByDay = {};
                const volumeByDay = {};

                for (let i = 6; i >= 0; i--) {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    const dateStr = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
                    days.push(dateStr);
                    feedsByDay[dateStr] = 0;
                    diapersByDay[dateStr] = 0;
                    sleepByDay[dateStr] = 0;
                    awakeByDay[dateStr] = 0;
                    walkByDay[dateStr] = 0;
                    volumeByDay[dateStr] = 0;
                }

                // Считаем графики по дням
                events.forEach(e => {
                    const dateStr = new Date(e.start_time).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
                    if (feedsByDay[dateStr] !== undefined) {
                        if (e.event_type === 'feed') { 
                            feedsByDay[dateStr]++; 
                            const ml = parseInt(e.details); if (!isNaN(ml)) volumeByDay[dateStr] += ml; 
                        }
                        if (e.event_type === 'diaper') diapersByDay[dateStr]++;
                        
                        if (e.end_time) {
                            const hours = (new Date(e.end_time) - new Date(e.start_time)) / (1000 * 60 * 60);
                            if (e.event_type === 'sleep') sleepByDay[dateStr] += hours;
                            if (e.event_type === 'awake') awakeByDay[dateStr] += hours;
                            if (e.event_type === 'walk') walkByDay[dateStr] += hours;
                        }
                    }
                });

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

        const isoDay = (value) => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

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
                        timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false
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

        loadEvents();
        loadAppointments();
        renderStatus();
        flushQueue();
        if (!apiToken()) {
            setTimeout(openTokenModal, 600);
        }
        setInterval(() => { if (document.visibilityState === 'visible') loadEvents(); }, 30000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadEvents(); });
