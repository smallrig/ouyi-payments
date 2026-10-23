<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { NButton } from 'naive-ui';
import {
  completePayPalBindSuccess,
  oauthSuccessInfo,
  oauthSuccessLoading,
  oauthSuccessVisible
} from '@/lib/oauth';

const rows = computed(() => {
  const info = oauthSuccessInfo.value;
  const authorized = !info?.status || info.status === 'active';
  return [
    { label: 'PayPal 账号', value: info?.email || info?.name || '—' },
    { label: 'PayPal 商户 ID', value: info?.payerId || '—' },
    { label: '授权状态', value: authorized ? '已授权' : info?.status || '—', ok: authorized }
  ];
});
</script>

<template>
  <Teleport to="body">
    <Transition name="oauth-success">
      <div
        v-if="oauthSuccessVisible"
        class="oauth-success-mask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-success-title"
      >
        <div class="oauth-success">
          <div class="oauth-success__check" aria-hidden="true">
            <Icon icon="mdi:check" width="28" />
          </div>
          <h2 id="oauth-success-title" class="oauth-success__title">绑定成功</h2>

          <dl class="oauth-success__rows">
            <div v-for="row in rows" :key="row.label" class="oauth-success__row">
              <dt>{{ row.label }}</dt>
              <dd :class="{ 'is-ok': row.ok }">
                <span v-if="oauthSuccessLoading && row.value === '—'" class="is-loading">读取中…</span>
                <template v-else>{{ row.value }}</template>
              </dd>
            </div>
          </dl>

          <NButton type="primary" size="large" block strong class="oauth-success__ok" @click="completePayPalBindSuccess">
            完成
          </NButton>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.oauth-success-mask {
  position: fixed;
  inset: 0;
  z-index: 3100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(11, 31, 58, 0.48);
  backdrop-filter: blur(6px);
}

.oauth-success {
  width: min(400px, 100%);
  padding: 32px 28px 24px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 48px rgba(11, 31, 58, 0.22);
  text-align: center;
}

.oauth-success__check {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  color: #16a34a;
  background: #e8f8ef;
  box-shadow: inset 0 0 0 6px #f3fbf6;
}

.oauth-success__title {
  margin: 0 0 20px;
  font-size: 1.2rem;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.oauth-success__rows {
  margin: 0 0 22px;
  padding: 4px 4px 8px;
  text-align: left;
}

.oauth-success__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid #eef2f6;
  font-size: 0.84rem;
}

.oauth-success__row:last-child {
  border-bottom: 0;
}

.oauth-success__row dt {
  color: var(--pp-muted);
  font-weight: 550;
}

.oauth-success__row dd {
  margin: 0;
  color: var(--pp-text);
  font-weight: 650;
  word-break: break-all;
  text-align: right;
}

.oauth-success__row dd.is-ok {
  color: #16a34a;
}

.is-loading {
  color: var(--pp-muted);
  font-weight: 500;
}

.oauth-success__ok {
  --n-height: 42px !important;
}

.oauth-success-enter-active,
.oauth-success-leave-active {
  transition: opacity 0.2s ease;
}

.oauth-success-enter-active .oauth-success,
.oauth-success-leave-active .oauth-success {
  transition: transform 0.22s ease, opacity 0.2s ease;
}

.oauth-success-enter-from,
.oauth-success-leave-to {
  opacity: 0;
}

.oauth-success-enter-from .oauth-success,
.oauth-success-leave-to .oauth-success {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>
