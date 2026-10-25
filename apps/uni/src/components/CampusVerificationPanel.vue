<script setup lang="ts">
import { computed } from "vue";
import type { CampusState } from "../campus/controller";
import { beijingTime, renewalDue } from "../campus/presentation";
import FormButton from "./FormButton.vue";
import FormInput from "./FormInput.vue";

const props = defineProps<{ state: CampusState }>();
const emit = defineEmits<{
  start: [];
  refresh: [];
  submit: [];
  query: [];
  cancel: [];
  retry: [];
  back: [];
  consent: [value: boolean];
  account: [value: string];
  password: [value: string];
  captcha: [value: string];
  imageError: [];
}>();
const busy = computed(() => !!props.state.pending);
const labels: Record<string, string> = {
  unverified: "校园账号未验证",
  valid: "校园账号已验证",
  expired: "校园账号核验已过期",
  revoked: "校园账号核验已撤销",
};
const txLabels: Record<string, string> = {
  waiting: "等待填写验证码",
  processing: "学校正在处理，请稍候",
  succeeded: "本次核验成功",
  failed: "本次核验未通过",
  cancelled: "本次核验已取消",
  expired: "本次核验已过期",
};
const waiting = computed(
  () =>
    props.state.transaction?.status === "waiting" &&
    !!props.state.transaction.challenge &&
    !props.state.uncertain,
);
const ongoing = computed(() =>
  ["waiting", "processing"].includes(props.state.transaction?.status ?? ""),
);
const canStart = computed(
  () =>
    props.state.consented &&
    props.state.qualification?.available &&
    !!props.state.qualification.currentTerm &&
    !ongoing.value &&
    !props.state.uncertain,
);
</script>

<template>
  <view class="campus-panel">
    <view class="campus-intro">
      <text class="campus-heading">校园账号核验</text>
      <text class="campus-copy"
        >确认校园账号控制权，让校园合作多一份信任。</text
      >
    </view>
    <view class="campus-section" aria-label="当前校园资格">
      <text class="campus-title">{{
        state.qualification
          ? labels[state.qualification.status]
          : "校园资格待查询"
      }}</text>
      <text v-if="state.qualification?.validUntil" class="campus-copy"
        >有效至 {{ beijingTime(state.qualification.validUntil) }}</text
      >
      <text v-if="state.qualification?.termId" class="campus-muted"
        >核验学期：{{ state.qualification.termId }}</text
      >
      <text
        v-if="
          state.qualification?.status === 'valid' &&
          renewalDue(state.qualification.validUntil)
        "
        class="campus-copy"
        >距离到期不足七天。下一学期需重新核验；同学期重验不会延长到下学期。</text
      >
      <text class="campus-muted"
        >核验只证明校园账号控制权，不证明本科、在读、实名或学校担保。到期仅限制发布招募、申请、接受邀请和查看联系方式，不会因此被踢出队伍。</text
      >
      <text
        v-if="state.qualification?.status === 'valid' && ongoing"
        class="campus-copy"
        >本次重验与已有资格分别计算；处理中或普通失败不会撤销原有有效资格。</text
      >
    </view>
    <view class="campus-section" aria-label="本人学校资料">
      <text class="campus-title">本人学校资料</text>
      <template v-if="state.profile">
        <view class="campus-detail"
          ><text class="campus-muted">学校账号编号</text
          ><text class="campus-value">{{
            state.profile.accountNumber
          }}</text></view
        >
        <view class="campus-detail"
          ><text class="campus-muted">学校登记姓名</text
          ><text class="campus-value">{{ state.profile.name }}</text></view
        >
        <text class="campus-muted"
          >仅本人可查看，来自学校返回，不能手工修改；同一校园账号成功重新核验后更新。</text
        >
      </template>
      <text v-else class="campus-muted">{{
        state.profileError ||
        (state.pending === "loading" ? "正在读取…" : "暂无已保存的学校资料。")
      }}</text>
    </view>
    <view v-if="!state.transaction" class="campus-section">
      <text class="campus-title">核验前请独立确认</text>
      <text class="campus-copy"
        >校园密码会经过本平台后端短时处理，不保存密码或学校
        Cookie。学校账号编号与登记姓名会私密保存，供本人只读查看。</text
      >
      <text v-if="state.policy" class="campus-policy">{{
        state.policy.content
      }}</text>
      <text v-else class="campus-muted">{{
        busy ? "正在读取核验告知…" : "告知未加载，请重新查询。"
      }}</text>
      <view
        v-if="state.policy"
        class="campus-consent"
        role="checkbox"
        :aria-checked="state.consented"
        :aria-disabled="busy"
        tabindex="0"
        aria-label="已阅读并同意独立核验告知"
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
        <text>已阅读并同意核验告知（版本 {{ state.policy.version }}）</text>
      </view>
      <text
        v-if="state.qualification && !state.qualification.currentTerm"
        class="campus-copy"
        >当前没有学期配置，暂不可核验，可继续浏览。</text
      >
      <text
        v-else-if="state.qualification && !state.qualification.available"
        class="campus-copy"
        >校园核验暂未开放，可继续浏览。已有资格仍按原截止时间计算。</text
      >
      <FormButton
        :loading="state.pending === 'creating'"
        :disabled="busy || !canStart"
        @click="emit('start')"
        >{{
          state.pending === "creating"
            ? "正在获取验证码…"
            : state.qualification?.status === "valid"
              ? "开始重新核验"
              : "同意并获取验证码"
        }}</FormButton
      >
    </view>
    <view v-else class="campus-section" aria-label="本次核验事务">
      <text class="campus-title">{{ txLabels[state.transaction.status] }}</text>
      <text class="campus-muted"
        >本次事务截止
        {{
          beijingTime(state.transaction.expiresAt)
        }}。学校验证码可能提前失效。</text
      >
      <template v-if="waiting">
        <FormInput
          id="campus-account"
          label="校园账号"
          :model-value="state.account"
          :disabled="busy"
          :maxlength="128"
          autocomplete="off"
          @update:model-value="emit('account', $event)"
        />
        <FormInput
          id="campus-password"
          label="校园密码"
          :model-value="state.password"
          secret
          :disabled="busy"
          :maxlength="512"
          autocomplete="off"
          hint="仅用于本次核验，不保存。"
          @update:model-value="emit('password', $event)"
        />
        <view class="campus-captcha">
          <image
            class="campus-image"
            :src="state.transaction.challenge?.imageDataUrl"
            mode="aspectFit"
            aria-label="学校图片验证码"
            @error="emit('imageError')"
          />
          <FormButton
            variant="secondary"
            :disabled="busy"
            :loading="state.pending === 'refreshing'"
            @click="emit('refresh')"
            >换一张</FormButton
          >
        </view>
        <FormInput
          id="campus-captcha"
          label="图片验证码"
          :model-value="state.captcha"
          :disabled="busy"
          :maxlength="32"
          autocomplete="off"
          hint="手动输入图片字符，刷新后请重新填写。"
          @update:model-value="emit('captcha', $event)"
          @confirm="emit('submit')"
        />
        <FormButton
          :disabled="
            busy ||
            !state.account ||
            !state.password ||
            !state.captcha ||
            state.imageFailed
          "
          :loading="state.pending === 'submitting'"
          @click="emit('submit')"
          >{{
            state.pending === "submitting" ? "正在核验，请稍候…" : "提交核验"
          }}</FormButton
        >
      </template>
      <text v-else-if="ongoing" class="campus-copy">{{
        state.transaction.status === "processing"
          ? "处理中只查询结果，不再次发送密码。"
          : "旧输入已清空。请查询原事务，或取消后重新开始。"
      }}</text>
      <FormButton
        v-if="ongoing || state.uncertain"
        variant="secondary"
        :disabled="busy"
        :loading="state.pending === 'querying'"
        @click="emit('query')"
        >查询本次结果</FormButton
      >
      <FormButton
        v-if="ongoing || state.uncertain"
        variant="soft"
        :loading="state.pending === 'cancelling'"
        :disabled="state.pending === 'cancelling'"
        @click="emit('cancel')"
        >取消本次核验</FormButton
      >
      <FormButton
        v-if="
          !ongoing &&
          !state.uncertain &&
          state.transaction.status !== 'succeeded'
        "
        :disabled="busy"
        @click="emit('retry')"
        >重新开始</FormButton
      >
    </view>
    <text
      v-if="state.message"
      class="campus-feedback"
      role="status"
      aria-live="polite"
      >{{ state.message }}</text
    >
    <view class="campus-footer">
      <FormButton
        v-if="!state.transaction && !busy"
        variant="secondary"
        @click="emit('retry')"
        >重新查询资格与告知</FormButton
      >
      <FormButton variant="soft" @click="emit('back')">{{
        state.transaction?.status === "succeeded"
          ? "返回原页面"
          : "暂不核验，继续浏览"
      }}</FormButton>
      <text class="campus-muted"
        >招募与队伍目前仍有演示内容，核验不会将样例转为正式资产；返回后需自行确认原操作。</text
      >
    </view>
  </view>
</template>

<style scoped>
.campus-panel {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 18px calc(28px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  color: var(--hhr-color-ink);
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.campus-intro {
  padding: 6px 0 24px;
}
.campus-heading {
  display: block;
  font-size: 28px;
  font-weight: 700;
}
.campus-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
}
.campus-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 0;
  border-top: 1px solid var(--hhr-color-line);
}
.campus-copy,
.campus-muted,
.campus-policy {
  display: block;
}
.campus-muted {
  color: var(--hhr-color-muted);
  font-size: 13px;
}
.campus-policy {
  white-space: pre-wrap;
  font-size: 14px;
}
.campus-detail {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 20px;
}
.campus-value {
  min-width: 0;
}
.campus-consent {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 44px;
  cursor: pointer;
}
.campus-checkbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 1px solid var(--hhr-color-muted);
  border-radius: 4px;
  text-align: center;
  line-height: 22px;
}
.campus-checkbox.is-checked {
  color: var(--hhr-color-surface);
  background: var(--hhr-color-brand);
  border-color: var(--hhr-color-brand);
}
.campus-captcha {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.campus-image {
  display: block;
  width: 180px;
  max-width: 100%;
  height: 72px;
  background: var(--hhr-color-surface);
}
.campus-feedback {
  display: block;
  padding: 16px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-ink);
}
.campus-footer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 24px;
}
.campus-panel :deep(.hhr-button) {
  min-height: 44px;
  height: auto;
  white-space: normal;
  text-align: center;
  box-sizing: border-box;
}
.campus-consent:focus-visible {
  outline: 2px solid var(--hhr-color-focus);
  outline-offset: 3px;
}
</style>
