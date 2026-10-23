#!/usr/bin/env bash
# 构建并部署 payments-admin-service → PM2 + API 域名
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

API_ROOT="$PAYMENTS_ROOT/api/services/payments-admin-service"
TAR=/tmp/payments-api-${DEPLOY_ENV}-dist.tar.gz
ENV_UPLOAD="$API_ROOT/$API_ENV_FILE"
ENV_PROD_EXAMPLE="$API_ROOT/.env.production.example"

payments_banner "构建 payments-admin-service"
cd "$API_ROOT"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  corepack enable 2>/dev/null || true
  export CI=true
  if [[ -f pnpm-lock.yaml ]]; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  else
    npm install
  fi
  npm run build
else
  echo "(i) SKIP_BUILD=1"
fi

if [[ ! -f "$API_ROOT/dist/main.js" ]]; then
  echo "Missing $API_ROOT/dist/main.js" >&2
  exit 1
fi

payments_banner "打包 dist + package 元数据"
COPYFILE_DISABLE=1 tar -czf "$TAR" \
  -C "$API_ROOT" \
  dist \
  package.json \
  ecosystem.config.cjs \
  $( [[ -f pnpm-lock.yaml ]] && echo pnpm-lock.yaml || true ) \
  $( [[ -f package-lock.json ]] && echo package-lock.json || true )

payments_banner "上传 → $HOST"
payments_scp "$TAR" "$HOST:/tmp/payments-api-dist.tar.gz"
if [[ "${UPLOAD_ENV:-0}" == "1" ]]; then
  if [[ -f "$ENV_UPLOAD" ]]; then
    echo "(i) UPLOAD_ENV=1 — 上传 ${API_ENV_FILE}（含密钥，慎用）"
    payments_scp "$ENV_UPLOAD" "$HOST:/tmp/payments-api.env"
  elif [[ -f "$API_ROOT/.env" ]]; then
    echo "(i) UPLOAD_ENV=1 — 回退上传本地 .env"
    payments_scp "$API_ROOT/.env" "$HOST:/tmp/payments-api.env"
  fi
elif [[ -f "$ENV_PROD_EXAMPLE" ]]; then
  payments_scp "$ENV_PROD_EXAMPLE" "$HOST:/tmp/payments-api.env.example"
fi

payments_banner "服务器安装 + PM2 + Nginx ($API_DOMAIN / $PM2_APP_NAME)"
payments_ssh \
  "API_DEPLOY_DIR='$API_DEPLOY_DIR' API_DOMAIN='$API_DOMAIN' API_PORT='$API_PORT' API_UPSTREAM='$API_UPSTREAM' PM2_APP_NAME='$PM2_APP_NAME' UPLOAD_ENV='${UPLOAD_ENV:-0}' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$API_DEPLOY_DIR" /www/wwwlogs

KEEP_ENV=""
if [[ "${UPLOAD_ENV:-0}" != "1" && -f "$API_DEPLOY_DIR/.env" ]]; then
  KEEP_ENV=$(mktemp)
  cp "$API_DEPLOY_DIR/.env" "$KEEP_ENV"
fi

find "$API_DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name '.well-known' ! -name '.user.ini' ! -name '.env' -exec rm -rf {} +
tar xzf /tmp/payments-api-dist.tar.gz -C "$API_DEPLOY_DIR"
rm -f /tmp/payments-api-dist.tar.gz

if [[ "${UPLOAD_ENV:-0}" == "1" && -f /tmp/payments-api.env ]]; then
  mv /tmp/payments-api.env "$API_DEPLOY_DIR/.env"
elif [[ -n "$KEEP_ENV" && -f "$KEEP_ENV" ]]; then
  mv "$KEEP_ENV" "$API_DEPLOY_DIR/.env"
elif [[ ! -f "$API_DEPLOY_DIR/.env" && -f /tmp/payments-api.env.example ]]; then
  cp /tmp/payments-api.env.example "$API_DEPLOY_DIR/.env"
  echo "(!) 已写入 .env.example 模板，请编辑 $API_DEPLOY_DIR/.env 后重启 PM2"
fi
rm -f /tmp/payments-api.env /tmp/payments-api.env.example
[[ -n "$KEEP_ENV" ]] && rm -f "$KEEP_ENV" || true

cd "$API_DEPLOY_DIR"
if command -v pnpm >/dev/null 2>&1 && [[ -f pnpm-lock.yaml ]]; then
  pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod
elif command -v npm >/dev/null 2>&1; then
  npm install --omit=dev
else
  echo "node package manager missing" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

export PM2_APP_NAME
pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
PM2_APP_NAME="$PM2_APP_NAME" pm2 start ecosystem.config.cjs
pm2 save

EXT_DIR="/www/server/panel/vhost/nginx/extension/$API_DOMAIN"
mkdir -p "$EXT_DIR"
rm -f "$EXT_DIR/proxy-api.conf"

nginx -t
nginx -s reload

sleep 1
local_code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://127.0.0.1:${API_PORT}/api/health" || echo 000)
pub_code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 "https://$API_DOMAIN/api/health" || echo 000)
echo "GET http://127.0.0.1:${API_PORT}/api/health -> $local_code"
echo "GET https://$API_DOMAIN/api/health -> $pub_code"
pm2 show "$PM2_APP_NAME" | head -25 || true
REMOTE

echo "=== done: https://$API_DOMAIN ==="
echo "提示：UPLOAD_ENV=1 可上传 ${API_ENV_FILE}；PM2 进程名 ${PM2_APP_NAME}"
