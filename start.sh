#!/usr/bin/env bash
# === Lumen 路径追踪器 启动脚本（Git Bash / macOS / Linux）===
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "[错误] 未找到 Node.js，请先安装：https://nodejs.org"; exit 1; }

PORT="${PORT:-8081}"
URL="http://localhost:${PORT}/"

open_url() {
  if command -v cygstart >/dev/null 2>&1; then cygstart "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  elif command -v open >/dev/null 2>&1; then open "$1"
  else cmd //c start "" "$1" 2>/dev/null || powershell -c "Start-Process '$1'" 2>/dev/null; fi
}

echo "=== Lumen 路径追踪器 ==="
echo "启动本地静态服务器 ${URL} ..."
( sleep 1; open_url "$URL" ) &
node "$(dirname "$0")/serve.js" "$PORT"
