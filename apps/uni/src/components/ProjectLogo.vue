<script setup lang="ts">
import ResourceImage from "./ResourceImage.vue";

withDefaults(defineProps<{ size?: number; decorative?: boolean }>(), {
  size: 40,
  decorative: true,
});
</script>

<template>
  <ResourceImage
    src="/static/hehuoda-logo.png"
    label="禾伙搭"
    fallback="禾伙搭"
    :size="size"
    :decorative="decorative"
  />
</template>
