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
  competitionErrorMessage,
  competitionKey,
  competitionContentKey,
  competitionDirty,
  emptyCompetition,
  exampleCompetitions,
  unavailableCompetitions,
  publicationStates,
  validCompetitionId,
  validateCompetition,
  competitionPatch,
  type CompetitionAction,
  type CompetitionListItem,
  type CompetitionPreviewReceipt,
  type ManagedCompetition,
} from "../console/competitions";
import type { CompetitionPatch } from "../console/review";
import {
  createResourceController,
  ConsoleError,
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
// 显式示例模式只读且完全隔离：即使已注入真实服务也不得回落到真实读写接口。
const service = computed(() =>
  example.value ? exampleCompetitions : (injected ?? unavailableCompetitions),
);
const query = computed(() => readQuery(route.query, publicationStates));
const controller = createResourceController<
    CompetitionListItem,
    ManagedCompetition
  >(),
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
  acknowledged = ref(false),
  /** 修改已发布记录内容的显式二次确认；默认不勾选，不能由页面自行补上。 */
  publishedAck = ref(false);
const preview = ref<{
  key: string;
  receipt?: CompetitionPreviewReceipt;
  message: string;
} | null>(null);
const notice = ref("");
let epoch = 0,
  previewEpoch = 0,
  collegeEpoch = 0;
/** 一次写命令的身份：结果不明时原样重试，不允许中途换 UUID 或载荷。 */
interface PendingCommand {
  operationId: string;
  action: CompetitionAction;
  baseline: string;
  patchKey: string;
  receipt?: CompetitionPreviewReceipt;
  confirmPublished: boolean;
}
const pending = ref<PendingCommand | null>(null);
/** 新建成功后正在把地址换成正式记录页，此时不重复加载也不拦截路由。 */
const replacing = ref(false);
const contentKey = computed(() =>
  draft.value
    ? competitionContentKey(draft.value, baseline.value, action.value)
    : "",
);
const dirty = computed(
  () => draft.value !== null && JSON.stringify(draft.value) !== initial.value,
);
/** 已存在记录仍有未提交的表单改动：发布/隐藏前必须先保存。 */
const unsavedContent = computed(
  () =>
    !!draft.value &&
    !!original.value &&
    competitionDirty(toRaw(draft.value), toRaw(original.value)),
);
const fresh = computed(() => preview.value?.key === contentKey.value);
const blocks = computed(() => preview.value?.receipt?.blocks ?? []);
const changes = computed(() => preview.value?.receipt?.changes ?? []);
const allowedActions = computed<CompetitionAction[]>(() => {
  if (isNew.value) return ["save"];
  if (!draft.value) return [];
  return [
    ...(editing.value ? ["save" as const] : []),
    draft.value.publication === "published" ? "hide" : "publish",
  ];
});
const labels = { save: "保存比赛", publish: "发布比赛", hide: "隐藏比赛" };
/** 已发布记录的内容更新必须单独确认，与普通草稿保存区分。 */
const needsPublishedAck = computed(
  () => action.value === "save" && original.value?.publication === "published",
);
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
function resetEdits() {
  busy.value = false;
  stale.value = false;
  dialog.value = false;
  error.value = "";
  notice.value = "";
  preview.value = null;
  acknowledged.value = false;
  publishedAck.value = false;
  draft.value = null;
  original.value = null;
  baseline.value = "";
  pending.value = null;
  action.value = "save";
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
  resetEdits();
  if (!detail.value) {
    await controller.load(() => service.value.list(query.value));
    return;
  }
  controller.clear();
  if (isNew.value) {
    draft.value = emptyCompetition();
    initial.value = JSON.stringify(draft.value);
    // 新建在 ID 校验通过后才取该 ID 的服务端空记录基线（validate → ensureIdBaseline）。
    return;
  }
  await controller.select(() => service.value.detail(String(route.params.id)));
  if (current !== epoch || !state.detail) return;
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
/** 新建前按 ID 校验并取该 ID 的服务端基线；已存在时提示进入对应记录。 */
async function ensureIdBaseline() {
  if (!draft.value) return false;
  if (!validCompetitionId(draft.value.id)) {
    error.value = "ID 须为不超过100字的小写英文、数字与连字符。";
    await nextTick();
    document.getElementById("competition-id")?.focus();
    return false;
  }
  if (example.value) return true;
  busy.value = true;
  try {
    const value = await service.value.baseline(draft.value.id);
    if (value.exists) {
      error.value = "";
      const state = value.publication
        ? (publicationStates as Record<string, string>)[value.publication]
        : null;
      notice.value = `届次 ${value.targetId} 已存在（${state ?? "状态未知"}），请进入该记录维护，避免重复新建。`;
      return false;
    }
    baseline.value = value.baseline;
    return true;
  } catch (cause) {
    error.value = competitionErrorMessage(cause);
    return false;
  } finally {
    busy.value = false;
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
  if (isNew.value && action.value === "save" && !(await ensureIdBaseline()))
    return false;
  const issue = validateCompetition(draft.value, colleges.value, action.value);
  if (!issue) return true;
  error.value = issue.message;
  await nextTick();
  document.getElementById("competition-" + issue.field)?.focus();
  return false;
}
async function generate() {
  if (busy.value || stale.value || !draft.value) return;
  const current = epoch,
    request = ++previewEpoch,
    targetAction = action.value;
  let key = "";
  if (targetAction !== "save" && unsavedContent.value) {
    // 发布/隐藏只改状态，未保存的表单不会被提交，必须让管理员先保存。
    error.value =
      "表单仍有未保存的修改，发布或隐藏不会提交这些内容；请先选择“保存修改”。";
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  preview.value = null;
  acknowledged.value = false;
  publishedAck.value = false;
  pending.value = null;
  try {
    // 校验会为新建草稿取服务端基线，必须在取基线之后才能固定预览键。
    if (!(await validate())) return;
    const target = structuredClone(toRaw(draft.value)),
      targetBaseline = baseline.value;
    key = contentKey.value;
    const receipt = await service.value.preview({
      content: target,
      patch: competitionPatch(
        target,
        original.value ? toRaw(original.value) : null,
      ),
      baseline: targetBaseline,
      action: targetAction,
      reason: "生成比赛变更预览",
    });
    if (
      current === epoch &&
      request === previewEpoch &&
      key === contentKey.value &&
      receipt.contentKey === key
    )
      preview.value = {
        key,
        receipt,
        message: receipt.blocks.length
          ? "服务预览已返回：发布底线仍有缺口，请先补齐后重新预览。"
          : "服务预览已返回，请核对下方服务端差异。",
      };
  } catch (cause) {
    if (
      current === epoch &&
      request === previewEpoch &&
      key === contentKey.value
    ) {
      if (cause instanceof ServiceUnavailable)
        // 示例模式不写也不预览真实服务，只做布局展示。
        preview.value = {
          key,
          message: "布局预览：示例模式只读，未校验正式基线，也不会写入服务端。",
        };
      else {
        if (cause instanceof ConsoleError && cause.status === 409)
          stale.value = true;
        error.value = competitionErrorMessage(cause);
      }
    }
  } finally {
    if (current === epoch && request === previewEpoch) busy.value = false;
  }
}
async function execute(reason: string) {
  // 客户端前置条件不属于服务端拒绝，不能提示成“未确认执行结果”；统一用 400 明确未执行。
  if (busy.value || stale.value || !fresh.value || !acknowledged.value)
    throw new ConsoleError(400, "预览已失效，请重新生成变更预览后再提交。");
  if (needsPublishedAck.value && !publishedAck.value)
    throw new ConsoleError(400, "修改已发布记录须先勾选显式确认。");
  if (!draft.value) throw new ConsoleError(400, "请重新加载比赛后再提交。");
  if (!example.value && !preview.value?.receipt)
    throw new ConsoleError(400, "缺少预览回执，请重新生成变更预览。");
  if (!(await validate()))
    throw new ConsoleError(400, "表单校验未通过，本次操作未执行。");
  if (example.value)
    throw new ServiceUnavailable(
      "示例模式只读，未保存、发布或隐藏；页面示例原状态未改变。",
    );
  const current = epoch,
    target = structuredClone(toRaw(draft.value)),
    patch = competitionPatch(
      target,
      original.value ? toRaw(original.value) : null,
    ),
    patchKey = JSON.stringify(patch);
  const previous = pending.value;
  const reusable =
    !!previous &&
    previous.patchKey === patchKey &&
    previous.action === action.value &&
    previous.baseline === baseline.value;
  const command: PendingCommand = reusable
    ? previous
    : {
        operationId: crypto.randomUUID(),
        action: action.value,
        baseline: baseline.value,
        patchKey,
        // 只有 save 能消费预览回执；发布/隐藏携带 previewId 会被服务端拒绝。
        receipt:
          action.value === "save" ? toRaw(preview.value!.receipt!) : undefined,
        confirmPublished: needsPublishedAck.value,
      };
  pending.value = command;
  busy.value = true;
  try {
    await service.value.change({
      patch,
      baseline: command.baseline,
      action: command.action,
      reason,
      operationId: command.operationId,
      receipt: command.receipt,
      confirmPublished: command.confirmPublished,
    });
    if (current !== epoch) return;
    // 服务端已确认：清空暂存命令，再刷新列表与详情基线。
    pending.value = null;
    initial.value = JSON.stringify(target);
    dialog.value = false;
    // 新建成功后进入正式记录地址，避免停在“新增草稿”而重复创建同名 ID。
    if (isNew.value) {
      replacing.value = true;
      try {
        await router.replace(`/competitions/${target.id}/edit`);
      } finally {
        replacing.value = false;
      }
    }
    const submittedPath = route.fullPath;
    await load();
    // load() 会推进 epoch，不能用旧代数判断；以当前路由确认刷新仍属于本次提交。
    if (route.fullPath !== submittedPath) return;
    // 写入已确认，刷新失败不能提示写入失败；提供重载入口让管理员核对新基线。
    notice.value =
      state.detailStatus === "error"
        ? "服务端已确认本次操作，但重新读取详情失败；请用“重新加载比赛”核对最新基线，不要重复提交。"
        : "服务端已确认本次操作，详情与基线已重新读取。";
  } catch (cause) {
    if (current !== epoch) throw cause;
    // 错误同时留在页面表单区：关闭确认对话框后管理员仍能看到失败原因。
    error.value = competitionErrorMessage(cause);
    if (cause instanceof ConsoleError && cause.status === 409) {
      stale.value = true;
      preview.value = null;
      acknowledged.value = false;
    }
    // 只有服务端确定性拒绝才丢弃暂存命令；网络中断保留以便原样重试。
    if (
      cause instanceof ConsoleError &&
      [400, 403, 409, 422].includes(cause.status)
    )
      pending.value = null;
    throw cause;
  } finally {
    if (current === epoch) busy.value = false;
  }
}
async function leave() {
  if (replacing.value) return true;
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
watch(needsPublishedAck, () => {
  publishedAck.value = false;
});
watch(
  () => route.fullPath,
  () => {
    // 新建成功后的地址替换由 execute 自行加载，避免重复请求。
    if (replacing.value) return;
    void load();
  },
  { immediate: true },
);
loadColleges();
function confirm() {
  // 不在这里清空暂存命令：网络结果不明时重开确认框仍需复用原操作标识与回执。
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
      独立页面示例 · 不代表真实比赛目录，所有操作均为只读，不会写入服务端。
    </p>
    <p v-if="notice" role="status" class="notice-strip">
      {{ notice }}
      <ElButton v-if="!detail" @click="load">重新加载列表</ElButton>
    </p>
    <template v-if="!detail"
      ><ResourceList
        :items="state.items"
        :total="state.total"
        :status="state.status"
        :error="state.error"
        :query="query"
        :states="publicationStates"
        :date-filters="false"
        :page-sizes="[10, 20, 50]"
        search-placeholder="搜索名称、届次或主办方"
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
          公开详情仅含已发布内容；进入维护前必须由管理服务重新读取基线。
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
          基线：{{
            baseline || (example ? "示例模式无正式基线" : "尚未取得服务端基线")
          }}
        </p>
        <p v-if="dirty" role="status" class="form-error">
          表单有未保存的修改；发布或隐藏只提交状态，不会带走这些内容。
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
          <div
            v-if="changes.length"
            class="diff-scroll"
            tabindex="0"
            aria-label="服务端返回的比赛变更"
          >
            <table class="review-diff">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>服务端原内容</th>
                  <th>本次提交后</th>
                  <th>解除的关系成员</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in changes" :key="row.field" class="changed">
                  <th>{{ row.field }}</th>
                  <td>
                    <pre>{{ JSON.stringify(row.previous, null, 2) }}</pre>
                  </td>
                  <td>
                    <pre>{{ JSON.stringify(row.current, null, 2) }}</pre>
                  </td>
                  <td>{{ row.removed?.join("、") || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="preview.receipt" role="status">
            服务端未返回字段差异，说明本次提交与正式基线一致。
          </p>
          <ul v-if="blocks.length" role="alert" class="block-list">
            <li v-for="block in blocks" :key="block.code">
              {{ block.code }} · {{ block.message }}
            </li>
          </ul>
          <div
            v-if="preview.receipt && !changes.length"
            class="diff-scroll"
            tabindex="0"
            aria-label="本地表单与基线差异"
          >
            <table class="review-diff">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>基线内容</th>
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
              </tbody>
            </table>
          </div>
          <label class="preview-ack"
            ><input
              v-model="acknowledged"
              type="checkbox"
              :disabled="!fresh || busy || stale"
            />我已核对同一内容及目标动作；已发布内容更新不会退回草稿。</label
          >
          <label v-if="needsPublishedAck" class="preview-ack">
            <input
              v-model="publishedAck"
              type="checkbox"
              :disabled="!fresh || busy || stale"
            />确认修改已发布记录内容：公开端在本次确认前保持原状，本次提交会直接更新已发布版本。</label
          >
          <ElButton
            :disabled="
              !fresh ||
              !acknowledged ||
              (needsPublishedAck && !publishedAck) ||
              busy ||
              stale ||
              (!example && blocks.length > 0)
            "
            @click="confirm"
            >打开操作确认</ElButton
          >
          <p v-if="pending" role="status" class="field-help">
            上一提交结果未确认；重试会复用同一操作标识与载荷，由服务端幂等回执判定，不会重复写入。
          </p>
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
.block-list {
  margin: 0;
  padding-left: 1.2em;
  color: #8a3b12;
}
</style>
