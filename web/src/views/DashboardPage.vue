<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, useMessage } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpPageHero from '@/components/PpPageHero.vue';
import {
  fetchAccounts,
  fetchRecentTransactionsAcrossAccounts,
  fetchStats
} from '@/api/paypal';
import type { DashboardStats, PayPalAccount } from '@/api/types';
import { accountStatusLabel } from '@/lib/account-status';
import { formatDateTime, formatMoney } from '@/lib/format';
import { startPayPalOAuth } from '@/lib/oauth';
import {
  formatAmountObj,
  txAmountNumber,
  txCounterparty,
  txEventLabel,
  txId,
  txInfo,
  txInitiatedAt,
  txStatusMeta,
  type TxRow
} from '@/lib/transaction';
import { useAuthStore } from '@/store/auth';

const router = useRouter();
const message = useMessage();
const auth = useAuthStore();
const loading = ref(true);
const stats = ref<DashboardStats | null>(null);
const accounts = ref<PayPalAccount[]>([]);
const txRows = ref<TxRow[]>([]);
const hoverDay = ref<number | null>(null);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const pendingCount = computed(() =>
  txRows.value.filter(r => txInfo(r.tx).transaction_status === 'P').length
);

const weekInflow = computed(() =>
  trend.value.reduce((s, d) => s + Math.max(0, d.amount), 0)
);

const weekCount = computed(() => trend.value.reduce((s, d) => s + d.count, 0));

const metricCards = computed(() => {
  const complaints = stats.value?.complaintCount ?? 0;
  const disputeCases = stats.value?.disputeCaseCount ?? stats.value?.disputeCount ?? 0;
  return [
    {
      key: 'income',
      label: '收款总额',
      value: formatMoney(stats.value?.totalReceived ?? null),
      sub: `近 7 日流入 ${formatMoney(weekInflow.value)}`,
      icon: 'mdi:trending-up',
      tone: 'blue',
      to: 'transactions',
      query: undefined as Record<string, string> | undefined
    },
    {
      key: 'count',
      label: '交易笔数',
      value: String(txRows.value.length || 0),
      sub: `近 7 日 ${weekCount.value} 笔`,
      icon: 'mdi:swap-horizontal',
      tone: 'navy',
      to: 'transactions',
      query: undefined as Record<string, string> | undefined
    },
    {
      key: 'complaints',
      label: '待处理投诉',
      value: String(complaints),
      sub: 'PayPal Inquiry 未结案',
      icon: 'mdi:message-alert-outline',
      tone: 'warn',
      to: 'complaints',
      query: undefined as Record<string, string> | undefined
    },
    {
      key: 'disputes',
      label: '争议案件',
      value: String(disputeCases),
      sub: `未结案 · 交易处理中 ${pendingCount.value}`,
      icon: 'mdi:shield-alert-outline',
      tone: 'teal',
      to: 'disputes',
      query: undefined as Record<string, string> | undefined
    }
  ];
});

const trend = computed(() => {
  const days: { key: string; label: string; weekday: string; count: number; amount: number }[] = [];
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const bucket = {
      key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      weekday: `周${weekdays[d.getDay()]}`,
      count: 0,
      amount: 0
    };
    for (const row of txRows.value) {
      const raw = txInfo(row.tx).transaction_initiation_date || '';
      if (!raw.startsWith(key)) continue;
      bucket.count += 1;
      bucket.amount += txAmountNumber(row.tx);
    }
    days.push(bucket);
  }
  return days;
});

const chartMax = computed(() => Math.max(...trend.value.map(d => d.count), 1));

const recentTx = computed(() => txRows.value.slice(0, 6));
const recentAccounts = computed(() => accounts.value.slice(0, 5));

function barHeight(count: number) {
  const minPct = 8;
  return Math.max(minPct, (count / chartMax.value) * 100);
}

function badgeTone(type: string) {
  if (type === 'success') return 'ok';
  if (type === 'warning') return 'warn';
  if (type === 'error') return 'bad';
  return 'mute';
}

function statusTone(status: string) {
  if (status === 'active') return 'ok';
  if (status === 'pending') return 'warn';
  if (status === 'frozen') return 'bad';
  return 'mute';
}

function amountClass(row: TxRow) {
  const n = txAmountNumber(row.tx);
  if (n > 0) return 'is-in';
  if (n < 0) return 'is-out';
  return '';
}

async function load() {
  loading.value = true;
  try {
    const [s, acc] = await Promise.all([fetchStats(), fetchAccounts()]);
    stats.value = s;
    accounts.value = acc;
    txRows.value = acc.length
      ? await fetchRecentTransactionsAcrossAccounts(acc, 80, 500)
      : [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载概览失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="pp-page home">
    <PpPageHero
      icon="mdi:view-dashboard-outline"
      :kicker="`${greeting}，${auth.displayName || '管理员'}`"
      title="收款经营概览"
      description="账号状态、交易流水与风险事项集中查看。"
    >
      <template #actions>
        <NButton @click="load">
          <template #icon><Icon icon="mdi:refresh" width="16" /></template>
          刷新
        </NButton>
        <NButton @click="router.push({ name: 'transactions' })">交易记录</NButton>
        <NButton type="primary" @click="startPayPalOAuth()">
          <template #icon><Icon icon="mdi:paypal" width="16" /></template>
          绑定账号
        </NButton>
      </template>
    </PpPageHero>

    <PpAsyncPane
      :loading="loading"
      icon="mdi:view-dashboard-outline"
      title="加载概览"
      description="正在汇总收款与交易数据…"
      min-height="420px"
    >
      <div class="metrics">
        <button
          v-for="m in metricCards"
          :key="m.key"
          type="button"
          class="metric"
          :data-tone="m.tone"
          @click="router.push({ name: m.to, query: m.query })"
        >
          <div class="metric__icon">
            <Icon :icon="m.icon" width="20" />
          </div>
          <div class="metric__body">
            <span class="metric__label">{{ m.label }}</span>
            <strong class="metric__value">{{ m.value }}</strong>
            <span class="metric__sub">{{ m.sub }}</span>
          </div>
        </button>
      </div>

      <div class="main-grid">
        <section class="panel trend-panel">
          <div class="panel__head">
            <div>
              <h2 class="panel__title">近 7 日交易</h2>
              <p class="panel__sub">按日统计笔数 · 本地已同步账单</p>
            </div>
            <div class="trend-sum">
              <div>
                <span>本周笔数</span>
                <b>{{ weekCount }}</b>
              </div>
              <div>
                <span>本周流入</span>
                <b>{{ formatMoney(weekInflow) }}</b>
              </div>
            </div>
          </div>

          <PpEmptyState
            v-if="!accounts.length"
            compact
            icon="mdi:chart-bar"
            title="还没有数据可展示"
            description="绑定 PayPal 账号并同步账单后，这里会显示每日交易柱状图。"
          >
            <template #actions>
              <NButton type="primary" @click="startPayPalOAuth()">绑定账号</NButton>
            </template>
          </PpEmptyState>

          <div v-else class="bars" @mouseleave="hoverDay = null">
            <div
              v-for="(d, i) in trend"
              :key="d.key"
              class="bars__col"
              :class="{ 'is-active': hoverDay === i, 'is-empty': d.count === 0 }"
              @mouseenter="hoverDay = i"
            >
              <div class="bars__tip" v-show="hoverDay === i">
                <strong>{{ d.count }} 笔</strong>
                <span>{{ formatMoney(d.amount) }}</span>
              </div>
              <div class="bars__track">
                <div class="bars__fill" :style="{ height: `${barHeight(d.count)}%` }" />
              </div>
              <div class="bars__meta">
                <span class="bars__date">{{ d.label }}</span>
                <span class="bars__week">{{ d.weekday }}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="panel side-panel">
          <div class="panel__head">
            <h2 class="panel__title">快捷操作</h2>
          </div>
          <div class="quick">
            <button type="button" class="quick__item" @click="startPayPalOAuth()">
              <span class="quick__icon" data-c="blue"><Icon icon="mdi:paypal" width="18" /></span>
              <span>
                <strong>绑定新账号</strong>
                <em>商家登录授权接入</em>
              </span>
            </button>
            <button type="button" class="quick__item" @click="router.push({ name: 'transactions' })">
              <span class="quick__icon" data-c="navy"><Icon icon="mdi:receipt-text-outline" width="18" /></span>
              <span>
                <strong>查看交易</strong>
                <em>跨账号筛选与查单</em>
              </span>
            </button>
            <button type="button" class="quick__item" @click="router.push({ name: 'complaints' })">
              <span class="quick__icon" data-c="warn"><Icon icon="mdi:message-alert-outline" width="18" /></span>
              <span>
                <strong>客户投诉</strong>
                <em>Inquiry 询单与回应</em>
              </span>
            </button>
            <button type="button" class="quick__item" @click="router.push({ name: 'accounts' })">
              <span class="quick__icon" data-c="teal"><Icon icon="mdi:account-cog-outline" width="18" /></span>
              <span>
                <strong>账号管理</strong>
                <em>分配负责人与同步</em>
              </span>
            </button>
          </div>
        </section>
      </div>

      <div class="main-grid main-grid--bottom">
        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">最近交易</h2>
            <button type="button" class="panel__link" @click="router.push({ name: 'transactions' })">
              全部
              <Icon icon="mdi:chevron-right" width="16" />
            </button>
          </div>

          <PpEmptyState
            v-if="!recentTx.length"
            compact
            icon="mdi:receipt-text-outline"
            title="暂无交易"
            description="同步账号账单后，最近流水会出现在这里。"
          />

          <ul v-else class="feed">
            <li v-for="row in recentTx" :key="`${row.payerId}-${txId(row.tx)}`" class="feed__row">
              <div class="feed__main">
                <strong>{{ txCounterparty(row.tx) }}</strong>
                <span>{{ txEventLabel(txInfo(row.tx).transaction_event_code) }} · {{ txInitiatedAt(row.tx) }}</span>
              </div>
              <div class="feed__side">
                <b :class="amountClass(row)">{{ formatAmountObj(txInfo(row.tx).transaction_amount) }}</b>
                <span
                  class="pp-badge"
                  :class="`pp-badge--${badgeTone(txStatusMeta(txInfo(row.tx).transaction_status).type)}`"
                >
                  {{ txStatusMeta(txInfo(row.tx).transaction_status).label }}
                </span>
              </div>
            </li>
          </ul>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title">账号一览</h2>
            <button type="button" class="panel__link" @click="router.push({ name: 'accounts' })">
              管理
              <Icon icon="mdi:chevron-right" width="16" />
            </button>
          </div>

          <PpEmptyState
            v-if="!recentAccounts.length"
            compact
            icon="mdi:account-multiple-outline"
            title="尚未绑定账号"
            description="授权后可在此查看状态与同步时间。"
          >
            <template #actions>
              <NButton type="primary" size="small" @click="startPayPalOAuth()">立即绑定</NButton>
            </template>
          </PpEmptyState>

          <ul v-else class="acct-list">
            <li
              v-for="acc in recentAccounts"
              :key="acc.payerId"
            >
              <button
                type="button"
                class="acct"
                @click="router.push({ name: 'account-detail', params: { payerId: acc.payerId } })"
              >
                <span class="acct__avatar">{{ (acc.email || acc.payerId).slice(0, 1).toUpperCase() }}</span>
                <span class="acct__body">
                  <strong>{{ acc.email || acc.payerId }}</strong>
                  <em>{{ acc.ownerName || '未分配' }} · {{ formatDateTime(acc.lastSyncedAt) }}</em>
                </span>
                <span class="pp-badge" :class="`pp-badge--${statusTone(acc.status)}`">
                  {{ accountStatusLabel(acc.status) }}
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </PpAsyncPane>
  </div>
</template>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--pp-shadow);
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.metric:hover {
  transform: translateY(-2px);
  box-shadow: var(--pp-shadow-md);
}

.metric__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  color: #fff;
  background: var(--pp-blue);
}

.metric[data-tone='navy'] .metric__icon {
  background: #003087;
}

.metric[data-tone='teal'] .metric__icon {
  background: #0d9488;
}

.metric[data-tone='warn'] .metric__icon {
  background: #d97706;
}

.metric__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.metric__label {
  font-size: 0.78rem;
  color: var(--pp-muted);
  font-weight: 500;
}

.metric__value {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--pp-text);
  word-break: break-all;
}

.metric__sub {
  font-size: 0.72rem;
  color: #93a1b4;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.9fr);
  gap: 14px;
  margin-bottom: 14px;
}

.main-grid--bottom {
  grid-template-columns: 1fr 1fr;
}

.panel {
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 0;
}

.panel__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}

.panel__sub {
  margin: 4px 0 0;
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.panel__link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.trend-sum {
  display: flex;
  gap: 18px;
}

.trend-sum > div {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.trend-sum span {
  font-size: 0.7rem;
  color: var(--pp-muted);
}

.trend-sum b {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--pp-text);
}

.bars {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
  height: 220px;
  padding: 28px 18px 16px;
}

.bars__col {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  cursor: default;
}

.bars__track {
  flex: 1;
  width: 100%;
  max-width: 42px;
  display: flex;
  align-items: flex-end;
  border-radius: 8px 8px 4px 4px;
  background: #f1f5fa;
  overflow: hidden;
}

.bars__fill {
  width: 100%;
  border-radius: 8px 8px 0 0;
  background: linear-gradient(180deg, #1e8fff 0%, #0070ba 70%, #003087 100%);
  transition: height 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease;
  min-height: 6px;
}

.bars__col.is-empty .bars__fill {
  opacity: 0.28;
  background: #94a3b8;
}

.bars__col.is-active .bars__fill {
  filter: brightness(1.08);
}

.bars__meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin-top: 8px;
}

.bars__date {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--pp-text);
}

.bars__week {
  font-size: 0.65rem;
  color: var(--pp-muted);
}

.bars__tip {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -4px);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #0b1f3a;
  color: #fff;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(11, 31, 58, 0.25);
  pointer-events: none;
}

.bars__tip strong {
  font-size: 0.75rem;
}

.bars__tip span {
  font-size: 0.65rem;
  opacity: 0.75;
}

.quick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.quick__item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: background 0.15s ease;
}

.quick__item:hover {
  background: #f5f8fc;
}

.quick__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #fff;
  flex-shrink: 0;
}

.quick__icon[data-c='blue'] {
  background: #0070ba;
}

.quick__icon[data-c='navy'] {
  background: #003087;
}

.quick__icon[data-c='warn'] {
  background: #d97706;
}

.quick__icon[data-c='teal'] {
  background: #0d9488;
}

.quick__item strong {
  display: block;
  font-size: 0.875rem;
  font-weight: 650;
}

.quick__item em {
  display: block;
  margin-top: 2px;
  font-style: normal;
  font-size: 0.72rem;
  color: var(--pp-muted);
}

.feed,
.acct-list {
  list-style: none;
  margin: 0;
  padding: 8px 10px 12px;
}

.feed__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 8px;
  border-bottom: 1px solid #eef1f6;
}

.feed__row:last-child {
  border-bottom: none;
}

.feed__main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.feed__main strong {
  font-size: 0.875rem;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed__main span {
  font-size: 0.72rem;
  color: var(--pp-muted);
}

.feed__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.feed__side b {
  font-size: 0.875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.feed__side b.is-in {
  color: #15803d;
}

.feed__side b.is-out {
  color: #b91c1c;
}

.acct {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.acct:hover {
  background: #f5f8fc;
}

.acct__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-weight: 700;
  color: #003087;
  background: #e8f1fb;
  flex-shrink: 0;
}

.acct__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.acct__body strong {
  font-size: 0.84rem;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acct__body em {
  font-style: normal;
  font-size: 0.7rem;
  color: var(--pp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1100px) {
  .main-grid,
  .main-grid--bottom {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .metrics {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .metrics {
    grid-template-columns: 1fr;
  }

  .bars {
    gap: 6px;
    height: 180px;
  }
}
</style>
