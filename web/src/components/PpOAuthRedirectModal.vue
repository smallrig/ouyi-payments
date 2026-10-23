<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { NButton } from 'naive-ui';
import { cancelPayPalOAuthRedirect, oauthRedirectVisible } from '@/lib/oauth';
</script>

<template>
  <Teleport to="body">
    <Transition name="oauth-mask">
      <div
        v-if="oauthRedirectVisible"
        class="oauth-mask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-redirect-title"
      >
        <div class="oauth-card">
          <div class="oauth-card__visual" aria-hidden="true">
            <div class="oauth-card__ring" />
            <div class="oauth-card__logo">
              <Icon icon="mdi:paypal" width="28" />
            </div>
          </div>

          <h2 id="oauth-redirect-title" class="oauth-card__title">正在前往 PayPal</h2>
          <p class="oauth-card__desc">
            即将打开 PayPal 商家授权登录页，请在授权完成后返回本系统。
          </p>

          <div class="oauth-card__steps">
            <div class="oauth-card__step is-active">
              <span class="oauth-card__dot" />
              准备跳转
            </div>
            <div class="oauth-card__step">
              <span class="oauth-card__dot" />
              PayPal 登录授权
            </div>
            <div class="oauth-card__step">
              <span class="oauth-card__dot" />
              返回并绑定账号
            </div>
          </div>

          <div class="oauth-card__bar" aria-hidden="true">
            <span class="oauth-card__bar-fill" />
          </div>

          <NButton quaternary size="small" class="oauth-card__cancel" @click="cancelPayPalOAuthRedirect">
            取消
          </NButton>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.oauth-mask {
  position: fixed;
  inset: 0;
  z-index: 3010;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(11, 31, 58, 0.48);
  backdrop-filter: blur(6px);
}

.oauth-card {
  position: relative;
  width: min(400px, 100%);
  padding: 32px 28px 22px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 20px 48px rgba(11, 31, 58, 0.22);
  text-align: center;
}

.oauth-card__visual {
  position: relative;
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
}

.oauth-card__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(0, 112, 186, 0.18);
  border-top-color: #0070ba;
  animation: oauth-spin 0.9s linear infinite;
}

.oauth-card__logo {
  position: absolute;
  inset: 0;
  margin: auto;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  color: #fff;
  background: #0070ba;
}

.oauth-card__title {
  margin: 0 0 8px;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--pp-text);
  letter-spacing: -0.02em;
}

.oauth-card__desc {
  margin: 0 0 18px;
  font-size: 0.875rem;
  line-height: 1.55;
  color: var(--pp-muted);
}

.oauth-card__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  text-align: left;
}

.oauth-card__step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: var(--pp-muted);
  background: #f7f9fc;
}

.oauth-card__step.is-active {
  color: #003087;
  font-weight: 600;
  background: rgba(0, 112, 186, 0.08);
}

.oauth-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c5d0de;
  flex-shrink: 0;
}

.oauth-card__step.is-active .oauth-card__dot {
  background: #0070ba;
  box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.18);
}

.oauth-card__bar {
  height: 4px;
  border-radius: 999px;
  background: #e8eef6;
  overflow: hidden;
  margin-bottom: 14px;
}

.oauth-card__bar-fill {
  display: block;
  height: 100%;
  width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #0070ba, #1e8fff);
  animation: oauth-bar 0.9s ease-out forwards;
}

.oauth-card__cancel {
  color: var(--pp-muted) !important;
}

@keyframes oauth-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes oauth-bar {
  from {
    width: 8%;
  }
  to {
    width: 100%;
  }
}

.oauth-mask-enter-active,
.oauth-mask-leave-active {
  transition: opacity 0.2s ease;
}

.oauth-mask-enter-active .oauth-card,
.oauth-mask-leave-active .oauth-card {
  transition: transform 0.22s ease, opacity 0.2s ease;
}

.oauth-mask-enter-from,
.oauth-mask-leave-to {
  opacity: 0;
}

.oauth-mask-enter-from .oauth-card,
.oauth-mask-leave-to .oauth-card {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>
