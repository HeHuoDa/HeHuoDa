<script setup lang="ts">
import { computed } from "vue";
// #ifdef H5
import NativePicker from "../forms/NativePicker.h5.vue";
// #endif
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    options?: { value: string; label: string }[];
    mode?: "selector" | "date" | "time";
    placeholder?: string;
    error?: string;
    hint?: string;
    disabled?: boolean;
    loading?: boolean;
    focus?: boolean;
  }>(),
  {
    options: () => [],
    mode: "selector",
    placeholder: "请选择",
    error: "",
    hint: "",
  },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  cancel: [];
}>();
const selected = computed(() =>
  props.options.findIndex((item) => item.value === props.modelValue),
);
const display = computed(() =>
  props.mode === "selector"
    ? props.options[selected.value]?.label
    : props.modelValue,
);
function change(value: string) {
  if (props.disabled || props.loading) return;
  emit("update:modelValue", value);
  emit("change", value);
}
function platformChange(event: { detail: { value: string | number } }) {
  if (props.mode === "selector") {
    const option = props.options[Number(event.detail.value)];
    if (option) change(option.value);
  } else change(String(event.detail.value));
}
</script>

<template>
  <view :id="`${id}-field`" class="hhr-form-field">
    <label :for="id" class="hhr-form-label">{{ label }}</label>
    <!-- #ifdef H5 -->
    <NativePicker
      :id="id"
      :model-value="modelValue"
      :mode="mode"
      :options="options"
      :placeholder="placeholder"
      :disabled="disabled || loading"
      :focus="focus"
      :aria-label="label"
      :aria-invalid="!!error"
      :aria-describedby="
        error ? `${id}-error` : hint ? `${id}-hint` : undefined
      "
      class="hhr-input hhr-native-picker"
      :class="{ 'has-error': error }"
      @change="change"
    />
    <!-- #endif -->
    <!-- #ifdef MP-WEIXIN -->
    <picker
      :id="id"
      :mode="mode"
      :value="mode === 'selector' ? Math.max(0, selected) : modelValue"
      :range="options"
      range-key="label"
      :disabled="disabled || loading"
      :aria-label="`${label}：${display || placeholder}`"
      @change="platformChange"
      @cancel="emit('cancel')"
      ><view
        class="hhr-input hhr-picker-value"
        :class="{ 'has-error': error, 'is-disabled': disabled || loading }"
        >{{ display || placeholder }}</view
      ></picker
    >
    <!-- #endif -->
    <text
      v-if="error"
      :id="`${id}-error`"
      role="alert"
      class="hhr-form-error"
      >{{ error }}</text
    >
    <text v-else-if="hint" :id="`${id}-hint`" class="hhr-form-hint">{{
      hint
    }}</text>
  </view>
</template>
