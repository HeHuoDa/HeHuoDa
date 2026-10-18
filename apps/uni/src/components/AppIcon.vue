<script setup lang="ts">
import { computed } from "vue";
import { resolveIcon } from "./app-icons";

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
    color?: string;
    label?: string;
  }>(),
  { size: 24, color: undefined, label: "" },
);
const glyph = computed(() => resolveIcon(props.name));
</script>

<template>
  <text
    class="app-icon"
    :style="{ fontSize: `${size}px`, color }"
    :aria-hidden="!label"
    :aria-label="label || undefined"
    :role="label ? 'img' : undefined"
    >{{ glyph }}</text
  >
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  overflow: hidden;
  font-family: "HeHuoDa Icons", sans-serif;
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  text-align: center;
  vertical-align: middle;
}
</style>
