<script setup lang="ts">
import { computed } from "vue";
import FormPicker from "./FormPicker.vue";
const props = defineProps<{
  id: string;
  label: string;
  /** 无时区的北京时间 YYYY-MM-DDTHH:mm，由共享 parseDeadline 严格解析。 */
  modelValue: string;
  error?: string;
  disabled?: boolean;
  focus?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
}>();
const parts = computed(() => props.modelValue.split("T"));
function update(part: "date" | "time", value: string) {
  const date = part === "date" ? value : parts.value[0] || "";
  const time = part === "time" ? value : parts.value[1] || "";
  const next = `${date}T${time}`;
  emit("update:modelValue", next);
  emit("change", next);
}
</script>
<template>
  <view :id="`${id}-field`" class="hhr-form-field">
    <text class="hhr-form-label">{{ label }}（北京时间）</text>
    <view class="hhr-datetime-fields">
      <FormPicker
        :id="`${id}-date`"
        label="日期"
        mode="date"
        :model-value="parts[0] || ''"
        :disabled="disabled"
        :focus="focus"
        @change="update('date', $event)"
      />
      <FormPicker
        :id="`${id}-time`"
        label="时间"
        mode="time"
        :model-value="parts[1] || ''"
        :disabled="disabled"
        @change="update('time', $event)"
      />
    </view>
    <text
      v-if="error"
      :id="`${id}-error`"
      role="alert"
      class="hhr-form-error"
      >{{ error }}</text
    >
  </view>
</template>
