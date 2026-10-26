<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CampusState } from "../campus/controller";
import { beijingTime } from "../campus/presentation";
import AppIcon from "./AppIcon.vue";
import FormButton from "./FormButton.vue";
import FormInput from "./FormInput.vue";

const props = defineProps<{ state: CampusState }>();
const emit = defineEmits<{
  restart: [];
  reload: [];
  refresh: [];
  submit: [];
  query: [];
  cancel: [];
  back: [];
  consent: [value: boolean];
  name: [value: string];
  account: [value: string];
  password: [value: string];
  captcha: [value: string];
  imageError: [];
}>();

/** 认证说明固定短文案，不再提供长说明展开入口。 */
const note =
  "密码、验证码仅用于本次认证，不会保存。学校返回的姓名、学号加密保存，仅本人可见。认证仅核对学校账号信息，不证明当前在读或操作者本人。";

const formOpen = ref(false);
const busy = computed(() => !!props.state.pending);
const challenge = computed(() => props.state.transaction?.challenge);
const succeeded = computed(
  () => props.state.transaction?.status === "succeeded",
);
const processing = computed(
  () =>
    props.state.transaction?.status === "processing" || props.state.uncertain,
);
const ended = computed(() =>
  ["failed", "cancelled", "expired"].includes(
    props.state.transaction?.status ?? "",
  ),
);
const verified = computed(() => props.state.qualification?.status === "valid");
/** 恢复前台或结果不明后只剩事务、没有验证码：必须重新认证。 */
const needRestart = computed(
  () =>
    props.state.transaction?.status === "waiting" &&
    !props.state.transaction.challenge &&
    !props.state.uncertain,
);
const waiting = computed(
  () =>
    props.state.transaction?.status === "waiting" &&
    !!challenge.value &&
    !props.state.uncertain,
);
const blocked = computed(() => {
  const qualification = props.state.qualification;
  if (!qualification) return "";
  if (!qualification.available)
    return "统一身份认证暂未开放，可继续浏览。已有资格仍按原截止时间计算。";
  if (!qualification.currentTerm)
    return "当前没有学期配置，暂不可认证，可继续浏览。";
  return "";
});
const statusText = computed(() => {
  if (succeeded.value) return "认证成功";
  if (processing.value) return "正在认证，请稍候";
  if (ended.value) return "本次认证未完成";
  if (verified.value) return "已认证";
  if (blocked.value) return "暂不可认证";
  if (props.state.pending === "creating") return "正在获取验证码";
  return "未认证";
});
const showCard = computed(() => verified.value || succeeded.value);
const showForm = computed(
  () =>
    formOpen.value &&
    !succeeded.value &&
    !processing.value &&
    !ended.value &&
    !needRestart.value &&
    !blocked.value,
);
const canSubmit = computed(
  () =>
    !!props.state.name.trim() &&
    !!props.state.account.trim() &&
    !!props.state.password &&
    !!props.state.captcha &&
    props.state.consented &&
    waiting.value &&
    !props.state.imageFailed,
);
const expiry = computed(() =>
  beijingTime(props.state.qualification?.validUntil),
);

watch(
  verified,
  (value) => {
    // 已有有效资格先看资料卡，点“重新认证”才展开表单。
    formOpen.value = !value;
  },
  { immediate: true },
);
watch([succeeded, ended], ([done, failed]) => {
  if (done || failed) formOpen.value = false;
});

function beginRenew() {
  formOpen.value = true;
  emit("restart");
}
function refreshImage() {
  if (busy.value || !waiting.value) return;
  emit("refresh");
}
</script>

<template>
  <view class="campus-panel">
    <view class="campus-header">
      <AppIcon name="shield" :size="20" class="campus-shield" />
      <view class="campus-header-text">
        <text class="campus-heading">统一身份认证</text>
        <text class="campus-status" role="status" aria-live="polite">{{
          statusText
        }}</text>
      </view>
    </view>

    <view v-if="blocked" class="campus-card">
      <text class="campus-copy">{{ blocked }}</text>
      <FormButton variant="secondary" :disabled="busy" @click="emit('reload')"
        >重新查询</FormButton
      >
    </view>

    <view v-if="showCard" class="campus-card" aria-label="本人认证资料">
      <view class="campus-detail">
        <text class="campus-detail-label">姓名</text>
        <text class="campus-detail-value">{{
          state.profile?.name || "—"
        }}</text>
      </view>
      <view class="campus-detail">
        <text class="campus-detail-label">学号</text>
        <text class="campus-detail-value">{{
          state.profile?.accountNumber || "—"
        }}</text>
      </view>
      <view class="campus-detail">
        <text class="campus-detail-label">有效期</text>
        <text class="campus-detail-value">{{ expiry }}</text>
      </view>
      <text v-if="state.profileError" class="campus-copy">{{
        state.profileError
      }}</text>
      <FormButton v-if="succeeded" @click="emit('back')">返回原页面</FormButton>
      <FormButton
        v-else
        variant="secondary"
        :disabled="busy || processing"
        @click="beginRenew"
        >重新认证</FormButton
      >
    </view>

    <view v-if="showForm" class="campus-card campus-form">
      <FormInput
        id="campus-name"
        label="姓名"
        hide-label
        placeholder="姓名"
        :model-value="state.name"
        :error="state.fieldErrors.name"
        :disabled="busy"
        :maxlength="128"
        autocomplete="off"
        @update:model-value="emit('name', $event)"
      />
      <FormInput
        id="campus-account"
        label="学号"
        hide-label
        placeholder="学号"
        :model-value="state.account"
        :error="state.fieldErrors.account"
        :disabled="busy"
        :maxlength="128"
        autocomplete="off"
        @update:model-value="emit('account', $event)"
      />
      <FormInput
        id="campus-password"
        label="统一身份认证密码"
        hide-label
        reveal-icon
        placeholder="统一身份认证密码"
        :model-value="state.password"
        :error="state.fieldErrors.password"
        secret
        :disabled="busy"
        :maxlength="512"
        autocomplete="off"
        @update:model-value="emit('password', $event)"
      />
      <view class="campus-captcha">
        <view class="campus-captcha-field">
          <FormInput
            id="campus-captcha"
            label="验证码"
            hide-label
            placeholder="验证码"
            :model-value="state.captcha"
            :error="state.fieldErrors.captcha"
            :disabled="busy"
            :maxlength="32"
            autocomplete="off"
            @update:model-value="emit('captcha', $event)"
            @confirm="emit('submit')"
          />
        </view>
        <view
          class="campus-captcha-image"
          role="button"
          :tabindex="busy ? -1 : 0"
          :aria-label="'换一张验证码图片'"
          :aria-busy="state.pending === 'refreshing'"
          :aria-disabled="busy"
          @click="refreshImage"
          @keydown.enter.prevent="refreshImage"
          @keydown.space.prevent="refreshImage"
        >
          <image
            v-if="challenge"
            class="campus-captcha-img"
            :src="challenge.imageDataUrl"
            mode="aspectFit"
            aria-hidden="true"
            @error="emit('imageError')"
          />
          <text v-else class="campus-captcha-wait">{{
            state.pending === "creating" ? "加载中" : "换一张"
          }}</text>
        </view>
      </view>
      <text class="campus-captcha-hint">看不清？点击图片换一张</text>
      <FormButton
        :disabled="busy || !canSubmit"
        :loading="state.pending === 'submitting'"
        @click="emit('submit')"
        >{{ state.pending === "submitting" ? "正在认证…" : "认证" }}</FormButton
      >
    </view>

    <view v-if="showForm" class="campus-note-block">
      <text class="campus-note">{{ note }}</text>
      <view
        class="campus-consent"
        role="checkbox"
        :aria-checked="state.consented"
        :aria-disabled="busy"
        tabindex="0"
        aria-label="我已阅读并同意上述认证说明"
        @click="!busy && emit('consent', !state.consented)"
        @keydown.enter.prevent="!busy && emit('consent', !state.consented)"
        @keydown.space.prevent="!busy && emit('consent', !state.consented)"
      >
        <view
          class="campus-checkbox"
          :class="{ 'is-checked': state.consented }"
          aria-hidden="true"
          >{{ state.consented ? "✓" : "" }}</view
        >
        <text class="campus-consent-text">我已阅读并同意上述认证说明</text>
      </view>
    </view>

    <text
      v-if="state.message"
      class="campus-feedback"
      role="status"
      aria-live="polite"
      >{{ state.message }}</text
    >

    <view v-if="processing" class="campus-actions">
      <FormButton
        v-if="state.uncertain"
        variant="secondary"
        :disabled="busy"
        :loading="state.pending === 'querying'"
        @click="emit('query')"
        >查询本次结果</FormButton
      >
      <FormButton
        variant="soft"
        :disabled="busy"
        :loading="state.pending === 'cancelling'"
        @click="emit('cancel')"
        >取消本次认证</FormButton
      >
    </view>

    <FormButton
      v-if="!processing && !showCard && (ended || needRestart)"
      :disabled="busy"
      :loading="state.pending === 'creating'"
      @click="beginRenew"
      >{{
        state.pending === "creating" ? "正在获取验证码…" : "重新认证"
      }}</FormButton
    >
  </view>
</template>

<style scoped>
.campus-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px calc(28px + env(safe-area-inset-bottom));
  color: var(--hhr-color-ink);
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.campus-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
.campus-shield {
  color: var(--hhr-color-brand);
}
.campus-header-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.campus-heading {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.campus-status {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.5;
}
.campus-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 16px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-surface);
}
.campus-copy {
  color: var(--hhr-color-muted);
  font-size: 13px;
}
.campus-detail {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.campus-detail-label {
  flex-shrink: 0;
  color: var(--hhr-color-muted);
  font-size: 13px;
}
.campus-detail-value {
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  text-align: right;
}
.campus-captcha {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.campus-captcha-field {
  flex: 1;
  min-width: 0;
}
.campus-captcha-image {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
  width: 104px;
  min-height: 44px;
  height: 44px;
  margin-top: 0;
  padding: 0 4px;
  border: 1px solid var(--hhr-color-input-line);
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-page);
  cursor: pointer;
}
.campus-captcha-img {
  display: block;
  width: 100%;
  height: 100%;
}
.campus-captcha-wait {
  color: var(--hhr-color-muted);
  font-size: 12px;
}
.campus-captcha-hint {
  margin-top: -6px;
  color: var(--hhr-color-muted);
  font-size: 12px;
}
.campus-note-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 4px;
}
.campus-note {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.7;
}
.campus-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  cursor: pointer;
}
.campus-checkbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 1px solid var(--hhr-color-muted);
  border-radius: 4px;
  color: var(--hhr-color-surface);
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}
.campus-checkbox.is-checked {
  background: var(--hhr-color-brand);
  border-color: var(--hhr-color-brand);
}
.campus-consent-text {
  font-size: 13px;
  line-height: 1.6;
}
.campus-feedback {
  display: block;
  padding: 12px 14px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-ink);
  font-size: 13px;
  line-height: 1.6;
}
.campus-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.campus-panel :deep(.hhr-button) {
  min-height: 44px;
  height: auto;
  white-space: normal;
  text-align: center;
  box-sizing: border-box;
}
.campus-consent:focus-visible,
.campus-captcha-image:focus-visible {
  outline: 2px solid var(--hhr-color-focus);
  outline-offset: 3px;
}
</style>
