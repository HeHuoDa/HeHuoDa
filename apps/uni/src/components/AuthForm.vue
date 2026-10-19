<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { onShow } from "@dcloudio/uni-app";
import FormInput from "./FormInput.vue";
import FormButton from "./FormButton.vue";
import { replacePage } from "../navigation/navigate";
import {
  clearSensitive,
  emptyAuthValues,
  feedbackMessage,
  linkedFields,
  revalidateFields,
  validateField,
  validateValues,
  visibleFields,
  type AuthErrors,
  type AuthFeedback,
  type AuthField,
  type AuthMode,
  type AuthValues,
} from "../forms/auth-form";

/**
 * 登录/注册表单主体。
 *
 * 行为对齐旧 Web 的 AuthView.vue：失焦校验、提交全量校验、已报错字段即时复验、
 * 修改密码后联动确认密码。认证与验证码服务尚未开放，合法提交只给出提示，
 * 不发起请求、不生成会话、不写存储、不产生假倒计时。
 *
 * 与旧 Web 的结构差异：不使用 HTML form 元素。H5 下 FormButton 渲染为
 * view[role=button]，没有原生 submit 语义；提交只绑定在按钮点击，
 * 输入框 Enter 通过 FormInput 的 confirm 事件触发（仅单行输入）。
 * 这样显隐与发送验证码按钮在结构上不可能触发提交。
 */
const props = defineProps<{ mode: AuthMode }>();

const registering = computed(() => props.mode === "register");
const values = reactive<AuthValues>(emptyAuthValues());
const errors = reactive<AuthErrors>({});
const feedback = ref<AuthFeedback>("");
/** 用作首错定位的焦点目标；FormInput 在值为 true 时聚焦。 */
const focusField = ref<AuthField | "">("");
const submitting = ref(false);
const fields = computed(() => visibleFields(props.mode));

function clearErrors() {
  for (const field of Object.keys(errors) as AuthField[]) delete errors[field];
}

/** 校验一个字段并写入/清除错误提示。 */
function validate(field: AuthField) {
  const message = validateField(props.mode, field, values);
  if (message) errors[field] = message;
  else delete errors[field];
  return !message;
}

function isVisible(field: AuthField) {
  return fields.value.includes(field);
}

/**
 * 已报错字段随输入即时复验；确认密码一旦填写过就持续校验，
 * 使“两次输入的密码不一致”在修正后立即消失。
 */
watch(
  () => ({ ...values }),
  () => {
    feedback.value = "";
    for (const field of revalidateFields(props.mode, values, errors)) {
      if (isVisible(field)) validate(field);
    }
  },
);

function onFieldInput(field: AuthField) {
  for (const linked of linkedFields(field)) {
    if (isVisible(linked)) validate(linked);
  }
}

/** 定位到字段；H5 由输入控件聚焦，微信设置焦点状态后由输入框自行处理。 */
async function focusAt(field: AuthField) {
  // 先清空再设置，保证连续两次定位同一字段也能重新触发聚焦。
  focusField.value = "";
  await nextTick();
  focusField.value = field;
}

function submit() {
  if (submitting.value) return;
  feedback.value = "";
  clearErrors();
  const result = validateValues(props.mode, values);
  Object.assign(errors, result);
  const invalid =
    visibleFields(props.mode).find((field) => result[field]) ?? "";
  if (invalid) {
    void focusAt(invalid);
    return;
  }
  submitting.value = true;
  try {
    // 真实 OpenAPI 当前只有健康接口；这里不创建会话或模拟请求成功。
    feedback.value = "auth";
  } finally {
    submitting.value = false;
  }
}

function sendCode() {
  feedback.value = "";
  // 只校验邮箱；通过后仍提示服务未开放，不生成倒计时或「已发送」状态。
  if (!validate("email")) {
    void focusAt("email");
    return;
  }
  feedback.value = "code";
}

function switchMode() {
  // 互跳用页面栈替换：返回时不会回到仍带密码的表单实例。
  replacePage(registering.value ? "login" : "register");
}

const feedbackText = computed(() => feedbackMessage(feedback.value));

/**
 * 重新进入页面时清空密码、确认密码与验证码。
 * 邮箱与昵称保留以便续填；反馈与错误一并复位。
 */
function resetSensitive() {
  Object.assign(values, clearSensitive(values));
  clearErrors();
  feedback.value = "";
  focusField.value = "";
}

onShow(resetSensitive);
</script>

<template>
  <view
    class="hhr-panel hhr-auth-panel"
    role="region"
    :aria-label="registering ? '注册' : '登录'"
  >
    <text class="hhr-eyebrow">
      {{ registering ? "GROW TOGETHER" : "WELCOME BACK" }}
    </text>
    <text class="auth-heading">
      {{ registering ? "注册" : "登录" }}
    </text>
    <text class="auth-intro">
      {{
        registering
          ? "从认识彼此开始，一起让想法生根。"
          : "欢迎回来，继续寻找你的校园伙伴。"
      }}
    </text>
    <view class="auth-form">
      <FormInput
        v-if="registering"
        id="auth-nickname"
        v-model="values.nickname"
        label="昵称"
        autocomplete="nickname"
        placeholder="希望伙伴怎么称呼你"
        :error="errors.nickname"
        :focus="focusField === 'nickname'"
        @blur="validate('nickname')"
      />
      <FormInput
        id="auth-email"
        v-model="values.email"
        label="邮箱"
        email
        autocomplete="email"
        placeholder="请输入邮箱地址"
        :error="errors.email"
        :focus="focusField === 'email'"
        @blur="validate('email')"
        @input="onFieldInput('email')"
      >
        <FormButton
          v-if="registering"
          variant="soft"
          class="auth-send"
          @click="sendCode"
          >发送验证码</FormButton
        >
      </FormInput>
      <FormInput
        id="auth-password"
        v-model="values.password"
        label="密码"
        secret
        :autocomplete="registering ? 'new-password' : 'current-password'"
        :placeholder="registering ? '至少 8 位，不限制字符组合' : '请输入密码'"
        :error="errors.password"
        :focus="focusField === 'password'"
        @blur="validate('password')"
        @input="onFieldInput('password')"
        @confirm="registering ? undefined : submit()"
      />
      <FormInput
        v-if="registering"
        id="auth-confirmation"
        v-model="values.confirmation"
        label="确认密码"
        secret
        autocomplete="new-password"
        placeholder="请再次输入密码"
        :error="errors.confirmation"
        :focus="focusField === 'confirmation'"
        @blur="validate('confirmation')"
      />
      <FormInput
        v-if="registering"
        id="auth-code"
        v-model="values.code"
        label="邮箱验证码"
        autocomplete="one-time-code"
        placeholder="请输入验证码"
        hint="验证码服务暂未开放，暂时无法获取验证码。"
        :error="errors.code"
        :focus="focusField === 'code'"
        @blur="validate('code')"
        @confirm="submit()"
      />
      <text class="auth-service-note">
        账号服务暂未开放，当前可先浏览首页与找队友。
      </text>
      <text
        v-if="feedbackText"
        class="auth-feedback"
        role="status"
        aria-live="polite"
        >{{ feedbackText }}</text
      >
      <FormButton :disabled="submitting" class="auth-submit" @click="submit">
        {{ registering ? "注册" : "登录" }}
      </FormButton>
    </view>
    <view class="hhr-auth-switch">
      <text>{{ registering ? "已经有账号？" : "还没有账号？" }}</text>
      <text
        class="hhr-auth-switch__link"
        role="link"
        tabindex="0"
        @click="switchMode"
        @keydown.enter.prevent="switchMode"
        @keydown.space.prevent="switchMode"
      >
        {{ registering ? "前往登录" : "前往注册" }} →
      </text>
    </view>
  </view>
</template>

<style scoped>
/*
 * 旧 Web 的认证面板内部间距：标题 30px/36px，说明 13px，表单间距 18px
 * （767px 以下 16px / 顶部 24px），与 .auth-* 组件类一一对应。
 *
 * 单位沿用 docs/student-ui-style.md 的对照迁移例外（同 #65 表单、#63 健康页）：
 * 间距写固定 px。uni-app H5 会按视口缩放根字号（375px 宽时 1rem = 15.36px），
 * rem 会让 20px 留白在 375px 缩到 19.2px、430px 涨到 22px，与旧 Web 出现可见差异。
 */
.auth-heading {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-ink);
  font-family: var(--hhr-font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 36px;
  letter-spacing: -0.025em;
}

.auth-intro {
  display: block;
  margin-top: 8px;
  color: var(--hhr-color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

.auth-service-note {
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.auth-feedback {
  display: block;
  padding: 10px 12px;
  border-radius: var(--hhr-radius-control);
  background: var(--hhr-color-accent-soft);
  color: var(--hhr-color-accent-ink);
  font-size: 14px;
  line-height: 1.65;
}

.auth-submit {
  font-weight: 600;
}

.auth-send {
  flex-shrink: 0;
  width: auto;
  min-height: 44px;
  margin-right: 4px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 400;
}

@media (min-width: 768px) {
  .auth-form {
    gap: 18px;
    margin-top: 28px;
  }
}
</style>
