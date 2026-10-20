<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  ref,
  toRaw,
  watch,
} from "vue";
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  ingestionControlKey,
  fixedSources,
  settingFields,
  validateSettings,
  validateScan,
  exampleControl,
  unavailableControl,
  runStates,
  availabilityLabels,
  canResume,
  type SourceConfig,
  type IngestionRun,
  type ScanInput,
  type AcceptedRequest,
} from "../console/ingestion-control";
import {
  createResourceController,
  ConsoleError,
  errorMessage,
  type PageQuery,
} from "../console/resource";
import { readQuery } from "../console/query";
import ReasonDialog from "../components/ReasonDialog.vue";
import ResourceList from "../components/ResourceList.vue";
const route = useRoute(),
  router = useRouter();
const isSources = computed(() => route.path === "/ingestion/sources"),
  example = computed(() => route.query.preview === "1");
const injected = inject(ingestionControlKey, null),
  service = computed(
    () => injected ?? (example.value ? exampleControl : unavailableControl),
  );
const query = computed(() => readQuery(route.query, runStates));
const sourceFilter = computed(() =>
  fixedSources.some((s) => s.id === route.query.source)
    ? String(route.query.source)
    : "",
);
const sources = ref<SourceConfig[]>([]),
  config = ref<SourceConfig | null>(null),
  initial = ref(""),
  sourceStatus = ref("idle"),
  sourceError = ref("");
const controller = createResourceController<IngestionRun>(),
  state = controller.state;
function initialScan(): ScanInput {
  const to = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - 89 * 86400000)
    .toISOString()
    .slice(0, 10);
  return { sourceId: fixedSources[0].id, from, to, url: "", preview: true };
}
const scan = ref<ScanInput>(initialScan()),
  scanInitial = ref(JSON.stringify(scan.value));
const dirty = computed(
  () =>
    (!!config.value && JSON.stringify(config.value) !== initial.value) ||
    JSON.stringify(scan.value) !== scanInitial.value,
);
const busy = ref(false),
  stale = ref(false),
  error = ref(""),
  dialog = ref(false),
  action = ref<"configure" | "scan" | "resume">("scan"),
  accepted = ref<AcceptedRequest | null>(null),
  requestBusy = ref(false);
let epoch = 0,
  requestEpoch = 0,
  operationId = "";
const actionLabel = computed(
  () =>
    ({
      configure: "保存来源配置",
      scan: scan.value.preview ? "请求扫描预览" : "请求手动扫描",
      resume: "续跑原范围",
    })[action.value],
);
const currentSource = computed(() =>
  sources.value.find((s) => s.id === scan.value.sourceId),
);
const scanBlocked = computed(
  () =>
    !!currentSource.value &&
    (!currentSource.value.enabled ||
      ["running", "locked", "disabled"].includes(
        currentSource.value.availability,
      )),
);
const statusText = computed(() =>
  accepted.value
    ? {
        accepted: "仅已受理，尚未确认扫描完成",
        running: "请求执行中，请查询运行记录",
        completed: "请求处理已结束，请核对运行/预览结果",
        failed: "请求失败，请核对错误后重新提交",
      }[accepted.value.state]
    : "",
);
function link(path: string) {
  return { path, query: example.value ? { preview: "1" } : {} };
}
async function load() {
  const current = ++epoch;
  ++requestEpoch;
  busy.value = false;
  requestBusy.value = false;
  dialog.value = false;
  stale.value = false;
  error.value = "";
  accepted.value = null;
  config.value = null;
  initial.value = "";
  scan.value = initialScan();
  scanInitial.value = JSON.stringify(scan.value);
  if (isSources.value) {
    sourceStatus.value = "loading";
    sourceError.value = "";
    sources.value = [];
    try {
      const result = await service.value.sources();
      if (current === epoch) {
        sources.value = result;
        sourceStatus.value = "ready";
        if (result[0]) {
          config.value = structuredClone(result[0]);
          initial.value = JSON.stringify(config.value);
        }
      }
    } catch (cause) {
      if (current === epoch) {
        sourceStatus.value = "error";
        sourceError.value = errorMessage(cause);
      }
    }
  } else if (route.params.id)
    await controller.select(() => service.value.run(String(route.params.id)));
  else
    await controller.load(() =>
      service.value.runs(query.value, sourceFilter.value),
    );
}
async function leave() {
  if (busy.value) return false;
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm(
      "来源配置或扫描范围尚未保存/提交。",
      "未保存采集配置",
      {
        confirmButtonText: "丢弃并离开",
        cancelButtonText: "继续编辑",
        type: "warning",
      },
    );
    return true;
  } catch {
    return false;
  }
}
async function chooseSource(id: string) {
  if (config.value?.id === id) return;
  if (!(await leave())) return;
  const found = sources.value.find((s) => s.id === id);
  config.value = found ? structuredClone(toRaw(found)) : null;
  initial.value = JSON.stringify(config.value);
  stale.value = false;
  error.value = "";
}
async function open(kind: typeof action.value) {
  if (busy.value || stale.value) return;
  error.value = "";
  if (kind === "configure" && config.value) {
    error.value = validateSettings(config.value.settings) ?? "";
    if (error.value) {
      await nextTick();
      document.getElementById("source-settings")?.focus();
      return;
    }
  }
  if (kind === "scan") {
    error.value = validateScan(scan.value) ?? "";
    if (scanBlocked.value)
      error.value = "来源停用、执行中或被锁占用，请重新查询来源状态。";
    if (error.value) {
      await nextTick();
      document.getElementById("scan-range")?.focus();
      return;
    }
  }
  if (kind === "resume" && (!state.detail || !canResume(state.detail))) return;
  action.value = kind;
  operationId = crypto.randomUUID();
  dialog.value = true;
}
async function execute(reason: string) {
  if (busy.value || stale.value) throw new Error("请重新加载");
  const current = epoch;
  busy.value = true;
  error.value = "";
  try {
    if (action.value === "configure" && config.value) {
      const issue = validateSettings(config.value.settings);
      if (issue) throw new Error(issue);
      await service.value.configure(config.value.id, {
        enabled: config.value.enabled,
        settings: structuredClone(toRaw(config.value.settings)),
        baseline: config.value.baseline,
        reason,
        operationId,
      });
      if (current === epoch) {
        initial.value = JSON.stringify(config.value);
        await load();
      }
    } else {
      let result: AcceptedRequest;
      if (action.value === "scan") {
        const issue = validateScan(scan.value);
        if (issue || scanBlocked.value)
          throw new Error(issue ?? "来源不可执行");
        result = await service.value.scan({
          ...toRaw(scan.value),
          reason,
          operationId,
        });
      } else {
        if (!state.detail || !canResume(state.detail))
          throw new Error("当前运行不可续跑");
        result = await service.value.resume(state.detail.id, {
          reason,
          operationId,
        });
      }
      if (current === epoch) {
        accepted.value = result;
        scanInitial.value = JSON.stringify(scan.value);
        dialog.value = false;
      }
    }
  } catch (cause) {
    if (
      current === epoch &&
      cause instanceof ConsoleError &&
      cause.status === 409
    ) {
      stale.value = true;
      error.value =
        "配置基线过期或运行被锁占用，输入已保留；请重新查询状态后再确认，不能覆盖。";
    }
    throw cause;
  } finally {
    if (current === epoch) busy.value = false;
  }
}
async function queryRequest() {
  if (!accepted.value || requestBusy.value) return;
  const current = ++requestEpoch,
    id = accepted.value.requestId;
  requestBusy.value = true;
  error.value = "";
  try {
    const value = await service.value.request(id);
    if (current === requestEpoch && accepted.value?.requestId === id)
      accepted.value = value;
  } catch (cause) {
    if (current === requestEpoch) error.value = errorMessage(cause);
  } finally {
    if (current === requestEpoch) requestBusy.value = false;
  }
}
function changeQuery(value: PageQuery) {
  router.push({
    path: "/ingestion/runs",
    query: {
      ...value,
      ...(sourceFilter.value ? { source: sourceFilter.value } : {}),
      ...(example.value ? { preview: "1" } : {}),
    },
  });
}
function setFilter(value: string) {
  router.push({
    path: "/ingestion/runs",
    query: { ...route.query, source: value || undefined, page: "1" },
  });
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  ++epoch;
  ++requestEpoch;
  window.removeEventListener("beforeunload", beforeUnload);
});
watch(() => route.fullPath, load, { immediate: true });
</script>
<template>
  <div class="console-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">INGESTION OPERATIONS</span>
        <h1>{{ isSources ? "采集来源与扫描" : "采集运行记录" }}</h1>
        <p>
          固定来源、有限预算、可追溯的运行范围。采集仅产生候选，发布另行审核。
        </p>
      </div>
    </div>
    <div class="console-actions">
      <RouterLink :to="link('/ingestion/sources')">来源配置与扫描</RouterLink
      ><RouterLink :to="link('/ingestion/runs')">运行列表</RouterLink
      ><ElButton
        @click="
          router.push({
            path: route.path,
            query: { preview: example ? undefined : '1' },
          })
        "
        >{{ example ? "返回真实服务查询" : "查看独立采集示例" }}</ElButton
      >
    </div>
    <p v-if="example" class="notice-strip">
      独立页面示例 · 配置、运行、计数与错误均为演示，不代表实际抓取结果。
    </p>
    <p v-if="error" role="alert" class="form-error">{{ error }}</p>
    <p v-if="stale" role="alert">
      本轮确认已锁定，请记录输入并重新查询。<ElButton @click="load"
        >重新查询状态</ElButton
      >
    </p>
    <section v-if="accepted" class="panel console-pad" aria-live="polite">
      <h2>{{ statusText }}</h2>
      <p>请求 {{ accepted.requestId }} · {{ accepted.message }}</p>
      <p>受理与采集运行状态分开；预览请求不表示已保存采集业务记录。</p>
      <ElButton :loading="requestBusy" @click="queryRequest"
        >查询请求状态</ElButton
      ><RouterLink
        v-if="accepted.runId"
        :to="link('/ingestion/runs/' + accepted.runId)"
        >查看关联运行</RouterLink
      >
    </section>
    <template v-if="isSources">
      <section class="panel console-pad">
        <h2>已实现的固定来源</h2>
        <p class="field-help">
          每天北京时间 09:00、18:00 调度。frequency 仅表示最小调度间隔，不编辑
          cron。来源停用将在下一次请求前停止，不杀进程。
        </p>
        <p v-if="sourceStatus === 'loading'" role="status">正在加载来源配置…</p>
        <p v-if="sourceError" role="alert">
          {{ sourceError }} <ElButton @click="load">重新加载来源</ElButton>
        </p>
        <p v-if="sourceStatus === 'ready' && !sources.length">
          来源列表为空，请核对服务配置。
        </p>
        <div
          v-for="source in fixedSources"
          :key="source.id"
          class="stage-editor"
        >
          <h3>{{ source.publisher }}</h3>
          <p class="field-help">{{ source.id }} · {{ source.listUrl }}</p>
          <template
            v-for="row in sources.filter((s) => s.id === source.id)"
            :key="row.id"
            ><p>
              {{ row.enabled ? "已启用" : "已停用" }} ·
              {{ availabilityLabels[row.availability] }}
            </p>
            <ElButton :disabled="busy" @click="chooseSource(row.id)"
              >配置{{ source.publisher }}</ElButton
            ><RouterLink
              v-if="row.lastRunId"
              :to="link('/ingestion/runs/' + row.lastRunId)"
              >最近运行</RouterLink
            ></template
          >
        </div>
      </section>
      <section v-if="config" class="panel console-pad">
        <h2>{{ config.title }} · 来源配置</h2>
        <p class="field-help">
          基线 {{ config.baseline }}；来源适配器与 URL 固定，不能新增任意网站。
        </p>
        <fieldset
          id="source-settings"
          class="review-form"
          tabindex="-1"
          :disabled="busy || stale"
        >
          <legend>启停与预算</legend>
          <label class="preview-ack"
            ><input
              v-model="config.enabled"
              type="checkbox"
            />启用来源（停用将在下一次请求前停止）</label
          >
          <div class="review-fields">
            <label v-for="field in settingFields" :key="field.key"
              >{{ field.label
              }}<input
                v-model.number="config.settings[field.key]"
                type="number"
                :min="field.min"
                :max="field.max"
                :aria-label="field.label"
              /><small>{{ field.min }}–{{ field.max }}</small></label
            >
          </div>
        </fieldset>
        <p v-if="JSON.stringify(config) !== initial" class="field-help">
          有未保存配置，页面不会自动保存。
        </p>
        <ElButton :disabled="busy || stale" @click="open('configure')"
          >确认保存配置</ElButton
        >
      </section>
      <section class="panel console-pad">
        <h2>手动扫描</h2>
        <p class="field-help">
          只向服务提交请求；页面不会抓取官网或调用命令行。扫描预览不写入候选、正式比赛或采集运行，执行请求元数据由后端单独管理。前端
          URL 检查不能替代服务端 SSRF 防护。
        </p>
        <fieldset
          id="scan-range"
          class="review-form"
          tabindex="-1"
          :disabled="busy || stale"
        >
          <legend>本次范围（北京时间日期）</legend>
          <div class="review-fields">
            <label
              >扫描来源<select v-model="scan.sourceId">
                <option
                  v-for="source in fixedSources"
                  :key="source.id"
                  :value="source.id"
                >
                  {{ source.publisher }}
                </option>
              </select></label
            ><label
              >单通知 URL（可选）<input
                v-model="scan.url"
                aria-label="单通知 URL"
                placeholder="仅所选来源 HTTPS 同源"
            /></label>
            <label>开始日期<input v-model="scan.from" type="date" /></label
            ><label>结束日期<input v-model="scan.to" type="date" /></label>
          </div>
          <label class="preview-ack"
            ><input
              v-model="scan.preview"
              type="checkbox"
            />只请求扫描预览，不写采集业务数据</label
          >
        </fieldset>
        <p v-if="currentSource" class="field-help">
          {{
            availabilityLabels[currentSource.availability]
          }}；实际预算采用该来源已保存配置（不采用未保存输入）。
        </p>
        <ElButton
          :disabled="
            busy ||
            stale ||
            scanBlocked ||
            (!!accepted && accepted.state !== 'failed')
          "
          @click="open('scan')"
          >确认扫描请求</ElButton
        >
      </section>
    </template>
    <template v-else-if="!route.params.id">
      <section class="panel console-pad">
        <label
          >来源筛选<select
            :value="sourceFilter"
            aria-label="来源筛选"
            @change="setFilter(($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部来源</option>
            <option
              v-for="source in fixedSources"
              :key="source.id"
              :value="source.id"
            >
              {{ source.publisher }}
            </option>
          </select></label
        >
      </section>
      <ResourceList
        :items="
          state.items.map((r) => ({
            ...r,
            secondary: fixedSources.find((s) => s.id === r.sourceId)?.publisher,
          }))
        "
        :total="state.total"
        :status="state.status"
        :error="state.error"
        :query="query"
        :states="runStates"
        @query="changeQuery"
        @retry="load"
        @open="router.push(link('/ingestion/runs/' + $event))"
      />
    </template>
    <template v-else>
      <p v-if="state.detailStatus === 'loading'" role="status">
        正在加载运行详情…
      </p>
      <p v-if="state.detailError" role="alert">
        {{ state.detailError }} <ElButton @click="load">重新加载运行</ElButton>
      </p>
      <section v-if="state.detail" class="panel console-pad">
        <h2>{{ state.detail.title }}</h2>
        <p class="status-tag">{{ runStates[state.detail.status] }}</p>
        <p class="field-help">
          {{ state.detail.id }} · 来源 {{ state.detail.sourceId }} · 触发方式
          {{
            { manual: "手动", scheduled: "定时", resume: "续跑" }[
              state.detail.trigger
            ]
          }}
        </p>
        <h3>原始范围（续跑不可修改）</h3>
        <p>
          {{ state.detail.range.from }} 至 {{ state.detail.range.to }} · 单通知
          {{ state.detail.range.url || "未指定" }}
        </p>
        <p>
          仅表示本次范围处理，不代表全站完整遍历；部分完成须检查预算原因、待处理和续跑链。
        </p>
        <h3>预算与计数</h3>
        <div class="diff-scroll" tabindex="0" aria-label="预算和计数">
          <table class="review-diff">
            <tbody>
              <tr v-for="field in settingFields" :key="field.key">
                <th>{{ field.label }}</th>
                <td>{{ state.detail.settings[field.key] }}</td>
              </tr>
              <tr v-for="(count, key) in state.detail.counts" :key="key">
                <th>{{ key }}</th>
                <td>{{ count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>错误与预算原因</h3>
        <p v-if="!state.detail.errors.length">本次记录无错误摘要。</p>
        <ul class="evidence-notes">
          <li v-for="(item, index) in state.detail.errors" :key="index">
            {{ item.kind }} · {{ item.message }}
            <p class="field-help">{{ item.url }}</p>
          </li>
        </ul>
        <h3>游标与续跑链</h3>
        <p>
          待处理页 {{ state.detail.cursor.pages }} · 待处理通知
          {{ state.detail.cursor.pending }} · 已见
          {{ state.detail.cursor.seen }}
        </p>
        <div class="console-actions">
          <RouterLink
            v-if="state.detail.previousRunId"
            :to="link('/ingestion/runs/' + state.detail.previousRunId)"
            >上一运行 {{ state.detail.previousRunId }}</RouterLink
          ><RouterLink
            v-if="state.detail.nextRunId"
            :to="link('/ingestion/runs/' + state.detail.nextRunId)"
            >后续运行 {{ state.detail.nextRunId }}</RouterLink
          ><ElButton
            :disabled="
              !canResume(state.detail) ||
              busy ||
              stale ||
              (!!accepted && accepted.state !== 'failed')
            "
            @click="open('resume')"
            >确认续跑原范围</ElButton
          ><ElButton @click="load">重新加载运行</ElButton>
        </div>
        <p class="field-help">
          续跑仅提交运行
          ID，不允许改写旧范围。执行中不能重复续跑，已有后续运行时请查看续跑链。
        </p>
      </section>
    </template>
    <ReasonDialog
      v-model="dialog"
      :title="actionLabel"
      :execute="execute"
      :blocked="stale"
    />
  </div>
</template>
