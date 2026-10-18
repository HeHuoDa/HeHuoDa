<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), {
  size: 20,
  label: "",
});
</script>

<template>
  <view
    class="loading-indicator"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-hidden="!label"
    :aria-label="label || undefined"
    :role="label ? 'status' : undefined"
  />
</template>

<style scoped>
.loading-indicator {
  box-sizing: border-box;
  display: inline-block;
  flex-shrink: 0;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  vertical-align: middle;
  animation: hhr-loading-spin 1s linear infinite;
}
@keyframes hhr-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-indicator {
    animation: none;
  }
}
</style>
