<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NPagination, NSelect, NSpin, useMessage } from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpTxDetailDrawer from '@/components/PpTxDetailDrawer.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import { fetchAccounts, fetchRecentTransactionsAcrossAccounts } from '@/api/paypal';
import type { PayPalAccount } from '@/api/types';
import { startPayPalOAuth } from '@/lib/oauth';
import {
  formatAmountObj,
  txAmountNumber,
  txCounterparty,
  txEventLabel,
  txEventOptions,
  txId,
  txInfo,
  txInitiatedAt,
  txStatusMeta,
  txSubject,
  type TxRow
} from '@/lib/transaction';

const router = useRouter();
const message = useMessage();
const loading = ref(false);
const accounts = ref<PayPalAccount[]>([]);
const filterPayerId = ref<string | null>(null);
const statusFilter = ref<string | null>(null);
const typeFilter = ref<string | null>(null);
const keyword = ref('');
const rows = ref<TxRow[]>([]);

const detailOpen = ref(false);
const detailRow = ref<TxRow | null>(null);

const accountOptions = ref<{ label: string; value: string }[]>([]);
const statusOptions = [
  { label: '成功', value: 'S' },
  { label: '处理中', value: 'P' },
  { label: '拒绝', value: 'D' },
  { label: '撤销', value: 'V' },
  { label: '部分退款', value: 'F' }
];

const hasAccounts = computed(() => accounts.value.length > 0);
const isFilteredEmpty = computed(() => Boolean(filterPayerId.value) && hasAccounts.value);

const typeOptions = computed(() => {
  const codes = rows.value.map(r => txInfo(r.tx).transaction_event_code || '').filter(Boolean);
  return txEventOptions(codes);
});

const filteredRows = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return rows.value.filter(row => {
    const info = txInfo(row.tx);
    if (statusFilter.value && info.transaction_status !== statusFilter.value) return false;
    if (typeFilter.value && info.transaction_event_code !== typeFilter.value) return false;
    if (!q) return true;
    const hay = [
      row.email,
      row.payerId,
      txId(row.tx),
      txCounterparty(row.tx),
      txSubject(row.tx),
      info.invoice_id,
      info.paypal_reference_id,
      info.transaction_event_code,
      txEventLabel(info.transaction_event_code)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
});

const { page, pageSize, pageSizes, paged: pagedRows, pageCount, resetPage } = useClientPagination(
  filteredRows,
  10
);

function amountClass(row: TxRow) {
  const n = txAmountNumber(row.tx);
  if (n > 0) return 'is-in';
  if (n < 0) return 'is-out';
  return '';
}

function badgeTone(type: string) {
  if (type === 'success') return 'ok';
  if (type === 'warning') return 'warn';
  if (type === 'error') return 'bad';
  if (type === 'info') return 'info';
  return 'mute';
}

function clearFilters() {
  keyword.value = '';
  statusFilter.value = null;
  typeFilter.value = null;
  filterPayerId.value = null;
  resetPage();
}

async function loadAccounts() {
  try {
    accounts.value = await fetchAccounts();
    accountOptions.value = accounts.value.map(a => ({
      label: a.email || a.payerId,
      value: a.payerId
    }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载账号失败');
  }
}

async function loadTransactions() {
  loading.value = true;
  try {
    const list = filterPayerId.value
      ? accounts.value.filter(a => a.payerId === filterPayerId.value)
      : accounts.value;
    rows.value = await fetchRecentTransactionsAcrossAccounts(
      list,
      filterPayerId.value ? 200 : 80,
      500
    );
    resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载交易失败');
  } finally {
    loading.value = false;
  }
}

function onQuery() {
  resetPage();
  void loadTransactions();
}

function goSync() {
  if (filterPayerId.value) {
    void router.push({ name: 'account-detail', params: { payerId: filterPayerId.value } });
    return;
  }
  if (accounts.value[0]) {
    void router.push({ name: 'account-detail', params: { payerId: accounts.value[0].payerId } });
    return;
  }
  void router.push({ name: 'accounts' });
}

function openDetail(row: TxRow) {
  detailRow.value = row;
  detailOpen.value = true;
}

function closeDetail() {
  detailOpen.value = false;
}

onMounted(async () => {
  await loadAccounts();
  await loadTransactions();
});

watch(filterPayerId, () => void loadTransactions());
watch([statusFilter, typeFilter, keyword], () => resetPage());
</script>

<template>
  <div class="pp-page">
    <div class="pp-page-head">
      <div>
        <h1 class="pp-page-title">交易记录</h1>
        <p class="pp-page-desc">按账号、状态、类型筛选交易；点击详情查看完整信息</p>
      </div>
      <NButton secondary @click="goSync">
        <template #icon><Icon icon="mdi:cloud-sync-outline" width="16" /></template>
        去同步
      </NButton>
    </div>

    <div class="pp-filter">
      <div class="pp-filter__field pp-filter__field--account">
        <NSelect
          v-model:value="filterPayerId"
          :options="accountOptions"
          placeholder="全部账号"
          clearable
          size="medium"
        />
      </div>
      <div class="pp-filter__field">
        <NSelect
          v-model:value="statusFilter"
          :options="statusOptions"
          placeholder="交易状态"
          clearable
          size="medium"
        />
      </div>
      <div class="pp-filter__field pp-filter__field--wide">
        <NSelect
          v-model:value="typeFilter"
          :options="typeOptions"
          placeholder="交易类型"
          clearable
          filterable
          size="medium"
        />
      </div>
      <div class="pp-filter__search search">
        <Icon icon="mdi:magnify" width="16" class="search__icon" />
        <input
          v-model="keyword"
          class="search-input"
          type="search"
          placeholder="交易 ID / 订单号 / 邮箱"
          autocomplete="off"
          @keyup.enter="onQuery"
        />
      </div>
      <NButton type="primary" @click="onQuery">查询</NButton>
      <NButton quaternary @click="clearFilters">重置</NButton>
    </div>

    <NSpin :show="loading">
      <template v-if="!loading && !rows.length">
        <div class="pp-table-wrap">
          <PpEmptyState
            v-if="!hasAccounts"
            icon="mdi:receipt-text-outline"
            title="还没有可展示的交易"
            description="先绑定收款账号并同步账单（当前支持 PayPal）。"
          >
            <template #actions>
              <NButton type="primary" @click="startPayPalOAuth()">授权收款账号</NButton>
            </template>
          </PpEmptyState>
          <PpEmptyState
            v-else-if="isFilteredEmpty"
            icon="mdi:filter-off-outline"
            title="该账号暂无交易缓存"
            description="可进入账号详情同步近 31 天，或清空筛选。"
          >
            <template #actions>
              <NButton type="primary" @click="goSync">去同步</NButton>
              <NButton quaternary @click="filterPayerId = null">查看全部</NButton>
            </template>
          </PpEmptyState>
          <PpEmptyState
            v-else
            icon="mdi:receipt-text-outline"
            title="暂无交易数据"
            :description="`已接入 ${accounts.length} 个账号，同步后展示流水。`"
          >
            <template #actions>
              <NButton type="primary" @click="goSync">去同步</NButton>
            </template>
          </PpEmptyState>
        </div>
      </template>

      <template v-else>
        <div class="pp-table-wrap">
          <PpEmptyState
            v-if="!filteredRows.length"
            compact
            icon="mdi:filter-remove-outline"
            title="没有匹配的交易"
            description="试试调整筛选条件。"
          >
            <template #actions>
              <NButton secondary @click="clearFilters">清空筛选</NButton>
            </template>
          </PpEmptyState>

          <template v-else>
            <table class="pp-table">
              <thead>
                <tr>
                  <th>交易时间</th>
                  <th>交易 ID</th>
                  <th>类型</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>账号</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in pagedRows" :key="`${row.payerId}-${txId(row.tx)}-${i}`">
                  <td class="mono">{{ txInitiatedAt(row.tx) }}</td>
                  <td>
                    <button type="button" class="pp-table__link mono" @click="openDetail(row)">
                      {{ txId(row.tx) || '—' }}
                    </button>
                  </td>
                  <td>{{ txEventLabel(txInfo(row.tx).transaction_event_code) }}</td>
                  <td>
                    <span class="money" :class="amountClass(row)">
                      {{ formatAmountObj(txInfo(row.tx).transaction_amount) }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="pp-badge"
                      :class="`pp-badge--${badgeTone(txStatusMeta(txInfo(row.tx).transaction_status).type)}`"
                    >
                      {{ txStatusMeta(txInfo(row.tx).transaction_status).label }}
                    </span>
                  </td>
                  <td class="muted">{{ row.email || row.payerId }}</td>
                  <td>
                    <button type="button" class="pp-table__link" @click="openDetail(row)">详情</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="pp-pager">
              <div class="pp-pager__meta">
                共 {{ filteredRows.length }} 条 · 第 {{ page }} / {{ pageCount }} 页
              </div>
              <NPagination
                v-model:page="page"
                v-model:page-size="pageSize"
                :item-count="filteredRows.length"
                :page-sizes="pageSizes"
                show-size-picker
                size="small"
              />
            </div>
          </template>
        </div>
      </template>
    </NSpin>

    <PpTxDetailDrawer
      :open="detailOpen"
      :payer-id="detailRow?.payerId || ''"
      :email="detailRow?.email"
      :tx="detailRow?.tx || null"
      @close="closeDetail"
    />
  </div>
</template>

<style scoped>
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

.pp-filter__field--wide {
  width: 260px;
  flex-basis: 260px;
}

.search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border: 1px solid var(--pp-border);
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 0.875rem;
  color: var(--pp-text);
  outline: none;
}

.search-input:focus {
  border-color: var(--pp-blue);
  box-shadow: 0 0 0 2px rgba(0, 112, 186, 0.12);
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.muted {
  color: var(--pp-muted);
  font-size: 0.8125rem;
}

.money {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.money.is-in,
.is-in {
  color: #15803d;
}

.money.is-out,
.is-out {
  color: #b91c1c;
}
</style>
