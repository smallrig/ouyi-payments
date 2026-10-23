<script setup lang="ts">
import PpLoadingState from '@/components/PpLoadingState.vue';

withDefaults(
  defineProps<{
    loading: boolean;
    title?: string;
    description?: string;
    icon?: string;
    compact?: boolean;
    minHeight?: string;
  }>(),
  {
    title: '加载中',
    description: '正在获取最新数据…',
    icon: 'mdi:wallet-outline',
    compact: false,
    minHeight: '280px'
  }
);
</script>

<template>
  <div class="pp-async" :style="{ minHeight: loading ? minHeight : undefined }">
    <PpLoadingState
      v-if="loading"
      :title="title"
      :description="description"
      :icon="icon"
      :compact="compact"
    />
    <div v-else class="pp-async__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.pp-async {
  width: 100%;
}

.pp-async__body {
  animation: pp-async-in 0.28s ease both;
}

@keyframes pp-async-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
