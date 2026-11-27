<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CompetitionDetail } from "@hehuoda/api-types";
import FormButton from "./FormButton.vue";
import {
  createSourceActions,
  type SourcePorts,
  type SourceResult,
} from "../source/actions";
import { resolvePublicSourceUrl } from "../source/policy";
// #ifdef H5
import SourceLink from "./SourceLink.h5.vue";
import { writeH5Clipboard } from "../source/clipboard-h5";
// #endif
// #ifndef H5
import { openPage } from "../navigation/navigate";
// #endif

const props = defineProps<{
  notice: Pick<
    CompetitionDetail["notices"][number],
    "id" | "title" | "publisher" | "url"
  >;
  compact?: boolean;
  /** 来源直达页自身只提供复制，不再向下一个承载页跳转。 */
  copyOnly?: boolean;
}>();
// 现行交付端（H5 与 Android）都按 ADR 0011 接受公开 HTTPS 外链。
const acceptSource = resolvePublicSourceUrl;
const source = computed(() => acceptSource(props.notice.url));
const feedback = ref<SourceResult | null>(null);
/** 剪贴板动作在途；驱动复制按钮 loading 并阻止重复复制。 */
const busy = ref(false);
/** 来源直达页导航在途；与剪贴板分开，导航未决时复制仍然可用。 */
const opening = ref(false);
/** 反馈归属代次：只决定结果能否写进 `feedback`，不再控制任何在途状态复位。 */
let generation = 0;
/** 复制动作 token：只有本次复制仍是最新时才有权复位 `busy`。 */
let copyToken = 0;
/** 导航动作 token：只有本次导航仍是最新时才有权复位 `opening`。 */
let openToken = 0;
function reset() {
  generation += 1;
  copyToken += 1;
  openToken += 1;
  feedback.value = null;
  busy.value = false;
  opening.value = false;
}
watch(() => [props.notice.id, props.notice.url], reset, { flush: "sync" });
onBeforeUnmount(reset);

const ports: SourcePorts = {};
// #ifdef H5
ports.writeClipboard = writeH5Clipboard;
// #endif
// #ifndef H5
// App-Plus 走 uni 通用剪贴板 API（非平台专有接口）；失败仍转为可取选地址的手动路径。
ports.writeClipboard = (url) =>
  new Promise<void>((resolve, reject) => {
    uni.setClipboardData({
      data: url,
      success: () => resolve(),
      fail: reject,
    });
  });
// #endif
const actions = createSourceActions(ports, acceptSource);

/**
 * 复制当前 Notice 的官方链接。
 * 小程序内嵌承载已按 ADR 0011 退役，这里不再发起 web-view 导航；
 * Android 的系统浏览器打开由 #226 在真机侧实测。
 */
async function copySource() {
  if (busy.value) return;
  const current = ++generation;
  const token = ++copyToken;
  busy.value = true;
  feedback.value = null;
  const result = await actions.copy(props.notice.url);
  // 在途复位只看复制 token：期间即使被导航占用反馈代次，按钮也必须恢复可点。
  if (token === copyToken) busy.value = false;
  if (generation !== current) return;
  feedback.value = result;
}

/**
 * 非 H5（Android）保留来源直达页作为可执行入口，参数仍由承载页重新校验。
 * 与 `copySource` 一样按代次归属反馈：导航回调可能在复制成功或 Notice 切换之后才交付，
 * 无代次校验会把旧失败覆盖新结果，或把旧地址挂到新 Notice 下显示。
 * 在途复位另按 `openToken` 判定：旧导航迟到不得清掉新导航的 `opening`。
 */
function openSourcePage() {
  if (opening.value) return;
  const target = source.value;
  if (!target) return;
  const current = ++generation;
  const token = ++openToken;
  opening.value = true;
  feedback.value = null;
  openPage(
    "source-webview",
    { url: target.url, title: props.notice.title },
    () => {
      if (token === openToken) opening.value = false;
      if (generation !== current) return;
      feedback.value = {
        status: "manual",
        message: "暂时无法打开原文页面，请先复制链接到浏览器核对。",
        url: target.url,
      };
    },
    // 导航成功后组件仍在页面栈内，用户返回时不会走 onBeforeUnmount，必须显式复位。
    // 成功回调同样校验 token，避免旧导航的迟到成功清掉新导航的在途状态。
    () => {
      if (token === openToken) opening.value = false;
    },
  );
}
</script>

<template>
  <view class="source-action" @click.stop>
    <template v-if="source">
      <!-- #ifdef H5 -->
      <SourceLink
        :href="source.url"
        :title="notice.title"
        class="source-link"
        :class="{ 'source-publisher': compact }"
      >
        {{
          compact
            ? notice.publisher + "原文（新窗口）"
            : notice.url + "（新窗口）"
        }}
      </SourceLink>
      <FormButton
        :variant="compact ? 'reveal' : 'secondary'"
        :loading="busy"
        class="source-button"
        @click="copySource"
      >
        {{ compact ? "复制链接" : "复制官方链接" }}
      </FormButton>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <text
        v-if="!compact"
        :selectable="true"
        :user-select="true"
        class="source-url"
        >{{ notice.url }}</text
      >
      <FormButton
        v-if="!copyOnly"
        :variant="compact ? 'reveal' : 'secondary'"
        :loading="opening"
        class="source-button"
        @click="openSourcePage"
      >
        {{ compact ? notice.publisher + "原文" : "查看官方原文" }}
      </FormButton>
      <FormButton
        variant="secondary"
        :loading="busy"
        class="source-button"
        @click="copySource"
      >
        {{ compact ? "复制链接" : "复制官方链接" }}
      </FormButton>
      <!-- #endif -->
    </template>
    <text v-else class="source-feedback">来源地址无效，无法打开或复制。</text>
    <view
      v-if="feedback"
      class="source-feedback"
      role="status"
      aria-live="polite"
    >
      <text>{{ feedback.message }}</text>
      <text
        v-if="feedback.url && (compact || feedback.status === 'manual')"
        :selectable="true"
        :user-select="true"
        class="source-url"
        >{{ feedback.url }}</text
      >
    </view>
  </view>
</template>

<style scoped>
.source-action {
  min-width: 0;
}
.source-link,
.source-url,
.source-feedback {
  display: block;
  color: var(--hhr-color-brand);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.source-link {
  display: flex;
  box-sizing: border-box;
  min-height: 44px;
  align-items: center;
  padding: 8px 0;
  text-decoration: underline;
}
.source-publisher {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding: 0;
}
.source-link:not(.source-publisher) {
  margin-top: 8px;
}
.source-url {
  padding: 8px 0;
  user-select: text;
}
.source-button {
  display: inline-flex;
  width: auto;
  max-width: 100%;
  margin-top: 4px;
  font-size: 13px;
  white-space: normal;
}
.source-feedback {
  margin-top: 0.5rem;
}
.source-button.hhr-button--secondary {
  padding: 10px 18px;
}
</style>
