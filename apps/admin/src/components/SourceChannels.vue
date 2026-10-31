<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, toRaw } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { ElMessageBox } from "element-plus";
import { createOperationsService, operationsKey } from "../operations";
import { adminHttp } from "../runtime";
import type { Schema } from "../http";
import { errorMessage, ConsoleError } from "../console/resource";
import {
  defaultSettings,
  settingFields,
  validateSettings,
} from "../console/ingestion-control";
import { validDate } from "../console/review";
import ReasonDialog from "./ReasonDialog.vue";
const emit = defineEmits<{ changed: [] }>();
const service =
  inject(operationsKey, null) ?? createOperationsService(adminHttp);
const directory = ref<Schema["CollegeVerificationCandidateDto"][]>([]);
const sources = ref<Schema["IngestionSourceDto"][]>([]);
const loading = ref(false),
  loaded = ref(false),
  error = ref(""),
  busy = ref(false),
  stale = ref(false),
  dialog = ref(false);
const selection = ref("");
const channels = computed(() =>
  sources.value.flatMap((s) =>
    (s.channelStates ?? []).map((c) => ({
      source: s,
      channel: c,
      key: s.id + "/" + c.id,
    })),
  ),
);
const current = computed(() =>
  channels.value.find((c) => c.key === selection.value),
);
// 与 admin-ingestion.service.ts sourceDetail 的 coverage 聚合形状对应。
type PhaseCoverage = {
  total: number;
  ranges: {
    status: string;
    from: string;
    to: string;
    pendingNotices: number;
    pendingPages: number;
    scope: string;
  }[];
};
const phases = {
  fresh: "新通知首页检查",
  backfill: "固定范围历史遍历",
  revisit: "已知通知复查",
  retry: "失败地址重试",
};
const coverage = computed(
  () =>
    (current.value?.channel.coverage ?? {}) as Record<string, PhaseCoverage>,
);
const settings = ref({ ...defaultSettings }),
  enabled = ref(false),
  initial = ref("");
const verification = ref<Schema["VerifyChannelDto"]>({
  status: "pending",
  checkedAt: "",
  sampleUrls: [],
  paginationResult: "inconclusive",
  operationId: "",
  reason: "",
});
const sampleUrls = ref("");
const snapshot = () =>
  JSON.stringify({
    settings: settings.value,
    enabled: enabled.value,
    verification: verification.value,
    sampleUrls: sampleUrls.value,
  });
const dirty = computed(() => !!initial.value && snapshot() !== initial.value);
let epoch = 0;
async function leave() {
  if (!adminHttp.state.session && adminHttp.state.ready) return true;
  if (busy.value) return false;
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm("栏目配置或核验资料尚未保存。", "未保存资料", {
      confirmButtonText: "丢弃并继续",
      cancelButtonText: "继续编辑",
    });
    return true;
  } catch {
    return false;
  }
}
function reset() {
  settings.value = { ...defaultSettings, ...current.value?.channel.settings };
  enabled.value = current.value?.channel.enabled ?? false;
  verification.value = {
    status: "pending",
    checkedAt: "",
    sampleUrls: [],
    paginationResult: "inconclusive",
    operationId: "",
    reason: "",
  };
  sampleUrls.value = "";
  initial.value = snapshot();
  stale.value = false;
  dialog.value = false;
}
async function select(event: Event) {
  if (busy.value || stale.value || loading.value) return;
  const key = (event.target as HTMLSelectElement).value;
  if (await leave()) {
    selection.value = key;
    reset();
  } else (event.target as HTMLSelectElement).value = selection.value;
}
async function load() {
  // 退出或会话失效后不再发起目录与栏目读取。
  if (adminHttp.state.ready && !adminHttp.state.session) return;
  const turn = ++epoch;
  loading.value = true;
  loaded.value = false;
  error.value = "";
  stale.value = true;
  try {
    const [list, registered] = await Promise.all([
      service.directory(),
      service.sources(),
    ]);
    if (turn !== epoch) return;
    directory.value = list;
    sources.value = registered;
    loaded.value = true;
    if (!channels.value.some((c) => c.key === selection.value))
      selection.value = channels.value[0]?.key ?? "";
    reset();
  } catch (cause) {
    if (turn === epoch) error.value = errorMessage(cause);
  } finally {
    if (turn === epoch) loading.value = false;
  }
}
let command: {
  source: string;
  channel: string;
  body: Schema["VerifyChannelDto"] | Schema["ConfigureChannelDto"];
  kind: "verify" | "configure";
} | null = null;
function open(kind: "verify" | "configure") {
  if (!current.value || busy.value || stale.value) return;
  error.value = "";
  if (
    kind === "verify" &&
    (!validDate(verification.value.checkedAt) || !sampleUrls.value.trim())
  ) {
    error.value = "请填写有效核验日期和公开样本 URL。";
    return;
  }
  if (kind === "configure" && validateSettings(settings.value)) {
    error.value = validateSettings(settings.value)!;
    return;
  }
  command = {
    source: current.value.source.id,
    channel: current.value.channel.id,
    kind,
    body:
      kind === "verify"
        ? {
            ...toRaw(verification.value),
            sampleUrls: sampleUrls.value.split(/\s+/).filter(Boolean),
            operationId: crypto.randomUUID(),
            reason: "",
          }
        : {
            baseline: current.value.channel.baseline,
            enabled: enabled.value,
            settings: { ...toRaw(settings.value) },
            operationId: crypto.randomUUID(),
            reason: "",
          },
  };
  dialog.value = true;
}
async function execute(reason: string) {
  if (!command || busy.value || stale.value) throw new Error("请重新核对");
  const turn = epoch;
  busy.value = true;
  try {
    if (command.kind === "verify")
      await service.verify(command.source, command.channel, {
        ...command.body,
        reason,
      } as Schema["VerifyChannelDto"]);
    else
      await service.configure(command.source, command.channel, {
        ...command.body,
        reason,
      } as Schema["ConfigureChannelDto"]);
    if (turn === epoch) {
      initial.value = "";
      await load();
      emit("changed");
    }
  } catch (cause) {
    if (
      turn === epoch &&
      cause instanceof ConsoleError &&
      cause.status === 409
    ) {
      stale.value = true;
      error.value = "栏目基线已过期，输入保留，请重新加载后核验。";
    }
    throw cause;
  } finally {
    if (turn === epoch || !loading.value) busy.value = false;
  }
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
const unload = (event: BeforeUnloadEvent) => {
  if (busy.value || dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("beforeunload", unload);
onBeforeUnmount(() => {
  epoch++;
  window.removeEventListener("beforeunload", unload);
});
void load();
</script>
<template>
  <section class="panel console-pad">
    <h2>学院目录与栏目运营</h2>
    <p v-if="loading" role="status">正在查询目录与栏目…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ElButton
      :disabled="busy"
      @click="
        async () => {
          if (await leave()) await load();
        }
      "
      >重新查询栏目</ElButton
    >
    <template v-if="!loading && loaded">
      <p>
        目录 {{ directory.length }} 院 · 已注册
        {{ new Set(sources.map((s) => s.collegeId)).size }} 院 · 有已核验栏目
        {{
          new Set(
            channels
              .filter((c) => c.channel.verificationStatus === "verified")
              .map((c) => c.source.collegeId),
          ).size
        }}
        院 · 有启用栏目
        {{
          new Set(
            channels
              .filter((c) => c.source.enabled && c.channel.enabled)
              .map((c) => c.source.collegeId),
          ).size
        }}
        院。
      </p>
      <p>
        自动覆盖总数暂不可用；请逐栏目核对覆盖范围、最近成功检查与积压。目录研究日期不等于人工核验日期。
      </p>
      <p v-if="!sources.length">
        没有已注册来源，目录仅供核验线索查看，不能扫描。
      </p>
      <details>
        <summary>查看学院目录（只读线索）</summary>
        <ul>
          <li v-for="college in directory" :key="college.collegeId">
            {{ college.collegeName }} ·
            {{
              sources.some((s) => s.collegeId === college.collegeId)
                ? "已注册，核验状态见栏目"
                : "待注册／待核验，不能启用或扫描"
            }}
            · 研究日期 {{ college.checkedAt }}
            <p>{{ college.reason }}</p>
          </li>
        </ul>
      </details>
      <label
        >运营栏目<select
          aria-label="运营栏目"
          :value="selection"
          :disabled="busy || stale || loading"
          @change="select"
        >
          <option v-for="row in channels" :key="row.key" :value="row.key">
            {{ row.source.publisher }} · {{ row.channel.id }}
          </option>
        </select></label
      >
      <template v-if="current">
        <p>
          适配器
          {{
            current.source.channels.find((c) => c.id === current!.channel.id)
              ?.adapterId
          }}
          /
          {{
            current.source.channels.find((c) => c.id === current!.channel.id)
              ?.version
          }}
          · 核验 {{ current.channel.verificationStatus }} ·
          {{ current.channel.verifiedAt ?? "尚未核验" }} · 最近成功
          {{ current.channel.lastSuccessfulCheck ?? "未提供" }} · 积压
          {{ current.channel.pendingCount }} · 退避
          {{ current.channel.backoffUntil ?? "无" }}
        </p>
        <div class="diff-scroll" tabindex="0" aria-label="各阶段覆盖与积压">
          <table class="review-diff">
            <thead>
              <tr>
                <th>阶段</th>
                <th>范围／状态</th>
                <th>剩余通知／列表页</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(label, phase) in phases" :key="phase"
                ><tr v-if="!coverage[phase]?.ranges?.length">
                  <th>{{ label }}</th>
                  <td colspan="2">暂无此阶段记录，不表示已覆盖</td>
                </tr>
                <tr
                  v-for="(range, index) in coverage[phase]?.ranges ?? []"
                  :key="phase + index"
                >
                  <th>{{ label }}</th>
                  <td>
                    {{ range.from }} 至 {{ range.to }} · {{ range.status }} ·
                    {{ range.scope }}
                  </td>
                  <td>{{ range.pendingNotices }} / {{ range.pendingPages }}</td>
                </tr></template
              >
            </tbody>
          </table>
        </div>
        <p>
          fresh
          完成只表示首页检查；历史范围完成也不表示学院全站覆盖。轮次结束、扫描完成和按时结束分别核对。
        </p>
        <details>
          <summary>覆盖、阶段、轮次、预算与核验记录</summary>
          <pre class="notice-text">{{
            JSON.stringify(
              {
                coverage: current.channel.coverage,
                round: current.channel.latestRound,
                budget: current.channel.budgetUsage,
                verification: current.channel.verification,
              },
              null,
              2,
            )
          }}</pre>
        </details>
        <fieldset class="review-form" :disabled="busy || stale || dialog">
          <legend>登记栏目核验</legend>
          <div class="review-fields">
            <label
              >核验结论<select v-model="verification.status">
                <option value="pending">待核验</option>
                <option value="verified">核验通过</option>
                <option value="rejected">核验拒绝</option>
              </select></label
            >
            <label
              >核验日期<input v-model="verification.checkedAt" type="date"
            /></label>
            <label
              >分页结果<select v-model="verification.paginationResult">
                <option value="inconclusive">未确定</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
              </select></label
            >
            <label
              >公开赛事样本 URL（逐行）<textarea v-model="sampleUrls" />
            </label>
          </div>
          <ElButton @click="open('verify')">确认登记核验</ElButton>
        </fieldset>
        <fieldset class="review-form" :disabled="busy || stale || dialog">
          <legend>栏目启停与预算（不能更改主机或解析规则）</legend>
          <label
            ><input
              v-model="enabled"
              type="checkbox"
            />启用栏目（需核验通过，且来源启用）</label
          >
          <div class="review-fields">
            <label v-for="field in settingFields" :key="field.key"
              >{{ field.label
              }}<input
                v-model.number="settings[field.key]"
                type="number"
                :min="field.min"
                :max="field.max"
            /></label>
          </div>
          <ElButton @click="open('configure')">确认保存栏目配置</ElButton>
        </fieldset>
      </template>
    </template>
    <ReasonDialog
      v-model="dialog"
      title="栏目操作确认"
      :blocked="stale"
      :execute="execute"
    />
  </section>
</template>
<style scoped>
select,
textarea {
  max-width: 100%;
}
details ul {
  max-height: 360px;
  overflow: auto;
}
</style>
