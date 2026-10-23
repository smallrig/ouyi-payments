#!/usr/bin/env bash
# Payments 一键部署（管理端 + API）
#
# 正式（默认）：
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh prod
#   Web  https://payments.ouyishop.com
#   API  https://payments-api.ouyishop.com  → :3025 / 库 yxshop_paypal
#
# 测试 Sandbox：
#   ./scripts/deploy.sh sandbox
#   ./scripts/deploy.sh sandbox web|api
#   Web  https://payments-sandbox.ouyishop.com
#   API  https://payments-sandbox-api.ouyishop.com → :3026 / 库 yxshop_paypal_sandbox
#
# Cloudflare 橙云时 SSH 不通，请用源站 IP：
#   DEPLOY_HOST=root@x.x.x.x ./scripts/deploy.sh sandbox
#
# 上传 API 环境变量：
#   UPLOAD_ENV=1 ./scripts/deploy.sh sandbox api
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 解析：deploy.sh [prod|sandbox] [all|web|api]
ARG1="${1:-}"
ARG2="${2:-}"
if [[ "$ARG1" == "prod" || "$ARG1" == "production" || "$ARG1" == "live" || "$ARG1" == "sandbox" || "$ARG1" == "test" ]]; then
  export DEPLOY_ENV="$ARG1"
  TARGET="${ARG2:-all}"
elif [[ -n "$ARG1" ]]; then
  TARGET="$ARG1"
else
  TARGET=all
fi

# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

payments_require_key
payments_banner "deploy env=$DEPLOY_ENV target=$TARGET host=$HOST"
echo "  web: $WEB_DOMAIN  → $WEB_DEPLOY_DIR (vite mode=$WEB_BUILD_MODE)"
echo "  api: $API_DOMAIN  → $API_DEPLOY_DIR (port $API_PORT, pm2=$PM2_APP_NAME, envfile=$API_ENV_FILE)"
echo "  db hint: $DB_NAME_HINT"

payments_banner "SSH 探活"
if ! payments_ssh 'echo ok; hostname; whoami'; then
  cat >&2 <<EOF

SSH 连接失败：$HOST
请改用源站公网 IP：
  DEPLOY_HOST=root@<源站IP> $0 ${DEPLOY_ENV} $TARGET

密钥：$SSH_KEY
EOF
  exit 1
fi

case "$TARGET" in
  all)
    bash "$SCRIPT_DIR/deploy-web.sh"
    bash "$SCRIPT_DIR/deploy-api.sh"
    ;;
  web)
    bash "$SCRIPT_DIR/deploy-web.sh"
    ;;
  api)
    bash "$SCRIPT_DIR/deploy-api.sh"
    ;;
  *)
    echo "usage: $0 [prod|sandbox] [all|web|api]" >&2
    exit 1
    ;;
esac

payments_banner "完成"
echo "  管理端  https://$WEB_DOMAIN"
echo "  接口    https://$API_DOMAIN/api/health"
echo "  宝塔需已创建站点并申请 SSL：$WEB_DOMAIN / $API_DOMAIN"
