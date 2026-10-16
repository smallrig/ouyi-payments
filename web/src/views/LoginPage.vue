<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton } from 'naive-ui';
import { useAuthStore } from '@/store/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const error = ref('');
const pending = ref(false);

function redirectTarget() {
  const value = String(route.query.redirect || '/');
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

async function startLogin() {
  error.value = '';
  pending.value = true;
  try {
    await auth.signIn(redirectTarget());
  } catch (err) {
    pending.value = false;
    error.value = err instanceof Error ? err.message : '无法打开登录页';
  }
}

onMounted(async () => {
  const ok = await auth.ensureSession();
  if (ok) await router.replace(redirectTarget());
  else if (auth.lastError) error.value = auth.lastError;
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
            <Icon icon="mdi:paypal" width="28" />
          </span>
          <span class="login__pp-word">PayPal</span>
        </div>
          <p class="login__sub">统一管理您的 PayPal 账号，查看交易记录和客户投诉</p>
      </div>

      <p v-if="error" class="login__hint login__hint--error">{{ error }}</p>
      <p v-else class="login__hint">点击按钮前往统一账号登录</p>
      <NButton
        type="primary"
        size="large"
        block
        strong
        class="login__submit"
        :loading="pending"
        @click="startLogin"
      >
        前往登录
      </NButton>
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

.login__hint--error {
  color: #b42318;
}

@media (max-width: 480px) {
  .login__card {
    padding: 28px 20px 24px;
  }
}
</style>
