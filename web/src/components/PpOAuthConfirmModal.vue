<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { NButton } from 'naive-ui';
import {
  cancelPayPalOAuthConfirm,
  confirmPayPalOAuth,
  oauthConfirmVisible
} from '@/lib/oauth';

const permissions = [
  { icon: 'mdi:file-document-outline', label: '查看交易记录' },
  { icon: 'mdi:message-alert-outline', label: '查看投诉与争议' },
  { icon: 'mdi:account-box-outline', label: '管理账户信息' }
] as const;
</script>

<template>
  <Teleport to="body">
    <Transition name="oauth-confirm">
      <div
        v-if="oauthConfirmVisible"
        class="oauth-confirm-mask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-confirm-title"
        @click.self="cancelPayPalOAuthConfirm"
      >
        <div class="oauth-confirm">
          <div class="oauth-confirm__brand" aria-hidden="true">
            <Icon icon="mdi:paypal" width="36" class="oauth-confirm__pp" />
            <span class="oauth-confirm__wordmark">Pay<span>Pal</span></span>
          </div>

          <h2 id="oauth-confirm-title" class="oauth-confirm__title">连接您的 PayPal 账号</h2>
          <p class="oauth-confirm__desc">授权后，本系统将代表您的商家账号使用以下权限：</p>

          <ul class="oauth-confirm__list">
            <li v-for="item in permissions" :key="item.label" class="oauth-confirm__item">
              <span class="oauth-confirm__ico">
                <Icon :icon="item.icon" width="18" />
              </span>
              <span>{{ item.label }}</span>
            </li>
          </ul>

          <div class="oauth-confirm__actions">
            <NButton type="primary" size="large" block strong class="oauth-confirm__ok" @click="confirmPayPalOAuth">
              同意并连接
            </NButton>
            <NButton size="large" block class="oauth-confirm__cancel" @click="cancelPayPalOAuthConfirm">
              取消
            </NButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.oauth-confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(11, 31, 58, 0.48);
  backdrop-filter: blur(6px);
}

.oauth-confirm {
  width: min(400px, 100%);
  padding: 28px 28px 22px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 20px 48px rgba(11, 31, 58, 0.22);
  text-align: center;
}

.oauth-confirm__brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 14px;
  color: #003087;
}

.oauth-confirm__pp {
  color: #0070ba;
}

.oauth-confirm__wordmark {
  font-size: 1.55rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  color: #003087;
}

.oauth-confirm__wordmark span {
  color: #0070ba;
}

.oauth-confirm__title {
  margin: 0 0 8px;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--pp-text);
  letter-spacing: -0.02em;
}

.oauth-confirm__desc {
  margin: 0 0 16px;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--pp-muted);
}

.oauth-confirm__list {
  list-style: none;
  margin: 0 0 22px;
  padding: 0;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oauth-confirm__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f5f8fc;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--pp-text);
}

.oauth-confirm__ico {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #fff;
  color: #0070ba;
  box-shadow: 0 1px 2px rgba(15, 35, 60, 0.06);
  flex-shrink: 0;
}

.oauth-confirm__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oauth-confirm__ok {
  --n-height: 42px !important;
}

.oauth-confirm__cancel {
  --n-height: 42px !important;
  color: var(--pp-muted) !important;
}

.oauth-confirm-enter-active,
.oauth-confirm-leave-active {
  transition: opacity 0.2s ease;
}

.oauth-confirm-enter-active .oauth-confirm,
.oauth-confirm-leave-active .oauth-confirm {
  transition: transform 0.22s ease, opacity 0.2s ease;
}

.oauth-confirm-enter-from,
.oauth-confirm-leave-to {
  opacity: 0;
}

.oauth-confirm-enter-from .oauth-confirm,
.oauth-confirm-leave-to .oauth-confirm {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>
