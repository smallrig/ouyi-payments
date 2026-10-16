<script setup lang="ts">
import { Icon } from '@iconify/vue';

withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    compact?: boolean;
  }>(),
  {
    icon: 'mdi:inbox-outline',
    description: '',
    compact: false
  }
);
</script>

<template>
  <div class="pp-empty" :class="{ 'pp-empty--compact': compact }">
    <div class="pp-empty__icon" aria-hidden="true">
      <Icon :icon="icon" width="28" />
    </div>
    <h2 class="pp-empty__title">{{ title }}</h2>
    <p v-if="description" class="pp-empty__desc">{{ description }}</p>
    <div v-if="$slots.actions || $slots.default" class="pp-empty__actions">
      <slot name="actions" />
      <slot />
    </div>
  </div>
</template>
