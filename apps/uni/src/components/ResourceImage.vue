<script setup lang="ts">
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    src?: string | null;
    label: string;
    fallback?: string;
    decorative?: boolean;
    whiteArtwork?: boolean;
    size?: number;
  }>(),
  {
    src: null,
    fallback: "图片暂缺",
    decorative: false,
    whiteArtwork: false,
    size: 40,
  },
);
const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <view
    class="resource-image"
    :class="{ 'resource-image--white': whiteArtwork && src && !failed }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-hidden="decorative"
    :aria-label="decorative ? undefined : label"
    :role="decorative ? undefined : 'img'"
  >
    <image
      v-if="src && !failed"
      class="resource-image__picture"
      :src="src"
      :alt="decorative ? '' : label"
      mode="aspectFit"
      :draggable="false"
      @error="failed = true"
    />
    <text v-else class="resource-image__fallback">{{ fallback }}</text>
  </view>
</template>

<style scoped>
.resource-image {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  vertical-align: middle;
}
.resource-image--white {
  border-radius: var(--hhr-radius-badge);
  background: var(--hhr-color-brand);
}
.resource-image__picture {
  display: block;
  width: 100%;
  height: 100%;
}
.resource-image__fallback {
  display: block;
  max-width: 100%;
  color: var(--hhr-color-muted);
  font-size: 11px;
  line-height: 1.2;
  overflow-wrap: anywhere;
  text-align: center;
}
</style>
