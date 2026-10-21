<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CompetitionDetail } from "@hehuoda/api-types";
import FormButton from "./FormButton.vue";
import {
  createSourceActions,
  type SourcePorts,
  type SourceResult,
} from "../source/actions";
import { parseSourceUrl, resolveWebViewSource } from "../source/policy";
// #ifdef H5
import SourceLink from "./SourceLink.h5.vue";
import { writeH5Clipboard } from "../source/clipboard-h5";
// #endif
// #ifdef MP-WEIXIN
import { openPage } from "../navigation/navigate";
// #endif

const props = defineProps<{
  notice: Pick<
    CompetitionDetail["notices"][number],
    "id" | "title" | "publisher" | "url"
  >;
  compact?: boolean;
  copyOnly?: boolean;
}>();
const source = computed(() => parseSourceUrl(props.notice.url));
const embeddable = computed(() => resolveWebViewSource(props.notice.url));
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
// #ifdef MP-WEIXIN
ports.writeClipboard = (url) =>
  new Promise<void>((resolve, reject) => {
    uni.setClipboardData({
      data: url,
      success: () => resolve(),
      fail: reject,
    });
  });
ports.openWebView = (url) =>
  new Promise<void>((resolve, reject) => {
    openPage(
      "source-webview",
      { url, title: props.notice.title },
      () => reject(new Error("navigation failed")),
      resolve,
    );
  });
// #endif
const actions = createSourceActions(ports);

async function activate(open = false) {
  if (busy.value) return;
  const current = ++generation;
  const isCurrent = () => generation === current;
  busy.value = true;
  feedback.value = null;
  const url = props.notice.url;
  const result = open
    ? await actions.openWeixin(url, isCurrent)
    : await actions.copy(url);
  if (!isCurrent()) return;
  feedback.value = result;
  busy.value = false;
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
        @click="activate()"
      >
        {{ compact ? "复制链接" : "复制官方链接" }}
      </FormButton>
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <text
        v-if="!compact"
        :selectable="true"
        :user-select="true"
        class="source-url"
        >{{ notice.url }}</text
      >
      <FormButton
        :variant="compact ? 'reveal' : 'secondary'"
        :loading="busy"
        class="source-button"
        @click="activate(!copyOnly)"
      >
        {{ compact ? notice.publisher + "原文 · " : ""
        }}{{ embeddable && !copyOnly ? "查看原文" : "复制官方链接" }}
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
