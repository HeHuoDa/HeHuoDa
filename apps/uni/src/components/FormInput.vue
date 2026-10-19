<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import FormButton from "./FormButton.vue";
// #ifdef H5
import NativeTextControl from "../forms/NativeTextControl.h5.vue";
// #endif
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    error?: string;
    hint?: string;
    placeholder?: string;
    secret?: boolean;
    multiline?: boolean;
    type?: "text" | "number" | "digit";
    focus?: boolean;
    disabled?: boolean;
    loading?: boolean;
    maxlength?: number;
    adjustPosition?: boolean;
    autocomplete?: string;
    email?: boolean;
  }>(),
  {
    type: "text",
    maxlength: -1,
    adjustPosition: true,
    error: "",
    hint: "",
    placeholder: "",
    autocomplete: "off",
  },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  input: [value: string];
  change: [value: string];
  focus: [];
  blur: [];
  confirm: [];
}>();
const visible = ref(false);
const focused = ref(false);
const disabled = computed(() => props.disabled || props.loading);
watch(
  () => props.focus,
  (value) => {
    focused.value = !!value;
  },
  { immediate: true },
);
function input(event: unknown) {
  if (disabled.value) return;
  const value = (event as { detail?: { value?: unknown } })?.detail?.value;
  if (typeof value !== "string") return;
  // 包括密码在内的所有输入均保留原值，规范化由消费表单决定。
  emit("update:modelValue", value);
  emit("input", value);
}
async function reveal() {
  if (disabled.value) return;
  visible.value = !visible.value;
  focused.value = false;
  await nextTick();
  focused.value = true;
}
function blur(event: unknown) {
  focused.value = false;
  emit("blur");
  const value = (event as { detail?: { value?: unknown } })?.detail?.value;
  emit("change", typeof value === "string" ? value : props.modelValue);
}
</script>

<template>
  <view :id="`${id}-field`" class="hhr-form-field">
    <label :for="id" class="hhr-form-label">{{ label }}</label>
    <view
      class="hhr-form-input-row"
      :class="{ 'has-error': error, 'is-disabled': disabled }"
    >
      <!-- #ifdef H5 -->
      <NativeTextControl
        :id="id"
        :model-value="modelValue"
        :multiline="multiline"
        :password="secret && !visible"
        :type="email ? 'email' : type === 'digit' ? 'text' : type"
        :inputmode="email ? 'email' : type === 'digit' ? 'decimal' : undefined"
        :autocomplete="autocomplete"
        :placeholder="placeholder"
        :focus="focused"
        :disabled="disabled"
        :maxlength="maxlength"
        :aria-invalid="!!error"
        :aria-label="label"
        :aria-describedby="
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        "
        class="hhr-input"
        :class="{ 'hhr-form-textarea': multiline }"
        @input="input"
        @focus="
          focused = true;
          emit('focus');
        "
        @blur="blur"
        @confirm="emit('confirm')"
      />
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <textarea
        v-if="multiline"
        :id="id"
        :value="modelValue"
        :focus="focused"
        :disabled="disabled"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :adjust-position="adjustPosition"
        :cursor-spacing="24"
        :show-confirm-bar="false"
        :aria-label="label"
        :aria-invalid="!!error"
        :aria-describedby="
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        "
        class="hhr-input hhr-form-textarea"
        @input="input"
        @focus="
          focused = true;
          emit('focus');
        "
        @blur="blur"
      />
      <input
        v-else
        :id="id"
        :value="modelValue"
        :type="type"
        :password="secret && !visible"
        :focus="focused"
        :disabled="disabled"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :adjust-position="adjustPosition"
        :cursor-spacing="24"
        confirm-type="done"
        :aria-label="label"
        :aria-invalid="!!error"
        :aria-describedby="
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        "
        class="hhr-input"
        @input="input"
        @focus="
          focused = true;
          emit('focus');
        "
        @blur="blur"
        @confirm="emit('confirm')"
      />
      <!-- #endif -->
      <FormButton
        v-if="secret && !multiline"
        variant="reveal"
        :disabled="disabled"
        :aria-label="`${visible ? '隐藏' : '显示'}${label}`"
        :aria-pressed="visible"
        @click="reveal"
        >{{ visible ? "隐藏" : "显示" }}</FormButton
      >
      <slot />
    </view>
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
