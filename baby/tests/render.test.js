/**
 * Тест рендера ленты без браузера.
 *
 * Запуск:  node tests/render.test.js
 * Зависимостей нет — используется встроенный в Node.js мини-DOM-стаб.
 *
 * Ловит регрессии класса «лента пустая из-за исключения в рендере»:
 * именно так в ноябре 2026 пропали все записи при непрерывном обновлении.
 */
const fs = require('fs');
const path = require('path');

// можно передать путь к другому файлу: node tests/render.test.js /tmp/x.js
const APP = process.argv[2] || path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

// ---- синтетические данные: никакой реальной информации о ребёнке ----
const now = new Date();
const iso = (d) => d.toISOString();
const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);

const events = [
  { id: 101, event_type: 'sleep', start_time: iso(hoursAgo(6)), end_time: iso(hoursAgo(5)), details: null },
  { id: 102, event_type: 'awake', start_time: iso(hoursAgo(5)), end_time: iso(hoursAgo(4)), details: null },
  { id: 103, event_type: 'feed', start_time: iso(hoursAgo(4)), end_time: iso(hoursAgo(4)), details: '120 мл' },
  { id: 104, event_type: 'diaper', start_time: iso(hoursAgo(3)), end_time: iso(hoursAgo(3)), details: 'Пописиюлькала' },
  { id: 105, event_type: 'diaper', start_time: iso(hoursAgo(3)), end_time: iso(hoursAgo(3)), details: null },
  { id: 106, event_type: 'walk', start_time: iso(hoursAgo(2)), end_time: iso(hoursAgo(1)), details: null },
  { id: 107, event_type: 'sleep', start_time: iso(hoursAgo(1)), end_time: null, details: null },
  // событие вчерашнего дня — должно попасть в свёрнутую секцию
  { id: 201, event_type: 'feed', start_time: iso(hoursAgo(30)), end_time: iso(hoursAgo(30)), details: '90 мл' },
  { id: 202, event_type: 'diaper', start_time: iso(hoursAgo(31)), end_time: iso(hoursAgo(31)), details: 'Пописиюлькала' }
];

// ---- мини-DOM ----
const elements = {};
const errors = [];

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {},
    remove() {},
    addEventListener() {},
    getContext() { return {}; },
    querySelectorAll() { return []; },
    setAttribute() {},
    focus() {}
  };
}
const getEl = (id) => (elements[id] = elements[id] || makeEl(id));

global.document = {
  getElementById: getEl,
  querySelectorAll: () => [],
  querySelector: () => null,
  documentElement: { getAttribute: () => 'dark', setAttribute() {} },
  addEventListener() {},
  createElement: (tag) => makeEl(tag),
  body: { appendChild() {} },
  head: { appendChild() {} },
  visibilityState: 'visible'
};
global.window = {
  addEventListener() {},
  matchMedia: () => ({ matches: false }),
  crypto: { randomUUID: () => 'test-uuid' },
  location: { search: '', pathname: '/baby/' },
  history: { replaceState() {} }
};
global.navigator = { onLine: true, vibrate: () => {} };
global.localStorage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};
global.setInterval = () => 0;
global.clearInterval = () => {};
global.Chart = function () { return { destroy() {} }; };
global.confirm = () => false;
global.alert = () => {};
global.fetch = async (url) => {
  const u = String(url);
  const body = (u.includes('events/today') || u.includes('events/week') || u.includes('events/history')) ? events : [];
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
};

const realError = console.error;
console.error = (...args) => errors.push(args.join(' '));

try {
  eval(source);
} catch (e) {
  errors.push('EVAL: ' + e.message);
}

setTimeout(async () => {
  console.error = realError;

  // --- аналитика: считаем агрегаты и корреляции на тех же данных ---
  let analyticsOk = false;
  let analyticsDetail = '';
  try {
    await loadAnalytics();
    const feeds = elements['an-feeds'] ? elements['an-feeds'].textContent : '';
    const sleep = elements['an-sleep'] ? elements['an-sleep'].textContent : '';
    analyticsOk = feeds !== '' && feeds !== '0' && sleep !== '' && sleep !== '0ч';
    analyticsDetail = `кормлений/день=${feeds}, сна/день=${sleep}`;
  } catch (e) {
    analyticsDetail = e.message;
  }

  const html = elements['log-list'] ? elements['log-list'].innerHTML : '';
  const count = (re) => (html.match(re) || []).length;

  // активные события (без end_time) в ленту не попадают
  const expectedItems = events.filter(e =>
    !((e.event_type === 'sleep' || e.event_type === 'awake' || e.event_type === 'walk') && !e.end_time)
  ).length;

  const checks = [
    ['рендер не упал', errors.length === 0, errors.join(' | ')],
    ['лента не пуста', count(/class="log-item"/g) > 0, `записей: ${count(/class="log-item"/g)}`],
    ['все завершённые события отрисованы', count(/class="log-item"/g) === expectedItems, `ожидалось ${expectedItems}, получено ${count(/class="log-item"/g)}`],
    ['две секции по дням', count(/class="day-section/g) === 2, `секций: ${count(/class="day-section/g)}`],
    ['сегодняшняя секция раскрыта', count(/day-section today open/g) === 1, `найдено: ${count(/day-section today open/g)}`],
    ['вчерашняя секция сворачиваемая', count(/class="log-date-title day-toggle"/g) === 1, `кнопок: ${count(/class="log-date-title day-toggle"/g)}`],
    ['вчерашняя секция закрыта', count(/aria-expanded="false"/g) === 1, `найдено: ${count(/aria-expanded="false"/g)}`],
    ['удаление доступно по id', /onclick="deleteEvent\(\d+\)"/.test(html), 'нет обработчика удаления'],
    ['аналитика посчитана', analyticsOk, analyticsDetail]
  ];

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (ok) {
      console.log(`  ok   ${name}`);
    } else {
      failed++;
      console.log(`  FAIL ${name} — ${detail}`);
    }
  }

  console.log(failed === 0 ? '\nВсе проверки пройдены.' : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}, 400);
