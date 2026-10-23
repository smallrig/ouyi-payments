# shellcheck shell=bash
# Shared deploy helpers for payments → bt-node.ouyiuri.com

PAYMENTS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$PAYMENTS_ROOT/bt-node.ouyiuri.com_id_ed25519}"
# Cloudflare 代理开启时，域名解析到 CF Anycast，SSH 22 不可达。
# 此时请：DEPLOY_HOST=root@<源站公网IP> ./scripts/deploy.sh
HOST="${DEPLOY_HOST:-root@47.251.56.99}"

# prod | sandbox（可由 DEPLOY_ENV 或 deploy.sh 第一个参数覆盖）
DEPLOY_ENV="${DEPLOY_ENV:-prod}"

payments_apply_env() {
  case "$DEPLOY_ENV" in
    sandbox|test)
      DEPLOY_ENV=sandbox
      WEB_DOMAIN="${WEB_DOMAIN:-payments-sandbox.ouyishop.com}"
      API_DOMAIN="${API_DOMAIN:-payments-sandbox-api.ouyishop.com}"
      API_PORT="${API_PORT:-3026}"
      PM2_APP_NAME="${PM2_APP_NAME:-payments-admin-service-sandbox}"
      API_ENV_FILE="${API_ENV_FILE:-.env.test}"
      WEB_BUILD_MODE="${WEB_BUILD_MODE:-sandbox}"
      DB_NAME_HINT=yxshop_paypal_sandbox
      ;;
    prod|production|live|"")
      DEPLOY_ENV=prod
      WEB_DOMAIN="${WEB_DOMAIN:-payments.ouyishop.com}"
      API_DOMAIN="${API_DOMAIN:-payments-api.ouyishop.com}"
      API_PORT="${API_PORT:-3025}"
      PM2_APP_NAME="${PM2_APP_NAME:-payments-admin-service}"
      API_ENV_FILE="${API_ENV_FILE:-.env.production}"
      WEB_BUILD_MODE="${WEB_BUILD_MODE:-prod}"
      DB_NAME_HINT=yxshop_paypal
      ;;
    *)
      echo "Unknown DEPLOY_ENV=$DEPLOY_ENV (use prod|sandbox)" >&2
      exit 1
      ;;
  esac

  WEB_DEPLOY_DIR="${WEB_DEPLOY_DIR:-/www/wwwroot/${WEB_DOMAIN}}"
  API_DEPLOY_DIR="${API_DEPLOY_DIR:-/www/wwwroot/${API_DOMAIN}}"
  GATEWAY_UPSTREAM="${GATEWAY_UPSTREAM:-http://127.0.0.1:3020}"
  API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:${API_PORT}}"
}

payments_apply_env

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20)

payments_require_key() {
  if [[ ! -f "$SSH_KEY" ]]; then
    echo "SSH key not found: $SSH_KEY" >&2
    exit 1
  fi
  chmod 600 "$SSH_KEY" 2>/dev/null || true
}

payments_ssh() {
  payments_require_key
  ssh "${SSH_OPTS[@]}" "$HOST" "$@"
}

payments_scp() {
  payments_require_key
  scp "${SSH_OPTS[@]}" "$@"
}

payments_banner() {
  echo ""
  echo "=== $* ==="
}
