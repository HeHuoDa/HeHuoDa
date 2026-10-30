<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  toRaw,
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
  reviewKey,
  reviewStates,
  unavailableReview,
  allowedReviewAction,
  samePreview,
  validateReviewDraft,
  type ReviewAction,
  type ReviewMaterial,
  type ReviewRecord,
  type PreviewReceipt,
  type ReviewInput,
  type ReviewSummary,
  type ReviewService,
} from "../console/review";
import { toReviewDraft, serializeReviewDraft } from "../console/review-draft";
import {
  createResourceController,
  errorMessage,
  ConsoleError,
  type PageQuery,
} from "../console/resource";
import { readQuery } from "../console/query";
import { ServiceUnavailable } from "../services";
import ResourceList from "../components/ResourceList.vue";
import ReasonDialog from "../components/ReasonDialog.vue";
import ReviewFields from "../components/ReviewFields.vue";
import ReviewEvidence from "../components/ReviewEvidence.vue";
import ReviewDiff from "../components/ReviewDiff.vue";
import PublicCatalog from "../components/PublicCatalog.vue";
import { adminHttp } from "../runtime";
const route = useRoute(),
  router = useRouter();
const kind = computed(() => route.meta.ingestion as "candidates" | "notices");
const title = computed(() =>
  kind.value === "candidates" ? "候选审核" : "通知版本追溯",
);
const example = computed(() => route.query.preview === "1");
const injected = inject(reviewKey, null);
const exampleService = shallowRef<ReviewService | null>(null);
const service = computed(() =>
  example.value
    ? (exampleService.value ?? unavailableReview)
    : (injected ?? unavailableReview),
);
const query = computed(() => readQuery(route.query, reviewStates));
const controller = createResourceController<ReviewSummary, ReviewRecord>(),
  state = controller.state;
const draft = ref<ReviewMaterial | null>(null),
  initialKey = ref(""),
  colleges = ref<College[]>([]),
  target = ref(""),
  targetMode = ref("new");
const dirty = computed(
  () => !!draft.value && JSON.stringify(draft.value) !== initialKey.value,
);
const stale = ref(false);
const readOnly = computed(
  () =>
    !state.detail ||
    state.detail.material.sourceVersion !== state.detail.latestVersion ||
    ["imported", "rejected"].includes(state.detail.status),
);
const error = ref(""),
  pending = ref(false),
  writing = ref(false),
  dialog = ref(false),
  action = ref<ReviewAction>("save"),
  operationId = ref("");
const actionLabels: Record<ReviewAction, string> = {
  save: "保存修正",
  approve: "批准候选",
  reject: "拒绝候选",
  reopen: "重开候选",
  import: "导入比赛",
  publish: "发布比赛",
};
const confirmationTitle = computed(() =>
  action.value === "import" &&
  draft.value?.formalBefore?.publication === "published"
    ? "更新已发布比赛（显式确认）"
    : actionLabels[action.value],
);
const preview = ref<{
    kind: "import" | "publish";
    key: string;
    receipt?: PreviewReceipt;
    error: string;
  } | null>(null),
  acknowledged = ref(false);
const contentKey = computed(() =>
  draft.value ? JSON.stringify(draft.value) : "",
);
const previewFresh = computed(
  () =>
    !!draft.value &&
    !!preview.value &&
    samePreview(preview.value.key, draft.value),
);
watch(contentKey, () => {
  acknowledged.value = false;
});
let previewEpoch = 0;
let loadEpoch = 0;
async function mayLeave() {
  if (!adminHttp.state.session && adminHttp.state.ready) return true;
  if (writing.value) return false;
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm(
      "尚有未保存修正。离开将丢弃当前输入，原始记录不会改变。",
      "未保存修正",
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
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || writing.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onUnmounted(() => {
  loadEpoch++;
  controller.clear();
  previewEpoch++;
  window.removeEventListener("beforeunload", beforeUnload);
});
async function load() {
  const currentLoad = ++loadEpoch;
  previewEpoch++;
  controller.clear();
  draft.value = null;
  initialKey.value = "";
  preview.value = null;
  acknowledged.value = false;
  error.value = "";
  dialog.value = false;
  stale.value = false;
  pending.value = false;
  writing.value = false;
  if (example.value && !exampleService.value) {
    const examples = await import("../console/review-examples");
    if (currentLoad !== loadEpoch) return;
    exampleService.value = examples.exampleReview;
  }
  const id = route.params.id;
  if (id) {
    await controller.select(() =>
      service.value.detail(
        kind.value,
        String(id),
        typeof route.query.version === "string"
          ? route.query.version
          : undefined,
        typeof route.query.target === "string" ? route.query.target : undefined,
      ),
    );
    if (state.detail && currentLoad === loadEpoch) {
      draft.value = toReviewDraft(state.detail.material);
      initialKey.value = JSON.stringify(draft.value);
      target.value = draft.value.targetId;
      targetMode.value = draft.value.formalBefore ? "existing" : "new";
    }
  } else
    await controller.load(() => service.value.list(kind.value, query.value));
}
watch(() => route.fullPath, load, { immediate: true });
function updateQuery(value: PageQuery) {
  controller.clear();
  router.push({
    path: "/ingestion/" + kind.value,
    query: { ...value, preview: example.value ? "1" : undefined },
  });
}
function open(id: string) {
  router.push({
    path: "/ingestion/" + kind.value + "/" + encodeURIComponent(id),
    query: { ...route.query, version: undefined, target: undefined },
  });
}
async function selectTarget(id = target.value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100) {
    error.value = "目标届次 ID 仅允许小写字母、数字及单个连字符，最长100字。";
    return;
  }
  await router.push({
    path: route.path,
    query: { ...route.query, target: id },
  });
}
async function valid() {
  if (!draft.value) return false;
  const issue = validateReviewDraft(draft.value);
  error.value = issue?.message ?? "";
  if (issue) {
    await nextTick();
    const node = document.getElementById("review-" + issue.field);
    node?.scrollIntoView({ block: "center" });
    if (node instanceof HTMLElement) {
      node.tabIndex = node.tabIndex < 0 ? -1 : node.tabIndex;
      node.focus();
    }
    return false;
  }
  return true;
}
function can(action: ReviewAction) {
  return (
    !!state.detail &&
    !pending.value &&
    !stale.value &&
    state.detail.material.sourceVersion === state.detail.latestVersion &&
    allowedReviewAction(state.detail.status, action) &&
    !(action === "import" && state.detail.requiresReapproval) &&
    !(
      action === "publish" &&
      state.detail.material.formalBefore?.publication === "published"
    )
  );
}
async function makePreview(kind: "import" | "publish") {
  if (!draft.value || !(await valid()) || !can(kind)) return;
  const material = serializeReviewDraft(
      toRaw(draft.value),
      state.detail!.material,
    ),
    key = JSON.stringify(draft.value),
    epoch = ++previewEpoch;
  preview.value = { kind, key, error: "" };
  acknowledged.value = false;
  pending.value = true;
  try {
    const receipt = await service.value.preview(material, kind);
    if (epoch === previewEpoch && contentKey.value === key) {
      if (receipt.contentKey !== JSON.stringify(material) || !receipt.token)
        throw new Error("预览内容不匹配");
      preview.value = { kind, key, receipt, error: "" };
    }
  } catch (cause) {
    if (epoch === previewEpoch && contentKey.value === key) {
      if (cause instanceof ConsoleError && cause.status === 409) {
        stale.value = true;
        confirmedMaterial = null;
        confirmedReceipt = undefined;
      }
      if (preview.value?.key === key) preview.value.error = errorMessage(cause);
    }
  } finally {
    if (epoch === previewEpoch) pending.value = false;
  }
}
let confirmedMaterial: ReviewInput | null = null;
let confirmedReceipt: PreviewReceipt | undefined;
async function confirm(next: ReviewAction) {
  if (!draft.value || !can(next)) return;
  if (
    ["save", "approve", "import", "publish"].includes(next) &&
    !(await valid())
  )
    return;
  if (
    (next === "import" || next === "publish") &&
    (!previewFresh.value || !acknowledged.value || preview.value?.kind !== next)
  ) {
    error.value = "请先审阅同一内容的对应预览。修改后必须重新预览。";
    return;
  }
  if (next === "import" && dirty.value) {
    error.value = "已批准材料已改动，请先保存修正并重新审核，不能沿用旧批准。";
    return;
  }
  confirmedMaterial = serializeReviewDraft(
    toRaw(draft.value),
    state.detail!.material,
  );
  confirmedReceipt = preview.value?.receipt;
  operationId.value = crypto.randomUUID();
  action.value = next;
  dialog.value = true;
}
async function execute(reason: string) {
  const executingEpoch = loadEpoch;
  if (stale.value) throw new ConsoleError(409, "stale");
  if (!confirmedMaterial) return;
  if (
    (action.value === "import" || action.value === "publish") &&
    (!confirmedReceipt ||
      confirmedReceipt.contentKey !== JSON.stringify(confirmedMaterial))
  )
    throw new ServiceUnavailable(
      "服务未开放，未执行；布局预览不具备服务端授权或基线核验。",
    );
  pending.value = true;
  writing.value = true;
  try {
    await service.value.change(
      action.value,
      confirmedMaterial,
      reason,
      operationId.value,
      confirmedReceipt,
      {
        confirmPublished:
          action.value === "import" &&
          confirmedMaterial.formalBefore?.publication === "published",
        stateBaseline: state.detail?.stateBaseline,
      },
    );
    if (executingEpoch === loadEpoch) {
      dialog.value = false;
      initialKey.value = JSON.stringify(draft.value);
      await load();
    }
  } catch (cause) {
    if (executingEpoch === loadEpoch) {
      preview.value = null;
      acknowledged.value = false;
      if (cause instanceof ConsoleError && cause.status === 409) {
        stale.value = true;
        confirmedMaterial = null;
        confirmedReceipt = undefined;
      }
    }
    throw cause;
  } finally {
    if (executingEpoch === loadEpoch) {
      pending.value = false;
      writing.value = false;
    }
  }
}
async function reload() {
  if (await mayLeave()) await load();
}
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p>候选、正式比赛与来源版本分开核对；批准、导入和发布各自确认。</p>
    </div>
    <RouterLink
      v-if="route.params.id"
      :to="{
        path: '/ingestion/' + kind,
        query: { ...route.query, version: undefined, target: undefined },
      }"
      class="inline-link"
      >返回列表</RouterLink
    >
  </div>
  <ElAlert
    :title="
      example
        ? '独立审核页面示例：不代表真实通知或审核授权，管理写服务未开放。'
        : '审核基于当前原文与候选修订；批准、导入和发布分别确认。'
    "
    type="info"
    :closable="false"
  />
  <div class="example-toggle">
    <ElButton
      @click="
        router.push({
          path: '/ingestion/' + kind,
          query: { preview: example ? undefined : '1' },
        })
      "
      >{{ example ? "退出示例" : "查看独立审核示例" }}</ElButton
    ><span>原文以纯文本显示，附件只提供安全链接。</span>
  </div>
  <ResourceList
    v-if="!route.params.id"
    :searchable="example"
    :items="state.items"
    :total="state.total"
    :status="state.status"
    :error="state.error"
    :query="query"
    :states="reviewStates"
    @query="updateQuery"
    @open="open"
    @retry="load"
  />
  <template v-else>
    <div
      v-if="state.detailStatus === 'loading'"
      class="panel empty-block"
      role="status"
    >
      正在加载核对材料…
    </div>
    <div v-else-if="state.detailStatus === 'error'" class="panel empty-block">
      <p role="alert">{{ state.detailError }}</p>
      <ElButton @click="load">重新加载核对材料</ElButton>
    </div>
    <template v-else-if="state.detail && draft">
      <section class="panel console-pad">
        <div v-if="stale" role="alert" class="field-help">
          审核材料版本已过期，本轮确认已失效。请重新载入/导出材料并重新审核。<ElButton
            @click="reload"
            >重新载入审核材料</ElButton
          >
        </div>
        <span class="status-tag">{{ reviewStates[state.detail.status] }}</span>
        <p v-if="state.detail.requiresReapproval" class="field-help">
          目标核对材料已重新导出，旧批准不适用，需重新填写日期并审核。
        </p>
        <h2 class="detail-heading">{{ state.detail.title }}</h2>
        <p class="field-help">
          正式平台状态：{{
            state.detail.material.formalBefore?.publication ?? "尚无正式比赛"
          }}
          · 候选状态不会代替平台发布状态。
        </p>
        <div class="review-fields">
          <label
            >通知版本<ElSelect
              :model-value="state.detail.material.sourceVersion"
              aria-label="通知版本"
              :disabled="pending"
              @update:model-value="
                router.push({
                  path: route.path,
                  query: { ...route.query, version: $event, target: undefined },
                })
              "
              ><ElOption
                v-for="version in state.detail.versions"
                :key="version"
                :label="version"
                :value="version" /></ElSelect
          ></label>
          <p
            v-if="
              state.detail.material.sourceVersion !== state.detail.latestVersion
            "
            role="status"
          >
            历史版本只读，不能沿用旧证据审核新内容。
          </p>
        </div>
        <details>
          <summary>选择目标届次与公开查询</summary>
          <PublicCatalog @colleges="colleges = $event" @select="selectTarget" />
          <div class="review-fields">
            <label
              >目标关系<ElSelect v-model="targetMode" aria-label="目标关系"
                ><ElOption label="新建届次草稿" value="new" /><ElOption
                  label="关联已有届次（需重新读取基线）"
                  value="existing" /></ElSelect></label
            ><label
              >目标届次 ID<input v-model="target" aria-label="目标届次 ID"
            /></label>
          </div>
          <p class="field-help">
            公开列表不包含隐藏及未发布目录。修改关联目标会丢弃未保存输入，并重新获取只读正式基线。
          </p>
          <div v-if="example" class="console-actions">
            <ElButton @click="selectTarget('example-draft')"
              >查看更新草稿示例</ElButton
            ><ElButton @click="selectTarget('example-published')"
              >查看更新已发布示例</ElButton
            >
          </div>
          <ElButton @click="selectTarget()">重新载入目标核对材料</ElButton>
        </details>
      </section>
      <p v-if="error" class="form-error console-pad" role="alert">
        {{ error }}
      </p>
      <div class="review-columns">
        <div class="review-column">
          <ReviewEvidence :file="state.detail.material" />
        </div>
        <div class="review-column">
          <section class="panel console-pad">
            <ReviewFields
              v-model="draft"
              :colleges="colleges"
              :disabled="readOnly || pending"
            />
            <p class="field-help">
              {{
                dirty
                  ? "有未保存修正；离开会提示，尚未改变原始记录。"
                  : "当前没有未保存修正。"
              }}
            </p>
            <div class="console-actions">
              <ElButton :disabled="!can('save')" @click="confirm('save')"
                >保存修正 · 确认预览</ElButton
              ><ElButton :disabled="!can('approve')" @click="confirm('approve')"
                >批准候选 · 确认预览</ElButton
              ><ElButton :disabled="!can('reject')" @click="confirm('reject')"
                >拒绝候选 · 确认预览</ElButton
              ><ElButton :disabled="!can('reopen')" @click="confirm('reopen')"
                >显式重开 · 确认预览</ElButton
              >
            </div>
          </section>
          <ReviewDiff :file="draft" />
        </div>
      </div>
      <section class="panel console-pad">
        <h2>导入与独立发布</h2>
        <p class="field-help">
          {{
            draft.formalBefore?.publication === "published"
              ? "路径三：显式确认更新已发布比赛，不退回草稿。"
              : draft.formalBefore
                ? "路径二：更新现有草稿。"
                : "路径一：新建草稿。"
          }}
          导入不自动发布；已导入候选不能拒绝。
        </p>
        <div class="console-actions">
          <ElButton
            :disabled="!can('import') || dirty"
            @click="makePreview('import')"
            >生成导入预览</ElButton
          ><ElButton :disabled="!can('publish')" @click="makePreview('publish')"
            >生成独立发布预览</ElButton
          >
        </div>
        <div v-if="preview">
          <h3>
            {{ preview.kind === "import" ? "导入" : "独立发布"
            }}{{ example ? "布局预览" : "预览" }}
          </h3>
          <p v-if="pending" role="status">正在请求服务端预览…</p>
          <p v-if="preview.error" role="alert" class="form-error">
            {{ preview.error }}
          </p>
          <pre v-if="preview.receipt?.changes" class="notice-text">{{
            JSON.stringify(preview.receipt.changes, null, 2)
          }}</pre>
          <p v-if="!previewFresh" role="alert">
            内容已更改，原预览失效，请重新生成。
          </p>
          <p class="field-help">
            目标：{{ draft.targetId }} · 来源版本：{{ draft.sourceVersion }} ·
            基线：{{ draft.baseline }}。上方差异表展示当前材料。
          </p>
          <label class="preview-ack"
            ><input
              v-model="acknowledged"
              type="checkbox"
              :disabled="!previewFresh || pending || stale"
            />{{
              example
                ? "我已审阅同一内容的布局预览（不等于服务端授权）"
                : "我已核对本次目标、内容及预览差异，确认执行"
            }}</label
          ><ElButton
            :disabled="!previewFresh || !acknowledged || pending || stale"
            @click="confirm(preview.kind)"
            >打开{{ preview.kind === "import" ? "导入" : "发布" }}确认</ElButton
          >
        </div>
      </section>
    </template>
  </template>
  <ReasonDialog
    v-model="dialog"
    :title="confirmationTitle"
    :execute="execute"
    :blocked="stale"
  />
</template>
