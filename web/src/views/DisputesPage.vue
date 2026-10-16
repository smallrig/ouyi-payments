<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NPagination, NSelect, NSpin, useMessage } from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import { fetchDisputes, seedSampleDisputes, syncDisputes } from '@/api/paypal';
import type { DisputeItem } from '@/api/types';
import {
  disputeReasonOptions,
  disputeStageOptions,
  disputeStatusOptions,
  outcomeLabel,
  reasonLabel,
  stageLabel,
  statusLabel
} from '@/lib/dispute';
import { formatDateTime } from '@/lib/format';

const router = useRouter();
const message = useMessage();
const loading = ref(false);
const syncing = ref(false);
const seeding = ref(false);
const disputes = ref<DisputeItem[]>([]);
const keyword = ref('');
const statusFilter = ref<string | null>(null);
const stageFilter = ref<string | null>(null);
const reasonFilter = ref<string | null>(null);
const accountFilter = ref<string | null>(null);
const dueFilter = ref<string | null>(null);

const accountOptions = computed(() => {
  const ids = [...new Set(disputes.value.map(row => row.payerId).filter(Boolean))];
  return ids.map(id => ({ label: id, value: id }));
});

const dueOptions = [
  { label: '即将到期', value: 'soon' },
  { label: '已逾期', value: 'overdue' },
  { label: '未逾期', value: 'open' }
];

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return disputes.value.filter(row => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
    if (stageFilter.value && (row.lifeCycleStage || row.caseType) !== stageFilter.value) return false;
    if (reasonFilter.value && row.reason !== reasonFilter.value) return false;
    if (accountFilter.value && row.payerId !== accountFilter.value) return false;
    const due = dueState(row);
    if (dueFilter.value === 'soon' && due !== 'soon') return false;
    if (dueFilter.value === 'overdue' && due !== 'overdue') return false;
    if (dueFilter.value === 'open' && due === 'overdue') return false;
    if (!q) return true;
    const haystack = [
      row.id,
      row.payerId,
      row.buyerEmail,
      row.relatedTransactionId,
      row.itemName,
      reasonLabel(row.reason),
      stageLabel(row.lifeCycleStage || row.caseType),
      statusLabel(row.status)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
});

const { page, pageSize, pageSizes, paged, pageCount, resetPage } = useClientPagination(filtered, 10);

function badgeTone(status: string) {
  if (status === 'OPEN' || status === 'UNDER_REVIEW') return 'bad';
  if (status === 'RESOLVED') return 'ok';
  if (status === 'WAITING_FOR_BUYER_RESPONSE') return 'info';
  if (status === 'WAITING_FOR_SELLER_RESPONSE') return 'warn';
  return 'mute';
}

function dueState(row: DisputeItem) {
  if (!row.deadlineAt || row.status === 'RESOLVED') return '';
  const due = new Date(row.deadlineAt).getTime();
  if (Number.isNaN(due)) return '';
  const left = due - Date.now();
  if (left < 0) return 'overdue';
  if (left <= 3 * 86400000) return 'soon';
  return 'ok';
}

function goDetail(row: DisputeItem) {
  void router.push({ name: 'dispute-detail', params: { id: row.id } });
}

function amountText(row: DisputeItem) {
  if (!row.amount?.value) return '—';
  return `${row.amount.value} ${row.amount.currency_code || ''}`.trim();
}

function deadlineText(row: DisputeItem) {
  if (row.deadlineAt) return formatDateTime(row.deadlineAt);
  if (!row.createdAt) return '—';
  const date = new Date(row.createdAt);
  if (Number.isNaN(date.getTime())) return '—';
  date.setDate(date.getDate() + 13);
  return formatDateTime(date.toISOString());
}

async function load() {
  loading.value = true;
  try {
    disputes.value = await fetchDisputes();
    resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载争议失败');
  } finally {
    loading.value = false;
  }
}

async function onSeed() {
  seeding.value = true;
  try {
    const res = await seedSampleDisputes();
    message.success(res.message || '已生成示例争议');
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '生成示例失败');
  } finally {
    seeding.value = false;
  }
}

async function onSync() {
  syncing.value = true;
  try {
    const res = await syncDisputes();
    message.success(res.message || '同步完成');
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '同步失败');
  } finally {
    syncing.value = false;
  }
}

function clearFilters() {
  keyword.value = '';
  statusFilter.value = null;
  stageFilter.value = null;
  reasonFilter.value = null;
  accountFilter.value = null;
  dueFilter.value = null;
  resetPage();
}

watch([keyword, statusFilter, stageFilter, reasonFilter, accountFilter, dueFilter], () => resetPage());

onMounted(() => void load());
</script>

<template>
  <div class="pp-page">
    <div class="pp-page-head">
      <div>
        <h1 class="pp-page-title">争议案件</h1>
        <p class="pp-page-desc">查看买家投诉与争议进度；点击进入案件详情</p>
      </div>
      <div class="head-actions">
        <NButton :loading="seeding" @click="onSeed">
          <template #icon><Icon icon="mdi:playlist-plus" width="16" /></template>
          生成示例
        </NButton>
        <NButton type="primary" :loading="syncing" @click="onSync">
          <template #icon><Icon icon="mdi:cloud-sync-outline" width="16" /></template>
          同步争议
        </NButton>
      </div>
    </div>

    <div class="pp-filter">
      <div class="pp-filter__search search">
        <Icon icon="mdi:magnify" width="16" class="search__icon" />
        <input
          v-model="keyword"
          class="search-input"
          type="search"
          placeholder="案件号 / 邮箱 / 交易号"
          autocomplete="off"
        />
      </div>
      <div class="pp-filter__field">
        <NSelect v-model:value="statusFilter" :options="disputeStatusOptions" placeholder="状态" clearable />
      </div>
      <div class="pp-filter__field">
        <NSelect v-model:value="stageFilter" :options="disputeStageOptions" placeholder="阶段" clearable />
      </div>
      <div class="pp-filter__field">
        <NSelect v-model:value="reasonFilter" :options="disputeReasonOptions" placeholder="原因" clearable />
      </div>
      <div class="pp-filter__field pp-filter__field--account">
        <NSelect v-model:value="accountFilter" :options="accountOptions" placeholder="商家账号" clearable />
      </div>
      <div class="pp-filter__field">
        <NSelect v-model:value="dueFilter" :options="dueOptions" placeholder="截止时间" clearable />
      </div>
      <NButton type="primary" @click="resetPage">查询</NButton>
      <NButton quaternary @click="clearFilters">重置</NButton>
    </div>

    <NSpin :show="loading">
      <div class="pp-table-wrap">
        <PpEmptyState
          v-if="!loading && !disputes.length"
          icon="mdi:shield-alert-outline"
          title="暂无争议记录"
          description="同步后可在此查看买家争议状态、金额与原因。"
        >
          <template #actions>
            <NButton :loading="seeding" @click="onSeed">生成示例</NButton>
            <NButton type="primary" :loading="syncing" @click="onSync">同步争议</NButton>
            <NButton quaternary @click="router.push({ name: 'accounts' })">去账号列表</NButton>
          </template>
        </PpEmptyState>

        <PpEmptyState
          v-else-if="!loading && !filtered.length"
          icon="mdi:filter-off-outline"
          title="没有符合条件的案件"
          description="换一组筛选条件，或清空后重新查询。"
        >
          <template #actions>
            <NButton type="primary" @click="clearFilters">重置筛选</NButton>
          </template>
        </PpEmptyState>

        <template v-else-if="filtered.length">
          <div class="table-scroll">
          <table class="pp-table">
            <thead>
              <tr>
                <th>案件</th>
                <th>关联交易</th>
                <th>关联账号</th>
                <th>金额</th>
                <th>买家信息</th>
                <th>状态</th>
                <th>案件类型</th>
                <th>原因</th>
                <th>结果</th>
                <th>创建时间</th>
                <th>截止时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in paged" :key="row.id" class="clickable" @click="goDetail(row)">
                <td class="nowrap">
                  <button type="button" class="pp-table__link mono" @click.stop="goDetail(row)">
                    {{ row.id }}
                  </button>
                  <span v-if="row.sample" class="pp-badge pp-badge--mute sample">示例</span>
                </td>
                <td class="mono nowrap">{{ row.relatedTransactionId || '—' }}</td>
                <td class="mono nowrap">{{ row.payerId || '—' }}</td>
                <td class="mono nowrap">{{ amountText(row) }}</td>
                <td>{{ row.buyerEmail || '—' }}</td>
                <td class="nowrap">
                  <span class="pp-badge" :class="`pp-badge--${badgeTone(row.status)}`">
                    {{ statusLabel(row.status) }}
                  </span>
                </td>
                <td class="nowrap">{{ stageLabel(row.lifeCycleStage || row.caseType) || '—' }}</td>
                <td>{{ reasonLabel(row.reason) }}</td>
                <td class="nowrap">{{ outcomeLabel(row.outcome) || '—' }}</td>
                <td class="nowrap">{{ formatDateTime(row.createdAt) }}</td>
                <td class="nowrap" :class="`due due--${dueState(row) || 'none'}`">
                  {{ deadlineText(row) }}
                  <template v-if="dueState(row) === 'overdue'"> · 已逾期</template>
                  <template v-else-if="dueState(row) === 'soon'"> · 即将到期</template>
                </td>
                <td class="nowrap">
                  <button type="button" class="pp-table__link" @click.stop="goDetail(row)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>

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

.search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 0.84rem;
  color: var(--pp-text);
}

.table-scroll {
  overflow-x: auto;
}

.table-scroll .pp-table {
  min-width: 1320px;
}

.nowrap {
  white-space: nowrap;
}

.sample {
  margin-left: 8px;
}

.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  color: var(--pp-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

.due--overdue {
  color: #b42318;
  font-weight: 650;
}

.due--soon {
  color: #b54708;
  font-weight: 650;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

.clickable {
  cursor: pointer;
}

.clickable:hover td {
  background: #f8fafc;
}
</style>
