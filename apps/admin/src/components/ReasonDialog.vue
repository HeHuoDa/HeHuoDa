<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { errorMessage } from "../console/resource";
const props = defineProps<{
  modelValue: boolean;
  title: string;
  execute: (reason: string, conclusion: string) => Promise<void>;
  needsConclusion?: boolean;
  blocked?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const reason = ref(""),
  conclusion = ref(""),
  error = ref(""),
  pending = ref(false);
const input = ref<{ focus: () => void }>();
watch(
  () => props.modelValue,
  () => {
    reason.value = "";
    conclusion.value = "";
    error.value = "";
  },
);
function close() {
  if (!pending.value) emit("update:modelValue", false);
}
async function submit() {
  if (pending.value || props.blocked) return;
  error.value = "";
  if (!reason.value.trim() || reason.value.trim().length > 1000) {
    error.value = "请填写理由（1–1000 字）";
    await nextTick();
    input.value?.focus();
    return;
  }
  if (props.needsConclusion && !conclusion.value) {
    error.value = "请选择举报处理结论";
    return;
  }
  pending.value = true;
  try {
    await props.execute(reason.value.trim(), conclusion.value);
    error.value = "请求已返回，请重新加载核验实际状态。";
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    :title="title + ' · 确认预览'"
    width="min(560px, 92vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!pending"
    :show-close="!pending"
    :before-close="close"
    @update:model-value="close"
  >
    <p class="field-help">
      当前为页面预览。确认后仅尝试服务适配，服务未开放时不会执行操作。举报结论不自动限制账号或隐藏招募。
    </p>
    <form class="editor-form" :aria-busy="pending" @submit.prevent="submit">
      <template v-if="needsConclusion"
        ><label for="action-conclusion">处理结论</label
        ><ElSelect
          id="action-conclusion"
          v-model="conclusion"
          :disabled="pending || blocked"
          aria-label="处理结论"
          ><ElOption
            label="属实，另行评估治理措施"
            value="substantiated" /><ElOption
            label="不属实"
            value="dismissed" /><ElOption
            label="资料不足"
            value="insufficient" /></ElSelect
      ></template>
      <label for="action-reason">理由（必填）</label
      ><ElInput
        id="action-reason"
        ref="input"
        v-model="reason"
        type="textarea"
        :rows="5"
        :disabled="pending"
        maxlength="1000"
        show-word-limit
      />
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <div class="console-actions">
        <ElButton :disabled="pending" @click="close">取消</ElButton
        ><ElButton
          type="primary"
          native-type="submit"
          :loading="pending"
          :disabled="pending || blocked"
          >确认{{ title }}</ElButton
        >
      </div>
    </form>
  </ElDialog>
</template>
