<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import FormButton from "./FormButton.vue";
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
const height = ref<number>();
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
    // 浏览器特有焦点/键盘/viewport 能力全部集中在 H5 适配器。
    dispose = attachH5Dialog(root.value, cancel, (value, offset) => {
      height.value = value;
      top.value = offset;
    });
    // #endif
    // #ifdef APP-PLUS
    // Android 原生层没有 DOM 适配器：用当前窗口高度作最小可用的尺寸基准。
    // 底部安全区由样式中的 env(safe-area-inset-bottom, 0px) 默认承担，这里不读取安全区。
    // 软键盘遮挡、返回键与真机安全区的真实行为归 #220/#226 验收。
    const update = () => {
      if (generation !== current) return;
      const info = uni.getWindowInfo();
      height.value = Math.max(0, info.windowHeight);
    };
    uni.onWindowResize(update);
    update();
    dispose = () => {
      uni.offWindowResize(update);
    };
    // #endif
  },
  { immediate: true },
);
// 原生返回无法拦截。页面隐藏/卸载即丢弃，由父层处理草稿；不伪造 onBackPress。
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
    :style="{
      height: height === undefined ? undefined : `${height}px`,
      top: `${top}px`,
    }"
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
