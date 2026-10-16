<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { NButton } from 'naive-ui';
import { startPayPalOAuth } from '@/lib/oauth';

const redirectUri = import.meta.env.VITE_PAYPAL_REDIRECT_URI || '';

const tips = [
  {
    icon: 'mdi:account-multiple-outline',
    title: '多账号集中管理',
    desc: '账号多了看得清，每个 payerId 独立存储令牌与缓存。'
  },
  {
    icon: 'mdi:account-key-outline',
    title: '按人分配',
    desc: '分配给不同用户后，普通用户只能查看已分配账号。'
  },
  {
    icon: 'mdi:sync',
    title: '账单同步',
    desc: '支持手动拉取近 31 天 Transaction Search；Webhook 可自动入账。'
  },
  {
    icon: 'mdi:text-search',
    title: '出问题查得到',
    desc: 'API 调用与 Webhook 写入日志页，便于审计与排障。'
  }
];
</script>

<template>
  <div class="pp-page">
    <div class="pp-page-head">
      <div>
        <p class="pp-page-eyebrow">Connect</p>
        <h1 class="pp-page-title">授权接入</h1>
        <p class="pp-page-desc">
          方案一 · 商家登录授权：平台持有一个 REST App，商家点授权后服务端兑换 token，后续查单只带商家 Bearer。
        </p>
      </div>
    </div>

    <section class="auth-hero">
      <div class="auth-hero__glow" aria-hidden="true" />
      <div class="auth-hero__inner">
        <div class="auth-hero__badge">
          <Icon icon="mdi:paypal" width="36" />
        </div>
        <div class="auth-hero__copy">
          <h2>使用 PayPal 登录并授权</h2>
          <p>绑定新的商家账号，或刷新已有账号的 refresh_token。应用所属账号不能给自己授权。</p>
        </div>
        <NButton type="primary" size="large" strong class="auth-hero__btn" @click="startPayPalOAuth()">
          <template #icon>
            <Icon icon="mdi:login-variant" width="18" />
          </template>
          使用 PayPal 登录并授权
        </NButton>
      </div>
      <p class="auth-hero__hint">
        Return URL 须与沙箱 App 完全一致：
        <code>{{ redirectUri }}</code>
      </p>
    </section>

    <div class="tip-grid">
      <article v-for="tip in tips" :key="tip.title" class="tip-card">
        <div class="tip-card__icon">
          <Icon :icon="tip.icon" width="20" />
        </div>
        <h3>{{ tip.title }}</h3>
        <p>{{ tip.desc }}</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.auth-hero {
  position: relative;
  padding: 28px;
  border-radius: calc(var(--pp-radius) + 4px);
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 100% at 100% -10%, rgba(30, 143, 255, 0.35), transparent 50%),
    linear-gradient(135deg, #07111f 0%, #0d2348 45%, #003087 100%);
  color: #eef5ff;
  box-shadow: 0 20px 48px rgba(7, 17, 31, 0.28);
  margin-bottom: 22px;
}

.auth-hero__glow {
  position: absolute;
  inset: auto -20% -40% auto;
  width: 60%;
  height: 80%;
  background: radial-gradient(circle, rgba(13, 148, 136, 0.25), transparent 65%);
  pointer-events: none;
}

.auth-hero__inner {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
}

.auth-hero__badge {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.auth-hero__copy {
  flex: 1;
  min-width: 220px;
}

.auth-hero__copy h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.auth-hero__copy p {
  margin: 0;
  max-width: 48ch;
  font-size: 0.9rem;
  line-height: 1.55;
  opacity: 0.78;
}

.auth-hero__btn {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.auth-hero__hint {
  position: relative;
  margin: 20px 0 0;
  font-size: 0.78rem;
  opacity: 0.65;
}

.auth-hero__hint code {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 0.76rem;
}

.tip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.tip-card {
  padding: 18px 18px 16px;
  border-radius: var(--pp-radius);
  background: var(--pp-card-solid);
  border: 1px solid var(--pp-border);
  box-shadow: var(--pp-shadow);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.tip-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--pp-shadow-lg);
}

.tip-card__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: 14px;
  border-radius: 10px;
  color: var(--pp-accent);
  background: var(--pp-accent-soft);
}

.tip-card h3 {
  margin: 0 0 6px;
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.tip-card p {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--pp-muted);
}

@media (max-width: 960px) {
  .tip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .tip-grid {
    grid-template-columns: 1fr;
  }
}
</style>
