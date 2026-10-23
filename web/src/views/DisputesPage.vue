<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NPagination, NSelect, useMessage } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpPageHero from '@/components/PpPageHero.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import { fetchDisputes, fetchStats, seedSampleDisputes, syncDisputes } from '@/api/paypal';
import type { DashboardStats, DisputeItem } from '@/api/types';
import {
  type CaseListTab,
  disputeReasonOptions,
  disputeStatusOptions,
  filterByCaseTab,
  isComplaint,
  isDisputeCase,
  isOpenCase,
  reasonLabel,
  stageLabel,
  statusLabel
} from '@/lib/dispute';
import { formatDateTime, formatShortDateTime } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const loading = ref(true);
const syncing = ref(false);
const seeding = ref(false);
const disputes = ref<DisputeItem[]>([]);
const stats = ref<DashboardStats | null>(null);
const keyword = ref('');
const statusFilter = ref<string | null>(null);
const reasonFilter = ref<string | null>(null);
const accountFilter = ref<string | null>(null);
const dueFilter = ref<string | null>(null);

function tabFromRoute(): CaseListTab {
  if (route.name === 'complaints' || route.query.tab === 'complaints') return 'complaints';
  return 'disputes';
}

const activeTab = computed<CaseListTab>(() => tabFromRoute());

const listStats = computed(() => {
  const complaints = disputes.value.filter(isComplaint);
  const cases = disputes.value.filter(isDisputeCase);
  const rows = activeTab.value === 'complaints' ? complaints : cases;
  return {
    total: rows.length,
    open: rows.filter(isOpenCase).length,
    soon: rows.filter(row => dueState(row) === 'soon').length,
    overdue: rows.filter(row => dueState(row) === 'overdue').length
  };
});

const accountOptions = computed(() => {
  const ids = [...new Set(disputes.value.map(row => row.payerId).filter(Boolean))];
  return ids.map(id => ({ label: id, value: id }));
});

const dueOptions = [
  { label: '即将到期', value: 'soon' },
  { label: '已逾期', value: 'overdue' },
  { label: '未逾期', value: 'open' }
];

const tabRows = computed(() => filterByCaseTab(disputes.value, activeTab.value));

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return tabRows.value.filter(row => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
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

const heroMetrics = computed(() => [
  { label: activeTab.value === 'complaints' ? '全部投诉' : '全部案件', value: listStats.value.total },
  { label: '待处理', value: listStats.value.open },
  {
    label: listStats.value.overdue ? '已逾期' : '即将到期',
    value: listStats.value.overdue || listStats.value.soon
  },
  {
    label: '最近同步',
    value: stats.value?.lastDisputeSyncAt
      ? formatShortDateTime(stats.value.lastDisputeSyncAt)
      : '尚未同步'
  }
]);

const pageCopy = computed(() =>
  activeTab.value === 'complaints'
    ? {
        title: '客户投诉',
        desc: '买家询单阶段（PayPal Inquiry）。可留言、补证；升级后进入争议案件。',
        emptyTitle: '暂无客户投诉',
        emptyDesc: '同步后可在此查看买家询单。仍处 Inquiry 阶段的案件会出现在这里。',
        loadingTitle: '加载投诉',
        loadingDesc: '正在获取客户投诉…'
      }
    : {
        title: '争议案件',
        desc: '已升级的拒付 / 仲裁案件（Chargeback 及之后阶段）。',
        emptyTitle: '暂无争议案件',
        emptyDesc: '同步后可在此查看正式争议。Inquiry 阶段请到「客户投诉」。',
        loadingTitle: '加载争议',
        loadingDesc: '正在获取争议案件…'
      }
);

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
  void router.push({
    name: 'dispute-detail',
    params: { id: row.id },
    query: { from: activeTab.value }
  });
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

function goOtherList() {
  void router.push({ name: activeTab.value === 'complaints' ? 'disputes' : 'complaints' });
}

async function load() {
  loading.value = true;
  try {
    const [rows, nextStats] = await Promise.all([fetchDisputes(), fetchStats().catch(() => null)]);
    disputes.value = rows;
    stats.value = nextStats;
    resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function onSeed() {
  seeding.value = true;
  try {
    const res = await seedSampleDisputes();
    message.success(res.message || '已生成示例案件');
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
  reasonFilter.value = null;
  accountFilter.value = null;
  dueFilter.value = null;
  resetPage();
}

watch([keyword, statusFilter, reasonFilter, accountFilter, dueFilter], () => resetPage());
watch(() => route.name, () => resetPage());

onMounted(() => {
  if (route.name === 'disputes' && route.query.tab === 'complaints') {
    void router.replace({ name: 'complaints' });
  }
  void load();
});
</script>

<template>
  <div class="pp-page">
    <PpPageHero
      :icon="activeTab === 'complaints' ? 'mdi:message-alert-outline' : 'mdi:shield-alert-outline'"
      :kicker="activeTab === 'complaints' ? '买家询单' : '拒付仲裁'"
      :title="pageCopy.title"
      :description="pageCopy.desc"
      :metrics="heroMetrics"
    >
      <template #actions>
        <NButton :loading="seeding" @click="onSeed">
          <template #icon><Icon icon="mdi:playlist-plus" width="16" /></template>
          生成示例
        </NButton>
        <NButton type="primary" :loading="syncing" @click="onSync">
          <template #icon><Icon icon="mdi:cloud-sync-outline" width="16" /></template>
          同步 PayPal
        </NButton>
      </template>
    </PpPageHero>

    <div class="pp-filter">
        <div class="pp-filter__search">
          <Icon icon="mdi:magnify" width="16" class="search__icon" />
          <input
            v-model="keyword"
            class="search-input"
            type="search"
            placeholder="搜索案件号、交易号或邮箱"
            autocomplete="off"
          />
        </div>
        <div class="pp-filter__field">
          <NSelect v-model:value="statusFilter" :options="disputeStatusOptions" placeholder="案件状态" clearable />
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
        <div class="pp-filter__actions">
          <NButton type="primary" @click="resetPage">查询</NButton>
          <NButton quaternary @click="clearFilters">重置</NButton>
        </div>
      </div>

    <PpAsyncPane
      :loading="loading"
      :icon="activeTab === 'complaints' ? 'mdi:message-alert-outline' : 'mdi:shield-alert-outline'"
      :title="pageCopy.loadingTitle"
      :description="pageCopy.loadingDesc"
    >
      <div class="pp-table-wrap">
        <PpEmptyState
          v-if="!disputes.length"
          icon="mdi:shield-alert-outline"
          title="暂无投诉或争议"
          description="先同步 PayPal，或用示例数据预览列表与详情。"
        >
          <template #actions>
            <NButton :loading="seeding" @click="onSeed">生成示例</NButton>
            <NButton type="primary" :loading="syncing" @click="onSync">同步 PayPal</NButton>
            <NButton quaternary @click="router.push({ name: 'accounts' })">去账号列表</NButton>
          </template>
        </PpEmptyState>

        <PpEmptyState
          v-else-if="!tabRows.length"
          :icon="activeTab === 'complaints' ? 'mdi:message-alert-outline' : 'mdi:shield-alert-outline'"
          :title="pageCopy.emptyTitle"
          :description="pageCopy.emptyDesc"
        >
          <template #actions>
            <NButton
              v-if="activeTab === 'complaints' && disputes.some(isDisputeCase)"
              type="primary"
              @click="goOtherList"
            >
              查看争议案件
            </NButton>
            <NButton
              v-else-if="activeTab === 'disputes' && disputes.some(isComplaint)"
              type="primary"
              @click="goOtherList"
            >
              查看客户投诉
            </NButton>
            <NButton type="primary" :loading="syncing" @click="onSync">同步 PayPal</NButton>
          </template>
        </PpEmptyState>

        <PpEmptyState
          v-else-if="!filtered.length"
          icon="mdi:filter-off-outline"
          title="没有符合条件的记录"
          description="换一组筛选条件，或清空后重新查询。"
        >
          <template #actions>
            <NButton type="primary" @click="clearFilters">重置筛选</NButton>
          </template>
        </PpEmptyState>

        <template v-else>
          <div class="tab-hint">
            <Icon :icon="activeTab === 'complaints' ? 'mdi:information-outline' : 'mdi:gavel'" width="16" />
            <span>{{ pageCopy.desc }}</span>
          </div>
          <div class="table-scroll">
            <table class="pp-table">
              <thead>
                <tr>
                  <th>案件号</th>
                  <th>关联交易</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>阶段</th>
                  <th>原因</th>
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
                  <td class="mono nowrap">{{ amountText(row) }}</td>
                  <td class="nowrap">
                    <span class="pp-badge" :class="`pp-badge--${badgeTone(row.status)}`">
                      {{ statusLabel(row.status) }}
                    </span>
                  </td>
                  <td class="nowrap">{{ stageLabel(row.lifeCycleStage || row.caseType) || '—' }}</td>
                  <td>{{ reasonLabel(row.reason) }}</td>
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
            <div class="pp-pager__meta">
              {{ pageCopy.title }}共 {{ filtered.length }} 条 · 第 {{ page }} / {{ pageCount }} 页
            </div>
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
    </PpAsyncPane>
  </div>
</template>

<style scoped>
.tab-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f8fc;
  color: var(--pp-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.tab-hint .iconify {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--pp-blue);
}

.table-scroll {
  overflow-x: auto;
}

.table-scroll .pp-table {
  min-width: 960px;
}

.nowrap {
  white-space: nowrap;
}

.sample {
  margin-left: 8px;
}

.due--overdue {
  color: #b42318;
  font-weight: 650;
}

.due--soon {
  color: #b54708;
  font-weight: 650;
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
