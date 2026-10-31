<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import { createOperationsService, operationsKey } from "../operations";
import { adminHttp } from "../runtime";
import type { Schema } from "../http";
import { ConsoleError, errorMessage } from "../console/resource";
import { safeSourceUrl } from "../console/review";
import { observeRequest } from "../observe-request";
import ReasonDialog from "./ReasonDialog.vue";
const props = defineProps<{ noticeId: string }>();
const route = useRoute(),
  router = useRouter();
const service =
  inject(operationsKey, null) ?? createOperationsService(adminHttp);
const data = ref<Schema["NoticeAttachmentsDto"] | null>(null),
  history = ref<Schema["AttachmentVersionsDto"] | null>(null);
const text = ref<Schema["AttachmentTextDto"] | null>(null),
  comparison = ref<Schema["AttachmentTextDto"] | null>(null);
const loading = ref(false),
  busy = ref(false),
  stale = ref(false),
  uncertain = ref(false),
  error = ref(""),
  dialog = ref(false);
const request = ref<Schema["IngestionRequestDto"] | null>(null);
const selected = computed(
  () =>
    data.value?.items.find(
      (a) =>
        a.attachmentId === route.query.attachment ||
        a.url === route.query.attachmentUrl,
    ) ?? data.value?.items[0],
);
const number = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
};
const page = computed(() => number(route.query.attachmentPage));
const historyPage = computed(() => number(route.query.attachmentHistoryPage));
const version = computed(() =>
  typeof route.query.attachmentVersion === "string"
    ? route.query.attachmentVersion
    : selected.value?.latestVersion,
);
const compareVersion = computed(() =>
  typeof route.query.compareVersion === "string"
    ? route.query.compareVersion
    : "",
);
const statuses: Record<string, string> = {
  pending: "待获取",
  extracted: "提取完成",
  "needs-review": "需人工核对（扫描件／旧格式等）",
  blocked: "受阻",
  failed: "失败",
  stale: "证据已过期",
  truncated: "超限／截断",
};
let epoch = 0,
  requestEpoch = 0,
  stop = () => {};
function navigate(values: Record<string, string | undefined>) {
  if (busy.value || uncertain.value) return;
  void router.replace({
    path: route.path,
    query: { ...route.query, ...values },
  });
}
async function load() {
  const turn = ++epoch;
  loading.value = true;
  error.value = "";
  text.value = null;
  comparison.value = null;
  history.value = null;
  stale.value = false;
  dialog.value = false;
  try {
    const result = await service.attachments(props.noticeId);
    if (turn !== epoch) return;
    data.value = result;
    if (selected.value) {
      const id = selected.value.attachmentId;
      const [versions, snapshot, old] = await Promise.all([
        service.attachmentVersions(id, historyPage.value),
        version.value
          ? service.attachmentText(id, version.value, page.value)
          : null,
        compareVersion.value
          ? service.attachmentText(id, compareVersion.value, page.value)
          : null,
      ]);
      if (turn !== epoch) return;
      history.value = versions;
      text.value = snapshot;
      comparison.value = old;
      await nextTick();
      if (route.query.segment)
        document
          .getElementById("attachment-segment-" + String(route.query.segment))
          ?.scrollIntoView?.({ block: "center" });
    }
  } catch (cause) {
    if (turn === epoch) error.value = errorMessage(cause);
  } finally {
    if (turn === epoch) loading.value = false;
  }
}
let command: {
  id: string;
  kind: "recheck" | "reparse";
  body: Schema["AttachmentReparseCommandDto"];
} | null = null;
function open(kind: "recheck" | "reparse") {
  if (
    !selected.value ||
    busy.value ||
    uncertain.value ||
    stale.value ||
    loading.value ||
    !data.value ||
    (kind === "reparse" && !text.value)
  )
    return;
  command = {
    id: selected.value.attachmentId,
    kind,
    body: {
      operationId: crypto.randomUUID(),
      reason: "",
      baseline: data.value.evidenceRevision,
      versionId: text.value?.versionId ?? "",
    },
  };
  dialog.value = true;
}
async function queryRequest() {
  const id =
    typeof route.query.attachmentRequest === "string"
      ? route.query.attachmentRequest
      : request.value?.requestId;
  if (!id) return;
  const turn = ++requestEpoch;
  try {
    const result = await service.request(id);
    if (turn !== requestEpoch) return;
    request.value = result;
    if (!["accepted", "running"].includes(result.status)) {
      stop();
      await load();
    }
    return result.status;
  } catch (cause) {
    if (turn === requestEpoch) error.value = errorMessage(cause);
  }
}
async function execute(reason: string) {
  if (!command || busy.value || stale.value || uncertain.value)
    throw new Error("请重新查询附件");
  busy.value = true;
  const turn = epoch;
  command.body.reason = reason;
  try {
    const body = {
      baseline: command.body.baseline,
      operationId: command.body.operationId,
      reason: command.body.reason,
    };
    const result =
      command.kind === "reparse"
        ? await service.reparse(command.id, command.body)
        : await service.recheck(command.id, body);
    if (turn !== epoch) return;
    dialog.value = false;
    busy.value = false;
    await router.replace({
      path: route.path,
      query: { ...route.query, attachmentRequest: result.requestId },
    });
  } catch (cause) {
    if (turn === epoch) {
      if (cause instanceof ConsoleError && cause.status === 409) {
        stale.value = true;
        error.value =
          command.kind === "reparse"
            ? "版本或证据基线已变化；旧字节可能已清理，请先重新获取，再加载核对。"
            : "附件证据基线已变化，请重新加载后核对。";
      } else if (!(cause instanceof ConsoleError && cause.status < 500)) {
        uncertain.value = true;
        error.value =
          "受理结果未知，请按原操作标识查询，不能重复创建操作：" +
          command.body.operationId;
      }
    }
    throw cause;
  } finally {
    if (turn === epoch) busy.value = false;
  }
}
async function recover() {
  if (!command || busy.value) return;
  const turn = epoch;
  busy.value = true;
  try {
    const value = await service.recover(command.body.operationId);
    if (turn !== epoch) return;
    uncertain.value = false;
    busy.value = false;
    dialog.value = false;
    await router.replace({
      path: route.path,
      query: { ...route.query, attachmentRequest: value.requestId },
    });
  } catch (cause) {
    if (turn === epoch)
      error.value =
        cause instanceof ConsoleError && cause.status === 404
          ? "当前未找到受理；请保留原操作标识，由操作审计核对后恢复，勿重复提交。"
          : errorMessage(cause);
  } finally {
    if (turn === epoch) busy.value = false;
  }
}
const leave = () =>
  (!adminHttp.state.session && adminHttp.state.ready) ||
  (!busy.value && !uncertain.value);
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
const unload = (event: BeforeUnloadEvent) => {
  if (busy.value || uncertain.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("beforeunload", unload);
watch(
  () => [
    props.noticeId,
    route.query.attachment,
    route.query.attachmentUrl,
    route.query.attachmentVersion,
    route.query.attachmentPage,
    route.query.attachmentHistoryPage,
    route.query.compareVersion,
  ],
  load,
  { immediate: true },
);
watch(
  () => route.query.attachmentRequest,
  async () => {
    stop();
    ++requestEpoch;
    request.value = null;
    const state = await queryRequest();
    if (state === "accepted" || state === "running")
      stop = observeRequest(queryRequest);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  epoch++;
  requestEpoch++;
  stop();
  window.removeEventListener("beforeunload", unload);
});
</script>
<template>
  <section class="panel console-pad">
    <h2>附件内容版本与追溯</h2>
    <p>
      浏览器只读取服务端已提取的分页文本。PDF 按页、DOCX
      按段落；原始字节清理后仍可读取已保存文字。
    </p>
    <p v-if="loading" role="status">正在加载附件证据…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton :disabled="busy || uncertain" @click="load"
      >重新加载附件</ElButton
    >
    <ElButton v-if="uncertain" :disabled="busy" @click="recover"
      >按原操作标识查询受理</ElButton
    >
    <p v-if="request" role="status">
      附件请求 {{ request.requestId }} ·
      {{ request.status }}（受理完成仍须核对提取状态） {{ request.errorCode
      }}<ElButton @click="queryRequest">查询附件请求</ElButton>
    </p>
    <p v-if="data && !data.items.length && !loading">此通知没有登记附件。</p>
    <template v-if="selected">
      <p>证据修订 {{ data?.evidenceRevision }} · {{ data?.evidenceState }}</p>
      <label
        >附件<select
          aria-label="附件"
          :disabled="busy || uncertain || dialog"
          :value="selected.attachmentId"
          @change="
            navigate({
              attachment: ($event.target as HTMLSelectElement).value,
              attachmentUrl: undefined,
              attachmentVersion: undefined,
              compareVersion: undefined,
              attachmentPage: '1',
              attachmentHistoryPage: '1',
              segment: undefined,
            })
          "
        >
          <option
            v-for="item in data?.items"
            :key="item.attachmentId"
            :value="item.attachmentId"
          >
            {{ item.url }} · {{ statuses[item.state] ?? item.state }}
          </option>
        </select></label
      >
      <p class="notice-text">
        {{ selected.url }} · {{ statuses[selected.state] ?? selected.state }} ·
        {{ selected.errorCode ?? "无错误代码" }} · 检查
        {{ selected.lastCheckedAt ?? "尚未检查" }}
      </p>
      <a
        v-if="safeSourceUrl(selected.url)"
        :href="safeSourceUrl(selected.url)!"
        target="_blank"
        rel="noopener noreferrer"
        >官方附件链接</a
      >
      <div class="review-fields">
        <label
          >内容版本<select
            aria-label="附件版本"
            :disabled="busy || uncertain || dialog"
            :value="version"
            @change="
              navigate({
                attachmentVersion: ($event.target as HTMLSelectElement).value,
                attachmentPage: '1',
                segment: undefined,
              })
            "
          >
            <option
              v-if="
                version && !history?.items.some((v) => v.versionId === version)
              "
              :value="version"
            >
              指定版本 {{ version }}
            </option>
            <option
              v-for="item in history?.items"
              :key="item.versionId"
              :value="item.versionId"
            >
              第 {{ item.revision }} 版 · {{ item.fetchedAt }} ·
              {{ item.status }}
            </option>
          </select></label
        >
        <label
          >比较版本<select
            :disabled="busy || uncertain || dialog"
            :value="compareVersion"
            @change="
              navigate({
                compareVersion:
                  ($event.target as HTMLSelectElement).value || undefined,
              })
            "
          >
            <option value="">不比较</option>
            <option
              v-for="item in history?.items"
              :key="item.versionId"
              :value="item.versionId"
            >
              第 {{ item.revision }} 版 · {{ item.versionId }}
            </option>
          </select></label
        >
      </div>
      <ElPagination
        :current-page="historyPage"
        :total="history?.total ?? 0"
        :page-size="10"
        layout="prev, pager, next"
        :disabled="busy || uncertain"
        @current-change="navigate({ attachmentHistoryPage: String($event) })"
      />
      <template v-if="text">
        <p>
          内容版本 {{ text.versionId }} · 关联正文 {{ text.noticeVersion }} ·
          提取器 {{ text.extractorVersion }} · {{ text.fetchedAt }} ·
          {{ text.status }} · {{ text.errorCode }}
        </p>
        <div class="document-columns">
          <div>
            <h3>选定内容版本</h3>
            <article
              v-for="segment in text.segments"
              :id="'attachment-segment-' + segment.index"
              :key="segment.index"
              :tabindex="-1"
            >
              <h4>
                {{ segment.kind === "page" ? "PDF 第" : "DOCX 第" }}
                {{ segment.index }} {{ segment.kind === "page" ? "页" : "段" }}
              </h4>
              <pre class="notice-text">{{ segment.text }}</pre>
              <p v-if="segment.truncated">
                本段文字超限已截断，需人工核对原附件。
              </p>
            </article>
            <p v-if="!text.segments.length">
              无可提取文字，请按状态核对扫描件、旧 DOC、超限或受阻原因。
            </p>
          </div>
          <div v-if="comparison">
            <h3>比较内容版本 {{ comparison.versionId }}</h3>
            <article
              v-for="segment in comparison.segments"
              :key="segment.index"
            >
              <h4>{{ segment.kind }} {{ segment.index }}</h4>
              <pre class="notice-text">{{ segment.text }}</pre>
            </article>
          </div>
        </div>
        <ElPagination
          :current-page="page"
          :total="Math.max(text.totalSegments, comparison?.totalSegments ?? 0)"
          :page-size="10"
          layout="prev, pager, next"
          :disabled="busy || uncertain"
          @current-change="
            navigate({ attachmentPage: String($event), segment: undefined })
          "
        />
      </template>
      <div class="console-actions">
        <ElButton
          :disabled="
            busy ||
            stale ||
            uncertain ||
            loading ||
            (!!request && ['accepted', 'running'].includes(request.status))
          "
          @click="open('recheck')"
          >重新获取附件</ElButton
        ><ElButton
          :disabled="
            busy ||
            stale ||
            uncertain ||
            loading ||
            !text ||
            (!!request && ['accepted', 'running'].includes(request.status))
          "
          @click="open('reparse')"
          >重新解析此版本</ElButton
        >
      </div>
    </template>
    <ReasonDialog
      v-model="dialog"
      title="附件操作"
      :blocked="stale || uncertain"
      :execute="execute"
    />
  </section>
</template>
<style scoped>
select {
  max-width: 100%;
}
</style>
