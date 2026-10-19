<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { colleges } from "../data/colleges";
import ResourceImage from "./ResourceImage.vue";

const props = withDefaults(
  defineProps<{
    collegeId: string;
    size?: number;
    decorative?: boolean;
    picker?: boolean;
    compact?: boolean;
  }>(),
  { size: 40, decorative: false },
);
const college = computed(() =>
  colleges.find((item) => item.id === props.collegeId),
);
const failed = ref(false);
watch(
  () => props.collegeId,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <view
    class="college-emblem"
    :class="{
      'college-emblem--picker': picker,
      'college-emblem--compact': picker && compact,
      'college-emblem--white': picker && college?.whiteArtwork && !failed,
    }"
    :style="picker ? undefined : { width: `${size}px`, height: `${size}px` }"
  >
    <ResourceImage
      :src="college?.emblem"
      :label="college ? `${college.name}院徽` : '未知学院'"
      :fallback="
        college ? (picker ? college.name[0] : college.name) : '未知学院'
      "
      :initial="picker"
      :white-artwork="college?.whiteArtwork"
      :size="size"
      :decorative="decorative"
      fill
      @error="failed = true"
    />
  </view>
</template>

<style scoped>
.college-emblem {
  display: inline-flex;
  flex-shrink: 0;
  box-sizing: border-box;
}
.college-emblem--picker {
  width: 48px;
  height: 48px;
  padding: 3px;
  border: 1px solid var(--hhr-color-line);
  border-radius: 50%;
  background: var(--hhr-color-surface);
}
.college-emblem--compact {
  width: 32px;
  height: 32px;
  padding: 2px;
}
.college-emblem--white {
  background: var(--hhr-color-brand);
}
@media (max-width: 767px) {
  .college-emblem--picker {
    width: 36px;
    height: 36px;
  }
  .college-emblem--compact {
    width: 32px;
    height: 32px;
  }
}
</style>
