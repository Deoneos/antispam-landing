#!/bin/bash
# Деплой приложения «Лад» из репозитория на RU-сервер.
# Использование: ./deploy-lad.sh [версия]
set -euo pipefail

cd "$(dirname "$0")"
KEY=/home/telegram/.ssh/id_ed25519_vps
RU=root@212.192.248.48
SRC=baby/
DST=/var/www/lad/baby/

if [ ! -f baby/app.js ] || [ ! -f baby/index.html ]; then
  echo "нет baby/app.js или baby/index.html"; exit 1
fi

# 1) версия для сброса кэша
if [ $# -ge 1 ]; then
  VER="$1"
else
  CUR=$(grep -o 'app\.js?v=[0-9]*' baby/index.html | head -1 | cut -d= -f2)
  VER=$(( ${CUR:-0} + 1 ))
fi
echo "$VER" > baby/version.txt
sed -i "s/app\.js?v=[0-9]*/app.js?v=$VER/" baby/index.html
# версия CSS тоже сбрасывает кэш
CSSV=$(grep -o 'styles\.css?v=[0-9]*' baby/index.html | head -1 | cut -d= -f2)
sed -i "s/styles\.css?v=[0-9]*/styles.css?v=$(( ${CSSV:-0} + 1 ))/" baby/index.html
grep -o "app.js?v=$VER" baby/index.html
grep -o 'styles.css?v=[0-9]*' baby/index.html

# 2) копируем на RU
rsync -az --exclude '*.bak*' --exclude '__pycache__' -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  "$SRC" "$RU:$DST"
echo "скопировано на RU"

# 3) проверка
sleep 1
code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://baby.kustos.ru/baby/)
echo "сайт: $code"
live=$(curl -s -m 10 https://baby.kustos.ru/baby/ | grep -o 'app.js?v=[0-9]*' | head -1)
echo "версия на сайте: $live"
js=$(curl -s -m 15 -o /dev/null -w "%{http_code}" https://baby.kustos.ru/baby/app.js)
echo "app.js: $js"

if [ "$code" = "200" ] && [ "$js" = "200" ]; then
  git add baby/index.html 2>/dev/null || true
  git commit -m "deploy(baby): v$VER" 2>/dev/null | tail -1 || true
  echo "OK"
else
  echo "ПРОВЕРКА НЕ ПРОШЛА"; exit 1
fi
