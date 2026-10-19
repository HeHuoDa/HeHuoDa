<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import FormButton from "./FormButton.vue";
import { routePath, tabRoutes } from "../navigation/routes";
// #ifdef H5
import { attachH5Dialog } from "../forms/dialog-h5";
// #endif
const props = withDefaults(
  defineProps<{
    id: string;
    open: boolean;
    title: string;
    saving?: boolean;
    saveLabel?: string;
    errorTarget?: string;
  }>(),
  { saveLabel: "保存", errorTarget: "" },
);
const emit = defineEmits<{ cancel: []; save: [] }>();
const root = ref();
const height = ref(0);
const top = ref(0);
const scrollTarget = ref("");
let dispose = () => {};
let generation = 0;
function cancel() {
  if (!props.saving) emit("cancel");
}
function stop() {
  generation++;
  dispose();
  dispose = () => {};
}
watch(
  () => props.errorTarget,
  async (target) => {
    scrollTarget.value = "";
    await nextTick();
    scrollTarget.value = target ?? "";
  },
);
watch(
  () => props.open,
  async (open) => {
    stop();
    if (!open) return;
    const current = generation;
    await nextTick();
    if (generation !== current || !props.open) return;
    // #ifdef H5
    dispose = attachH5Dialog(root.value, cancel, (value, offset) => {
      height.value = value;
      top.value = offset;
    });
    // #endif
    // #ifdef MP-WEIXIN
    const windowHeight = uni.getWindowInfo().windowHeight;
    height.value = windowHeight;
    const keyboard = (event: { height: number }) => {
      height.value = Math.max(0, windowHeight - event.height);
    };
    uni.onKeyboardHeightChange(keyboard);
    // 原生 tabBar 在页面视图之外，弹层打开期间隐藏，关闭后恢复。
    const route = getCurrentPages().at(-1)?.route;
    const tab = tabRoutes.some(({ name }) => routePath(name) === `/${route}`);
    if (tab) uni.hideTabBar({ animation: false });
    dispose = () => {
      uni.offKeyboardHeightChange(keyboard);
      if (tab) uni.showTabBar({ animation: false });
    };
    // #endif
  },
  { immediate: true },
);
// 微信原生返回无法拦截。页面隐藏/卸载即丢弃，由父层处理草稿；不伪造 onBackPress。
function leave() {
  stop();
  if (props.open) emit("cancel");
}
onPageHide(leave);
onUnload(leave);
onBeforeUnmount(stop);
</script>

<template>
  <view
    v-if="open"
    ref="root"
    class="hhr-dialog-overlay"
    :style="height ? { height: `${height}px`, top: `${top}px` } : undefined"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="`${id}-title`"
    tabindex="-1"
  >
    <view class="hhr-dialog-backdrop" @touchmove.stop.prevent @click.stop />
    <view class="hhr-dialog-panel" @click.stop @touchmove.stop>
      <view class="hhr-dialog-heading">
        <text
          :id="`${id}-title`"
          class="font-serif text-[20px] leading-[28px]"
          >{{ title }}</text
        >
      </view>
      <scroll-view
        scroll-y
        class="hhr-dialog-body"
        :scroll-into-view="scrollTarget"
        :scroll-with-animation="false"
      >
        <view class="hhr-dialog-content"><slot /></view>
      </scroll-view>
      <view class="hhr-dialog-actions">
        <FormButton :loading="saving" @click="emit('save')">{{
          saving ? "保存中…" : saveLabel
        }}</FormButton>
        <FormButton variant="secondary" :disabled="saving" @click="cancel"
          >取消并关闭</FormButton
        >
      </view>
    </view>
  </view>
</template>
