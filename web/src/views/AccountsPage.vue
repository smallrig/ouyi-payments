<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import {
  NButton,
  NInput,
  NPagination,
  NSelect,
  NSpin,
  useMessage
} from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import {
  fetchAccounts,
  patchAccount,
  revokeAccountAuth,
  syncAccountTransactions
} from '@/api/paypal';
import type { PayPalAccount } from '@/api/types';
import { accountStatusLabel } from '@/lib/account-status';
import { formatDateTime, formatMoney } from '@/lib/format';
import { startPayPalOAuth } from '@/lib/oauth';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(false);
const syncingId = ref('');
const accounts = ref<PayPalAccount[]>([]);
const keyword = ref('');
const statusFilter = ref<string | null>(null);
const assignVisible = ref(false);
const assignSaving = ref(false);
const assignTarget = ref<PayPalAccount | null>(null);
const assignOwnerId = ref('');
const assignOwnerName = ref('');

type SyncPhase = 'idle' | 'running' | 'done' | 'error';
const syncVisible = ref(false);
const syncPhase = ref<SyncPhase>('idle');
const syncTarget = ref<PayPalAccount | null>(null);
const syncCount = ref(0);
const syncError = ref('');
const syncSyncedAt = ref('');

const revokeVisible = ref(false);
const revokeSaving = ref(false);
const revokeTarget = ref<PayPalAccount | null>(null);
const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '待授权', value: 'pending' },
  { label: '冻结', value: 'frozen' }
];

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return accounts.value.filter(a => {
    if (statusFilter.value && a.status !== statusFilter.value) return false;
    if (!q) return true;
    const hay = [a.email, a.name, a.payerId, a.ownerName, a.ownerUserId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
});

const { page, pageSize, pageSizes, paged, pageCount, resetPage } = useClientPagination(filtered, 10);

const stats = computed(() => {
  const list = accounts.value;
  return {
    total: list.length,
    authorized: list.filter(a => a.authorized).length,
    pending: list.filter(a => a.status === 'pending' || !a.authorized).length,
    frozen: list.filter(a => a.status === 'frozen').length
  };
});

function statusTone(status: string) {
  if (status === 'active') return 'ok';
  if (status === 'pending') return 'warn';
  if (status === 'frozen') return 'bad';
  return 'mute';
}

function clearFilters() {
  keyword.value = '';
  statusFilter.value = null;
  resetPage();
}

async function load() {
  loading.value = true;
  try {
    accounts.value = await fetchAccounts();
    resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载账号失败');
  } finally {
    loading.value = false;
  }
}

function closeAssign() {
  if (assignSaving.value) return;
  assignVisible.value = false;
}

function openAssign(row: PayPalAccount) {
  assignTarget.value = row;
  assignOwnerId.value = row.ownerUserId || '';
  assignOwnerName.value = row.ownerName || '';
  assignVisible.value = true;
}

async function saveAssign() {
  if (!assignTarget.value || assignSaving.value) return;
  assignSaving.value = true;
  try {
    await patchAccount(assignTarget.value.payerId, {
      ownerUserId: assignOwnerId.value.trim(),
      ownerName: assignOwnerName.value.trim()
    });
    message.success('负责人已更新');
    assignVisible.value = false;
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    assignSaving.value = false;
  }
}

function closeSync() {
  if (syncPhase.value === 'running') return;
  syncVisible.value = false;
  syncPhase.value = 'idle';
  syncTarget.value = null;
  syncError.value = '';
}

async function onSync(row: PayPalAccount) {
  if (syncingId.value) return;
  syncingId.value = row.payerId;
  syncTarget.value = row;
  syncPhase.value = 'running';
  syncCount.value = 0;
  syncError.value = '';
  syncSyncedAt.value = '';
  syncVisible.value = true;
  try {
    const res = await syncAccountTransactions(row.payerId);
    syncCount.value = res.count;
    syncSyncedAt.value = res.syncedAt || new Date().toISOString();
    syncPhase.value = 'done';
    await load();
  } catch (err) {
    syncPhase.value = 'error';
    syncError.value = err instanceof Error ? err.message : '同步失败';
  } finally {
    syncingId.value = '';
  }
}
function openRevoke(row: PayPalAccount) {
  revokeTarget.value = row;
  revokeVisible.value = true;
}

function closeRevoke() {
  if (revokeSaving.value) return;
  revokeVisible.value = false;
  revokeTarget.value = null;
}

async function confirmRevoke() {
  if (!revokeTarget.value || revokeSaving.value) return;
  revokeSaving.value = true;
  try {
    await revokeAccountAuth(revokeTarget.value.payerId);
    message.success('已解除授权');
    revokeVisible.value = false;
    revokeTarget.value = null;
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    revokeSaving.value = false;
  }
}

async function handleAuthQuery() {
  const auth = route.query.auth;
  if (auth === 'ok') {
    message.success('PayPal 授权成功');
    await router.replace({ query: {} });
    await load();
  } else if (auth === 'error') {
    message.error(String(route.query.detail || '授权失败'));
    await router.replace({ query: {} });
  }
}

onMounted(() => {
  void load();
  void handleAuthQuery();
});

watch(() => route.query.auth, () => void handleAuthQuery());
watch([keyword, statusFilter], () => resetPage());
</script>

<template>
  <div class="pp-page">
    <div class="pp-page-head">
      <div>
        <h1 class="pp-page-title">PayPal 账号管理</h1>
        <p class="pp-page-desc">绑定商家账号，分配负责人，同步账单与查单</p>
      </div>
      <NButton type="primary" @click="startPayPalOAuth()">
        <template #icon><Icon icon="mdi:paypal" width="16" /></template>
        绑定账号
      </NButton>
    </div>

    <div class="stats">
      <div class="stats__item">
        <span class="stats__ico"><Icon icon="mdi:wallet-outline" width="18" /></span>
        <div><b>{{ stats.total }}</b><span>全部账号</span></div>
      </div>
      <div class="stats__item is-ok">
        <span class="stats__ico"><Icon icon="mdi:check-decagram-outline" width="18" /></span>
        <div><b>{{ stats.authorized }}</b><span>已授权</span></div>
      </div>
      <div class="stats__item is-warn">
        <span class="stats__ico"><Icon icon="mdi:clock-outline" width="18" /></span>
        <div><b>{{ stats.pending }}</b><span>待授权</span></div>
      </div>
      <div class="stats__item is-bad">
        <span class="stats__ico"><Icon icon="mdi:snowflake" width="18" /></span>
        <div><b>{{ stats.frozen }}</b><span>冻结</span></div>
      </div>
    </div>

    <div class="pp-filter">
        <div class="pp-filter__field">
          <NSelect
            v-model:value="statusFilter"
            :options="statusOptions"
            placeholder="账号状态"
            clearable
          />
        </div>
        <div class="pp-filter__search search">
          <Icon icon="mdi:magnify" width="16" class="search__icon" />
          <input
            v-model="keyword"
            class="search-input"
            type="search"
            placeholder="邮箱 / 名称 / Payer ID / 负责人"
            autocomplete="off"
          />
        </div>
        <NButton type="primary" @click="resetPage">查询</NButton>
        <NButton quaternary @click="clearFilters">重置</NButton>
      </div>

    <NSpin :show="loading">
      <div class="pp-table-wrap">
        <PpEmptyState
          v-if="!loading && !accounts.length"
          icon="mdi:account-multiple-outline"
          title="尚未绑定商家账号"
          description="使用商家登录授权接入沙箱或生产账号。"
        >
          <template #actions>
            <NButton type="primary" @click="startPayPalOAuth()">授权新账号</NButton>
          </template>
        </PpEmptyState>

        <PpEmptyState
          v-else-if="!loading && !filtered.length"
          compact
          icon="mdi:filter-remove-outline"
          title="没有匹配的账号"
          description="试试调整筛选条件。"
        >
          <template #actions>
            <NButton secondary @click="clearFilters">清空筛选</NButton>
          </template>
        </PpEmptyState>

        <template v-else-if="filtered.length">
          <table class="pp-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>状态</th>
                <th>余额</th>
                <th>负责人</th>
                <th>最近同步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in paged" :key="row.payerId">
                <td>
                  <button
                    type="button"
                    class="acct"
                    @click="router.push({ name: 'account-detail', params: { payerId: row.payerId } })"
                  >
                    <span class="acct__avatar">{{ (row.email || row.payerId).slice(0, 1).toUpperCase() }}</span>
                    <span class="acct__body">
                      <span class="acct__email">{{ row.email || row.payerId }}</span>
                      <span class="acct__name">{{ row.name || '未命名' }} · {{ row.payerId }}</span>
                    </span>
                  </button>
                </td>
                <td>
                  <span class="pp-badge" :class="`pp-badge--${statusTone(row.status)}`">
                    {{ accountStatusLabel(row.status) }}
                  </span>
                  <span
                    class="pp-badge"
                    :class="row.authorized ? 'pp-badge--ok' : 'pp-badge--warn'"
                    style="margin-left: 4px"
                  >
                    {{ row.authorized ? '已授权' : '未授权' }}
                  </span>
                </td>
                <td class="mono">{{ formatMoney(row.balance) }}</td>
                <td>
                  <span v-if="row.ownerName" class="owner">{{ row.ownerName }}</span>
                  <span v-else class="muted">未分配</span>
                </td>
                <td class="muted mono">{{ formatDateTime(row.lastSyncedAt) }}</td>
                <td>
                  <div class="ops">
                  <button
                    type="button"
                    class="op"
                    @click="router.push({ name: 'account-detail', params: { payerId: row.payerId } })"
                  >
                    <Icon icon="mdi:text-box-outline" width="14" />
                    详情
                  </button>
                  <button type="button" class="op" @click="openAssign(row)">
                    <Icon icon="mdi:account-arrow-right-outline" width="14" />
                    分配
                  </button>
                  <button
                    v-if="row.authorized"
                    type="button"
                    class="op"
                    :class="{ 'is-busy': syncingId === row.payerId }"
                    :disabled="!!syncingId"
                    @click="onSync(row)"
                  >
                    <Icon
                      :icon="syncingId === row.payerId ? 'mdi:loading' : 'mdi:cloud-sync-outline'"
                      width="14"
                      :class="{ spin: syncingId === row.payerId }"
                    />
                    {{ syncingId === row.payerId ? '同步中' : '同步' }}
                  </button>
                  <button
                    v-if="!row.authorized || row.status === 'pending'"
                    type="button"
                    class="op"
                    @click="startPayPalOAuth(row.payerId)"
                  >
                    <Icon icon="mdi:link-variant" width="14" />
                    重新授权
                  </button>
                  <button
                    v-if="row.authorized && row.status !== 'pending'"
                    type="button"
                    class="op is-danger"
                    @click="openRevoke(row)"
                  >
                    <Icon icon="mdi:link-off" width="14" />
                    解绑
                  </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="pp-pager">
            <div class="pp-pager__meta">共 {{ filtered.length }} 条 · 第 {{ page }} / {{ pageCount }} 页</div>
            <NPagination
              v-model:page="page"
              v-model:page-size="pageSize"
              :item-count="filtered.length"
              :page-sizes="pageSizes"
              show-size-picker
              size="small"
            />
          </div>
        </template>
      </div>
    </NSpin>

    <!-- 分配负责人 -->
    <Teleport to="body">
      <Transition name="pp-mask">
        <div
          v-if="assignVisible && assignTarget"
          class="pp-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-title"
          @click.self="closeAssign"
        >
          <div class="sheet">
            <header class="sheet__head">
              <div class="sheet__icon" aria-hidden="true">
                <Icon icon="mdi:account-tie-outline" width="22" />
              </div>
              <div class="sheet__head-text">
                <h2 id="assign-title" class="sheet__title">分配负责人</h2>
                <p class="sheet__sub">指定后，普通用户仅能查看已分配给自己的账号</p>
              </div>
              <button type="button" class="sheet__close" aria-label="关闭" @click="closeAssign">
                <Icon icon="mdi:close" width="18" />
              </button>
            </header>

            <div class="acct-chip">
              <div class="acct-chip__avatar" aria-hidden="true">
                {{ (assignTarget.email || assignTarget.payerId).slice(0, 1).toUpperCase() }}
              </div>
              <div class="acct-chip__body">
                <strong>{{ assignTarget.email || assignTarget.payerId }}</strong>
                <span>{{ assignTarget.name || '未命名商家' }} · {{ assignTarget.payerId }}</span>
              </div>
              <span
                v-if="assignTarget.ownerName"
                class="acct-chip__tag"
              >
                当前：{{ assignTarget.ownerName }}
              </span>
            </div>

            <div class="sheet__fields">
              <label class="field">
                <span class="field__label">负责人 ID</span>
                <NInput
                  v-model:value="assignOwnerId"
                  placeholder="例如 10086"
                  :disabled="assignSaving"
                >
                  <template #prefix>
                    <Icon icon="mdi:identifier" width="16" class="field__icon" />
                  </template>
                </NInput>
              </label>
              <label class="field">
                <span class="field__label">负责人名称</span>
                <NInput
                  v-model:value="assignOwnerName"
                  placeholder="列表中显示的名称"
                  :disabled="assignSaving"
                >
                  <template #prefix>
                    <Icon icon="mdi:badge-account-horizontal-outline" width="16" class="field__icon" />
                  </template>
                </NInput>
              </label>
            </div>

            <footer class="sheet__foot">
              <NButton quaternary :disabled="assignSaving" @click="closeAssign">取消</NButton>
              <NButton type="primary" :loading="assignSaving" @click="saveAssign">
                <template #icon><Icon icon="mdi:check" width="16" /></template>
                保存分配
              </NButton>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 同步账单 -->
    <Teleport to="body">
      <Transition name="pp-mask">
        <div
          v-if="syncVisible && syncTarget"
          class="pp-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-title"
          @click.self="closeSync"
        >
          <div class="sheet sheet--sync" :class="`sheet--sync-${syncPhase}`">
            <!-- 成功态：突出结果，不重复步骤 -->
            <template v-if="syncPhase === 'done'">
              <div class="sync-hero" aria-hidden="true">
                <span class="sync-hero__glow" />
                <span class="sync-hero__mark">
                  <Icon icon="mdi:check-bold" width="28" />
                </span>
              </div>
              <h2 id="sync-title" class="sync-h">同步完成</h2>
              <p class="sync-lead">近 31 天账单已写入本地缓存</p>
              <div class="sync-acct">
                <Icon icon="mdi:paypal" width="14" />
                <span>{{ syncTarget.email || syncTarget.payerId }}</span>
              </div>
              <div class="sync-stat">
                <div class="sync-stat__count">
                  <b>{{ syncCount }}</b>
                  <span>条交易</span>
                </div>
                <div class="sync-stat__meta">
                  <Icon icon="mdi:clock-outline" width="14" />
                  <span>{{ formatDateTime(syncSyncedAt) }}</span>
                </div>
              </div>
              <button type="button" class="sync-cta" @click="closeSync">完成</button>
            </template>

            <!-- 进行中 -->
            <template v-else-if="syncPhase === 'running'">
              <div class="sync-hero is-run" aria-hidden="true">
                <span class="sync-hero__ring" />
                <span class="sync-hero__mark">
                  <Icon icon="mdi:cloud-sync-outline" width="26" />
                </span>
              </div>
              <h2 id="sync-title" class="sync-h">正在同步账单</h2>
              <div class="sync-acct sync-acct--soft">
                <Icon icon="mdi:paypal" width="14" />
                <span>{{ syncTarget.email || syncTarget.payerId }}</span>
              </div>
              <ol class="sync-tl">
                <li class="is-done">连接 PayPal Transaction Search</li>
                <li class="is-active">拉取近 31 天交易并写入本地</li>
                <li>更新账号最近同步时间</li>
              </ol>
              <div class="sync-bar" aria-hidden="true"><span class="sync-bar__fill" /></div>
              <p class="sync-hint">请稍候，同步期间请勿关闭页面</p>
            </template>

            <!-- 失败 -->
            <template v-else>
              <div class="sync-hero is-err" aria-hidden="true">
                <span class="sync-hero__mark">
                  <Icon icon="mdi:alert-outline" width="26" />
                </span>
              </div>
              <h2 id="sync-title" class="sync-h">同步失败</h2>
              <div class="sync-acct sync-acct--soft">
                <Icon icon="mdi:paypal" width="14" />
                <span>{{ syncTarget.email || syncTarget.payerId }}</span>
              </div>
              <div class="sync-err">{{ syncError || '请求失败，请稍后重试' }}</div>
              <div class="sync-actions">
                <button type="button" class="sync-cta sync-cta--ghost" @click="closeSync">关闭</button>
                <button type="button" class="sync-cta" @click="onSync(syncTarget)">重试</button>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 解除授权 -->
    <Teleport to="body">
      <Transition name="pp-mask">
        <div
          v-if="revokeVisible && revokeTarget"
          class="pp-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-title"
          @click.self="closeRevoke"
        >
          <div class="sheet sheet--revoke">
            <button
              type="button"
              class="sheet__close sheet__close--abs"
              aria-label="关闭"
              :disabled="revokeSaving"
              @click="closeRevoke"
            >
              <Icon icon="mdi:close" width="18" />
            </button>

            <div class="revoke-hero" aria-hidden="true">
              <span class="revoke-hero__ring" />
              <span class="revoke-hero__mark">
                <Icon icon="mdi:link-variant-off" width="28" height="28" style="color: #fff" />
              </span>
            </div>

            <span class="revoke-pill">危险操作</span>
            <h2 id="revoke-title" class="sync-h">解除授权</h2>
            <p class="sync-lead">
              仅清除本系统保存的令牌，PayPal 商家账号本身不会被删除
            </p>

            <div class="acct-chip acct-chip--danger">
              <div class="acct-chip__avatar acct-chip__avatar--danger" aria-hidden="true">
                {{ (revokeTarget.email || revokeTarget.payerId).slice(0, 1).toUpperCase() }}
              </div>
              <div class="acct-chip__body">
                <strong>{{ revokeTarget.email || revokeTarget.payerId }}</strong>
                <span>{{ revokeTarget.name || '未命名商家' }} · {{ revokeTarget.payerId }}</span>
              </div>
              <span class="acct-chip__tag acct-chip__tag--warn">已授权</span>
            </div>

            <div class="revoke-card">
              <div class="revoke-card__row">
                <span class="revoke-ico revoke-ico--bad">
                  <Icon icon="mdi:key-remove" width="16" height="16" />
                </span>
                <div>
                  <b>清除令牌</b>
                  <em>access / refresh token 将从本地移除</em>
                </div>
              </div>
              <div class="revoke-card__row">
                <span class="revoke-ico revoke-ico--bad">
                  <Icon icon="mdi:sync-off" width="16" height="16" />
                </span>
                <div>
                  <b>暂停同步</b>
                  <em>需重新授权后才能继续拉取账单</em>
                </div>
              </div>
              <div class="revoke-card__row">
                <span class="revoke-ico revoke-ico--ok">
                  <Icon icon="mdi:check" width="16" height="16" />
                </span>
                <div>
                  <b>数据保留</b>
                  <em>本地已同步的交易记录不会删除</em>
                </div>
              </div>
            </div>

            <footer class="revoke-foot">
              <button
                type="button"
                class="sync-cta sync-cta--ghost"
                :disabled="revokeSaving"
                @click="closeRevoke"
              >
                取消
              </button>
              <button
                type="button"
                class="sync-cta sync-cta--danger"
                :disabled="revokeSaving"
                @click="confirmRevoke"
              >
                <Icon
                  v-if="!revokeSaving"
                  icon="mdi:link-variant-off"
                  width="16"
                  height="16"
                  style="color: #fff"
                />
                <Icon
                  v-else
                  icon="mdi:loading"
                  width="16"
                  height="16"
                  class="spin"
                  style="color: #fff"
                />
                确认解除
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.stats__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius);
  box-shadow: var(--pp-shadow);
}

.stats__ico {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 10px;
  color: #003087;
  background: #e7f0fb;
}

.stats__item.is-ok .stats__ico {
  color: #15803d;
  background: #e8f7ee;
}

.stats__item.is-warn .stats__ico {
  color: #b45309;
  background: #fff4e5;
}

.stats__item.is-bad .stats__ico {
  color: #b42318;
  background: #fdecec;
}

.stats__item b {
  display: block;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.stats__item span {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.search {
  position: relative;
}

.search__icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #8aa0b8;
  pointer-events: none;
}

.search .search-input {
  padding-left: 32px;
  background: #fff;
}

.search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--pp-border);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 0.875rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--pp-blue);
  box-shadow: 0 0 0 2px rgba(0, 112, 186, 0.12);
}

.acct {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.acct__avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: #e7f0fb;
  color: #003087;
  font-size: 0.85rem;
  font-weight: 700;
}

.acct__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.acct__email {
  font-weight: 600;
  color: var(--pp-blue);
}

.acct:hover .acct__email {
  text-decoration: underline;
}

.acct__name {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.owner {
  display: inline-flex;
  align-items: center;
  max-width: 140px;
  padding: 2px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 999px;
  background: #f3f6fb;
  color: #334155;
  font-size: 0.78rem;
}

.mono {
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--pp-muted);
  font-size: 0.8125rem;
}

.ops {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 4px;
  vertical-align: middle;
}

.op {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.op:hover:not(:disabled) {
  background: rgba(0, 112, 186, 0.08);
}

.op:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.op.is-busy {
  opacity: 1;
  color: #003087;
  background: rgba(0, 112, 186, 0.1);
}

.op.is-danger {
  color: var(--pp-danger);
}

.op.is-danger:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.08);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* —— shared modal shell —— */
.pp-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(11, 31, 58, 0.48);
  backdrop-filter: blur(6px);
}

.sheet {
  width: min(440px, 100%);
  padding: 22px 22px 18px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 20px 48px rgba(11, 31, 58, 0.22);
}

.sheet--sync {
  width: min(380px, 100%);
  padding: 32px 28px 24px;
  text-align: center;
  overflow: hidden;
}

.sheet--sync-done {
  background:
    radial-gradient(120% 70% at 50% -10%, rgba(13, 159, 110, 0.1), transparent 55%),
    #fff;
}

.sheet__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.sheet__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(145deg, #0070ba, #003087);
  flex-shrink: 0;
}

.sheet__head-text {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}

.sheet__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--pp-text);
}

.sheet__sub {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--pp-muted);
}

.sheet__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin: -4px -4px 0 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--pp-muted);
  cursor: pointer;
}

.sheet__close:hover {
  background: #f1f5f9;
  color: var(--pp-text);
}

.acct-chip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 18px;
  border-radius: 10px;
  background: #f5f8fc;
  border: 1px solid var(--pp-border);
}

.acct-chip__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #003087;
  background: rgba(0, 112, 186, 0.12);
  flex-shrink: 0;
}

.acct-chip__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.acct-chip__body strong {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--pp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-chip__body span {
  font-size: 0.75rem;
  color: var(--pp-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-chip__tag {
  flex-shrink: 0;
  max-width: 110px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #003087;
  background: rgba(0, 112, 186, 0.1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet__fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--pp-text);
}

.field__icon {
  color: var(--pp-muted);
  display: block;
}

.sheet__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.sheet__foot--split {
  justify-content: space-between;
}

.sheet--revoke {
  position: relative;
  width: min(400px, 100%);
  padding: 28px 24px 22px;
  text-align: center;
  background:
    radial-gradient(110% 60% at 50% -8%, rgba(220, 38, 38, 0.1), transparent 52%),
    #fff;
}

.sheet__close--abs {
  position: absolute;
  top: 12px;
  right: 12px;
  margin: 0;
}

.revoke-hero {
  position: relative;
  width: 84px;
  height: 84px;
  margin: 4px auto 14px;
}

.revoke-hero__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(220, 38, 38, 0.18);
  box-shadow: 0 0 0 8px rgba(220, 38, 38, 0.06);
}

.revoke-hero__mark {
  position: absolute;
  inset: 0;
  margin: auto;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(160deg, #f87171 0%, #dc2626 55%, #b91c1c 100%);
  box-shadow:
    0 12px 28px rgba(220, 38, 38, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  animation: sync-pop 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.revoke-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #b91c1c;
  background: rgba(220, 38, 38, 0.1);
}

.acct-chip--danger {
  text-align: left;
  background: linear-gradient(180deg, #fff8f8, #fff5f5);
  border-color: #fecaca;
  box-shadow: 0 1px 0 rgba(220, 38, 38, 0.04);
}

.acct-chip__avatar--danger {
  color: #991b1b;
  background: rgba(220, 38, 38, 0.12);
}

.acct-chip__tag--warn {
  color: #0d9f6e;
  background: rgba(13, 159, 110, 0.12);
}

.revoke-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 20px;
  border-radius: 12px;
  border: 1px solid var(--pp-border);
  background: #f8fafc;
  overflow: hidden;
  text-align: left;
}

.revoke-card__row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
}

.revoke-card__row + .revoke-card__row {
  border-top: 1px solid #e8eef6;
}

.revoke-card__row b {
  display: block;
  font-size: 0.8125rem;
  font-weight: 650;
  color: var(--pp-text);
  line-height: 1.35;
}

.revoke-card__row em {
  display: block;
  margin-top: 2px;
  font-style: normal;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--pp-muted);
}

.revoke-ico {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
  margin-top: 1px;
}

.revoke-ico--bad {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}

.revoke-ico--ok {
  color: #0d9f6e;
  background: rgba(13, 159, 110, 0.12);
}

.revoke-foot {
  display: grid;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
}

.sync-cta--danger {
  gap: 6px;
  background: linear-gradient(180deg, #ef4444, #dc2626);
  box-shadow: 0 8px 18px rgba(220, 38, 38, 0.28);
}

.sync-cta--danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #dc2626, #b91c1c);
}

.sync-cta--danger:disabled {
  opacity: 0.7;
  cursor: wait;
}

/* sync modal */
.sync-hero {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto 18px;
}

.sync-hero__glow {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(13, 159, 110, 0.22), transparent 70%);
  animation: sync-glow 1.6s ease-in-out infinite;
}

.sync-hero__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid rgba(0, 112, 186, 0.14);
  border-top-color: #0070ba;
  animation: spin 0.85s linear infinite;
}

.sync-hero__mark {
  position: absolute;
  inset: 0;
  margin: auto;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, #12b981, #0d9f6e);
  box-shadow: 0 10px 24px rgba(13, 159, 110, 0.28);
  animation: sync-pop 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.sync-hero.is-run .sync-hero__mark {
  background: linear-gradient(145deg, #1a8ad4, #0070ba);
  box-shadow: 0 10px 24px rgba(0, 112, 186, 0.28);
  animation: none;
}

.sync-hero.is-err .sync-hero__mark {
  background: linear-gradient(145deg, #ef4444, #dc2626);
  box-shadow: 0 10px 24px rgba(220, 38, 38, 0.28);
  animation: sync-pop 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.sync-h {
  margin: 0 0 6px;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--pp-text);
}

.sync-lead {
  margin: 0 0 14px;
  font-size: 0.875rem;
  color: var(--pp-muted);
  line-height: 1.45;
}

.sync-acct {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 0 auto 18px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #0f5132;
  background: rgba(13, 159, 110, 0.1);
  overflow: hidden;
}

.sync-acct span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-acct--soft {
  color: #003087;
  background: rgba(0, 112, 186, 0.08);
  margin-bottom: 16px;
}

.sync-stat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 16px 14px;
  margin-bottom: 20px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f4faf7 0%, #f7f9fc 100%);
  border: 1px solid rgba(13, 159, 110, 0.14);
}

.sync-stat__count {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.sync-stat__count b {
  font-size: 2.25rem;
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #0d9f6e;
  font-variant-numeric: tabular-nums;
}

.sync-stat__count span {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.sync-stat__meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px dashed rgba(13, 159, 110, 0.2);
  font-size: 0.75rem;
  color: var(--pp-muted);
  font-variant-numeric: tabular-nums;
}

.sync-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: #0070ba;
  color: #fff;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}

.sync-cta:hover {
  background: #005ea6;
}

.sync-cta:active {
  transform: scale(0.98);
}

.sync-cta--ghost {
  background: #eef2f7;
  color: var(--pp-text);
}

.sync-cta--ghost:hover {
  background: #e2e8f0;
}

.sync-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.sync-tl {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  text-align: left;
}

.sync-tl li {
  position: relative;
  padding: 0 0 14px 22px;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: #94a3b8;
}

.sync-tl li:last-child {
  padding-bottom: 0;
}

.sync-tl li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d0d7e2;
  box-shadow: 0 0 0 3px #f1f5f9;
}

.sync-tl li::after {
  content: '';
  position: absolute;
  left: 7px;
  top: 18px;
  bottom: 0;
  width: 2px;
  background: #e8eef6;
}

.sync-tl li:last-child::after {
  display: none;
}

.sync-tl li.is-done {
  color: #003087;
}

.sync-tl li.is-done::before {
  background: #0070ba;
  box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.14);
}

.sync-tl li.is-active {
  color: #0070ba;
  font-weight: 600;
}

.sync-tl li.is-active::before {
  background: #0070ba;
  box-shadow: 0 0 0 4px rgba(0, 112, 186, 0.2);
  animation: pulse 1.1s ease-in-out infinite;
}

.sync-bar {
  height: 4px;
  border-radius: 999px;
  background: #e8eef6;
  overflow: hidden;
  margin-bottom: 12px;
}

.sync-bar__fill {
  display: block;
  height: 100%;
  width: 35%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0070ba, #1e8fff);
  animation: sync-indeterminate 1.2s ease-in-out infinite;
}

.sync-err {
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 10px;
  text-align: left;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.sync-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--pp-muted);
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(0, 112, 186, 0.16);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(0, 112, 186, 0.28);
  }
}

@keyframes sync-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@keyframes sync-glow {
  0%,
  100% {
    opacity: 0.7;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

@keyframes sync-pop {
  from {
    opacity: 0;
    transform: scale(0.72);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.pp-mask-enter-active,
.pp-mask-leave-active {
  transition: opacity 0.2s ease;
}

.pp-mask-enter-active .sheet,
.pp-mask-leave-active .sheet {
  transition: transform 0.22s ease, opacity 0.2s ease;
}

.pp-mask-enter-from,
.pp-mask-leave-to {
  opacity: 0;
}

.pp-mask-enter-from .sheet,
.pp-mask-leave-to .sheet {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 720px) {
  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
