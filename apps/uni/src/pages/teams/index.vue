<script setup lang="ts">
import PlaceholderPage from "../../components/PlaceholderPage.vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import { openPage } from "../../navigation/navigate";
import { parseBusinessId } from "../../navigation/params";
import { useNavigationStore } from "../../stores/navigation";
const navigation = useNavigationStore();
const competition = ref("");
function receive(query: Record<string, unknown>) {
  const parsed = parseBusinessId(query.competition);
  competition.value = parsed.issue ? "" : parsed.value;
}
onLoad((query) => receive(query ?? {}));
onShow(() => {
  const query = navigation.consumeTabQuery("teams");
  if (query) receive(query);
});
</script>

<template>
  <view class="hhr-page hhr-page--tab">
    <view class="hhr-page__inner">
      <PlaceholderPage
        title="找队友"
        description="按项目与角色发现招募，寻找志同道合的伙伴。"
      >
        <text v-if="competition" class="recruitment-context"
          >已选择关联比赛。招募列表将在这里展示。</text
        >
        <button
          class="hhr-button hhr-button--inline"
          @click="openPage('team-new')"
        >
          发布招募
        </button>
        <button
          class="hhr-button hhr-button--soft hhr-button--inline"
          @click="openPage('team-detail', { id: 'preview' })"
        >
          队伍详情 · 占位预览
        </button>
      </PlaceholderPage>
    </view>
  </view>
</template>
