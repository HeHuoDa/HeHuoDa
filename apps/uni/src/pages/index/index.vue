<script setup lang="ts">
import { storeToRefs } from "pinia";
import { version } from "vue";
import { useWorkspaceStore } from "../../stores/workspace";

const store = useWorkspaceStore();
const { count, input } = storeToRefs(store);
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <text class="hhr-eyebrow">禾伙搭 · 用户端</text>
      <text class="mt-2 block font-serif text-display font-bold text-ink">
        一起发现，一起成长
      </text>
      <text class="mt-3 block text-body text-muted">
        新客户端正在迁移。本页用于验证工程入口与共享主题，业务页面将在后续任务接入。
      </text>

      <view class="hhr-panel mt-6">
        <text class="block text-title-sm font-semibold text-ink">交互检查</text>
        <text class="mt-4 block text-body text-ink" data-testid="count">
          计数：{{ count }}
        </text>
        <button class="hhr-button mt-3" @click="store.increment">
          增加一次
        </button>

        <view class="hhr-field mt-5">
          <text class="hhr-label">输入内容</text>
          <input
            v-model="input"
            class="hhr-input"
            placeholder="请输入文字"
            maxlength="100"
            aria-label="输入内容"
          />
        </view>
        <text
          class="mt-3 block break-all text-body text-muted"
          data-testid="echo"
        >
          {{ input || "尚未输入" }}
        </text>
      </view>

      <text class="mt-6 block break-all text-caption text-muted">
        本地工程验证 · Vue 运行时 {{ version }}
      </text>
    </view>
  </view>
</template>
