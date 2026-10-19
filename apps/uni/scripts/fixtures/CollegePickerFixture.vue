<script setup lang="ts">
import { ref } from "vue";
import { colleges } from "@hehuoda/client-domain/colleges";
import type { CollegeSelection } from "@hehuoda/client-domain/college-selection";
import CollegePicker from "../../src/components/CollegePicker.vue";
import FormButton from "../../src/components/FormButton.vue";

const selection = ref<CollegeSelection>("all");
const status = ref<"ready" | "loading" | "error">("ready");
const mismatched = ref(false);
const actions = ref(0);
function ready() {
  status.value = "ready";
  mismatched.value = false;
}
function invalid() {
  ready();
  selection.value = ["missing-college", "law", "law"] as CollegeSelection;
}
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <text class="block text-title font-semibold">学院选择组件验收</text>
      <view class="fixture-controls">
        <FormButton @click="ready">就绪</FormButton>
        <FormButton @click="status = 'loading'">加载</FormButton>
        <FormButton @click="status = 'error'">失败</FormButton>
        <FormButton @click="mismatched = true">目录不一致</FormButton>
        <FormButton @click="invalid">失效选择</FormButton>
        <FormButton @click="selection = 'all'">恢复全部</FormButton>
        <FormButton @click="selection = []">恢复空选</FormButton>
      </view>
      <text data-testid="selection" class="block text-caption">{{
        JSON.stringify(selection)
      }}</text>
      <CollegePicker
        v-model="selection"
        compact
        :status="status"
        :catalog="mismatched ? [] : colleges"
        @retry="ready"
      >
        <template #footer>
          <FormButton
            class="fixture-footer"
            variant="secondary"
            @click="actions++"
            >外层操作 {{ actions }}</FormButton
          >
        </template>
      </CollegePicker>
      <view class="fixture-gap" />
      <CollegePicker
        v-model="selection"
        :status="status"
        :catalog="mismatched ? [] : colleges"
        @retry="ready"
      />
      <view class="fixture-gap" />
      <FormButton @click="actions++">页面底部操作 {{ actions }}</FormButton>
    </view>
  </view>
</template>

<style scoped>
.fixture-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.fixture-controls > view {
  min-height: 44px;
}
.fixture-gap {
  height: 24px;
}
.fixture-footer {
  width: 100%;
}
</style>
