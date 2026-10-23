<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useAuthStore } from '@/store/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();
const error = ref('');

onMounted(async () => {
  const ticket = String(route.query.ticket || '').trim();
  if (!ticket) {
    error.value = '缺少 SSO ticket';
    return;
  }
  try {
    await auth.exchangeSso(ticket);
    const redirect = (route.query.redirect as string) || '/';
    await router.replace(redirect);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'SSO 登录失败';
    message.error(error.value);
  }
});
</script>

<template>
  <div class="sso-page">
    <div class="sso-card">
      <template v-if="!error">
        <p class="sso-hint">正在通过工作台 SSO 登录…</p>
      </template>
      <p v-else class="error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.sso-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f3f8;
}

.sso-card {
  min-width: min(360px, 92vw);
  padding: 40px 48px;
  text-align: center;
  color: #6b7a90;
  background: #fff;
  border: 1px solid #e4e9f0;
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(26, 35, 50, 0.08);
}

.sso-hint {
  margin: 0;
  font-size: 0.9rem;
}

.error {
  margin: 0;
  color: #b42318;
}
</style>
