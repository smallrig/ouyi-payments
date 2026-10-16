<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NDropdown, NAvatar } from 'naive-ui';
import PpOAuthRedirectModal from '@/components/PpOAuthRedirectModal.vue';
import { useAuthStore } from '@/store/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const navItems = [
  { name: 'dashboard', label: '首页', icon: 'mdi:view-dashboard-outline', match: ['dashboard'] },
  { name: 'transactions', label: '交易记录', icon: 'mdi:receipt-text-outline', match: ['transactions'] },
  { name: 'disputes', label: '争议案件', icon: 'mdi:shield-alert-outline', match: ['disputes', 'dispute-detail'] },
  { name: 'accounts', label: '账号管理', icon: 'mdi:account-multiple-outline', match: ['accounts', 'account-detail'] }
] as const;

const pageMeta: Record<string, string> = {
  dashboard: '首页',
  accounts: '账号管理',
  'account-detail': '账号详情',
  transactions: '交易记录',
  disputes: '争议案件',
  'dispute-detail': '案件详情'
};

const activeName = computed(() => String(route.name || 'dashboard'));
const currentTitle = computed(() => pageMeta[activeName.value] || '首页');

function isActive(item: (typeof navItems)[number]) {
  return (item.match as readonly string[]).includes(activeName.value);
}

function go(name: string) {
  if (route.name === name) return;
  void router.push({ name });
}

async function onLogout() {
  await auth.logout();
  await router.push({ name: 'login' });
}

const userDropdownOptions = [{ label: '退出登录', key: 'logout' }];

function onUserSelect(key: string) {
  if (key === 'logout') void onLogout();
}

const initial = computed(() => (auth.displayName || 'U').slice(0, 1).toUpperCase());
</script>

<template>
  <div class="shell">
    <aside class="sider">
      <div class="brand">
        <div class="brand__mark" aria-hidden="true">
          <Icon icon="mdi:paypal" width="20" />
        </div>
        <div class="brand__text">
          <span class="brand__title">PayPal</span>
          <span class="brand__sub">账号管理系统</span>
        </div>
      </div>

      <nav class="nav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.name"
          type="button"
          class="nav__item"
          :class="{ 'is-active': isActive(item) }"
          @click="go(item.name)"
        >
          <Icon :icon="item.icon" width="18" class="nav__icon" />
          <span class="nav__label">{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <h1 class="topbar__title">{{ currentTitle }}</h1>
        <div class="topbar__actions">
          <NDropdown :options="userDropdownOptions" @select="onUserSelect">
            <button type="button" class="user-chip">
              <NAvatar :size="28" round class="user-chip__avatar">{{ initial }}</NAvatar>
              <span class="user-chip__name">{{ auth.displayName }}</span>
              <Icon icon="mdi:chevron-down" width="16" />
            </button>
          </NDropdown>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>

    <PpOAuthRedirectModal />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--pp-bg);
}

.sider {
  flex: 0 0 220px;
  width: 220px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0b1f3a;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 20px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: #fff;
  background: #0070ba;
}

.brand__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand__title {
  font-weight: 700;
  font-size: 0.95rem;
  color: #fff;
  letter-spacing: -0.02em;
}

.brand__sub {
  margin-top: 1px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.45);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 10px;
}

.nav__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 42px;
  padding: 0 12px 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.nav__item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.nav__item.is-active {
  background: rgba(0, 112, 186, 0.28);
  color: #fff;
  font-weight: 600;
}

.nav__item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: #0070ba;
}

.nav__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.nav__item.is-active .nav__icon {
  opacity: 1;
}

.nav__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.topbar {
  flex-shrink: 0;
  height: var(--pp-topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--pp-border);
}

.topbar__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  color: var(--pp-text);
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px 3px 3px;
  border: 1px solid var(--pp-border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  color: var(--pp-text);
}

.user-chip:hover {
  border-color: var(--pp-border-strong);
}

.user-chip__avatar {
  background: #0070ba !important;
  color: #fff !important;
  font-weight: 700;
  font-size: 0.75rem;
}

.user-chip__name {
  font-size: 0.82rem;
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 24px 32px;
}
</style>
