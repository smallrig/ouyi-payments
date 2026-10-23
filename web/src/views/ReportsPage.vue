<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NSelect, useMessage } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpPageHero from '@/components/PpPageHero.vue';
import {
  fetchAccounts,
  fetchDisputes,
  fetchRecentTransactionsAcrossAccounts,
  fetchStats
} from '@/api/paypal';
import type { DashboardStats, DisputeItem, PayPalAccount } from '@/api/types';
import {
  isComplaint,
  isDisputeCase,
  isOpenCase,
  needsSellerResponse,
  outcomeLabel,
  reasonLabel,
  stageLabel,
  statusLabel
} from '@/lib/dispute';
import { formatMoney, formatShortDateTime } from '@/lib/format';
import { txAmountNumber, txEventLabel, txInfo, txStatusMeta, type TxRow } from '@/lib/transaction';

type Section = 'overview' | 'transactions' | 'complaints' | 'disputes';
type Kpi = { icon: string; label: string; value: string | number; hint?: string; tone?: string };
type Rank = { label: string; count: number; extra?: string; pct: number };

const router = useRouter();
const message = useMessage();
const loading = ref(true);
const hoverDay = ref<number | null>(null);
const stats = ref<DashboardStats | null>(null);
const accounts = ref<PayPalAccount[]>([]);
const disputes = ref<DisputeItem[]>([]);
const rows = ref<TxRow[]>([]);
const payerId = ref<string | null>(null);
const rangeDays = ref(30);
const section = ref<Section>('overview');

const rangeOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 }
];

const sections: { key: Section; label: string; icon: string }[] = [
  { key: 'overview', label: '总览', icon: 'mdi:view-dashboard-outline' },
  { key: 'transactions', label: '交易统计分析', icon: 'mdi:swap-horizontal' },
  { key: 'complaints', label: '客户投诉统计分析', icon: 'mdi:message-alert-outline' },
  { key: 'disputes', label: '争议案件统计分析', icon: 'mdi:shield-alert-outline' }
];

const accountOptions = computed(() =>
  accounts.value.map(a => ({ label: a.email || a.payerId, value: a.payerId }))
);

const range = computed(() => {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - rangeDays.value + 1);
  return { from: from.toISOString(), to: to.toISOString(), fromMs: from.getTime(), toMs: to.getTime() };
});

const scopedAccounts = computed(() =>
  payerId.value ? accounts.value.filter(a => a.payerId === payerId.value) : accounts.value
);

const scopedRows = computed(() =>
  payerId.value ? rows.value.filter(r => r.payerId === payerId.value) : rows.value
);

const scopedCases = computed(() =>
  payerId.value ? disputes.value.filter(d => d.payerId === payerId.value) : disputes.value
);

const complaints = computed(() => scopedCases.value.filter(isComplaint));
const disputeCases = computed(() => scopedCases.value.filter(isDisputeCase));

function inRange(iso?: string) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= range.value.fromMs && t <= range.value.toMs + 86400000;
}

function caseAmount(row: DisputeItem) {
  const n = Number(row.amount?.value);
  return Number.isFinite(n) ? n : 0;
}

function dueKind(row: DisputeItem) {
  if (!row.deadlineAt || row.status === 'RESOLVED') return '';
  const due = new Date(row.deadlineAt).getTime();
  if (Number.isNaN(due)) return '';
  const left = due - Date.now();
  if (left < 0) return 'overdue';
  if (left <= 3 * 86400000) return 'soon';
  return 'ok';
}

function ageDays(iso?: string) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function rankOf<T>(list: T[], labelOf: (item: T) => string): Rank[] {
  const map = new Map<string, number>();
  for (const item of list) {
    const label = labelOf(item) || '未分类';
    map.set(label, (map.get(label) || 0) + 1);
  }
  const total = list.length || 1;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count, pct: pct(count, total) }));
}

const txStats = computed(() => {
  const list = scopedRows.value;
  let inflow = 0;
  let outflow = 0;
  let refund = 0;
  let success = 0;
  let pending = 0;
  let failed = 0;
  for (const row of list) {
    const n = txAmountNumber(row.tx);
    const info = txInfo(row.tx);
    const status = info.transaction_status;
    const event = info.transaction_event_code || '';
    if (n >= 0) inflow += n;
    else outflow += Math.abs(n);
    if (event.startsWith('T01') || event === 'T1201' || n < 0) refund += Math.abs(Math.min(0, n));
    if (status === 'S') success += 1;
    else if (status === 'P') pending += 1;
    else if (status === 'D' || status === 'V' || status === 'C') failed += 1;
  }
  const count = list.length;
  return {
    count,
    inflow,
    outflow,
    net: inflow - outflow,
    refund,
    success,
    pending,
    failed,
    successRate: pct(success, count),
    avgTicket: count ? inflow / Math.max(1, success || count) : 0
  };
});

const complaintPeriod = computed(() => complaints.value.filter(row => inRange(row.createdAt)));
const disputePeriod = computed(() => disputeCases.value.filter(row => inRange(row.createdAt)));

const complaintStats = computed(() => {
  const list = complaints.value;
  const period = complaintPeriod.value;
  const open = list.filter(isOpenCase);
  const wait = list.filter(needsSellerResponse);
  const soon = list.filter(row => dueKind(row) === 'soon');
  const overdue = list.filter(row => dueKind(row) === 'overdue');
  const resolved = list.filter(row => row.status === 'RESOLVED');
  const amount = list.reduce((s, row) => s + caseAmount(row), 0);
  const ages = resolved.map(row => ageDays(row.createdAt));
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
  return {
    total: list.length,
    period: period.length,
    open: open.length,
    wait: wait.length,
    soon: soon.length,
    overdue: overdue.length,
    resolved: resolved.length,
    resolveRate: pct(resolved.length, list.length),
    amount,
    avgAge
  };
});

const disputeStats = computed(() => {
  const list = disputeCases.value;
  const period = disputePeriod.value;
  const open = list.filter(isOpenCase);
  const overdue = list.filter(row => dueKind(row) === 'overdue');
  const soon = list.filter(row => dueKind(row) === 'soon');
  const resolved = list.filter(row => row.status === 'RESOLVED');
  const sellerWin = resolved.filter(row => row.outcome === 'RESOLVED_SELLER_FAVOUR').length;
  const chargeback = list.filter(row => (row.lifeCycleStage || row.caseType) === 'CHARGEBACK').length;
  const arb = list.filter(row => {
    const stage = row.lifeCycleStage || row.caseType;
    return stage === 'ARBITRATION' || stage === 'PRE_ARBITRATION';
  }).length;
  const amount = list.reduce((s, row) => s + caseAmount(row), 0);
  const openAmount = open.reduce((s, row) => s + caseAmount(row), 0);
  return {
    total: list.length,
    period: period.length,
    open: open.length,
    overdue: overdue.length,
    soon: soon.length,
    resolved: resolved.length,
    sellerWin,
    sellerWinRate: pct(sellerWin, resolved.length),
    chargeback,
    arb,
    amount,
    openAmount
  };
});

const heroMetrics = computed(() => [
  { label: '交易笔数', value: txStats.value.count },
  { label: '净流入', value: formatMoney(txStats.value.net) },
  { label: '客户投诉', value: complaintStats.value.total, hint: `${complaintStats.value.open} 待处理` },
  { label: '争议案件', value: disputeStats.value.total, hint: `${disputeStats.value.open} 待处理` }
]);

const trend = computed(() => {
  const days = rangeDays.value;
  const buckets: { key: string; label: string; count: number; amount: number; complaints: number; disputes: number }[] =
    [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.push({
      key: d.toISOString().slice(0, 10),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: 0,
      amount: 0,
      complaints: 0,
      disputes: 0
    });
  }
  const map = new Map(buckets.map(b => [b.key, b]));
  for (const row of scopedRows.value) {
    const key = (txInfo(row.tx).transaction_initiation_date || '').slice(0, 10);
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += txAmountNumber(row.tx);
  }
  for (const row of complaints.value) {
    const bucket = map.get((row.createdAt || '').slice(0, 10));
    if (bucket) bucket.complaints += 1;
  }
  for (const row of disputeCases.value) {
    const bucket = map.get((row.createdAt || '').slice(0, 10));
    if (bucket) bucket.disputes += 1;
  }
  return buckets;
});

const maxCount = computed(() => Math.max(1, ...trend.value.map(d => d.count)));
const maxCase = computed(() => Math.max(1, ...trend.value.map(d => d.complaints + d.disputes)));

function barHeight(count: number, max: number) {
  return Math.max(count ? 8 : 0, Math.round((count / max) * 100));
}

const peakDay = computed(() => {
  return [...trend.value].sort((a, b) => b.count - a.count)[0] || null;
});

const txStatusRank = computed(() =>
  rankOf(scopedRows.value, row => txStatusMeta(txInfo(row.tx).transaction_status).label)
);

const txEventRank = computed(() =>
  rankOf(scopedRows.value, row => txEventLabel(txInfo(row.tx).transaction_event_code))
);

const complaintStatusRank = computed(() => rankOf(complaints.value, row => statusLabel(row.status)));
const complaintReasonRank = computed(() => rankOf(complaints.value, row => reasonLabel(row.reason)));
const disputeStatusRank = computed(() => rankOf(disputeCases.value, row => statusLabel(row.status)));
const disputeStageRank = computed(() =>
  rankOf(disputeCases.value, row => stageLabel(row.lifeCycleStage || row.caseType))
);
const disputeReasonRank = computed(() => rankOf(disputeCases.value, row => reasonLabel(row.reason)));
const disputeOutcomeRank = computed(() =>
  rankOf(
    disputeCases.value.filter(row => row.outcome),
    row => outcomeLabel(row.outcome)
  )
);

const accountRows = computed(() =>
  scopedAccounts.value
    .map(acc => {
      const txs = rows.value.filter(r => r.payerId === acc.payerId);
      const casesForAcc = disputes.value.filter(d => d.payerId === acc.payerId);
      const comps = casesForAcc.filter(isComplaint);
      const dps = casesForAcc.filter(isDisputeCase);
      const inflow = txs.reduce((sum, row) => sum + Math.max(0, txAmountNumber(row.tx)), 0);
      return {
        payerId: acc.payerId,
        email: acc.email || acc.payerId,
        txCount: txs.length,
        inflow,
        avg: txs.length ? inflow / txs.length : 0,
        complaints: comps.length,
        complaintOpen: comps.filter(isOpenCase).length,
        disputes: dps.length,
        disputeOpen: dps.filter(isOpenCase).length,
        risk: dps.reduce((s, row) => s + caseAmount(row), 0)
      };
    })
    .sort((a, b) => b.inflow - a.inflow)
);

const overviewKpis = computed<Kpi[]>(() => [
  { icon: 'mdi:swap-horizontal', label: '交易笔数', value: txStats.value.count, hint: `成功率 ${txStats.value.successRate}%`, tone: 'blue' },
  { icon: 'mdi:trending-up', label: '净流入', value: formatMoney(txStats.value.net), hint: `流入 ${formatMoney(txStats.value.inflow)}`, tone: 'green' },
  { icon: 'mdi:message-alert-outline', label: '待处理投诉', value: complaintStats.value.open, hint: `本期新增 ${complaintStats.value.period}`, tone: 'warn' },
  { icon: 'mdi:shield-alert-outline', label: '待处理争议', value: disputeStats.value.open, hint: `风险金额 ${formatMoney(disputeStats.value.openAmount)}`, tone: 'bad' },
  { icon: 'mdi:cash-check', label: '客单价', value: formatMoney(txStats.value.avgTicket), hint: '按流入 / 成功笔数', tone: 'navy' },
  { icon: 'mdi:clock-alert-outline', label: '需卖家回应', value: complaintStats.value.wait + disputeStats.value.overdue, hint: `投诉 ${complaintStats.value.wait} · 逾期争议 ${disputeStats.value.overdue}`, tone: 'orange' }
]);

const txKpis = computed<Kpi[]>(() => [
  { icon: 'mdi:counter', label: '交易笔数', value: txStats.value.count, hint: `日均 ${(txStats.value.count / rangeDays.value).toFixed(1)} 笔`, tone: 'blue' },
  { icon: 'mdi:arrow-down-bold-circle-outline', label: '流入金额', value: formatMoney(txStats.value.inflow), tone: 'green' },
  { icon: 'mdi:arrow-up-bold-circle-outline', label: '流出金额', value: formatMoney(txStats.value.outflow), tone: 'orange' },
  { icon: 'mdi:sigma', label: '净额', value: formatMoney(txStats.value.net), tone: 'navy' },
  { icon: 'mdi:check-decagram-outline', label: '成功', value: txStats.value.success, hint: `${txStats.value.successRate}%`, tone: 'green' },
  { icon: 'mdi:progress-clock', label: '处理中', value: txStats.value.pending, tone: 'warn' },
  { icon: 'mdi:close-octagon-outline', label: '失败 / 撤销', value: txStats.value.failed, tone: 'bad' },
  { icon: 'mdi:cash-refund', label: '退款相关', value: formatMoney(txStats.value.refund), tone: 'mute' }
]);

const complaintKpis = computed<Kpi[]>(() => [
  { icon: 'mdi:message-alert-outline', label: '全部投诉', value: complaintStats.value.total, hint: `本期新增 ${complaintStats.value.period}`, tone: 'blue' },
  { icon: 'mdi:folder-open-outline', label: '待处理', value: complaintStats.value.open, tone: 'warn' },
  { icon: 'mdi:reply-outline', label: '需卖家回应', value: complaintStats.value.wait, tone: 'orange' },
  { icon: 'mdi:clock-outline', label: '即将到期', value: complaintStats.value.soon, tone: 'warn' },
  { icon: 'mdi:alarm-light-outline', label: '已逾期', value: complaintStats.value.overdue, tone: 'bad' },
  { icon: 'mdi:check-circle-outline', label: '已解决', value: complaintStats.value.resolved, hint: `结案率 ${complaintStats.value.resolveRate}%`, tone: 'green' },
  { icon: 'mdi:calendar-clock', label: '平均处理天数', value: complaintStats.value.avgAge || '—', hint: '已结案样本', tone: 'navy' },
  { icon: 'mdi:cash', label: '涉及金额', value: formatMoney(complaintStats.value.amount), tone: 'mute' }
]);

const disputeKpis = computed<Kpi[]>(() => [
  { icon: 'mdi:shield-alert-outline', label: '全部争议', value: disputeStats.value.total, hint: `本期新增 ${disputeStats.value.period}`, tone: 'blue' },
  { icon: 'mdi:folder-open-outline', label: '待处理', value: disputeStats.value.open, tone: 'warn' },
  { icon: 'mdi:gavel', label: '拒付索赔', value: disputeStats.value.chargeback, tone: 'orange' },
  { icon: 'mdi:scale-balance', label: '仲裁阶段', value: disputeStats.value.arb, tone: 'navy' },
  { icon: 'mdi:alarm-light-outline', label: '已逾期', value: disputeStats.value.overdue, hint: `即将到期 ${disputeStats.value.soon}`, tone: 'bad' },
  { icon: 'mdi:check-circle-outline', label: '已解决', value: disputeStats.value.resolved, tone: 'green' },
  { icon: 'mdi:trophy-outline', label: '卖家胜诉率', value: `${disputeStats.value.sellerWinRate}%`, hint: `${disputeStats.value.sellerWin} 件胜诉`, tone: 'green' },
  { icon: 'mdi:cash-remove', label: '未结风险金额', value: formatMoney(disputeStats.value.openAmount), tone: 'bad' }
]);

async function load() {
  loading.value = true;
  try {
    const [nextAccounts, nextDisputes, nextStats] = await Promise.all([
      fetchAccounts(),
      fetchDisputes().catch(() => [] as DisputeItem[]),
      fetchStats().catch(() => null)
    ]);
    accounts.value = nextAccounts;
    disputes.value = nextDisputes;
    stats.value = nextStats;
    const list = payerId.value
      ? nextAccounts.filter(a => a.payerId === payerId.value)
      : nextAccounts;
    rows.value = await fetchRecentTransactionsAcrossAccounts(list, 200, 800, range.value);
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载报表失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch([rangeDays, payerId], () => void load());
</script>

<template>
  <div class="pp-page">
    <PpPageHero
      icon="mdi:chart-box-outline"
      kicker="经营分析"
      title="数据报表"
      description="交易、客户投诉与争议案件的构成、趋势和账号对比。"
      :metrics="heroMetrics"
    >
      <template #actions>
        <NButton :loading="loading" @click="load">
          <template #icon><Icon icon="mdi:refresh" width="16" /></template>
          刷新
        </NButton>
        <NButton type="primary" @click="router.push({ name: 'transactions' })">交易记录</NButton>
      </template>
    </PpPageHero>

    <div class="pp-switch" role="tablist" aria-label="分析模块">
      <button
        v-for="item in sections"
        :key="item.key"
        type="button"
        class="pp-switch__item"
        :class="{ 'is-active': section === item.key }"
        @click="section = item.key"
      >
        <Icon :icon="item.icon" width="16" />
        {{ item.label }}
      </button>
    </div>

    <div class="pp-filter">
      <div class="pp-filter__field">
        <NSelect v-model:value="rangeDays" :options="rangeOptions" />
      </div>
      <div class="pp-filter__field pp-filter__field--account">
        <NSelect v-model:value="payerId" :options="accountOptions" placeholder="全部账号" clearable />
      </div>
      <div class="pp-filter__actions">
        <NButton
          quaternary
          @click="
            payerId = null;
            rangeDays = 30;
            section = 'overview';
          "
        >
          重置
        </NButton>
      </div>
    </div>

    <PpAsyncPane
      :loading="loading"
      icon="mdi:chart-box-outline"
      title="加载报表"
      description="正在汇总交易、投诉与争议…"
    >
      <section v-if="section === 'overview'" class="block">
        <div class="kpi-grid">
          <article v-for="item in overviewKpis" :key="item.label" class="kpi" :data-tone="item.tone">
            <div class="kpi__ico" aria-hidden="true">
              <Icon :icon="item.icon" width="18" height="18" />
            </div>
            <div class="kpi__body">
              <span class="kpi__label">{{ item.label }}</span>
              <strong class="kpi__value">{{ item.value }}</strong>
              <em v-if="item.hint" class="kpi__hint">{{ item.hint }}</em>
            </div>
          </article>
        </div>

        <div class="grid grid--wide">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark"><Icon icon="mdi:chart-bar" width="18" /></span>
                <div>
                  <h2>交易趋势</h2>
                  <p>按日笔数 · 高峰 {{ peakDay?.label || '—' }} · {{ peakDay?.count || 0 }} 笔</p>
                </div>
              </div>
            </header>
            <div class="bars" @mouseleave="hoverDay = null">
              <div
                v-for="(d, i) in trend"
                :key="d.key"
                class="bars__col"
                :class="{ 'is-active': hoverDay === i, 'is-empty': d.count === 0 }"
                @mouseenter="hoverDay = i"
              >
                <div v-show="hoverDay === i" class="bars__tip">
                  <strong>{{ d.count }} 笔</strong>
                  <span>{{ formatMoney(d.amount) }}</span>
                </div>
                <div class="bars__track">
                  <div class="bars__fill" :style="{ height: `${barHeight(d.count, maxCount)}%` }" />
                </div>
                <span class="bars__label">{{ d.label }}</span>
              </div>
            </div>
          </article>

          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-warn"><Icon icon="mdi:lightbulb-on-outline" width="18" /></span>
                <div>
                  <h2>分析要点</h2>
                  <p>当前筛选范围内的关键信号</p>
                </div>
              </div>
            </header>
            <ul class="insight">
              <li>
                <Icon icon="mdi:check-decagram-outline" width="16" />
                交易成功率 {{ txStats.successRate }}%，处理中 {{ txStats.pending }} 笔
              </li>
              <li>
                <Icon icon="mdi:cash-plus" width="16" />
                流入 {{ formatMoney(txStats.inflow) }} · 流出 {{ formatMoney(txStats.outflow) }}
              </li>
              <li>
                <Icon icon="mdi:message-alert-outline" width="16" />
                投诉待处理 {{ complaintStats.open }}，需卖家回应 {{ complaintStats.wait }}
              </li>
              <li>
                <Icon icon="mdi:shield-alert-outline" width="16" />
                争议未结风险 {{ formatMoney(disputeStats.openAmount) }}，逾期 {{ disputeStats.overdue }} 件
              </li>
              <li v-if="stats?.lastDisputeSyncAt">
                <Icon icon="mdi:cloud-sync-outline" width="16" />
                最近案件同步 {{ formatShortDateTime(stats.lastDisputeSyncAt) }}
              </li>
            </ul>
            <div class="jump">
              <button type="button" class="jump__btn" @click="section = 'transactions'">交易分析</button>
              <button type="button" class="jump__btn" @click="section = 'complaints'">投诉分析</button>
              <button type="button" class="jump__btn" @click="section = 'disputes'">争议分析</button>
            </div>
          </article>
        </div>

        <article class="panel">
          <header class="panel__head">
            <div class="panel__title">
              <span class="panel__mark"><Icon icon="mdi:account-group-outline" width="18" /></span>
              <div>
                <h2>账号对比</h2>
                <p>流入、客单价与风险暴露</p>
              </div>
            </div>
          </header>
          <PpEmptyState v-if="!accountRows.length" compact icon="mdi:account-group-outline" title="暂无账号" />
          <div v-else class="pp-table-wrap table-embed">
            <table class="pp-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>交易</th>
                  <th>流入</th>
                  <th>客单价</th>
                  <th>投诉 / 待处理</th>
                  <th>争议 / 待处理</th>
                  <th>争议金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in accountRows" :key="row.payerId">
                  <td>
                    <button
                      type="button"
                      class="pp-table__link"
                      @click="router.push({ name: 'account-detail', params: { payerId: row.payerId } })"
                    >
                      {{ row.email }}
                    </button>
                  </td>
                  <td>{{ row.txCount }}</td>
                  <td class="mono">{{ formatMoney(row.inflow) }}</td>
                  <td class="mono">{{ formatMoney(row.avg) }}</td>
                  <td>{{ row.complaints }} / {{ row.complaintOpen }}</td>
                  <td>{{ row.disputes }} / {{ row.disputeOpen }}</td>
                  <td class="mono">{{ formatMoney(row.risk) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section v-else-if="section === 'transactions'" class="block">
        <div class="sec-head">
          <span class="sec-head__ico"><Icon icon="mdi:swap-horizontal" width="20" /></span>
          <div>
            <h2>交易统计分析</h2>
            <p>金额、成功率、类型构成与账号贡献</p>
          </div>
        </div>
        <div class="kpi-grid kpi-grid--8">
          <article v-for="item in txKpis" :key="item.label" class="kpi" :data-tone="item.tone">
            <div class="kpi__ico" aria-hidden="true">
              <Icon :icon="item.icon" width="18" height="18" />
            </div>
            <div class="kpi__body">
              <span class="kpi__label">{{ item.label }}</span>
              <strong class="kpi__value">{{ item.value }}</strong>
              <em v-if="item.hint" class="kpi__hint">{{ item.hint }}</em>
            </div>
          </article>
        </div>
        <div class="grid grid--wide">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark"><Icon icon="mdi:chart-timeline-variant" width="18" /></span>
                <div>
                  <h2>每日交易量</h2>
                  <p>高峰 {{ peakDay?.label || '—' }} · {{ formatMoney(peakDay?.amount || 0) }}</p>
                </div>
              </div>
            </header>
            <div class="bars" @mouseleave="hoverDay = null">
              <div
                v-for="(d, i) in trend"
                :key="d.key"
                class="bars__col"
                :class="{ 'is-active': hoverDay === i, 'is-empty': d.count === 0 }"
                @mouseenter="hoverDay = i"
              >
                <div v-show="hoverDay === i" class="bars__tip">
                  <strong>{{ d.count }} 笔</strong>
                  <span>{{ formatMoney(d.amount) }}</span>
                </div>
                <div class="bars__track">
                  <div class="bars__fill" :style="{ height: `${barHeight(d.count, maxCount)}%` }" />
                </div>
                <span class="bars__label">{{ d.label }}</span>
              </div>
            </div>
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark"><Icon icon="mdi:list-status" width="18" /></span>
                <div>
                  <h2>交易状态构成</h2>
                  <p>成功 / 处理中 / 失败</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in txStatusRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
            <PpEmptyState v-if="!txStatusRank.length" compact icon="mdi:chart-donut" title="暂无状态数据" />
          </article>
        </div>
        <div class="grid">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-navy"><Icon icon="mdi:shape-outline" width="18" /></span>
                <div>
                  <h2>交易类型 TOP</h2>
                  <p>按 PayPal event code 归类</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in txEventRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-green"><Icon icon="mdi:account-cash-outline" width="18" /></span>
                <div>
                  <h2>账号贡献</h2>
                  <p>按流入排序</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="row in accountRows.slice(0, 6)" :key="row.payerId">
                <div class="dist__meta">
                  <span>{{ row.email }}</span>
                  <b>{{ row.txCount }} 笔 · {{ formatMoney(row.inflow) }}</b>
                </div>
                <div class="dist__track">
                  <i :style="{ width: `${pct(row.inflow, txStats.inflow || 1)}%` }" />
                </div>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section v-else-if="section === 'complaints'" class="block">
        <div class="sec-head">
          <span class="sec-head__ico is-warn"><Icon icon="mdi:message-alert-outline" width="20" /></span>
          <div>
            <h2>客户投诉统计分析</h2>
            <p>Inquiry 阶段的存量、时效与原因构成</p>
          </div>
          <NButton size="small" @click="router.push({ name: 'complaints' })">查看列表</NButton>
        </div>
        <div class="kpi-grid kpi-grid--8">
          <article v-for="item in complaintKpis" :key="item.label" class="kpi" :data-tone="item.tone">
            <div class="kpi__ico" aria-hidden="true">
              <Icon :icon="item.icon" width="18" height="18" />
            </div>
            <div class="kpi__body">
              <span class="kpi__label">{{ item.label }}</span>
              <strong class="kpi__value">{{ item.value }}</strong>
              <em v-if="item.hint" class="kpi__hint">{{ item.hint }}</em>
            </div>
          </article>
        </div>
        <div class="grid">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-warn"><Icon icon="mdi:chart-box-outline" width="18" /></span>
                <div>
                  <h2>投诉状态</h2>
                  <p>待处理与已结案分布</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in complaintStatusRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track is-warn"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-orange"><Icon icon="mdi:comment-question-outline" width="18" /></span>
                <div>
                  <h2>投诉原因</h2>
                  <p>未收到货 / 货不对板等</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in complaintReasonRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track is-warn"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
        </div>
        <article class="panel">
          <header class="panel__head">
            <div class="panel__title">
              <span class="panel__mark"><Icon icon="mdi:chart-line" width="18" /></span>
              <div>
                <h2>本期新增投诉</h2>
                <p>按创建日统计</p>
              </div>
            </div>
          </header>
          <div class="bars bars--short">
            <div
              v-for="d in trend"
              :key="`c-${d.key}`"
              class="bars__col"
              :class="{ 'is-empty': d.complaints === 0 }"
            >
              <div class="bars__track">
                <div class="bars__fill is-warn" :style="{ height: `${barHeight(d.complaints, maxCase)}%` }" />
              </div>
              <span class="bars__label">{{ d.label }}</span>
            </div>
          </div>
        </article>
      </section>

      <section v-else class="block">
        <div class="sec-head">
          <span class="sec-head__ico is-bad"><Icon icon="mdi:shield-alert-outline" width="20" /></span>
          <div>
            <h2>争议案件统计分析</h2>
            <p>拒付、仲裁阶段、胜诉率与未结风险金额</p>
          </div>
          <NButton size="small" @click="router.push({ name: 'disputes' })">查看列表</NButton>
        </div>
        <div class="kpi-grid kpi-grid--8">
          <article v-for="item in disputeKpis" :key="item.label" class="kpi" :data-tone="item.tone">
            <div class="kpi__ico" aria-hidden="true">
              <Icon :icon="item.icon" width="18" height="18" />
            </div>
            <div class="kpi__body">
              <span class="kpi__label">{{ item.label }}</span>
              <strong class="kpi__value">{{ item.value }}</strong>
              <em v-if="item.hint" class="kpi__hint">{{ item.hint }}</em>
            </div>
          </article>
        </div>
        <div class="grid grid--3">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-bad"><Icon icon="mdi:layers-outline" width="18" /></span>
                <div>
                  <h2>阶段构成</h2>
                  <p>拒付 / 仲裁前 / 仲裁</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in disputeStageRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track is-bad"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-warn"><Icon icon="mdi:list-status" width="18" /></span>
                <div>
                  <h2>案件状态</h2>
                  <p>审核中、待补充、已解决</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in disputeStatusRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track is-bad"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-orange"><Icon icon="mdi:comment-alert-outline" width="18" /></span>
                <div>
                  <h2>争议原因</h2>
                  <p>高频原因排名</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in disputeReasonRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track is-bad"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
          </article>
        </div>
        <div class="grid">
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark is-green"><Icon icon="mdi:trophy-outline" width="18" /></span>
                <div>
                  <h2>结案结果</h2>
                  <p>卖家胜诉 {{ disputeStats.sellerWinRate }}%</p>
                </div>
              </div>
            </header>
            <ul class="dist">
              <li v-for="item in disputeOutcomeRank" :key="item.label">
                <div class="dist__meta">
                  <span>{{ item.label }}</span>
                  <b>{{ item.count }} · {{ item.pct }}%</b>
                </div>
                <div class="dist__track"><i :style="{ width: `${item.pct}%` }" /></div>
              </li>
            </ul>
            <PpEmptyState v-if="!disputeOutcomeRank.length" compact icon="mdi:trophy-outline" title="还没有结案结果" />
          </article>
          <article class="panel">
            <header class="panel__head">
              <div class="panel__title">
                <span class="panel__mark"><Icon icon="mdi:chart-line" width="18" /></span>
                <div>
                  <h2>本期新增争议</h2>
                  <p>按创建日统计</p>
                </div>
              </div>
            </header>
            <div class="bars bars--short">
              <div v-for="d in trend" :key="`d-${d.key}`" class="bars__col" :class="{ 'is-empty': d.disputes === 0 }">
                <div class="bars__track">
                  <div class="bars__fill is-bad" :style="{ height: `${barHeight(d.disputes, maxCase)}%` }" />
                </div>
                <span class="bars__label">{{ d.label }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </PpAsyncPane>
  </div>
</template>

<style scoped>
.pp-switch {
  margin-bottom: 12px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sec-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sec-head h2 {
  margin: 0;
  font-size: 1.05rem;
}

.sec-head p {
  margin: 2px 0 0;
  color: var(--pp-muted);
  font-size: 0.75rem;
}

.sec-head__ico,
.panel__mark,
.kpi__ico {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 0;
  color: #003087;
  background: #e7f0fb;
}

.sec-head__ico :deep(svg),
.panel__mark :deep(svg),
.kpi__ico :deep(svg) {
  display: block;
}

.sec-head__ico {
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.sec-head__ico.is-warn,
.panel__mark.is-warn,
.kpi[data-tone='warn'] .kpi__ico {
  color: #b45309;
  background: #fff4e5;
}

.sec-head__ico.is-bad,
.panel__mark.is-bad,
.kpi[data-tone='bad'] .kpi__ico {
  color: #b42318;
  background: #fdecec;
}

.panel__mark.is-green,
.kpi[data-tone='green'] .kpi__ico {
  color: #15803d;
  background: #e8f7ee;
}

.panel__mark.is-navy,
.kpi[data-tone='navy'] .kpi__ico {
  color: #003087;
  background: #e8eef8;
}

.panel__mark.is-orange,
.kpi[data-tone='orange'] .kpi__ico {
  color: #c2410c;
  background: #fff1e8;
}

.kpi[data-tone='mute'] .kpi__ico {
  color: #475569;
  background: #eef2f6;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi-grid--8 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.kpi {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 84px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
}

.kpi__ico {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.kpi__ico :deep(svg) {
  width: 18px;
  height: 18px;
}

.kpi__body {
  min-width: 0;
}

.kpi__label,
.kpi__hint {
  display: block;
  color: var(--pp-muted);
  font-size: 0.72rem;
  font-style: normal;
  line-height: 1.3;
}

.kpi__value {
  display: block;
  margin: 3px 0 2px;
  font-size: 1.2rem;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.grid--wide {
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.85fr);
}

.grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel {
  padding: 16px 18px 18px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
}

.panel__head {
  margin-bottom: 14px;
}

.panel__title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.panel__mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
}

.panel__title h2 {
  margin: 0;
  font-size: 0.92rem;
}

.panel__title p {
  margin: 3px 0 0;
  color: var(--pp-muted);
  font-size: 0.72rem;
}

.insight {
  margin: 0;
  padding: 0;
  list-style: none;
}

.insight li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #eef2f6;
  color: var(--pp-text);
  font-size: 0.82rem;
  line-height: 1.45;
}

.insight .iconify {
  margin-top: 2px;
  color: var(--pp-blue);
}

.jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.jump__btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d5deea;
  border-radius: 7px;
  background: #fff;
  color: #2a3d55;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  min-height: 180px;
  overflow-x: auto;
  padding-top: 28px;
}

.bars--short {
  min-height: 140px;
}

.bars__col {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1 0 16px;
  min-width: 16px;
  height: 150px;
}

.bars__track {
  flex: 1;
  display: flex;
  align-items: flex-end;
  width: 100%;
  max-width: 16px;
  border-radius: 6px 6px 2px 2px;
  background: #eef3f8;
}

.bars__fill {
  width: 100%;
  border-radius: inherit;
  background: linear-gradient(180deg, #1a8adf, #003087);
}

.bars__fill.is-warn {
  background: linear-gradient(180deg, #f59e0b, #b45309);
}

.bars__fill.is-bad {
  background: linear-gradient(180deg, #f87171, #b42318);
}

.bars__col.is-empty .bars__fill {
  background: #d5deea;
}

.bars__label {
  margin-top: 6px;
  color: var(--pp-muted);
  font-size: 0.6rem;
  white-space: nowrap;
}

.bars__tip {
  position: absolute;
  top: -6px;
  z-index: 1;
  padding: 4px 8px;
  border-radius: 6px;
  background: #0b1f3a;
  color: #fff;
  font-size: 0.7rem;
  white-space: nowrap;
}

.dist {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dist li + li {
  margin-top: 11px;
}

.dist__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.8rem;
}

.dist__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #eef3f8;
}

.dist__track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pp-blue);
}

.dist__track.is-warn i {
  background: #d97706;
}

.dist__track.is-bad i {
  background: #dc2626;
}

.table-embed {
  margin: 0;
  box-shadow: none;
}

.mono {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .kpi-grid,
  .kpi-grid--8,
  .grid,
  .grid--wide,
  .grid--3 {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .kpi-grid,
  .kpi-grid--8,
  .grid,
  .grid--wide,
  .grid--3 {
    grid-template-columns: 1fr;
  }
}
</style>
