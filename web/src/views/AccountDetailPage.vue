<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NForm, NFormItem, NInput, NModal, NPagination, NSpin, useMessage } from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpTxDetailDrawer from '@/components/PpTxDetailDrawer.vue';
import {
  fetchAccount,
  fetchAccountTransactions,
  fetchOrder,
  patchAccount,
  syncAccountTransactions
} from '@/api/paypal';
import type { PayPalAccount, TransactionItem } from '@/api/types';
import { accountStatusLabel, accountStatusTagType } from '@/lib/account-status';
import { formatDateTime, formatMoney } from '@/lib/format';
import { startPayPalOAuth } from '@/lib/oauth';
import {
  formatAmountObj,
  summarizeRows,
  txAmountNumber,
  txEventLabel,
  txId,
  txInfo,
  txInitiatedAt,
  txStatusMeta
} from '@/lib/transaction';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const payerId = computed(() => String(route.params.payerId || ''));
const loading = ref(true);
const syncing = ref(false);
const saving = ref(false);
const account = ref<PayPalAccount | null>(null);
const transactions = ref<TransactionItem[]>([]);
const syncedAt = ref('');
const ownerUserId = ref('');
const ownerName = ref('');
const note = ref('');
const ownerOpen = ref(false);
const orderId = ref('');
const orderLoading = ref(false);
const orderOpen = ref(false);
const orderResult = ref<unknown>(null);

const page = ref(1);
const pageSize = ref(10);
const detailOpen = ref(false);
const detailTx = ref<TransactionItem | null>(null);

const pagedTransactions = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return transactions.value.slice(start, start + pageSize.value);
});

const txSummary = computed(() =>
  summarizeRows(
    transactions.value.map(tx => ({
      payerId: payerId.value,
      email: account.value?.email || '',
      tx
    }))
  )
);

function amountClass(tx: TransactionItem) {
  const n = txAmountNumber(tx);
  if (n > 0) return 'is-in';
  if (n < 0) return 'is-out';
  return '';
}

function statusTone(status: PayPalAccount['status']) {
  const t = accountStatusTagType(status);
  if (t === 'success') return 'ok';
  if (t === 'warning') return 'warn';
  if (t === 'error') return 'bad';
  return 'mute';
}

function badgeTone(type: string) {
  if (type === 'success') return 'ok';
  if (type === 'warning') return 'warn';
  if (type === 'error') return 'bad';
  if (type === 'info') return 'info';
  return 'mute';
}

function openDetail(tx: TransactionItem) {
  detailTx.value = tx;
  detailOpen.value = true;
}

async function loadAccount() {
  loading.value = true;
  page.value = 1;
  try {
    account.value = await fetchAccount(payerId.value);
    ownerUserId.value = account.value.ownerUserId || '';
    ownerName.value = account.value.ownerName || '';
    note.value = account.value.note || '';
    const tx = await fetchAccountTransactions(payerId.value);
    transactions.value = tx.items || [];
    syncedAt.value = tx.syncedAt || '';
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败');
    account.value = null;
    transactions.value = [];
  } finally {
    loading.value = false;
  }
}

async function saveOwner() {
  saving.value = true;
  try {
    account.value = await patchAccount(payerId.value, {
      ownerUserId: ownerUserId.value.trim(),
      ownerName: ownerName.value.trim(),
      note: note.value.trim()
    });
    message.success('已保存');
    ownerOpen.value = false;
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function syncTx() {
  syncing.value = true;
  try {
    const res = await syncAccountTransactions(payerId.value);
    message.success(`同步 ${res.count} 条`);
    const tx = await fetchAccountTransactions(payerId.value);
    transactions.value = tx.items || [];
    syncedAt.value = tx.syncedAt || '';
    page.value = 1;
    if (account.value) {
      account.value = { ...account.value, lastSyncedAt: syncedAt.value };
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function queryOrder() {
  if (!orderId.value.trim()) {
    message.warning('请输入 Order ID');
    return;
  }
  orderLoading.value = true;
  orderResult.value = null;
  try {
    const res = await fetchOrder(payerId.value, orderId.value.trim());
    orderResult.value = res.order;
    orderOpen.value = true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : '查询失败');
  } finally {
    orderLoading.value = false;
  }
}

onMounted(() => void loadAccount());
watch(payerId, () => void loadAccount());
watch(pageSize, () => {
  page.value = 1;
});
</script>

<template>
  <div class="pp-page">
    <button type="button" class="back" @click="router.push({ name: 'accounts' })">
      <Icon icon="mdi:arrow-left" width="16" />
      返回账号列表
    </button>

    <NSpin :show="loading">
      <template v-if="account">
        <header class="hero">
          <div class="hero__top">
            <div class="hero__id">
              <span class="hero__avatar" aria-hidden="true">
                {{ (account.email || account.payerId).slice(0, 1).toUpperCase() }}
              </span>
              <div class="hero__copy">
                <h1 class="hero__title">{{ account.email || account.payerId }}</h1>
                <p class="hero__meta">{{ account.name || '未命名商家' }} · {{ account.payerId }}</p>
                <div class="hero__badges">
                  <span class="pp-badge" :class="`pp-badge--${statusTone(account.status)}`">
                    {{ accountStatusLabel(account.status) }}
                  </span>
                  <span class="pp-badge" :class="account.authorized ? 'pp-badge--ok' : 'pp-badge--warn'">
                    {{ account.authorized ? '已授权' : '未授权' }}
                  </span>
                </div>
              </div>
            </div>
            <div class="hero__actions">
              <button type="button" class="owner-entry" @click="ownerOpen = true">
                <Icon icon="mdi:account-edit-outline" width="16" />
                <span>{{ ownerName ? `负责人 ${ownerName}` : '负责人与备注' }}</span>
                <Icon icon="mdi:chevron-right" width="16" class="owner-entry__chev" />
              </button>
              <NButton v-if="!account.authorized" type="primary" @click="startPayPalOAuth(payerId)">
                重新授权
              </NButton>
              <NButton v-if="account.authorized" type="primary" :loading="syncing" @click="syncTx">
                <template #icon><Icon icon="mdi:cloud-sync-outline" width="16" /></template>
                同步近 31 天
              </NButton>
            </div>
          </div>

          <div class="metrics">
            <div class="metric">
              <span class="metric__ico"><Icon icon="mdi:wallet-outline" width="18" /></span>
              <div>
                <span>余额</span>
                <b :class="{ 'is-empty': account.balance == null }">{{ formatMoney(account.balance) }}</b>
              </div>
            </div>
            <div class="metric">
              <span class="metric__ico is-warn"><Icon icon="mdi:snowflake" width="18" /></span>
              <div>
                <span>冻结</span>
                <b>{{ formatMoney(account.frozenAmount) }}</b>
              </div>
            </div>
            <div class="metric">
              <span class="metric__ico"><Icon icon="mdi:receipt-text-outline" width="18" /></span>
              <div>
                <span>本地交易</span>
                <b>{{ transactions.length }}</b>
              </div>
            </div>
            <div class="metric">
              <span class="metric__ico"><Icon icon="mdi:clock-outline" width="18" /></span>
              <div>
                <span>最近同步</span>
                <b class="sm">{{ formatDateTime(account.lastSyncedAt) }}</b>
              </div>
            </div>
          </div>
        </header>

        <section class="pp-table-wrap">
          <div class="tx-head">
            <div>
              <h2 class="card-title" style="margin: 0">账号交易</h2>
              <span class="hint">
                共 {{ txSummary.count }} 笔
                <template v-if="syncedAt"> · 缓存 {{ formatDateTime(syncedAt) }}</template>
              </span>
            </div>
            <form class="order-search" @submit.prevent="queryOrder">
              <Icon icon="mdi:magnify" width="18" class="order-search__icon" />
              <input
                v-model="orderId"
                class="order-search__input"
                type="search"
                placeholder="查询 PayPal 订单号"
                autocomplete="off"
              />
              <NButton type="primary" attr-type="submit" :loading="orderLoading">查询</NButton>
            </form>
          </div>

          <PpEmptyState
            v-if="!transactions.length"
            compact
            icon="mdi:receipt-text-outline"
            title="暂无交易缓存"
            :description="account.authorized ? '点击「同步近 31 天」拉取账单。' : '重新授权后才能拉取账单。'"
          >
            <template #actions>
              <NButton v-if="account.authorized" type="primary" :loading="syncing" @click="syncTx">立即同步</NButton>
              <NButton v-else type="primary" @click="startPayPalOAuth(payerId)">重新授权</NButton>
            </template>
          </PpEmptyState>

          <template v-else>
            <table class="pp-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>交易 ID</th>
                  <th>类型</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="tx in pagedTransactions"
                  :key="txId(tx)"
                  class="clickable"
                  @click="openDetail(tx)"
                >
                  <td class="mono">{{ txInitiatedAt(tx) }}</td>
                  <td>
                    <button type="button" class="pp-table__link mono" @click.stop="openDetail(tx)">
                      {{ txId(tx) || '—' }}
                    </button>
                  </td>
                  <td>{{ txEventLabel(txInfo(tx).transaction_event_code) }}</td>
                  <td>
                    <span class="money" :class="amountClass(tx)">
                      {{ formatAmountObj(txInfo(tx).transaction_amount) }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="pp-badge"
                      :class="`pp-badge--${badgeTone(txStatusMeta(txInfo(tx).transaction_status).type)}`"
                    >
                      {{ txStatusMeta(txInfo(tx).transaction_status).label }}
                    </span>
                  </td>
                  <td>
                    <button type="button" class="pp-table__link" @click.stop="openDetail(tx)">详情</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="pp-pager">
              <div class="pp-pager__meta">共 {{ transactions.length }} 条</div>
              <NPagination
                v-model:page="page"
                v-model:page-size="pageSize"
                :item-count="transactions.length"
                :page-sizes="[10, 20, 50]"
                show-size-picker
                size="small"
              />
            </div>
          </template>
        </section>
      </template>

      <PpEmptyState
        v-else-if="!loading"
        icon="mdi:account-off-outline"
        title="账号不存在"
        description="该 Payer ID 可能尚未授权或已被移除。"
      >
        <template #actions>
          <NButton type="primary" @click="router.push({ name: 'accounts' })">返回列表</NButton>
        </template>
      </PpEmptyState>
    </NSpin>

    <NModal
      :show="orderOpen"
      preset="card"
      :title="`订单 ${orderId.trim() || ''}`"
      style="width: 720px"
      @update:show="open => { if (!open) orderOpen = false }"
    >
      <pre class="json json--modal">{{ JSON.stringify(orderResult, null, 2) }}</pre>
    </NModal>

    <NModal
      :show="ownerOpen"
      preset="card"
      title="负责人与备注"
      style="width: 480px"
      @update:show="open => { if (!open) ownerOpen = false }"
    >
      <NForm label-placement="top">
        <NFormItem label="负责人 ID">
          <NInput v-model:value="ownerUserId" />
        </NFormItem>
        <NFormItem label="负责人名称">
          <NInput v-model:value="ownerName" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="note" type="textarea" :rows="4" />
        </NFormItem>
      </NForm>
      <div class="dlg-foot">
        <NButton @click="ownerOpen = false">取消</NButton>
        <NButton type="primary" :loading="saving" @click="saveOwner">保存</NButton>
      </div>
    </NModal>

    <PpTxDetailDrawer
      :open="detailOpen"
      :payer-id="payerId"
      :email="account?.email"
      :tx="detailTx"
      @close="detailOpen = false"
    />
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 550;
  cursor: pointer;
}

.hero {
  margin-bottom: 14px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  overflow: hidden;
}

.hero__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px 16px;
}

.hero__id {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.hero__avatar {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 14px;
  background: #e7f0fb;
  color: #003087;
  font-size: 1.15rem;
  font-weight: 700;
}

.hero__copy {
  min-width: 0;
}

.hero__title {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.hero__meta {
  margin: 4px 0 0;
  color: var(--pp-muted);
  font-size: 0.8rem;
}

.hero__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  flex: none;
}

.owner-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  background: #fff;
  color: var(--pp-text);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}

.owner-entry:hover {
  border-color: #7aa7e8;
  color: #003087;
}

.owner-entry__chev {
  color: #8aa0b8;
}

.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--pp-border);
  background: #f7f9fc;
}

.metric {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
}

.metric + .metric {
  border-left: 1px solid var(--pp-border);
}

.metric__ico {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  color: #003087;
  background: #e7f0fb;
}

.metric__ico.is-warn {
  color: #b45309;
  background: #fff4e5;
}

.metric span {
  display: block;
  font-size: 0.72rem;
  color: var(--pp-muted);
}

.metric b {
  display: block;
  margin-top: 2px;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.metric b.sm {
  font-size: 0.82rem;
  font-weight: 650;
}

.metric b.is-empty {
  color: var(--pp-muted);
  font-weight: 600;
}

.card-title {
  margin: 0 0 14px;
  font-size: 0.95rem;
  font-weight: 650;
}

.hint {
  display: block;
  margin-top: 4px;
  font-size: 0.78rem;
  color: var(--pp-muted);
}

.order-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 280px;
  padding: 4px 4px 4px 10px;
  border: 1px solid var(--pp-border);
  border-radius: 10px;
  background: #f7f9fc;
}

.order-search:focus-within {
  border-color: #7aa7e8;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
}

.order-search__icon {
  flex: none;
  color: #7b8ba3;
}

.order-search__input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.84rem;
  color: var(--pp-text);
  outline: none;
}

.json {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: #f7f9fc;
  border: 1px solid var(--pp-border);
  font-size: 0.75rem;
  line-height: 1.5;
  overflow: auto;
}

.json--modal {
  max-height: 60vh;
}

.tx-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--pp-border);
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.money {
  font-weight: 650;
}

.money.is-in {
  color: #15803d;
}

.money.is-out {
  color: #b91c1c;
}

.clickable {
  cursor: pointer;
}

.clickable:hover td {
  background: #f8fafc;
}

@media (max-width: 900px) {
  .hero__top {
    align-items: flex-start;
    flex-direction: column;
  }

  .metrics {
    grid-template-columns: 1fr 1fr;
  }

  .metric:nth-child(odd) {
    border-left: 0;
  }

  .metric:nth-child(n + 3) {
    border-top: 1px solid var(--pp-border);
  }

  .tx-head {
    grid-template-columns: 1fr;
    display: grid;
  }

  .order-search {
    min-width: 0;
    width: 100%;
  }
}
</style>
