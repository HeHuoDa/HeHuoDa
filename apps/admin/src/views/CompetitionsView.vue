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
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import { ElMessageBox } from "element-plus";
import type { College } from "@hehuoda/api-types";
import {
  competitionKey,
  emptyCompetition,
  exampleCompetitions,
  unavailableCompetitions,
  publicationStates,
  validateCompetition,
  competitionPatch,
  type ManagedCompetition,
  type CompetitionAction,
} from "../console/competitions";
import type { CompetitionPatch, PreviewReceipt } from "../console/review";
import {
  createResourceController,
  ConsoleError,
  errorMessage,
  type PageQuery,
} from "../console/resource";
import { readQuery } from "../console/query";
import {
  publicCatalogKey,
  createPublicCatalog,
} from "../console/public-catalog";
import { ServiceUnavailable } from "../services";
import ResourceList from "../components/ResourceList.vue";
import PublicCatalog from "../components/PublicCatalog.vue";
import CompetitionFields from "../components/CompetitionFields.vue";
import ReasonDialog from "../components/ReasonDialog.vue";
const route = useRoute(),
  router = useRouter();
const example = computed(() => route.query.preview === "1"),
  isNew = computed(() => route.path === "/competitions/new"),
  detail = computed(() => !!route.params.id || isNew.value),
  editing = computed(() => isNew.value || route.path.endsWith("/edit"));
const injected = inject(competitionKey, null),
  api = inject(publicCatalogKey, null) ?? createPublicCatalog();
const service = computed(
  () =>
    injected ?? (example.value ? exampleCompetitions : unavailableCompetitions),
);
const query = computed(() => readQuery(route.query, publicationStates));
const controller = createResourceController<ManagedCompetition>(),
  state = controller.state;
const draft = ref<CompetitionPatch | null>(null),
  original = ref<CompetitionPatch | null>(null),
  initial = ref(""),
  baseline = ref("");
const colleges = ref<College[]>([]),
  collegeError = ref(""),
  collegeLoading = ref(false);
const error = ref(""),
  busy = ref(false),
  stale = ref(false),
  dialog = ref(false),
  action = ref<CompetitionAction>("save"),
  acknowledged = ref(false);
const preview = ref<{
  key: string;
  receipt?: PreviewReceipt;
  message: string;
} | null>(null);
let epoch = 0,
  previewEpoch = 0,
  collegeEpoch = 0,
  operationId = "";
const contentKey = computed(() =>
  JSON.stringify({
    content: draft.value,
    baseline: baseline.value,
    action: action.value,
  }),
);
const dirty = computed(
  () => draft.value !== null && JSON.stringify(draft.value) !== initial.value,
);
const fresh = computed(() => preview.value?.key === contentKey.value);
const allowedActions = computed<CompetitionAction[]>(() => {
  if (isNew.value) return ["save"];
  if (!draft.value) return [];
  return [
    ...(editing.value ? ["save" as const] : []),
    draft.value.publication === "published" ? "hide" : "publish",
  ];
});
const labels = { save: "保存比赛", publish: "发布比赛", hide: "隐藏比赛" };
const title = computed(() =>
  action.value === "save" && original.value?.publication === "published"
    ? "更新已发布比赛（显式确认）"
    : labels[action.value],
);
const diffRows = computed(() =>
  draft.value
    ? (Object.keys(draft.value) as (keyof CompetitionPatch)[]).map((key) => ({
        key,
        before: JSON.stringify(original.value?.[key] ?? null, null, 2),
        after: JSON.stringify(draft.value![key], null, 2),
      }))
    : [],
);
function link(path: string) {
  return { path, query: example.value ? { preview: "1" } : {} };
}
async function loadColleges() {
  const current = ++collegeEpoch;
  collegeError.value = "";
  collegeLoading.value = true;
  try {
    const value = await api.colleges();
    if (current === collegeEpoch) colleges.value = value;
  } catch {
    if (current === collegeEpoch)
      collegeError.value = "公开学院查询失败，未填充示例学院，请重试。";
  } finally {
    if (current === collegeEpoch) collegeLoading.value = false;
  }
}
async function load() {
  const current = ++epoch;
  ++previewEpoch;
  busy.value = false;
  stale.value = false;
  dialog.value = false;
  error.value = "";
  preview.value = null;
  acknowledged.value = false;
  draft.value = null;
  original.value = null;
  baseline.value = "";
  action.value = "save";
  if (!detail.value) {
    await controller.load(() => service.value.list(query.value));
    return;
  }
  controller.clear();
  if (isNew.value) {
    draft.value = emptyCompetition();
    initial.value = JSON.stringify(draft.value);
    return;
  }
  await controller.select(() => service.value.detail(String(route.params.id)));
  if (current === epoch && state.detail) {
    draft.value = structuredClone(toRaw(state.detail.content));
    original.value = structuredClone(toRaw(state.detail.content));
    baseline.value = state.detail.baseline;
    initial.value = JSON.stringify(draft.value);
    action.value = editing.value
      ? "save"
      : draft.value.publication === "published"
        ? "hide"
        : "publish";
  }
}
function changeQuery(value: PageQuery) {
  router.push({
    path: "/competitions",
    query: { ...value, ...(example.value ? { preview: "1" } : {}) },
  });
}
async function validate() {
  if (!draft.value) return false;
  if (!allowedActions.value.includes(action.value)) {
    error.value = "当前对象不允许该动作，请重新加载并选择。";
    return false;
  }
  const issue = validateCompetition(draft.value, colleges.value, action.value);
  if (!issue) return true;
  error.value = issue.message;
  await nextTick();
  document.getElementById("competition-" + issue.field)?.focus();
  return false;
}
async function generate() {
  if (busy.value || stale.value || !(await validate()) || !draft.value) return;
  const current = epoch,
    request = ++previewEpoch,
    key = contentKey.value;
  busy.value = true;
  error.value = "";
  preview.value = null;
  acknowledged.value = false;
  try {
    const receipt = await service.value.preview(
      structuredClone(toRaw(draft.value)),
      baseline.value,
      action.value,
    );
    if (
      current === epoch &&
      request === previewEpoch &&
      key === contentKey.value &&
      receipt.contentKey === key
    )
      preview.value = {
        key,
        receipt,
        message: "服务预览已返回，请核对下方差异。",
      };
  } catch (cause) {
    if (
      current === epoch &&
      request === previewEpoch &&
      key === contentKey.value
    ) {
      if (cause instanceof ConsoleError && cause.status === 409)
        stale.value = true;
      if (cause instanceof ServiceUnavailable)
        preview.value = {
          key,
          message:
            "布局预览：服务未开放，尚未校验正式基线；任何确认均不会写入。",
        };
      else error.value = errorMessage(cause);
    }
  } finally {
    if (current === epoch && request === previewEpoch) busy.value = false;
  }
}
async function execute(reason: string) {
  if (
    busy.value ||
    stale.value ||
    !fresh.value ||
    !acknowledged.value ||
    !draft.value
  )
    throw new Error("需要重新预览");
  if (!(await validate())) throw new Error("校验失败");
  const current = epoch;
  busy.value = true;
  try {
    if (!preview.value?.receipt)
      throw new ServiceUnavailable(
        "服务未开放，未保存、发布或隐藏；页面示例原状态未改变。",
      );
    await service.value.change({
      content: structuredClone(toRaw(draft.value)),
      patch: competitionPatch(
        toRaw(draft.value),
        original.value ? toRaw(original.value) : null,
      ),
      baseline: baseline.value,
      action: action.value,
      reason,
      operationId,
      receipt: toRaw(preview.value.receipt),
      confirmPublished: original.value?.publication === "published",
    });
    if (current === epoch) {
      initial.value = JSON.stringify(draft.value);
      await load();
    }
  } catch (cause) {
    if (
      current === epoch &&
      cause instanceof ConsoleError &&
      cause.status === 409
    ) {
      stale.value = true;
      preview.value = null;
    }
    throw cause;
  } finally {
    if (current === epoch) busy.value = false;
  }
}
async function leave() {
  if (busy.value) return false;
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm("当前输入尚未保存。", "未保存比赛", {
      confirmButtonText: "丢弃并离开",
      cancelButtonText: "继续编辑",
      type: "warning",
    });
    return true;
  } catch {
    return false;
  }
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  ++epoch;
  ++previewEpoch;
  ++collegeEpoch;
  window.removeEventListener("beforeunload", beforeUnload);
});
watch(contentKey, () => {
  acknowledged.value = false;
});
watch(() => route.fullPath, load, { immediate: true });
loadColleges();
function confirm() {
  operationId = crypto.randomUUID();
  dialog.value = true;
}
</script>
<template>
  <div class="console-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">COMPETITION CATALOG</span>
        <h1>比赛届次维护</h1>
        <p>独立维护届次、赛段、赛道与来源，所有发布操作均需人工确认。</p>
      </div>
      <ElButton @click="router.push(link('/competitions/new'))"
        >新增草稿</ElButton
      >
    </div>
    <div class="console-actions">
      <ElButton
        @click="
          router.push({
            path: '/competitions',
            query: { preview: example ? undefined : '1' },
          })
        "
        >{{ example ? "返回真实管理查询" : "查看独立比赛示例" }}</ElButton
      ><RouterLink v-if="detail" :to="link('/competitions')"
        >返回列表</RouterLink
      >
    </div>
    <p v-if="example" class="notice-strip">
      独立页面示例 · 不代表真实比赛目录，操作不会保存。
    </p>
    <template v-if="!detail"
      ><ResourceList
        :items="state.items"
        :total="state.total"
        :status="state.status"
        :error="state.error"
        :query="query"
        :states="publicationStates"
        @query="changeQuery"
        @retry="load"
        @open="router.push(link('/competitions/' + $event))"
      />
      <section class="panel console-pad">
        <PublicCatalog
          show-details
          :allow-select="false"
          @colleges="colleges = $event"
        />
        <p class="field-help">
          公开详情仅含已发布内容；进入维护前必须由管理服务重新读取基线。当前管理服务未开放。
        </p>
      </section></template
    >
    <template v-else>
      <p v-if="state.detailStatus === 'loading'" role="status">正在加载比赛…</p>
      <p v-if="state.detailError" role="alert">
        {{ state.detailError }} <ElButton @click="load">重新加载比赛</ElButton>
      </p>
      <section v-if="draft" class="panel console-pad">
        <div class="detail-heading">
          <h2>{{ isNew ? "新增草稿" : draft.name }}</h2>
          <span class="status-tag">{{
            publicationStates[draft.publication]
          }}</span
          ><RouterLink
            v-if="!editing"
            :to="link('/competitions/' + draft.id + '/edit')"
            >编辑比赛</RouterLink
          >
        </div>
        <p class="field-help">
          基线：{{ baseline || "新建草稿，待服务端确认 ID 可用" }}
        </p>
        <p v-if="collegeLoading" role="status">正在加载学院选项…</p>
        <p v-if="collegeError" role="alert">
          {{ collegeError }}
          <ElButton @click="loadColleges">重试学院查询</ElButton>
        </p>
        <CompetitionFields
          v-model="draft"
          :colleges="colleges"
          :disabled="!editing || busy || stale"
          :existing="!isNew"
        />
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <p v-if="stale" role="alert">
          本轮基线已过期，输入已保留。请复制待核对输入，重新加载后重新预览，不能强制覆盖。<ElButton
            @click="load"
            >重新加载比赛</ElButton
          >
        </p>
        <div class="console-actions">
          <label
            >目标动作<select v-model="action" :disabled="busy || stale">
              <option v-if="editing" value="save">
                {{ isNew ? "保存新草稿" : "保存修改" }}
              </option>
              <option
                v-if="!isNew && draft.publication !== 'published'"
                value="publish"
              >
                发布比赛
              </option>
              <option
                v-if="!isNew && draft.publication === 'published'"
                value="hide"
              >
                隐藏比赛
              </option>
            </select></label
          ><ElButton
            :disabled="busy || stale || (!editing && action === 'save')"
            @click="generate"
            >生成变更预览</ElButton
          >
        </div>
        <template v-if="preview"
          ><p role="status">{{ preview.message }}</p>
          <p v-if="!fresh" role="alert">内容已更改，原预览失效，请重新生成。</p>
          <div class="diff-scroll" tabindex="0" aria-label="比赛变更差异">
            <table class="review-diff">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>原内容</th>
                  <th>本次内容</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in diffRows"
                  :key="row.key"
                  :class="{ changed: row.before !== row.after }"
                >
                  <th>{{ row.key }}</th>
                  <td>
                    <pre>{{ row.before }}</pre>
                  </td>
                  <td>
                    <pre>{{ row.after }}</pre>
                  </td>
                </tr>
                <tr>
                  <th>确认动作</th>
                  <td>{{ draft.publication }}</td>
                  <td>{{ labels[action] }}（独立确认）</td>
                </tr>
              </tbody>
            </table>
          </div>
          <label class="preview-ack"
            ><input
              v-model="acknowledged"
              type="checkbox"
              :disabled="!fresh || busy || stale"
            />我已核对同一内容及目标动作；已发布内容更新不会退回草稿。</label
          ><ElButton
            :disabled="!fresh || !acknowledged || busy || stale"
            @click="confirm"
            >打开操作确认</ElButton
          >
        </template>
      </section>
    </template>
    <ReasonDialog
      v-model="dialog"
      :title="title"
      :execute="execute"
      :blocked="stale || !fresh"
    />
  </div>
</template>
<style scoped>
.console-page {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.console-page p {
  overflow-wrap: anywhere;
}
.console-page :deep(select) {
  border: 1px solid #cbd7cf;
  border-radius: 6px;
  padding: 9px;
  min-width: 0;
  color: #243d32;
  background: white;
}
</style>
