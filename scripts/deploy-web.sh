#!/usr/bin/env bash
# 构建并部署 payments 管理端静态站
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

WEB_ROOT="$PAYMENTS_ROOT/web"
TAR=/tmp/payments-web-${DEPLOY_ENV}-dist.tar.gz

payments_banner "构建 payments-web (mode=$WEB_BUILD_MODE)"
cd "$WEB_ROOT"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  corepack enable 2>/dev/null || true
  export CI=true
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  pnpm exec vite build --mode "$WEB_BUILD_MODE"
else
  echo "(i) SKIP_BUILD=1"
fi

if [[ ! -f "$WEB_ROOT/dist/index.html" ]]; then
  echo "Missing $WEB_ROOT/dist/index.html" >&2
  exit 1
fi

payments_banner "打包 dist"
COPYFILE_DISABLE=1 tar -czf "$TAR" -C "$WEB_ROOT/dist" .

payments_banner "上传 → $HOST"
payments_scp "$TAR" "$HOST:/tmp/payments-web-dist.tar.gz"

payments_banner "服务器解压 + Nginx 扩展 ($WEB_DOMAIN)"
payments_ssh \
  "WEB_DEPLOY_DIR='$WEB_DEPLOY_DIR' WEB_DOMAIN='$WEB_DOMAIN' API_UPSTREAM='$API_UPSTREAM' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$WEB_DEPLOY_DIR"
find "$WEB_DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name '.well-known' ! -name '.user.ini' -exec rm -rf {} +
tar xzf /tmp/payments-web-dist.tar.gz -C "$WEB_DEPLOY_DIR"
find "$WEB_DEPLOY_DIR" -mindepth 1 ! -name '.user.ini' ! -path "$WEB_DEPLOY_DIR/.well-known/*" \
  -exec chown -h www:www {} + 2>/dev/null || true
rm -f /tmp/payments-web-dist.tar.gz

EXT_DIR="/www/server/panel/vhost/nginx/extension/$WEB_DOMAIN"
mkdir -p "$EXT_DIR"

cat > "$EXT_DIR/spa-cache.conf" <<'NGINX'
location = /index.html {
  add_header Cache-Control "no-cache, no-store, must-revalidate" always;
  add_header Pragma "no-cache" always;
  add_header Expires "0" always;
}
NGINX

rm -f "$EXT_DIR/spa-fallback.conf"
cat > "$EXT_DIR/proxy-api.conf" <<NGINX
location ^~ /api/ {
  proxy_pass ${API_UPSTREAM};
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
  client_max_body_size 60m;
  proxy_read_timeout 120s;
  proxy_send_timeout 120s;
}
NGINX

nginx -t
nginx -s reload

code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 "https://$WEB_DOMAIN/" || echo 000)
echo "GET https://$WEB_DOMAIN/ -> $code"
REMOTE

echo "=== done: https://$WEB_DOMAIN ==="
