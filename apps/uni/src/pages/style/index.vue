<script setup lang="ts">
import { ref } from "vue";

/**
 * 样式基线页：逐项渲染主题色、字号层级、按钮状态、徽标、表单与状态块。
 * 页面只消费语义工具类与 .hhr-* 组件类，不写内联品牌色，
 * 因此它同时是后续页面的样式参照和两端构建的回归入口。
 */
const colors = [
  { className: "bg-brand", name: "brand", note: "主要操作与品牌" },
  { className: "bg-brand-hover", name: "brand-hover", note: "主要操作悬停" },
  { className: "bg-brand-soft", name: "brand-soft", note: "浅绿状态" },
  { className: "bg-ink", name: "ink", note: "正文" },
  { className: "bg-muted", name: "muted", note: "辅助文字" },
  { className: "bg-page", name: "page", note: "页面背景" },
  { className: "bg-surface", name: "surface", note: "卡片与表单背景" },
  { className: "bg-line", name: "line", note: "边框与分隔线" },
  { className: "bg-accent", name: "accent", note: "提醒点缀" },
  { className: "bg-accent-soft", name: "accent-soft", note: "提醒浅底" },
  { className: "bg-accent-ink", name: "accent-ink", note: "提醒文字" },
  { className: "bg-danger", name: "danger", note: "错误与危险操作" },
  { className: "bg-danger-soft", name: "danger-soft", note: "错误浅底" },
];

const typeScale = [
  { className: "text-display font-bold", name: "text-display", note: "28px" },
  { className: "text-title font-bold", name: "text-title", note: "21px" },
  {
    className: "text-title-sm font-semibold",
    name: "text-title-sm",
    note: "18px",
  },
  { className: "text-body-lg", name: "text-body-lg", note: "16px" },
  { className: "text-body", name: "text-body", note: "14px" },
  { className: "text-label", name: "text-label", note: "13px" },
  { className: "text-caption", name: "text-caption", note: "12px" },
  { className: "text-eyebrow", name: "text-eyebrow", note: "11px" },
];

const longTitle =
  "关于举办第十届全国大学生生命科学创新创业大赛校内选拔赛决赛的通知与参赛队伍名单公示";
const longToken = "CompetitionRegistrationDeadlineReminderWithoutAnySpace";

const urgent = ref(false);
const teamName = ref("");
</script>

<template>
  <view class="hhr-page">
    <view class="hhr-page__inner">
      <text class="hhr-eyebrow">STYLE BASELINE</text>
      <text class="mt-2 block font-serif text-display font-bold text-ink">
        样式基线
      </text>
      <text class="mt-2 block text-body text-muted">
        禾苗绿、暖白与谷物黄的用户端基线。页面只消费语义工具类，不重复定义色值。
      </text>

      <view class="hhr-panel mt-6">
        <text class="block text-title-sm font-semibold text-ink">品牌色</text>
        <view class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <view
            v-for="color in colors"
            :key="color.name"
            class="rounded-control border border-line border-solid p-2"
            :data-testid="`swatch-${color.name}`"
          >
            <view
              class="h-10 rounded-badge border border-line border-solid"
              :class="color.className"
            />
            <text class="mt-2 block text-caption font-semibold text-ink">
              {{ color.name }}
            </text>
            <text class="block text-caption text-muted">{{ color.note }}</text>
          </view>
        </view>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink">字号层级</text>
        <view class="mt-3 flex flex-col gap-3">
          <view v-for="item in typeScale" :key="item.name">
            <text class="block text-caption text-muted">
              {{ item.name }} · {{ item.note }}
            </text>
            <text class="block text-ink" :class="item.className">
              一起发现，一起成长
            </text>
          </view>
        </view>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink">按钮状态</text>
        <view class="mt-3 flex flex-col gap-3">
          <button class="hhr-button" data-testid="button-primary">
            主要操作
          </button>
          <button
            class="hhr-button hhr-button--secondary"
            data-testid="button-secondary"
          >
            次要操作
          </button>
          <button class="hhr-button hhr-button--soft">轻量操作</button>
          <button
            class="hhr-button hhr-button--danger"
            data-testid="button-danger"
          >
            危险操作
          </button>
          <button
            class="hhr-button is-disabled"
            disabled
            data-testid="button-disabled"
          >
            不可用操作
          </button>
          <button
            class="hhr-button is-loading"
            disabled
            data-testid="button-loading"
          >
            <view class="hhr-spinner" />
            <text>正在提交</text>
          </button>
          <button class="hhr-button" data-testid="button-long">
            确认加入这支队伍并同意向队长公开我的联系方式
          </button>
        </view>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink">状态标签</text>
        <view class="mt-3 flex flex-wrap gap-2">
          <text class="hhr-badge">进行中</text>
          <text class="hhr-badge hhr-badge--warning">即将截止</text>
          <text class="hhr-badge hhr-badge--muted">已结束</text>
          <text class="hhr-badge hhr-badge--danger">名额已满</text>
        </view>
        <view class="mt-3 flex flex-wrap items-center gap-2">
          <text
            class="hhr-badge"
            :class="urgent ? 'hhr-badge--warning' : 'hhr-badge--muted'"
            data-testid="badge-conditional"
          >
            {{ urgent ? "条件类：提醒" : "条件类：弱化" }}
          </text>
          <button
            class="hhr-button hhr-button--soft hhr-button--inline"
            @click="urgent = !urgent"
          >
            切换
          </button>
        </view>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink">表单</text>
        <view class="hhr-field mt-3">
          <text class="hhr-label">队伍名称</text>
          <input
            v-model="teamName"
            class="hhr-input"
            placeholder="例如：禾下乘凉队"
            maxlength="30"
            data-testid="input-team"
          />
          <text class="hhr-field-error" data-testid="field-error">
            队伍名称已被占用，请换一个。
          </text>
        </view>
        <text class="hhr-notice mt-3 block">
          提醒条：报名截止时间为北京时间 10 月 20 日 23:59。
        </text>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink">状态块</text>
        <view class="hhr-state mt-2" data-testid="state-empty">
          <text class="text-title-sm">暂无收藏的比赛</text>
          <text class="text-caption">在比赛详情页点击收藏后会出现在这里。</text>
        </view>
        <view class="hhr-state" data-testid="state-loading">
          <view class="hhr-spinner text-brand" />
          <text class="text-caption">正在加载队伍列表…</text>
        </view>
        <view class="hhr-state hhr-state--error" data-testid="state-error">
          <text class="text-body">加载失败，请稍后重试。</text>
          <button class="hhr-button hhr-button--inline hhr-button--secondary">
            重新加载
          </button>
        </view>
      </view>

      <view class="hhr-card mt-4 p-5">
        <text class="block text-caption text-muted">长标题换行</text>
        <text class="mt-2 block text-title-sm font-semibold text-ink">
          {{ longTitle }}
        </text>
        <text class="mt-3 block break-all text-body text-muted">
          {{ longToken }}
        </text>
      </view>

      <view class="hhr-panel mt-4">
        <text class="block text-title-sm font-semibold text-ink"
          >触控与尺寸</text
        >
        <view class="mt-3 flex flex-wrap items-center gap-3">
          <view
            class="flex min-h-[44px] w-[168px] items-center justify-center rounded-control bg-brand-soft px-2 text-label text-brand"
            data-testid="touch-target"
          >
            44px 高触控区
          </view>
          <text class="text-caption text-muted">
            触控下限与任意值类写 px，间距写 rem；320px 宽下 44px 仍不缩小。
          </text>
        </view>
      </view>

      <text class="mt-6 block text-caption text-muted">
        本页仅用于样式回归，不承载业务逻辑。
      </text>
    </view>
  </view>
</template>
