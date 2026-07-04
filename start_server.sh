#!/bin/sh
cd "$(dirname "$0")"

PORT=18440
CERT=/etc/letsencrypt/live/narnialab.duckdns.org/fullchain.pem
KEY=/etc/letsencrypt/live/narnialab.duckdns.org/privkey.pem

if [ -f server.pid ]; then
  PGID=$(ps -o pgid= -p "$(cat server.pid)" 2>/dev/null | tr -d ' ')
  [ -n "$PGID" ] && kill -- -"$PGID" 2>/dev/null
  kill -9 "$(cat server.pid)" 2>/dev/null
  rm -f server.pid
fi

lsof -t -i:$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 3
lsof -t -i:$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

if [ ! -d node_modules ]; then
  npm install --silent
fi

npm run build
if [ $? -ne 0 ]; then
  echo "빌드 실패"
  exit 1
fi

# /appinfo 경로는 서비스워커가 가로채지 않도록 SW에 denylist 패치
sed -i 's|e\.registerRoute(new e\.NavigationRoute(e\.createHandlerBoundToURL("index\.html")))|e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[/^\\/appinfo/]}))|g' dist/sw.js

setsid env SSL_CERT="$CERT" SSL_KEY="$KEY" PORT="$PORT" node server.js > server.log 2>&1 &
echo $! > server.pid
sleep 3

echo "========================================="
echo "서버 실행 완료: https://narnialab.duckdns.org:$PORT"
echo "========================================="
