<script setup lang="ts">
// 最小维护型组件 fixture；仅由测试或本地临时入口挂载，不注册生产业务页。
import { nextTick, ref } from "vue";
import FormButton from "../../src/components/FormButton.vue";
import FormInput from "../../src/components/FormInput.vue";
import FormPicker from "../../src/components/FormPicker.vue";
import FormDateTime from "../../src/components/FormDateTime.vue";
import FormDialog from "../../src/components/FormDialog.vue";
import { useDraftForm, type FieldErrors } from "../../src/forms/use-draft-form";
import { deadlineInstant } from "@hehuoda/client-domain/team";

const saved = ref({
  nickname: "禾小苗",
  password: "  password  ",
  campus: "雅安校区",
  deadline: "2026-10-20T00:30",
  bio: "喜欢把想法做成看得见的东西。",
});
type Draft = typeof saved.value;
const saves = ref(0);
const disabled = ref(false);
const loading = ref(false);
const focusField = ref("");
const form = useDraftForm({
  read: () => saved.value,
  clone: (value) => ({ ...value }),
  validate(value) {
    const errors: FieldErrors<Draft> = {};
    if (!value.nickname.trim() || value.nickname.trim().length > 20)
      errors.nickname = "请输入 1–20 字昵称，不能只填写空格。";
    if (!value.password) errors.password = "请输入密码。";
    if (!value.campus) errors.campus = "请选择校区。";
    if (!Number.isFinite(deadlineInstant(value.deadline)))
      errors.deadline = "请选择有效的北京时间日期和时间。";
    if (value.bio.length > 200) errors.bio = "简介不能超过 200 字。";
    return errors;
  },
  save(value) {
    saved.value = value;
    saves.value++;
  },
});
const { opened, draft, errors, submitting, firstError, submitError } = form;
async function submit() {
  focusField.value = "";
  form.submit();
  await nextTick();
  focusField.value = firstError.value;
}
const campusOptions = ["雅安校区", "成都校区", "都江堰校区"].map((value) => ({
  value,
  label: value,
}));
</script>

<template>
  <view class="fixture">
    <FormButton id="fixture-open" @click="form.begin">编辑表单</FormButton>
    <text id="fixture-saved"
      >已保存昵称：{{ saved.nickname }}；保存次数：{{ saves }}</text
    >
    <FormButton variant="secondary" @click="disabled = !disabled"
      >切换禁用</FormButton
    >
    <FormButton variant="secondary" @click="loading = !loading"
      >切换加载</FormButton
    >
    <FormDialog
      id="fixture"
      :open="opened"
      title="编辑资料"
      :saving="submitting"
      :error-target="focusField ? `fixture-${focusField}-field` : ''"
      @cancel="form.cancel"
      @save="submit"
    >
      <view class="fixture-fields">
        <FormInput
          id="fixture-nickname"
          v-model="draft.nickname"
          label="昵称"
          :error="errors.nickname"
          :focus="focusField === 'nickname'"
          :disabled="disabled"
          :loading="loading"
          :adjust-position="false"
        />
        <FormInput
          id="fixture-password"
          v-model="draft.password"
          label="密码"
          secret
          :error="errors.password"
          :focus="focusField === 'password'"
          :disabled="disabled"
          :loading="loading"
          :adjust-position="false"
        />
        <FormPicker
          id="fixture-campus"
          v-model="draft.campus"
          label="校区"
          :options="campusOptions"
          :error="errors.campus"
          :focus="focusField === 'campus'"
          :disabled="disabled"
          :loading="loading"
        />
        <FormDateTime
          id="fixture-deadline"
          v-model="draft.deadline"
          label="截止时间"
          :error="errors.deadline"
          :focus="focusField === 'deadline'"
          :disabled="disabled || loading"
        />
        <FormInput
          id="fixture-bio"
          v-model="draft.bio"
          label="个人简介（最多 200 字）"
          multiline
          :error="errors.bio"
          :focus="focusField === 'bio'"
          :disabled="disabled"
          :loading="loading"
          :adjust-position="false"
        />
        <text v-if="submitError" role="alert">{{ submitError }}</text>
        <text v-for="index in 8" :key="index" class="fixture-long"
          >长表单内容
          {{
            index
          }}：用于检查窄屏阅读、滚动和底部操作可达，不写回任何业务状态。</text
        >
      </view>
    </FormDialog>
  </view>
</template>

<style scoped>
.fixture {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.fixture-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.fixture-long {
  display: block;
  font-size: 14px;
  overflow-wrap: anywhere;
}
</style>
