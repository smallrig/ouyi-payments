<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { NButton, NDataTable, NTabs, NTabPane, useMessage, type DataTableColumns } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpPageHero from '@/components/PpPageHero.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import { fetchApiLogs, fetchWebhooks } from '@/api/paypal';
import type { ApiLogItem, WebhookItem } from '@/api/types';
import { formatDateTime } from '@/lib/format';

const message = useMessage();
const loadingWebhooks = ref(true);
const loadingLogs = ref(true);
const webhooks = ref<WebhookItem[]>([]);
const logs = ref<ApiLogItem[]>([]);

const webhookPager = useClientPagination(webhooks, 10);
const logPager = useClientPagination(logs, 10);
const webhookPagination = computed(() => webhookPager.tablePagination());
const logPagination = computed(() => logPager.tablePagination());

const webhookColumns: DataTableColumns<WebhookItem> = [
  { title: 'ID', key: 'id', width: 100 },
  { title: '接收时间', key: 'receivedAt', render: r => formatDateTime(r.receivedAt) },
  {
    title: 'Transmission ID',
    key: 'transmission',
    render: r => r.headers?.['paypal-transmission-id'] || '—'
  },
  {
    title: '事件摘要',
    key: 'event',
    ellipsis: { tooltip: true },
    render: row => {
      const ev = row.event as { event_type?: string; id?: string } | undefined;
      return ev?.event_type || JSON.stringify(row.event).slice(0, 80);
    }
  }
];

const logColumns: DataTableColumns<ApiLogItem> = [
  { title: '方法', key: 'method', width: 72 },
  { title: '路径', key: 'path', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 72 },
  { title: '用户', key: 'userId', width: 100, render: r => r.userId || '—' },
  { title: 'Payer', key: 'payerId', width: 100, render: r => r.payerId || '—' },
  { title: '耗时 ms', key: 'ms', width: 88 },
  {
    title: '时间',
    key: 'at',
    width: 160,
    render: row => formatDateTime(row.at)
  }
];

async function loadWebhooks() {
  loadingWebhooks.value = true;
  try {
    webhooks.value = await fetchWebhooks(200);
    webhookPager.resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载 Webhook 失败');
  } finally {
    loadingWebhooks.value = false;
  }
}

async function loadLogs() {
  loadingLogs.value = true;
  try {
    logs.value = await fetchApiLogs(200);
    logPager.resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载 API 日志失败');
  } finally {
    loadingLogs.value = false;
  }
}

const heroMetrics = computed(() => [
  { label: 'Webhook', value: webhooks.value.length },
  { label: 'API 日志', value: logs.value.length }
]);

onMounted(() => {
  void loadWebhooks();
  void loadLogs();
});
</script>

<template>
  <div class="pp-page">
    <PpPageHero
      icon="mdi:timeline-text-outline"
      kicker="运维观测"
      title="Webhook 与日志"
      description="Webhook 自动同步 PayPal 事件；API 日志记录管理端调用（不含密钥）。"
      :metrics="heroMetrics"
    >
      <template #actions>
        <NButton :loading="loadingWebhooks || loadingLogs" @click="() => { void loadWebhooks(); void loadLogs(); }">
          <template #icon><Icon icon="mdi:refresh" width="16" /></template>
          刷新
        </NButton>
      </template>
    </PpPageHero>

    <NTabs type="line" animated>
      <NTabPane name="webhooks" tab="Webhook">
        <div class="tab-toolbar">
          <NButton size="small" :loading="loadingWebhooks" @click="loadWebhooks">刷新</NButton>
        </div>
        <PpAsyncPane
          :loading="loadingWebhooks"
          icon="mdi:webhook"
          title="加载 Webhook"
          description="正在获取通知事件…"
          compact
          min-height="240px"
        >
          <PpEmptyState
            v-if="!webhooks.length"
            compact
            icon="mdi:webhook"
            title="还没有 Webhook 事件"
            description="在 PayPal Developer 控制台将通知 URL 指向本服务，支付与争议事件会自动落在此列表。"
          >
            <template #actions>
              <NButton type="primary" strong secondary @click="loadWebhooks">
                <template #icon><Icon icon="mdi:refresh" width="18" /></template>
                刷新列表
              </NButton>
            </template>
          </PpEmptyState>
          <NDataTable
            v-else
            :columns="webhookColumns"
            :data="webhooks"
            :pagination="webhookPagination"
            class="pp-panel"
            :bordered="false"
          />
        </PpAsyncPane>
      </NTabPane>
      <NTabPane name="logs" tab="API 日志">
        <div class="tab-toolbar">
          <NButton size="small" :loading="loadingLogs" @click="loadLogs">刷新</NButton>
        </div>
        <PpAsyncPane
          :loading="loadingLogs"
          icon="mdi:timeline-text-outline"
          title="加载 API 日志"
          description="正在获取调用记录…"
          compact
          min-height="240px"
        >
          <PpEmptyState
            v-if="!logs.length"
            compact
            icon="mdi:timeline-text-outline"
            title="暂无 API 调用日志"
            description="管理端请求 PayPal 相关接口后，方法、路径、状态与耗时会记录在此，便于排查授权与查单问题。"
          >
            <template #actions>
              <NButton type="primary" strong secondary @click="loadLogs">
                <template #icon><Icon icon="mdi:refresh" width="18" /></template>
                刷新日志
              </NButton>
            </template>
          </PpEmptyState>
          <NDataTable
            v-else
            :columns="logColumns"
            :data="logs"
            :pagination="logPagination"
            class="pp-panel"
            :bordered="false"
          />
        </PpAsyncPane>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.tab-toolbar {
  margin-bottom: 12px;
}
</style>
