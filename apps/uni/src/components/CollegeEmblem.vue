<script setup lang="ts">
import { computed } from "vue";
import { colleges } from "../data/colleges";
import ResourceImage from "./ResourceImage.vue";

const props = withDefaults(
  defineProps<{ collegeId: string; size?: number; decorative?: boolean }>(),
  { size: 40, decorative: false },
);
const college = computed(() =>
  colleges.find((item) => item.id === props.collegeId),
);
</script>

<template>
  <ResourceImage
    :src="college?.emblem"
    :label="college ? `${college.name}院徽` : '未知学院'"
    :fallback="college ? college.name : '未知学院'"
    :white-artwork="college?.whiteArtwork"
    :size="size"
    :decorative="decorative"
  />
</template>
