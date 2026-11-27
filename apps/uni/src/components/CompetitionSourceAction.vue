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
const busy = ref(false);
let generation = 0;
function reset() {
  generation += 1;
  feedback.value = null;
  busy.value = false;
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
  busy.value = true;
  feedback.value = null;
  const result = await actions.copy(props.notice.url);
  if (generation !== current) return;
  feedback.value = result;
  busy.value = false;
}

/** 非 H5（Android）保留来源直达页作为可执行入口，参数仍由承载页重新校验。 */
function openSourcePage() {
  const target = source.value;
  if (!target) return;
  openPage(
    "source-webview",
    { url: target.url, title: props.notice.title },
    () => {
      feedback.value = {
        status: "manual",
        message: "暂时无法打开原文页面，请先复制链接到浏览器核对。",
        url: target.url,
      };
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
        :loading="busy"
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
