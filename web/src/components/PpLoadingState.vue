<script setup lang="ts">
import { Icon } from '@iconify/vue';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    icon?: string;
    compact?: boolean;
  }>(),
  {
    title: '加载中',
    description: '正在获取最新数据…',
    icon: 'mdi:wallet-outline',
    compact: false
  }
);
</script>

<template>
  <div class="pp-loading" :class="{ 'pp-loading--compact': compact }" role="status" aria-live="polite">
    <div class="pp-loading__visual" aria-hidden="true">
      <span class="pp-loading__ring" />
      <span class="pp-loading__ring pp-loading__ring--delay" />
      <span class="pp-loading__orb">
        <Icon :icon="icon" width="22" />
      </span>
    </div>
    <h2 class="pp-loading__title">{{ title }}</h2>
    <p v-if="description" class="pp-loading__desc">{{ description }}</p>
    <div class="pp-loading__dots" aria-hidden="true">
      <span /><span /><span />
    </div>
  </div>
</template>
