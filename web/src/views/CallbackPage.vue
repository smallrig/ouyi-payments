<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpin } from 'naive-ui';
import { logto } from '@/lib/logto';
import { takePostLoginRedirect, useAuthStore } from '@/store/auth';

const auth = useAuthStore();
const router = useRouter();
const error = ref('');

onMounted(async () => {
  try {
    await logto.handleSignInCallback(location.href);
    const ok = await auth.exchangeFromLogto();
    if (!ok) {
      error.value = auth.lastError || '登录失败';
      return;
    }
    await router.replace(takePostLoginRedirect());
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录回调失败';
  }
});
</script>

<template>
  <div class="callback">
    <div class="callback__card">
      <template v-if="!error">
        <NSpin size="medium" />
        <p>正在完成登录…</p>
      </template>
      <template v-else>
        <p class="callback__error">{{ error }}</p>
        <NButton type="primary" @click="auth.logout()">返回登录页</NButton>
      </template>
    </div>
  </div>
</template>

<style scoped>
.callback {
  min-height: 100%;
  display: grid;
  place-items: center;
  background: #f0f3f8;
}

.callback__card {
  display: grid;
  justify-items: center;
  gap: 14px;
  width: min(420px, calc(100% - 32px));
  padding: 32px 24px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  text-align: center;
  color: var(--pp-muted);
}

.callback__error {
  margin: 0;
  color: #b42318;
  line-height: 1.5;
}
</style>
