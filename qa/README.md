# QA «Лада»

Быстрый smoke-тест перед деплоем. Не требует зависимостей, запускается на VM.

```bash
cd /home/telegram/antispam-landing
python3 qa/baby_smoke.py
python3 qa/baby_smoke.py --url https://baby.kustos.ru/baby/

# --api запускать там, где доступен /health:
# на сервере API или с любым доступным URL.
python3 qa/baby_smoke.py --api http://127.0.0.1:8091/health
```

Что проверяет:

- наличие `index.html`, `app.js`, `styles.css`, `version.txt`;
- дубли `id` и обязательные элементы (таймеры, вода, nudge, push-онбординг);
- что старые auth-элементы и функции не вернулись;
- что все `getElementById(...)` ссылаются на существующие элементы
  (динамические `event-edit-*` — в allowlist);
- синтаксис `app.js` через `node --check`;
- версию в `version.txt` и `app.js?v=`;
- манифест, scope `/baby/`, базовые ассеты;
- опционально `/health` API и живую страницу.

## Перед деплоем

1. Поднять версию в `index.html`, `version.txt`, `sw.js` при необходимости.
2. `python3 qa/baby_smoke.py --url https://baby.kustos.ru/baby/`
3. `./deploy-lad.sh <version>`
4. Повторить smoke с `--url` уже после деплоя.
5. Для API — отдельно проверить `/health` на сервере API.
