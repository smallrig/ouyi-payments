<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NCheckbox, NInput, useMessage } from 'naive-ui';
import { useAuthStore } from '@/store/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const message = useMessage();

const username = ref('');
const password = ref('');
const remember = ref(true);
const portalUrl = (import.meta.env.VITE_PORTAL_URL || '').replace(/\/$/, '');
const appTitle = import.meta.env.VITE_APP_TITLE || 'Payments · 收款管理';

async function handleLogin() {
  if (!username.value || !password.value) {
    message.warning('请输入账号和密码');
    return;
  }
  try {
    await auth.login(username.value, password.value);
    const redirect = (route.query.redirect as string) || '/';
    await router.replace(redirect);
  } catch (err) {
    message.error(err instanceof Error ? err.message : '登录失败');
  }
}

function onForgot() {
  if (portalUrl) {
    window.open(portalUrl, '_blank', 'noopener');
    return;
  }
  message.info('请联系管理员重置密码');
}

function onRegister() {
  if (portalUrl) {
    window.open(portalUrl, '_blank', 'noopener');
    return;
  }
  message.info('请通过 Portal 申请账号');
}

onMounted(async () => {
  if (auth.isLogin) {
    await auth.fetchProfile().catch(() => null);
    if (auth.user) await router.replace('/');
  }
});
</script>

<template>
  <div class="login">
    <div class="login__cover" aria-hidden="true">
      <div class="login__shape login__shape--1" />
      <div class="login__shape login__shape--2" />
      <div class="login__shape login__shape--3" />
      <div class="login__shape login__shape--4" />
      <div class="login__shape login__shape--5" />
      <div class="login__glow" />
    </div>

    <div class="login__card">
      <div class="login__brand">
        <div class="login__logo-row">
          <span class="login__pp-mark">
            <Icon icon="mdi:wallet-outline" width="28" />
          </span>
          <span class="login__pp-word">Payments</span>
        </div>
        <h1 class="login__title">{{ appTitle }}</h1>
        <p class="login__sub">统一管理收款账号，查看交易流水与客户争议</p>
      </div>

      <template v-if="auth.standaloneAuthEnabled">
        <form class="login__form" @submit.prevent="handleLogin">
          <div class="field">
            <NInput
              v-model:value="username"
              size="large"
              placeholder="请输入账号"
              autocomplete="username"
              class="field__input"
            >
              <template #prefix>
                <Icon icon="mdi:account-outline" width="18" class="field__icon" />
              </template>
            </NInput>
          </div>
          <div class="field">
            <NInput
              v-model:value="password"
              size="large"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
              autocomplete="current-password"
              class="field__input"
              @keyup.enter="handleLogin"
            >
              <template #prefix>
                <Icon icon="mdi:lock-outline" width="18" class="field__icon" />
              </template>
            </NInput>
          </div>

          <div class="login__row">
            <NCheckbox v-model:checked="remember">记住登录状态</NCheckbox>
            <button type="button" class="login__link" @click="onForgot">忘记密码？</button>
          </div>

          <NButton
            type="primary"
            size="large"
            block
            strong
            attr-type="submit"
            :loading="auth.loginLoading"
            class="login__submit"
          >
            登录
          </NButton>
        </form>

        <p class="login__foot">
          没有账号？
          <button type="button" class="login__link" @click="onRegister">立即注册</button>
        </p>
      </template>

      <template v-else>
        <p class="login__hint">请从统一 Portal 进入本系统，或使用 SSO 链接（/sso?ticket=…）。</p>
        <NButton
          v-if="portalUrl"
          type="primary"
          size="large"
          block
          strong
          tag="a"
          :href="portalUrl"
          class="login__submit"
        >
          打开 Portal
        </NButton>
        <p v-if="portalUrl" class="login__foot">
          <a :href="portalUrl" target="_blank" rel="noopener" class="login__link">返回 Portal</a>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 28px 16px;
  overflow: hidden;
}

.login__cover {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(165deg, #3aa0e8 0%, #0070ba 42%, #004b9a 72%, #003087 100%);
  overflow: hidden;
}

.login__glow {
  position: absolute;
  top: -20%;
  left: -10%;
  width: 70%;
  height: 55%;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.22), transparent 68%);
  pointer-events: none;
}

.login__shape {
  position: absolute;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transform: rotate(-22deg);
  pointer-events: none;
}

.login__shape--1 {
  width: min(42vw, 420px);
  height: min(58vw, 560px);
  top: -12%;
  left: -8%;
  background: rgba(255, 255, 255, 0.14);
}

.login__shape--2 {
  width: min(36vw, 360px);
  height: min(48vw, 480px);
  top: 8%;
  right: -6%;
  background: rgba(0, 48, 135, 0.22);
  transform: rotate(18deg);
}

.login__shape--3 {
  width: min(28vw, 280px);
  height: min(36vw, 360px);
  bottom: -8%;
  left: 18%;
  background: rgba(255, 255, 255, 0.08);
  transform: rotate(-12deg);
}

.login__shape--4 {
  width: min(22vw, 220px);
  height: min(30vw, 300px);
  bottom: 12%;
  right: 12%;
  background: rgba(0, 112, 186, 0.35);
  transform: rotate(28deg);
}

.login__shape--5 {
  width: min(18vw, 180px);
  height: min(24vw, 240px);
  top: 42%;
  left: 8%;
  background: rgba(255, 255, 255, 0.06);
  transform: rotate(8deg);
}

.login__card {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
  padding: 40px 36px 32px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 32, 80, 0.28);
}

.login__brand {
  text-align: center;
  margin-bottom: 28px;
}

.login__logo-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.login__pp-mark {
  display: grid;
  place-items: center;
  color: #0070ba;
}

.login__pp-word {
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #003087;
}

.login__title {
  margin: 0 0 8px;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #1a2332;
}

.login__sub {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.55;
  color: #6b7a90;
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field__icon {
  color: #93a1b4;
}

.login__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 2px 0 4px;
}

.login__link {
  padding: 0;
  border: 0;
  background: none;
  color: #0070ba;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 550;
  cursor: pointer;
  text-decoration: none;
}

.login__link:hover {
  color: #003087;
  text-decoration: underline;
}

.login__submit {
  height: 44px !important;
  margin-top: 4px;
  font-size: 0.95rem !important;
}

.login__foot {
  margin: 22px 0 0;
  text-align: center;
  font-size: 0.8125rem;
  color: #6b7a90;
}

.login__hint {
  margin: 0 0 16px;
  font-size: 0.875rem;
  color: #6b7a90;
  line-height: 1.55;
  text-align: center;
}

@media (max-width: 480px) {
  .login__card {
    padding: 28px 20px 24px;
  }

  .login__title {
    font-size: 1.15rem;
  }
}
</style>
