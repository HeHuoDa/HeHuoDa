<script setup lang="ts">
import { computed, ref } from "vue";
import { colleges, type CollegeId } from "../data/colleges";
import type { CollegeSelection } from "../data/college-selection";

defineProps<{ compact?: boolean }>();

const selected = defineModel<CollegeSelection>({ required: true });
const emit = defineEmits<{
  select: [ids: CollegeId[]];
  reset: [];
  clear: [];
}>();
const failed = ref(new Set<CollegeId>());
const selectedIds = computed(() =>
  selected.value === "all" ? [] : selected.value,
);
const selectionLabel = computed(() => {
  if (selected.value === "all") return "全部学院";
  if (selectedIds.value.length > 1)
    return `已选择 ${selectedIds.value.length} 个学院`;
  return (
    colleges.find((college) => college.id === selectedIds.value[0])?.name ??
    "未选择学院"
  );
});

function select(id: CollegeId) {
  const ids = selectedIds.value.includes(id)
    ? selectedIds.value.filter((selectedId) => selectedId !== id)
    : [...selectedIds.value, id];
  selected.value = ids;
  if (ids.length === 0) emit("clear");
  else emit("select", [...ids]);
}
function reset() {
  if (selected.value === "all") {
    selected.value = [];
    emit("clear");
    return;
  }
  selected.value = "all";
  emit("reset");
}
</script>

<template>
  <section
    class="hhr-panel college-picker flex flex-col p-4 max-[767px]:p-3"
    :class="{
      'max-[767px]:h-[40svh]': !compact,
      'college-picker--compact': compact,
    }"
    aria-labelledby="college-heading"
  >
    <header class="flex shrink-0 items-center justify-between gap-3">
      <div>
        <h2 id="college-heading" class="font-serif text-lg font-semibold">
          选择学院
        </h2>
      </div>
      <button
        type="button"
        class="hhr-button college-reset min-h-11 shrink-0 px-3"
        :class="
          selected === 'all'
            ? 'hhr-button--soft border-brand'
            : 'hhr-button--secondary'
        "
        :aria-pressed="selected === 'all'"
        @click="reset"
      >
        <span v-if="selected === 'all'" aria-hidden="true">✓</span>全部学院
      </button>
    </header>
    <p id="college-scroll-hint" class="my-1 shrink-0 text-xs text-muted">
      {{
        compact
          ? "承办学院 · 可多选 · 上下滚动查看更多"
          : "27 个本科教学学院 · 上下滚动查看更多"
      }}
    </p>
    <div
      class="college-scroll min-h-0 overflow-y-auto border-y border-line"
      :class="compact ? 'h-[186px] shrink-0' : 'h-[248px] max-[767px]:flex-1'"
      role="group"
      aria-label="学院入口，可多选"
      aria-describedby="college-scroll-hint"
      tabindex="0"
    >
      <div class="college-grid grid grid-cols-4 gap-1 px-[5px] py-1">
        <button
          v-for="(college, index) in colleges"
          :key="college.id"
          type="button"
          class="college-entry flex min-h-[78px] min-w-0 cursor-pointer flex-col items-center gap-1 rounded-control border border-transparent px-0.5 py-1 max-[767px]:min-h-[68px] max-[767px]:gap-0.5 max-[767px]:py-0.5"
          :class="{
            'is-selected': selectedIds.includes(college.id),
          }"
          :aria-label="college.name"
          :aria-pressed="selectedIds.includes(college.id)"
          :data-college-id="college.id"
          @click="select(college.id)"
        >
          <span
            class="college-emblem relative grid size-12 shrink-0 place-items-center rounded-[50%] border border-line bg-surface max-[767px]:size-9"
            :class="{
              'college-emblem--white-artwork':
                college.whiteArtwork && !failed.has(college.id),
            }"
            aria-hidden="true"
          >
            <img
              v-if="college.emblem && !failed.has(college.id)"
              :src="college.emblem"
              alt=""
              width="40"
              height="40"
              :loading="index < 12 ? 'eager' : 'lazy'"
              decoding="async"
              class="size-10 object-contain max-[767px]:size-7"
              @error="failed.add(college.id)"
            />
            <span
              v-else
              class="college-initial font-serif text-xl font-semibold text-brand max-[767px]:text-lg"
              >{{ college.name[0] }}</span
            >
            <span
              v-if="selectedIds.includes(college.id)"
              class="college-check absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center rounded-full border-2 border-surface bg-brand text-[10px] text-surface"
              >✓</span
            >
          </span>
          <span
            class="college-name max-w-full text-xs leading-[1.4] wrap-anywhere max-[767px]:leading-[1.2]"
            >{{ college.name }}</span
          >
        </button>
      </div>
    </div>
    <p
      class="mt-1 shrink-0 text-xs text-brand"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      当前选择：<strong>{{ selectionLabel }}</strong>
    </p>
    <div
      v-if="$slots.footer"
      class="college-footer mt-2 shrink-0 border-t border-line pt-2"
    >
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.college-picker--compact {
  padding: 7px;
}
.college-picker--compact h2 {
  font-size: 16px;
  line-height: 24px;
}
.college-picker--compact .college-reset {
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
.college-picker--compact #college-scroll-hint,
.college-picker--compact > [role="status"] {
  margin: 2px 0;
  font-size: 11px;
  line-height: 12px;
}
.college-picker--compact > [role="status"] strong {
  color: var(--hhr-color-muted);
}
.college-picker--compact .college-entry {
  height: 56px;
  min-height: 56px;
  gap: 0;
  padding: 0 2px;
}
.college-picker--compact .college-emblem {
  width: 32px;
  height: 32px;
}
.college-picker--compact .college-emblem img {
  width: 26px;
  height: 26px;
}
.college-picker--compact .college-name {
  font-size: 11px;
  line-height: 11px;
}
.college-picker--compact .college-footer {
  margin-top: 2px;
  padding-top: 2px;
}
.college-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--hhr-color-brand) var(--hhr-color-brand-soft);
}
.college-entry.is-selected {
  background: var(--hhr-color-brand-soft);
}
.college-entry.is-selected {
  border-color: var(--hhr-color-brand);
  font-weight: 600;
}
/* 部分官网院徽为白色透明图案，用主题底衬保持原图可见。 */
.college-emblem--white-artwork {
  background: var(--hhr-color-brand);
}
@media (max-width: 767px) {
  .college-picker--compact {
    padding: 12px;
  }
  .college-picker--compact .college-reset {
    min-height: 44px;
    font-size: 13px;
  }
  .college-picker--compact #college-scroll-hint,
  .college-picker--compact > [role="status"] {
    margin-block: 6px;
    font-size: 12px;
    line-height: 1.5;
  }
  .college-picker--compact .college-entry {
    height: auto;
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
  .college-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
