<script setup lang="ts">
import type { Time } from "@hehuoda/api-types";
const props = defineProps<{ label: string; disabled?: boolean }>();
const model = defineModel<Time>({ required: true });
function precision(value: Time["precision"]) {
  model.value = { precision: value, value: value === "unknown" ? null : "" };
}
</script>
<template>
  <div class="time-field">
    <label
      >{{ props.label }}精度<ElSelect
        :model-value="model.precision"
        :disabled="disabled"
        :aria-label="props.label + '精度'"
        @update:model-value="precision"
        ><ElOption label="未知" value="unknown" /><ElOption
          label="仅日期"
          value="date" /><ElOption
          label="精确时刻（含时区）"
          value="instant" /></ElSelect></label
    ><label v-if="model.precision !== 'unknown'"
      >{{ props.label
      }}<input
        v-model="model.value"
        :type="model.precision === 'date' ? 'date' : 'text'"
        :aria-label="props.label"
        :placeholder="
          model.precision === 'instant' ? '2026-11-08T18:00:00+08:00' : ''
        "
    /></label>
    <p v-else class="field-help">未知，不补齐日期或时刻</p>
  </div>
</template>
