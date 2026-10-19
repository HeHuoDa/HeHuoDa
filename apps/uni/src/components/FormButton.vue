<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    loading?: boolean;
    variant?: "primary" | "secondary" | "soft" | "danger" | "reveal";
  }>(),
  { variant: "primary" },
);
const emit = defineEmits<{ click: [] }>();
function activate() {
  if (!props.disabled && !props.loading) emit("click");
}
function keydown(event: {
  key: string;
  repeat?: boolean;
  preventDefault: () => void;
}) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!event.repeat) activate();
  }
}
</script>

<template>
  <!-- H5 uni-button 默认不可键盘聚焦，view 显式承担按钮角色和键盘操作。 -->
  <!-- #ifdef H5 -->
  <view
    role="button"
    :tabindex="disabled || loading ? -1 : 0"
    :aria-disabled="disabled || loading"
    :aria-busy="loading"
    class="hhr-button"
    :class="[
      `hhr-button--${variant}`,
      { 'is-disabled': disabled, 'is-loading': loading },
    ]"
    @click="activate"
    @keydown="keydown"
    ><slot
  /></view>
  <!-- #endif -->
  <!-- #ifdef MP-WEIXIN -->
  <button
    :disabled="disabled || loading"
    :loading="loading"
    class="hhr-button"
    :class="`hhr-button--${variant}`"
    @click="activate"
  >
    <slot />
  </button>
  <!-- #endif -->
</template>

<style scoped>
.hhr-button {
  cursor: pointer;
}
.hhr-button--reveal {
  flex-shrink: 0;
  width: auto;
  margin-right: 4px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--hhr-color-brand);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.65;
}
.hhr-button.hhr-button--reveal[disabled],
.hhr-button.hhr-button--reveal.is-disabled {
  background: transparent;
  color: var(--hhr-color-brand);
}
</style>
