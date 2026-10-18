<script setup lang="ts">
import { storeToRefs } from "pinia";
import { version } from "vue";
import { useWorkspaceStore } from "../../stores/workspace";

const store = useWorkspaceStore();
const { count, input } = storeToRefs(store);
</script>

<template>
  <view class="workspace-page min-h-screen px-5 py-8">
    <view class="mx-auto max-w-lg">
      <text class="block text-sm font-semibold text-green-800">禾伙搭</text>
      <text class="mt-3 block text-2xl font-bold">一起发现，一起成长</text>
      <text class="mt-3 block text-base leading-7 text-stone-600">
        新客户端正在迁移。本页用于验证工程入口，业务页面将在后续任务接入。
      </text>
      <view
        class="mt-8 rounded-2xl border border-solid border-stone-200 bg-white p-5"
      >
        <text class="block text-lg font-semibold">交互检查</text>
        <text class="mt-4 block" data-testid="count">计数：{{ count }}</text>
        <button class="workspace-button mt-3" @click="store.increment">
          增加一次
        </button>
        <text class="mt-6 block">输入内容</text>
        <input
          v-model="input"
          class="workspace-input mt-2"
          placeholder="请输入文字"
          maxlength="100"
          aria-label="输入内容"
        />
        <text class="mt-3 block break-all text-stone-600" data-testid="echo">
          {{ input || "尚未输入" }}
        </text>
      </view>
      <text class="mt-6 block break-all text-sm text-stone-500">
        本地工程验证 · Vue 运行时 {{ version }}
      </text>
    </view>
  </view>
</template>
