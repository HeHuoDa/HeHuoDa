<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { onPageHide, onUnload } from "@dcloudio/uni-app";
import { competitionApi } from "../api/competitions";
import {
  createDetailController,
  initialDetailState,
} from "../stores/detail-controller";
import CompetitionSourceAction from "./CompetitionSourceAction.vue";
import FormButton from "./FormButton.vue";

const props = defineProps<{ competitionId: string; stageId: string }>();
const state = reactive(initialDetailState());
const controller = createDetailController(state, competitionApi);
const expanded = ref(false);
const sources = computed(() => {
  const stage = state.detail?.stages.find((item) => item.id === props.stageId);
  return (
    state.detail?.notices.filter((notice) =>
      stage?.sourceIds.includes(notice.id),
    ) || []
  );
});
function close() {
  controller.cancel();
  expanded.value = false;
  state.detail = null;
  state.status = "idle";
}
function load() {
  expanded.value = true;
  void controller.load(props.competitionId);
}
watch(() => [props.competitionId, props.stageId], close, { flush: "sync" });
onPageHide(close);
onUnload(close);
onBeforeUnmount(close);
</script>

<template>
  <view class="competition-sources">
    <FormButton
      variant="reveal"
      :loading="state.status === 'loading'"
      @click="expanded ? close() : load()"
    >
      {{ expanded ? "收起官方来源" : "查看官方来源" }}
    </FormButton>
    <view v-if="expanded" aria-live="polite">
      <text v-if="state.status === 'loading'" class="sources-message"
        >正在读取官方来源…</text
      >
      <view v-else-if="state.status === 'error' || state.status === 'missing'">
        <text class="sources-message">{{ state.error }}</text>
        <text v-if="state.requestId" class="sources-message"
          >请求编号：{{ state.requestId }}</text
        >
        <FormButton variant="reveal" @click="load">重试来源</FormButton>
      </view>
      <template v-else-if="state.status === 'ready'">
        <CompetitionSourceAction
          v-for="notice in sources"
          :key="notice.id"
          :notice="notice"
          compact
        />
        <text v-if="!sources.length" class="sources-message"
          >此赛段暂无可用官方来源，请进入比赛详情核对。</text
        >
      </template>
    </view>
  </view>
</template>

<style scoped>
.competition-sources {
  min-width: 0;
  margin-top: 0.5rem;
}
.sources-message {
  display: block;
  font-size: 12px;
  color: var(--hhr-color-muted);
  overflow-wrap: anywhere;
}
</style>
