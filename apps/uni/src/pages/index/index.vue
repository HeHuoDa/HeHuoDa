<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import {
  collegeNames,
  formatTime,
  formatEvaluatedAt,
  materialDeadlineLabel,
  parseFilters,
  writeFilters,
  scopeLabel,
  statuses,
  type Filters,
} from "@hehuoda/client-domain/competition-discovery";
import CollegePicker from "../../components/CollegePicker.vue";
import FormButton from "../../components/FormButton.vue";
import FormInput from "../../components/FormInput.vue";
import FormPicker from "../../components/FormPicker.vue";
import { competitionApi } from "../../api/competitions";
import {
  createDiscoveryController,
  initialDiscoveryState,
} from "../../stores/discovery-controller";
import { openPage } from "../../navigation/navigate";
import { useNavigationStore } from "../../stores/navigation";

const state = reactive(initialDiscoveryState());
const controller = createDiscoveryController(state, competitionApi);
const search = ref("");
const navigation = useNavigationStore();
const options = [
  { value: "", label: "全部状态" },
  ...Object.entries(statuses).map(([value, label]) => ({ value, label })),
];
const originLabels = {
  official: "官方通知",
  historical: "官方历史信息",
  demo: "虚构交互样例",
};
const noColleges = computed(
  () => state.filters.hosts !== "all" && !state.filters.hosts.length,
);
const directoryStatus = computed(() =>
  state.directoryStatus === "ready"
    ? "ready"
    : state.directoryStatus === "error"
      ? "error"
      : "loading",
);
function reset() {
  search.value = "";
  void controller.update(parseFilters({}));
}
function submit() {
  void controller.update({ q: search.value });
}
function status(value: string) {
  void controller.update({ status: value as Filters["status"] });
}
onLoad((query) => {
  state.filters = parseFilters(query ?? {});
  search.value = state.filters.q;
});
onShow(() => {
  const query = navigation.consumeTabQuery("home");
  if (query) {
    controller.cancel();
    state.filters = parseFilters(query);
    search.value = state.filters.q;
    void controller.load();
    return;
  }
  void controller.resume();
});
onHide(controller.cancel);
onUnload(controller.cancel);
</script>

<template>
  <view class="hhr-page hhr-page--tab discovery-page">
    <view class="discovery-inner">
      <view class="discovery-header">
        <text class="hhr-eyebrow">校园里的每一种可能</text>
        <text class="discovery-heading">发现比赛，找到同路人</text>
        <text class="discovery-intro"
          >从一场比赛开始，让想法生根，让各有所长的伙伴相遇。</text
        >
      </view>
      <view class="discovery-layout">
        <CollegePicker
          compact
          :model-value="state.filters.hosts"
          :status="directoryStatus"
          :catalog="
            state.directoryStatus === 'ready' ? state.directory : undefined
          "
          :error-message="state.error"
          @update:model-value="controller.update({ hosts: $event })"
          @retry="controller.load()"
        >
          <template #footer>
            <view class="discovery-filters" role="search" aria-label="比赛筛选">
              <view class="discovery-search">
                <FormInput
                  id="competition-search"
                  v-model="search"
                  label="搜索比赛"
                  class="discovery-search-field"
                  :maxlength="100"
                  placeholder="搜索比赛名称、届次"
                  @confirm="submit"
                />
                <FormButton class="discovery-search-button" @click="submit"
                  >搜索</FormButton
                >
              </view>
              <FormPicker
                id="competition-status"
                label="报名状态"
                :model-value="state.filters.status"
                :options="options"
                @change="status"
              />
              <view class="discovery-filter-actions">
                <FormButton
                  variant="reveal"
                  @click="controller.update({ hosts: [] })"
                  >取消全部学院</FormButton
                >
                <FormButton variant="reveal" @click="reset"
                  >重置所有筛选</FormButton
                >
              </view>
            </view>
          </template>
        </CollegePicker>
        <view class="discovery-results" role="region" aria-label="比赛发现">
          <view class="discovery-results-header">
            <text class="discovery-section-heading">比赛一览</text>
            <text
              v-if="state.status === 'loading' || state.response"
              class="discovery-count"
              role="status"
              aria-live="polite"
              >{{
                state.status === "loading"
                  ? "统计中…"
                  : `${state.response?.totalCompetitions} 项比赛 · ${state.response?.totalStages} 个赛段`
              }}</text
            >
          </view>
          <view
            v-if="state.status === 'loading' || state.status === 'idle'"
            class="hhr-panel discovery-feedback"
            role="status"
            >{{
              state.directoryStatus === "loading"
                ? "正在加载学院目录…"
                : "正在加载比赛…"
            }}</view
          >
          <view
            v-else-if="state.status === 'error'"
            class="hhr-panel discovery-feedback"
            role="alert"
          >
            <text>{{ state.error }}</text>
            <text v-if="state.requestId" class="discovery-request-id"
              >请求编号：{{ state.requestId }}</text
            >
            <FormButton class="discovery-retry" @click="controller.load()"
              >重试加载</FormButton
            >
          </view>
          <view
            v-else-if="!state.response?.items.length"
            class="hhr-panel discovery-empty"
          >
            <text class="discovery-empty-title">{{
              noColleges ? "尚未选择学院" : "暂时没有匹配的比赛"
            }}</text>
            <text class="discovery-empty-description">{{
              noColleges
                ? "已取消全部学院，请选择承办学院或点击全部学院查看比赛。"
                : "试试其他学院或放宽筛选，学院入口仍可继续选择。"
            }}</text>
            <FormButton variant="soft" class="discovery-retry" @click="reset"
              >重置所有筛选</FormButton
            >
          </view>
          <view v-else class="discovery-cards">
            <view
              v-for="{ competition, stage } in state.response.items"
              :key="`${competition.id}:${stage.id}`"
              class="hhr-card discovery-card"
              data-competition-card
            >
              <view class="discovery-tags">
                <text class="hhr-badge">{{ competition.category }}</text
                ><text class="discovery-edition">{{ competition.edition }}</text
                ><text class="hhr-badge hhr-badge--muted">{{
                  originLabels[competition.origin]
                }}</text>
              </view>
              <FormButton
                variant="reveal"
                class="discovery-card-title"
                @click="
                  openPage('competition-detail', {
                    ...writeFilters({}, state.filters),
                    id: competition.id,
                    stage: stage.id,
                  })
                "
                >{{ competition.name }}</FormButton
              >
              <text class="discovery-stage">{{ stage.name }}</text>
              <view class="discovery-facts">
                <text class="discovery-label">承办学院</text
                ><text>{{ collegeNames(stage.hosts) }}</text>
                <text class="discovery-label">参赛范围</text
                ><text>{{ scopeLabel(stage.scope) }}</text>
              </view>
              <text class="discovery-scope-note">{{ stage.scope.note }}</text>
              <view class="discovery-deadline">
                <text class="discovery-status">{{
                  statuses[stage.status]
                }}</text>
                <text
                  >报名截止：{{
                    stage.conflict ? "时间待核对" : formatTime(stage.deadline)
                  }}</text
                >
                <text v-if="stage.materialsAt.value"
                  >材料截止：{{
                    materialDeadlineLabel(
                      stage.materialsAt,
                      state.response.evaluatedAt,
                    )
                  }}</text
                >
              </view>
            </view>
          </view>
          <view
            v-if="state.response?.items.length"
            class="discovery-pagination"
            role="navigation"
            aria-label="比赛分页"
          >
            <FormButton
              variant="secondary"
              :disabled="state.filters.page <= 1"
              @click="controller.page(state.filters.page - 1)"
              >上一页</FormButton
            >
            <text
              >第 {{ state.filters.page }} /
              {{ state.response.totalPages }} 页</text
            >
            <FormButton
              variant="secondary"
              :disabled="!state.response.hasMore"
              @click="controller.page(state.filters.page + 1)"
              >下一页</FormButton
            >
          </view>
          <text class="discovery-disclaimer"
            >状态计算时间：{{
              state.response
                ? formatEvaluatedAt(state.response.evaluatedAt)
                : "待获取"
            }}（北京时间）。报名时段内不保证名额或资格通过，最新安排以官方通知为准。</text
          >
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* px 对齐旧 Web 字号及间距，避免 uni H5 根字号缩放改变视觉基线。 */
.discovery-page {
  padding: 24px 20px
    calc(24px + var(--window-bottom, 0px) + env(safe-area-inset-bottom, 0px));
}
.discovery-inner {
  max-width: 1020px;
  margin: 0 auto;
}
.discovery-header {
  margin-bottom: 28px;
}
.discovery-heading {
  display: block;
  font-family: var(--hhr-font-display);
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
}
.discovery-intro {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.discovery-layout {
  display: grid;
  align-items: start;
  gap: 20px;
}
.discovery-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px;
}
.discovery-search {
  display: flex;
  min-width: 0;
  gap: 6px;
  grid-column: 1 / -1;
}
.discovery-search-field {
  flex: 1;
  min-width: 0;
}
.discovery-search-button {
  width: auto;
  flex-shrink: 0;
  min-height: 32px;
  padding: 0 12px;
  font-size: 12px;
}
.discovery-filters :deep(.hhr-form-label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.discovery-filters :deep(.hhr-form-field) {
  min-width: 0;
}
.discovery-filters :deep(.hhr-input) {
  min-height: 32px;
  height: 32px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--hhr-color-muted);
}
.discovery-filter-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.discovery-filter-actions :deep(.hhr-button) {
  min-height: 32px;
  margin: 0;
  padding: 0;
  font-size: 11px;
}
.discovery-results {
  min-width: 0;
}
.discovery-results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.discovery-section-heading {
  font-family: var(--hhr-font-display);
  font-size: 20px;
  font-weight: 600;
}
.discovery-count {
  color: var(--hhr-color-brand);
  font-size: 12px;
}
.discovery-feedback {
  padding: 24px;
}
.discovery-feedback > text {
  display: block;
}
.discovery-request-id {
  margin-top: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.discovery-retry {
  margin-top: 16px;
  width: fit-content;
}
.discovery-empty {
  padding: 40px 24px;
  text-align: center;
}
.discovery-empty-title {
  display: block;
  font-weight: 600;
}
.discovery-empty-description {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  color: var(--hhr-color-muted);
}
.discovery-empty .discovery-retry {
  margin-left: auto;
  margin-right: auto;
}
.discovery-cards {
  display: grid;
  gap: 12px;
}
.discovery-card {
  padding: 16px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.discovery-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 16px;
}
.discovery-edition {
  color: var(--hhr-color-muted);
}
.discovery-card-title {
  display: block;
  min-height: 44px;
  padding: 4px 0;
  margin: 0;
  font-family: var(--hhr-font-display);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.55;
  text-align: left;
  white-space: normal;
}
.discovery-stage {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
}
.discovery-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 12px;
  row-gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 20px;
}
.discovery-label,
.discovery-scope-note {
  color: var(--hhr-color-muted);
}
.discovery-scope-note {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 20px;
}
.discovery-deadline {
  margin-top: 8px;
  border-top: 1px solid var(--hhr-color-line);
  padding-top: 8px;
  font-size: 12px;
  line-height: 16px;
}
.discovery-deadline > text {
  display: block;
}
.discovery-deadline > text + text {
  margin-top: 4px;
}
.discovery-status {
  font-weight: 600;
  color: var(--hhr-color-brand);
}
.discovery-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 20px;
  font-size: 12px;
  color: var(--hhr-color-muted);
}
.discovery-pagination :deep(.hhr-button) {
  width: auto;
  padding: 10px 18px;
  font-size: 14px;
}
.discovery-disclaimer {
  display: block;
  margin-top: 16px;
  font-size: 12px;
  line-height: 24px;
  color: var(--hhr-color-muted);
}
@media (min-width: 1100px) {
  .discovery-layout {
    grid-template-columns: 340px minmax(0, 1fr);
  }
}
@media (max-width: 767px) {
  .discovery-heading {
    font-size: clamp(24px, 6vw, 30px);
    line-height: 1.5;
    text-wrap: balance;
  }
  .discovery-filters {
    gap: 8px;
  }
  .discovery-filters :deep(.hhr-input) {
    height: 44px;
    min-height: 44px;
    font-size: 16px;
  }
  .discovery-search-button {
    min-height: 44px;
    font-size: 14px;
  }
  .discovery-filters :deep(.hhr-form-field),
  .discovery-filter-actions {
    grid-column: 1 / -1;
  }
  .discovery-filter-actions {
    gap: 12px;
  }
  .discovery-filter-actions :deep(.hhr-button) {
    flex: 1;
    min-height: 44px;
    font-size: 13px;
  }
}
</style>
