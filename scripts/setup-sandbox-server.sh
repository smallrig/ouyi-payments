#!/usr/bin/env bash
# 在服务器上初始化 Sandbox 站点 + 测试库（幂等）
# 用法（本机）：./scripts/setup-sandbox-server.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

export DEPLOY_ENV=sandbox
payments_apply_env

WEB_D=payments-sandbox.ouyishop.com
API_D=payments-sandbox-api.ouyishop.com
DB_NAME=yxshop_paypal_sandbox
API_PORT=3026

payments_banner "创建 Postgres 测试库 $DB_NAME"
payments_ssh bash -s <<REMOTE
set -euo pipefail
docker exec payments-postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || docker exec payments-postgres psql -U postgres -c "CREATE DATABASE $DB_NAME;"
docker exec payments-postgres psql -U postgres -c "\\l $DB_NAME"
REMOTE

payments_banner "写入 Nginx 站点配置（HTTP，随后申请证书）"
payments_ssh bash -s <<'REMOTE'
set -euo pipefail
WEB_D=payments-sandbox.ouyishop.com
API_D=payments-sandbox-api.ouyishop.com
API_PORT=3026

mkdir -p /www/wwwroot/$WEB_D /www/wwwroot/$API_D \
  /www/server/panel/vhost/nginx/extension/$WEB_D \
  /www/server/panel/vhost/nginx/extension/$API_D \
  /www/server/panel/vhost/nginx/well-known \
  /www/wwwlogs

# well-known 占位（宝塔 ACME）
for d in $WEB_D $API_D; do
  cat > /www/server/panel/vhost/nginx/well-known/$d.conf <<EOF
location ~ \\.well-known {
  allow all;
}
EOF
done

# Web SPA
cat > /www/server/panel/vhost/nginx/$WEB_D.conf <<EOF
server
{
    listen 80;
    server_name $WEB_D;
    index index.html;
    root /www/wwwroot/$WEB_D;
    include /www/server/panel/vhost/nginx/extension/$WEB_D/*.conf;
    include /www/server/panel/vhost/nginx/well-known/$WEB_D.conf;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    access_log  /www/wwwlogs/$WEB_D.log;
    error_log   /www/wwwlogs/$WEB_D.error.log;
}
EOF

# API reverse proxy
cat > /www/server/panel/vhost/nginx/$API_D.conf <<EOF
server
{
    listen 80;
    server_name $API_D;
    index index.html;
    root /www/wwwroot/$API_D;
    include /www/server/panel/vhost/nginx/extension/$API_D/*.conf;
    include /www/server/panel/vhost/nginx/well-known/$API_D.conf;

    location / {
      proxy_pass http://127.0.0.1:$API_PORT;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      client_max_body_size 60m;
      proxy_read_timeout 120s;
      proxy_send_timeout 120s;
    }

    access_log  /www/wwwlogs/$API_D.log;
    error_log   /www/wwwlogs/$API_D.error.log;
}
EOF

nginx -t
nginx -s reload
echo "nginx HTTP vhosts ready"
REMOTE

payments_banner "尝试申请 Let's Encrypt 证书（域名须已解析到本机）"
payments_ssh bash -s <<'REMOTE'
set -euo pipefail
WEB_D=payments-sandbox.ouyishop.com
API_D=payments-sandbox-api.ouyishop.com

issue() {
  local domain="$1" is_proxy="$2"
  local certdir="/www/server/panel/vhost/cert/$domain"
  mkdir -p "$certdir"
  if [[ -f "$certdir/fullchain.pem" && -f "$certdir/privkey.pem" ]]; then
    echo "(i) $domain 证书已存在"
    return 0
  fi
  if command -v certbot >/dev/null 2>&1; then
    certbot certonly --webroot -w /www/wwwroot/$domain -d "$domain" --non-interactive --agree-tos \
      --register-unsafely-without-email 2>/dev/null \
      || certbot certonly --nginx -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email || true
    if [[ -f /etc/letsencrypt/live/$domain/fullchain.pem ]]; then
      cp -f /etc/letsencrypt/live/$domain/fullchain.pem "$certdir/fullchain.pem"
      cp -f /etc/letsencrypt/live/$domain/privkey.pem "$certdir/privkey.pem"
    fi
  fi
  # 宝塔 CLI（若可用）
  if [[ ! -f "$certdir/fullchain.pem" ]] && command -v btpython >/dev/null 2>&1; then
    echo "(!) 请在宝塔面板为 $domain 申请 SSL，或确认 DNS 已指向本机后重跑"
  fi
}

issue "$WEB_D" 0
issue "$API_D" 1

# 若证书就绪则写入 443
for domain in $WEB_D $API_D; do
  certdir="/www/server/panel/vhost/cert/$domain"
  conf="/www/server/panel/vhost/nginx/$domain.conf"
  if [[ -f "$certdir/fullchain.pem" && -f "$certdir/privkey.pem" ]]; then
    if ! grep -q 'listen 443' "$conf"; then
      echo "(i) 为 $domain 启用 HTTPS"
      if [[ "$domain" == "$WEB_D" ]]; then
        cat > "$conf" <<EOF
server
{
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name $domain;
    index index.html;
    root /www/wwwroot/$domain;
    include /www/server/panel/vhost/nginx/extension/$domain/*.conf;
    include /www/server/panel/vhost/nginx/well-known/$domain.conf;

    set \$isRedcert 1;
    if (\$server_port != 443) { set \$isRedcert 2; }
    if ( \$uri ~ /\\.well-known/ ) { set \$isRedcert 1; }
    if (\$isRedcert != 1) { rewrite ^(/.*)\$ https://\$host\$1 permanent; }
    ssl_certificate    $certdir/fullchain.pem;
    ssl_certificate_key    $certdir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:!MD5;
    ssl_prefer_server_ciphers on;
    error_page 497  https://\$host\$request_uri;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~ \\.well-known { allow all; }
    access_log  /www/wwwlogs/$domain.log;
    error_log   /www/wwwlogs/$domain.error.log;
}
EOF
      else
        cat > "$conf" <<EOF
server
{
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name $domain;
    root /www/wwwroot/$domain;
    include /www/server/panel/vhost/nginx/extension/$domain/*.conf;
    include /www/server/panel/vhost/nginx/well-known/$domain.conf;

    set \$isRedcert 1;
    if (\$server_port != 443) { set \$isRedcert 2; }
    if ( \$uri ~ /\\.well-known/ ) { set \$isRedcert 1; }
    if (\$isRedcert != 1) { rewrite ^(/.*)\$ https://\$host\$1 permanent; }
    ssl_certificate    $certdir/fullchain.pem;
    ssl_certificate_key    $certdir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:!MD5;
    ssl_prefer_server_ciphers on;
    error_page 497  https://\$host\$request_uri;

    location / {
      proxy_pass http://127.0.0.1:3026;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      client_max_body_size 60m;
      proxy_read_timeout 120s;
    }
    location ~ \\.well-known { allow all; }
    access_log  /www/wwwlogs/$domain.log;
    error_log   /www/wwwlogs/$domain.error.log;
}
EOF
      fi
    fi
  else
    echo "(!) $domain 暂无证书，仅 HTTP；请在宝塔申请 SSL 后 reload"
  fi
done

nginx -t && nginx -s reload
REMOTE

payments_banner "完成初始化"
echo "  测试库  $DB_NAME"
echo "  Web     https://$WEB_D （或 http:// 若证书未就绪）"
echo "  API     https://$API_D"
echo "  请确认 DNS A 记录指向 ${HOST}，并在 Sandbox App 配置 Return URL："
echo "  https://payments-sandbox-api.ouyishop.com/api/callback"
