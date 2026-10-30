<script setup lang="ts">
import { inject, ref } from "vue";
import {
  adminServicesKey,
  unavailableServices,
  ServiceUnavailable,
} from "../services";
import { ShieldCheck, ArrowLeft } from "@lucide/vue";
import { useRoute, useRouter } from "vue-router";
import { safeReturn } from "../http";
const router = useRouter(),
  route = useRoute();
const account = ref("");
const password = ref("");
const passwordVisible = ref(false);
const error = ref("");
const submitting = ref(false);
const services = inject(adminServicesKey, unavailableServices);
async function submit() {
  if (submitting.value) return;
  if (!account.value.trim() || !password.value) {
    error.value = "请填写管理员账号和密码";
    return;
  }
  submitting.value = true;
  error.value = "";
  try {
    await services.login(account.value.trim(), password.value);
    await router?.replace(safeReturn(route?.query.returnTo));
  } catch (cause) {
    error.value =
      cause instanceof ServiceUnavailable
        ? cause.message
        : "登录请求失败，请稍后重试。";
  } finally {
    password.value = "";
    passwordVisible.value = false;
    submitting.value = false;
  }
}
</script>
<template>
  <div class="login-page">
    <div class="login-panel">
      <span class="login-icon"><ShieldCheck :size="31" /></span>
      <h1>管理员登录</h1>
      <p>管理禾伙搭的比赛与内容。</p>
      <ElAlert
        title="仅受控管理员账号可以登录；学生登录不能访问管理数据。"
        type="info"
        :closable="false"
      />
      <form
        class="editor-form"
        :aria-busy="submitting"
        @submit.prevent="submit"
      >
        <p v-if="route?.query.error === 'session-unavailable'" role="alert">
          会话服务暂时不可用，请稍后重试登录。
        </p>
        <label for="admin-account">管理员账号</label
        ><ElInput
          id="admin-account"
          v-model="account"
          placeholder="输入管理员账号"
          autocomplete="username"
          :disabled="submitting"
        /><label for="admin-password">密码</label
        ><ElInput
          id="admin-password"
          v-model="password"
          :type="passwordVisible ? 'text' : 'password'"
          placeholder="输入密码"
          autocomplete="current-password"
          :disabled="submitting"
          ><template #suffix
            ><button
              type="button"
              class="text-button"
              :disabled="submitting"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              :aria-pressed="passwordVisible"
              aria-controls="admin-password"
              @click="passwordVisible = !passwordVisible"
            >
              {{ passwordVisible ? "隐藏" : "显示" }}
            </button></template
          ></ElInput
        >
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <ElButton
          type="primary"
          size="large"
          native-type="submit"
          :loading="submitting"
          :disabled="submitting"
          >登录</ElButton
        >
      </form>
      <RouterLink to="/" class="inline-link"
        ><ArrowLeft :size="15" />返回页面预览</RouterLink
      >
    </div>
  </div>
</template>
