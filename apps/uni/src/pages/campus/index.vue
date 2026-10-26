<script setup lang="ts">
import FormButton from "../../components/FormButton.vue";
import { openTab } from "../../navigation/navigate";
// #ifdef MP-WEIXIN
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { onLoad, onUnload } from "@dcloudio/uni-app";
import CampusVerificationPanel from "../../components/CampusVerificationPanel.vue";
import { createCampusApi } from "../../api/campus-client";
import { authedHttp } from "../../api/client";
import {
  createCampusController,
  initialCampusState,
} from "../../campus/controller";
import { useAuthStore } from "../../stores/auth";
import { useAppLifecycleStore } from "../../stores/app-lifecycle";
import { useSessionStore } from "../../stores/session";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import { campusReturnTarget } from "../../navigation/campus-return";
import { openPage, replacePage } from "../../navigation/navigate";

const auth = useAuthStore();
const app = useAppLifecycleStore();
const business = useSessionStore();
const state = reactive(initialCampusState());
const controller = createCampusController(
  state,
  createCampusApi(authedHttp),
  () => auth.generation,
);
const returnTarget = ref<ReturnType<typeof campusReturnTarget>>(null);
const authenticated = computed(() => auth.authenticated);
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
let visible = false;
onLoad((query) => {
  returnTarget.value = campusReturnTarget(query ?? {});
});
function stopTimer() {
  if (timer !== undefined) globalThis.clearInterval(timer);
  timer = undefined;
}
function show() {
  visible = true;
  if (!auth.authenticated) return;
  void controller.show();
  stopTimer();
  timer = globalThis.setInterval(() => {
    if (state.transaction?.status === "processing") void controller.query();
  }, 2000);
}
function hide() {
  visible = false;
  stopTimer();
  controller.hide(false);
  // 应用后台和页面隐藏可能同轮发生；立即清密，等本轮应用状态落定再区分离页。
  void Promise.resolve().then(() => {
    if (!visible && app.foreground) controller.hide(true);
  });
}
function dispose() {
  visible = false;
  stopTimer();
  controller.hide(true);
}
usePageLifecycle({ show, hide });
onUnload(dispose);
onScopeDispose(dispose);
watch(
  () => auth.generation,
  () => {
    stopTimer();
    controller.reset();
  },
  { flush: "sync" },
);
watch(authenticated, (value) => {
  if (value && visible && app.foreground) show();
});
watch(
  () => state.transaction?.status,
  (status) => {
    if (status === "succeeded") void auth.reloadProfile();
  },
);
function retry() {
  if (state.pending) return;
  void controller.reload();
}
function finish() {
  dispose();
  const target = returnTarget.value;
  if (target?.name === "team-new") {
    replacePage("team-new");
    return;
  }
  if (
    target?.name === "team-detail" &&
    business.teams.some((team) => team.id === target.id)
  ) {
    replacePage("team-detail", { id: target.id });
    return;
  }
  openTab("profile");
}
// #endif
</script>

<template>
  <view class="campus-page">
    <!-- #ifdef MP-WEIXIN -->
    <CampusVerificationPanel
      v-if="authenticated"
      :state="state"
      @restart="controller.restart"
      @reload="retry"
      @refresh="controller.refresh"
      @submit="controller.submit"
      @query="controller.query"
      @cancel="controller.cancel"
      @back="finish"
      @consent="state.consented = $event"
      @name="controller.edit('name', $event)"
      @account="controller.edit('account', $event)"
      @password="controller.edit('password', $event)"
      @captcha="controller.edit('captcha', $event)"
      @image-error="controller.imageError"
    />
    <view v-else class="campus-unavailable">
      <text class="block">请先微信登录，再进行统一身份认证。</text>
      <FormButton
        @click="openPage('login', { returnTo: 'campus-verification' })"
        >前往微信登录</FormButton
      >
      <FormButton variant="soft" @click="openTab('profile')"
        >返回个人中心</FormButton
      >
    </view>
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <view class="campus-unavailable">
      <text class="block"
        >统一身份认证仅在微信小程序提供，当前可继续浏览公开内容。</text
      >
      <FormButton variant="secondary" @click="openTab('profile')"
        >返回个人中心</FormButton
      >
    </view>
    <!-- #endif -->
  </view>
</template>
<style scoped>
.campus-page {
  min-height: 100vh;
  background: var(--hhr-color-page);
}
.campus-unavailable {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 600px;
  margin: 0 auto;
  padding: 32px 20px calc(32px + env(safe-area-inset-bottom));
  font-size: 16px;
  color: var(--hhr-color-ink);
  line-height: 1.7;
}
</style>
