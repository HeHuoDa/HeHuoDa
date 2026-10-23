<script setup lang="ts">
import { onScopeDispose, reactive, ref, watch } from "vue";
import { usePageLifecycle } from "../../lifecycle/use-page-lifecycle";
import { competitionApi } from "../../api/competitions";
import AppIcon from "../../components/AppIcon.vue";
import FormButton from "../../components/FormButton.vue";
import { openPage, openTab } from "../../navigation/navigate";
import { useSessionStore } from "../../stores/session";
import {
  createFavoritesController,
  initialFavoritesState,
} from "../../stores/favorites-controller";

const session = useSessionStore();
const state = reactive(initialFavoritesState());
const controller = createFavoritesController(
  state,
  () => session.favorites,
  competitionApi,
);
const feedback = ref("");
watch(
  () => session.favorites.map(({ id, order }) => `${id}:${order}`),
  controller.sync,
  { flush: "sync" },
);
function remove(id: string, name?: string) {
  session.removeFavorite(id);
  feedback.value = `已取消收藏${name ? `「${name}」` : "该比赛"}。`;
}
usePageLifecycle({
  show() {
    feedback.value = "";
    controller.start();
  },
  hide: controller.stop,
});
const unregisterReset = session.registerReset(Symbol("favorites"), () => {
  // 保持可见性，先取消旧请求；集合清空后同步 watcher 会清除行。
  controller.reset();
  feedback.value = "";
});
onScopeDispose(unregisterReset);
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <view class="mb-5">
        <text class="hhr-eyebrow">SAVED FOR LATER</text>
        <text class="block mt-2 font-serif text-display">我的收藏</text>
        <text class="block mt-3 text-body text-muted"
          >把感兴趣的比赛留在这里，慢慢了解，再出发。</text
        >
      </view>
      <view class="hhr-notice mb-4">
        <text class="block text-body"
          >已收藏 {{ session.favoriteCount }} 场比赛 · 最近收藏在前</text
        >
        <text class="block mt-1 text-caption text-muted"
          >仅当前会话保留，刷新、冷启动或重置后清空；暂不可用的比赛仍计入数量。</text
        >
      </view>
      <view
        v-if="feedback"
        class="hhr-notice mb-4"
        role="status"
        aria-live="polite"
        >{{ feedback }}</view
      >
      <view v-if="!session.favoriteCount" class="hhr-panel p-6 text-center">
        <AppIcon name="star" :size="32" />
        <text class="block mt-4 text-title-sm">还没有收藏的比赛</text>
        <text class="block mt-2 mb-5 text-body text-muted"
          >在比赛详情页点击收藏，下次回来就能继续了解。</text
        >
        <FormButton @click="openTab('home')">去看看比赛</FormButton>
      </view>
      <view v-else class="flex flex-col gap-4">
        <view
          v-for="row in state.rows"
          :key="row.id + ':' + row.order"
          class="hhr-card p-5"
        >
          <template v-if="row.status === 'ready' && row.detail">
            <text class="text-caption text-brand"
              >{{ row.detail.category || "比赛" }} ·
              {{ row.detail.edition || "届次待补充" }}</text
            >
            <text
              class="block mt-2 text-title-sm"
              role="heading"
              aria-level="2"
              >{{ row.detail.name }}</text
            >
            <text class="block mt-2 text-body text-muted">{{
              row.detail.organizer || "组织单位待补充"
            }}</text>
            <text class="block mt-2 text-caption text-muted"
              >{{ row.detail.stages.length }} 个赛段 ·
              报名资格与时间请查看详情，以官方通知为准。</text
            >
          </template>
          <view v-else-if="row.status === 'missing'" role="status">
            <text class="block text-title-sm">比赛暂不可用</text>
            <text class="block mt-2 text-body text-muted"
              >该比赛可能已隐藏或不存在。收藏仍保留，你可以取消或重新查询。</text
            >
            <text class="block mt-2 text-caption text-muted"
              >比赛编号：{{ row.id }}</text
            >
          </view>
          <view v-else-if="row.status === 'error'" role="alert">
            <text class="block text-title-sm">暂时无法加载比赛</text>
            <text class="block mt-2 text-body text-danger">{{
              row.error
            }}</text>
            <text class="block mt-2 text-caption text-muted"
              >收藏仍保留 · 比赛编号：{{ row.id }}</text
            >
          </view>
          <view v-else role="status" aria-live="polite">
            <text class="block text-body text-muted">{{
              row.status === "loading" ? "正在加载比赛…" : "等待加载比赛…"
            }}</text>
          </view>
          <text v-if="row.requestId" class="block mt-2 text-caption text-muted"
            >请求编号：{{ row.requestId }}</text
          >
          <view class="mt-4 flex flex-wrap gap-2">
            <FormButton
              v-if="row.status === 'ready'"
              class="favorite-action"
              @click="openPage('competition-detail', { id: row.id })"
              >查看详情</FormButton
            >
            <FormButton
              v-else-if="row.status === 'error' || row.status === 'missing'"
              class="favorite-action"
              variant="secondary"
              @click="controller.retry(row.id)"
              >{{
                row.status === "missing" ? "重新查询" : "重试加载"
              }}</FormButton
            >
            <FormButton
              class="favorite-action"
              variant="secondary"
              :aria-label="`取消收藏${row.detail?.name || row.id}`"
              @click="remove(row.id, row.detail?.name)"
              >取消收藏</FormButton
            >
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.favorite-action {
  flex: 1 1 100px;
  min-width: 0;
}
</style>
