<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { colleges, type CollegeId } from "@hehuoda/client-domain/colleges";
import {
  normalizeCollegeSelection,
  toggleCollegeSelection,
  type CollegeSelection,
} from "@hehuoda/client-domain/college-selection";
import CollegeEmblem from "./CollegeEmblem.vue";

const props = withDefaults(
  defineProps<{
    modelValue: CollegeSelection;
    compact?: boolean;
    catalog?: readonly { id: string; name: string }[];
    status?: "ready" | "loading" | "error";
    errorMessage?: string;
  }>(),
  {
    catalog: () => colleges,
    status: "ready",
    errorMessage: "学院目录加载失败，请重试。",
  },
);
const emit = defineEmits<{
  "update:modelValue": [value: CollegeSelection];
  select: [ids: CollegeId[]];
  reset: [];
  clear: [];
  invalid: [ids: string[]];
  retry: [];
}>();
const notice = ref("");
// 消费页负责远端目录核验；此处只作防御，不请求或按名称猜测 ID。
const catalogMatches = computed(
  () =>
    props.catalog.length === colleges.length &&
    props.catalog.every(
      (item, index) =>
        item.id === colleges[index]?.id && item.name === colleges[index]?.name,
    ),
);
const ready = computed(() => props.status === "ready" && catalogMatches.value);
const selection = computed(() => normalizeCollegeSelection(props.modelValue));
const selectedIds = computed(() =>
  selection.value === "all" ? [] : selection.value,
);
const selectionLabel = computed(() => {
  if (selection.value === "all") return "全部学院";
  if (selectedIds.value.length > 1)
    return `已选择 ${selectedIds.value.length} 个学院`;
  return (
    colleges.find((college) => college.id === selectedIds.value[0])?.name ??
    "未选择学院"
  );
});
watch(
  () => [props.modelValue, ready.value] as const,
  () => {
    if (!ready.value || props.modelValue === "all") return;
    const valid = selectedIds.value;
    const invalid = [
      ...new Set(
        props.modelValue.filter(
          (id) => !colleges.some((college) => college.id === id),
        ),
      ),
    ];
    if (invalid.length) {
      notice.value = `已移除 ${invalid.length} 个失效学院，请重新确认选择。`;
      emit("invalid", invalid);
    }
    if (
      valid.length !== props.modelValue.length ||
      valid.some((id, index) => id !== props.modelValue[index])
    )
      emit("update:modelValue", [...valid]);
  },
  { immediate: true, deep: true },
);
function update(value: CollegeSelection) {
  if (!ready.value) return;
  notice.value = "";
  emit("update:modelValue", value === "all" ? value : [...value]);
  if (value === "all") emit("reset");
  else if (value.length) emit("select", [...value]);
  else emit("clear");
}
function select(id: CollegeId) {
  update(toggleCollegeSelection(selection.value, id));
}
// H5 的 uni-button 需要显式键盘行为；小程序直接使用同节点的原生 button。
function keydown(
  event: { key: string; repeat?: boolean; preventDefault: () => void },
  action: CollegeId | "reset" | "retry",
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (event.repeat) return;
  if (action === "retry") emit("retry");
  else if (action === "reset") update(selection.value === "all" ? [] : "all");
  else select(action);
}
</script>

<template>
  <view
    class="hhr-panel college-picker"
    :class="{ 'college-picker--compact': compact }"
    role="region"
    aria-label="选择学院"
    :aria-busy="status === 'loading'"
  >
    <view class="college-header">
      <text class="college-heading">选择学院</text>
      <button
        class="hhr-button college-reset"
        hover-class="none"
        :class="
          selection === 'all'
            ? 'hhr-button--soft is-all'
            : 'hhr-button--secondary'
        "
        role="button"
        :tabindex="ready ? 0 : -1"
        :disabled="!ready"
        :aria-pressed="selection === 'all'"
        @click="update(selection === 'all' ? [] : 'all')"
        @keydown="keydown($event, 'reset')"
      >
        <text v-if="selection === 'all'" aria-hidden="true">✓</text>全部学院
      </button>
    </view>
    <text class="college-hint">{{
      compact
        ? "承办学院 · 可多选 · 上下滚动查看更多"
        : `${colleges.length} 个本科教学学院 · 上下滚动查看更多`
    }}</text>
    <scroll-view
      class="college-scroll"
      :scroll-y="true"
      role="group"
      aria-label="学院入口，可多选，上下滚动查看更多"
      :tabindex="ready ? 0 : -1"
    >
      <view v-if="status === 'loading'" class="college-feedback" role="status"
        >正在加载学院目录…</view
      >
      <view v-else-if="!ready" class="college-feedback" role="alert">
        <text>{{
          catalogMatches ? errorMessage : "学院目录与本地版本不一致，请重试。"
        }}</text>
        <button
          class="hhr-button hhr-button--secondary"
          hover-class="none"
          role="button"
          :tabindex="0"
          @click="emit('retry')"
          @keydown="keydown($event, 'retry')"
        >
          重新加载
        </button>
      </view>
      <view v-else class="college-grid">
        <view
          v-for="college in colleges"
          :key="college.id"
          class="college-cell"
        >
          <button
            class="hhr-button college-entry"
            hover-class="none"
            :class="{ 'is-selected': selectedIds.includes(college.id) }"
            role="button"
            :tabindex="0"
            :aria-label="college.name"
            :aria-pressed="selectedIds.includes(college.id)"
            :data-college-id="college.id"
            @click="select(college.id)"
            @keydown="keydown($event, college.id)"
          >
            <view class="college-emblem-wrap" aria-hidden="true">
              <CollegeEmblem
                :college-id="college.id"
                decorative
                picker
                :compact="compact"
              />
              <text
                v-if="selectedIds.includes(college.id)"
                class="college-check"
                >✓</text
              >
            </view>
            <text class="college-name">{{ college.name }}</text>
          </button>
        </view>
      </view>
    </scroll-view>
    <view
      class="college-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <text v-if="ready"
        >当前选择：<text class="college-selection">{{
          selectionLabel
        }}</text></text
      >
      <text v-else>{{
        status === "loading"
          ? "目录加载后可选择学院"
          : "学院目录不可用，暂不能选择"
      }}</text>
      <text v-if="notice" class="college-notice">{{ notice }}</text>
    </view>
    <view v-if="$slots.footer" class="college-footer"
      ><slot name="footer"
    /></view>
  </view>
</template>

<style scoped>
.college-picker {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px;
}
.college-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.college-heading {
  font-family: var(--hhr-font-display);
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
}
.college-reset {
  width: auto;
  gap: 8px;
  line-height: 1.65;
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 12px;
}
.college-reset.is-all {
  border-color: var(--hhr-color-brand);
}
.college-hint {
  display: block;
  flex-shrink: 0;
  margin: 4px 0;
  color: var(--hhr-color-muted);
  font-size: 12px;
  line-height: 16px;
}
.college-scroll {
  box-sizing: border-box;
  height: 248px;
  min-height: 0;
  flex-shrink: 0;
  border-top: 1px solid var(--hhr-color-line);
  border-bottom: 1px solid var(--hhr-color-line);
}
.college-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 5px;
}
.college-cell {
  box-sizing: border-box;
  display: flex;
  width: calc((100% - 12px) / 4);
  min-width: 0;
}
.college-entry {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 78px;
  margin: 0;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: var(--hhr-radius-control);
  background: transparent;
  color: var(--hhr-color-ink);
  font-weight: 400;
  font-size: 14px;
  line-height: 1.65;
}
.college-entry.is-selected {
  border-color: var(--hhr-color-brand);
  background: var(--hhr-color-brand-soft);
  font-weight: 600;
}
.college-emblem-wrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
}
.college-check {
  position: absolute;
  right: -2px;
  bottom: -2px;
  box-sizing: border-box;
  display: flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--hhr-color-surface);
  border-radius: 50%;
  background: var(--hhr-color-brand);
  color: var(--hhr-color-surface);
  font-size: 10px;
  line-height: 1;
}
.college-name {
  display: block;
  max-width: 100%;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: normal;
}
.college-status {
  flex-shrink: 0;
  margin-top: 4px;
  color: var(--hhr-color-brand);
  font-size: 12px;
  line-height: 16px;
}
.college-selection {
  font-weight: 700;
}
.college-notice {
  display: block;
  color: var(--hhr-color-danger);
}
.college-footer {
  flex-shrink: 0;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--hhr-color-line);
}
.college-feedback {
  display: flex;
  min-height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  color: var(--hhr-color-muted);
  text-align: center;
  font-size: 14px;
}
.college-picker--compact {
  padding: 7px;
}
.college-picker--compact .college-heading {
  font-size: 16px;
  line-height: 24px;
}
.college-picker--compact .college-reset {
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
.college-picker--compact .college-hint,
.college-picker--compact .college-status {
  margin: 2px 0;
  font-size: 11px;
  line-height: 12px;
}
.college-picker--compact .college-selection {
  color: var(--hhr-color-muted);
}
.college-picker--compact .college-scroll {
  height: 186px;
}
.college-picker--compact .college-entry {
  min-height: 56px;
  gap: 0;
  padding: 0 2px;
}
.college-picker--compact .college-name {
  font-size: 11px;
  line-height: 11px;
}
.college-picker--compact .college-footer {
  margin-top: 2px;
  padding-top: 2px;
}
/* #ifdef H5 */
.college-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--hhr-color-brand) var(--hhr-color-brand-soft);
}
.college-scroll :deep(.uni-scroll-view) {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--hhr-color-brand) var(--hhr-color-brand-soft);
}
.college-entry:focus-visible {
  outline: 2px solid var(--hhr-color-brand);
  outline-offset: -2px;
}
/* #endif */
@media (max-width: 767px) {
  .college-picker {
    padding: 12px;
  }
  .college-picker:not(.college-picker--compact) .college-scroll {
    height: calc(40vh - 110px);
    flex-shrink: 1;
    min-height: 44px;
  }
  .college-picker:not(.college-picker--compact) {
    height: 40vh;
  }
  .college-entry {
    min-height: 68px;
    gap: 2px;
    padding: 2px;
  }
  .college-name {
    line-height: 1.2;
  }
  .college-picker--compact .college-reset {
    min-height: 44px;
    font-size: 13px;
  }
  .college-picker--compact .college-hint,
  .college-picker--compact .college-status {
    margin: 6px 0;
    font-size: 12px;
    line-height: 1.5;
  }
  .college-picker--compact .college-entry {
    min-height: 80px;
    gap: 4px;
    padding: 4px 2px;
  }
  .college-picker--compact .college-name {
    font-size: 12px;
    line-height: 1.4;
  }
  .college-picker--compact .college-scroll {
    height: 200px;
  }
  .college-picker--compact .college-footer {
    margin-top: 8px;
    padding-top: 8px;
  }
}
@media (max-width: 359px) {
  .college-cell {
    width: calc((100% - 8px) / 3);
  }
}
/* #ifdef H5 */
@media (max-width: 767px) {
  .college-picker:not(.college-picker--compact) {
    height: 40svh;
  }
  .college-picker:not(.college-picker--compact) .college-scroll {
    height: calc(40svh - 110px);
  }
}
/* #endif */
</style>
